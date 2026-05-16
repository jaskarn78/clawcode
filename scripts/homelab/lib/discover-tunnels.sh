#!/usr/bin/env bash
# scripts/homelab/lib/discover-tunnels.sh
#
# Enumerates Cloudflare tunnels. Tries `cloudflared tunnel list --output json`
# first (locally installed). Falls back to the Cloudflare API if cloudflared
# is missing AND $CF_API_TOKEN + $CF_ACCOUNT_ID are present in the env.
#
# Test mode: $HOMELAB_TUNNELS_FIXTURE bypasses both paths.
#
# Emits to stdout:
#   { "tunnels": [ { "name": "<id>", "hostname": "<fqdn>" } ] }
#
# Hostname is derived from `ingress` if available; cloudflared JSON output
# at v2024+ exposes tunnel names but ingress rules require `cloudflared
# tunnel info <id>` per-tunnel which is an order-of-magnitude more calls.
# For v1 we surface tunnel-name-as-hostname when a hostname mapping isn't
# trivially available, leaving the operator to map names → hostnames in
# NETWORK.md.

set -euo pipefail

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

homelab_discover_tunnels() {
  local raw_json
  if [[ -n "${HOMELAB_TUNNELS_FIXTURE:-}" ]]; then
    if [[ ! -f "$HOMELAB_TUNNELS_FIXTURE" ]]; then
      homelab_fail "tunnels-fixture-missing" \
        "HOMELAB_TUNNELS_FIXTURE points at non-existent file: $HOMELAB_TUNNELS_FIXTURE"
    fi
    raw_json="$(cat -- "$HOMELAB_TUNNELS_FIXTURE")"
  elif command -v cloudflared >/dev/null 2>&1; then
    if ! raw_json="$(cloudflared tunnel list --output json 2>/dev/null)"; then
      homelab_fail "cloudflared-cli-failed" \
        "cloudflared tunnel list exited non-zero"
    fi
  elif [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ACCOUNT_ID:-}" ]]; then
    homelab_require_cmd curl "missing-curl"
    if ! raw_json="$(curl -sSf \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
        2>/dev/null)"; then
      homelab_fail "cf-api-failed" "Cloudflare API request failed"
    fi
    # API returns { result: [...] }; reshape to look like the cloudflared
    # CLI output so the jq below is unified.
    raw_json="$(jq -c '.result // []' <<<"$raw_json")"
  else
    homelab_log_struct warn \
      "no cloudflared CLI and no CF_API_TOKEN — emitting empty tunnel list"
    jq -nc '{tunnels: []}'
    return 0
  fi

  if ! jq -c '
    {
      tunnels: (
        . | map({
            name: (.name // .id // ""),
            hostname: (.name // .id // "")
          })
          | map(select(.name != ""))
      )
    }
  ' <<<"$raw_json"; then
    homelab_fail "tunnels-parse-failed" \
      "failed to parse cloudflared tunnel list JSON"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  homelab_discover_tunnels
fi
