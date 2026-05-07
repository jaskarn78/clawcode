#!/usr/bin/env bash
#
# Deploy ClawCode to clawdy (100.98.211.108).
#
# Pipeline:
#   1. npm run build         (skip with --no-build)
#   2. rsync dist/cli/index.js → clawdy:~/clawcode-staging/index.js
#   3. ssh + sudo -S         (password piped from ~/.clawcode-deploy-pw)
#      - cp staging → /opt/clawcode/dist/cli/index.js
#      - systemctl restart clawcode (skip with --no-restart)
#   4. md5 verification both ends
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

if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN — would execute:"
  [ "$DO_BUILD" = 1 ]   && echo "  npm run build"
  echo "  rsync -avz $DIST_FILE $REMOTE_USER@$HOST:$STAGING_PATH"
  echo "  ssh $HOST 'sudo -S cp $STAGING_PATH $DEPLOY_PATH'"
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

echo "→ Staging to $HOST:$STAGING_PATH"
ssh "$HOST" "mkdir -p $(dirname "$STAGING_PATH")" >/dev/null
rsync -az "$DIST_FILE" "$REMOTE_USER@$HOST:$STAGING_PATH"
echo "  ✓ staged"

# ---------------------------------------------------------------------------
# 3. sudo cp + restart
# ---------------------------------------------------------------------------

# Build the remote sudo command. `sudo -S` reads the password from stdin once;
# subsequent sudo calls in the same shell may need re-auth, so we do everything
# in a single sudo sh -c '…'.
REMOTE_CMD="cp '$STAGING_PATH' '$DEPLOY_PATH'"
if [ "$DO_RESTART" = 1 ]; then
  REMOTE_CMD="$REMOTE_CMD && systemctl restart $SERVICE_NAME"
fi

echo "→ Deploying to $DEPLOY_PATH"
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
echo "  ✓ md5 match"

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
