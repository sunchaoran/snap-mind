import type { FastifyInstance } from "fastify";
import { ERR_JOB_NOT_FOUND, NotFoundError } from "@/server/errors.js";
import { getJob, subscribeJob } from "@/server/job-store.js";
import { sendEvent, writeSseHead } from "@/server/sse-utils.js";

export async function registerJobsRoutes(app: FastifyInstance) {
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/jobs/:id",
    {
      logLevel: "warn",
    },
    async (request) => {
      const job = getJob(request.params.id);
      if (!job) {
        throw new NotFoundError("job_not_found", ERR_JOB_NOT_FOUND);
      }
      return job;
    },
  );

  // SSE: GET /api/v1/jobs/:id/events — 推每一步进度，terminal 时 close。
  // 帧格式参考 docs/architecture/api-design.md §7。
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/jobs/:id/events",
    {
      logLevel: "warn",
    },
    async (request, reply) => {
      const jobId = request.params.id;
      const job = getJob(jobId);
      if (!job) {
        // 走统一错误信封 — error-handler plugin 会把这转成 404 JSON。
        throw new NotFoundError("job_not_found", ERR_JOB_NOT_FOUND);
      }

      writeSseHead(reply.raw);

      // Job 已经 terminal — 直接补一帧 done/error 然后关连接，不订阅。
      if (job.status === "done" && job.result) {
        sendEvent(reply.raw, "done", {
          result: job.result,
        });
        reply.raw.end();
        return reply.hijack();
      }
      if (job.status === "error" && job.result) {
        sendEvent(reply.raw, "error", {
          result: job.result,
        });
        reply.raw.end();
        return reply.hijack();
      }

      // Job 还在跑 — 订阅 in-memory 事件流。
      const unsubscribe = subscribeJob(jobId, (evt) => {
        if (evt.type === "step") {
          sendEvent(reply.raw, "step", {
            step: evt.stepIndex,
            status: evt.status,
            message: evt.message,
          });
          return;
        }
        if (evt.type === "done") {
          sendEvent(reply.raw, "done", {
            result: evt.result,
          });
          reply.raw.end();
          unsubscribe();
          return;
        }
        if (evt.type === "error") {
          sendEvent(reply.raw, "error", {
            result: evt.result,
          });
          reply.raw.end();
          unsubscribe();
        }
      });

      // Client 主动断开 — 必须解订阅，否则 EventEmitter 上的 listener 会泄漏。
      request.raw.on("close", () => {
        unsubscribe();
      });

      // hijack 告诉 Fastify "我接管 socket 了"，不要尝试序列化 return 值
      // 当 response body — 否则 SSE stream 会被破坏。
      // 参考 https://www.fastify.io/docs/latest/Reference/Reply/#hijack
      return reply.hijack();
    },
  );
}
