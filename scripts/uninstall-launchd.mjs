#!/usr/bin/env node
// Uninstall the snap-mind LaunchAgent. Idempotent.

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  assertMacOS,
  LAUNCH_AGENTS_DIR,
  launchctlIsLoaded,
  launchctlUnload,
  makeLog,
} from "./lib/launchd.mjs";

const LABEL = "dev.snap-mind.server";
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);

const { log, err } = makeLog("[uninstall-launchd]");

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

log("done");
