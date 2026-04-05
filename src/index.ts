import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { config } from "./config.js";
import { registerRoutes } from "./server/routes.js";

const app = Fastify({
  logger: true,
});

await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max screenshot size
  },
});

await registerRoutes(app);

try {
  await app.listen({ port: config.server.port, host: config.server.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
