import type { VLMResult, MergedVLMResult, Platform, ContentType } from "../types/index.js";

/**
 * Merge N VLM results using majority voting.
 * Single model: direct return. Multiple models: vote on each field.
 */
export function mergeVLMResults(
  results: Record<string, VLMResult>,
): MergedVLMResult {
  const entries = Object.values(results);

  if (entries.length === 1) {
    const r = entries[0];
    return {
      platform: r.platform ?? "unknown",
      author: r.author,
      title: r.title,
      keywords: r.keywords,
      publishTime: r.publishTime,
      visibleUrl: r.visibleUrl,
      contentSnippet: r.contentSnippet,
      contentType: r.contentType ?? "post",
      confidence: r.confidence,
      rawResults: results,
    };
  }

  // TODO: implement multi-model voting logic
  // 1. Platform: majority vote, fallback to highest confidence
  // 2. Author: text similarity ≥ 0.8, majority wins
  // 3. Title: text similarity ≥ 0.7, majority wins
  // 4. Keywords: union + deduplicate
  // 5. Other fields: prefer highest confidence model's non-null value
  // 6. Overall confidence: based on platform agreement + field coverage

  throw new Error("Multi-model voting not yet implemented");
}
