import { fetchContent } from "@/fetcher/index.js";
import { handleFailure } from "@/pipeline/failure.js";
import { timed } from "@/pipeline/timing.js";
import { processContent } from "@/processor/index.js";
import {
  jobDone,
  stepDone,
  stepSkipped,
  stepStart,
} from "@/server/job-store.js";
import { loadSidecarVlm, saveSidecarJson } from "@/store/screenshot.js";
import type { ClipRecord, VLMAnalysis } from "@/types/domain.js";
import type { ClipResponse } from "@/types/wire.js";
import { createLogger } from "@/utils/logger.js";
import { analyzeScreenshot } from "@/vlm/analyzer.js";
import { removeClipMarkdownFile, writeClip } from "@/writer/markdown.js";

const log = createLogger("pipeline-retry");

export interface RetrySource {
  buffer: Buffer;
  ext: string;
}

/**
 * 对已存在的 clip 重新跑 fetch + process，覆盖 markdown。
 *
 * 数据来源：
 * - 截图：调用方负责从 `assets/<id>.<ext>` 加载好后传进来（失败时由
 *   handleFailure 写入，所以源图理论上一直都在）
 * - VLM 结果：`assets/<id>.json` sidecar（可选 — 完全失败的 clip 没有，
 *   会重跑 VLM）
 *
 * 与 handleClip 的差异：
 * - 跳过 dedup（不然会和自己相似度匹配）
 * - 跳过保存截图（沿用 vault 里现有的）
 * - createdAt 重置为当前时间（约定语义：retry = 重新采集）
 * - 旧 markdown 在写入新版前 unlink，避免 writeClip 因新文件名规则产生 orphan
 */
export async function handleRetry(
  jobId: string,
  clipId: string,
  screenshot: RetrySource,
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
    "▶ Retry pipeline start",
  );

  const cachedVlm = await loadSidecarVlm(clipId);

  // 1. VLM (skipped if sidecar present)
  let vlmResult: VLMAnalysis;
  if (cachedVlm) {
    stepSkipped(jobId, 0, "复用 VLM sidecar");
    vlmResult = cachedVlm;
    log.info(
      {
        clipId,
      },
      "── Step 1/7: VLM — reused sidecar ──",
    );
  } else {
    stepStart(jobId, 0, "重新分析截图…");
    log.info(
      {
        clipId,
      },
      "── Step 1/7: VLM Screenshot Analysis ──",
    );
    vlmResult = await timed("vlmMs", timings, () =>
      analyzeScreenshot(screenshot.buffer),
    );
    stepDone(
      jobId,
      0,
      `识别为 ${vlmResult.platform}，置信度 ${vlmResult.confidence}`,
    );
  }

  // 2. Dedup — always skipped on retry: clip is already in vault and would
  // self-match.
  stepSkipped(jobId, 1, "重试不去重");

  // 3. Fetch
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

  // 4. Process
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

  // 5. Screenshot already in vault — skip save.
  stepSkipped(jobId, 4, "沿用 vault 中的截图");

  // 6. Assemble (preserve clipId + screenshotPath, refresh createdAt)
  stepStart(jobId, 5, "组装记录…");
  const record: ClipRecord = {
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
    screenshotPath: `assets/${clipId}.${screenshot.ext}`,
    fetchLevel: fetchResult.fetchLevel,
    sourceConfidence: vlmResult.confidence,
    createdAt: new Date().toISOString(),
    rawVlmResult: vlmResult,
  };
  stepDone(jobId, 5);

  // 7. Write — unlink old md first so writeClip's date+slug-derived filename
  // doesn't leave the previous file as an orphan.
  stepStart(jobId, 6, "写入 Obsidian…");
  await removeClipMarkdownFile(clipId);
  const vaultPath = await timed("writeClipMs", timings, () =>
    writeClip(record),
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
      title: record.title,
      tags: tagStr,
      timings,
    },
    "✓ Retry pipeline complete",
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
    message: `重试成功: ${record.title} [${record.platform}] ${tagStr}`,
  };
  jobDone(jobId, result);
}

/**
 * Retry 二次失败时的清理：先把旧 markdown 删掉，再走标准 handleFailure
 * 写"处理失败"占位。这样不会同时留下旧 md + 新占位 md 两个 orphan。
 */
export async function handleRetryFailure(
  clipId: string,
  imageBuffer: Buffer,
): Promise<ClipResponse> {
  await removeClipMarkdownFile(clipId).catch(() => {
    // Best effort — handleFailure can still run.
  });
  return handleFailure(clipId, imageBuffer);
}
