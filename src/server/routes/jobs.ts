import type { FastifyInstance } from "fastify";
import { ERR_JOB_NOT_FOUND, NotFoundError } from "@/server/errors.js";
import { getJob } from "@/server/job-store.js";

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
}
