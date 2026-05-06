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

### Gate A — BRAVE_API_KEY pipeline is BROKEN on prod (root cause confirmed)

**Read-only investigation (PM session) found the root cause without any prod restart. Detailed evidence below; the fix is independent of Phase 110.**

#### Evidence

1. `/etc/clawcode/env` on clawdy contains: ANTHROPIC_API_KEY, OP_SERVICE_ACCOUNT_TOKEN, GITHUB_TOKEN, PATH, CLAWCODE_ADMIN_DISCORD_USER_IDS, CLAWCODE_DASHBOARD_HOST, HF_HOME, CLAWCODE_OPENAI_LOG_BODIES, FAL_API_KEY, GEMINI_API_KEY, FINMENTUM_OP_TOKEN, POLYGON_API_KEY. **No `BRAVE_API_KEY`.**
2. `/etc/clawcode/clawcode.yaml` line 103: `BRAVE_API_KEY: ${BRAVE_API_KEY}` — pure shell-style env passthrough on the legacy `brave-search` Python MCP block. Other secrets in the same yaml use `op://clawdbot/...` (FINNHUB_API_KEY, MYSQL_*, FAL_API_KEY, etc.). **Brave is the only one configured to inherit from env, with no fallback.**
3. `/etc/clawcode/clawcode.yaml` has NO top-level `search:` block and NO `defaults.search` block — search config is fully default.
4. `src/search/providers/brave.ts:100`:
   ```ts
   const apiKey = env[config.brave.apiKeyEnv];
   if (!apiKey || apiKey.length === 0) {
     return Object.freeze({
       ok: false,
       error: makeError("invalid_argument",
         `missing Brave API key (env var ${config.brave.apiKeyEnv} is unset)`),
     });
   }
   ```
   The Phase 71 BraveClient reads `process.env[config.brave.apiKeyEnv]` (default `BRAVE_API_KEY`) at request time. Returns `invalid_argument` if unset.
5. `src/manager/daemon.ts:3061`: `const braveClient = createBraveClient(searchCfg);` — the daemon constructs BraveClient with `env=process.env` (default arg). The daemon process's env is the systemd `EnvironmentFile=/etc/clawcode/env` contents — which lacks `BRAVE_API_KEY` per (1).
6. `src/manager/session-config.ts` op:// resolution applies to per-agent `mcpServers[].env` overrides only — NOT to `process.env` of the daemon process itself.
7. journalctl last 24h: **0 `web_search` or `search-tool-call` events**. Nobody has tried web_search in a day. The "search MCP clients ready (lazy — no boot-time network)" line at boot is just BraveClient construction, no key validation.

**Conclusion:** BRAVE_API_KEY pipeline is broken on prod RIGHT NOW. Every `web_search` call returns `invalid_argument: missing Brave API key (env var BRAVE_API_KEY is unset)`. The admin-clawdy error this morning was REAL and is a pre-existing config gap — NOT a Phase 110 regression. The Node search shim has the same problem the Go shim would have because neither shim handles the key — the DAEMON does, and the daemon's env doesn't have the key.

**This is NOT a Phase 110 blocker** in the sense that flipping the search canary doesn't change the BRAVE pipeline outcome. It IS a separate BLOCKER for the Stage 0b user-facing claim "search works on the new Go shim" because there's nothing for either shim to demonstrate.

#### The fix (1Password reference confirmed: `op://clawdbot/Brave Search API Key/credential`)

The cred is already in 1Password (`clawdbot` vault, item "Brave Search API Key", field `credential`). Two paths — both make the daemon-side BraveClient resolve correctly. Pick one.

##### Path 1 — fastest, env-file route (no code deploy required)

Operator runs on clawdy as `jjagpal` (op CLI signed in):

```bash
ssh clawdy
echo "BRAVE_API_KEY=$(op read 'op://clawdbot/Brave Search API Key/credential')" \
  | echo "686Shanghai" | sudo -S -p "" tee -a /etc/clawcode/env > /dev/null
echo "686Shanghai" | sudo -S -p "" /bin/systemctl restart clawcode.service
```

> Phase 999.6 snapshot/restore preserves running agents across the systemd restart. Wait ~2 min for warm-path-ready (personal can stretch to 4-7 min via Phase 999.33 boot-storm).
>
> Run the Discord smoke test below after restart.

##### Path 2 — yaml-level op:// resolution (code shipped on master, takes effect at next deploy)

Path 2 code is already shipped on master in commit `<TBD — see git log>`:

| Change | What |
|---|---|
| `src/config/schema.ts` | New optional `defaults.search.brave.apiKey` and `.exa.apiKey` fields (string \| op://) |
| `src/manager/secrets-collector.ts` | Zone 4 added — collectAllOpRefs scans the two new fields and feeds them to `SecretsResolver.preResolveAll` at boot |
| `src/manager/daemon.ts` | New `buildSearchEnv(searchCfg, secretsResolver)` helper builds a synthetic env from `process.env` overlaid with resolved `apiKey` values; `createBraveClient` / `createExaClient` receive this env (instead of the default `process.env`) |
| `src/manager/__tests__/secrets-collector.test.ts` | 5 new tests (COLL-08 through COLL-12) covering brave + exa apiKey collection, dedup, literals ignored, missing-field safety |

After Path 2 ships to clawdy + daemon restart, the operator edits `/etc/clawcode/clawcode.yaml`:

```yaml
defaults:
  search:
    brave:
      apiKey: op://clawdbot/Brave Search API Key/credential
```

ConfigWatcher hot-reloads. Boot-time SecretsResolver caches the resolved value; BraveClient sees it via the synthetic env at `apiKeyEnv` ("BRAVE_API_KEY" by default). No `/etc/clawcode/env` edit needed for Brave going forward.

> Path 2 keeps the existing env-file path working as a fallback — when `apiKey` is absent or its op:// resolve cache-misses, the synthetic env passes `process.env` through unchanged so any literal `BRAVE_API_KEY=...` in `/etc/clawcode/env` keeps working.

**Recommendation:** Path 1 for today's unblock; Path 2 ships at the next Phase 110 deploy as the permanent fix and keeps Brave consistent with every other secret in clawcode.yaml (FINNHUB, FAL, MYSQL_*, etc., all `op://`).

#### Operator action (Gate A)

1. Pick Path 1 or Path 2.
2. After the fix is in place, send a Discord prompt to admin-clawdy: *"Use web_search to find today's date. Reply YYYY-MM-DD only."*
3. **GREEN** — agent returns `2026-05-06` with sources → advance to Gate B.
4. **RED** — different error than "missing API key" → escalate; investigate further before Stage 0b.

> Why this still needs operator action: provisioning the value via env-file edit (Path 1) or yaml-edit + daemon restart (Path 2) is exactly the kind of action gated by `feedback_no_auto_deploy.md` and `feedback_ramy_active_no_deploy.md`.

**Resume signal:** `gate-a-fixed` (after the fix + verification prompt returns real results) or `gate-a-deferred` (Phase 110 rollout proceeds without resolving Brave; the cgroup-pressure-relief value stands alone).

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
