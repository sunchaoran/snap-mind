import type { FastifyInstance } from "fastify";
import { authenticate, UnauthorizedError } from "./auth.js";

export async function registerRoutes(app: FastifyInstance) {
  app.post("/clip", async (request, reply) => {
    // 1. Authenticate
    try {
      await authenticate(request);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return reply.status(401).send({ success: false, error: err.message });
      }
      throw err;
    }

    // 2. Parse multipart image
    const data = await request.file();
    if (!data) {
      return reply
        .status(400)
        .send({ success: false, error: "Missing image file" });
    }

    const imageBuffer = await data.toBuffer();

    // TODO: implement full processing pipeline
    // generateClipId → vlmAnalyzer → findSimilar → contentFetcher
    // → contentProcessor → screenshotStore → clipWriter

    return reply.send({
      success: true,
      clipId: "stub",
      message: "TODO: implement processing pipeline",
    });
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });
}
