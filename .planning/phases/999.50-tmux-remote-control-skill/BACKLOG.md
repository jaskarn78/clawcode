# Backlog: tmux Remote-Control Skill

## 999.50 — Ship a `tmux` skill that auto-registers as a Discord `/tmux` slash command

Port (or re-implement) the OpenClaw `skills/tmux/` skill into ClawCode so agents can remote-control tmux sessions for interactive CLIs by sending keystrokes and scraping pane output. Surface it as a Discord `/tmux` slash command via the existing skill→slash auto-registration path.

### Why

Operator workflow regularly involves long-running interactive CLIs in tmux on remote VMs — Claude Code sessions, `new-reel` baseline pipelines, Finmentum v4 builds, GSD execute-phase runs. Today the agent reaches into those sessions via ad-hoc `tmux send-keys` / `capture-pane` Bash calls reinvented each conversation. A first-class skill:

- Standardizes the "safe-send" pattern (`send-keys -l ... ; sleep 0.1 ; Enter`) that avoids TUI paste artifacts
- Gives the agent a tested helper for waiting on prompt text instead of polling blindly
- Centralizes session discovery (named sockets, socket-dir convention)
- Surfaces a Discord `/tmux` slash command for operator-driven attach/list/inspect flows that mirror what Jas remembers using on OC

### Prior art

- Upstream reference: `github.com/openclaw/openclaw/blob/main/skills/tmux/`
  - `SKILL.md` (frontmatter + agent instructions, with `metadata.openclaw.install.brew` for tmux dependency check)
  - `scripts/find-sessions.sh` (flags: `-L socket | -S socket-path | -A`, scans `$OPENCLAW_TMUX_SOCKET_DIR`, default `${TMPDIR}/openclaw-tmux-sockets`, `-q` substring filter)
  - `scripts/wait-for-text.sh` (poll `capture-pane -p` until pattern matches, with timeout)
- Research thread (2026-05-13): https://discord.com/channels/@me/1504260747822235891

### Desired behavior

**Skill body teaches the agent:**

- When to use vs. `exec` (vs. spawning a fresh shell) — tmux is for sessions that *outlive* the agent turn
- Example session naming (`shared`, `worker-2…8`) and how to scan for them
- Recipes for `list-sessions`, `capture-pane -p [-S -]`, `send-keys` (incl. `Enter`, `Escape`, `C-c`, `C-d`, `C-z`), pane/window navigation
- The safe-send pattern split text from `Enter`:
  ```bash
  tmux send-keys -t shared -l -- "Please apply the patch in src/foo.ts"
  sleep 0.1
  tmux send-keys -t shared Enter
  ```
- Loop snippets to poll worker sessions for approval-prompt patterns (`❯|Yes.*No|proceed|permission`)

**Discord `/tmux` slash surface (via auto-registration):**

- `/tmux` → lists available sessions on the agent's host (or the agent's allowed hosts)
- Operator can pick one and the agent then drives via `capture-pane` / `send-keys`
- No PTY hijack; this is agent-driven remote control, not a terminal attach

### Acceptance criteria

- New skill directory under whatever ClawCode's skill-registration path is (likely `~/.clawcode/skills/tmux/` or in-repo `skills/tmux/`)
- Skill auto-appears as `/tmux` in Discord slash-command list for agents that have the skill enabled
- Agent can list, capture, and send-keys to local tmux sessions on its host
- Documented recipes in `SKILL.md` cover: list, capture (full + tail), send-keys safe pattern, wait-for-text, common control sequences
- Optional: `wait-for-text.sh` helper script with timeout + pattern flags
- Optional: socket-dir convention (`$CLAWCODE_TMUX_SOCKET_DIR`) for namespaced sockets when multiple agents share a host

### Implementation notes

- Verify ClawCode's skill-registration code path is what surfaces skills as Discord slash commands (the assumption based on operator screenshot showing `/tmux — Remote-control tmux sessions...  Clawdy (OC)`). If the registration path differs from OpenClaw's, port the skill content and adapt the registration shim.
- Skill should be host-aware — when the agent runs in a sandbox without tmux, the install hint kicks in (`apt-get install -y tmux` on Linux, `brew install tmux` on darwin).
- Keep the skill body terse — recipe-first, prose-light. Mirror the OpenClaw `SKILL.md` density.
- Don't try to re-implement PTY attach in Discord. The value is agent-driven send-keys + capture, not a terminal in chat.

### Out of scope

- True PTY/terminal attach inside Discord (would require something like web-tmux or noVNC; explicitly not what this skill does)
- Multi-host tmux orchestration (skill assumes the agent's host or a single SSH target it already has creds for)
- Replacing the existing reelforge-style polling cron jobs (those are separate; this skill just makes the building blocks first-class)

### Related

- Reelforge monitoring session 2026-05-13 — operator polled `new-reel` tmux via ad-hoc cron; this skill makes that pattern reusable
- `feedback_silent_monitoring.md` style preferences (only alert on events, not heartbeats) — applies to any future polling helper built on this skill

### Reporter

Jas, 2026-05-13 16:14 PT — remembered using OpenClaw's `/tmux` slash command and asked for an equivalent in ClawCode. Research subagent confirmed upstream artifact at `openclaw/openclaw/skills/tmux/`.
