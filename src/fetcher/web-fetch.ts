import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { config } from "@/config.js";
import type { MergedVLMResult, Platform } from "@/types/index.js";
import { createLogger, errMsg } from "@/utils/logger.js";
import { llmClient } from "@/vlm/openrouter.js";

const log = createLogger("web-fetch");

let browser: Browser | null = null;

const CDP_MAX_RETRIES = 3;
const CDP_INITIAL_DELAY_MS = 1000;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) {
    return browser;
  }

  // Reset stale reference
  browser = null;

  for (let attempt = 1; attempt <= CDP_MAX_RETRIES; attempt++) {
    try {
      log.debug(
        {
          cdpUrl: config.playwright.cdpUrl,
          attempt,
        },
        "connecting to Chrome CDP",
      );
      browser = await chromium.connectOverCDP(config.playwright.cdpUrl);

      // Listen for disconnect to auto-clear the reference
      browser.on("disconnected", () => {
        log.warn("Chrome CDP disconnected");
        browser = null;
      });

      log.info("Chrome CDP connected");
      return browser;
    } catch (err) {
      log.warn(
        {
          error: errMsg(err),
          attempt,
          maxRetries: CDP_MAX_RETRIES,
        },
        "CDP connection failed",
      );
      if (attempt < CDP_MAX_RETRIES) {
        const delay = CDP_INITIAL_DELAY_MS * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to connect to Chrome CDP at ${config.playwright.cdpUrl} after ${CDP_MAX_RETRIES} attempts`,
  );
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Already disconnected
    }
    browser = null;
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
  vlm: MergedVLMResult,
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
    await page.goto(searchUrl, {
      waitUntil: "networkidle",
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
  vlm: MergedVLMResult,
) => Promise<string | null>;

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
    return href.startsWith("http") ? href : `https://x.com${href}`;
  },

  zhihu: async (page) => {
    log.debug("waiting for zhihu content link");
    await page
      .waitForSelector('a[href*="/question/"], a[href*="/p/"]', {
        timeout: 8_000,
      })
      .catch(() => null);
    const href = await page
      .$eval('a[href*="/question/"], a[href*="/p/"]', (el) =>
        el.getAttribute("href"),
      )
      .catch(() => null);
    if (!href) {
      return null;
    }
    return href.startsWith("http") ? href : `https://www.zhihu.com${href}`;
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
    return href.startsWith("http") ? href : `https://www.bilibili.com${href}`;
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
    return href.startsWith("http")
      ? href
      : `https://www.xiaohongshu.com${href}`;
  },
};

function buildPlatformSearchUrl(vlm: MergedVLMResult): string | null {
  const author = vlm.author?.replace(/^@/, "");

  switch (vlm.platform) {
    case "twitter": {
      const parts: string[] = [];
      if (author) {
        parts.push(`from:${author}`);
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
      model: config.llm.models.processor,
    },
    "fetchAndExtract ▶ sending HTML to LLM for extraction",
  );

  const response = await llmClient.chat.completions.create({
    model: config.llm.models.processor,
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
