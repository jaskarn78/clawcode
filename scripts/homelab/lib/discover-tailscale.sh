#!/usr/bin/env bash
# scripts/homelab/lib/discover-tailscale.sh
#
# Polls `tailscale status --json` (or reads $HOMELAB_TS_FIXTURE for tests)
# and emits a normalized JSON document to stdout:
#
#   { "hosts": [ { "name": "<id>", "ip": "<tsv4>", "os": "<os>",
#                  "lastSeen": "<iso>" }, ... ] }
#
# Sources lib/common.sh. Exits non-zero (homelab_fail) only on hard failure;
# missing keys in the upstream JSON are tolerated as empty strings.

set -euo pipefail

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

homelab_discover_tailscale() {
  local raw_json
  if [[ -n "${HOMELAB_TS_FIXTURE:-}" ]]; then
    if [[ ! -f "$HOMELAB_TS_FIXTURE" ]]; then
      homelab_fail "tailscale-fixture-missing" \
        "HOMELAB_TS_FIXTURE points at non-existent file: $HOMELAB_TS_FIXTURE"
    fi
    raw_json="$(cat -- "$HOMELAB_TS_FIXTURE")"
  else
    homelab_require_cmd tailscale "missing-tailscale-cli"
    if ! raw_json="$(tailscale status --json 2>/dev/null)"; then
      homelab_fail "tailscale-cli-failed" \
        "tailscale status --json exited non-zero"
    fi
  fi

  # Normalize. `Self` + `Peer.*` carry the hosts.  We use jq to map them
  # to the shared schema.  If `Peer` is null/absent, we emit just Self.
  if ! jq -c '
    def host_of:
      {
        name: ((.HostName // .DNSName // "") | sub("\\.$"; "")),
        ip: (.TailscaleIPs[0] // ""),
        os: (.OS // ""),
        lastSeen: (.LastSeen // "")
      };
    {
      hosts: (
        [ .Self | host_of ] +
        ( ( .Peer // {} ) | to_entries | map(.value | host_of) )
      )
      | map(select(.name != ""))
    }
  ' <<<"$raw_json"; then
    homelab_fail "tailscale-parse-failed" \
      "failed to parse tailscale JSON via jq"
  fi
}

# When sourced as part of refresh.sh, the orchestrator calls the function.
# When invoked directly (for tests / manual debug), run it.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  homelab_discover_tailscale
fi
