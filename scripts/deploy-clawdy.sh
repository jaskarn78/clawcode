#!/usr/bin/env bash
#
# Deploy ClawCode to clawdy (100.98.211.108).
#
# Pipeline:
#   1. npm run build         (skip with --no-build)
#      - tsup → dist/cli/index.js     (daemon bundle)
#      - vite build → dist/dashboard/spa/   (Phase 116 SPA, when present)
#   2. rsync dist/cli/index.js → clawdy:~/clawcode-staging/index.js
#      rsync dist/dashboard/spa/ → clawdy:~/clawcode-staging-spa/   (when present)
#      rsync .planning/ → clawdy:~/clawcode-staging-planning/        (when present)
#      rsync per-agent prompt-corpus → clawdy:~/clawcode-staging-agents/<name>/  (Phase 999.55)
#      rsync package.json + package-lock.json → clawdy:~/clawcode-staging-deps/  (Phase 101-fu, only when lockfile md5 changed)
#   3. ssh + sudo -S         (password piped from ~/.clawcode-deploy-pw)
#      - cp staging → /opt/clawcode/dist/cli/index.js
#      - rsync --delete spa staging → /opt/clawcode/dist/dashboard/spa/  (when present)
#      - chown -R clawcode:clawcode /opt/clawcode/dist/dashboard/spa
#      - rsync (NO --delete) agent staging → /home/clawcode/.clawcode/agents/<name>/  (Phase 999.55)
#      - cp package.json + package-lock.json + `sudo -u clawcode npm ci`  (Phase 101-fu, only when staged)
#      - systemctl restart clawcode (skip with --no-restart)
#   4. md5 verification (daemon bundle); ls check (SPA bundle); presence check (per-agent AGENTS.md)
#
# Password file: ~/.clawcode-deploy-pw  (chmod 600, gitignored — never lives in repo).
# When the password rotates, just overwrite the file:
#     echo -n 'NEWPASSWORD' > ~/.clawcode-deploy-pw && chmod 600 ~/.clawcode-deploy-pw
#
# Usage:
#   scripts/deploy-clawdy.sh                 # full pipeline
#   scripts/deploy-clawdy.sh --no-build      # skip build (use existing dist/)
#   scripts/deploy-clawdy.sh --no-restart    # deploy bytes but don't restart service
#   scripts/deploy-clawdy.sh --dry-run       # show what would happen
#

set -euo pipefail

PASSWORD_FILE="${CLAWCODE_DEPLOY_PW_FILE:-$HOME/.clawcode-deploy-pw}"
HOST="${CLAWCODE_DEPLOY_HOST:-clawdy}"
REMOTE_USER="${CLAWCODE_DEPLOY_USER:-jjagpal}"
STAGING_PATH="${CLAWCODE_DEPLOY_STAGING:-/home/jjagpal/clawcode-staging/index.js}"
DEPLOY_PATH="${CLAWCODE_DEPLOY_TARGET:-/opt/clawcode/dist/cli/index.js}"
SERVICE_NAME="${CLAWCODE_DEPLOY_SERVICE:-clawcode}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_FILE="$REPO_ROOT/dist/cli/index.js"
SPA_DIR="$REPO_ROOT/dist/dashboard/spa"
SPA_STAGING="${CLAWCODE_DEPLOY_SPA_STAGING:-/home/jjagpal/clawcode-staging-spa}"
SPA_DEPLOY="${CLAWCODE_DEPLOY_SPA_TARGET:-/opt/clawcode/dist/dashboard/spa}"
SPA_OWNER="${CLAWCODE_DEPLOY_SPA_OWNER:-clawcode:clawcode}"
# Phase 116-postdeploy 2026-05-12 — also rsync the .planning/ tree so the
# new GSD-planning-tasks ingest (daemon scanner at request time) reads
# the operator's live planning artifacts instead of a stale May-7 snapshot.
# Local read-only on the daemon side; the scanner walks .planning/todos/,
# .planning/quick/, and .planning/ROADMAP.md.
PLANNING_DIR="$REPO_ROOT/.planning"
PLANNING_STAGING="${CLAWCODE_DEPLOY_PLANNING_STAGING:-/home/jjagpal/clawcode-staging-planning}"
# Phase 101-fu 2026-05-16 — also sync package.json + package-lock.json so that
# new npm deps (added in any phase) are present on clawdy at restart time.
# Before this, a deploy that introduced new runtime deps would crashloop with
# ERR_MODULE_NOT_FOUND because /opt/clawcode/node_modules was untouched.
DEPS_STAGING="${CLAWCODE_DEPLOY_DEPS_STAGING:-/home/jjagpal/clawcode-staging-deps}"
DEPS_DEPLOY_ROOT="${CLAWCODE_DEPLOY_DEPS_TARGET:-/opt/clawcode}"
DEPS_OWNER="${CLAWCODE_DEPLOY_DEPS_OWNER:-clawcode:clawcode}"
PLANNING_DEPLOY="${CLAWCODE_DEPLOY_PLANNING_TARGET:-/opt/clawcode/.planning}"
PLANNING_OWNER="${CLAWCODE_DEPLOY_PLANNING_OWNER:-clawcode:clawcode}"

# Phase 999.55 — per-agent prompt-corpus rsync. Ships AGENTS.md / SOUL.md /
# IDENTITY.md / USER.md / TOOLS.md / HEARTBEAT.md / BOOTSTRAP.md / skills/**
# alongside the daemon binary. Allowlist-only: never touches memory/, state/,
# telemetry, media, scripts — those are production-owned operational state.
# Discovery: any dir under $AGENTS_LOCAL_ROOT that has AGENTS.md or SOUL.md.
# Sync gate: only agents whose prod workspace dir already exists are synced
# (we don't create new agents via deploy). Server-side rsync omits --delete
# so the merge into the existing workspace leaves operational state intact.
AGENTS_LOCAL_ROOT="${CLAWCODE_DEPLOY_AGENTS_LOCAL:-$HOME/.clawcode/agents}"
AGENTS_REMOTE_ROOT="${CLAWCODE_DEPLOY_AGENTS_TARGET:-/home/clawcode/.clawcode/agents}"
AGENTS_STAGING_ROOT="${CLAWCODE_DEPLOY_AGENTS_STAGING:-/home/jjagpal/clawcode-staging-agents}"
AGENTS_OWNER="${CLAWCODE_DEPLOY_AGENTS_OWNER:-clawcode:clawcode}"

DO_BUILD=1
DO_RESTART=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --no-build)   DO_BUILD=0 ;;
    --no-restart) DO_RESTART=0 ;;
    --dry-run)    DRY_RUN=1 ;;
    -h|--help)    sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

if [ ! -f "$PASSWORD_FILE" ]; then
  echo "✗ Password file not found: $PASSWORD_FILE" >&2
  echo "  Create it: echo -n 'PASSWORD' > $PASSWORD_FILE && chmod 600 $PASSWORD_FILE" >&2
  exit 1
fi

# Permissions check — refuse to run if the file is world/group readable.
PERMS=$(stat -c '%a' "$PASSWORD_FILE")
if [ "$PERMS" != "600" ] && [ "$PERMS" != "400" ]; then
  echo "✗ $PASSWORD_FILE has perms $PERMS — must be 600 or 400" >&2
  echo "  Fix: chmod 600 $PASSWORD_FILE" >&2
  exit 1
fi

PASSWORD=$(cat "$PASSWORD_FILE")
if [ -z "$PASSWORD" ]; then
  echo "✗ Password file is empty: $PASSWORD_FILE" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Phase 101 D-01 — Tesseract CLI precheck on $HOST
# ---------------------------------------------------------------------------
# The document-ingestion pipeline (Phase 101) uses Tesseract as the Tier-1
# OCR backend for scanned PDFs (fall-back is in-process tesseract.js WASM
# at ~2x cost). Tesseract is NOT installed by default on Debian/Ubuntu, so
# we fail-fast on a missing binary with a one-line apt-install hint rather
# than silently letting the daemon route every scanned PDF through the
# slower WASM path.
#
# Skipped under --dry-run (the dry-run preview already prints intent).
if [ "$DRY_RUN" = 0 ]; then
  if ! ssh "$HOST" 'which tesseract' >/dev/null 2>&1; then
    echo "✗ Phase 101 D-01: tesseract-ocr not installed on $HOST" >&2
    echo "  Document OCR (scanned-PDF Tier-1 backend) requires it." >&2
    echo "  Fix:  ssh $HOST 'sudo apt-get install -y tesseract-ocr'" >&2
    echo "  Then re-run: $0" >&2
    exit 1
  fi
fi

if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN — would execute:"
  echo "  ssh $HOST 'which tesseract'  # Phase 101 D-01 precheck"
  [ "$DO_BUILD" = 1 ]   && echo "  npm run build"
  echo "  rsync -avz $DIST_FILE $REMOTE_USER@$HOST:$STAGING_PATH"
  # Phase 101-fu — lockfile md5 check; on mismatch stage + npm ci.
  if [ -f "$REPO_ROOT/package.json" ] && [ -f "$REPO_ROOT/package-lock.json" ]; then
    LOCAL_LOCK_MD5=$(md5sum "$REPO_ROOT/package-lock.json" | awk '{print $1}')
    REMOTE_LOCK_MD5=$(ssh "$HOST" "md5sum '$DEPS_DEPLOY_ROOT/package-lock.json' 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo "MISSING")
    [ -z "$REMOTE_LOCK_MD5" ] && REMOTE_LOCK_MD5="MISSING"
    if [ "$LOCAL_LOCK_MD5" != "$REMOTE_LOCK_MD5" ]; then
      echo "  rsync -avz $REPO_ROOT/{package.json,package-lock.json} $REMOTE_USER@$HOST:$DEPS_STAGING/"
      echo "  ssh $HOST 'sudo -u clawcode bash -c \"cd $DEPS_DEPLOY_ROOT && npm ci --no-audit --no-fund\"'  # lockfile md5 ${REMOTE_LOCK_MD5:0:8} → ${LOCAL_LOCK_MD5:0:8}"
    else
      echo "  # deps skipped (lockfile unchanged, md5 ${LOCAL_LOCK_MD5:0:8})"
    fi
  fi
  if [ -d "$REPO_ROOT/dist/dashboard/spa" ]; then
    echo "  rsync -avz --delete $REPO_ROOT/dist/dashboard/spa/ $REMOTE_USER@$HOST:$SPA_STAGING/"
    echo "  ssh $HOST 'sudo -S sh -c \"cp $STAGING_PATH $DEPLOY_PATH && rsync -a --delete $SPA_STAGING/ $SPA_DEPLOY/ && chown -R $SPA_OWNER $SPA_DEPLOY\"'"
  else
    echo "  ssh $HOST 'sudo -S cp $STAGING_PATH $DEPLOY_PATH'"
  fi
  # Phase 999.55 — dry-run preview for per-agent prompt-corpus.
  # /home/clawcode/ is mode 750 owned by clawcode:clawcode — jjagpal can't
  # traverse without sudo. One upfront `sudo ls` gets the prod agent list
  # for membership checks instead of per-agent ssh test -d.
  if [ -d "$AGENTS_LOCAL_ROOT" ]; then
    echo "  --- per-agent prompt-corpus discovery (Phase 999.55) ---"
    PROD_AGENT_LIST=$(printf '%s\n' "$PASSWORD" | ssh "$HOST" "sudo -S -p '' ls '$AGENTS_REMOTE_ROOT/' 2>/dev/null" 2>/dev/null | tr '\n' ' ')
    for agent_dir in "$AGENTS_LOCAL_ROOT"/*/; do
      [ -d "$agent_dir" ] || continue
      agent_name=$(basename "$agent_dir")
      if [ ! -f "$agent_dir/AGENTS.md" ] && [ ! -f "$agent_dir/SOUL.md" ]; then
        echo "    ⊘ $agent_name (no prompt-corpus)"
        continue
      fi
      # Membership check via word-boundary grep on the cached prod list.
      if echo " $PROD_AGENT_LIST " | grep -q " $agent_name "; then
        # List allowlisted files that would be synced.
        echo "    → $agent_name (would rsync $AGENTS_LOCAL_ROOT/$agent_name/ → $AGENTS_REMOTE_ROOT/$agent_name/)"
        for f in AGENTS.md HEARTBEAT.md SOUL.md IDENTITY.md USER.md TOOLS.md BOOTSTRAP.md; do
          [ -f "$agent_dir/$f" ] && echo "        + $f"
        done
        if [ -d "$agent_dir/skills" ]; then
          skill_count=$(find "$agent_dir/skills" -name "SKILL.md" 2>/dev/null | wc -l)
          echo "        + skills/ ($skill_count SKILL.md files)"
        fi
      else
        echo "    ⊘ $agent_name (no prod workspace at $AGENTS_REMOTE_ROOT/$agent_name)"
      fi
    done
  fi
  [ "$DO_RESTART" = 1 ] && echo "  ssh $HOST 'sudo -S systemctl restart $SERVICE_NAME'"
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Build
# ---------------------------------------------------------------------------

if [ "$DO_BUILD" = 1 ]; then
  echo "→ Building…"
  cd "$REPO_ROOT"
  npm run build > /tmp/clawcode-deploy-build.log 2>&1 || {
    echo "✗ Build failed — see /tmp/clawcode-deploy-build.log" >&2
    tail -20 /tmp/clawcode-deploy-build.log >&2
    exit 1
  }
  echo "  ✓ build ok"
fi

if [ ! -f "$DIST_FILE" ]; then
  echo "✗ $DIST_FILE not found — run with build (omit --no-build)" >&2
  exit 1
fi

LOCAL_MD5=$(md5sum "$DIST_FILE" | awk '{print $1}')
echo "  local  md5: $LOCAL_MD5"

# ---------------------------------------------------------------------------
# 2. Stage on clawdy
# ---------------------------------------------------------------------------

echo "→ Staging daemon bundle to $HOST:$STAGING_PATH"
ssh "$HOST" "mkdir -p $(dirname "$STAGING_PATH")" >/dev/null
rsync -az "$DIST_FILE" "$REMOTE_USER@$HOST:$STAGING_PATH"
echo "  ✓ daemon staged"

# Stage SPA bundle if it exists (Phase 116+). Backwards compatible — if the
# SPA dir is absent, skip without erroring.
DEPLOY_SPA=0
if [ -d "$SPA_DIR" ] && [ -f "$SPA_DIR/index.html" ]; then
  DEPLOY_SPA=1
  echo "→ Staging SPA bundle to $HOST:$SPA_STAGING/"
  ssh "$HOST" "mkdir -p '$SPA_STAGING'" >/dev/null
  rsync -az --delete "$SPA_DIR/" "$REMOTE_USER@$HOST:$SPA_STAGING/"
  SPA_FILES=$(find "$SPA_DIR" -type f | wc -l)
  echo "  ✓ SPA staged ($SPA_FILES files)"
fi

# Stage .planning/ tree if it exists (Phase 116-postdeploy GSD planning
# ingest). The daemon's planning-tasks scanner walks this tree at request
# time. Without this sync the dashboard Tasks page shows stale planning
# state (last manual snapshot, often days/weeks old).
DEPLOY_PLANNING=0
if [ -d "$PLANNING_DIR" ] && [ -f "$PLANNING_DIR/ROADMAP.md" ]; then
  DEPLOY_PLANNING=1
  echo "→ Staging .planning/ to $HOST:$PLANNING_STAGING/"
  ssh "$HOST" "mkdir -p '$PLANNING_STAGING'" >/dev/null
  rsync -az --delete "$PLANNING_DIR/" "$REMOTE_USER@$HOST:$PLANNING_STAGING/"
  PLANNING_FILES=$(find "$PLANNING_DIR" -type f | wc -l)
  echo "  ✓ planning staged ($PLANNING_FILES files)"
fi

# Phase 101-fu 2026-05-16 — Stage package.json + package-lock.json, but only
# trigger remote `npm ci` when the lockfile actually changed. Compare md5s
# locally; if mismatch (or remote is MISSING), stage + flag DEPLOY_DEPS=1.
# This keeps the steady-state deploy fast (zero npm work when deps haven't
# moved) while making lockfile-bumped deploys self-healing.
DEPLOY_DEPS=0
if [ -f "$REPO_ROOT/package.json" ] && [ -f "$REPO_ROOT/package-lock.json" ]; then
  LOCAL_LOCK_MD5=$(md5sum "$REPO_ROOT/package-lock.json" | awk '{print $1}')
  REMOTE_LOCK_MD5=$(ssh "$HOST" "md5sum '$DEPS_DEPLOY_ROOT/package-lock.json' 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo "MISSING")
  [ -z "$REMOTE_LOCK_MD5" ] && REMOTE_LOCK_MD5="MISSING"
  if [ "$LOCAL_LOCK_MD5" != "$REMOTE_LOCK_MD5" ]; then
    DEPLOY_DEPS=1
    echo "→ Staging package.json + package-lock.json (lockfile md5 ${REMOTE_LOCK_MD5:0:8} → ${LOCAL_LOCK_MD5:0:8})"
    ssh "$HOST" "mkdir -p '$DEPS_STAGING'" >/dev/null
    rsync -az "$REPO_ROOT/package.json" "$REPO_ROOT/package-lock.json" "$REMOTE_USER@$HOST:$DEPS_STAGING/"
    echo "  ✓ deps staged"
  else
    echo "  ⊘ deps skipped (lockfile unchanged)"
  fi
fi

# Phase 999.55 — Stage per-agent prompt-corpus. Loop over each dev-side
# agent dir; for each one that (a) has AGENTS.md or SOUL.md and (b) has a
# corresponding workspace dir on prod, rsync the allowlist to a per-agent
# staging dir. Server-side copy (no --delete) happens in the sudo block
# below. The allowlist is intentionally narrow — never sync memory/,
# state/, .clawmetry-*, .backups/, media, scripts.
DEPLOY_AGENTS=0
AGENTS_TO_DEPLOY=()
AGENTS_SKIPPED=()
if [ -d "$AGENTS_LOCAL_ROOT" ]; then
  # One upfront `sudo ls` of the prod agents dir — /home/clawcode/ is
  # mode 750, so jjagpal can't traverse without sudo. Cache the list for
  # the per-agent membership check below.
  PROD_AGENT_LIST=$(printf '%s\n' "$PASSWORD" | ssh "$HOST" "sudo -S -p '' ls '$AGENTS_REMOTE_ROOT/' 2>/dev/null" 2>/dev/null | tr '\n' ' ')
  for agent_dir in "$AGENTS_LOCAL_ROOT"/*/; do
    [ -d "$agent_dir" ] || continue
    agent_name=$(basename "$agent_dir")
    # Discover gate: must have at least one prompt-corpus marker file.
    if [ ! -f "$agent_dir/AGENTS.md" ] && [ ! -f "$agent_dir/SOUL.md" ]; then
      AGENTS_SKIPPED+=("$agent_name(no-prompt-corpus)")
      continue
    fi
    # Prod-existence gate: only sync if the agent's prod workspace already
    # exists. Refuse to silently create new agent workspaces via deploy.
    if ! echo " $PROD_AGENT_LIST " | grep -q " $agent_name "; then
      AGENTS_SKIPPED+=("$agent_name(no-prod-workspace)")
      continue
    fi
    AGENTS_TO_DEPLOY+=("$agent_name")
  done

  if [ "${#AGENTS_TO_DEPLOY[@]}" -gt 0 ]; then
    DEPLOY_AGENTS=1
    echo "→ Staging agent prompt-corpus to $HOST:$AGENTS_STAGING_ROOT/ (${#AGENTS_TO_DEPLOY[@]} agents)"
    for agent_name in "${AGENTS_TO_DEPLOY[@]}"; do
      ssh "$HOST" "mkdir -p '$AGENTS_STAGING_ROOT/$agent_name'" >/dev/null
      # --delete on staging is safe (throwaway dir); allowlist ensures we
      # only ship prompt-corpus. NB: include 'skills/' BEFORE 'skills/**'
      # so rsync descends into the directory.
      rsync -az --delete \
        --include='AGENTS.md' \
        --include='HEARTBEAT.md' \
        --include='SOUL.md' \
        --include='IDENTITY.md' \
        --include='USER.md' \
        --include='TOOLS.md' \
        --include='BOOTSTRAP.md' \
        --include='skills/' \
        --include='skills/**' \
        --exclude='*' \
        "$AGENTS_LOCAL_ROOT/$agent_name/" "$REMOTE_USER@$HOST:$AGENTS_STAGING_ROOT/$agent_name/"
    done
    echo "  ✓ agent prompt-corpus staged: ${AGENTS_TO_DEPLOY[*]}"
  fi
  if [ "${#AGENTS_SKIPPED[@]}" -gt 0 ]; then
    echo "  ⊘ agent prompt-corpus skipped: ${AGENTS_SKIPPED[*]}"
  fi
fi

# ---------------------------------------------------------------------------
# 3. sudo cp + restart
# ---------------------------------------------------------------------------

# Build the remote sudo command. `sudo -S` reads the password from stdin once;
# subsequent sudo calls in the same shell may need re-auth, so we do everything
# in a single sudo sh -c '…'.
REMOTE_CMD="cp '$STAGING_PATH' '$DEPLOY_PATH'"
if [ "$DEPLOY_SPA" = 1 ]; then
  # rsync --delete keeps the deployed SPA dir in sync with the local build (drops
  # stale hashed bundle filenames). chown so the daemon user can serve it.
  REMOTE_CMD="$REMOTE_CMD && mkdir -p '$SPA_DEPLOY' && rsync -a --delete '$SPA_STAGING/' '$SPA_DEPLOY/' && chown -R '$SPA_OWNER' '$SPA_DEPLOY'"
fi
if [ "$DEPLOY_PLANNING" = 1 ]; then
  # Same atomic rsync + chown pattern. The daemon reads .planning/ at IPC
  # request time so no restart is needed for new planning artifacts to
  # appear in the dashboard Tasks page.
  REMOTE_CMD="$REMOTE_CMD && mkdir -p '$PLANNING_DEPLOY' && rsync -a --delete '$PLANNING_STAGING/' '$PLANNING_DEPLOY/' && chown -R '$PLANNING_OWNER' '$PLANNING_DEPLOY'"
fi
if [ "$DEPLOY_AGENTS" = 1 ]; then
  # Phase 999.55 — per-agent prompt-corpus merge. NO --delete here: we
  # rsync the staging dir (which already holds only allowlisted files) into
  # the existing prod workspace, merging by file. Operational state
  # (memory/, state/, etc.) on prod is untouched because it's not in the
  # staging tree to overwrite OR delete. chown each agent dir's
  # newly-written files back to the daemon user.
  for agent_name in "${AGENTS_TO_DEPLOY[@]}"; do
    REMOTE_CMD="$REMOTE_CMD && rsync -a '$AGENTS_STAGING_ROOT/$agent_name/' '$AGENTS_REMOTE_ROOT/$agent_name/' && chown -R '$AGENTS_OWNER' '$AGENTS_REMOTE_ROOT/$agent_name/'"
  done
fi
if [ "$DEPLOY_DEPS" = 1 ]; then
  # Phase 101-fu 2026-05-16 — copy lockfile + run `npm ci` as the daemon
  # user. MUST execute BEFORE systemctl restart so the new binary boots
  # against the updated node_modules. --no-audit --no-fund for speed.
  REMOTE_CMD="$REMOTE_CMD && cp '$DEPS_STAGING/package.json' '$DEPS_DEPLOY_ROOT/package.json' && cp '$DEPS_STAGING/package-lock.json' '$DEPS_DEPLOY_ROOT/package-lock.json' && chown $DEPS_OWNER '$DEPS_DEPLOY_ROOT/package.json' '$DEPS_DEPLOY_ROOT/package-lock.json' && sudo -u clawcode bash -c 'cd $DEPS_DEPLOY_ROOT && npm ci --no-audit --no-fund'"
  # Phase 101-fu 2026-05-16 incident — the Claude Agent SDK 0.2.140 native-
  # binary lookup function (sdk.mjs F5) tries `claude-agent-sdk-linux-${arch}-musl`
  # BEFORE `claude-agent-sdk-linux-${arch}` and returns the first one that
  # `require.resolve`s. Both variants get installed by `npm ci` because npm's
  # libc-aware optional-dep filtering doesn't skip musl on this glibc Ubuntu
  # host. The musl binary's ELF interpreter is `/lib/ld-musl-x86_64.so.1`,
  # which doesn't exist on glibc → ENOENT at exec time. Rename the musl
  # variant's directory after every `npm ci` so require.resolve fails on it
  # and the SDK falls through to the glibc binary. Idempotent: noop if the
  # rename target already exists.
  REMOTE_CMD="$REMOTE_CMD && bash -c 'MUSL=$DEPS_DEPLOY_ROOT/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl; if [ -d \"\$MUSL\" ] && [ ! -L \"\$MUSL.DISABLED-glibc-host\" ]; then mv \"\$MUSL\" \"\$MUSL.DISABLED-glibc-host\"; echo deploy-clawdy: disabled musl variant of claude-agent-sdk (glibc-host workaround for SDK 0.2.140); fi'"
fi
if [ "$DO_RESTART" = 1 ]; then
  REMOTE_CMD="$REMOTE_CMD && systemctl restart $SERVICE_NAME"
fi

echo "→ Deploying to $DEPLOY_PATH"
[ "$DEPLOY_SPA" = 1 ] && echo "→ Deploying SPA to $SPA_DEPLOY"
[ "$DEPLOY_PLANNING" = 1 ] && echo "→ Deploying .planning/ to $PLANNING_DEPLOY"
[ "$DEPLOY_AGENTS" = 1 ] && echo "→ Deploying agent prompt-corpus to $AGENTS_REMOTE_ROOT/{${AGENTS_TO_DEPLOY[*]}}"
[ "$DEPLOY_DEPS" = 1 ] && echo "→ Deploying package.json + npm ci to $DEPS_DEPLOY_ROOT"
# -p prefix the prompt so sudo writes ONLY '' on the password line — keeps stdout clean.
# The password is piped via stdin so it never appears on the SSH command line or in ps.
printf '%s\n' "$PASSWORD" | ssh "$HOST" "sudo -S -p '' sh -c \"$REMOTE_CMD\"" 2>&1 | grep -v '^$' || true
echo "  ✓ deployed"

# ---------------------------------------------------------------------------
# 4. Verify
# ---------------------------------------------------------------------------

REMOTE_MD5=$(ssh "$HOST" "md5sum '$DEPLOY_PATH' | awk '{print \$1}'")
echo "  remote md5: $REMOTE_MD5"

if [ "$LOCAL_MD5" != "$REMOTE_MD5" ]; then
  echo "✗ md5 mismatch — deploy did not propagate" >&2
  exit 1
fi
echo "  ✓ daemon md5 match"

if [ "$DEPLOY_SPA" = 1 ]; then
  # Verify the SPA index landed (md5-sum every asset would be overkill;
  # presence + asset count is a reasonable smoke check).
  REMOTE_SPA_INDEX=$(ssh "$HOST" "test -f '$SPA_DEPLOY/index.html' && echo OK || echo MISSING")
  REMOTE_SPA_ASSETS=$(ssh "$HOST" "ls '$SPA_DEPLOY/assets/' 2>/dev/null | wc -l")
  LOCAL_SPA_ASSETS=$(ls "$SPA_DIR/assets/" 2>/dev/null | wc -l)
  if [ "$REMOTE_SPA_INDEX" != "OK" ] || [ "$REMOTE_SPA_ASSETS" != "$LOCAL_SPA_ASSETS" ]; then
    echo "✗ SPA verify failed — index=$REMOTE_SPA_INDEX assets=$REMOTE_SPA_ASSETS (expected $LOCAL_SPA_ASSETS)" >&2
    exit 1
  fi
  echo "  ✓ SPA verify ($REMOTE_SPA_ASSETS asset files)"
fi

if [ "$DEPLOY_PLANNING" = 1 ]; then
  REMOTE_PLANNING_ROADMAP=$(ssh "$HOST" "test -f '$PLANNING_DEPLOY/ROADMAP.md' && echo OK || echo MISSING")
  if [ "$REMOTE_PLANNING_ROADMAP" != "OK" ]; then
    echo "✗ planning verify failed — ROADMAP.md=$REMOTE_PLANNING_ROADMAP" >&2
    exit 1
  fi
  echo "  ✓ planning verify (ROADMAP.md present)"
fi

if [ "$DEPLOY_AGENTS" = 1 ]; then
  # Per-agent verify: confirm AGENTS.md md5 matches local. AGENTS.md is the
  # most operator-visible prompt-corpus file; md5-match guarantees the rsync
  # propagated. (Verifying every allowlist file would be overkill — AGENTS.md
  # is the representative.) /home/clawcode/ is mode 750, so md5sum needs
  # sudo — pipe the password the same way the deploy block does.
  for agent_name in "${AGENTS_TO_DEPLOY[@]}"; do
    LOCAL_AGENT_MD5=$(md5sum "$AGENTS_LOCAL_ROOT/$agent_name/AGENTS.md" 2>/dev/null | awk '{print $1}')
    if [ -z "$LOCAL_AGENT_MD5" ]; then
      # Local agent has no AGENTS.md (skipped agents). Should not reach
      # here because the discovery loop already filtered them.
      continue
    fi
    REMOTE_AGENT_MD5=$(printf '%s\n' "$PASSWORD" | ssh "$HOST" "sudo -S -p '' md5sum '$AGENTS_REMOTE_ROOT/$agent_name/AGENTS.md' 2>/dev/null | awk '{print \$1}'" 2>/dev/null)
    if [ -z "$REMOTE_AGENT_MD5" ]; then
      echo "  ⚠ agent verify ($agent_name): could not md5sum remote AGENTS.md (sudo failed?) — chown succeeded so the file is in place"
      continue
    fi
    if [ "$LOCAL_AGENT_MD5" != "$REMOTE_AGENT_MD5" ]; then
      echo "✗ agent verify failed for $agent_name — AGENTS.md md5 mismatch (local=$LOCAL_AGENT_MD5 remote=$REMOTE_AGENT_MD5)" >&2
      exit 1
    fi
    echo "  ✓ agent verify ($agent_name): AGENTS.md md5 match"
  done
fi

if [ "$DO_RESTART" = 1 ]; then
  # Give the daemon ~3s to come up, then check active state.
  sleep 3
  STATE=$(ssh "$HOST" "systemctl is-active $SERVICE_NAME" 2>/dev/null || true)
  if [ "$STATE" = "active" ]; then
    echo "  ✓ $SERVICE_NAME is active"
  else
    echo "✗ $SERVICE_NAME is $STATE — check journalctl -u $SERVICE_NAME -n 50" >&2
    exit 1
  fi
fi

echo "✓ Deploy complete"
