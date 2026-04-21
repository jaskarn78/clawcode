# Phase 70 — Deferred items

Out-of-scope issues discovered during Plan 70-02 execution. Per SCOPE BOUNDARY rule, these were NOT fixed — they are pre-existing, unrelated to browser automation work.

## Pre-existing TypeScript errors (unrelated files)

**Source:** `npx tsc --noEmit` — present without any Plan 70-02 changes.

1. `src/config/__tests__/differ.test.ts` (line 8) — test fixture missing `openai` and `browser` keys on the resolved config type. Fallout from Plan 69 (openai) + Plan 70-01 (browser) adding required fields to the config shape. Test files not updated.
2. `src/config/__tests__/loader.test.ts` (lines 17, 189, 646) — same root cause as above.

**Suggested fix (future plan):** extend test fixtures to include `openai` and `browser` defaults, OR mark both config fields as optional on the exported type.

## Pre-existing flaky tests (timeout / sqlite setup)

**Source:** `npm test` — 3–5 failures that reproduce without Plan 70-02 changes, varying by run.

1. `src/cli/__tests__/openai-key.test.ts` — `"direct-DB fallback integration (daemon down)"` block times out at 5s.
2. `src/cli/commands/__tests__/trace.test.ts` — `"walkCausationChain > walks a simple chain"` times out at 5s.
3. `src/cli/commands/__tests__/triggers.test.ts` — multiple `queryTriggerFires` cases time out at 5s.

All three test files exercise SQLite-heavy setups (trace-store, trigger store, openai key store) that occasionally exceed the default 5s vitest timeout on the dev box. Raising `testTimeout` in `vitest.config` OR re-architecting the setup to pre-build the DB in `beforeAll` would fix them. NOT a Plan 70-02 responsibility — their failure patterns are unchanged by this plan's edits.

**Verification that they are pre-existing:**
```bash
git stash
npx vitest run src/cli/__tests__/openai-key.test.ts src/cli/commands/__tests__/trace.test.ts src/cli/commands/__tests__/triggers.test.ts
# → 3 of 59 tests fail (same categories)
git stash pop
```

## Plan 70-02 test summary

- New tests added: 65 (16 readability/screenshot + 35 tools + 14 mcp-server)
- All 94 browser tests: GREEN
- Full suite: 2689 pass / 5 pre-existing failures (0 new regressions)
