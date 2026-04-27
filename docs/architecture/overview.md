# System Architecture Overview

## 1. Problem Statement

用户在浏览手机 App（Twitter、小红书、Reddit、微博、知乎等）时，看到感兴趣的内容想收藏，但只想做最轻量的动作——截图。ClipService 接收截图后，自动完成内容识别、原文获取、摘要生成、标签分类，最终存入 Obsidian vault，形成结构化的个人知识库。

## 2. User Flow

### 写入

```
单张上传：
客户端 → POST /clip (截图) → 返回 jobId (202)
       → 轮询 GET /jobs/:id → 处理完成后返回结果

批量上传（最多 20 张）：
客户端 → POST /clip/batch (多张截图) → 返回 batchId + jobIds (202)
       → 轮询 GET /batch/:id 获取整体进度
       → 轮询 GET /jobs/:id 获取单张进度
```

### 读取 / 删除

backend 是 vault 的唯一解析者，client 直接消费 JSON 而不再各自维护
markdown parser。

```
列表：
客户端 → GET /clip → ClipRecordWire[] (轻量，不含原文)
       → 内存 filter / sort

详情：
客户端 → GET /clip/:id → ClipRecordWireFull (含 contentFull)

删除：
客户端 → DELETE /clip/:id → 204
       → 物理删 .md + 全部 assets/<id>.* + evict writer dedup index
```

每次读都重新扫盘——vault ~千条量级在可控范围内，不维护内存索引/缓存
（writer 内部那个 dedup index 不是给 read 路径用的）。

## 3. Architecture Diagram

```
客户端 (龙虾 / Web App / iOS App)
    │
    │  HTTP POST /clip  (image + auth)
    ▼
┌─────────────────────────────────────────────────┐
│                  ClipService                     │
│                                                  │
│  ┌──────────────┐                               │
│  │ InputAdapter  │  HTTP 服务 + 认证，接收截图    │
│  │               │  单张: Job → jobId (202)      │
│  │               │  批量: BatchJob → batchId     │
│  └──────┬───────┘                               │
│         ▼  (async pipeline, fire-and-forget)     │
│  ┌─────────────┐                                │
│  │ VLMAnalyzer  │  两阶段：平台识别 → N模型提取   │
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
│  GET /jobs/:id  → 轮询 Job 状态 + 进度           │
│                                                  │
│  ┌──────────────┐                                │
│  │ ClipLibrary   │  GET /clip, GET /clip/:id,    │
│  │ (library/    │  DELETE /clip/:id              │
│  │  clips.ts)    │  扫 vault → wire format       │
│  └──────────────┘                                │
│                                                  │
│  外部依赖：                                      │
│  ├─ OpenRouter API (Kimi/Gemini/Claude/GPT-4o)  │
│  ├─ opencli (本地 CLI)                            │
│  └─ Obsidian vault (本地文件系统)                │
└─────────────────────────────────────────────────┘
```

## 4. Processing Pipeline

收到 POST /clip 请求后，立即返回 `jobId`（202），pipeline 在后台异步执行，通过 JobStore 跟踪每步进度。

```
handleClip(jobId, clipId, imageBuffer)
    │
    ├─ Step 0: 图片预处理
    │      └─ sharp: 缩放（最长边 ≤ 2560px）→ WebP 压缩（quality 80）
    │
    ├─ Step 1/7: VLM 截图分析
    │      └─ 两阶段：先识别平台 → 再用平台特定 prompt 并发提取 → 投票合并
    │
    ├─ Step 2/7: 去重检查
    │      └─ findSimilarClip(platform, author, title)
    │      └─ 命中后跳过后续所有步骤
    │
    ├─ Step 3/7: 抓取原文
    │      └─ L1 → L2 → L3 → L4 逐级降级
    │
    ├─ Step 4/7: 内容处理
    │      └─ 摘要 + 标签 + 分类 + 语言检测
    │
    ├─ Step 5/7: 保存截图
    │      └─ 自动检测图片格式 (PNG/JPEG/WEBP/GIF)
    │
    ├─ Step 6/7: 组装 ClipRecord
    │
    └─ Step 7/7: 写入 Vault
           └─ renderClipMarkdown() + 保存 MD 文件
           └─ saveSidecarJson() 保存 VLM 原始结果
```

## 5. Deployment Environment

- **运行环境**：Mac mini，本地常驻 Node.js 服务
- **依赖服务**：Chrome 浏览器（保持各平台登录态）、opencli CLI 工具、OpenRouter API
- **存储**：本地 Obsidian vault
- **进程管理**：PM2 或 launchd

## 6. Error Handling Strategy

- 整体流程 try-catch 包裹，超时 300 秒
- Pipeline 在后台运行，通过 JobStore 记录状态
- 失败时截图仍保存到 vault assets 目录
- 写入一条最小化的失败记录（`fetchLevel: 4`），标记为待重试
- 返回 `message` 字段供龙虾直接回复用户
