# Module: ClipWriter

> Write driver 抽象层，第一版实现 MarkdownWriter。

## Source Files

- `src/writer/interface.ts` — ClipWriter 接口定义
- `src/writer/markdown.ts` — MarkdownWriter 实现
- `src/writer/template.ts` — Markdown 模板渲染 + 内容格式化

## Interface

```typescript
interface ClipWriter {
  /** 写入一条收藏记录，返回 vault 相对路径 */
  write(record: ClipRecord): Promise<string>;

  /** 检查是否已存在（去重） */
  exists(id: string): Promise<boolean>;

  /** 模糊去重：检查是否有高度相似的条目 */
  findSimilar(
    platform: string,
    author: string | null,
    title: string | null
  ): Promise<string | null>;
}
```

## MarkdownWriter Implementation

### Vault Directory Structure

```
{VAULT_PATH}/
  Clippings/
    _index.md                                    # Dataview 汇总页（自动生成）
    2026-04-02_xiaohongshu_rust-async-guide.md
    2026-04-02_twitter_llm-agent-pattern.md
    ...
    assets/
      clip_20260402_143000_V1StGX.png            # 原始截图
      clip_20260402_143000_V1StGX.json           # rawVlmResult sidecar
```

### File Naming

Format: `{yyyy-MM-dd}_{platform}_{title_slug}.md`

- `title_slug`: 使用 `slugify` 库生成 URL 友好的标识，截取前 50 字符
- 文件名冲突时追加 `-2`、`-3`

### Markdown Template (Normal)

```markdown
---
id: clip_20260402_143000_V1StGX
title: "Rust 异步编程指南"
platform: xiaohongshu
author: "某用户名"
originalUrl: "https://www.xiaohongshu.com/explore/xxx"
contentType: post
tags:
  - rust
  - async
  - 编程
category: tech
language: zh
fetchLevel: 1
sourceConfidence: 0.95
createdAt: 2026-04-02T14:30:00.000Z
---

## 摘要

Rust 的异步编程模型基于 Future trait 和 async/await 语法...

## 原文

（完整原文，经 formatContent() 格式化后的内容）

## 截图

![[assets/clip_20260402_143000_V1StGX.png]]
```

### Markdown Template (fetchLevel=4, No Original)

```markdown
---
# ...同上，但 fetchLevel: 4, originalUrl: null
---

## 摘要

（基于截图识别，未获取到原文）根据截图内容，这是一篇关于……

## 原文

> ⚠️ 未能获取原文。以下为截图中识别到的内容片段：

{contentSnippet from VLM}

## 截图

![[assets/clip_20260402_143000_V1StGX.png]]
```

### formatContent()

`template.ts` 中的 `formatContent()` 函数用于修复被压平的文本（如 opencli 输出中被去除的换行符）。

处理规则：
- 如果文本已有合理的换行（每 500 字符超过 3 个换行），跳过处理
- 在 emoji 标题前（如 💡 为什么）插入空行
- 在 bullet points（•, ·）前插入换行
- 去除尾部的 hashtag 块（如 `#AI助手 #Mac ...`）

### Dataview Index Page (_index.md)

自动生成，包含三个 Dataview 查询：最近收藏、按平台统计、待补充原文。

仅在 `_index.md` 不存在时创建（不会覆盖已有文件）。

## Deduplication

`findSimilarClip` 方法扫描 Clippings 目录下已有 md 文件的 frontmatter，比对 `platform + author + title`。

- 使用 Levenshtein 相似度（`js-levenshtein`）
- 阈值 ≥ **0.85** 视为重复
- 先匹配 platform，再匹配 title，最后匹配 author
- 若 title 相似度达标且无 author 可比对，仅凭 title 即判定重复
- 返回已存在的 clipId 或 null
