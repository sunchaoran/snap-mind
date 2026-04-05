# Development Setup Guide

## Prerequisites

- Node.js >= 20
- pnpm (package manager)
- opencli-rs (latest)
- Chrome browser (保持各平台登录态)
- opencli-rs Chrome Extension

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
pnpm dev

# 4. Run tests
pnpm test
```

## Verify Installation

```bash
# Check opencli-rs
opencli-rs --version

# Check Node.js
node --version  # should be >= 20

# Test the endpoint
curl -X POST http://localhost:3210/clip \
  -F "image=@screenshot.png"
```
