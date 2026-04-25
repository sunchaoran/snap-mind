---
name: snap-mind
description: 把用户在对话中发送的截图收藏到 Obsidian 知识库（自动平台识别、原文抓取、摘要、标签）
user-invocable: true
---

# SnapMind: Save Screenshots to Obsidian

## When to invoke

用户表达"收藏 / 保存 / 存到 Obsidian / 记一下 / 帮我留着"等意图，并伴随截图附件时调用此 skill。

不应触发：
- 仅分享图片（"看这只猫"）
- 非截图（拍照、表情包、设计稿）
- 用户要求对图片做问答 / OCR 而非长期收藏

## How to invoke

服务端 (SnapMind) 已经实现了完整 pipeline。Skill 通过 **`snap-mind` CLI** 调用——**不要在 markdown 里直接拼 curl**（multipart / auth / polling 让 LLM 现拼太脆）。

### 命令契约（详见 [cli/snap-mind-cli/CONTRACT.md](../../cli/snap-mind-cli/CONTRACT.md)）

**Step 1 — 把截图加入 sticky session（每张图一次）**：

```bash
snap-mind sticky push \
  --session-id <session-id> \
  --file <attachment-path>
```

约定：
- `<session-id>` 用 OpenClaw 当前对话的稳定标识（具体字段名待确认 — 见 QUESTIONS.md #3）
- `<attachment-path>` 用户消息附件的本地路径（具体读取方式待确认 — 见 QUESTIONS.md #4）
- CLI 内部完成 multipart upload / Auth header / 错误重试
- 立即返回 stdout JSON：`{"sessionId": "...", "queueDepth": N}`

**Step 2 — 全部图发完后，等批量完成**：

```bash
snap-mind sticky wait --session-id <session-id>
```

阻塞直到服务端 sticky session 进入 `done` 状态（5s 静默窗口结束 + pipeline 全部完成）。

返回 stdout JSON：
```json
{
  "sessionId": "...",
  "status": "done",
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    { "success": true, "title": "...", "platform": "xiaohongshu", "tags": [...], "message": "✅ 已收藏: ..." },
    ...
  ]
}
```

**Step 3 — 把 results 整体回执给用户（一条消息）**：

模板：

```
✅ 已收藏 {succeeded}/{total} 张：
- {result1.message}
- {result2.message}
...
```

失败的项标 `⚠️` 并附 `error` 字段：

```
⚠️ {error}（截图已保存待重试）
```

## Configuration

CLI 通过环境变量读取配置（OpenClaw 的 env 加载链：shell / 项目 .env / `~/.openclaw/.env` / `openclaw.json`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SNAP_MIND_BASE_URL` | `http://localhost:3210` | SnapMind 服务地址 |
| `SNAP_MIND_API_KEY` | (必填) | SnapMind 服务的 API Key |

**敏感 key 推荐**通过 OpenClaw SecretRef：
```
openclaw secrets configure SNAP_MIND_API_KEY
```

## Notes

- SnapMind 是异步处理；所有结果在 `snap-mind sticky wait` 返回时收口。
- 即使处理失败，截图也会被保存到 Obsidian vault 的 `assets/` 目录。
- 此 skill **不感知具体 channel**——微信 / iOS / Telegram 通用。
- Skill 是 **portable core**：业务逻辑全在 CLI 里。OpenClaw 适配只在 frontmatter 这层。

## TODO（依赖未答问题）

- [ ] **Q3** — 把"OpenClaw 暴露的 conversation metadata 字段名"填入 Step 1 的 `<session-id>` 取值方式
- [ ] **Q4** — 把"附件路径 / URL / bytes 的读取方式"填入 Step 1 的 `<attachment-path>` 取值方式
- [ ] **Q5** — 决定是否需要在 skill 层做"多次触发去重"
- [ ] **Q8** — 微信 ClawBot 的图是否原图、是否需要质量提示

详见仓库 [skills/QUESTIONS.md](../QUESTIONS.md)。
