---
phase: 37
slug: on-demand-memory-loading
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (ESM-first) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/memory/__tests__/ src/mcp/__tests__/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/memory/__tests__/ src/mcp/__tests__/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 01 | 1 | LOAD-01 | unit | `npx vitest run src/mcp/__tests__/memory-lookup.test.ts -t "memory_lookup"` | ❌ W0 | ⬜ pending |
| 37-01-02 | 01 | 1 | LOAD-01 | unit | `npx vitest run src/manager/__tests__/memory-lookup-handler.test.ts` | ❌ W0 | ⬜ pending |
| 37-02-01 | 02 | 2 | LOAD-02 | unit | `npx vitest run src/memory/__tests__/fingerprint.test.ts` | ❌ W0 | ⬜ pending |
| 37-02-02 | 02 | 2 | LOAD-02 | unit | `npx vitest run src/memory/__tests__/soul-storage.test.ts` | ❌ W0 | ⬜ pending |
| 37-02-03 | 02 | 2 | LOAD-02 | unit | `npx vitest run src/manager/__tests__/session-config.test.ts -t "fingerprint"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/mcp/__tests__/memory-lookup.test.ts` — LOAD-01 tool registration and response format
- [ ] `src/manager/__tests__/memory-lookup-handler.test.ts` — LOAD-01 daemon handler routing
- [ ] `src/memory/__tests__/fingerprint.test.ts` — LOAD-02 fingerprint extraction
- [ ] `src/memory/__tests__/soul-storage.test.ts` — LOAD-02 SOUL.md storage idempotency
- [ ] `src/manager/__tests__/session-config.test.ts` updates — LOAD-02 fingerprint injection + top-3 hot

*No framework install needed — vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| System prompt measurably smaller | SC-4 | Requires running agent and comparing prompt sizes | Start agent, capture system prompt length, compare with v1.4 baseline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
