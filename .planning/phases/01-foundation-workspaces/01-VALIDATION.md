---
phase: 1
slug: foundation-workspaces
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-08
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (Wave 0 installs) |
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
| 01-01-01 | 01 | 1 | MGMT-01 | unit | `npx vitest run src/__tests__/config.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | MGMT-01 | unit | `npx vitest run src/__tests__/config-validation.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | WKSP-01 | unit | `npx vitest run src/__tests__/workspace.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | WKSP-02, WKSP-03 | unit | `npx vitest run src/__tests__/identity.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | WKSP-04 | integration | `npx vitest run src/__tests__/isolation.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` + `@vitest/coverage-v8` — test framework installation
- [ ] `vitest.config.ts` — test configuration
- [ ] `src/__tests__/config.test.ts` — stubs for MGMT-01 (config parsing)
- [ ] `src/__tests__/config-validation.test.ts` — stubs for MGMT-01 (schema validation)
- [ ] `src/__tests__/workspace.test.ts` — stubs for WKSP-01 (workspace creation)
- [ ] `src/__tests__/identity.test.ts` — stubs for WKSP-02, WKSP-03 (identity files)
- [ ] `src/__tests__/isolation.test.ts` — stubs for WKSP-04 (workspace isolation)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CLI UX (help text, error formatting) | MGMT-01 | Subjective output quality | Run `clawcode init --help` and verify clear, well-formatted output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
