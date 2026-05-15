#!/usr/bin/env bash
# scripts/homelab/refresh.sh
#
# Phase 999.47 Plan 03 — top-level homelab refresh orchestrator.
#
# Runs hourly under the ClawCode daemon's heartbeat tick on clawdy. Polls
# Tailscale + Unraid (virsh + docker) + Cloudflare tunnels + 1Password
# item identifiers; rewrites the Live State blocks in INVENTORY.md;
# quarantines drift into DRIFT.md; commits diffs under the
# `clawcode-refresh <noreply@clawcode>` identity; writes
# `.refresh-last.json` matching Plan 02's frozen Zod schema.
#
# Hard invariants (T-99947-04 / T-99947-11 / T-99947-12 / T-99947-13):
#   - NO calls to the init system. NO daemon-install-tree touches.
#   - Bytes outside `<!-- refresh.sh: managed -->` markers NEVER modified.
#   - flock against concurrent runs.
#   - Noisy failures: ok=false + failureReason + non-zero exit.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
# shellcheck disable=SC1091
# shellcheck source=lib/discover-tailscale.sh
source "${SCRIPT_DIR}/lib/discover-tailscale.sh"
# shellcheck disable=SC1091
# shellcheck source=lib/discover-unraid.sh
source "${SCRIPT_DIR}/lib/discover-unraid.sh"
# shellcheck disable=SC1091
# shellcheck source=lib/discover-tunnels.sh
source "${SCRIPT_DIR}/lib/discover-tunnels.sh"
# shellcheck disable=SC1091
# shellcheck source=lib/discover-op.sh
source "${SCRIPT_DIR}/lib/discover-op.sh"
# shellcheck disable=SC1091
# shellcheck source=lib/write-refresh-output.sh
source "${SCRIPT_DIR}/lib/write-refresh-output.sh"
# shellcheck disable=SC1091
# shellcheck source=lib/diff-and-quarantine.sh
source "${SCRIPT_DIR}/lib/diff-and-quarantine.sh"

# ---- args -------------------------------------------------------------------
REPO_PATH_DEFAULT="${HOMELAB_REPO:-/home/clawcode/homelab}"
REPO_PATH="${REPO_PATH_DEFAULT}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-path) REPO_PATH="$2"; shift 2;;
    --help|-h)
      cat <<'EOF'
Usage: refresh.sh [--repo-path <path>]

Polls Tailscale + Unraid + Cloudflare + 1Password; rewrites Live State
blocks in INVENTORY.md inside the homelab repo; commits diffs under
clawcode-refresh; writes .refresh-last.json.

Env knobs:
  HOMELAB_REPO                       — repo root (default /home/clawcode/homelab)
  HOMELAB_TS_FIXTURE                 — bypass live tailscale (tests)
  HOMELAB_UNRAID_VIRSH_FIXTURE       — bypass live virsh (tests)
  HOMELAB_UNRAID_DOCKER_FIXTURE      — bypass live docker (tests)
  HOMELAB_TUNNELS_FIXTURE            — bypass live cloudflared (tests)
  HOMELAB_OP_FIXTURE                 — bypass live op (tests)
  HOMELAB_SKIP_UNRAID=1              — skip Unraid SSH entirely
  HOMELAB_LOCK_FILE                  — override flock path (default /tmp/clawcode-homelab-refresh.lock)
EOF
      exit 0
      ;;
    *) echo "refresh.sh: unknown arg '$1'" >&2; exit 2;;
  esac
done

export HOMELAB_REPO="$REPO_PATH"

if [[ ! -d "$HOMELAB_REPO/.git" ]]; then
  echo "refresh.sh: $HOMELAB_REPO is not a git repo (Plan 01 bootstrap missing?)" >&2
  exit 2
fi

# ---- flock against concurrent runs (T-99947-12) ----------------------------
LOCK_FILE="${HOMELAB_LOCK_FILE:-/tmp/clawcode-homelab-refresh.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  homelab_log_struct warn "another refresh.sh is already running — exiting cleanly" \
    "lock=$LOCK_FILE"
  exit 0
fi

START_TS="$(homelab_iso_ts)"
homelab_log_struct info "refresh.sh starting" "repo=$HOMELAB_REPO" "started=$START_TS"

# ---- discovery -------------------------------------------------------------
WORK_DIR="$(mktemp -d -t clawcode-homelab-refresh.XXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

TS_OUT="$WORK_DIR/tailscale.json"
UNRAID_OUT="$WORK_DIR/unraid.json"
TUNNELS_OUT="$WORK_DIR/tunnels.json"
OP_OUT="$WORK_DIR/op.json"
COUNTS_OUT="$WORK_DIR/counts.json"

# Run each source in turn. Per-source failures log a warning + emit empty
# normalized JSON; only an ALL-failed condition triggers homelab_fail.
sources_ok=0

if homelab_discover_tailscale >"$TS_OUT" 2>>"$WORK_DIR/stderr.log"; then
  sources_ok=$((sources_ok + 1))
else
  homelab_log_struct warn "tailscale discovery failed — continuing with empty set"
  echo '{"hosts":[]}' >"$TS_OUT"
fi

if homelab_discover_unraid >"$UNRAID_OUT" 2>>"$WORK_DIR/stderr.log"; then
  sources_ok=$((sources_ok + 1))
else
  homelab_log_struct warn "unraid discovery failed — continuing with empty set"
  echo '{"vms":[],"containers":[]}' >"$UNRAID_OUT"
fi

if homelab_discover_tunnels >"$TUNNELS_OUT" 2>>"$WORK_DIR/stderr.log"; then
  sources_ok=$((sources_ok + 1))
else
  homelab_log_struct warn "tunnels discovery failed — continuing with empty set"
  echo '{"tunnels":[]}' >"$TUNNELS_OUT"
fi

if homelab_discover_op >"$OP_OUT" 2>>"$WORK_DIR/stderr.log"; then
  sources_ok=$((sources_ok + 1))
else
  homelab_log_struct warn "op discovery failed — continuing with empty set"
  echo '{"items":[]}' >"$OP_OUT"
fi

# Trap any user-supplied fixture that pointed at a missing file: those paths
# call homelab_fail directly (which exits non-zero). The discover-*.sh
# functions in test mode emit `homelab_fail` for missing fixtures, which is
# detected here — if any discover_* invocation made homelab_fail run, we
# would have exited already. Reaching this point means at least the per-source
# fallbacks let us proceed.

if [[ "$sources_ok" -eq 0 ]]; then
  homelab_fail "all-sources-failed" \
    "all four discovery sources failed — refusing to commit empty state"
fi

# ---- diff + quarantine -----------------------------------------------------
HOMELAB_OP_VAULT="${HOMELAB_OP_VAULT:-clawdbot}" \
  homelab_diff_and_quarantine \
    --repo "$HOMELAB_REPO" \
    --tailscale-json "$TS_OUT" \
    --unraid-json "$UNRAID_OUT" \
    --tunnels-json "$TUNNELS_OUT" \
    --op-json "$OP_OUT" \
    --counts-out "$COUNTS_OUT"

DRIFT_COUNT="$(jq -r '.driftCount' "$COUNTS_OUT")"
STALE_COUNT="$(jq -r '.staleCount' "$COUNTS_OUT")"

# Count semantics (per advisor + Plan 03 Test 1 expectations):
#   hostCount / vmCount / containerCount = intersection of inventory anchors
#     and discovery (computed by diff-and-quarantine.sh). Reflects "how many
#     inventoried items are alive in discovery this tick."
#   tunnelCount  = raw discovered tunnels (no inventory comparison surface
#     in v1; surfaces via journalctl for operator visibility).
#   driftCount   = inventory-mismatched host/vm/container items NEW to
#     DRIFT.md this run (excludes tunnels/op which have no anchors).
#   dnsCount     = 0 in v1 (no discover-dns.sh poller — deferred).
HOST_COUNT="$(jq -r '.matchedHosts' "$COUNTS_OUT")"
VM_COUNT="$(jq -r '.matchedVms' "$COUNTS_OUT")"
CONTAINER_COUNT="$(jq -r '.matchedContainers' "$COUNTS_OUT")"
TUNNEL_COUNT="$(jq -r '.tunnels | length' "$TUNNELS_OUT")"
DNS_COUNT=0

# ---- commit (only if diff exists) ------------------------------------------
cd "$HOMELAB_REPO"
git add -A

COMMITSHA="null"
NO_DIFF="true"

if ! git diff --cached --quiet 2>/dev/null; then
  NO_DIFF="false"
  # Commit under the clawcode-refresh machine identity (D-02a).
  COMMIT_MSG="refresh: hourly tick $(homelab_iso_ts) [drift=${DRIFT_COUNT},stale=${STALE_COUNT}]"
  if ! git \
      -c user.name="clawcode-refresh" \
      -c user.email="noreply@clawcode" \
      commit -m "$COMMIT_MSG" >/dev/null 2>&1; then
    homelab_fail "git-commit-failed" "git commit returned non-zero"
  fi
  COMMITSHA="$(git rev-parse HEAD)"
else
  homelab_log_struct info "no diff — skipping commit"
fi

# ---- emit .refresh-last.json -----------------------------------------------
homelab_write_refresh_output \
  --ok true \
  --commitsha "$COMMITSHA" \
  --no-diff "$NO_DIFF" \
  --host-count "$HOST_COUNT" \
  --vm-count "$VM_COUNT" \
  --container-count "$CONTAINER_COUNT" \
  --drift-count "$DRIFT_COUNT" \
  --tunnel-count "$TUNNEL_COUNT" \
  --dns-count "$DNS_COUNT"

homelab_log_struct info "refresh.sh complete" \
  "hostCount=$HOST_COUNT" "vmCount=$VM_COUNT" \
  "containerCount=$CONTAINER_COUNT" "driftCount=$DRIFT_COUNT" \
  "tunnelCount=$TUNNEL_COUNT" "commitsha=$COMMITSHA"

exit 0
