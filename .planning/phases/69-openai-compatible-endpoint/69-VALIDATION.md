---
phase: 69
slug: openai-compatible-endpoint
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 69 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TypeScript ESM, existing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/openai src/manager/__tests__/turn-origin.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (quick) / ~3 minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <scoped-path>` for the files touched in that task
- **After every plan wave:** Run `npx vitest run src/openai src/manager src/memory`
- **Before `/gsd:verify-work`:** Full suite must be green (`npm test`)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 69-01-01 | 01 | 1 | OPENAI-07 | unit | `npx vitest run src/manager/__tests__/turn-origin.test.ts` | ✅ | ⬜ pending |
| 69-01-02 | 01 | 1 | OPENAI-04 | unit | `npx vitest run src/openai/__tests__/auth.test.ts` | ❌ W0 | ⬜ pending |
| 69-02-01 | 02 | 2 | OPENAI-01, OPENAI-03 | unit | `npx vitest run src/openai/__tests__/server.test.ts` | ❌ W0 | ⬜ pending |
| 69-02-02 | 02 | 2 | OPENAI-06 | unit | `npx vitest run src/openai/__tests__/translator.test.ts` | ❌ W0 | ⬜ pending |
| 69-02-03 | 02 | 2 | OPENAI-02 | unit | `npx vitest run src/openai/__tests__/stream.test.ts` | ❌ W0 | ⬜ pending |
| 69-03-01 | 03 | 3 | OPENAI-05 | integration | `npx vitest run src/openai/__tests__/session-continuity.test.ts` | ❌ W0 | ⬜ pending |
| 69-03-02 | 03 | 3 | OPENAI-01..07 | E2E | `python scripts/openai-smoke.py` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/openai/__tests__/server.test.ts` — HTTP surface (routing, error shape, CORS) stubs for OPENAI-01, OPENAI-03
- [ ] `src/openai/__tests__/auth.test.ts` — bearer-key hashing, constant-time compare, 401/403 routing stubs for OPENAI-04
- [ ] `src/openai/__tests__/translator.test.ts` — OpenAI↔Claude tool-use bidirectional mapping stubs for OPENAI-06
- [ ] `src/openai/__tests__/stream.test.ts` — SSE chunk shape, role-on-first-chunk, [DONE] termination, streamed tool-call accumulation stubs for OPENAI-02
- [ ] `src/openai/__tests__/session-continuity.test.ts` — per-bearer-key session mapping integration stubs for OPENAI-05
- [ ] `scripts/openai-smoke.py` — Python OpenAI SDK headline E2E test (runs against live daemon on localhost)
- [ ] `src/cli/__tests__/openai-key.test.ts` — CLI subcommand (create/list/revoke) tests for OPENAI-04

*Vitest is already installed; no framework bootstrap needed. Existing infrastructure (better-sqlite3 in-memory, pino test transport) covers fixture needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Python OpenAI SDK smoke against live daemon | OPENAI-01, OPENAI-02 | Requires live network + real Python env | `pip install openai && python scripts/openai-smoke.py` against running daemon |
| OpenClaw integration | OPENAI-01..07 | Requires OpenClaw instance configured with `openai:default` baseUrl → clawcode | Document in README; point OpenClaw at `http://clawdy:3101/v1`; run a test prompt |

*All automatable behaviors have unit or integration test coverage. Manual verifications are real-world-integration smoke tests only.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
