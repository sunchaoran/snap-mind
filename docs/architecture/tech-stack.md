# Tech Stack

## Core Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js (>=22) | 主开发语言 |
| HTTP Framework | Fastify 或 Express | 轻量，接收截图 |
| LLM Gateway | OpenRouter API | 统一调用 Claude / Gemini / GPT-4o |
| Content Fetching | opencli | 55+ 平台支持，Browser 模式复用 Chrome 登录态 |
| Web Fetch Fallback | puppeteer 或 playwright | L2/L3 级别的页面抓取 |
| Storage | 本地文件系统 (Obsidian vault) | Markdown + 截图文件 |
| Process Manager | PM2 或 launchd | Mac mini 上常驻运行 |

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
    "gray-matter": "^4.x",
    "puppeteer": "^23.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/node": "^22.x",
    "vitest": "^2.x"
  }
}
```

### System Dependencies (Mac mini)

- Node.js >= 22
- opencli (latest)
- Chrome browser + opencli Chrome Extension
- PM2 (`npm install -g pm2`)
