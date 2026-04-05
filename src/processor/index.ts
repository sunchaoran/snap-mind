import { config } from "../config.js";
import { openrouter } from "../vlm/openrouter.js";
import type {
  MergedVLMResult,
  FetchResult,
  ProcessedContent,
} from "../types/index.js";

const SYSTEM_PROMPT = `你是一个内容整理助手。对给定的文章内容进行结构化处理。

请返回以下 JSON 格式：

{
  "summary": "3-5 句话的核心摘要，概括文章最重要的信息和观点",
  "tags": ["3-5个具体标签，偏具体而非抽象，如 'rust' 而非 'programming'"],
  "category": "从以下枚举中选一个最匹配的: tech | design | product | business | finance | science | life | culture | career | other",
  "language": "内容的主要语言，如 zh、en、ja"
}

仅返回 JSON，不要有任何其他文字。`;

export async function processContent(
  vlm: MergedVLMResult,
  fetchResult: FetchResult,
): Promise<ProcessedContent> {
  const content =
    fetchResult.contentFull ?? vlm.contentSnippet ?? vlm.title ?? "";

  const userMessage = `标题: ${vlm.title ?? "未知"}
来源: ${vlm.platform}
内容:
${content.slice(0, 32_000)}`;

  const response = await openrouter.chat.completions.create({
    model: config.openrouter.models.processor,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0,
  });

  const text = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(text) as ProcessedContent;

  // Prefix summary when no original content was fetched
  if (fetchResult.fetchLevel === 4) {
    parsed.summary = `（基于截图识别，未获取到原文）${parsed.summary}`;
  }

  return parsed;
}
