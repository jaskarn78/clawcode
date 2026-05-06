# Phase 110 Stage 0b — Resume Brief (post-context-clear)

**Last updated:** 2026-05-06 (PM session, post-deploy)
**Status:** **PM dist + binary DEPLOYED to clawdy. BRAVE_API_KEY provisioned in /etc/clawcode/env via op://. Daemon restarted at 15:18 PT; all 5 main agents warm. NO canary flipped — every agent still on Node baseline.** Phase 110 RSS savings still 0 GiB (canary flips are the next operator step).

## TL;DR for next session

Phase 110 Stage 0b code-side is COMPLETE on master:

- search Go shim (110-04) — shipped to clawdy this morning; Plan 110-05 canary unflipped
- image Go shim (110-06 Tasks 1+2) — on master, dev-green; binary contains active code path; clawdy still runs older binary where image case is a stub
- browser Go shim (110-07 Tasks 1+2) — on master, dev-green; same situation as image
- 110-PROD-RETRY-PLAN.md — operator's gated checklist for resuming the rollout (Gates A-H)

Dev validation results (PM session):
- `go test ./...` GREEN across all 4 packages (search, image, browser, ipc)
- Live-daemon binary smoke: `--type image` registers 3 tools, `--type browser` registers 6 tools — full path through daemon `list-mcp-tools` IPC verified
- 21-test dev harness PASS (search regression-free with new binary)
- 50-prompt stress test PASS (0 RSS growth, 0 respawns, 0 exit-75)

Open questions:
- BRAVE_API_KEY env passthrough — investigation deferred to operator-driven Discord prompt (Gate A in 110-PROD-RETRY-PLAN.md). Prod ssh inspection denied by permissions.

Plan 110-08 (cleanup) — still not started; gated on browser fleet GREEN.

Ramy-quiet check via Discord MCP **before any prod restart**.

---

## Topology

| Server | Role | User | clawcode location | Where I work |
|---|---|---|---|---|
| **claude-bot** (100.71.14.96) | DEV — where source lives | jjagpal | `/home/jjagpal/.openclaw/workspace-coding/` (git repo) | This is the workspace. Local dev daemon at `~/.clawcode-dev-110/` |
| **clawdy** (100.98.211.108) | PROD — Ramy-facing | clawcode (daemon) | `/opt/clawcode/dist/`, `/opt/clawcode/bin/`, `/etc/clawcode/clawcode.yaml` | ssh from claude-bot. Sudo password: `686Shanghai` |

**ssh shorthand from claude-bot:** `ssh clawdy` (key auth configured)

---

## Current state (verified 2026-05-06)

### On clawdy (prod) — post-PM-deploy 2026-05-06 15:18 PT
- ✅ **PM dist deployed**: `/opt/clawcode/dist/cli/index.js` (2.30 MB, sha256 `ba56faf5…`) — image+browser cases now ACTIVE (no longer stubs)
- ✅ **PM Go binary deployed**: `/opt/clawcode/bin/clawcode-mcp-shim` (5.69 MB, sha256 `8656243a…`) — image.Register + browser.Register wired
- ✅ **BRAVE_API_KEY provisioned**: `/etc/clawcode/env` now contains the key (resolved from `op://clawdbot/Brave Search API Key/credential`); systemd EnvironmentFile picks it up; daemon process.env has BRAVE_API_KEY set
- ✅ Backups preserved: `dist.bak-pre-110-final-pm-20260506-151645/`, `clawcode-mcp-shim.bak-pre-110-final-pm-20260506-151645`, `clawcode-mcp-shim.bak-pre-110-canary-retry-…` (morning's), `clawcode.yaml.bak-pre-110-revert-…`, env `bak-pre-brave` (sed in-place backup)
- ✅ Daemon restarted: PID 1945993 (uptime 2h28m, mem peak 13.4 GB) → PID 2157589 (current). Phase 999.6 snapshot/restore preserved agent state.
- ✅ Boot secrets: `secrets: pre-resolve complete {resolved:15, failed:0}` — Path 2 op:// infrastructure exercised on prod with zero failures
- ✅ All 5 main agents warm (Admin Clawdy 15:18:32, fin-acquisition 15:18:47, research 15:18:59, fin-research 15:19:15, personal 15:26:28 — needed manual `clawcode restart personal` due to Phase 999.33 boot-storm)
- ❌ **No canary flipped** — every agent still on Node search/image/browser baseline. Stage 0b RSS savings still 0 GiB.
- ✅ 0 exit-75 / TEMPFAIL events since restart. 0 panics.

### On claude-bot (dev)
- Dev daemon running at `/home/jjagpal/.clawcode-dev-110/manager/clawcode.sock`
- Two test agents: `dev-canary` (per-agent shimRuntime: static = Go shim) + `dev-control` (Node baseline)
- Dev binary: `/home/jjagpal/dev-clawcode-mcp-shim` (built from `dist/`)
- Dev yaml: `/home/jjagpal/dev-clawcode.yaml`

### On GitHub
- All commits pushed to `origin/master` (https://github.com/jaskarn78/clawcode)
- Most recent: `4906349 feat(110): upgrade modelcontextprotocol/go-sdk v1.5.0 → v1.6.0 + add 999.40 backlog`

---

## What's left in Phase 110 Stage 0b

| Plan | Status | What |
|---|---|---|
| 110-00 | ✅ shipped | Wave 0 spike + kill-switch (RSS 6.4 MB on clawdy) |
| 110-01 | ✅ shipped | Daemon `list-mcp-tools` IPC method |
| 110-02 | ✅ shipped | Schema enum widen + loader resolveShimCommand + per-agent override |
| 110-03 | ✅ shipped | CI Go-build + npm-publish (prebuild-install bundle) |
| 110-04 | ✅ shipped | Search Go shim production Register |
| **110-05** | ⏸ Task 1 only | **Search rollout** — canary flip on admin-clawdy + 24-48h watch + fleet rollout (Tasks 2 + 3 await operator) |
| **110-06** | ❌ not started | **Image-mcp Register** + canary + fleet rollout |
| **110-07** | ❌ not started | **Browser-mcp Register** + canary + fleet rollout |
| **110-08** | ❌ not started | Cleanup decision (keep or remove Node fallback) |

---

## The build + deploy procedure (locked)

### Build dev artifacts
```bash
cd /home/jjagpal/.openclaw/workspace-coding

# TS dist (always after src/ changes)
npm run build      # writes dist/cli/index.js

# Go binary (only after Go source changes — internal/shim/, cmd/)
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" \
  -o /tmp/clawcode-mcp-shim ./cmd/clawcode-mcp-shim
```

### Deploy to dev (claude-bot, no sudo)
```bash
# Copy fresh dev binary
cp /tmp/clawcode-mcp-shim /home/jjagpal/dev-clawcode-mcp-shim

# Restart dev daemon (pkill + nohup)
pkill -f "dist/cli/index.js.*dev-clawcode.yaml"
sleep 2
rm -f /home/jjagpal/.clawcode-dev-110/manager/clawcode.sock /home/jjagpal/.clawcode-dev-110/manager/mcp-broker.sock
cd /home/jjagpal && \
  CLAWCODE_MANAGER_DIR=/home/jjagpal/.clawcode-dev-110/manager \
  CLAWCODE_STATIC_SHIM_PATH=/home/jjagpal/dev-clawcode-mcp-shim \
  nohup node /home/jjagpal/.openclaw/workspace-coding/dist/cli/index.js \
    start-all --foreground --config /home/jjagpal/dev-clawcode.yaml \
    > /home/jjagpal/.clawcode-dev-110/logs/daemon.log 2>&1 </dev/null &
disown
```

### Validate in dev (run before deploying to prod)
```bash
~/dev-prompt --status                                    # show shim state
~/dev-prompt dev-canary "What is 2 + 2?"                 # quick smoke
~/.clawcode-dev-110/run-tests.sh                         # 21-test harness (~75s)
~/.clawcode-dev-110/stress-test.sh 50                    # leak/stability (~5-10 min)
```

### Deploy to prod (clawdy) — RAMY CHECK FIRST
**CRITICAL: Always verify Ramy quiet via Discord MCP before any prod restart. Memory note `feedback_ramy_active_no_deploy.md` has the rule.**

```bash
# 1. Discord-verified Ramy check (NOT journalctl alone)
mcp__plugin_discord_discord__fetch_messages with chat_id of #fin-acquisition channel
# Look for non-bot messages in last 10-15 min. If present → HOLD.
# Also check journalctl for "streaming message to agent" without "stream complete" — in-flight turn.

# 2. Build artifacts (above) and ship
tar -czf /tmp/clawcode-dist.tar.gz -C dist .
scp /tmp/clawcode-mcp-shim /tmp/clawcode-dist.tar.gz clawdy:/tmp/

# 3. Deploy on clawdy (no sudo for these — /opt/clawcode is jjagpal:clawcode 0775)
ssh clawdy '
  mv /opt/clawcode/dist /opt/clawcode/dist.bak-pre-deploy-$(date +%Y%m%d-%H%M%S)
  mkdir /opt/clawcode/dist && tar -xzf /tmp/clawcode-dist.tar.gz -C /opt/clawcode/dist/
  install -m 0755 /tmp/clawcode-mcp-shim /opt/clawcode/bin/clawcode-mcp-shim
'

# 4. Restart daemon (Phase 999.6 snapshot/restore preserves agents)
ssh clawdy 'echo "686Shanghai" | sudo -S -p "" /bin/systemctl restart clawcode.service'

# 5. Wait for warm-path-ready for all auto-start agents (~2 min, with personal sometimes taking 4-7 min due to Phase 999.33 boot-storm)
```

### Canary flip (when ready) — NO daemon restart needed
The CLEAN canary mechanism is `agents.<name>.shimRuntime.search: static` in clawcode.yaml. ConfigWatcher hot-reloads MCP server changes via `clawcode restart <agent>` (single-agent restart, NOT full daemon).

```bash
# Edit yaml on clawdy
ssh clawdy 'echo "686Shanghai" | sudo -S -p "" python3 - <<EOF
import yaml
with open("/etc/clawcode/clawcode.yaml") as f: data = f.read()
# Insert "shimRuntime: { search: static }" into the Admin Clawdy block
# (Use proper YAML editing, not regex, for safety)
EOF
'

# Restart only that agent
ssh clawdy 'echo "686Shanghai" | sudo -S -p "" -u clawcode bash -c "clawcode restart \"Admin Clawdy\""'

# Verify Go shim spawned for that agent only
ssh clawdy 'pgrep -af "/opt/clawcode/bin/clawcode-mcp-shim --type search"'
```

---

## Outstanding TODOs to resolve before fleet rollout

### 1. BRAVE_API_KEY env passthrough investigation (NOT a Phase 110 shim issue)
**Symptom:** When admin-clawdy was on Go shim, agent reported "Brave API key missing from the shim's environment."

**Investigation result:** The error is misleading. Confirmed via `/proc/<pid>/environ` checks:
- Daemon process: NO `BRAVE_API_KEY` in env
- Node search-mcp child: NO `BRAVE_API_KEY` in env
- Go shim child: NO `BRAVE_API_KEY` in env

The shim doesn't NEED the key — it just translates MCP messages. The actual brave/exa search is daemon-side via `BraveClient`. The error must come from the daemon's BraveClient, not the shim.

**Real question:** does the daemon resolve `BRAVE_API_KEY` via `op://` reference? Check `/etc/clawcode/env` and `clawcode.yaml` for op:// patterns. If yes, op CLI must be working and the key resolution at runtime must be succeeding. If the key was just missing from `/etc/clawcode/env`, the Node shim wouldn't work either — but the user reported it does, so it's something more nuanced.

**Action:** Before flipping the search canary in prod, send a `web_search` request via fin-acquisition (Node shim) and confirm it succeeds today. If it does, this is not a regression risk for the canary. If it fails too, then there's a daemon-side BRAVE_API_KEY config issue to fix BEFORE Phase 110 rollout.

### 2. The orphan-claude-reaper boot-storm + personal-agent-stall (Phase 999.33 follow-up)
Personal stalls on every daemon restart — boot-storm contention on the 9 per-agent MCP children. Phase 999.33 capped concurrency to 4 but doesn't fully fix it. Manual `clawcode restart personal` clears it within 30s. Worth a separate phase that *sequentially gates* agents into warm-path-ready before starting the next.

---

## Plan 110-06 (Image shim) implementation notes — start here

The image shim is structurally identical to search:
1. `internal/shim/image/register.go` — mirror `internal/shim/search/register.go`. The IPC client is shared (already at `internal/shim/ipc/client.go`). Just swap "search" → "image" in `list-mcp-tools` shimType + `<type>-tool-call` IPC method.
2. `cmd/clawcode-mcp-shim/main.go` — replace the image stub with `image.Register(server)`. Stub message currently says `see plan 110-06 (image), 110-07 (browser)` — update to active path.
3. Tests in `internal/shim/image/register_test.go` (mirror search tests). Should reuse the IPC fake-daemon scaffold from `internal/shim/search/register_test.go`.

Daemon side: the `<type>-tool-call` IPC method needs to exist for image. Check if it's already registered in `src/ipc/protocol.ts` and `src/manager/daemon.ts`. If not, mirror the search-tool-call pattern.

The browser shim (Plan 110-07) will follow the same pattern. Browser session state stays per-agent in the daemon (RED tier) — the shim is just MCP message translation.

---

## Test discipline (don't repeat the original blind spot)

Every shim implementation MUST pass:
1. ✅ Idle properties (RSS, parent, alive)
2. ✅ **Real prompt round-trip** — agent sends a tool call through the new shim, gets a non-error response back
3. ✅ Agent restart preserves the per-agent shimRuntime (regression scenario)
4. ✅ Stress: 50 prompts, no respawns, no leak

Run `~/.clawcode-dev-110/run-tests.sh` after each shim impl. The test harness exercises real MCP dispatch — that's the bug surface that bit production this morning.

---

## Memory rules (refer before deploys)

- `feedback_no_auto_deploy.md` — never deploy without explicit phrase in same turn
- `feedback_ramy_active_no_deploy.md` — Discord-verified Ramy quiet (NOT journalctl) before prod restart
- `reference_clawcode_server.md` — clawdy topology + sudoers grants

---

## Discord MCP — find Ramy's chat_id

Per `feedback_ramy_active_no_deploy.md`, ASK the operator for the fin-acquisition channel chat_id if you don't have it. The Discord plugin's `fetch_messages` requires it. Don't proceed with prod restart without it.

OR observe: when Ramy sends a Discord message, it arrives in the conversation as `<channel source="discord" chat_id="...">` — that's the chat_id to fetch from later.
