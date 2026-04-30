import type { FastifyInstance } from "fastify";
import { deleteClip, getClip, listClips } from "@/library/clips.js";
import { ERR_CLIP_NOT_FOUND, NotFoundError } from "@/server/errors.js";

export async function registerClipReadRoutes(app: FastifyInstance) {
  // Clip read / delete (vault-as-source-of-truth).
  app.get(
    "/api/v1/clip",
    {
      schema: {
        tags: [
          "clips",
        ],
        summary: "List all clips",
        description:
          "Reads `ClipRecordWire[]` from the vault. No `contentFull`.",
        response: {
          200: {
            type: "object",
            required: [
              "clips",
            ],
            properties: {
              clips: {
                type: "array",
                items: {
                  $ref: "ClipRecordWire#",
                },
              },
            },
          },
          401: {
            $ref: "ErrorEnvelope#",
          },
        },
      },
    },
    async () => {
      const clips = await listClips();
      return {
        clips,
      };
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/clip/:id",
    {
      schema: {
        tags: [
          "clips",
        ],
        summary: "Get one clip by id",
        description: "Returns `ClipRecordWireFull` (includes `contentFull`).",
        params: {
          type: "object",
          required: [
            "id",
          ],
          properties: {
            id: {
              type: "string",
            },
          },
        },
        response: {
          200: {
            $ref: "ClipRecordWireFull#",
          },
          401: {
            $ref: "ErrorEnvelope#",
          },
          404: {
            $ref: "ErrorEnvelope#",
          },
        },
      },
    },
    async (request) => {
      const clip = await getClip(request.params.id);
      if (!clip) {
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }
      return clip;
    },
  );

  app.delete<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/clip/:id",
    {
      schema: {
        tags: [
          "clips",
        ],
        summary: "Hard-delete a clip",
        description:
          "Removes the .md and assets from the vault. 204 on success.",
        params: {
          type: "object",
          required: [
            "id",
          ],
          properties: {
            id: {
              type: "string",
            },
          },
        },
        response: {
          204: {
            type: "null",
            description: "Deleted (no body)",
          },
          401: {
            $ref: "ErrorEnvelope#",
          },
          404: {
            $ref: "ErrorEnvelope#",
          },
        },
      },
    },
    async (request, reply) => {
      const result = await deleteClip(request.params.id);
      if (result === "notfound") {
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }
      return reply.status(204).send();
    },
  );
}
