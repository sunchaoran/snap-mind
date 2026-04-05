import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

export async function saveScreenshot(
  clipId: string,
  imageBuffer: Buffer,
  ext: string = "png",
): Promise<string> {
  const assetsDir = join(config.vault.basePath, config.vault.assetsDir);
  await mkdir(assetsDir, { recursive: true });

  const filename = `${clipId}.${ext}`;
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
