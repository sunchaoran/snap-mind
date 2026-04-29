# Roadmap

> 每个 Version 的"Definition of Done"都明确写出来——避免范围漂移。

## V1 — Stable self-host (current)

**目标**：你自己用得舒服 + 把代码以一个体面的状态开源出去。

**Audience**：你（N=1）。Backend AGPL-3.0 开源；其他人技术上能 self-host，但工程量优化只针对你的 Mac mini。

**Definition of Done**：

- [ ] 路由全部移到 `/api/v1/` 前缀，保留旧路径作 410 Gone 引导
- [ ] AuthStrategy 接口 + ApiKeyStrategy 实现，inline auth 检查移除
- [ ] 统一错误信封 `{ error: { code, message } }`
- [ ] `routes.ts` 拆按资源（clip-write / clip-sticky / clip-read / jobs / batch / meta）
- [ ] Pipeline 编排从 routes 抽出到 `src/pipeline/`
- [ ] Wire 类型与内部类型分离 (`types/wire.ts` + `types/domain.ts`)
- [ ] SSE：`GET /api/v1/jobs/:id/events`、`/batch/:id/events`
- [ ] `@fastify/rate-limit` + pino redaction
- [ ] OpenAPI spec via `@fastify/swagger` + `/api/docs` UI
- [ ] `scripts/install-launchd.sh` + plist template + 部署文档
- [ ] Tailscale 部署文档（可选用，但 doc 涵盖）
- [ ] LICENSE (AGPL-3.0) + CONTRIBUTING.md ✅ 已完成
- [ ] README + docs 全部更新到 V1 设计 ✅ 进行中
- [ ] tag `v1.0.0`

**Non-goals**：

- ❌ 多用户 / 多租户 / JWT auth
- ❌ Docker image 发布（写好 Dockerfile 即可，不发 ghcr）
- ❌ macOS .app installer（手动跑脚本即可）
- ❌ Web client / Web UI
- ❌ SQLite / Redis / 任何额外持久化层
- ❌ 任何 V2/V3 列出的能力

详细设计：[api-v2-design.md](./architecture/api-v2-design.md)。

---

## V2 — Wider self-host audience

**前提**：V1 稳定使用一段时间后，你决定把它推给 self-host 社区（Linux/NAS 用户、Mac power users）。

**Audience**：技术型自托管用户。

**候选项**（按优先级）：

### V2.1 — Cross-platform packaging

- [ ] Dockerfile + 公开 ghcr 镜像（GitHub Actions auto-build）
- [ ] docker-compose.yml 示例
- [ ] 跨平台 vault 路径处理（去掉所有 macOS-only 假设）
- [ ] Linux deployment 指南（systemd unit 模板）
- [ ] NAS 用户的 Synology / Unraid 上手指南

### V2.2 — Mac .app installer

- [ ] Backend 打包成单 binary（Node SEA 或 Bun --compile）
- [ ] macOS .app bundle 包含 binary + onboarding UI
- [ ] 自动安装 LaunchAgent
- [ ] Sparkle 自更新
- [ ] notarization + DMG 分发

### V2.3 — Reliability improvements

- [ ] SQLite 索引层（vault 5K+ 条目时的读性能）
- [ ] Job/Batch state 持久化（重启不丢 in-flight pipeline）
- [ ] mDNS / Bonjour app 自发现
- [ ] 失败 record 的 retry endpoint (`POST /api/v1/clip/:id/retry`)

### V2.4 — Backend feature gaps

- [ ] `PUT /api/v1/clip/:id`：tags / category / summary 编辑（不动原文）
- [ ] `GET /api/v1/clip` 加分页 + 简单 filter (`?platform=`, `?category=`, `?dateFrom=`)
- [ ] 截图 `?w=` 参数生成缩略图（懒生成 + 缓存）

**Definition of Done**：每个子项独立可发，不必同步。

---

## V3 — SnapMind Cloud (hosted)

**前提**：V1 + V2 走通，社区有需求 OR 你想把它做成商业服务。

**Audience**：不想自己运维的普通用户。

**这是另一个产品形态**——独立 repo `snap-mind-cloud`，闭源。

候选要点：

- 多租户 backend（user 表 + JWT auth + per-user data isolation）
- 失去 Obsidian 集成（cloud 用户用 app 编辑，不直接接触文件）
- S3 / R2 存储替代 iCloud Drive
- 元数据 DB（PostgreSQL / DynamoDB）
- 计费 + 免费层 + Pro 层
- 客户端 onboarding 改为"Self-host / Cloud" 二选一（Cloud 选项从 disabled 变 enabled）

**Wire format 与 V1/V2 self-host 共用**——这是 V1 设计阶段就锁定的硬约束（`/api/v1/` 前缀、stable error codes、AuthStrategy 接口）。

---

## Not on the roadmap (历史决策)

这些之前讨论过，明确**不做**的：

| 决策 | 不做的原因 |
|---|---|
| Web client | 用户决定砍掉，专注 native app |
| 多租户 self-host | 跟"开源核心 + 闭源 Cloud" 模型冲突——多租户能力放 Cloud |
| Redis | 单进程没分布式 cache 需求 |
| CloudKit | 跟 vault-as-files 哲学冲突，且 OpenClaw 用不了 |
| iCloud + SQLite/Redis 文件 | iCloud Drive 不能放活动 DB，会损坏 |
| 把 backend embed 进 macOS app | Lifecycle 错位（app 不开 backend 就停） |
| pluggable storage backend (FS / S3) | 假抽象，两边都不好；cloud 是独立产品而非 config flag |
| GraphQL | REST + RPC 已经够，多一层翻译没收益 |
