import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import type { ClipRecord } from "../types/domain.js";
import { renderClipMarkdown } from "./template.js";

describe("renderClipMarkdown", () => {
  it("escapes quoted frontmatter strings safely", () => {
    const record: ClipRecord = {
      id: "clip_20260407_143955_-cM5NE",
      title: 'Karpathy前两天刚说"应该有人做这个"，',
      platform: "xiaohongshu",
      author: 'Karpat..."foo"',
      originalUrl: null,
      contentType: "post",
      contentFull: null,
      contentSummary: "summary",
      tags: [
        'Claude "Code"',
        "Graphify:KG",
      ],
      category: "tech",
      language: "zh",
      screenshotPath: "assets/clip_20260407_143955_-cM5NE.webp",
      fetchLevel: 4,
      sourceConfidence: 0.95,
      createdAt: "2026-04-07T06:41:56.888Z",
      rawVlmResult: {
        platform: "xiaohongshu",
        author: "Karpat...",
        title: 'Karpathy前两天刚说"应该有人做这个"，',
        keywords: [],
        publishTime: null,
        visibleUrl: null,
        contentSnippet: "snippet",
        contentType: "post",
        confidence: 0.95,
        rawResult: {
          platform: "xiaohongshu",
          confidence: 0.95,
          author: "Karpat...",
          title: 'Karpathy前两天刚说"应该有人做这个"，',
          keywords: [],
          publishTime: null,
          visibleUrl: null,
          contentSnippet: "snippet",
          contentType: "post",
        },
      },
    };

    const markdown = renderClipMarkdown(record);
    const parsed = matter(markdown);

    expect(parsed.data.title).toBe(record.title);
    expect(parsed.data.author).toBe(record.author);
    expect(parsed.data.tags).toEqual(record.tags);
  });
});
