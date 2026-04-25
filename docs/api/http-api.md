# HTTP API Specification

## Authentication

所有接口需携带认证信息（`/health` 和 `/dev` 除外），支持两种方式：

| Method | Header | Use Case |
|--------|--------|----------|
| API Key | `Authorization: Bearer sk-xxx` | 服务间调用（龙虾等 Agent） |
| JWT | `Authorization: Bearer eyJxxx` | 用户客户端（Web App / iOS App），暂未实现 |

> Dev 模式下（`NODE_ENV !== 'production'`），未携带 Authorization header 时跳过认证。

### Response: Unauthorized (401)

```json
{
  "success": false,
  "error": "Missing or invalid Authorization header"
}
```

---

## POST /clip

接收截图，创建异步处理 Job，立即返回 `jobId`。

### Request

```
POST /clip
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| image | File (png/jpg/webp/gif) | Yes | 截图文件，最大 10MB（上传后自动压缩为 WebP） |

### Response: Accepted (202)

```json
{
  "jobId": "clip_20260402_143000_V1StGX"
}
```

客户端收到 `jobId` 后，通过 `GET /jobs/:id` 轮询处理进度。

---

## POST /clip/batch

批量上传多张截图，每张图独立创建异步处理 Job，全部并发执行。

### Request

```
POST /clip/batch
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| images | File[] (png/jpg/webp/gif) | Yes | 截图文件，每张最大 10MB，最多 20 张（上传后自动压缩为 WebP） |

### Response: Accepted (202)

```json
{
  "batchId": "batch_clip_20260407_143000_V1StGX",
  "jobIds": [
    "clip_20260407_143000_A1B2C3",
    "clip_20260407_143001_D4E5F6",
    "clip_20260407_143002_G7H8I9"
  ],
  "total": 3
}
```

客户端收到 `batchId` 后，可通过以下方式追踪进度：
- `GET /batch/:id` — 查询整体批次进度
- `GET /jobs/:id` — 查询单个 Job 进度（使用 `jobIds` 中的 ID）

### Response: Bad Request (400)

```json
{
  "success": false,
  "error": "Too many images. Max 20 per batch"
}
```

---

## POST /clip/sticky

把一张截图加入指定 sticky session 的 buffer。同 sessionId 的连续上传会**重置 5 秒静默 timer**；停发 5 秒后整批转给 `/clip/batch` 处理流程。专为 chat-style channel（OpenClaw skill / 微信 ClawBot）设计：用户连发多张图归并成一次回执。

### Request

```
POST /clip/sticky?sessionId=<id>
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

| Field / Param | Type | Required | Description |
|---|---|---|---|
| `sessionId` (query) | string | Yes | 客户端定义的稳定标识；同一 sessionId 的多次上传归并为一批 |
| `image` | File | Yes | 单张截图（最大 10MB） |

### Response: Accepted (202)

```json
{
  "sessionId": "u_alice_20260425",
  "queueDepth": 3,
  "status": "buffering"
}
```

`queueDepth` = session 当前已累计的图数；`status` 在此阶段恒为 `buffering`。

### Response: Bad Request (400)

```json
{
  "success": false,
  "error": "Session ... reached max batch size (20)",
  "code": "batch_full"
}
```

### Response: Conflict (409)

session 已经进入 `processing` / `done` 阶段后再 push：

```json
{
  "success": false,
  "error": "Session ... is no longer buffering (current: processing)",
  "code": "wrong_state"
}
```

调用方应使用新的 sessionId 开新 session。

---

## GET /clip/sticky/:sessionId

查询 sticky session 的状态。无需认证。

### Request

```
GET /clip/sticky/:sessionId
```

### Response: Buffering (200)

debounce 窗口未结束，还在等更多图：

```json
{
  "sessionId": "u_alice_20260425",
  "status": "buffering",
  "queueDepth": 3,
  "total": 3,
  "completed": 0,
  "succeeded": 0,
  "failed": 0,
  "results": []
}
```

### Response: Processing (200)

debounce 关闭后批量 pipeline 已启动，部分完成：

```json
{
  "sessionId": "u_alice_20260425",
  "status": "processing",
  "queueDepth": 3,
  "batchId": "batch_clip_20260425_153000_AbCdEf",
  "total": 3,
  "completed": 1,
  "succeeded": 1,
  "failed": 0,
  "results": [
    {
      "success": true,
      "clipId": "...",
      "title": "...",
      "platform": "xiaohongshu",
      "tags": ["..."],
      "message": "已收藏: ..."
    }
  ]
}
```

### Response: Done (200)

```json
{
  "sessionId": "u_alice_20260425",
  "status": "done",
  "queueDepth": 3,
  "batchId": "batch_...",
  "total": 3,
  "completed": 3,
  "succeeded": 2,
  "failed": 1,
  "results": ["..."]
}
```

### Response: Not Found (404)

```json
{
  "error": "Sticky session not found"
}
```

### Notes

- Debounce 窗口：**5 秒静默**触发批量；每次 push 重置。
- 单 session 最多累积 `MAX_BATCH_SIZE` 张（默认 20）。
- session 数据在内存中保留 30 分钟（与 Job/Batch 一致），过期清理。
- `done` 状态下 results 数组就是最终结果，可直接展示给用户；包含 `success: false` 的项是失败但截图仍保存到 vault。

---

## GET /batch/:id

查询批量任务的整体进度。无需认证。

### Request

```
GET /batch/:id
```

### Response: Running (200)

```json
{
  "id": "batch_clip_20260407_143000_V1StGX",
  "status": "running",
  "jobIds": ["clip_20260407_143000_A1B2C3", "clip_20260407_143001_D4E5F6"],
  "total": 2,
  "completed": 1,
  "succeeded": 1,
  "failed": 0,
  "results": [
    {
      "success": true,
      "clipId": "clip_20260407_143000_A1B2C3",
      "title": "Rust 异步编程指南",
      "message": "已收藏: Rust 异步编程指南 [xiaohongshu] #rust #async"
    }
  ]
}
```

### Response: Done (200)

```json
{
  "id": "batch_clip_20260407_143000_V1StGX",
  "status": "done",
  "total": 2,
  "completed": 2,
  "succeeded": 2,
  "failed": 0,
  "results": ["..."]
}
```

### Response: Not Found (404)

```json
{
  "error": "Batch not found"
}
```

---

## GET /jobs/:id

查询 Job 的实时状态和各步骤进度。无需认证。

### Request

```
GET /jobs/:id
```

### Response: Running (200)

```json
{
  "id": "clip_20260402_143000_V1StGX",
  "clipId": "clip_20260402_143000_V1StGX",
  "status": "running",
  "currentStep": 2,
  "steps": [
    { "name": "VLM 截图分析", "status": "done", "message": "识别为 xiaohongshu，置信度 0.95" },
    { "name": "去重检查", "status": "done", "message": "无重复" },
    { "name": "抓取原文", "status": "running", "message": "抓取原文内容…" },
    { "name": "内容处理", "status": "pending" },
    { "name": "保存截图", "status": "pending" },
    { "name": "组装记录", "status": "pending" },
    { "name": "写入 Vault", "status": "pending" }
  ]
}
```

### Response: Done (200)

```json
{
  "id": "clip_20260402_143000_V1StGX",
  "clipId": "clip_20260402_143000_V1StGX",
  "status": "done",
  "currentStep": 6,
  "steps": [ "..." ],
  "result": {
    "success": true,
    "clipId": "clip_20260402_143000_V1StGX",
    "title": "Rust 异步编程指南",
    "platform": "xiaohongshu",
    "tags": ["rust", "async", "编程"],
    "category": "tech",
    "fetchLevel": 1,
    "vaultPath": "snap-mind/2026-04-02_xiaohongshu_rust-async.md",
    "message": "已收藏: Rust 异步编程指南 [小红书] #rust #async #编程"
  }
}
```

### Response: Error (200)

```json
{
  "id": "clip_20260402_143000_V1StGX",
  "clipId": "clip_20260402_143000_V1StGX",
  "status": "error",
  "steps": [ "..." ],
  "result": {
    "success": false,
    "clipId": "clip_20260402_143000_V1StGX",
    "error": "Pipeline processing failed",
    "screenshotSaved": true,
    "message": "处理失败，已保存原始截图，请稍后重试"
  }
}
```

### Response: Not Found (404)

```json
{
  "error": "Job not found"
}
```

---

## GET /health

健康检查端点，无需认证。

```json
{
  "status": "ok"
}
```

---

## GET /dev

Dev 模式专用，返回上传测试页面（HTML）。仅在 `NODE_ENV !== 'production'` 时可用。

---

## Step Status 枚举

| Status | Description |
|--------|-------------|
| `pending` | 等待执行 |
| `running` | 正在执行 |
| `done` | 完成 |
| `skipped` | 跳过（如去重命中后续步骤） |
| `error` | 失败 |

## Notes

- Job 和 Batch 数据保存在内存中，30 分钟后自动清理
- `result` 字段仅在 `status` 为 `done` 或 `error` 时存在
- `result.message` 字段可供聊天类客户端直接转发给用户
- 失败时截图仍会保存到 vault assets 目录，并写入一条最小化失败记录
- 单个 Pipeline 超时：300 秒
- 批量上传默认最多 20 张，并发处理数默认 5（可通过 `MAX_BATCH_SIZE` 和 `MAX_CONCURRENT_PIPELINES` 配置）
- 批量任务中每张图独立处理，互不影响——单张失败不会中断其他图的处理
