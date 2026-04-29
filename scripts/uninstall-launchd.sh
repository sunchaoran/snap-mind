#!/usr/bin/env bash
# Uninstall the snap-mind LaunchAgent. Idempotent.

set -euo pipefail

LABEL="dev.snap-mind.server"
PLIST_NAME="${LABEL}.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
PREFIX="[uninstall-launchd]"

log() { printf '%s %s\n' "$PREFIX" "$*"; }
err() { printf '%s ERROR: %s\n' "$PREFIX" "$*" >&2; }

# 1. macOS check
if [[ "$(uname -s)" != "Darwin" ]]; then
  err "this script only supports macOS (got $(uname -s))"
  exit 1
fi

# 2. Try plist-based unload first
if [[ -f "$PLIST_DEST" ]]; then
  log "unloading ${PLIST_DEST}"
  launchctl unload "$PLIST_DEST" 2>/dev/null || \
    log "WARN: \`launchctl unload\` failed (agent may not have been loaded)"
  rm -f "$PLIST_DEST"
  log "removed ${PLIST_DEST}"
else
  log "no plist at ${PLIST_DEST} (already removed?)"
  # Plist gone but agent may still be registered: fall back to remove-by-label
  if launchctl list | grep -q "${LABEL}\$"; then
    log "agent still registered under label ${LABEL}; removing by label"
    launchctl remove "$LABEL" 2>/dev/null || \
      err "WARN: \`launchctl remove ${LABEL}\` failed"
  fi
fi

# 3. Verify gone
if launchctl list | grep -q "${LABEL}\$"; then
  err "agent ${LABEL} still appears in \`launchctl list\`"
  err "try manually: launchctl remove ${LABEL}"
  exit 1
fi

log "done"
