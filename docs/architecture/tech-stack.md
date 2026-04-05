# Tech Stack

## Core Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (>=22) | 主开发语言 |
| HTTP Framework | Fastify 5 | 原生 multipart 支持，TypeScript 类型推导好，内置 pino 日志 |
| LLM Gateway | OpenRouter API (via `openai` SDK) | 兼容 OpenAI API，切换 baseURL 即可调用多家模型 |
| Content Fetching | opencli | 55+ 平台支持，Browser 模式复用 Chrome 登录态 |
| Web Fetch Fallback | Playwright | `connectOverCDP` 复用 Chrome 登录态，`networkidle` 等待更可靠 |
| Storage | 本地文件系统 (Obsidian vault) | Markdown + 截图文件 |
| Process Manager | PM2 | 日志/监控开箱即用，跨平台可迁移 |
| Logging | pino (Fastify built-in) | 结构化 JSON 日志，PM2 采集友好 |

## Build & Dev Tooling

| Tool | Purpose |
|------|---------|
| `tsx` | 开发阶段直接运行 TypeScript，零配置 |
| `tsup` | 生产构建，基于 esbuild，秒级打包 |
| `vitest` | 测试框架 |
| `dotenv` | 环境变量加载 |

## LLM Models

### VLM Analysis (Configurable N-Model Voting)

模型数量可配置，必须为奇数。V1 默认单模型。

| Provider | Model | Note |
|----------|-------|------|
| Google | gemini-2.5-flash | **V1 默认** |
| Anthropic | claude-sonnet-4-20250514 | 可选，增强精度 |
| OpenAI | gpt-4o | 可选，增强精度 |

> 通过配置 `openrouter.models.vlm` 数组调整模型列表和数量。

### Content Processing

| Provider | Model | Purpose |
|----------|-------|---------|
| Google | gemini-2.5-flash | 摘要/标签/分类（性价比优先） |

## Dependencies

### NPM Packages

```json
{
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/multipart": "^9.x",
    "openai": "^4.x",
    "playwright": "^1.x",
    "gray-matter": "^4.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^22.x",
    "tsx": "^4.x",
    "tsup": "^8.x",
    "vitest": "^2.x"
  }
}
```

### System Dependencies (Mac mini)

- Node.js >= 22
- opencli (latest)
- Chrome browser + opencli Chrome Extension
- PM2 (`npm install -g pm2`)
