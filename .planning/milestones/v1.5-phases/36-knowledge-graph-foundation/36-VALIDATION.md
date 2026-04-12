---
phase: 36
slug: knowledge-graph-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (ESM-first) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/memory/__tests__/graph.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/memory/__tests__/graph.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 36-01-01 | 01 | 1 | GRAPH-01 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "extractWikilinks"` | ❌ W0 | ⬜ pending |
| 36-01-02 | 01 | 1 | GRAPH-01 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "insert.*link"` | ❌ W0 | ⬜ pending |
| 36-01-03 | 01 | 1 | GRAPH-01 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "merge.*link"` | ❌ W0 | ⬜ pending |
| 36-01-04 | 01 | 1 | GRAPH-02 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "backlink"` | ❌ W0 | ⬜ pending |
| 36-01-05 | 01 | 1 | GRAPH-02 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "forward"` | ❌ W0 | ⬜ pending |
| 36-01-06 | 01 | 1 | SC-3 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "consolidation\|archival"` | ❌ W0 | ⬜ pending |
| 36-01-07 | 01 | 1 | SC-4 | unit | `npx vitest run src/memory/__tests__/graph.test.ts -t "circular"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/memory/__tests__/graph.test.ts` — test stubs for GRAPH-01, GRAPH-02, SC-3, SC-4
- [ ] No framework install needed — vitest already configured

*Existing infrastructure covers framework requirements.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
