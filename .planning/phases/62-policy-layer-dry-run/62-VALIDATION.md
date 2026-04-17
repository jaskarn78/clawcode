---
phase: 62
slug: policy-layer-dry-run
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 62 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/triggers/__tests__/policy` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~50 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/triggers/__tests__/policy`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 50 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 62-01-01 | 01 | 1 | POL-01,02 | unit | `npx vitest run src/triggers/__tests__/policy-schema.test.ts` | ❌ W0 | ⬜ pending |
| 62-01-02 | 01 | 1 | POL-02 | unit | `npx vitest run src/triggers/__tests__/policy-evaluator.test.ts` | ❌ W0 | ⬜ pending |
| 62-02-01 | 02 | 2 | POL-03 | unit | `npx vitest run src/triggers/__tests__/policy-watcher.test.ts` | ❌ W0 | ⬜ pending |
| 62-03-01 | 03 | 3 | POL-04 | unit | `npx vitest run src/cli/commands/__tests__/policy.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `handlebars` npm package installed
- [ ] Test stubs for policy schema, evaluator, watcher, CLI

*Existing vitest infrastructure covers all framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hot-reload picks up change without restart | POL-03 | Requires running daemon + file edit | Edit policies.yaml while daemon runs, verify next trigger uses new policy |
| Dry-run table output is readable | POL-04 | Visual assessment of formatting | Run `clawcode policy dry-run --since 1h`, verify output is clear |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 50s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
