import { config } from "@/config.js";
import type { MergedVLMResult, Platform, VLMResult } from "@/types/index.js";
import { parseLLMJson } from "@/utils/json.js";
import { createLogger, errMsg } from "@/utils/logger.js";
import { mergeVLMResults } from "@/vlm/merger.js";
import { openrouter } from "@/vlm/openrouter.js";
import { buildExtractPrompt, VLM_IDENTIFY_PROMPT } from "@/vlm/prompt.js";

const log = createLogger("vlm");

interface IdentifyResult {
  platform: Platform;
  confidence: number;
}

export async function analyzeScreenshot(
  imageBuffer: Buffer,
): Promise<MergedVLMResult> {
  const models = config.openrouter.models.vlm;

  if (models.length % 2 === 0) {
    throw new Error(
      `VLM model count must be odd for voting, got ${models.length}`,
    );
  }

  log.info(
    {
      models,
      imageSize: `${(imageBuffer.length / 1024).toFixed(0)}KB`,
    },
    "▶ analyzeScreenshot start",
  );

  const base64Image = imageBuffer.toString("base64");
  const mime = detectImageMime(imageBuffer);
  const dataUrl = `data:${mime};base64,${base64Image}`;

  // Step 1: Identify platform
  const identifyResult = await callVLMRaw<IdentifyResult>(
    models[0],
    dataUrl,
    VLM_IDENTIFY_PROMPT,
  );
  const platform = identifyResult.platform ?? "unknown";
  log.info(
    {
      platform,
      confidence: identifyResult.confidence,
    },
    "  platform identified",
  );

  // Step 2: Extract with platform-specific prompt
  const extractPrompt = buildExtractPrompt(platform);

  const startTime = Date.now();
  const settled = await Promise.allSettled(
    models.map((model) => {
      log.debug(
        {
          model,
        },
        "  calling VLM model",
      );
      return callVLMRaw<VLMResult>(model, dataUrl, extractPrompt);
    }),
  );

  const results: Record<string, VLMResult> = {};
  const errors: string[] = [];
  for (let i = 0; i < models.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      results[models[i]] = result.value;
      log.info(
        {
          model: models[i],
          platform: result.value.platform,
          confidence: result.value.confidence,
          author: result.value.author,
        },
        "  ✓ VLM model returned",
      );
    } else {
      const reason = errMsg(result.reason);
      errors.push(`${models[i]}: ${reason}`);
      log.warn(
        {
          model: models[i],
          error: reason,
        },
        "  ✗ VLM model failed",
      );
    }
  }

  if (Object.keys(results).length === 0) {
    throw new Error(`All VLM models failed:\n${errors.join("\n")}`);
  }

  const merged = mergeVLMResults(results);
  const elapsed = Date.now() - startTime;

  log.info(
    {
      elapsed: `${elapsed}ms`,
      platform: merged.platform,
      confidence: merged.confidence,
      author: merged.author,
      title: merged.title?.slice(0, 60),
      contentType: merged.contentType,
      hasVisibleUrl: !!merged.visibleUrl,
      keywordCount: merged.keywords.length,
      snippetLength: merged.contentSnippet?.length ?? 0,
      modelsUsed: Object.keys(results).length,
      modelsFailed: errors.length,
    },
    "✓ analyzeScreenshot complete",
  );

  return merged;
}

async function callVLMRaw<T>(
  model: string,
  dataUrl: string,
  systemPrompt: string,
): Promise<T> {
  const response = await openrouter.chat.completions.create(
    {
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: dataUrl,
              },
            },
            {
              type: "text",
              text: "请分析这张截图。",
            },
          ],
        },
      ],
      temperature: 0,
    },
    {
      timeout: config.processing.vlmTimeout,
    },
  );

  const text = response.choices[0]?.message?.content ?? "";
  return parseLLMJson<T>(text);
}

function detectImageMime(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return "image/jpeg";
  }
  if (buf[0] === 0x52 && buf[1] === 0x49) {
    return "image/webp";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49) {
    return "image/gif";
  }
  return "image/png";
}
