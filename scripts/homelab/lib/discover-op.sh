#!/usr/bin/env bash
# scripts/homelab/lib/discover-op.sh
#
# Enumerates 1Password item identifiers in the `clawdbot` vault (or a
# configurable vault). NEVER reads secret values — only `op item list` for
# the identifiers themselves. Threat-register T-99947-10: hard rule.
#
# Test mode: $HOMELAB_OP_FIXTURE bypasses the live `op` invocation.
#
# Emits to stdout:
#   { "items": [ { "id": "<uuid>", "title": "<title>" } ] }

set -euo pipefail

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

HOMELAB_OP_VAULT="${HOMELAB_OP_VAULT:-clawdbot}"

homelab_discover_op() {
  local raw_json
  if [[ -n "${HOMELAB_OP_FIXTURE:-}" ]]; then
    if [[ ! -f "$HOMELAB_OP_FIXTURE" ]]; then
      homelab_fail "op-fixture-missing" \
        "HOMELAB_OP_FIXTURE points at non-existent file: $HOMELAB_OP_FIXTURE"
    fi
    raw_json="$(cat -- "$HOMELAB_OP_FIXTURE")"
  else
    if ! command -v op >/dev/null 2>&1; then
      homelab_log_struct warn \
        "op CLI missing — emitting empty op item list (operator should install op)"
      jq -nc '{items: []}'
      return 0
    fi
    if [[ -z "${OP_SERVICE_ACCOUNT_TOKEN:-}" ]]; then
      homelab_log_struct warn \
        "OP_SERVICE_ACCOUNT_TOKEN unset — emitting empty op item list"
      jq -nc '{items: []}'
      return 0
    fi
    if ! raw_json="$(op item list --vault "$HOMELAB_OP_VAULT" --format json 2>/dev/null)"; then
      homelab_fail "op-cli-failed" \
        "op item list --vault $HOMELAB_OP_VAULT exited non-zero"
    fi
  fi

  if ! jq -c '
    {
      items: (
        . | map({
            id: (.id // ""),
            title: (.title // "")
          })
          | map(select(.id != ""))
      )
    }
  ' <<<"$raw_json"; then
    homelab_fail "op-parse-failed" \
      "failed to parse op item list JSON"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  homelab_discover_op
fi
