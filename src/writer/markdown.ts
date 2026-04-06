import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { config } from "@/config.js";
import type { ClipRecord } from "@/types/index.js";
import { textSimilarity } from "@/utils/similarity.js";
import { generateSlug } from "@/utils/slug.js";
import { renderClipMarkdown } from "@/writer/template.js";

function clippingsDir(): string {
  return join(config.vault.basePath, config.vault.clippingsDir);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listClipFiles(): Promise<string[]> {
  try {
    const entries = await readdir(clippingsDir());
    return entries.filter((f) => f.endsWith(".md") && f !== "_index.md");
  } catch {
    return [];
  }
}

async function ensureIndexPage(): Promise<void> {
  const indexPath = join(clippingsDir(), "_index.md");
  if (await fileExists(indexPath)) {
    return;
  }

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

export async function writeClip(record: ClipRecord): Promise<string> {
  const dir = clippingsDir();
  await mkdir(dir, {
    recursive: true,
  });

  const slug = generateSlug(record.title);
  const dateStr = record.createdAt.slice(0, 10);
  let filename = `${dateStr}_${record.platform}_${slug}.md`;

  // Handle filename conflicts
  let counter = 1;
  while (await fileExists(join(dir, filename))) {
    counter++;
    filename = `${dateStr}_${record.platform}_${slug}-${counter}.md`;
  }

  const content = renderClipMarkdown(record);
  await writeFile(join(dir, filename), content, "utf-8");

  await ensureIndexPage();

  return `${config.vault.clippingsDir}/${filename}`;
}

export async function clipExists(id: string): Promise<boolean> {
  const files = await listClipFiles();
  for (const file of files) {
    const raw = await readFile(join(clippingsDir(), file), "utf-8");
    const { data } = matter(raw);
    if (data.id === id) {
      return true;
    }
  }
  return false;
}

export async function findSimilarClip(
  platform: string,
  author: string | null,
  title: string | null,
): Promise<string | null> {
  if (!title) {
    return null;
  }

  const threshold = config.processing.similarityThreshold;
  const files = await listClipFiles();
  const dir = clippingsDir();

  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf-8");
    const { data } = matter(raw);

    if (data.platform !== platform) {
      continue;
    }
    if (!data.title) {
      continue;
    }

    const titleSim = textSimilarity(String(data.title), title);
    if (titleSim < threshold) {
      continue;
    }

    if (author && data.author) {
      const authorSim = textSimilarity(String(data.author), author);
      if (authorSim >= threshold) {
        return data.id as string;
      }
    }

    // Title similarity alone is enough if no author to compare
    if (!author || !data.author) {
      return data.id as string;
    }
  }
  return null;
}
