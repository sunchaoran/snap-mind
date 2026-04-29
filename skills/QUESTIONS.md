# Open Questions for OpenClaw

> 状态记号:
> - ✅ 已被 OpenClaw 文档机器人回复确认
> - ⚠️ 已得到指引但仍需精确化
> - ❌ 未答 / 还需精确问

---

## ✅ 1. Skill 内如何发起 HTTP 调用？

**结论**：不在 SKILL.md 里堆 `curl`。封装成本地 **CLI wrapper**（短期最稳），未来可演进到 **MCP server**（长期更正）。

理由：multipart upload / Bearer auth / polling / 错误恢复在 markdown 里让 LLM 现拼太脆。

→ 见 [cli/snap-mind-cli/CONTRACT.md](../cli/snap-mind-cli/CONTRACT.md)

---

## ✅ 2. Skill 如何拿到环境变量 / secret？

**结论**：CLI 直接从 `process.env` 读。OpenClaw 的 env 加载链已涵盖：

1. 当前 shell
2. 当前目录 `.env`
3. `~/.openclaw/.env`
4. `openclaw.json` 的 `env` 块

**敏感** key（`SNAP_MIND_API_KEY`）建议用 `~/.openclaw/.env` 或 OpenClaw SecretRef (`openclaw secrets configure`)。
**非敏感**（`SNAP_MIND_BASE_URL`）放普通 env 即可。

❌ **不要赌** SKILL.md 里的 `${VAR}` 占位符替换——文档没明确支持。

---

## ⚠️ 3. Conversation / Session ID 怎么拿？

文档机器人说 OpenClaw 内部 session key 规则明确（如 `agent:<agentId>:<channel>:group:<id>`）。

**WeChat ClawBot README 进一步证实**：WeChat envelope (`WeixinMessage`) 里有 `session_id`、`from_user_id`、`message_id`、`create_time_ms`、`context_token` 等字段。说明**最底层一定存在 session 标识**。

**仍待精确化的问题**（去问）：

> WeChat ClawBot 的 envelope 里有 `session_id`。在 OpenClaw markdown skill 触发时，runtime 是把这个 session_id 直接暴露给 skill（用什么变量名 / 模板语法），还是只在内部使用？如果不直接暴露，推荐的 sessionId 派生方式是什么？

**兜底设计**：CLI 接受 `--session-id <id>` 参数；如果 OpenClaw 不暴露 session_id，SKILL.md 可让 LLM 用 `from_user_id + 当日日期` 派生（同一用户连续上传归一）。

---

## ⚠️ 4. 用户发的图片，skill 看到的是什么形态？

**WeChat ClawBot README 给了具体答案（针对微信 channel）**：

- 图片以 `ImageItem` 形态传递，包含 `encrypt_query_param`（加密 CDN URL）+ `aes_key`
- **AES-128-ECB 加密**——使用方需要先下载再解密
- **不是本地文件路径**，**不是普通公网 URL**

这意味着 **每个 channel 的附件形态可能不同**（微信特殊，Telegram 可能给本地路径，Discord 可能给 URL）。

**仍待精确化的问题**（去问）：

> ImageItem (encrypt_query_param + aes_key) 是由 OpenClaw runtime 自动 resolve 成本地文件 / 解密 URL 后再交给 skill，还是 skill 需要自己处理 AES 解密？是否有内置的 `media_resolve` / `attachment.toLocalFile()` API？
>
> 不同 channel（WeChat / Telegram / Discord / iMessage）的附件统一抽象是什么？skill 能否拿到一个 channel-agnostic 的 `attachment.localPath`？

**对设计的影响**：CLI input 接口必须支持多种形态。**短期假设**：OpenClaw runtime 会把 ImageItem 解密下载到 `/tmp` 之后才让 skill 看到本地路径。如果不是，CLI 要扩展支持 CDN URL + AES key（见 [CLI CONTRACT](../cli/snap-mind-cli/CONTRACT.md) Open design points）。

---

## ⚠️ 5. Stateless skill 怎么"等 N 秒再 polling"？

**结论先行**：状态机**不放在 markdown skill**——已设计为 SnapMind 服务端 sticky session 处理。

**WeChat ClawBot README 证实**：消息是 long-polling 逐条推送（35s 超时），**没有 batch 机制**——所以连发 5 张图就是 5 次独立 message event，5 次 skill trigger。

**仍待精确化的问题**（去问）：

> 在 OpenClaw 中，如何让一个 skill 在短时间窗口内（如 5 秒）被多次触发时仅在最后一次窗口结束后执行？
>
> 具体场景：用户连发 5 张图给微信，5 次 skill trigger。我希望 skill 第 1-4 次"静默"（只把图加入服务端 buffer），第 5 次（或停发 5s 后）一次性回复整批结果。
>
> OpenClaw 是否有：
> 1. channel/plugin 层的 message debounce / batching 配置？
> 2. skill 返回 "no-reply" 让 OpenClaw 不向用户回执的语义？
> 3. cron / scheduled callback 让 skill 注册"5s 后再继续"？

**兜底设计**：如果完全无解，**接受"一张一次回执"行为**——但 SnapMind 服务端在 sticky session 的 `done` 状态可以让 skill 在第 N 次 wait 时返回**仅自己之前没拿过的 result**（dedupe by jobId），让回执自然合并。

---

## ✅ 6. Skill 部署 / 加载

**结论**：

- 放到 `~/.openclaw/workspace/skills/<name>/` 后**下一会话生效**（不保证当前会话热刷新）
- 开发期 **symlink** 项目内 `skills/snap-mind/` 到 workspace
- 失败 debug：`openclaw channels logs` / `openclaw status` / `openclaw doctor` / `/tmp/openclaw/openclaw-*.log`
- 没找到专用 `openclaw reload skills` 命令，必要时重启 gateway

部署命令（参考）：
```bash
ln -s ${PWD}/skills/snap-mind ~/.openclaw/workspace/skills/snap-mind
```

---

## ✅ 7. 触发模式选择

**结论**：NLU 触发 + slash command **能并存**。frontmatter 配置：

```yaml
---
name: snap-mind
description: ...
user-invocable: true              # 暴露为 slash command
# disable-model-invocation: 不设  # 保留模型自动判断意图能力
---
```

⚠️ 仍需精确化的子问题：是否要为这个 skill 显式注册 channel-level 的 `nativeSkills`（如 Telegram / Discord 的 native command 暴露）？微信 ClawBot 是否支持这个？

→ 跟 #8 一起问微信插件作者。

---

## ⚠️ 8. WeChat ClawBot 的具体限制

[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) README 提供了大量答案：

| 子问题 | 答案 |
|---|---|
| 图片传输 | CDN URL + AES-128-ECB 加密（`ImageItem` schema） |
| 单文件 size 上限 | ❌ README 未明确 |
| 群聊支持 | ❌ README 没有 `is_group` / `group_id` 字段，**推断仅私聊** |
| 时序 | Long-polling 35s 超时，**逐条推送**（不 batch） |
| Envelope 字段 | `from_user_id`, `to_user_id`, `message_id`, `create_time_ms`, `session_id`, `message_type`, `context_token` |
| 回复机制 | `sendMessage` endpoint，`item_list` 支持 text/image/voice/file/video |

**仍待精确化的问题**（去 [Tencent/openclaw-weixin issues](https://github.com/Tencent/openclaw-weixin/issues) 问）：

> 1. 单 image 是否有 size 上限？是否压缩 / 转码？
> 2. 群聊场景目前是 unsupported 还是 future work？有 roadmap 吗？
> 3. ImageItem 的 AES 解密是 SDK 自动做的，还是 skill 需要显式调用？

**对设计的影响**：
- ✅ **图片 ≠ 本地文件**——CLI 必须支持 ImageItem 形态（或依赖 OpenClaw runtime 先 resolve 到本地）
- ⚠️ **仅私聊**预设——产品定位为"私聊收藏 bot"，不要承诺群聊
- ✅ **逐条推送**确认了 Q5 的场景：连发 N 张就是 N 次 skill trigger

---

## ✅ 9. AgentSkills 跨 runtime 兼容

**结论**：兼容是真的，但 OpenClaw 扩展不 100% 可移植。**两层架构**保可移植：

### Portable core（可移植层）
- CLI / MCP tool 自己处理 env / HTTP / polling / 附件 IO
- SKILL.md 只用自然语言说明任务和调用契约

### OpenClaw adapter layer（适配层）
- `user-invocable` / `command-dispatch` 等 frontmatter
- channel/session/chat metadata 注入
- slash 注册

→ 我们的设计就是按这个分层做的：CLI 是 portable core，SKILL.md frontmatter 是 OpenClaw adapter。

---

## 待动作清单（更新于 OpenClaw 答复后）

**用户负责去问的**（基于已知信息精确化）：
- [ ] Q3 — OpenClaw 是否把 WeChat envelope 的 `session_id` 直接暴露给 markdown skill
- [ ] Q4 — ImageItem 是 OpenClaw runtime 自动解密下载到本地，还是 skill 自己处理 AES？
- [ ] Q5 — OpenClaw 是否支持 skill 返回 "no-reply"（在 N-1 次触发时不向用户回执）
- [ ] Q8 — 微信 image 大小限制 + 群聊 roadmap（仅 size + roadmap 这两个点没答）

**我们可以并行做的**（不依赖未答问题）：
- [x] 更新 SKILL.md 为 CLI 路线
- [x] 起草 CLI 接口契约（[../cli/snap-mind-cli/CONTRACT.md](../cli/snap-mind-cli/CONTRACT.md)）
- [ ] SnapMind 服务端实现 `/api/v1/clip/sticky` API（debounce + sticky session buffer）
- [ ] 给 sticky-store 加单测

**等回答后才能做的**：
- [ ] CLI 实际实现（要等 Q4 决定 input 接口）
- [ ] SKILL.md 完整落地（要等 Q3/Q4/Q5）
