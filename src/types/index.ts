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
 * 对外暴露给 client 的 ClipRecord 投影。
 *
 * 跟内部的 {@link ClipRecord} 区别：
 * - 不含 `contentFull`：单条原文可能几十 KB，列表 API 全带回去太重；
 *   client 真要原文时再单独走 detail/raw 端点。
 * - 不含 `rawVlmResult`：是 VLM debug 元数据，已落到 `<assets>/<id>.json`
 *   sidecar，不该出现在 client 消费的 wire format 里。
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
