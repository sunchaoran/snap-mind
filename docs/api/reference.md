# SnapMind HTTP API Reference

> **Auto-generated** from the OpenAPI 3.1 spec by
> `pnpm gen:api-doc`. **Do not edit by hand** — your changes
> will be overwritten on next regeneration.
>
> Source of truth:
> - Shared schemas: [`src/server/plugins/shared-schemas.ts`](../../src/server/plugins/shared-schemas.ts)
> - Per-route annotations: [`src/server/routes/`](../../src/server/routes)

- **Version**: `0.3.0`
- **Base URL**: `http://127.0.0.1:3210`
- **Auth**: `Authorization: Bearer <API_KEY>` (V1 ApiKeyStrategy)
- **Interactive UI**: `/api/docs` (Swagger UI, served by backend)
- **Design doc**: [api-design.md](../architecture/api-design.md) — authoritative契约和决策

self-host backend for snap-mind — 截图即收藏。详见 docs/architecture/api-design.md。

---

## Endpoints

### clips

> Clip 写入 / 读取 / 删除

#### `GET /api/v1/clip`

> List all clips

Reads `ClipRecordWire[]` from the vault. No `contentFull`.

- **Auth**: required (Bearer)
- **Responses**:
  - `200`: object `{ clips }`
  - `401`: [`ErrorEnvelope`](#errorenvelope)

---

#### `POST /api/v1/clip`

> Upload a single screenshot for processing

multipart/form-data with one `image` file field. Returns a `jobId` immediately; the pipeline runs in the background. Poll `GET /api/v1/jobs/:id` or subscribe to `GET /api/v1/jobs/:id/events`. Body schema intentionally omitted — Fastify's JSON schema validator does not understand multipart and would reject valid uploads.

- **Auth**: required (Bearer)
- **Responses**:
  - `202`: object `{ jobId }`
  - `400`: [`ErrorEnvelope`](#errorenvelope)
  - `401`: [`ErrorEnvelope`](#errorenvelope)

---

#### `POST /api/v1/clip/batch`

> Upload up to MAX_BATCH_SIZE screenshots in one request

multipart/form-data with multiple `image` file fields (max defined by `MAX_BATCH_SIZE`, default 50). Returns `batchId` + per-image `jobIds`. Body schema intentionally omitted — see POST /api/v1/clip.

- **Auth**: required (Bearer)
- **Responses**:
  - `202`: object `{ batchId, jobIds, total }`
  - `400`: [`ErrorEnvelope`](#errorenvelope)
  - `401`: [`ErrorEnvelope`](#errorenvelope)

---

#### `GET /api/v1/clip/:id`

> Get one clip by id

Returns `ClipRecordWireFull` (includes `contentFull`).

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `200`: [`ClipRecordWireFull`](#cliprecordwirefull)
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

#### `DELETE /api/v1/clip/:id`

> Hard-delete a clip

Removes the .md and assets from the vault. 204 on success.

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `204`: no body — Deleted (no body)
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

#### `POST /api/v1/clip/:id/retry`

> Retry fetch + process for an existing clip

Re-runs the pipeline (fetch + process + write) against the screenshot already stored in the vault. Reuses the cached VLM sidecar when available; otherwise re-runs VLM. Skips dedup. Refreshes `createdAt` to now. Returns a `jobId` immediately; track via `GET /api/v1/jobs/:id`.

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `202`: object `{ jobId }`
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

### jobs

> 异步 job 快照与 SSE 进度流

#### `GET /api/v1/jobs/:id`

> Job snapshot (polling endpoint)

Returns the current `JobWire` snapshot. State held in memory with TTL.

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `200`: [`JobWire`](#jobwire)
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

#### `GET /api/v1/jobs/:id/events`

> Job progress SSE stream

text/event-stream — emits `step` frames per pipeline step then a terminal `done` or `error` frame. See docs/architecture/api-design.md §7 for the per-event payload shape (intentionally not enumerated here — OpenAPI is poor at describing event-stream framing).

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `200`: `string` — text/event-stream (SSE) — see description above
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

### batch

> 批量 job 聚合

#### `GET /api/v1/batch/:id`

> Batch snapshot (polling endpoint)

Returns the current `BatchWire` snapshot — aggregated from all child jobs.

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `200`: [`BatchWire`](#batchwire)
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

#### `GET /api/v1/batch/:id/events`

> Batch progress SSE stream

text/event-stream — emits a `progress` frame after each child job, then a terminal `done` or `error` frame. See docs/architecture/api-design.md §7 for the per-event payload (intentionally not enumerated — OpenAPI is poor at describing event-stream framing).

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `200`: `string` — text/event-stream (SSE) — see description above
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

### sticky

> sticky session 上传（debounced batch）

#### `POST /api/v1/clip/sticky`

> Push one image to a sticky session

multipart/form-data with one `image` file field; `sessionId` in querystring. The session debounces multiple uploads into a single batch. Body schema intentionally omitted — see POST /api/v1/clip.

- **Auth**: required (Bearer)
- **Query params**:
  - `sessionId` *(required)*: `string`
- **Responses**:
  - `202`: [`StickyWire`](#stickywire)
  - `400`: [`ErrorEnvelope`](#errorenvelope)
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `409`: [`ErrorEnvelope`](#errorenvelope)

---

#### `GET /api/v1/clip/sticky/:sessionId`

> Snapshot of a sticky session

Three phases: `buffering` (collecting images), `processing` (committed to a batch), `done` (batch finished). `batchId` populated only after leaving buffering.

- **Auth**: required (Bearer)
- **Path params**:
  - `sessionId`: `string`
- **Responses**:
  - `200`: [`StickyWire`](#stickywire)
  - `401`: [`ErrorEnvelope`](#errorenvelope)
  - `404`: [`ErrorEnvelope`](#errorenvelope)

---

### meta

> 存活探测 / 系统元数据

#### `GET /`

> Root liveness + entry point

Returns 200 with a tiny JSON body — useful as a quick `is the server up?` probe in a browser, and as a discovery hook pointing at `/api/docs`. No auth.

- **Auth**: not required
- **Responses**:
  - `200`: object `{ name, status, docs }`

---

#### `GET /health`

> Liveness probe

Always returns `{ status: "ok" }` once the process is up. No auth.

- **Auth**: not required
- **Responses**:
  - `200`: object `{ status }`

---

### (untagged)

#### `POST /dev/clear-snap-mind`

- **Auth**: required (Bearer)
- **Responses**:
  - `200`: no body

---

#### `DELETE /dev/clip/:id`

- **Auth**: required (Bearer)
- **Path params**:
  - `id`: `string`
- **Responses**:
  - `200`: no body

---

#### `GET /dev`

- **Auth**: required (Bearer)
- **Responses**:
  - `200`: no body

---

---

## Schemas

### `BatchWire`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✓ |  |
| `status` | `running` \| `done` \| `error` | ✓ |  |
| `jobIds` | array of `string` | ✓ |  |
| `total` | `integer` | ✓ |  |
| `completed` | `integer` | ✓ |  |
| `succeeded` | `integer` | ✓ |  |
| `failed` | `integer` | ✓ |  |
| `results` | array of [`ClipResponse`](#clipresponse) | ✓ |  |
| `createdAt` | `integer` | ✓ | Unix epoch milliseconds |

---

### `Category`

> Predefined category bucket

**Enum** (`string`):

`tech` · `design` · `product` · `business` · `finance` · `science` · `life` · `culture` · `career` · `other`

---

### `ClipRecordWire`

> List view; lacks `contentFull`. See ClipRecordWireFull for detail.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✓ |  |
| `title` | `string` | ✓ | Primary display title — equals aiTitle for new clips, original VLM title for legacy clips. Always present. |
| `aiTitle` | `null` \| `string` | ✓ | LLM-rewritten objective title. null for legacy clips and failure placeholders. |
| `originalTitle` | `string` | ✓ | Raw VLM-extracted title (potentially clickbait). For legacy clips, falls back to the legacy `title` field. |
| `platform` | [`Platform`](#platform) | ✓ |  |
| `author` | `string` | ✓ |  |
| `originalUrl` | `null` \| `string` | ✓ |  |
| `contentType` | [`ContentType`](#contenttype) | ✓ |  |
| `contentSummary` | `string` | ✓ |  |
| `tags` | array of `string` | ✓ |  |
| `category` | [`Category`](#category) | ✓ |  |
| `language` | `string` | ✓ |  |
| `screenshotPath` | `string` | ✓ | vault-relative path |
| `fetchLevel` | `1` \| `2` \| `3` \| `4` | ✓ |  |
| `sourceConfidence` | `number` | ✓ |  |
| `createdAt` | `string` | ✓ | ISO 8601 timestamp from frontmatter |

---

### `ClipRecordWireFull`

> Detail view extending ClipRecordWire with `contentFull`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✓ |  |
| `title` | `string` | ✓ | Primary display title — equals aiTitle for new clips, original VLM title for legacy clips. Always present. |
| `aiTitle` | `null` \| `string` | ✓ | LLM-rewritten objective title. null for legacy clips and failure placeholders. |
| `originalTitle` | `string` | ✓ | Raw VLM-extracted title (potentially clickbait). For legacy clips, falls back to the legacy `title` field. |
| `platform` | [`Platform`](#platform) | ✓ |  |
| `author` | `string` | ✓ |  |
| `originalUrl` | `null` \| `string` | ✓ |  |
| `contentType` | [`ContentType`](#contenttype) | ✓ |  |
| `contentSummary` | `string` | ✓ |  |
| `tags` | array of `string` | ✓ |  |
| `category` | [`Category`](#category) | ✓ |  |
| `language` | `string` | ✓ |  |
| `screenshotPath` | `string` | ✓ |  |
| `fetchLevel` | `1` \| `2` \| `3` \| `4` | ✓ |  |
| `sourceConfidence` | `number` | ✓ |  |
| `createdAt` | `string` | ✓ |  |
| `contentFull` | `null` \| `string` | ✓ | Full markdown body of `## 原文` section |

---

### `ClipResponse`

> job.result shape — also batch.results[] element.

| Field | Type | Required | Notes |
|---|---|---|---|
| `success` | `boolean` | ✓ |  |
| `clipId` | `string` | ✓ |  |
| `title` | `string` | — |  |
| `platform` | [`Platform`](#platform) | — |  |
| `tags` | array of `string` | — |  |
| `category` | [`Category`](#category) | — |  |
| `fetchLevel` | `1` \| `2` \| `3` \| `4` | — |  |
| `vaultPath` | `string` | — | Vault-relative path to the .md file |
| `error` | `string` | — |  |
| `screenshotSaved` | `boolean` | — |  |
| `message` | `string` | ✓ |  |

---

### `ContentType`

> Content type tag from VLM

**Enum** (`string`):

`post` · `article` · `comment` · `video` · `thread`

---

### `ErrorEnvelope`

> 统一错误信封 — 所有非 2xx response。详见 docs/architecture/api-design.md §3。

| Field | Type | Required | Notes |
|---|---|---|---|
| `error` | object `{ code, message, details }` | ✓ |  |

---

### `JobStepWire`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | `string` | ✓ |  |
| `status` | `pending` \| `running` \| `done` \| `skipped` \| `error` | ✓ |  |
| `message` | `string` | — |  |

---

### `JobWire`

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | ✓ |  |
| `clipId` | `string` | ✓ |  |
| `status` | `running` \| `done` \| `error` | ✓ |  |
| `steps` | array of [`JobStepWire`](#jobstepwire) | ✓ |  |
| `currentStep` | `integer` | ✓ |  |
| `result` | [`ClipResponse`](#clipresponse) | — |  |
| `createdAt` | `integer` | ✓ | Unix epoch milliseconds |

---

### `Platform`

> Source platform identifier

**Enum** (`string`):

`xiaohongshu` · `twitter` · `reddit` · `weibo` · `zhihu` · `weixin` · `bilibili` · `douban` · `hackernews` · `youtube` · `medium` · `substack` · `unknown`

---

### `StickyWire`

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionId` | `string` | ✓ |  |
| `status` | `buffering` \| `processing` \| `done` | ✓ |  |
| `queueDepth` | `integer` | ✓ |  |
| `batchId` | `null` \| `string` | — | Set after the session leaves `buffering`; null/absent during buffering. |
| `total` | `integer` | ✓ |  |
| `completed` | `integer` | ✓ |  |
| `succeeded` | `integer` | ✓ |  |
| `failed` | `integer` | ✓ |  |
| `results` | array of [`ClipResponse`](#clipresponse) | ✓ |  |

---
