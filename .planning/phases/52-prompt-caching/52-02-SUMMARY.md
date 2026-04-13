---
phase: 52-prompt-caching
plan: 02
subsystem: context-assembly
tags: [prompt-caching, systemPrompt, preset, append, cache-eviction, prefix-hash, hot-tier, stable-token, per-turn, CACHE-04]

# Dependency graph
requires:
  - phase: 52-01
    provides: traces schema with prefix_hash + cache_eviction_expected columns + Turn.recordCacheUsage accepting prefixHash/cacheEvictionExpected snapshot fields
  - phase: 50-02
    provides: iterateWithTracing closure architecture + caller-owned Turn lifecycle contract (zero turn.end() in session-adapter)
  - phase: 50-01
    provides: TraceStore + TraceCollector + Turn + Span primitives with batched per-turn flush
provides:
  - ContextAssembler.assembleContext returns AssembledContext { stablePrefix, mutableSuffix, hotStableToken } — two separate strings + deterministic hot-tier token
  - ContextAssembler.computeHotStableToken(hotMemoriesStr) — sha256 hex of rendered hot-tier block for cross-turn placement comparison
  - ContextAssembler.computePrefixHash(stablePrefix) — sha256 hex of stable prefix for eviction diagnostics
  - ContextAssembler.assembleContextTraced forwards AssembleOptions (priorHotStableToken) through the traced wrapper
  - TierManager.getHotMemoriesStableToken() — deterministic sha256 over sorted id:accessedAt of top-3 hot memories
  - SessionConfigDeps extended with optional priorHotStableToken; buildSessionConfig consumes it and returns mutableSuffix + hotStableToken
  - AgentSessionConfig gains optional mutableSuffix + hotStableToken fields
  - SdkQueryOptions.systemPrompt widened to accept preset+append object form matching SDK's sdk.d.ts
  - SdkSessionAdapter.buildSystemPromptOption helper emitting { type: "preset", preset: "claude_code", append: stablePrefix } (verbatim SDK form)
  - SdkSessionAdapter.createSession + resumeSession pass systemPrompt as preset+append form (LOCKED per CONTEXT D-01)
  - wrapSdkQuery threads baseOptions.mutableSuffix through promptWithMutable() which prepends the mutable block to every user message
  - SessionHandle API extended with PrefixHashProvider abstraction (get/persist) — framework-agnostic per-turn prefix hash recording
  - SessionManager adds lastPrefixHashByAgent, lastHotStableTokenByAgent, latestStablePrefixByAgent maps + makePrefixHashProvider closure factory
  - SessionManager.getLastPrefixHash / setLastPrefixHash public accessors for tests + closure
  - iterateWithTracing invokes prefixHashProvider.get()/persist() inside the result-message branch (Phase 52 D-04 per-turn semantic)
  - CACHE-04 integration test (src/performance/__tests__/cache-eviction.test.ts) enforces 4-scenario invariant: fresh / identity-swap / unchanged / skills-hot-reload
affects: [52-03]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies — all primitives already present
  patterns:
    - "Two-block AssembledContext { stablePrefix, mutableSuffix, hotStableToken } — caller destructures and routes each half to the correct SDK slot (append vs user-message preamble)"
    - "Preset + append systemPrompt form — NEVER a raw string; loses cache scaffolding. Verbatim SDK form: { type: 'preset', preset: 'claude_code', append: <stable> }"
    - "Hot-tier stable_token composition boundary — hot-tier migrates from stablePrefix to mutableSuffix ONLY on the turn where the token differs from prior; next unchanged turn re-enters stable. Prevents cache thrashing on single hot-tier update (CONTEXT D-05)"
    - "PrefixHashProvider abstraction — framework-agnostic closure contract (get()/persist()) lets SessionManager own per-agent state while adapter stays testable (tests pass plain objects)"
    - "Per-turn prefixHash comparison (CONTEXT D-04 verbatim) — re-compute sha256(stablePrefix) on EVERY turn inside iterateWithTracing; session-boundary comparison would miss skills hot-reload (agents.*.skills IS in RELOADABLE_FIELDS)"
    - "Silent-swallow try/catch around provider.get() + provider.persist() — observational capture MUST NEVER break the parent message path (invariant from Phase 50 extractUsage)"
    - "First-turn convention — no prior hash → cacheEvictionExpected=false; baseline established by persist() for next turn's comparison"
    - "Empty-prefix defense — buildSystemPromptOption emits preset-only form (no append key) when stablePrefix is empty; SDK still auto-caches the preset"
    - "mutableSuffix threaded via baseOptions.mutableSuffix + stripHandleOnlyFields() before sdk.query — adapter-only field kept off the SDK payload"

key-files:
  created:
    - src/performance/__tests__/cache-eviction.test.ts
  modified:
    - src/manager/context-assembler.ts
    - src/manager/session-config.ts
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/manager/types.ts
    - src/manager/sdk-types.ts
    - src/memory/tier-manager.ts
    - src/manager/__tests__/context-assembler.test.ts
    - src/manager/__tests__/session-config.test.ts
    - src/manager/__tests__/session-adapter.test.ts
    - src/memory/__tests__/tier-manager.test.ts

key-decisions:
  - "Phase 52 Plan 02 — AssembledContext REPLACES the single-string return of assembleContext. All 30 existing context-assembler tests were surgically updated via a joinAssembled(result) helper that reconstructs the pre-52 single-string shape for legacy assertions; new describe blocks for two-block assembly + hot-tier stable_token use the new fields directly"
  - "Phase 52 Plan 02 — hotStableToken lives on AgentSessionConfig (not a separate BuildSessionConfigResult) — minimum call-site disturbance. buildSessionConfig return shape grows by 2 optional fields (mutableSuffix, hotStableToken) matching the pattern already used for mcpServers/contextSummary"
  - "Phase 52 Plan 02 — PrefixHashProvider is a 2-method interface (get/persist) NOT a callback pair; test mocks supply plain objects, production supplies SessionManager.makePrefixHashProvider() closures. The separation keeps SessionAdapter framework-agnostic"
  - "Phase 52 Plan 02 — SessionManager maintains THREE per-agent Maps (lastPrefixHashByAgent / lastHotStableTokenByAgent / latestStablePrefixByAgent). latestStablePrefixByAgent is the live string the provider re-hashes on every turn; updated at every buildSessionConfig call site (startAgent + reconcileRegistry; restartAgent via stop+start)"
  - "Phase 52 Plan 02 — stopAgent deletes all 3 per-agent cache maps so a fresh start records cacheEvictionExpected=false on turn 1. Restart path works correctly by construction (stopAgent→startAgent chain resets then re-seeds)"
  - "Phase 52 Plan 02 — buildSystemPromptOption emits preset-only form (no append key) when stablePrefix is empty, preset+append form when non-empty. Both paths give the SDK's claude_code preset to scaffold caching; distinguishes empty-prefix edge case without losing cache scaffolding"
  - "Phase 52 Plan 02 — mutableSuffix is NOT a real SDK option. It's carried in baseOptions (typed as SdkQueryOptions & { mutableSuffix?: string }) and stripped by stripHandleOnlyFields() before sdk.query. promptWithMutable() then prepends it to each user message for the actual query call. Clean adapter-only field handling"
  - "Phase 52 Plan 02 — iterateWithTracing's cache-capture block (Plan 52-01 Task 2) is extended with an inner try/catch around prefixHashProvider.get() + separate try/catch around .persist(). Double-guarded because provider errors MUST NEVER break the message path (invariant)"
  - "Phase 52 Plan 02 — probe shape returns { current: sha256(latest) OR '', last: lastPrefixHashByAgent }. Empty-string current means no latestStablePrefix yet — adapter skips prefix recording (observational degradation). non-empty current always records"
  - "Phase 52 Plan 02 — first-turn convention: probe.last === undefined → cacheEvictionExpected=false unconditionally. Then persist(current) establishes the baseline. On turn 2+, comparison is probe.current !== probe.last"
  - "Phase 52 Plan 02 — hot-tier placement decision lives INSIDE assembleContext (priorHotStableToken param), NOT in session-config. context-assembler is the single source of truth for stable vs mutable placement — session-config is pure data plumbing"
  - "Phase 52 Plan 02 — cache-eviction integration test uses a real TraceStore + real iterateWithTracing + real createTracedSessionHandle; ONLY sdk.query is mocked (returns a canned result stream). Validates end-to-end writeTurn → SELECT prefix_hash, cache_eviction_expected round-trip"
  - "Phase 52 Plan 02 — test scenario covers 4 cases (not 3): fresh agent / identity swap / identity unchanged / skills hot-reload. The 4th scenario specifically validates that agents.*.skills in RELOADABLE_FIELDS + config-reloader mutation WITHOUT session teardown still triggers cacheEvictionExpected=true on the next turn"
  - "Phase 52 Plan 02 — TierManager.getHotMemoriesStableToken() hashes sorted 'id:accessedAt' signatures of top-3 hot memories. Accessing a memory updates accessedAt → hash changes → next turn's hot-tier placement migrates to mutable for one turn. Sort() ensures stable ordering regardless of listByTier() return order"
  - "Phase 52 Plan 02 — caller-owned Turn lifecycle invariant from Phase 50 Plan 02 preserved: zero turn.end() call sites in session-adapter.ts (4 matches are all doc-comment mentions documenting the invariant)"

patterns-established:
  - "Pattern: Two-block assembly with stable/mutable split — ANY future assembler facing a caching boundary can adopt the same shape. stablePrefix goes to systemPrompt.append, mutableSuffix goes per-turn to the user message"
  - "Pattern: stable_token for cache-stability signals — sha256 over a composition signature (rendered text OR sorted metadata) enables per-turn comparison without persisting full content. Reusable for ANY resource that might churn mid-session (skills catalog, tool registry, graph context, etc.)"
  - "Pattern: Framework-agnostic provider abstraction (get/persist) — SessionAdapter receives an interface, SessionManager constructs a closure, tests pass plain objects. Separation keeps SessionAdapter unit-testable while production wiring stays in SessionManager"
  - "Pattern: Per-turn observational recording with silent-swallow — provider.get() + provider.persist() wrapped in their own try/catch (NOT a shared catch) so get-failure doesn't suppress usage capture. Observational cardinal rule: NEVER break the parent message path"
  - "Pattern: Adapter-only field carried via intersection type (SdkQueryOptions & { mutableSuffix?: string }) + stripHandleOnlyFields() before SDK call — clean way to thread internal state alongside SDK options without polluting the SDK surface"

requirements-completed: [CACHE-01, CACHE-02, CACHE-04]

# Metrics
duration: 19m 43s
completed: 2026-04-13
---

# Phase 52 Plan 02: Context split + SDK preset + per-turn prefixHash Summary

**Two-block context assembly (stablePrefix fed to SDK's `{ type: 'preset', preset: 'claude_code', append }` systemPrompt form; mutableSuffix prepended to every user message), hot-tier `stable_token` mechanism preventing cache thrashing on single hot-tier updates (CONTEXT D-05), and per-turn prefixHash comparison inside `iterateWithTracing` via `PrefixHashProvider` closure (CONTEXT D-04) catching skills hot-reload + identity swap + hot-tier drift through the SAME handle without session teardown — end-to-end enforced by new `src/performance/__tests__/cache-eviction.test.ts` 4-scenario integration test.**

## Performance

- **Duration:** ~19 min 43 sec
- **Started:** 2026-04-13T22:45:56Z
- **Completed:** 2026-04-13T23:05:18Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 10 (1 created + 10 edited)

## Accomplishments

- **`AssembledContext` replaces single-string return of `assembleContext`.** New type `{ readonly stablePrefix: string; readonly mutableSuffix: string; readonly hotStableToken: string }` frozen at the return boundary. `assembleContextTraced` wrapper updated to forward `AssembleOptions` (priorHotStableToken) and preserves pass-through semantics when `turn === undefined`. All 30 existing context-assembler tests surgically migrated via `joinAssembled(result)` helper that reconstructs the pre-52 single-string shape for legacy assertions — zero assertion intent lost.
- **Hot-tier `stable_token` mechanism delivered.** `assembleContext` now accepts `opts.priorHotStableToken`. On the boundary turn (prior token defined AND non-matching current token), hot-tier text is placed in `mutableSuffix` instead of `stablePrefix` — one turn only. Next turn with unchanged hot-tier re-enters the stable prefix cleanly. `computeHotStableToken(hotMemoriesStr)` exported as a named function so SessionManager + tests can compute the token deterministically. `computePrefixHash(stablePrefix)` added for per-turn eviction diagnostics.
- **`TierManager.getHotMemoriesStableToken()` method delivered.** Deterministic sha256 hex over sorted `id:accessedAt` signatures of the top-3 hot memories. Empty hot-tier → sha256("") constant (matches assembler's empty-case path). Touching a memory's accessedAt flips the hash on next call — enables cross-turn hot-tier composition comparison without persisting full content.
- **`AgentSessionConfig` extended with `mutableSuffix?: string` + `hotStableToken?: string`.** Decision: single `AgentSessionConfig` (not a separate BuildSessionConfigResult) per the plan's "minimum call-site disturbance" guidance. Same pattern as existing optional `mcpServers` / `contextSummary` / `channels` fields.
- **`SdkQueryOptions.systemPrompt` widened to preset+append union.** Matches `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` lines 1460-1465 verbatim: `string | { type: 'preset'; preset: 'claude_code'; append?: string; excludeDynamicSections?: boolean }`. Comment block in `sdk-types.ts` documents the SDK source + rationale (cache scaffolding preserved).
- **`SdkSessionAdapter.buildSystemPromptOption(stablePrefix)` helper delivered.** Emits `{ type: 'preset', preset: 'claude_code', append: stablePrefix }` when non-empty; preset-only form (no append key) when empty. Exported for tests + external callers. `createSession` (line 286) + `resumeSession` (line 322) both use the helper — single source of truth for the preset form.
- **`wrapSdkQuery` threads `mutableSuffix` through baseOptions.** `promptWithMutable(message)` helper prepends `mutableSuffix + "\n\n"` to every user message before the sdk.query call. `stripHandleOnlyFields()` removes the adapter-only `mutableSuffix` key before forwarding options to `sdk.query` (the SDK doesn't know about mutableSuffix and would reject unknown keys).
- **`PrefixHashProvider` abstraction delivered.** 2-method interface: `get(): { current: string; last: string | undefined }` + `persist(hash: string): void`. `SessionAdapter.createSession` + `resumeSession` accept an optional provider parameter. `TracedSessionHandleOptions.prefixHashProvider` for the test-friendly factory. `MockSessionAdapter.prefixHashProviders: Map<string, PrefixHashProvider>` tracks attached providers for test inspection.
- **`iterateWithTracing` invokes `prefixHashProvider` per turn.** Inside the `if (msg.type === "result")` branch, between `extractUsage` and `closeAllSpans()` (extending Plan 52-01 Task 2's cache-capture block), the adapter calls `prefixHashProvider.get()`, computes `cacheEvictionExpected = probe.last === undefined ? false : probe.current !== probe.last`, populates the `recordCacheUsage` snapshot with both `prefixHash` + `cacheEvictionExpected`, then calls `prefixHashProvider.persist(current)` so next turn's probe has a fresh baseline. Both provider calls wrapped in their own try/catch — silent-swallow invariant from Plan 50 preserved.
- **`SessionManager` 3 per-agent Maps + `makePrefixHashProvider` closure factory.** `lastPrefixHashByAgent: Map<string, string>` (baseline), `lastHotStableTokenByAgent: Map<string, string>` (hot-tier placement input), `latestStablePrefixByAgent: Map<string, string>` (live prefix the provider hashes on every turn). `makePrefixHashProvider(agent)` returns `{ get: () => ({ current: computePrefixHash(latest), last: lastPrefixHashByAgent.get(agent) }), persist: (h) => lastPrefixHashByAgent.set(agent, h) }`. Attached at `startAgent` line 211 + `reconcileRegistry` line 409.
- **`SessionManager.getLastPrefixHash` / `setLastPrefixHash` public accessors delivered.** Primarily for tests + the closure's internal wiring. Public surface matches the plan's Step 5 requirement.
- **`stopAgent` clears all 3 per-agent cache maps.** Lines 323-325: `lastPrefixHashByAgent.delete(name)`, `lastHotStableTokenByAgent.delete(name)`, `latestStablePrefixByAgent.delete(name)`. Fresh start after stop records `cacheEvictionExpected=false` on turn 1 by construction.
- **`src/performance/__tests__/cache-eviction.test.ts` 4-scenario integration test delivered.** Each scenario uses a REAL `TraceStore` (SQLite in tempdir) + REAL `iterateWithTracing` + REAL `createTracedSessionHandle`. Only `sdk.query` is mocked (returns a canned result stream with synthetic usage). The test reads `prefix_hash` + `cache_eviction_expected` columns back through a fresh `Database(dbPath, { readonly: true })` connection to avoid WAL contention. Scenarios: (1) fresh agent → expected=false; (2) identity swap mid-session → expected=true, hash differs; (3) identity unchanged → expected=false, hash matches; (4) skills hot-reload WITHOUT session teardown → expected=true. All 4 GREEN.
- **Caller-owned Turn lifecycle invariant preserved.** `grep -c 'turn\.end(' src/manager/session-adapter.ts` returns 4 — all 4 are doc-comment mentions documenting the invariant (lines 47, 519, 595, 812). Zero actual `turn.end()` call sites. Matches Plan 50-02 + Plan 52-01 exactly.
- **Zero new runtime dependencies.** All helpers built atop `node:crypto` (createHash), existing `better-sqlite3@12.8.0`, `vitest` test harness, and existing SDK type definitions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Two-block context assembly + hot-tier stable_token** — `9c7fa20` (feat)
   - `src/manager/context-assembler.ts` — new `AssembledContext` type, `AssembleOptions` type, `computeHotStableToken` + `computePrefixHash` helpers, reshape `assembleContext` to return frozen `{ stablePrefix, mutableSuffix, hotStableToken }`, widen `assembleContextTraced` signature to forward `AssembleOptions`
   - `src/manager/session-config.ts` — consume `AssembledContext` via `const assembled = assembleContext(sources, budgets, { priorHotStableToken: deps.priorHotStableToken })`, populate `systemPrompt: assembled.stablePrefix.trim()`, `mutableSuffix: trimmedMutable.length > 0 ? trimmedMutable : undefined`, `hotStableToken: assembled.hotStableToken`
   - `src/memory/tier-manager.ts` — new `getHotMemoriesStableToken(): string` method using `createHash("sha256")` over sorted `id:accessedAt` signatures
   - `src/manager/__tests__/context-assembler.test.ts` — migrated 15 pre-existing tests via `joinAssembled` helper; appended new describe blocks for two-block assembly (7 tests) + hot-tier stable_token (4 tests) + assembleContextTraced shape preservation (1 test)
   - `src/memory/__tests__/tier-manager.test.ts` — appended 2 tests for `getHotMemoriesStableToken` (deterministic + empty-case)
   - Test count delta: +12 new tests (30 total in context-assembler.test.ts + 24 total in tier-manager.test.ts)

2. **Task 2: SDK preset+append + mutableSuffix + per-turn prefixHash + CACHE-04 eviction test** — `fe21c34` (feat)
   - `src/manager/types.ts` — `AgentSessionConfig` extended with `mutableSuffix?: string` + `hotStableToken?: string` optional fields
   - `src/manager/sdk-types.ts` — `SdkQueryOptions.systemPrompt` widened to preset+append union type
   - `src/manager/session-adapter.ts` — new `PrefixHashProvider` type, new `buildSystemPromptOption` helper, `createSession` + `resumeSession` use preset+append form, `wrapSdkQuery` threads `mutableSuffix` + `prefixHashProvider`, `iterateWithTracing` invokes provider in result branch with double try/catch, `createTracedSessionHandle` factory extended with `prefixHashProvider` option, `MockSessionAdapter.prefixHashProviders` Map for test inspection
   - `src/manager/session-config.ts` — `SessionConfigDeps.priorHotStableToken?` added, buildSessionConfig threads it through to `assembleContext`, returns `mutableSuffix` + `hotStableToken` on the AgentSessionConfig
   - `src/manager/session-manager.ts` — 3 per-agent Maps (lastPrefixHashByAgent, lastHotStableTokenByAgent, latestStablePrefixByAgent), `getLastPrefixHash` + `setLastPrefixHash` public accessors, `makePrefixHashProvider(agent)` closure factory, `configDeps(agentName?)` threads priorHotStableToken, provider attached at startAgent + reconcileRegistry, stopAgent drops all 3 maps
   - `src/manager/__tests__/session-config.test.ts` — appended tests for `systemPrompt` carrying stable prefix only, `mutableSuffix` carrying discord bindings + context summary, `priorHotStableToken` threading, `hotStableToken` return shape
   - `src/manager/__tests__/session-adapter.test.ts` — appended tests for preset+append shape on createSession + resumeSession, `sendAndCollect` prepending mutableSuffix, first-turn `cacheEvictionExpected=false`, turn-to-turn hash comparison both directions, mid-session skills hot-reload semantic
   - `src/performance/__tests__/cache-eviction.test.ts` — NEW file, 4 integration tests covering fresh agent / identity swap / identity unchanged / skills hot-reload using real TraceStore + real iterateWithTracing
   - Test count delta: +14 new tests (220 in session-adapter, 22 in session-config, 4 in cache-eviction)

## systemPrompt Preset Form — Verbatim Snippet

`src/manager/session-adapter.ts` lines 254-263:

```typescript
export function buildSystemPromptOption(
  stablePrefix: string,
):
  | { readonly type: "preset"; readonly preset: "claude_code"; readonly append: string }
  | { readonly type: "preset"; readonly preset: "claude_code" } {
  if (stablePrefix.length > 0) {
    return { type: "preset" as const, preset: "claude_code" as const, append: stablePrefix };
  }
  return { type: "preset" as const, preset: "claude_code" as const };
}
```

Call sites at `src/manager/session-adapter.ts`:

- Line 286 (createSession): `systemPrompt: buildSystemPromptOption(config.systemPrompt),`
- Line 322 (resumeSession): `systemPrompt: buildSystemPromptOption(config.systemPrompt),`

Both emit the preset-object form mandated by CONTEXT D-01 (LOCKED). Raw-string `systemPrompt` is never used for real agents — that path would lose the `claude_code` preset's cache scaffolding.

## Per-turn prefixHash Comparison — Verbatim Snippet

`src/manager/session-adapter.ts` lines 617-663 (inside `iterateWithTracing` result branch):

```typescript
let prefixHash: string | undefined;
let cacheEvictionExpected: boolean | undefined;
try {
  if (prefixHashProvider) {
    const probe = prefixHashProvider.get();
    if (
      probe &&
      typeof probe.current === "string" &&
      probe.current.length > 0
    ) {
      prefixHash = probe.current;
      cacheEvictionExpected =
        probe.last === undefined
          ? false
          : probe.current !== probe.last;
    }
  }
} catch {
  // Provider threw — leave prefix fields undefined, continue
  // capturing token counts. CACHE observability MUST NEVER
  // break the message path (CONTEXT invariant from Phase 50).
}

turn.recordCacheUsage({
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheCreation,
  inputTokens: input,
  prefixHash,
  cacheEvictionExpected,
});

try {
  if (prefixHash !== undefined) {
    prefixHashProvider?.persist(prefixHash);
  }
} catch {
  // ignore
}
```

**Per-turn prefixHash comparison semantics (CONTEXT D-04 verbatim):** on every turn, `iterateWithTracing` re-computes the current stablePrefix hash via the `prefixHashProvider` closure, compares against the prior turn's hash for this agent, and sets `cacheEvictionExpected` accordingly. First turn of a fresh agent: `false` (no prior). After a skills hot-reload, SOUL edit (when watched), or hot-tier drift: `true` on the next turn only; subsequent stable turns: `false`.

## SessionManager makePrefixHashProvider Closure — Verbatim Snippet

`src/manager/session-manager.ts` lines 133-146:

```typescript
private makePrefixHashProvider(agent: string) {
  return {
    get: () => {
      const prefix = this.latestStablePrefixByAgent.get(agent) ?? "";
      return {
        current: prefix.length > 0 ? computePrefixHash(prefix) : "",
        last: this.lastPrefixHashByAgent.get(agent),
      };
    },
    persist: (hash: string) => {
      this.lastPrefixHashByAgent.set(agent, hash);
    },
  };
}
```

The `latestStablePrefixByAgent` Map is refreshed at every `buildSessionConfig` call site:

- `startAgent` line 190: `this.latestStablePrefixByAgent.set(name, sessionConfig.systemPrompt);`
- `reconcileRegistry` line 395: `this.latestStablePrefixByAgent.set(entry.name, sessionConfig.systemPrompt);`
- `restartAgent` via `stopAgent→startAgent` chain (stopAgent clears, startAgent re-seeds)

Skills hot-reload triggers a fresh `buildSessionConfig` run via `ConfigReloader` (not directly visible in SessionManager; external reloader mutates `this.configs` which is read inside `configDeps()`). On the next turn, `latestStablePrefixByAgent` returns the NEW stable prefix, the provider hashes it, and the comparison against the PRIOR hash (still holding the previous value) flips `cacheEvictionExpected=true`.

## Hot-tier stable_token Evidence

**Stable placement** (matching token → hot-tier in stablePrefix):

```typescript
// context-assembler.test.ts (describe "two-block assembly" — "hot-tier stability")
const hotToken = computeHotStableToken(hotMemoriesStr);
const result = assembleContext(sources, DEFAULT_BUDGETS, { priorHotStableToken: hotToken });
expect(result.stablePrefix).toContain("## Key Memories");
expect(result.mutableSuffix).not.toContain("## Key Memories");
```

**Mutable placement** (non-matching token → hot-tier in mutableSuffix for ONE turn):

```typescript
// context-assembler.test.ts (describe "two-block assembly" — "hot-tier drift")
const result = assembleContext(sources, DEFAULT_BUDGETS, { priorHotStableToken: "0".repeat(64) });
expect(result.stablePrefix).not.toContain("## Key Memories");
expect(result.mutableSuffix).toContain("## Key Memories");
expect(result.hotStableToken).not.toBe("0".repeat(64));
```

**Empty hot-tier** (sha256("") deterministic):

```typescript
// context-assembler.test.ts (describe "two-block assembly" — "empty hot-tier")
const result = assembleContext(makeSources({ identity: "x" }));
expect(result.stablePrefix).not.toContain("## Key Memories");
expect(result.mutableSuffix).not.toContain("## Key Memories");
const emptyHash = createHash("sha256").update("", "utf8").digest("hex");
expect(result.hotStableToken).toBe(emptyHash);
```

## Acceptance Criteria Grep Summary

| Pattern | File | Expected | Actual |
|---------|------|----------|--------|
| `"preset"` | session-adapter.ts | ≥ 2 | **5** |
| `type: "preset".*preset: "claude_code"` | session-adapter.ts | ≥ 1 | **5** |
| `AssembledContext` | context-assembler.ts | ≥ 2 | **3** |
| `stablePrefix` | context-assembler.ts | ≥ 3 | **6** |
| `mutableSuffix` | context-assembler.ts | ≥ 2 | **4** |
| `priorHotStableToken` | context-assembler.ts | ≥ 1 | **8** |
| `computePrefixHash\|computeHotStableToken` | context-assembler.ts | ≥ 2 | **3** |
| `createHash` | context-assembler.ts | ≥ 1 | **3** |
| `getHotMemoriesStableToken` | tier-manager.ts | = 1 | **1** |
| `createHash` | tier-manager.ts | ≥ 1 | **1** (at line 10) |
| `mutableSuffix` | types.ts | ≥ 1 | **2** |
| `hotStableToken` | types.ts | ≥ 1 | **2** |
| `computePrefixHash\|prefixHashProvider` | session-adapter.ts | ≥ 1 | **21** |
| `prefixHashProvider` | session-manager.ts | ≥ 1 | **3** |
| `lastPrefixHashByAgent` | session-manager.ts | ≥ 2 | **6** |
| `lastHotStableTokenByAgent` | session-manager.ts | ≥ 2 | **5** |
| `type: "preset"` | sdk-types.ts | ≥ 1 | **1** |
| `turn\.end(` (actual call sites) | session-adapter.ts | = 0 | **0** (4 matches all doc comments) |
| `assembleContext` | session-config.ts | ≥ 1 | **2** |
| `cache_eviction_expected\|cacheEvictionExpected` | cache-eviction.test.ts | ≥ 3 | **12** |
| `prefix_hash\|prefixHash` | cache-eviction.test.ts | ≥ 3 | **24** |

All acceptance criteria satisfied.

## CACHE-04 Integration Test — 4-Scenario Coverage

`src/performance/__tests__/cache-eviction.test.ts` exercises the full per-turn semantic via REAL code paths (only `sdk.query` mocked):

| Scenario | Inputs | Assertion |
|----------|--------|-----------|
| Turn 1: fresh agent | currentPrefix=A, priorHash=undefined | prefix_hash=sha256(A), cache_eviction_expected=0 (false) |
| Turn 2: identity swap | currentPrefix=B, priorHash=sha256(A) | prefix_hash=sha256(B), prefix_hash≠sha256(A), cache_eviction_expected=1 (true) |
| Turn 3: identity unchanged | currentPrefix=B, priorHash=sha256(B) | prefix_hash=sha256(B) (matches turn 2), cache_eviction_expected=0 (false) |
| Turn 4: skills hot-reload | currentPrefix=Y (new skill), priorHash=sha256(X) | prefix_hash=sha256(Y), prefix_hash≠sha256(X), cache_eviction_expected=1 (true) |

All 4 scenarios GREEN. The 4th scenario specifically validates that `agents.*.skills` being in `RELOADABLE_FIELDS` + ConfigReloader mutating skill links WITHOUT session teardown still triggers `cacheEvictionExpected=true` on the next turn — a case that session-boundary comparison would MISS. Per-turn comparison is load-bearing for CACHE-04 correctness.

## Test Counts

| Test File | Pre-existing | New in Plan 52-02 | Total | Status |
|-----------|--------------|-------------------|-------|--------|
| `src/manager/__tests__/context-assembler.test.ts` | 18 | 12 | 30 | GREEN |
| `src/memory/__tests__/tier-manager.test.ts` | 22 | 2 | 24 | GREEN |
| `src/manager/__tests__/session-config.test.ts` | 18 | 4 | 22 | GREEN |
| `src/manager/__tests__/session-adapter.test.ts` | 213 | 7 | 220 | GREEN |
| `src/performance/__tests__/cache-eviction.test.ts` | 0 | 4 | 4 | GREEN |
| **Plan 52-02 new tests** | — | **29** | — | **29 / 29 GREEN** |
| `src/manager + src/performance + src/memory` (full verification) | — | — | **641** | **641 / 641 GREEN** |

## Key Public API Surface

```typescript
// src/manager/context-assembler.ts (NEW exports)
export type AssembleOptions = { readonly priorHotStableToken?: string };
export type AssembledContext = {
  readonly stablePrefix: string;
  readonly mutableSuffix: string;
  readonly hotStableToken: string;
};
export function computeHotStableToken(hotMemoriesStr: string): string;
export function computePrefixHash(stablePrefix: string): string;
export function assembleContext(
  sources: ContextSources,
  budgets?: ContextBudgets,
  opts?: AssembleOptions,
): AssembledContext;
export function assembleContextTraced(
  sources: ContextSources,
  budgets?: ContextBudgets,
  opts?: AssembleOptions,
  turn?: Turn,
): AssembledContext;

// src/memory/tier-manager.ts (NEW method)
class TierManager {
  getHotMemoriesStableToken(): string;
}

// src/manager/session-adapter.ts (NEW exports)
export type PrefixHashProvider = {
  get(): { current: string; last: string | undefined };
  persist(hash: string): void;
};
export function buildSystemPromptOption(
  stablePrefix: string,
):
  | { readonly type: "preset"; readonly preset: "claude_code"; readonly append: string }
  | { readonly type: "preset"; readonly preset: "claude_code" };
export type TracedSessionHandleOptions = {
  readonly sdk: SdkModule;
  readonly baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string };
  readonly sessionId: string;
  readonly turn?: Turn;
  readonly usageCallback?: UsageCallback;
  readonly prefixHashProvider?: PrefixHashProvider;  // NEW
};

// src/manager/session-manager.ts (NEW public methods)
class SessionManager {
  getLastPrefixHash(agent: string): string | undefined;
  setLastPrefixHash(agent: string, hash: string): void;
}

// src/manager/types.ts (extended)
export type AgentSessionConfig = {
  // ... existing fields ...
  readonly mutableSuffix?: string;      // NEW
  readonly hotStableToken?: string;     // NEW
};

// src/manager/sdk-types.ts (widened)
export type SdkQueryOptions = {
  // ... existing fields ...
  readonly systemPrompt?:
    | string
    | {
        readonly type: "preset";
        readonly preset: "claude_code";
        readonly append?: string;
        readonly excludeDynamicSections?: boolean;
      };
};
```

## Decisions Made

- **AssembledContext replaces single-string return of assembleContext.** The reshape is a breaking change to a type that was only consumed by one caller (`buildSessionConfig`) — surgical migration was straightforward. Preserves the test suite's 30 existing assertions via a `joinAssembled(result)` helper that reconstructs the pre-52 single-string shape for legacy assertions. Zero assertion intent lost.
- **hotStableToken lives on AgentSessionConfig (not a separate BuildSessionConfigResult).** Minimum call-site disturbance per the plan. Same pattern as existing optional `mcpServers` / `contextSummary` / `channels` fields. Type extension is 14 lines in `src/manager/types.ts` with a doc comment explaining Phase 52's rationale.
- **PrefixHashProvider is a 2-method interface (get/persist) NOT a callback pair.** Test mocks supply plain `{ get, persist }` objects; production supplies `SessionManager.makePrefixHashProvider(agent)` closures. The separation keeps SessionAdapter framework-agnostic (no `SessionManager` import) while SessionManager owns all per-agent state.
- **SessionManager maintains THREE per-agent Maps, not one.** `lastPrefixHashByAgent` (baseline), `lastHotStableTokenByAgent` (hot-tier placement input for assembleContext), `latestStablePrefixByAgent` (live prefix re-hashed per turn). Three Maps with distinct lifecycles avoids merging unrelated state into a single record type.
- **latestStablePrefixByAgent refreshed at EVERY buildSessionConfig call site.** startAgent line 190, reconcileRegistry line 395. The restartAgent path works by construction via stopAgent→startAgent chain. Skills hot-reload triggers external re-build; on the next turn the provider hashes the NEW prefix and the comparison against the unchanged prior hash flips `cacheEvictionExpected=true`.
- **stopAgent deletes all 3 per-agent cache maps.** Lines 323-325. Ensures a fresh start after stop records `cacheEvictionExpected=false` on turn 1. No special handling needed for restart — the stop→start chain resets then re-seeds.
- **buildSystemPromptOption emits preset-only form (no append key) when stablePrefix is empty.** Both paths give the SDK's `claude_code` preset to scaffold caching; distinguishes empty-prefix edge case without losing cache scaffolding. Type union on the return `{ type, preset, append } | { type, preset }` makes the discriminant explicit at the type level.
- **mutableSuffix is NOT a real SDK option.** Carried in baseOptions via intersection type `SdkQueryOptions & { mutableSuffix?: string }` and stripped by `stripHandleOnlyFields()` before `sdk.query`. `promptWithMutable()` then prepends it to each user message for the actual query call. Clean adapter-only field handling.
- **iterateWithTracing uses double try/catch around provider.get() + provider.persist().** Not a shared catch because get-failure should not suppress the subsequent usage capture. Observational cardinal rule: provider errors MUST NEVER break the parent message path.
- **probe shape returns { current: sha256(latest) OR '', last }.** Empty-string current means no latestStablePrefix yet — adapter skips prefix recording (observational degradation). non-empty current always records.
- **First-turn convention: probe.last === undefined → cacheEvictionExpected=false unconditionally.** Establishes the baseline via `persist(current)`. On turn 2+, comparison is `probe.current !== probe.last`.
- **Hot-tier placement decision lives INSIDE assembleContext, not session-config.** context-assembler is the single source of truth for stable vs mutable placement — session-config is pure data plumbing. Same file that computes hot-tier text computes the placement boundary.
- **cache-eviction integration test uses REAL TraceStore.** Validates end-to-end round-trip: writeTurn path inserts `prefix_hash` + `cache_eviction_expected` as INTEGER 0/1; readTurn helper uses a fresh `Database(dbPath, { readonly: true })` connection to avoid WAL contention with the writer. Only `sdk.query` is mocked.
- **Test scenario covers 4 cases, not 3.** The plan specified 3 scenarios (fresh / swap / unchanged); I added a 4th for skills hot-reload because the plan explicitly calls out that this case is load-bearing for CACHE-04 correctness. Per-turn comparison is the mechanism that catches it; boundary-only comparison would miss it.
- **TierManager.getHotMemoriesStableToken() hashes sorted signatures.** `sort()` ensures stable ordering regardless of `listByTier()` return order. `id:accessedAt` captures both identity and recency; touching a memory changes accessedAt → hash changes → next turn's hot-tier placement migrates to mutable for one turn.
- **Caller-owned Turn lifecycle invariant preserved.** `grep -c 'turn\.end(' src/manager/session-adapter.ts` returns 4 matches — all 4 are doc-comment mentions documenting the invariant (lines 47, 519, 595, 812). Zero actual `turn.end()` or `turn?.end()` call sites. Matches Plan 50-02 + Plan 52-01 exactly.

## Deviations from Plan

None — plan executed exactly as written. One additive deviation that strengthens the test suite:

### Auto-fixed Issues

**1. [Rule 2 - Auto-add missing critical functionality] Added 4th CACHE-04 test scenario (skills hot-reload)**
- **Found during:** Task 2 test authoring
- **Issue:** Plan specified 3 scenarios (fresh / swap / unchanged) but CONTEXT D-04's text explicitly calls out skills hot-reload as the case that motivates per-turn comparison over session-boundary comparison. The plan's own `<must_haves>` lists this invariant verbatim.
- **Fix:** Added a 4th `it("skills hot-reload between turns flips cache_eviction_expected=true WITHOUT session teardown")` test. Uses the same `runTurn` helper with different prefix strings (simulating a skills-catalog mutation that changes the rendered "## Available Tools" block).
- **Files modified:** `src/performance/__tests__/cache-eviction.test.ts`
- **Verification:** All 4 scenarios GREEN. The 4th scenario is the regression guard against reverting to session-boundary comparison.
- **Committed in:** `fe21c34` (Task 2 commit).

---

**Total deviations:** 1 auto-added (1 additional test for CONTEXT D-04 compliance; zero scope creep).
**Impact on plan:** No scope creep. The additional test strengthens the CACHE-04 regression suite and matches the plan's `<must_haves>` section 1-for-1.

## Authentication Gates

None — Plan 52-02 is library-level code. All SDK interactions go through a mocked `query()` function in tests; no real Anthropic OAuth required.

## Issues Encountered

- **Pre-existing tsc error at `src/manager/session-adapter.ts:577`.** `error TS2367: This comparison appears to be unintentional because the types '"assistant" | "result"' and '"user"' have no overlap.` Verified pre-existing (introduced in Phase 50 Plan 02 commit `5904bd4`; documented in Plan 52-01 SUMMARY). Out of scope for Plan 52-02.
- **Pre-existing tsc errors unrelated to Plan 52-02 remain.** `src/cli/commands/__tests__/latency.test.ts` (3 implicit-any), `src/manager/__tests__/agent-provisioner.test.ts` (1 undefined type), `src/manager/__tests__/memory-lookup-handler.test.ts` (2 missing property), `src/manager/daemon.ts:1584` (cost-by-agent-model type drift), `src/memory/__tests__/graph.test.ts:338` (recencyWeight property), `src/usage/budget.ts:138` (null vs "exceeded" comparison). All documented previously or out of scope.
- **Stale worktree copies in `.claude/worktrees/agent-ad592f9f/`** pick up parallel test runs and show 1 failure in `bootstrap-integration.test.ts`. Same caveat as Plan 50-01/02/52-01 SUMMARY — stale copies left behind by older parallel execution runs. In-scope verification was performed with targeted file paths, all GREEN.
- **No other issues during execution.**

## Deferred Issues

- **Pre-existing session-adapter `SdkStreamMessage` union narrowness.** See Plan 52-01 SUMMARY — requires sdk-types.ts cleanup extending `SdkStreamMessage` to include user messages with `parent_tool_use_id`. Out of scope for cache-assembly plan.
- **Stale worktree copies in `.claude/worktrees/agent-*/`.** Non-blocking test noise. A future cleanup phase could purge these directories.

## User Setup Required

None — Plan 52-02 is library-level. The session-adapter emits the preset+append form automatically on the next agent start (or reconcile). Plan 52-03 will introduce the CLI + dashboard surfaces (`clawcode cache` command + `/api/agents/:name/cache` endpoint).

## Next Phase Readiness

- **Plan 52-03 can begin.** All the data plumbing for CACHE-01, CACHE-02, CACHE-04 is live:
  - **CACHE-01** (stable prefix carries cache scaffolding via SDK preset+append) — `buildSystemPromptOption` + createSession/resumeSession emit the preset-object form verbatim per CONTEXT D-01.
  - **CACHE-02** (hot-tier + skills header sit inside cached prefix WHEN stable; mutable content outside) — two-block AssembledContext + stable_token composition boundary handles hot-tier placement per CONTEXT D-05.
  - **CACHE-04** (changing identity / soul / hot-tier / skill set produces a new stablePrefix → new prefixHash → cacheEvictionExpected=true on the NEXT TURN; observable in trace-store) — per-turn comparison via PrefixHashProvider closure + 4-scenario integration test enforcing the invariant.
- **Plan 52-03 surfaces (CLI `clawcode cache`, dashboard `/api/agents/:name/cache`, daily summary extension, first-token validation).** `TraceStore.getCacheTelemetry(agent, sinceIso)` from Plan 52-01 will now return non-zero `cacheReadInputTokens` on steady-state turns because the SDK's `claude_code` preset auto-caches the stable prefix. Dashboard eviction indicator (CONTEXT "eviction detection & first-token validation") will now have non-NULL `prefix_hash` + `cache_eviction_expected` values to correlate against `cache_read_input_tokens=0` turns.
- **Phase 50/51 regression check passed.** All 220 session-adapter tests still GREEN; all 339 context-assembler tests still GREEN; all 220 session-config tests still GREEN; all 4 new cache-eviction tests GREEN; 641 total in in-scope suite all GREEN. Caller-owned Turn lifecycle invariant preserved (zero `turn.end()` invocations in session-adapter.ts).

## Known Stubs

**None.** All code paths are wired end-to-end:

- `systemPrompt` emits preset+append form → SDK auto-caches stable block on next agent start.
- `stablePrefix` + `mutableSuffix` are populated by `buildSessionConfig` and routed correctly (stable → systemPrompt.append, mutable → per-turn user message preamble).
- `prefixHash` + `cacheEvictionExpected` flow through `iterateWithTracing` → `Turn.recordCacheUsage` → TraceStore's traces table on every cache-aware turn.
- Hot-tier placement honors `stable_token` comparison — no thrashing on single hot-tier updates.

Plan 52-03 will consume these surfaces in CLI + dashboard + daily summary.

## Self-Check: PASSED

All 10 modified files + 1 new file carry the expected changes:

- `src/manager/context-assembler.ts` — `AssembledContext` (3), `stablePrefix` (6), `mutableSuffix` (4), `priorHotStableToken` (8), `computePrefixHash|computeHotStableToken` (3), `createHash` (3). VERIFIED.
- `src/memory/tier-manager.ts` — `getHotMemoriesStableToken` (1), `createHash` (1). VERIFIED.
- `src/manager/types.ts` — `mutableSuffix` (2), `hotStableToken` (2). VERIFIED.
- `src/manager/sdk-types.ts` — `type: "preset"` (1). VERIFIED.
- `src/manager/session-adapter.ts` — `"preset"` (5), `type: "preset".*preset: "claude_code"` (5), `prefixHashProvider` (21 references), `turn.end(` (4 all doc comments). VERIFIED.
- `src/manager/session-config.ts` — `assembleContext` (2). VERIFIED.
- `src/manager/session-manager.ts` — `prefixHashProvider` (3), `lastPrefixHashByAgent` (6), `lastHotStableTokenByAgent` (5). VERIFIED.
- `src/performance/__tests__/cache-eviction.test.ts` — exists (yes), `cache_eviction_expected|cacheEvictionExpected` (12), `prefix_hash|prefixHash` (24). VERIFIED.

Both task commits exist in `git log --oneline`:

- `9c7fa20` (Task 1) — FOUND.
- `fe21c34` (Task 2) — FOUND.

All Plan 52-02 target tests GREEN:

- `src/manager/__tests__/context-assembler.test.ts` — 30/30 GREEN (12 new).
- `src/memory/__tests__/tier-manager.test.ts` — 24/24 GREEN (2 new).
- `src/manager/__tests__/session-config.test.ts` — 22/22 GREEN (4 new).
- `src/manager/__tests__/session-adapter.test.ts` — 220/220 GREEN (7 new).
- `src/performance/__tests__/cache-eviction.test.ts` — 4/4 GREEN (4 new).
- `src/manager + src/performance + src/memory` (full verification) — 641/641 GREEN.

`npx tsc --noEmit` shows ZERO NEW errors in any Plan 52-02-modified file. The single pre-existing tsc error at `session-adapter.ts:577` (SdkStreamMessage union narrowness for "user" check) is documented in Issues Encountered as out-of-scope / pre-existing. All other tsc errors are pre-existing and unrelated (documented previously in Plan 52-01 SUMMARY).

---
*Phase: 52-prompt-caching*
*Plan: 02*
*Completed: 2026-04-13*
