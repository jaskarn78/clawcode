#!/usr/bin/env bash
#
# Phase 999.47 Plan 04 Task 2 — fleet-wide MEMORY.md homelab-pointer backfill.
#
# Idempotent operator-gated one-shot seeder. Enumerates every agent workspace
# under ~/.clawcode/agents (override via --agents-dir), and ensures each
# agent's MEMORY.md contains the verbatim homelab pointer line:
#
#   - [Homelab inventory](/home/clawcode/homelab/INVENTORY.md) — canonical source of truth for hosts, VMs, containers, access
#
# Per-agent decision tree:
#   - MEMORY.md missing               -> create with "# Memory\n\n<pointer>\n"
#                                        (action=created)
#   - MEMORY.md present, pointer found -> no-op (action=skip)
#   - MEMORY.md present, pointer missing -> atomic temp+rename append
#                                            (action=appended)
#
# Hard rules (Phase 999.47 D-03 + Ramy-active deploy hold):
#   - This script is APPEND-ONLY. It never touches any running process and
#     never invokes any process-management tooling. Ramy-safe by design.
#   - No in-place stream-editor writes on production files (race window
#     between truncate and rewrite). Use atomic temp+rename instead.
#   - Touch ONLY MEMORY.md — never SOUL.md, IDENTITY.md, USER.md, or other.
#   - Re-runs on a seeded fleet are no-ops (grep -Fxq exact-line check).
#
# Usage:
#   bash scripts/homelab/seed-memory-pointer.sh                    # live
#   bash scripts/homelab/seed-memory-pointer.sh --dry-run          # plan only
#   bash scripts/homelab/seed-memory-pointer.sh --agents-dir DIR   # override
#                                                                  # (for tests)
#
# Structured-log tag for operator grep:
#   phase999.47-homelab-seed-pointer

set -euo pipefail

# ─── Constants ────────────────────────────────────────────────────────────────

# Verbatim pointer line — single-sourced with src/config/defaults.ts
# HOMELAB_POINTER_LINE. The em-dash and trailing text are part of the
# contract — DO NOT paraphrase. The grep -Fxq exact-line idempotency
# check below depends on this byte-for-byte match.
readonly POINTER_LINE='- [Homelab inventory](/home/clawcode/homelab/INVENTORY.md) — canonical source of truth for hosts, VMs, containers, access'

# Default MEMORY.md template for the create-missing path — mirrors
# DEFAULT_MEMORY_TEMPLATE in src/config/defaults.ts so the two surfaces
# converge on the same byte layout.
readonly DEFAULT_HEADER='# Memory'

readonly LOG_TAG='phase999.47-homelab-seed-pointer'

# ─── Argument parsing ────────────────────────────────────────────────────────

AGENTS_DIR="${HOME}/.clawcode/agents"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --agents-dir)
      if [ $# -lt 2 ]; then
        echo "ERROR: --agents-dir requires a path argument" >&2
        exit 2
      fi
      AGENTS_DIR="$2"
      shift 2
      ;;
    --agents-dir=*)
      AGENTS_DIR="${1#--agents-dir=}"
      shift
      ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      echo "Usage: $0 [--dry-run] [--agents-dir DIR]" >&2
      exit 2
      ;;
  esac
done

# ─── Sweep counters ──────────────────────────────────────────────────────────

total=0
created=0
appended=0
already_had=0
errors=0
failed_agents=()

emit_action() {
  # Structured per-agent JSON-ish line — easy to grep without a JSON parser.
  local agent="$1"
  local action="$2"
  local reason="${3:-}"
  if [ -n "$reason" ]; then
    echo "${LOG_TAG} {\"agent\":\"${agent}\",\"action\":\"${action}\",\"reason\":\"${reason}\",\"dryRun\":${DRY_RUN}}"
  else
    echo "${LOG_TAG} {\"agent\":\"${agent}\",\"action\":\"${action}\",\"dryRun\":${DRY_RUN}}"
  fi
}

# ─── Validate agents dir ─────────────────────────────────────────────────────

if [ ! -d "$AGENTS_DIR" ]; then
  # Empty/missing agents dir is not an error — fleet may simply be empty.
  # Emit a single structured summary and exit 0.
  echo "${LOG_TAG} {\"totalAgents\":0,\"seeded\":0,\"alreadyHad\":0,\"created\":0,\"errors\":0,\"reason\":\"agents-dir-missing\",\"agentsDir\":\"${AGENTS_DIR}\"}"
  exit 0
fi

# ─── Per-agent loop ──────────────────────────────────────────────────────────

# Enumerate top-level agent directories. Null-delimited to tolerate exotic
# names (unlikely under ~/.clawcode/agents, but cheap insurance).
while IFS= read -r -d '' agent_dir; do
  total=$((total + 1))
  agent_name="$(basename "$agent_dir")"
  memory_file="${agent_dir}/MEMORY.md"

  if [ ! -e "$memory_file" ]; then
    # Create-missing path
    if [ "$DRY_RUN" -eq 1 ]; then
      emit_action "$agent_name" "would-create"
      created=$((created + 1))
    else
      tmp_file="${memory_file}.tmp.$$"
      if printf '%s\n\n%s\n' "$DEFAULT_HEADER" "$POINTER_LINE" > "$tmp_file" \
         && mv -f "$tmp_file" "$memory_file"; then
        emit_action "$agent_name" "created"
        created=$((created + 1))
      else
        emit_action "$agent_name" "error" "create-failed"
        errors=$((errors + 1))
        failed_agents+=("$agent_name")
        rm -f "$tmp_file" 2>/dev/null || true
      fi
    fi
    continue
  fi

  # MEMORY.md exists — check for the pointer line using exact-line literal
  # match (grep -Fxq: -F = fixed string, -x = whole line, -q = silent).
  #
  # Rule 1 fix: the pointer line starts with "- ", which grep would otherwise
  # parse as an option flag. Pass the pattern via "-e --" so the leading dash
  # is unambiguously the pattern, and "--" terminates option parsing before
  # the filename argument.
  if grep -Fxq -e "$POINTER_LINE" -- "$memory_file"; then
    emit_action "$agent_name" "skip" "already-seeded"
    already_had=$((already_had + 1))
    continue
  fi

  # Pointer missing — atomic append.
  if [ "$DRY_RUN" -eq 1 ]; then
    emit_action "$agent_name" "would-append"
    appended=$((appended + 1))
    continue
  fi

  tmp_file="${memory_file}.tmp.$$"
  # Build the new content: original body, then a separator (leading newline
  # if the file doesn't already end with one), then the pointer line +
  # trailing newline.
  if cp -- "$memory_file" "$tmp_file"; then
    # Ensure separator so the pointer lands on its own list line.
    if [ -s "$tmp_file" ]; then
      # Append a leading newline only when the file doesn't end with one.
      # Use tail -c1 to inspect the last byte.
      last_byte="$(tail -c 1 "$tmp_file" || true)"
      if [ "$last_byte" != "" ] && [ "$last_byte" != $'\n' ]; then
        printf '\n' >> "$tmp_file"
      fi
    fi
    printf '%s\n' "$POINTER_LINE" >> "$tmp_file"
    if mv -f "$tmp_file" "$memory_file"; then
      emit_action "$agent_name" "appended"
      appended=$((appended + 1))
    else
      emit_action "$agent_name" "error" "rename-failed"
      errors=$((errors + 1))
      failed_agents+=("$agent_name")
      rm -f "$tmp_file" 2>/dev/null || true
    fi
  else
    emit_action "$agent_name" "error" "copy-failed"
    errors=$((errors + 1))
    failed_agents+=("$agent_name")
  fi

done < <(find "$AGENTS_DIR" -maxdepth 1 -mindepth 1 -type d -print0 2>/dev/null)

# ─── Summary ─────────────────────────────────────────────────────────────────

seeded=$((created + appended))

echo "${LOG_TAG} {\"totalAgents\":${total},\"seeded\":${seeded},\"alreadyHad\":${already_had},\"created\":${created},\"appended\":${appended},\"errors\":${errors},\"dryRun\":${DRY_RUN}}"

if [ "$errors" -gt 0 ]; then
  echo "ERROR: ${errors} agent(s) failed: ${failed_agents[*]}" >&2
  exit 1
fi

exit 0
