# Module: ContentProcessor

> 对获取到的内容进行 LLM 加工——生成摘要、打标签、分类、检测语言。

## Source Files

- `src/processor/index.ts` — 主逻辑

## Input / Output

- **Input**: `MergedVLMResult` + `FetchResult`
- **Output**: `ProcessedContent { summary, tags, category, language }`

## Model

单模型调用（不需要交叉验证），通过 OpenRouter 使用性价比最高的模型。

推荐：`anthropic/claude-sonnet-4-20250514` 或 `google/gemini-2.5-flash`

## Prompt Design

```
System Prompt:
你是一个内容整理助手。对给定的文章内容进行结构化处理。

请返回以下 JSON 格式：

{
  "summary": "3-5 句话的核心摘要，概括文章最重要的信息和观点",
  "tags": ["3-5个具体标签，偏具体而非抽象，如 'rust' 而非 'programming'"],
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

## Special Cases

### fetchLevel = 4 (No Original Content)

- 用 VLM 提取的 `contentSnippet` + `title` 作为输入
- 摘要基于截图可见信息生成
- 摘要开头标注"（基于截图识别，未获取到原文）"

### Content Too Long

- 超过模型 context window 时，截取前 **8000 tokens**
