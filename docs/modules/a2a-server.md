# Module: A2AServer

> HTTP 服务，接收龙虾发来的截图，触发处理流程，返回结果。

## Source Files

- `src/index.ts` — 入口，启动 HTTP 服务
- `src/server/routes.ts` — HTTP 路由定义

## Responsibilities

1. 接收来自龙虾 (OpenClew Agent) 的截图上传请求
2. 生成 `clipId`，保存截图到临时目录
3. 串行调度整个处理流程（VLM → Fetch → Process → Write）
4. 返回结构化结果，包含供龙虾直接转发的 `message` 字段

## Implementation Notes

- 收到请求后立即生成 `clipId`，保存截图到临时目录
- 整个处理流程同步串行执行，整体超时 90 秒
- 处理成功或失败都返回 `message` 字段，龙虾直接用这个回复微信
- 失败时截图已保存到 Obsidian vault 的 assets 目录，标记为待重试

## Flow

```
POST /clip (image) →
  generateClipId() →
  saveTempScreenshot() →
  vlmAnalyzer.analyze() →
  clipWriter.findSimilar() →   // 去重
  contentFetcher.fetch() →
  contentProcessor.process() →
  screenshotStore.save() →
  clipWriter.write() →
  saveSidecarJson() →
  return ClipResponse
```

## Error Handling

```typescript
try {
  return await handleClipRequest(imageBuffer);
} catch (error) {
  // 确保截图已保存（即使处理失败）
  await screenshotStore.save(clipId, imageBuffer, "png");

  // 写入一条最小化的失败记录到 Obsidian
  await clipWriter.write({
    id: clipId,
    title: "处理失败 - 待重试",
    platform: "unknown",
    fetchLevel: 4,
    // ... 其他字段填默认值
  });

  return {
    success: false,
    clipId,
    error: error.message,
    screenshotSaved: true,
    message: "处理失败，已保存原始截图，请稍后重试",
  };
}
```
