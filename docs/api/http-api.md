# HTTP API Specification

## POST /clip

接收截图，触发完整处理流程，返回收藏结果。

### Request

```
POST /clip
Content-Type: multipart/form-data
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

- `message` 字段供龙虾直接转发给用户，无需二次加工
- 失败时截图仍会保存到 vault assets 目录
- 整体超时：90 秒
