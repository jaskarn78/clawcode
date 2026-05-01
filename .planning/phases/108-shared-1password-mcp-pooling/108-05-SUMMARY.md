---
phase: 108-shared-1password-mcp-pooling
plan: "05"
type: execute
status: partial-deployed-rolled-back
date: 2026-05-01
deployed-by: operator (explicit "Deploy it" 06:34 PT) — rolled back to dormant state at 06:42 PT after warm-path failures
deploy-pids: 432427 (initial), 436507 (hot-fix attempt), 439879 (rollback)
requirements-completed: [POOL-01, POOL-02, POOL-03, POOL-04, BROKER-01, BROKER-02, SHIM-01, SHIM-02, HEARTBEAT-01]
requirements-shipped-but-dormant: [WIRE-01]
requirements-deferred: [LIVE-INTEGRATION]
---

# Phase 108-05 — Deploy gate + smoke

**Outcome:** partial-deployed-rolled-back

Phase 108 broker code (108-01..04) shipped to clawdy successfully. Loader.ts auto-injection wiring (108-04-01 commit `421d8c1`) was reverted in commit `f2eb64e` (Admin Clawdy auto-healed during outage). System is healthy at pre-108 1Password path; broker code dormant in dist/.

## Pre-deploy gauntlet

- `npm run build`: PASS (tsup 384ms, dist/cli/index.js 2.11 MB)
- 267/268 affected tests GREEN
- 1 pre-existing failure on master (Phase 94 TOOL-10 directives test, unrelated to 108, confirmed via stash baseline)

## Deploy attempts

### Attempt 1: 06:35 PDT — initial deploy
- `rsync -av --delete dist/ → clawcode:/opt/clawcode/dist/` + `systemctl restart clawcode`
- Service: active. Broker boot logs visible: `mcp-broker listening` on `~/.clawcode/manager/mcp-broker.sock`, `uniqueTokens: 1`.
- **Issue surfaced:** No `mcp-broker-shim` processes spawned. `pgrep -ac 1password-mcp` = 0 but `ps -ef | grep takescake` = 6 — agents still using legacy npx command from explicit `mcpServers.1password` block in clawcode.yaml. The auto-injection rewrite was guarded by `!resolvedMcpMap.has("1password")` — yaml-defined entry took precedence and broker was never invoked.

### Attempt 2: 06:38 PDT — hot-fix loader
- Patched `src/config/loader.ts` to detect legacy `npx -y @takescake/1password-mcp` command and rewrite to broker shim.
- Rebuilt + redeployed.
- Service: active. Broker shim DID spawn (1 process visible) — but agents started failing warm-path:
  ```
  agent="research"          errors=["mcp: 1password: Process exited with code 75 before responding"]
  agent="finmentum-content-creator" errors=["mcp: 1password: Process exited with code 75 before responding"]
  agent="fin-research"      errors=["mcp: 1password: Process exited with code 75 before responding"]
  ```
- **Root cause (preliminary):** shim exits with `EX_TEMPFAIL (75)` within ~2s of SDK spawn, before MCP `initialize` completes. Either:
  - Broker's pool-spawn pathway is blocking the handshake response longer than the SDK's MCP-init timeout
  - Shim handshake / socket protocol has a race on first connection
  - Pool's first-time spawn of `@takescake/1password-mcp` is slower than the SDK can tolerate

### Attempt 3: 06:42 PDT — rollback
- `f2eb64e` reverted loader.ts to pre-108 npx auto-injection (Admin Clawdy committed during the outage window via `gsd:add-backlog`-style commit; commit message claims docs but diff includes the loader revert).
- Rebuilt + redeployed.
- Service: active. All autoStart agents reached warm-path-ready (Admin Clawdy at 06:41:01). Discord routing operational ("See this message?" → ClawdyV2 acknowledged at 06:42:50).

## Smoke results (against rolled-back state)

### Service health
- `systemctl is-active clawcode`: **active** ✅
- All autoStart agents warm-path-ready
- Discord bridge operational

### Broker activation (rolled back — broker code dormant)
- `mcp-broker-shim` processes: 0 (rolled back)
- `1password-mcp` children via npx: standard per-agent count (~5–11)
- Token redaction audit: **0 leaks** of `ops_eyJzaWdu...` literal in journal

### Token redaction
- Even during the failing window, NO raw token leaks were found in journalctl. SEC-07 invariant held.

## What's shipped vs. what's active

| Component | In dist/ | Active in production |
|-----------|---------|----------------------|
| `src/mcp/broker/types.ts` | ✅ | ✅ (loaded but unused) |
| `src/mcp/broker/pooled-child.ts` | ✅ | ✅ (loaded but unused) |
| `src/mcp/broker/broker.ts` | ✅ | ✅ (loaded but unused) |
| `src/mcp/broker/shim-server.ts` | ✅ (listens on socket) | ✅ (listens, no clients) |
| `src/cli/commands/mcp-broker-shim.ts` | ✅ | ⚪ (CLI registered but not invoked) |
| `src/heartbeat/checks/mcp-broker.ts` | ✅ | ✅ (running, reports healthy with 0 pools) |
| `src/manager/daemon.ts` boot wiring | ✅ | ✅ (broker constructed, listening) |
| `src/mcp/reconciler.ts` `__broker:` skip | ✅ | ✅ (no-op until pools spawn) |
| `src/config/loader.ts` auto-injection | ❌ (reverted) | ❌ (back to npx per-agent) |

## Deferred items (LIVE-INTEGRATION follow-up phase)

A future phase needs to:

1. **Reproduce the shim → SDK handshake race in a controlled test.** Currently the unit tests use FakeBrokerSocketPair which doesn't exercise the SDK's actual stdio + JSON-RPC initialize timing. Build an integration test that spawns the real shim against the real broker and runs through `initialize` end-to-end — measure timings, identify the race window.

2. **Investigate first-time pool spawn cost.** The pool spawns `npx -y @takescake/1password-mcp@latest` on first request. `npx` resolution + npm tarball extraction + node startup likely exceeds the SDK's MCP-init timeout (default ~5s). Options:
   - Pre-spawn the pool at daemon boot (eager warm)
   - Switch to a stable-installed package path (`require.resolve('@takescake/1password-mcp')` after `npm install`) to skip npx resolution
   - Increase SDK MCP-init timeout if configurable

3. **Add a deployable smoke harness.** Synthetic 5-agent `op read` burst that runs in `--dry-run` mode against a non-prod token, validates broker fanout end-to-end before touching production agents.

4. **Re-attempt deploy under quiet window.** Once shim handshake race is fixed, re-deploy with smoke + monitoring active. Operator can verify `pgrep -ac 1password-mcp` drops from ~5 → 1 (single token in current fleet).

## Notes

- 108-CONTEXT.md predicted "11 agents → 2 instances" but actual fleet has only 1 unique OP_SERVICE_ACCOUNT_TOKEN value (all per-agent overrides resolve to same `jjagpal101.1password.com` operator account). Pool would be 1 instance, not 2.
- Phase 999.14/15 MCP lifecycle work (orphan reaper, PID tracker) caught and cleanly cleaned up the legacy npx processes during each restart cycle. Zero leaked MCP children across 3 daemon restarts.
- Snapshot system (Phase 999.6) restored running agents on each restart cleanly. Operator workflow uninterrupted.

## Files committed

- `f2eb64e` — loader.ts revert (Admin Clawdy)
- This SUMMARY (`108-05-SUMMARY.md`)

**Phase 108 status:** code shipped, integration deferred to live-integration follow-up phase. Foundation is in place (44 broker tests GREEN); next phase reproduces the SDK init-timing race and fixes it before re-enabling auto-injection.
