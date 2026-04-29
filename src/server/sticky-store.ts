import { config } from "@/config.js";

const DEBOUNCE_MS = 5000;
const TTL_MS = 30 * 60 * 1000;

export type StickyStatus = "buffering" | "processing" | "done";

interface StickySession {
  sessionId: string;
  buffers: Buffer[];
  debounceTimer: NodeJS.Timeout | null;
  status: StickyStatus;
  batchId: string | null;
  createdAt: number;
}

export interface StickySnapshot {
  sessionId: string;
  status: StickyStatus;
  queueDepth: number;
  batchId: string | null;
}

export class StickyError extends Error {
  constructor(
    public readonly code:
      | "wrong_state"
      | "batch_full"
      | "no_handler"
      | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "StickyError";
  }
}

type CommitHandler = (sessionId: string, buffers: Buffer[]) => string;

const sessions = new Map<string, StickySession>();
let commitHandler: CommitHandler | null = null;

export function registerCommitHandler(handler: CommitHandler): void {
  commitHandler = handler;
}

export function pushToSticky(
  sessionId: string,
  buffer: Buffer,
): {
  sessionId: string;
  queueDepth: number;
  status: StickyStatus;
} {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      buffers: [],
      debounceTimer: null,
      status: "buffering",
      batchId: null,
      createdAt: Date.now(),
    };
    sessions.set(sessionId, session);
  }

  if (session.status !== "buffering") {
    throw new StickyError(
      "wrong_state",
      `Session ${sessionId} is no longer buffering (current: ${session.status})`,
    );
  }

  if (session.buffers.length >= config.processing.maxBatchSize) {
    throw new StickyError(
      "batch_full",
      `Session ${sessionId} reached max batch size (${config.processing.maxBatchSize})`,
    );
  }

  session.buffers.push(buffer);

  if (session.debounceTimer) {
    clearTimeout(session.debounceTimer);
  }
  session.debounceTimer = setTimeout(() => {
    commitSession(sessionId);
  }, DEBOUNCE_MS);

  return {
    sessionId,
    queueDepth: session.buffers.length,
    status: "buffering",
  };
}

export function getStickySnapshot(sessionId: string): StickySnapshot | null {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }
  return {
    sessionId,
    status: session.status,
    queueDepth: session.buffers.length,
    batchId: session.batchId,
  };
}

/**
 * Marks a session as 'done'. Called by the routes layer once it observes
 * the underlying batch has finished (via getBatchJob). Idempotent.
 */
export function markStickyDone(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session && session.status === "processing") {
    session.status = "done";
  }
}

function commitSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "buffering") {
    return;
  }
  if (session.buffers.length === 0) {
    return;
  }
  if (!commitHandler) {
    throw new StickyError(
      "no_handler",
      "Sticky commit handler not registered — call registerCommitHandler() at startup",
    );
  }

  session.debounceTimer = null;
  session.status = "processing";
  session.batchId = commitHandler(sessionId, session.buffers);
}

const cleanupInterval = setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) {
      if (session.debounceTimer) {
        clearTimeout(session.debounceTimer);
      }
      sessions.delete(id);
    }
  }
}, 60 * 1000);
cleanupInterval.unref();

// ─── Test-only helpers ──────────────────────────────────────────────
// Avoid leaking module state across test files.

/** @internal */
export function _resetForTests(): void {
  for (const session of sessions.values()) {
    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
    }
  }
  sessions.clear();
  commitHandler = null;
}

/** @internal */
export function _getDebounceMs(): number {
  return DEBOUNCE_MS;
}
