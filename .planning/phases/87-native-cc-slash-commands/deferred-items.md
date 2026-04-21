# Phase 87 Deferred Items

Items surfaced during Phase 87 Plan 01 execution that are OUT OF SCOPE for this
plan and should be addressed separately. Pre-existing or cross-phase.

## Pre-existing test failures (not caused by Plan 01)

Confirmed via `git stash && vitest run <file>` on the RED baseline — these
files were already failing before Plan 01 started. Logged here so a future
agent can investigate without conflating them with Plan 01 regressions.

- `src/manager/__tests__/bootstrap-integration.test.ts`
  - 2 failures: `buildSessionConfig` throws `TypeError: The "path" argument
    must be of type string. Received undefined`
  - Likely root cause: a recent `ResolvedAgentConfig` shape change or
    missing test-fixture field (`memoryPath` / `workspace`).

- `src/manager/__tests__/daemon-openai.test.ts`
  - 7 failures: `startOpenAiServer` mock never invoked, `handle.apiKeysStore`
    undefined, etc.
  - Likely root cause: a recent daemon boot refactor that rerouted the
    openai-server bootstrap; the test fixture didn't follow.

- `src/manager/__tests__/warm-path-mcp-gate.test.ts`
  - 1 flaky failure in parallel runs: `ENOTEMPTY: directory not empty,
    rmdir '/tmp/mcp-gate-test-…'` — a test-isolation race on tmpdir
    cleanup. The file passes when run alone. Non-deterministic.

## TSC baseline

Baseline captured at Plan 01 start: 38 errors (pre-existing from Phase 85/86
and earlier). Plan 01 landed with the same 38 errors — no regression.
Pre-existing errors span `src/memory/__tests__/graph.test.ts`,
`src/tasks/task-manager.ts`, `src/triggers/__tests__/engine.test.ts`,
`src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts`.
