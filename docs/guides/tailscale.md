# Tailscale 部署指南

> 一句话定位：让 iOS app / 笔记本 / iPad 通过 Tailscale 安全访问 Mac mini 上的 backend。
>
> 完整设计参见 [api-design.md §8 部署形态](../architecture/api-design.md#8-部署形态)。本文档是 [deployment.md](./deployment.md) 网络暴露段的展开。

## 它在 SnapMind 部署里扮演什么角色

backend 只绑 `127.0.0.1`——公网扫描器连接都建立不了。跨设备访问全部走 Tailscale：每台设备装一个 client，加入同一个 tailnet，互相能看到。Tailscale Serve 在 Mac mini 这一端把 HTTPS 终止掉、反代到本机 backend。

```
┌── iOS app ───┐
│              │
└─ 100.x.y.z ──┘  Tailscale tunnel
       │           (WireGuard)
       ▼
┌─── tailnet ────────────────────────────┐
│  MagicDNS: <mac>.<tailnet>.ts.net      │
└────────────┬───────────────────────────┘
             │
             ▼
   ┌── Mac mini ───────────────────────┐
   │                                    │
   │  tailscaled (Tailscale.app)        │
   │     │  https://<mac>.ts.net:443    │
   │     │  ↓ tailscale serve           │
   │     ▼                              │
   │  http://127.0.0.1:3210             │
   │  (backend, LaunchAgent)            │
   └────────────────────────────────────┘
```

证书由 Tailscale 自动签发（LetsEncrypt-style），MagicDNS 提供 `<hostname>.<tailnet>.ts.net` 域名。tailnet 之外完全不可见。

## 前置：你需要什么

- Mac mini 已按 [deployment.md 形态 1](./deployment.md) 装好 backend、`/health` 在 `http://127.0.0.1:3210/health` 通
- 一个 [Tailscale](https://tailscale.com) 账号（个人免费版够用——Personal plan 含 100 设备）
- 想接入的客户端设备（iOS、笔记本、iPad 等）

## 第一次安装

### Mac mini 端

```bash
brew install --cask tailscale
open -a Tailscale            # 启动 menu bar app
```

第一次启动会弹登录页。用 Google / GitHub / 邮箱登录任选——这是你 tailnet 的 owner 账号，**所有客户端设备后面都用同一个账号登录**。

登录完成后菜单栏会显示连接状态。验证：

```bash
tailscale status             # 应能看到 mac mini 自己的条目
tailscale ip                 # 显示 100.x.y.z 这一段的 tailnet IP
```

记下两件事：

- **Tailnet IP**：`100.x.y.z`，每台设备一个，加入 tailnet 后稳定不变
- **MagicDNS hostname**：默认是 `<mac-hostname>.<tailnet>.ts.net`，例如 `mac-mini.tail1234.ts.net`。在 [Tailscale admin](https://login.tailscale.com/admin/dns) 能看到完整的 tailnet 域名

> 如果 admin 后台 DNS 设置里没启 MagicDNS，先打开它——下文 `tailscale serve` 的 HTTPS 证书依赖 MagicDNS。

### 客户端端

每台要访问 backend 的设备都装 Tailscale client、用同一个账号登录：

| 平台 | 安装方式 |
|---|---|
| iOS / iPadOS | App Store 搜 "Tailscale" |
| macOS（笔记本） | `brew install --cask tailscale` 或 App Store |
| Linux | 参见 [Tailscale install docs](https://tailscale.com/download/linux) |
| Windows | 官网下载 installer |

### 验证 tailnet 通了

任意一台 client 上：

```bash
tailscale status                    # 列出 tailnet 内所有设备
ping <mac-mini-hostname>            # 走 MagicDNS 解析到 100.x.y.z
curl http://<mac-mini-hostname>:3210/health
```

最后一步如果通——基础打通了。下一步配 HTTPS。

## 配置 Tailscale Serve（HTTPS 反代）

在 Mac mini 上跑：

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:3210
```

flag 解释：

- `--bg`：后台跑，`tailscale serve status` 可查
- `--https=443`：监听 443，自动签发 + 续期 LetsEncrypt-style 证书
- 末尾参数：upstream，指向本机 backend

第一次执行会触发证书签发，需要几秒。完成后验证：

```bash
# 在 mac mini 上
tailscale serve status              # 应看到 https://...:443 → http://127.0.0.1:3210

# 在任意 client 上
curl https://<mac-mini-hostname>.<tailnet>.ts.net/health
```

返回 `{"status":"ok"}` 就成了。

## 把 client 接进去

backend 自己不变；client 只需要把 base URL 换成 Tailscale 的 HTTPS 地址。

- **iOS / macOS app onboarding**：填 `https://<mac>.<tailnet>.ts.net` 作为 server URL，加上 `.env` 里那个 `API_KEY` 作为 Bearer token
- **OpenClaw skill**：同一份 base URL + API key，参见 skill 的 onboarding 文档

API contract（路径、错误码、SSE）跟本机访问完全一致——参见 [api-design.md §3 Wire Format](../architecture/api-design.md#3-wire-format公开契约)。

## ACL（可选，推荐）

默认 tailnet 内部全互通——单用户场景这样没问题，所有设备都是你自己的。

如果想更收敛（比如以后有别人加入 tailnet 但不该看到 backend），可以给 mac mini 打 tag、写 ACL：

```hujson
{
  "tagOwners": {
    "tag:snap-mind-server": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src":    ["autogroup:member"],
      "dst":    ["tag:snap-mind-server:443"]
    }
  ]
}
```

含义：tailnet 成员只能访问打了 `tag:snap-mind-server` 标签的设备的 443 端口。其他端口、其他设备照默认隐藏或允许。

打 tag 在 [Tailscale admin → Machines](https://login.tailscale.com/admin/machines) 里给 mac mini 加。完整 ACL 语法见 [Tailscale ACL docs](https://tailscale.com/kb/1018/acls)，本文不展开。

## 故障排查

| 症状 | 检查 |
|---|---|
| `tailscale status` 看不到 mac mini | Tailscale.app 启动了吗、登录态还在吗、菜单栏图标变灰说明掉线 |
| `curl https://...ts.net` 报证书错 | MagicDNS 在 admin 后台开了吗、`tailscale cert <host>` 跑过吗、`tailscale serve status` 显示 https 是 on 吗 |
| client 连得上但 401 | API_KEY 错了、`Authorization: Bearer <key>` header 没带；看 backend 日志的 `unauthorized` |
| `tailscale serve` 配了但端口不响应 | backend 还在跑吗（`launchctl list \| grep snap-mind`）、`curl http://127.0.0.1:3210/health` 直连通不通、Mac 是不是睡眠了 |
| 域名解析错（`<mac>.ts.net` not found） | client 端 Tailscale 是不是开着、admin 后台 MagicDNS toggle 是不是 on |
| `sudo tailscale serve` 提示需要 funnel | 你不需要 funnel——那是公网暴露，本文档明确不用。检查你打的是 `serve` 不是 `funnel` |

backend 自身的日志位置参见 [deployment.md 故障排查段](./deployment.md#故障排查)。

## 升级 / 维护

- **Tailscale.app**：自动更新，正常不用管。手动检查：菜单栏 → About → Check for updates
- **backend 重启不影响 Serve**：Tailscale Serve 配置持久化在 tailscaled state 里。`launchctl unload && load` 走完一遍 backend，Serve 仍然指着 `127.0.0.1:3210`
- **改 backend 端口**：先 `sudo tailscale serve reset`（清掉旧 mapping），再用新端口重新跑 `tailscale serve --bg --https=443 http://127.0.0.1:<新端口>`
- **换 Mac mini 主机名**：MagicDNS 域名跟着变；client 端的 server URL 要更新

## 何时不该用 Tailscale

绝大多数 self-host 场景 Tailscale 是最省事的——一行命令搞定 HTTPS + 跨设备访问。下面是**不**适用的场景，仅做指引，不在本文档展开替代方案的细节：

- **不想装 Tailscale**：公网暴露需要自己搞反代（Caddy / nginx + Let's Encrypt）。backend 仍**不**绑 `0.0.0.0`，由反代经 `127.0.0.1` 转发，并自己加 IP allowlist 或 VPN 防扫描
- **公司网络禁 Tailscale / WireGuard**：可以看 ZeroTier、Cloudflare Tunnel 这类替代——名字仅供参考
- **完全只在本机用**：不需要 cross-device → 直接 `curl http://127.0.0.1:3210`，Tailscale 都不必装
