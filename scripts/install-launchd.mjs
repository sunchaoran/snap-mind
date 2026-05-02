#!/usr/bin/env node
// Install snap-mind server as a per-user macOS LaunchAgent.
// Idempotent: safe to re-run for upgrades.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
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

const LABEL = "dev.snap-mind.server";
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);
const LOG_DIR = join(process.env.HOME ?? "", "Library", "Logs", "snap-mind");
const HEALTH_URL = "http://127.0.0.1:3210/health";
const REQUIRED_NODE_MAJOR = 24;

const { log, err, warn } = makeLog("[install-launchd]");

assertMacOS({
  err,
});

// 1. Node version check (this script is itself running on Node, so we can
//    just inspect process.versions instead of shelling out)
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  err(`node v${process.versions.node} too old; need ≥ ${REQUIRED_NODE_MAJOR}`);
  process.exit(1);
}
const nodeBin = process.execPath;
log(`node: ${nodeBin} (v${process.versions.node})`);

// 2. Resolve project root via git
let projectRoot;
try {
  projectRoot = execFileSync(
    "git",
    [
      "rev-parse",
      "--show-toplevel",
    ],
    {
      encoding: "utf-8",
    },
  ).trim();
} catch {
  err("not inside a git worktree; run from the snap-mind repo root");
  process.exit(1);
}
log(`project root: ${projectRoot}`);

// 3. Build artifact check — server LaunchAgent runs `node dist/index.js`
const distEntry = join(projectRoot, "dist", "index.js");
if (!existsSync(distEntry)) {
  err(`missing build artifact: ${distEntry}`);
  err("run `pnpm install && pnpm build` first, then re-run this script");
  process.exit(1);
}

// 4. .env check — warn only; absent .env doesn't block install but the server
//    will crash on startup without API_KEY etc.
if (!existsSync(join(projectRoot, ".env"))) {
  warn(`${projectRoot}/.env not found`);
  warn("server will likely fail to start without API_KEY / OPENROUTER_API_KEY");
  warn("see deployment.md §1.1 to create .env, then re-run");
}

// 5. Locate template (sibling to this script)
const SCRIPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const TEMPLATE = join(SCRIPTS_DIR, "snap-mind.server.plist.template");
if (!existsSync(TEMPLATE)) {
  err(`template not found: ${TEMPLATE}`);
  process.exit(1);
}

ensureDir(LOG_DIR);
ensureDir(LAUNCH_AGENTS_DIR);

// 6. Render plist
const rendered = renderTemplate(TEMPLATE, {
  NODE_BIN: nodeBin,
  NODE_BIN_DIR: dirname(nodeBin),
  PROJECT_ROOT: projectRoot,
  HOME: process.env.HOME ?? "",
});

// 7. Validate via plutil before publishing
const stagingPath = `${PLIST_DEST}.staging`;
atomicWrite(stagingPath, rendered);
if (!plutilLint(stagingPath)) {
  err("rendered plist failed plutil -lint");
  err(`staging file kept at: ${stagingPath}`);
  process.exit(1);
}

// 8. Idempotent: unload prior agent if loaded
if (launchctlIsLoaded(LABEL)) {
  log("agent already loaded; unloading first");
  launchctlUnload(PLIST_DEST, LABEL);
}

// 9. Move rendered plist into final destination
atomicWrite(PLIST_DEST, rendered);
try {
  const { rmSync } = await import("node:fs");
  rmSync(stagingPath, {
    force: true,
  });
} catch {
  // tolerate races; the staging file is harmless
}
log(`wrote ${PLIST_DEST}`);

// 10. Load
launchctlLoad(PLIST_DEST);
await sleep(1000);

if (!launchctlIsLoaded(LABEL)) {
  err("agent not visible in `launchctl list` after load");
  err(`check logs: tail ${LOG_DIR}/server.err.log`);
  process.exit(1);
}
log(`agent loaded: ${LABEL}`);

// 11. Health probe
log(`probing ${HEALTH_URL}`);
if (curlProbe(HEALTH_URL)) {
  log(styleText("green", "health OK"));
  log(`done. logs: ${LOG_DIR}/server.{log,err.log}`);
} else {
  err(`health probe failed: ${HEALTH_URL}`);
  err("tail logs to diagnose:");
  err(`  tail -n 50 ${LOG_DIR}/server.err.log`);
  err(`  tail -n 50 ${LOG_DIR}/server.log`);
  err(
    "common causes: missing/invalid .env, port 3210 already in use, build stale",
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
