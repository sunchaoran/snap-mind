#!/usr/bin/env bash
# Install snap-mind server as a per-user macOS LaunchAgent.
# Idempotent: safe to re-run for upgrades.

set -euo pipefail

LABEL="dev.snap-mind.server"
PLIST_NAME="${LABEL}.plist"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_DEST="${LAUNCH_AGENTS_DIR}/${PLIST_NAME}"
LOG_DIR="${HOME}/Library/Logs/snap-mind"
HEALTH_URL="http://127.0.0.1:3210/health"
PREFIX="[install-launchd]"

log() { printf '%s %s\n' "$PREFIX" "$*"; }
err() { printf '%s ERROR: %s\n' "$PREFIX" "$*" >&2; }

# Escape for use as `sed` replacement RHS: backslash, ampersand, and the chosen
# delimiter `/` need escaping. Spaces are safe.
sed_escape() {
  printf '%s' "$1" | sed -e 's/[\\&/]/\\&/g'
}

# 1. macOS check
if [[ "$(uname -s)" != "Darwin" ]]; then
  err "this script only supports macOS (got $(uname -s))"
  err "for Linux/NAS see deployment.md §2 (Docker, V2 planned)"
  exit 1
fi

# 2. Node ≥ 24 check
if ! command -v node >/dev/null 2>&1; then
  err "node not found in PATH"
  err "install Node 24+ (https://nodejs.org or via nvm) and retry"
  exit 1
fi
NODE_BIN="$(command -v node)"
NODE_VERSION_RAW="$(node --version)"           # e.g. v24.15.0
NODE_MAJOR="${NODE_VERSION_RAW#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < 24 )); then
  err "node ${NODE_VERSION_RAW} too old; need ≥ 24"
  exit 1
fi
log "node: ${NODE_BIN} (${NODE_VERSION_RAW})"

# 3. Resolve project root
if ! PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  err "not inside a git worktree; run from the snap-mind repo root"
  exit 1
fi
log "project root: ${PROJECT_ROOT}"

# 4. Build artifact check
DIST_ENTRY="${PROJECT_ROOT}/dist/index.js"
if [[ ! -f "$DIST_ENTRY" ]]; then
  err "missing build artifact: ${DIST_ENTRY}"
  err "run \`pnpm install && pnpm build\` first, then re-run this script"
  exit 1
fi

# 5. .env check (warn only)
if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
  log "WARN: ${PROJECT_ROOT}/.env not found"
  log "WARN: server will likely fail to start without API_KEY / OPENROUTER_API_KEY"
  log "WARN: see deployment.md §1.1 to create .env, then re-run"
fi

# 6. Locate template
TEMPLATE="${PROJECT_ROOT}/scripts/snap-mind.server.plist.template"
if [[ ! -f "$TEMPLATE" ]]; then
  err "template not found: ${TEMPLATE}"
  exit 1
fi

# 7. Prepare log dir + LaunchAgents dir
mkdir -p "$LOG_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"

# 8. Render plist
NODE_BIN_DIR="$(dirname "$NODE_BIN")"
SAFE_NODE_BIN="$(sed_escape "$NODE_BIN")"
SAFE_NODE_BIN_DIR="$(sed_escape "$NODE_BIN_DIR")"
SAFE_PROJECT_ROOT="$(sed_escape "$PROJECT_ROOT")"
SAFE_HOME="$(sed_escape "$HOME")"

TMP_PLIST="$(mktemp -t snap-mind-plist.XXXXXX)"
trap 'rm -f "$TMP_PLIST"' EXIT

sed \
  -e "s/__NODE_BIN__/${SAFE_NODE_BIN}/g" \
  -e "s/__NODE_BIN_DIR__/${SAFE_NODE_BIN_DIR}/g" \
  -e "s/__PROJECT_ROOT__/${SAFE_PROJECT_ROOT}/g" \
  -e "s/__HOME__/${SAFE_HOME}/g" \
  "$TEMPLATE" > "$TMP_PLIST"

# 9. Validate rendered plist
if ! plutil -lint "$TMP_PLIST" >/dev/null; then
  err "rendered plist failed plutil -lint"
  err "rendered file kept at: ${TMP_PLIST}"
  trap - EXIT
  exit 1
fi

# 10. Idempotent install: unload prior agent if present
if launchctl list | grep -q "${LABEL}\$"; then
  log "agent already loaded; unloading first"
  launchctl unload "$PLIST_DEST" 2>/dev/null || \
    launchctl remove "$LABEL" 2>/dev/null || true
fi

# 11. Move rendered plist into place
mv "$TMP_PLIST" "$PLIST_DEST"
trap - EXIT
log "wrote ${PLIST_DEST}"

# 12. Load
launchctl load "$PLIST_DEST"
sleep 1

# 13. Show PID
LIST_LINE="$(launchctl list | grep "${LABEL}\$" || true)"
if [[ -z "$LIST_LINE" ]]; then
  err "agent not visible in \`launchctl list\` after load"
  err "check logs:"
  err "  tail ${LOG_DIR}/server.err.log"
  exit 1
fi
log "agent loaded: ${LIST_LINE}"

# 14. Health probe
log "probing ${HEALTH_URL}"
if curl -fsS "$HEALTH_URL" >/dev/null; then
  log "health OK"
  log "done. logs: ${LOG_DIR}/server.{log,err.log}"
else
  err "health probe failed: ${HEALTH_URL}"
  err "tail logs to diagnose:"
  err "  tail -n 50 ${LOG_DIR}/server.err.log"
  err "  tail -n 50 ${LOG_DIR}/server.log"
  err "common causes: missing/invalid .env, port 3210 already in use, build stale"
  exit 1
fi
