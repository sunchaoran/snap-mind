import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { config } from "@/config.js";
import { extractAuthorHandle } from "@/fetcher/author.js";
import type { Platform, VLMAnalysis } from "@/types/domain.js";
import { createLogger, errMsg } from "@/utils/logger.js";
import { activeModels, llmClient } from "@/vlm/llm-client.js";

const log = createLogger("web-fetch");

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    log.debug(
      {
        cdpUrl: config.playwright.cdpUrl,
      },
      "connecting to Chrome CDP",
    );
    await ensureChromeProfileLoaded(config.playwright.cdpUrl);
    browser = await chromium.connectOverCDP(config.playwright.cdpUrl);
    log.info("Chrome CDP connected");
  }
  return browser;
}

/**
 * 当 Chrome 没有任何打开的标签页时，`ProfileManager::GetLastUsedProfileIfLoaded()`
 * 返回 null（参见 chromium 源 `devtools_browser_context_manager.cc`）；
 * 进一步导致 `Browser.setDownloadBehavior` 报 "Browser context management is
 * not supported"，而 Playwright 的 `connectOverCDP` 启动时正好会调这个 CDP
 * 方法 — 整个连接就废了。
 *
 * 修法：在 connect 之前用 Chrome 的 HTTP CDP endpoint 先点一下 `/json/list`，
 * 如果一个 page 都没有就 `PUT /json/new?about:blank` 强制 Chrome 加载默认
 * profile。幂等：已经有 page 时直接返回。
 *
 * 触发场景：用户手动关掉了 LaunchAgent Chrome 里所有标签页之后；或者 Chrome
 * 冷启动还没显示任何 tab（罕见但可能）。
 */
export async function ensureChromeProfileLoaded(
  cdpHttpUrl: string,
): Promise<void> {
  try {
    const listRes = await fetch(`${cdpHttpUrl}/json/list`);
    if (!listRes.ok) {
      log.warn(
        {
          status: listRes.status,
        },
        "CDP /json/list returned non-ok, skipping profile preflight",
      );
      return;
    }
    const targets = (await listRes.json()) as Array<{
      type?: string;
    }>;
    const pageCount = targets.filter((t) => t.type === "page").length;
    if (pageCount > 0) {
      return;
    }
    log.info(
      "Chrome has 0 open pages, seeding about:blank to load default profile",
    );
    const newRes = await fetch(`${cdpHttpUrl}/json/new?about:blank`, {
      method: "PUT",
    });
    if (!newRes.ok) {
      log.warn(
        {
          status: newRes.status,
        },
        "CDP /json/new failed, connectOverCDP will likely fail too",
      );
    }
  } catch (err) {
    log.warn(
      {
        error: errMsg(err),
      },
      "ensureChromeProfileLoaded failed, proceeding to connectOverCDP anyway",
    );
  }
}

async function openPage(): Promise<Page> {
  const b = await getBrowser();
  const context = b.contexts()[0] ?? (await b.newContext());
  return context.newPage();
}

/** Fetch raw HTML from a URL using Playwright with Chrome login sessions. */
export async function fetchPageHtml(url: string): Promise<string> {
  log.debug(
    {
      url,
    },
    "fetching page HTML via Playwright",
  );
  const page = await openPage();

  try {
    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 20_000,
    });
    const html = await page.content();
    log.debug(
      {
        url,
        htmlLength: html.length,
      },
      "page HTML fetched",
    );
    return html;
  } finally {
    await page.close();
  }
}

/**
 * Search on the platform's own website using Playwright, find the post URL.
 * Uses the Chrome CDP session (potentially logged in) for platforms that
 * require authentication (e.g. X/Twitter).
 */
export async function findPostUrlOnPlatform(
  vlm: VLMAnalysis,
): Promise<string | null> {
  const searchUrl = buildPlatformSearchUrl(vlm);
  if (!searchUrl) {
    log.debug(
      {
        platform: vlm.platform,
      },
      "no platform search URL could be built",
    );
    return null;
  }

  log.info(
    {
      platform: vlm.platform,
      searchUrl,
    },
    "opening platform search page",
  );
  const page = await openPage();

  try {
    // `networkidle` rarely fires on JS-heavy social platforms (constant
    // background polling means the network is never quiet for 500ms),
    // making this a near-guaranteed timeout. The downstream extractor uses
    // its own `waitForSelector(...)` to wait for the post link, so we just
    // need the DOM to be parsed here, not the network to be idle.
    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    log.debug("platform search page loaded");

    const extractor = POST_URL_EXTRACTORS[vlm.platform];
    if (!extractor) {
      log.debug(
        {
          platform: vlm.platform,
        },
        "no post URL extractor for this platform",
      );
      return null;
    }

    const url = await extractor(page, vlm);
    if (url) {
      log.info(
        {
          postUrl: url,
        },
        "post URL extracted from platform search",
      );
    } else {
      log.warn(
        {
          platform: vlm.platform,
        },
        "no post URL found in search results",
      );
    }
    return url;
  } catch (err) {
    log.warn(
      {
        error: errMsg(err),
        searchUrl,
      },
      "platform search page failed to load",
    );
    return null;
  } finally {
    await page.close();
  }
}

type PostUrlExtractor = (
  page: Page,
  vlm: VLMAnalysis,
) => Promise<string | null>;

/**
 * Resolve an `href` attribute against a base origin, handling all the forms
 * search-results pages emit:
 *   - absolute:           "https://example.com/x"     → unchanged
 *   - protocol-relative:  "//zhuanlan.zhihu.com/p/1"  → "https://zhuanlan.zhihu.com/p/1"
 *   - root-relative:      "/question/123"             → "https://www.zhihu.com/question/123"
 *
 * The earlier `startsWith("http") ? href : base + href` shortcut produced
 * `https://www.zhihu.com//zhuanlan.zhihu.com/...` for protocol-relative
 * hrefs (zhihu's column links are emitted as `//zhuanlan.zhihu.com/...`),
 * which then 404'd or redirected to a login wall.
 */
export function resolveUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}

const POST_URL_EXTRACTORS: Partial<Record<Platform, PostUrlExtractor>> = {
  twitter: async (page) => {
    log.debug('waiting for tweet link (a[href*="/status/"])');
    await page
      .waitForSelector('a[href*="/status/"]', {
        timeout: 8_000,
      })
      .catch(() => null);
    const href = await page
      .$eval('a[href*="/status/"]', (el) => el.getAttribute("href"))
      .catch(() => null);
    if (!href) {
      return null;
    }
    return resolveUrl(href, "https://x.com");
  },

  zhihu: async (page) => {
    log.debug("waiting for zhihu content link");
    // Wait for either selector to appear, then prefer /question/ over /p/.
    // /question/ is the canonical Q&A page (what most zhihu screenshots
    // are); /p/ is a zhuanlan column article — usually a less-relevant
    // keyword match when both surface for the same query, and zhuanlan
    // pages frequently land on a partial-content paywall when fetched
    // headlessly.
    await page
      .waitForSelector('a[href*="/question/"], a[href*="/p/"]', {
        timeout: 8_000,
      })
      .catch(() => null);
    const questionHref = await page
      .$eval('a[href*="/question/"]', (el) => el.getAttribute("href"))
      .catch(() => null);
    const href =
      questionHref ??
      (await page
        .$eval('a[href*="/p/"]', (el) => el.getAttribute("href"))
        .catch(() => null));
    if (!href) {
      return null;
    }
    return resolveUrl(href, "https://www.zhihu.com");
  },

  bilibili: async (page) => {
    log.debug("waiting for bilibili video link");
    await page
      .waitForSelector('a[href*="/video/"]', {
        timeout: 8_000,
      })
      .catch(() => null);
    const href = await page
      .$eval('a[href*="/video/"]', (el) => el.getAttribute("href"))
      .catch(() => null);
    if (!href) {
      return null;
    }
    return resolveUrl(href, "https://www.bilibili.com");
  },

  xiaohongshu: async (page) => {
    log.debug("waiting for xiaohongshu note link");
    await page
      .waitForSelector('a[href*="/explore/"], a[href*="/discovery/item/"]', {
        timeout: 8_000,
      })
      .catch(() => null);
    const href = await page
      .$eval('a[href*="/explore/"], a[href*="/discovery/item/"]', (el) =>
        el.getAttribute("href"),
      )
      .catch(() => null);
    if (!href) {
      return null;
    }
    return resolveUrl(href, "https://www.xiaohongshu.com");
  },
};

function buildPlatformSearchUrl(vlm: VLMAnalysis): string | null {
  // Twitter's `from:` operator wants the bare handle; without this normalization
  // an author like "Ding @dingyi" produced `from:Ding @dingyi`, which Twitter
  // parses as "from user `Ding`" + literal text, matching nothing.
  const handle = extractAuthorHandle(vlm.author);

  switch (vlm.platform) {
    case "twitter": {
      const parts: string[] = [];
      if (handle) {
        parts.push(`from:${handle}`);
      }
      const text = vlm.contentSnippet?.slice(0, 60) ?? vlm.title;
      if (text) {
        parts.push(text);
      }
      if (parts.length === 0 && vlm.keywords.length > 0) {
        parts.push(vlm.keywords.join(" "));
      }
      if (parts.length === 0) {
        return null;
      }
      return `https://x.com/search?q=${encodeURIComponent(parts.join(" "))}&f=top`;
    }
    case "zhihu": {
      const q = vlm.title ?? vlm.contentSnippet?.slice(0, 80);
      if (!q) {
        return null;
      }
      return `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`;
    }
    case "bilibili": {
      const q = vlm.title ?? vlm.contentSnippet?.slice(0, 80);
      if (!q) {
        return null;
      }
      return `https://search.bilibili.com/all?keyword=${encodeURIComponent(q)}`;
    }
    case "xiaohongshu": {
      const q =
        vlm.title ?? vlm.contentSnippet?.slice(0, 80) ?? vlm.keywords.join(" ");
      if (!q) {
        return null;
      }
      return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}`;
    }
    default:
      return null;
  }
}

/**
 * Fetch a URL and extract the main article content as markdown using LLM.
 * Returns null if extraction fails.
 */
export async function fetchAndExtract(url: string): Promise<string | null> {
  log.info(
    {
      url,
    },
    "fetchAndExtract ▶ loading page",
  );
  const html = await fetchPageHtml(url);

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .slice(0, 60_000);

  log.debug(
    {
      cleanedLength: cleaned.length,
      model: activeModels.processor,
    },
    "fetchAndExtract ▶ sending HTML to LLM for extraction",
  );

  const response = await llmClient.chat.completions.create({
    model: activeModels.processor,
    messages: [
      {
        role: "system",
        content:
          "你是一个网页正文提取工具。从给定的 HTML 中提取文章正文内容，转换为干净的 Markdown 格式。只返回正文内容，不要包含导航、广告、页脚等无关内容。如果无法识别正文，返回空字符串。",
      },
      {
        role: "user",
        content: cleaned,
      },
    ],
    temperature: 0,
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "";
  if (text) {
    log.info(
      {
        url,
        chars: text.length,
      },
      "fetchAndExtract ✓ content extracted",
    );
  } else {
    log.warn(
      {
        url,
      },
      "fetchAndExtract ✗ LLM returned empty content",
    );
  }
  return text || null;
}
