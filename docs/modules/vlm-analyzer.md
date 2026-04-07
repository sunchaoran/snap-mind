# Module: VLMAnalyzer

> 两阶段分析：先识别平台，再用平台特定 prompt 并发提取，投票合并出结构化信息。

## Source Files

- `src/vlm/analyzer.ts` — 主逻辑（两阶段分析）
- `src/vlm/openrouter.ts` — OpenRouter API 客户端
- `src/vlm/prompt.ts` — prompt 加载与模板构建
- `src/vlm/merger.ts` — 投票合并逻辑

## Input / Output

- **Input**: `imageBuffer: Buffer` (截图二进制)
- **Output**: `MergedVLMResult` (see [data-model](../architecture/data-model.md))

## Two-Step Analysis Flow

与早期的单步分析不同，当前实现采用两阶段流程：

### Step 1: Platform Identification

使用第一个 VLM 模型 + `vlm-identify.md` prompt 识别截图来源平台。

```typescript
const identifyResult = await callVLMRaw(models[0], dataUrl, VLM_IDENTIFY_PROMPT);
const platform = identifyResult.platform ?? "unknown";
```

### Step 2: Platform-Specific Extraction

根据 Step 1 识别出的平台，构建平台特定的 extract prompt，然后 **所有 VLM 模型并发调用**。

```typescript
const extractPrompt = buildExtractPrompt(platform);
const settled = await Promise.allSettled(
  models.map(model => callVLMRaw(model, dataUrl, extractPrompt))
);
```

这样做的好处：每个平台有针对性的提取规则，提升关键字段的提取精度。

## Model Configuration

模型数量可配置，**必须为单数**（投票机制要求多数胜出）。

| Config | Models | Behavior |
|--------|--------|----------|
| 默认 | 1 个模型 | 单模型直出，不投票 |
| 增强模式 | 3 个模型 | 三取二投票合并 |
| 更高精度 | 5 个模型 | 五取三投票合并 |

### Default Configuration

通过环境变量 `VLM_MODELS` 配置，逗号分隔。默认值为 `moonshotai/kimi-k2.5`（单模型）。

```bash
# 单模型（默认）
VLM_MODELS=moonshotai/kimi-k2.5

# 三模型投票
VLM_MODELS=anthropic/claude-sonnet-4-20250514,google/gemini-2.5-flash,openai/gpt-4o
```

> 启动时校验 `vlm.length` 必须为奇数，否则抛出配置错误。

## Prompt Design

Prompt 从文件系统加载（`src/prompts/` 目录），而非硬编码。

### Prompt 文件结构

```
src/prompts/
├── vlm-identify.md          # Step 1: 平台识别 prompt
├── vlm-extract.md           # Step 2: 提取模板（含 {{PLATFORM}} 和 {{PLATFORM_RULES}} 占位符）
├── processor.md             # ContentProcessor 的 system prompt
└── platforms/
    ├── xiaohongshu.md        # 小红书平台特定规则
    ├── twitter.md            # Twitter 平台特定规则
    ├── bilibili.md
    ├── ...
    └── unknown.md            # 兜底规则
```

### buildExtractPrompt(platform)

```typescript
function buildExtractPrompt(platform: Platform): string {
  // 加载 platforms/{platform}.md，不存在则 fallback 到 platforms/unknown.md
  // 替换 vlm-extract.md 模板中的 {{PLATFORM}} 和 {{PLATFORM_RULES}} 占位符
}
```

## Voting & Merge Logic

```typescript
function mergeVLMResults(results: Record<string, VLMResult>): MergedVLMResult {
  // 单模型: 直接返回，confidence 取模型自身值
  // 多模型: 投票合并
  // 1. Platform: 多数胜出；全不同时取 confidence 最高的
  // 2. Author: 文本相似度 ≥ 0.8，聚类后取多数一致的
  // 3. Title: 文本相似度 ≥ 0.7，聚类后取多数一致的
  // 4. Keywords: 去重合并（大小写不敏感）
  // 5. ContentType: 多数胜出
  // 6. 整体置信度: 加权平均
  //    - 一致性权重 40%
  //    - 字段覆盖度 20%
  //    - 模型置信度 40%
}
```

## Constraints

- Step 2 所有模型 **并发** 调用，不串行等待
- 每个模型调用设 **35 秒** 超时（通过 OpenAI SDK timeout 参数）
- 部分模型返回结果时，用可用结果合并
- 0 个模型返回结果时，整体失败，走错误处理
- 模型数量必须为 **奇数**（1, 3, 5...）
- 图片自动检测 MIME 类型（PNG/JPEG/WEBP/GIF），转 base64 data URL 传给模型
