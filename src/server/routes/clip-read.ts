import type { FastifyInstance } from "fastify";
import { deleteClip, getClip, listClips } from "@/library/clips.js";
import { ERR_CLIP_NOT_FOUND, NotFoundError } from "@/server/errors.js";

export async function registerClipReadRoutes(app: FastifyInstance) {
  // Clip read / delete (vault-as-source-of-truth).
  app.get("/api/v1/clip", async () => {
    const clips = await listClips();
    return {
      clips,
    };
  });

  app.get<{
    Params: {
      id: string;
    };
  }>("/api/v1/clip/:id", async (request) => {
    const clip = await getClip(request.params.id);
    if (!clip) {
      throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
    }
    return clip;
  });

  app.delete<{
    Params: {
      id: string;
    };
  }>("/api/v1/clip/:id", async (request, reply) => {
    const result = await deleteClip(request.params.id);
    if (result === "notfound") {
      throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
    }
    return reply.status(204).send();
  });
}
