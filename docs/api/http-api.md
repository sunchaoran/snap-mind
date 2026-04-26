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

## GET /clip

列出 vault 里所有 clip 的精简结构（wire format，不含原文 / VLM 调试字段）。
每次请求都重新扫盘——backend 不维护索引/缓存，client 在内存按需 filter。

### Request

```
GET /clip
Authorization: Bearer <token>
```

### Response: OK (200)

```json
{
  "clips": [
    {
      "id": "clip_20260426_115637_lCNmmh",
      "title": "Karpathy 谈 LLM",
      "platform": "twitter",
      "author": "karpathy",
      "originalUrl": "https://twitter.com/karpathy/status/...",
      "contentType": "post",
      "contentSummary": "三句话摘要……",
      "tags": ["llm", "research"],
      "category": "tech",
      "language": "en",
      "screenshotPath": "snap-mind/assets/clip_20260426_115637_lCNmmh.webp",
      "fetchLevel": 1,
      "sourceConfidence": 0.95,
      "createdAt": "2026-04-26T03:57:19.317Z"
    }
  ]
}
```

### Notes

- 排序：按 `createdAt` 降序（最新的在前）
- 跳过 vault 里的 `_index.md`（Dataview 索引页，不是 clip）
- 同 id 重复（备份/手工编辑产生）只保留 `createdAt` 最早的那一条
- 单条文件解析失败（YAML 损坏 / 必填字段缺失 / 枚举值未知）会被静默跳过，
  整个列表不会因为一条坏文件失败；server 端 `console.warn` 留痕
- 不分页、无 query 过滤——如果 vault 规模超过万级再考虑

---

## GET /clip/:id

按 frontmatter `id` 取单条 clip。返回的是 ClipRecord 对象本身，**不**包
`{ "clips": [...] }` 信封。

### Request

```
GET /clip/clip_20260426_115637_lCNmmh
Authorization: Bearer <token>
```

### Response: OK (200)

返回值的 shape 跟 `GET /clip` 数组里的元素完全一致：

```json
{
  "id": "clip_20260426_115637_lCNmmh",
  "title": "Karpathy 谈 LLM",
  "platform": "twitter",
  "author": "karpathy",
  "originalUrl": "https://twitter.com/karpathy/status/...",
  "contentType": "post",
  "contentSummary": "三句话摘要……",
  "tags": ["llm", "research"],
  "category": "tech",
  "language": "en",
  "screenshotPath": "snap-mind/assets/clip_20260426_115637_lCNmmh.webp",
  "fetchLevel": 1,
  "sourceConfidence": 0.95,
  "createdAt": "2026-04-26T03:57:19.317Z"
}
```

### Response: Not Found (404)

```json
{
  "error": "Clip not found"
}
```

不存在的 id 和"看起来像 path traversal"的 id（含 `..` / `/` / `\` / 空格
等非白名单字符）一律返回 404，不暴露内部校验细节。

---

## DELETE /clip/:id

物理删除一条 clip：

1. unlink frontmatter `id` 匹配的 `<vault>/<clippingsDir>/*.md`
2. unlink `<vault>/<assetsDir>/<id>.*`（截图本体 + `.json` sidecar）
3. 把这条从 backend 的内存 dedup index 里摘掉，避免下次相似截图被错误 dedup
   到一个已经不存在的 id

不动 `_index.md`（下次写入时 backend 会重新生成）；也不会触碰 `<assets>/`
之外的任何文件。删除后**不可恢复**——如果需要回收站语义，请走 Obsidian
自己的 trash。

### Request

```
DELETE /clip/clip_20260426_115637_lCNmmh
Authorization: Bearer <token>
```

### Response: No Content (204)

成功时返回空 body。

### Response: Not Found (404)

```json
{
  "error": "Clip not found"
}
```

跟 GET 一样，越界 id 也会落到 404，不区分"找不到"和"非法"。

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
