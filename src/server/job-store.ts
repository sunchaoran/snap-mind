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

function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > MAX_AGE_MS) {
      jobs.delete(id);
    }
  }
}
