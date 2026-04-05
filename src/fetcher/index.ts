import type { FetchResult, MergedVLMResult, Platform } from "../types/index.js";

const PLATFORM_L1_SUPPORT: Platform[] = [
  "xiaohongshu",
  "twitter",
  "zhihu",
  "bilibili",
  "weixin",
];

const PLATFORM_L2_SUPPORT: Platform[] = ["weibo", "reddit", "weixin"];

/**
 * Four-level content fetching strategy.
 * L1: opencli search + download
 * L2: opencli search → URL → web fetch
 * L3: search engine fallback
 * L4: screenshot-only (all levels failed)
 */
export async function fetchContent(vlm: MergedVLMResult): Promise<FetchResult> {
  // L1
  if (PLATFORM_L1_SUPPORT.includes(vlm.platform)) {
    // TODO: implement L1
  }

  // L2
  if (PLATFORM_L2_SUPPORT.includes(vlm.platform)) {
    // TODO: implement L2
  }

  // L3
  // TODO: implement L3

  // L4: all failed
  return { contentFull: null, originalUrl: null, fetchLevel: 4 };
}
