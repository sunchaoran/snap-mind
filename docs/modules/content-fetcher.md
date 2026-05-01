# 模块：ContentFetcher

> 根据 VLMAnalyzer 的输出，按四级策略尝试获取原文。

## 源文件

- `src/fetcher/index.ts` — 主逻辑（四级策略调度）
- `src/fetcher/opencli.ts` — opencli 调用封装
- `src/fetcher/web-fetch.ts` — Playwright web fetch + LLM 正文提取
- `src/fetcher/search-engine.ts` — L3 搜索引擎调用（Google/Bing）

## 输入 / 输出

- **Input**: `VLMAnalysis`
- **Output**: `FetchResult { contentFull, originalUrl, fetchLevel }`

## 平台能力矩阵

| Platform | L1: opencli search | L2: web fetch | L3: 搜索引擎兜底 |
|----------|------|------|------|
| xiaohongshu | ✅ L1.a author-first + L1.b keyword | ✅ visibleUrl / Playwright / opencli→URL | ✅ |
| twitter | ✅ L1.b keyword search | ✅ visibleUrl / Playwright | ✅ |
| zhihu | ✅ L1.b keyword search | ✅ visibleUrl / Playwright | ✅ |
| bilibili | ✅ L1.a author-first + L1.b keyword | ✅ visibleUrl / Playwright | ✅ |
| weixin | ✅ L1.b keyword search | ✅ visibleUrl / Playwright / opencli→URL | ✅ |
| weibo | ❌ | ✅ visibleUrl / Playwright / opencli→URL | ✅ |
| reddit | ❌ | ✅ visibleUrl / Playwright / opencli→URL | ✅ |
| 其他/unknown | ❌ | ❌ | ✅ 直接走 L3 |

## 四级策略

```typescript
async function fetchContent(vlm: VLMAnalysis): Promise<FetchResult> {
  // L1: opencli search
  if (L1_SUPPORT.includes(vlm.platform)) {
    // L1.a: author-first strategy (xiaohongshu, bilibili)
    // L1.b: keyword search fallback
    const l1 = await tryWithTimeout(() => tryLevel1(vlm), config.fetchTimeouts.l1);
    if (l1) return { ...l1, fetchLevel: 1 };
  }

  // L2: platform-aware web fetch
  if (L2_SUPPORT.includes(vlm.platform)) {
    // L2.a: visibleUrl → direct fetch
    // L2.b: Playwright platform site search
    // L2.c: opencli search → URL → web fetch (仅当 L1 未覆盖的平台)
    const l2 = await tryWithTimeout(() => tryLevel2(vlm), config.fetchTimeouts.l2);
    if (l2) return { ...l2, fetchLevel: 2 };
  }

  // L3: 搜索引擎 → web fetch + LLM extract
  const l3 = await tryWithTimeout(() => tryLevel3(vlm), config.fetchTimeouts.l3);
  if (l3) return { ...l3, fetchLevel: 3 };

  // L4: 全部失败
  return { contentFull: null, originalUrl: null, fetchLevel: 4 };
}
```

### maxFetchLevel

通过环境变量 `MAX_FETCH_LEVEL`（默认 4）控制最大尝试级别。若设定级别的获取失败，pipeline 将直接报错而非降级。

### L1: opencli 搜索

L1 包含两个子策略：

#### L1.a: Author-First Strategy

对有 `PlatformUserStrategy` 配置的平台（xiaohongshu, bilibili），优先通过作者定位内容：

```
1. opencli {platform} search "{author}" → 搜索结果
2. 从 author_url 提取 userId（平台特定正则）
3. opencli {platform} user {userId} --limit 30 → 用户帖子列表
4. findBestMatch() 匹配标题 → 找到帖子
5. 若帖子列表已含 content/text，直接使用
6. 否则 opencli {platform} note {postId/url} → 获取详情
```

#### L1.b: Keyword Search Fallback

```
1. buildSearchQuery(vlm) → 构建查询（提取 @handle、keywords、title 片段）
2. opencli {platform} search "{query}" --limit 20 → 搜索
3. findBestMatch() → 取相似度最高的结果（threshold ≥ 0.3）
4. 使用结果的 text/content 字段
```

### L2: 平台感知的 web fetch

L2 包含三个子策略，按顺序尝试：

```
L2.a: visibleUrl → Playwright fetch → LLM extract
L2.b: findPostUrlOnPlatform(vlm) → Playwright 在平台站内搜索 → 提取帖子 URL → fetch
L2.c: opencli search → 取 URL → fetchAndExtract()（仅 L1 未覆盖的平台）
```

**平台站内搜索 URL 提取规则**（web-fetch.ts）：

| Platform | Selector |
|----------|----------|
| twitter | `a[href*="/status/"]` |
| zhihu | `a[href*="/question/"], a[href*="/p/"]` |
| bilibili | `a[href*="/video/"]` |
| xiaohongshu | `a[href*="/explore/"], a[href*="/discovery/item/"]` |

### L3: 搜索引擎兜底

```
1. searchForUrl(vlm) → Google Custom Search 或 Bing API
   查询格式: site:{domain} {author} {title/keywords}
2. fetchAndExtract(url) → Playwright 加载页面 → 去除 script/style/nav → LLM 提取正文
```

需要配置 `SEARCH_API_KEY`（和 Google 需要 `GOOGLE_CX`）。

## opencli 调用

```typescript
async function runOpencli(args: string[]): Promise<unknown> {
  // 通过 child_process.execFile() 调用 opencli 二进制
  // 超时: 120 秒（可配置）
  // 解析 stdout JSON 输出
  // 超时或非零退出码时抛出错误
}
```

## 辅助函数

- **`buildSearchQuery(vlm)`**: 从 VLM 结果构建搜索查询。提取 `@handle`，优先用 keywords 而非 title，清理特殊字符
- **`findBestMatch(items, vlm)`**: 在搜索结果中找最匹配的项。基于 title/snippet/author 的相似度评分（min threshold 0.3）
- **`normalizeSearchResults(raw)`**: 统一处理 opencli 返回格式（数组、`{data: [...]}`, `{results: [...]}`, `{items: [...]}`)
- **`extractDetailContent(detail)`**: 从详情接口提取内容，支持 `{field, value}[]` 和扁平对象两种格式

## 超时配置

| Level | Timeout | Description |
|-------|---------|-------------|
| L1 | 100s | opencli search + author strategy |
| L2 | 50s | Playwright web fetch |
| L3 | 50s | 搜索引擎 API + web fetch |
| Overall | 300s | 整体 pipeline 超时 |

每个 level 独立使用 `tryWithTimeout()` 包裹，超时返回 null 后降级到下一级。
