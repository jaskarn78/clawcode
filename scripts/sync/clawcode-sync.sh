#!/usr/bin/env bash
# Phase 91 Plan 01 — systemd-timer-invoked sync wrapper.
#
# Invoked by scripts/systemd/clawcode-sync.service every 5 minutes. Runs one
# sync cycle via the ClawCode CLI entrypoint. Re-entrancy safe — flock
# prevents a second cycle from starting if the prior one is still running
# (D-03: "ActiveSec idempotent; if prior run overruns, next cycle skips").
#
# Exits non-zero on failure; systemd captures in journalctl. A non-zero exit
# code means THIS cycle failed — the timer still fires the next one per
# OnUnitActiveSec=5min (D-04 graceful degradation).
#
# Operator override knobs:
#   CLAWCODE_DIR      — install prefix (default /opt/clawcode)
#   CLAWCODE_SYNC_CMD — override the CLI entrypoint for testing

set -euo pipefail

LOCK_FILE="${HOME}/.clawcode/manager/sync.lock"
CLAWCODE_DIR="${CLAWCODE_DIR:-/opt/clawcode}"
SYNC_FILTER="${CLAWCODE_DIR}/scripts/sync/clawcode-sync-filter.txt"
SYNC_CMD_DEFAULT="node ${CLAWCODE_DIR}/dist/cli/index.js sync run-once --filter-file ${SYNC_FILTER}"
SYNC_CMD="${CLAWCODE_SYNC_CMD:-${SYNC_CMD_DEFAULT}}"

mkdir -p "$(dirname "$LOCK_FILE")"

# --nonblock: bail out immediately if another cycle holds the lock. Exit
# code 1 in that case is fine — systemd logs "skipped, prior run in flight".
exec flock --nonblock "$LOCK_FILE" ${SYNC_CMD}
