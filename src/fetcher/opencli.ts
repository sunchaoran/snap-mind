import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "@/config.js";
import type { Platform } from "@/types/index.js";
import { createLogger } from "@/utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("opencli");
const platformQueues = new Map<Platform, Promise<void>>();
const platformQueueDepths = new Map<Platform, number>();

export async function runOpencli(
  platform: Platform,
  args: string[],
): Promise<unknown> {
  return enqueueByPlatform(platform, () => executeOpencli(args));
}

async function enqueueByPlatform<T>(
  platform: Platform,
  task: () => Promise<T>,
): Promise<T> {
  const previous = platformQueues.get(platform);
  const queuedBefore = platformQueueDepths.get(platform) ?? 0;
  const enqueuedAt = Date.now();
  platformQueueDepths.set(platform, queuedBefore + 1);

  const run = (previous ?? Promise.resolve()).catch(() => undefined).then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );

  platformQueues.set(platform, tail);

  log.debug(
    {
      platform,
      queued: !!previous,
      queuedBefore,
    },
    "scheduled opencli command on platform queue",
  );

  try {
    const waitMs = Date.now() - enqueuedAt;
    log.debug(
      {
        platform,
        waitMs,
        queuedBefore,
      },
      "starting opencli command from platform queue",
    );
    return await run;
  } finally {
    const remaining = Math.max((platformQueueDepths.get(platform) ?? 1) - 1, 0);
    if (remaining === 0) {
      platformQueueDepths.delete(platform);
    } else {
      platformQueueDepths.set(platform, remaining);
    }

    if (platformQueues.get(platform) === tail) {
      platformQueues.delete(platform);
    }
  }
}

async function executeOpencli(args: string[]): Promise<unknown> {
  const cmd = `opencli ${args.join(" ")}`;
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(
      config.opencli.binaryPath,
      args,
      {
        timeout: config.opencli.timeout,
        env: {
          ...process.env,
        },
      },
    );

    const elapsed = Date.now() - start;
    if (stderr?.trim()) {
      log.debug(
        {
          cmd,
          elapsed: `${elapsed}ms`,
          stderr: stderr.trim(),
        },
        "stderr output",
      );
    }

    if (!stdout.trim()) {
      throw new Error(
        `opencli returned empty stdout${stderr ? `: ${stderr.trim()}` : ""}`,
      );
    }

    log.debug(
      {
        cmd,
        elapsed: `${elapsed}ms`,
      },
      "✓ command succeeded",
    );
    return JSON.parse(stdout);
  } catch (err) {
    const elapsed = Date.now() - start;
    const e = err as Error & {
      killed?: boolean;
      signal?: string;
      stderr?: string;
    };

    // execFile sets killed=true and signal=SIGTERM when timeout triggers
    if (e.killed || e.signal === "SIGTERM") {
      throw new Error(
        `opencli timed out after ${elapsed}ms (limit: ${config.opencli.timeout}ms): ${cmd}`,
      );
    }

    // Re-throw with stderr context
    throw new Error(
      `opencli failed in ${elapsed}ms: ${e.message}${e.stderr?.trim() ? `\nstderr: ${e.stderr.trim()}` : ""}`,
    );
  }
}
