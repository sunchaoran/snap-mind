import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { clearSnapMindVault } from "@/writer/markdown.js";

const isDev = process.env.NODE_ENV !== "production";

export async function registerMetaRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
    };
  });

  if (!isDev) {
    return;
  }

  app.post("/dev/clear-snap-mind", async (_request, reply) => {
    try {
      const cleared = await clearSnapMindVault();
      return {
        success: true,
        ...cleared,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        success: false,
        error: message,
      });
    }
  });

  app.get("/dev", async (_request, reply) => {
    const html = await readFile(
      join(import.meta.dirname, "..", "dev-upload.html"),
      "utf-8",
    );
    return reply.type("text/html").send(html);
  });
}
