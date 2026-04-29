import { describe, expect, test, vi } from "vitest";
import {
  batchItemDone,
  createBatchJob,
  createJob,
  type JobEvent,
  jobDone,
  jobError,
  stepDone,
  stepSkipped,
  stepStart,
  subscribeBatch,
  subscribeJob,
} from "@/server/job-store.js";
import type { ClipResponse } from "@/types/wire.js";

const SUCCESS: ClipResponse = {
  success: true,
  clipId: "clip_x",
  message: "ok",
};

const FAIL: ClipResponse = {
  success: false,
  clipId: "clip_x",
  message: "boom",
};

describe("job-store SSE event emission", () => {
  test("subscribeJob receives step / done events in order", () => {
    const id = "job_seq_1";
    createJob(id, id);

    const events: JobEvent[] = [];
    const unsub = subscribeJob(id, (e) => events.push(e));

    stepStart(id, 0, "starting");
    stepDone(id, 0, "Level 1");
    stepSkipped(id, 1, "duplicate");
    jobDone(id, SUCCESS);

    expect(events).toEqual([
      {
        type: "step",
        stepIndex: 0,
        status: "running",
        message: "starting",
      },
      {
        type: "step",
        stepIndex: 0,
        status: "done",
        message: "Level 1",
      },
      {
        type: "step",
        stepIndex: 1,
        status: "skipped",
        message: "duplicate",
      },
      {
        type: "done",
        result: SUCCESS,
      },
    ]);

    unsub();
  });

  test("subscribeJob receives error event when jobError mutator runs", () => {
    const id = "job_err_1";
    createJob(id, id);

    const fn = vi.fn();
    const unsub = subscribeJob(id, fn);

    jobError(id, FAIL);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({
      type: "error",
      result: FAIL,
    });

    unsub();
  });

  test("unsubscribeJob stops further deliveries (no listener leak)", () => {
    const id = "job_unsub_1";
    createJob(id, id);

    const fn = vi.fn();
    const unsub = subscribeJob(id, fn);
    stepStart(id, 0);
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();
    stepDone(id, 0);
    stepSkipped(id, 1);
    jobDone(id, SUCCESS);

    // Still 1 — nothing after unsub leaks through.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("subscribeBatch receives progress then terminal done snapshot", () => {
    const batchId = "batch_evt_1";
    createBatchJob(batchId, [
      "j1",
      "j2",
    ]);

    const events: Array<{
      type: string;
      completed: number;
      status: string;
    }> = [];
    const unsub = subscribeBatch(batchId, (evt) => {
      events.push({
        type: evt.type,
        completed: evt.batch.completed,
        status: evt.batch.status,
      });
    });

    batchItemDone(batchId, SUCCESS);
    batchItemDone(batchId, SUCCESS);

    expect(events).toEqual([
      {
        type: "progress",
        completed: 1,
        status: "running",
      },
      {
        type: "done",
        completed: 2,
        status: "done",
      },
    ]);

    unsub();
  });

  test("subscribeBatch terminal-error fires when all items fail", () => {
    const batchId = "batch_err_1";
    createBatchJob(batchId, [
      "j1",
    ]);

    const fn = vi.fn();
    const unsub = subscribeBatch(batchId, fn);

    batchItemDone(batchId, FAIL);

    expect(fn).toHaveBeenCalledTimes(1);
    const evt = fn.mock.calls[0][0];
    expect(evt.type).toBe("error");
    expect(evt.batch.status).toBe("error");
    expect(evt.batch.failed).toBe(1);

    unsub();
  });

  test("emit on unknown jobId is a no-op (no listener exists)", () => {
    // Should not throw, should not register a job, should not deliver to
    // any subscriber for an unrelated id.
    const fn = vi.fn();
    const unsub = subscribeJob("absent", fn);
    stepStart("absent", 0); // job doesn't exist → mutator early-returns
    expect(fn).not.toHaveBeenCalled();
    unsub();
  });
});
