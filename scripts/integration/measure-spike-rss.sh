#!/usr/bin/env bash
# Phase 110 Stage 0b Wave 0 — measure spike RSS on clawdy host.
#
# Run on admin-clawdy with the spike binary already deployed and registered
# as admin-clawdy's search MCP server. The script reads VmRSS from
# /proc/<pid>/status and emits PASS if ≤ 15360 kB (15 MB), FAIL otherwise.
#
# Exit codes:
#   0 — PASS (VmRSS ≤ 15 MB; operator may proceed to Wave 1)
#   1 — script error (no spike PID found; deploy/wiring problem)
#   2 — FAIL (VmRSS > 15 MB; operator must abort Stage 0b for Python pivot)
set -euo pipefail

PID="$(pgrep -f 'clawcode-mcp-shim --type search' | head -1)"
if [ -z "$PID" ]; then
  echo "ERROR: no clawcode-mcp-shim --type search process found" >&2
  echo "Hint: ensure admin-clawdy is started with the spike binary at /usr/local/bin/clawcode-mcp-shim and its MCP config points search at that binary with --type search." >&2
  exit 1
fi

VMRSS_KB="$(awk '/^VmRSS:/ {print $2}' "/proc/$PID/status")"
VMRSS_MB="$((VMRSS_KB / 1024))"

echo "PID:          $PID"
echo "VmRSS:        $VMRSS_KB kB"
echo "VmRSS:        $VMRSS_MB MB"
echo "Threshold:    15 MB (KILL-SWITCH)"
if [ "$VMRSS_KB" -le 15360 ]; then
  echo "RESULT:       PASS (under 15360 kB / 15 MB)"
  exit 0
else
  echo "RESULT:       FAIL (RSS exceeds 15 MB — pivot to Python before any Wave 1 commits)"
  exit 2
fi
