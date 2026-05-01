# 模块：VLMAnalyzer

> 两阶段单模型分析：先识别平台，再用平台特定 prompt 提取结构化字段。

## 源文件

- `src/vlm/analyzer.ts` — 主逻辑（两阶段分析）
- `src/vlm/llm-client.ts` — OpenAI 兼容客户端工厂；按 `LLM_PROVIDER_TARGET` 选 OpenRouter 或本地 server
- `src/vlm/prompt.ts` — prompt 加载与模板构建

## 输入 / 输出

- **Input**: `imageBuffer: Buffer` (截图二进制)
- **Output**: `VLMAnalysis` (see [data-model](../architecture/data-model.md))

## 两步分析流程

### 第 1 步：平台识别

调用 VLM 模型 + `vlm-identify.md` prompt 识别截图来源平台。

```typescript
const identifyResult = await callVLMRaw(model, dataUrl, VLM_IDENTIFY_PROMPT);
const platform = identifyResult.platform ?? "unknown";
```

### 第 2 步：平台特定提取

根据 Step 1 识别出的平台，构建平台特定的 extract prompt 再次调用同一个模型：

```typescript
const extractPrompt = buildExtractPrompt(platform);
const raw = await callVLMRaw<VLMResult>(model, dataUrl, extractPrompt);
```

每个平台有针对性的提取规则，提升关键字段的抽取精度。

返回前为下游消费者填默认值（`platform` 兜底 `"unknown"`、`contentType` 兜底 `"post"`），同时把 raw 结果原样塞进 `rawResult` 留作 debug。

## 模型配置

单模型，per-provider：

```bash
# OpenRouter（默认 target）
OPENROUTER_VLM_MODEL=moonshotai/kimi-k2.5

# 本地 server（值与 GET <LOCAL_BASE_URL>/models 一致）
LOCAL_VLM_MODEL=qwen2.5-vl-7b-instruct
```

## Prompt 设计

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

## 约束

- 每次调用设 **80 秒** 超时（通过 OpenAI SDK timeout 参数；本地 server 首次 JIT 加载模型可能超时，先 warmup）
- 任一阶段调用失败 → 整体失败，走错误处理
- 图片自动检测 MIME 类型（PNG/JPEG/WEBP/GIF），转 base64 data URL 传给模型
