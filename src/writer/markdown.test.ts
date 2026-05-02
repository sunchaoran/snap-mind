import { access, mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "@/config.js";
import type { ClipRecord } from "@/types/domain.js";
import {
  clearSnapMindVault,
  findSimilarClip,
  removeClipMarkdownFile,
  writeClip,
} from "@/writer/markdown.js";

let vaultRoot: string;
let originalBasePath: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "snap-mind-writer-test-"));
  originalBasePath = config.vault.basePath;
  setBasePath(vaultRoot);
  await clearSnapMindVault(); // resets the writer's in-memory dedup index
  await mkdir(join(vaultRoot, config.vault.assetsDir), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(vaultRoot, {
    recursive: true,
    force: true,
  });
  setBasePath(originalBasePath);
});

describe("removeClipMarkdownFile", () => {
  it("unlinks the .md file and purges the dedup index", async () => {
    const record = makeRecord({
      id: "clip_remove_me",
      title: "Distinctive Title",
      author: "alpha",
      platform: "twitter",
    });
    const vaultPath = await writeClip(record);
    const absolutePath = join(vaultRoot, vaultPath);

    // Sanity: the writer registered the entry in the dedup index.
    expect(await findSimilarClip("twitter", "alpha", "Distinctive Title")).toBe(
      "clip_remove_me",
    );
    await expectFilePresent(absolutePath);

    await removeClipMarkdownFile("clip_remove_me");

    await expectFileMissing(absolutePath);
    expect(
      await findSimilarClip("twitter", "alpha", "Distinctive Title"),
    ).toBeNull();
  });

  it("leaves the screenshot + sidecar untouched", async () => {
    // The retry pipeline reuses these — proves removeClipMarkdownFile is
    // narrower than deleteClip (which wipes assets too).
    const record = makeRecord({
      id: "clip_assets_kept",
    });
    await writeClip(record);
    const screenshotPath = join(
      vaultRoot,
      config.vault.assetsDir,
      "clip_assets_kept.webp",
    );
    const sidecarPath = join(
      vaultRoot,
      config.vault.assetsDir,
      "clip_assets_kept.json",
    );
    await writeStubAsset(screenshotPath, "fake-screenshot-bytes");
    await writeStubAsset(sidecarPath, "{}");

    await removeClipMarkdownFile("clip_assets_kept");

    await expectFilePresent(screenshotPath);
    await expectFilePresent(sidecarPath);
  });

  it("is a no-op for an unknown id", async () => {
    await expect(
      removeClipMarkdownFile("clip_never_existed"),
    ).resolves.toBeUndefined();
  });

  it("still cleans the index entry when the .md is already gone on disk", async () => {
    // Models the pathological case where someone deletes the file out of
    // band — the in-memory index would otherwise dangle and dedup against
    // a vanished id.
    const record = makeRecord({
      id: "clip_orphan_index",
      title: "Orphan Title",
      author: "ghost",
      platform: "reddit",
    });
    const vaultPath = await writeClip(record);
    await unlink(join(vaultRoot, vaultPath));

    await removeClipMarkdownFile("clip_orphan_index");

    expect(await findSimilarClip("reddit", "ghost", "Orphan Title")).toBeNull();
  });
});

// --- helpers ---

function setBasePath(path: string) {
  (
    config.vault as {
      basePath: string;
    }
  ).basePath = path;
}

async function expectFileMissing(path: string) {
  await expect(access(path)).rejects.toThrow();
}

async function expectFilePresent(path: string) {
  await expect(access(path)).resolves.toBeUndefined();
}

async function writeStubAsset(path: string, contents: string) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, contents, "utf-8");
}

function makeRecord(overrides: Partial<ClipRecord> = {}): ClipRecord {
  const id = overrides.id ?? "clip_test";
  // Mirror title into aiTitle / originalTitle so fixtures that only set
  // `title` still drive dedup (which matches on originalTitle).
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
      contentSnippet: null,
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
        contentSnippet: null,
        contentType: "post",
      },
    },
    ...overrides,
  };
}
