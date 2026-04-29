# HTTP API

> **本文档将由 OpenAPI spec 自动生成。** 项目尚未发布、V1 路由尚未实现完成，
> 当前没有可用的 OpenAPI 输出。

## 当前 spec 来源

V1 期间，权威 spec 在设计文档里：[api-design.md](../architecture/api-design.md)。
该文档定义：

- 路由表（全部带 `/api/v1/` 前缀）
- Wire format（`ClipRecordWire` / `ClipRecordWireFull` / `JobState` 等）
- 错误信封（`{ error: { code, message, details? } }`）
- Auth 架构（`AuthStrategy` 接口，V1 实现 `ApiKeyStrategy`）
- 实时进度（SSE 端点 `/api/v1/jobs/:id/events`）

## V1 实现完成后

后端通过 `@fastify/swagger` 自动生成 OpenAPI 3 spec，挂在：

- `GET /api/v1/openapi.json` — 机读
- `GET /api/v1/docs` — 人读（Swagger UI）

到那时本文档会被这两个端点链接替代。

## 稳定性承诺（V1 发布后生效）

| 变更 | 是否 breaking | 处理 |
|------|---------------|------|
| 加可选 response 字段 | 否 | 直接发布 |
| 加新端点 | 否 | 直接发布 |
| 删字段 / 改字段类型 / 删端点 | **是** | 需要 `/api/v2/` + 一段 deprecation period |
| `error.code` 重命名 | **是** | 同上 |
| `error.message` 改写 | 否 | client 不应基于 message 做分支 |
