import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { clearSnapMindVault } from "@/writer/markdown.js";

const isDev = process.env.NODE_ENV !== "production";

export async function registerMetaRoutes(app: FastifyInstance) {
  app.get(
    "/health",
    {
      schema: {
        tags: [
          "meta",
        ],
        summary: "Liveness probe",
        description:
          'Always returns `{ status: "ok" }` once the process is up. No auth.',
        // Auth-skip route — opt out of the global Bearer requirement so the
        // generated spec correctly advertises this as public.
        security: [],
        response: {
          200: {
            type: "object",
            required: [
              "status",
            ],
            properties: {
              status: {
                type: "string",
                enum: [
                  "ok",
                ],
              },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: "ok",
      };
    },
  );

  if (!isDev) {
    return;
  }

  // Dev-only: any throw here propagates to the global error handler, which
  // produces the unified envelope. The handler also logs the original error
  // (including stack) without leaking it into the response.
  app.post("/dev/clear-snap-mind", async () => {
    const cleared = await clearSnapMindVault();
    return {
      success: true,
      ...cleared,
    };
  });

  app.get("/dev", async (_request, reply) => {
    const html = await readFile(
      join(import.meta.dirname, "..", "dev-upload.html"),
      "utf-8",
    );
    return reply.type("text/html").send(html);
  });
}
