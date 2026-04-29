import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  _getDebounceMs,
  _resetForTests,
  getStickySnapshot,
  markStickyDone,
  pushToSticky,
  registerCommitHandler,
  StickyError,
} from "@/server/sticky-store.js";

const FAKE_BUF = Buffer.from([
  0x89,
  0x50,
]);

describe("sticky-store", () => {
  beforeEach(() => {
    _resetForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("first push creates a buffering session", () => {
    registerCommitHandler(() => "batch_x");
    const r = pushToSticky("s1", FAKE_BUF);
    expect(r).toEqual({
      sessionId: "s1",
      queueDepth: 1,
      status: "buffering",
    });
    expect(getStickySnapshot("s1")).toMatchObject({
      sessionId: "s1",
      status: "buffering",
      queueDepth: 1,
      batchId: null,
    });
  });

  test("subsequent pushes append and report cumulative depth", () => {
    registerCommitHandler(() => "batch_x");
    pushToSticky("s1", FAKE_BUF);
    pushToSticky("s1", FAKE_BUF);
    const r = pushToSticky("s1", FAKE_BUF);
    expect(r.queueDepth).toBe(3);
  });

  test("debounce timer fires commitHandler after silence window", () => {
    const commit = vi.fn(() => "batch_abc");
    registerCommitHandler(commit);

    pushToSticky("s1", FAKE_BUF);
    pushToSticky("s1", FAKE_BUF);

    // Not yet
    vi.advanceTimersByTime(_getDebounceMs() - 1);
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("s1", [
      FAKE_BUF,
      FAKE_BUF,
    ]);

    const snapshot = getStickySnapshot("s1");
    expect(snapshot?.status).toBe("processing");
    expect(snapshot?.batchId).toBe("batch_abc");
  });

  test("each push resets the debounce timer", () => {
    const commit = vi.fn(() => "batch_x");
    registerCommitHandler(commit);

    pushToSticky("s1", FAKE_BUF);
    vi.advanceTimersByTime(_getDebounceMs() - 100);

    pushToSticky("s1", FAKE_BUF); // resets timer
    vi.advanceTimersByTime(_getDebounceMs() - 100);
    expect(commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test("different sessions are isolated", () => {
    const commits: Array<
      [
        string,
        number,
      ]
    > = [];
    registerCommitHandler((sessionId, buffers) => {
      commits.push([
        sessionId,
        buffers.length,
      ]);
      return `batch_${sessionId}`;
    });

    pushToSticky("a", FAKE_BUF);
    pushToSticky("b", FAKE_BUF);
    pushToSticky("b", FAKE_BUF);

    vi.advanceTimersByTime(_getDebounceMs());
    expect(commits.sort()).toEqual([
      [
        "a",
        1,
      ],
      [
        "b",
        2,
      ],
    ]);
  });

  test("pushing to a processing session throws wrong_state", () => {
    registerCommitHandler(() => "batch_x");
    pushToSticky("s1", FAKE_BUF);
    vi.advanceTimersByTime(_getDebounceMs());

    expect(() => pushToSticky("s1", FAKE_BUF)).toThrow(StickyError);
    try {
      pushToSticky("s1", FAKE_BUF);
    } catch (err) {
      expect((err as StickyError).stickyCode).toBe("wrong_state");
    }
  });

  test("pushing past maxBatchSize throws batch_full", () => {
    registerCommitHandler(() => "batch_x");
    // src/config.ts default maxBatchSize is 20 (capped via Math.min).
    for (let i = 0; i < 20; i++) {
      pushToSticky("s1", FAKE_BUF);
    }
    expect(() => pushToSticky("s1", FAKE_BUF)).toThrow(StickyError);
    try {
      pushToSticky("s1", FAKE_BUF);
    } catch (err) {
      expect((err as StickyError).stickyCode).toBe("batch_full");
    }
  });

  test("commit without registered handler throws no_handler", () => {
    // intentionally do not register a handler
    pushToSticky("s1", FAKE_BUF);
    expect(() => vi.advanceTimersByTime(_getDebounceMs())).toThrow(StickyError);
  });

  test("getStickySnapshot returns null for unknown session", () => {
    expect(getStickySnapshot("nope")).toBeNull();
  });

  test("markStickyDone advances processing → done; idempotent on others", () => {
    registerCommitHandler(() => "batch_x");
    pushToSticky("s1", FAKE_BUF);

    // buffering → markDone is a no-op
    markStickyDone("s1");
    expect(getStickySnapshot("s1")?.status).toBe("buffering");

    vi.advanceTimersByTime(_getDebounceMs());
    expect(getStickySnapshot("s1")?.status).toBe("processing");

    markStickyDone("s1");
    expect(getStickySnapshot("s1")?.status).toBe("done");

    // calling again is harmless
    markStickyDone("s1");
    expect(getStickySnapshot("s1")?.status).toBe("done");
  });
});
