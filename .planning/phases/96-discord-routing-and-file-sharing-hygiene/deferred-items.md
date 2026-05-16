## Pre-existing test timeouts (NOT introduced by 96-04)

- `src/config/__tests__/shared-workspace.integration.test.ts > SHARED-02 > memories inserted into agent A do not appear in agent B (tag query)` — times out at 20s under concurrent test load (3 parallel-agent vitest runs + integration teardown/setup churn)
- `src/config/__tests__/shared-workspace.integration.test.ts > SHARED-03 > 5 agents maintain full pairwise memory isolation` — same 20s timeout under load

Both tests pre-date Phase 96 (Phase 75-03 added 2026-04-23 per git log). Tests pass when run in isolation. Out of scope for 96-04 (Phase 75 perf/concurrency hardening responsibility).
