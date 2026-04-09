---
phase: 5
slug: heartbeat-monitoring
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Max feedback latency:** 12 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-T1 | 01 | 1 | HRTB-01, HRTB-02, HRTB-03 | unit | `npx vitest run src/heartbeat/__tests__/` | inline | ⬜ pending |
| 05-01-T2 | 01 | 1 | HRTB-01 | integration | `npx vitest run --reporter=verbose` | inline | ⬜ pending |

---

## Wave 0 Requirements

Test files created inline. Existing vitest infrastructure reused.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live heartbeat with real agent sessions | HRTB-01 | Requires running daemon | Start daemon, verify heartbeat logs appear at interval |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify
- [x] Sampling continuity OK
- [x] No watch-mode flags
- [x] `nyquist_compliant: true` set

**Approval:** approved 2026-04-09
