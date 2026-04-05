# HTTP API Specification

## Authentication

所有接口需携带认证信息，支持两种方式：

| Method | Header | Use Case |
|--------|--------|----------|
| API Key | `Authorization: Bearer sk-xxx` | 服务间调用（龙虾等 Agent） |
| JWT | `Authorization: Bearer eyJxxx` | 用户客户端（Web App / iOS App） |

### Response: Unauthorized (401)

```json
{
  "success": false,
  "error": "Unauthorized"
}
```

---

## POST /clip

接收截图，触发完整处理流程，返回收藏结果。

### Request

```
POST /clip
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| image | File (png/jpg/webp) | Yes | 截图文件 |

### Response: Success (200)

```json
{
  "success": true,
  "clipId": "clip_20260402_143000_a3f2",
  "title": "Rust 异步编程指南",
  "platform": "xiaohongshu",
  "tags": ["rust", "async", "编程"],
  "category": "tech",
  "fetchLevel": 1,
  "message": "已收藏: Rust 异步编程指南 [小红书] #rust #async #编程"
}
```

### Response: Error (500)

```json
{
  "success": false,
  "clipId": "clip_20260402_143000_a3f2",
  "error": "All fetch levels failed",
  "screenshotSaved": true,
  "message": "处理失败，已保存原始截图，请稍后重试"
}
```

### Notes

- `message` 字段可供聊天类客户端直接转发给用户
- 失败时截图仍会保存到 vault assets 目录
- 整体超时：90 秒
