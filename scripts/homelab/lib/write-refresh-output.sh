#!/usr/bin/env bash
# scripts/homelab/lib/write-refresh-output.sh
#
# Writes `.refresh-last.json` matching Plan 02's frozen
# `src/homelab/refresh-output-schema.ts` contract verbatim.
# Atomic temp+rename (Phase 96 pattern).
#
# Reads the previous `.refresh-last.json` (if any) to roll
# `consecutiveFailures` forward:
#   - ok=true  → consecutiveFailures resets to 0
#   - ok=false → consecutiveFailures = prev + 1
#
# Required env: HOMELAB_REPO (cwd of the homelab git repo).
#
# Usage:
#   homelab_write_refresh_output \
#     --ok true|false \
#     --commitsha <sha-or-null> \
#     --no-diff true|false \
#     --host-count <int> --vm-count <int> --container-count <int> \
#     --drift-count <int> --tunnel-count <int> --dns-count <int> \
#     [--failure-reason <code>]
#
# Cross-field invariant (D-04c, enforced by Zod schema .refine):
#   ok=false REQUIRES non-empty failureReason. If the caller passes ok=false
#   without --failure-reason, this function fails loud.

set -euo pipefail

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

homelab_write_refresh_output() {
  local ok="" commitsha="null" no_diff="false"
  local host_count="0" vm_count="0" container_count="0"
  local drift_count="0" tunnel_count="0" dns_count="0"
  local failure_reason=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --ok)              ok="$2"; shift 2;;
      --commitsha)       commitsha="$2"; shift 2;;
      --no-diff)         no_diff="$2"; shift 2;;
      --host-count)      host_count="$2"; shift 2;;
      --vm-count)        vm_count="$2"; shift 2;;
      --container-count) container_count="$2"; shift 2;;
      --drift-count)     drift_count="$2"; shift 2;;
      --tunnel-count)    tunnel_count="$2"; shift 2;;
      --dns-count)       dns_count="$2"; shift 2;;
      --failure-reason)  failure_reason="$2"; shift 2;;
      *) echo "homelab_write_refresh_output: unknown arg '$1'" >&2; return 2;;
    esac
  done

  if [[ -z "$ok" ]]; then
    echo "homelab_write_refresh_output: --ok is required" >&2
    return 2
  fi
  if [[ "$ok" == "false" && -z "$failure_reason" ]]; then
    echo "homelab_write_refresh_output: --failure-reason required when --ok=false (D-04c)" >&2
    return 2
  fi

  local repo="${HOMELAB_REPO:?HOMELAB_REPO env var required}"
  local dest="${repo}/.refresh-last.json"

  # Roll consecutiveFailures forward.
  local prev_consec="0"
  if [[ -f "$dest" ]]; then
    prev_consec="$(jq -r '.consecutiveFailures // 0' "$dest" 2>/dev/null || echo 0)"
    # jq -r emits empty for null; coerce to 0.
    [[ -z "$prev_consec" || "$prev_consec" == "null" ]] && prev_consec=0
  fi
  local consec
  if [[ "$ok" == "true" ]]; then
    consec=0
  else
    consec=$((prev_consec + 1))
  fi

  local ts
  ts="$(homelab_iso_ts)"

  # Build commitsha argument. The Zod schema accepts string|null — never an
  # empty string. The caller passes the literal token "null" to mean SQL-null.
  local commitsha_jq_value
  if [[ -z "$commitsha" || "$commitsha" == "null" ]]; then
    commitsha_jq_value=null
  else
    commitsha_jq_value="$(jq -nc --arg s "$commitsha" '$s')"
  fi

  local failure_reason_jq_value
  if [[ -z "$failure_reason" ]]; then
    failure_reason_jq_value=null
  else
    failure_reason_jq_value="$(jq -nc --arg s "$failure_reason" '$s')"
  fi

  # Coerce ok / no_diff to JSON booleans.
  local ok_json="$ok"
  local no_diff_json="$no_diff"
  [[ "$ok_json" != "true" && "$ok_json" != "false" ]] && ok_json="false"
  [[ "$no_diff_json" != "true" && "$no_diff_json" != "false" ]] && no_diff_json="false"

  jq -nc \
    --arg ranAt "$ts" \
    --argjson ok "$ok_json" \
    --argjson commitsha "$commitsha_jq_value" \
    --argjson noDiff "$no_diff_json" \
    --argjson hostCount "$host_count" \
    --argjson vmCount "$vm_count" \
    --argjson containerCount "$container_count" \
    --argjson driftCount "$drift_count" \
    --argjson tunnelCount "$tunnel_count" \
    --argjson dnsCount "$dns_count" \
    --argjson failureReason "$failure_reason_jq_value" \
    --argjson consecutiveFailures "$consec" \
    '{
      schemaVersion: 1,
      ranAt: $ranAt,
      ok: $ok,
      commitsha: $commitsha,
      noDiff: $noDiff,
      counts: {
        hostCount: $hostCount,
        vmCount: $vmCount,
        containerCount: $containerCount,
        driftCount: $driftCount,
        tunnelCount: $tunnelCount,
        dnsCount: $dnsCount
      },
      failureReason: $failureReason,
      consecutiveFailures: $consecutiveFailures
    }' \
    | homelab_atomic_write "$dest"
}
