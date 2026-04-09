---
phase: 4
slug: memory-system
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-09
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 01 | 1 | MEM-01, MEM-06 | unit | `npx vitest run src/memory/__tests__/` | inline | ⬜ pending |
| 04-01-T2 | 01 | 1 | MEM-05 | unit | `npx vitest run src/memory/__tests__/` | inline | ⬜ pending |
| 04-02-T1 | 02 | 2 | MEM-02 | unit | `npx vitest run src/memory/__tests__/` | inline | ⬜ pending |
| 04-02-T2 | 02 | 2 | MEM-03, MEM-04 | unit | `npx vitest run src/memory/__tests__/` | inline | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files created inline within plan tasks. Existing vitest infrastructure reused.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Semantic search quality | MEM-05 | Embedding quality is subjective | Store 10 diverse memories, search with various queries, verify relevance ranking |
| Auto-compaction with live SDK | MEM-03 | Requires real API session filling context | Run agent with long conversation, verify compaction triggers and memories preserved |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-09
