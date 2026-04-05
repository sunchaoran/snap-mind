import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export async function runOpencli(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync(config.opencli.binaryPath, args, {
    timeout: config.opencli.timeout,
    env: { ...process.env },
  });
  return JSON.parse(stdout);
}
