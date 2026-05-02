import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "@/config.js";
import type { VLMAnalysis } from "@/types/domain.js";

export function detectImageExt(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return "png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    return "jpg";
  }
  if (buf[0] === 0x52 && buf[1] === 0x49) {
    return "webp";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49) {
    return "gif";
  }
  return "png";
}

export async function saveScreenshot(
  clipId: string,
  imageBuffer: Buffer,
  ext?: string,
): Promise<string> {
  const assetsDir = join(config.vault.basePath, config.vault.assetsDir);
  await mkdir(assetsDir, {
    recursive: true,
  });

  const resolvedExt = ext ?? detectImageExt(imageBuffer);
  const filename = `${clipId}.${resolvedExt}`;
  const filePath = join(assetsDir, filename);
  await writeFile(filePath, imageBuffer);

  return `assets/${filename}`;
}

export async function saveSidecarJson(
  clipId: string,
  data: unknown,
): Promise<void> {
  const assetsDir = join(config.vault.basePath, config.vault.assetsDir);
  const filePath = join(assetsDir, `${clipId}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

const SCREENSHOT_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
] as const;

export interface LoadedScreenshot {
  buffer: Buffer;
  ext: string;
}

export async function loadScreenshot(
  clipId: string,
): Promise<LoadedScreenshot | null> {
  const assetsDir = join(config.vault.basePath, config.vault.assetsDir);
  // The on-disk extension was decided by the original `saveScreenshot` call;
  // we don't track it elsewhere, so scan the dir for any `<id>.<ext>` match.
  const entries = await readdir(assetsDir).catch(() => null);
  if (!entries) {
    return null;
  }
  for (const ext of SCREENSHOT_EXTS) {
    const filename = `${clipId}.${ext}`;
    if (entries.includes(filename)) {
      const buffer = await readFile(join(assetsDir, filename));
      return {
        buffer,
        ext,
      };
    }
  }
  return null;
}

export async function loadSidecarVlm(
  clipId: string,
): Promise<VLMAnalysis | null> {
  const assetsDir = join(config.vault.basePath, config.vault.assetsDir);
  const filePath = join(assetsDir, `${clipId}.json`);
  const raw = await readFile(filePath, "utf-8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as VLMAnalysis;
  } catch {
    return null;
  }
}
