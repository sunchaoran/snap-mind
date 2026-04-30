import type { FastifyInstance } from "fastify";
import { ERR_BATCH_NOT_FOUND, NotFoundError } from "@/server/errors.js";
import { getBatchJob, subscribeBatch } from "@/server/job-store.js";
import { sendEvent, writeSseHead } from "@/server/sse-utils.js";

export async function registerBatchRoutes(app: FastifyInstance) {
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/batch/:id",
    {
      logLevel: "warn",
      schema: {
        tags: [
          "batch",
        ],
        summary: "Batch snapshot (polling endpoint)",
        description:
          "Returns the current `BatchWire` snapshot — aggregated from all child jobs.",
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
            $ref: "BatchWire#",
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
      const batch = getBatchJob(request.params.id);
      if (!batch) {
        throw new NotFoundError("batch_not_found", ERR_BATCH_NOT_FOUND);
      }
      return batch;
    },
  );

  // SSE: GET /api/v1/batch/:id/events — 推 batch 整体进度（每完成一个子 job
  // 一次 progress 帧；terminal 时一次性结算 done/error 然后 close）。
  // 帧格式参考 docs/architecture/api-design.md §7。
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/batch/:id/events",
    {
      logLevel: "warn",
      schema: {
        tags: [
          "batch",
        ],
        summary: "Batch progress SSE stream",
        description:
          "text/event-stream — emits a `progress` frame after each child job, then a terminal `done` or `error` frame. See docs/architecture/api-design.md §7 for the per-event payload (intentionally not enumerated — OpenAPI is poor at describing event-stream framing).",
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
            type: "string",
            description: "text/event-stream (SSE) — see description above",
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
      const batchId = request.params.id;
      const batch = getBatchJob(batchId);
      if (!batch) {
        throw new NotFoundError("batch_not_found", ERR_BATCH_NOT_FOUND);
      }

      writeSseHead(reply.raw);

      // Batch 已经 terminal — 直接发一帧最终 snapshot 然后 close。
      if (batch.status === "done") {
        sendEvent(reply.raw, "done", batch);
        reply.raw.end();
        return reply.hijack();
      }
      if (batch.status === "error") {
        sendEvent(reply.raw, "error", batch);
        reply.raw.end();
        return reply.hijack();
      }

      // Batch 还在跑 — 订阅事件流。
      const unsubscribe = subscribeBatch(batchId, (evt) => {
        if (evt.type === "progress") {
          sendEvent(reply.raw, "progress", evt.batch);
          return;
        }
        if (evt.type === "done") {
          sendEvent(reply.raw, "done", evt.batch);
          reply.raw.end();
          unsubscribe();
          return;
        }
        if (evt.type === "error") {
          sendEvent(reply.raw, "error", evt.batch);
          reply.raw.end();
          unsubscribe();
        }
      });

      // Client 主动断开 — 必须解订阅，否则 EventEmitter 上的 listener 会泄漏。
      request.raw.on("close", () => {
        unsubscribe();
      });

      // hijack 告诉 Fastify "我接管 socket 了"，不要 serialize handler 返回值。
      // 参考 https://www.fastify.io/docs/latest/Reference/Reply/#hijack
      return reply.hijack();
    },
  );
}
