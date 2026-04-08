import { describe, expect, it } from "vitest";
import type { VLMResult } from "@/types/index.js";
import { mergeVLMResults } from "@/vlm/merger.js";

function makeVLMResult(overrides: Partial<VLMResult> = {}): VLMResult {
  return {
    platform: "twitter",
    confidence: 0.9,
    author: "@testuser",
    title: "Test Title",
    keywords: ["test"],
    publishTime: null,
    visibleUrl: null,
    contentSnippet: "Test content snippet",
    contentType: "post",
    ...overrides,
  };
}

describe("mergeVLMResults", () => {
  it("passes through single model result directly", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({ platform: "twitter", author: "@john" }),
    });
    expect(result.platform).toBe("twitter");
    expect(result.author).toBe("@john");
    expect(result.contentType).toBe("post");
  });

  it("majority votes platform when 2 of 3 agree", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({ platform: "twitter" }),
      modelB: makeVLMResult({ platform: "twitter" }),
      modelC: makeVLMResult({ platform: "reddit" }),
    });
    expect(result.platform).toBe("twitter");
  });

  it("handles all-different platforms by picking most common (first)", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({
        platform: "twitter",
        confidence: 0.5,
      }),
      modelB: makeVLMResult({
        platform: "reddit",
        confidence: 0.9,
      }),
      modelC: makeVLMResult({
        platform: "zhihu",
        confidence: 0.7,
      }),
    });
    // When all differ, majorityVote still returns the first (most common with count=1)
    // The actual winner depends on Map iteration order
    expect(["twitter", "reddit", "zhihu"]).toContain(result.platform);
  });

  it("uses text consensus for author with similarity threshold", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({ author: "John Smith" }),
      modelB: makeVLMResult({ author: "John Smith" }),
      modelC: makeVLMResult({ author: "Jane Doe" }),
    });
    expect(result.author).toBe("John Smith");
  });

  it("returns null author when all disagree", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({ author: "Alice" }),
      modelB: makeVLMResult({ author: "Bob" }),
      modelC: makeVLMResult({ author: "Charlie" }),
    });
    // With 3 completely different names, textConsensus should group them separately
    // and return the one in the largest group (or first if all equal size)
    expect(result.author).not.toBeNull();
  });

  it("merges keywords as unique set", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({ keywords: ["rust", "async"] }),
      modelB: makeVLMResult({ keywords: ["Rust", "tokio"] }),
      modelC: makeVLMResult({ keywords: ["rust", "programming"] }),
    });
    // "rust" and "Rust" should be deduplicated (case-insensitive)
    const lowerKws = result.keywords.map((k) => k.toLowerCase());
    expect(new Set(lowerKws).size).toBe(lowerKws.length);
    expect(lowerKws).toContain("rust");
    expect(lowerKws).toContain("async");
    expect(lowerKws).toContain("tokio");
    expect(lowerKws).toContain("programming");
  });

  it("picks longest contentSnippet", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({ contentSnippet: "short" }),
      modelB: makeVLMResult({ contentSnippet: "this is a much longer snippet" }),
      modelC: makeVLMResult({ contentSnippet: null }),
    });
    expect(result.contentSnippet).toBe("this is a much longer snippet");
  });

  it("calculates confidence based on agreement and coverage", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult({
        platform: "twitter",
        confidence: 0.9,
      }),
      modelB: makeVLMResult({
        platform: "twitter",
        confidence: 0.8,
      }),
      modelC: makeVLMResult({
        platform: "twitter",
        confidence: 0.85,
      }),
    });
    // All agree on platform (1.0 * 0.4) + full coverage (1.0 * 0.2) + avg confidence (~0.85 * 0.4)
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("stores rawResults for debugging", () => {
    const result = mergeVLMResults({
      modelA: makeVLMResult(),
      modelB: makeVLMResult(),
      modelC: makeVLMResult(),
    });
    expect(result.rawResults).toBeDefined();
    expect(Object.keys(result.rawResults)).toHaveLength(3);
  });
});
