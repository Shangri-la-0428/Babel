#!/bin/bash
# BABEL — Quick Start / Self Update
# Usage:
#   ./start.sh
#   ./start.sh start [--no-update]
#   ./start.sh update
#   ./start.sh help

set -euo pipefail

resolve_root() {
  local source="${BASH_SOURCE[0]}"
  while [ -L "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" && pwd
}

ROOT="$(resolve_root)"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/babel"
AUTO_UPDATE_STAMP="$CACHE_DIR/last-update-check"
AUTO_UPDATE_INTERVAL_SECONDS="${BABEL_AUTO_UPDATE_INTERVAL_SECONDS:-21600}"
BACKEND_PID=""
FRONTEND_PID=""

log() {
  echo "[BABEL] $*"
}

ensure_cache_dir() {
  mkdir -p "$CACHE_DIR"
}

mark_update_check() {
  ensure_cache_dir
  date +%s > "$AUTO_UPDATE_STAMP"
}

should_check_for_updates() {
  if [ ! -f "$AUTO_UPDATE_STAMP" ]; then
    return 0
  fi

  local now last delta
  now="$(date +%s)"
  last="$(cat "$AUTO_UPDATE_STAMP" 2>/dev/null || echo 0)"
  delta=$((now - last))
  [ "$delta" -ge "$AUTO_UPDATE_INTERVAL_SECONDS" ]
}

is_git_checkout() {
  command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

has_clean_worktree() {
  [ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]
}

sync_backend_dependencies() {
  log "Syncing backend dependencies..."
  (
    cd "$ROOT/backend"
    if [ ! -d .venv ]; then
      python3 -m venv .venv
    fi
    # shellcheck disable=SC1091
    source .venv/bin/activate
    pip install -e . -q
  )
}

sync_frontend_dependencies() {
  log "Syncing frontend dependencies..."
  (
    cd "$ROOT/frontend"
    npm install --silent
  )
}

sync_dependencies_for_update() {
  local old_head="$1"
  local new_head="$2"
  local changed_files

  changed_files="$(git -C "$ROOT" diff --name-only "$old_head" "$new_head" -- \
    backend/pyproject.toml \
    frontend/package.json \
    frontend/package-lock.json \
    frontend/npm-shrinkwrap.json)"

  if echo "$changed_files" | grep -Eq '^backend/pyproject\.toml$'; then
    sync_backend_dependencies
  fi

  if echo "$changed_files" | grep -Eq '^frontend/(package\.json|package-lock\.json|npm-shrinkwrap\.json)$'; then
    sync_frontend_dependencies
  fi
}

run_self_update() {
  local force="${1:-0}"

  if ! is_git_checkout; then
    return 0
  fi

  if [ "${BABEL_AUTO_UPDATE:-1}" = "0" ] && [ "$force" != "1" ]; then
    return 0
  fi

  if [ "$force" != "1" ] && ! should_check_for_updates; then
    return 0
  fi

  local branch current_head remote_head new_head
  branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    mark_update_check
    return 0
  fi

  if ! has_clean_worktree; then
    log "Auto-update skipped: local changes detected."
    mark_update_check
    return 0
  fi

  log "Checking for updates..."
  current_head="$(git -C "$ROOT" rev-parse HEAD)"

  if ! GIT_TERMINAL_PROMPT=0 git -C "$ROOT" fetch --quiet origin "$branch"; then
    log "Update check skipped: remote unavailable."
    mark_update_check
    return 0
  fi

  remote_head="$(git -C "$ROOT" rev-parse "origin/$branch" 2>/dev/null || true)"
  if [ -z "$remote_head" ] || [ "$remote_head" = "$current_head" ]; then
    mark_update_check
    return 0
  fi

  if ! git -C "$ROOT" merge-base --is-ancestor "$current_head" "$remote_head"; then
    log "Auto-update skipped: local branch diverged from origin/$branch."
    mark_update_check
    return 0
  fi

  log "Updating BABEL..."
  if ! GIT_TERMINAL_PROMPT=0 git -C "$ROOT" pull --ff-only --quiet origin "$branch"; then
    log "Update failed. Continuing with the current version."
    mark_update_check
    return 0
  fi

  new_head="$(git -C "$ROOT" rev-parse HEAD)"
  sync_dependencies_for_update "$current_head" "$new_head"
  mark_update_check
  log "Updated to $(git -C "$ROOT" rev-parse --short HEAD)."
}

cleanup() {
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

start_backend() {
  log "Starting backend..."
  cd "$ROOT/backend"
  if [ ! -d .venv ]; then
    python3 -m venv .venv
    # shellcheck disable=SC1091
    source .venv/bin/activate
    pip install -e . -q
  else
    # shellcheck disable=SC1091
    source .venv/bin/activate
  fi
  uvicorn babel.api:app --host 127.0.0.1 --port 8000 &
  BACKEND_PID=$!
}

start_frontend() {
  log "Starting frontend..."
  cd "$ROOT/frontend"
  if [ ! -d node_modules ]; then
    npm install --silent
  fi
  npx next dev --port 3000 &
  FRONTEND_PID=$!
}

kill_previous_instances() {
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  lsof -ti:8000 | xargs kill -9 2>/dev/null || true
}

open_browser() {
  sleep 3
  open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true
}

print_help() {
  cat <<'EOF'
BABEL

Usage:
  babel
  babel start [--no-update]
  babel update
  babel help

Behavior:
  - Running `babel` checks for updates automatically when the local checkout is clean.
  - Auto-update is skipped when local changes exist, the branch diverged, or the remote is unavailable.
  - `babel update` forces an immediate update check without starting the app.
  - Set `BABEL_AUTO_UPDATE=0` to disable automatic update checks.
EOF
}

main() {
  local command="start"
  local skip_auto_update=0

  if [ $# -gt 0 ]; then
    case "$1" in
      start)
        command="start"
        shift
        ;;
      update)
        command="update"
        shift
        ;;
      help|-h|--help)
        print_help
        exit 0
        ;;
    esac
  fi

  while [ $# -gt 0 ]; do
    case "$1" in
      --no-update)
        skip_auto_update=1
        ;;
      help|-h|--help)
        print_help
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        print_help
        exit 1
        ;;
    esac
    shift
  done

  cd "$ROOT"

  if [ "$command" = "update" ]; then
    run_self_update 1
    exit 0
  fi

  if [ "$skip_auto_update" != "1" ]; then
    run_self_update 0
  fi

  kill_previous_instances
  start_backend
  start_frontend
  open_browser

  echo ""
  log "Running at http://localhost:3000"
  log "Press Ctrl+C to stop."

  trap cleanup EXIT
  wait
}

main "$@"
