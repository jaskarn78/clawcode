#!/usr/bin/env bash
# scripts/homelab/lib/diff-and-quarantine.sh
#
# Reconciles live-discovery JSON against INVENTORY.md anchors. Three outputs:
#
#   1. For every anchor present in BOTH inventory + discovery:
#      rewrite its <!-- refresh.sh: managed --> block in-place with
#      status: ok / last_seen: <iso> / source: <command>.
#
#   2. For every anchor present in inventory but NOT in discovery (stale):
#      rewrite its <!-- refresh.sh: managed --> block with
#      status: unreachable since <iso> (D-04b — NEVER delete).
#
#   3. For every discovered item NOT in any inventory anchor (drift):
#      append a row to DRIFT.md's `## Drift Items` section with an
#      HTML-comment dedup marker `<!-- drift:<source>:<id> -->` and the
#      raw payload (D-04a).
#
# CRITICAL INVARIANT (T-99947-11): bytes outside the
# `<!-- refresh.sh: managed --> ... <!-- end refresh.sh: managed -->`
# markers are NEVER modified. All rewrites are scoped via the awk state
# machine to the in-block region. Operator-written Stable Facts are
# untouched.
#
# Inputs (CLI args):
#   --repo <path>             — homelab repo root (default $HOMELAB_REPO)
#   --tailscale-json <file>   — { hosts: [{name,ip,os,lastSeen}] }
#   --unraid-json <file>      — { vms: [{name,state}], containers: [{name,state}] }
#   --tunnels-json <file>     — { tunnels: [{name,hostname}] }
#   --op-json <file>          — { items: [{id,title}] }
#   --counts-out <file>       — JSON line written with { driftCount, staleCount }
#
# Discovery items emit normalized identifiers via this mapping:
#   tailscale host name → "host: <name>"  (case-insensitive, hyphenated)
#   virsh vm name       → "vm: <name>"
#   docker name         → "container: <name>"
#   tunnel name         → drift only (NETWORK.md tunnels live in a shared block)
#   op item             → drift only (no inventory anchors for op items yet)
#
# Identifier matching: anchor names are compared case-insensitively after
# stripping non-alphanumeric chars (so "Windows11-Min" in INVENTORY matches
# virsh's "Windows11-Min" or "windows11-min").

set -euo pipefail

# shellcheck disable=SC1091  # source path is dynamic
# shellcheck source=lib/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"

# Normalize an identifier: lowercase + drop everything not [a-z0-9].
__hl_norm() {
  local s="${1:-}"
  printf '%s' "${s}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'
}

homelab_diff_and_quarantine() {
  local repo="" ts_json="" unraid_json="" counts_out=""
  # tunnels_json + op_json are accepted for forward-compat but not used in
  # v1's quarantine logic — tunnels/op items have no inventory anchors so
  # they don't compute drift here. The orchestrator (refresh.sh) reads
  # tunnels.json directly to populate tunnelCount in the schema.

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)           repo="$2"; shift 2;;
      --tailscale-json) ts_json="$2"; shift 2;;
      --unraid-json)    unraid_json="$2"; shift 2;;
      --tunnels-json)   shift 2;;  # accepted, not used in v1
      --op-json)        shift 2;;  # accepted, not used in v1
      --counts-out)     counts_out="$2"; shift 2;;
      *) echo "diff-and-quarantine: unknown arg '$1'" >&2; return 2;;
    esac
  done

  repo="${repo:-${HOMELAB_REPO:?HOMELAB_REPO required}}"
  local inventory="${repo}/INVENTORY.md"
  local drift="${repo}/DRIFT.md"
  [[ -f "$inventory" ]] || { echo "INVENTORY.md missing at $inventory" >&2; return 1; }
  [[ -f "$drift" ]] || { echo "DRIFT.md missing at $drift" >&2; return 1; }

  local ts
  ts="$(homelab_iso_ts)"

  # ---- Build canonical maps from discovery JSON --------------------------
  # Map shape: normalized-id → "display-name|source-cmd"
  declare -A discovered_hosts discovered_vms discovered_containers
  # Drift list — raw rows we'll append to DRIFT.md if not matched.
  local -a drift_rows=()

  # Tailscale hosts
  if [[ -n "$ts_json" && -f "$ts_json" ]]; then
    while IFS=$'\t' read -r name _ip _os; do
      [[ -z "$name" ]] && continue
      local k; k="$(__hl_norm "$name")"
      discovered_hosts["$k"]="${name}|tailscale status --json"
    done < <(jq -r '.hosts[] | [.name, .ip, .os] | @tsv' <"$ts_json")
  fi

  # Unraid VMs + containers
  if [[ -n "$unraid_json" && -f "$unraid_json" ]]; then
    while IFS=$'\t' read -r name state; do
      [[ -z "$name" ]] && continue
      local k; k="$(__hl_norm "$name")"
      discovered_vms["$k"]="${name}|virsh list --all|${state}"
    done < <(jq -r '.vms[] | [.name, .state] | @tsv' <"$unraid_json")
    while IFS=$'\t' read -r name state; do
      [[ -z "$name" ]] && continue
      local k; k="$(__hl_norm "$name")"
      discovered_containers["$k"]="${name}|docker ps -a|${state}"
    done < <(jq -r '.containers[] | [.name, .state] | @tsv' <"$unraid_json")
  fi

  # ---- Walk INVENTORY.md, identify anchored items + rewrite managed blocks -
  # The awk script:
  #   1. Tracks managed-block state via the open/close marker pair.
  #   2. Inside a managed block, reads the discriminator key (first non-marker
  #      line: "host: <name>" / "vm: <name>" / "container: <name>" / "service: <name>").
  #   3. Looks up the normalized name in the in-band MATCH_* environment.
  #      Match = rewrite the block with new status/last_seen/source.
  #      No match = mark unreachable since <ts>.
  #   4. Bytes outside the marker pair pass through verbatim — Test 8 invariant.

  # Build the lookup payload — name=status pairs for each kind.
  # We pass three TSV blobs via env vars; awk parses them.
  __hl_pairs_for() {
    local -n map=$1
    local k
    for k in "${!map[@]}"; do
      IFS='|' read -r dispname src state <<<"${map[$k]}"
      # If state is provided + not "running" / "ok", treat as stale-like
      # (so e.g. "shut off" VMs surface as unreachable in the managed block).
      printf '%s\t%s\t%s\t%s\n' "$k" "$dispname" "$src" "${state:-running}"
    done
  }

  local host_pairs vm_pairs container_pairs
  host_pairs="$(__hl_pairs_for discovered_hosts)"
  vm_pairs="$(__hl_pairs_for discovered_vms)"
  container_pairs="$(__hl_pairs_for discovered_containers)"

  # Run awk to rewrite. Tracks matched-anchor keys in a sentinel file so the
  # drift step can subtract them from the discovery set.
  local matched_file; matched_file="$(mktemp)"
  local inv_tmp; inv_tmp="${inventory}.tmp.$$"

  HOMELAB_TS="$ts" \
  HOMELAB_HOST_PAIRS="$host_pairs" \
  HOMELAB_VM_PAIRS="$vm_pairs" \
  HOMELAB_CONTAINER_PAIRS="$container_pairs" \
  HOMELAB_MATCHED_OUT="$matched_file" \
    awk '
    function norm(s,    out) {
      out = tolower(s)
      gsub(/[^a-z0-9]/, "", out)
      return out
    }
    function load_pairs(blob, dest,    n, lines, i, parts) {
      if (length(blob) == 0) return
      n = split(blob, lines, "\n")
      for (i=1; i<=n; i++) {
        if (length(lines[i]) == 0) continue
        split(lines[i], parts, "\t")
        dest[parts[1] "|name"] = parts[2]
        dest[parts[1] "|src"]  = parts[3]
        dest[parts[1] "|state"]= parts[4]
      }
    }
    BEGIN {
      ts        = ENVIRON["HOMELAB_TS"]
      matched   = ENVIRON["HOMELAB_MATCHED_OUT"]
      load_pairs(ENVIRON["HOMELAB_HOST_PAIRS"],      hosts)
      load_pairs(ENVIRON["HOMELAB_VM_PAIRS"],        vms)
      load_pairs(ENVIRON["HOMELAB_CONTAINER_PAIRS"], containers)
      in_block = 0
      buf_n = 0
    }
    {
      if (in_block == 0 && $0 ~ /^<!-- refresh\.sh: managed -->$/) {
        in_block = 1
        delete buf
        buf_n = 0
        buf[++buf_n] = $0
        next
      }
      if (in_block == 1) {
        buf[++buf_n] = $0
        if ($0 ~ /^<!-- end refresh\.sh: managed -->$/) {
          # Find discriminator inside buf[2..buf_n-1].
          kind = ""; name = ""
          for (i=2; i<=buf_n-1; i++) {
            line = buf[i]
            if (line ~ /^host:[[:space:]]/) { kind="host"; name=substr(line, index(line, ":")+1); break }
            if (line ~ /^vm:[[:space:]]/)        { kind="vm";        name=substr(line, index(line, ":")+1); break }
            if (line ~ /^container:[[:space:]]/) { kind="container"; name=substr(line, index(line, ":")+1); break }
            if (line ~ /^service:[[:space:]]/)   { kind="service";   name=substr(line, index(line, ":")+1); break }
            if (line ~ /^domain:[[:space:]]/)    { kind="domain";    name=substr(line, index(line, ":")+1); break }
          }
          # Trim whitespace from name.
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
          key = norm(name)
          # Pick the right map.
          new_status = ""; new_source = ""; matched_here = 0
          if (kind == "host" && (key "|name") in hosts) {
            new_status="ok"; new_source=hosts[key "|src"]; matched_here=1
            print key >> matched
          } else if (kind == "vm" && (key "|name") in vms) {
            state = vms[key "|state"]
            if (state == "running") new_status="ok"; else new_status="unreachable since " ts
            new_source=vms[key "|src"]; matched_here=1
            print key >> matched
          } else if (kind == "container" && (key "|name") in containers) {
            state = containers[key "|state"]
            if (state == "running") new_status="ok"; else new_status="unreachable since " ts
            new_source=containers[key "|src"]; matched_here=1
            print key >> matched
          } else if (kind == "service") {
            # Services not discovered live in v1 — leave block untouched but
            # still rewrite to retain consistent field order. Mark unreachable
            # if no live signal (operator-edits the Stable Facts; live status
            # comes from a future plan).
            new_status = "unreachable since " ts
            new_source = "no-live-poller"
          } else if (kind == "domain") {
            # Same as service — placeholder for the NETWORK.md shared block.
            new_status = "ok"
            new_source = "operator-stable"
          } else {
            # No kind / no match — mark stale.
            new_status = "unreachable since " ts
            new_source = "no-live-signal"
          }
          # Idempotency: if the prior block has the same status and source as
          # the newly-computed values, preserve the prior last_seen. This
          # gives refresh.sh the noDiff:true property on stable inputs.
          #
          # Special case (D-04b stale-down freeze): once a block has been
          # flagged "unreachable since <ts>", subsequent runs that produce
          # the same unreachable verdict must preserve the ORIGINAL "since"
          # timestamp — otherwise the operator-visible "when did this first
          # go away" data point would shift on every tick. We achieve this
          # by treating any prior "unreachable since *" status as equivalent
          # to the newly-computed "unreachable since ts" status, and freezing
          # both the status text AND last_seen to the prior values.
          prior_status = ""; prior_source = ""; prior_last_seen = ""
          for (i=2; i<=buf_n-1; i++) {
            line = buf[i]
            if (line ~ /^status:[[:space:]]/) {
              prior_status = substr(line, index(line, ":") + 2)
            } else if (line ~ /^source:[[:space:]]/) {
              prior_source = substr(line, index(line, ":") + 2)
            } else if (line ~ /^last_seen:[[:space:]]/) {
              prior_last_seen = substr(line, index(line, ":") + 2)
            }
          }
          new_status_is_unreachable = (new_status ~ /^unreachable since /)
          prior_status_is_unreachable = (prior_status ~ /^unreachable since /)
          status_equivalent = (prior_status == new_status) \
            || (new_status_is_unreachable && prior_status_is_unreachable)
          if (status_equivalent \
              && prior_source == new_source \
              && prior_last_seen != "" \
              && prior_last_seen != "not-yet-refreshed") {
            new_last_seen = prior_last_seen
            # When both prior and new are unreachable, freeze the "since" ts
            # to the prior value so the operator sees when it first went away.
            if (new_status_is_unreachable && prior_status_is_unreachable) {
              new_status = prior_status
            }
          } else {
            new_last_seen = ts
          }

          # Rewrite buf with the new status/last_seen/source while preserving
          # the discriminator line.
          print buf[1]                                    # open marker
          for (i=2; i<=buf_n-1; i++) {
            line = buf[i]
            if (line ~ /^status:/)    { print "status: " new_status; continue }
            if (line ~ /^last_seen:/) { print "last_seen: " new_last_seen; continue }
            if (line ~ /^source:/)    { print "source: " new_source; continue }
            print line
          }
          print buf[buf_n]                                # close marker
          in_block = 0
          next
        }
        next
      }
      print
    }
  ' "$inventory" >"$inv_tmp"

  mv -f -- "$inv_tmp" "$inventory"

  # ---- Compute matched counts (intersection of inventory + discovery) ----
  # matched_file lines are the normalized inventory keys that the awk pass
  # marked status: ok. We count per-kind by intersecting the matched keys
  # with each discovered_* map.
  local matched_hosts=0 matched_vms=0 matched_containers=0
  if [[ -s "$matched_file" ]]; then
    local mk
    while IFS= read -r mk; do
      [[ -z "$mk" ]] && continue
      if [[ -n "${discovered_hosts[$mk]:-}" ]]; then
        matched_hosts=$((matched_hosts + 1))
      elif [[ -n "${discovered_vms[$mk]:-}" ]]; then
        matched_vms=$((matched_vms + 1))
      elif [[ -n "${discovered_containers[$mk]:-}" ]]; then
        matched_containers=$((matched_containers + 1))
      fi
    done <"$matched_file"
  fi

  # ---- Compute drift: discovered host/vm/container keys not matched ------
  # Drift markers are SOURCE-keyed (drift:<source>:<display-name>) so they
  # encode the discovery command that surfaced the entry. Test 2 and Test 7
  # of refresh.test.ts pin this format.
  #
  # Tunnels + op items are NOT filed to DRIFT.md in v1 — they have no
  # inventory comparison surface (no anchors for them in INVENTORY.md). They
  # surface via journalctl `tunnelCount` instead. tunnelCount in the schema
  # carries the raw count.
  __hl_emit_drift_for_kind() {
    local source_key="$1"  # "tailscale" / "virsh" / "docker"
    local -n map=$2
    local k
    for k in "${!map[@]}"; do
      [[ -z "$k" ]] && continue
      if grep -qxF "$k" "$matched_file" 2>/dev/null; then
        continue
      fi
      local v="${map[$k]}"
      local dispname="${v%%|*}"
      local rest="${v#*|}"
      local src="${rest%%|*}"
      drift_rows+=("${source_key}|${dispname}|${src}")
    done
  }

  __hl_emit_drift_for_kind tailscale discovered_hosts
  __hl_emit_drift_for_kind virsh     discovered_vms
  __hl_emit_drift_for_kind docker    discovered_containers

  # ---- Apply dedup against existing drift markers ------------------------
  local final_drift_count=0
  if [[ ${#drift_rows[@]} -gt 0 ]]; then
    local drift_append_tmp; drift_append_tmp="$(mktemp)"
    local row
    for row in "${drift_rows[@]}"; do
      IFS='|' read -r source_key name src <<<"$row"
      local marker="<!-- drift:${source_key}:${name} -->"
      if grep -qF "$marker" "$drift" 2>/dev/null; then
        continue
      fi
      {
        printf '\n%s\n' "$marker"
        # backticks here are literal markdown inline-code fences around the name.
        # shellcheck disable=SC2016  # backticks are literal markdown, not command-substitution
        printf -- '- **%s** `%s` discovered=%s source=%s\n' \
          "$source_key" "$name" "$ts" "$src"
      } >>"$drift_append_tmp"
      final_drift_count=$((final_drift_count + 1))
    done
    if [[ -s "$drift_append_tmp" ]]; then
      # Append below the `## Drift Items` header.
      local drift_tmp; drift_tmp="${drift}.tmp.$$"
      awk -v payload_file="$drift_append_tmp" '
        BEGIN { appended = 0 }
        {
          print
          if (!appended && $0 ~ /^## Drift Items[[:space:]]*$/) {
            while ((getline line < payload_file) > 0) print line
            close(payload_file)
            appended = 1
          }
        }
      ' "$drift" >"$drift_tmp"
      mv -f -- "$drift_tmp" "$drift"
    fi
    rm -f -- "$drift_append_tmp"
  fi

  # Stale count = anchors that exist but weren't matched. We re-scan the
  # rewritten INVENTORY.md for `status: unreachable since` lines.
  local stale_count
  stale_count="$(grep -c '^status: unreachable since' "$inventory" 2>/dev/null || echo 0)"

  rm -f -- "$matched_file"

  if [[ -n "$counts_out" ]]; then
    jq -nc \
      --argjson driftCount "$final_drift_count" \
      --argjson staleCount "$stale_count" \
      --argjson matchedHosts "$matched_hosts" \
      --argjson matchedVms "$matched_vms" \
      --argjson matchedContainers "$matched_containers" \
      '{
         driftCount: $driftCount,
         staleCount: $staleCount,
         matchedHosts: $matchedHosts,
         matchedVms: $matchedVms,
         matchedContainers: $matchedContainers
       }' >"$counts_out"
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  homelab_diff_and_quarantine "$@"
fi
