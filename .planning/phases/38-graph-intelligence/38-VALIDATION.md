---
phase: 38
slug: graph-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (ESM-first) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/memory/__tests__/graph-search.test.ts src/heartbeat/checks/__tests__/auto-linker.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/memory/__tests__/graph-search.test.ts src/heartbeat/checks/__tests__/auto-linker.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 38-01-01 | 01 | 1 | GRAPH-03 | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts` | ❌ W0 | ⬜ pending |
| 38-01-02 | 01 | 1 | GRAPH-03 | unit | `npx vitest run src/memory/__tests__/graph-search.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-01 | 02 | 2 | GRAPH-04 | unit | `npx vitest run src/heartbeat/checks/__tests__/auto-linker.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-02 | 02 | 2 | GRAPH-04 | unit | `npx vitest run src/heartbeat/checks/__tests__/auto-linker.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/memory/__tests__/graph-search.test.ts` — GRAPH-03 graph-enriched search tests
- [ ] `src/heartbeat/checks/__tests__/auto-linker.test.ts` — GRAPH-04 auto-linker tests
- [ ] No framework install needed — vitest already configured

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
