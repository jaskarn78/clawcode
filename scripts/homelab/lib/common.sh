#!/usr/bin/env bash
# scripts/homelab/lib/common.sh
#
# Shared bash helpers for Phase 999.47 Plan 03 refresh.sh + verify.sh.
# Sourced — never executed directly.
#
# Helpers:
#   homelab_iso_ts                — UTC ISO-8601 timestamp matching Plan 02 schema (ranAt)
#   homelab_atomic_write          — temp+rename (Phase 96 pattern)
#   homelab_log_struct            — single-line JSON log to stderr
#   homelab_fail                  — noisy-failure path (D-04c)
#   homelab_require_cmd           — preflight check for an external tool
#
# All helpers are pure: no global mutation outside the documented function
# return-channel (stdout for data, stderr for logs). Sourcing this file is
# safe under `set -euo pipefail`.

# Idempotent source guard — multiple lib files source common.sh; we want
# the helpers defined exactly once per shell.
if [[ -n "${HOMELAB_COMMON_SH_LOADED:-}" ]]; then
  # shellcheck disable=SC2317  # fallback for direct-execute is intentional
  return 0 2>/dev/null || exit 0
fi
HOMELAB_COMMON_SH_LOADED=1

# ---- iso timestamp ----------------------------------------------------------
# Returns UTC ISO-8601 in the exact form Plan 02's `refreshOutputSchema.ranAt`
# (`z.iso.datetime()`) accepts: YYYY-MM-DDTHH:MM:SSZ.
homelab_iso_ts() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

# ---- atomic write -----------------------------------------------------------
# Usage: homelab_atomic_write <dest>   (reads content from stdin)
# Writes content to <dest>.tmp.$$ then `mv -f` to <dest>. Failure on
# intermediate write leaves <dest> untouched.
homelab_atomic_write() {
  local dest="${1:?dest path required}"
  local tmp="${dest}.tmp.$$"
  # Make sure parent dir exists.
  local parent
  parent="$(dirname -- "$dest")"
  [[ -d "$parent" ]] || mkdir -p -- "$parent"
  cat >"$tmp"
  mv -f -- "$tmp" "$dest"
}

# ---- structured log ---------------------------------------------------------
# Usage: homelab_log_struct <level> <message> [k1=v1 k2=v2 ...]
# Emits a single-line JSON object to stderr. Values are passed through jq -R
# so they're safely escaped.
homelab_log_struct() {
  local level="${1:?level required}"
  local msg="${2:?msg required}"
  shift 2
  local ts
  ts="$(homelab_iso_ts)"

  # Build a jq filter that assembles {ts, level, msg, ...kv}.
  # shellcheck disable=SC2016  # $ts/$level/$msg are jq-side vars, not shell
  local jq_filter='{ts: $ts, level: $level, msg: $msg}'
  local args=(--arg ts "$ts" --arg level "$level" --arg msg "$msg")
  local kv
  for kv in "$@"; do
    local k="${kv%%=*}"
    local v="${kv#*=}"
    args+=(--arg "$k" "$v")
    jq_filter="${jq_filter} + {${k}: \$${k}}"
  done
  jq -nc "${args[@]}" "$jq_filter" >&2 || {
    # jq itself failed — fall back to a plain-text line. Never blow up the
    # caller because logging failed.
    printf '%s level=%s msg=%s\n' "$ts" "$level" "$msg" >&2
  }
}

# ---- failure path -----------------------------------------------------------
# Usage: homelab_fail <reason-code> <human-msg>
# Appends a row to DRIFT.md `## Refresh Failures`, then invokes
# write-refresh-output.sh with ok=false. Exits the caller non-zero.
# Requires HOMELAB_REPO to be set (orchestrator does this).
homelab_fail() {
  local reason="${1:?reason-code required}"
  local human="${2:?human-msg required}"
  local repo="${HOMELAB_REPO:?HOMELAB_REPO env var required}"
  local ts
  ts="$(homelab_iso_ts)"

  # Append a structured row to DRIFT.md `## Refresh Failures`. Locate the
  # section header and append below it. Never modify any other section.
  local drift="${repo}/DRIFT.md"
  if [[ -f "$drift" ]]; then
    local tmp="${drift}.tmp.$$"
    awk -v ts="$ts" -v reason="$reason" -v human="$human" '
      BEGIN { appended = 0 }
      {
        print
        if (!appended && $0 ~ /^## Refresh Failures[[:space:]]*$/) {
          print ""
          print "- " ts " | reason=" reason " | " human
          appended = 1
        }
      }
    ' "$drift" >"$tmp"
    mv -f -- "$tmp" "$drift"
  else
    homelab_log_struct warn "DRIFT.md missing — failure not persisted" \
      "path=$drift" "reason=$reason"
  fi

  homelab_log_struct error "$human" "reason=$reason"

  # Persist .refresh-last.json with ok=false. write-refresh-output.sh is
  # sourced by refresh.sh — when called from a discover-*.sh that's not
  # under refresh.sh, the function may not exist; tolerate that.
  if declare -F homelab_write_refresh_output >/dev/null 2>&1; then
    homelab_write_refresh_output \
      --ok false \
      --failure-reason "$reason" \
      --commitsha "null" \
      --no-diff false \
      --host-count 0 --vm-count 0 --container-count 0 \
      --drift-count 0 --tunnel-count 0 --dns-count 0 || true
  fi

  exit 1
}

# ---- command preflight ------------------------------------------------------
# Usage: homelab_require_cmd <cmd> [reason-code]
# Exits via homelab_fail if the command is not in PATH.
homelab_require_cmd() {
  local cmd="${1:?cmd name required}"
  local reason="${2:-missing-${cmd}}"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    homelab_fail "$reason" "required command '$cmd' not found in PATH"
  fi
}
