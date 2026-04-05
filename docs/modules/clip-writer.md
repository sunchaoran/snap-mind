# Module: ClipWriter

> Write driver 抽象层，第一版实现 MarkdownWriter。

## Source Files

- `src/writer/interface.ts` — ClipWriter 接口定义
- `src/writer/markdown.ts` — MarkdownWriter 实现
- `src/writer/template.ts` — Markdown 模板渲染

## Interface

```typescript
interface ClipWriter {
  /** 写入一条收藏记录 */
  write(record: ClipRecord): Promise<void>;

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
      clip_20260402_143000_a3f2.png              # 原始截图
      clip_20260402_143000_a3f2.json             # rawVlmResult sidecar
```

### File Naming

Format: `{yyyy-MM-dd}_{platform}_{title_slug}.md`

- `title_slug`: 标题转小写，非字母数字字符替换为 `-`，截取前 50 字符
- 文件名冲突时追加 `-2`、`-3`

### Markdown Template (Normal)

```markdown
---
id: clip_20260402_143000_a3f2
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
createdAt: 2026-04-02T14:30:00+08:00
---

## 摘要

Rust 的异步编程模型基于 Future trait 和 async/await 语法...

## 原文

（完整原文，markdown 格式化后的内容）

## 截图

![[assets/clip_20260402_143000_a3f2.png]]
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

![[assets/clip_20260402_143000_a3f2.png]]
```

### Dataview Index Page (_index.md)

```markdown
# 📋 Clippings

## 最近收藏

\```dataview
TABLE platform, category, tags, sourceConfidence
FROM "Clippings"
WHERE id != null
SORT createdAt DESC
LIMIT 50
\```

## 按平台统计

\```dataview
TABLE length(rows) as "数量"
FROM "Clippings"
WHERE id != null
GROUP BY platform
SORT length(rows) DESC
\```

## 待补充原文

\```dataview
TABLE title, platform, createdAt
FROM "Clippings"
WHERE fetchLevel = 4
SORT createdAt DESC
\```
```

## Deduplication

`findSimilar` 方法扫描 Clippings 目录下已有 md 文件的 frontmatter，比对 `platform + author + title`。

- 使用 Levenshtein 或 Jaccard 相似度
- 阈值 ≥ **0.85** 视为重复
- 返回已存在的 clipId 或 null
