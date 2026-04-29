# 部署指南

> SnapMind backend 是 V1 设计的 self-hostable 服务。本文档覆盖 3 种部署形态——按你的环境挑一个。
>
> 完整设计参见 [api-v2-design.md §8 部署形态](../architecture/api-v2-design.md#8-部署形态)

---

## 通用：构建

```bash
pnpm install
pnpm build           # tsup → dist/
```

输出 `dist/index.js`（server 入口）+ `dist/cli.js`（snap-mind CLI for OpenClaw skill）+ `dist/prompts/`。

---

## 形态 1：macOS — LaunchAgent（V1 推荐）

**适合**：你自己 + Mac power user。

### 1. 配置环境变量

```bash
cp .env.example .env
```

必填：

```env
API_KEY=<32+ 字符随机串>
OPENROUTER_API_KEY=sk-or-v1-...
OBSIDIAN_VAULT_PATH=/Users/<you>/Library/Mobile Documents/com~apple~CloudDocs/Obsidian
```

可选：

```env
PORT=3210
HOST=127.0.0.1                  # 默认绑 localhost；下文 Tailscale 段会改
VLM_MODELS=moonshotai/kimi-k2.5
PROCESSOR_MODEL=moonshotai/kimi-k2.5
```

### 2. 写 LaunchAgent plist

`~/Library/LaunchAgents/dev.snap-mind.server.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.snap-mind.server</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/<you>/Projects/snap-mind/dist/index.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/<you>/Projects/snap-mind</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/Users/<you>/Library/Logs/snap-mind/server.log</string>

  <key>StandardErrorPath</key>
  <string>/Users/<you>/Library/Logs/snap-mind/server.err.log</string>
</dict>
</plist>
```

> 替换 `<you>` 和路径。Node 路径用 `which node` 找。

### 3. 加载

```bash
mkdir -p ~/Library/Logs/snap-mind
launchctl load ~/Library/LaunchAgents/dev.snap-mind.server.plist
launchctl list | grep snap-mind   # 应该看到 PID
curl http://127.0.0.1:3210/health
```

### 4. 网络暴露：Tailscale Serve（可选但推荐）

如果 iOS / OpenClaw 等其他设备要访问：

```bash
# 1. 装 Tailscale，登录，把 Mac 加入 tailnet
brew install --cask tailscale
# 启动 Tailscale.app 完成登录

# 2. 配 Tailscale Serve 反代到 backend
sudo tailscale serve --bg --https=443 http://127.0.0.1:3210

# 3. 验证
curl https://<mac-name>.<tailnet>.ts.net/health
```

之后 iOS app onboarding 填 `https://<mac-name>.<tailnet>.ts.net` + 你的 API_KEY。

> Backend 始终绑 `127.0.0.1`，不暴露 `0.0.0.0`——公网扫描器连接都建立不了。Tailscale Serve 只在 tailnet 内可见。

### 5. 升级流程

```bash
git pull
pnpm install
pnpm build
launchctl unload ~/Library/LaunchAgents/dev.snap-mind.server.plist
launchctl load   ~/Library/LaunchAgents/dev.snap-mind.server.plist
```

将来会有 `scripts/install-launchd.sh` 自动化以上。

---

## 形态 2：Linux / NAS — Docker（V2 计划）

**适合**：Linux self-hoster、NAS（Synology / Unraid / TrueNAS）用户。

> ⚠️ **V2 计划**——V1 只规划好接口和文件结构，Docker 镜像未发布。下面是目标形态。

### 期望用法

```yaml
# docker-compose.yml
services:
  snap-mind:
    image: ghcr.io/<owner>/snap-mind:v1.0.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:3210:3210"     # 默认只监听 localhost
    volumes:
      - ./vault:/vault             # 你的 Obsidian vault 目录
      - ./logs:/app/logs
    environment:
      OBSIDIAN_VAULT_PATH: /vault
      API_KEY: ${API_KEY}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      NODE_ENV: production
```

### Linux 部署的差别

跟 macOS 比：

- ✅ 没 iCloud quirks（online-only 文件、conflict 文件）
- ✅ chokidar 用 inotify，性能比 macOS FSEvents 还好
- ⚠️ 没装 Chrome → L2 web fetch 失败时降级到 L3 搜索引擎或 L4 仅截图（fetchLevel 上升）
- ⚠️ 想 L2 抓取需要在 image 里装 Chromium（增加 ~300MB 镜像体积）

### 反代 + HTTPS

不用 Tailscale 的话，常见组合：

- Caddy（自动 Let's Encrypt） → backend
- nginx + certbot → backend

不在本文档详细展开——Linux 用户对这套熟悉。

---

## 形态 3：macOS .app installer（V2 计划）

**适合**：不会用命令行的 Mac 用户。

> 目标形态：用户下载 `.dmg`、拖进 Applications、首次启动 onboarding 引导填 API key + vault 路径，app 自动安装 LaunchAgent。

V1 不做。V2 详见 roadmap §V2.2。

---

## 配套：可选依赖

### opencli + Chrome（L1 抓取最强路径）

```bash
pnpm add -g @jackwener/opencli
```

确保 Chrome 保持以下平台登录态：

- Twitter / X
- 小红书
- 微博
- 知乎
- Bilibili
- 豆瓣

没装 opencli 时 backend 仍可用，但平台抓取会从 L1 直接降级到 L2 / L3。

### Playwright Chromium

`pnpm install` 时会顺带装 Playwright，但首次跑需要：

```bash
npx playwright install chromium
```

可选——用于 L2 web fetch 的 fallback。

---

## 故障排查

| 症状 | 检查 |
|---|---|
| `launchctl list` 看不到进程 | plist 路径、Node 路径、JSON 语法、log 文件夹是否存在 |
| backend 启动后立刻 KeepAlive 重启 | `tail -f ~/Library/Logs/snap-mind/server.err.log` 看错误 |
| `/health` 返回 200 但 API 401 | API_KEY 是否对，client header `Authorization: Bearer <key>` |
| iOS / OpenClaw 连不上 | Tailscale 装了吗、`tailscale status`、`https://<mac>.ts.net/health` 通不通 |
| 抓取经常 fetchLevel=4 | opencli 装了吗、Chrome 平台登录是否还有效、OpenRouter 配额 |

日志位置：

- `~/Library/Logs/snap-mind/server.log`（stdout）
- `~/Library/Logs/snap-mind/server.err.log`（stderr）

每个请求带 `X-Request-Id`，报 issue 时附上 ID 和日志片段。
