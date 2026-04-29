# SnapMind - Engineering Documentation

> 截图即收藏：从截图到结构化知识库的自动化管道。

> **🚧 Active redesign**: V1 设计在 [api-v2-design.md](./architecture/api-v2-design.md)。其它文档正在跟进同步——发现冲突时以设计文档为准。

## Quick Navigation

| Section | Description |
|---------|-------------|
| [V1 Design](./architecture/api-v2-design.md) | **权威设计文档**——产品策略、API 契约、模块边界、部署模式 |
| [Architecture](./architecture/) | 系统架构、数据模型、技术选型 |
| [Modules](./modules/) | 各模块详细设计规范 |
| [API](./api/) | HTTP API 接口契约（V1 公开稳定） |
| [Guides](./guides/) | 配置、开发环境搭建、部署指南 |
| [Roadmap](./roadmap.md) | V1 / V2 / V3 路线图 |

## Architecture Overview

```
┌─ 这个 repo (open source backend, AGPL-3.0) ────────┐
│                                                     │
│  客户端 (macOS / iOS / OpenClaw skill)              │
│      │                                              │
│      │  /api/v1/clip          POST 写入             │
│      │  /api/v1/clip/batch    POST 批量             │
│      │  /api/v1/clip/sticky   POST 防抖批量         │
│      │  /api/v1/jobs/:id      GET 进度（轮询/SSE）  │
│      │  /api/v1/clip          GET 列表（无 contentFull）│
│      │  /api/v1/clip/:id      GET 详情（含 contentFull）│
│      │  DELETE /api/v1/clip/:id                     │
│      │  /api/v1/clip/:id/image GET 截图字节         │
│      ▼                                              │
│  ┌────────────────────────────────────────────┐    │
│  │  Fastify + AuthStrategy + RateLimit + SSE   │    │
│  │  ──────────────────────────────────────────  │    │
│  │  routes/  →  pipeline/  →  writer/ + library/│    │
│  │              ↓                                │    │
│  │              VLM / fetcher / processor        │    │
│  │              ↓                                │    │
│  │              vault (filesystem 目录)         │    │
│  └────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
                       ↓
        macOS: ~/Library/Mobile Documents/...iCloud Drive
        Linux: /data/vault
        Docker: volume mount
```

完整设计、模块边界、wire format 契约、部署模式等详见 [V1 设计文档](./architecture/api-v2-design.md)。

## Module Index

| Module | Path | Description |
|--------|------|-------------|
| InputAdapter | [modules/input-adapter.md](./modules/input-adapter.md) | HTTP 服务 + 认证 + 异步 Job 管理 |
| VLMAnalyzer | [modules/vlm-analyzer.md](./modules/vlm-analyzer.md) | 两阶段分析：平台识别 → N 模型并发提取 + 投票合并 |
| ContentFetcher | [modules/content-fetcher.md](./modules/content-fetcher.md) | 四级策略获取原文（含 author-first 子策略） |
| ContentProcessor | [modules/content-processor.md](./modules/content-processor.md) | 摘要 / 标签 / 分类 |
| ClipWriter | [modules/clip-writer.md](./modules/clip-writer.md) | Write driver 抽象层 + MarkdownWriter |
| ClipLibrary | `src/library/clips.ts` | Read/delete：扫 vault、解析、wire-format 投影、安全删除 |
| ScreenshotStore | [modules/screenshot-store.md](./modules/screenshot-store.md) | 截图文件存储 + 格式检测 |
| AuthStrategy | `src/server/auth/` (V1 设计) | API key / JWT 等认证策略接口（V1 只实现 ApiKey） |
| Pipeline | `src/pipeline/` (V1 设计) | 写入 pipeline 编排（VLM → fetch → process → write）|

## Project Structure

```
snap-mind/
├── src/
│   ├── index.ts                # 入口，启动 Fastify HTTP 服务
│   ├── config.ts               # 配置定义（环境变量驱动）
│   ├── vault.ts                # Vault 文件结构常量（heading 字面量、_index 文件名等，writer/reader 共用）
│   ├── server/
│   │   ├── routes.ts           # HTTP 路由 + pipeline 调度
│   │   ├── job-store.ts        # 异步 Job 状态管理（内存）
│   │   ├── auth.ts             # 认证逻辑 (API Key / JWT)
│   │   ├── errors.ts           # HTTP 错误文案集中处
│   │   └── dev-upload.html     # Dev 上传页面
│   ├── library/
│   │   └── clips.ts            # 读/删：扫 vault、解析、wire format 投影、安全删除
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
├── scripts/
│   └── check-opencli.ts        # 比对本地 opencli 版本与最新版（pnpm check:opencli）
├── cli/
│   └── snap-mind-cli/          # `snap-mind` CLI（OpenClaw skill 调用入口）
│       ├── main.ts             # 实现：sticky push / wait / status
│       └── CONTRACT.md         # 命令契约 + 退出码
└── skills/                     # OpenClaw / AgentSkills 兼容的 Skill 定义
    ├── snap-mind/
    │   └── SKILL.md            # "收藏截图到 Obsidian" skill
    └── QUESTIONS.md            # 待 OpenClaw 团队/文档确认的开放问题
```

> 上面是**当前**结构。V1 设计文档里描述了**目标**结构（routes 拆按资源、pipeline 独立模块、auth strategy 抽象等）——参见 [api-v2-design.md §6 Module Boundaries](./architecture/api-v2-design.md#6-module-boundaries)。重构按 feature 分支逐步推进，不一次性掀桌。
