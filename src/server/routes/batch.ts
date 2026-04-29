import type { FastifyInstance } from "fastify";
import { ERR_BATCH_NOT_FOUND } from "@/server/errors.js";
import { getBatchJob } from "@/server/job-store.js";

export async function registerBatchRoutes(app: FastifyInstance) {
  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/api/v1/batch/:id",
    {
      logLevel: "warn",
    },
    async (request, reply) => {
      const batch = getBatchJob(request.params.id);
      if (!batch) {
        return reply.status(404).send({
          error: ERR_BATCH_NOT_FOUND,
        });
      }
      return batch;
    },
  );
}
