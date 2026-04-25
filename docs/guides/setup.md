# Development Setup Guide

## Prerequisites

- Node.js >= 24
- pnpm (package manager)
- [opencli](https://github.com/jackwener/opencli) >= 1.6.10
- Chrome browser (保持各平台登录态，需开启 CDP 远程调试)
- opencli Chrome Extension

### Install / Upgrade opencli

推荐使用 pnpm 全局管理 CLI 工具。

```bash
# 首次：初始化 pnpm 全局 bin（一次性，幂等）
pnpm setup
source ~/.zshrc        # 或新开终端，让 PATH 生效

# 安装或升级到最新
pnpm add -g @jackwener/opencli@latest

# 检查本地版本
pnpm check:opencli
```

> opencli 的 shebang 用 `env node`，运行时跟随 nvm active 的 Node 版本——本项目要求 Node ≥ 24，nvm 切到符合的版本即可。

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
pnpm check:opencli  # 对比本地 opencli 版本与 npm 最新版（@jackwener/opencli）
```

### Environment Variables Loading

启动时 `src/config.ts` 自动按以下顺序加载环境变量文件，**后者覆盖前者**（Vite / Next.js 风格的 cascade）：

1. `.env` — 基础配置
2. `.env.local` — 个人本地覆盖（gitignored）
3. `.env.${NODE_ENV}` — 环境特定（如 `.env.production`）
4. `.env.${NODE_ENV}.local` — 环境 + 本地组合（gitignored）

## Verify Installation

```bash
# Check opencli (raw version, then full check vs latest + min required)
opencli --version
pnpm check:opencli

# Check Node.js
node --version  # should be >= 24

# Test the endpoint (dev mode, no auth required)
curl -X POST http://localhost:3210/clip \
  -F "image=@screenshot.png"

# Or visit the dev upload page
open http://localhost:3210/dev
```
