#!/usr/bin/env bash
# Phase 110 Stage 0b — measure aggregate shim RSS on clawdy host.
#
# Usage: measure-shim-rss.sh [search|image|browser|all]
#   default: all
#
# Reads VmRSS from /proc/<pid>/status for every running clawcode-mcp-shim
# process matching the requested --type, prints per-PID lines, and finishes
# with an aggregate Total + average. Emits zero matching lines and exits 0
# when no shims of the requested type are running.
#
# Exit codes:
#   0  — completed (zero or more shims measured)
#   64 — usage error (unknown shim type)
set -euo pipefail
SHIM_TYPE="${1:-all}"

case "$SHIM_TYPE" in
  search|image|browser)
    PATTERN="clawcode-mcp-shim --type $SHIM_TYPE"
    ;;
  all)
    PATTERN="clawcode-mcp-shim --type"
    ;;
  *)
    echo "ERROR: unknown shim type $SHIM_TYPE (want search|image|browser|all)" >&2
    exit 64
    ;;
esac

# pgrep exits 1 when no match; tolerate that under `set -e` so we can emit
# the "no matching shims" message and exit cleanly.
PIDS="$(pgrep -f "$PATTERN" 2>/dev/null | tr '\n' ' ' || true)"
PIDS="${PIDS%% }"
if [ -z "$PIDS" ]; then
  echo "No matching shims found for: $PATTERN"
  exit 0
fi

TOTAL_KB=0
COUNT=0
for PID in $PIDS; do
  KB="$(awk '/^VmRSS:/ {print $2}' /proc/$PID/status 2>/dev/null || echo 0)"
  MB=$((KB / 1024))
  echo "PID=$PID VmRSS=${KB}kB (${MB}MB)"
  TOTAL_KB=$((TOTAL_KB + KB))
  COUNT=$((COUNT + 1))
done

TOTAL_MB=$((TOTAL_KB / 1024))
AVG_KB=$((TOTAL_KB / COUNT))
AVG_MB=$((AVG_KB / 1024))
echo "Total: ${TOTAL_KB}kB (${TOTAL_MB}MB) across $COUNT shims; avg ${AVG_KB}kB (${AVG_MB}MB)"
