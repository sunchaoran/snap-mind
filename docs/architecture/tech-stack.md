# Tech Stack

## Core Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (>=24) | 主开发语言 |
| HTTP Framework | Fastify 5 | 原生 multipart 支持，TypeScript 类型推导好，内置 pino 日志 |
| LLM Gateway | OpenRouter API (via `openai` SDK) | 兼容 OpenAI API，切换 baseURL 即可调用多家模型 |
| Content Fetching | opencli | 55+ 平台支持，Browser 模式复用 Chrome 登录态 |
| Web Fetch Fallback | Playwright | `connectOverCDP` 复用 Chrome 登录态，`networkidle` 等待更可靠 |
| Image Processing | sharp (libvips) | 高性能截图压缩：缩放 + WebP 转换 |
| Storage | 本地文件系统 (Obsidian vault) | Markdown + 截图文件 |
| Process Manager | PM2 | 日志/监控开箱即用，跨平台可迁移 |
| Logging | pino (Fastify built-in) | 结构化 JSON 日志，PM2 采集友好 |

## Build & Dev Tooling

| Tool | Purpose |
|------|---------|
| `tsx` | 开发阶段直接运行 TypeScript，零配置 |
| `tsup` | 生产构建，基于 esbuild，秒级打包（ESM only, target Node 24） |
| `vitest` | 测试框架（含 `@vitest/coverage-v8` 覆盖率） |
| `biome` | Linter + Formatter（替代 ESLint + Prettier） |
| Env loading | Node 内置 `--env-file-if-exists`（无需 dotenv） |

## LLM Models

### VLM Analysis (Configurable N-Model Voting)

模型数量可配置，必须为奇数。通过环境变量 `VLM_MODELS`（逗号分隔）配置。

| Provider | Model | Note |
|----------|-------|------|
| Moonshot | kimi-k2.5 | **默认模型** |
| Google | gemini-2.5-flash | 可选 |
| Anthropic | claude-sonnet-4-20250514 | 可选，增强精度 |
| OpenAI | gpt-4o | 可选，增强精度 |

> 通过环境变量 `VLM_MODELS` 调整模型列表。例：`VLM_MODELS=google/gemini-2.5-flash,anthropic/claude-sonnet-4-20250514,openai/gpt-4o`

### Content Processing

| Provider | Model | Purpose |
|----------|-------|---------|
| Moonshot | kimi-k2.5 | 摘要/标签/分类（默认，可通过 `PROCESSOR_MODEL` 环境变量覆盖） |

## Dependencies

### NPM Packages

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/multipart": "^10.x",
    "openai": "^6.x",
    "playwright": "^1.x",
    "gray-matter": "^4.x",
    "dayjs": "^1.x",
    "nanoid": "^5.x",
    "js-levenshtein": "^1.x",
    "semver": "^7.x",
    "pino": "^10.x",
    "sharp": "^0.34.x"
  },
  "devDependencies": {
    "typescript": "^6.x",
    "@types/node": "^24.x",
    "@types/js-levenshtein": "^1.x",
    "@types/semver": "^7.x",
    "@biomejs/biome": "^2.x",
    "tsx": "^4.x",
    "tsup": "^8.x",
    "vitest": "^4.x",
    "@vitest/coverage-v8": "^4.x",
    "pino-pretty": "^13.x"
  }
}
```

### System Dependencies (Mac mini)

- Node.js >= 24
- opencli (latest)
- Chrome browser + opencli Chrome Extension
- PM2 (`npm install -g pm2`)
