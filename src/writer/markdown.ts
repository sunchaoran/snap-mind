import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { config } from "@/config.js";
import type { ClipRecord } from "@/types/index.js";
import { createLogger } from "@/utils/logger.js";
import { textSimilarity } from "@/utils/similarity.js";
import {
  generateSlug,
  shortDateStamp,
  shortPlatformName,
} from "@/utils/slug.js";
import { renderClipMarkdown } from "@/writer/template.js";

interface ClipIndexEntry {
  id: string;
  platform: string;
  title: string | null;
  author: string | null;
  vaultPath: string;
  absolutePath: string;
}

const log = createLogger("clip-writer");
const clipIndexById = new Map<string, ClipIndexEntry>();
const clipIdsByPlatform = new Map<string, Set<string>>();
const clipIdByVaultPath = new Map<string, string>();
let clipIndexReady = false;
let clipIndexLoadPromise: Promise<void> | null = null;

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

  const content = `# snap-mind

## 最近收藏

\`\`\`dataview
TABLE platform, category, tags, sourceConfidence
FROM "snap-mind"
WHERE id != null
SORT createdAt DESC
LIMIT 50
\`\`\`

## 按平台统计

\`\`\`dataview
TABLE length(rows) as "数量"
FROM "snap-mind"
WHERE id != null
GROUP BY platform
SORT length(rows) DESC
\`\`\`

## 待补充原文

\`\`\`dataview
TABLE title, platform, createdAt
FROM "snap-mind"
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
  await ensureClipIndexReady();

  const slug = generateSlug(record.title, 30) || "Untitled";
  const dateStr = shortDateStamp(record.createdAt);
  const platformStr = shortPlatformName(record.platform);
  let filename = `${dateStr}_${platformStr}_${slug}.md`;

  // Handle filename conflicts
  let counter = 1;
  while (clipIdByVaultPath.has(`${config.vault.clippingsDir}/${filename}`)) {
    counter++;
    filename = `${dateStr}_${platformStr}_${slug}-${counter}.md`;
  }

  const content = renderClipMarkdown(record);
  await writeFile(join(dir, filename), content, "utf-8");

  upsertClipIndexEntry({
    id: record.id,
    platform: record.platform,
    title: record.title,
    author: record.author,
    vaultPath: `${config.vault.clippingsDir}/${filename}`,
    absolutePath: join(dir, filename),
  });

  await ensureIndexPage();

  return `${config.vault.clippingsDir}/${filename}`;
}

export async function clearSnapMindVault(): Promise<{
  removedNotes: number;
}> {
  const dir = clippingsDir();
  await mkdir(dir, {
    recursive: true,
  });

  const entries = await readdir(dir).catch(() => []);
  const removedNotes = entries.filter(
    (entry) => entry.endsWith(".md") && entry !== "_index.md",
  ).length;
  await Promise.all(
    entries.map((entry) =>
      rm(join(dir, entry), {
        recursive: true,
        force: true,
      }),
    ),
  );
  resetClipIndex();

  return {
    removedNotes,
  };
}

export async function clipExists(id: string): Promise<boolean> {
  await ensureClipIndexReady();
  return clipIndexById.has(id);
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
  await ensureClipIndexReady();
  const candidateIds = clipIdsByPlatform.get(platform);
  if (!candidateIds || candidateIds.size === 0) {
    return null;
  }

  for (const id of candidateIds) {
    const entry = clipIndexById.get(id);
    if (!entry?.title) {
      continue;
    }

    const titleSim = textSimilarity(entry.title, title);
    if (titleSim < threshold) {
      continue;
    }

    if (author && entry.author) {
      const authorSim = textSimilarity(entry.author, author);
      if (authorSim >= threshold) {
        return entry.id;
      }
    }

    // Title similarity alone is enough if no author to compare
    if (!author || !entry.author) {
      return entry.id;
    }
  }
  return null;
}

async function ensureClipIndexReady(): Promise<void> {
  if (clipIndexReady) {
    return;
  }
  if (clipIndexLoadPromise) {
    return clipIndexLoadPromise;
  }

  clipIndexLoadPromise = (async () => {
    const start = Date.now();
    const files = await listClipFiles();
    const entries: ClipIndexEntry[] = [];

    for (const file of files) {
      const absolutePath = join(clippingsDir(), file);
      const raw = await readFile(absolutePath, "utf-8").catch(() => null);
      if (!raw) {
        continue;
      }

      const entry = buildClipIndexEntryFromFile(file, raw);
      if (entry) {
        entries.push(entry);
      }
    }

    replaceClipIndex(entries);
    clipIndexReady = true;
    log.info(
      {
        entries: entries.length,
        elapsed: `${Date.now() - start}ms`,
      },
      "clip index loaded",
    );
  })().finally(() => {
    clipIndexLoadPromise = null;
  });

  return clipIndexLoadPromise;
}

function replaceClipIndex(entries: ClipIndexEntry[]) {
  clipIndexById.clear();
  clipIdsByPlatform.clear();
  clipIdByVaultPath.clear();

  for (const entry of entries) {
    clipIndexById.set(entry.id, entry);
    clipIdByVaultPath.set(entry.vaultPath, entry.id);

    const ids = clipIdsByPlatform.get(entry.platform) ?? new Set<string>();
    ids.add(entry.id);
    clipIdsByPlatform.set(entry.platform, ids);
  }
}

function upsertClipIndexEntry(entry: ClipIndexEntry) {
  const previous = clipIndexById.get(entry.id);
  if (previous) {
    clipIdByVaultPath.delete(previous.vaultPath);
    const ids = clipIdsByPlatform.get(previous.platform);
    ids?.delete(previous.id);
    if (ids && ids.size === 0) {
      clipIdsByPlatform.delete(previous.platform);
    }
  }

  clipIndexById.set(entry.id, entry);
  clipIdByVaultPath.set(entry.vaultPath, entry.id);
  const ids = clipIdsByPlatform.get(entry.platform) ?? new Set<string>();
  ids.add(entry.id);
  clipIdsByPlatform.set(entry.platform, ids);
  clipIndexReady = true;
}

function resetClipIndex() {
  clipIndexById.clear();
  clipIdsByPlatform.clear();
  clipIdByVaultPath.clear();
  clipIndexReady = false;
  clipIndexLoadPromise = null;
}

function buildClipIndexEntryFromFile(
  file: string,
  raw: string,
): ClipIndexEntry | null {
  let data: Record<string, unknown>;
  try {
    data = matter(raw).data;
  } catch (error) {
    log.warn(
      {
        file,
        error: error instanceof Error ? error.message : String(error),
      },
      "skipping malformed clip frontmatter while building index",
    );
    return null;
  }

  const id = typeof data.id === "string" ? data.id : null;
  if (!id) {
    return null;
  }

  return {
    id,
    platform: typeof data.platform === "string" ? data.platform : "unknown",
    title: typeof data.title === "string" ? data.title : null,
    author: typeof data.author === "string" ? data.author : null,
    vaultPath: `${config.vault.clippingsDir}/${file}`,
    absolutePath: join(clippingsDir(), file),
  };
}
