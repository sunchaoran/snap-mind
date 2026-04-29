import type { FastifyInstance } from "fastify";
import { deleteClip, getClip, listClips } from "@/library/clips.js";
import { authenticate } from "@/server/auth.js";
import { ERR_CLIP_NOT_FOUND } from "@/server/errors.js";

export async function registerClipReadRoutes(app: FastifyInstance) {
  // Clip read / delete (vault-as-source-of-truth).
  app.get("/api/v1/clip", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth.ok) {
      return reply.status(401).send({
        success: false,
        error: auth.error.message,
      });
    }
    const clips = await listClips();
    return {
      clips,
    };
  });

  app.get<{
    Params: {
      id: string;
    };
  }>("/api/v1/clip/:id", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth.ok) {
      return reply.status(401).send({
        success: false,
        error: auth.error.message,
      });
    }
    const clip = await getClip(request.params.id);
    if (!clip) {
      return reply.status(404).send({
        error: ERR_CLIP_NOT_FOUND,
      });
    }
    return clip;
  });

  app.delete<{
    Params: {
      id: string;
    };
  }>("/api/v1/clip/:id", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth.ok) {
      return reply.status(401).send({
        success: false,
        error: auth.error.message,
      });
    }
    const result = await deleteClip(request.params.id);
    if (result === "notfound") {
      return reply.status(404).send({
        error: ERR_CLIP_NOT_FOUND,
      });
    }
    return reply.status(204).send();
  });
}
