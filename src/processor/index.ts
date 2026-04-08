import { config } from "@/config.js";
import { PROCESSOR_SYSTEM_PROMPT as SYSTEM_PROMPT } from "@/prompts/index.js";
import type {
  FetchResult,
  MergedVLMResult,
  ProcessedContent,
} from "@/types/index.js";
import { parseLLMJson } from "@/utils/json.js";
import { createLogger } from "@/utils/logger.js";
import { llmClient } from "@/vlm/openrouter.js";

const log = createLogger("processor");

export async function processContent(
  vlm: MergedVLMResult,
  fetchResult: FetchResult,
): Promise<ProcessedContent> {
  const content =
    fetchResult.contentFull ?? vlm.contentSnippet ?? vlm.title ?? "";

  const contentSource = fetchResult.contentFull
    ? "fetchedContent"
    : vlm.contentSnippet
      ? "vlmSnippet"
      : "vlmTitle";

  log.info(
    {
      contentSource,
      contentLength: content.length,
      fetchLevel: fetchResult.fetchLevel,
      model: config.llm.models.processor,
    },
    "▶ processContent start",
  );

  const userMessage = `标题: ${vlm.title ?? "未知"}
来源: ${vlm.platform}
内容:
${content.slice(0, 32_000)}`;

  const response = await llmClient.chat.completions.create({
    model: config.llm.models.processor,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
    temperature: 0,
  });

  const text = response.choices[0]?.message?.content ?? "";
  const parsed = parseLLMJson<ProcessedContent>(text);

  if (fetchResult.fetchLevel === 4) {
    parsed.summary = `（基于截图识别，未获取到原文）${parsed.summary}`;
  }

  log.info(
    {
      category: parsed.category,
      language: parsed.language,
      tags: parsed.tags,
      summaryLength: parsed.summary.length,
    },
    "✓ processContent complete",
  );

  return parsed;
}
