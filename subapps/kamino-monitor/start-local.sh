#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
PORT="${PORT:-7650}"
RUNTIME="$ROOT_DIR/.runtime/kamino-monitor"
LOG="$RUNTIME/server.log"
PIDFILE="$RUNTIME/server.pid"
mkdir -p "$RUNTIME"
stop_pattern(){
  pattern="$1"
  pids=$(pgrep -u "$(id -u)" -f "$pattern" || true)
  [ -z "$pids" ] || kill $pids 2>/dev/null || true
}
stop_pattern "node .*subapps/kamino-monitor/server\\.js"
# Replace only an existing Kamino process. Never touch the simulation port/app.
for pid in $(fuser "$PORT/tcp" 2>/dev/null || true); do
  [ "$(stat -c %u "/proc/$pid" 2>/dev/null || printf x)" = "$(id -u)" ] || continue
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  case "$cwd" in
    "$ROOT_DIR/subapps/kamino-monitor") kill "$pid" 2>/dev/null || true ;;
    *) printf 'Port %s is owned by unrelated PID %s (%s); refusing to stop it.\n' "$PORT" "$pid" "$cwd" >&2; exit 1 ;;
  esac
done
i=0
while [ "$i" -lt 30 ] && fuser "$PORT/tcp" >/dev/null 2>&1; do i=$((i+1)); sleep 0.1; done
: > "$LOG"
PORT="$PORT" node "$ROOT_DIR/subapps/kamino-monitor/server.js" >>"$LOG" 2>&1 &
pid=$!
printf '%s\n' "$pid" > "$PIDFILE"
i=0
while [ "$i" -lt 80 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then printf 'Kamino Monitor failed. Log: %s\n' "$LOG" >&2; sed -n '1,120p' "$LOG" >&2; exit 1; fi
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then printf 'Kamino production wallet app: http://127.0.0.1:%s/#\nPID: %s\nLog: %s\n' "$PORT" "$pid" "$LOG"; exit 0; fi
  i=$((i+1)); sleep 0.1
done
printf 'Kamino Monitor health timeout. Log: %s\n' "$LOG" >&2
kill "$pid" 2>/dev/null || true
exit 1
