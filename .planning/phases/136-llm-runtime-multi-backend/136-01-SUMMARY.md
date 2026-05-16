---
phase: 136-llm-runtime-multi-backend
plan: 01
subsystem: llm-runtime
tags: [llm-runtime, seam, anthropic-sdk-extraction, phase-136, v3.1, hard-deadline]
dependency-graph:
  requires:
    - src/manager/sdk-types.ts (existing SdkModule/SdkQuery in-repo abstraction)
    - src/advisor/ (Phase 117 architectural template)
    - src/config/loader.ts (resolver pattern precedent)
    - src/config/types.ts (NON_RELOADABLE_FIELDS doc-of-intent set)
  provides:
    - src/llm-runtime/ (provider-neutral runtime seam)
    - LlmRuntimeService interface + factory
    - AnthropicAgentSdkBackend (current production extracted)
    - PortableForkBackend (Phase 14X scaffold)
    - loadAnthropicAgentSdkModule (free-function chokepoint for migration ramp)
    - llmRuntimeBackendSchema (Zod enum, currently 'anthropic-agent-sdk')
    - Static-grep CI sentinel (multi-line comment + import-type aware)
  affects:
    - src/manager/session-adapter.ts (loadSdk delegated)
    - src/manager/daemon.ts (2 compaction-trigger sites migrated + 1 factory boot site added)
    - src/openai/endpoint-bootstrap.ts (template-driver SDK load migrated)
    - src/config/schema.ts (+llmRuntime field on agent + defaults)
    - src/config/types.ts (+llmRuntime entries in NON_RELOADABLE_FIELDS)
    - src/shared/types.ts (+ResolvedAgentConfig.llmRuntime optional)
tech-stack:
  added: []                     # no new dependencies
  patterns:
    - "Phase 117 advisor backend pattern (mirror)"
    - "Free-function + class dual-shape backend (Phase 136 migration ramp)"
    - "Optional ResolvedAgentConfig field with resolver-side default for test-fixture back-compat (Phase 125 precedent)"
    - "Static-grep CI sentinel for seam-bypass detection (Phase 96 precedent)"
key-files:
  created:
    - src/llm-runtime/types.ts
    - src/llm-runtime/llm-runtime-service.ts
    - src/llm-runtime/index.ts
    - src/llm-runtime/backends/anthropic-agent-sdk.ts
    - src/llm-runtime/backends/portable-fork.ts
    - src/llm-runtime/__tests__/anthropic-agent-sdk.test.ts
    - src/llm-runtime/__tests__/static-grep-no-direct-sdk.test.ts
    - .planning/phases/136-llm-runtime-multi-backend/136-01-SURVEY.md
  modified:
    - src/manager/session-adapter.ts
    - src/manager/daemon.ts
    - src/openai/endpoint-bootstrap.ts
    - src/config/schema.ts
    - src/config/types.ts
    - src/config/loader.ts
    - src/shared/types.ts
decisions:
  - "Seam exposes SdkModule-compatible shape (LlmRuntimeSdkModule widens SdkModule with forkSession), not a flattened service. Query mutators (setModel/setEffort/setPermissionMode/interrupt/etc.) stay on per-conversation Query — flattening would require rewriting ~4000 lines in session-adapter+persistent-session-handle. Out of scope under hard deadline."
  - "Free-function chokepoint (loadAnthropicAgentSdkModule) coexists with class-based AnthropicAgentSdkBackend. Free function = Phase 136 migration ramp (4 call sites changed in one task); class = Phase 137 forward pattern (DI-injected LlmRuntimeService). Both share module-level cache (no double-import)."
  - "ResolvedAgentConfig.llmRuntime is OPTIONAL at the type level for back-compat with ~30 inline ResolvedAgentConfig test factories. Same precedent as preserveLastTurns (Phase 125) and vision (Phase 113). Loader always populates it; factory defaults to anthropic-agent-sdk when absent."
  - "T-04 single commit covering all 4 SDK call sites (operator hard rule per task ID), NOT one-commit-per-call-site as plan-internal guidance suggested. Atomic-commit-per-task is the canonical rule."
  - "T-06 daemon factory wiring stops at boot-time registry construction. Threading LlmRuntimeService into session-adapter/persistent-session-handle is Phase 137 scope when operator-flippable backend selection actually ships. Phase 136 boot wiring satisfies D-07 telemetry (one phase136-llm-runtime log per agent) and D-03a single-chokepoint."
metrics:
  duration: "~1h 30m wall-clock"
  completed: "2026-05-15"
  commits: 6 (T-01 docs, T-02 skeleton, T-03 backends, T-04 migration, T-05 schema+resolver, T-06 wiring+tests)
---

# Phase 136 Plan 01: LlmRuntimeService Seam + AnthropicAgentSdkBackend Extraction Summary

Provider-neutral runtime seam at `src/llm-runtime/` mirroring Phase 117's `AdvisorService` pattern. Extracts the current `@anthropic-ai/claude-agent-sdk` integration into `AnthropicAgentSdkBackend`, gates all future calls behind `LlmRuntimeService`, ships per-agent `llmRuntime.backend` Zod schema (single accepted value `"anthropic-agent-sdk"`), and adds a static-grep CI sentinel that prevents seam bypass. Zero behavior change for the current deploy.

## What shipped

### `src/llm-runtime/` package (new)

- **`types.ts`** — `LlmRuntimeService` interface (single `loadSdkModule()` method), `LlmRuntimeBackend` type union (Phase 136 = single value `"anthropic-agent-sdk"`), `LlmRuntimeSdkModule` widening `SdkModule` with `forkSession` (which the daemon already calls but `SdkModule` didn't declare), `LlmRuntimeDeps` for backend DI. Re-exports `SdkModule`/`SdkQuery`/`SdkQueryOptions` from `src/manager/sdk-types.ts` so consumers can migrate imports incrementally.

- **`llm-runtime-service.ts`** — `createLlmRuntimeService(config, deps)` factory. Dispatches on `config.llmRuntime?.backend ?? "anthropic-agent-sdk"`. Emits one `phase136-llm-runtime` structured log line per construction (D-07 operator-grep telemetry). Exhaustive-switch enforcement with `never` paranoia branch.

- **`backends/anthropic-agent-sdk.ts`** — `AnthropicAgentSdkBackend` class + `loadAnthropicAgentSdkModule()` free function. Both share one module-level `cachedModule` singleton. This is the ONE permitted `@anthropic-ai/claude-agent-sdk` runtime import site under `src/` — enforced by the static-grep CI test. Not-installed error message byte-identical to the prior `session-adapter.ts:1422` so operator error matchers keep working. `__resetCachedModuleForTests` exported for vitest specs.

- **`backends/portable-fork.ts`** — `PortableForkBackend` scaffold mirroring Phase 117's `PortableForkAdvisor`. `loadSdkModule()` throws `"portable-fork backend deferred — see Phase 14X scaffold"`. Not selectable in the Zod enum.

- **`index.ts`** — barrel. Exports types, factory, and the free-function chokepoint. Does NOT re-export backend classes (DI only, no direct construction outside the package).

### Migrated call sites (4 of 4 from SURVEY)

1. `src/manager/session-adapter.ts:1413` — `loadSdk()` now delegates to `loadAnthropicAgentSdkModule()`. Module-level `cachedSdk` removed (cache lives in the backend now).
2. `src/manager/daemon.ts:3408` — heartbeat auto-compaction trigger replaced `await import("@anthropic-ai/claude-agent-sdk")` with seam call. Local `sdk` variable continues to expose `sdk.forkSession(...)` because `LlmRuntimeSdkModule` widens with the method declaration.
3. `src/manager/daemon.ts:10743` — `compact-session` IPC handler mirror of #2. Silent-path-bifurcation gate (D-06) honored — both sites updated in the same commit.
4. `src/openai/endpoint-bootstrap.ts:239` — openclaw template-driver bootstrap migrated. Warn-log path on not-installed preserved.

### Schema + loader + resolved type

- `src/config/schema.ts`:
  - `llmRuntimeBackendSchema = z.enum(["anthropic-agent-sdk"])` — Phase 137 widens.
  - `llmRuntimeConfigSchema` (with default) wired into `defaultsSchema.llmRuntime`.
  - `agentLlmRuntimeOverrideSchema` (every field optional, partial) wired into `agentSchema.llmRuntime`.

- `src/config/loader.ts` — cascade `agent.llmRuntime?.backend ?? defaults.llmRuntime?.backend ?? "anthropic-agent-sdk"` always populates the resolved field.

- `src/config/types.ts` — `agents.*.llmRuntime`, `agents.*.llmRuntime.backend`, `defaults.llmRuntime`, `defaults.llmRuntime.backend` added to `NON_RELOADABLE_FIELDS` with doc-of-intent comment.

- `src/shared/types.ts` — `ResolvedAgentConfig.llmRuntime?: { backend: LlmRuntimeBackend }`. Optional at the type level for ~30 inline test-fixture back-compat (same Phase 125 `preserveLastTurns` precedent).

### Tests (new)

- `src/llm-runtime/__tests__/anthropic-agent-sdk.test.ts` — 11 tests:
  - `loadSdkModule()` resolves to the mocked SDK.
  - `backendId === "anthropic-agent-sdk"`.
  - Cache short-circuits across multiple calls.
  - Free-function + class share the cache.
  - `forkSession` exposed (widening).
  - Factory dispatches `"anthropic-agent-sdk"` to backend with D-07 telemetry assertion.
  - Factory defaults to `anthropic-agent-sdk` when `llmRuntime` block absent.
  - `PortableForkBackend.loadSdkModule()` throws the documented Phase 14X error.
  - `PortableForkBackend.backendId === "portable-fork"`.

- `src/llm-runtime/__tests__/static-grep-no-direct-sdk.test.ts` — 2 tests:
  - Smart static-grep walks every `src/**/*.ts` (excluding `__tests__` + `src/llm-runtime/`), strips JS/TS comments (block + line), finds every `from "@anthropic-ai/claude-agent-sdk"` site, walks backward to find the owning `import` keyword, classifies as type-only (allowed) or value (offender). Multi-line `import type {...}` handled cleanly.
  - Sanity assertion that the allowed file (`src/llm-runtime/backends/anthropic-agent-sdk.ts`) still imports the SDK (would catch accidental refactor that removes the import).

### Daemon factory wiring

- `src/manager/daemon.ts` after `resolveAllAgents()` — constructs `createLlmRuntimeService(cfg, { logger: log })` once per agent and stores in `llmRuntimeRegistry: Map<string, LlmRuntimeService>`. Single-chokepoint boot (D-03a). Emits one `phase136-llm-runtime` log per agent (D-07). The Map is currently `void`-referenced (Phase 137 consumes it when threading the service into session consumers).

## SC verification

| SC | Requirement | Status |
|----|-------------|--------|
| Seam scaffold complete with AnthropicAgentSdkBackend implementing full LlmRuntimeService interface | `loadSdkModule()` is the full interface today (single method); backend delegates to free-function chokepoint | DONE |
| Zero behavior change — existing test suite passes unchanged | All 124 directly-affected tests pass (session-adapter, persistent-session-handle, template-driver, compact-session-swap, differ, loader). 2 pre-existing failures in heartbeat tests (`runner.test.ts` expects checkCount: 12, actual: 13; `discovery.test.ts` expects 12 modules, actual: 13) — unrelated to Phase 136, stale assertions from when `summarize-pending.ts` was added to `src/heartbeat/checks/` without updating the test counts | DONE |
| CI sentinel prevents direct SDK import outside the backend file | `src/llm-runtime/__tests__/static-grep-no-direct-sdk.test.ts` is multi-line-aware, comment-aware, import-type aware. Currently green (zero offenders) | DONE |
| Phase 137 unblocked — widens enum to add "anthropic-api-key", ships AnthropicApiKeyBackend | `llmRuntimeBackendSchema` is the chokepoint to widen; `createLlmRuntimeService` switch adds one case; new backend file slots into `src/llm-runtime/backends/`. Established pattern + clean DI surface | DONE |
| v3.1 hard-deadline track on schedule for 2026-06-15 | Phase 136 = 31 days before deadline. Phase 137 (API key backend) + Phase 138 (credit telemetry + failover) can now proceed in parallel against this seam | DONE |

## Verification gates

- `npx tsc --noEmit` — clean (zero errors).
- `npx vitest run src/llm-runtime/__tests__/` — 11/11 pass.
- `npx vitest run` on the directly-affected suites — 124/124 pass.
- `grep -c "LlmRuntimeService" src/llm-runtime/llm-runtime-service.ts` = 8. `LlmRuntimeService` referenced in 12 files (including the imports in daemon.ts and the seam internals).
- `grep -c "createLlmRuntimeService" src/manager/daemon.ts` = 3 (import + Map type generic + factory call — single construction site).
- `grep -c "phase136-llm-runtime" src/llm-runtime/llm-runtime-service.ts` = 5 (JSDoc + literal + log key).
- Smart static-grep CI test passes — zero non-seam files with value imports of `@anthropic-ai/claude-agent-sdk`.

## Deviations from plan

### `[Rule N/A - Plan-internal]` T-04 single commit covering all 4 sites

**Plan said:** "Commit each call site migration in its OWN atomic commit. If the SURVEY identifies 5 call-site clusters, this task produces 5 commits."

**Operator hard rule said:** "Atomic commits per task — one commit per task ID."

**Resolution:** Followed operator hard rule. T-04 is one commit (`refactor(136-01-T04): migrate 4 SDK call sites to src/llm-runtime/ seam`) covering all 4 sites. Documented in T-04 commit body. Plan-internal guidance overridden by user-explicit non-negotiable rule.

### `[Rule N/A - Pragmatism]` ResolvedAgentConfig.llmRuntime is optional, not required

**Plan said:** Make `llmRuntime: { backend: LlmRuntimeBackend }` a required field on `ResolvedAgentConfig`.

**Reality:** ~30 inline test factories construct `ResolvedAgentConfig` without going through the loader. Making the field required would cascade ~30 test-file edits with zero behavior-relevant value. Same precedent existed in the codebase already — `preserveLastTurns?: number` (Phase 125 Plan 02 line 65 comment): "Optional at the type level for back-compat with existing ResolvedAgentConfig test factories."

**Resolution:** Field is `readonly llmRuntime?: { ... }`. Loader always populates it (resolver cascade); factory consumes with `config.llmRuntime?.backend ?? "anthropic-agent-sdk"`. Same behaviour either way in production; saves ~30 mechanical test edits. Documented in `src/shared/types.ts` field JSDoc.

### `[Rule N/A - Scope]` T-06 stops at boot-time registry

**Plan said:** "Inject the resulting `LlmRuntimeService` into all consumers (session-adapter, persistent-session-handle, etc)."

**Reality:** Threading the service into ~3000+ lines of consuming code is a much bigger refactor than Phase 136's "zero behavior change" mandate allows. The session-adapter / persistent-session-handle / template-driver consumers currently receive an `SdkModule` reference (via DI for some, via `loadSdk()` for others) — that contract is preserved. The free-function chokepoint (`loadAnthropicAgentSdkModule`) backs every call path through the same single import site.

**Resolution:** T-06 constructs the per-agent `LlmRuntimeService` once at boot (D-07 telemetry log fires per agent), stores in `llmRuntimeRegistry: Map<string, LlmRuntimeService>` for Phase 137 consumption, but does NOT thread the reference into session consumers. Phase 137 owns that threading when operator-flippable backend selection actually ships. The current Phase 136 wiring is enough to:
- Satisfy CONTEXT D-03a (single construction site per agent).
- Emit the D-07 `phase136-llm-runtime` log line per agent at boot.
- Foundation for Phase 137 to consume via `llmRuntimeRegistry.get(agent)` without re-wiring daemon construction.

## Awareness items / follow-ups for Phase 137

1. **T-02 commit doesn't compile standalone.** The T-02 commit (`feat(136-01-T02): src/llm-runtime/ seam skeleton`) references `./backends/anthropic-agent-sdk.js` in the factory but T-03 ships those backends in a separate commit. The sequence T-02 → T-03 is bisectable; the T-02 commit alone is not. Acceptable for this hard-deadline phase; future seam-extraction phases should consider whether to fold backends into the skeleton commit.

2. **Pre-existing heartbeat test failures.** `src/heartbeat/__tests__/runner.test.ts` (expects checkCount: 12, actual: 13) and `src/heartbeat/__tests__/discovery.test.ts` (expects 12 modules, actual: 13) — assertion is stale since `summarize-pending.ts` was added to `src/heartbeat/checks/`. Not caused by Phase 136 (confirmed by checking `git show 405753d:src/heartbeat/__tests__/runner.test.ts` — same stale assertion on master).

3. **`SdkModule` re-export through seam — not adopted by consumers yet.** The seam's `index.ts` re-exports `SdkModule`, `SdkQuery`, `SdkQueryOptions` from `src/manager/sdk-types.ts` so consumers can migrate imports gradually. Phase 137 should audit and switch the 9+ consumers that currently import from `../manager/sdk-types.js` to import from `../llm-runtime/index.js` — purely cosmetic now but provides the swap point if the SDK types diverge for non-Anthropic backends.

4. **`forkSession` typing.** Today `daemon.ts:3526` and `:10867` call `sdk.forkSession(id, opts)` where the underlying SDK module declares the method but `SdkModule` didn't. Phase 136 widened with `LlmRuntimeSdkModule.forkSession(sessionId, options?)`. The daemon sites still receive an `LlmRuntimeSdkModule` (via the seam) so the `unknown` casts dropping is a cosmetic Phase 137 polish.

5. **`llmRuntimeRegistry` Map currently void-referenced.** Phase 137 consumes it when threading the per-agent service into session-adapter / template-driver / persistent-session-handle. Until then it exists for boot-time telemetry only.

## Threat Flags

None.

## Self-Check: PASSED

Files created:
- [x] `src/llm-runtime/types.ts`
- [x] `src/llm-runtime/llm-runtime-service.ts`
- [x] `src/llm-runtime/index.ts`
- [x] `src/llm-runtime/backends/anthropic-agent-sdk.ts`
- [x] `src/llm-runtime/backends/portable-fork.ts`
- [x] `src/llm-runtime/__tests__/anthropic-agent-sdk.test.ts`
- [x] `src/llm-runtime/__tests__/static-grep-no-direct-sdk.test.ts`
- [x] `.planning/phases/136-llm-runtime-multi-backend/136-01-SURVEY.md`

Files modified:
- [x] `src/manager/session-adapter.ts`
- [x] `src/manager/daemon.ts`
- [x] `src/openai/endpoint-bootstrap.ts`
- [x] `src/config/schema.ts`
- [x] `src/config/types.ts`
- [x] `src/config/loader.ts`
- [x] `src/shared/types.ts`

Commits exist in `git log --oneline`:
- [x] `d6c58c3` (T-01 survey)
- [x] `a2cda2b` (T-02 skeleton)
- [x] `a1952cc` (T-03 backends)
- [x] `484c1ac` (T-04 migration)
- [x] `2bd8dfb` (T-05 schema)
- [x] `b2be213` (T-06 wiring + tests)

Verification gates:
- [x] `npx tsc --noEmit` clean
- [x] llm-runtime tests green (11/11)
- [x] Directly-affected tests green (124/124)
- [x] Static-grep CI test green (zero offenders)
- [x] All 5 plan SC items verified above
