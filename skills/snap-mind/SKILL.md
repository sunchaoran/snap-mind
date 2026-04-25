---
name: snap-mind
description: 把用户在对话中发送的截图收藏到 Obsidian 知识库（自动平台识别、原文抓取、摘要、标签）
---

# SnapMind: Save Screenshots to Obsidian

## When to invoke

用户表达"收藏 / 保存 / 存到 Obsidian / 记一下 / 帮我留着"等意图，并伴随截图附件时调用此 skill。

不应触发：
- 仅分享图片（"看这只猫"）
- 非截图（拍照、表情包、设计稿）
- 用户要求对图片做问答 / OCR 而非长期收藏

## How to invoke

服务端 (SnapMind) 已经实现了完整 pipeline。Skill 只是个**薄适配器**——把附件交给服务，把结果回执给用户。

### Step 1 — Push each screenshot into a sticky session

对**当前对话中**用户最近发送的每一张截图，调用：

```
POST {SNAP_MIND_BASE_URL}/clip/sticky
Content-Type: multipart/form-data
Authorization: Bearer {SNAP_MIND_API_KEY}

image=<file bytes>
sessionId=<conversation id>
```

约定：
- `sessionId` 用 OpenClaw 当前 conversation 的稳定 id（同一对话内的多次调用必须用同一个）。
- 服务端会把同 sessionId 的图加入 buffer，**重置 5s 静默 timer**；停发 5s 后整批进入处理。
- 接口立即返回 `{ sessionId, queueDepth }`，不等处理。

### Step 2 — Wait for batch completion, then fetch results

发完最后一张后，等 5–10 秒，然后轮询：

```
GET {SNAP_MIND_BASE_URL}/clip/sticky/{sessionId}
Authorization: Bearer {SNAP_MIND_API_KEY}
```

响应 status 状态机：`pending` → `processing` → `done`

`done` 时附 `results: ClipResponse[]`（参见 SnapMind HTTP API spec）。

### Step 3 — Reply once with the whole batch

仅在 status 变成 `done` 后回复用户**一次**，不要每张回。模板：

```
✅ 已收藏 {N} 张：
- {title1} [{platform1}] #{tag1} #{tag2}
- {title2} [{platform2}] #{tag3}
...
```

失败的项标 `⚠️` 并附 error 字段：

```
⚠️ {title or "未识别"}: {error}（截图已保存待重试）
```

## Configuration

通过 OpenClaw 的环境变量 / secret 注入机制提供：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SNAP_MIND_BASE_URL` | `http://localhost:3210` | SnapMind 服务地址（同机部署默认 localhost） |
| `SNAP_MIND_API_KEY` | (required) | SnapMind 服务的 API Key（对应 SnapMind 的 `API_KEY` env） |

## Notes

- SnapMind 是**异步处理**，不要试图同步等单张图的完整结果——所有结果收口在 `/clip/sticky/{sessionId}` 的 `done` 状态。
- 即使处理失败，截图也会被保存到 Obsidian vault 的 `assets/` 目录，并写入一条占位记录供后续重试。
- 此 skill **不感知具体 channel**（微信 / iOS / Telegram 等）—— 只要 OpenClaw 把附件正确传过来即可。

## TODO（待 OpenClaw 文档/团队确认后填补具体实现细节）

详见仓库根 `skills/QUESTIONS.md`。在以下问题确认前，本 SKILL.md 是设计草稿：

- [ ] OpenClaw skill 内调用 HTTP 的官方 idiom（curl shell / 内置 fetch / MCP tool 注册）
- [ ] env / secret 注入语法（是否支持 `${VAR}` 替换 / 还是 skill runtime 自动 inject）
- [ ] OpenClaw 暴露给 skill 的 conversation id 字段名
- [ ] 用户消息附件（图片）在 skill 上下文里的引用方式（URL / 本地路径 / bytes）
- [ ] Skill 在 stateless 模式下如何"等 N 秒再 polling"——loop tool call 还是其他范式
