# Module: VLMAnalyzer

> 三模型并发分析截图，投票合并出结构化信息。

## Source Files

- `src/vlm/analyzer.ts` — 主逻辑
- `src/vlm/openrouter.ts` — OpenRouter API 客户端
- `src/vlm/prompt.ts` — VLM prompt 模板
- `src/vlm/merger.ts` — 投票合并逻辑

## Input / Output

- **Input**: `imageBuffer: Buffer` (截图二进制)
- **Output**: `MergedVLMResult` (see [data-model](../architecture/data-model.md))

## Models

通过 OpenRouter API 统一调用：

| Model | Provider |
|-------|----------|
| `anthropic/claude-sonnet-4-20250514` | Anthropic |
| `google/gemini-2.5-flash` | Google |
| `openai/gpt-4o` | OpenAI |

## Prompt Design

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

## Voting & Merge Logic

```typescript
function mergeVLMResults(claude, gemini, gpt4o): MergedVLMResult {
  // 1. Platform: 三取二投票；三个都不同取 confidence 最高的
  // 2. Author: 文本相似度 ≥ 0.8，两个以上一致就采纳
  // 3. Title: 文本相似度 ≥ 0.7，两个以上一致就采纳
  // 4. Keywords: 取并集，去重
  // 5. 其余字段: 取非 null 值，优先 confidence 最高的模型
  // 6. 整体置信度: 基于 platform 一致性 + 各字段覆盖度
}
```

## Constraints

- 三个模型 **并发** 调用，不串行等待
- 每个模型调用设 **30 秒** 超时，超时视为该模型结果缺失
- 1-2 个模型返回结果时，用可用结果合并
- 0 个模型返回结果时，整体失败，走错误处理
