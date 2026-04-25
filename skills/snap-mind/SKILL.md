---
name: snap-mind
description: 把用户在对话中发送的截图收藏到 Obsidian 知识库（自动平台识别、原文抓取、摘要、标签）
user-invocable: true
---

# SnapMind: Save Screenshots to Obsidian

## When to invoke

用户表达"收藏 / 保存 / 存到 Obsidian / 记一下 / 帮我留着"等意图，并伴随截图附件时调用此 skill。

**不**应触发：
- 仅分享图片（"看这只猫"）
- 非截图（拍照、表情包、设计稿）
- 用户要求对图片做问答 / OCR 而非长期收藏

**Slash 触发**：用户输入 `/snap` 直接显式触发本 skill。

## How to invoke

业务逻辑全在服务端 SnapMind + 本地 `snap-mind` CLI 里。Skill 只指导 LLM 调用 CLI 的两到三个命令，**不要在 markdown 里拼 curl**。

### Step 1 — 把每张截图 push 进 sticky session

对消息中的每张截图调用一次：

```bash
snap-mind sticky push \
  --session-id "${SESSION_ID}" \
  --file "${ATTACHMENT_PATH}" \
  --verbose
```

`SESSION_ID` 取值（按可用性顺序）：

1. **OpenClaw 注入的 conversation/session 字段**（最稳）。OpenClaw 把 channel envelope 字段以环境变量形式注入到 skill 子进程的概率较高（具体字段名见 [QUESTIONS.md #3](../QUESTIONS.md#3-conversation--session-id-怎么拿)）。**`--verbose` 会把当前匹配 `^(OPENCLAW_|CLAW_|CHANNEL_|MESSAGE_|CHAT_|SESSION_|FROM_|CONTEXT_|WEIXIN_|WX_)` 前缀的环境变量 dump 到 stderr**——第一次跑起来看 log 即可定位真实字段名，再回来固化。
2. **派生兜底**：如果 OpenClaw 不暴露任何 envelope 字段，用 `${user_handle}_$(date +%Y%m%d)` 构造（同一用户当日所有截图归一批）。

`ATTACHMENT_PATH` 取值：用户附件经 OpenClaw runtime 自动解码 / 解密后的本地文件路径（参见 [QUESTIONS.md #4](../QUESTIONS.md#4-用户发的图片skill-看到的是什么形态)）。微信场景下 OpenClaw 应该已经把 `ImageItem`(CDN URL + AES-128-ECB) 解密落到本地 — **若发现实际不是这样，CLI 需要扩展支持 `--cdn` / `--aes-key`**。

CLI 立即返回 JSON 到 stdout：
```json
{ "sessionId": "...", "queueDepth": 3, "status": "buffering" }
```

非零退出码（见 [CLI CONTRACT — Exit codes](../../cli/snap-mind-cli/CONTRACT.md#exit-codes)）：
- `2` 参数错误
- `3` 认证失败 → 检查 `SNAP_MIND_API_KEY`
- `4` 服务不可达 → 检查 `SNAP_MIND_BASE_URL`、SnapMind 进程是否运行
- `7` 服务端拒绝（如 batch 已满 20 张 / session 已 done）

### Step 2 — 等批量处理完成

```bash
snap-mind sticky wait --session-id "${SESSION_ID}" --verbose
```

阻塞直到 sticky session 进入 `done`（debounce 关闭 + pipeline 全部完成；通常 push 之后 5–60 秒内）。

返回的 JSON 形如：
```json
{
  "sessionId": "...",
  "status": "done",
  "total": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    { "success": true, "title": "...", "platform": "xiaohongshu", "tags": ["..."], "message": "已收藏: ..." },
    { "success": false, "error": "VLM extraction failed", "screenshotSaved": true, "message": "处理失败，已保存原始截图，请稍后重试" }
  ]
}
```

### Step 3 — 把 results 整体回执给用户（一条消息）

```
✅ 已收藏 {succeeded}/{total} 张：
- {result.message}
- ...
```

失败项混排，`⚠️` 起头：

```
⚠️ {error}（截图已保存待重试）
```

## 多次触发处理（用户连发多张）

> 现实约束：OpenClaw skill 是 stateless markdown，且 WeChat ClawBot 是逐条 long-poll 推送，**没有原生的 message debounce**。用户连发 5 张图意味着 LLM 被触发 5 次。

**当前策略（方案 a，MVP）—— 接受 N 次回执，每次都给完整结果**：

第 1 次触发（用户发第 1 张图）：
- LLM 调 `push` → 立刻返回 `queueDepth: 1`
- LLM 调 `wait` → 阻塞期间用户发了第 2-5 张，OpenClaw 排队后续 turn
- 用户停发后 5 秒 sticky 关闭窗口 → batch 完成 → `wait` 返回所有 5 张的 results
- LLM 把整批 results 回执给用户

第 2-5 次触发（OpenClaw 处理积压消息）：
- LLM 调 `push` → **抛 409 wrong_state**（session 已 done）
- 看到这个错误，**改调 `snap-mind sticky status --session-id ${SESSION_ID}`** → 拿到相同的 results
- 回执 "已收藏过了" 或重新展示完整 results

**用户体感**：1 条完整结果 + 4 条 "已收藏过了"。能用，未来可改进（见 [QUESTIONS.md #5](../QUESTIONS.md#5-stateless-skill-怎么等-n-秒再-polling)）。

## Configuration

CLI 通过环境变量读取（OpenClaw 的 env 加载链涵盖 shell / 项目 `.env` / `~/.openclaw/.env` / `openclaw.json`）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SNAP_MIND_BASE_URL` | `http://localhost:3210` | SnapMind 服务地址 |
| `SNAP_MIND_API_KEY` | （必填） | SnapMind 服务的 Bearer token |

**敏感 key 推荐**通过 OpenClaw SecretRef：
```
openclaw secrets configure SNAP_MIND_API_KEY
```

## Notes

- SnapMind 是**异步处理**；所有结果在 `wait` 返回时收口。
- 即使处理失败，截图也会被保存到 Obsidian vault 的 `assets/` 目录待人工重试。
- 此 skill **不感知具体 channel**——微信 / iOS / Telegram / Discord 通用。
- Skill 是 **portable core**：业务逻辑全在 CLI 里。OpenClaw 适配只在 frontmatter 这层。
- 第一次跑起来时务必带 `--verbose`，stderr 里能看到 envelope-env-scan 输出，对照确认实际可用的 session id 来源。

## Deployment

把项目内的 skill 软链接到 OpenClaw workspace：

```bash
ln -s "${PWD}/skills/snap-mind" ~/.openclaw/workspace/skills/snap-mind
```

CLI 安装（让 `snap-mind` 命令全局可用，OpenClaw 子进程能找到）：

```bash
pnpm install
pnpm build           # 产生 dist/cli.js
pnpm link --global   # 注册 bin/snap-mind 到 PATH
snap-mind --version  # 验证
```

下次 OpenClaw 会话即可看到本 skill。
