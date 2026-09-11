#!/usr/bin/env bash
# Starts all five surfaces on their fixed ports plus the check-in hub on 5170.
# Ports are the ones in shared/CONTRACT_ADDENDUM.md section G. Uses strictPort so a busy port fails loudly.
# Usage: bash checkin/start.sh            (foreground, Ctrl-C stops everything)
#        bash checkin/start.sh --status   (just regenerate the hub and exit)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 checkin/build_status.py
[ "${1:-}" = "--status" ] && exit 0

declare -a PIDS
start() { # name port
  if lsof -nP -iTCP:"$2" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "$1: port $2 already listening, reusing"
  else
    (cd "$1" && npm run dev -- --port "$2" --strictPort > "/tmp/trashlab-$1.log" 2>&1) &
    PIDS+=($!); echo "$1: starting on $2 (log /tmp/trashlab-$1.log)"
  fi
}
start storefront 5173
start portal 5175
start billing 5179
start pricing 5180
start account 5199
if lsof -nP -iTCP:5170 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "hub: port 5170 already listening, reusing"
else
  (python3 checkin/serve.py 5170 > /tmp/trashlab-hub.log 2>&1) &
  PIDS+=($!)
fi
echo
echo "Check-in hub: http://localhost:5170/"
echo "Ctrl-C stops the servers this script started."
trap 'kill "${PIDS[@]}" 2>/dev/null' EXIT INT TERM
wait
