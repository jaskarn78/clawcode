---
phase: 68
slug: conversation-search-deep-retrieval
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 68 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `68-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.3 |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/memory/__tests__/conversation-store.test.ts src/memory/__tests__/conversation-search.test.ts --reporter=verbose` |
| **Full suite command** | `npm test` (→ `vitest run --reporter=verbose`) |
| **Estimated runtime** | ~40 seconds (scoped); ~4 minutes (full) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/memory/__tests__/conversation-store.test.ts src/memory/__tests__/conversation-search.test.ts src/mcp/__tests__/memory-lookup.test.ts --reporter=verbose`
- **After every plan wave:** `npx vitest run --reporter=verbose` (full suite)
- **Before `/gsd:verify-work`:** `npm test` — full suite must be green
- **Max feedback latency:** 60 seconds per task-commit sample

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 68-01-01 | 01 | 1 | RETR-02 | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "FTS5 migration"` | ⚠ extend | ⬜ pending |
| 68-01-02 | 01 | 1 | RETR-02 | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "backfill"` | ⚠ extend | ⬜ pending |
| 68-01-03 | 01 | 1 | RETR-02 | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "trigger"` | ⚠ extend | ⬜ pending |
| 68-01-04 | 01 | 1 | RETR-02 | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "searchTurns"` | ⚠ extend | ⬜ pending |
| 68-01-05 | 01 | 1 | RETR-02 | unit | `npx vitest run src/memory/__tests__/conversation-store.test.ts -t "escape"` | ⚠ extend | ⬜ pending |
| 68-01-06 | 01 | 1 | RETR-03 | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "pagination"` | ❌ W0 | ⬜ pending |
| 68-01-07 | 01 | 1 | RETR-03 | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "hasMore"` | ❌ W0 | ⬜ pending |
| 68-01-08 | 01 | 1 | RETR-03 | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "decay"` | ❌ W0 | ⬜ pending |
| 68-01-09 | 01 | 1 | RETR-03 | unit | `npx vitest run src/memory/__tests__/conversation-search.test.ts -t "deduplicate"` | ❌ W0 | ⬜ pending |
| 68-02-01 | 02 | 2 | RETR-01 | unit | `npx vitest run src/mcp/__tests__/memory-lookup.test.ts -t "scope"` | ⚠ extend | ⬜ pending |
| 68-02-02 | 02 | 2 | RETR-01 | unit | `npx vitest run src/mcp/__tests__/memory-lookup.test.ts -t "backward"` | ⚠ extend | ⬜ pending |
| 68-02-03 | 02 | 2 | RETR-01 | integration | `npx vitest run src/manager/__tests__/daemon-memory-lookup.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*File Exists: ❌ W0 = create new in Wave 0; ⚠ extend = append to existing test file*

---

## Wave 0 Requirements

- [ ] `src/memory/__tests__/conversation-store.test.ts` — extend with 5 new test suites: FTS5 migration, backfill, triggers (INSERT/DELETE/UPDATE sync), `searchTurns`, and query escape safety
- [ ] `src/memory/__tests__/conversation-search.test.ts` — NEW file with 4 test suites covering `searchByScope` orchestrator: pagination cap, `hasMore` + `nextOffset`, decay weighting, dedup logic for `scope="all"`
- [ ] `src/mcp/__tests__/memory-lookup.test.ts` — extend with schema validation for new `scope` + `page` fields + backward-compat assertion
- [ ] `src/manager/__tests__/daemon-memory-lookup.test.ts` — NEW file for IPC-layer integration tests (scope branching, pagination wiring, error propagation)

**Fixtures to create/reuse:**
- In-memory `better-sqlite3` with `sqlite-vec` loaded — lift from existing `conversation-store.test.ts` harness
- Pre-seeded ConversationStore with ~20 turns across 3 sessions (1 recent, 1 mid-age, 1 old) for decay tests
- Pre-seeded MemoryStore with session-summary MemoryEntries matching the 3 sessions for `scope="all"` dedup tests
- `MockClock` for deterministic decay math (inject `now: number`, same pattern as Phase 67)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real agent calling `memory_lookup` with `scope="all"` retrieves prior-conversation context and uses it naturally | RETR-01 + RETR-02 + RETR-03 acceptance | Requires live daemon + real agent LLM call + real Discord channel | 1) Have a 10+ turn conversation; wait for session summary to land. 2) Start a new session, ask the agent to recall a specific detail from a week ago. 3) Observe the agent calling `memory_lookup` with `scope="all"` or `scope="conversations"` and confirm results include both the session summary AND relevant raw turns. |
| Pagination works from agent's perspective (page=1 retrieves next batch) | RETR-03 | Cannot fake agent-driven pagination in CI without a real tool-call loop | Manually call `memory_lookup` via MCP with page=0, confirm `hasMore=true`, then call again with page=1, confirm a different result set. |
| FTS5 query performance remains acceptable at scale | RETR-02 | Requires real conversation volume (~10k+ turns) to surface latency regressions | After v1.9 has been running in production for ~2 weeks, run `clawcode context-audit --trace memory-lookup` and confirm p95 query latency < 200ms. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (all commands use `vitest run`)
- [ ] Feedback latency < 60s per task-commit sample
- [ ] `nyquist_compliant: true` set in frontmatter (after plan-checker + nyquist-auditor approval)

**Approval:** pending
