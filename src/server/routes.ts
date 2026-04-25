import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "@/config.js";
import { fetchContent } from "@/fetcher/index.js";
import { processContent } from "@/processor/index.js";
import { authenticate } from "@/server/auth.js";
import {
  batchItemDone,
  createBatchJob,
  createJob,
  getBatchJob,
  getJob,
  jobDone,
  jobError,
  stepDone,
  stepSkipped,
  stepStart,
} from "@/server/job-store.js";
import { saveScreenshot, saveSidecarJson } from "@/store/screenshot.js";
import type { ClipRecord, ClipResponse } from "@/types/index.js";
import { generateClipId } from "@/utils/id.js";
import { preprocessImage } from "@/utils/image.js";
import { createLogger } from "@/utils/logger.js";
import { analyzeScreenshot } from "@/vlm/analyzer.js";
import {
  clearSnapMindVault,
  findSimilarClip,
  writeClip,
} from "@/writer/markdown.js";

const log = createLogger("pipeline");

export async function registerRoutes(app: FastifyInstance) {
  app.post("/clip", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth.ok) {
      return reply.status(401).send({
        success: false,
        error: auth.error.message,
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        success: false,
        error: "Missing image file",
      });
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

  app.post("/clip/batch", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth.ok) {
      return reply.status(401).send({
        success: false,
        error: auth.error.message,
      });
    }

    const parts = request.files();
    const buffers: Buffer[] = [];
    for await (const part of parts) {
      buffers.push(await part.toBuffer());
      if (buffers.length > config.processing.maxBatchSize) {
        return reply.status(400).send({
          success: false,
          error: `Too many images. Max ${config.processing.maxBatchSize} per batch`,
        });
      }
    }

    if (buffers.length === 0) {
      return reply.status(400).send({
        success: false,
        error: "No image files provided",
      });
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

  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/batch/:id",
    {
      logLevel: "warn",
    },
    async (request, reply) => {
      const batch = getBatchJob(request.params.id);
      if (!batch) {
        return reply.status(404).send({
          error: "Batch not found",
        });
      }
      return batch;
    },
  );

  app.get<{
    Params: {
      id: string;
    };
  }>(
    "/jobs/:id",
    {
      logLevel: "warn",
    },
    async (request, reply) => {
      const job = getJob(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "Job not found",
        });
      }
      return job;
    },
  );

  app.get("/health", async () => {
    return {
      status: "ok",
    };
  });

  if (process.env.NODE_ENV !== "production") {
    app.post("/dev/clear-snap-mind", async (_request, reply) => {
      try {
        const cleared = await clearSnapMindVault();
        return {
          success: true,
          ...cleared,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({
          success: false,
          error: message,
        });
      }
    });

    app.get("/dev", async (_request, reply) => {
      const html = await readFile(
        join(import.meta.dirname, "dev-upload.html"),
        "utf-8",
      );
      return reply.type("text/html").send(html);
    });
  }
}

function runBatch(batchId: string, jobIds: string[], buffers: Buffer[]) {
  const concurrency = config.processing.maxConcurrentPipelines;
  let cursor = 0;

  function next() {
    if (cursor >= buffers.length) {
      return;
    }
    const i = cursor++;
    const jobId = jobIds[i];
    const clipId = jobId; // jobId === clipId
    const imageBuffer = buffers[i];

    withTimeout(
      handleClip(jobId, clipId, imageBuffer),
      config.processing.overallTimeout,
    )
      .then(() => {
        const job = getJob(jobId);
        if (job?.result) {
          batchItemDone(batchId, job.result);
        }
      })
      .catch(async (error) => {
        log.error(
          {
            clipId,
            batchId,
            error: error instanceof Error ? error.message : String(error),
          },
          "batch pipeline failed",
        );
        const result = await handleFailure(clipId, imageBuffer);
        jobError(jobId, result);
        batchItemDone(batchId, result);
      })
      .finally(() => {
        next();
      });
  }

  // Kick off initial batch of concurrent pipelines
  for (let i = 0; i < Math.min(concurrency, buffers.length); i++) {
    next();
  }
}

async function handleClip(
  jobId: string,
  clipId: string,
  imageBuffer: Buffer,
): Promise<void> {
  const pipelineStart = Date.now();
  const timings: Record<string, number> = {};
  log.info(
    {
      clipId,
    },
    "═══════════════════════════════════════════════",
  );
  log.info(
    {
      clipId,
    },
    "▶ Pipeline start",
  );

  // 0. Preprocess image (compress & resize)
  const preprocessed = await timed("preprocessMs", timings, () =>
    preprocessImage(imageBuffer),
  );
  const processedBuffer = preprocessed.buffer;

  // 1. VLM analysis
  stepStart(jobId, 0, "正在分析截图…");
  log.info(
    {
      clipId,
    },
    "── Step 1/7: VLM Screenshot Analysis ──",
  );
  const vlmResult = await timed("vlmMs", timings, () =>
    analyzeScreenshot(processedBuffer),
  );
  stepDone(
    jobId,
    0,
    `识别为 ${vlmResult.platform}，置信度 ${vlmResult.confidence}`,
  );
  log.info(
    {
      clipId,
      elapsed: `${timings.vlmMs}ms`,
    },
    "  step timing",
  );

  // 2. Dedup check
  stepStart(jobId, 1, "检查是否已收藏…");
  log.info(
    {
      clipId,
    },
    "── Step 2/7: Dedup Check ──",
  );
  const existingId = await timed("dedupMs", timings, () =>
    findSimilarClip(vlmResult.platform, vlmResult.author, vlmResult.title),
  );
  if (existingId) {
    log.info(
      {
        clipId,
        existingId,
        elapsed: `${timings.dedupMs}ms`,
        timings,
      },
      "⊘ duplicate found, skipping",
    );
    stepSkipped(jobId, 1, `已存在 (${existingId})`);
    // Mark remaining steps as skipped
    for (let i = 2; i < 7; i++) {
      stepSkipped(jobId, i);
    }
    const result: ClipResponse = {
      success: true,
      clipId: existingId,
      message: `已存在相似收藏 (${existingId})，跳过`,
    };
    jobDone(jobId, result);
    return;
  }
  stepDone(jobId, 1, "无重复");
  log.info(
    {
      clipId,
      elapsed: `${timings.dedupMs}ms`,
    },
    "  no duplicate found",
  );

  // 3. Fetch original content
  stepStart(jobId, 2, "抓取原文内容…");
  log.info(
    {
      clipId,
    },
    "── Step 3/7: Content Fetch (L1→L2→L3→L4) ──",
  );
  const fetchResult = await timed("fetchMs", timings, () =>
    fetchContent(vlmResult),
  );
  stepDone(jobId, 2, `Level ${fetchResult.fetchLevel}`);
  log.info(
    {
      clipId,
      fetchLevel: fetchResult.fetchLevel,
      elapsed: `${timings.fetchMs}ms`,
    },
    "  step timing",
  );

  // 4. Process content (summary/tags/category)
  stepStart(jobId, 3, "生成摘要和标签…");
  log.info(
    {
      clipId,
    },
    "── Step 4/7: Content Processing ──",
  );
  const processed = await timed("processMs", timings, () =>
    processContent(vlmResult, fetchResult),
  );
  stepDone(jobId, 3, `${processed.category} / ${processed.tags.join(", ")}`);
  log.info(
    {
      clipId,
      elapsed: `${timings.processMs}ms`,
    },
    "  step timing",
  );

  // 5. Save screenshot to vault
  stepStart(jobId, 4, "保存截图…");
  log.info(
    {
      clipId,
    },
    "── Step 5/7: Save Screenshot ──",
  );
  const screenshotPath = await timed("saveScreenshotMs", timings, () =>
    saveScreenshot(clipId, processedBuffer, preprocessed.ext),
  );
  stepDone(jobId, 4);
  log.info(
    {
      screenshotPath,
      elapsed: `${timings.saveScreenshotMs}ms`,
    },
    "  screenshot saved",
  );

  // 6. Assemble ClipRecord
  stepStart(jobId, 5, "组装记录…");
  log.info(
    {
      clipId,
    },
    "── Step 6/7: Assemble Record ──",
  );
  const record: ClipRecord = await timed("assembleMs", timings, async () => ({
    id: clipId,
    title: vlmResult.title ?? "未知标题",
    platform: vlmResult.platform,
    author: vlmResult.author ?? "未知作者",
    originalUrl: fetchResult.originalUrl,
    contentType: vlmResult.contentType,
    contentFull: fetchResult.contentFull,
    contentSummary: processed.summary,
    tags: processed.tags,
    category: processed.category,
    language: processed.language,
    screenshotPath,
    fetchLevel: fetchResult.fetchLevel,
    sourceConfidence: vlmResult.confidence,
    createdAt: new Date().toISOString(),
    rawVlmResult: vlmResult,
  }));
  stepDone(jobId, 5);
  log.info(
    {
      clipId,
      elapsed: `${timings.assembleMs}ms`,
    },
    "  step timing",
  );

  // 7. Write to Obsidian vault
  stepStart(jobId, 6, "写入 Obsidian…");
  log.info(
    {
      clipId,
    },
    "── Step 7/7: Write to Vault ──",
  );
  const vaultPath = await timed("writeClipMs", timings, () =>
    writeClip(record),
  );
  log.info(
    {
      vaultPath: `${config.vault.basePath}/${vaultPath}`,
      elapsed: `${timings.writeClipMs}ms`,
    },
    "  vault file written",
  );

  await timed("saveSidecarMs", timings, () =>
    saveSidecarJson(clipId, vlmResult),
  );
  stepDone(jobId, 6, vaultPath);

  const elapsed = Date.now() - pipelineStart;
  const tagStr = processed.tags.map((t) => `#${t}`).join(" ");
  log.info(
    {
      clipId,
      elapsed: `${elapsed}ms`,
      platform: record.platform,
      fetchLevel: record.fetchLevel,
      confidence: record.sourceConfidence,
      title: record.title,
      tags: tagStr,
      originalUrl: record.originalUrl,
      timings: {
        preprocessMs: timings.preprocessMs,
        vlmMs: timings.vlmMs,
        dedupMs: timings.dedupMs,
        fetchMs: timings.fetchMs,
        processMs: timings.processMs,
        saveScreenshotMs: timings.saveScreenshotMs,
        assembleMs: timings.assembleMs,
        writeClipMs: timings.writeClipMs,
        saveSidecarMs: timings.saveSidecarMs,
      },
    },
    "✓ Pipeline complete",
  );
  log.info(
    {
      clipId,
    },
    "═══════════════════════════════════════════════",
  );

  const result: ClipResponse = {
    success: true,
    clipId,
    title: record.title,
    platform: record.platform,
    tags: processed.tags,
    category: processed.category,
    fetchLevel: fetchResult.fetchLevel,
    vaultPath,
    message: `已收藏: ${record.title} [${record.platform}] ${tagStr}`,
  };
  jobDone(jobId, result);
}

async function handleFailure(
  clipId: string,
  imageBuffer: Buffer,
): Promise<ClipResponse> {
  let savedExt = "webp";
  try {
    const pp = await preprocessImage(imageBuffer);
    await saveScreenshot(clipId, pp.buffer, pp.ext);
    savedExt = pp.ext;
  } catch {
    try {
      await saveScreenshot(clipId, imageBuffer);
      savedExt = "png";
    } catch {
      // Screenshot save itself failed
    }
  }

  try {
    const failRecord: ClipRecord = {
      id: clipId,
      title: "处理失败 - 待重试",
      platform: "unknown",
      author: "unknown",
      originalUrl: null,
      contentType: "post",
      contentFull: null,
      contentSummary: "处理过程中发生错误，请稍后重试。",
      tags: [],
      category: "other",
      language: "zh",
      screenshotPath: `assets/${clipId}.${savedExt}`,
      fetchLevel: 4,
      sourceConfidence: 0,
      createdAt: new Date().toISOString(),
      rawVlmResult: {
        platform: "unknown",
        author: null,
        title: null,
        keywords: [],
        publishTime: null,
        visibleUrl: null,
        contentSnippet: null,
        contentType: "post",
        confidence: 0,
        rawResults: {},
      },
    };
    await writeClip(failRecord);
  } catch {
    // Failure record write itself failed
  }

  return {
    success: false,
    clipId,
    error: "Pipeline processing failed",
    screenshotSaved: true,
    message: "处理失败，已保存原始截图，请稍后重试",
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Processing timed out after ${ms}ms`)),
      ms,
    );
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function timed<T>(
  key: string,
  timings: Record<string, number>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    timings[key] = Date.now() - start;
  }
}
