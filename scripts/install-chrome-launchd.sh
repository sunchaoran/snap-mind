#!/usr/bin/env bash
# Install a dedicated headed Chrome as a per-user macOS LaunchAgent so the
# snap-mind backend's L2 web-fetch tier (Playwright via CDP) has a stable,
# logged-in browser to attach to. Idempotent: safe to re-run.

set -euo pipefail

LABEL="dev.snap-mind.chrome"
PLIST_NAME="${LABEL}.plist"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_DEST="${LAUNCH_AGENTS_DIR}/${PLIST_NAME}"
LOG_DIR="${HOME}/Library/Logs/snap-mind"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
USER_DATA_DIR="${HOME}/Library/Application Support/snap-mind/chrome-profile"
CDP_PORT="9222"
CDP_PROBE_URL="http://127.0.0.1:${CDP_PORT}/json/version"
PREFIX="[install-chrome-launchd]"

log() { printf '%s %s\n' "$PREFIX" "$*"; }
err() { printf '%s ERROR: %s\n' "$PREFIX" "$*" >&2; }

# Escape for use as `sed` replacement RHS: backslash, ampersand, and the chosen
# delimiter `|` need escaping. Spaces are safe.
sed_escape() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

# 1. macOS check
if [[ "$(uname -s)" != "Darwin" ]]; then
  err "this script only supports macOS (got $(uname -s))"
  exit 1
fi

# 2. Chrome binary check
if [[ ! -x "$CHROME_BIN" ]]; then
  err "Chrome binary not found: ${CHROME_BIN}"
  err "install Google Chrome from https://www.google.com/chrome/ and retry"
  err "(if Chrome is at a non-standard path, edit CHROME_BIN at the top of this script)"
  exit 1
fi
log "chrome: ${CHROME_BIN}"

# 3. Resolve project root (for the template lookup)
if ! PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  err "not inside a git worktree; run from the snap-mind repo root"
  exit 1
fi

# 4. Locate template
TEMPLATE="${PROJECT_ROOT}/scripts/snap-mind.chrome.plist.template"
if [[ ! -f "$TEMPLATE" ]]; then
  err "template not found: ${TEMPLATE}"
  exit 1
fi

# 5. Prepare profile + log dirs
mkdir -p "$USER_DATA_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"
log "user-data-dir: ${USER_DATA_DIR}"

# 6. Render plist (use `|` as sed delimiter so paths containing `/` need no escaping)
SAFE_CHROME_BIN="$(sed_escape "$CHROME_BIN")"
SAFE_USER_DATA_DIR="$(sed_escape "$USER_DATA_DIR")"
SAFE_HOME="$(sed_escape "$HOME")"

TMP_PLIST="$(mktemp -t snap-mind-chrome-plist.XXXXXX)"
trap 'rm -f "$TMP_PLIST"' EXIT

sed \
  -e "s|__CHROME_BIN__|${SAFE_CHROME_BIN}|g" \
  -e "s|__USER_DATA_DIR__|${SAFE_USER_DATA_DIR}|g" \
  -e "s|__CDP_PORT__|${CDP_PORT}|g" \
  -e "s|__HOME__|${SAFE_HOME}|g" \
  "$TEMPLATE" > "$TMP_PLIST"

# 7. Validate rendered plist
if ! plutil -lint "$TMP_PLIST" >/dev/null; then
  err "rendered plist failed plutil -lint"
  err "rendered file kept at: ${TMP_PLIST}"
  trap - EXIT
  exit 1
fi

# 8. Idempotent install: unload prior agent if present
if launchctl list | grep -q "${LABEL}\$"; then
  log "agent already loaded; unloading first"
  launchctl unload "$PLIST_DEST" 2>/dev/null || \
    launchctl remove "$LABEL" 2>/dev/null || true
fi

# 9. Move rendered plist into place
mv "$TMP_PLIST" "$PLIST_DEST"
trap - EXIT
log "wrote ${PLIST_DEST}"

# 10. Load
launchctl load "$PLIST_DEST"
# Chrome cold-start needs longer than the server agent (load profile, init GPU, etc.)
sleep 3

# 11. Show PID
LIST_LINE="$(launchctl list | grep "${LABEL}\$" || true)"
if [[ -z "$LIST_LINE" ]]; then
  err "agent not visible in \`launchctl list\` after load"
  err "check logs:"
  err "  tail ${LOG_DIR}/chrome.err.log"
  exit 1
fi
log "agent loaded: ${LIST_LINE}"

# 12. CDP probe
log "probing ${CDP_PROBE_URL}"
if curl -fsS --max-time 10 "$CDP_PROBE_URL" >/dev/null; then
  log "CDP OK"
else
  err "CDP probe failed: ${CDP_PROBE_URL}"
  err "tail logs to diagnose:"
  err "  tail -n 50 ${LOG_DIR}/chrome.err.log"
  err "common causes: another Chrome already holds port ${CDP_PORT}, Chrome crashed on launch"
  exit 1
fi

# 13. First-run hint
if [[ ! -d "${USER_DATA_DIR}/Default" ]]; then
  log ""
  log "first install detected. To populate logged-in cookies for L2 fetching:"
  log "  1. Screen Share into this Mac (or use it directly)"
  log "  2. The Chrome window managed by this LaunchAgent should be visible"
  log "  3. Log into the platforms snap-mind needs (Twitter, Zhihu, Reddit, ...)"
  log "  4. Cookies persist in ${USER_DATA_DIR}; future launches stay logged in"
  log ""
fi

log "done. logs: ${LOG_DIR}/chrome.{log,err.log}"
