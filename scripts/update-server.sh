#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${1:-main}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
DB_FILE="$BACKEND_DIR/data/xyzw.db"
TIMESTAMP="$(date +%F-%H%M%S)"
NODE_BUILD_HEAP_MB="${NODE_BUILD_HEAP_MB:-1536}"
PM2_APP_NAME="${PM2_APP_NAME:-xyzw-backend}"
BACKUP_KEEP_COUNT="${BACKUP_KEEP_COUNT:-5}"

log() {
  printf '\n[%s] %s\n' "$(date '+%F %T')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd git
require_cmd node
require_cmd corepack

if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" ]]; then
  echo "Please run this script inside the project checkout." >&2
  exit 1
fi

cd "$ROOT_DIR"

log "Project root: $ROOT_DIR"
log "Target branch: $BRANCH"

if [[ -f "$DB_FILE" ]]; then
  backup_file="${DB_FILE}.deploy-${TIMESTAMP}.bak"
  log "Backing up database -> $backup_file"
  cp -p "$DB_FILE" "$backup_file"
else
  log "Database file not found, skipping backup: $DB_FILE"
fi

log "Pruning old database backups (keep newest ${BACKUP_KEEP_COUNT})"
python3 - "$BACKEND_DIR/data" "$BACKUP_KEEP_COUNT" <<'PY'
from pathlib import Path
import sys

data_dir = Path(sys.argv[1])
keep_count = int(sys.argv[2])
patterns = [
    "xyzw.db*.bak",
    "xyzw.db.bak-*",
    "xyzw.db.before-vacuum-*",
    "xyzw.db.bad-now-*",
    "xyzw.db.corrupt-*",
]

files = []
seen = set()
for pattern in patterns:
    for path in data_dir.glob(pattern):
        if path.is_file() and path.name not in seen:
            seen.add(path.name)
            files.append(path)

files.sort(key=lambda path: path.stat().st_mtime, reverse=True)
keep = files[:keep_count]
remove = files[keep_count:]

print("Keeping:")
for path in keep:
    print(f"  {path.name}")

if remove:
    print("Removing:")
    for path in remove:
      print(f"  {path.name}")
      path.unlink()
else:
    print("No old backups to remove.")
PY

log "Fetching latest code"
git fetch "$REMOTE_NAME" "$BRANCH"
git reset --hard "$REMOTE_NAME/$BRANCH"

log "Current commit: $(git rev-parse --short HEAD)"

log "Activating pnpm via corepack"
corepack enable >/dev/null 2>&1 || true
PNPM_CMD=(corepack pnpm)
"${PNPM_CMD[@]}" -v

log "Installing backend dependencies"
cd "$BACKEND_DIR"
"${PNPM_CMD[@]}" install --frozen-lockfile

log "Installing frontend dependencies"
cd "$FRONTEND_DIR"
"${PNPM_CMD[@]}" install --frozen-lockfile

log "Building frontend with NODE_OPTIONS=--max-old-space-size=${NODE_BUILD_HEAP_MB}"
NODE_OPTIONS="--max-old-space-size=${NODE_BUILD_HEAP_MB}" "${PNPM_CMD[@]}" build

cd "$ROOT_DIR"

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    log "Restarting existing PM2 app: $PM2_APP_NAME"
    pm2 restart "$PM2_APP_NAME"
  else
    log "Starting PM2 app from ecosystem.config.cjs"
    pm2 start ecosystem.config.cjs
  fi

  log "PM2 status"
  pm2 list
else
  log "pm2 not found, skipping restart"
fi

if command -v curl >/dev/null 2>&1; then
  log "Health check"
  curl -fsS http://127.0.0.1:3001/api/health
  printf '\n'
fi

log "Update completed successfully"
