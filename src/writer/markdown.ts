import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { config } from "../config.js";
import type { ClipRecord } from "../types/index.js";
import { generateSlug } from "../utils/slug.js";
import type { ClipWriter } from "./interface.js";
import { renderClipMarkdown } from "./template.js";

export class MarkdownWriter implements ClipWriter {
  private get clippingsDir() {
    return join(config.vault.basePath, config.vault.clippingsDir);
  }

  async write(record: ClipRecord): Promise<void> {
    const slug = generateSlug(record.title);
    const dateStr = record.createdAt.slice(0, 10);
    let filename = `${dateStr}_${record.platform}_${slug}.md`;

    // Handle filename conflicts
    let counter = 1;
    while (await this.fileExists(join(this.clippingsDir, filename))) {
      counter++;
      filename = `${dateStr}_${record.platform}_${slug}-${counter}.md`;
    }

    const content = renderClipMarkdown(record);
    await writeFile(join(this.clippingsDir, filename), content, "utf-8");
  }

  async exists(id: string): Promise<boolean> {
    const files = await this.listClipFiles();
    for (const file of files) {
      const raw = await readFile(join(this.clippingsDir, file), "utf-8");
      const { data } = matter(raw);
      if (data.id === id) return true;
    }
    return false;
  }

  async findSimilar(
    platform: string,
    author: string | null,
    title: string | null,
  ): Promise<string | null> {
    if (!title) return null;

    const files = await this.listClipFiles();
    for (const file of files) {
      const raw = await readFile(join(this.clippingsDir, file), "utf-8");
      const { data } = matter(raw);

      if (data.platform !== platform) continue;
      if (!data.title) continue;

      // Simple similarity: exact match on platform + title
      // TODO: implement Levenshtein/Jaccard with 0.85 threshold
      if (data.title === title && data.author === author) {
        return data.id as string;
      }
    }
    return null;
  }

  private async listClipFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.clippingsDir);
      return entries.filter((f) => f.endsWith(".md") && f !== "_index.md");
    } catch {
      return [];
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
