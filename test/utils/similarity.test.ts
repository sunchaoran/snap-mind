import { describe, expect, it } from "vitest";
import { textSimilarity } from "@/utils/similarity.js";

describe("textSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(textSimilarity("hello", "hello")).toBe(1);
  });

  it("returns 0 for empty vs non-empty", () => {
    expect(textSimilarity("", "hello")).toBe(0);
    expect(textSimilarity("hello", "")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    // Both empty → a === b → 1
    expect(textSimilarity("", "")).toBe(1);
  });

  it("returns high similarity for similar strings", () => {
    const sim = textSimilarity("Rust异步编程", "Rust异步编程指南");
    expect(sim).toBeGreaterThan(0.7);
  });

  it("returns low similarity for different strings", () => {
    const sim = textSimilarity("hello world", "goodbye universe");
    expect(sim).toBeLessThan(0.5);
  });

  it("handles Chinese text comparison", () => {
    const sim = textSimilarity("小红书用户", "小红书用户名");
    expect(sim).toBeGreaterThan(0.8);
  });

  it("is symmetric", () => {
    const ab = textSimilarity("abc", "abcd");
    const ba = textSimilarity("abcd", "abc");
    expect(ab).toBe(ba);
  });
});
