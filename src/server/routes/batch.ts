import type { FastifyInstance } from "fastify";
import { ERR_BATCH_NOT_FOUND, NotFoundError } from "@/server/errors.js";
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
    async (request) => {
      const batch = getBatchJob(request.params.id);
      if (!batch) {
        throw new NotFoundError("batch_not_found", ERR_BATCH_NOT_FOUND);
      }
      return batch;
    },
  );
}
