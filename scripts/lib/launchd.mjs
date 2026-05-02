// Shared helpers for the per-user macOS LaunchAgent install/uninstall
// scripts. Pure stdlib — must run before `pnpm install` if necessary, so
// don't import anything outside `node:`.

import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { styleText } from "node:util";

/** Build a `[prefix] message` formatter for log lines (stdout) and errors (stderr). */
export function makeLog(prefix) {
  return {
    log: (msg) => process.stdout.write(`${prefix} ${msg}\n`),
    err: (msg) =>
      process.stderr.write(`${prefix} ${styleText("red", "ERROR")}: ${msg}\n`),
    warn: (msg) =>
      process.stdout.write(
        `${prefix} ${styleText("yellow", "WARN")}: ${msg}\n`,
      ),
  };
}

/** Hard-fail if not running on macOS. LaunchAgent / launchctl / plutil are Darwin-only. */
export function assertMacOS({ err }) {
  if (process.platform !== "darwin") {
    err(`this script only supports macOS (got ${process.platform})`);
    process.exit(1);
  }
}

/** mkdir -p */
export function ensureDir(path) {
  mkdirSync(path, {
    recursive: true,
  });
}

/**
 * Render a `__VAR__`-style template by substituting each {key,value} from `vars`.
 * No escaping — the template is plain XML and our values are filesystem paths,
 * which can't contain `<` or `&` legitimately on macOS.
 */
export function renderTemplate(templatePath, vars) {
  let body = readFileSync(templatePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    body = body.replaceAll(`__${key}__`, value);
  }
  return body;
}

/**
 * Atomically write `contents` to `dest` (write to a tmp file in the same dir,
 * then rename). Avoids a launchctl race that would see a half-written plist.
 */
export function atomicWrite(dest, contents) {
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, dest);
}

/** Validate a plist with `plutil -lint`. Returns true on success, false otherwise. */
export function plutilLint(path) {
  const r = spawnSync(
    "plutil",
    [
      "-lint",
      path,
    ],
    {
      stdio: "pipe",
    },
  );
  return r.status === 0;
}

/** True if `launchctl list` shows the given label as registered. */
export function launchctlIsLoaded(label) {
  const r = spawnSync(
    "launchctl",
    [
      "list",
    ],
    {
      stdio: "pipe",
    },
  );
  if (r.status !== 0) {
    return false;
  }
  const lines = r.stdout.toString("utf-8").split("\n");
  return lines.some((line) => line.endsWith(`\t${label}`));
}

/** `launchctl load <plist>` — throws on failure. */
export function launchctlLoad(plistPath) {
  execFileSync(
    "launchctl",
    [
      "load",
      plistPath,
    ],
    {
      stdio: "inherit",
    },
  );
}

/**
 * Best-effort `launchctl unload` followed by `launchctl remove` fallback.
 * Idempotent — never throws when the agent isn't loaded.
 */
export function launchctlUnload(plistPath, label) {
  spawnSync(
    "launchctl",
    [
      "unload",
      plistPath,
    ],
    {
      stdio: "ignore",
    },
  );
  spawnSync(
    "launchctl",
    [
      "remove",
      label,
    ],
    {
      stdio: "ignore",
    },
  );
}

/**
 * `curl` HTTP probe. Returns true if the URL responds 2xx within the timeout.
 * Uses `curl` (not Node's fetch) so the tool stack matches what the rest of the
 * deploy story uses, and keeps `node --max-old-space-size`-free.
 */
export function curlProbe(url, { timeoutSec = 10 } = {}) {
  const r = spawnSync(
    "curl",
    [
      "-fsS",
      "--max-time",
      String(timeoutSec),
      url,
    ],
    {
      stdio: "ignore",
    },
  );
  return r.status === 0;
}

/** Make a tempdir scoped to this run; returns its path. Caller deletes when done. */
export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** rm -rf, ignore-missing. Convenience wrapper to keep call sites tidy. */
export function rmrf(path) {
  rmSync(path, {
    recursive: true,
    force: true,
  });
}

/** Path the install scripts mount their plists under. */
export const LAUNCH_AGENTS_DIR = join(
  process.env.HOME ?? "",
  "Library",
  "LaunchAgents",
);
