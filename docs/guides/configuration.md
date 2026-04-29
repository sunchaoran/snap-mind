# 配置指南

所有可配置项集中在 `src/config.ts`，敏感信息通过环境变量注入。

## 环境变量

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API Key |
| `OBSIDIAN_VAULT_PATH` | No | macOS iCloud Drive 下的 `Obsidian` | Obsidian vault 绝对路径；未设置时默认使用 `~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian` |
| `OBSIDIAN_SCREENSHOT_WIDTH` | No | `360` | Obsidian 笔记中截图的默认显示宽度（像素）；设为 `0` 或负数时不限制 |
| `API_KEY` | Yes | — | self-host bearer token，所有 client 共用 |
| `JWT_SECRET` | No | — | 仅 SnapMind Cloud (V3) 用于 JWT 签名；self-host 不需要 |
| `VLM_MODELS` | No | `moonshotai/kimi-k2.5` | VLM 模型列表，逗号分隔，数量必须为奇数 |
| `PROCESSOR_MODEL` | No | `moonshotai/kimi-k2.5` | 内容处理模型 |
| `VLM_ESCALATION_THRESHOLD` | No | `0.8` | 主 VLM 结果低于该置信度，或缺少关键字段时，升级为多模型投票 |
| `OPENCLI_PATH` | No | `opencli` | opencli 二进制路径 |
| `CDP_URL` | No | `http://localhost:9222` | Chrome DevTools Protocol URL |
| `PORT` | No | `3210` | 服务端口 |
| `HOST` | No | `0.0.0.0` | 监听地址 |
| `MAX_FETCH_LEVEL` | No | `4` | 最大获取级别（1-4），超出则报错不降级 |
| `MAX_BATCH_SIZE` | No | `20` | 批量上传每次最多图片数（1-20） |
| `MAX_CONCURRENT_PIPELINES` | No | `5` | 批量上传时同时处理的最大 Pipeline 数 |
| `SEARCH_API_KEY` | No | — | Google/Bing 搜索引擎 API Key (L3 fallback) |
| `SEARCH_PROVIDER` | No | `google` | 搜索引擎提供商 (`google` \| `bing`) |
| `GOOGLE_CX` | No | — | Google Custom Search Engine ID |
| `RATE_LIMIT_MAX` | No | `200` | 每个时间窗口内允许的最大请求数（按 Bearer token 维度，缺失时回落到 IP） |
| `RATE_LIMIT_WINDOW` | No | `1 minute` | 速率限制时间窗口，支持 `@lukeed/ms` 格式（如 `30 seconds`、`5 minutes`） |

## 配置 Schema

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

const defaultObsidianVaultPath = join(
  homedir(),
  "Library",
  "Mobile Documents",
  "com~apple~CloudDocs",
  "Obsidian",
);

export const config = {
  // HTTP 服务
  server: {
    port: Number(process.env.PORT) || 3210,
    host: process.env.HOST || "0.0.0.0",
    // 单用户 / Tailscale-only 部署，速率限制主要防呆
    rateLimit: {
      max: Number(process.env.RATE_LIMIT_MAX) || 200,
      timeWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
    },
  },

  // 认证
  auth: {
    apiKey: process.env.API_KEY!,
    jwtSecret: process.env.JWT_SECRET!,
  },

  // OpenRouter
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseUrl: "https://openrouter.ai/api/v1",
    models: {
      // VLM 模型列表，数量必须为奇数（投票机制）
      vlm: (process.env.VLM_MODELS || "moonshotai/kimi-k2.5").split(","),
      processor: process.env.PROCESSOR_MODEL || "moonshotai/kimi-k2.5",
    },
  },

  // opencli
  opencli: {
    binaryPath: process.env.OPENCLI_PATH || "opencli",
    timeout: 120_000,  // 120 秒
  },

  // Playwright (web fetch fallback)
  playwright: {
    cdpUrl: process.env.CDP_URL || "http://localhost:9222",
  },

  // Obsidian Vault
  vault: {
    basePath: process.env.OBSIDIAN_VAULT_PATH || defaultObsidianVaultPath,
    clippingsDir: "snap-mind",
    assetsDir: "snap-mind/assets",
    screenshotDisplayWidth: Number(process.env.OBSIDIAN_SCREENSHOT_WIDTH) || 360,
  },

  // 处理参数
  processing: {
    overallTimeout: 300_000,   // 300 秒
    fetchTimeouts: {
      l1: 100_000,  // 100 秒
      l2: 50_000,   // 50 秒
      l3: 50_000,   // 50 秒
    },
    vlmTimeout: 80_000,        // 80 秒（每个模型调用）
    vlmEscalationThreshold: Number(process.env.VLM_ESCALATION_THRESHOLD) || 0.8,
    similarityThreshold: 0.85,
    maxFetchLevel: Number(process.env.MAX_FETCH_LEVEL) || 4,
    maxBatchSize: Math.min(Number(process.env.MAX_BATCH_SIZE) || 20, 20),
    maxConcurrentPipelines: Number(process.env.MAX_CONCURRENT_PIPELINES) || 5,
  },

  // L3 搜索引擎（可选）
  searchEngine: {
    provider: (process.env.SEARCH_PROVIDER || "google") as "google" | "bing",
    apiKey: process.env.SEARCH_API_KEY,
    cx: process.env.GOOGLE_CX,
  },
} as const;
```

## .env 示例

```bash
# 必填
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
# 可选：覆盖默认的 iCloud Drive Obsidian vault 路径
OBSIDIAN_VAULT_PATH=/Users/chaoran/Library/Mobile Documents/com~apple~CloudDocs/Obsidian
# 可选：生成的笔记里截图的显示宽度
OBSIDIAN_SCREENSHOT_WIDTH=360
API_KEY=sk-snapmind-xxxxxxxxxxxx
# JWT_SECRET 仅 SnapMind Cloud 用，self-host 不必设

# 可选：LLM 模型
VLM_MODELS=moonshotai/kimi-k2.5
PROCESSOR_MODEL=moonshotai/kimi-k2.5
VLM_ESCALATION_THRESHOLD=0.8

# 可选：服务端口与监听地址
PORT=3210
HOST=0.0.0.0

# 可选：opencli & Chrome
OPENCLI_PATH=opencli
CDP_URL=http://localhost:9222

# 可选：抓取控制
MAX_FETCH_LEVEL=4
MAX_BATCH_SIZE=20
MAX_CONCURRENT_PIPELINES=5

# 可选：搜索引擎（L3 兜底）
SEARCH_PROVIDER=google
SEARCH_API_KEY=AIzaSyxxxxxxxxxxxx
GOOGLE_CX=xxxxxxxxxxxx

# Optional: Rate limit (per Bearer token; defaults shown)
RATE_LIMIT_MAX=200
RATE_LIMIT_WINDOW=1 minute
```

## Rate Limiting

通过 `@fastify/rate-limit` 全局注册（在 `multipart` 之后、路由之前），默认每 Bearer token 每分钟 200 次。
单用户 / Tailscale-only 部署下，目的是防止脚本失控刷接口，而非抗 DDoS。

- `keyGenerator`: 优先用 `Authorization: Bearer <key>` 作为 key（Tailscale NAT 后所有客户端 IP 会一样）；缺失时回落 `req.ip`。
- 触发限流时返回 HTTP 429，body 为统一错误信封：`{ "error": { "code": "RATE_LIMITED", "message": "..." } }`。

## Logging & Redaction

服务端 logger 使用 `pino`（开发环境下叠加 `pino-pretty`），通过 `src/utils/logger.ts` 中的
`getLoggerOptions()` 在 Fastify logger 与独立 logger 之间共享配置。

以下字段在写入日志前会被替换为 `[Redacted]`：

- `req.headers.authorization` / `req.headers.cookie` / `req.headers["set-cookie"]`
- `res.headers.authorization` / `res.headers["set-cookie"]`
- `headers.authorization` / `headers.cookie` / `headers["set-cookie"]`（child logger 简化路径）

> pino 的 redact 不支持任意 glob，因此**禁止**直接日志整个 `config` 对象。
> 调用 logger 时只打印需要的非敏感字段（例如 `vault: config.vault.basePath`）。
