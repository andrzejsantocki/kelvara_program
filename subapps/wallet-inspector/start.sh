#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
SERVER="$ROOT_DIR/subapps/wallet-inspector/backend/server.js"
RUNTIME_DIR="$ROOT_DIR/.runtime/wallet-inspector"
PID_FILE="$RUNTIME_DIR/server.pid"
LOG_FILE="$RUNTIME_DIR/server.log"
PORT="${WALLET_INSPECTOR_PORT:-7620}"

mkdir -p "$RUNTIME_DIR"

# Stop only current-user processes running this exact server file.
old_pids=$(pgrep -u "$(id -u)" -f "node .*subapps/wallet-inspector/backend/server\.js" || true)
if [ -n "$old_pids" ]; then
  # shellcheck disable=SC2086
  kill -TERM $old_pids 2>/dev/null || true
  attempts=0
  while [ "$attempts" -lt 20 ]; do
    alive=""
    for old_pid in $old_pids; do
      if kill -0 "$old_pid" 2>/dev/null; then alive="$alive $old_pid"; fi
    done
    [ -z "$alive" ] && break
    attempts=$((attempts + 1))
    sleep 0.1
  done
  for old_pid in $old_pids; do kill -KILL "$old_pid" 2>/dev/null || true; done
fi

rm -f "$PID_FILE"
cd "$ROOT_DIR"
WALLET_INSPECTOR_PORT="$PORT" node "$SERVER" >>"$LOG_FILE" 2>&1 &
pid=$!
printf '%s\n' "$pid" >"$PID_FILE"

attempts=0
while [ "$attempts" -lt 50 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'Wallet Inspector failed to start. Log: %s\n' "$LOG_FILE" >&2
    exit 1
  fi
  if curl --silent --fail --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    printf 'Wallet Inspector started: http://127.0.0.1:%s (PID %s)\n' "$PORT" "$pid"
    printf 'Log: %s\n' "$LOG_FILE"
    exit 0
  fi
  attempts=$((attempts + 1))
  sleep 0.1
done

kill -TERM "$pid" 2>/dev/null || true
printf 'Wallet Inspector did not become healthy. Log: %s\n' "$LOG_FILE" >&2
exit 1
