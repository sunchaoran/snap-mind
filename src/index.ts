import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { config } from "@/config.js";
import { closeBrowser } from "@/fetcher/web-fetch.js";
import { registerRoutes } from "@/server/routes.js";
import { createLogger } from "@/utils/logger.js";

const isDev = process.env.NODE_ENV !== "production";
const log = createLogger("server");

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
    fileSize: 20 * 1024 * 1024, // 20MB max screenshot size
  },
});

await registerRoutes(app);

// ── Startup Diagnostics ──

function redactKey(key: string | undefined): string {
  if (!key) {
    return "(not set)";
  }
  if (key.length <= 8) {
    return "***";
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

// ── Graceful Shutdown ──

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  log.info(
    {
      signal,
    },
    "Graceful shutdown initiated",
  );

  try {
    // Stop accepting new connections, wait for in-flight requests
    await app.close();
    log.info("HTTP server closed");
  } catch (err) {
    log.error(
      {
        err,
      },
      "Error closing HTTP server",
    );
  }

  try {
    await closeBrowser();
    log.info("Browser connection closed");
  } catch {
    // Browser may not be connected
  }

  log.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start Server ──

try {
  await app.listen({
    port: config.server.port,
    host: config.server.host,
  });

  log.info("═══════════════════════════════════════════════");
  log.info("  SnapMind Server Started");
  log.info("═══════════════════════════════════════════════");
  log.info(
    {
      port: config.server.port,
      host: config.server.host,
      vault: config.vault.basePath,
      llmKey: redactKey(config.llm.apiKey),
      vlmModels: config.llm.models.vlm,
      processorModel: config.llm.models.processor,
      cdpUrl: config.playwright.cdpUrl,
      maxFetchLevel: config.processing.maxFetchLevel,
    },
    "Configuration",
  );

  if (isDev) {
    log.info(`Dev upload page: http://localhost:${config.server.port}/dev`);
  }
} catch (err) {
  log.error(err, "Failed to start server");
  process.exit(1);
}
