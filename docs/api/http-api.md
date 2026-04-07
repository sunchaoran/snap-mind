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
| image | File (png/jpg/webp/gif) | Yes | 截图文件，最大 20MB |

### Response: Accepted (202)

```json
{
  "jobId": "clip_20260402_143000_V1StGX"
}
```

客户端收到 `jobId` 后，通过 `GET /jobs/:id` 轮询处理进度。

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
    "vaultPath": "Clippings/2026-04-02_xiaohongshu_rust-async.md",
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

- Job 数据保存在内存中，30 分钟后自动清理
- `result` 字段仅在 `status` 为 `done` 或 `error` 时存在
- `result.message` 字段可供聊天类客户端直接转发给用户
- 失败时截图仍会保存到 vault assets 目录，并写入一条最小化失败记录
- 整体超时：180 秒
