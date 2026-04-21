---
phase: 74-seamless-openclaw-backend-caller-provided-agent-config
plan: 02
subsystem: api
tags: [openai-endpoint, openclaw-integration, security, cost-attribution, usage-tracker, shutdown-drain, denyScopeAll, smoke, readme]

# Dependency graph
requires:
  - phase: 74-01
    provides: TransientSessionCache, OpenClawTemplateDriver, caller-identity routing, onUsage callback slot
  - phase: 73-openclaw-endpoint-latency
    provides: SessionManager.drain primitive used in shutdown ordering
  - phase: 72-image-generation-mcp
    provides: Pitfall 8 pattern (tracker.record failure is non-fatal via try/catch + log.warn)
  - phase: 69-openai-compatible-endpoint
    provides: OpenAiSessionDriver, sendError/OpenAI error envelope, scope-aware bearer auth
provides:
  - securityConfigSchema.denyScopeAll (per-agent boolean, default false)
  - OpenAiServerConfig.getAgentConfig accessor (narrow projection — security.denyScopeAll read-only)
  - server.ts denyScopeAll gate on scope='all' branch — 403 agent_forbids_multi_agent_key
  - ResolvedAgentConfig.security.denyScopeAll field (shared/types.ts)
  - endpoint-bootstrap wires UsageTracker.record via OpenClawTemplateDriver.onUsage (agent='openclaw:<slug>')
  - OpenAiEndpointHandle.transientCache exposed for observability
  - endpoint-bootstrap close() drains TransientSessionCache BEFORE server.close()
  - scripts/smoke-openclaw-backend.mjs zero-dep SSE TTFB cache-hit smoke
  - README "OpenClaw Backend (Phase 74)" operator section
affects: Phase 74 milestone closure — BACKEND-02/03/04 end-to-end.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-agent security gate with optional DI accessor — getAgentConfig?: callback defaults to permissive when absent, keeps server.ts hermetic from src/config/schema.ts at compile time"
    - "Caller-attributed cost rows via fleet-anchor UsageTracker lookup — transient sessions have no native agent, so rows route to the first top-level agent's DB with agent='openclaw:<slug>' keeping them distinguishable at query time"
    - "Shutdown drain order swap — transientCache.closeAll() BEFORE server.close() so in-flight SDK subprocesses abort cleanly rather than orphaning mid-turn when sockets get yanked"
    - "Zero-dep smoke script with 3-tier exit code (0 ok / 1 assertion / 2 infra-skip) and /v1/models probe distinguishing daemon-down from auth-rejection paths"

key-files:
  created:
    - src/openai/__tests__/server-deny-scope-all.test.ts
    - src/openai/__tests__/template-driver-cost-attribution.test.ts
    - scripts/smoke-openclaw-backend.mjs
    - .planning/phases/74-seamless-openclaw-backend-caller-provided-agent-config/74-02-SUMMARY.md
  modified:
    - src/config/schema.ts (+denyScopeAll on securityConfigSchema)
    - src/config/__tests__/schema.test.ts (+4 denyScopeAll schema tests)
    - src/openai/server.ts (+getAgentConfig field on OpenAiServerConfig, +denyScopeAll gate in scope='all' branch)
    - src/openai/endpoint-bootstrap.ts (+getAgentConfig wiring from SessionManager, +UsageTracker.record via onUsage, +shutdown order swap, +transientCache on handle)
    - src/shared/types.ts (+denyScopeAll on ResolvedAgentConfig.security)
    - src/manager/daemon.ts (stamp Phase 74 shutdown-order invariant comment)
    - README.md (+OpenClaw Backend (Phase 74) operator section)

key-decisions:
  - "Phase 74-02: denyScopeAll gate placement — inside the `if (row.scope === 'all')` branch AFTER partial.agent stamp, BEFORE else-if pinned-scope check. Only fires for scope='all' bearer keys, never for pinned keys (pinned keys targeting a different agent hit agent_mismatch, not agent_forbids_multi_agent_key — orthogonal failure modes, matching the CONTEXT 'per-agent opt-out' design vs global 'all scope='all' keys rejected' alternative)."
  - "Phase 74-02: getAgentConfig returns a structural subset, not the full ResolvedAgentConfig — server.ts stays hermetic from src/config/schema.ts (keeps Phase 69 test-harness boundary clean). endpoint-bootstrap narrows ResolvedAgentConfig → { security: { denyScopeAll? } } at the call site."
  - "Phase 74-02: openclaw-template branch bypasses denyScopeAll entirely — the template path is guarded by extractCallerIdentity's own scope='all' check and reaches a SEPARATE dispatch branch (5a) that never consults config.getAgentConfig. Test 9 of server-deny-scope-all.test.ts pins this invariant."
  - "Phase 74-02: Fleet-anchor UsageTracker lookup for transient turns — UsageTracker instances are per-agent, but transient sessions have no native agent. Route rows to the first top-level agent's DB. The agent column ('openclaw:<slug>') keeps rows distinguishable from native rows at query time, so `clawcode costs` groups correctly without any CLI change. When no top-level agent exists, tracker.record is silently skipped (Pitfall 8: cost accounting never breaks a turn)."
  - "Phase 74-02: Tier encoded in `model` column, NEVER the `agent` column — slug='fin-test' + tier='opus' emits agent='openclaw:fin-test' (not 'openclaw:fin-test:opus'), model='claude-opus-4-7'. Matches CONTEXT D-04: cost rollup by caller gets one row per caller, not fragmenting per (caller, tier). Test 2+6 of template-driver-cost-attribution.test.ts pins agent string never contains ':opus' / ':sonnet' / ':haiku' tier suffix."
  - "Phase 74-02: Shutdown drain order — transientCache.closeAll() runs BEFORE handle.close() (which does Pitfall 10 activeStreams iteration + server.close). Rationale: in-flight transient-SDK subprocesses need to finish cleanly or abort with AbortError BEFORE the server forcibly yanks sockets. This extends the quick task 260419-q2z SessionManager.drain pattern to the transient-session lifecycle (daemon.ts calls manager.drain() → openAiEndpoint.close() in order; close() then drains transient cache before server)."

patterns-established:
  - "Pattern: Opt-in per-agent security flag with narrow DI accessor — getAgentConfig? callback returns structural subset so server.ts stays decoupled from src/config; absent callback defaults to permissive (preserves Phase 69 back-compat test suite byte-for-byte)."
  - "Pattern: Caller-attributed cost rows without schema change — `agent` column carries 'openclaw:<slug>' prefix; same usage_events table; existing getCostsByAgentModel groups naturally. Orthogonal to Phase 72's category column (which splits image vs token rows)."
  - "Pattern: Graceful shutdown drain extends SessionManager.drain to per-subsystem caches — daemon.ts orders manager.drain() → subsystem close() where each subsystem close() runs its own internal drain (transientCache here; will generalize to other caches as they appear)."

requirements-completed:
  - BACKEND-02
  - BACKEND-03
  - BACKEND-04

# Metrics
duration: 19min
completed: 2026-04-19
---

# Phase 74 Plan 02: Security + Cost Attribution + Shutdown Drain + Smoke + README Summary

**Per-agent `security.denyScopeAll` flag gates scope='all' bearer keys on admin-grade native agents; every completed openclaw-template turn attributes cost to `agent="openclaw:<slug>"` via the UsageTracker; daemon shutdown drains the transient-session cache before yanking sockets; operator-facing smoke + README land alongside.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-04-19T23:40:11Z
- **Completed:** 2026-04-19T23:59:30Z
- **Tasks:** 3 (all committed atomically on master, NOT pushed)
- **Files created:** 3 (2 test files + smoke script) + summary
- **Files modified:** 7
- **Tests added:** 27 (4 schema + 9 server-deny-scope-all + 14 template-driver-cost-attribution)
- **Total tests in repo:** 3249 (3241 pass / 8 pre-existing baseline failures — 7 daemon-openai.test.ts + 1 session-manager.test.ts, verified on pre-Plan-74-02 HEAD via git checkout)
- **tsc errors:** 29 (unchanged baseline — zero Plan 74-02 contribution)
- **Build:** `npm run build` succeeds, tsup ESM 1.02 MB in ~205ms

## Accomplishments

- `securityConfigSchema.denyScopeAll: z.boolean().default(false)` — per-agent opt-in gate; admin-grade agents (admin-clawdy) set it via `clawcode.yaml` to reject scope='all' bearers.
- `server.ts` denyScopeAll gate fires INSIDE the `if (row.scope === 'all')` branch and returns 403 permission_error + code='agent_forbids_multi_agent_key'. Pinned keys, openclaw-template requests, and unknown-config-lookup paths all bypass the gate (separate orthogonal failure modes).
- `endpoint-bootstrap.ts` wires `getAgentConfig: (name) => sessionManager.getAgentConfig(name) ?? null` via a narrow structural projection (keeps server.ts hermetic from src/config/schema.ts).
- Every completed openclaw-template turn fires `OpenClawTemplateDriver.onUsage` which invokes `UsageTracker.record` with `agent='openclaw:${input.callerSlug}'`, `model=TIER_MODEL_MAP[input.tier]`, `session_id=handle.sessionId`, `turns=1`, and `duration_ms=elapsedMs`. Failures in record() are caught + logged via `log.warn` (Pitfall 8 — cost accounting never breaks a turn).
- Tier encoded in the MODEL column, NEVER the AGENT column — slug='fin-test' + tier='opus' → agent='openclaw:fin-test', model='claude-opus-4-7'. One row per caller in `clawcode costs`, not fragmented by (caller, tier).
- Shutdown drain order: daemon.ts calls `manager.drain(15_000)` → `openAiEndpoint.close()` → `browserManager.close()` → `server.close()`. Inside openAiEndpoint.close(): `transientCache.closeAll()` FIRST, then `handle.close()` (Pitfall 10 activeStreams + server), then `apiKeysStore.close()`, then `requestLogger.close()`. In-flight transient turns abort with AbortError; no leaked SDK subprocesses.
- `OpenAiEndpointHandle.transientCache` exposed for admin/observability (daemon shutdown doesn't need it — close() handles drain internally).
- `scripts/smoke-openclaw-backend.mjs` — zero-dep Node ESM; probes `/v1/models`, POSTs two sequential `openclaw:<slug>:<tier>` streaming requests, compares TTFB as a soft cache-hit signal. Exit codes: 0 success / 1 assertion failure / 2 infra skip (daemon unreachable, missing key, SDK disabled).
- README adds "OpenClaw Backend (Phase 74)" section: model-id semantics, `openclaw.json` provider snippet, shared/not-shared matrix (tools flow through; workspace/memory/MCP surface do NOT), security guidance pointing at `security.denyScopeAll: true` for admin-grade native agents, key-management + smoke invocation.

## Task Commits

Each task was committed atomically on master (NOT pushed per constraints):

1. **Task 1: security.denyScopeAll schema + server gate + tests** — `f42a853` (feat)
2. **Task 2: UsageTracker cost attribution for openclaw:<slug> transient turns** — `a9bfdef` (feat)
3. **Task 3: Shutdown drain order + smoke script + README operator guide** — `c048c88` (feat)

## Files Created/Modified

### Created

- `src/openai/__tests__/server-deny-scope-all.test.ts` — 9 integration tests booting a real `node:http` server with a native + template driver AND a config-lookup stub. Pins: 403+agent_forbids_multi_agent_key on scope='all'+denyScopeAll=true; 200 on scope='all'+denyScopeAll=false; 200 on null config lookup (permissive default); 200 on pinned key + denyScopeAll=true (flag only gates scope='all'); 200 on openclaw:admin-clawdy:opus bypassing the flag; agent_mismatch (not agent_forbids_multi_agent_key) on pinned-on-wrong-agent path; 200 on scope='all' on a different (permissive) agent while another has the flag set; 200 without getAgentConfig at all (Phase 69 back-compat); 200 when security field is undefined.
- `src/openai/__tests__/template-driver-cost-attribution.test.ts` — 14 unit tests covering the onUsage callback contract: invoked exactly once per completed turn with (input, usage, sessionId, elapsedMs) tuple; agent='openclaw:<slug>' never contains tier suffix; tier→model mapping for sonnet/opus/haiku; tokens/cost flow-through from SDK usage struct; sessionId matches handle.sessionId; onUsage throwing is caught + result event still emitted; elapsedMs non-negative; multi-turn reuses handle and fires onUsage per turn with same sessionId; category/backend/count undefined by default (keeps rows in the 'tokens' rollup); undefined usage fields mapped to 0 at the callsite.
- `scripts/smoke-openclaw-backend.mjs` — 187 lines, zero-dep Node ESM; shebang + exec bit; `#!/usr/bin/env node`. Probes /v1/models first (distinguishes daemon-down from auth-rejection), then runs 2 sequential streaming POSTs with a 500ms gap, parses SSE `data:` frames, measures TTFB via first content delta arrival. Prints JSON summary on success.

### Modified

- `src/config/schema.ts` — securityConfigSchema extended with `denyScopeAll: z.boolean().default(false)` + Phase 74 docstring pointing at `admin-clawdy` as the canonical use case.
- `src/config/__tests__/schema.test.ts` — 4 new tests: parse with denyScopeAll=true; default false when omitted; reject non-boolean; agent-level config with admin=true + security.denyScopeAll=true round-trips.
- `src/openai/server.ts` — OpenAiServerConfig gained `getAgentConfig?: (name) => { security?: { denyScopeAll?: boolean } } | null | undefined`. Gate lands INSIDE the scope='all' branch (not before it, not in a new pre-dispatch phase) — keeps the scope-resolution path in one place.
- `src/openai/endpoint-bootstrap.ts` — wires `getAgentConfig` narrowing ResolvedAgentConfig to the server's structural subset; wires `onUsage` callback via fleet-anchor UsageTracker lookup + Pitfall 8 guard; `OpenAiEndpointHandle.transientCache` field added; close() drain order swap + info log with cacheSize when non-empty.
- `src/shared/types.ts` — ResolvedAgentConfig.security gained `readonly denyScopeAll: boolean` (required — Zod default produces a non-undefined value post-parse).
- `src/manager/daemon.ts` — Phase 74 invariant comment stamped on the existing `await openAiEndpoint.close()` line; no behavioural change (the order manager.drain → endpoint.close already held post-Phase-69 + post-quick-task-q2z).
- `README.md` — added "OpenClaw Backend (Phase 74)" section under the OpenAI-Compatible Endpoint area with openclaw.json provider snippet, shared/not-shared bullet matrix, security guidance, smoke invocation.

## Decisions Made

1. **denyScopeAll gate placement inside scope='all' branch (not pre-branch)** — colocating the check with the other scope-resolution logic keeps the scope/auth flow in one place. A pre-branch placement would duplicate knownAgents lookups (scope check also wants to know the target agent exists) and diverge from Phase 69's single-source-of-truth pattern.

2. **getAgentConfig as structural subset, not ResolvedAgentConfig passthrough** — server.ts has a long-standing "zero imports from src/config/" invariant (Phase 69 research). A full ResolvedAgentConfig passthrough would either (a) require importing the type into server.ts, breaking the boundary, or (b) couple server.ts tests to 50+ config fields irrelevant to the gate. Structural subset keeps the contract minimal and the test surface tight.

3. **Fleet-anchor UsageTracker lookup for transient turns** — UsageTracker instances are per-agent (wrapping per-agent SQLite files). Transient sessions have NO native agent. Three options considered:
   - A daemon-level "shared" UsageTracker — requires new DB file + schema + CLI migration.
   - Route by caller slug to a matching native agent — scope='all' keys are multi-tenant, slugs don't map 1:1 to agents.
   - Route to the first top-level agent's tracker DB; distinguish rows via the `agent` column — zero schema change, existing `getCostsByAgentModel` groups naturally.
   Chose option 3. Caveat: rows pile into whichever agent's DB file happens to be the alphabetical / insertion-order first — `clawcode costs` still groups correctly (agent column is authoritative), but if an operator deletes agent A's DB, `openclaw:*` rows may disappear too. Documented in endpoint-bootstrap.ts inline comment.

4. **Tier encoded in `model` column, NOT `agent` column (CONTEXT D-04 confirmed)** — otherwise the same caller using sonnet one day and opus the next would appear as two separate agents in `clawcode costs`, fragmenting cost visibility. The `model` column already carries per-tier distinction (claude-sonnet-4-6 vs claude-opus-4-7), and `getCostsByAgentModel` groups by (agent, model) — operators see one row per caller with a breakdown per model used.

5. **Shutdown drain order — transientCache.closeAll() BEFORE server.close(), not after** — if server.close() ran first, it would start tearing down the listening socket while transient SDK subprocesses are still mid-turn; those SDK subprocesses would see socket closure mid-stream and potentially corrupt their state. Draining the cache first means every SDK subprocess either completes cleanly or aborts via AbortError, with a live server behind them to emit the final SSE frames. Matches the SessionManager.drain pattern from quick task 260419-q2z.

6. **Exit code convention on smoke — 2 for infra-skip — inherited from Phase 70/71/72 smoke pattern** — lets CI / cron wrappers treat "daemon not running" as a skip rather than a test failure, while still flagging genuine assertion failures (1) and successes (0). The /v1/models probe before POST also catches "daemon up but endpoint disabled" as a clean 2, not a misleading 1.

## Deviations from Plan

None — plan executed exactly as written. Pitfall 4 (daemon drain ordering already held post-Phase-69 + quick task q2z) saved one implementation step but the comment stamp was still added to keep the invariant visible.

### Edge cases handled during execution

- **Schema test 3 (reject non-boolean) initially passed during RED phase because Zod silently dropped the unknown `denyScopeAll` field** — writing the test BEFORE the field existed, Zod ignored `denyScopeAll: "yes"` as an extra property (zod 4.x default behaviour is non-strict). After adding the field to the schema, the same test correctly fails on the non-boolean value. No action needed — the TDD RED→GREEN cycle covered it.
- **ResolvedAgentConfig.security was defined in src/shared/types.ts, NOT derived from Zod** — the two were intentionally decoupled in earlier phases (so Zod changes don't ripple everywhere). Added the field in both places; the schema tests prove Zod default works, and the structural subset in server.ts means the exact-match is only required at the endpoint-bootstrap wiring site.

## Issues Encountered

- **8 pre-existing daemon-openai.test.ts + session-manager.test.ts failures** — baseline per STATE.md quick task 260419-q2z + 74-01 SUMMARY. Verified reproducible on pre-Plan-74-02 HEAD (commit 59c4d7e) via git checkout + vitest. Not a regression. Plan 74-02 added 27 new passing tests; full-suite count climbed from 3214 pass / 8 fail (74-01 baseline) to 3241 pass / 8 fail.

## Verification

- `npx tsc --noEmit` — 29 errors (unchanged baseline; zero Plan 74-02 contribution).
- `npx vitest run src/openai src/config src/usage --reporter=dot` — 571 pass / 0 fail across 29 files.
- `npx vitest run --reporter=dot` (full suite) — 3241 pass / 8 pre-existing baseline failures.
- `npm run build` — tsup build completes in ~205ms with no new warnings. CLI bundle 1.02 MB.
- `node --check scripts/smoke-openclaw-backend.mjs` — syntax valid, exec bit set.
- Smoke script manual run (infra-skip paths): `CLAWCODE_OPENAI_SMOKE_KEY=""` exits 2 with SKIP message; `CLAWCODE_OPENAI_HOST=http://127.0.0.1:65499` with a dummy key exits 2 with ECONNREFUSED SKIP message. Happy-path 200 requires a live clawdy daemon with the Phase 74 build + a valid scope='all' key — deferred to orchestrator-side post-deploy validation.

### Grep invariants (all confirmed)

- `denyScopeAll: z.boolean().default(false)` in src/config/schema.ts:161
- `agent_forbids_multi_agent_key` in src/openai/server.ts:755, 761 (one gate call, surface on sendError)
- `config.getAgentConfig?.(body.model)` inside the `if (row.scope === "all")` branch (line 753) — AFTER the partial.agent stamp, BEFORE the else-if pinned scope
- `getAgentConfig:` wiring in src/openai/endpoint-bootstrap.ts:290-299 narrowing ResolvedAgentConfig.security → { denyScopeAll }
- `agent: \`openclaw:${input.callerSlug}\`` in src/openai/endpoint-bootstrap.ts:276
- `model: TIER_MODEL_MAP[input.tier]` in src/openai/endpoint-bootstrap.ts:282
- `tracker.record failed (non-fatal)` log message in src/openai/endpoint-bootstrap.ts:289 (Pitfall 8)
- `transient usage callback threw (non-fatal)` log message in src/openai/template-driver.ts:202 (Pitfall 8 — double wrap)
- `transientCache.closeAll()` appears twice in src/openai/endpoint-bootstrap.ts: once in the start-failure path (existing), once in the normal close() path (NEW — runs FIRST before handle.close)
- `OpenClaw Backend (Phase 74)` section header in README.md:416
- `openclaw:<slug>` literal string in README.md:420, 471
- `security: { denyScopeAll: true }` YAML snippet in README.md:466-468
- `clawcode api-keys create --all` in README.md:455
- `exit(2,` and `exit(1,` appear 5+ and 4+ times respectively in scripts/smoke-openclaw-backend.mjs
- `openclaw:smoke-test:sonnet` is the default computed MODEL in the smoke script (SLUG default="smoke-test" + TIER default="sonnet")

## User Setup Required

Two steps for operators on clawdy (outside this plan's scope — orchestrator-owned):

1. **Add `security.denyScopeAll: true` to admin-grade agents in clawcode.yaml** — at minimum `admin-clawdy`. The README has the stanza.
2. **Create a scope='all' bearer key for OpenClaw** — `clawcode openai-key create --all --label openclaw-fleet`. Drop the resulting `ck_all_...` key into `~/.openclaw/openclaw.json` → `models.providers.clawcode.apiKey`.

After daemon restart with the new clawcode.yaml, verify the gate fires by posting `{ "model": "admin-clawdy", ... }` with the scope='all' key — should return 403 agent_forbids_multi_agent_key.

## Next Phase Readiness

- Phase 74 milestone closure: BACKEND-02/03/04 end-to-end operational. BACKEND-01 + BACKEND-05 closed in Plan 01.
- Orchestrator task list: push commits, pull on clawdy, build, restart clawcoded, update `clawcode.yaml` admin-clawdy stanza, run `scripts/smoke-openclaw-backend.mjs`, verify `clawcode costs` shows openclaw:smoke-test rows post-smoke.
- Phase 74 is the final v2.0 phase — on clean smoke, v2.0 milestone is fully shipped. Follow-ups: reasoning_effort plumb-through (separate phase), `openclaw:*` row grouping in `clawcode costs` (deferred idea in 74-CONTEXT.md).

## Self-Check: PASSED

All created files verified on disk:
- FOUND: src/openai/__tests__/server-deny-scope-all.test.ts
- FOUND: src/openai/__tests__/template-driver-cost-attribution.test.ts
- FOUND: scripts/smoke-openclaw-backend.mjs

All commits verified via `git log --oneline`:
- FOUND: f42a853 (Task 1 — feat(74-02): security.denyScopeAll per-agent gate)
- FOUND: a9bfdef (Task 2 — feat(74-02): UsageTracker cost attribution)
- FOUND: c048c88 (Task 3 — feat(74-02): shutdown drain + smoke + README)

---
*Phase: 74-seamless-openclaw-backend-caller-provided-agent-config*
*Completed: 2026-04-19*
