#!/usr/bin/env bash
# ClawCode installer for Ubuntu 25 (and compatible Debian-based systems)
# Usage: curl -fsSL <repo>/scripts/install.sh | bash
#   or:  bash scripts/install.sh
#
# Installs: Node.js 22 LTS, Claude Code CLI, ClawCode, systemd service
# Requires: sudo access, internet connection

set -euo pipefail

# --- Configuration ---
CLAWCODE_DIR="${CLAWCODE_DIR:-/opt/clawcode}"
CLAWCODE_USER="${CLAWCODE_USER:-clawcode}"
CLAWCODE_CONFIG="${CLAWCODE_CONFIG:-/etc/clawcode/clawcode.yaml}"
NODE_MAJOR=22
LOG_FILE="/tmp/clawcode-install-$(date +%Y%m%d-%H%M%S).log"

# --- Helpers ---
info()  { printf '\033[1;34m[INFO]\033[0m  %s\n' "$1"; }
ok()    { printf '\033[1;32m[OK]\033[0m    %s\n' "$1"; }
warn()  { printf '\033[1;33m[WARN]\033[0m  %s\n' "$1"; }
fail()  { printf '\033[1;31m[FAIL]\033[0m  %s\n' "$1" >&2; exit 1; }

log_cmd() {
  "$@" >> "$LOG_FILE" 2>&1 || { warn "Command failed: $*  (see $LOG_FILE)"; return 1; }
}

check_root() {
  if [[ $EUID -ne 0 ]]; then
    fail "This script must be run as root (try: sudo bash scripts/install.sh)"
  fi
}

# --- Pre-flight checks ---
preflight() {
  info "Running pre-flight checks..."

  # Check Ubuntu/Debian
  if ! command -v apt-get &>/dev/null; then
    fail "apt-get not found — this installer requires Ubuntu/Debian"
  fi

  # Check architecture
  ARCH=$(dpkg --print-architecture)
  if [[ "$ARCH" != "amd64" && "$ARCH" != "arm64" ]]; then
    fail "Unsupported architecture: $ARCH (need amd64 or arm64)"
  fi

  # Check internet
  if ! curl -fsSL --max-time 5 https://deb.nodesource.com/ &>/dev/null; then
    fail "Cannot reach package repositories — check internet connection"
  fi

  ok "Pre-flight passed (arch=$ARCH)"
}

# --- Install system dependencies ---
install_system_deps() {
  info "Installing system dependencies..."

  export DEBIAN_FRONTEND=noninteractive
  log_cmd apt-get update
  log_cmd apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    ca-certificates \
    gnupg

  ok "System dependencies installed"
}

# --- Install Node.js 22 LTS ---
install_node() {
  if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]]; then
      ok "Node.js $(node --version) already installed"
      return 0
    fi
    warn "Node.js $(node --version) found but need v${NODE_MAJOR}+, upgrading..."
  fi

  info "Installing Node.js ${NODE_MAJOR} LTS..."

  # NodeSource setup
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  log_cmd apt-get update
  log_cmd apt-get install -y nodejs

  ok "Node.js $(node --version) installed"
}

# --- Install Claude Code CLI ---
install_claude_cli() {
  if command -v claude &>/dev/null; then
    ok "Claude Code CLI already installed"
    return 0
  fi

  info "Installing Claude Code CLI..."
  log_cmd npm install -g @anthropic-ai/claude-code
  ok "Claude Code CLI installed"
}

# --- Create clawcode system user ---
create_user() {
  if id "$CLAWCODE_USER" &>/dev/null; then
    ok "User '$CLAWCODE_USER' already exists"
    return 0
  fi

  info "Creating system user '$CLAWCODE_USER'..."
  useradd --system --create-home --shell /bin/bash "$CLAWCODE_USER"
  ok "User '$CLAWCODE_USER' created"
}

# --- Clone/update ClawCode ---
install_clawcode() {
  info "Installing ClawCode to ${CLAWCODE_DIR}..."

  if [[ -d "$CLAWCODE_DIR" ]]; then
    warn "$CLAWCODE_DIR exists — pulling latest..."
    cd "$CLAWCODE_DIR"
    log_cmd git pull --ff-only
  else
    # If running from a git repo, copy it; otherwise expect CLAWCODE_REPO env
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_ROOT="$(dirname "$SCRIPT_DIR")"

    if [[ -d "$REPO_ROOT/.git" ]]; then
      info "Copying from local repo at ${REPO_ROOT}..."
      cp -a "$REPO_ROOT" "$CLAWCODE_DIR"
    elif [[ -n "${CLAWCODE_REPO:-}" ]]; then
      log_cmd git clone "$CLAWCODE_REPO" "$CLAWCODE_DIR"
    else
      fail "No git repo found and CLAWCODE_REPO not set. Either run from the repo or set CLAWCODE_REPO=<url>"
    fi
  fi

  cd "$CLAWCODE_DIR"

  info "Installing npm dependencies..."
  log_cmd npm ci --omit=dev

  info "Building..."
  log_cmd npm run build

  chown -R "$CLAWCODE_USER:$CLAWCODE_USER" "$CLAWCODE_DIR"
  ok "ClawCode installed at ${CLAWCODE_DIR}"
}

# --- Create config directory ---
setup_config() {
  info "Setting up configuration..."

  CONFIG_DIR=$(dirname "$CLAWCODE_CONFIG")
  mkdir -p "$CONFIG_DIR"

  if [[ ! -f "$CLAWCODE_CONFIG" ]]; then
    cat > "$CLAWCODE_CONFIG" <<'YAML'
# ClawCode configuration
# See docs for full reference: https://github.com/your-org/clawcode
#
# Required: Set your Anthropic API key
#   export ANTHROPIC_API_KEY=sk-ant-...
#
# Required: Set your Discord bot token (or use 1Password reference)
#   discord:
#     botToken: "op://vault/item/field"  # 1Password
#     botToken: "your-token-here"        # plaintext (not recommended)

discord:
  botToken: ""

agents: []
  # Example agent:
  # - name: assistant
  #   model: sonnet
  #   channels: ["YOUR_CHANNEL_ID"]
  #   workspace: /home/clawcode/workspaces/assistant
  #   soul: |
  #     You are a helpful assistant.
YAML
    ok "Config template created at ${CLAWCODE_CONFIG}"
    warn "Edit ${CLAWCODE_CONFIG} to configure agents before starting"
  else
    ok "Config already exists at ${CLAWCODE_CONFIG}"
  fi

  chown -R "$CLAWCODE_USER:$CLAWCODE_USER" "$CONFIG_DIR"
}

# --- Create systemd service ---
install_service() {
  info "Installing systemd service..."

  cat > /etc/systemd/system/clawcode.service <<EOF
[Unit]
Description=ClawCode Multi-Agent Orchestration Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CLAWCODE_USER}
Group=${CLAWCODE_USER}
WorkingDirectory=${CLAWCODE_DIR}

# Core command
ExecStart=${CLAWCODE_DIR}/dist/cli/index.js daemon --config ${CLAWCODE_CONFIG}

# Environment
Environment=NODE_ENV=production
Environment=HOME=/home/${CLAWCODE_USER}
EnvironmentFile=-/etc/clawcode/env

# Restart policy
Restart=on-failure
RestartSec=10
StartLimitBurst=5
StartLimitIntervalSec=60

# Resource limits
LimitNOFILE=65536
MemoryMax=4G

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/home/${CLAWCODE_USER} ${CLAWCODE_DIR} /etc/clawcode /tmp
ProtectHome=tmpfs
BindPaths=/home/${CLAWCODE_USER}
PrivateTmp=yes

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=clawcode

[Install]
WantedBy=multi-user.target
EOF

  # Create env file for secrets
  if [[ ! -f /etc/clawcode/env ]]; then
    cat > /etc/clawcode/env <<'ENV'
# ClawCode environment variables
# ANTHROPIC_API_KEY=sk-ant-...
# DISCORD_BOT_TOKEN=...
ENV
    chmod 600 /etc/clawcode/env
    chown "$CLAWCODE_USER:$CLAWCODE_USER" /etc/clawcode/env
  fi

  systemctl daemon-reload
  ok "Systemd service installed"
}

# --- Create workspace directories ---
setup_workspaces() {
  info "Creating workspace directories..."

  WORKSPACE_ROOT="/home/${CLAWCODE_USER}/workspaces"
  mkdir -p "$WORKSPACE_ROOT"
  mkdir -p "/home/${CLAWCODE_USER}/.clawcode/manager"
  chown -R "$CLAWCODE_USER:$CLAWCODE_USER" "/home/${CLAWCODE_USER}"

  ok "Workspace directories created at ${WORKSPACE_ROOT}"
}

# --- Summary ---
print_summary() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ClawCode installation complete"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Install dir:   ${CLAWCODE_DIR}"
  echo "  Config:        ${CLAWCODE_CONFIG}"
  echo "  Secrets:       /etc/clawcode/env"
  echo "  Service:       clawcode.service"
  echo "  User:          ${CLAWCODE_USER}"
  echo "  Workspaces:    /home/${CLAWCODE_USER}/workspaces"
  echo "  Log:           ${LOG_FILE}"
  echo ""
  echo "  Next steps:"
  echo "  1. Set your API key:    sudo editor /etc/clawcode/env"
  echo "  2. Configure agents:    sudo editor ${CLAWCODE_CONFIG}"
  echo "  3. Start the daemon:    sudo systemctl start clawcode"
  echo "  4. Enable on boot:      sudo systemctl enable clawcode"
  echo "  5. View logs:           journalctl -u clawcode -f"
  echo ""
}

# --- Main ---
main() {
  echo ""
  echo "  ClawCode Installer"
  echo "  ==================="
  echo ""

  check_root
  preflight
  install_system_deps
  install_node
  install_claude_cli
  create_user
  install_clawcode
  setup_config
  setup_workspaces
  install_service
  print_summary
}

main "$@"
