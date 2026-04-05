import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { fetchContent } from "../fetcher/index.js";
import { processContent } from "../processor/index.js";
import { saveScreenshot, saveSidecarJson } from "../store/screenshot.js";
import type { ClipRecord, ClipResponse } from "../types/index.js";
import { generateClipId } from "../utils/id.js";
import { createLogger } from "../utils/logger.js";
import { analyzeScreenshot } from "../vlm/analyzer.js";
import { MarkdownWriter } from "../writer/markdown.js";
import { authenticate, UnauthorizedError } from "./auth.js";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const log = createLogger("pipeline");
const writer = new MarkdownWriter();

export async function registerRoutes(app: FastifyInstance) {
  app.post("/clip", async (request, reply) => {
    try {
      await authenticate(request);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return reply.status(401).send({ success: false, error: err.message });
      }
      throw err;
    }

    const data = await request.file();
    if (!data) {
      return reply
        .status(400)
        .send({ success: false, error: "Missing image file" });
    }

    const imageBuffer = await data.toBuffer();
    const clipId = generateClipId();

    const result = await withTimeout(
      handleClip(clipId, imageBuffer),
      config.processing.overallTimeout,
    ).catch(async (error) => {
      log.error({ clipId, error: error instanceof Error ? error.message : String(error) }, "pipeline failed");
      return handleFailure(clipId, imageBuffer);
    });

    const statusCode = result.success ? 200 : 500;
    return reply.status(statusCode).send(result);
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  if (process.env.NODE_ENV !== "production") {
    app.get("/dev", async (_request, reply) => {
      const html = await readFile(join(__dirname, "dev-upload.html"), "utf-8");
      return reply.type("text/html").send(html);
    });
  }
}

async function handleClip(
  clipId: string,
  imageBuffer: Buffer,
): Promise<ClipResponse> {
  const pipelineStart = Date.now();
  log.info({ clipId }, "═══════════════════════════════════════════════");
  log.info({ clipId }, "▶ Pipeline start");

  // 1. VLM analysis
  log.info({ clipId }, "── Step 1/7: VLM Screenshot Analysis ──");
  const vlmResult = await analyzeScreenshot(imageBuffer);

  // 2. Dedup check
  log.info({ clipId }, "── Step 2/7: Dedup Check ──");
  const existingId = await writer.findSimilar(
    vlmResult.platform,
    vlmResult.author,
    vlmResult.title,
  );
  if (existingId) {
    log.info({ clipId, existingId }, "⊘ duplicate found, skipping");
    return {
      success: true,
      clipId: existingId,
      message: `已存在相似收藏 (${existingId})，跳过`,
    };
  }
  log.info("  no duplicate found");

  // 3. Fetch original content
  log.info({ clipId }, "── Step 3/7: Content Fetch (L1→L2→L3→L4) ──");
  const fetchResult = await fetchContent(vlmResult);

  // 4. Process content (summary/tags/category)
  log.info({ clipId }, "── Step 4/7: Content Processing ──");
  const processed = await processContent(vlmResult, fetchResult);

  // 5. Save screenshot to vault
  log.info({ clipId }, "── Step 5/7: Save Screenshot ──");
  const screenshotPath = await saveScreenshot(clipId, imageBuffer);
  log.info({ screenshotPath }, "  screenshot saved");

  // 6. Assemble ClipRecord
  log.info({ clipId }, "── Step 6/7: Assemble Record ──");
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

  // 7. Write to Obsidian vault
  log.info({ clipId }, "── Step 7/7: Write to Vault ──");
  const vaultPath = await writer.write(record);
  log.info({ vaultPath: `${config.vault.basePath}/${vaultPath}` }, "  vault file written");

  await saveSidecarJson(clipId, vlmResult);

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
  log.info({ clipId }, "═══════════════════════════════════════════════");

  return {
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
}

async function handleFailure(
  clipId: string,
  imageBuffer: Buffer,
): Promise<ClipResponse> {
  try {
    await saveScreenshot(clipId, imageBuffer);
  } catch {
    // Screenshot save itself failed
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
    await writer.write(failRecord);
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
