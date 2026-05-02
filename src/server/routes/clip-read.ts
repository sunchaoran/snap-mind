import { resolve as pathResolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "@/config.js";
import {
  deleteClip,
  getClip,
  isSafeClipId,
  listClips,
} from "@/library/clips.js";
import { handleRetry, handleRetryFailure } from "@/pipeline/retry.js";
import { withTimeout } from "@/pipeline/timing.js";
import { ERR_CLIP_NOT_FOUND, NotFoundError } from "@/server/errors.js";
import { createJob, jobError } from "@/server/job-store.js";
import { loadScreenshot } from "@/store/screenshot.js";
import { createLogger } from "@/utils/logger.js";
import { clipExists } from "@/writer/markdown.js";

const SCREENSHOT_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const log = createLogger("clip-retry");

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

  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/clip/:id/screenshot",
    {
      schema: {
        tags: [
          "clips",
        ],
        summary: "Get the raw screenshot bytes for a clip",
        description:
          "Streams the on-disk screenshot for the given clip id. Content-Type matches the stored image format (png/jpeg/webp/gif). Returns 404 if either the clip or its screenshot file is missing — callers should fall back to a placeholder. Invalid ids (path-traversal attempts, etc.) are rejected as 404 to match other clip-by-id routes.",
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
            description: "Raw image bytes (Content-Type per stored format)",
            type: "string",
            format: "binary",
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
      const clipId = request.params.id;
      // Same gate as DELETE/retry: bad id (path separator, dot-dot, …) → 404,
      // never an attempt to read off-vault. We deliberately do NOT 400 here so
      // clients can branch on a single not-found code regardless of why the
      // bytes weren't served.
      if (!isSafeClipId(clipId)) {
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }

      const screenshot = await loadScreenshot(clipId);
      if (!screenshot) {
        // Covers both: (a) clip .md exists but assets/<id>.<ext> doesn't
        // (historical screenshotSaved=false), and (b) clip id itself is
        // unknown. Spec calls for a single 404 in either case so unauth'd
        // probes can't distinguish.
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }

      // Belt-and-braces: even though isSafeClipId already excludes path
      // separators, re-resolve and assert the file lands under assetsDir.
      // Cheap, and keeps this route honest if the regex ever loosens.
      const assetsRoot = pathResolve(
        config.vault.basePath,
        config.vault.assetsDir,
      );
      const expectedPath = pathResolve(
        assetsRoot,
        `${clipId}.${screenshot.ext}`,
      );
      if (
        expectedPath !== assetsRoot &&
        !expectedPath.startsWith(`${assetsRoot}/`)
      ) {
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }

      const mime = SCREENSHOT_EXT_TO_MIME[screenshot.ext] ?? "image/png";
      reply
        .header("Content-Length", screenshot.buffer.byteLength)
        // 1h cache: retry overwrites the same path, so spec's `immutable`
        // would be wrong. Short cache is enough for the common "open detail
        // page once" flow; clients that cache locally are unaffected.
        .header("Cache-Control", "private, max-age=3600")
        .type(mime);
      return reply.send(screenshot.buffer);
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

  app.post<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/clip/:id/retry",
    {
      schema: {
        tags: [
          "clips",
        ],
        summary: "Retry fetch + process for an existing clip",
        description:
          "Re-runs the pipeline (fetch + process + write) against the screenshot already stored in the vault. Reuses the cached VLM sidecar when available; otherwise re-runs VLM. Skips dedup. Refreshes `createdAt` to now. Returns a `jobId` immediately; track via `GET /api/v1/jobs/:id`.",
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
          202: {
            type: "object",
            required: [
              "jobId",
            ],
            properties: {
              jobId: {
                type: "string",
              },
            },
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
      const clipId = request.params.id;
      if (!isSafeClipId(clipId) || !(await clipExists(clipId))) {
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }

      // Preflight the source screenshot synchronously so the client gets a
      // proper 4xx if the vault is corrupted, instead of a 202 that resolves
      // to a job error. Also caches the buffer for the failure-fallback path
      // below.
      const screenshot = await loadScreenshot(clipId);
      if (!screenshot) {
        throw new NotFoundError("clip_not_found", ERR_CLIP_NOT_FOUND);
      }

      // Reuse clipId as jobId — same convention as the upload routes. Calling
      // createJob with an existing id resets the in-memory job state so SSE
      // listeners see fresh "running" frames.
      const jobId = clipId;
      createJob(jobId, clipId);

      withTimeout(
        handleRetry(jobId, clipId, screenshot),
        config.processing.overallTimeout,
      ).catch(async (error) => {
        log.error(
          {
            clipId,
            error: error instanceof Error ? error.message : String(error),
          },
          "retry pipeline failed",
        );
        const result = await handleRetryFailure(clipId, screenshot.buffer);
        jobError(jobId, result);
      });

      return reply.status(202).send({
        jobId,
      });
    },
  );
}
