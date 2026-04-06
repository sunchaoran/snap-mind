# ClipService - Engineering Documentation

> 截图即收藏：从截图到结构化知识库的自动化管道

## Quick Navigation

| Section | Description |
|---------|-------------|
| [PRD](./clip-service-prd.md) | 原始产品技术文档 |
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
| InputAdapter | [modules/input-adapter.md](./modules/input-adapter.md) | HTTP 服务 + 认证，接收截图，触发处理流程 |
| VLMAnalyzer | [modules/vlm-analyzer.md](./modules/vlm-analyzer.md) | 可配置 N 模型识别 + 投票合并 |
| ContentFetcher | [modules/content-fetcher.md](./modules/content-fetcher.md) | 四级策略获取原文 |
| ContentProcessor | [modules/content-processor.md](./modules/content-processor.md) | 摘要 / 标签 / 分类 |
| ClipWriter | [modules/clip-writer.md](./modules/clip-writer.md) | Write driver 抽象层 + MarkdownWriter |
| ScreenshotStore | [modules/screenshot-store.md](./modules/screenshot-store.md) | 截图文件存储管理 |

## Project Structure

```
clip-service/
├── src/
│   ├── index.ts                # 入口，启动 HTTP 服务
│   ├── config.ts               # 配置定义
│   ├── server/
│   │   ├── routes.ts           # HTTP 路由 (POST /clip, GET /jobs/:id)
│   │   ├── job-store.ts        # 异步 Job 状态管理（内存）
│   │   ├── dev-upload.html     # Dev 上传页面（含进度条）
│   │   └── auth.ts             # 认证中间件 (API Key / JWT)
│   ├── vlm/
│   │   ├── analyzer.ts         # VLMAnalyzer 主逻辑
│   │   ├── openrouter.ts       # OpenRouter API 客户端
│   │   ├── prompt.ts           # VLM prompt 模板
│   │   └── merger.ts           # 投票合并逻辑
│   ├── fetcher/
│   │   ├── index.ts            # ContentFetcher（四级策略调度）
│   │   ├── opencli.ts          # opencli 调用封装
│   │   ├── web-fetch.ts        # Web fetch + LLM 正文提取
│   │   └── search-engine.ts    # L3 搜索引擎调用
│   ├── processor/
│   │   └── index.ts            # ContentProcessor
│   ├── writer/
│   │   ├── interface.ts        # ClipWriter 接口定义
│   │   ├── markdown.ts         # MarkdownWriter 实现
│   │   └── template.ts         # Markdown 模板渲染
│   ├── store/
│   │   └── screenshot.ts       # ScreenshotStore
│   ├── utils/
│   │   ├── id.ts               # clipId 生成
│   │   ├── slug.ts             # title slug 生成
│   │   └── similarity.ts       # 文本相似度计算
│   └── types/
│       └── index.ts            # TypeScript 类型定义
└── test/
    ├── vlm/
    ├── fetcher/
    ├── processor/
    └── writer/
```
