import { describe, expect, it } from "vitest";
import { bigramOverlap, textSimilarity } from "@/utils/similarity.js";

describe("textSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(textSimilarity("dingyi", "dingyi")).toBe(1);
  });

  it("returns 0 when either side is empty", () => {
    expect(textSimilarity("", "dingyi")).toBe(0);
    expect(textSimilarity("dingyi", "")).toBe(0);
  });

  it("tanks toward 0 when lengths are very asymmetric (motivates bigramOverlap)", () => {
    const short = "这个音频组件库做得太完美了。";
    const long = `${short}另外它的官网也很漂亮，推荐给做音频和前端的朋友。`;
    expect(textSimilarity(short, long)).toBeLessThan(0.6);
  });
});

describe("bigramOverlap", () => {
  it("returns 1 when the shorter string's bigrams are all present in the longer", () => {
    const short = "这个音频组件库做得太完美了。";
    const long = `${short}另外它的官网也很漂亮，推荐给做音频和前端的朋友。`;
    expect(bigramOverlap(short, long)).toBe(1);
  });

  it("is symmetric for identical inputs", () => {
    expect(bigramOverlap("hello world", "hello world")).toBe(1);
  });

  it("returns 0 when there's no shared bigram", () => {
    expect(bigramOverlap("abcd", "wxyz")).toBe(0);
  });

  it("is partial when only some bigrams overlap", () => {
    const score = bigramOverlap("audio kit", "audio component");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("is case-insensitive", () => {
    expect(bigramOverlap("Hello", "hello world")).toBe(1);
  });

  it("returns 0 for empty inputs", () => {
    expect(bigramOverlap("", "anything")).toBe(0);
    expect(bigramOverlap("anything", "")).toBe(0);
  });

  it.each([
    [
      "a",
      "alphabet",
      1,
    ],
    [
      "z",
      "alphabet",
      0,
    ],
  ])("single-char input falls back to substring containment (%j vs %j)", (needle, haystack, expected) => {
    expect(bigramOverlap(needle, haystack)).toBe(expected);
  });
});
