import { accessSync, constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "@/config.js";
import { fetchContent } from "@/fetcher/index.js";
import { processContent } from "@/processor/index.js";
import { authenticate } from "@/server/auth.js";
import {
  createJob,
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
import { createLogger } from "@/utils/logger.js";
import { analyzeScreenshot } from "@/vlm/analyzer.js";
import { findSimilarClip, writeClip } from "@/writer/markdown.js";

const __dirname = join(fileURLToPath(import.meta.url), "..");
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

    // Validate file type
    if (data.mimetype && !data.mimetype.startsWith("image/")) {
      return reply.status(400).send({
        success: false,
        error: `Invalid file type: ${data.mimetype}. Only images are accepted.`,
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
      const result = await handleFailure(clipId, imageBuffer, error);
      jobError(
        jobId,
        result,
        error instanceof Error ? error.message : String(error),
      );
    });

    return reply.status(202).send({
      jobId,
    });
  });

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
    let vaultWritable = false;
    try {
      accessSync(config.vault.basePath, constants.W_OK);
      vaultWritable = true;
    } catch {
      // vault not writable
    }

    return {
      status: vaultWritable ? "ok" : "degraded",
      vault: {
        path: config.vault.basePath,
        writable: vaultWritable,
      },
      cdpUrl: config.playwright.cdpUrl,
      maxFetchLevel: config.processing.maxFetchLevel,
      uptime: Math.floor(process.uptime()),
    };
  });

  if (process.env.NODE_ENV !== "production") {
    app.get("/dev", async (_request, reply) => {
      const html = await readFile(join(__dirname, "dev-upload.html"), "utf-8");
      return reply.type("text/html").send(html);
    });
  }
}

async function handleClip(
  jobId: string,
  clipId: string,
  imageBuffer: Buffer,
): Promise<void> {
  const pipelineStart = Date.now();
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

  // 1. VLM analysis
  stepStart(jobId, 0, "正在分析截图…");
  log.info(
    {
      clipId,
    },
    "── Step 1/7: VLM Screenshot Analysis ──",
  );
  const vlmResult = await analyzeScreenshot(imageBuffer);
  stepDone(
    jobId,
    0,
    `识别为 ${vlmResult.platform}，置信度 ${vlmResult.confidence}`,
  );

  // 2. Dedup check
  stepStart(jobId, 1, "检查是否已收藏…");
  log.info(
    {
      clipId,
    },
    "── Step 2/7: Dedup Check ──",
  );
  const existingId = await findSimilarClip(
    vlmResult.platform,
    vlmResult.author,
    vlmResult.title,
  );
  if (existingId) {
    log.info(
      {
        clipId,
        existingId,
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
  log.info("  no duplicate found");

  // 3. Fetch original content
  stepStart(jobId, 2, "抓取原文内容…");
  log.info(
    {
      clipId,
    },
    "── Step 3/7: Content Fetch (L1→L2→L3→L4) ──",
  );
  const fetchResult = await fetchContent(vlmResult);
  stepDone(jobId, 2, `Level ${fetchResult.fetchLevel}`);

  // 4. Process content (summary/tags/category)
  stepStart(jobId, 3, "生成摘要和标签…");
  log.info(
    {
      clipId,
    },
    "── Step 4/7: Content Processing ──",
  );
  const processed = await processContent(vlmResult, fetchResult);
  stepDone(jobId, 3, `${processed.category} / ${processed.tags.join(", ")}`);

  // 5. Save screenshot to vault
  stepStart(jobId, 4, "保存截图…");
  log.info(
    {
      clipId,
    },
    "── Step 5/7: Save Screenshot ──",
  );
  const screenshotPath = await saveScreenshot(clipId, imageBuffer);
  stepDone(jobId, 4);
  log.info(
    {
      screenshotPath,
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
    screenshotPath,
    fetchLevel: fetchResult.fetchLevel,
    sourceConfidence: vlmResult.confidence,
    createdAt: new Date().toISOString(),
    rawVlmResult: vlmResult,
  };
  stepDone(jobId, 5);

  // 7. Write to Obsidian vault
  stepStart(jobId, 6, "写入 Obsidian…");
  log.info(
    {
      clipId,
    },
    "── Step 7/7: Write to Vault ──",
  );
  const vaultPath = await writeClip(record);
  log.info(
    {
      vaultPath: `${config.vault.basePath}/${vaultPath}`,
    },
    "  vault file written",
  );

  await saveSidecarJson(clipId, vlmResult);
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
  originalError?: unknown,
): Promise<ClipResponse> {
  const errorMessage =
    originalError instanceof Error
      ? originalError.message
      : String(originalError ?? "Unknown error");

  try {
    await saveScreenshot(clipId, imageBuffer);
  } catch (screenshotErr) {
    log.error(
      {
        clipId,
        error:
          screenshotErr instanceof Error
            ? screenshotErr.message
            : String(screenshotErr),
      },
      "Failed to save screenshot during error recovery",
    );
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
      screenshotPath: `assets/${clipId}.png`,
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
  } catch (writeErr) {
    log.error(
      {
        clipId,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      },
      "Failed to write failure record during error recovery",
    );
  }

  return {
    success: false,
    clipId,
    error: errorMessage,
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
