# Phase 51 — Deferred Items (Out of Scope)

Issues discovered during Plan 51-01 execution that are pre-existing and out of scope for this phase. Verified pre-existing via `git stash && npx tsc --noEmit` on the unmodified working tree (same errors reported).

## Pre-existing `tsc --noEmit` breakages (10 errors)

These errors were present BEFORE Plan 51-01 changes — confirmed by stashing changes and re-running `tsc --noEmit`. Plan 51-01 introduces zero new tsc errors. The plan's tsc gate (acceptance criterion 12) verifies that the new `ResolvedAgentConfig.perf.slos?` field typechecks cleanly under strict mode for downstream consumers (Plan 51-03). The pre-existing errors below are unrelated to that gate.

| File | Line | Error |
|------|------|-------|
| `src/cli/commands/__tests__/latency.test.ts` | 61, 77, 90 | TS7006: Parameter `c` implicitly has an `any` type. (mock callback shape drift since Phase 50 IPC types tightened) |
| `src/manager/__tests__/agent-provisioner.test.ts` | 34 | TS2322: `string \| undefined` not assignable to `string` |
| `src/manager/__tests__/context-assembler.test.ts` | 234 | TS2578: Unused `@ts-expect-error` directive (Wave 0 sentinel from Plan 50-00 — turned green in Plan 50-02 without removing the marker) |
| `src/manager/__tests__/memory-lookup-handler.test.ts` | 22 | TS2339: Property `limit` does not exist on `{ agent; query }` (signature drift) |
| `src/manager/__tests__/session-adapter.test.ts` | 23 | TS2578: Unused `@ts-expect-error` directive (same Wave 0 sentinel pattern) |
| `src/manager/daemon.ts` | 1475 | TS2345: `CostByAgentModel` missing `input_tokens`/`output_tokens` properties (cost shape mismatch in `getCostByAgentModel` path) |
| `src/manager/session-adapter.ts` | 450 | TS2367: Comparison of `"assistant" \| "result"` with `"user"` has no overlap (post-iteration union narrowing) |
| `src/memory/__tests__/graph.test.ts` | 338 | TS2353: Unknown property `recencyWeight` on `ScoringConfig` |
| `src/usage/budget.ts` | 138 | TS2367: Comparison of `"warning" \| null` with `"exceeded"` has no overlap |

**Why deferred:** Each is in a file unrelated to Plan 51-01's scope (slos.ts, perf.slos? Zod override, ResolvedAgentConfig.perf.slos? TS mirror, bench types/thresholds). Fixing them is a separate cleanup effort that should not be bundled into a perf-foundation plan.

**Recommended action:** Consider a `/gsd:quick` cleanup pass after Phase 51 ships to clear these in one batch, especially the two `Unused @ts-expect-error` directives which are leftover Wave 0 RED markers.
