import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyRequest } from "fastify";
import { config } from "@/config.js";
import { registerRoutes } from "@/server/routes.js";
import { getLoggerOptions } from "@/utils/logger.js";

const isDev = process.env.NODE_ENV !== "production";

const app = Fastify({
  logger: getLoggerOptions(),
});

await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 20, // max files per request (batch upload)
  },
});

/**
 * Custom Error subclass thrown by the rate-limit `errorResponseBuilder`.
 * Carries the V1 unified error envelope (`{ error: { code, message } }`)
 * via `toJSON`, while still exposing `statusCode` so Fastify's default
 * error handler returns HTTP 429.
 */
class RateLimitError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "RateLimitError";
    this.statusCode = statusCode;
    this.code = code;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

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
  errorResponseBuilder: (_req, context) =>
    new RateLimitError(
      context.statusCode,
      "RATE_LIMITED",
      `Too many requests, retry after ${context.after}.`,
    ),
});

// Shape rate-limit errors into the V1 unified envelope. Other errors still
// fall through to Fastify's default handler.
app.setErrorHandler((error, _request, reply) => {
  if (error instanceof RateLimitError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
});

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
