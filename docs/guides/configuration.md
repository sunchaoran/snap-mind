# Configuration Guide

所有可配置项集中在 `src/config.ts`，敏感信息通过环境变量注入。

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | — | OpenRouter API Key |
| `OBSIDIAN_VAULT_PATH` | Yes | — | Obsidian vault 绝对路径 |
| `API_KEY` | Yes | — | 服务间调用密钥（龙虾等 Agent） |
| `JWT_SECRET` | Yes | — | JWT 签名密钥（暂未使用，预留） |
| `VLM_MODELS` | No | `moonshotai/kimi-k2.5` | VLM 模型列表，逗号分隔，数量必须为奇数 |
| `PROCESSOR_MODEL` | No | `moonshotai/kimi-k2.5` | 内容处理模型 |
| `OPENCLI_PATH` | No | `opencli` | opencli 二进制路径 |
| `CDP_URL` | No | `http://localhost:9222` | Chrome DevTools Protocol URL |
| `PORT` | No | `3210` | 服务端口 |
| `HOST` | No | `0.0.0.0` | 监听地址 |
| `MAX_FETCH_LEVEL` | No | `4` | 最大获取级别（1-4），超出则报错不降级 |
| `SEARCH_API_KEY` | No | — | Google/Bing 搜索引擎 API Key (L3 fallback) |
| `SEARCH_PROVIDER` | No | `google` | 搜索引擎提供商 (`google` \| `bing`) |
| `GOOGLE_CX` | No | — | Google Custom Search Engine ID |

## Configuration Schema

```typescript
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
    basePath: process.env.OBSIDIAN_VAULT_PATH!,
    clippingsDir: "Clippings",
    assetsDir: "Clippings/assets",
  },

  // 处理参数
  processing: {
    overallTimeout: 180_000,   // 180 秒
    fetchTimeouts: {
      l1: 80_000,   // 80 秒
      l2: 35_000,   // 35 秒
      l3: 20_000,   // 20 秒
    },
    vlmTimeout: 35_000,        // 35 秒（每个模型调用）
    similarityThreshold: 0.85,
    maxFetchLevel: Number(process.env.MAX_FETCH_LEVEL) || 4,
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
OBSIDIAN_VAULT_PATH=/Users/chaoran/ObsidianVault
API_KEY=sk-snapmind-xxxxxxxxxxxx
JWT_SECRET=your-jwt-secret-here

# Optional: LLM models
VLM_MODELS=moonshotai/kimi-k2.5
PROCESSOR_MODEL=moonshotai/kimi-k2.5

# Optional: Server
PORT=3210
HOST=0.0.0.0

# Optional: opencli & Chrome
OPENCLI_PATH=opencli
CDP_URL=http://localhost:9222

# Optional: Fetch control
MAX_FETCH_LEVEL=4

# Optional: Search engine (L3 fallback)
SEARCH_PROVIDER=google
SEARCH_API_KEY=AIzaSyxxxxxxxxxxxx
GOOGLE_CX=xxxxxxxxxxxx
```
