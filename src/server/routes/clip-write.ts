import type { FastifyInstance } from "fastify";
import { config } from "@/config.js";
import { handleFailure } from "@/pipeline/failure.js";
import { handleClip, log, runBatch } from "@/pipeline/index.js";
import { withTimeout } from "@/pipeline/timing.js";
import {
  BadRequestError,
  ERR_MISSING_IMAGE,
  ERR_NO_IMAGES,
  errTooManyImages,
} from "@/server/errors.js";
import { createBatchJob, createJob, jobError } from "@/server/job-store.js";
import { generateClipId } from "@/utils/id.js";

export async function registerClipWriteRoutes(app: FastifyInstance) {
  app.post("/api/v1/clip", async (request, reply) => {
    const data = await request.file();
    if (!data) {
      throw new BadRequestError("missing_image", ERR_MISSING_IMAGE);
    }

    const imageBuffer = await data.toBuffer();
    const clipId = generateClipId();
    const jobId = clipId; // reuse clipId as jobId for simplicity

    createJob(jobId, clipId);

    // Fire and forget — pipeline runs in background
    withTimeout(
      handleClip(jobId, clipId, imageBuffer),
      config.processing.overallTimeout,
    ).catch(async (error) => {
      log.error(
        {
          clipId,
          error: error instanceof Error ? error.message : String(error),
        },
        "pipeline failed",
      );
      const result = await handleFailure(clipId, imageBuffer);
      jobError(jobId, result);
    });

    return reply.status(202).send({
      jobId,
    });
  });

  app.post("/api/v1/clip/batch", async (request, reply) => {
    const parts = request.files();
    const buffers: Buffer[] = [];
    for await (const part of parts) {
      buffers.push(await part.toBuffer());
      if (buffers.length > config.processing.maxBatchSize) {
        throw new BadRequestError(
          "too_many_images",
          errTooManyImages(config.processing.maxBatchSize),
        );
      }
    }

    if (buffers.length === 0) {
      throw new BadRequestError("no_images", ERR_NO_IMAGES);
    }

    const batchId = `batch_${generateClipId()}`;
    const jobIds: string[] = [];

    for (const _ of buffers) {
      const clipId = generateClipId();
      const jobId = clipId;
      createJob(jobId, clipId);
      jobIds.push(jobId);
    }

    createBatchJob(batchId, jobIds);

    // Run pipelines concurrently with concurrency limit
    runBatch(batchId, jobIds, buffers);

    return reply.status(202).send({
      batchId,
      jobIds,
      total: buffers.length,
    });
  });
}
