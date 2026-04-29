import { config } from "@/config.js";
import { fetchContent } from "@/fetcher/index.js";
import { handleFailure } from "@/pipeline/failure.js";
import { timed, withTimeout } from "@/pipeline/timing.js";
import { processContent } from "@/processor/index.js";
import {
  batchItemDone,
  getJob,
  jobDone,
  jobError,
  stepDone,
  stepSkipped,
  stepStart,
} from "@/server/job-store.js";
import { saveScreenshot, saveSidecarJson } from "@/store/screenshot.js";
import type { ClipRecord } from "@/types/domain.js";
import type { ClipResponse } from "@/types/wire.js";
import { preprocessImage } from "@/utils/image.js";
import { createLogger } from "@/utils/logger.js";
import { analyzeScreenshot } from "@/vlm/analyzer.js";
import { findSimilarClip, writeClip } from "@/writer/markdown.js";

export const log = createLogger("pipeline");

export function runBatch(batchId: string, jobIds: string[], buffers: Buffer[]) {
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

export async function handleClip(
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
