import type { FastifyInstance } from "fastify";
import { createBatchJob, createJob } from "@/server/job-store.js";
import { runBatch } from "@/server/pipeline.js";
import { registerBatchRoutes } from "@/server/routes/batch.js";
import { registerClipReadRoutes } from "@/server/routes/clip-read.js";
import { registerClipStickyRoutes } from "@/server/routes/clip-sticky.js";
import { registerClipWriteRoutes } from "@/server/routes/clip-write.js";
import { registerJobsRoutes } from "@/server/routes/jobs.js";
import { registerMetaRoutes } from "@/server/routes/meta.js";
import { registerCommitHandler } from "@/server/sticky-store.js";
import { generateClipId } from "@/utils/id.js";
import { createLogger } from "@/utils/logger.js";

const log = createLogger("pipeline");

export async function registerRoutes(app: FastifyInstance) {
  // Sticky → batch commit bridge (boot-time registration).
  // Lives here because it depends on runBatch (pipeline) + job-store, and
  // is shared across routes; not a per-route concern.
  registerCommitHandler((sessionId, buffers) => {
    const batchId = `batch_${generateClipId()}`;
    const jobIds: string[] = buffers.map(() => generateClipId());
    for (const jobId of jobIds) {
      createJob(jobId, jobId);
    }
    createBatchJob(batchId, jobIds);
    log.info(
      {
        sessionId,
        batchId,
        count: buffers.length,
      },
      "sticky session committed to batch",
    );
    runBatch(batchId, jobIds, buffers);
    return batchId;
  });

  await registerClipWriteRoutes(app);
  await registerClipStickyRoutes(app);
  await registerClipReadRoutes(app);
  await registerJobsRoutes(app);
  await registerBatchRoutes(app);
  await registerMetaRoutes(app);
}
