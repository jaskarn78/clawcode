---
phase: 61
slug: additional-trigger-sources
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 61 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/triggers/__tests__/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~50 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/triggers/__tests__/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 50 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 61-01-01 | 01 | 1 | TRIG-02 | unit | `npx vitest run src/triggers/__tests__/mysql-source.test.ts` | ❌ W0 | ⬜ pending |
| 61-01-02 | 01 | 1 | TRIG-03 | unit | `npx vitest run src/triggers/__tests__/webhook-source.test.ts` | ❌ W0 | ⬜ pending |
| 61-02-01 | 02 | 2 | TRIG-04 | unit | `npx vitest run src/triggers/__tests__/inbox-source.test.ts` | ❌ W0 | ⬜ pending |
| 61-02-02 | 02 | 2 | TRIG-05 | unit | `npx vitest run src/triggers/__tests__/calendar-source.test.ts` | ❌ W0 | ⬜ pending |
| 61-03-01 | 03 | 3 | TRIG-02,03,04,05 | integration | `npx vitest run src/triggers/__tests__/sources-integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/triggers/__tests__/` — test stubs for all 4 source types
- [ ] mysql2 installed as dependency

*Existing vitest infrastructure covers all framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MySQL trigger fires on real DB insert | TRIG-02 | Requires running MySQL | Insert row in pipeline_clients, verify agent receives turn |
| Webhook fires on real HTTP POST | TRIG-03 | Requires running daemon + HTTP client | POST to /webhook/<id> with HMAC, verify agent turn |
| Calendar fires 15min before event | TRIG-05 | Requires Google Calendar event | Create event, wait for offset, verify agent turn |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 50s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
