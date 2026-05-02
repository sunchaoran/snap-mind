import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "@/config.js";
import { loadScreenshot, loadSidecarVlm } from "@/store/screenshot.js";
import type { VLMAnalysis } from "@/types/domain.js";

let vaultRoot: string;
let originalBasePath: string;

beforeEach(async () => {
  vaultRoot = await mkdtemp(join(tmpdir(), "snap-mind-store-test-"));
  originalBasePath = config.vault.basePath;
  setBasePath(vaultRoot);
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

describe("loadScreenshot", () => {
  it.each([
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
  ])("loads <id>.%s when present", async (ext) => {
    const payload = Buffer.from(`fake-${ext}-bytes`);
    await writeAsset(`clip_x.${ext}`, payload);

    const loaded = await loadScreenshot("clip_x");

    expect(loaded).not.toBeNull();
    expect(loaded?.ext).toBe(ext);
    expect(loaded?.buffer.equals(payload)).toBe(true);
  });

  it("prefers png over later extensions when multiple exist", async () => {
    // Defends the documented fallback order in SCREENSHOT_EXTS — if the
    // order changes inadvertently, this test will catch it before users
    // see a different file get picked up.
    await writeAsset("clip_multi.png", Buffer.from("png-bytes"));
    await writeAsset("clip_multi.jpg", Buffer.from("jpg-bytes"));
    await writeAsset("clip_multi.webp", Buffer.from("webp-bytes"));

    const loaded = await loadScreenshot("clip_multi");

    expect(loaded?.ext).toBe("png");
    expect(loaded?.buffer.toString()).toBe("png-bytes");
  });

  it("returns null when no file matches the id", async () => {
    await writeAsset("clip_other.png", Buffer.from("not-mine"));

    const loaded = await loadScreenshot("clip_missing");

    expect(loaded).toBeNull();
  });

  it("returns null when assets dir does not exist", async () => {
    // Wipe the dir created in beforeEach to simulate a fresh / corrupted vault
    await rm(join(vaultRoot, config.vault.assetsDir), {
      recursive: true,
      force: true,
    });

    const loaded = await loadScreenshot("clip_x");

    expect(loaded).toBeNull();
  });

  it("ignores unknown extensions even when filename prefix matches", async () => {
    // `.bmp` is not in the supported set — must not be returned even though
    // a naive `<id>.*` glob would catch it.
    await writeAsset("clip_bmp.bmp", Buffer.from("bmp-bytes"));

    const loaded = await loadScreenshot("clip_bmp");

    expect(loaded).toBeNull();
  });
});

describe("loadSidecarVlm", () => {
  it("returns the parsed VLMAnalysis when sidecar is valid", async () => {
    const vlm: VLMAnalysis = {
      platform: "twitter",
      contentType: "post",
      author: "tester",
      title: "Sample",
      keywords: [
        "kw1",
      ],
      publishTime: null,
      visibleUrl: null,
      contentSnippet: null,
      confidence: 0.9,
      rawResult: {
        platform: "twitter",
        confidence: 0.9,
        author: "tester",
        title: "Sample",
        keywords: [
          "kw1",
        ],
        publishTime: null,
        visibleUrl: null,
        contentSnippet: null,
        contentType: "post",
      },
    };
    await writeAsset("clip_v.json", Buffer.from(JSON.stringify(vlm), "utf-8"));

    const loaded = await loadSidecarVlm("clip_v");

    expect(loaded).toEqual(vlm);
  });

  it("returns null when sidecar file is missing", async () => {
    const loaded = await loadSidecarVlm("clip_no_sidecar");

    expect(loaded).toBeNull();
  });

  it("returns null on malformed JSON instead of throwing", async () => {
    // A retry path that crashed on a corrupt sidecar would never get to the
    // VLM re-run fallback — the null contract is what makes the fallback safe.
    await writeAsset("clip_bad.json", Buffer.from("{not valid json"));

    const loaded = await loadSidecarVlm("clip_bad");

    expect(loaded).toBeNull();
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

async function writeAsset(filename: string, payload: Buffer) {
  await writeFile(join(vaultRoot, config.vault.assetsDir, filename), payload);
}
