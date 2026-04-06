# SnapMind

> 截图即收藏：从截图到结构化知识库的自动化管道

SnapMind (ClipService) 接收手机截图，自动完成平台识别、原文获取、摘要生成、标签分类，最终存入 Obsidian vault，形成结构化的个人知识库。

## How It Works

```
客户端（龙虾 / Web App / iOS App）→ 认证 → SnapMind API → 自动处理 → 返回结果
```

1. **VLM 识别** — 可配置 N 模型并发分析截图，投票合并出平台、作者、标题等结构化信息
2. **原文获取** — 四级降级策略（opencli → web fetch → 搜索引擎 → 仅截图）
3. **内容加工** — LLM 生成摘要、标签、分类
4. **写入 Vault** — Markdown + frontmatter 存入 Obsidian，支持 Dataview 查询

## Quick Start

```bash
pnpm install
cp .env.example .env  # 填入 API keys 和 vault 路径
pnpm dev
```

## Prerequisites

- Node.js >= 22
- [opencli](https://github.com/nicepkg/opencli) + Chrome Extension
- Chrome（保持各平台登录态）
- Obsidian vault

## Documentation

详细的工程文档见 [docs/](./docs/README.md)，包括：

- [系统架构](./docs/architecture/overview.md)
- [数据模型](./docs/architecture/data-model.md)
- [模块规范](./docs/modules/)
- [API 接口](./docs/api/http-api.md)
- [配置指南](./docs/guides/configuration.md)
- [部署指南](./docs/guides/deployment.md)

## License

Private
