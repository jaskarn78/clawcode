#!/usr/bin/env bash
#
# Phase 999.47 Plan 03 Task 3 — operator-gated deploy of refresh.sh +
# verify.sh + lib/ helpers into /home/clawcode/homelab/scripts/ on clawdy.
#
# Operationally distinct from scripts/deploy-clawdy.sh:
#   - This script ships standalone bash scripts into the homelab repo
#     (owned by the clawcode user, lives at /home/clawcode/homelab/).
#   - It NEVER touches the daemon install tree.
#   - It NEVER invokes the init system. Nothing is bounced or rebooted;
#     the homelab refresh tick is driven by the daemon's heartbeat loop
#     (Plan 02), which reads the bash scripts on every invocation.
#   - Excludes test-fixtures/ and __tests__/ — production clawdy never
#     sees those.
#
# Pipeline:
#   1. Read sudo password from ~/.clawcode-deploy-pw (chmod 600).
#   2. SSH preflight: refuse if /home/clawcode/homelab/.git/ is missing
#      (Plan 01's bootstrap must have shipped first).
#   3. rsync scripts/homelab/{refresh.sh, verify.sh, lib/} → clawdy:/tmp/
#      homelab-staging-$$/ (clawcode-owned)
#   4. SSH + sudo: cp into /home/clawcode/homelab/scripts/ as clawcode user,
#      chmod +x, then `git add scripts/ && git commit` under the operator's
#      identity (D-02a — operator-driven commits are NOT clawcode-refresh).
#   5. Print `git log --oneline -3` for confirmation.
#
# Usage:
#   bash scripts/homelab/deploy-to-clawdy.sh \
#       --operator-name "Jaskarn Jagpal" \
#       --operator-email "jjagpal101@gmail.com"
#   bash scripts/homelab/deploy-to-clawdy.sh ... --dry-run

set -euo pipefail

PASSWORD_FILE="${CLAWCODE_DEPLOY_PW_FILE:-$HOME/.clawcode-deploy-pw}"
SSH_HOST="${CLAWCODE_DEPLOY_HOST:-clawdy}"
SSH_USER="${CLAWCODE_DEPLOY_USER:-jjagpal}"

# Phase 999.47 — homelab repo location on clawdy (owned by clawcode user).
HOMELAB_REPO_REMOTE="${HOMELAB_REPO_REMOTE:-/home/clawcode/homelab}"
HOMELAB_OWNER="${HOMELAB_OWNER:-clawcode:clawcode}"

OPERATOR_NAME=""
OPERATOR_EMAIL=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --operator-name)  OPERATOR_NAME="$2"; shift 2;;
    --operator-email) OPERATOR_EMAIL="$2"; shift 2;;
    --dry-run)        DRY_RUN=1; shift;;
    -h|--help)
      sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2;;
  esac
done

if [[ -z "$OPERATOR_NAME" || -z "$OPERATOR_EMAIL" ]]; then
  cat >&2 <<EOF
ERROR: --operator-name and --operator-email are REQUIRED.

D-02a (Phase 999.47): refresh.sh commits are authored as
'clawcode-refresh <noreply@clawcode>' (machine identity); deploys ship
under the OPERATOR identity so the audit trail distinguishes machine
edits from human edits.

Example:
  bash $0 \\
    --operator-name "Jaskarn Jagpal" \\
    --operator-email "jjagpal101@gmail.com"
EOF
  exit 2
fi

if [[ "$DRY_RUN" -ne 1 && ! -f "$PASSWORD_FILE" ]]; then
  echo "ERROR: password file not found at $PASSWORD_FILE" >&2
  echo "       create it with: echo -n 'PW' > $PASSWORD_FILE && chmod 600 $PASSWORD_FILE" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL_DIR="$REPO_ROOT/scripts/homelab"

for required in \
  "$LOCAL_DIR/refresh.sh" \
  "$LOCAL_DIR/verify.sh" \
  "$LOCAL_DIR/lib/common.sh"
do
  if [[ ! -f "$required" ]]; then
    echo "ERROR: required file missing: $required" >&2
    exit 2
  fi
done

# ---- staging dir name (timestamped to allow concurrent operators) ---------
STAGING_REMOTE="/tmp/homelab-staging-$$-$(date +%s)"

# ---- preflight: confirm Plan 01's homelab repo exists on clawdy -----------
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would ssh $SSH_USER@$SSH_HOST 'test -d $HOMELAB_REPO_REMOTE/.git'"
else
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 \
      "${SSH_USER}@${SSH_HOST}" \
      "sudo -n -k -u clawcode test -d $HOMELAB_REPO_REMOTE/.git" 2>/dev/null
  then
    # Try the simpler path without sudo (operator's user may not have -n).
    PW="$(cat "$PASSWORD_FILE")"
    if ! ssh -o BatchMode=no -o ConnectTimeout=10 \
        "${SSH_USER}@${SSH_HOST}" \
        "echo '$PW' | sudo -S -u clawcode test -d $HOMELAB_REPO_REMOTE/.git" 2>/dev/null
    then
      echo "ERROR: $HOMELAB_REPO_REMOTE/.git not found on $SSH_HOST" >&2
      echo "       Plan 01's bootstrap-clawdy-repo.sh must run first." >&2
      exit 3
    fi
  fi
fi

# ---- rsync into staging dir ------------------------------------------------
RSYNC_FLAGS=(-az --delete-during \
  --exclude="test-fixtures/" \
  --exclude="__tests__/" \
  --exclude="deploy-to-clawdy.sh" \
  --exclude="*.bak" \
  --exclude=".*")

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] rsync ${RSYNC_FLAGS[*]} $LOCAL_DIR/ $SSH_USER@$SSH_HOST:$STAGING_REMOTE/"
  echo "[dry-run] excluded paths: test-fixtures/, __tests__/, deploy-to-clawdy.sh, *.bak, dotfiles"
else
  echo "==> rsyncing scripts to $SSH_HOST:$STAGING_REMOTE ..."
  # shellcheck disable=SC2029  # $STAGING_REMOTE is intentionally expanded client-side
  ssh "${SSH_USER}@${SSH_HOST}" "mkdir -p $STAGING_REMOTE"
  rsync "${RSYNC_FLAGS[@]}" \
    "$LOCAL_DIR/" \
    "${SSH_USER}@${SSH_HOST}:${STAGING_REMOTE}/"
fi

# ---- ssh + sudo: cp into homelab repo + commit under operator identity ----
REMOTE_SCRIPT=$(cat <<REMOTE_EOF
set -euo pipefail
cd "$HOMELAB_REPO_REMOTE"
mkdir -p scripts
# Copy + own + chmod (clawcode user owns the repo).
cp -r $STAGING_REMOTE/refresh.sh $STAGING_REMOTE/verify.sh $STAGING_REMOTE/lib scripts/
chown -R $HOMELAB_OWNER scripts/
chmod +x scripts/refresh.sh scripts/verify.sh
# Stage + commit under the operator identity. Skip commit if no diff.
sudo -u clawcode git -C "$HOMELAB_REPO_REMOTE" add scripts/
if sudo -u clawcode git -C "$HOMELAB_REPO_REMOTE" diff --cached --quiet; then
  echo "[skip] no changes to scripts/ — nothing to commit"
else
  sudo -u clawcode git \\
    -C "$HOMELAB_REPO_REMOTE" \\
    -c user.name="$OPERATOR_NAME" \\
    -c user.email="$OPERATOR_EMAIL" \\
    commit -m "feat(homelab): deploy refresh + verify scripts (Phase 999.47 Plan 03)"
fi
echo "==> git log on $HOMELAB_REPO_REMOTE:"
sudo -u clawcode git -C "$HOMELAB_REPO_REMOTE" log --oneline -3
# Clean up staging.
rm -rf $STAGING_REMOTE
REMOTE_EOF
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] ssh + sudo block that would run on $SSH_HOST:"
  echo "----"
  echo "$REMOTE_SCRIPT"
  echo "----"
  echo "[dry-run] commit identity would be: $OPERATOR_NAME <$OPERATOR_EMAIL>"
  echo "[dry-run] complete — no bytes deployed"
  exit 0
fi

echo "==> applying on $SSH_HOST (operator: $OPERATOR_NAME <$OPERATOR_EMAIL>) ..."
PW="$(cat "$PASSWORD_FILE")"
ssh -tt "${SSH_USER}@${SSH_HOST}" "echo '$PW' | sudo -S bash -lc '$REMOTE_SCRIPT'"

echo "==> deploy complete"
