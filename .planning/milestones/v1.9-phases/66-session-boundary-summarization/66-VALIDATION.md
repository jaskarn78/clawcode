---
phase: 66
slug: session-boundary-summarization
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-18
---

# Phase 66 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Tests are created within each TDD task (no separate Wave 0) — each task's `<automated>` block runs the newly-written test.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (ESM, node env) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/memory/__tests__/session-summarizer.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~20 seconds (full), ~3 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** Run the task-specific `<automated>` command from the plan.
- **After every plan wave:** Run full suite (`npx vitest run`)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 66-01-01 | 01 | 1 | SESS-01 (prereq CONV-03 write path) | unit | `npx vitest run src/memory/__tests__/store.test.ts -t "sourceTurnIds"` | ⬜ pending |
| 66-01-02 | 01 | 1 | SESS-04 | unit | `npx vitest run src/memory/__tests__/store.test.ts -t "source_turn_ids roundtrip"` | ⬜ pending |
| 66-02-01 | 02 | 2 | SESS-01 | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "types"` | ⬜ pending |
| 66-02-02 | 02 | 2 | SESS-01 / SESS-04 | unit | `npx vitest run src/memory/__tests__/session-summarizer.test.ts -t "happy path\|skip\|timeout\|idempotent\|tags"` | ⬜ pending |
| 66-03-01 | 03 | 3 | SESS-01 | unit | `npx vitest run src/manager/__tests__/summarize-with-haiku.test.ts` | ⬜ pending |
| 66-03-02 | 03 | 3 | SESS-01 / SESS-04 | integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "stopAgent\|crashed"` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No separate Wave 0 plan — tests are written inside each TDD task alongside the implementation:
- [x] `src/memory/__tests__/store.test.ts` — roundtrip tests added in Plan 01 Task 2
- [x] `src/memory/__tests__/session-summarizer.test.ts` — happy/skip/timeout/idempotency/tags added in Plan 02 Task 2
- [x] `src/manager/__tests__/summarize-with-haiku.test.ts` — SDK-mocked unit tests added in Plan 03 Task 1
- [x] `src/manager/__tests__/session-manager.test.ts` — stop/crash integration tests added in Plan 03 Task 2
- [x] Fixtures: `summarize` mock fn, in-memory better-sqlite3 harness (reuses `conversation-store.test.ts` patterns), deterministic `embed` stub — all declared in their respective test files.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Haiku summary quality on real captured session | SESS-01 | LLM output quality is subjective — needs human eyeball check per STATE.md blocker | After Plan 03: run a live Discord session > 3 turns, stop agent, inspect generated MemoryEntry in SQLite. Verify 4 categories are populated and accurate. |
| Knowledge graph auto-links summary to related memories | SESS-01 | Linker runs async in background; end-to-end link quality is emergent | Inspect `memory_links` table 30s after summary insert — summary should have ≥1 outbound link or rationale in logs if not |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-18
