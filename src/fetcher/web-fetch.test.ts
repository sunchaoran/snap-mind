import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Playwright before importing web-fetch so the module-level browser
// caching in `getBrowser()` is wired against the fake `connectOverCDP`,
// not the real chromium binary. Tests that don't touch Playwright
// (`ensureChromeProfileLoaded` suite below) are unaffected — they only
// hit `globalThis.fetch`.
vi.mock("playwright", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

import { ensureChromeProfileLoaded, resolveUrl } from "@/fetcher/web-fetch.js";
import type { VLMAnalysis, VLMResult } from "@/types/domain.js";

// Stash the real fetch so we can restore between tests; vitest's vi.spyOn
// works fine, but we want clean per-test setup of distinct request sequences.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("ensureChromeProfileLoaded", () => {
  it("seeds about:blank when /json/list reports zero pages", async () => {
    const calls: Array<{
      url: string;
      init?: RequestInit;
    }> = [];
    (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        init,
      });
      if (url.endsWith("/json/list")) {
        return new Response(JSON.stringify([]), {
          status: 200,
        });
      }
      if (url.endsWith("/json/new?about:blank")) {
        return new Response(JSON.stringify({}), {
          status: 200,
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await ensureChromeProfileLoaded("http://localhost:9222");

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://localhost:9222/json/list");
    expect(calls[1].url).toBe("http://localhost:9222/json/new?about:blank");
    expect(calls[1].init?.method).toBe("PUT");
  });

  it("does NOT seed when /json/list already has at least one page", async () => {
    const calls: string[] = [];
    (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/json/list")) {
        return new Response(
          JSON.stringify([
            {
              type: "page",
              url: "https://example.com",
            },
          ]),
          {
            status: 200,
          },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await ensureChromeProfileLoaded("http://localhost:9222");

    expect(calls).toEqual([
      "http://localhost:9222/json/list",
    ]);
  });

  it("ignores non-page targets when counting (workers, service_worker, etc.)", async () => {
    // /json/list returns workers/service_workers/iframes too — they don't
    // count as "pages". If only those exist, we still need to seed.
    const calls: string[] = [];
    (
      globalThis.fetch as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/json/list")) {
        return new Response(
          JSON.stringify([
            {
              type: "service_worker",
            },
            {
              type: "background_page",
            },
          ]),
          {
            status: 200,
          },
        );
      }
      if (url.endsWith("/json/new?about:blank")) {
        return new Response(JSON.stringify({}), {
          status: 200,
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await ensureChromeProfileLoaded("http://localhost:9222");

    expect(calls).toEqual([
      "http://localhost:9222/json/list",
      "http://localhost:9222/json/new?about:blank",
    ]);
  });

  it("swallows /json/list non-ok responses without throwing", async () => {
    // Profile preflight failing must not block connectOverCDP — we'd rather
    // surface the real Playwright error than mask it with a synthetic one.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("oops", {
        status: 500,
      }),
    );

    await expect(
      ensureChromeProfileLoaded("http://localhost:9222"),
    ).resolves.toBeUndefined();
  });

  it("swallows network failures from /json/list", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );

    await expect(
      ensureChromeProfileLoaded("http://localhost:9222"),
    ).resolves.toBeUndefined();
  });
});

describe("resolveUrl", () => {
  it.each([
    [
      "absolute http URL",
      "https://example.com/x?y=1",
      "https://www.zhihu.com",
      "https://example.com/x?y=1",
    ],
    [
      "protocol-relative href (the bug that produced double slashes)",
      "//zhuanlan.zhihu.com/p/2030788302954051562",
      "https://www.zhihu.com",
      "https://zhuanlan.zhihu.com/p/2030788302954051562",
    ],
    [
      "root-relative href",
      "/question/123/answer/456",
      "https://www.zhihu.com",
      "https://www.zhihu.com/question/123/answer/456",
    ],
    [
      "twitter relative status path",
      "/user/status/789",
      "https://x.com",
      "https://x.com/user/status/789",
    ],
  ])("%s", (_label, href, base, expected) => {
    const out = resolveUrl(href, base);
    expect(out).toBe(expected);
    // Belt-and-braces: the original bug manifested as `//` in the path;
    // pin that it never reappears in any case.
    expect(out).not.toMatch(/^https:\/\/[^/]+\/\//);
  });
});

describe("findPostUrlOnPlatform — zhihu extractor", () => {
  // Re-import web-fetch fresh per test so the module-level `browser` cache
  // (set the first time `connectOverCDP` is called) doesn't leak between
  // tests and starve later mocks.
  async function importFresh() {
    vi.resetModules();
    const playwright = await import("playwright");
    const wf = await import("@/fetcher/web-fetch.js");
    return {
      findPostUrlOnPlatform: wf.findPostUrlOnPlatform,
      chromium: playwright.chromium,
    };
  }

  function makeZhihuVlm(): VLMAnalysis {
    return {
      platform: "zhihu",
      contentType: "post",
      author: "韦易笑",
      title: "为什么AI提效，我感觉更累了？",
      keywords: [],
      publishTime: null,
      visibleUrl: null,
      contentSnippet: null,
      confidence: 0.9,
      rawResult: {} as VLMResult,
    };
  }

  /**
   * Wires up a fake Playwright browser whose Page returns hrefs based on
   * the selector argument passed to `$eval`. Returns the goto / close
   * spies for assertion. The href map keys are substrings the test cares
   * about (e.g. "/question/", "/p/"); the extractor's actual selectors
   * include those substrings.
   */
  function setupFakeBrowser(
    // The runtime value is a vi.fn() (see the top-level vi.mock("playwright")),
    // but the static type of the playwright export is BrowserType<{}>. Bridge
    // the two via vi.mocked() inside the body and accept it loosely here.
    chromium: typeof import("playwright").chromium,
    hrefBySelector: Record<string, string | null>,
  ) {
    const gotoSpy = vi.fn().mockResolvedValue(null);
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    const evalSpy = vi
      .fn()
      .mockImplementation(async (selector: string): Promise<string> => {
        for (const [key, href] of Object.entries(hrefBySelector)) {
          if (selector.includes(key) && href !== null) {
            return href;
          }
        }
        // $eval throws when no element matches — that's how the extractor
        // detects "no link of this kind on the page".
        throw new Error(`no element matching ${selector}`);
      });
    const fakePage = {
      goto: gotoSpy,
      waitForSelector: vi.fn().mockResolvedValue(null),
      $eval: evalSpy,
      close: closeSpy,
    };
    const fakeBrowser = {
      contexts: () => [
        {
          newPage: vi.fn().mockResolvedValue(fakePage),
        },
      ],
    };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(
      fakeBrowser as unknown as Awaited<
        ReturnType<typeof chromium.connectOverCDP>
      >,
    );
    return {
      gotoSpy,
      closeSpy,
      evalSpy,
    };
  }

  beforeEach(() => {
    // Profile preflight: pretend Chrome already has a page open so we
    // skip the about:blank seeding round-trip.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            type: "page",
          },
        ]),
        {
          status: 200,
        },
      ),
    );
  });

  it("uses domcontentloaded (not networkidle) so JS-heavy social pages don't time out", async () => {
    const { findPostUrlOnPlatform, chromium } = await importFresh();
    const { gotoSpy, closeSpy } = setupFakeBrowser(chromium, {});

    const result = await findPostUrlOnPlatform(makeZhihuVlm());

    // Extractor finds nothing (no hrefs configured) → null. Fine; we're
    // auditing the wait condition, not the extraction outcome.
    expect(result).toBeNull();
    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy.mock.calls[0][1]).toMatchObject({
      waitUntil: "domcontentloaded",
    });
    // Page must always be released, even when extractor returns null.
    expect(closeSpy).toHaveBeenCalled();
  });

  it("collapses protocol-relative hrefs into clean absolute URLs (no zhihu.com//... double slash)", async () => {
    // Mirrors what zhihu's search page actually emits for column links —
    // this is the exact href that produced the production bug.
    const { findPostUrlOnPlatform, chromium } = await importFresh();
    setupFakeBrowser(chromium, {
      "/question/": null, // no Q&A link in this fixture
      "/p/": "//zhuanlan.zhihu.com/p/2030788302954051562",
    });

    const result = await findPostUrlOnPlatform(makeZhihuVlm());

    expect(result).toBe("https://zhuanlan.zhihu.com/p/2030788302954051562");
    expect(result).not.toMatch(/zhihu\.com\/\//);
  });

  it("prefers /question/ over /p/ when both are present in the search results", async () => {
    // For Q&A screenshots (the common case), the question page is the
    // canonical target — column articles are usually less-relevant
    // keyword matches that also tend to land on a partial-content wall.
    const { findPostUrlOnPlatform, chromium } = await importFresh();
    const { evalSpy } = setupFakeBrowser(chromium, {
      "/question/": "/question/12345/answer/67890",
      "/p/": "//zhuanlan.zhihu.com/p/2030788302954051562",
    });

    const result = await findPostUrlOnPlatform(makeZhihuVlm());

    expect(result).toBe("https://www.zhihu.com/question/12345/answer/67890");
    // The /p/ selector must NOT have been queried once /question/ matched
    // — otherwise we'd be paying extra Playwright RTTs on every search.
    const queriedSelectors = evalSpy.mock.calls.map((c) => c[0] as string);
    expect(queriedSelectors).toContain('a[href*="/question/"]');
    expect(queriedSelectors).not.toContain('a[href*="/p/"]');
  });
});
