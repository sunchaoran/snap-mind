import { readdir, readFile, unlink } from "node:fs/promises";
import {
  join,
  relative as pathRelative,
  resolve as pathResolve,
} from "node:path";
import dayjs from "dayjs";
import matter from "gray-matter";
import { config } from "@/config.js";
import type {
  Category,
  ClipRecordWire,
  ClipRecordWireFull,
  ContentType,
  Platform,
} from "@/types/index.js";
import { createLogger } from "@/utils/logger.js";
import {
  FALLBACK_SCREENSHOT_EXT,
  H2_PREFIX,
  HEADING_ORIGINAL,
  HEADING_SUMMARY,
  VAULT_INDEX_FILENAME,
} from "@/vault.js";
import { removeClipFromIndex } from "@/writer/markdown.js";

const log = createLogger("clip-library");

/**
 * 允许的 clip id 字符集。`generateClipId` 只产出
 * `clip_<yyyymmdd>_<hhmmss>_<6位nanoid>`，nanoid 也只用 `[A-Za-z0-9_-]`，
 * 所以白名单足够严格。这条正则同时挡掉所有路径分隔符 / `..`，避免在
 * `DELETE /clip/:id` 里拼接出能逃逸 `<vault>/<clippingsDir>/` 的路径。
 */
const CLIP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const PLATFORMS = new Set<Platform>([
  "xiaohongshu",
  "twitter",
  "reddit",
  "weibo",
  "zhihu",
  "weixin",
  "bilibili",
  "douban",
  "hackernews",
  "youtube",
  "medium",
  "substack",
  "unknown",
]);

const CONTENT_TYPES = new Set<ContentType>([
  "post",
  "article",
  "comment",
  "video",
  "thread",
]);

const CATEGORIES = new Set<Category>([
  "tech",
  "design",
  "product",
  "business",
  "finance",
  "science",
  "life",
  "culture",
  "career",
  "other",
]);

function clippingsDir(): string {
  return join(config.vault.basePath, config.vault.clippingsDir);
}

function assetsDir(): string {
  return join(config.vault.basePath, config.vault.assetsDir);
}

export function isSafeClipId(id: string): boolean {
  return CLIP_ID_PATTERN.test(id);
}

/**
 * 列出 vault 里所有 clip 的精简 wire format（不含 contentFull）。每次都
 * 重新扫盘——vault 规模 (~千条量级) 完全在可控范围内，相比维护一份内存
 * 索引 + 失效逻辑，重新 scan 反而更稳。
 *
 * - 跳过 `_index.md`（Dataview 索引页，不是 clip）
 * - 单条解析失败的不让整批失败，只 warn 后跳过
 * - 同 id 重复保留 `createdAt` 最早的那条（详见下方 dedup ordering 注释）
 * - 按 createdAt 倒序返回
 */
export async function listClips(): Promise<ClipRecordWire[]> {
  const all = await loadAllClips();
  return all.map(stripContentFull);
}

/**
 * 内部辅助：把 vault 里所有 .md 都 parse 出来（detail 形态，含 contentFull），
 * dedup + 按 createdAt 倒序排好。`listClips` / `getClip` 在此基础上做投影。
 */
async function loadAllClips(): Promise<ClipRecordWireFull[]> {
  const dir = clippingsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const files = entries.filter(
    (name) => name.endsWith(".md") && name !== VAULT_INDEX_FILENAME,
  );

  const parsed: {
    file: string;
    clip: ClipRecordWireFull;
  }[] = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf-8").catch(() => null);
    if (!raw) {
      continue;
    }
    const clip = parseClipFile(file, raw);
    if (clip) {
      parsed.push({
        file,
        clip,
      });
    }
  }

  // Dedup ordering: when two files share an id (manual copy or backend
  // filename collision), keep the one with the earliest `createdAt`——that
  // matches the spec's "原始 vs -N 后缀" 场景下保留原始的意图。Tie-break:
  // alphabetically later filename wins so `foo.md` beats `foo-2.md`
  // (`.` > `-`), again giving the bare-name original priority.
  parsed.sort((a, b) => {
    if (a.clip.createdAt !== b.clip.createdAt) {
      return a.clip.createdAt < b.clip.createdAt ? -1 : 1;
    }
    return a.file > b.file ? -1 : 1;
  });

  const seen = new Set<string>();
  const deduped: ClipRecordWireFull[] = [];
  for (const { file, clip } of parsed) {
    if (seen.has(clip.id)) {
      log.warn(
        {
          id: clip.id,
          file,
        },
        "duplicate clip id encountered, keeping the earliest createdAt",
      );
      continue;
    }
    seen.add(clip.id);
    deduped.push(clip);
  }

  deduped.sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return 0;
    }
    return a.createdAt < b.createdAt ? 1 : -1;
  });

  return deduped;
}

function stripContentFull(full: ClipRecordWireFull): ClipRecordWire {
  const { contentFull: _omit, ...summary } = full;
  return summary;
}

/**
 * 取单条 clip 的 detail 视图（含 contentFull）。复用 list 的解析与 dedup
 * 逻辑，所以"哪条赢"的语义跟 list 完全一致。找不到返回 null。
 */
export async function getClip(id: string): Promise<ClipRecordWireFull | null> {
  if (!isSafeClipId(id)) {
    return null;
  }
  const all = await loadAllClips();
  return all.find((c) => c.id === id) ?? null;
}

export type DeleteResult = "ok" | "notfound";

/**
 * 物理删除一条 clip：
 *
 * 1. 通过 frontmatter `id` 匹配 `<vault>/<clippingsDir>/*.md`，unlink 那一个
 * 2. unlink `<assets>/<id>.*`（截图本身 + `.json` sidecar）
 * 3. 把这条从 writer 的内存 dedup index 里摘掉，避免下次 dedup 误中
 *
 * 不重生成 `_index.md`（它是 Dataview 索引页，下次 write 时会再起来）。
 */
export async function deleteClip(id: string): Promise<DeleteResult> {
  if (!isSafeClipId(id)) {
    return "notfound";
  }

  const dir = clippingsDir();
  const targetFile = await findClipFile(id, dir);
  if (!targetFile) {
    return "notfound";
  }

  const targetPath = pathResolve(dir, targetFile);
  if (!isInside(targetPath, pathResolve(dir))) {
    log.warn(
      {
        id,
        file: targetFile,
      },
      "refusing to delete file resolved outside clippings dir",
    );
    return "notfound";
  }

  await unlink(targetPath);
  await deleteAssetsForId(id);
  removeClipFromIndex(id);

  return "ok";
}

async function findClipFile(id: string, dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md") || entry === VAULT_INDEX_FILENAME) {
      continue;
    }
    const raw = await readFile(join(dir, entry), "utf-8").catch(() => null);
    if (!raw) {
      continue;
    }
    let data: Record<string, unknown>;
    try {
      data = matter(raw).data;
    } catch {
      continue;
    }
    if (data.id === id) {
      return entry;
    }
  }
  return null;
}

async function deleteAssetsForId(id: string): Promise<void> {
  const dir = assetsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const prefix = `${id}.`;
  const dirResolved = pathResolve(dir);

  for (const entry of entries) {
    if (!entry.startsWith(prefix)) {
      continue;
    }

    const target = pathResolve(dir, entry);
    if (!isInside(target, dirResolved)) {
      continue;
    }

    await unlink(target).catch((err) => {
      log.warn(
        {
          id,
          file: entry,
          error: err instanceof Error ? err.message : String(err),
        },
        "failed to delete asset file",
      );
    });
  }
}

/** path 必须是 parent 的真后代（不能等于 parent，也不能是 `..`）。 */
function isInside(path: string, parent: string): boolean {
  const rel = pathRelative(parent, path);
  if (!rel || rel.startsWith("..")) {
    return false;
  }
  // Windows-only safety; node 在 posix 下也不会引入反斜杠，留着无害
  return !rel.split(/[/\\]/).includes("..");
}

/**
 * 把一份 clip markdown 解析成 detail wire format。所有必填字段缺一不可；
 * platform/contentType/category 必须是已知枚举，否则视为损坏，跳过。
 *
 * `contentFull` 取自 body 里 `## 原文` 段——段缺失或纯空白时为 `null`。
 * `listClips` 拿到这个结果后会把 `contentFull` 投影掉。
 *
 * 文件名只用作日志上下文，不影响结果。
 */
export function parseClipFile(
  filename: string,
  raw: string,
): ClipRecordWireFull | null {
  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    const parsed = matter(raw);
    frontmatter = parsed.data;
    body = parsed.content;
  } catch (error) {
    log.warn(
      {
        file: filename,
        error: error instanceof Error ? error.message : String(error),
      },
      "skipping clip with malformed frontmatter",
    );
    return null;
  }

  const id = readString(frontmatter.id);
  if (!id || !isSafeClipId(id)) {
    log.warn(
      {
        file: filename,
      },
      "skipping clip with missing or invalid id",
    );
    return null;
  }

  const platform = readEnum(frontmatter.platform, PLATFORMS);
  const contentType = readEnum(frontmatter.contentType, CONTENT_TYPES);
  const category = readEnum(frontmatter.category, CATEGORIES);
  const title = readString(frontmatter.title);
  const author = readString(frontmatter.author);
  const language = readString(frontmatter.language);
  const fetchLevel = readFetchLevel(frontmatter.fetchLevel);
  const sourceConfidence = readNumber(frontmatter.sourceConfidence);
  const createdAt = readString(frontmatter.createdAt);

  if (
    !platform ||
    !contentType ||
    !category ||
    title === null ||
    author === null ||
    language === null ||
    fetchLevel === null ||
    sourceConfidence === null ||
    !createdAt
  ) {
    log.warn(
      {
        file: filename,
        id,
      },
      "skipping clip with incomplete frontmatter",
    );
    return null;
  }

  const tags = readStringList(frontmatter.tags);
  const originalUrl = readNullableString(frontmatter.originalUrl);
  const screenshotPath = extractScreenshotPath(body, id);
  const contentSummary = extractSection(body, HEADING_SUMMARY);
  const contentFull = extractSection(body, HEADING_ORIGINAL) || null;

  return {
    id,
    title,
    platform,
    author,
    originalUrl,
    contentType,
    contentSummary,
    contentFull,
    tags,
    category,
    language,
    screenshotPath,
    fetchLevel,
    sourceConfidence,
    createdAt,
  };
}

/**
 * gray-matter 用 js-yaml v3 默认 schema 解析，会把 ISO timestamp 自动
 * 转成 `Date`。wire format 要求 createdAt 是字符串，所以在这里把 Date
 * 转回 ISO 8601。
 *
 * Backend 自己 `Date.toISOString()` 写入只到 ms 精度，dayjs 的
 * `toISOString()` 同样保留到 ms——round-trip 无损。手工编辑出 sub-ms
 * 精度时会被截断，这是接受的折衷（详见 spec 注释）。
 */
function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    const wrapped = dayjs(value);
    if (wrapped.isValid()) {
      return wrapped.toISOString();
    }
  }
  return null;
}

function readNullableString(value: unknown): string | null {
  return readString(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFetchLevel(value: unknown): 1 | 2 | 3 | 4 | null {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  return null;
}

function readEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T | null {
  if (typeof value !== "string") {
    return null;
  }
  return allowed.has(value as T) ? (value as T) : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * 抽出 body 里第一个 `![[…]]` embed，去掉 `|width` 后缀，前缀
 * `<clippingsDir>/` → 得到相对 vault root 的路径。没 embed 时回退到
 * `<clippingsDir>/assets/<id>.webp`（极少数 backfill / 失败记录场景）。
 */
function extractScreenshotPath(body: string, fallbackId: string): string {
  const match = body.match(/!\[\[([^\]]+)\]\]/);
  if (match) {
    let inner = match[1];
    const pipe = inner.indexOf("|");
    if (pipe >= 0) {
      inner = inner.slice(0, pipe);
    }
    inner = inner.trim();
    if (inner) {
      return `${config.vault.clippingsDir}/${inner}`;
    }
  }
  return `${config.vault.assetsDir}/${fallbackId}.${FALLBACK_SCREENSHOT_EXT}`;
}

/**
 * 抽出 body 里某个 H2 段（从 `heading` 行的下一行起，到下一个 `## ` 行
 * 之前为止），trim 首尾空白后返回。段不存在或纯空白时返回空串。
 */
function extractSection(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    return "";
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith(H2_PREFIX)) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}
