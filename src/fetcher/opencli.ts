import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "@/config.js";
import { createLogger } from "@/utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("opencli");

export async function runOpencli(args: string[]): Promise<unknown> {
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
