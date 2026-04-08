---
phase: 2
slug: agent-lifecycle
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 01 | 1 | MGMT-07, MGMT-08 | unit | `npx vitest run src/manager/__tests__/` | inline | ⬜ pending |
| 02-01-T2 | 01 | 1 | MGMT-02, MGMT-03, MGMT-04 | unit | `npx vitest run src/manager/__tests__/` | inline | ⬜ pending |
| 02-01-T3 | 01 | 1 | MGMT-06 | unit | `npx vitest run src/manager/__tests__/` | inline | ⬜ pending |
| 02-02-T1 | 02 | 2 | MGMT-05 | unit | `npx vitest run src/cli/__tests__/` | inline | ⬜ pending |
| 02-02-T2 | 02 | 2 | MGMT-02-08 | integration | `npx vitest run --reporter=verbose` | inline | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created inline within plan tasks (not as separate Wave 0 stubs):
- Plans create their own test files alongside implementation
- Existing vitest infrastructure from Phase 1 is reused

Existing infrastructure covers all phase requirements via inline test creation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent SDK session spawning | MGMT-02 | Real SDK calls cost tokens | Manually run `clawcode start <agent>` with a real config and verify Claude Code session starts |
| Process cleanup on SIGTERM | MGMT-08 | Signal handling in test env is unreliable | Send SIGTERM to running manager, verify all agent sessions terminate |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 8s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-08
