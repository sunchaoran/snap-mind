# Module: InputAdapter

> 统一的输入接入层，接收来自不同客户端的截图，经认证后触发处理流程。

## Source Files

- `src/index.ts` — 入口，启动 HTTP 服务
- `src/server/routes.ts` — HTTP 路由定义
- `src/server/auth.ts` — 认证中间件

## Design Rationale

录入侧不局限于单一客户端。所有客户端（龙虾/OpenClew Agent、Web App、iOS App）统一通过 HTTP API 接入，差异仅在认证方式：

| Client | Auth Method | Description |
|--------|-------------|-------------|
| 龙虾 (OpenClew) | API Key | 服务间调用，固定密钥 |
| Web App | JWT (Bearer Token) | 用户登录后获取 token |
| iOS App | JWT (Bearer Token) | 同 Web App，共享认证体系 |

认证通过后，所有客户端走同一条处理管道，不需要为每个客户端写独立 adapter。

## Interface

```typescript
interface InputAdapter {
  /** 启动服务 */
  start(): Promise<void>;

  /** 停止服务 */
  stop(): Promise<void>;
}
```

## Authentication

```typescript
// 认证中间件：支持 API Key 和 JWT 两种方式
async function authenticate(request): Promise<AuthResult> {
  const authHeader = request.headers.authorization;

  // API Key: "Bearer sk-xxx"
  if (isApiKey(authHeader)) {
    return validateApiKey(authHeader);
  }

  // JWT: "Bearer eyJxxx"
  if (isJwt(authHeader)) {
    return validateJwt(authHeader);
  }

  throw new UnauthorizedError();
}

interface AuthResult {
  clientId: string;       // 客户端标识
  clientType: "agent" | "webapp" | "ios";
}
```

## Responsibilities

1. 接收截图上传请求，执行认证
2. 生成 `clipId`，保存截图到临时目录
3. 串行调度处理流程（VLM → Fetch → Process → Write）
4. 返回结构化结果，包含 `message` 字段（供聊天类客户端直接转发）

## Implementation Notes

- 收到请求后立即生成 `clipId`，保存截图到临时目录
- 整个处理流程同步串行执行，整体超时 90 秒
- 处理成功或失败都返回 `message` 字段
- 失败时截图已保存到 Obsidian vault 的 assets 目录，标记为待重试
- `AuthResult.clientType` 记录到 ClipRecord 中，便于追踪来源

## Flow

```
POST /clip (image + auth header) →
  authenticate() →
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
