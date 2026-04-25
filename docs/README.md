# ClipService - Engineering Documentation

> 截图即收藏：从截图到结构化知识库的自动化管道

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Architecture](./architecture/) | 系统架构、数据模型、技术选型 |
| [Modules](./modules/) | 各模块详细设计规范 |
| [API](./api/) | HTTP API 接口规范 |
| [Guides](./guides/) | 配置、开发环境搭建、部署指南 |
| [Roadmap](./roadmap.md) | 未来扩展规划 |

## Architecture Overview

```
客户端 (龙虾 / Web App / iOS App)
    │
    │  POST /clip  (image + auth)
    ▼
┌─────────────────────────────────────────────────┐
│                  ClipService                     │
│                                                  │
│  InputAdapter → 创建 Job → 返回 jobId (202)      │
│       │                                          │
│       └─ async pipeline ─────────────────────    │
│          VLMAnalyzer → ContentFetcher            │
│          → ContentProcessor → ClipWriter         │
│          (每步更新 JobStore)                      │
│                                                  │
│  GET /jobs/:id  → 轮询 Job 状态 + 进度           │
│                                                  │
│  External: OpenRouter API / opencli / Vault       │
└─────────────────────────────────────────────────┘
```

## Module Index

| Module | Path | Description |
|--------|------|-------------|
| InputAdapter | [modules/input-adapter.md](./modules/input-adapter.md) | HTTP 服务 + 认证 + 异步 Job 管理 |
| VLMAnalyzer | [modules/vlm-analyzer.md](./modules/vlm-analyzer.md) | 两阶段分析：平台识别 → N 模型并发提取 + 投票合并 |
| ContentFetcher | [modules/content-fetcher.md](./modules/content-fetcher.md) | 四级策略获取原文（含 author-first 子策略） |
| ContentProcessor | [modules/content-processor.md](./modules/content-processor.md) | 摘要 / 标签 / 分类 |
| ClipWriter | [modules/clip-writer.md](./modules/clip-writer.md) | Write driver 抽象层 + MarkdownWriter |
| ScreenshotStore | [modules/screenshot-store.md](./modules/screenshot-store.md) | 截图文件存储 + 格式检测 |

## Project Structure

```
snap-mind/
├── src/
│   ├── index.ts                # 入口，启动 Fastify HTTP 服务
│   ├── config.ts               # 配置定义（环境变量驱动）
│   ├── server/
│   │   ├── routes.ts           # HTTP 路由 + pipeline 调度
│   │   ├── job-store.ts        # 异步 Job 状态管理（内存）
│   │   ├── auth.ts             # 认证逻辑 (API Key / JWT)
│   │   └── dev-upload.html     # Dev 上传页面
│   ├── vlm/
│   │   ├── analyzer.ts         # 两阶段 VLM 分析主逻辑
│   │   ├── openrouter.ts       # OpenRouter API 客户端
│   │   ├── prompt.ts           # prompt 加载与模板构建
│   │   └── merger.ts           # 投票合并逻辑
│   ├── fetcher/
│   │   ├── index.ts            # ContentFetcher（四级策略调度）
│   │   ├── opencli.ts          # opencli 调用封装
│   │   ├── web-fetch.ts        # Playwright web fetch + LLM 正文提取
│   │   └── search-engine.ts    # L3 搜索引擎调用
│   ├── processor/
│   │   └── index.ts            # ContentProcessor
│   ├── prompts/
│   │   ├── index.ts            # prompt 加载器
│   │   ├── vlm-identify.md     # Step 1: 平台识别 prompt
│   │   ├── vlm-extract.md      # Step 2: 提取模板
│   │   ├── processor.md        # 内容处理 system prompt
│   │   └── platforms/          # 各平台特定提取规则
│   │       ├── xiaohongshu.md
│   │       ├── twitter.md
│   │       ├── bilibili.md
│   │       ├── ...
│   │       └── unknown.md
│   ├── writer/
│   │   ├── interface.ts        # ClipWriter 接口定义
│   │   ├── markdown.ts         # MarkdownWriter 实现
│   │   └── template.ts         # Markdown 模板渲染
│   ├── store/
│   │   └── screenshot.ts       # ScreenshotStore + 格式检测
│   ├── utils/
│   │   ├── id.ts               # clipId 生成 (nanoid)
│   │   ├── slug.ts             # title slug 生成
│   │   ├── similarity.ts       # 文本相似度 (Levenshtein)
│   │   ├── image.ts            # 图片预处理 (sharp)
│   │   ├── json.ts             # LLM JSON 解析
│   │   └── logger.ts           # pino logger 工厂
│   └── types/
│       └── index.ts            # TypeScript 类型定义
└── scripts/
    └── check-opencli.ts        # 比对本地 opencli 版本与最新版（pnpm check:opencli）
```
