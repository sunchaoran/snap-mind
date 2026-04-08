import { describe, expect, it } from "vitest";
import { detectImageType } from "@/utils/image.js";

describe("detectImageType", () => {
  it("detects PNG", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    expect(detectImageType(buf)).toEqual({ mime: "image/png", ext: "png" });
  });

  it("detects JPEG", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectImageType(buf)).toEqual({ mime: "image/jpeg", ext: "jpg" });
  });

  it("detects WebP", () => {
    const buf = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    expect(detectImageType(buf)).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("detects GIF", () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38]);
    expect(detectImageType(buf)).toEqual({ mime: "image/gif", ext: "gif" });
  });

  it("defaults to PNG for unknown format", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(detectImageType(buf)).toEqual({ mime: "image/png", ext: "png" });
  });

  it("defaults to PNG for empty buffer", () => {
    const buf = Buffer.alloc(0);
    expect(detectImageType(buf)).toEqual({ mime: "image/png", ext: "png" });
  });
});
