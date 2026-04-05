import { config } from "../config.js";
import type { FetchResult, MergedVLMResult, Platform } from "../types/index.js";
import { errMsg, createLogger } from "../utils/logger.js";
import { textSimilarity } from "../utils/similarity.js";
import { runOpencli } from "./opencli.js";
import { searchForUrl } from "./search-engine.js";
import { fetchAndExtract, findPostUrlOnPlatform } from "./web-fetch.js";

const log = createLogger("fetcher");

const PLATFORM_L1_SUPPORT: Platform[] = [
  "xiaohongshu",
  "twitter",
  "zhihu",
  "bilibili",
  "weixin",
];

const PLATFORM_L2_SUPPORT: Platform[] = [
  "twitter",
  "xiaohongshu",
  "zhihu",
  "bilibili",
  "weibo",
  "reddit",
  "weixin",
];

interface OpencliSearchItem {
  id?: string;
  note_id?: string;
  url?: string;
  title?: string;
  author?: string;
  content?: string;
  [key: string]: unknown;
}

interface OpencliDownloadResult {
  content?: string;
  title?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * Four-level content fetching strategy.
 * L1: opencli search + download
 * L2: platform-aware web fetch (visibleUrl → platform search → opencli URL)
 * L3: search engine fallback
 * L4: screenshot-only (all levels failed)
 */
export async function fetchContent(vlm: MergedVLMResult): Promise<FetchResult> {
  log.info(
    {
      platform: vlm.platform,
      author: vlm.author,
      title: vlm.title?.slice(0, 60),
      visibleUrl: vlm.visibleUrl,
      keywords: vlm.keywords,
    },
    "▶ fetchContent start",
  );

  // L1: opencli direct (search + download)
  if (PLATFORM_L1_SUPPORT.includes(vlm.platform)) {
    log.info("L1 ▶ trying opencli search + download");
    const l1 = await tryWithTimeout(
      () => tryLevel1(vlm),
      config.processing.fetchTimeouts.l1,
    );
    if (l1) {
      log.info(
        { url: l1.originalUrl, chars: l1.contentFull?.length },
        "L1 ✓ opencli download succeeded",
      );
      return { ...l1, fetchLevel: 1 };
    }
    log.warn("L1 ✗ opencli failed or timed out, falling through");
  } else {
    log.debug({ platform: vlm.platform }, "L1 ⊘ platform not in L1 support list, skipping");
  }

  // L2: platform-aware web fetch
  if (PLATFORM_L2_SUPPORT.includes(vlm.platform)) {
    log.info("L2 ▶ trying platform-aware web fetch");
    const l2 = await tryWithTimeout(
      () => tryLevel2(vlm),
      config.processing.fetchTimeouts.l2,
    );
    if (l2) {
      log.info(
        { url: l2.originalUrl, chars: l2.contentFull?.length },
        "L2 ✓ web fetch succeeded",
      );
      return { ...l2, fetchLevel: 2 };
    }
    log.warn("L2 ✗ platform web fetch failed or timed out, falling through");
  } else {
    log.debug({ platform: vlm.platform }, "L2 ⊘ platform not in L2 support list, skipping");
  }

  // L3: search engine → web fetch + LLM extract
  log.info("L3 ▶ trying search engine fallback");
  const l3 = await tryWithTimeout(
    () => tryLevel3(vlm),
    config.processing.fetchTimeouts.l3,
  );
  if (l3) {
    log.info(
      { url: l3.originalUrl, chars: l3.contentFull?.length },
      "L3 ✓ search engine fetch succeeded",
    );
    return { ...l3, fetchLevel: 3 };
  }
  log.warn("L3 ✗ search engine failed or timed out");

  // L4: all failed
  log.error("✗ all levels failed → L4 screenshot-only fallback");
  return { contentFull: null, originalUrl: null, fetchLevel: 4 };
}

/**
 * L1: Use opencli to search and download full content directly.
 */
async function tryLevel1(
  vlm: MergedVLMResult,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  const query = buildSearchQuery(vlm);
  if (!query) {
    log.warn("L1   no search query could be built from VLM data");
    return null;
  }
  log.debug({ query }, "L1   opencli search query");

  const searchResults = await runOpencli([
    vlm.platform,
    "search",
    query,
    "--limit",
    "5",
    "--format",
    "json",
  ]).catch((err) => {
    log.warn({ error: errMsg(err) }, "L1   opencli search command failed");
    return null;
  });

  if (!searchResults) return null;

  const items = normalizeSearchResults(searchResults);
  log.debug({ count: items.length }, "L1   search returned results");

  const best = findBestMatch(items, vlm);
  if (!best) {
    log.warn("L1   no matching item found in search results");
    return null;
  }
  log.debug(
    { id: best.id ?? best.note_id, title: best.title?.slice(0, 50) },
    "L1   best match selected",
  );

  const itemId = best.id ?? best.note_id;
  if (!itemId) {
    log.warn("L1   matched item has no id, cannot download");
    return null;
  }

  const downloaded = (await runOpencli([
    vlm.platform,
    "download",
    String(itemId),
    "--format",
    "json",
  ]).catch((err) => {
    log.warn({ error: errMsg(err) }, "L1   opencli download command failed");
    return null;
  })) as OpencliDownloadResult | null;

  if (!downloaded?.content) {
    log.warn("L1   download returned no content");
    return null;
  }

  return {
    contentFull: downloaded.content,
    originalUrl: downloaded.url ?? best.url ?? null,
  };
}

/**
 * L2: Platform-aware web fetch fallback.
 * Strategy: visibleUrl → platform search (Playwright) → opencli URL → web fetch
 */
async function tryLevel2(
  vlm: MergedVLMResult,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  // 2a: If VLM found a URL in the screenshot, try it directly
  if (vlm.visibleUrl) {
    log.info({ url: vlm.visibleUrl }, "L2.a ▶ trying visibleUrl from screenshot");
    const content = await fetchAndExtract(vlm.visibleUrl).catch((err) => {
      log.warn({ error: errMsg(err) }, "L2.a ✗ visibleUrl fetch failed");
      return null;
    });
    if (content) {
      log.info({ chars: content.length }, "L2.a ✓ visibleUrl content extracted");
      return { contentFull: content, originalUrl: vlm.visibleUrl };
    }
    log.warn("L2.a ✗ visibleUrl returned no extractable content");
  } else {
    log.debug("L2.a ⊘ no visibleUrl in screenshot, skipping");
  }

  // 2b: Platform-aware search — use Playwright to search on the platform site
  log.info({ platform: vlm.platform }, "L2.b ▶ trying platform site search via Playwright");
  const postUrl = await findPostUrlOnPlatform(vlm).catch((err) => {
    log.warn({ error: errMsg(err) }, "L2.b ✗ platform search failed");
    return null;
  });

  if (postUrl) {
    log.info({ url: postUrl }, "L2.b ✓ found post URL, fetching content");
    const content = await fetchAndExtract(postUrl).catch((err) => {
      log.warn({ error: errMsg(err) }, "L2.b ✗ post URL fetch failed");
      return null;
    });
    if (content) {
      log.info({ chars: content.length }, "L2.b ✓ post content extracted");
      return { contentFull: content, originalUrl: postUrl };
    }
    log.warn("L2.b ✗ post URL returned no extractable content");
  } else {
    log.warn("L2.b ✗ no post URL found on platform search");
  }

  // 2c: opencli search → URL → web fetch (skip if L1 already tried opencli for this platform)
  if (!PLATFORM_L1_SUPPORT.includes(vlm.platform)) {
    log.info("L2.c ▶ trying opencli search → URL → web fetch");
    const query = buildSearchQuery(vlm);
    if (!query) {
      log.warn("L2.c   no search query could be built");
      return null;
    }

    const searchResults = await runOpencli([
      vlm.platform,
      "search",
      query,
      "--limit",
      "5",
      "--format",
      "json",
    ]).catch((err) => {
      log.warn({ error: errMsg(err) }, "L2.c ✗ opencli search failed");
      return null;
    });

    if (!searchResults) return null;

    const items = normalizeSearchResults(searchResults);
    const best = findBestMatch(items, vlm);
    if (!best?.url) {
      log.warn("L2.c ✗ no URL found in opencli search results");
      return null;
    }

    log.info({ url: best.url }, "L2.c ▶ fetching content from opencli result URL");
    const content = await fetchAndExtract(best.url).catch((err) => {
      log.warn({ error: errMsg(err) }, "L2.c ✗ URL fetch failed");
      return null;
    });
    if (!content) return null;

    log.info({ chars: content.length }, "L2.c ✓ content extracted");
    return { contentFull: content, originalUrl: best.url };
  }

  log.debug("L2.c ⊘ L1 already tried opencli for this platform, skipping");
  return null;
}

/**
 * L3: Use search engine API to find URL, then web fetch + LLM extraction.
 */
async function tryLevel3(
  vlm: MergedVLMResult,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  // Try visible URL from screenshot first (if L2 didn't already)
  if (vlm.visibleUrl && !PLATFORM_L2_SUPPORT.includes(vlm.platform)) {
    log.info({ url: vlm.visibleUrl }, "L3.a ▶ trying visibleUrl");
    const content = await fetchAndExtract(vlm.visibleUrl).catch((err) => {
      log.warn({ error: errMsg(err) }, "L3.a ✗ visibleUrl fetch failed");
      return null;
    });
    if (content) {
      return { contentFull: content, originalUrl: vlm.visibleUrl };
    }
  }

  if (!config.searchEngine.apiKey) {
    log.warn("L3   ⊘ no SEARCH_API_KEY configured, search engine unavailable");
    return null;
  }

  log.info({ provider: config.searchEngine.provider }, "L3 ▶ searching via search engine API");
  const url = await searchForUrl(vlm).catch((err) => {
    log.warn({ error: errMsg(err) }, "L3 ✗ search engine request failed");
    return null;
  });

  if (!url) {
    log.warn("L3 ✗ search engine returned no URL");
    return null;
  }

  log.info({ url }, "L3 ▶ fetching content from search engine result");
  const content = await fetchAndExtract(url).catch((err) => {
    log.warn({ error: errMsg(err) }, "L3 ✗ search result URL fetch failed");
    return null;
  });
  if (!content) return null;

  log.info({ chars: content.length }, "L3 ✓ content extracted");
  return { contentFull: content, originalUrl: url };
}

function buildSearchQuery(vlm: MergedVLMResult): string | null {
  const parts: string[] = [];
  if (vlm.author) parts.push(vlm.author);
  if (vlm.title) parts.push(vlm.title);
  else if (vlm.keywords.length > 0) parts.push(vlm.keywords.join(" "));
  else if (vlm.contentSnippet) parts.push(vlm.contentSnippet.slice(0, 80));

  return parts.length > 0 ? parts.join(" ") : null;
}

function normalizeSearchResults(raw: unknown): OpencliSearchItem[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

function findBestMatch(
  items: OpencliSearchItem[],
  vlm: MergedVLMResult,
): OpencliSearchItem | null {
  if (items.length === 0) return null;
  if (!vlm.title && !vlm.author) return items[0];

  let bestItem = items[0];
  let bestScore = -1;

  for (const item of items) {
    let score = 0;
    if (vlm.title && item.title) {
      score += textSimilarity(vlm.title, item.title);
    }
    if (vlm.author && item.author) {
      score += textSimilarity(vlm.author, item.author) * 0.5;
    }
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  return bestItem;
}

async function tryWithTimeout<T>(
  fn: () => Promise<T | null>,
  ms: number,
): Promise<T | null> {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<null>((resolve) => {
        setTimeout(() => {
          log.warn({ timeoutMs: ms }, "  ⏱ step timed out");
          resolve(null);
        }, ms);
      }),
    ]);
    return result;
  } catch (err) {
    log.error({ error: errMsg(err) }, "  ✗ step threw unexpected error");
    return null;
  }
}
