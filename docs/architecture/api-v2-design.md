# SnapMind V1 Design

> **Status**: Draft, in progress on `feat/api-redesign-multi-client`. Authoritative once merged to `develop`.
>
> **Audience**: Backend implementers, app developers (Mac / iOS), future Cloud team.
>
> **Scope**: Defines the V1 backend architecture, the public HTTP wire format clients depend on, and the deployment paths the project supports. Does **not** specify app UX, app architecture, or future Cloud internals.

## 1. Product Strategy

SnapMind ships as **open core + closed apps + future managed Cloud**:

```
┌─ open source backend ────────────────┐
│  • V1: 你 self-host on Mac mini       │
│  • V2: 其他 self-hosters (Mac / Docker / NAS)│
└─ ↑ same HTTP API contract ───────────┘
   ↓
┌─ closed source apps ─────────────────┐
│  iOS + macOS, App Store distribution  │
│  Onboarding 二选一: self-host / cloud │
└─ ↓ same HTTP API contract ───────────┘
   ↑
┌─ Cloud (V3, hosted by us) ───────────┐
│  Multi-tenant, account auth           │
└──────────────────────────────────────┘
```

| Layer | Repo | License | Distribution |
|---|---|---|---|
| Backend | `snap-mind` | AGPL-3.0 | Source on GitHub; future: Docker image, macOS .app installer |
| Apple apps | `snap-mind-apple` | Closed | App Store (eventually) |
| Cloud | `snap-mind-cloud` | Closed | Hosted service (V3) |

The closed-source apps talk to either a self-hosted backend OR Cloud through **the same wire format**. This is the central design constraint that drives everything below.

### Audience

| Audience | What they need | Priority |
|---|---|---|
| You (V1) | Backend works on your Mac mini, simple install | P0 |
| Other self-hosters (V2+) | Docker image, clear setup docs, vault path config | P1 |
| App developers (your own work, V1+) | Stable wire format, OpenAPI spec, error codes | P0 |
| Cloud users (V3) | Account auth, quota, billing | P3 |

V1 ships only what P0 needs but **does not preclude** any P1+ requirement.

## 2. Repository & Licensing

### Layout

- `snap-mind` (this repo) — backend + skill + CLI, open source AGPL-3.0
  - `src/` — TypeScript backend
  - `cli/snap-mind-cli/` — small CLI used by OpenClaw skill
  - `skills/` — OpenClaw / similar skill definitions
  - `docs/` — public design + API + deployment docs
- `snap-mind-apple` (separate, private) — iOS + macOS clients, SwiftPM workspace
- `snap-mind-cloud` (separate, private, V3) — Cloud-specific code

### Why AGPL-3.0

Self-hosters can use freely. Anyone modifying and offering as a service must open-source their changes. Protects future Cloud business from being trivially re-hosted by a third party (AWS, China cloud vendors, etc.) while still being a real open-source license recognized by OSI / FSF.

Alternatives considered: MIT (no protection), BSL (not OSI-approved, smaller community).

### Wire format ownership

The OpenAPI spec lives in this repo at `docs/api/openapi.yaml` (generated from Fastify routes via `@fastify/swagger`). Apps repo consumes it via codegen. **Backend is the source of truth** for the contract.

## 3. Wire Format (the public contract)

### Versioning

- All resource paths under **`/api/v1/`** from V1 onwards. Non-prefixed paths from V0 are removed (no back-compat — V1 is the first stable shape).
- Version bump rule: **breaking changes** require `/api/v2/` and a deprecation period for `/api/v1/`. Adding optional fields to existing responses is **not** breaking.
- `/health` and `/api/docs` (Swagger UI) sit outside `/api/v1/` because they're not part of the contract.

### Route Table

```
# Auth + meta
GET  /health                                  no auth — liveness
GET  /api/docs                                no auth — Swagger UI
GET  /api/v1/whoami                           returns auth context (debug aid)

# Clip write
POST /api/v1/clip                             single screenshot → jobId
POST /api/v1/clip/batch                       up to 20 screenshots → batchId + jobIds
POST /api/v1/clip/sticky?sessionId=...        debounced batch (chat-style channels)
GET  /api/v1/clip/sticky/:sessionId           sticky session snapshot

# Async progress
GET  /api/v1/jobs/:id                         job snapshot (poll)
GET  /api/v1/jobs/:id/events                  SSE stream of job progress
GET  /api/v1/batch/:id                        batch snapshot (poll)
GET  /api/v1/batch/:id/events                 SSE stream of batch progress

# Clip read / detail / delete
GET  /api/v1/clip                             list (ClipRecordWire[], no contentFull)
GET  /api/v1/clip/:id                         detail (ClipRecordWireFull, contentFull)
DELETE /api/v1/clip/:id                       hard delete
GET  /api/v1/clip/:id/image                   stream screenshot bytes (with optional ?w=)
```

### Wire Types

The TypeScript types in `src/types/index.ts` are the source. Two key types:

```typescript
interface ClipRecordWire {
  id: string;
  title: string;
  platform: Platform;
  author: string;
  originalUrl: string | null;
  contentType: ContentType;
  contentSummary: string;
  tags: string[];
  category: Category;
  language: string;
  screenshotPath: string;        // vault-relative
  fetchLevel: 1 | 2 | 3 | 4;
  sourceConfidence: number;
  createdAt: string;             // ISO 8601
}

interface ClipRecordWireFull extends ClipRecordWire {
  contentFull: string | null;
}
```

`ClipRecordWire` ships in `GET /api/v1/clip` (list). `ClipRecordWireFull` ships in `GET /api/v1/clip/:id` (detail).

`rawVlmResult` is **never** exposed via wire format — it's debug metadata, available only as the `<assets>/<id>.json` sidecar inside the vault.

### Error Envelope (uniform)

All non-2xx responses use this shape:

```json
{
  "error": {
    "code": "clip_not_found",
    "message": "Clip not found",
    "details": null
  }
}
```

| `code` (snake_case) | HTTP status | Meaning |
|---|---|---|
| `unauthorized` | 401 | Missing or invalid Bearer token |
| `forbidden` | 403 | Authenticated but lacks permission (placeholder for V2) |
| `clip_not_found` | 404 | id doesn't exist; also returned for malformed id (avoid leaking validation logic) |
| `job_not_found` | 404 | jobId expired or never existed |
| `batch_not_found` | 404 | batchId expired or never existed |
| `sticky_session_not_found` | 404 | sessionId expired or never existed |
| `missing_image` | 400 | multipart upload missing image field |
| `no_images` | 400 | batch upload had zero images |
| `too_many_images` | 400 | batch exceeded MAX_BATCH_SIZE |
| `missing_session_id` | 400 | sticky upload without sessionId |
| `sticky_wrong_state` | 409 | sticky session moved past `buffering` |
| `sticky_batch_full` | 400 | sticky session reached MAX_BATCH_SIZE |
| `rate_limited` | 429 | rate limit exceeded |
| `internal_error` | 500 | unhandled — should not happen in steady state |

**Stability**: codes are STABLE — clients branch on `error.code`. Messages may change for clarity; codes do not.

### Request / Response Headers

| Header | Direction | Use |
|---|---|---|
| `Authorization: Bearer <token>` | client → server | API key (V1) or JWT (V2 Cloud) |
| `Content-Type: application/json` | both | default |
| `Content-Type: multipart/form-data` | client → server | screenshot upload |
| `Content-Type: text/event-stream` | server → client | SSE responses |
| `Cache-Control: no-store` | server → client | mutating responses |
| `X-Request-Id: <uuid>` | both | per-request tracing (server generates if absent) |

## 4. Auth Architecture

### Strategy interface

```typescript
interface AuthStrategy {
  authenticate(req: FastifyRequest): Promise<AuthResult>;
}

interface AuthResult {
  ok: true;
  principal: { type: 'user' | 'service'; id: string };
} | {
  ok: false;
  error: AuthError;
}
```

V1 ships **only `ApiKeyStrategy`**. V2 Cloud will add `JwtStrategy`. Same Fastify hook, runtime-selectable strategy.

### V1 ApiKeyStrategy

Single shared API key from `process.env.API_KEY`. Bearer token compared in constant time.

Future-friendly variants without breaking the API:
- Multiple keys with labels (service vs user)
- Key rotation
- Per-key rate limit / scope

These are internal extensions; clients always send `Authorization: Bearer <token>`.

### V2 Cloud JwtStrategy (sketch only, not V1 work)

Validate JWT signed by Cloud's auth service. Claims include `userId`, `tier`, etc. `principal.type === 'user'` and `principal.id === userId`. Backend uses principal to scope vault path / quota.

### Dev mode skip

`NODE_ENV !== 'production'` and missing `Authorization` header → ApiKeyStrategy returns ok with `principal: { type: 'service', id: 'dev' }`. Tests opt into strict mode by setting `NODE_ENV=production` (see `vitest.config.ts`).

## 5. Storage / Vault Architecture

### Vault is just a directory

```
<VAULT_BASE>/
  <clippingsDir>/                    # default "snap-mind"
    _index.md                        # Dataview index page (auto-regenerated)
    YYYY-MM-DD_<platform>_<slug>.md  # one .md per clip
    assets/
      <clipId>.<ext>                 # screenshot
      <clipId>.json                  # rawVlmResult sidecar
```

The vault is a **filesystem directory**. Backend reads and writes files using standard `fs` APIs. No assumption about the underlying storage:

- macOS users: typically points at `~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/`
- Linux self-hosters: `/data/vault` or wherever they want
- NAS: SMB / NFS mount
- Docker: a volume mount

### macOS-iCloud edge cases (deployment, not core)

These are handled at the parser level but the **rules live in the deployment guide, not core architecture**:

- Files marked "online-only" by iCloud: backend opens them on demand. First read may block briefly while iCloud downloads. Acceptable.
- Conflict files (`foo (Conflict 1).md`, `foo (冲突 1).md`): parser **skips** these and warns. User resolves in Obsidian.
- Eventual consistency: chokidar watches vault; index invalidated on any change. Other Mac (if user has multi-Mac) writes settle within iCloud's normal sync window.

Linux / Docker users encounter none of the above.

### No SQLite for V1

Read path scans the vault each `GET /api/v1/clip` call. Acceptable up to several thousand clips. Past that, swap in a SQLite index without changing the API.

The implementation is contained in `src/library/clips.ts` — a single module, not pretending to be polymorphic. When SQLite arrives, this module gets rewritten.

## 6. Module Boundaries

```
src/
├── index.ts                # bootstrap: Fastify + plugins + routes
├── config.ts               # env-driven configuration
├── vault.ts                # shared vault format constants
├── server/
│   ├── plugins/
│   │   ├── auth.ts         # registers AuthStrategy hook
│   │   ├── rate-limit.ts   # @fastify/rate-limit
│   │   ├── swagger.ts      # @fastify/swagger + swagger-ui
│   │   └── error-handler.ts# uniform error envelope
│   ├── routes/
│   │   ├── clip-write.ts   # POST /clip, /clip/batch
│   │   ├── clip-sticky.ts  # POST /clip/sticky, GET /clip/sticky/:id
│   │   ├── clip-read.ts    # GET /clip, GET /clip/:id, DELETE /clip/:id, GET /clip/:id/image
│   │   ├── jobs.ts         # GET /jobs/:id, /jobs/:id/events
│   │   ├── batch.ts        # GET /batch/:id, /batch/:id/events
│   │   └── meta.ts         # /health, /whoami
│   ├── auth/
│   │   ├── strategy.ts     # AuthStrategy interface
│   │   ├── api-key.ts      # V1 implementation
│   │   └── (jwt.ts)        # V2 placeholder
│   ├── errors.ts           # error code constants + envelope helpers
│   └── job-store.ts        # in-memory Job/Batch/Sticky state (TTL'd)
├── pipeline/
│   ├── index.ts            # handleClip orchestration
│   ├── timing.ts           # step timing helpers
│   └── failure.ts          # handleFailure (fetchLevel=4 path)
├── library/
│   └── clips.ts            # vault read/parse/delete (current shape)
├── writer/
│   ├── interface.ts
│   ├── markdown.ts
│   └── template.ts
├── store/
│   └── screenshot.ts
├── fetcher/                # unchanged
├── processor/              # unchanged
├── vlm/                    # unchanged
├── prompts/                # unchanged
├── utils/                  # unchanged
└── types/
    ├── wire.ts             # ClipRecordWire, ClipRecordWireFull, ErrorEnvelope, Job, Batch, Sticky
    └── domain.ts           # ClipRecord (internal), MergedVLMResult, Platform, Category, ContentType
```

### Why this split

- **`server/` vs `pipeline/`**: HTTP transport is decoupled from business logic. Tests for pipeline don't need Fastify. Cloud version can later move pipeline to a worker.
- **`library/` vs `writer/`**: Read and write are separate concerns. Same vault format, different operations.
- **`auth/strategy.ts`**: Future-proofs auth without paying the V2 cost now.
- **`types/wire.ts` vs `types/domain.ts`**: Public contract types vs internal types. Wire types ship to clients.

### Plugin order at boot

```
1. registerErrorHandler  (so all later errors get uniform envelope)
2. registerRateLimit     (early, before expensive handlers)
3. registerAuth          (before route registration)
4. registerSwagger       (introspects all subsequent routes)
5. registerRoutes        (the API surface)
```

## 7. Async Pipeline & Real-time Updates

### Job model (write paths)

All three write entrypoints share the same async substrate:

```
POST /api/v1/clip              → 1 jobId
POST /api/v1/clip/batch        → 1 batchId + N jobIds
POST /api/v1/clip/sticky       → 1 sessionId, debounce → 1 batchId + N jobIds
```

A **Job** is one screenshot's pipeline run (~7 steps). A **Batch** groups N Jobs. A **Sticky session** groups uploads with debounce, then resolves to a Batch.

### Polling vs SSE

**Both supported**. SSE is preferred for long pipelines (≥10s); polling is the fallback.

```
# Polling (works always)
GET /api/v1/jobs/:id           → snapshot

# SSE (open one connection, get every step)
GET /api/v1/jobs/:id/events    → text/event-stream
                                 event: step
                                 data: {"step":2,"status":"running","message":"..."}
                                 ...
                                 event: done
                                 data: {"result":{...}}
```

Same shape applies to batches.

### State persistence: none in V1

Job / Batch / Sticky state lives in process memory with 30-min TTL. Restart loses in-flight jobs.

This is acceptable for V1 because:
- Single-Mac deployment
- LaunchAgent restarts are rare
- Mac sleep doesn't kill the process; only OS updates do
- Lost pipeline = client retries the upload

V2+ may add SQLite-backed job persistence if it becomes painful. The `JobStore` module already encapsulates the storage.

## 8. Deployment Modes

### Mode 1: Personal self-host on Mac mini (V1, you)

```bash
git clone https://github.com/<you>/snap-mind
cd snap-mind
pnpm install
cp .env.example .env  # set API_KEY, OPENROUTER_API_KEY, OBSIDIAN_VAULT_PATH
pnpm build

# Install as LaunchAgent (auto-start, KeepAlive)
./scripts/install-launchd.sh

# Verify
curl http://localhost:3210/health
```

The `install-launchd.sh` script writes `~/Library/LaunchAgents/dev.snap-mind.server.plist` and `launchctl load`s it.

Other devices reach the backend via Tailscale: `https://<mac-name>.<tailnet>.ts.net:3210` (Tailscale Serve handles TLS).

### Mode 2: Mac users via .app installer (V2)

A macOS .app bundle:
- Ships `snap-mind-server` binary (Node SEA or Bun --compile)
- Onboarding: collect API key, vault path, OpenRouter token, set up LaunchAgent
- Self-update mechanism (Sparkle or similar)

Out of scope for V1; the install-launchd.sh script is the bridge until then.

### Mode 3: Linux / Docker self-host (V2)

```yaml
# docker-compose.yml
services:
  snap-mind:
    image: ghcr.io/<you>/snap-mind:latest
    ports: ["3210:3210"]
    volumes:
      - ./vault:/vault
    environment:
      OBSIDIAN_VAULT_PATH: /vault
      API_KEY: ${API_KEY}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
```

For V1, write the Dockerfile but don't publish the image. Documenting the path makes future contributors' lives easier.

Notes for non-macOS deployment:
- No iCloud edge cases
- Playwright (L2 fetch) needs Chromium installed in the image — adds ~300MB
- chokidar works fine on Linux (uses inotify)

### Mode 4: SnapMind Cloud (V3)

Deferred. Outline only:
- Multi-tenant deployment of the same backend code
- Auth: JWT + user accounts (separate auth service)
- Storage: per-user S3 bucket OR shared bucket with prefix isolation
- No iCloud / Obsidian integration (Cloud users edit through the apps directly)
- Different product, same wire format

## 9. Cross-cutting concerns

### Network exposure

**Default**: bind to `127.0.0.1` and `100.x.y.z` (Tailscale interface). **Never** to `0.0.0.0` unless explicitly opted in via env var (with a startup warning).

This is the primary defense against public scanners. Rate limiting is layer-2.

### Rate limiting

`@fastify/rate-limit`:
- Authenticated routes: 120 req/min/IP (generous; legit clients won't hit this)
- Unauthenticated requests: 10 req/min/IP (kills brute-force / scanner traffic)
- 429 response uses the standard error envelope

### Logging

`pino` with redaction:

```typescript
{
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.token'],
    censor: '[REDACTED]',
  },
}
```

Each request gets `X-Request-Id`. Errors logged at `error` level include the request id; clients can quote it when reporting issues.

### CORS, Helmet, etc.

**Not needed in V1** (Tailscale-only access, single-origin clients, no browser environment).

Reserved for V2:
- CORS: needed if a web client (someone else's, not yours) is built against the API
- Helmet: needed if any browser-served content shows up

### Observability

V1 ships pino logs and that's it. No metrics, no tracing, no Sentry. Single user, you read your own logs.

## 10. Open decisions

These are not blockers but should be confirmed before implementation finalizes:

| Decision | Default | Status |
|---|---|---|
| Tailscale used for cross-device access | Yes | Pending your confirmation |
| Backend listens on Tailscale + 127.0.0.1 only | Yes | Implied by Tailscale decision |
| LaunchAgent for production process management | Yes | Confirmed |
| OpenAPI / Swagger UI exposed | Yes | Confirmed |
| SSE for job progress | Yes | Confirmed |
| mDNS / Bonjour for app auto-discovery | No (V1+) | Nice-to-have |
| Docker image published | Not in V1 | Documented for V2 |

## 11. Migration from current code

Current state (post-merge of `feature/openclaw-skill`):

- All routes at `/clip`, `/clip/sticky`, `/jobs/:id`, etc.
- Error shapes inconsistent (some `{ error }`, some `{ success: false, error }`, sticky has `{ error, code }`)
- Auth inline in each handler
- No SSE, no rate limit
- Routes file is ~700 lines
- Wire format types in single `types/index.ts`

Migration plan (small feature branches):

1. **`feat/api-v1-prefix`** — add `/api/v1/` prefix to all routes. **Rewrite directly, no compat shim**——项目尚未发布、唯一 client（OpenClaw skill / CLI）跟着同步改即可。
2. **`feat/auth-strategy`** — refactor inline auth into AuthStrategy + Fastify hook. ApiKeyStrategy is the only impl.
3. **`feat/error-envelope`** — uniform `{ error: { code, message } }` everywhere; replace existing inline error shapes; update tests.
4. **`feat/route-split`** — split `routes.ts` into `server/routes/clip-write.ts`, etc. Pure refactor, no behavior change.
5. **`feat/pipeline-extract`** — pull pipeline orchestration out of `routes.ts` into `pipeline/`. Pure refactor.
6. **`feat/types-split`** — separate `types/wire.ts` (public) and `types/domain.ts` (internal).
7. **`feat/sse-job-events`** — add `/jobs/:id/events` and `/batch/:id/events`. Existing polling endpoints unchanged.
8. **`feat/rate-limit-and-logging`** — add `@fastify/rate-limit` + pino redaction.
9. **`feat/openapi-swagger`** — `@fastify/swagger` + `/api/docs` UI; OpenAPI spec written to `docs/api/openapi.yaml` at build time.
10. **`feat/install-launchd-script`** — `scripts/install-launchd.sh` + plist template + deployment doc.

Each is small enough to land in 1-3 commits. Order isn't strict, but `1-3` need to land before clients can fully migrate, and `9` is most useful after the others stabilize.

## 12. Implementation cadence

Given V1 audience is you alone, no race. Land branches as they're ready, run on your Mac mini for a few days between, sand down rough edges. Final cut tag = `v1.0.0`, then start putting the apps repo together.

---

**Next**: lock the open decisions in §10, then start with `feat/api-v1-prefix`.
