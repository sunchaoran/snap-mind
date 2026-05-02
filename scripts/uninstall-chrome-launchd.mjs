#!/usr/bin/env node
// Uninstall the snap-mind Chrome LaunchAgent. Idempotent.
// Does NOT delete the Chrome user-data-dir (login cookies); remove it
// manually if you really want a clean slate.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertMacOS,
  LAUNCH_AGENTS_DIR,
  launchctlIsLoaded,
  launchctlUnload,
  makeLog,
} from "./lib/launchd.mjs";

const LABEL = "dev.snap-mind.chrome";
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);
const USER_DATA_DIR = join(
  process.env.HOME ?? "",
  "Library",
  "Application Support",
  "snap-mind",
  "chrome-profile",
);

const { log, err } = makeLog("[uninstall-chrome-launchd]");

assertMacOS({
  err,
});

if (existsSync(PLIST_DEST)) {
  log(`unloading ${PLIST_DEST}`);
  launchctlUnload(PLIST_DEST, LABEL);
  rmSync(PLIST_DEST, {
    force: true,
  });
  log(`removed ${PLIST_DEST}`);
} else {
  log(`no plist at ${PLIST_DEST} (already removed?)`);
  if (launchctlIsLoaded(LABEL)) {
    log(`agent still registered under label ${LABEL}; removing by label`);
    launchctlUnload(PLIST_DEST, LABEL);
  }
}

if (launchctlIsLoaded(LABEL)) {
  err(`agent ${LABEL} still appears in \`launchctl list\``);
  err(`try manually: launchctl remove ${LABEL}`);
  process.exit(1);
}

if (existsSync(USER_DATA_DIR)) {
  log(`Chrome profile preserved at: ${USER_DATA_DIR}`);
  log("(contains login cookies — delete manually if you want a clean slate)");
}

log("done");
