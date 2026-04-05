# System Architecture Overview

## 1. Problem Statement

用户在浏览手机 App（Twitter、小红书、Reddit、微博、知乎等）时，看到感兴趣的内容想收藏，但只想做最轻量的动作——截图。ClipService 接收截图后，自动完成内容识别、原文获取、摘要生成、标签分类，最终存入 Obsidian vault，形成结构化的个人知识库。

## 2. User Flow

```
用户截图 → 发送到微信 → 龙虾(OpenClew Agent) 接收
→ A2A 调用 ClipService HTTP API → 自动处理
→ 龙虾回复微信确认："已收藏: 标题 [平台] #tag1 #tag2"
```

## 3. Architecture Diagram

```
龙虾 (OpenClew Agent)
    │
    │  HTTP POST /clip  (image binary)
    ▼
┌─────────────────────────────────────────────────┐
│                  ClipService                     │
│                                                  │
│  ┌─────────────┐                                │
│  │  A2AServer   │  HTTP 服务，接收截图            │
│  └──────┬──────┘                                │
│         ▼                                        │
│  ┌─────────────┐                                │
│  │ VLMAnalyzer  │  三模型并发识别 + 投票合并      │
│  └──────┬──────┘                                │
│         ▼                                        │
│  ┌──────────────┐                               │
│  │ContentFetcher│  四级策略获取原文               │
│  └──────┬───────┘                               │
│         ▼                                        │
│  ┌────────────────┐                             │
│  │ContentProcessor│  摘要 / 标签 / 分类          │
│  └──────┬─────────┘                             │
│         ▼                                        │
│  ┌─────────────┐                                │
│  │  ClipWriter  │  write driver 抽象层           │
│  │  └─MarkdownWriter│  第一版实现               │
│  └──────────────┘                                │
│                                                  │
│  外部依赖：                                      │
│  ├─ OpenRouter API (Claude/Gemini/GPT-4o)       │
│  ├─ opencli-rs (本地 CLI)                        │
│  └─ Obsidian vault (本地文件系统)                │
└─────────────────────────────────────────────────┘
```

## 4. Processing Pipeline

```
handleClipRequest(imageBuffer)
    │
    ├─ 1. generateClipId() + saveTempScreenshot()
    │
    ├─ 2. vlmAnalyzer.analyze(imageBuffer)
    │      └─ 三模型并发调用 → 投票合并 → MergedVLMResult
    │
    ├─ 3. clipWriter.findSimilar() → 去重检查
    │
    ├─ 4. contentFetcher.fetch(vlmResult)
    │      └─ L1 → L2 → L3 → L4 逐级降级
    │
    ├─ 5. contentProcessor.process(vlmResult, fetchResult)
    │      └─ 摘要 + 标签 + 分类 + 语言检测
    │
    ├─ 6. screenshotStore.save()
    │
    ├─ 7. 组装 ClipRecord
    │
    ├─ 8. clipWriter.write(record)
    │
    ├─ 9. saveSidecarJson()
    │
    └─ 10. 返回 ClipResponse
```

## 5. Deployment Environment

- **运行环境**：Mac mini，本地常驻 Node.js 服务
- **依赖服务**：Chrome 浏览器（保持各平台登录态）、opencli-rs CLI 工具、OpenRouter API
- **存储**：本地 Obsidian vault
- **进程管理**：PM2 或 launchd

## 6. Error Handling Strategy

- 整体流程 try-catch 包裹，超时 90 秒
- 失败时截图仍保存到 vault assets 目录
- 写入一条最小化的失败记录（`fetchLevel: 4`），标记为待重试
- 返回 `message` 字段供龙虾直接回复用户
