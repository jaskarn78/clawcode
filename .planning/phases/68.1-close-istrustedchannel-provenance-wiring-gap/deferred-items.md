# Phase 68.1 — Deferred Items (Out of Scope)

Pre-existing `tsc --noEmit` errors surfaced while verifying the 68.1-01 fix.
NONE touch the files modified by 68.1-01 (`src/discord/capture.ts`,
`src/discord/bridge.ts`, `src/discord/__tests__/capture.test.ts`). Per the
executor SCOPE BOUNDARY rule they are logged but not fixed.

| File | Line | Error |
|------|------|-------|
| src/memory/__tests__/graph.test.ts | 338 | `recencyWeight` not in `ScoringConfig` |
| src/tasks/task-manager.ts | 239, 328, 367, 485 | Missing `causationId` on four Readonly turn-chain literals |
| src/triggers/__tests__/engine.test.ts | 66, 67 | vitest Mock vs `() => void` type mismatch |
| src/usage/__tests__/daily-summary.test.ts | 209, 288, 313 | Tuple `[]` indexed at `0`/`1` |
| src/usage/budget.ts | 138 | Impossible comparison `"warning" \| null` vs `"exceeded"` |

These pre-date Phase 68.1 and do not block production capture-path trust
provenance. Recommend a future `chore/tsc-cleanup` phase.
