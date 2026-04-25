# Configuration Guide

所有可配置项集中在 `src/config.ts`，敏感信息通过环境变量注入。

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API Key |
| `OBSIDIAN_VAULT_PATH` | No | macOS iCloud Drive 下的 `Obsidian` | Obsidian vault 绝对路径；未设置时默认使用 `~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian` |
| `OBSIDIAN_SCREENSHOT_WIDTH` | No | `360` | Obsidian 笔记中截图的默认显示宽度（像素）；设为 `0` 或负数时不限制 |
| `API_KEY` | Yes | — | 服务间调用密钥（龙虾等 Agent） |
| `JWT_SECRET` | Yes | — | JWT 签名密钥（暂未使用，预留） |
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

## Configuration Schema

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

## .env Example

```bash
# Required
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
# Optional: override the default iCloud Drive Obsidian vault path
OBSIDIAN_VAULT_PATH=/Users/chaoran/Library/Mobile Documents/com~apple~CloudDocs/Obsidian
# Optional: screenshot display width in generated notes
OBSIDIAN_SCREENSHOT_WIDTH=360
API_KEY=sk-snapmind-xxxxxxxxxxxx
JWT_SECRET=your-jwt-secret-here

# Optional: LLM models
VLM_MODELS=moonshotai/kimi-k2.5
PROCESSOR_MODEL=moonshotai/kimi-k2.5
VLM_ESCALATION_THRESHOLD=0.8

# Optional: Server
PORT=3210
HOST=0.0.0.0

# Optional: opencli & Chrome
OPENCLI_PATH=opencli
CDP_URL=http://localhost:9222

# Optional: Fetch control
MAX_FETCH_LEVEL=4
MAX_BATCH_SIZE=20
MAX_CONCURRENT_PIPELINES=5

# Optional: Search engine (L3 fallback)
SEARCH_PROVIDER=google
SEARCH_API_KEY=AIzaSyxxxxxxxxxxxx
GOOGLE_CX=xxxxxxxxxxxx
```
