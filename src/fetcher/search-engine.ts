import type { MergedVLMResult } from "../types/index.js";

/**
 * L3 fallback: use search engine API to find the original URL.
 * TODO: implement Google Custom Search / Bing API integration
 */
export async function searchForUrl(
  _vlm: MergedVLMResult,
): Promise<string | null> {
  // TODO: construct query from platform + author + title/contentSnippet
  // TODO: call search engine API
  // TODO: return best matching URL
  return null;
}
