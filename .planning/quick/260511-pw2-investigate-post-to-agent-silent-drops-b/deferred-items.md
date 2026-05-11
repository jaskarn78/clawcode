# Deferred items (out-of-scope discoveries)

## Pre-existing test failure: src/mcp/server.test.ts "has exactly 22 tools defined"

- Test asserts `TOOL_DEFINITIONS.length === 22`; actual count was 27
  BEFORE this PR (verified via `git stash` baseline), and is now 28
  AFTER Quick 260511-pw3 added `list_agent_schemas`.
- Pre-dates these quick tasks — the 22 vs 27 mismatch existed before
  any changes today.
- Not caused by 260511-pw2 or 260511-pw3.
- Owner action: when the magic number is replaced, set it to the
  actual count at that time (28 as of this commit), OR preferably
  replace the brittle count assertion with an explicit allow-list of
  tool names so adding a tool no longer breaks the test.

## Broader pre-existing test failures (wider sweep, 2026-05-11)

Wider sweep `npx vitest run src/manager/__tests__/ src/mcp/ src/tasks/__tests__/` reports 18 failed tests across 6 files. Baseline `git stash`
sweep (without any 260511-pw2/pw3 changes) reports 17 failed tests across
5 files. The +1 file (`src/mcp/server.test.ts`) and +1 test is the
TOOL_DEFINITIONS count assertion above — all other failures pre-date
both quick tasks.

Pre-existing failing files (NOT caused by 260511-pw2 or 260511-pw3):

- `src/manager/__tests__/bootstrap-integration.test.ts` — 2 failures
  (buildSessionConfig prompt-content checks).
- `src/manager/__tests__/daemon-openai.test.ts` — 7 failures (OpenAI
  endpoint boot / shutdown / env-override paths).
- `src/manager/__tests__/daemon-warmup-probe.test.ts` — 1 failure
  (EmbeddingService singleton-invariant grep).
- `src/manager/__tests__/dream-prompt-builder.test.ts` — 2 failures
  (D-02 context assembler templates, token truncation).
- `src/manager/__tests__/session-config.test.ts` — 5 failures (prompt
  size, brief-cache wiring, MEMORY.md cap).

None of these tests touch `daemon-post-to-agent-ipc.ts`,
`list-agent-schemas`, the `delegate-task` IPC handler, or any code
260511-pw2/pw3 modified. Surfaced for the next planner / verifier pass
but explicitly out of scope here.
