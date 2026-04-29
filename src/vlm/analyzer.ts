import { config } from "@/config.js";
import type { MergedVLMResult, Platform, VLMResult } from "@/types/domain.js";
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
  const analysisStart = Date.now();

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
  const identifyStart = Date.now();
  const identifyResult = await callVLMRaw<IdentifyResult>(
    models[0],
    dataUrl,
    VLM_IDENTIFY_PROMPT,
  );
  const identifyElapsed = Date.now() - identifyStart;
  const platform = identifyResult.platform ?? "unknown";
  log.info(
    {
      model: models[0],
      platform,
      confidence: identifyResult.confidence,
      elapsed: `${identifyElapsed}ms`,
    },
    "  platform identified",
  );

  // Step 2: Extract with platform-specific prompt
  const extractPrompt = buildExtractPrompt(platform);
  const results: Record<string, VLMResult> = {};
  const errors: string[] = [];
  const primaryModel = models[0];
  const primaryExtractStart = Date.now();
  let primaryResult: VLMResult | null = null;
  let primaryError: string | null = null;

  try {
    primaryResult = await callVLMRaw<VLMResult>(
      primaryModel,
      dataUrl,
      extractPrompt,
    );
    results[primaryModel] = primaryResult;
    log.info(
      {
        model: primaryModel,
        platform: primaryResult.platform,
        confidence: primaryResult.confidence,
        author: primaryResult.author,
        elapsed: `${Date.now() - primaryExtractStart}ms`,
      },
      "  ✓ primary VLM model returned",
    );
  } catch (error) {
    primaryError = errMsg(error);
    errors.push(`${primaryModel}: ${primaryError}`);
    log.warn(
      {
        model: primaryModel,
        error: primaryError,
        elapsed: `${Date.now() - primaryExtractStart}ms`,
      },
      "  ✗ primary VLM model failed",
    );
  }

  const escalation = decideEscalation(
    identifyResult,
    primaryResult,
    primaryError,
    models.length,
  );

  if (escalation.shouldEscalate) {
    log.info(
      {
        primaryModel,
        reasons: escalation.reasons,
        configuredModels: models.length,
      },
      "  escalating to multi-model VLM voting",
    );
  } else {
    log.info(
      {
        primaryModel,
        confidence: primaryResult?.confidence,
        reasons: escalation.reasons,
      },
      "  primary VLM result accepted without escalation",
    );
  }

  const additionalModels = escalation.shouldEscalate ? models.slice(1) : [];
  const escalationStart = Date.now();
  const settled = await Promise.allSettled(
    additionalModels.map((model) => {
      log.debug(
        {
          model,
        },
        "  calling additional VLM model",
      );
      return callVLMRaw<VLMResult>(model, dataUrl, extractPrompt);
    }),
  );

  for (let i = 0; i < additionalModels.length; i++) {
    const model = additionalModels[i];
    const result = settled[i];
    if (result.status === "fulfilled") {
      results[model] = result.value;
      log.info(
        {
          model,
          platform: result.value.platform,
          confidence: result.value.confidence,
          author: result.value.author,
        },
        "  ✓ VLM model returned",
      );
    } else {
      const reason = errMsg(result.reason);
      errors.push(`${model}: ${reason}`);
      log.warn(
        {
          model,
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
  const elapsed = Date.now() - analysisStart;

  log.info(
    {
      elapsed: `${elapsed}ms`,
      identifyElapsed: `${identifyElapsed}ms`,
      primaryExtractElapsed: `${Date.now() - primaryExtractStart}ms`,
      escalationElapsed: `${additionalModels.length > 0 ? Date.now() - escalationStart : 0}ms`,
      escalated: escalation.shouldEscalate,
      escalationReasons: escalation.reasons,
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

function decideEscalation(
  identify: IdentifyResult,
  primary: VLMResult | null,
  primaryError: string | null,
  configuredModelCount: number,
): {
  shouldEscalate: boolean;
  reasons: string[];
} {
  if (configuredModelCount <= 1) {
    return {
      shouldEscalate: false,
      reasons: [],
    };
  }

  const threshold = config.processing.vlmEscalationThreshold;
  const reasons: string[] = [];

  if (primaryError) {
    reasons.push("primary_failed");
  }
  if (identify.platform === "unknown") {
    reasons.push("identify_unknown");
  }
  if (identify.confidence < threshold) {
    reasons.push("identify_low_confidence");
  }
  if (!primary) {
    reasons.push("primary_missing");
  } else {
    if (primary.confidence < threshold) {
      reasons.push("extract_low_confidence");
    }
    if (!primary.title) {
      reasons.push("missing_title");
    }
    if (!primary.author && !primary.visibleUrl && !primary.contentSnippet) {
      reasons.push("missing_reference_fields");
    }
    if (
      primary.platform &&
      identify.platform &&
      primary.platform !== identify.platform
    ) {
      reasons.push("platform_mismatch");
    }
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
  };
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
