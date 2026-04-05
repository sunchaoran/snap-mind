# Tech Stack

## Core Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (>=20) | 主开发语言 |
| HTTP Framework | Fastify 或 Express | 轻量，接收截图 |
| LLM Gateway | OpenRouter API | 统一调用 Claude / Gemini / GPT-4o |
| Content Fetching | opencli-rs | 55+ 平台支持，Browser 模式复用 Chrome 登录态 |
| Web Fetch Fallback | puppeteer 或 playwright | L2/L3 级别的页面抓取 |
| Storage | 本地文件系统 (Obsidian vault) | Markdown + 截图文件 |
| Process Manager | PM2 或 launchd | Mac mini 上常驻运行 |

## LLM Models

### VLM Analysis (Triple-Model Voting)

| Provider | Model | Purpose |
|----------|-------|---------|
| Anthropic | claude-sonnet-4-20250514 | 截图分析 |
| Google | gemini-2.5-flash | 截图分析 |
| OpenAI | gpt-4o | 截图分析 |

> 具体模型版本可通过配置文件调整。

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
    "gray-matter": "^4.x",
    "puppeteer": "^23.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^20.x",
    "vitest": "^2.x"
  }
}
```

### System Dependencies (Mac mini)

- Node.js >= 20
- opencli-rs (latest)
- Chrome browser + opencli-rs Chrome Extension
- PM2 (`npm install -g pm2`)
