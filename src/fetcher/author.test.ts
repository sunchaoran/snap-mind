import { describe, expect, it } from "vitest";
import { extractAuthorHandle } from "@/fetcher/author.js";

describe("extractAuthorHandle", () => {
  it.each([
    [
      "Ding @dingyi",
      "dingyi",
    ],
    [
      "@dingyi",
      "dingyi",
    ],
    [
      "Berryxia.AI (@berryxia)",
      "berryxia",
    ],
    [
      "Display Name @first_handle @second_handle",
      "first_handle",
    ],
  ])("extracts handle from %j", (input, expected) => {
    expect(extractAuthorHandle(input)).toBe(expected);
  });

  it.each([
    [
      "老番茄",
      "老番茄",
    ],
    [
      "丁奕",
      "丁奕",
    ],
    [
      "dang",
      "dang",
    ],
  ])("returns trimmed string when no @-handle present (%j)", (input, expected) => {
    expect(extractAuthorHandle(input)).toBe(expected);
  });

  it.each([
    "  @dingyi  ",
    "\t@dingyi\n",
  ])("ignores surrounding whitespace (%j)", (input) => {
    expect(extractAuthorHandle(input)).toBe("dingyi");
  });

  it("returns null for null", () => {
    expect(extractAuthorHandle(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractAuthorHandle("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(extractAuthorHandle("   ")).toBeNull();
  });
});
