import { config } from "@/config.js";
import type { ClipRecord } from "@/types/domain.js";
import {
  HEADING_ORIGINAL,
  HEADING_SCREENSHOT,
  HEADING_SUMMARY,
} from "@/vault.js";

/**
 * Restore paragraph structure from flattened text.
 * Many opencli outputs strip all newlines; this re-inserts them using structural cues.
 */
function formatContent(text: string): string {
  // Already has reasonable formatting (>3 newlines per 500 chars)
  if ((text.match(/\n/g)?.length ?? 0) > text.length / 500) {
    return text;
  }

  return (
    text
      // Add blank line before emoji-prefixed section headers (💡 为什么, 📊 三种, 🏆 最佳 etc.)
      .replace(
        /\s+([\u{1F300}-\u{1FAF8}\u{2600}-\u{27BF}]+\s*[^\s•·-])/gu,
        "\n\n$1",
      )
      // Add newline before bullet points (•, ·, -)
      .replace(/\s+(•|·)\s/g, "\n$1 ")
      // Strip trailing hashtag block (e.g. 👇 #AI助手 #Mac ... ##########)
      .replace(
        /\s*(?:[\u{1F300}-\u{1FAF8}\u{2600}-\u{27BF}]|\uFE0F)*\s*(#\S+\s*){3,}#{0,}$/gu,
        "",
      )
      .trim()
  );
}

export function renderClipMarkdown(record: ClipRecord): string {
  const frontmatter = [
    "---",
    `id: ${record.id}`,
    `title: ${yamlString(record.title)}`,
    `platform: ${record.platform}`,
    `author: ${yamlString(record.author)}`,
    `originalUrl: ${record.originalUrl ? yamlString(record.originalUrl) : "null"}`,
    `contentType: ${record.contentType}`,
    "tags:",
    ...record.tags.map((t) => `  - ${yamlString(t)}`),
    `category: ${record.category}`,
    `language: ${record.language}`,
    `fetchLevel: ${record.fetchLevel}`,
    `sourceConfidence: ${record.sourceConfidence}`,
    `createdAt: ${record.createdAt}`,
    "---",
  ].join("\n");

  const summary = `${HEADING_SUMMARY}\n\n${record.contentSummary}`;

  let body: string;
  if (record.fetchLevel === 4) {
    body = `${HEADING_ORIGINAL}\n\n> ⚠️ 未能获取原文。以下为截图中识别到的内容片段：\n\n${record.rawVlmResult.contentSnippet ?? ""}`;
  } else {
    body = `${HEADING_ORIGINAL}\n\n${formatContent(record.contentFull ?? "")}`;
  }

  const screenshotWidthSuffix =
    config.vault.screenshotDisplayWidth > 0
      ? `|${config.vault.screenshotDisplayWidth}`
      : "";
  const screenshot = `${HEADING_SCREENSHOT}\n\n![[${record.screenshotPath}${screenshotWidthSuffix}]]`;

  return `${frontmatter}\n\n${summary}\n\n${body}\n\n${screenshot}\n`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}
