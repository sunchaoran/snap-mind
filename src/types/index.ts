/** 来源平台标识 */
export type Platform =
  | "xiaohongshu"
  | "twitter"
  | "reddit"
  | "weibo"
  | "zhihu"
  | "weixin"
  | "bilibili"
  | "douban"
  | "hackernews"
  | "youtube"
  | "medium"
  | "substack"
  | "unknown";

/** 内容类型 */
export type ContentType = "post" | "article" | "comment" | "video" | "thread";

/** 预定义分类 */
export type Category =
  | "tech"
  | "design"
  | "product"
  | "business"
  | "finance"
  | "science"
  | "life"
  | "culture"
  | "career"
  | "other";

/** 客户端类型 */
export type ClientType = "agent" | "webapp" | "ios";

/** 认证结果 */
export interface AuthResult {
  clientId: string;
  clientType: ClientType;
}

/** 单个 VLM 模型的输出 */
export interface VLMResult {
  platform: Platform | null;
  confidence: number;
  author: string | null;
  title: string | null;
  keywords: string[];
  publishTime: string | null;
  visibleUrl: string | null;
  contentSnippet: string | null;
  contentType: ContentType | null;
}

/** N 模型投票合并后的结果 */
export interface MergedVLMResult {
  platform: Platform;
  author: string | null;
  title: string | null;
  keywords: string[];
  publishTime: string | null;
  visibleUrl: string | null;
  contentSnippet: string | null;
  contentType: ContentType;
  confidence: number;
  /** 各模型的原始结果，key 为模型标识 */
  rawResults: Record<string, VLMResult>;
}

/** ContentFetcher 的输出 */
export interface FetchResult {
  contentFull: string | null;
  originalUrl: string | null;
  fetchLevel: 1 | 2 | 3 | 4;
}

/** ContentProcessor 的输出 */
export interface ProcessedContent {
  summary: string;
  tags: string[];
  category: Category;
  language: string;
}

/** 核心数据结构 */
export interface ClipRecord {
  /** 全局唯一 ID，格式: clip_{yyyyMMdd}_{HHmmss}_{4位短hash} */
  id: string;
  title: string;
  platform: Platform;
  author: string;
  originalUrl: string | null;
  contentType: ContentType;
  contentFull: string | null;
  contentSummary: string;
  tags: string[];
  category: Category;
  language: string;
  screenshotPath: string;
  fetchLevel: 1 | 2 | 3 | 4;
  sourceConfidence: number;
  createdAt: string;
  rawVlmResult: MergedVLMResult;
}

/**
 * `GET /clip` 列表里每条 clip 的精简 wire format。
 *
 * 跟内部的 {@link ClipRecord} 区别：
 * - 不含 `contentFull`：单条原文可能几十 KB，列表里全带回去太重；
 *   detail 端点 (`GET /clip/:id`) 用 {@link ClipRecordWireFull} 带回去
 * - 不含 `rawVlmResult`：是 VLM debug 元数据，已落到 `<assets>/<id>.json`
 *   sidecar，不该出现在 client 消费的 wire format 里
 */
export interface ClipRecordWire {
  id: string;
  title: string;
  platform: Platform;
  author: string;
  originalUrl: string | null;
  contentType: ContentType;
  contentSummary: string;
  tags: string[];
  category: Category;
  language: string;
  /** vault-relative path, e.g. "snap-mind/assets/clip_xxx.webp" */
  screenshotPath: string;
  fetchLevel: 1 | 2 | 3 | 4;
  sourceConfidence: number;
  /** ISO 8601 string, 原样从 frontmatter 透出 */
  createdAt: string;
}

/**
 * `GET /clip/:id` detail 视图：在 {@link ClipRecordWire} 之上补 `contentFull`。
 *
 * `contentFull` = markdown body 里 `## 原文` 段的全文（已经过 backend 写入
 * 时的 `formatContent` 规整）。fetchLevel=4 失败 record 的段落是"警告 +
 * VLM snippet"的 markdown，原样返回，client 自己渲染。
 *
 * 仅当 `## 原文` 段缺失或纯空白时为 `null`（手工 backfill / 老格式）。
 */
export interface ClipRecordWireFull extends ClipRecordWire {
  contentFull: string | null;
}

/** API 响应 */
export interface ClipResponse {
  success: boolean;
  clipId: string;
  title?: string;
  platform?: Platform;
  tags?: string[];
  category?: Category;
  fetchLevel?: 1 | 2 | 3 | 4;
  /** Vault-relative path to the clip file, e.g. "snap-mind/2026-04-05_twitter_xxx.md" */
  vaultPath?: string;
  error?: string;
  screenshotSaved?: boolean;
  message: string;
}
