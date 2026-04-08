import { describe, expect, it } from "vitest";
import {
  createJob,
  getJob,
  jobDone,
  jobError,
  stepDone,
  stepError,
  stepSkipped,
  stepStart,
} from "@/server/job-store.js";

describe("job-store", () => {
  it("creates a job with 7 pending steps", () => {
    const job = createJob("test-job-1", "clip-1");
    expect(job.id).toBe("test-job-1");
    expect(job.clipId).toBe("clip-1");
    expect(job.status).toBe("running");
    expect(job.steps).toHaveLength(7);
    expect(job.steps.every((s) => s.status === "pending")).toBe(true);
    expect(job.currentStep).toBe(-1);
  });

  it("retrieves a created job", () => {
    createJob("test-job-2", "clip-2");
    const job = getJob("test-job-2");
    expect(job).toBeDefined();
    expect(job?.clipId).toBe("clip-2");
  });

  it("returns undefined for non-existent job", () => {
    expect(getJob("non-existent")).toBeUndefined();
  });

  it("tracks step lifecycle: start → done", () => {
    createJob("test-job-3", "clip-3");
    stepStart("test-job-3", 0, "分析中...");
    let job = getJob("test-job-3")!;
    expect(job.steps[0].status).toBe("running");
    expect(job.steps[0].message).toBe("分析中...");
    expect(job.currentStep).toBe(0);

    stepDone("test-job-3", 0, "完成");
    job = getJob("test-job-3")!;
    expect(job.steps[0].status).toBe("done");
    expect(job.steps[0].message).toBe("完成");
  });

  it("tracks step error", () => {
    createJob("test-job-4", "clip-4");
    stepStart("test-job-4", 0);
    stepError("test-job-4", 0, "VLM timeout");
    const job = getJob("test-job-4")!;
    expect(job.steps[0].status).toBe("error");
    expect(job.steps[0].message).toBe("VLM timeout");
  });

  it("tracks step skipped", () => {
    createJob("test-job-5", "clip-5");
    stepSkipped("test-job-5", 1, "已存在");
    const job = getJob("test-job-5")!;
    expect(job.steps[1].status).toBe("skipped");
  });

  it("marks job as done with result", () => {
    createJob("test-job-6", "clip-6");
    const result = {
      success: true as const,
      clipId: "clip-6",
      message: "已收藏",
    };
    jobDone("test-job-6", result);
    const job = getJob("test-job-6")!;
    expect(job.status).toBe("done");
    expect(job.result).toEqual(result);
  });

  it("marks job as error with error message", () => {
    createJob("test-job-7", "clip-7");
    const result = {
      success: false as const,
      clipId: "clip-7",
      error: "Pipeline failed",
      message: "处理失败",
    };
    jobError("test-job-7", result, "Timeout after 60s");
    const job = getJob("test-job-7")!;
    expect(job.status).toBe("error");
    expect(job.error).toBe("Timeout after 60s");
  });

  it("handles operations on non-existent jobs gracefully", () => {
    // These should not throw
    stepStart("nope", 0);
    stepDone("nope", 0);
    stepError("nope", 0);
    stepSkipped("nope", 0);
    jobDone("nope", { success: true, clipId: "x", message: "" });
    jobError("nope", { success: false, clipId: "x", message: "" });
  });
});
