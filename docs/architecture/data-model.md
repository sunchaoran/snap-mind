# 数据模型

> **注**：这里的类型分两层——
>
> - **内部类型**（`ClipRecord`、`MergedVLMResult` 等）：backend 内部流转，可自由演进
> - **Wire 类型**（`ClipRecordWire`、`ClipRecordWireFull`、错误信封等）：通过 HTTP 暴露，**对客户端是公开契约**，演进受 [api-design.md §3](./api-design.md#3-wire-format-the-public-contract) 的稳定性规则约束
>
> Source of truth 是 [`src/types/index.ts`](../../src/types/index.ts)（V1 后会拆成 `types/wire.ts` + `types/domain.ts`）。

## 1. ClipRecord（核心结构，内部）

ClipWriter 的入参，pipeline 各模块输出汇聚成这一个结构。**不直接通过 wire format 暴露**——客户端拿到的是 ClipRecordWire/Full（见下文）。

```typescript
interface ClipRecord {
  /** 全局唯一 ID，格式: clip_{yyyyMMdd}_{HHmmss}_{6位nanoid} */
  id: string;

  /** 内容标题 */
  title: string;

  /** 来源平台标识 */
  platform: Platform;

  /** 原作者用户名 */
  author: string;

  /** 原文链接，可能为空（fetchLevel=4 时） */
  originalUrl: string | null;

  /** 内容类型 */
  contentType: ContentType;

  /** 完整原文，markdown 格式。fetchLevel=4 时为空 */
  contentFull: string | null;

  /** LLM 生成的 3-5 句摘要 */
  contentSummary: string;

  /** LLM 生成的标签，3-5 个 */
  tags: string[];

  /** 预定义分类枚举 */
  category: Category;

  /** 内容语言 */
  language: string;

  /** 原始截图的 vault 相对路径 */
  screenshotPath: string;

  /** 获取策略级别 1-4 */
  fetchLevel: 1 | 2 | 3 | 4;

  /** VLM 投票合并后的整体置信度 0-1 */
  sourceConfidence: number;

  /** 创建时间 ISO 8601 */
  createdAt: string;

  /** VLM 投票合并后的原始结构，debug 用 */
  rawVlmResult: MergedVLMResult;
}
```

### ClipRecordWire (List Projection)

`GET /clip` 列表里每条 clip 的精简 wire format。跟内部 `ClipRecord` 区别：

- **去掉 `contentFull`**：单条原文可能几十 KB，列表全带回去太重。
  client 想要原文走 `GET /clip/:id` (detail)。
- **去掉 `rawVlmResult`**：是 VLM 调试 metadata，已落到
  `<assets>/<id>.json` sidecar，不该出现在 client 消费的 wire format 里。

```typescript
interface ClipRecordWire {
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
  /** ISO 8601 string，原样从 frontmatter 透出，不重新 format */
  createdAt: string;
}
```

### ClipRecordWireFull (Detail Projection)

`GET /clip/:id` 单条 detail 视图：在 `ClipRecordWire` 之上补一个
`contentFull`。跟内部 `ClipRecord` 仍然不一样——还是不暴露
`rawVlmResult`。

```typescript
interface ClipRecordWireFull extends ClipRecordWire {
  /**
   * Markdown body 里 `## 原文` 段全文（已经过 backend 写入时的
   * formatContent 规整）。fetchLevel=4 失败 record 的段落是"警告 +
   * VLM snippet"的 markdown，原样返回。`## 原文` 段缺失或纯空白时
   * 为 null。
   */
  contentFull: string | null;
}
```

## 2. 枚举

```typescript
type Platform =
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

type ContentType = "post" | "article" | "comment" | "video" | "thread";

type Category =
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
```

> V1 把"client 是谁"挪到 auth 层（`Principal`），不再以枚举形式暴露给业务代码——
> 详见 [api-design.md §4](./api-design.md#4-auth-architecture)。

## 3. VLM 类型

### VLMResult（单模型输出）

```typescript
interface VLMResult {
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
```

### MergedVLMResult（投票合并后的结果）

```typescript
interface MergedVLMResult {
  platform: Platform;
  author: string | null;
  title: string | null;
  keywords: string[];
  publishTime: string | null;
  visibleUrl: string | null;
  contentSnippet: string | null;
  contentType: ContentType;

  /** 整体置信度 */
  confidence: number;

  /** 各模型的原始结果，用于 debug。key 为模型标识 */
  rawResults: Record<string, VLMResult>;
}
```

## 4. 模块 I/O 类型

### FetchResult（ContentFetcher 输出）

```typescript
interface FetchResult {
  contentFull: string | null;
  originalUrl: string | null;
  fetchLevel: 1 | 2 | 3 | 4;
}
```

### ProcessedContent（ContentProcessor 输出）

```typescript
interface ProcessedContent {
  summary: string;
  tags: string[];
  category: Category;
  language: string;
}
```

### ClipResponse（API 输出，内部 job 结果）

```typescript
interface ClipResponse {
  success: boolean;
  clipId: string;
  title?: string;
  platform?: Platform;
  tags?: string[];
  category?: Category;
  fetchLevel?: 1 | 2 | 3 | 4;
  /** Vault-relative path, e.g. "snap-mind/2026-04-05_twitter_xxx.md" */
  vaultPath?: string;
  error?: string;
  screenshotSaved?: boolean;
  message: string;
}
```

## 5. 错误信封（V1，wire-level）

所有非 2xx 响应使用统一 shape：

```typescript
interface ErrorEnvelope {
  error: {
    code: string;       // STABLE machine-readable，例如 "clip_not_found"
    message: string;    // 人读，可改文案
    details?: unknown;  // 可选上下文
  };
}
```

完整错误码表见 [api-design.md §3](./api-design.md#3-wire-format公开契约)。

## 6. ID 格式

```
clip_{yyyyMMdd}_{HHmmss}_{6位nanoid}

示例: clip_20260402_143000_V1StGX
```

用 `nanoid(6)` 生成 6 位随机字符串，配合时间戳保证全局唯一。
