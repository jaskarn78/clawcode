---
phase: 3
slug: discord-integration
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 01 | 1 | DISC-01, DISC-04 | unit | `npx vitest run src/discord/__tests__/` | inline | ⬜ pending |
| 03-01-T2 | 01 | 1 | DISC-01 | unit | `npx vitest run src/discord/__tests__/` | inline | ⬜ pending |
| 03-02-T1 | 02 | 2 | DISC-02, DISC-03, DISC-04 | integration | `npx vitest run --reporter=verbose` | inline | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created inline within plan tasks. Existing vitest infrastructure from Phase 1 is reused.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Discord message routing | DISC-02 | Requires real Discord bot token and channels | Send message in bound channel, verify correct agent responds |
| Rate limit under sustained load | DISC-04 | Requires real Discord API calls | Send rapid messages across multiple channels, verify no 429 errors |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-09
