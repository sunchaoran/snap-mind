# SnapMind

> 截图即收藏：从截图到结构化知识库的自动化管道。
>
> [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

SnapMind 接收一张截图，自动完成平台识别、原文获取、摘要生成、标签分类，最终写入 Obsidian-style markdown vault，形成结构化的个人知识库。

这个 repo 是 **backend**——AGPL-3.0 开源，自托管。配套的 iOS / macOS app 是闭源的、通过 App Store 分发，连接你自己 self-host 的 backend 或未来的 SnapMind Cloud。

## 工作原理

```
截图 → 客户端 → backend → VLM 识别 → 原文抓取 → 内容加工 → 写入 Vault → 返回结果
```

1. **VLM 识别** — 两阶段分析（平台识别 → 平台特定提取），可配置 N 模型并发投票合并
2. **原文获取** — 四级降级策略（opencli → web fetch → 搜索引擎 → 仅截图）
3. **内容加工** — LLM 生成摘要、标签、分类
4. **写入 Vault** — Markdown + frontmatter 存入 Obsidian，支持 Dataview 查询
5. **读 / 删 API** — clients 通过 HTTP API 浏览和管理 vault，无需各自写 markdown parser

## Quick Start

```bash
pnpm install
cp .env.example .env  # 填入 API keys 和 vault 路径
pnpm dev
```

详细的部署（含 macOS LaunchAgent / Linux / Docker）见 [部署指南](./docs/guides/deployment.md)。

## Prerequisites

- Node.js >= 24
- pnpm
- OpenRouter API key（VLM + 内容处理）
- 一个 vault 目录（macOS 推荐 Obsidian on iCloud Drive；Linux/Docker 任意路径都行）
- 可选：[opencli](https://github.com/jackwener/opencli) + Chrome（L1 抓取最强，但不强制）

## Architecture

SnapMind 是 **open core + closed apps + 未来 Cloud** 模型：

```
┌─ 这个 repo (open source backend, AGPL-3.0) ────┐
│  你 self-host on Mac mini / Linux / Docker      │
└─ ↑ 同一份 HTTP API 契约 (/api/v1/...) ─────────┘
   ↓
┌─ snap-mind-apple (closed source, App Store) ───┐
│  iOS / macOS app, onboarding 选 self-host or cloud │
└────────────────────────────────────────────────┘
```

完整设计见 [API V1 设计文档](./docs/architecture/api-design.md)。

## Documentation

详细工程文档在 [docs/](./docs/README.md)：

- [系统架构](./docs/architecture/overview.md)
- [API V1 设计](./docs/architecture/api-design.md) ← 新设计，权威文档
- [数据模型](./docs/architecture/data-model.md)
- [HTTP API 契约](./docs/api/http-api.md)
- [模块规范](./docs/modules/)
- [配置指南](./docs/guides/configuration.md)
- [部署指南](./docs/guides/deployment.md)
- [Roadmap](./docs/roadmap.md)

## Contributing

PR / issue 欢迎，但本项目对 scope 有明确的取舍。提 PR 前请读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## License

[AGPL-3.0](./LICENSE)。任何人可以自由使用、修改、自托管；如果你拿这份代码搭建对外的服务，必须开源你的修改。
