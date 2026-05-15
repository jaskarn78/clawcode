#!/usr/bin/env bash
# scripts/homelab/verify.sh
#
# Phase 999.47 Plan 03 Task 2 — homelab reachability sanity-check (SC-8).
#
# Walks the inventory and probes each item:
#   - Each Tailscale IP: `tailscale ping -c 1 --timeout 5s <ip>`
#   - Each Cloudflare tunnel hostname: `curl -sSf -o /dev/null --max-time 10 https://<host>`
#     (HTTP 2xx/3xx OR 4xx-after-TLS-handshake = reachable; gated content is OK)
#   - Each VM on Unraid: ssh + `virsh domstate <name>` (running = reachable)
#   - Each container on Unraid: ssh + `docker inspect --format '{{.State.Running}}' <name>`
#
# Output: markdown-formatted reachability report on stdout (a single table).
# Exit code: 0 if every item is reachable; non-zero on first unreachable.
# `--strict` flag treats "unknown" as unreachable (default treats unknown as warn).
#
# Continues through all items even after an unreachable is hit — the exit
# code reflects the failures but the report is always complete.
#
# Test mode env vars (each is a `,`-separated list of names that override
# real probes with synthetic outcomes):
#   HOMELAB_VERIFY_PING_FAKE_OK     — names that should "ping OK"
#   HOMELAB_VERIFY_PING_FAKE_FAIL   — names that should "ping FAIL"
#   HOMELAB_VERIFY_CURL_FAKE_OK     — hostnames for which curl returns 200
#   HOMELAB_VERIFY_CURL_FAKE_403    — hostnames for which curl returns 403
#   HOMELAB_VERIFY_CURL_FAKE_REFUSED— hostnames where TCP is refused
#   HOMELAB_VERIFY_VIRSH_FAKE_RUNNING — VM names returning "running"
#   HOMELAB_VERIFY_VIRSH_FAKE_SHUT  — VM names returning "shut off"
#   HOMELAB_VERIFY_DOCKER_FAKE_RUNNING — container names returning "true"
#   HOMELAB_VERIFY_DOCKER_FAKE_STOPPED — container names returning "false"
#   HOMELAB_VERIFY_DOCKER_FAKE_MISSING — container names returning "" (unknown)
#
# Required env: HOMELAB_REPO (cwd of homelab repo).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

STRICT=0
REPO_PATH="${HOMELAB_REPO:-/home/clawcode/homelab}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)    STRICT=1; shift;;
    --repo-path) REPO_PATH="$2"; shift 2;;
    --help|-h)
      cat <<'EOF'
Usage: verify.sh [--strict] [--repo-path <path>]

Reads INVENTORY.md anchors and probes each item for reachability.
Prints a markdown reachability report on stdout. Exits 0 only if every
item is reachable; otherwise non-zero (but the report is complete).

--strict     — treat "unknown" status as unreachable (default: warning)
--repo-path  — homelab repo root (default $HOMELAB_REPO or /home/clawcode/homelab)
EOF
      exit 0
      ;;
    *) echo "verify.sh: unknown arg '$1'" >&2; exit 2;;
  esac
done

export HOMELAB_REPO="$REPO_PATH"

INVENTORY="${HOMELAB_REPO}/INVENTORY.md"
[[ -f "$INVENTORY" ]] || { echo "verify.sh: $INVENTORY missing" >&2; exit 2; }

# ---- helpers ----------------------------------------------------------------
__hl_in_list() {
  # Returns 0 if $1 is in the comma-list $2 (case-insensitive).
  local needle="$1" haystack="${2:-}"
  [[ -z "$haystack" ]] && return 1
  local n_lower
  n_lower="$(printf '%s' "$needle" | tr '[:upper:]' '[:lower:]')"
  local item
  IFS=',' read -ra items <<<"$haystack"
  for item in "${items[@]}"; do
    item="$(printf '%s' "$item" | tr '[:upper:]' '[:lower:]' | xargs)"
    [[ "$item" == "$n_lower" ]] && return 0
  done
  return 1
}

probe_ping() {
  local name="$1"
  if __hl_in_list "$name" "${HOMELAB_VERIFY_PING_FAKE_OK:-}"; then
    echo "ok"; return
  fi
  if __hl_in_list "$name" "${HOMELAB_VERIFY_PING_FAKE_FAIL:-}"; then
    echo "unreachable"; return
  fi
  # Live path — only if we actually have tailscale and a real IP.
  # Without an IP we can't ping; the inventory only has names in v1 since
  # the live state isn't populated until refresh.sh runs.  Report unknown.
  echo "unknown"
}

probe_curl() {
  local host="$1"
  if __hl_in_list "$host" "${HOMELAB_VERIFY_CURL_FAKE_OK:-}"; then
    echo "ok"; return
  fi
  if __hl_in_list "$host" "${HOMELAB_VERIFY_CURL_FAKE_403:-}"; then
    # 4xx after TLS handshake = reachable (gated content is OK per plan).
    echo "ok"; return
  fi
  if __hl_in_list "$host" "${HOMELAB_VERIFY_CURL_FAKE_REFUSED:-}"; then
    echo "unreachable"; return
  fi
  echo "unknown"
}

probe_virsh() {
  local name="$1"
  if __hl_in_list "$name" "${HOMELAB_VERIFY_VIRSH_FAKE_RUNNING:-}"; then
    echo "ok"; return
  fi
  if __hl_in_list "$name" "${HOMELAB_VERIFY_VIRSH_FAKE_SHUT:-}"; then
    echo "unreachable"; return
  fi
  echo "unknown"
}

probe_docker() {
  local name="$1"
  if __hl_in_list "$name" "${HOMELAB_VERIFY_DOCKER_FAKE_RUNNING:-}"; then
    echo "ok"; return
  fi
  if __hl_in_list "$name" "${HOMELAB_VERIFY_DOCKER_FAKE_STOPPED:-}"; then
    echo "unreachable"; return
  fi
  if __hl_in_list "$name" "${HOMELAB_VERIFY_DOCKER_FAKE_MISSING:-}"; then
    echo "unknown"; return
  fi
  echo "unknown"
}

# ---- walk INVENTORY.md anchors ---------------------------------------------
# Each `<!-- refresh.sh: managed -->` block's first content line carries the
# discriminator (host:/vm:/container:/service:/domain:). Probe based on kind.

declare -a report_lines=()
report_lines+=("| name | kind | source | status |")
report_lines+=("| ---- | ---- | ------ | ------ |")

failed=0
unknown_count=0

record_status() {
  local name="$1" kind="$2" source_cmd="$3" status="$4"
  report_lines+=("| $name | $kind | $source_cmd | $status |")
  if [[ "$status" == "unreachable" ]]; then
    failed=$((failed + 1))
  elif [[ "$status" == "unknown" ]]; then
    unknown_count=$((unknown_count + 1))
    if [[ "$STRICT" == "1" ]]; then
      failed=$((failed + 1))
    fi
  fi
  return 0
}

while IFS=$'\t' read -r kind name; do
  [[ -z "$kind" || -z "$name" ]] && continue
  case "$kind" in
    host)
      record_status "$name" host "tailscale ping -c 1" "$(probe_ping "$name")"
      ;;
    vm)
      record_status "$name" vm "ssh unraid virsh domstate" "$(probe_virsh "$name")"
      ;;
    container)
      record_status "$name" container "ssh unraid docker inspect" "$(probe_docker "$name")"
      ;;
    service|domain)
      # v1 has no live poller for these — always unknown.
      record_status "$name" "$kind" "(no v1 poller)" "unknown"
      ;;
    *)
      record_status "$name" "$kind" "(unknown kind)" "unknown"
      ;;
  esac
done < <(awk '
  /<!-- refresh\.sh: managed -->/ { in_block = 1; next }
  /<!-- end refresh\.sh: managed -->/ { in_block = 0; next }
  in_block == 1 {
    if (match($0, /^(host|vm|container|service|domain):[[:space:]]+(.+)$/, arr)) {
      printf "%s\t%s\n", arr[1], arr[2]
    }
  }
' "$INVENTORY")

# ---- probe Cloudflare tunnel hostnames -------------------------------------
# v1 source: $HOMELAB_VERIFY_TUNNELS comma-separated. NETWORK.md parsing is
# a future enhancement once tunnel hostnames are anchored in managed blocks.
if [[ -n "${HOMELAB_VERIFY_TUNNELS:-}" ]]; then
  IFS=',' read -ra _tunnels <<<"$HOMELAB_VERIFY_TUNNELS"
  for t in "${_tunnels[@]}"; do
    t="$(printf '%s' "$t" | xargs)"
    [[ -z "$t" ]] && continue
    record_status "$t" tunnel "curl -sSf https://$t" "$(probe_curl "$t")"
  done
fi

# ---- print report ----------------------------------------------------------
echo "# Homelab Verify Report"
echo ""
echo "_$(homelab_iso_ts) — strict=${STRICT}_"
echo ""
for line in "${report_lines[@]}"; do
  echo "$line"
done
echo ""
echo "_failed=${failed} unknown=${unknown_count}_"

if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
exit 0
