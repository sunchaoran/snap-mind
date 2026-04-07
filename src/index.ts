import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { config } from "@/config.js";
import { registerRoutes } from "@/server/routes.js";

const isDev = process.env.NODE_ENV !== "production";

const app = Fastify({
  logger: {
    level: isDev ? "debug" : "info",
    ...(isDev && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    }),
  },
});

await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 20, // max files per request (batch upload)
  },
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
