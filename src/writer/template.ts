import type { ClipRecord } from "../types/index.js";

export function renderClipMarkdown(record: ClipRecord): string {
  const frontmatter = [
    "---",
    `id: ${record.id}`,
    `title: "${record.title}"`,
    `platform: ${record.platform}`,
    `author: "${record.author}"`,
    `originalUrl: ${record.originalUrl ? `"${record.originalUrl}"` : "null"}`,
    `contentType: ${record.contentType}`,
    "tags:",
    ...record.tags.map((t) => `  - ${t}`),
    `category: ${record.category}`,
    `language: ${record.language}`,
    `fetchLevel: ${record.fetchLevel}`,
    `sourceConfidence: ${record.sourceConfidence}`,
    `createdAt: ${record.createdAt}`,
    "---",
  ].join("\n");

  const summary = `## 摘要\n\n${record.contentSummary}`;

  let body: string;
  if (record.fetchLevel === 4) {
    body = `## 原文\n\n> ⚠️ 未能获取原文。以下为截图中识别到的内容片段：\n\n${record.rawVlmResult.contentSnippet ?? ""}`;
  } else {
    body = `## 原文\n\n${record.contentFull ?? ""}`;
  }

  const screenshot = `## 截图\n\n![[assets/${record.id}.png]]`;

  return `${frontmatter}\n\n${summary}\n\n${body}\n\n${screenshot}\n`;
}
