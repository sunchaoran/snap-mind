import { describe, expect, it } from "vitest";
import { generateClipId } from "@/utils/id.js";

describe("generateClipId", () => {
  it("starts with 'clip_' prefix", () => {
    const id = generateClipId();
    expect(id.startsWith("clip_")).toBe(true);
  });

  it("contains date and time components", () => {
    const id = generateClipId();
    // Format: clip_{YYYYMMDD}_{HHmmss}_{nanoid}
    const parts = id.split("_");
    expect(parts.length).toBeGreaterThanOrEqual(4);
    // Date part should be 8 digits
    expect(parts[1]).toMatch(/^\d{8}$/);
    // Time part should be 6 digits
    expect(parts[2]).toMatch(/^\d{6}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateClipId());
    }
    expect(ids.size).toBe(100);
  });
});
