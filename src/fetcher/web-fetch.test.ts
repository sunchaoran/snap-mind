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

import { chromium } from "playwright";
import {
  ensureChromeProfileLoaded,
  findPostUrlOnPlatform,
} from "@/fetcher/web-fetch.js";
import type { VLMResult } from "@/types/domain.js";

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

describe("findPostUrlOnPlatform — page.goto wait condition", () => {
  it("uses domcontentloaded (not networkidle) so JS-heavy social pages don't time out", async () => {
    // Make the profile preflight a no-op: pretend Chrome already has a page.
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

    const gotoSpy = vi.fn().mockResolvedValue(null);
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    // The zhihu extractor calls waitForSelector + $eval; we don't care about
    // the URL it ultimately produces, only that the goto wait condition is
    // right. Letting $eval reject keeps the extractor returning null.
    const fakePage = {
      goto: gotoSpy,
      waitForSelector: vi.fn().mockResolvedValue(null),
      $eval: vi.fn().mockRejectedValue(new Error("no element")),
      close: closeSpy,
    };
    const fakeContext = {
      newPage: vi.fn().mockResolvedValue(fakePage),
    };
    const fakeBrowser = {
      contexts: () => [
        fakeContext,
      ],
    };
    vi.mocked(chromium.connectOverCDP).mockResolvedValue(
      fakeBrowser as unknown as Awaited<
        ReturnType<typeof chromium.connectOverCDP>
      >,
    );

    const result = await findPostUrlOnPlatform({
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
    });

    // Extractor failed → null. That's expected; we're auditing the wait
    // condition, not the extraction.
    expect(result).toBeNull();
    expect(gotoSpy).toHaveBeenCalledTimes(1);
    expect(gotoSpy.mock.calls[0][1]).toMatchObject({
      waitUntil: "domcontentloaded",
    });
    // Page must always be released, even when extractor throws.
    expect(closeSpy).toHaveBeenCalled();
  });
});
