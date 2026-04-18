---
phase: 60
slug: trigger-engine-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 60 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/triggers/__tests__/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/triggers/__tests__/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 60-01-01 | 01 | 1 | TRIG-07 | unit | `npx vitest run src/triggers/__tests__/dedup.test.ts` | ❌ W0 | ⬜ pending |
| 60-01-02 | 01 | 1 | TRIG-08 | unit | `npx vitest run src/triggers/__tests__/engine.test.ts` | ❌ W0 | ⬜ pending |
| 60-02-01 | 02 | 2 | TRIG-01 | unit | `npx vitest run src/triggers/__tests__/scheduler-source.test.ts` | ❌ W0 | ⬜ pending |
| 60-02-02 | 02 | 2 | TRIG-06 | unit | `npx vitest run src/triggers/__tests__/replay.test.ts` | ❌ W0 | ⬜ pending |
| 60-03-01 | 03 | 3 | LIFE-03 | unit | `npx vitest run src/tasks/__tests__/retention.test.ts` | ❌ W0 | ⬜ pending |
| 60-03-02 | 03 | 3 | TRIG-01,08 | integration | `npx vitest run src/triggers/__tests__/integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/triggers/__tests__/` — test directory created
- [ ] Test stubs for dedup, engine, scheduler-source, replay, integration
- [ ] `src/tasks/__tests__/retention.test.ts` — retention purge tests

*Existing vitest infrastructure covers all framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Daemon restart replays missed events | TRIG-06 | Requires actual daemon stop/start cycle | Start daemon, stop for 5min, restart, check agent received missed triggers |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
