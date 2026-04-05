# Module: ContentFetcher

> 根据 VLMAnalyzer 的输出，按四级策略尝试获取原文。

## Source Files

- `src/fetcher/index.ts` — 主逻辑（四级策略调度）
- `src/fetcher/opencli.ts` — opencli 调用封装
- `src/fetcher/web-fetch.ts` — Web fetch + LLM 正文提取
- `src/fetcher/search-engine.ts` — L3 搜索引擎调用

## Input / Output

- **Input**: `MergedVLMResult`
- **Output**: `FetchResult { contentFull, originalUrl, fetchLevel }`

## Platform Capability Matrix

| Platform | L1: opencli search+download | L2: opencli search → web fetch | L3: 搜索引擎兜底 |
|----------|------|------|------|
| xiaohongshu | ✅ search + download | - | ✅ |
| twitter | ✅ search + download (thread) | - | ✅ |
| zhihu | ✅ search + question/download | - | ✅ |
| weibo | ❌ | ✅ search → URL → fetch | ✅ |
| reddit | ❌ | ✅ search + read | ✅ |
| bilibili | ✅ search + download (subtitle) | - | ✅ |
| weixin | ✅ download（需完整 URL） | ✅ 需先从截图获取 URL | ✅ |
| 其他/unknown | ❌ | ❌ | ✅ 直接走 L3 |

## Four-Level Strategy

```typescript
async function fetchContent(vlm: MergedVLMResult): Promise<FetchResult> {
  // L1: opencli 直连 (search + download)
  if (PLATFORM_L1_SUPPORT.includes(vlm.platform)) {
    const l1Result = await tryLevel1(vlm);
    if (l1Result) return { ...l1Result, fetchLevel: 1 };
  }

  // L2: opencli search → 拿 URL → web fetch
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

### L1: opencli Direct (e.g. xiaohongshu)

```bash
# Step 1: 搜索
opencli xiaohongshu search "{keywords}" --limit 5 --format json

# Step 2: 从搜索结果中匹配最相关的（title/author 匹配）

# Step 3: 下载完整内容
opencli xiaohongshu download {note_id} --output ./tmp --format json
```

### L2: opencli Search → Web Fetch (e.g. weibo)

```bash
# Step 1: 搜索获取 URL
opencli weibo search "{keywords}" --limit 5 --format json

# Step 2: puppeteer/playwright 访问 URL

# Step 3: LLM 提取正文 → markdown
```

### L3: Search Engine Fallback

```bash
# Step 1: 构造查询 (platform + author + title/contentSnippet)
# Step 2: Google Custom Search 或 Bing API
# Step 3: Web fetch + LLM 提取正文
```

## opencli Invocation

```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function runOpencliRs(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync("opencli", args, {
    timeout: 15000,
    env: { ...process.env },
  });
  return JSON.parse(stdout);
}
```

## Timeout Configuration

| Level | Timeout |
|-------|---------|
| L1 | 15s |
| L2 | 20s |
| L3 | 20s |
| Overall | 60s |
