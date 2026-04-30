import type { FastifyInstance } from "fastify";
import {
  BadRequestError,
  ERR_MISSING_IMAGE,
  ERR_MISSING_SESSION_ID,
  ERR_STICKY_SESSION_NOT_FOUND,
  NotFoundError,
} from "@/server/errors.js";
import { getBatchJob } from "@/server/job-store.js";
import {
  getStickySnapshot,
  markStickyDone,
  pushToSticky,
} from "@/server/sticky-store.js";

export async function registerClipStickyRoutes(app: FastifyInstance) {
  // Sticky session ingestion (debounced batch upload).
  app.post<{
    Querystring: {
      sessionId?: string;
    };
  }>(
    "/api/v1/clip/sticky",
    {
      schema: {
        tags: [
          "sticky",
        ],
        summary: "Push one image to a sticky session",
        description:
          "multipart/form-data with one `image` file field; `sessionId` in querystring. The session debounces multiple uploads into a single batch. Body schema intentionally omitted — see POST /api/v1/clip.",
        consumes: [
          "multipart/form-data",
        ],
        querystring: {
          type: "object",
          required: [
            "sessionId",
          ],
          properties: {
            sessionId: {
              type: "string",
              minLength: 1,
            },
          },
        },
        response: {
          202: {
            $ref: "StickyWire#",
          },
          400: {
            $ref: "ErrorEnvelope#",
          },
          401: {
            $ref: "ErrorEnvelope#",
          },
          409: {
            $ref: "ErrorEnvelope#",
          },
        },
      },
    },
    async (request, reply) => {
      const sessionId = request.query.sessionId?.trim();
      if (!sessionId) {
        throw new BadRequestError("missing_session_id", ERR_MISSING_SESSION_ID);
      }

      const data = await request.file();
      if (!data) {
        throw new BadRequestError("missing_image", ERR_MISSING_IMAGE);
      }

      const buffer = await data.toBuffer();

      // pushToSticky throws StickyError (extends ApiError) on wrong_state /
      // batch_full — let it bubble to the global error handler instead of
      // catching here. Keeps the route handler focused on the happy path.
      const snapshot = pushToSticky(sessionId, buffer);
      return reply.status(202).send(snapshot);
    },
  );

  app.get<{
    Params: {
      sessionId: string;
    };
  }>(
    "/api/v1/clip/sticky/:sessionId",
    {
      logLevel: "warn",
      schema: {
        tags: [
          "sticky",
        ],
        summary: "Snapshot of a sticky session",
        description:
          "Three phases: `buffering` (collecting images), `processing` (committed to a batch), `done` (batch finished). `batchId` populated only after leaving buffering.",
        params: {
          type: "object",
          required: [
            "sessionId",
          ],
          properties: {
            sessionId: {
              type: "string",
            },
          },
        },
        response: {
          200: {
            $ref: "StickyWire#",
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
      const snapshot = getStickySnapshot(request.params.sessionId);
      if (!snapshot) {
        throw new NotFoundError(
          "sticky_session_not_found",
          ERR_STICKY_SESSION_NOT_FOUND,
        );
      }

      // While buffering — no batch yet, just expose queue depth.
      if (snapshot.status === "buffering" || !snapshot.batchId) {
        return {
          sessionId: snapshot.sessionId,
          status: snapshot.status,
          queueDepth: snapshot.queueDepth,
          total: snapshot.queueDepth,
          completed: 0,
          succeeded: 0,
          failed: 0,
          results: [],
        };
      }

      // Processing or done — fold in the underlying batch state.
      const batch = getBatchJob(snapshot.batchId);
      if (!batch) {
        return {
          sessionId: snapshot.sessionId,
          status: snapshot.status,
          queueDepth: snapshot.queueDepth,
          batchId: snapshot.batchId,
          total: snapshot.queueDepth,
          completed: 0,
          succeeded: 0,
          failed: 0,
          results: [],
        };
      }

      const allDone = batch.completed >= batch.total;
      if (allDone) {
        markStickyDone(snapshot.sessionId);
      }

      return {
        sessionId: snapshot.sessionId,
        status: allDone ? "done" : "processing",
        queueDepth: snapshot.queueDepth,
        batchId: snapshot.batchId,
        total: batch.total,
        completed: batch.completed,
        succeeded: batch.succeeded,
        failed: batch.failed,
        results: batch.results,
      };
    },
  );
}
