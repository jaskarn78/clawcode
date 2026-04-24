#!/usr/bin/env bash
# Phase 91 Plan 03 — hourly OpenClaw→ClawCode conversation-turn translator.
#
# Two-step flow:
#   1. rsync ~/.openclaw/agents/fin-acquisition/sessions/ from the OpenClaw
#      host (100.71.14.96, jjagpal user) to a local staging dir on clawdy
#      (~/.clawcode/manager/openclaw-sessions-staging/). Read-only staging
#      keeps the translator orthogonal to 91-01's workspace sync (separate
#      path, separate cadence).
#   2. Invoke `clawcode sync translate-sessions --agent fin-acquisition`
#      (CLI command registered by Plan 91-04). The CLI opens the agent's
#      memories.db, constructs a ConversationStore, and calls
#      translateAllSessions({sessionsDir: staging-path, ...}).
#
# Serialized via flock(1) so two hourly timer firings (if one overruns)
# don't race for the same DB / cursor file.
#
# Exit codes:
#   0  — ran successfully (zero or more turns translated)
#   1  — CLI exited non-zero; systemd journal carries details
#   2  — rsync failed; translation skipped this cycle (retry next hour)

set -euo pipefail

REMOTE_HOST="${CLAWCODE_OPENCLAW_HOST:-jjagpal@100.71.14.96}"
REMOTE_SESSIONS_DIR="${CLAWCODE_OPENCLAW_SESSIONS_DIR:-/home/jjagpal/.openclaw/agents/fin-acquisition/sessions/}"
STAGING_DIR="${CLAWCODE_TRANSLATOR_STAGING_DIR:-${HOME}/.clawcode/manager/openclaw-sessions-staging/}"
LOCK_FILE="${CLAWCODE_TRANSLATOR_LOCK:-${HOME}/.clawcode/manager/translator.lock}"
CLAWCODE_DIR="${CLAWCODE_DIR:-/opt/clawcode}"
SSH_KEY="${CLAWCODE_SSH_KEY:-${HOME}/.ssh/clawcode_sync_ed25519}"

mkdir -p "$(dirname "$LOCK_FILE")"
mkdir -p "$STAGING_DIR"

# Single-writer guard — hourly cadence is well over the expected runtime,
# but a stall scenario (e.g. OpenClaw SSH hung) shouldn't stack invocations.
exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  echo "clawcode-translator: another instance is running; exiting" >&2
  exit 0
fi

# Step 1 — stage sessions from OpenClaw host. Read-only copy; no --delete
# (we want historical files preserved even if OpenClaw rotates them).
if ! rsync \
  -az \
  --partial \
  --timeout=120 \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=10" \
  --include='*.jsonl' \
  --exclude='*' \
  "${REMOTE_HOST}:${REMOTE_SESSIONS_DIR}" \
  "$STAGING_DIR"; then
  echo "clawcode-translator: rsync staging failed; skipping translation this cycle" >&2
  exit 2
fi

# Step 2 — invoke the CLI translator (Plan 91-04 registers this subcommand).
exec node "${CLAWCODE_DIR}/dist/cli/index.js" sync translate-sessions --agent fin-acquisition
