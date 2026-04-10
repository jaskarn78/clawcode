---
phase: 40
slug: cost-optimization-budgets
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 40 — Validation Strategy

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
| 40-01-01 | 01 | 1 | COST-01 | unit | `npx vitest run src/usage/tracker.test.ts` | ✅ extend | ⬜ pending |
| 40-01-02 | 01 | 1 | COST-02 | unit | `npx vitest run src/memory/importance.test.ts` | ❌ W0 | ⬜ pending |
| 40-02-01 | 02 | 2 | TIER-04 | unit | `npx vitest run src/usage/budget.test.ts` | ❌ W0 | ⬜ pending |
| 40-02-02 | 02 | 2 | COST-01 | unit | `npx vitest run src/cli/commands/costs.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/memory/importance.test.ts` — COST-02 scoring heuristic tests
- [ ] `src/usage/budget.test.ts` — TIER-04 budget enforcement tests
- [ ] `src/cli/commands/costs.test.ts` — COST-01 CLI command tests
- [ ] No framework install needed — vitest already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard costs section renders correctly | COST-01 | Requires browser + running dashboard | Start daemon, open dashboard, verify costs section shows |
| Discord budget alert embeds look correct | TIER-04 | Requires live Discord connection | Configure budget, exceed it, verify embed in channel |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
