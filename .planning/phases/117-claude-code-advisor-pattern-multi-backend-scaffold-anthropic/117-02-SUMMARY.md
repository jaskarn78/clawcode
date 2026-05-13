---
phase: 117
plan: 02
subsystem: advisor
tags: [advisor, scaffold, service, registry, prompts, types]
requires: ["117-01"]
provides:
  - AdvisorService, AdvisorRequest, AdvisorResponse, BackendId (types)
  - AdvisorInvokedEvent, AdvisorResultedEvent (event shapes for 117-04/09)
  - AdvisorBackend interface (consult entry point for 117-03/04/05)
  - DefaultAdvisorService (budget + dispatch + truncation)
  - BackendRegistry, resolveBackend (per-agent backend resolution)
  - resolveAdvisorModel + ADVISOR_MODEL_ALIASES (opus → claude-opus-4-7)
  - buildAdvisorSystemPrompt (parity port of daemon.ts:9836)
affects: []  # No production call site rewired in this plan (117-07 does that)
tech-stack:
  added: []
  patterns:
    - Provider-neutral seam (src/advisor/) — call sites depend on interfaces only
    - Constructor-injected deps (DefaultAdvisorService) for full testability
    - Alias map at SDK boundary (re-uses src/manager/model-resolver.ts pattern)
key-files:
  created:
    - src/advisor/types.ts
    - src/advisor/backends/types.ts
    - src/advisor/service.ts
    - src/advisor/registry.ts
    - src/advisor/prompts.ts
    - src/advisor/index.ts
    - src/advisor/__tests__/service.test.ts
    - src/advisor/__tests__/registry.test.ts
    - src/advisor/__tests__/prompts.test.ts
  modified:
    - src/manager/model-resolver.ts (added ADVISOR_MODEL_ALIASES + resolveAdvisorModel)
decisions:
  - Alias resolver lives in src/manager/model-resolver.ts (NOT src/advisor/registry.ts) because that file already maps "opus" → "claude-opus-4-7" for the executor model. Registry re-exports the advisor pair so call sites can import everything from src/advisor/. Per T04 step 1 explicit instruction.
  - DefaultAdvisorService resolves backend even on budget-exhausted path (so the response includes the correct backend id for telemetry). Cheap synchronous lookup, no SDK calls.
  - BackendRegistry.has(id) added (not in spec) as a tiny ergonomic helper for capability probes in 117-08 — pure read, zero risk.
  - prompts.ts treats empty-string memoryContext the same as null/undefined (matches the existing daemon.ts:9836 spread short-circuit; `""` is falsy).
metrics:
  duration: "~30 min"
  completed: "2026-05-13"
  tasks_total: 8
  tasks_completed: 8
  files_created: 9
  files_modified: 1
  tests_added: 28
---

# Phase 117 Plan 02: AdvisorService core + AdvisorBackend interface + registry + prompts + tests Summary

Provider-neutral `AdvisorService` seam landed: types, default service (budget + dispatch + 2000-char truncation), per-agent backend registry with defensive `portable-fork → native` coercion, parity-verified prompt builder ported from `daemon.ts:9836`, and the `opus → claude-opus-4-7` advisor model alias resolver.

## What changed

- **`src/advisor/`** is now the public seam. `index.ts` re-exports the full surface (6 `from "./..."` lines). Call sites in Plans 117-03 / 117-07 will import from here, never from individual files.
- **`AdvisorBudget` is reused unchanged** — `DefaultAdvisorService` takes it via constructor injection and orders the operations exactly like `daemon.ts:9862` (budget check → backend → truncate → record).
- **`ADVISOR_RESPONSE_MAX_LENGTH` is imported from `src/usage/advisor-budget.ts:11`** — never redefined.
- **Model alias resolver** placed in `src/manager/model-resolver.ts` next to `resolveModelId` (per T04 step 1 — "if the file already maps opus, add the advisor exports there"). `src/advisor/registry.ts` re-exports it so consumers see one barrel.
- **No backends shipped.** `AnthropicSdkAdvisor`, `LegacyForkAdvisor`, `PortableForkAdvisor` land in 117-03/04/05.
- **`daemon.ts` untouched** — extraction lives in 117-03.

## Per-task results

| Task | Subject | Commit | Files |
| ---- | ------- | ------ | ----- |
| T01  | Advisor types (`AdvisorService/Request/Response/BackendId` + invoked/resulted event shapes) | `3786ca4` | `src/advisor/types.ts` |
| T02  | `AdvisorBackend` interface | `9512d25` | `src/advisor/backends/types.ts` |
| T03  | `buildAdvisorSystemPrompt` parity port | `e16f724` | `src/advisor/prompts.ts` |
| T04  | `resolveAdvisorModel` + `ADVISOR_MODEL_ALIASES` | `9f34110` | `src/manager/model-resolver.ts` |
| T05  | `resolveBackend` + `BackendRegistry` (rejects `portable-fork`) | `70cfb9b` | `src/advisor/registry.ts` |
| T06  | `DefaultAdvisorService` (budget → dispatch → truncate → record) | `8354065` | `src/advisor/service.ts` |
| T07  | `src/advisor/index.ts` re-exports | `cc830a9` | `src/advisor/index.ts` |
| T08  | Tests (service, registry, prompts) — 28 passing | `4bc26ce` | `src/advisor/__tests__/{service,registry,prompts}.test.ts` |

## Test results

`npm test -- src/advisor/__tests__/`:

```
 Test Files  3 passed (3)
      Tests  28 passed (28)
```

Coverage:
- **service.test.ts (12 tests):** budget-exhausted short-circuit (no consult, no recordCall), truncation at 2000 chars, no-op for ≤2000, exact `consult({agent, question, systemPrompt, advisorModel})` payload, backend id reported in response, `recordCall` fires exactly once on success, `budgetRemaining` reflects post-record state, `recordCall` does NOT fire when backend throws.
- **registry.test.ts (12 tests):** default → `native`, agent overrides defaults, defaults fallback, defensive `portable-fork → native`, agent-only set, `opus → claude-opus-4-7`, fully-qualified opus passthrough, unknown values pass through, `ADVISOR_MODEL_ALIASES` exposes mapping, `BackendRegistry` throws on unregistered get, register/replace, `has()` reflects state.
- **prompts.test.ts (6 tests):** non-empty output, exact parity vs frozen baseline for `null` / `undefined` / `""` / non-empty memory, agent-name interpolation.

`npm run typecheck`: clean.

## Verification

- `npm run typecheck` — clean after every commit.
- `npm test -- src/advisor/__tests__/` — 28/28 passing.
- `npm test -- src/manager/__tests__/model-resolver.test.ts src/usage/advisor-budget.test.ts` — 14/14 passing (no regression in files I touched or near).
- Full `npm test` run: pre-existing failures in `src/migration/__tests__/verifier.test.ts` (Tests 1–2 — `ENOENT` on `/tmp/cc-verifier-mJK2Cr/target/alpha/MEMORY.md`). Confirmed pre-existing by running them on `master` with my changes stashed — same failures, same files, no relation to advisor work.

## Deviations from plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Strict-mode `vi.fn()` typing in `service.test.ts`**
- **Found during:** Task 8 (typecheck after writing tests)
- **Issue:** `let mockConsult: ReturnType<typeof vi.fn>` is too loose for TypeScript strict mode — TS rejected assigning it to `AdvisorBackend["consult"]` slot with `TS2322`. Runtime was fine.
- **Fix:** Parameterised the mock with `vi.fn<AdvisorBackend["consult"]>()`.
- **Files modified:** `src/advisor/__tests__/service.test.ts` (in the same T08 commit `4bc26ce` — caught before commit).

### Additions beyond plan spec

- **`BackendRegistry.has(id)`** — pure read accessor, two lines. Not in T05 spec but trivially useful for capability probes (Plan 117-08). Zero risk. Documented in tests.
- **Extra test cases** beyond the spec's A/B/C/D assertions on `service.test.ts`:
  - "does NOT touch answers at or below the cap" + "leaves short answers untouched" (truncation boundary).
  - "returns the backend id from resolveBackend in the response" (validates `native` id propagates too).
  - "reports budgetRemaining after recording the call" (proves the budget recorded BEFORE the response was assembled).
  - "does NOT record the call when the backend throws" (proves daemon.ts:9862 ordering preserved).
- **`ADVISOR_MODEL_ALIASES` includes the canonical id as a self-map** (`"claude-opus-4-7": "claude-opus-4-7"`) per T04 spec. Belt-and-braces: ensures explicit IDs round-trip through `resolveAdvisorModel` without depending on the `?? raw` fallback.

## Auth gates encountered

None.

## Known stubs

None. All backend implementations are explicitly out of scope per the plan ("backends land in 117-03 / 117-04 / 117-05") and are NOT re-exported from `index.ts` — so no stub backends could leak to consumers in this phase.

## TDD gate compliance

Plan frontmatter `type: execute` — not a TDD plan, so RED/GREEN/REFACTOR gate sequencing does not apply. Tests landed in the final task (T08) per the plan's task ordering.

## Threat flags

None. This plan introduces no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. Pure interface scaffold + in-memory dispatch logic.

## Out of scope (deferred to later plans)

- `AnthropicSdkAdvisor` impl — **117-04**
- `LegacyForkAdvisor` impl + `forkAdvisorConsult` extraction from `daemon.ts:9805` — **117-03**
- `PortableForkAdvisor` stub — **117-05**
- Config schema `advisor` block + per-agent override — **117-06**
- Daemon IPC re-point at `AdvisorService.ask` — **117-07**
- MCP `ask_advisor` conditional registration — **117-07**
- `advisor:invoked` event emit site in `session-adapter.ts` — **117-04 / 117-09**

## Self-Check: PASSED

- `src/advisor/types.ts` — FOUND
- `src/advisor/backends/types.ts` — FOUND
- `src/advisor/service.ts` — FOUND
- `src/advisor/registry.ts` — FOUND
- `src/advisor/prompts.ts` — FOUND
- `src/advisor/index.ts` — FOUND
- `src/advisor/__tests__/service.test.ts` — FOUND
- `src/advisor/__tests__/registry.test.ts` — FOUND
- `src/advisor/__tests__/prompts.test.ts` — FOUND
- Commit `3786ca4` (T01) — FOUND
- Commit `9512d25` (T02) — FOUND
- Commit `e16f724` (T03) — FOUND
- Commit `9f34110` (T04) — FOUND
- Commit `70cfb9b` (T05) — FOUND
- Commit `8354065` (T06) — FOUND
- Commit `cc830a9` (T07) — FOUND
- Commit `4bc26ce` (T08) — FOUND
