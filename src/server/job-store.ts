import { EventEmitter } from "node:events";
import type {
  BatchWire,
  ClipResponse,
  JobStatus,
  JobStepWire,
  JobWire,
  StepStatus,
} from "@/types/wire.js";

// Re-export wire-side aliases under their historical names so callers that
// referenced the old in-memory types (`Job`, `BatchJob`, `JobStep`) keep
// compiling. The in-memory state and the wire snapshot are intentionally the
// same shape — `GET /api/v1/jobs/:id` etc. just return the in-memory object.
export type { JobStatus, StepStatus };
export type Job = JobWire;
export type BatchJob = BatchWire;
export type JobStep = JobStepWire;

/**
 * 内部 event 类型 — 用于 SSE handler 订阅 in-memory 状态变化。
 *
 * 故意不放进 `src/types/wire.ts`：这是 server 内部的 push channel，不上 wire
 * （SSE 帧自己的 shape 在 routes 层组装，不和这个类型直接绑）。
 */
export type JobEvent =
  | {
      type: "step";
      stepIndex: number;
      status: StepStatus;
      message?: string;
    }
  | {
      type: "done";
      result: ClipResponse;
    }
  | {
      type: "error";
      result: ClipResponse;
    };

export type BatchEvent =
  | {
      type: "progress";
      batch: BatchWire;
    }
  | {
      type: "done";
      batch: BatchWire;
    }
  | {
      type: "error";
      batch: BatchWire;
    };

const STEP_NAMES = [
  "VLM 截图分析",
  "去重检查",
  "抓取原文",
  "内容处理",
  "保存截图",
  "组装记录",
  "写入 Vault",
];

const jobs = new Map<string, Job>();
const batchJobs = new Map<string, BatchJob>();

// EventEmitters 把 mutator 调用扇出到任意数量的 SSE listener。
// setMaxListeners(0) 关掉 Node 默认的 10 个 listener 警告 — 单 job/batch
// 一般只有 1-2 个 client，但允许多个订阅（debug、多端）也无害。
const jobEvents = new EventEmitter();
const batchEvents = new EventEmitter();
jobEvents.setMaxListeners(0);
batchEvents.setMaxListeners(0);

// Auto-clean jobs older than 30 minutes
const MAX_AGE_MS = 30 * 60 * 1000;

export function createJob(jobId: string, clipId: string): Job {
  cleanup();

  const job: Job = {
    id: jobId,
    clipId,
    status: "running",
    steps: STEP_NAMES.map((name) => ({
      name,
      status: "pending" as StepStatus,
    })),
    currentStep: -1,
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function stepStart(jobId: string, stepIndex: number, message?: string) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.currentStep = stepIndex;
  job.steps[stepIndex].status = "running";
  if (message) {
    job.steps[stepIndex].message = message;
  }
  jobEvents.emit(jobId, {
    type: "step",
    stepIndex,
    status: "running",
    message,
  } satisfies JobEvent);
}

export function stepDone(jobId: string, stepIndex: number, message?: string) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.steps[stepIndex].status = "done";
  if (message) {
    job.steps[stepIndex].message = message;
  }
  jobEvents.emit(jobId, {
    type: "step",
    stepIndex,
    status: "done",
    message,
  } satisfies JobEvent);
}

export function stepSkipped(
  jobId: string,
  stepIndex: number,
  message?: string,
) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.steps[stepIndex].status = "skipped";
  if (message) {
    job.steps[stepIndex].message = message;
  }
  jobEvents.emit(jobId, {
    type: "step",
    stepIndex,
    status: "skipped",
    message,
  } satisfies JobEvent);
}

export function jobDone(jobId: string, result: ClipResponse) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = "done";
  job.result = result;
  jobEvents.emit(jobId, {
    type: "done",
    result,
  } satisfies JobEvent);
}

export function jobError(jobId: string, result: ClipResponse) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = "error";
  job.result = result;
  jobEvents.emit(jobId, {
    type: "error",
    result,
  } satisfies JobEvent);
}

export function createBatchJob(batchId: string, jobIds: string[]): BatchJob {
  const batch: BatchJob = {
    id: batchId,
    status: "running",
    jobIds,
    total: jobIds.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    results: [],
    createdAt: Date.now(),
  };
  batchJobs.set(batchId, batch);
  return batch;
}

export function getBatchJob(batchId: string): BatchJob | undefined {
  return batchJobs.get(batchId);
}

export function batchItemDone(batchId: string, result: ClipResponse) {
  const batch = batchJobs.get(batchId);
  if (!batch) {
    return;
  }

  batch.completed++;
  batch.results.push(result);
  if (result.success) {
    batch.succeeded++;
  } else {
    batch.failed++;
  }

  if (batch.completed >= batch.total) {
    batch.status = batch.failed === batch.total ? "error" : "done";
  }

  // 一次 mutator 调用产生一个事件 — terminal 时也只发一次（type 取决于
  // 最终的 batch.status）。SSE handler 看 type 决定是否 close stream。
  const type: BatchEvent["type"] =
    batch.status === "done"
      ? "done"
      : batch.status === "error"
        ? "error"
        : "progress";
  batchEvents.emit(batchId, {
    type,
    batch,
  } satisfies BatchEvent);
}

/**
 * 订阅某个 jobId 的实时事件流 — 由 SSE handler 调用。
 *
 * 返回一个 unsubscribe 函数，必须在 client 断线 / job terminal 之后调用,
 * 否则 EventEmitter 上挂的 listener 会泄漏。
 */
export function subscribeJob(
  jobId: string,
  listener: (evt: JobEvent) => void,
): () => void {
  jobEvents.on(jobId, listener);
  return () => {
    jobEvents.off(jobId, listener);
  };
}

/**
 * 订阅某个 batchId 的实时事件流 — 由 SSE handler 调用。
 *
 * 同 {@link subscribeJob} 的清理义务。
 */
export function subscribeBatch(
  batchId: string,
  listener: (evt: BatchEvent) => void,
): () => void {
  batchEvents.on(batchId, listener);
  return () => {
    batchEvents.off(batchId, listener);
  };
}

function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > MAX_AGE_MS) {
      jobs.delete(id);
    }
  }
  for (const [id, batch] of batchJobs) {
    if (now - batch.createdAt > MAX_AGE_MS) {
      batchJobs.delete(id);
    }
  }
}
