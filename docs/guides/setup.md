# 开发环境搭建

## 先决条件

- Node.js >= 24
- pnpm（包管理器）
- [opencli](https://github.com/jackwener/opencli) >= 1.6.10
- Chrome 浏览器（保持各平台登录态，需开启 CDP 远程调试）
- opencli Chrome Extension

### 安装 / 升级 opencli

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

## 快速开始

```bash
# 1. clone & install
git clone git@github.com:sunchaoran/snap-mind.git
cd snap-mind
pnpm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API keys 和 vault 路径

# 3. 启动开发服务
pnpm dev          # tsx watch 模式

# 4. 跑测试
pnpm test

# 5. production 构建
pnpm build        # tsup → dist/
```

## 可用 scripts

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

### 环境变量加载

启动时 `src/config.ts` 按以下顺序加载环境变量文件，**后者覆盖前者**（Vite / Next.js 风格的 cascade）：

1. `.env` — 基础配置
2. `.env.local` — 个人本地覆盖（gitignored）
3. `.env.${NODE_ENV}` — 环境特定（如 `.env.production`）
4. `.env.${NODE_ENV}.local` — 环境 + 本地组合（gitignored）

## 验证安装

```bash
# 检查 opencli（先打 raw 版本，再跑完整 check）
opencli --version
pnpm check:opencli

# 检查 Node.js
node --version  # 需 >= 24

# 测试端点（dev 模式，无需认证）
curl -X POST http://localhost:3210/api/v1/clip \
  -F "image=@screenshot.png"

# 或打开 dev 上传调试页面
open http://localhost:3210/dev
```
