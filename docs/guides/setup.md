# Development Setup Guide

## Prerequisites

- Node.js >= 24
- pnpm (package manager)
- opencli >= 1.6.10
- Chrome browser (保持各平台登录态，需开启 CDP 远程调试)
- opencli Chrome Extension

### Chrome CDP 远程调试

ContentFetcher 的 L2 层通过 Playwright 连接本地 Chrome 的 CDP 端口抓取网页内容。需要以 `--remote-debugging-port=9222` 启动 Chrome。

推荐在 `~/.zshrc` 中添加 alias，避免每次手动传参：

```bash
alias chrome='open -a "Google Chrome" --args --remote-debugging-port=9222'
```

添加后执行 `source ~/.zshrc`，之后用 `chrome` 命令启动即可。

> 如果 9222 端口已被占用，可通过环境变量 `CDP_URL` 指定其他端口。

## Quick Start

```bash
# 1. Clone & install
git clone git@github.com:sunchaoran/snap-mind.git
cd snap-mind
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys and vault path

# 3. Start development server
pnpm dev          # tsx watch mode

# 4. Run tests
pnpm test

# 5. Build for production
pnpm build        # tsup → dist/
```

## Available Scripts

```bash
pnpm dev            # tsx watch mode 开发（自动加载 .env）
pnpm build          # tsup 构建到 dist/
pnpm start          # node dist/index.js 生产运行（自动加载 .env）
pnpm test           # vitest 交互模式
pnpm test:run       # vitest 单次运行
pnpm test:coverage  # vitest run + 覆盖率报告（v8 provider）
pnpm lint           # biome check
pnpm lint:fix       # biome check --fix
pnpm format         # biome format --write
pnpm typecheck      # tsc --noEmit
```

> `dev` 和 `start` 通过 Node 内置的 `--env-file-if-exists=.env` 加载环境变量，缺失 `.env` 时不会报错（适合 prod 用 OS 环境变量的场景）。

## Verify Installation

```bash
# Check opencli
opencli --version

# Check Node.js
node --version  # should be >= 24

# Test the endpoint (dev mode, no auth required)
curl -X POST http://localhost:3210/clip \
  -F "image=@screenshot.png"

# Or visit the dev upload page
open http://localhost:3210/dev
```
