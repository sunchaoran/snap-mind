import { config } from "@/config.js";
import { runOpencli } from "@/fetcher/opencli.js";
import { searchForUrl } from "@/fetcher/search-engine.js";
import { fetchAndExtract, findPostUrlOnPlatform } from "@/fetcher/web-fetch.js";
import type { FetchResult, Platform, VLMAnalysis } from "@/types/domain.js";
import { createLogger, errMsg } from "@/utils/logger.js";
import { textSimilarity } from "@/utils/similarity.js";

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
  author_url?: string;
  content?: string;
  text?: string;
  [key: string]: unknown;
}

/** Per-platform config for the "search author → list user posts → fetch detail" strategy. */
interface PlatformUserStrategy {
  /** Regex to extract user id from author_url */
  userIdPattern: RegExp;
  /** opencli subcommand to list user posts, e.g. ["user"] or ["user-videos"] */
  listCmd: string[];
  /** opencli subcommand to fetch a single post detail, e.g. ["note"] */
  detailCmd: string[];
  /** Field name for the post id in list results */
  postIdField: string;
}

const PLATFORM_USER_STRATEGY: Partial<Record<Platform, PlatformUserStrategy>> =
  {
    xiaohongshu: {
      userIdPattern: /\/user\/profile\/([a-f0-9]+)/,
      listCmd: [
        "user",
      ],
      detailCmd: [
        "note",
      ],
      postIdField: "id",
    },
    bilibili: {
      userIdPattern: /space\.bilibili\.com\/(\d+)|uid=(\d+)/,
      listCmd: [
        "user-videos",
      ],
      detailCmd: [],
      postIdField: "bvid",
    },
  };

/**
 * Four-level content fetching strategy.
 * L1: opencli search (results already contain full text)
 * L2: platform-aware web fetch (visibleUrl → platform search → opencli URL)
 * L3: search engine fallback
 * L4: screenshot-only (all levels failed)
 */
export async function fetchContent(vlm: VLMAnalysis): Promise<FetchResult> {
  const start = Date.now();
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

  const maxLevel = config.processing.maxFetchLevel;

  // L1: opencli search (results contain full text)
  if (maxLevel >= 1 && PLATFORM_L1_SUPPORT.includes(vlm.platform)) {
    log.info("L1 ▶ trying opencli search");
    const l1Start = Date.now();
    const l1 = await tryWithTimeout(
      () => tryLevel1(vlm),
      config.processing.fetchTimeouts.l1,
    );
    if (l1) {
      log.info(
        {
          url: l1.originalUrl,
          chars: l1.contentFull?.length,
          elapsed: `${Date.now() - l1Start}ms`,
        },
        "L1 ✓ opencli search matched",
      );
      return {
        ...l1,
        fetchLevel: 1,
      };
    }
    if (maxLevel <= 1) {
      throw new Error("L1 fetch failed and MAX_FETCH_LEVEL=1, aborting");
    }
    log.warn(
      {
        elapsed: `${Date.now() - l1Start}ms`,
      },
      "L1 ✗ opencli failed or timed out, falling through",
    );
  } else if (maxLevel >= 1) {
    log.debug(
      {
        platform: vlm.platform,
      },
      "L1 ⊘ platform not in L1 support list, skipping",
    );
    if (maxLevel <= 1) {
      throw new Error(
        "L1 skipped (platform unsupported) and MAX_FETCH_LEVEL=1, aborting",
      );
    }
  }

  // L2: platform-aware web fetch
  if (maxLevel >= 2 && PLATFORM_L2_SUPPORT.includes(vlm.platform)) {
    log.info("L2 ▶ trying platform-aware web fetch");
    const l2Start = Date.now();
    const l2 = await tryWithTimeout(
      () => tryLevel2(vlm),
      config.processing.fetchTimeouts.l2,
    );
    if (l2) {
      log.info(
        {
          url: l2.originalUrl,
          chars: l2.contentFull?.length,
          elapsed: `${Date.now() - l2Start}ms`,
        },
        "L2 ✓ web fetch succeeded",
      );
      return {
        ...l2,
        fetchLevel: 2,
      };
    }
    if (maxLevel <= 2) {
      throw new Error("L2 fetch failed and MAX_FETCH_LEVEL=2, aborting");
    }
    log.warn(
      {
        elapsed: `${Date.now() - l2Start}ms`,
      },
      "L2 ✗ platform web fetch failed or timed out, falling through",
    );
  } else if (maxLevel >= 2) {
    log.debug(
      {
        platform: vlm.platform,
      },
      "L2 ⊘ platform not in L2 support list, skipping",
    );
  }

  // L3: search engine → web fetch + LLM extract
  if (maxLevel >= 3) {
    log.info("L3 ▶ trying search engine fallback");
    const l3Start = Date.now();
    const l3 = await tryWithTimeout(
      () => tryLevel3(vlm),
      config.processing.fetchTimeouts.l3,
    );
    if (l3) {
      log.info(
        {
          url: l3.originalUrl,
          chars: l3.contentFull?.length,
          elapsed: `${Date.now() - l3Start}ms`,
        },
        "L3 ✓ search engine fetch succeeded",
      );
      return {
        ...l3,
        fetchLevel: 3,
      };
    }
    if (maxLevel <= 3) {
      throw new Error("L3 fetch failed and MAX_FETCH_LEVEL=3, aborting");
    }
    log.warn(
      {
        elapsed: `${Date.now() - l3Start}ms`,
      },
      "L3 ✗ search engine failed or timed out",
    );
  }

  // L4: all failed
  log.error(
    {
      elapsed: `${Date.now() - start}ms`,
    },
    "✗ all levels failed → L4 screenshot-only fallback",
  );
  return {
    contentFull: null,
    originalUrl: null,
    fetchLevel: 4,
  };
}

/**
 * L1: opencli-based content fetching.
 * L1.a: search author → get user id → list user posts → match title → fetch detail
 * L1.b: keyword search fallback (original strategy)
 */
async function tryLevel1(
  vlm: VLMAnalysis,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  // L1.a: author-first strategy
  const strategy = PLATFORM_USER_STRATEGY[vlm.platform];
  if (strategy && vlm.author) {
    log.info("L1.a ▶ trying author-first strategy");
    const result = await tryAuthorFirst(vlm, strategy);
    if (result) {
      return result;
    }
    log.warn("L1.a ✗ author-first strategy failed, trying keyword search");
  }

  // L1.b: keyword search fallback
  log.info("L1.b ▶ trying keyword search");
  return tryKeywordSearch(vlm);
}

/**
 * L1.a: Search author name → extract user id → list user posts → match title → fetch detail.
 */
async function tryAuthorFirst(
  vlm: VLMAnalysis,
  strategy: PlatformUserStrategy,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  // Step 1: search author name to find their profile URL
  const authorQuery = vlm.author!.replace(/@/g, "").trim();
  log.debug(
    {
      authorQuery,
    },
    "L1.a   searching for author",
  );

  const searchResults = await runOpencli(vlm.platform, [
    vlm.platform,
    "search",
    authorQuery,
    "--limit",
    "5",
    "--format",
    "json",
  ]).catch((err) => {
    log.warn(
      {
        error: errMsg(err),
      },
      "L1.a   author search failed",
    );
    return null;
  });

  if (!searchResults) {
    return null;
  }

  const items = normalizeSearchResults(searchResults);
  // Find an item with an author_url that matches the author name
  const authorItem = items.find((item) => {
    if (!item.author_url) {
      return false;
    }
    const cleanAuthor = (item.author || "")
      .replace(
        /[\d\s]*(?:\d{4}[-/])?\d{1,2}[-/]\d{1,2}.*$|[\d\s]*\d+[天小时分钟秒]+前.*$/,
        "",
      )
      .trim();
    return textSimilarity(authorQuery, cleanAuthor) > 0.5;
  });

  if (!authorItem?.author_url) {
    log.warn("L1.a   no author_url found in search results");
    return null;
  }

  // Step 2: extract user id from author_url
  const idMatch = authorItem.author_url.match(strategy.userIdPattern);
  // Some patterns have multiple capture groups (e.g. bilibili), pick the first non-null
  const userId = idMatch?.slice(1).find(Boolean);
  if (!userId) {
    log.warn(
      {
        author_url: authorItem.author_url,
      },
      "L1.a   could not extract user id",
    );
    return null;
  }
  log.info(
    {
      userId,
    },
    "L1.a   ✓ user id extracted",
  );

  // Step 3: list user posts
  const userPosts = await runOpencli(vlm.platform, [
    vlm.platform,
    ...strategy.listCmd,
    userId,
    "--limit",
    "30",
    "--format",
    "json",
  ]).catch((err) => {
    log.warn(
      {
        error: errMsg(err),
      },
      "L1.a   user post list failed",
    );
    return null;
  });

  if (!userPosts) {
    return null;
  }

  const posts = normalizeSearchResults(userPosts);
  log.debug(
    {
      count: posts.length,
    },
    "L1.a   user posts returned",
  );

  // Step 4: match title
  const best = findBestMatch(posts, vlm);
  if (!best) {
    log.warn("L1.a   no matching post in user's post list");
    return null;
  }

  const postId = best[strategy.postIdField] as string | undefined;
  log.info(
    {
      postId,
      title: best.title,
    },
    "L1.a   ✓ matched post",
  );

  // If the post list already has full content, use it
  const inlineContent = best.text || best.content;
  if (inlineContent) {
    return {
      contentFull: inlineContent,
      originalUrl: best.url ?? null,
    };
  }

  // Step 5: fetch detail if we have a detail command
  // Prefer full URL (preserves xsec_token etc.), fall back to bare post id
  const detailArg = best.url || postId;
  if (strategy.detailCmd.length > 0 && detailArg) {
    log.info(
      {
        detailArg: detailArg.slice(0, 80),
      },
      "L1.a   fetching post detail",
    );
    const detail = await runOpencli(vlm.platform, [
      vlm.platform,
      ...strategy.detailCmd,
      detailArg,
      "--format",
      "json",
    ]).catch((err) => {
      log.warn(
        {
          error: errMsg(err),
        },
        "L1.a   detail fetch failed",
      );
      return null;
    });

    if (detail) {
      const detailContent = extractDetailContent(detail);
      if (detailContent) {
        return {
          contentFull: detailContent,
          originalUrl: best.url ?? null,
        };
      }
    }
    log.warn("L1.a   detail fetch returned no content");
  }

  // Fall back to URL if available
  if (best.url) {
    return {
      contentFull: null,
      originalUrl: best.url,
    };
  }

  return null;
}

/**
 * L1.b: Keyword search fallback — search by keywords/title directly.
 */
async function tryKeywordSearch(
  vlm: VLMAnalysis,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  const query = buildSearchQuery(vlm);
  if (!query) {
    log.warn("L1.b   no search query could be built from VLM data");
    return null;
  }
  log.debug(
    {
      query,
    },
    "L1.b   opencli search query",
  );

  const searchResults = await runOpencli(vlm.platform, [
    vlm.platform,
    "search",
    query,
    "--limit",
    "20",
    "--format",
    "json",
  ]).catch((err) => {
    log.warn(
      {
        error: errMsg(err),
      },
      "L1.b   opencli search command failed",
    );
    return null;
  });

  if (!searchResults) {
    return null;
  }

  const items = normalizeSearchResults(searchResults);
  log.debug(
    {
      count: items.length,
    },
    "L1.b   search returned results",
  );

  const best = findBestMatch(items, vlm);
  if (!best) {
    log.warn("L1.b   no matching item found in search results");
    return null;
  }
  log.debug(
    {
      id: best.id ?? best.note_id,
    },
    "L1.b   best match selected",
  );

  const content = best.text || best.content;
  if (!content) {
    log.warn("L1.b   matched item has no text/content field");
    return null;
  }

  return {
    contentFull: content,
    originalUrl: best.url ?? null,
  };
}

/**
 * L2: Platform-aware web fetch fallback.
 * Strategy: visibleUrl → platform search (Playwright) → opencli URL → web fetch
 */
async function tryLevel2(
  vlm: VLMAnalysis,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  // 2a: If VLM found a URL in the screenshot, try it directly
  if (vlm.visibleUrl) {
    log.info(
      {
        url: vlm.visibleUrl,
      },
      "L2.a ▶ trying visibleUrl from screenshot",
    );
    const content = await fetchAndExtract(vlm.visibleUrl).catch((err) => {
      log.warn(
        {
          error: errMsg(err),
        },
        "L2.a ✗ visibleUrl fetch failed",
      );
      return null;
    });
    if (content) {
      log.info(
        {
          chars: content.length,
        },
        "L2.a ✓ visibleUrl content extracted",
      );
      return {
        contentFull: content,
        originalUrl: vlm.visibleUrl,
      };
    }
    log.warn("L2.a ✗ visibleUrl returned no extractable content");
  } else {
    log.debug("L2.a ⊘ no visibleUrl in screenshot, skipping");
  }

  // 2b: Platform-aware search — use Playwright to search on the platform site
  log.info(
    {
      platform: vlm.platform,
    },
    "L2.b ▶ trying platform site search via Playwright",
  );
  const postUrl = await findPostUrlOnPlatform(vlm).catch((err) => {
    log.warn(
      {
        error: errMsg(err),
      },
      "L2.b ✗ platform search failed",
    );
    return null;
  });

  if (postUrl) {
    log.info(
      {
        url: postUrl,
      },
      "L2.b ✓ found post URL, fetching content",
    );
    const content = await fetchAndExtract(postUrl).catch((err) => {
      log.warn(
        {
          error: errMsg(err),
        },
        "L2.b ✗ post URL fetch failed",
      );
      return null;
    });
    if (content) {
      log.info(
        {
          chars: content.length,
        },
        "L2.b ✓ post content extracted",
      );
      return {
        contentFull: content,
        originalUrl: postUrl,
      };
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

    const searchResults = await runOpencli(vlm.platform, [
      vlm.platform,
      "search",
      query,
      "--limit",
      "20",
      "--format",
      "json",
    ]).catch((err) => {
      log.warn(
        {
          error: errMsg(err),
        },
        "L2.c ✗ opencli search failed",
      );
      return null;
    });

    if (!searchResults) {
      return null;
    }

    const items = normalizeSearchResults(searchResults);
    const best = findBestMatch(items, vlm);
    if (!best?.url) {
      log.warn("L2.c ✗ no URL found in opencli search results");
      return null;
    }

    log.info(
      {
        url: best.url,
      },
      "L2.c ▶ fetching content from opencli result URL",
    );
    const content = await fetchAndExtract(best.url).catch((err) => {
      log.warn(
        {
          error: errMsg(err),
        },
        "L2.c ✗ URL fetch failed",
      );
      return null;
    });
    if (!content) {
      return null;
    }

    log.info(
      {
        chars: content.length,
      },
      "L2.c ✓ content extracted",
    );
    return {
      contentFull: content,
      originalUrl: best.url,
    };
  }

  log.debug("L2.c ⊘ L1 already tried opencli for this platform, skipping");
  return null;
}

/**
 * L3: Use search engine API to find URL, then web fetch + LLM extraction.
 */
async function tryLevel3(
  vlm: VLMAnalysis,
): Promise<Pick<FetchResult, "contentFull" | "originalUrl"> | null> {
  // Try visible URL from screenshot first (if L2 didn't already)
  if (vlm.visibleUrl && !PLATFORM_L2_SUPPORT.includes(vlm.platform)) {
    log.info(
      {
        url: vlm.visibleUrl,
      },
      "L3.a ▶ trying visibleUrl",
    );
    const content = await fetchAndExtract(vlm.visibleUrl).catch((err) => {
      log.warn(
        {
          error: errMsg(err),
        },
        "L3.a ✗ visibleUrl fetch failed",
      );
      return null;
    });
    if (content) {
      return {
        contentFull: content,
        originalUrl: vlm.visibleUrl,
      };
    }
  }

  if (!config.searchEngine.apiKey) {
    log.warn("L3   ⊘ no SEARCH_API_KEY configured, search engine unavailable");
    return null;
  }

  log.info(
    {
      provider: config.searchEngine.provider,
    },
    "L3 ▶ searching via search engine API",
  );
  const url = await searchForUrl(vlm).catch((err) => {
    log.warn(
      {
        error: errMsg(err),
      },
      "L3 ✗ search engine request failed",
    );
    return null;
  });

  if (!url) {
    log.warn("L3 ✗ search engine returned no URL");
    return null;
  }

  log.info(
    {
      url,
    },
    "L3 ▶ fetching content from search engine result",
  );
  const content = await fetchAndExtract(url).catch((err) => {
    log.warn(
      {
        error: errMsg(err),
      },
      "L3 ✗ search result URL fetch failed",
    );
    return null;
  });
  if (!content) {
    return null;
  }

  log.info(
    {
      chars: content.length,
    },
    "L3 ✓ content extracted",
  );
  return {
    contentFull: content,
    originalUrl: url,
  };
}

function buildSearchQuery(vlm: VLMAnalysis): string | null {
  const parts: string[] = [];

  // Extract clean username from author (e.g. "Berryxia.AI (@berryxia)" → "berryxia")
  if (vlm.author) {
    const handleMatch = vlm.author.match(/@(\w+)/);
    parts.push(handleMatch ? handleMatch[1] : vlm.author);
  }

  // Prefer keywords over full title (shorter, less noise)
  if (vlm.keywords.length > 0) {
    parts.push(vlm.keywords.slice(0, 3).join(" "));
  } else if (vlm.title) {
    parts.push(vlm.title.slice(0, 40));
  } else if (vlm.contentSnippet) {
    parts.push(vlm.contentSnippet.slice(0, 80));
  }

  if (parts.length === 0) {
    return null;
  }

  // Remove characters that may confuse CLI arg parsing
  return parts.join(" ").replace(/[()!！？?""''「」【】]/g, "");
}

/**
 * Extract content from opencli detail response.
 * Handles both {field, value}[] format (e.g. xiaohongshu note) and flat object format.
 */
function extractDetailContent(detail: unknown): string | null {
  // Handle {field, value}[] format → convert to flat object first
  let obj: Record<string, unknown>;
  if (
    Array.isArray(detail) &&
    detail.length > 0 &&
    "field" in detail[0] &&
    "value" in detail[0]
  ) {
    obj = {};
    for (const row of detail as {
      field: string;
      value: unknown;
    }[]) {
      obj[row.field] = row.value;
    }
  } else if (Array.isArray(detail)) {
    obj = (detail[0] ?? {}) as Record<string, unknown>;
  } else {
    obj = (detail ?? {}) as Record<string, unknown>;
  }

  const content = (obj.content || obj.text || obj.desc) as string | undefined;
  if (!content || content === "url is invalid") {
    return null;
  }
  return content;
}

function normalizeSearchResults(raw: unknown): OpencliSearchItem[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      return obj.data;
    }
    if (Array.isArray(obj.results)) {
      return obj.results;
    }
    if (Array.isArray(obj.items)) {
      return obj.items;
    }
  }
  return [];
}

function findBestMatch(
  items: OpencliSearchItem[],
  vlm: VLMAnalysis,
): OpencliSearchItem | null {
  if (items.length === 0) {
    return null;
  }

  const refTitle = vlm.title ?? "";
  const refSnippet = vlm.contentSnippet ?? "";
  if (!refTitle && !refSnippet && !vlm.author) {
    return items[0];
  }

  log.debug(
    {
      refTitle: refTitle.slice(0, 80),
      refSnippet: refSnippet.slice(0, 80),
      refAuthor: vlm.author,
    },
    "  match ref",
  );

  let bestItem: OpencliSearchItem | null = null;
  let bestScore = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Compare title and snippet separately, take the better score
    const itemText = item.text || item.content || item.title || "";
    let titleScore = 0;
    let snippetScore = 0;
    if (itemText) {
      if (refTitle) {
        titleScore = textSimilarity(refTitle, itemText);
      }
      if (refSnippet) {
        snippetScore = textSimilarity(refSnippet, itemText);
      }
    }
    const textScore = Math.max(titleScore, snippetScore);

    // Strip trailing date/time from author (e.g. "ByteWatcher2天前", "嘿嘿03-24")
    const cleanAuthor = item.author
      ?.replace(
        /[\d\s]*(?:\d{4}[-/])?\d{1,2}[-/]\d{1,2}.*$|[\d\s]*\d+[天小时分钟秒]+前.*$/,
        "",
      )
      .trim();
    let authorScore = 0;
    if (vlm.author && cleanAuthor) {
      authorScore = textSimilarity(vlm.author, cleanAuthor);
    }

    const score = textScore + authorScore * 0.3;

    log.debug(
      {
        idx: i,
        itemTitle: item.title?.slice(0, 60),
        itemAuthor: item.author,
        cleanAuthor,
        titleScore: titleScore.toFixed(3),
        snippetScore: snippetScore.toFixed(3),
        authorScore: authorScore.toFixed(3),
        total: score.toFixed(3),
      },
      "  match candidate",
    );

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  // Require minimum similarity to avoid matching unrelated content
  if (bestScore < 0.3) {
    log.warn(
      {
        bestScore: bestScore.toFixed(2),
      },
      "  best match score too low, rejecting",
    );
    return null;
  }

  log.debug(
    {
      bestScore: bestScore.toFixed(2),
    },
    "  match score",
  );
  return bestItem;
}

async function tryWithTimeout<T>(
  fn: () => Promise<T | null>,
  ms: number,
): Promise<T | null> {
  try {
    let timer: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      fn(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          log.warn(
            {
              timeoutMs: ms,
            },
            "  ⏱ step timed out",
          );
          resolve(null);
        }, ms);
      }),
    ]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    log.error(
      {
        error: errMsg(err),
      },
      "  ✗ step threw unexpected error",
    );
    return null;
  }
}
