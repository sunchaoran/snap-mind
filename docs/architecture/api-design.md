# SnapMind V1 设计

> **状态**：草稿，在 `feat/api-redesign-multi-client` 分支演进中。merge 进 `develop` 后转为权威。
>
> **读者**：backend 实现者、apps 开发者（macOS / iOS）、未来的 Cloud 团队。
>
> **范围**：定义 V1 backend 架构、客户端依赖的公开 HTTP wire format、项目支持的部署形态。**不**涉及 app UX、app 架构、或未来 Cloud 内部实现。

## 1. 产品策略

SnapMind 走 **open core + 闭源 apps + 未来托管 Cloud** 路线：

```
┌─ open source backend ────────────────┐
│  • V1: 你 self-host 在 Mac mini       │
│  • V2: 其他 self-hosters (Mac/Docker/NAS) │
└─ ↑ 同一份 HTTP API 契约 ──────────────┘
   ↓
┌─ closed source apps ─────────────────┐
│  iOS + macOS, App Store 分发          │
│  Onboarding 二选一: self-host / Cloud │
└─ ↓ 同一份 HTTP API 契约 ──────────────┘
   ↑
┌─ Cloud (V3, 由我们托管) ──────────────┐
│  Multi-tenant，账户认证                │
└──────────────────────────────────────┘
```

| 层 | 仓库 | License | 分发 |
|---|---|---|---|
| Backend | `snap-mind` | AGPL-3.0 | GitHub 源码；后续：Docker image、macOS .app installer |
| Apple apps | `snap-mind-apple` | 闭源 | App Store（最终目标）|
| Cloud | `snap-mind-cloud` | 闭源 | 托管服务（V3）|

闭源 apps 既能连 self-hosted backend、也能连 Cloud，**走同一份 wire format**。这是 V1 设计的核心约束。

### 受众

| 受众 | 需要什么 | 优先级 |
|---|---|---|
| 你（V1） | backend 在 Mac mini 跑得稳、安装简单 | P0 |
| 其他 self-hosters（V2+） | Docker image、清晰的部署文档、vault path 配置 | P1 |
| Apps 开发者（你自己，V1+） | 稳定的 wire format、OpenAPI spec、错误码 | P0 |
| OpenClaw 等 chat-style 集成（V1+） | sticky session API、CLI 工具入口 | P2（接口保留，不催实现） |
| Cloud 用户（V3） | 账户认证、配额、计费 | P3 |

V1 只交付 P0 需要的，但**不阻断**任何 P1+ 的需求。

## 2. 仓库与许可

### 仓库结构

- `snap-mind`（本仓库）— backend + skill + CLI，AGPL-3.0 开源
  - `src/` — TypeScript backend
  - `cli/snap-mind-cli/` — OpenClaw skill 调用的小 CLI（接口保留，V1 不催实现）
  - `skills/` — OpenClaw 等 skill 定义
  - `docs/` — 公开的设计 + API + 部署文档
- `snap-mind-apple`（独立私有仓）— iOS + macOS 客户端，SwiftPM workspace
- `snap-mind-cloud`（独立私有仓，V3）— Cloud 专用代码

### 为什么选 AGPL-3.0

Self-hosters 自由使用。任何人修改后**作为服务对外提供**必须开源他们的修改。这保护了未来 Cloud 业务不被第三方（AWS、国内云厂等）轻易托管搬走，同时仍是 OSI / FSF 认可的真正开源 license。

考虑过的替代：MIT（无保护）、BSL（非 OSI 认可、社区接受度低）。

### Wire format 归属

OpenAPI spec 放在本仓 `docs/api/openapi.yaml`（由 `@fastify/swagger` 从 Fastify 路由自动生成）。Apps 仓通过 codegen 消费。**Backend 是契约的 source of truth**。

## 3. Wire Format（公开契约）

### 版本前缀

- 所有资源路径自 V1 起统一在 **`/api/v1/`** 下。项目尚未发布，无遗留路径需要兼容。
- 版本升级规则：**breaking change** 走 `/api/v2/`，并对 `/api/v1/` 保留一段 deprecation period。给已有 response 加可选字段**不是** breaking。
- `/health` 和 `/api/docs`（Swagger UI）在 `/api/v1/` 之外——它们不是契约的一部分。

### 路由表

```
# Auth + meta
GET  /health                                  无需 auth — 存活探测
GET  /api/docs                                无需 auth — Swagger UI
GET  /api/v1/whoami                           返回当前 auth context（debug 辅助）

# Clip 写入
POST /api/v1/clip                             单张截图 → jobId
POST /api/v1/clip/batch                       最多 20 张 → batchId + jobIds
POST /api/v1/clip/sticky?sessionId=...        debounced batch（chat-style channels）
GET  /api/v1/clip/sticky/:sessionId           sticky session 快照

# 异步进度
GET  /api/v1/jobs/:id                         job 快照（polling）
GET  /api/v1/jobs/:id/events                  job 进度 SSE 流
GET  /api/v1/batch/:id                        batch 快照（polling）
GET  /api/v1/batch/:id/events                 batch 进度 SSE 流

# Clip 读取 / 详情 / 删除
GET  /api/v1/clip                             list（ClipRecordWire[]，不含 contentFull）
GET  /api/v1/clip/:id                         detail（ClipRecordWireFull，含 contentFull）
DELETE /api/v1/clip/:id                       硬删除
GET  /api/v1/clip/:id/image                   截图字节流（可选 ?w=）
```

仅在 dev 环境额外注册的 endpoint（不属于 wire format 契约）：

```
GET  /dev                                     上传调试页面（NODE_ENV !== production）
POST /dev/clear-snap-mind                     清空 vault 测试数据
```

这两个仅供 backend 开发自测，不暴露给 apps。

### Wire 类型

TypeScript 类型放在 `src/types/wire.ts`，是 source of truth。两个核心类型：

```typescript
interface ClipRecordWire {
  id: string;
  title: string;
  platform: Platform;
  author: string;
  originalUrl: string | null;
  contentType: ContentType;
  contentSummary: string;
  tags: string[];
  category: Category;
  language: string;
  screenshotPath: string;        // vault-relative
  fetchLevel: 1 | 2 | 3 | 4;
  sourceConfidence: number;
  createdAt: string;             // ISO 8601
}

interface ClipRecordWireFull extends ClipRecordWire {
  contentFull: string | null;
}
```

`ClipRecordWire` 走 `GET /api/v1/clip`（list）。`ClipRecordWireFull` 走 `GET /api/v1/clip/:id`（detail）。

`rawVlmResult` **永远不**通过 wire format 暴露——它是 debug 元数据，仅在 vault 内的 `<assets>/<id>.json` sidecar 文件里。

### 统一错误信封

所有非 2xx response 用同一个 shape：

```json
{
  "error": {
    "code": "clip_not_found",
    "message": "Clip not found",
    "details": null
  }
}
```

| `code`（snake_case） | HTTP status | 含义 |
|---|---|---|
| `unauthorized` | 401 | 缺失或无效的 Bearer token |
| `forbidden` | 403 | 已认证但无权限（V2 占位）|
| `not_found` | 404 | URL 没匹配到任何 route（vs 资源级 `<resource>_not_found`）|
| `clip_not_found` | 404 | id 不存在；非法 id 也返这个（避免泄漏校验细节）|
| `job_not_found` | 404 | jobId 已过期或从未存在 |
| `batch_not_found` | 404 | batchId 已过期或从未存在 |
| `sticky_session_not_found` | 404 | sessionId 已过期或从未存在 |
| `missing_image` | 400 | multipart 缺 image 字段 |
| `no_images` | 400 | batch 上传零张图 |
| `too_many_images` | 400 | batch 超过 MAX_BATCH_SIZE |
| `missing_session_id` | 400 | sticky 上传缺 sessionId |
| `sticky_wrong_state` | 409 | sticky session 已离开 `buffering` 阶段 |
| `sticky_batch_full` | 400 | sticky session 已达 MAX_BATCH_SIZE |
| `rate_limited` | 429 | 超过限流 |
| `internal_error` | 500 | 兜底——稳态下不应出现 |

**稳定性**：`code` 是 STABLE 的——客户端按 code 做分支。`message` 可改写以提升清晰度，code 不动。

### 请求 / 响应头

| Header | 方向 | 用途 |
|---|---|---|
| `Authorization: Bearer <token>` | client → server | API key（V1）或 JWT（V3 Cloud）|
| `Content-Type: application/json` | 双向 | 默认 |
| `Content-Type: multipart/form-data` | client → server | 截图上传 |
| `Content-Type: text/event-stream` | server → client | SSE response |
| `Cache-Control: no-store` | server → client | 写操作 response |
| `X-Request-Id: <uuid>` | 双向 | per-request 追踪（server 在缺失时生成）|

## 4. Auth 架构

### Strategy 接口

```typescript
interface AuthStrategy {
  authenticate(req: FastifyRequest): Promise<AuthResult>;
}

type AuthResult =
  | { ok: true; principal: { type: 'user' | 'service'; id: string } }
  | { ok: false; error: AuthError };
```

V1 **只交付 `ApiKeyStrategy`**。V3 Cloud 加 `JwtStrategy`。同一个 Fastify hook，运行时按部署模式选 strategy。

### V1 的 ApiKeyStrategy

从 `process.env.API_KEY` 读单个共享 token。Bearer token 用 constant-time 比对。

未来不破坏 API 的演进方向：

- 多个 key 带 label（service vs user）
- Key rotation
- Per-key rate limit / scope

这些是 server 内部扩展；clients 始终发 `Authorization: Bearer <token>`。

### V3 Cloud 的 JwtStrategy（仅勾画，非 V1 工作）

校验由 Cloud auth service 签发的 JWT。Claims 含 `userId`、`tier` 等。`principal.type === 'user'`、`principal.id === userId`。Backend 用 principal 隔离 vault 路径 / 计算配额。

### Dev 模式跳过

`NODE_ENV !== 'production'` 且无 `Authorization` header → ApiKeyStrategy 返回 ok，`principal: { type: 'service', id: 'dev' }`。测试通过设 `NODE_ENV=production` 走严格分支（参见 `vitest.config.ts`）。

## 5. Storage / Vault 架构

### Vault 就是一个目录

```
<VAULT_BASE>/
  <clippingsDir>/                    # 默认 "snap-mind"
    _index.md                        # Dataview 索引页（自动重生成）
    YYYY-MM-DD_<platform>_<slug>.md  # 每条 clip 一个 .md
    assets/
      <clipId>.<ext>                 # 截图
      <clipId>.json                  # rawVlmResult sidecar
```

Vault 是**文件系统目录**，backend 用标准 `fs` API 读写。对底层存储不做任何假设：

- macOS 用户：通常指向 `~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/`
- Linux self-hosters：`/data/vault` 或任何路径
- NAS：SMB / NFS mount
- Docker：volume mount

### macOS-iCloud 边界条件（部署关切，非核心架构）

下面这些在 parser 层处理，但**规则放在部署文档，不放在核心架构**：

- iCloud 标记为 "online-only" 的文件：backend 按需打开，首次读会短暂阻塞等 iCloud 下载。可接受。
- 冲突文件（`foo (Conflict 1).md`、`foo (冲突 1).md`）：parser **跳过**并 warn，让用户在 Obsidian 里自己合并。
- 最终一致：chokidar 监听 vault；任何文件变化触发 dedup index 失效。多 Mac 场景下，对端 Mac 的写入在 iCloud 正常同步窗口内可见。

Linux / Docker 用户碰不到上述任何一条。

### V1 不上 SQLite

读路径每次 `GET /api/v1/clip` 都全量扫盘。几千条以内可接受。再大就无脑加 SQLite index，**不改 API**。

实现收口在 `src/library/clips.ts` 单文件——不假装 polymorphic。SQLite 真要来时，重写这个文件即可。

## 6. 模块边界

```
src/
├── index.ts                # 入口：Fastify + plugins + routes
├── config.ts               # env 驱动的配置
├── vault.ts                # 共享的 vault 格式常量
├── server/
│   ├── plugins/
│   │   ├── auth.ts         # 注册 AuthStrategy hook
│   │   ├── rate-limit.ts   # @fastify/rate-limit
│   │   ├── swagger.ts      # @fastify/swagger + swagger-ui
│   │   └── error-handler.ts# 统一错误信封
│   ├── routes/
│   │   ├── clip-write.ts   # POST /clip, /clip/batch
│   │   ├── clip-sticky.ts  # POST /clip/sticky, GET /clip/sticky/:id
│   │   ├── clip-read.ts    # GET /clip, GET /clip/:id, DELETE /clip/:id, GET /clip/:id/image
│   │   ├── jobs.ts         # GET /jobs/:id, /jobs/:id/events
│   │   ├── batch.ts        # GET /batch/:id, /batch/:id/events
│   │   └── meta.ts         # /health, /whoami
│   ├── auth/
│   │   ├── strategy.ts     # AuthStrategy 接口
│   │   ├── api-key.ts      # V1 实现
│   │   └── (jwt.ts)        # V3 占位
│   ├── errors.ts           # 错误码常量 + 信封 helper
│   └── job-store.ts        # 内存中的 Job/Batch/Sticky 状态（带 TTL）
├── pipeline/
│   ├── index.ts            # handleClip 编排
│   ├── timing.ts           # step timing helpers
│   └── failure.ts          # handleFailure（fetchLevel=4 路径）
├── library/
│   └── clips.ts            # vault 读 / 解析 / 删除
├── writer/
│   ├── interface.ts
│   ├── markdown.ts
│   └── template.ts
├── store/
│   └── screenshot.ts
├── fetcher/                # 不变
├── processor/              # 不变
├── vlm/                    # 不变
├── prompts/                # 不变
├── utils/                  # 不变
└── types/
    ├── wire.ts             # ClipRecordWire, ClipRecordWireFull, ErrorEnvelope, Job, Batch, Sticky
    └── domain.ts           # ClipRecord（内部）, VLMAnalysis, Platform, Category, ContentType
```

### 为什么这么切

- **`server/` vs `pipeline/`**：HTTP transport 跟业务逻辑解耦。pipeline 的测试不需要 Fastify。Cloud 版本可以把 pipeline 挪到 worker。
- **`library/` vs `writer/`**：读和写是不同关注点。同一份 vault 格式，操作不同。
- **`auth/strategy.ts`**：现在不付 V2 成本，但留好接口。
- **`types/wire.ts` vs `types/domain.ts`**：公开契约 vs 内部类型。Wire types 出口给 clients。

### 启动时的 plugin 顺序

```
1. registerErrorHandler  （最早，让后续所有错误都走统一信封）
2. registerRateLimit     （在重 handler 之前）
3. registerAuth          （在路由注册之前）
4. registerSwagger       （introspect 之后注册的所有路由）
5. registerRoutes        （API 表面）
```

## 7. 异步 pipeline 与实时进度

### Job 模型（写路径）

三个写入入口共享同一份异步底座：

```
POST /api/v1/clip              → 1 个 jobId
POST /api/v1/clip/batch        → 1 个 batchId + N 个 jobIds
POST /api/v1/clip/sticky       → 1 个 sessionId，debounce 后 → 1 个 batchId + N 个 jobIds
```

**Job** 是一张截图的 pipeline 跑（约 7 步）。**Batch** 把 N 个 Job 聚合。**Sticky session** 把多次上传按 debounce 合并，最终落到一个 Batch。

### Polling vs SSE

**两者都支持**。pipeline 长（≥10s）时优先 SSE；polling 是 fallback。

```
# Polling（永远可用）
GET /api/v1/jobs/:id           → 快照

# SSE（开一条长连接、推每一步）
GET /api/v1/jobs/:id/events    → text/event-stream
                                 event: step
                                 data: {"step":2,"status":"running","message":"..."}
                                 ...
                                 event: done
                                 data: {"result":{...}}
```

batch 用一样的形式。

### V1 状态不持久化

Job / Batch / Sticky 状态在进程内存里，30 分钟 TTL。重启丢失在飞 Job。

V1 接受这个的理由：

- 单 Mac 部署
- LaunchAgent 重启不频繁
- Mac 睡眠不会杀进程；只有系统更新会
- 丢一个 pipeline = 客户端重传一次

V2+ 如果痛了再加 SQLite-backed job 持久化。`JobStore` 模块已经把存储封装好。

## 8. 部署形态

### Mode 1：你自己在 Mac mini 上 self-host（V1）

```bash
git clone https://github.com/<you>/snap-mind
cd snap-mind
pnpm install
cp .env.example .env  # 填 API_KEY、LLM_PROVIDER_TARGET（默认 openrouter，对应填 OPENROUTER_API_KEY）、OBSIDIAN_VAULT_PATH
pnpm build

# 装成 LaunchAgent（自启 + KeepAlive）
./scripts/install-launchd.sh

# 验证
curl http://localhost:3210/health
```

`install-launchd.sh` 写 `~/Library/LaunchAgents/dev.snap-mind.server.plist` 然后 `launchctl load`。

其它设备通过 Tailscale 访问：`https://<mac-name>.<tailnet>.ts.net:3210`（Tailscale Serve 处理 TLS）。

### Mode 2：Mac 用户通过 .app installer（V2）

一个 macOS .app bundle：

- 内嵌 `snap-mind-server` binary（Node SEA 或 Bun --compile）
- Onboarding 收集 API key、vault path、LLM provider 选择（OpenRouter token 或本地 server 配置），写 LaunchAgent
- 自更新机制（Sparkle 或类似）

V1 不做；`install-launchd.sh` 是过渡。

### Mode 3：Linux / Docker self-host（V2）

```yaml
# docker-compose.yml
services:
  snap-mind:
    image: ghcr.io/<you>/snap-mind:latest
    ports: ["3210:3210"]
    volumes:
      - ./vault:/vault
    environment:
      OBSIDIAN_VAULT_PATH: /vault
      API_KEY: ${API_KEY}
      LLM_PROVIDER_TARGET: ${LLM_PROVIDER_TARGET:-openrouter}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
```

V1 写好 Dockerfile 但不 publish image。文档里留这条路给将来贡献者。

非 macOS 部署需要注意：

- 没有 iCloud 边界条件
- Playwright（L2 fetch）需要 image 里装 Chromium（约 +300MB）
- chokidar 在 Linux 用 inotify，工作正常

### Mode 4：SnapMind Cloud（V3）

延后。仅勾画：

- 同一份 backend 代码的多租户部署
- Auth：JWT + 账户系统（独立的 auth service）
- 存储：每用户单独 S3 bucket，或共享 bucket + prefix 隔离
- 没有 iCloud / Obsidian 集成（Cloud 用户直接通过 apps 编辑）
- 不同的产品形态，但 wire format 共用

## 9. 横切关切

### 网络暴露

**默认**绑 `127.0.0.1` + `100.x.y.z`（Tailscale 接口）。**绝不**绑 `0.0.0.0`，除非通过 env var 显式 opt-in（启动时打 warning）。

这是防公网扫描的第一道防线，rate limit 是第二道。

### Rate limiting

`@fastify/rate-limit`：

- 已认证路由：120 req/min/IP（很宽，正经客户端打不到）
- 未认证请求：10 req/min/IP（卡爆破和扫描器流量）
- 429 response 走统一错误信封

### 日志

`pino` + redaction：

```typescript
{
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.token'],
    censor: '[REDACTED]',
  },
}
```

每个请求带 `X-Request-Id`。`error` 级别的 log 带 request id，client 报问题时引用。

### CORS、Helmet 等

**V1 不需要**（Tailscale-only 访问、单一来源 client、无浏览器环境）。

延后到 V2+：

- CORS：仅在出现"由你之外的人"用浏览器写客户端时考虑
- Helmet：仅在出现需要由 backend 输出浏览器内容时考虑

`/dev` 上传页面是 backend 自身调试用，不构成对外的 web 客户端，不需要为它加 CORS。

### Observability

V1 只发 pino logs，不接 metrics、tracing、Sentry。单用户，自己看自己的日志。

## 10. 待确认决策

下面这些不阻断开工，但实施定型前要 confirm：

| 决策 | 默认值 | 状态 |
|---|---|---|
| Tailscale 用于跨设备访问 | 是 | 已确认（V1 上线前装好） |
| Backend 仅监听 Tailscale + 127.0.0.1 | 是 | 已确认（由 Tailscale 决策推导）|
| 用 LaunchAgent 做 production 进程管理 | 是 | 已确认 |
| 暴露 OpenAPI / Swagger UI | 是 | 已确认 |
| Job 进度用 SSE | 是 | 已确认 |
| mDNS / Bonjour 让 app 自动发现 backend | 否（V1+ 加分项）| 锦上添花 |
| 发布 Docker image | V1 不发布 | V2 文档化 |

## 11. V1 实现 backlog

V1 是从零搭，不做 V0 → V1 的兼容迁移。下面是把工作切成可独立 land 的 feature 分支顺序：

1. **`feat/api-v1-prefix`** — 全部路由加 `/api/v1/` 前缀。直接重写，无兼容 shim。仓内现有的 OpenClaw skill / CLI 跟着同步改即可（接口保留，本身不重写）。
2. **`feat/auth-strategy`** — 把内联 auth 重构为 `AuthStrategy` + Fastify hook。`ApiKeyStrategy` 是唯一实现。
3. **`feat/error-envelope`** — 全部 response 走统一 `{ error: { code, message } }`；替换现有不一致的错误形态；同步更新测试。
4. **`feat/route-split`** — 把 `routes.ts` 切到 `server/routes/clip-write.ts` 等多文件。纯 refactor，无行为变化。
5. **`feat/pipeline-extract`** — 把 pipeline 编排从 `routes.ts` 抽到 `pipeline/`。纯 refactor。
6. **`feat/types-split`** — 拆 `types/wire.ts`（公开）和 `types/domain.ts`（内部）。
7. **`feat/sse-job-events`** — 加 `/api/v1/jobs/:id/events` 和 `/api/v1/batch/:id/events`。原 polling 端点不变。
8. **`feat/rate-limit-and-logging`** — 加 `@fastify/rate-limit` + pino redaction。
9. **`feat/openapi-swagger`** — `@fastify/swagger` + `/api/docs` UI；OpenAPI spec 在 build 时落到 `docs/api/openapi.yaml`。
10. **`feat/install-launchd-script`** — `scripts/install-launchd.sh` + plist 模板 + 部署文档。

每个分支 1-3 个 commit 体量。顺序不强制，但 1-3 落完才能让客户端开始切到 V1。9 在前面稳定后做最有意义。

OpenClaw skill / CLI 本身的功能完善（比如 `--cdn`/`--aes-key` 那些）属于 P2，**V1 不催**。设计文档把它们的入口（POST /clip/sticky 等）锁定即可。

## 12. 实施节奏

V1 受众只有你一个，无 race。分支随写随 land，间隔几天在 Mac mini 上跑一跑，磨掉粗糙边。最后切 `v1.0.0` tag，开 apps 仓。

---

**下一步**：锁掉 §10 待确认决策，从 `feat/api-v1-prefix` 开始。
