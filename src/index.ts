import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import { config } from "@/config.js";
import { RateLimitError } from "@/server/errors.js";
import authPlugin from "@/server/plugins/auth.js";
import errorHandlerPlugin from "@/server/plugins/error-handler.js";
import swaggerPlugin from "@/server/plugins/swagger.js";
import { registerRoutes } from "@/server/routes/index.js";
import { getLoggerOptions } from "@/utils/logger.js";

const isDev = process.env.NODE_ENV !== "production";

const app = Fastify({
  logger: getLoggerOptions(),
});

// error-handler must register first so plugin-stage errors (multipart parse,
// rate-limit overflow, auth failure) all flow through the unified envelope.
await app.register(errorHandlerPlugin);

await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 20, // max files per request (batch upload)
  },
});

await app.register(rateLimit, {
  max: config.server.rateLimit.max,
  timeWindow: config.server.rateLimit.timeWindow,
  /**
   * Single-user deploy: every request from the iOS app / agents carries the
   * same Bearer key, so keying by API key keeps each "user" isolated.
   * Behind Tailscale NAT, `req.ip` would collapse all clients into one bucket
   * — so only fall back to it when the Authorization header is missing.
   */
  keyGenerator: (req: FastifyRequest) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      return `bearer:${auth.slice(7)}`;
    }
    return req.ip;
  },
  // The plugin throws this; our setErrorHandler picks it up via instanceof
  // ApiError and writes the V1 envelope at the right HTTP status.
  errorResponseBuilder: (_req, context) =>
    new RateLimitError(
      `Too many requests, retry after ${context.after}.`,
      typeof context.after === "number" ? context.after : undefined,
    ),
});

// `@fastify/swagger-ui` registers multiple sub-paths under its routePrefix
// (UI HTML, /json spec, /yaml spec, /static/* assets). The auth plugin's
// path-based skipping is exact-match against `req.routeOptions.url`, so we
// extend the default skip list explicitly. Keep this in sync with
// `swagger.ts`'s routePrefix.
await app.register(authPlugin, {
  skipPaths: [
    "/health",
    "/dev",
    "/dev/clear-snap-mind",
    "/api/docs",
    "/api/docs/",
    "/api/docs/json",
    "/api/docs/yaml",
    "/api/docs/static/index.html",
    "/api/docs/static/swagger-initializer.js",
    "/api/docs/static/*",
  ],
});

// `@fastify/swagger` collects route schemas via the `onRoute` hook — it must
// register *before* `registerRoutes` or it will see zero routes.
await app.register(swaggerPlugin);

await registerRoutes(app);

try {
  await app.listen({
    port: config.server.port,
    host: config.server.host,
  });
  app.log.info(
    {
      vault: config.vault.basePath,
    },
    "Obsidian vault path",
  );
  if (isDev) {
    app.log.info(`Dev upload page: http://localhost:${config.server.port}/dev`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
