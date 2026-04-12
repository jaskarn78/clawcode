---
phase: 39
slug: model-tiering-escalation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (ESM-first) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 39-01-01 | 01 | 1 | TIER-01 | unit | `npx vitest run src/config/__tests__/schema.test.ts` | ✅ modify | ⬜ pending |
| 39-01-02 | 01 | 1 | TIER-02 | unit | `npx vitest run src/manager/escalation.test.ts` | ❌ W0 | ⬜ pending |
| 39-02-01 | 02 | 2 | TIER-03 | unit | `npx vitest run src/usage/advisor-budget.test.ts` | ❌ W0 | ⬜ pending |
| 39-02-02 | 02 | 2 | TIER-05 | unit | `npx vitest run src/discord/__tests__/slash-types.test.ts` | ✅ modify | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/manager/escalation.test.ts` — TIER-02 escalation monitor, fork lifecycle, error counting
- [ ] `src/usage/advisor-budget.test.ts` — TIER-03 daily budget, per-agent isolation
- [ ] No framework install needed — vitest already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Haiku actually works for agent tasks | TIER-01 | Requires live daemon + Discord | Start agent with haiku default, send messages, verify responses |
| Escalation fires on real haiku failures | TIER-02 | Requires live agent hitting haiku limits | Trigger complex task, observe fork creation |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
