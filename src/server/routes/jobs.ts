import type { FastifyInstance } from "fastify";
import { ERR_JOB_NOT_FOUND } from "@/server/errors.js";
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
    async (request, reply) => {
      const job = getJob(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: ERR_JOB_NOT_FOUND,
        });
      }
      return job;
    },
  );
}
