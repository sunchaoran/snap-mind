import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { config } from "../config.js";
import type { ClipRecord } from "../types/index.js";
import { textSimilarity } from "../utils/similarity.js";
import { generateSlug } from "../utils/slug.js";
import type { ClipWriter } from "./interface.js";
import { renderClipMarkdown } from "./template.js";

export class MarkdownWriter implements ClipWriter {
  private get clippingsDir() {
    return join(config.vault.basePath, config.vault.clippingsDir);
  }

  async write(record: ClipRecord): Promise<string> {
    await mkdir(this.clippingsDir, { recursive: true });

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

    await this.ensureIndexPage();

    return `${config.vault.clippingsDir}/${filename}`;
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

    const threshold = config.processing.similarityThreshold;
    const files = await this.listClipFiles();

    for (const file of files) {
      const raw = await readFile(join(this.clippingsDir, file), "utf-8");
      const { data } = matter(raw);

      if (data.platform !== platform) continue;
      if (!data.title) continue;

      const titleSim = textSimilarity(String(data.title), title);
      if (titleSim < threshold) continue;

      if (author && data.author) {
        const authorSim = textSimilarity(String(data.author), author);
        if (authorSim >= threshold) return data.id as string;
      }

      // Title similarity alone is enough if no author to compare
      if (!author || !data.author) return data.id as string;
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

  private async ensureIndexPage(): Promise<void> {
    const indexPath = join(this.clippingsDir, "_index.md");
    if (await this.fileExists(indexPath)) return;

    const content = `# Clippings

## 最近收藏

\`\`\`dataview
TABLE platform, category, tags, sourceConfidence
FROM "Clippings"
WHERE id != null
SORT createdAt DESC
LIMIT 50
\`\`\`

## 按平台统计

\`\`\`dataview
TABLE length(rows) as "数量"
FROM "Clippings"
WHERE id != null
GROUP BY platform
SORT length(rows) DESC
\`\`\`

## 待补充原文

\`\`\`dataview
TABLE title, platform, createdAt
FROM "Clippings"
WHERE fetchLevel = 4
SORT createdAt DESC
\`\`\`
`;
    await writeFile(indexPath, content, "utf-8");
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
