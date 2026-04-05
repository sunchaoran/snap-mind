# Configuration Guide

所有可配置项集中在 `src/config.ts`，敏感信息通过环境变量注入。

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API Key |
| `OBSIDIAN_VAULT_PATH` | Yes | Obsidian vault 绝对路径，e.g. `/Users/chaoran/ObsidianVault` |
| `SEARCH_API_KEY` | No | Google/Bing 搜索引擎 API Key (L3 fallback) |
| `GOOGLE_CX` | No | Google Custom Search Engine ID |

## Configuration Schema

```typescript
export const config = {
  // HTTP 服务
  server: {
    port: 3210,
    host: "0.0.0.0",
  },

  // OpenRouter
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseUrl: "https://openrouter.ai/api/v1",
    models: {
      vlm: [
        "anthropic/claude-sonnet-4-20250514",
        "google/gemini-2.5-flash",
        "openai/gpt-4o",
      ],
      processor: "google/gemini-2.5-flash",
    },
  },

  // opencli-rs
  opencliRs: {
    binaryPath: "/usr/local/bin/opencli-rs",
    timeout: 15000,
  },

  // Obsidian Vault
  vault: {
    basePath: process.env.OBSIDIAN_VAULT_PATH!,
    clippingsDir: "Clippings",
    assetsDir: "Clippings/assets",
  },

  // 处理参数
  processing: {
    overallTimeout: 90000,
    fetchTimeouts: {
      l1: 15000,
      l2: 20000,
      l3: 20000,
    },
    vlmTimeout: 30000,
    similarityThreshold: 0.85,
  },

  // L3 搜索引擎（可选）
  searchEngine: {
    provider: "google", // google | bing
    apiKey: process.env.SEARCH_API_KEY,
    cx: process.env.GOOGLE_CX,
  },
};
```

## .env Example

```bash
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx
OBSIDIAN_VAULT_PATH=/Users/chaoran/ObsidianVault
SEARCH_API_KEY=AIzaSyxxxxxxxxxxxx
GOOGLE_CX=xxxxxxxxxxxx
```
