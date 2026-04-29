# 技术栈

> 本文档列**当前实际在用**的依赖与选型。V1 计划新增的（Zod / @fastify/bearer-auth / @fastify/rate-limit / @fastify/swagger / chokidar 等）参见 [api-v2-design.md](./api-v2-design.md)。

## 核心栈

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (>=24) | 主开发语言 |
| HTTP Framework | Fastify 5 | 原生 multipart 支持，TypeScript 类型推导好，内置 pino 日志 |
| LLM Gateway | OpenRouter API (via `openai` SDK) | 兼容 OpenAI API，切换 baseURL 即可调用多家模型 |
| Content Fetching | opencli | 55+ 平台支持，Browser 模式复用 Chrome 登录态 |
| Web Fetch Fallback | Playwright | `connectOverCDP` 复用 Chrome 登录态，`networkidle` 等待更可靠 |
| Image Processing | sharp (libvips) | 高性能截图压缩：缩放 + WebP 转换 |
| Storage | 本地文件系统（Obsidian-style vault） | Markdown frontmatter + assets 目录 |
| Process Manager | launchd (macOS) | 系统原生，零依赖；Linux 部署用 systemd（V2 计划）|
| Logging | pino (Fastify built-in) | 结构化 JSON 日志 |

## 构建与开发工具

| Tool | Purpose |
|------|---------|
| `tsx` | 开发阶段直接运行 TypeScript，零配置 |
| `tsup` | 生产构建，基于 esbuild，秒级打包（ESM only, target Node 24） |
| `vitest` | 测试框架（含 `@vitest/coverage-v8` 覆盖率） |
| `biome` | Linter + Formatter（替代 ESLint + Prettier） |
| Env loading | Node 内置 `process.loadEnvFile()`（cascade `.env`、`.env.local`、`.env.${NODE_ENV}` 等，无需 dotenv） |

## LLM 模型

### VLM 分析（可配置 N 模型投票）

模型数量可配置，必须为奇数。通过环境变量 `VLM_MODELS`（逗号分隔）配置。

| Provider | Model | Note |
|----------|-------|------|
| Moonshot | kimi-k2.5 | **默认模型** |
| Google | gemini-2.5-flash | 可选 |
| Anthropic | claude-sonnet-4-20250514 | 可选，增强精度 |
| OpenAI | gpt-4o | 可选，增强精度 |

> 通过环境变量 `VLM_MODELS` 调整模型列表。例：`VLM_MODELS=google/gemini-2.5-flash,anthropic/claude-sonnet-4-20250514,openai/gpt-4o`

### 内容处理

| Provider | Model | Purpose |
|----------|-------|---------|
| Moonshot | kimi-k2.5 | 摘要/标签/分类（默认，可通过 `PROCESSOR_MODEL` 环境变量覆盖） |

## 依赖

### npm 包

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

### 系统依赖（macOS self-host）

- Node.js >= 24
- pnpm
- launchd（macOS 内置，无需额外安装；plist 模板见 [部署指南](../guides/deployment.md)）
- 可选：opencli + Chrome（L1 抓取最强路径，没有时降级到 L2/L3 仍可工作）

Tailscale（可选但推荐）：iOS / OpenClaw 跨设备访问 backend 时使用，详见部署指南。
