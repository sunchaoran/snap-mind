import { config } from "../config.js";
import type { MergedVLMResult } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("search-engine");

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: "小红书",
  twitter: "Twitter",
  reddit: "Reddit",
  weibo: "微博",
  zhihu: "知乎",
  weixin: "微信公众号",
  bilibili: "Bilibili",
  douban: "豆瓣",
  hackernews: "Hacker News",
  youtube: "YouTube",
  medium: "Medium",
  substack: "Substack",
};

const PLATFORM_SITE_DOMAIN: Record<string, string> = {
  twitter: "x.com OR site:twitter.com",
  xiaohongshu: "xiaohongshu.com",
  zhihu: "zhihu.com",
  bilibili: "bilibili.com",
  weibo: "weibo.com",
  reddit: "reddit.com",
  weixin: "mp.weixin.qq.com",
  douban: "douban.com",
  hackernews: "news.ycombinator.com",
  youtube: "youtube.com",
  medium: "medium.com",
  substack: "substack.com",
};

/** Build a search query from VLM result fields with site: constraint. */
function buildQuery(vlm: MergedVLMResult): string {
  const parts: string[] = [];

  const siteDomain = PLATFORM_SITE_DOMAIN[vlm.platform];
  if (siteDomain) {
    parts.push(`site:${siteDomain}`);
  } else if (vlm.platform !== "unknown") {
    const platformName = PLATFORM_NAMES[vlm.platform] ?? vlm.platform;
    parts.push(platformName);
  }

  if (vlm.author) parts.push(vlm.author);
  if (vlm.title) parts.push(vlm.title);
  else if (vlm.contentSnippet) parts.push(vlm.contentSnippet.slice(0, 80));

  return parts.join(" ");
}

/**
 * L3 fallback: use Google Custom Search API to find the original URL.
 * Returns the best matching URL or null if search is not configured / fails.
 */
export async function searchForUrl(
  vlm: MergedVLMResult,
): Promise<string | null> {
  if (!config.searchEngine.apiKey) {
    log.warn("search engine API key not configured");
    return null;
  }

  const query = buildQuery(vlm);
  if (!query.trim()) {
    log.warn("built an empty search query, skipping");
    return null;
  }

  log.info(
    { provider: config.searchEngine.provider, query },
    "searching for original URL",
  );

  if (config.searchEngine.provider === "google") {
    return googleSearch(query);
  }

  return bingSearch(query);
}

async function googleSearch(query: string): Promise<string | null> {
  if (!config.searchEngine.cx) {
    log.warn("Google CX (Custom Search Engine ID) not configured");
    return null;
  }

  const params = new URLSearchParams({
    key: config.searchEngine.apiKey!,
    cx: config.searchEngine.cx,
    q: query,
    num: "5",
  });

  const resp = await fetch(
    `https://www.googleapis.com/customsearch/v1?${params}`,
  );
  if (!resp.ok) {
    log.warn({ status: resp.status }, "Google search API returned error");
    return null;
  }

  const data = (await resp.json()) as {
    items?: { link: string; title?: string }[];
  };

  const url = data.items?.[0]?.link ?? null;
  if (url) {
    log.info(
      { url, title: data.items?.[0]?.title, totalResults: data.items?.length },
      "Google search found URL",
    );
  } else {
    log.warn("Google search returned no results");
  }
  return url;
}

async function bingSearch(query: string): Promise<string | null> {
  const resp = await fetch(
    `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=5`,
    {
      headers: { "Ocp-Apim-Subscription-Key": config.searchEngine.apiKey! },
    },
  );
  if (!resp.ok) {
    log.warn({ status: resp.status }, "Bing search API returned error");
    return null;
  }

  const data = (await resp.json()) as {
    webPages?: { value?: { url: string; name?: string }[] };
  };

  const url = data.webPages?.value?.[0]?.url ?? null;
  if (url) {
    log.info(
      { url, title: data.webPages?.value?.[0]?.name },
      "Bing search found URL",
    );
  } else {
    log.warn("Bing search returned no results");
  }
  return url;
}
