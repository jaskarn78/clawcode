---
phase: 63
slug: observability-surfaces
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 63 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run src/cli/commands/__tests__/triggers.test.ts src/cli/commands/__tests__/tasks-list.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~50 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 50 seconds

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard task graph renders visually | OBS-03 | Requires browser | Open /tasks in browser, verify SVG graph with agent nodes |
| SSE live updates task graph | OBS-03 | Requires running daemon + active tasks | Start task, watch graph update in real-time |
| Trace tree output readable | OBS-04 | Visual assessment | Run `clawcode trace <id>`, verify tree formatting |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 50s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
