/**
 * Wire types — 公开/客户端可见的所有类型。
 *
 * 这些类型构成 V1 API 的稳定契约（参见 `docs/architecture/api-design.md` §3）。
 * 字段命名 / 形态一旦发布就不能随便改，要破坏性变更走版本前缀（`/api/v2/`）。
 *
 * 内部 domain 类型（`ClipRecord`、`VLMResult`、`FetchResult` 等）放在
 * {@link ./domain.ts}，本文件 re-export 共享枚举（Platform / Category /
 * ContentType）以保持单一 source of truth。
 */

import type { Category, ContentType, Platform } from "@/types/domain.js";

// Re-export domain enums so wire-only consumers don't need to reach across.
export type { Category, ContentType, Platform };

/**
 * Job 生命周期状态。
 *
 * `running` → `done` (success) / `error` (terminal failure)。
 * 仅这三种 — 没有 "pending"，因为 client 一拿到 jobId 就有 in-memory job
 * 在 running。
 */
export type JobStatus = "running" | "done" | "error";

/**
 * 单个 pipeline step 的状态（`steps[i].status`）。
 *
 * `skipped` 用于 dedup 命中后跳过 fetch / process / write 等步骤；UI 应
 * 当区别 done 和 skipped 给用户更准确的反馈。
 */
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

/**
 * `GET /api/v1/clip` 列表里每条 clip 的精简 wire format。
 *
 * 跟内部的 `ClipRecord` 区别：
 * - 不含 `contentFull`：单条原文可能几十 KB，列表里全带回去太重；
 *   detail 端点 (`GET /api/v1/clip/:id`) 用 {@link ClipRecordWireFull} 带回去
 * - 不含 `rawVlmResult`：是 VLM debug 元数据，已落到 `<assets>/<id>.json`
 *   sidecar，不该出现在 client 消费的 wire format 里
 */
export interface ClipRecordWire {
  id: string;
  title: string;
  platform: Platform;
  author: string;
  originalUrl: string | null;
  contentType: ContentType;
  contentSummary: string;
  tags: string[];
  category: Category;
  language: string;
  /** vault-relative path, e.g. "snap-mind/assets/clip_xxx.webp" */
  screenshotPath: string;
  fetchLevel: 1 | 2 | 3 | 4;
  sourceConfidence: number;
  /** ISO 8601 string, 原样从 frontmatter 透出 */
  createdAt: string;
}

/**
 * `GET /api/v1/clip/:id` detail 视图：在 {@link ClipRecordWire} 之上补
 * `contentFull`。
 *
 * `contentFull` = markdown body 里 `## 原文` 段的全文（已经过 backend 写入
 * 时的 `formatContent` 规整）。fetchLevel=4 失败 record 的段落是"警告 +
 * VLM snippet"的 markdown，原样返回，client 自己渲染。
 *
 * 仅当 `## 原文` 段缺失或纯空白时为 `null`（手工 backfill / 老格式）。
 */
export interface ClipRecordWireFull extends ClipRecordWire {
  contentFull: string | null;
}

/**
 * `GET /api/v1/jobs/:id` 拿到的 job.result 形态。也是 batch.results[] 的元素。
 *
 * 这是公开 wire 类型，clients 通过 polling 看到它。字段不要随便改名。
 */
export interface ClipResponse {
  success: boolean;
  clipId: string;
  title?: string;
  platform?: Platform;
  tags?: string[];
  category?: Category;
  fetchLevel?: 1 | 2 | 3 | 4;
  /** Vault-relative path to the clip file, e.g. "snap-mind/2026-04-05_twitter_xxx.md" */
  vaultPath?: string;
  error?: string;
  screenshotSaved?: boolean;
  message: string;
}

/**
 * Job 的 wire snapshot — `GET /api/v1/jobs/:id` 直接返回这个 shape。
 *
 * 内存中的 `Job` (`src/server/job-store.ts`) 和这个形状一致，server 直接
 * 把 in-memory 对象作为 response body 返回；这里把它复制成 wire-only 类型
 * 是为了 spec / 客户端 SDK 生成时不必反过来 import server 内部模块。
 */
export interface JobWire {
  id: string;
  clipId: string;
  status: JobStatus;
  steps: JobStepWire[];
  currentStep: number;
  result?: ClipResponse;
  createdAt: number;
}

export interface JobStepWire {
  name: string;
  status: StepStatus;
  message?: string;
}

/** Batch 的 wire snapshot — `GET /api/v1/batch/:id` 直接返回这个 shape。 */
export interface BatchWire {
  id: string;
  status: JobStatus;
  jobIds: string[];
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  results: ClipResponse[];
  createdAt: number;
}

/**
 * Sticky session 状态 — `GET /api/v1/clip/sticky/:sessionId` 返回。
 *
 * 三种相位（buffering / processing / done）对应 sticky 上传的生命周期：
 * - buffering: 还在收集图，没起 batch（batchId 为 null）
 * - processing: 已 commit 到 batch，正在 pipeline 里
 * - done: batch 全部跑完，可以拿 `results` 了
 */
export interface StickyWire {
  sessionId: string;
  status: "buffering" | "processing" | "done";
  queueDepth: number;
  /** processing / done 阶段才有；buffering 阶段为 undefined */
  batchId?: string | null;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  results: ClipResponse[];
}

/**
 * 统一错误信封（参见 `docs/architecture/api-design.md` §3）。
 *
 * 所有非 2xx response 一律是这个 shape — `code` 是 STABLE 的，clients 按
 * code 做分支判断；`message` 是给人看的，可改写。`details` 留给以后扩展
 * （比如 validation failure 的字段列表），V1 默认 null。
 */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
