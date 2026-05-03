import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/fetcher/opencli.js", () => ({
  runOpencli: vi.fn(),
}));

vi.mock("@/fetcher/web-fetch.js", () => ({
  fetchAndExtract: vi.fn(),
  findPostUrlOnPlatform: vi.fn(),
  fetchPageHtml: vi.fn(),
  ensureChromeProfileLoaded: vi.fn(),
}));

vi.mock("@/fetcher/search-engine.js", () => ({
  searchForUrl: vi.fn(),
}));

import { fetchContent } from "@/fetcher/index.js";
import { runOpencli } from "@/fetcher/opencli.js";
import { searchForUrl } from "@/fetcher/search-engine.js";
import { fetchAndExtract, findPostUrlOnPlatform } from "@/fetcher/web-fetch.js";
import type { VLMAnalysis, VLMResult } from "@/types/domain.js";

const runOpencliMock = vi.mocked(runOpencli);
const fetchAndExtractMock = vi.mocked(fetchAndExtract);
const findPostUrlOnPlatformMock = vi.mocked(findPostUrlOnPlatform);
const searchForUrlMock = vi.mocked(searchForUrl);

function makeVlm(overrides: Partial<VLMAnalysis> = {}): VLMAnalysis {
  // Zhihu has no PLATFORM_USER_STRATEGY → tryLevel1 skips L1.a and goes
  // straight to L1.b (keyword search). That's exactly the path we want to
  // exercise — the URL fall-through lives there.
  const base: VLMAnalysis = {
    platform: "zhihu",
    contentType: "post",
    author: "韦易笑",
    title: "为什么AI提效，我感觉更累了？",
    keywords: [
      "AI",
      "提效",
    ],
    publishTime: null,
    visibleUrl: null,
    contentSnippet: "我的公司在11个月前推出了人工智能工具",
    confidence: 0.9,
    rawResult: {} as VLMResult,
  };
  return {
    ...base,
    ...overrides,
  };
}

beforeEach(() => {
  // Reasonable defaults: every downstream call returns null unless a test
  // overrides it, so unrelated levels don't accidentally short-circuit a
  // case under test.
  fetchAndExtractMock.mockResolvedValue(null);
  findPostUrlOnPlatformMock.mockResolvedValue(null);
  searchForUrlMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchContent — L1.b URL fall-through", () => {
  it("falls through to fetchAndExtract when match has URL but no body (zhihu question case)", async () => {
    // Mirrors what opencli's `zhihu search` actually returns in production:
    // the question stub (title + asker) with a URL, but no answer text.
    runOpencliMock.mockResolvedValueOnce([
      {
        title: "为什么AI提效，我感觉更累了？",
        author: "halo",
        url: "https://www.zhihu.com/question/12345",
      },
    ]);
    fetchAndExtractMock.mockResolvedValueOnce(
      "full body extracted from the question page",
    );

    const result = await fetchContent(makeVlm());

    expect(result).toEqual({
      contentFull: "full body extracted from the question page",
      originalUrl: "https://www.zhihu.com/question/12345",
      fetchLevel: 1,
    });
    expect(fetchAndExtractMock).toHaveBeenCalledTimes(1);
    expect(fetchAndExtractMock).toHaveBeenCalledWith(
      "https://www.zhihu.com/question/12345",
    );
    // L2 and L3 must not have been touched once L1 succeeded.
    expect(findPostUrlOnPlatformMock).not.toHaveBeenCalled();
    expect(searchForUrlMock).not.toHaveBeenCalled();
  });

  it("uses inline content when present (text/content fields), skips fetchAndExtract", async () => {
    // Realistic shape: opencli platforms that DO return full bodies (e.g.
    // xiaohongshu detail) put the post body in `text` containing the
    // original title — that's what gives findBestMatch its title-overlap
    // signal in production. A no-overlap stub like "lorem ipsum" would
    // get rejected by the score>=0.3 floor for unrelated reasons.
    const inlineBody =
      "为什么AI提效，我感觉更累了？我的公司在11个月前推出了人工智能工具，从那以后，我做的每件事都花了更长的时间。";
    runOpencliMock.mockResolvedValueOnce([
      {
        title: "为什么AI提效，我感觉更累了？",
        author: "halo",
        url: "https://www.zhihu.com/question/12345",
        text: inlineBody,
      },
    ]);

    const result = await fetchContent(makeVlm());

    expect(result).toEqual({
      contentFull: inlineBody,
      originalUrl: "https://www.zhihu.com/question/12345",
      fetchLevel: 1,
    });
    // The whole point of inline content is we don't pay for an extra page
    // fetch — assert we didn't.
    expect(fetchAndExtractMock).not.toHaveBeenCalled();
  });

  it("falls through to higher levels when match has neither URL nor body", async () => {
    runOpencliMock.mockResolvedValueOnce([
      {
        title: "为什么AI提效，我感觉更累了？",
        author: "halo",
        // no url, no text/content — L1.b has nothing to recover from
      },
    ]);

    const result = await fetchContent(makeVlm());

    expect(result.fetchLevel).toBe(4);
    // No URL meant nothing to hand to fetchAndExtract on the L1 path.
    // L2.a is also skipped (no visibleUrl in the VLM fixture). The only
    // fetchAndExtract calls would be from L2.b (after a postUrl) — but our
    // findPostUrlOnPlatform mock returns null, so that's also skipped.
    expect(fetchAndExtractMock).not.toHaveBeenCalled();
  });

  it("falls through to higher levels when fetchAndExtract returns null on the URL", async () => {
    runOpencliMock.mockResolvedValueOnce([
      {
        title: "为什么AI提效，我感觉更累了？",
        url: "https://www.zhihu.com/question/12345",
        // no text/content — triggers URL fall-through
      },
    ]);
    // L1.b URL fall-through: fetchAndExtract is reachable but yields nothing
    fetchAndExtractMock.mockResolvedValueOnce(null);

    const result = await fetchContent(makeVlm());

    expect(result.fetchLevel).toBe(4);
    // Verify the L1.b fall-through actually fired (and only once — L2.a is
    // skipped because no visibleUrl, L2.b's postUrl is null so its
    // fetchAndExtract call doesn't happen either).
    expect(fetchAndExtractMock).toHaveBeenCalledTimes(1);
    expect(fetchAndExtractMock).toHaveBeenCalledWith(
      "https://www.zhihu.com/question/12345",
    );
  });
});
