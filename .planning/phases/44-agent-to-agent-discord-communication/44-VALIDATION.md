---
phase: 44
slug: agent-to-agent-discord-communication
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 44-01-01 | 01 | 1 | A2A-01 | unit | `npx vitest run src/mcp/__tests__/send-to-agent.test.ts` | ❌ W0 | ⬜ pending |
| 44-01-02 | 01 | 1 | A2A-02 | unit | `npx vitest run src/discord/__tests__/bridge-agent-msg.test.ts` | ❌ W0 | ⬜ pending |
| 44-02-01 | 02 | 1 | A2A-03 | unit | `npx vitest run src/manager/__tests__/daemon-a2a.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for MCP tool handler, bridge bot-filter, and IPC routing
- [ ] Existing vitest infrastructure covers framework needs

*Existing infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Webhook embed appears in Discord channel | A2A-01 | Requires live Discord bot | Send test message via MCP tool, verify embed in target channel |
| Agent auto-responds to agent message | A2A-02 | Requires live agent sessions | Start 2 agents, send message from A to B, verify B processes and responds |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
