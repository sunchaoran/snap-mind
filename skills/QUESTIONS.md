# Open Questions for OpenClaw

在 [skills/snap-mind/SKILL.md](./snap-mind/SKILL.md) 落地前，需要从 OpenClaw 团队 / 文档 / 社区确认以下问题。每个问题尽量独立可问。

---

## 1. Skill 内如何发起 HTTP 调用？

我们的 skill 需要调用一个本地 HTTP 服务（`http://localhost:3210/clip/sticky`）。OpenClaw 推荐的 pattern 是：

- (a) skill markdown 里直接写 shell 命令（`curl`），由 LLM 触发执行？
- (b) OpenClaw 内置 `http` / `fetch` tool，skill 让 LLM 调用？
- (c) 把目标服务包装成 OpenClaw 注册的 MCP server，skill 通过 MCP tool 调用？
- (d) 其他？

希望拿到一个能跑的最小示例（任意一种 pattern 都行）。

---

## 2. Skill 如何拿到环境变量 / secret？

skill 需要 `SNAP_MIND_API_KEY`（敏感）和 `SNAP_MIND_BASE_URL`（非敏感）。

- OpenClaw 是否有内置 secret store / config 机制？
- SKILL.md 里是否支持 `${VAR}` / `{{var}}` 占位符让 runtime 替换？
- 还是 skill 通过执行环境的 `process.env` / `os.environ` 读取（要求外部用户在系统层 export）？

---

## 3. Conversation / Session ID 怎么拿？

skill 需要把同一对话中陆续发送的多张图绑定到同一个 sessionId（5s debounce 依赖此）。

- OpenClaw 在 skill 触发上下文里暴露了哪些 ID 字段？conversation_id / chat_id / session_id / user_id / 其他？
- 这些 ID 在跨多轮消息（同一对话内）是否保持稳定不变？
- 如果不同 channel（微信 vs Telegram vs iOS）跑同一个 skill，conversation id 的语义是否一致？

---

## 4. 用户发的图片，skill 看到的是什么形态？

用户在微信里发了张截图，经过 ClawBot → OpenClaw → skill 的链路，到 skill 这一层时，图片是：

- (a) 一个公网 URL（OpenClaw 临时托管的）？
- (b) 本地文件系统路径？
- (c) base64 / bytes 直接在 message payload 里？
- (d) 其他？

skill 该用什么 API 引用 / 读取这个附件，并把它作为 `multipart/form-data` 的 file 字段上传？

---

## 5. Stateless skill 怎么"等 N 秒再做下一步"？

我们的流程是："上传所有图 → 等用户停发 5–10 秒 → polling 状态接口直到 done"。

OpenClaw 的 skill 是 stateless markdown，没法 setTimeout。请问：

- LLM 在一次 skill 调用里能否自然循环 tool call（`while !done: sleep && check`）？
- OpenClaw 是否有"延迟重新触发 skill"或"scheduled callback"机制？
- 还是必须依赖 channel 层（如 ClawBot）做 debounce？
- 如果 stateless，只能"用户每发一张图都触发一次 skill"，那连发 5 张就 5 次回执——这能避免吗？

---

## 6. Skill 部署 / 加载

- 把 `SKILL.md` 放到 `~/.openclaw/workspace/skills/snap-mind/` 就生效吗？还是要 `openclaw reload` / 重启 daemon？
- 项目内的 `skills/snap-mind/` 应该 symlink 到 workspace 还是 copy？官方推荐？
- skill 加载有错误时（frontmatter parse 失败等）如何 debug？日志在哪？

---

## 7. 触发模式选择

frontmatter 支持 `user-invocable`（slash command）/ `disable-model-invocation`（仅 user 触发）/ `command-dispatch: tool`（绕过 model）。

我们这个 skill 希望：
- **主路径**：用户对话里说"收藏这几张" → LLM 自动判断意图调用 skill（NLU 触发）
- **备用**：用户输入 `/snap` slash command 显式触发

应该怎么配 frontmatter？两种触发能并存吗？

---

## 8. WeChat ClawBot 的具体限制

通过 [tencent-weixin/openclaw-weixin-cli](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin-cli) 接入微信，请问：

- 用户发送的图片：原图还是压缩过？（影响 VLM 识别精度）
- 单张图片有最大 size 限制吗？（SnapMind 端默认 10MB）
- 微信群聊场景支持吗？还是仅私聊？
- 图片到达 OpenClaw 是即时的吗？还是延迟批量推送？

---

## 9. AgentSkills 跨 runtime 兼容

OpenClaw 文档说 skills 是 `AgentSkills 兼容`。这意味着同一份 SKILL.md 能在 Claude Code / 其他兼容 runtime 跑吗？

如果是，要避免哪些 OpenClaw 特定的扩展（保持可移植）？
