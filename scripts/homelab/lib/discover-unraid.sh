#!/usr/bin/env bash
# scripts/homelab/lib/discover-unraid.sh
#
# Polls Unraid (Tailscale IP 100.117.234.17) for VMs (virsh) + containers
# (docker). One SSH round-trip — the remote command emits a split marker
# (`---SPLIT---`) between virsh and docker output.
#
# Test mode: $HOMELAB_UNRAID_VIRSH_FIXTURE + $HOMELAB_UNRAID_DOCKER_FIXTURE
# bypass SSH entirely.
#
# Skip mode: $HOMELAB_SKIP_UNRAID=1 emits an empty {vms:[],containers:[]}
# with a warning — used when the operator knows Unraid is down and doesn't
# want refresh.sh to fail outright.
#
# Emits to stdout:
#   { "vms": [ { "name": "<name>", "state": "running|shut off|..." } ],
#     "containers": [ { "name": "<name>", "state": "running|exited|..." } ] }

set -euo pipefail

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

# Default Unraid Tailscale IP per CONTEXT.md / BACKLOG.
HOMELAB_UNRAID_HOST="${HOMELAB_UNRAID_HOST:-100.117.234.17}"
HOMELAB_UNRAID_USER="${HOMELAB_UNRAID_USER:-root}"

homelab_discover_unraid() {
  if [[ "${HOMELAB_SKIP_UNRAID:-0}" == "1" ]]; then
    homelab_log_struct warn "skipping Unraid discovery (HOMELAB_SKIP_UNRAID=1)"
    jq -nc '{vms: [], containers: []}'
    return 0
  fi

  local virsh_raw docker_raw
  if [[ -n "${HOMELAB_UNRAID_VIRSH_FIXTURE:-}" ]]; then
    if [[ ! -f "$HOMELAB_UNRAID_VIRSH_FIXTURE" ]]; then
      homelab_fail "unraid-virsh-fixture-missing" \
        "HOMELAB_UNRAID_VIRSH_FIXTURE points at non-existent file: $HOMELAB_UNRAID_VIRSH_FIXTURE"
    fi
    virsh_raw="$(cat -- "$HOMELAB_UNRAID_VIRSH_FIXTURE")"
  fi
  if [[ -n "${HOMELAB_UNRAID_DOCKER_FIXTURE:-}" ]]; then
    if [[ ! -f "$HOMELAB_UNRAID_DOCKER_FIXTURE" ]]; then
      homelab_fail "unraid-docker-fixture-missing" \
        "HOMELAB_UNRAID_DOCKER_FIXTURE points at non-existent file: $HOMELAB_UNRAID_DOCKER_FIXTURE"
    fi
    docker_raw="$(cat -- "$HOMELAB_UNRAID_DOCKER_FIXTURE")"
  fi

  # Live path (only when both fixtures absent).
  if [[ -z "${virsh_raw:-}" && -z "${docker_raw:-}" ]]; then
    homelab_require_cmd ssh "missing-ssh"
    local combined
    if ! combined="$(ssh -o ConnectTimeout=10 -o BatchMode=yes \
        "${HOMELAB_UNRAID_USER}@${HOMELAB_UNRAID_HOST}" \
        'virsh list --all && echo ---SPLIT--- && docker ps -a --format "{{json .}}"' \
        2>/dev/null)"; then
      homelab_fail "unraid-ssh-failed" \
        "ssh to ${HOMELAB_UNRAID_USER}@${HOMELAB_UNRAID_HOST} failed"
    fi
    virsh_raw="${combined%%---SPLIT---*}"
    docker_raw="${combined#*---SPLIT---}"
  fi

  # Parse virsh: skip header rows ("Id   Name   State", separator dashes,
  # and blank trailing lines). Each data row has the shape:
  #   " <id> <name> <state…>"
  # State is "running", "shut off", "paused", etc. — may include spaces.
  local vms_json
  vms_json="$(printf '%s\n' "${virsh_raw:-}" | awk '
    BEGIN { go=0 }
    /^-+$/ { go=1; next }
    go==1 && NF>=3 {
      name=$2
      state=$3
      for (i=4; i<=NF; i++) state=state " " $i
      printf "%s\t%s\n", name, state
    }
  ' | jq -Rsc '
    split("\n")
    | map(select(length>0))
    | map(split("\t") | {name: .[0], state: .[1]})
  ')"

  # Parse docker: one JSON object per line (docker --format "{{json .}}").
  local containers_json
  if [[ -z "${docker_raw// /}" ]]; then
    containers_json="[]"
  else
    containers_json="$(printf '%s\n' "$docker_raw" | jq -sc '
      map(select(type == "object"))
      | map({
          name: (.Names // .Name // ""),
          state: (
            if (.State // "") | test("^running"; "i") then "running"
            elif (.State // "") | test("^exited"; "i") then "exited"
            else (.State // .Status // "")
            end
          )
        })
      | map(select(.name != ""))
    ' 2>/dev/null || echo '[]')"
  fi

  jq -nc --argjson vms "$vms_json" --argjson containers "$containers_json" \
    '{vms: $vms, containers: $containers}'
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  homelab_discover_unraid
fi
