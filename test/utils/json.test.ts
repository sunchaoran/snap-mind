import { describe, expect, it } from "vitest";
import { parseLLMJson } from "@/utils/json.js";

describe("parseLLMJson", () => {
  it("parses plain JSON", () => {
    const result = parseLLMJson<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it("parses JSON with leading/trailing whitespace", () => {
    const result = parseLLMJson<{ a: number }>('  {"a": 1}  ');
    expect(result).toEqual({ a: 1 });
  });

  it("extracts JSON from ```json code fence", () => {
    const input = '```json\n{"platform": "twitter", "confidence": 0.9}\n```';
    const result = parseLLMJson<{ platform: string; confidence: number }>(input);
    expect(result.platform).toBe("twitter");
    expect(result.confidence).toBe(0.9);
  });

  it("extracts JSON from ``` code fence (no language tag)", () => {
    const input = '```\n{"key": "value"}\n```';
    const result = parseLLMJson<{ key: string }>(input);
    expect(result.key).toBe("value");
  });

  it("extracts JSON from mixed text containing { ... }", () => {
    const input = 'Here is the result: {"status": "ok"} done.';
    const result = parseLLMJson<{ status: string }>(input);
    expect(result.status).toBe("ok");
  });

  it("extracts JSON array from mixed text", () => {
    const input = 'Results: [1, 2, 3]';
    const result = parseLLMJson<number[]>(input);
    expect(result).toEqual([1, 2, 3]);
  });

  it("throws on completely invalid input", () => {
    expect(() => parseLLMJson("no json here")).toThrow(SyntaxError);
  });

  it("throws on empty string", () => {
    expect(() => parseLLMJson("")).toThrow();
  });

  it("handles nested objects in code fences", () => {
    const input = '```json\n{"a": {"b": [1, 2]}}\n```';
    const result = parseLLMJson<{ a: { b: number[] } }>(input);
    expect(result.a.b).toEqual([1, 2]);
  });
});
