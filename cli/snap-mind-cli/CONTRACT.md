# `snap-mind` CLI — Interface Contract

> 状态：契约草稿（不依赖 OpenClaw 未答问题；input 接口在 Q4 明确后微调）。
> 实现等 Q4 答复后开工。

CLI 是 SnapMind 服务的**本地客户端 wrapper**。OpenClaw skill 通过它跟服务端交互，避免在 markdown 里让 LLM 直接拼 multipart/auth/polling。

## 安装（计划）

```bash
# 跟项目 toolchain 一致，pnpm 全局
pnpm add -g @sunchaoran/snap-mind-cli@latest
```

⚠️ 名字暂定。是否独立 publish 还是作为 SnapMind 项目的 npm bin 一起发布，等实现时定。

## 命令

### `snap-mind sticky push`

把一张截图加入指定 sticky session 的 buffer。立即返回，不等处理。

```
snap-mind sticky push \
  --session-id <id>           required, string
  --file <path>               required, local file path (可重复, 多文件单次提交)
  [--base-url <url>]          override SNAP_MIND_BASE_URL
  [--api-key <token>]         override SNAP_MIND_API_KEY
```

**stdout**（成功，单 JSON 对象）：
```json
{
  "sessionId": "...",
  "queueDepth": 3,
  "status": "buffering"
}
```

**stderr**：错误时打印人类可读的诊断（exit code 见下）。

---

### `snap-mind sticky wait`

阻塞等待 sticky session 完成（debounce 窗口结束 + pipeline 全部 done）。

```
snap-mind sticky wait \
  --session-id <id>           required
  [--poll-interval <ms>]      default 2000
  [--timeout <ms>]            default 600000  (10 min)
  [--base-url <url>]
  [--api-key <token>]
```

**stdout**（成功，单 JSON 对象）：
```json
{
  "sessionId": "...",
  "status": "done",
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    {
      "success": true,
      "clipId": "clip_20260425_123000_AbCdEf",
      "title": "Rust 异步编程指南",
      "platform": "xiaohongshu",
      "tags": ["rust", "async"],
      "category": "tech",
      "fetchLevel": 1,
      "vaultPath": "snap-mind/2026-04-25_xiaohongshu_rust-async.md",
      "message": "已收藏: Rust 异步编程指南 [小红书] #rust #async"
    },
    {
      "success": false,
      "clipId": "clip_...",
      "error": "VLM extraction failed",
      "screenshotSaved": true,
      "message": "处理失败，已保存原始截图，请稍后重试"
    }
  ]
}
```

---

### `snap-mind sticky status`

非阻塞查询当前 sticky session 状态（一次 GET，不轮询）。

```
snap-mind sticky status --session-id <id>
```

**stdout**：跟 `wait` 一样的 schema，但 `status` 可能是 `buffering` / `processing` / `done`。

---

### `snap-mind --version`

输出 CLI 版本号到 stdout。

### `snap-mind --help`

输出 usage 文本到 stdout。

## Environment

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `SNAP_MIND_BASE_URL` | 否 | `http://localhost:3210` | SnapMind 服务地址 |
| `SNAP_MIND_API_KEY` | **是** | — | Bearer token (对应服务端 `API_KEY` env) |

CLI 加载链与 SnapMind 服务一致（cascade）：
1. 当前 shell env
2. 项目 `.env` / `.env.local`
3. `~/.openclaw/.env`（OpenClaw 集成）

CLI 不会再次 cascade-load `.env`，**信任调用环境**已经把 env 设好。这样 OpenClaw 的 env 注入链是单一权威。

## Exit codes

| Code | 含义 |
|---|---|
| `0` | 成功（push 接受 / wait 完成 / status 查询成功） |
| `1` | 通用错误（未分类） |
| `2` | 参数错误（缺必填 / 路径不存在 / session-id 非法） |
| `3` | 认证失败（401，API_KEY 错误或缺失） |
| `4` | 服务不可达（network error / connect refused） |
| `5` | `wait` 超时 |
| `6` | session not found（404） |
| `7` | 服务端拒绝（4xx 非 401，如 batch 满 / 文件过大） |
| `8` | 服务端错误（5xx） |

CLI 不做静默重试（除了 polling 间隔本身）。Skill 看到非 0 退出码就把 stderr 内容回执给用户。

## Stdout / stderr 约定

- **stdout**：仅在成功时输出 1 个 JSON 对象，**末尾带换行**。Skill / LLM 可以直接 `JSON.parse`。
- **stderr**：错误诊断（人类可读 + 一行 JSON 格式机器可读，详见下）。
- 没有进度条 / spinner / 颜色（CLI 跑在 OpenClaw skill 调用上下文里，非交互终端）。

错误时 stderr 末行格式：
```
ERROR: {"code": 4, "message": "Connection refused", "detail": "ECONNREFUSED localhost:3210"}
```

## Idempotency / re-entry

- 同一 `sessionId` 的 `push` 可以多次调用——服务端 sticky-store 会重置 5s debounce timer
- 同一 `sessionId` 的 `wait` 可以多次调用——返回相同的 done 结果（直到 30 min TTL 过期）
- `status` 总是幂等

## Open design points（等问题答复后定）

- **Q4 影响（已部分明确）**：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) README 显示微信图片是 `ImageItem`（CDN URL + AES-128-ECB key），**不是本地文件**。两种可能：
  - (a) OpenClaw runtime 自动把 ImageItem 解密下载到 `/tmp/xxx.png` 再交给 skill — CLI 仅需 `--file <path>`
  - (b) Skill 拿到原始 ImageItem，需要自己解密 — CLI 要加 `--cdn <encrypted-url> --aes-key <hex>` 模式
  
  目前按 (a) 设计，发现是 (b) 时扩展。

- **Q3 影响（已部分明确）**：WeChat envelope 有 `session_id` 字段，但 OpenClaw markdown skill 是否能直接读还需确认。如果不能，SKILL.md 让 LLM 用 `from_user_id + 当日日期` 派生 sessionId。

- **Q5 影响（已确认）**：消息是逐条 long-polling 推送，连发 5 张 = 5 次 skill trigger。CLI 已天然支持这个：第 1-N 次 `push` 都重置服务端 5s debounce timer，第 N+1 次（停发 5s 后）`wait` 拿到完整结果。仍未解决的是"如何让前 N-1 次 trigger 不向用户回执"。

## Reference

- 服务端 API：[docs/architecture/api-design.md](../../docs/architecture/api-design.md)（V1 全部路由在 `/api/v1/` 前缀下；sticky 端点：`POST /api/v1/clip/sticky`、`GET /api/v1/clip/sticky/:sessionId`）
- Skill：[skills/snap-mind/SKILL.md](../../skills/snap-mind/SKILL.md)
- 待答问题：[skills/QUESTIONS.md](../../skills/QUESTIONS.md)
