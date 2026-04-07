# Module: ContentProcessor

> 对获取到的内容进行 LLM 加工——生成摘要、打标签、分类、检测语言。

## Source Files

- `src/processor/index.ts` — 主逻辑

## Input / Output

- **Input**: `MergedVLMResult` + `FetchResult`
- **Output**: `ProcessedContent { summary, tags, category, language }`

## Model

单模型调用（不需要交叉验证），通过 OpenRouter 调用。

默认模型通过环境变量 `PROCESSOR_MODEL` 配置，默认值 `moonshotai/kimi-k2.5`。

## Prompt Design

System prompt 从文件 `src/prompts/processor.md` 加载，而非硬编码。

### User Message 模板

```
标题: {title ?? "未知"}
来源: {platform}
内容:
{content（截取前 32,000 字符）}
```

### Content 来源优先级

```typescript
const content = fetchResult.contentFull ?? vlm.contentSnippet ?? vlm.title ?? "";
```

1. 优先使用抓取到的原文 (`contentFull`)
2. 降级到 VLM 提取的内容片段 (`contentSnippet`)
3. 最终降级到标题 (`title`)

## Special Cases

### fetchLevel = 4 (No Original Content)

- 用 VLM 提取的 `contentSnippet` 或 `title` 作为输入
- 摘要开头自动标注"（基于截图识别，未获取到原文）"

### Content Too Long

- 超过 32,000 字符时截取前 32,000 字符
