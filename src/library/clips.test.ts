import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "@/config.js";
import { isSafeClipId } from "@/library/clips.js";
import authPlugin from "@/server/plugins/auth.js";
import errorHandlerPlugin from "@/server/plugins/error-handler.js";
import sharedSchemasPlugin from "@/server/plugins/shared-schemas.js";
import { registerRoutes } from "@/server/routes/index.js";
import type { ClipRecord } from "@/types/domain.js";
import type { ClipRecordWire, ClipRecordWireFull } from "@/types/wire.js";
import { clearSnapMindVault } from "@/writer/markdown.js";

const VALID_AUTH = {
  authorization: "Bearer test-key",
};
const INVALID_AUTH = {
  authorization: "Bearer wrong-token",
};

let app: FastifyInstance;
let vaultRoot: string;
let originalBasePath: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "snap-mind-clips-test-"));
  originalBasePath = config.vault.basePath;
  // Routes/library read `config.vault.basePath` at call-time, so swapping
  // the singleton here gives each test an isolated vault. We restore in
  // afterEach so we don't leak state into other test files.
  setBasePath(vaultRoot);

  // clearSnapMindVault() also resets the writer's in-memory dedup index,
  // which is what we actually need between tests; the on-disk wipe is a
  // no-op since vaultRoot is a fresh tmpdir.
  await clearSnapMindVault();
  await mkdir(join(vaultRoot, config.vault.assetsDir), {
    recursive: true,
  });

  app = Fastify({
    logger: false,
  });
  // error-handler must register first so any throw — including auth —
  // flows through the unified envelope. shared-schemas must precede
  // registerRoutes so route response schemas (`$ref: "ErrorEnvelope#"`)
  // can resolve. Same order as src/index.ts.
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(sharedSchemasPlugin);
  await registerRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(vaultRoot, {
    recursive: true,
    force: true,
  });
  setBasePath(originalBasePath);
});

describe("GET /clip", () => {
  it("returns all clips, skips _index.md, sorts by createdAt desc", async () => {
    await writeIndexPage();
    await writeClipMarkdown("2026-04-26_tw_alpha.md", {
      id: "clip_alpha",
      title: "Alpha",
      createdAt: "2026-04-26T08:00:00.000Z",
    });
    await writeClipMarkdown("2026-04-26_tw_beta.md", {
      id: "clip_beta",
      title: "Beta",
      createdAt: "2026-04-26T10:00:00.000Z",
    });
    await writeClipMarkdown("2026-04-26_tw_gamma.md", {
      id: "clip_gamma",
      title: "Gamma",
      createdAt: "2026-04-26T09:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      clips: ClipRecordWire[];
    };
    expect(body.clips.map((c) => c.id)).toEqual([
      "clip_beta",
      "clip_gamma",
      "clip_alpha",
    ]);
    // _index.md must not appear as a clip
    for (const clip of body.clips) {
      expect(clip.id).not.toBe("_index");
    }
  });

  it("dedupes by id, keeping the earliest createdAt", async () => {
    // Same id in two files: typical "original vs -N collision" scenario.
    // Earlier createdAt wins; suffix-having `dup-2.md` carries the later
    // timestamp because that's how the writer would have produced it.
    await writeClipMarkdown("2026-04-26_tw_dup.md", {
      id: "clip_dup",
      title: "Original",
      createdAt: "2026-04-26T08:00:00.000Z",
    });
    await writeClipMarkdown("2026-04-26_tw_dup-2.md", {
      id: "clip_dup",
      title: "Later Copy",
      createdAt: "2026-04-26T09:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip",
      headers: VALID_AUTH,
    });

    const body = res.json() as {
      clips: ClipRecordWire[];
    };
    const dupClips = body.clips.filter((c) => c.id === "clip_dup");
    expect(dupClips).toHaveLength(1);
    expect(dupClips[0].title).toBe("Original");
  });

  it("dedupe tie-break prefers bare filename over -N suffixed", async () => {
    // Same id, same createdAt: `foo.md` should beat `foo-2.md` because
    // alphabetically-later filename wins (`.` > `-`).
    await writeClipMarkdown("2026-04-26_tw_tie.md", {
      id: "clip_tie",
      title: "Bare",
      createdAt: "2026-04-26T08:00:00.000Z",
    });
    await writeClipMarkdown("2026-04-26_tw_tie-2.md", {
      id: "clip_tie",
      title: "Suffixed",
      createdAt: "2026-04-26T08:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip",
      headers: VALID_AUTH,
    });

    const body = res.json() as {
      clips: ClipRecordWire[];
    };
    const dupClips = body.clips.filter((c) => c.id === "clip_tie");
    expect(dupClips).toHaveLength(1);
    expect(dupClips[0].title).toBe("Bare");
  });

  it("skips malformed files without failing the whole list", async () => {
    await writeClipMarkdown("2026-04-26_tw_good.md", {
      id: "clip_good",
      title: "Good",
    });
    // Malformed: invalid YAML in frontmatter
    await writeFile(
      join(vaultRoot, config.vault.clippingsDir, "2026-04-26_tw_bad.md"),
      "---\nid: clip_bad\ntitle: : : not yaml\n---\n",
      "utf-8",
    );
    // Malformed: missing required fields
    await writeFile(
      join(vaultRoot, config.vault.clippingsDir, "2026-04-26_tw_thin.md"),
      "---\nid: clip_thin\n---\n",
      "utf-8",
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      clips: ClipRecordWire[];
    };
    expect(body.clips.map((c) => c.id)).toEqual([
      "clip_good",
    ]);
  });

  it("preserves wire format fields and strips contentFull from list", async () => {
    // contentFull IS in the markdown body — proves the list endpoint
    // actively projects it away rather than just "happens to skip it".
    await writeClipMarkdown("2026-04-26_tw_full.md", {
      id: "clip_full_test",
      title: 'Title with "quotes" and 中文',
      author: "tester",
      originalUrl: "https://example.com/post/1",
      tags: [
        "a",
        "b",
      ],
      contentSummary: "Just a summary.",
      contentFull: "Full original article body that should be stripped.",
      createdAt: "2026-04-26T12:34:56.789Z",
      sourceConfidence: 0.87,
      fetchLevel: 2,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip",
      headers: VALID_AUTH,
    });

    const body = res.json() as {
      clips: ClipRecordWire[];
    };
    expect(body.clips[0]).toEqual({
      id: "clip_full_test",
      title: 'Title with "quotes" and 中文',
      // Legacy fixture lacks aiTitle / originalTitle in frontmatter →
      // aiTitle is null; originalTitle falls back to the legacy title.
      aiTitle: null,
      originalTitle: 'Title with "quotes" and 中文',
      platform: "twitter",
      author: "tester",
      originalUrl: "https://example.com/post/1",
      contentType: "post",
      contentSummary: "Just a summary.",
      tags: [
        "a",
        "b",
      ],
      category: "tech",
      language: "en",
      screenshotPath: "snap-mind/assets/clip_full_test.webp",
      fetchLevel: 2,
      sourceConfidence: 0.87,
      createdAt: "2026-04-26T12:34:56.789Z",
    });
    // Must not leak internal/heavy fields
    expect(body.clips[0]).not.toHaveProperty("contentFull");
    expect(body.clips[0]).not.toHaveProperty("rawVlmResult");
  });

  it("surfaces aiTitle + originalTitle from frontmatter for new clips", async () => {
    // Hand-rolled fixture writes both new fields, simulating what the writer
    // template emits today. The legacy fallback path is covered by the
    // "preserves wire format fields" test above (which omits both fields).
    const dir = join(vaultRoot, config.vault.clippingsDir);
    await mkdir(dir, {
      recursive: true,
    });
    const frontmatter = [
      "---",
      "id: clip_new_titles",
      'title: "AI 重写后的客观标题"',
      'aiTitle: "AI 重写后的客观标题"',
      'originalTitle: "震惊！这个新闻你绝对没看过！"',
      "platform: twitter",
      'author: "tester"',
      "originalUrl: null",
      "contentType: post",
      "tags:",
      '  - "test"',
      "category: tech",
      "language: zh",
      "fetchLevel: 1",
      "sourceConfidence: 0.95",
      "createdAt: 2026-04-26T12:00:00.000Z",
      "---",
      "",
      "## 摘要",
      "",
      "summary",
      "",
    ].join("\n");
    await writeFile(join(dir, "2026-04-26_tw_titles.md"), frontmatter, "utf-8");

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_new_titles",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ClipRecordWireFull;
    expect(body.title).toBe("AI 重写后的客观标题");
    expect(body.aiTitle).toBe("AI 重写后的客观标题");
    expect(body.originalTitle).toBe("震惊！这个新闻你绝对没看过！");
  });

  it("falls back to <assetsDir>/<id>.webp when body has no embed", async () => {
    await writeClipMarkdown(
      "2026-04-26_tw_noembed.md",
      {
        id: "clip_noembed",
      },
      "## 摘要\n\nSummary only, no screenshot embed.\n",
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_noembed",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ClipRecordWireFull;
    expect(body.screenshotPath).toBe("snap-mind/assets/clip_noembed.webp");
  });
});

describe("GET /clip/:id (detail with contentFull)", () => {
  it("returns the single clip object (not wrapped) with contentFull included", async () => {
    await writeClipMarkdown("2026-04-26_tw_one.md", {
      id: "clip_one",
      title: "One",
      contentFull: "First paragraph.\n\nSecond paragraph.",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_one",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ClipRecordWireFull;
    expect(body.id).toBe("clip_one");
    expect(body.title).toBe("One");
    expect(body.contentFull).toBe("First paragraph.\n\nSecond paragraph.");
    expect(body).not.toHaveProperty("clips");
    expect(body).not.toHaveProperty("rawVlmResult");
  });

  it("returns contentFull = null when ## 原文 section is absent", async () => {
    // Default fixture body skips the `## 原文` heading entirely
    await writeClipMarkdown("2026-04-26_tw_noorig.md", {
      id: "clip_no_orig",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_no_orig",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ClipRecordWireFull;
    expect(body.contentFull).toBeNull();
  });

  it("preserves the fetchLevel=4 warning + snippet markdown verbatim", async () => {
    // What the writer template produces for failed-fetch records
    const failedBody = [
      "## 摘要",
      "",
      "短摘要",
      "",
      "## 原文",
      "",
      "> ⚠️ 未能获取原文。以下为截图中识别到的内容片段：",
      "",
      "VLM-recognized snippet text",
      "",
      "## 截图",
      "",
      "![[assets/clip_failed.webp|360]]",
      "",
    ].join("\n");
    await writeClipMarkdown(
      "2026-04-26_tw_fail.md",
      {
        id: "clip_failed",
        fetchLevel: 4,
        sourceConfidence: 0,
      },
      failedBody,
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_failed",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as ClipRecordWireFull;
    expect(body.contentFull).toBe(
      [
        "> ⚠️ 未能获取原文。以下为截图中识别到的内容片段：",
        "",
        "VLM-recognized snippet text",
      ].join("\n"),
    );
  });

  it("returns 404 when id does not exist", async () => {
    await writeClipMarkdown("2026-04-26_tw_x.md", {
      id: "clip_x",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_missing",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "clip_not_found",
        message: "Clip not found",
      },
    });
  });
});

describe("DELETE /clip/:id", () => {
  it("removes the .md file and all matching assets, returns 204", async () => {
    await writeClipMarkdown("2026-04-26_tw_del.md", {
      id: "clip_del",
    });
    // Drop a few asset files: screenshot, sidecar JSON, and a stray ext
    await writeFile(
      join(vaultRoot, config.vault.assetsDir, "clip_del.webp"),
      "fake png",
      "utf-8",
    );
    await writeFile(
      join(vaultRoot, config.vault.assetsDir, "clip_del.json"),
      "{}",
      "utf-8",
    );
    await writeFile(
      join(vaultRoot, config.vault.assetsDir, "clip_del.png"),
      "fake png",
      "utf-8",
    );
    // A neighboring asset that must NOT be deleted
    await writeFile(
      join(vaultRoot, config.vault.assetsDir, "clip_other.webp"),
      "keep me",
      "utf-8",
    );

    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/clip/clip_del",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    // .md should be gone
    const list = await app.inject({
      method: "GET",
      url: "/api/v1/clip",
      headers: VALID_AUTH,
    });
    const clips = (
      list.json() as {
        clips: ClipRecordWire[];
      }
    ).clips;
    expect(clips.find((c) => c.id === "clip_del")).toBeUndefined();

    // Asset files should be gone
    await expectFileMissing(
      join(vaultRoot, config.vault.assetsDir, "clip_del.webp"),
    );
    await expectFileMissing(
      join(vaultRoot, config.vault.assetsDir, "clip_del.json"),
    );
    await expectFileMissing(
      join(vaultRoot, config.vault.assetsDir, "clip_del.png"),
    );

    // The neighboring asset must remain
    await expectFilePresent(
      join(vaultRoot, config.vault.assetsDir, "clip_other.webp"),
    );
  });

  it("returns 404 when id does not exist", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/clip/clip_doesnotexist",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "clip_not_found",
        message: "Clip not found",
      },
    });
  });

  // Cases below reach our handler (Fastify doesn't pre-normalize them away),
  // so we verify the wire-level body matches our error contract. Pure HTTP
  // normalization paths like `/api/v1/clip/..` → `/clip` are handled elsewhere by
  // Fastify and tested via `isSafeClipId` unit cases below.
  it.each([
    [
      "embedded dot-dot",
      "clip..with..dots",
    ],
    [
      "backslash",
      "clip\\bar",
    ],
    [
      "literal dot",
      "clip.x",
    ],
    [
      "leading dotdot",
      "..foo",
    ],
  ])("rejects malicious id (%s) at handler with 404", async (_label, badId) => {
    await writeClipMarkdown("2026-04-26_tw_safe.md", {
      id: "clip_safe",
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/clip/${encodeURIComponent(badId)}`,
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "clip_not_found",
        message: "Clip not found",
      },
    });

    // The legitimate clip is untouched
    await expectFilePresent(
      join(vaultRoot, config.vault.clippingsDir, "2026-04-26_tw_safe.md"),
    );
  });
});

describe("GET /clip/:id/screenshot", () => {
  // 8-byte PNG signature followed by an arbitrary tail. Writing real PNG
  // bytes (rather than "fake png") lets the route's mime-by-magic-bytes
  // path actually match `image/png`.
  const PNG_MAGIC = Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  // RIFF....WEBP — minimal magic for ext detection in `detectImageExt`.
  // (`detectImageExt` only checks the first two bytes `R I`, so anything
  // starting with `RI` will be classified webp.)
  const WEBP_MAGIC = Buffer.from([
    0x52,
    0x49,
    0x46,
    0x46,
    0x00,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
  ]);

  function pngFixture(): Buffer {
    return Buffer.concat([
      PNG_MAGIC,
      Buffer.from("payload-bytes-here"),
    ]);
  }

  async function writeAsset(filename: string, buf: Buffer): Promise<void> {
    await writeFile(join(vaultRoot, config.vault.assetsDir, filename), buf);
  }

  it("returns 200 + image/png + exact bytes for a stored PNG", async () => {
    await writeClipMarkdown("2026-04-26_tw_shot.md", {
      id: "clip_shot",
    });
    const fixture = pngFixture();
    await writeAsset("clip_shot.png", fixture);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_shot/screenshot",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-length"]).toBe(String(fixture.byteLength));
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
    // Bytes must round-trip identically — the PNG signature alone proves
    // the route isn't accidentally JSON-stringifying the buffer.
    expect(res.rawPayload.equals(fixture)).toBe(true);
  });

  it("serves the matching mime type for non-PNG stored formats", async () => {
    await writeClipMarkdown("2026-04-26_tw_webp.md", {
      id: "clip_webp",
    });
    await writeAsset("clip_webp.webp", WEBP_MAGIC);

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_webp/screenshot",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/webp");
  });

  it("returns 404 when the clip id is unknown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_does_not_exist/screenshot",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "clip_not_found",
        message: "Clip not found",
      },
    });
  });

  it("returns 404 when the clip exists but the screenshot file is missing", async () => {
    // Simulates the historical `screenshotSaved: false` case: the .md is
    // present but no `assets/<id>.<ext>` was ever written. Spec calls for
    // a plain 404 — clients fall back to a placeholder.
    await writeClipMarkdown("2026-04-26_tw_md_only.md", {
      id: "clip_md_only",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_md_only/screenshot",
      headers: VALID_AUTH,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: {
        code: "clip_not_found",
        message: "Clip not found",
      },
    });
  });

  it.each([
    [
      "embedded dot-dot",
      "clip..with..dots",
    ],
    [
      "literal dot",
      "clip.x",
    ],
    [
      "leading dotdot",
      "..foo",
    ],
    [
      "backslash",
      "clip\\bar",
    ],
  ])("rejects malicious id (%s) with 404 and never reads off-vault", async (_label, badId) => {
    // Plant a sibling outside of the vault root that a successful
    // traversal would reach. We can't easily prove "no read" with
    // certainty here, but if the traversal worked the response payload
    // would contain this sentinel — the equality check below would fail.
    const sentinelPath = join(vaultRoot, "..", "outside-the-vault.txt");
    await writeFile(sentinelPath, "DO_NOT_LEAK", "utf-8");
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clip/${encodeURIComponent(badId)}/screenshot`,
        headers: VALID_AUTH,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        error: {
          code: "clip_not_found",
          message: "Clip not found",
        },
      });
      expect(res.rawPayload.toString("utf-8")).not.toContain("DO_NOT_LEAK");
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(sentinelPath, {
        force: true,
      });
    }
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_x/screenshot",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: {
        code: "unauthorized",
      },
    });
  });

  it("returns 401 with a wrong token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip/clip_x/screenshot",
      headers: INVALID_AUTH,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: {
        code: "unauthorized",
      },
    });
  });
});

describe("isSafeClipId", () => {
  it.each([
    "clip_20260426_120000_aaaaaa",
    "ABC-123_xyz",
  ])("accepts well-formed id %j", (id) => {
    expect(isSafeClipId(id)).toBe(true);
  });

  it.each([
    "..",
    "../escape",
    "foo/bar",
    "foo\\bar",
    "with space",
    "clip.with.dot",
    "",
    "中文",
  ])("rejects unsafe id %j", (id) => {
    expect(isSafeClipId(id)).toBe(false);
  });
});

describe("auth", () => {
  it.each([
    [
      "GET",
      "/api/v1/clip",
    ],
    [
      "GET",
      "/api/v1/clip/clip_x",
    ],
    [
      "DELETE",
      "/api/v1/clip/clip_x",
    ],
  ])("%s %s returns 401 with no Authorization header", async (method, url) => {
    const res = await app.inject({
      method: method as "GET" | "DELETE",
      url,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: {
        code: "unauthorized",
      },
    });
  });

  it.each([
    [
      "GET",
      "/api/v1/clip",
    ],
    [
      "GET",
      "/api/v1/clip/clip_x",
    ],
    [
      "DELETE",
      "/api/v1/clip/clip_x",
    ],
  ])("%s %s returns 401 with wrong token", async (method, url) => {
    const res = await app.inject({
      method: method as "GET" | "DELETE",
      url,
      headers: INVALID_AUTH,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: {
        code: "unauthorized",
      },
    });
  });
});

describe("DELETE invalidates writer dedup index", () => {
  it("a deleted clip is no longer treated as a dedup target", async () => {
    // First, write a clip via the writer so the dedup index is populated.
    const original = makeRecord({
      id: "clip_dedup_a",
      title: "Distinctive Title",
      author: "alpha",
      platform: "twitter",
    });
    await writeClipUsingTemplate(original);
    // Touch the writer's index to simulate a real write path
    const { findSimilarClip } = await import("@/writer/markdown.js");
    expect(await findSimilarClip("twitter", "alpha", "Distinctive Title")).toBe(
      "clip_dedup_a",
    );

    // Delete via API
    const del = await app.inject({
      method: "DELETE",
      url: "/api/v1/clip/clip_dedup_a",
      headers: VALID_AUTH,
    });
    expect(del.statusCode).toBe(204);

    // After delete, the same lookup must miss — index entry is gone
    expect(
      await findSimilarClip("twitter", "alpha", "Distinctive Title"),
    ).toBeNull();
  });
});

// --- helpers ---

function setBasePath(path: string) {
  // config is `as const` for type narrowing, but the runtime object is
  // mutable. The cast scopes the unsafety to test setup.
  (
    config.vault as {
      basePath: string;
    }
  ).basePath = path;
}

async function writeIndexPage() {
  await writeFile(
    join(vaultRoot, config.vault.clippingsDir, "_index.md"),
    '# index\n\n```dataview\nTABLE foo FROM "snap-mind"\n```\n',
    "utf-8",
  );
}

interface ClipFixture {
  id?: string;
  title?: string;
  platform?: ClipRecord["platform"];
  author?: string;
  originalUrl?: string | null;
  contentType?: ClipRecord["contentType"];
  tags?: string[];
  category?: ClipRecord["category"];
  language?: string;
  fetchLevel?: ClipRecord["fetchLevel"];
  sourceConfidence?: number;
  createdAt?: string;
  contentSummary?: string;
  /** Set to a string to inject `## 原文` section; omit to skip the section. */
  contentFull?: string;
}

async function writeClipMarkdown(
  filename: string,
  fixture: ClipFixture,
  rawBody?: string,
) {
  const id = fixture.id ?? "clip_default";
  const fmLines = [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(fixture.title ?? "Default Title")}`,
    `platform: ${fixture.platform ?? "twitter"}`,
    `author: ${JSON.stringify(fixture.author ?? "tester")}`,
    `originalUrl: ${
      fixture.originalUrl == null ? "null" : JSON.stringify(fixture.originalUrl)
    }`,
    `contentType: ${fixture.contentType ?? "post"}`,
    "tags:",
    ...(
      fixture.tags ?? [
        "test",
      ]
    ).map((t) => `  - ${JSON.stringify(t)}`),
    `category: ${fixture.category ?? "tech"}`,
    `language: ${fixture.language ?? "en"}`,
    `fetchLevel: ${fixture.fetchLevel ?? 1}`,
    `sourceConfidence: ${fixture.sourceConfidence ?? 0.9}`,
    `createdAt: ${fixture.createdAt ?? "2026-04-26T12:00:00.000Z"}`,
    "---",
  ];
  const bodyParts = [
    "",
    "## 摘要",
    "",
    fixture.contentSummary ?? "A quick test summary.",
    "",
  ];
  if (fixture.contentFull !== undefined) {
    bodyParts.push("## 原文", "", fixture.contentFull, "");
  }
  bodyParts.push("## 截图", "", `![[assets/${id}.webp|360]]`, "");
  const body = rawBody ?? bodyParts.join("\n");

  await writeFile(
    join(vaultRoot, config.vault.clippingsDir, filename),
    `${fmLines.join("\n")}\n${body}`,
    "utf-8",
  );
}

async function writeClipUsingTemplate(record: ClipRecord) {
  const { writeClip } = await import("@/writer/markdown.js");
  await writeClip(record);
}

function makeRecord(overrides: Partial<ClipRecord> = {}): ClipRecord {
  const id = overrides.id ?? "clip_test";
  // When a fixture specifies just `title`, mirror it into the new aiTitle /
  // originalTitle fields so dedup (which matches on originalTitle) keeps
  // working with the historical "title only" override style.
  const baseTitle = overrides.title ?? "Test Clip";
  return {
    id,
    title: baseTitle,
    aiTitle: baseTitle,
    originalTitle: baseTitle,
    platform: "twitter",
    author: "tester",
    originalUrl: null,
    contentType: "post",
    contentFull: "Original content here.",
    contentSummary: "A quick test summary.",
    tags: [
      "test",
    ],
    category: "tech",
    language: "en",
    screenshotPath: `assets/${id}.webp`,
    fetchLevel: 1,
    sourceConfidence: 0.9,
    createdAt: "2026-04-26T12:00:00.000Z",
    rawVlmResult: {
      platform: "twitter",
      author: "tester",
      title: "Test Clip",
      keywords: [],
      publishTime: null,
      visibleUrl: null,
      contentSnippet: "snippet",
      contentType: "post",
      confidence: 0.9,
      rawResult: {
        platform: "twitter",
        confidence: 0.9,
        author: "tester",
        title: "Test Clip",
        keywords: [],
        publishTime: null,
        visibleUrl: null,
        contentSnippet: "snippet",
        contentType: "post",
      },
    },
    ...overrides,
  };
}

async function expectFileMissing(path: string) {
  const { access } = await import("node:fs/promises");
  await expect(access(path)).rejects.toThrow();
}

async function expectFilePresent(path: string) {
  const { access } = await import("node:fs/promises");
  await expect(access(path)).resolves.toBeUndefined();
}
