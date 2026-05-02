import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureChromeProfileLoaded } from "@/fetcher/web-fetch.js";

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
