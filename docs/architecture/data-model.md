# Data Model

## 1. ClipRecord (Core Data Structure)

ClipWriter 的入参，所有模块的输出最终汇聚为这一个结构。

```typescript
interface ClipRecord {
  /** 全局唯一 ID，格式: clip_{yyyyMMdd}_{HHmmss}_{4位短hash} */
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

  /** 原始截图的本地路径 */
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

## 2. Enums

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

## 3. VLM Types

### VLMResult (Single Model Output)

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

### MergedVLMResult (Voting-Merged Result)

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

  /** 三个模型的原始结果，用于 debug */
  rawResults: {
    claude: VLMResult;
    gemini: VLMResult;
    gpt4o: VLMResult;
  };
}
```

## 4. Module IO Types

### FetchResult (ContentFetcher Output)

```typescript
interface FetchResult {
  contentFull: string | null;
  originalUrl: string | null;
  fetchLevel: 1 | 2 | 3 | 4;
}
```

### ProcessedContent (ContentProcessor Output)

```typescript
interface ProcessedContent {
  summary: string;
  tags: string[];
  category: Category;
  language: string;
}
```

## 5. ID Format

```
clip_{yyyyMMdd}_{HHmmss}_{4位短hash}

Example: clip_20260402_143000_a3f2
```
