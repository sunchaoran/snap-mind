import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "@/config.js";

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
