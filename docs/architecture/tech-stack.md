# 技术栈

> 本文档列**当前实际在用**的依赖与选型。V1 计划新增的（Zod / @fastify/bearer-auth / @fastify/rate-limit / @fastify/swagger / chokidar 等）参见 [api-design.md](./api-design.md)。

## 核心栈

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (>=24) | 主开发语言 |
| HTTP Framework | Fastify 5 | 原生 multipart 支持，TypeScript 类型推导好，内置 pino 日志 |
| LLM Gateway | OpenAI 兼容 API（OpenRouter 或本地 server，via `openai` SDK） | 全局开关 `LLM_PROVIDER_TARGET`，切 baseURL 即可在云端 / 本地之间切换 |
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

### Provider 切换

`LLM_PROVIDER_TARGET` 是全局开关，VLM 与 processor 共享同一 provider：

- `openrouter`（默认）：云端，`OPENROUTER_API_KEY` 必填
- `local`：任何 OpenAI 兼容的本地服务（LM Studio / vLLM / Ollama / llama.cpp / …），默认 base URL `http://localhost:1234/v1`，按需用 `LOCAL_BASE_URL` 覆盖

模型 ID 是 **per-provider** 的（`OPENROUTER_*` vs `LOCAL_*`），切换 target 时不会丢另一边的配置。单模型，无投票。

### VLM 分析（单模型）

| Provider | Model | Note |
|----------|-------|------|
| OpenRouter | moonshotai/kimi-k2.5 | **默认模型** |
| OpenRouter | google/gemini-2.5-flash | 可选 |
| OpenRouter | anthropic/claude-sonnet-4-20250514 | 可选 |
| OpenRouter | openai/gpt-4o | 可选 |
| Local | Qwen2.5-VL / 任意 OpenAI 兼容多模态模型 | 受本地显存限制 |

> 例：`OPENROUTER_VLM_MODEL=google/gemini-2.5-flash`

### 内容处理

| Provider | Model | Purpose |
|----------|-------|---------|
| OpenRouter | moonshotai/kimi-k2.5 | 摘要/标签/分类（默认，可通过 `OPENROUTER_PROCESSOR_MODEL` 覆盖） |
| Local | 任意本地文本模型 | 通过 `LOCAL_PROCESSOR_MODEL` 指定 |

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
