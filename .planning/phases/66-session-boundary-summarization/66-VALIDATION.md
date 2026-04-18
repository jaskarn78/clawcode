---
phase: 66
slug: session-boundary-summarization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 66 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (ESM, node env) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --run tests/session-summarizer.test.ts` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~20 seconds (full), ~3 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** Run quick command (`npm test -- --run tests/session-summarizer.test.ts`)
- **After every plan wave:** Run full suite (`npm test -- --run`)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 66-01-01 | 01 | 1 | CONV-03 | unit | `npm test -- --run tests/memory-store.test.ts -t "source_turn_ids roundtrip"` | ❌ W0 | ⬜ pending |
| 66-01-02 | 01 | 1 | CONV-03 | unit | `npm test -- --run tests/memory-store.test.ts -t "sourceTurnIds input"` | ❌ W0 | ⬜ pending |
| 66-02-01 | 02 | 1 | SESS-01 | unit | `npm test -- --run tests/session-summarizer.test.ts -t "happy path"` | ❌ W0 | ⬜ pending |
| 66-02-02 | 02 | 1 | SESS-01 | unit | `npm test -- --run tests/session-summarizer.test.ts -t "skip < 3 turns"` | ❌ W0 | ⬜ pending |
| 66-02-03 | 02 | 1 | SESS-01 | unit | `npm test -- --run tests/session-summarizer.test.ts -t "timeout falls back"` | ❌ W0 | ⬜ pending |
| 66-02-04 | 02 | 1 | SESS-04 | unit | `npm test -- --run tests/session-summarizer.test.ts -t "idempotent"` | ❌ W0 | ⬜ pending |
| 66-02-05 | 02 | 1 | SESS-01 | unit | `npm test -- --run tests/session-summarizer.test.ts -t "tags and source"` | ❌ W0 | ⬜ pending |
| 66-03-01 | 03 | 2 | SESS-01 | integration | `npm test -- --run tests/session-manager.test.ts -t "stopAgent triggers summarize"` | ❌ W0 | ⬜ pending |
| 66-03-02 | 03 | 2 | SESS-04 | integration | `npm test -- --run tests/session-manager.test.ts -t "crash fire-and-forget"` | ❌ W0 | ⬜ pending |
| 66-03-03 | 03 | 2 | SESS-01 | unit | `npm test -- --run tests/summarize-with-haiku.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/session-summarizer.test.ts` — unit tests for happy/skip/timeout/idempotency/tags paths (SESS-01, SESS-04)
- [ ] `tests/summarize-with-haiku.test.ts` — daemon helper test with `sdk.query()` mocked
- [ ] Fixture: mock `summarize()` fn returning canned category output
- [ ] Fixture: in-memory better-sqlite3 DB + sqlite-vec loaded (reuse `conversation-store.test.ts` harness)
- [ ] Fixture: stub `embed()` returning deterministic Float32Array(384)

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

**Approval:** pending
