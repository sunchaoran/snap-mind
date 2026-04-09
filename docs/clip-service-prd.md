# ClipService - 产品技术文档

> 截图即收藏：从截图到结构化知识库的自动化管道
> 
> 本文档供 Coding Agent 实现使用，包含完整的架构设计、模块规范和实现细节。

---

## 1. 产品概述

### 1.1 解决的问题

用户在浏览手机 App（Twitter、小红书、Reddit、微博、知乎等）时，看到感兴趣的内容想收藏，但只想做最轻量的动作——截图。ClipService 接收截图后，自动完成内容识别、原文获取、摘要生成、标签分类，最终存入 Obsidian vault，形成结构化的个人知识库。

### 1.2 用户流程

```
用户截图 → 发送到微信 → 龙虾(OpenClew Agent) 接收
→ A2A 调用 ClipService HTTP API → 自动处理
→ 龙虾回复微信确认："已收藏: 标题 [平台] #tag1 #tag2"
```

### 1.3 部署环境

- **运行环境**：Mac mini，本地常驻 Node.js 服务
- **依赖服务**：Chrome 浏览器（保持各平台登录态）、opencli-rs CLI 工具、OpenRouter API
- **存储**：本地 Obsidian vault
- **未来扩展**：DynamoDB 双写 + Web App 可视化（不在本版本范围内）

---

## 2. 系统架构

### 2.1 架构总览

```
龙虾 (OpenClew Agent)
    │
    │  HTTP POST /clip  (image binary)
    ▼
┌─────────────────────────────────────────────────┐
│                  ClipService                     │
│                                                  │
│  ┌─────────────┐                                │
│  │  A2AServer   │  HTTP 服务，接收截图            │
│  └──────┬──────┘                                │
│         ▼                                        │
│  ┌─────────────┐                                │
│  │ VLMAnalyzer  │  三模型并发识别 + 投票合并      │
│  └──────┬──────┘                                │
│         ▼                                        │
│  ┌──────────────┐                               │
│  │ContentFetcher│  四级策略获取原文               │
│  └──────┬───────┘                               │
│         ▼                                        │
│  ┌────────────────┐                             │
│  │ContentProcessor│  摘要 / 标签 / 分类          │
│  └──────┬─────────┘                             │
│         ▼                                        │
│  ┌─────────────┐                                │
│  │  ClipWriter  │  write driver 抽象层           │
│  │  └─MarkdownWriter│  第一版实现               │
│  └──────────────┘                                │
│                                                  │
│  外部依赖：                                      │
│  ├─ OpenRouter API (Claude/Gemini/GPT-4o)       │
│  ├─ opencli-rs (本地 CLI)                        │
│  └─ Obsidian vault (本地文件系统)                │
└─────────────────────────────────────────────────┘
```

### 2.2 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js (>=20) | 主开发语言 |
| HTTP 框架 | Fastify 或 Express | 轻量，接收截图 |
| LLM 网关 | OpenRouter API | 统一调用 Claude / Gemini / GPT-4o |
| 内容抓取 | opencli-rs | 55+ 平台支持，Browser 模式复用 Chrome 登录态 |
| Web Fetch 兜底 | puppeteer 或 playwright | L2/L3 级别的页面抓取 |
| 存储 | 本地文件系统 (Obsidian vault) | Markdown + 截图文件 |
| 进程管理 | PM2 或 launchd | Mac mini 上常驻运行 |

---

## 3. 数据模型

### 3.1 ClipRecord（核心数据结构）

这是 ClipWriter 的入参，所有模块的输出最终汇聚为这一个结构。

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

### 3.2 VLM 相关类型

```typescript
/** 单个 VLM 模型的输出 */
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

/** 三模型投票合并后的结果 */
interface MergedVLMResult {
  /** 合并后的确定结果 */
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

/** ContentFetcher 的输出 */
interface FetchResult {
  contentFull: string | null;
  originalUrl: string | null;
  fetchLevel: 1 | 2 | 3 | 4;
}

/** ContentProcessor 的输出 */
interface ProcessedContent {
  summary: string;
  tags: string[];
  category: Category;
  language: string;
}
```

---

## 4. 模块详细设计

### 4.1 A2AServer

**职责**：HTTP 服务，接收龙虾发来的截图，触发处理流程，返回结果。

**接口定义**：

```
POST /clip
Content-Type: multipart/form-data

Body:
  - image: 截图文件 (png/jpg/webp)

Response 200:
{
  "success": true,
  "clipId": "clip_20260402_143000_a3f2",
  "title": "Rust 异步编程指南",
  "platform": "xiaohongshu",
  "tags": ["rust", "async", "编程"],
  "category": "tech",
  "fetchLevel": 1,
  "message": "已收藏: Rust 异步编程指南 [小红书] #rust #async #编程"
}

Response 500:
{
  "success": false,
  "clipId": "clip_20260402_143000_a3f2",
  "error": "All fetch levels failed",
  "screenshotSaved": true,
  "message": "处理失败，已保存原始截图，请稍后重试"
}
```

**实现要点**：

- 收到请求后立即生成 `clipId`，保存截图到临时目录
- 整个处理流程同步串行执行，整体超时 90 秒
- 处理成功或失败都返回 `message` 字段，龙虾直接用这个回复微信
- 失败时截图已保存到 Obsidian vault 的 assets 目录，标记为待重试

---

### 4.2 VLMAnalyzer

**职责**：用三个 VLM 模型并发分析截图，投票合并出结构化信息。

**调用方式**：通过 OpenRouter API 统一调用三个模型。

```
OpenRouter Models:
  - anthropic/claude-sonnet-4-20250514
  - google/gemini-2.5-flash
  - openai/gpt-4o
```

> 具体模型版本可通过配置文件调整，上面仅为初始推荐。

**Prompt 设计**：

三个模型使用完全相同的 prompt + 截图，要求返回统一的 JSON 结构。

```
System Prompt:
你是一个截图分析专家。用户会发送一张来自手机 App 的截图，你需要：
1. 识别截图来自哪个平台（根据 UI 特征、logo、配色、布局判断）
2. 提取能帮助定位原始内容的所有关键信息

支持的平台列表及其视觉特征：
- xiaohongshu: 红色主题，底部有"首页/购物/消息/我"导航
- twitter: X logo，黑白为主，推文格式
- reddit: 橙色箭头，subreddit 名称以 r/ 开头
- weibo: 橙色主题，微博 logo，@用户名格式
- zhihu: 蓝色主题，"知乎"字样，问答格式
- weixin: 微信公众号文章，绿色元素
- bilibili: 粉蓝色主题，bilibili logo
- douban: 绿色主题，豆瓣评分
- hackernews: 橙色顶栏，极简排版
- youtube: 红色播放按钮，视频缩略图
- medium: 简洁排版，M logo
- substack: 订阅邮件风格

请严格以下面的 JSON 格式返回，对于不确定的字段返回 null，不要猜测：

{
  "platform": "平台标识，必须是上述列表之一，无法确定时用 unknown",
  "confidence": 0.0-1.0,
  "author": "作者/用户名，截图中可见的",
  "title": "标题或内容的第一句话",
  "keywords": ["从截图内容中提取的关键词，3-5个"],
  "publishTime": "如果截图中可见发布时间，ISO 8601 格式",
  "visibleUrl": "如果截图中可见 URL 或链接",
  "contentSnippet": "截图中可见的正文内容片段，尽可能完整",
  "contentType": "post | article | comment | video | thread"
}

仅返回 JSON，不要有任何其他文字。
```

**投票合并逻辑**：

```typescript
function mergeVLMResults(
  claude: VLMResult,
  gemini: VLMResult,
  gpt4o: VLMResult
): MergedVLMResult {
  const results = [claude, gemini, gpt4o];

  // 1. Platform 投票: 三取二；三个都不同取 confidence 最高的
  const platformVotes = [claude.platform, gemini.platform, gpt4o.platform];
  const platform = majorityVote(platformVotes)
    ?? highestConfidence(results).platform
    ?? "unknown";

  // 2. Author: 文本相似度匹配，两个以上一致就采纳
  const author = textConsensus(
    [claude.author, gemini.author, gpt4o.author],
    0.8  // 相似度阈值
  );

  // 3. Title: 同 author 逻辑
  const title = textConsensus(
    [claude.title, gemini.title, gpt4o.title],
    0.7
  );

  // 4. Keywords: 取并集，去重
  const keywords = uniqueKeywords([
    ...claude.keywords,
    ...gemini.keywords,
    ...gpt4o.keywords,
  ]);

  // 5. 其余字段: 取非 null 值，优先取 confidence 最高的模型
  // ...

  // 6. 整体置信度: 基于 platform 一致性 + 各字段覆盖度计算
  const confidence = calculateOverallConfidence(results, platform);

  return { platform, author, title, keywords, confidence, /* ... */ };
}
```

**关键实现细节**：

- 三个模型 **并发** 调用，不串行等待
- 每个模型调用设 30 秒超时，超时视为该模型结果缺失
- 如果只有 1-2 个模型返回结果，仍然继续流程，用可用结果合并
- 如果 0 个模型返回结果，整体失败，走错误处理

---

### 4.3 ContentFetcher

**职责**：根据 VLMAnalyzer 的输出，按四级策略尝试获取原文。

**输入**：`MergedVLMResult`
**输出**：`FetchResult`

**平台能力矩阵**（决定了每个平台从哪一级开始尝试）：

| 平台 | L1: opencli-rs search+download | L2: opencli-rs search → web fetch | L3: 搜索引擎兜底 |
|------|------|------|------|
| xiaohongshu | ✅ search + download | - | ✅ |
| twitter | ✅ search + download (thread) | - | ✅ |
| zhihu | ✅ search + question/download | - | ✅ |
| weibo | ❌ 无 download | ✅ search → URL → fetch | ✅ |
| reddit | ❌ 无 download | ✅ search + read | ✅ |
| bilibili | ✅ search + download (subtitle) | - | ✅ |
| weixin | ✅ download（需完整 URL） | ✅ 需先从截图获取 URL | ✅ |
| 其他/unknown | ❌ | ❌ | ✅ 直接走 L3 |

**四级策略实现**：

```typescript
async function fetchContent(vlm: MergedVLMResult): Promise<FetchResult> {
  // L1: opencli-rs 直连 (search + download)
  if (PLATFORM_L1_SUPPORT.includes(vlm.platform)) {
    const l1Result = await tryLevel1(vlm);
    if (l1Result) return { ...l1Result, fetchLevel: 1 };
  }

  // L2: opencli-rs search → 拿 URL → web fetch
  if (PLATFORM_L2_SUPPORT.includes(vlm.platform)) {
    const l2Result = await tryLevel2(vlm);
    if (l2Result) return { ...l2Result, fetchLevel: 2 };
  }

  // L3: 搜索引擎兜底
  const l3Result = await tryLevel3(vlm);
  if (l3Result) return { ...l3Result, fetchLevel: 3 };

  // L4: 全部失败
  return { contentFull: null, originalUrl: null, fetchLevel: 4 };
}
```

**L1 实现细节** (以小红书为例)：

```bash
# Step 1: 搜索
opencli-rs xiaohongshu search "{keywords}" --limit 5 --format json

# Step 2: 从搜索结果中匹配最相关的（用 title/author 匹配）

# Step 3: 下载完整内容
opencli-rs xiaohongshu download {note_id} --output ./tmp --format json
```

**L2 实现细节** (以微博为例)：

```bash
# Step 1: 搜索获取 URL
opencli-rs weibo search "{keywords}" --limit 5 --format json
# 从结果中提取原文 URL

# Step 2: Web fetch 抓取页面
# 使用 puppeteer/playwright 访问 URL，等待页面加载

# Step 3: LLM 提取正文
# 将页面 HTML 发给 LLM，要求提取正文内容并转为 markdown
```

**L3 实现细节**：

```bash
# Step 1: 构造搜索查询
# 组合: platform名 + author + title 或 contentSnippet

# Step 2: 使用搜索引擎 API（Google Custom Search 或 Bing）
# 找到最匹配的 URL

# Step 3: Web fetch + LLM 提取正文（同 L2 Step 2-3）
```

**超时配置**：

| 级别 | 超时 |
|------|------|
| L1 | 15 秒 |
| L2 | 20 秒 |
| L3 | 20 秒 |
| 整体 | 60 秒 |

**opencli-rs 调用方式**：

通过 Node.js `child_process.execFile` 调用本地二进制。

```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function runOpencliRs(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync("opencli-rs", args, {
    timeout: 15000,
    env: { ...process.env },
  });
  return JSON.parse(stdout);
}
```

---

### 4.4 ContentProcessor

**职责**：对获取到的内容进行 LLM 加工——生成摘要、打标签、分类、检测语言。

**调用方式**：单模型调用（不需要交叉验证），通过 OpenRouter 使用性价比最高的模型。推荐 `anthropic/claude-sonnet-4-20250514` 或 `google/gemini-2.5-flash`。

**Prompt 设计**：

```
System Prompt:
你是一个内容整理助手。对给定的文章内容进行结构化处理。

请返回以下 JSON 格式：

{
  "summary": "3-5 句话的核心摘要，概括文章最重要的信息和观点",
  "tags": ["3-5个具体标签，偏具体而非抽象，如 'rust' 而非 'programming'"；不允许有空格，可以有中割线，如 'open-source' 而非 'open source'],
  "category": "从以下枚举中选一个最匹配的: tech | design | product | business | finance | science | life | culture | career | other",
  "language": "内容的主要语言，如 zh、en、ja"
}

仅返回 JSON，不要有任何其他文字。

User Message:
标题: {title}
来源: {platform}
内容:
{contentFull 或 contentSnippet（fetchLevel=4 时用 VLM 提取的片段）}
```

**特殊情况处理**：

- `fetchLevel = 4`（未获取到原文）：用 VLM 提取的 `contentSnippet` + `title` 作为输入，摘要基于截图可见信息生成，并在摘要开头标注"（基于截图识别，未获取到原文）"
- 内容过长（超过模型 context window）：截取前 8000 tokens

---

### 4.5 ClipWriter

**职责**：write driver 抽象层，第一版实现 MarkdownWriter。

**接口定义**：

```typescript
interface ClipWriter {
  /** 写入一条收藏记录 */
  write(record: ClipRecord): Promise<void>;

  /** 检查是否已存在（去重） */
  exists(id: string): Promise<boolean>;

  /** 模糊去重：检查是否有高度相似的条目 */
  findSimilar(platform: string, author: string | null, title: string | null): Promise<string | null>;
}
```

**MarkdownWriter 实现**：

**Obsidian Vault 目录结构**：

```
{VAULT_PATH}/
  snap-mind/
    _index.md                                    # Dataview 汇总页（自动生成）
    2026-04-02_xiaohongshu_rust-async-guide.md
    2026-04-02_twitter_llm-agent-pattern.md
    ...
    assets/
      clip_20260402_143000_a3f2.png              # 原始截图
      clip_20260402_143000_a3f2.json             # rawVlmResult sidecar
```

**文件命名规则**：`{yyyy-MM-dd}_{platform}_{title_slug}.md`

- `title_slug`：标题转小写，非字母数字字符替换为 `-`，截取前 50 字符
- 若文件名冲突，追加 `-2`、`-3`

**Markdown 文件模板**：

```markdown
---
id: clip_20260402_143000_a3f2
title: "Rust 异步编程指南"
platform: xiaohongshu
author: "某用户名"
originalUrl: "https://www.xiaohongshu.com/explore/xxx"
contentType: post
tags:
  - rust
  - async
  - 编程
category: tech
language: zh
fetchLevel: 1
sourceConfidence: 0.95
createdAt: 2026-04-02T14:30:00+08:00
---

## 摘要

Rust 的异步编程模型基于 Future trait 和 async/await 语法，本文梳理了 tokio 运行时的核心概念……

## 原文

（完整原文，markdown 格式化后的内容）

## 截图

![[assets/clip_20260402_143000_a3f2.png|420]]
```

**fetchLevel=4 时的模板变体**：

```markdown
---
# ...同上，但 fetchLevel: 4, originalUrl: null
---

## 摘要

（基于截图识别，未获取到原文）根据截图内容，这是一篇关于……

## 原文

> ⚠️ 未能获取原文。以下为截图中识别到的内容片段：

{contentSnippet from VLM}

## 截图

![[assets/clip_20260402_143000_a3f2.png|420]]
```

**_index.md（Dataview 汇总页）**：

```markdown
# 📋 snap-mind

## 最近收藏

\```dataview
TABLE platform, category, tags, sourceConfidence
FROM "snap-mind"
WHERE id != null
SORT createdAt DESC
LIMIT 50
\```

## 按平台统计

\```dataview
TABLE length(rows) as "数量"
FROM "snap-mind"
WHERE id != null
GROUP BY platform
SORT length(rows) DESC
\```

## 待补充原文

\```dataview
TABLE title, platform, createdAt
FROM "snap-mind"
WHERE fetchLevel = 4
SORT createdAt DESC
\```
```

**去重逻辑**：

`findSimilar` 方法扫描 snap-mind 目录下已有 md 文件的 frontmatter，比对 `platform + author + title`。使用简单的字符串相似度（Levenshtein 或 Jaccard），阈值 0.85 以上视为重复。返回已存在的 clipId 或 null。

---

### 4.6 ScreenshotStore

**职责**：管理截图文件的存储。

```typescript
interface ScreenshotStore {
  /** 保存截图到 vault assets 目录，返回相对路径 */
  save(clipId: string, imageBuffer: Buffer, ext: string): Promise<string>;
}
```

实现逻辑：将截图从临时目录复制到 `{VAULT_PATH}/snap-mind/assets/{clipId}.{ext}`。

---

## 5. 完整处理流程

### 5.1 正常流程（伪代码）

```typescript
async function handleClipRequest(imageBuffer: Buffer): Promise<ClipResponse> {
  // 1. 生成 ID，保存截图到临时目录
  const clipId = generateClipId();  // clip_{yyyyMMdd}_{HHmmss}_{4位hash}
  const tempScreenshotPath = saveTempScreenshot(clipId, imageBuffer);

  // 2. VLM 分析（三模型并发）
  const vlmResult: MergedVLMResult = await vlmAnalyzer.analyze(imageBuffer);

  // 3. 去重检查
  const existingId = await clipWriter.findSimilar(
    vlmResult.platform,
    vlmResult.author,
    vlmResult.title
  );
  if (existingId) {
    return {
      success: true,
      clipId: existingId,
      message: `已存在相似收藏 (${existingId})，跳过`,
    };
  }

  // 4. 获取原文
  const fetchResult: FetchResult = await contentFetcher.fetch(vlmResult);

  // 5. 内容加工（摘要/标签/分类）
  const processed: ProcessedContent = await contentProcessor.process(
    vlmResult,
    fetchResult
  );

  // 6. 保存截图到 vault
  const screenshotPath = await screenshotStore.save(
    clipId,
    imageBuffer,
    "png"
  );

  // 7. 组装 ClipRecord
  const record: ClipRecord = {
    id: clipId,
    title: vlmResult.title ?? "未知标题",
    platform: vlmResult.platform,
    author: vlmResult.author ?? "未知作者",
    originalUrl: fetchResult.originalUrl,
    contentType: vlmResult.contentType,
    contentFull: fetchResult.contentFull,
    contentSummary: processed.summary,
    tags: processed.tags,
    category: processed.category,
    language: processed.language,
    screenshotPath: screenshotPath,
    fetchLevel: fetchResult.fetchLevel,
    sourceConfidence: vlmResult.confidence,
    createdAt: new Date().toISOString(),
    rawVlmResult: vlmResult,
  };

  // 8. 写入 Obsidian
  await clipWriter.write(record);

  // 9. 保存 sidecar JSON
  await saveSidecarJson(clipId, vlmResult);

  // 10. 返回结果
  const tagStr = processed.tags.map((t) => `#${t}`).join(" ");
  return {
    success: true,
    clipId: clipId,
    title: record.title,
    platform: record.platform,
    tags: processed.tags,
    category: processed.category,
    fetchLevel: fetchResult.fetchLevel,
    message: `已收藏: ${record.title} [${record.platform}] ${tagStr}`,
  };
}
```

### 5.2 错误处理

```typescript
// 整体 try-catch 包裹
try {
  return await handleClipRequest(imageBuffer);
} catch (error) {
  // 确保截图已保存（即使处理失败）
  await screenshotStore.save(clipId, imageBuffer, "png");

  // 写入一条最小化的失败记录到 Obsidian
  await clipWriter.write({
    id: clipId,
    title: "处理失败 - 待重试",
    platform: "unknown",
    fetchLevel: 4,
    // ... 其他字段填默认值
  });

  return {
    success: false,
    clipId: clipId,
    error: error.message,
    screenshotSaved: true,
    message: `处理失败，已保存原始截图，请稍后重试`,
  };
}
```

---

## 6. 配置

所有可配置项集中在一个配置文件中：

```typescript
// config.ts
export const config = {
  // HTTP 服务
  server: {
    port: 3210,
    host: "0.0.0.0",
  },

  // OpenRouter
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseUrl: "https://openrouter.ai/api/v1",
    models: {
      vlm: [
        "anthropic/claude-sonnet-4-20250514",
        "google/gemini-2.5-flash",
        "openai/gpt-4o",
      ],
      processor: "google/gemini-2.5-flash", // 摘要/标签用，性价比优先
    },
  },

  // opencli-rs
  opencliRs: {
    binaryPath: "/usr/local/bin/opencli-rs",
    timeout: 15000, // 单次调用超时 ms
  },

  // Obsidian Vault
  vault: {
    basePath: process.env.OBSIDIAN_VAULT_PATH!, // e.g. /Users/chaoran/ObsidianVault
    clippingsDir: "snap-mind",
    assetsDir: "snap-mind/assets",
  },

  // 处理参数
  processing: {
    overallTimeout: 90000,  // 整体超时 ms
    fetchTimeouts: {
      l1: 15000,
      l2: 20000,
      l3: 20000,
    },
    vlmTimeout: 30000,       // 单个 VLM 模型超时
    similarityThreshold: 0.85, // 去重相似度阈值
  },

  // L3 搜索引擎（可选）
  searchEngine: {
    provider: "google", // google | bing
    apiKey: process.env.SEARCH_API_KEY,
    cx: process.env.GOOGLE_CX, // Google Custom Search Engine ID
  },
};
```

---

## 7. 项目结构

```
clip-service/
├── package.json
├── tsconfig.json
├── .env                        # 环境变量
├── src/
│   ├── index.ts                # 入口，启动 HTTP 服务
│   ├── config.ts               # 配置定义
│   ├── server/
│   │   └── routes.ts           # HTTP 路由 (POST /clip)
│   ├── vlm/
│   │   ├── analyzer.ts         # VLMAnalyzer 主逻辑
│   │   ├── openrouter.ts       # OpenRouter API 客户端
│   │   ├── prompt.ts           # VLM prompt 模板
│   │   └── merger.ts           # 投票合并逻辑
│   ├── fetcher/
│   │   ├── index.ts            # ContentFetcher 主逻辑（四级策略调度）
│   │   ├── opencli.ts          # opencli-rs 调用封装
│   │   ├── web-fetch.ts        # Web fetch 抓取 + LLM 正文提取
│   │   └── search-engine.ts    # L3 搜索引擎调用
│   ├── processor/
│   │   └── index.ts            # ContentProcessor (摘要/标签/分类)
│   ├── writer/
│   │   ├── interface.ts        # ClipWriter 接口定义
│   │   ├── markdown.ts         # MarkdownWriter 实现
│   │   └── template.ts         # Markdown 模板渲染
│   ├── store/
│   │   └── screenshot.ts       # ScreenshotStore
│   ├── utils/
│   │   ├── id.ts               # clipId 生成
│   │   ├── slug.ts             # title slug 生成
│   │   └── similarity.ts       # 文本相似度计算
│   └── types/
│       └── index.ts            # 所有 TypeScript 类型定义
└── test/
    ├── vlm/
    ├── fetcher/
    ├── processor/
    └── writer/
```

---

## 8. 依赖清单

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/multipart": "^9.x",
    "gray-matter": "^4.x",
    "puppeteer": "^23.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "vitest": "^2.x"
  }
}
```

**系统依赖**（Mac mini 上需预装）：

- Node.js >= 20
- opencli-rs (最新版)
- Chrome 浏览器 + opencli-rs Chrome Extension
- PM2 (`npm install -g pm2`) 用于进程管理

---

## 9. 未来扩展（不在本版本范围）

以下功能记录在此，供后续版本参考：

1. **DynamoDBWriter**：实现 ClipWriter 接口，ClipRecord 双写到 DynamoDB。partition key = `id`，GSI: `platform-createdAt-index` 和 `category-createdAt-index`，tags 用 String Set 类型。
2. **Web App**：独立项目，Lambda + DynamoDB，提供收藏内容的可视化浏览、搜索、筛选。
3. **重试机制**：Web 后台对 `fetchLevel=4` 的条目手动触发重试。
4. **龙虾回复优化**：第二版回复包含 Web App 链接，可直接跳转查看。
5. **批量处理**：支持一次发送多张截图。
6. **A2A 协议升级**：从简单 HTTP POST 演进为标准 A2A 协议。
