import type { FastifyInstance } from "fastify";
import { authenticate } from "@/server/auth.js";
import {
  ERR_MISSING_IMAGE,
  ERR_MISSING_SESSION_ID,
  ERR_STICKY_SESSION_NOT_FOUND,
} from "@/server/errors.js";
import { getBatchJob } from "@/server/job-store.js";
import {
  getStickySnapshot,
  markStickyDone,
  pushToSticky,
  StickyError,
} from "@/server/sticky-store.js";

export async function registerClipStickyRoutes(app: FastifyInstance) {
  // Sticky session ingestion (debounced batch upload).
  app.post<{
    Querystring: {
      sessionId?: string;
    };
  }>("/api/v1/clip/sticky", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth.ok) {
      return reply.status(401).send({
        success: false,
        error: auth.error.message,
      });
    }

    const sessionId = request.query.sessionId?.trim();
    if (!sessionId) {
      return reply.status(400).send({
        success: false,
        error: ERR_MISSING_SESSION_ID,
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        success: false,
        error: ERR_MISSING_IMAGE,
      });
    }

    const buffer = await data.toBuffer();

    try {
      const snapshot = pushToSticky(sessionId, buffer);
      return reply.status(202).send(snapshot);
    } catch (err) {
      if (err instanceof StickyError) {
        const status = err.code === "batch_full" ? 400 : 409;
        return reply.status(status).send({
          success: false,
          error: err.message,
          code: err.code,
        });
      }
      throw err;
    }
  });

  app.get<{
    Params: {
      sessionId: string;
    };
  }>(
    "/api/v1/clip/sticky/:sessionId",
    {
      logLevel: "warn",
    },
    async (request, reply) => {
      const snapshot = getStickySnapshot(request.params.sessionId);
      if (!snapshot) {
        return reply.status(404).send({
          error: ERR_STICKY_SESSION_NOT_FOUND,
        });
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
