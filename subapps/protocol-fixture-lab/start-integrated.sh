#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
RUNTIME="$ROOT_DIR/.runtime/integrated-fixture"
FIXTURE_PORT="${PROTOCOL_FIXTURE_LAB_PORT:-${ONRE_FIXTURE_LAB_PORT:-7630}}"
WALLET_PORT="${WALLET_INSPECTOR_PORT:-7620}"
ALERT_PORT="${ALERT_CONSOLE_PORT:-7623}"
mkdir -p "$RUNTIME"

for required in \
  "$ROOT_DIR/subapps/protocol-fixture-lab/state.js" \
  "$ROOT_DIR/subapps/protocol-fixture-lab/server.js" \
  "$ROOT_DIR/subapps/alert-console/server.js" \
  "$ROOT_DIR/subapps/wallet-inspector/backend/server.js"
do
  [ -f "$required" ] || { printf 'Missing required file: %s\n' "$required" >&2; exit 1; }
done
command -v node >/dev/null 2>&1 || { printf 'Missing required command: node\n' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf 'Missing required command: curl\n' >&2; exit 1; }

stop_exact() {
  pattern="$1"
  old=$(pgrep -u "$(id -u)" -f "$pattern" || true)
  [ -z "$old" ] || kill -TERM $old 2>/dev/null || true
  i=0
  while [ "$i" -lt 50 ] && [ -n "$old" ]; do
    alive=""
    for candidate in $old; do kill -0 "$candidate" 2>/dev/null && alive=1 && break; done
    [ -z "$alive" ] && break
    i=$((i + 1)); sleep .1
  done
  [ -z "${alive:-}" ] || { printf 'Process did not stop: %s\n' "$old" >&2; exit 1; }
}
wait_health() {
  pid="$1"; url="$2"; label="$3"; log="$4"; i=0
  while [ "$i" -lt 50 ]; do
    kill -0 "$pid" 2>/dev/null || break
    curl -sf "$url" >/dev/null && return 0
    i=$((i + 1)); sleep .1
  done
  printf '%s failed. Log: %s\n' "$label" "$log" >&2
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done <"$log"
  exit 1
}

stop_exact "node .*subapps/alert-console/server\.js"
# Stop a process launched before the directory rename.
stop_exact "node .*subapps/onre-fixture-lab/server\.js"
stop_exact "node .*subapps/protocol-fixture-lab/server\.js"
stop_exact "node .*subapps/wallet-inspector/backend/server\.js"
cd "$ROOT_DIR"

: >"$RUNTIME/alert-console.log"
ALERT_CONSOLE_PORT="$ALERT_PORT" ALERT_CONSOLE_DB=":memory:" node subapps/alert-console/server.js >>"$RUNTIME/alert-console.log" 2>&1 &
alert_pid=$!; printf '%s\n' "$alert_pid" >"$RUNTIME/alert-console.pid"
wait_health "$alert_pid" "http://127.0.0.1:$ALERT_PORT/api/health" "Alert Console" "$RUNTIME/alert-console.log"

: >"$RUNTIME/fixture-lab.log"
PROTOCOL_FIXTURE_LAB_PORT="$FIXTURE_PORT" ALERT_CONSOLE_URL="http://127.0.0.1:$ALERT_PORT" node subapps/protocol-fixture-lab/server.js >>"$RUNTIME/fixture-lab.log" 2>&1 &
fixture_pid=$!; printf '%s\n' "$fixture_pid" >"$RUNTIME/fixture-lab.pid"
wait_health "$fixture_pid" "http://127.0.0.1:$FIXTURE_PORT/api/health" "Fixture Lab" "$RUNTIME/fixture-lab.log"

: >"$RUNTIME/wallet-inspector.log"
WALLET_INSPECTOR_PORT="$WALLET_PORT" FIXTURE_RPC_URL="http://127.0.0.1:$FIXTURE_PORT/rpc" node subapps/wallet-inspector/backend/server.js >>"$RUNTIME/wallet-inspector.log" 2>&1 &
wallet_pid=$!; printf '%s\n' "$wallet_pid" >"$RUNTIME/wallet-inspector.pid"
wait_health "$wallet_pid" "http://127.0.0.1:$WALLET_PORT/api/health" "Wallet Inspector" "$RUNTIME/wallet-inspector.log"

printf 'Integrated Protocol Fixture Lab stack started:\n'
printf 'Wallet Inspector: http://127.0.0.1:%s\n' "$WALLET_PORT"
printf 'Fixture Lab:     http://127.0.0.1:%s\n' "$FIXTURE_PORT"
printf 'Alert Console:   http://127.0.0.1:%s\n' "$ALERT_PORT"
printf 'Fixture holder:  4g7kC6haaE6MzUx428DRdfrgHmwo7Sj5XYAqkx4ys3Rt\n'
