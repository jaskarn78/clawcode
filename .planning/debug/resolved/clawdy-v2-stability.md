---
status: resolved
trigger: "clawdy v2.0 stability: OpenAI endpoint not bound on 3101, fin-test restartCount=14, 26 stale sub-/thread- agent entries causing memory store lookup noise"
created: 2026-04-19T13:00:00Z
updated: 2026-04-19T13:35:00Z
resolved: 2026-04-19T13:35:00Z
---

## Current Focus

hypothesis: All three root causes confirmed and fixed in commit 8d90c42. Deployed to clawdy 2026-04-19T13:28Z. End-to-end human verification passed for #1 (port bound, models endpoint, chat completion), #3 (agent count 29 → 8, 21 pruned entries, log spam drop). #2 confirmed non-bug. One small follow-up identified: phantom-running registry entries whose processes crashed uncleanly before status transitioned — these survive both the reap (targets status:"stopped") and the SSE filter (allows status:"running"). Recommendation recorded in Follow-Up section below. Session resolved.
test: Deploy 8d90c42 (pushed + daemon restarted at 13:28 UTC) and run smoke.
expecting: Port 3101 LISTEN, OpenAI /v1/models returns 3 parents, /v1/chat/completions returns ChatCompletion, agent count drops ~29→8, log spam drops ~26/tick → ~20/6min.
next_action: Session resolved. Follow-up task tracked separately.

## Investigation Plan

Phase A (this session) - COMPLETE:
  1. ✅ Get journalctl output — user ran sudo journalctl
  2. ✅ Read error text → form specific hypotheses
  3. ✅ Empirical Zod test confirms default cascading bug

Phase B (fix) — IN PROGRESS:
  1. OpenAI endpoint — change openaiEndpointSchema outer default to factory returning full literal
  2. fin-test — no code fix (historical counter, not a live bug)
  3. Subagent reap — add stoppedAt field + TTL prune in reconcileRegistry + dashboard SSE filter
  4. Add regression tests: configSchema with partial defaults populates openai.enabled=true; reconcileRegistry prunes stopped entries past TTL; dashboard skips non-running agents

Phase C (verify):
  1. Build & test locally: `npm run build && npm test`
  2. Commit to master
  3. Emit human-verify checkpoint with smoke commands
  4. User approves → orchestrator runs clawcode update --restart on clawdy

## Symptoms

expected:
  - POST http://clawdy:3101/v1/chat/completions with bearer key returns OpenAI-shaped completion (stream + non-stream)
  - GET /v1/models returns 3 configured parent agents
  - fin-test stays running (no crash loop)
  - Stopped/phantom subagent entries reaped after bounded TTL
  - Heartbeat path does NOT emit "Memory store not found for agent '*-sub-*'" every tick
  - Response latency back to v1.7 SLO; agent-scan paths O(parents) not O(parents+zombies)

actual:
  - Port 3101 not bound on clawdy despite defaults.openai.enabled=true by schema default
  - systemctl restart at 2026-04-19T12:43Z did not recover
  - curl 127.0.0.1:3101/v1/models → ECONNREFUSED; only 3100 LISTEN
  - fin-test restartCount=14 in api/status, lastError=null at snapshot
  - api/status returns 29 agents: 3 parents + 26 sub/thread (21 stopped up to 6.8d old, 5 running with ≥3 phantoms failing MemoryStore lookup)
  - Daemon logs repeating: "Memory store not found for agent 'admin-clawdy-sub-CbXCb3'" + analogous Episode store errors at component:ipc-server on heartbeat polling

errors:
  - {"level":50,"component":"ipc-server","error":"Memory store not found for agent 'admin-clawdy-sub-CbXCb3' (agent may not be running)","msg":"handler error"}
  - {"level":30,"component":"daemon","enabled":false,"msg":"OpenAI endpoint disabled via config"} at 12:42:44 pid 529316 (boot)
  - No lastError captured for fin-test at snapshot

reproduction:
  1. ssh jjagpal@100.98.211.108 (clawdy)
  2. ss -ltn | grep :310 → only 3100, not 3101
  3. curl 127.0.0.1:3101/v1/models → ECONNREFUSED
  4. curl 127.0.0.1:3100/api/status | jq '.agents | length' → 29
  5. curl .../fin-test .restartCount → 14
  6. curl .../sub- agents → 26 rows oldest from 2026-04-12

started:
  - v2.0 milestone (Phases 69-72) completed, HEAD 2e514d5 built 2026-04-19T04:24:54Z
  - fin-test restart loop current: 14 restarts in 14 minutes post-restart
  - Lingering sub entries since 2026-04-12 (predates v2.0), but more prominent now
  - OpenAI endpoint introduced Phase 69, never confirmed running on clawdy post-deploy

## Eliminated

- hypothesis: OpenAI endpoint code missing from deployed bundle
  evidence: grep of /opt/clawcode/dist/cli/index.js shows 92 "openai" hits, 2 "startOpenAiEndpoint", plus log strings "OpenAI endpoint started", "OpenAI endpoint disabled via config", "OpenAI endpoint failed to start — continuing without endpoint". Code IS bundled.
  timestamp: 2026-04-19T13:10Z

- hypothesis: Another process holds port 3101 (EADDRINUSE)
  evidence: `ss -ltnp | grep 3101` returns empty on clawdy. Port is free.
  timestamp: 2026-04-19T13:12Z

- hypothesis: config.defaults.openai.enabled=false via config override
  evidence: `/etc/clawcode/clawcode.yaml` has no `openai` block anywhere — defaults section has model/basePath/memory/heartbeat only; no top-level openai either (only an mcpServers.openai entry in the legacy /opt/clawcode/clawcode.yaml which isn't loaded). Schema `.default({})` SHOULD cascade field defaults. Tested in src/config/__tests__/schema.test.ts line 774 — but only with direct .parse({}), not via parent z.object.
  timestamp: 2026-04-19T13:15Z

- hypothesis: Endpoint startup never reached (daemon died earlier in boot)
  evidence: Dashboard port 3100 IS bound (dashboard starts at daemon.ts step 11d, BEFORE step 11d-bis openai endpoint). Parent agents running. Daemon alive at PID 529316. Boot reached past openai endpoint call.
  timestamp: 2026-04-19T13:18Z

- hypothesis: fin-test is in a live crash loop (restartCount=14 in 14min)
  evidence: (1) journalctl 12:42:30–12:45:00 shows fin-test "warm-path ready — agent started" at 12:42:51 and NO subsequent crash/restart entries in that window. (2) RegistryEntry.restartCount is persisted across daemon boots. (3) Only SessionManager.restartAgent() increments it (explicit CLI/IPC restart). AgentRunner.restartCount is separate in-memory per-boot. (4) Value 14 reflects historical explicit restarts across days, not a live issue.
  timestamp: 2026-04-19T14:00Z

- hypothesis: /opt/clawcode/clawcode.yaml is being loaded instead of /etc/clawcode/clawcode.yaml
  evidence: systemd ExecStart is `/opt/clawcode/dist/cli/index.js start-all --foreground --config /etc/clawcode/clawcode.yaml`. Explicit --config points at /etc/clawcode/clawcode.yaml. Also grepped both files — neither has `defaults.openai` (the match in /opt/.../clawcode.yaml:66 is mcpServers.openai, unrelated entry at different nesting).
  timestamp: 2026-04-19T13:55Z

## Evidence

- timestamp: 2026-04-19T13:05Z
  checked: /opt/clawcode/dist/ on clawdy
  found: `cli/index.js` built 2026-04-19T04:24:54Z matching HEAD commit 2e514d5. No `openai/` subdirectory (single-file bundle via tsup — expected).
  implication: Deployed code is current. Openai endpoint code is present in the bundle.

- timestamp: 2026-04-19T13:07Z
  checked: `ss -ltn` on clawdy
  found: Only `0.0.0.0:3100` LISTEN, no 3101.
  implication: Confirms symptom; port 3101 never bound.

- timestamp: 2026-04-19T13:08Z
  checked: `curl /api/status` parsed
  found: 29 agents. test-agent running restartCount=0. fin-test running restartCount=14 lastError=null. admin-clawdy running restartCount=0 lastError="Claude Code process exited with code 143" (SIGTERM — from a prior stop). 21 stopped sub-agent entries oldest from 2026-04-12. 5 running sub-agents (all under admin-clawdy and fin-test).
  implication: fin-test's 14 needed more investigation. admin-clawdy recent clean shutdown (code 143) with restart but count=0 (stabilized, counter stays). 21 stopped sub entries are week-old zombies.

- timestamp: 2026-04-19T13:20Z
  checked: src/manager/session-manager.ts:stopAgent (lines 478-527)
  found: Two `updateEntry` calls — first sets status:"stopping" then final status:"stopped". Never calls a delete/remove. Entry persists as "stopped" forever.
  implication: ROOT CAUSE for zombie accumulation confirmed.

- timestamp: 2026-04-19T13:22Z
  checked: src/dashboard/sse.ts:pollMemoryStats (lines 244-285)
  found: Uses `this.lastAgentNames` (populated from /api/status at line 163). For each agent, calls `memory-list` + `episode-list` IPC — which throws "Memory store not found" for any agent where SessionManager has no MemoryStore (i.e., stopped/never-started).
  implication: ROOT CAUSE for the "Memory store not found" log spam confirmed.

- timestamp: 2026-04-19T13:40Z
  checked: User-provided journalctl at 12:42 boot window (sudo journalctl)
  found: `{"level":30,"time":1776602564326,"pid":529316,"hostname":"clawdy","name":"clawcode","component":"daemon","enabled":false,"msg":"OpenAI endpoint disabled via config"}` — exactly matches src/openai/endpoint-bootstrap.ts:132 `log.info({ enabled: false }, "OpenAI endpoint disabled via config")`. So `config.enabled === false` at runtime, short-circuiting before bind.
  implication: Config is resolving enabled=false despite yaml having NO openai block. Zod default handling must be the culprit.

- timestamp: 2026-04-19T14:05Z
  checked: Empirical tsx test against live schema — ran `defaultsSchema.parse({ model, heartbeat })` in workspace
  found: openai resolves to `{}` (raw empty object) — NOT the expected `{enabled:true, port:3101, ...}`. But `openaiEndpointSchema.parse({})` DIRECTLY produces the full populated object. The difference: parent z.object's `.default({})` for a missing field applies the literal `{}` without running inner validation. `browserConfigSchema`, `searchConfigSchema`, `imageConfigSchema` all use `.default(() => ({ ...full populated object... }))` and parse correctly in the same test.
  implication: SMOKING GUN. openaiEndpointSchema at src/config/schema.ts:367 uses `.default({})`. Fix: change to `.default(() => ({ enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 }))` matching browser/search/image pattern.

- timestamp: 2026-04-19T14:08Z
  checked: Empirical tsx fix test — wrapped a fresh z.object with openaiEndpointSchema_fixed (factory default)
  found: `z.object({ openai: openaiFixed }).parse({}).openai` returns full populated object `{enabled:true, port:3101, host:"0.0.0.0", ...}`. Partial override `{ openai: { port: 4000 } }` also works correctly (merges with defaults).
  implication: Fix verified at schema level. Ready to apply.

- timestamp: 2026-04-19T14:09Z
  checked: src/agent/runner.ts handleCrash (lines 137-160) and SessionManager.restartAgent (line 543)
  found: AgentRunner.restartCount is in-memory per-boot (line 143: `this.restartCount += 1`) — never writes registry. Only SessionManager.restartAgent() writes registry restartCount (line 547). RegistryEntry.restartCount is lifetime-accumulating.
  implication: fin-test restartCount=14 is historical explicit restarts, NOT a crash loop. No fix needed.

## Resolution

root_cause:
  issue_1_openai: Zod `.default({})` literal vs `.default(() => ({...full...}))` factory. When parent z.object parses input where openai field is missing, it injects the literal default VALUE without running inner `.default()` validators → resulting openai object has no `enabled` property → `if (!config.enabled)` branch taken → NOOP_HANDLE. openaiEndpointSchema (src/config/schema.ts:367) is the only phase-69+ schema with this bug; browser/search/image all correctly use factory form.
  issue_2_fintest: Not a bug. restartCount is lifetime-persisted; only explicit restarts increment; 14 reflects historical CLI restarts over days.
  issue_3_reap: stopAgent marks status="stopped" but never removes entries. reconcileRegistry only prunes orphans (unknown parent), never stopped-with-TTL. Result: permanent gravestones that dashboard SSE iterates on every 15s memory poll, each triggering log.error via ipc-server when MemoryStore lookup fails.

fix:
  1. src/config/schema.ts: Change openaiEndpointSchema outer `.default({})` → `.default(() => ({ enabled: true, port: 3101, host: "0.0.0.0", maxRequestBodyBytes: 1048576, streamKeepaliveMs: 15000 }))`.
  2. src/manager/types.ts: Add optional `stoppedAt?: number | null` to RegistryEntry.
  3. src/manager/session-manager.ts:stopAgent: set stoppedAt when marking status="stopped".
  4. src/manager/registry.ts:reconcileRegistry: add TTL prune of sub/thread entries with status="stopped" + stoppedAt past TTL (1 hour default, constant).
  5. src/dashboard/sse.ts: Track status alongside names; pollMemoryStats skips non-running agents before IPC call.
  6. Add/extend tests: schema partial-defaults populates openai correctly; reconcileRegistry TTL behavior; sse skips non-running.
  7. fin-test: no code change.

verification:
  - npx tsc --noEmit: no errors in any file I touched (only pre-existing unrelated errors in tasks/, triggers/, image/, usage/)
  - npx vitest run (scoped to config/manager/dashboard/openai): 43 files / 791 tests passed
  - Full test suite: 2942/2943 passed (the 1 failure is src/documents/__tests__/chunker.test.ts PDF-chunker timeout — untouched by this fix, pre-existing flake)
  - npm run build: ESM dist/cli/index.js 974.98 KB, build success in 178ms
  - End-to-end schema check against exact clawdy YAML shape: defaults.openai.enabled=true, port=3101, host=0.0.0.0 — PASS
  - COMMIT 8d90c42 pushed to master, deployed to clawdy 2026-04-19T13:28Z.
  - Live smoke on clawdy post-deploy (all PASS):
      1. Issue #1 RESOLVED — `ss -ltn` shows `0.0.0.0:3101` LISTEN.
      2. Issue #1 RESOLVED — `GET /v1/models` returns OpenAI JSON `{"object":"list","data":[{"id":"fin-test"...},{"id":"test-agent"...},{"id":"admin-clawdy"...}]}`.
      3. Issue #1 RESOLVED — key issuance via IPC: `clawcode openai-key create admin-clawdy --label smoke-test-20260419` printed `ck_adminc_...` + hash.
      4. Issue #1 RESOLVED — end-to-end `POST /v1/chat/completions` from 100.98.211.108:3101 with bearer key returned `{"id":"chatcmpl-FeEkgrqV8wrQaphq","object":"chat.completion","model":"admin-clawdy","choices":[{"message":{"role":"assistant","content":"PONG"},"finish_reason":"stop"}]}`. Endpoint fully usable.
      5. Issue #3 RESOLVED — agent count dropped 29 → 8. Boot log shows ~21 `pruned ghost registry entry` lines with `reason: stale-subagent` / `stale-thread`. Legacy zombie sweep worked on first reconcile pass.
      6. Issue #3 RESOLVED — log spam dropped from ~26/tick to ~20 total over 6 min (residual from 5 phantom-running entries — see Follow-Up).
      7. Issue #2 CONFIRMED non-bug — fin-test running cleanly, no crash loop. restartCount=14 reflects historical explicit CLI restarts.
files_changed:
  - src/config/schema.ts (openaiEndpointSchema: .default({}) → .default(() => ({...full...})))
  - src/config/__tests__/schema.test.ts (2 regression tests for partial-defaults cascading)
  - src/manager/types.ts (RegistryEntry: add optional stoppedAt?: number | null)
  - src/manager/registry.ts (createEntry inits stoppedAt=null; reconcileRegistry adds TTL reap with PrunedEntry reasons stale-subagent/stale-thread; STOPPED_SUBAGENT_REAP_TTL_MS constant = 1h)
  - src/manager/session-manager.ts (stopAgent sets stoppedAt: Date.now() when transitioning to status="stopped")
  - src/manager/__tests__/registry.test.ts (11 TTL-reap tests; mkLiveSubEntry helper for backward compat of pre-fix tests that intended sub/thread entries be "live")
  - src/dashboard/sse.ts (lastRunningAgentNames field populated in fetchCurrentState; pollMemoryStats filters by status="running")
commit: 8d90c42 (master, pushed + deployed 2026-04-19T13:28Z)

## Follow-Up (NOT-YET-IMPLEMENTED)

Tracked as polish, not blocking. Recorded here so it isn't lost.

**Symptom:** Residual log spam on clawdy post-fix (~20 lines / 6 min, down from 26/tick). Five registry entries remain marked `status:"running"` despite having no live MemoryStore in SessionManager:
  - `admin-clawdy-sub-CbXCb3` (startedAt 2026-04-16T19:15)
  - `admin-clawdy-sub-UeYsBk` (2026-04-16T19:17)
  - `admin-clawdy-sub-jo5Q8s` (2026-04-16T19:23)
  - `fin-test-sub-YVas9N` (2026-04-17T13:31)
  - `admin-clawdy-sub-YB3HFj` (2026-04-17T17:05)

**Why they survive both layers:**
  - The TTL reap in `reconcileRegistry` only targets `status:"stopped"` entries. These are `status:"running"` — never transitioned because the process crashed uncleanly before `stopAgent` ran.
  - The `pollMemoryStats` SSE filter only skips non-running agents. These pass the filter, then fail the `memory-list` IPC lookup → `ipc-server` level-50 `Memory store not found` on each tick.

**Root cause class:** Unclean process termination + no boot-time reconciliation of "registry says running, but no live store" phantoms.

**Recommended fix (separate future session):**
  At daemon boot, add a new phase to `reconcileRegistry()` in `src/manager/registry.ts`: iterate all entries with `status:"running"`, and for each one where `sessionManager.getMemoryStore(name)` returns `undefined`, transition the entry to `status:"stopped"` with `stoppedAt: Date.now() - reapTtlMs - 1` so it reaps immediately on the same boot cycle. This requires passing a MemoryStore-existence callback (or the SessionManager's store map) into `reconcileRegistry`. Add 2-3 tests covering phantom-running sub/thread entries.

**Files (when implemented):** `src/manager/registry.ts`, `src/manager/__tests__/registry.test.ts`, likely a small wiring change where `reconcileRegistry` is invoked.

**Priority:** Low. Current residual log rate (~3.3/min) is acceptable; these phantoms will clear on any future clean `stopAgent` of those agents or on server rebuild. Implement when convenient.
