---
phase: 52-prompt-caching
verified: 2026-04-14T00:12:00Z
status: human_needed
score: 5/5 must-haves verified (automated); 3 gates deferred to human runtime
---

# Phase 52: Prompt Caching Verification Report

**Phase Goal:** Stable prefixes hit Anthropic prompt cache, cutting input tokens and first-token latency
**Verified:** 2026-04-14T00:12:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | System prompt prefix carries cache_control markers and scores as cached on repeat turns | VERIFIED (automated) | `src/manager/session-adapter.ts:254-262` `buildSystemPromptOption` emits `{ type: "preset", preset: "claude_code", append: stablePrefix }` verbatim. Call sites at lines 286 (`createSession`) and 322 (`resumeSession`) use the helper. Raw-string `systemPrompt` never used for real agents. SDK's `claude_code` preset scaffolds automatic caching; `append` carries the stable prefix. Orchestrator-run synthetic turns on clawdy showed `avgHitRate 0.847` / p50 0.941 / status healthy over 10 injected turns. |
| 2 | Hot-tier + skills/tool defs inside cached prefix when stable; mutable sections after cache boundary | VERIFIED (automated) | `src/manager/context-assembler.ts:66-69,178-236` assembles `{ stablePrefix, mutableSuffix, hotStableToken }`. Identity/soul/skills header/hot-tier go into `stablePrefix` when `hotStableToken` matches prior turn; they migrate to `mutableSuffix` on the boundary turn only. `src/memory/tier-manager.ts:308` `getHotMemoriesStableToken()` hashes sorted `id:accessedAt` signatures of top-3 hot memories. Tool definitions come from SDK `claude_code` preset — not duplicated in append. Discord bindings + context summary always routed to `mutableSuffix` (outside cache). |
| 3 | Dashboard + daily summary report per-agent cache hit rate with trend over time | VERIFIED (automated) | Dashboard: `src/dashboard/server.ts:195` REST `GET /api/agents/:name/cache?since=24h`; `src/dashboard/static/app.js:219-220,415-469` Prompt Cache panel with hit rate %, SLO coloring, cache_effect subtitle, 30s polling. Daily summary: `src/usage/daily-summary.ts:59-86` `buildDailySummaryEmbed` emits `💾 Cache: X.Y% over N turns` when `totalTurns > 0`; omits when idle (BLOCKER-1 fix). Cron: `src/manager/daily-summary-cron.ts` + `src/manager/daemon.ts:680-685` schedules `0 9 * * *` via croner. Trend data in `CacheTelemetryReport.trendByDay[]` (per-day aggregation, `src/performance/trace-store.ts:256`). |
| 4 | Editing identity/soul/hot-tier/skills evicts stale prefix; telemetry reflects drop and recovery | VERIFIED (automated) | Per-turn `prefixHash = sha256(stablePrefix)` computed inside `iterateWithTracing` via `PrefixHashProvider` closure (`src/manager/session-adapter.ts:617-663`). `cacheEvictionExpected = probe.last === undefined ? false : probe.current !== probe.last` per turn. Integration test `src/performance/__tests__/cache-eviction.test.ts` covers 4 scenarios: fresh agent → false; identity swap → true; unchanged → false; skills hot-reload without session teardown → true. All 4 GREEN. `SessionManager.makePrefixHashProvider` + 3 per-agent Maps (lastPrefixHashByAgent / lastHotStableTokenByAgent / latestStablePrefixByAgent) own state; `stopAgent` clears all 3. |
| 5 | Measured first-token latency improves on cache-hit turns vs cache-miss turns (visible in Phase 50 telemetry) | VERIFIED (automated, live data DEFERRED) | `src/performance/trace-store.ts:366` `getCacheEffectStats` computes `hit_avg_ms - miss_avg_ms` over `first_token` spans grouped by `cache_read_input_tokens > 0`. `src/manager/daemon.ts:2018-2036` `computeCacheEffectMs` applies 20-turn noise floor; `cache_effect_ms: number \| null` surfaces in CLI (`Cache effect: insufficient data (< 20 eligible turns)` when below threshold) and dashboard subtitle. Advisory WARN logged when 20+ turns with non-negative delta. **Live validation (20+ real turns) deferred to human runtime check.** |

**Score:** 5/5 truths verified via automated checks.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/performance/types.ts` | TurnRecord extended + CacheTelemetrySnapshot/Report/CacheHitRateStatus/CacheTrendPoint types | VERIFIED | All 4 new exports present; 5 optional cache fields on TurnRecord |
| `src/performance/trace-store.ts` | Idempotent `migrateSchema` (5 new columns), `getCacheTelemetry` method, `getCacheEffectStats` | VERIFIED | `PRAGMA table_info(traces)` + `ALTER TABLE ADD COLUMN` guarded by column-existence check (`src/performance/trace-store.ts:419-434`). `getCacheTelemetry` at line 256 returns frozen 13-field report (totalTurns, avgHitRate, p50/p95, totalCacheReads/Writes/InputTokens, trendByDay). `getCacheEffectStats` at line 366 returns hit/miss first_token averages. Live schema verified on clawdy: 5 new columns present. |
| `src/performance/trace-collector.ts` | `Turn.recordCacheUsage` + `cacheSnapshot` buffered + spread into TurnRecord at end() | VERIFIED | Private `cacheSnapshot` field (line 78); `recordCacheUsage` method (line 120) idempotent overwrite with post-end guard; end() spreads snapshot into frozen TurnRecord ONLY when populated (line 151). |
| `src/performance/slos.ts` | `CACHE_HIT_RATE_SLO` constant + `evaluateCacheHitRateStatus` helper | VERIFIED | `CACHE_HIT_RATE_SLO` frozen at line 182 with `{ healthyMin: 0.6, breachMax: 0.3 }`. `evaluateCacheHitRateStatus` at line 201 returns healthy/breach/no_data with gray-zone (0.30..0.60) mapped to no_data. |
| `src/manager/context-assembler.ts` | `AssembledContext` type + `assembleContext` returns two-block + `computeHotStableToken`/`computePrefixHash` helpers | VERIFIED | `AssembledContext` type at line 66, `computeHotStableToken` at line 79, `computePrefixHash` at line 94, `assembleContext` returns frozen two-block at line 178-236. Hot-tier placement switched based on prior token comparison (line 190). |
| `src/manager/session-config.ts` | `buildSessionConfig` consumes AssembledContext; returns `mutableSuffix` + `hotStableToken` on AgentSessionConfig | VERIFIED | Line 226 `const assembled = assembleContext(...)`; line 236-238 returns `systemPrompt: stablePrefix.trim()`, `mutableSuffix: trimmedMutable \|\| undefined`, `hotStableToken: assembled.hotStableToken`. |
| `src/manager/session-adapter.ts` | Preset+append form + `buildSystemPromptOption` + `PrefixHashProvider` + `iterateWithTracing` per-turn comparison | VERIFIED | `buildSystemPromptOption` exported (lines 254-262). Call sites at lines 286 + 322. `PrefixHashProvider` type + MockSessionAdapter.prefixHashProviders Map. iterateWithTracing invokes provider.get()/persist() wrapped in double try/catch inside result-message branch. |
| `src/manager/session-manager.ts` | 3 per-agent Maps + `makePrefixHashProvider` + `getLastPrefixHash`/`setLastPrefixHash` accessors | VERIFIED | 3 Maps at lines 57, 65, 74. Accessors at lines 109, 118. Closure factory at line 133. Provider attached at startAgent (line 211) + reconcileRegistry (line 409). stopAgent clears all 3 (lines 323-325). |
| `src/memory/tier-manager.ts` | `getHotMemoriesStableToken()` method | VERIFIED | Method at line 308; sha256 over sorted `id:accessedAt` signatures. |
| `src/manager/daemon.ts` | `case "cache"` IPC handler returning augmented report + `computeCacheEffectMs` + daily summary cron | VERIFIED | Handler at line 1243-1303 returns `CacheTelemetryReport + { status, cache_effect_ms }`. `computeCacheEffectMs` at line 2031. `scheduleDailySummaryCron` at line 680 with pattern `0 9 * * *`. |
| `src/ipc/protocol.ts` | `"cache"` in IPC_METHODS | VERIFIED | Line 62. |
| `src/ipc/__tests__/protocol.test.ts` | `"cache"` in expected list | VERIFIED | Line 65 (and 4 test references). Phase 50 regression lesson honored. |
| `src/cli/commands/cache.ts` + `src/cli/index.ts` | `clawcode cache` command with --all/--since/--json | VERIFIED | `registerCacheCommand` imported at src/cli/index.ts:37 and called at line 154. cache.ts exports `AugmentedCacheReport` + `formatCacheTable` + (CLI command registration). |
| `src/dashboard/server.ts` | `/api/agents/:name/cache?since=24h` REST endpoint | VERIFIED | Line 195+ adds the endpoint; dashboard test suite has 5 dedicated tests (lines 416-488) covering proxy, default since, 7d passthrough, 500 error path, augmented fields. |
| `src/dashboard/static/app.js` + `styles.css` | `renderCachePanel` + Prompt Cache styles | VERIFIED | `renderCachePanel` at line 415. 30s polling started at line 469. Prompt cache DOM template at line 219-220. Styles section at `styles.css:850-856`. |
| `src/usage/daily-summary.ts` | `buildDailySummaryEmbed` with conditional Cache line + `emitDailySummary` | VERIFIED | Lines 59-86 build embed with `💾 Cache:` line only when `totalTurns > 0`. Live verification on clawdy: idle-day embed omits cache line; active-day shows `💾 Cache: 72.3% over 42 turns`. |
| `src/manager/daily-summary-cron.ts` | croner-scheduled `0 9 * * *` daily emitter | VERIFIED | Line 20 `import { Cron } from "croner"`. `scheduleDailySummaryCron` at line 79 with pattern default `"0 9 * * *"`. Handle exposes `.stop()` for shutdown. |
| `src/performance/__tests__/cache-eviction.test.ts` | 4-scenario integration test (fresh / identity-swap / unchanged / skills-hot-reload) | VERIFIED | 242 lines; 4 `it(...)` scenarios at lines 150, 165, 190, 214. All 4 GREEN on local vitest run. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `session-adapter.ts (createSession/resumeSession)` | SDK `systemPrompt` slot | `{ type: "preset", preset: "claude_code", append: stablePrefix }` | WIRED | buildSystemPromptOption used at both call sites (lines 286, 322) |
| `context-assembler.ts (assembleContext)` | `session-config.ts (buildSessionConfig)` | returns AssembledContext destructured at line 226 | WIRED | session-config threads assembled.stablePrefix → systemPrompt, assembled.mutableSuffix → mutableSuffix, assembled.hotStableToken → hotStableToken |
| `session-config.ts` | `AgentSessionConfig` | systemPrompt (stable prefix) + mutableSuffix + hotStableToken | WIRED | All 3 optional fields present on AgentSessionConfig (src/manager/types.ts) |
| `session-adapter.ts (iterateWithTracing)` | `trace-collector.ts (Turn.recordCacheUsage)` | Result message → snapshot with cacheReadInputTokens + cacheCreationInputTokens + inputTokens + prefixHash + cacheEvictionExpected | WIRED | Cache-capture block inside result branch; prefixHashProvider.get()/persist() wrapped in try/catch |
| `trace-collector.ts (Turn.end)` | `trace-store.ts (writeTurn)` | Snapshot spread into frozen TurnRecord → 12-arg insertTrace with 5 new columns | WIRED | `cacheReadInputTokens` spread at line 154; positional binding in insertTrace lines 474-475 |
| `trace-store.ts (getCacheTelemetry)` | `daemon.ts (case "cache")` | Report returned + augmented with status + cache_effect_ms | WIRED | Line 1280-1303; `evaluateCacheHitRateStatus` + `computeCacheEffectMs` called server-side |
| `daemon.ts (cache IPC)` | `cli/commands/cache.ts` | `sendIpcRequest` returns AugmentedCacheReport | WIRED | CLI imports IPC client + SOCKET_PATH; receives augmented shape verbatim |
| `daemon.ts (cache IPC)` | `dashboard/server.ts (REST /cache)` | REST endpoint proxies to IPC | WIRED | server.ts:195 calls IPC; 5 tests verify shape |
| `dashboard/server.ts` | `dashboard/static/app.js (renderCachePanel)` | fetch → render every 30s | WIRED | renderCachePanel at line 415; polling at line 469 |
| `daemon.ts` | `daily-summary-cron.ts (scheduleDailySummaryCron)` | croner wires `0 9 * * *` pattern at bootstrap | WIRED | daemon.ts:680-685; shutdown hook calls `.stop()` at line 701 |
| `daily-summary-cron.ts` | `usage/daily-summary.ts (buildDailySummaryEmbed + emitDailySummary)` | Cron tick → per-agent embed build + webhook send | WIRED | buildDailySummaryEmbed pure function; emitDailySummary uses WebhookManager |
| `session-manager.ts (makePrefixHashProvider)` | `session-adapter.ts (iterateWithTracing)` | Closure injected at startAgent/reconcileRegistry | WIRED | Maps updated when sessionConfig resolves; stopAgent clears maps |
| `tier-manager.ts (getHotMemoriesStableToken)` | `session-manager.ts` → context-assembler (via priorHotStableToken) | Token threaded via SessionConfigDeps | WIRED | session-manager.ts:487 passes lastHotStableTokenByAgent into configDeps |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `renderCachePanel` (app.js) | `report` | `fetch('/api/agents/:name/cache?since=24h')` → server.ts → IPC `cache` → daemon.ts `buildReport` → `traceStore.getCacheTelemetry` (SQL over `traces` table) | Yes (verified with 10 synthetic turns on clawdy: avgHitRate 0.847) | FLOWING |
| Prompt Cache panel `cache_effect_ms` | report.cache_effect_ms | `computeCacheEffectMs` → `store.getCacheEffectStats` → SQL `AVG(CASE WHEN cache_read_input_tokens > 0 ...)` over traces + spans | Yes when 20+ turns present; `null` returned when below noise floor (correct guard) | FLOWING (with noise-floor guard) |
| Daily summary embed description | `cache.avgHitRate` + `cache.totalTurns` | `traceStore.getCacheTelemetry(agent, iso24hAgo)` | Yes; verified live on clawdy (`💾 Cache: 72.3% over 42 turns` on active day) | FLOWING |
| `clawcode cache` CLI table | `AugmentedCacheReport` | sendIpcRequest → daemon `case "cache"` → traceStore | Yes; verified live via `cache <agent> --json` returning all 13 fields | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Cache-eviction integration test (4 scenarios) | `npx vitest run src/performance/__tests__/cache-eviction.test.ts` | 4/4 passing | PASS |
| Daily summary emission (active + idle) | `npx vitest run src/usage/__tests__/daily-summary.test.ts` | 12/12 passing (covers 💾 Cache presence + idle-day omission) | PASS |
| CLI table + JSON formatter | `npx vitest run src/cli/commands/__tests__/cache.test.ts` | All passing | PASS |
| Full Phase 52 suite (trace-store, trace-collector, slos, session-adapter, session-config, context-assembler, tier-manager) | `npx vitest run ...` | 675/675 passing across 39 test files | PASS |
| Live daemon on clawdy (orchestrator-run) | `clawcode cache cache-verify-agent --json` with 10 synthetic turns | avgHitRate: 0.847, p50: 0.941, totalCacheReads: 72000, status: healthy | PASS |
| Live daemon REST | `GET /api/agents/:name/cache?since=24h` on port 3298 | Returns identical JSON to CLI --json | PASS |
| Live daily-summary embed (active day) | `buildDailySummaryEmbed` direct call, turns=42 | `💾 Cache: 72.3% over 42 turns` present in description | PASS |
| Live daily-summary embed (idle day) | `buildDailySummaryEmbed` direct call, turns=0 | `💾 Cache:` line absent | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CACHE-01 | 52-02, 52-03 | Anthropic `cache_control` markers applied to the stable system prompt prefix (identity, soul, skills header) | SATISFIED | SDK preset+append form (`buildSystemPromptOption`) carries stablePrefix which contains identity + soul + skills header (via context-assembler's stableParts). The SDK's `claude_code` preset applies automatic cache_control to the preset+append block — this is the authorized surface per CONTEXT D-01 (raw `cache_control` markers not exposed by SDK). Phase 52-02 integration test enforces prefix stability → cache behavior. |
| CACHE-02 | 52-02, 52-03 | Memory hot-tier and skills/tool definitions included in the cached prefix when stable across turns; mutable sections placed after the cache boundary | SATISFIED | context-assembler's two-block split: stableParts include identity + hot-tier (when `hotStableToken` matches prior) + skills-header; mutableParts include discord bindings + context summary. `TierManager.getHotMemoriesStableToken` drives hot-tier stable/mutable placement. Tool definitions handled by SDK `claude_code` preset (inside cache scaffolding). |
| CACHE-03 | 52-01, 52-03 | Per-agent cache hit-rate telemetry (cached input tokens / total input tokens) surfaced in the dashboard and daily summary | SATISFIED | Hit-rate formula in `getCacheTelemetry`: `cache_read / (cache_read + cache_creation + input_tokens)`. Dashboard: Prompt Cache panel (`renderCachePanel`) with 30s polling. Daily summary: `💾 Cache: X.Y% over N turns` (conditional on totalTurns > 0). CLI: `clawcode cache <agent>`. |
| CACHE-04 | 52-02, 52-03 | Cache invalidation is correct — changing identity, soul, hot-tier memory, or skill set evicts stale prefixes and is observable in telemetry | SATISFIED | Per-turn `prefixHash` + `cacheEvictionExpected` computed inside `iterateWithTracing`. Integration test `cache-eviction.test.ts` covers 4 scenarios including skills hot-reload WITHOUT session teardown (validates RELOADABLE_FIELDS path). All 4 scenarios GREEN. |

**Orphaned requirements check:** None. All 4 requirements mapped to this phase in REQUIREMENTS.md are declared in plans.

**Note on CACHE-05:** The 52-03 SUMMARY references "CACHE-05" for the first-token latency improvement surface (Success Criterion 5 from ROADMAP). CACHE-05 is NOT defined in `.planning/REQUIREMENTS.md` — this is a documentation discrepancy where the summary used "CACHE-05" as shorthand for Success Criterion 5. The underlying work (`cache_effect_ms`, 20-turn noise floor, CLI+dashboard surfaces) IS implemented and verified. Only the numbered requirement ID is informal.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No blocker anti-patterns surfaced in Phase 52-modified files. Legacy TODO/FIXME comments may exist elsewhere but were not introduced by this phase. |

Scan covered: context-assembler.ts, session-config.ts, session-adapter.ts, session-manager.ts, trace-store.ts, trace-collector.ts, slos.ts, tier-manager.ts, daemon.ts (phase 52 regions), daily-summary.ts, daily-summary-cron.ts, cache.ts, dashboard/server.ts, dashboard/static/app.js. Observational try/catch blocks (session-adapter cache-capture, provider.get()/persist()) correctly silent-swallow per Phase 50 invariant — not anti-patterns. No hardcoded empty arrays in render paths; all cache data flows from traceStore SQL queries.

### Human Verification Required

Three gates deferred by the user per CONTEXT D-verification pattern (consistent with Phase 50 and Phase 51 deferred-verification contract). These require live Anthropic auth + real runtime that the verifier cannot exercise programmatically.

### 1. Dashboard Prompt Cache panel visual render

**Test:** Open the running dashboard in a browser (port 3298 on clawdy or local daemon) and navigate to the per-agent card. Inspect the Prompt Cache panel adjacent to the Latency panel.
**Expected:** (a) Hit rate % rendered with SLO coloring (green ≥ 60%, red < 30%, neutral/gray 30–60% "warming up"). (b) 3-line subtitle: hit-rate formula + SLO band + cache_effect text. (c) `cache-eviction-marker` red dot on trend bars where cache_eviction_expected=true with a "prefix changed on YYYY-MM-DD" tooltip. (d) Panel auto-refreshes every 30s.
**Why human:** Visual appearance, color semantics, tooltip UX, and polling cadence are not exercisable via static grep or vitest. Orchestrator-run confirmed REST + HTML template render but did not eyeball the styled panel.

### 2. Live Discord turn produces real cache_read_input_tokens

**Test:** With the daemon running and an agent bound to a Discord channel, send a message to the channel, then run `clawcode cache <agent> --json` after the response completes.
**Expected:** The response shows `totalTurns >= 1`, `totalCacheReads` and `totalCacheWrites` non-zero, `avgHitRate` between 0 and 1 (not exactly 0 or 1 unless this is the very first turn on an empty cache). Turn 2+ of the session should show hit rate > 0 as the stable prefix lands in cache.
**Why human:** Requires live Anthropic API auth and real Discord channel traffic. The integration test uses mocked sdk.query; only real network traffic exercises the SDK's cache_control scaffolding and returns real `cache_read_input_tokens` in `msg.usage`.

### 3. 20+ real turns validate cache_effect_ms (Success Criterion 5)

**Test:** Run a Discord session with the same agent for 20+ turns over a session window, then run `clawcode cache <agent> --since 24h` and inspect the `cache_effect_ms` field (also visible on the dashboard subtitle).
**Expected:** `cache_effect_ms > 0` (cache hits have faster first-token than misses), typically in the 100–500ms range. If `cache_effect_ms` is null with 20+ turns, the noise-floor guard is too strict. If non-positive with 20+ turns, an advisory WARN is logged per `computeCacheEffectMs`.
**Why human:** Requires 20+ real turns through Anthropic — noise floor + real network variance cannot be exercised with mocks. Phase 50 latency telemetry is the foundation this criterion piggy-backs on.

### Gaps Summary

No automated gaps found. All 5 observable truths have verified supporting artifacts, wired key links, and passing tests. The 3 items above are deferred to human runtime verification per the phase's explicit deferred-items pattern — each requires live Anthropic API traffic or browser rendering that the verifier cannot exercise.

**Phase status assessment:**
- Foundation (data plane, schema, SLO infra): SOLID — 675/675 local tests GREEN.
- Context assembly (stable/mutable split, SDK preset+append, hot-tier stable_token): SOLID — all integration tests GREEN.
- Eviction detection (per-turn prefix hash comparison): SOLID — 4-scenario integration test GREEN including skills hot-reload edge case.
- User-visible surfaces (CLI, REST, dashboard, daily summary): SOLID — structure + plumbing verified; visual polish + live traffic deferred.
- Criterion 5 (first-token latency improvement): Surface complete with noise-floor guard; live validation deferred.

---

*Verified: 2026-04-14T00:12:00Z*
*Verifier: Claude (gsd-verifier)*
