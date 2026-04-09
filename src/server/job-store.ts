import type { ClipResponse } from "@/types/index.js";

export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface JobStep {
  name: string;
  status: StepStatus;
  message?: string;
}

export type JobStatus = "running" | "done" | "error";

export interface Job {
  id: string;
  clipId: string;
  status: JobStatus;
  steps: JobStep[];
  currentStep: number;
  result?: ClipResponse;
  createdAt: number;
}

export interface BatchJob {
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
}

export function jobDone(jobId: string, result: ClipResponse) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = "done";
  job.result = result;
}

export function jobError(jobId: string, result: ClipResponse) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = "error";
  job.result = result;
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
