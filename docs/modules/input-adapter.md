# Module: InputAdapter

> 统一的输入接入层，接收来自不同客户端的截图，经认证后触发异步处理流程。

## Source Files

- `src/index.ts` — 入口，启动 Fastify HTTP 服务
- `src/server/routes.ts` — HTTP 路由定义 + pipeline 调度
- `src/server/auth.ts` — 认证逻辑
- `src/server/job-store.ts` — 异步 Job 状态管理（内存）

## Design Rationale

录入侧不局限于单一客户端。所有客户端（龙虾/OpenClew Agent、Web App、iOS App）统一通过 HTTP API 接入，差异仅在认证方式：

| Client | Auth Method | Description |
|--------|-------------|-------------|
| 龙虾 (OpenClew) | API Key | 服务间调用，固定密钥 |
| Web App | JWT (Bearer Token) | 用户登录后获取 token（暂未实现） |
| iOS App | JWT (Bearer Token) | 同 Web App，共享认证体系（暂未实现） |

认证通过后，所有客户端走同一条处理管道，不需要为每个客户端写独立 adapter。

## Authentication

```typescript
type AuthenticateResult =
  | { ok: true; value: AuthResult }
  | { ok: false; error: UnauthorizedError };

async function authenticate(request: FastifyRequest): Promise<AuthenticateResult> {
  // Dev 模式：未携带 Authorization header 时跳过认证
  // API Key: token === config.auth.apiKey → clientType "agent"
  // JWT: 暂未实现，当前拒绝非 API Key token
}

interface AuthResult {
  clientId: string;       // 客户端标识
  clientType: "agent" | "webapp" | "ios";
}
```

## Async Job Pattern

当前实现采用异步 Job 模式，而非同步串行返回：

**单张上传：**

1. `POST /clip` 接收截图后，立即返回 `jobId`（HTTP 202）
2. Pipeline 在后台异步执行（fire-and-forget）
3. 客户端通过 `GET /jobs/:id` 轮询进度
4. JobStore 跟踪 7 个步骤的状态

**批量上传（最多 20 张）：**

1. `POST /clip/batch` 接收多张截图，立即返回 `batchId` + `jobIds`（HTTP 202）
2. 每张图创建独立的 Job，通过并发池（默认 5 并发）异步执行
3. 客户端通过 `GET /batch/:id` 轮询整体进度，或 `GET /jobs/:id` 查看单张进度
4. BatchJob 聚合所有子 Job 的完成状态和结果
5. 单张失败不影响其他图的处理

### Job Lifecycle

```
createJob(jobId, clipId) → 初始化 7 个步骤 (pending)
    │
    ├─ stepStart(jobId, stepIndex) → status: "running"
    ├─ stepDone(jobId, stepIndex, message) → status: "done"
    ├─ stepSkipped(jobId, stepIndex) → status: "skipped"
    │
    ├─ jobDone(jobId, result) → 整体完成
    └─ jobError(jobId, result) → 整体失败
```

### Batch Lifecycle

```
createBatchJob(batchId, jobIds[]) → 初始化批次
    │
    ├─ 每张图创建独立 Job（createJob）
    ├─ 并发池控制同时执行数量（maxConcurrentPipelines）
    ├─ batchItemDone(batchId, result) → 单张完成，累计计数
    │
    └─ 全部完成后 batch.status → "done" / "error"
```

### 7-Step Pipeline

| Step | Name | Description |
|------|------|-------------|
| 0 | VLM 截图分析 | 两阶段 VLM 分析 |
| 1 | 去重检查 | findSimilarClip()，命中则跳过后续步骤 |
| 2 | 抓取原文 | 四级策略 L1→L4 |
| 3 | 内容处理 | LLM 摘要/标签/分类 |
| 4 | 保存截图 | 写入 vault assets |
| 5 | 组装记录 | 构建 ClipRecord |
| 6 | 写入 Vault | Markdown 文件 + sidecar JSON |

## Responsibilities

1. 接收截图上传请求（单张或批量），执行认证
2. 生成 `clipId`（复用为 `jobId`），批量时额外生成 `batchId`
3. 创建 Job（或 BatchJob），立即返回 202
4. 后台异步调度处理流程（VLM → Dedup → Fetch → Process → Save → Assemble → Write）
5. 批量上传时通过并发池（默认 5）控制同时处理数量，防止资源耗尽
6. 通过 JobStore 更新每步进度

## Error Handling

```typescript
// Pipeline 整体包裹在 withTimeout() 中（180s 超时）
withTimeout(handleClip(jobId, clipId, imageBuffer), config.processing.overallTimeout)
  .catch(async (error) => {
    // 1. 保存截图到 vault assets（即使处理失败）
    await saveScreenshot(clipId, imageBuffer);

    // 2. 写入一条最小化的失败记录到 Obsidian
    await writeClip({
      id: clipId,
      title: "处理失败 - 待重试",
      platform: "unknown",
      fetchLevel: 4,
      // ... 其他字段填默认值
    });

    // 3. 更新 Job 状态为 error
    jobError(jobId, {
      success: false,
      clipId,
      error: "Pipeline processing failed",
      screenshotSaved: true,
      message: "处理失败，已保存原始截图，请稍后重试",
    });
  });
```

## Server Configuration

- Fastify 实例，注册 `@fastify/multipart` 插件（单文件最大 10MB，单次请求最多 20 个文件）
- Dev 模式：启用 `pino-pretty` 日志格式化，提供 `/dev` 上传测试页面（支持多图选择）
- 监听 `config.server.port`（默认 3210）和 `config.server.host`（默认 0.0.0.0）
- 批量上传参数：`MAX_BATCH_SIZE`（默认 20）、`MAX_CONCURRENT_PIPELINES`（默认 5）
