import sharp from "sharp";
import { config } from "@/config.js";
import type { Platform, VLMAnalysis, VLMResult } from "@/types/domain.js";
import { parseLLMJson } from "@/utils/json.js";
import { createLogger } from "@/utils/logger.js";
import { activeModels, llmClient } from "@/vlm/llm-client.js";
import { buildExtractPrompt, VLM_IDENTIFY_PROMPT } from "@/vlm/prompt.js";

const log = createLogger("vlm");

interface IdentifyResult {
  platform: Platform;
  confidence: number;
}

export async function analyzeScreenshot(
  imageBuffer: Buffer,
): Promise<VLMAnalysis> {
  const model = activeModels.vlm;
  const analysisStart = Date.now();

  log.info(
    {
      model,
      imageSize: `${(imageBuffer.length / 1024).toFixed(0)}KB`,
    },
    "▶ analyzeScreenshot start",
  );

  // Transcode to JPEG before sending. Vault keeps the WebP that pipeline's
  // preprocessImage produced; LM Studio's vision pipeline rejects WebP with
  // `400 'url' field must be a base64 encoded image.`, so we re-encode just
  // for the model call. JPEG works across both OpenRouter and local servers.
  const jpegBuffer = await sharp(imageBuffer)
    .jpeg({
      quality: 85,
    })
    .toBuffer();
  const base64Image = jpegBuffer.toString("base64");
  const dataUrl = `data:image/jpeg;base64,${base64Image}`;

  // Step 1: Identify platform
  const identifyStart = Date.now();
  const identifyResult = await callVLMRaw<IdentifyResult>(
    model,
    dataUrl,
    VLM_IDENTIFY_PROMPT,
  );
  const identifyElapsed = Date.now() - identifyStart;
  const platform = identifyResult.platform ?? "unknown";
  log.info(
    {
      model,
      platform,
      confidence: identifyResult.confidence,
      elapsed: `${identifyElapsed}ms`,
    },
    "  platform identified",
  );

  // Step 2: Extract with platform-specific prompt
  const extractStart = Date.now();
  const extractPrompt = buildExtractPrompt(platform);
  const raw = await callVLMRaw<VLMResult>(model, dataUrl, extractPrompt);
  const extractElapsed = Date.now() - extractStart;

  const analysis: VLMAnalysis = {
    platform: raw.platform ?? "unknown",
    contentType: raw.contentType ?? "post",
    author: raw.author,
    title: raw.title,
    keywords: raw.keywords,
    publishTime: raw.publishTime,
    visibleUrl: raw.visibleUrl,
    contentSnippet: raw.contentSnippet,
    confidence: raw.confidence,
    rawResult: raw,
  };

  log.info(
    {
      elapsed: `${Date.now() - analysisStart}ms`,
      identifyElapsed: `${identifyElapsed}ms`,
      extractElapsed: `${extractElapsed}ms`,
      platform: analysis.platform,
      confidence: analysis.confidence,
      author: analysis.author,
      title: analysis.title?.slice(0, 60),
      contentType: analysis.contentType,
      hasVisibleUrl: !!analysis.visibleUrl,
      keywordCount: analysis.keywords.length,
      snippetLength: analysis.contentSnippet?.length ?? 0,
    },
    "✓ analyzeScreenshot complete",
  );

  return analysis;
}

async function callVLMRaw<T>(
  model: string,
  dataUrl: string,
  systemPrompt: string,
): Promise<T> {
  const response = await llmClient.chat.completions.create(
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
