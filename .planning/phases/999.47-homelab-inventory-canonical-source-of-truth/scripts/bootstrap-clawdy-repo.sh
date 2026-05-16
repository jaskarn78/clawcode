#!/usr/bin/env bash
#
# Phase 999.47 Plan 01 — bootstrap-clawdy-repo.sh
#
# One-shot, idempotent operator-gated bootstrap for the canonical homelab
# inventory repo at /home/clawcode/homelab/ on clawdy (Tailscale 100.98.211.108).
#
# Honors the locked decisions:
#   D-02   Standalone git repo at /home/clawcode/homelab/, owned by the
#          clawcode service user. Independent of the daemon install tree.
#   D-02a  Initial commit is authored by the operator (--operator-name /
#          --operator-email REQUIRED, no defaults) so the audit trail
#          distinguishes operator commits from the later clawcode-refresh
#          machine commits.
#   D-02b  Local-only repo at v1 — NO `git remote add` here.
#
# This script does NOT:
#   - touch the daemon install tree
#   - call into the init system or restart any unit
#   - push to a git remote
#   - update an already-initialized repo (per D-02 it initializes only)
#
# Operator runbook:
#   bash scripts/bootstrap-clawdy-repo.sh \
#     --operator-name  "Jaskarn Jagpal" \
#     --operator-email "jjagpal101@gmail.com" \
#     --dry-run                       # preview only
#
#   bash scripts/bootstrap-clawdy-repo.sh \
#     --operator-name  "Jaskarn Jagpal" \
#     --operator-email "jjagpal101@gmail.com"
#                                     # real run, asks clawdy via sudo
#
# Password file (same convention as scripts/deploy-clawdy.sh):
#   ~/.clawcode-deploy-pw  (chmod 600, gitignored).
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults (override via env)
# ---------------------------------------------------------------------------

PASSWORD_FILE="${CLAWCODE_DEPLOY_PW_FILE:-$HOME/.clawcode-deploy-pw}"
HOST="${CLAWCODE_DEPLOY_HOST:-clawdy}"
REMOTE_USER="${CLAWCODE_DEPLOY_USER:-jjagpal}"
REMOTE_REPO_PATH="${HOMELAB_REPO_PATH:-/home/clawcode/homelab}"
REMOTE_REPO_OWNER="${HOMELAB_REPO_OWNER:-clawcode:clawcode}"
REMOTE_STAGING_DIR="/tmp/homelab-bootstrap-$$"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES_DIR="$REPO_ROOT/templates"

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

OPERATOR_NAME=""
OPERATOR_EMAIL=""
DRY_RUN=0

usage() {
  sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --operator-name)
      [ $# -ge 2 ] || { echo "✗ --operator-name requires a value" >&2; exit 2; }
      OPERATOR_NAME="$2"
      shift 2
      ;;
    --operator-email)
      [ $# -ge 2 ] || { echo "✗ --operator-email requires a value" >&2; exit 2; }
      OPERATOR_EMAIL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "✗ Unknown flag: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$OPERATOR_NAME" ] || [ -z "$OPERATOR_EMAIL" ]; then
  echo "✗ --operator-name and --operator-email are REQUIRED (D-02a)." >&2
  echo "  Per the locked decisions, the initial commit must carry the" >&2
  echo "  operator's identity — never a default placeholder." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Pre-flight (local)
# ---------------------------------------------------------------------------

if [ ! -d "$TEMPLATES_DIR" ]; then
  echo "✗ templates dir not found: $TEMPLATES_DIR" >&2
  echo "  This script is meant to be run from the Phase 999.47 Plan 01" >&2
  echo "  scripts/ dir, with templates/ as a sibling." >&2
  exit 1
fi

REQUIRED_TEMPLATES=(INVENTORY.md NETWORK.md ACCESS.md DRIFT.md RETIRED.md .gitignore)
for f in "${REQUIRED_TEMPLATES[@]}"; do
  if [ ! -f "$TEMPLATES_DIR/$f" ]; then
    echo "✗ required template missing: $TEMPLATES_DIR/$f" >&2
    exit 1
  fi
done

if [ "$DRY_RUN" = 0 ]; then
  if [ ! -f "$PASSWORD_FILE" ]; then
    echo "✗ Password file not found: $PASSWORD_FILE" >&2
    echo "  Create it: echo -n 'PASSWORD' > $PASSWORD_FILE && chmod 600 $PASSWORD_FILE" >&2
    exit 1
  fi
  PERMS=$(stat -c '%a' "$PASSWORD_FILE")
  if [ "$PERMS" != "600" ] && [ "$PERMS" != "400" ]; then
    echo "✗ $PASSWORD_FILE has perms $PERMS — must be 600 or 400" >&2
    exit 1
  fi
  PASSWORD=$(cat "$PASSWORD_FILE")
  if [ -z "$PASSWORD" ]; then
    echo "✗ Password file is empty: $PASSWORD_FILE" >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Dry-run preview
# ---------------------------------------------------------------------------

if [ "$DRY_RUN" = 1 ]; then
  echo "DRY RUN — would execute (no clawdy contact):"
  echo "  1. ssh $REMOTE_USER@$HOST 'test -d $REMOTE_REPO_PATH/.git'"
  echo "       → if exists: echo '[skip] repo already initialized' and exit 0"
  echo "  2. ssh $REMOTE_USER@$HOST 'mkdir -p $REMOTE_STAGING_DIR'"
  echo "  3. scp -rp $TEMPLATES_DIR/. $REMOTE_USER@$HOST:$REMOTE_STAGING_DIR/"
  echo "  4. ssh $REMOTE_USER@$HOST 'sudo -S sh -c <BOOTSTRAP_BLOCK>' << password"
  echo "        a. mkdir -p $REMOTE_REPO_PATH"
  echo "        b. chown $REMOTE_REPO_OWNER $REMOTE_REPO_PATH"
  echo "        c. sudo -u clawcode cp -r $REMOTE_STAGING_DIR/. $REMOTE_REPO_PATH/"
  echo "        d. sudo -u clawcode mkdir -p $REMOTE_REPO_PATH/scripts"
  echo "        e. sudo -u clawcode bash -lc 'cd $REMOTE_REPO_PATH && git init -b main && git add . \\"
  echo "             && git -c user.name=\"$OPERATOR_NAME\" -c user.email=\"$OPERATOR_EMAIL\" \\"
  echo "                  commit -m \"feat(homelab): initial inventory scaffold (Phase 999.47 Plan 01)\"'"
  echo "        f. sudo -u clawcode git -C $REMOTE_REPO_PATH log --oneline -1"
  echo "  5. ssh $REMOTE_USER@$HOST 'sudo rm -rf $REMOTE_STAGING_DIR'"
  echo ""
  echo "  Operator identity for initial commit:"
  echo "    name : $OPERATOR_NAME"
  echo "    email: $OPERATOR_EMAIL"
  echo ""
  echo "  No remote add. No init-system calls. No daemon-install-tree touch."
  exit 0
fi

# ---------------------------------------------------------------------------
# Idempotency pre-flight (remote)
# ---------------------------------------------------------------------------

echo "→ Checking remote repo state at $REMOTE_USER@$HOST:$REMOTE_REPO_PATH"

# `sudo test -d` so we can read inside /home/clawcode/ (mode 750).
# `sudo -S` reads the password from stdin so we never put it on a command line.
REPO_PREEXISTS=0
if printf '%s\n' "$PASSWORD" | ssh "$REMOTE_USER@$HOST" \
     "sudo -S -p '' test -d '$REMOTE_REPO_PATH/.git'" 2>/dev/null; then
  REPO_PREEXISTS=1
fi

if [ "$REPO_PREEXISTS" = 1 ]; then
  echo "[skip] repo already initialized at $REMOTE_REPO_PATH (per D-02 this script only initializes)"
  exit 0
fi

# ---------------------------------------------------------------------------
# trap ERR — clean up half-bootstrapped state IFF we created the dir
# ---------------------------------------------------------------------------

CLEANUP_REQUIRED=0
on_err() {
  local exit_code=$?
  echo "✗ bootstrap failed (exit $exit_code)" >&2
  if [ "$CLEANUP_REQUIRED" = 1 ] && [ "$REPO_PREEXISTS" = 0 ]; then
    echo "→ Cleaning up half-bootstrapped $REMOTE_REPO_PATH (did not pre-exist)" >&2
    printf '%s\n' "$PASSWORD" | ssh "$REMOTE_USER@$HOST" \
      "sudo -S -p '' rm -rf '$REMOTE_REPO_PATH' '$REMOTE_STAGING_DIR'" 2>/dev/null || true
  else
    echo "  (skipping cleanup — repo pre-existed, leaving operator state untouched)" >&2
  fi
  exit "$exit_code"
}
trap on_err ERR

# ---------------------------------------------------------------------------
# Stage templates to remote /tmp
# ---------------------------------------------------------------------------

echo "→ Staging templates to $REMOTE_USER@$HOST:$REMOTE_STAGING_DIR"
ssh "$REMOTE_USER@$HOST" "mkdir -p '$REMOTE_STAGING_DIR'"
# -rp preserves perms; trailing /. copies directory contents (incl. dotfiles
# like .gitignore) without re-creating the directory itself.
scp -rp "$TEMPLATES_DIR/." "$REMOTE_USER@$HOST:$REMOTE_STAGING_DIR/"
echo "  ✓ staged"

CLEANUP_REQUIRED=1

# ---------------------------------------------------------------------------
# Remote bootstrap block (single sudo sh -c so password is read once)
# ---------------------------------------------------------------------------
#
# Embed operator name/email into the heredoc directly so we don't have to
# round-trip them through the sudo'd subshell. Each value is shell-quoted by
# bash's printf %q before substitution to defang any embedded special chars.

OPERATOR_NAME_Q=$(printf '%q' "$OPERATOR_NAME")
OPERATOR_EMAIL_Q=$(printf '%q' "$OPERATOR_EMAIL")

REMOTE_CMD=$(cat <<EOF
set -euo pipefail
mkdir -p '$REMOTE_REPO_PATH'
chown '$REMOTE_REPO_OWNER' '$REMOTE_REPO_PATH'
sudo -u clawcode cp -r '$REMOTE_STAGING_DIR/.' '$REMOTE_REPO_PATH/'
sudo -u clawcode mkdir -p '$REMOTE_REPO_PATH/scripts'
sudo -u clawcode bash -lc 'cd $REMOTE_REPO_PATH && git init -b main >/dev/null && git add . && git -c user.name=$OPERATOR_NAME_Q -c user.email=$OPERATOR_EMAIL_Q commit -m "feat(homelab): initial inventory scaffold (Phase 999.47 Plan 01)" >/dev/null'
echo "--- initial commit ---"
sudo -u clawcode git -C '$REMOTE_REPO_PATH' log --oneline -1
echo "--- file listing ---"
sudo -u clawcode ls -la '$REMOTE_REPO_PATH'
EOF
)

echo "→ Initializing repo on $HOST (sudo)"
# -S reads password from stdin; -p '' suppresses the sudo prompt so stdout
# stays clean. The password never appears on the command line or in ps.
printf '%s\n' "$PASSWORD" | ssh "$REMOTE_USER@$HOST" "sudo -S -p '' sh -c $(printf '%q' "$REMOTE_CMD")"
echo "  ✓ initialized"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

echo "→ Removing remote staging dir $REMOTE_STAGING_DIR"
printf '%s\n' "$PASSWORD" | ssh "$REMOTE_USER@$HOST" "sudo -S -p '' rm -rf '$REMOTE_STAGING_DIR'"
echo "  ✓ cleaned"

trap - ERR

echo ""
echo "✓ Bootstrap complete — $REMOTE_REPO_PATH on $HOST initialized."
echo "  Verify:"
echo "    ssh clawcode@100.98.211.108 'cd $REMOTE_REPO_PATH && git log --oneline -1 && ls -la'"
