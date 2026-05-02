/**
 * 内部 domain 类型 — pipeline / vlm / fetcher / writer 等模块共用的核心
 * 数据结构。这些类型不上 wire（包含 `rawVlmResult`、`contentFull` 等 VLM
 * debug 元数据 / 重字段），客户端永远看不到。
 *
 * 公开/客户端可见的类型放在 {@link ./wire.ts}，会 re-export 这里的枚举
 * （Platform / Category / ContentType）以保持 single source of truth。
 */

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

/** VLM 模型的原始输出（platform / contentType 可能为 null —— 模型确实可能识别不出）。 */
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

/**
 * 分析阶段的输出：在 {@link VLMResult} 基础上为下游消费者填上 platform / contentType 的默认值，
 * 同时保留原始结果用于 debug。
 */
export interface VLMAnalysis {
  platform: Platform;
  contentType: ContentType;
  author: string | null;
  title: string | null;
  keywords: string[];
  publishTime: string | null;
  visibleUrl: string | null;
  contentSnippet: string | null;
  confidence: number;
  /** 模型的原始输出，便于排查 default 后丢失的信号。 */
  rawResult: VLMResult;
}

/** ContentFetcher 的输出 */
export interface FetchResult {
  contentFull: string | null;
  originalUrl: string | null;
  fetchLevel: 1 | 2 | 3 | 4;
}

/** ContentProcessor 的输出 */
export interface ProcessedContent {
  /** LLM 基于正文内容重写的客观标题，去除标题党语气。L4 时基于 VLM snippet 生成，仍非空。 */
  aiTitle: string;
  summary: string;
  tags: string[];
  category: Category;
  language: string;
}

/** 核心数据结构 */
export interface ClipRecord {
  /** 全局唯一 ID，格式: clip_{yyyyMMdd}_{HHmmss}_{4位短hash} */
  id: string;
  /**
   * 主展示标题。新 clip 等于 `aiTitle`（去标题党后的版本）；老 clip 是 VLM
   * 提取的原始标题（兼容字段，前端读 `title` 永远拿到"最干净的可用标题"）。
   */
  title: string;
  /** LLM 基于正文重写的标题。处理失败的占位记录里为 null；老 clip 为 null。 */
  aiTitle: string | null;
  /**
   * VLM 从截图直接提取的标题（可能带标题党/夸张语气）。新写入的 clip 总是非空；
   * 老 clip 通过 frontmatter 里的旧 `title` 字段回退得到。
   */
  originalTitle: string;
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
  rawVlmResult: VLMAnalysis;
}
