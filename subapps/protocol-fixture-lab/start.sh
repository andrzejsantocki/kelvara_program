#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
RUNTIME="$ROOT_DIR/.runtime/protocol-fixture-lab"
PORT="${PROTOCOL_FIXTURE_LAB_PORT:-${ONRE_FIXTURE_LAB_PORT:-7630}}"
SERVER="$ROOT_DIR/subapps/protocol-fixture-lab/server.js"
mkdir -p "$RUNTIME"

old=$(pgrep -u "$(id -u)" -f "node .*subapps/(onre|protocol)-fixture-lab/server\\.js" || true)
if [ -n "$old" ]; then
  kill -TERM $old 2>/dev/null || true
  i=0
  while [ "$i" -lt 50 ]; do
    alive=""
    for candidate in $old; do
      if kill -0 "$candidate" 2>/dev/null; then alive=1; break; fi
    done
    [ -z "$alive" ] && break
    i=$((i + 1)); sleep .1
  done
  if [ -n "${alive:-}" ]; then
    printf 'Existing Protocol Fixture Lab did not stop: PID(s) %s\n' "$old" >&2
    exit 1
  fi
fi

cd "$ROOT_DIR"
: >"$RUNTIME/server.log"
PROTOCOL_FIXTURE_LAB_PORT="$PORT" node "$SERVER" >>"$RUNTIME/server.log" 2>&1 &
pid=$!
printf '%s\n' "$pid" >"$RUNTIME/server.pid"

i=0
while [ "$i" -lt 50 ]; do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    sleep .1
    if kill -0 "$pid" 2>/dev/null; then
      printf 'Protocol Fixture Lab: http://127.0.0.1:%s (PID %s)\nRPC: http://127.0.0.1:%s/rpc\nLog: %s/server.log\n' "$PORT" "$pid" "$PORT" "$RUNTIME"
      exit 0
    fi
  fi
  i=$((i + 1)); sleep .1
done
printf 'Protocol Fixture Lab failed. Log follows:\n' >&2
if [ -s "$RUNTIME/server.log" ]; then
  while IFS= read -r line; do printf '%s\n' "$line" >&2; done <"$RUNTIME/server.log"
else
  printf '(empty log)\n' >&2
fi
exit 1
