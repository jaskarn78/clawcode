---
phase: 41
slug: context-assembly-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 41 — Validation Strategy

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (ESM-first) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/manager/__tests__/context-assembler.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/manager/__tests__/context-assembler.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 41-01-01 | 01 | 1 | LOAD-03 | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts` | ❌ W0 | ⬜ pending |
| 41-01-02 | 01 | 1 | LOAD-03 | unit | `npx vitest run src/manager/__tests__/session-config.test.ts` | ✅ extend | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `src/manager/__tests__/context-assembler.test.ts` — LOAD-03 budget truncation, ceiling enforcement, v1.4 comparison

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Net prompt size v1.5 <= v1.4 for real agent | LOAD-03 | Requires live daemon | Start agent, capture prompt, compare |

**Approval:** pending
