---
phase: 67
slug: resume-auto-injection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 67 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `67-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.3 |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/memory/__tests__/conversation-brief.test.ts --reporter=verbose` |
| **Full suite command** | `npm test` (→ `vitest run --reporter=verbose`) |
| **Estimated runtime** | ~35 seconds (scoped); ~4 minutes (full) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/memory/__tests__/conversation-brief.test.ts src/manager/__tests__/session-config.test.ts src/manager/__tests__/context-assembler.test.ts --reporter=verbose`
- **After every plan wave:** `npx vitest run src/memory/ src/manager/ src/performance/ src/config/ --reporter=verbose`
- **Before `/gsd:verify-work`:** `npm test` — full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 67-01-01 | 01 | 1 | SESS-02 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "renders last N summaries"` | ❌ W0 | ⬜ pending |
| 67-01-02 | 01 | 1 | SESS-02 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "renders markdown structure"` | ❌ W0 | ⬜ pending |
| 67-01-03 | 01 | 1 | SESS-02 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "respects sessionCount config"` | ❌ W0 | ⬜ pending |
| 67-01-04 | 01 | 1 | SESS-02 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "enforces conversation_context budget"` | ❌ W0 | ⬜ pending |
| 67-01-05 | 01 | 1 | SESS-03 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "skips when gap under threshold"` | ❌ W0 | ⬜ pending |
| 67-01-06 | 01 | 1 | SESS-03 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "injects when gap over threshold"` | ❌ W0 | ⬜ pending |
| 67-01-07 | 01 | 1 | SESS-03 | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "respects gap threshold config"` | ❌ W0 | ⬜ pending |
| 67-01-08 | 01 | 1 | edge | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "zero history produces empty string"` | ❌ W0 | ⬜ pending |
| 67-01-09 | 01 | 1 | edge | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "falls back to startedAt for active session"` | ❌ W0 | ⬜ pending |
| 67-01-10 | 01 | 1 | edge | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "renders old summaries without decay filter"` | ❌ W0 | ⬜ pending |
| 67-01-11 | 01 | 1 | edge | unit | `npx vitest run src/memory/__tests__/conversation-brief.test.ts -t "filters by session-summary tag only"` | ❌ W0 | ⬜ pending |
| 67-01-12 | 01 | 1 | config | unit | `npx vitest run src/config/__tests__/schema.test.ts -t "resumeSessionCount floor"` | ⚠ extend | ⬜ pending |
| 67-01-13 | 01 | 1 | config | unit | `npx vitest run src/config/__tests__/schema.test.ts -t "conversationContextBudget floor"` | ⚠ extend | ⬜ pending |
| 67-02-01 | 02 | 2 | SESS-02 | integration | `npx vitest run src/manager/__tests__/session-config.test.ts -t "conversation context in mutable suffix"` | ⚠ extend | ⬜ pending |
| 67-02-02 | 02 | 2 | wiring | integration | `npx vitest run src/manager/__tests__/session-config.test.ts -t "calls conversation brief assembler"` | ⚠ extend | ⬜ pending |
| 67-02-03 | 02 | 2 | wiring | integration | `npx vitest run src/manager/__tests__/session-config.test.ts -t "handles missing conversationStore"` | ⚠ extend | ⬜ pending |
| 67-02-04 | 02 | 2 | SESS-02 | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "measures conversation_context tokens"` | ⚠ extend | ⬜ pending |
| 67-02-05 | 02 | 2 | audit | unit | `npx vitest run src/performance/__tests__/context-audit.test.ts -t "SECTION_NAMES includes conversation_context"` | ⚠ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*File Exists: ❌ W0 = create new in Wave 0; ⚠ extend = append to existing test file in Wave 0*

---

## Wave 0 Requirements

- [ ] `src/memory/__tests__/conversation-brief.test.ts` — 11 new test cases covering SESS-02, SESS-03, and edge cases for `assembleConversationBrief` helper
- [ ] `src/memory/conversation-brief.ts` — helper module with `assembleConversationBrief(opts)` signature, `now: number` injection for deterministic gap-skip tests, pre-enforcement budget accumulator
- [ ] `src/memory/conversation-brief.types.ts` — typed options + result union
- [ ] `src/config/__tests__/schema.test.ts` — extend with 2 cases for new Zod floors (`resumeSessionCount >= 1`, `conversationContextBudget >= 500`)
- [ ] `src/manager/__tests__/session-config.test.ts` — extend with 3 cases for assembler wiring (mutable-suffix placement, helper invocation, graceful degradation)
- [ ] `src/manager/__tests__/context-assembler.test.ts` — extend with 1 case for `section_tokens.conversation_context` metadata
- [ ] `src/performance/__tests__/context-audit.test.ts` — extend with 1 case for `SECTION_NAMES` includes `conversation_context`

**Fixtures to create/reuse:**
- In-memory MemoryStore helper with N pre-seeded session-summary MemoryEntries (lift pattern from `src/memory/__tests__/session-summarizer.test.ts`)
- In-memory ConversationStore helper exposing `listRecentSessions(agentName, 1)` with controllable `endedAt` + `startedAt` (lift from `src/memory/__tests__/conversation-store.test.ts`)
- `MockClock`: injected `now: number` parameter into `assembleConversationBrief` so gap-threshold math is deterministic (no `Date.now()` monkey-patching)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end: restart daemon after real Discord conversation, observe agent natural recall of prior turns | SESS-02 + SESS-03 acceptance | Requires a live Discord channel + real LLM turn-taking; can't faithfully mock in CI | 1) Have a 5+ turn conversation with an agent → stop daemon. 2) Wait 4+ hours (or manually insert stub turns with 4h+ old `endedAt`). 3) Restart daemon. 4) Ask the agent "what were we talking about earlier?" — it should reference the prior topic without the user repeating themselves. |
| Context audit CLI shows `conversation_context` section in real session output | audit | Validates the new `SECTION_NAMES` entry surfaces in live audit reports | After a real session starts: run `clawcode context-audit <agent>` and confirm the table includes a `conversation_context` row with a non-zero token count. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (all commands use `vitest run`, not `vitest`)
- [ ] Feedback latency < 60s per task-commit sample
- [ ] `nyquist_compliant: true` set in frontmatter (after plan-checker + nyquist-auditor approval)

**Approval:** pending
