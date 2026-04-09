---
phase: 1
slug: foundation-workspaces
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (created by Plan 01-01 Task 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01 | 1 | MGMT-01 | typecheck | `npx tsc --noEmit` | inline | ⬜ pending |
| 01-01-T2 | 01 | 1 | MGMT-01 | unit | `npx vitest run src/config/__tests__/` | inline | ⬜ pending |
| 01-02-T1 | 02 | 2 | WKSP-01, WKSP-02, WKSP-03, WKSP-04 | unit | `npx vitest run src/agent/__tests__/` | inline | ⬜ pending |
| 01-02-T2 | 02 | 2 | MGMT-01 | integration | `npx vitest run --reporter=verbose` | inline | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created inline within plan tasks (not as separate Wave 0 stubs):
- Plan 01-01 Task 1 creates vitest.config.ts + project scaffolding
- Plan 01-01 Task 2 creates src/config/__tests__/schema.test.ts and src/config/__tests__/loader.test.ts
- Plan 01-02 Task 1 creates src/agent/__tests__/workspace.test.ts

Existing infrastructure covers all phase requirements via inline test creation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CLI UX (help text, error formatting) | MGMT-01 | Subjective output quality | Run `clawcode init --help` and verify clear, well-formatted output |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-08
