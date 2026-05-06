# Phase 110 Stage 0b — Prod Retry Plan (post-context-clear, 2026-05-06 PM)

**Status:** awaiting operator go-ahead. Code shipped to clawdy this morning. Canary flip aborted; deploy auth was exhausted. Dev validation GREEN today on image + browser shims.

**Authoring rule:** this plan is the operator's checklist when they're ready to retry. Claude does NOT execute steps unless the operator types one of the resume signals. Memory rules `feedback_no_auto_deploy.md` + `feedback_ramy_active_no_deploy.md` apply.

---

## What's ready (in dev, code-complete on master)

| Component                            | State                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Search Go shim (Plan 110-04)         | shipped to clawdy this morning; binary at `/opt/clawcode/bin/clawcode-mcp-shim`                  |
| Search rollout (Plan 110-05 Task 2)  | UNFLIPPED — deferred until operator says go                                                      |
| Image Go shim (Plan 110-06 Task 1)   | code complete on master; 6 unit tests + live-daemon binary smoke (3 tools registered)            |
| Browser Go shim (Plan 110-07 Task 1) | code complete on master; 6 unit tests incl. 1 MB screenshot regression + live-daemon binary smoke (6 tools registered) |
| Rollout logs                         | both 110-06 + 110-07 scaffolded with Plan 110-05/110-06 GREEN as Prereq 0                        |
| Dev stress test                      | 50/50 prompts OK, 0 RSS growth, 0 respawns on dev-canary Go search shim (regression check on new image+browser-bundled binary) |

The new dist/binary on master is structurally identical to what's already on clawdy EXCEPT it activates the image + browser switch arms that were stubs (USAGE 64) before. **No prod redeploy is required to start the search canary** — the binary already on clawdy is sufficient for Plan 110-05 Task 2. A redeploy IS required before image (Plan 110-06 Task 3) or browser (Plan 110-07 Task 3) can start.

---

## Sequence (operator-approved gates only)

### Gate A — Pre-flight BRAVE_API_KEY check (BEFORE Plan 110-05 Task 2 flip)

The user's open question: does prod's Node search-mcp shim actually return real `web_search` results today? The earlier "Brave API key missing" error from admin-clawdy needs to be ruled out as an existing-config issue (not a Phase 110 regression).

**Operator action** (no Claude execution required):
1. Pick an agent currently on Node search shim — admin-clawdy preferred (operator-owned), or fin-acquisition (Ramy-quiet check via Discord MCP first if using fin-acquisition).
2. Send via Discord channel: *"Use web_search to find today's date. Reply YYYY-MM-DD only."*
3. Observe:
   - **GREEN** — agent returns `2026-05-06` with sources → BRAVE_API_KEY pipeline is working today; not a Phase 110 regression risk; advance to Gate B.
   - **RED** — agent returns "Brave API key missing" or empty results → daemon-side config issue, blocks Stage 0b rollout. File a separate phase to fix BRAVE_API_KEY env passthrough; do NOT proceed.

> Why not self-execute: Claude's prod ssh inspection is denied per current permission boundaries. Operator-driven Discord prompt is the lowest-touch path that also doubles as production traffic validation.

**Resume signal:** `gate-a-green` or `gate-a-red <details>`.

### Gate B — Ramy-quiet Discord MCP check

Required before any prod-side flip. Per `feedback_ramy_active_no_deploy.md`.

**Operator action:**
1. Open `#fin-acquisition` channel in Discord.
2. Verify no Ramy messages in the last 10-15 min AND no in-flight assistant turn.

> If Ramy is mid-conversation, hold. Single-agent yaml flip via ConfigWatcher does NOT restart the daemon, but it DOES cycle the affected agent's MCP children — `clawcode restart "Admin Clawdy"` is one-agent-scoped and Ramy's fin-acquisition agent is NOT touched by an admin-clawdy yaml override. Still, the operator's call.

**Resume signal:** `gate-b-quiet` (advance) or `gate-b-busy` (hold).

### Gate C — Plan 110-05 Task 2: search canary flip on admin-clawdy

Already code-shipped to clawdy. No deploy needed.

**Operator action** (follows `110-05-ROLLOUT-LOG.md` Phase 1):
1. ssh clawdy.
2. Edit `/etc/clawcode/clawcode.yaml`:
   ```yaml
   agents:
     - name: Admin Clawdy   # exact agent key as it exists today
       shimRuntime:
         search: static
   ```
3. ConfigWatcher hot-reload (~5-6 sec). Verify daemon PID unchanged.
4. Verify shim child cycle:
   ```bash
   pgrep -af 'clawcode search-mcp' | grep -i 'admin clawdy'                 # expect: empty
   pgrep -af 'clawcode-mcp-shim --type search'                              # expect: 1 PID under admin-clawdy
   ```
5. Smoke: send "Use web_search to find today's date" via admin-clawdy Discord.
6. Sample VmRSS 3× over 30 min. Pass: ≤ 15 MB each.
7. Decision: `green-canary` to enter watch / `red-rollback` to halt.

**Resume signal:** `green-canary` or `red-rollback <details>`.

### Gate D — 24-48h watch on admin-clawdy

Per `110-05-ROLLOUT-LOG.md` §3. Sample at t+1h / t+12h / t+24h / t+48h.

**Resume signal:** `green-canary-watch-done` or `red-rollback-watch <details>`.

### Gate E — Plan 110-05 Task 3: search fleet rollout

Edit `clawcode.yaml`:
```yaml
defaults:
  shimRuntime:
    search: static    # was: node
agents:
  - name: Admin Clawdy
    # shimRuntime override REMOVED — fleet default applies
```
Wait 5 min. Verify all 11 agents cycled to Go search shim.

**Resume signal:** `fleet-green` (advance to image) or `fleet-rollback`.

### Gate F — Redeploy dist + binary to clawdy (image + browser cases now active)

Required before Plan 110-06 + 110-07 can start.

```bash
# Local
cd /home/jjagpal/.openclaw/workspace-coding
npm run build
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" \
  -o /tmp/clawcode-mcp-shim ./cmd/clawcode-mcp-shim
tar -czf /tmp/clawcode-dist.tar.gz -C dist .
scp /tmp/clawcode-mcp-shim /tmp/clawcode-dist.tar.gz clawdy:/tmp/

# On clawdy (no sudo for dist; sudo for systemd restart)
mv /opt/clawcode/dist /opt/clawcode/dist.bak-pre-image-$(date +%Y%m%d-%H%M%S)
mkdir /opt/clawcode/dist && tar -xzf /tmp/clawcode-dist.tar.gz -C /opt/clawcode/dist/
install -m 0755 /tmp/clawcode-mcp-shim /opt/clawcode/bin/clawcode-mcp-shim
echo "686Shanghai" | sudo -S /bin/systemctl restart clawcode.service
```

> Per Phase 999.6 snapshot/restore, agents auto-resume warm. Verify warm-path-ready for all auto-start agents (~2 min, personal can take 4-7 min via Phase 999.33 boot-storm).

**Resume signal:** `gate-f-deployed` or `gate-f-failed <details>`.

### Gate G — Plan 110-06 Tasks 3 + 4: image rollout

Mirrors Gate C/D/E with `shimRuntime.image: static` and `image_generate` smoke.

**Resume signals:** `green-canary-image` → watch → `image-fleet-green`.

### Gate H — Plan 110-07 Tasks 3 + 4: browser rollout

Mirrors with `shimRuntime.browser: static` and `browser_screenshot` smoke.
**Vigilance**: Pitfall §2 (16 MB IPC buffer truncation) most likely surfaces here.
RED-tier session-state check: open page → screenshot → extract should round-trip identically pre- vs post-flip.

**Resume signals:** `green-canary-browser` → watch → `stage-0b-complete`.

---

## What Claude is doing while waiting

Nothing — autonomous executor halts at Gate A. The operator drives every step. Claude can:

- Re-run dev tests at any time on demand
- Investigate questions surfaced by gates (e.g., if Gate A → RED, Claude can plan a separate BRAVE_API_KEY config phase)
- Author new phase plans as needed

Claude will NOT:

- ssh into clawdy on its own
- Restart the daemon
- Edit clawcode.yaml on prod
- Send Discord messages on the operator's behalf
- Mark Plan 110-05/06/07 Task ≥ 2 complete from this session

---

## Memory + rules referenced

- `feedback_no_auto_deploy.md` — explicit "deploy" / "ship it" required in same turn
- `feedback_ramy_active_no_deploy.md` — Discord-verified Ramy quiet (NOT journalctl) before prod restart
- `reference_clawcode_server.md` — clawdy topology + sudoers grants
- `project_clawcode.md` — sudo password if needed: `686Shanghai`

## Decision log (filled by operator at each gate)

| UTC time | Gate | Operator | Signal | Notes |
| -------- | ---- | -------- | ------ | ----- |
|          | A    |          |        |       |
|          | B    |          |        |       |
|          | C    |          |        |       |
|          | D    |          |        |       |
|          | E    |          |        |       |
|          | F    |          |        |       |
|          | G    |          |        |       |
|          | H    |          |        |       |
