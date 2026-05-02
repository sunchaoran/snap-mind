#!/usr/bin/env node
// Install a dedicated headed Chrome as a per-user macOS LaunchAgent so the
// snap-mind backend's L2 web-fetch tier (Playwright via CDP) has a stable,
// logged-in browser to attach to. Idempotent: safe to re-run.
//
// Reasoning for the dedicated profile + 127.0.0.1-only binding:
// docs/guides/chrome-cdp.md.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import {
  assertMacOS,
  atomicWrite,
  curlProbe,
  ensureDir,
  LAUNCH_AGENTS_DIR,
  launchctlIsLoaded,
  launchctlLoad,
  launchctlUnload,
  makeLog,
  plutilLint,
  renderTemplate,
} from "./lib/launchd.mjs";

const LABEL = "dev.snap-mind.chrome";
const PLIST_NAME = `${LABEL}.plist`;
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, PLIST_NAME);
const LOG_DIR = join(process.env.HOME ?? "", "Library", "Logs", "snap-mind");
const CHROME_BIN =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const USER_DATA_DIR = join(
  process.env.HOME ?? "",
  "Library",
  "Application Support",
  "snap-mind",
  "chrome-profile",
);
const CDP_PORT = "9222";
const CDP_PROBE_URL = `http://127.0.0.1:${CDP_PORT}/json/version`;
const SCRIPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const TEMPLATE = join(SCRIPTS_DIR, "snap-mind.chrome.plist.template");

const { log, err } = makeLog("[install-chrome-launchd]");

assertMacOS({
  err,
});

if (!isExecutable(CHROME_BIN)) {
  err(`Chrome binary not found: ${CHROME_BIN}`);
  err("install Google Chrome from https://www.google.com/chrome/ and retry");
  err(
    "(if Chrome is at a non-standard path, edit CHROME_BIN at the top of this script)",
  );
  process.exit(1);
}
log(`chrome: ${CHROME_BIN}`);

if (!existsSync(TEMPLATE)) {
  err(`template not found: ${TEMPLATE}`);
  process.exit(1);
}

ensureDir(USER_DATA_DIR);
ensureDir(LOG_DIR);
ensureDir(LAUNCH_AGENTS_DIR);
log(`user-data-dir: ${USER_DATA_DIR}`);

const rendered = renderTemplate(TEMPLATE, {
  CHROME_BIN,
  USER_DATA_DIR,
  CDP_PORT,
  HOME: process.env.HOME ?? "",
});

// Validate via plutil before publishing so launchd never sees a malformed plist.
const stagingPath = `${PLIST_DEST}.staging`;
atomicWrite(stagingPath, rendered);
if (!plutilLint(stagingPath)) {
  err("rendered plist failed plutil -lint");
  err(`staging file kept at: ${stagingPath}`);
  process.exit(1);
}

if (launchctlIsLoaded(LABEL)) {
  log("agent already loaded; unloading first");
  launchctlUnload(PLIST_DEST, LABEL);
}

atomicWrite(PLIST_DEST, rendered);
// Staging file no longer needed once the real one is in place.
try {
  // best-effort cleanup; tolerate races
  await import("node:fs/promises").then(({ rm }) =>
    rm(stagingPath, {
      force: true,
    }),
  );
} catch {}
log(`wrote ${PLIST_DEST}`);

launchctlLoad(PLIST_DEST);
// Chrome cold-start needs longer than the server agent (load profile, init GPU, etc.)
await sleep(3000);

if (!launchctlIsLoaded(LABEL)) {
  err("agent not visible in `launchctl list` after load");
  err(`check logs: tail ${LOG_DIR}/chrome.err.log`);
  process.exit(1);
}
log(`agent loaded: ${LABEL}`);

log(`probing ${CDP_PROBE_URL}`);
if (!curlProbe(CDP_PROBE_URL)) {
  err(`CDP probe failed: ${CDP_PROBE_URL}`);
  err("tail logs to diagnose:");
  err(`  tail -n 50 ${LOG_DIR}/chrome.err.log`);
  err(
    `common causes: another Chrome already holds port ${CDP_PORT}, Chrome crashed on launch`,
  );
  process.exit(1);
}
log(styleText("green", "CDP OK"));

// First-install hint: profile's `Default` subdir only exists after Chrome
// completes its first-run setup, which is where logins land.
if (!existsSync(join(USER_DATA_DIR, "Default"))) {
  log("");
  log("first install detected. To populate logged-in cookies for L2 fetching:");
  log("  1. Screen Share into this Mac (or use it directly)");
  log("  2. The Chrome window managed by this LaunchAgent should be visible");
  log(
    "  3. Log into the platforms snap-mind needs (Twitter, Zhihu, Reddit, ...)",
  );
  log(
    `  4. Cookies persist in ${USER_DATA_DIR}; future launches stay logged in`,
  );
  log("");
}

log(`done. logs: ${LOG_DIR}/chrome.{log,err.log}`);

function isExecutable(path) {
  try {
    const s = statSync(path);
    return s.isFile();
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
