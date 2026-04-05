# Development Setup Guide

## Prerequisites

- Node.js >= 22
- pnpm (package manager)
- opencli (latest)
- Chrome browser (保持各平台登录态)
- opencli Chrome Extension

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

## Verify Installation

```bash
# Check opencli
opencli --version

# Check Node.js
node --version  # should be >= 22

# Test the endpoint
curl -X POST http://localhost:3210/clip \
  -H "Authorization: Bearer <your-api-key>" \
  -F "image=@screenshot.png"
```
