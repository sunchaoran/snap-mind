import { describe, expect, it } from "vitest";
import { generateSlug } from "@/utils/slug.js";

describe("generateSlug", () => {
  it("converts English title to slug", () => {
    const slug = generateSlug("Hello World");
    expect(slug).toBe("hello-world");
  });

  it("handles CJK titles gracefully", () => {
    const slug = generateSlug("Rust异步编程指南");
    // slugify may strip CJK depending on version, but should at least produce something
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toContain("rust");
  });

  it("truncates to 50 characters", () => {
    const longTitle =
      "This is a very long title that exceeds the fifty character limit and should be truncated";
    const slug = generateSlug(longTitle);
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it("returns 'untitled' for empty string", () => {
    const slug = generateSlug("");
    expect(slug).toBe("untitled");
  });

  it("removes special characters", () => {
    const slug = generateSlug("Hello! @World #2026");
    expect(slug).not.toContain("!");
    expect(slug).not.toContain("@");
    expect(slug).not.toContain("#");
  });

  it("collapses multiple dashes", () => {
    const slug = generateSlug("hello---world");
    expect(slug).not.toContain("---");
  });
});
