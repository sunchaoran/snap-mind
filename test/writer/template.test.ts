import { describe, expect, it } from "vitest";
import type { ClipRecord } from "@/types/index.js";
import { renderClipMarkdown } from "@/writer/template.js";

function makeClipRecord(overrides: Partial<ClipRecord> = {}): ClipRecord {
  return {
    id: "clip_20260402_143000_abc123",
    title: "Test Title",
    platform: "xiaohongshu",
    author: "TestUser",
    originalUrl: "https://example.com/post/123",
    contentType: "post",
    contentFull: "This is the full content of the post.",
    contentSummary: "This is a summary.",
    tags: ["test", "vitest"],
    category: "tech",
    language: "zh",
    screenshotPath: "assets/clip_20260402_143000_abc123.png",
    fetchLevel: 1,
    sourceConfidence: 0.95,
    createdAt: "2026-04-02T14:30:00+08:00",
    rawVlmResult: {
      platform: "xiaohongshu",
      author: "TestUser",
      title: "Test Title",
      keywords: ["test"],
      publishTime: null,
      visibleUrl: null,
      contentSnippet: "Test snippet",
      contentType: "post",
      confidence: 0.95,
      rawResults: {},
    },
    ...overrides,
  };
}

describe("renderClipMarkdown", () => {
  it("renders correct YAML frontmatter", () => {
    const md = renderClipMarkdown(makeClipRecord());
    expect(md).toContain("---");
    expect(md).toContain("id: clip_20260402_143000_abc123");
    expect(md).toContain('title: "Test Title"');
    expect(md).toContain("platform: xiaohongshu");
    expect(md).toContain('author: "TestUser"');
    expect(md).toContain("fetchLevel: 1");
    expect(md).toContain("sourceConfidence: 0.95");
  });

  it("renders tags as YAML list", () => {
    const md = renderClipMarkdown(makeClipRecord());
    expect(md).toContain("tags:");
    expect(md).toContain("  - test");
    expect(md).toContain("  - vitest");
  });

  it("renders null originalUrl as YAML null", () => {
    const md = renderClipMarkdown(makeClipRecord({ originalUrl: null }));
    expect(md).toContain("originalUrl: null");
  });

  it("renders summary section", () => {
    const md = renderClipMarkdown(makeClipRecord());
    expect(md).toContain("## 摘要");
    expect(md).toContain("This is a summary.");
  });

  it("renders full content section for non-L4", () => {
    const md = renderClipMarkdown(makeClipRecord());
    expect(md).toContain("## 原文");
    expect(md).toContain("This is the full content");
  });

  it("renders fallback template for fetchLevel 4", () => {
    const md = renderClipMarkdown(
      makeClipRecord({
        fetchLevel: 4,
        contentFull: null,
      }),
    );
    expect(md).toContain("⚠️ 未能获取原文");
    expect(md).toContain("Test snippet");
  });

  it("renders screenshot embed", () => {
    const md = renderClipMarkdown(makeClipRecord());
    expect(md).toContain("## 截图");
    expect(md).toContain("![[assets/clip_20260402_143000_abc123.png]]");
  });

  it("escapes double quotes in title", () => {
    const md = renderClipMarkdown(
      makeClipRecord({ title: 'He said "hello"' }),
    );
    expect(md).toContain('title: "He said \\"hello\\""');
  });

  it("escapes double quotes in author", () => {
    const md = renderClipMarkdown(
      makeClipRecord({ author: 'User "Name"' }),
    );
    expect(md).toContain('author: "User \\"Name\\""');
  });

  it("handles newlines in title", () => {
    const md = renderClipMarkdown(
      makeClipRecord({ title: "Line1\nLine2" }),
    );
    // Should be on one line in frontmatter
    expect(md).toContain('title: "Line1 Line2"');
  });
});
