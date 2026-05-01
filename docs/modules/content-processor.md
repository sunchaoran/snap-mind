# 模块：ContentProcessor

> 对获取到的内容进行 LLM 加工——生成摘要、打标签、分类、检测语言。

## 源文件

- `src/processor/index.ts` — 主逻辑

## 输入 / 输出

- **Input**: `VLMAnalysis` + `FetchResult`
- **Output**: `ProcessedContent { summary, tags, category, language }`

## 模型

单模型调用，通过 `src/vlm/llm-client.ts` 暴露的 OpenAI 兼容客户端，provider 由全局开关 `LLM_PROVIDER_TARGET` 决定（`openrouter` | `local`）。

默认模型按 active provider 取：
- OpenRouter：`OPENROUTER_PROCESSOR_MODEL`，默认 `moonshotai/kimi-k2.5`
- 本地 server：`LOCAL_PROCESSOR_MODEL`（无默认，必须显式设置为本地加载的模型 ID）

## Prompt 设计

System prompt 从文件 `src/prompts/processor.md` 加载，而非硬编码。

### User Message 模板

```
标题: {title ?? "未知"}
来源: {platform}
内容:
{content（截取前 32,000 字符）}
```

### 内容来源优先级

```typescript
const content = fetchResult.contentFull ?? vlm.contentSnippet ?? vlm.title ?? "";
```

1. 优先使用抓取到的原文 (`contentFull`)
2. 降级到 VLM 提取的内容片段 (`contentSnippet`)
3. 最终降级到标题 (`title`)

## 特殊情况

### fetchLevel = 4（无原文）

- 用 VLM 提取的 `contentSnippet` 或 `title` 作为输入
- 摘要开头自动标注"（基于截图识别，未获取到原文）"

### 内容过长

- 超过 32,000 字符时截取前 32,000 字符
