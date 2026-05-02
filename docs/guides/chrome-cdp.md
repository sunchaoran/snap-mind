# Chrome CDP 配置

> snap-mind 的 L2 抓取（`src/fetcher/web-fetch.ts`）通过 **Chrome DevTools Protocol** 连一个本地浏览器，复用平台登录态去抓 Twitter / Zhihu / 小红书等闭墙内容。本文说明如何在 Mac mini 上把这个浏览器装成 LaunchAgent，以及笔记本端开发时怎么蹭。

---

## 形态

- **Mac mini（runtime，必装）**：独立 headed Chrome，专门 profile，开机自启，CDP 监听 `127.0.0.1:9222`，跟你日常 Chrome **完全分开**
- **MacBook（dev，可选）**：90% 的本地开发不碰 L2，省事；真要测 L2 时通过 SSH tunnel 蹭 Mac mini 那台

> ⚠️ **不要**给你日常用的 Chrome 加 `--remote-debugging-port`：任何本地进程都能驱动你的浏览器（读 cookie、截屏、自动操作），且日常重启 Chrome 会断 backend。

---

## Mac mini：一次性安装

### 0. 先决条件

- macOS（任意近代版本）
- 装好 Google Chrome（路径 `/Applications/Google Chrome.app`，`brew install --cask google-chrome` 也是这个路径）
- 启用 Mac 自动登录：**System Settings → Users & Groups → Automatic login on startup → 选你的账号**
  - LaunchAgent 只在 user session 活跃时跑；mac mini 重启停在登录窗口的话，Chrome 不会自启

### 1. 装 Chrome LaunchAgent

```bash
./scripts/install-chrome-launchd.sh
```

脚本做的事：
1. 检查 macOS + Chrome 二进制是否存在
2. 创建 profile 目录 `~/Library/Application Support/snap-mind/chrome-profile`
3. 渲染 plist 到 `~/Library/LaunchAgents/dev.snap-mind.chrome.plist`
4. `launchctl load`、`curl http://127.0.0.1:9222/json/version` 验活
5. 首次安装时打印登录引导

幂等——cookie 过期 / 升级 Chrome / 改 plist 时直接重跑。

卸载：`./scripts/uninstall-chrome-launchd.sh`（plist 删掉，profile 保留——里面有 cookie，要清空手动删）。

### 2. 首次登录平台

LaunchAgent 起来后，**Chrome 窗口在 Mac mini 上是可见的**。Screen Share 进去（Tailscale 或局域网 VNC 都行），在那个 Chrome 里手动登：
- Twitter / X
- Zhihu
- Reddit
- 其它你常截图的平台

cookie 持久化在 profile 目录里，下次 Chrome 重启也还在。

### 3. 跟 backend 对接

`.env` / `.env.local` 里的 `CDP_URL` 默认 `http://localhost:9222`，跟 plist 模板对得上，不用改。snap-mind backend 的 LaunchAgent 起来后会自动通过 `connectOverCDP` 复用这个浏览器。

---

## Cookie 维护

Cookie 不是永久的——平台 session 大多 1-3 个月会过期，或者你在别处主动登出会失效。snap-mind 的 L2 抓取突然全部 401/403 就是这个症状：

1. Screen Share 进 Mac mini
2. 在 snap-mind 那个 Chrome 窗口里**重新登录**对应平台
3. 不需要重启 Chrome 也不需要重启 backend——下一次 fetch 自动用新 cookie

---

## MacBook（dev）

多数本地开发不用碰 L2：
- L1（opencli）能本地装 opencli 直接测
- L4（VLM-only）不依赖任何外部
- L2 测试可以暂时跳过，或者临时把 `MAX_FETCH_LEVEL=1` 限制只走 L1

真要测 L2 的时候，SSH tunnel 蹭 Mac mini 的 Chrome 是最干净的：

```bash
# 在 MacBook 上
ssh -L 9222:localhost:9222 mac-mini.<tailnet>.ts.net

# tunnel 在跑的时候，dev 这边的 CDP_URL 自动通了
pnpm dev
```

- ✅ 单一登录源（cookie 都在 mac mini 的 profile 里）
- ✅ 不暴露端口（SSH 转发本质是本地端口）
- ⚠️ 你 dev 调试时跟 prod 抢同一个 Chrome 进程；高并发可能互相干扰，建议测完关掉 tunnel

**不要尝试把 mac mini 的 profile 同步到 MacBook**：iCloud sync Chrome user data 经常文件锁冲突；cookie 包含 device fingerprint，跨机搬运可能被平台主动登出。

---

## 安全要点

| 措施 | 为什么 |
|---|---|
| `--remote-debugging-address=127.0.0.1`（plist 已写明） | CDP 不暴露到 LAN；任意本地进程仍能连，但外网不行 |
| 独立 profile，不跟 daily Chrome 混 | 即使被入侵也不会泄露你日常账号的 cookie |
| profile 目录排除 iCloud / 公开备份 | session cookie ≈ 短期密码 |
| 不要 `--remote-debugging-address=0.0.0.0` | 等于 LAN 内任何机器都能驱动你的浏览器，**严重风险** |

---

## 故障排查

| 症状 | 检查 |
|---|---|
| `connect ECONNREFUSED ::1:9222` | Chrome LaunchAgent 没起：`launchctl list \| grep snap-mind.chrome` 有没有 PID；`tail ~/Library/Logs/snap-mind/chrome.err.log` |
| `launchctl list` 看到 PID 但 CDP 不通 | profile 路径权限问题，或同端口被另一个 Chrome 占了：`lsof -iTCP:9222` |
| L2 一段时间后突然失败 | 平台 cookie 过期 → Screen Share 进去重新登录 |
| Chrome 启动崩溃，循环重启 | 看 `chrome.err.log`；常见是 profile 损坏（删 profile 重建）或 Chrome 升级后版本不兼容 |
| Mac mini 重启后 Chrome 没起 | 自动登录没开 → System Settings 设一下 |
