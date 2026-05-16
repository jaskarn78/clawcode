---
phase: 117
plan: 08
subsystem: agent-awareness
tags: [advisor, capability-manifest, system-prompt, awareness]
dependency_graph:
  requires: [117-02, 117-06]
  provides: [agent-side advisor awareness in cached stable prefix]
  affects: [session-config.ts:382–393 cached prefix consumers (downstream)]
tech_stack:
  added: []
  patterns: [pure-function manifest builder, source-of-truth in subsystem, gated-injection-with-narrow-resolver]
key_files:
  created: []
  modified:
    - src/advisor/prompts.ts                            # +86 lines — added buildAgentAwarenessBlock
    - src/manager/capability-manifest.ts                # +49 lines — import + gated injection of bullet + protocol
    - src/manager/__tests__/capability-manifest.test.ts # +111 lines — 5 new advisor cases
decisions:
  - "Source of truth for advisor timing-prompt prose lives in src/advisor/prompts.ts (subsystem-owned), capability-manifest.ts imports it"
  - "Gate the injection on resolveAdvisorBackend(config) ∈ {native, fork}; always true today, future-proofs for 'none' opt-out"
  - "Preserve the 'minimal agents return empty string' rule — advisor block does NOT itself force a non-empty manifest"
  - "ADVISOR_DAILY_BUDGET_HINT=10 is a prompt-time hint; runtime enforcement remains AdvisorBudget (Plan 117-04)"
metrics:
  duration: ~25min
  completed_date: 2026-05-13
  tasks_completed: 3
  files_created: 0
  files_modified: 3
  tests_added: 5
  tests_total_after: 73 (advisor slice + capability-manifest) — 24 baseline manifest + 5 new + 44 advisor-side already green
---

# Phase 117 Plan 08: Agent awareness — system-prompt advisor block + capability manifest entry Summary

One-liner: Capability manifest now emits an "Advisor (Opus)" bullet plus a canonical timing-prompt "## Advisor protocol" prose block on every agent's cached stable prefix, with the prose source-of-truth living in `src/advisor/prompts.ts::buildAgentAwarenessBlock` and the manifest gating injection on `resolveAdvisorBackend(config) ∈ {native, fork}`.

## Scope clarification (orchestrator-visible)

The spawning prompt described T03 as a `context-assembler.ts` injection + test, but the PLAN.md `must_haves` and RESEARCH §3 / §4.4 are explicit: **context-assembler.ts is NOT modified** — it consumes the manifest verbatim from `session-config.ts:382–393` (downstream of the injection). The authoritative plan was followed: T01 (prompts.ts helper) → T02 (capability-manifest.ts injection) → T03 (capability-manifest.test.ts extension). The advisor confirmed the prompt/plan mismatch and recommended plan-first. No assembler files were touched.

## Tasks executed

### T01 — `buildAgentAwarenessBlock()` in `src/advisor/prompts.ts`
- Added an exported function returning `{ bullet, protocol }` for the manifest to consume.
- Bullet carries a `(legacy fork backend — operator rollback path)` qualifier when `backend === "fork"` so operators on the rollback path can tell at a glance which dispatch route is live.
- Protocol prose is lightly adapted from the docs-recommended Advisor Tool timing prompt (CLAUDE.md / CONTEXT.md `<decisions>.Claude's Discretion`), with a ClawCode-specific addendum:
  - "Consultations are visible in Discord (💭 reaction + footer)."
  - "For tasks that need operator-watchable execution (multi-step exploration, code review, long research), use `spawn_subagent_thread` instead — that creates a visible sidebar thread."
- Existing `buildAdvisorSystemPrompt` parity tests stay green (6/6).
- **Commit:** `b574330 feat(117-08): T01 — add buildAgentAwarenessBlock() to src/advisor/prompts.ts`

### T02 — Inject bullet + protocol into `src/manager/capability-manifest.ts`
- Imported `buildAgentAwarenessBlock` from `../advisor/prompts.js` and `resolveAdvisorBackend` from `../config/loader.js`.
- Added section 10b inside `buildCapabilityManifest`: resolve the backend (duck-typed cast since `ResolvedAgentConfig` doesn't yet carry the `advisor` field — resolver fall-through default `"native"` handles this), gate on `backend ∈ {native, fork}`, push the bullet into the existing bullets list.
- Appended `advisorAwareness.protocol` to the return string after the existing `memoryProtocol` so both protocol sections land in the cached stable prefix together.
- Hardcoded `ADVISOR_DAILY_BUDGET_HINT = 10` is a prompt-time hint; runtime enforcement remains `AdvisorBudget` (Plan 117-04). Future work can flow the live count through if useful.
- `capability-probes.ts` deliberately untouched (RESEARCH §6 Pitfall 5); an explicit `EXPLICIT DO-NOT` comment in the manifest references the pitfall so future readers don't drift.
- 24 baseline manifest tests stay green; typecheck clean.
- **Commit:** `1d04959 feat(117-08): T02 — inject advisor bullet + protocol into capability-manifest.ts`

### T03 — Extend `src/manager/__tests__/capability-manifest.test.ts`
Five new assertions:
- **CM-ADV-A (native):** non-minimal agent with default backend → `Advisor (Opus)` bullet + `## Advisor protocol` heading present; no `legacy fork backend` qualifier.
- **CM-ADV-B (fork):** config with `advisor: { backend: "fork" }` (cast-applied) → bullet carries `(legacy fork backend — operator rollback path)` qualifier.
- **CM-ADV-C (defensive, documenting):** asserts the gate intent for a future `"none"` backend (unreachable today via resolver narrowing); inverse direction confirms the gate is currently always true.
- **CM-ADV-D (single injection):** `Advisor (Opus)` bullet and `## Advisor protocol` heading each appear **exactly once** in a maximalist agent's assembled manifest.
- **CM-ADV-MINIMAL:** baseline agents (no opt-ins) still return `""` — the advisor block does NOT itself force a non-empty manifest, preserving the file's "don't bloat minimal agents" philosophy and keeping CM-4 / CM-4b green.
- Substring assertions used (per plan T03) so cosmetic edits don't force snapshot refreshes.
- **Commit:** `f2e364c test(117-08): T03 — extend capability-manifest.test.ts with advisor cases`

## Test pass delta

| Slice                                  | Before | After |
| -------------------------------------- | ------ | ----- |
| `capability-manifest.test.ts`          | 24     | 29    |
| `advisor/` test suite                  | 44     | 44    |
| **Combined (advisor + manifest)**      | **68** | **73** |

All 73 tests pass; `npm run typecheck` clean across the full repo.

## Critical correctness gates — confirmed

- `src/manager/capability-probes.ts` **NOT** modified. `grep -n "advisor" src/manager/capability-probes.ts` → exit 1 (zero matches). RESEARCH §6 Pitfall 5 honored.
- `src/manager/context-assembler.ts` **NOT** modified. PLAN.md must_have honored (assembler is downstream of the injection at `session-config.ts:382–393`).
- The awareness block is injected for **both** `native` and `fork` backends. The qualifier differs (`fork` adds the `legacy fork backend — operator rollback path` note).
- 117-scope correctness preserved: the resolver narrows to `"native" | "fork"`, so the gate's `null` branch is unreachable today. The gate exists for future regressions per the plan's explicit instruction.

## Files touched

| File                                                   | Change | Lines (+/-)   |
| ------------------------------------------------------ | ------ | ------------- |
| `src/advisor/prompts.ts`                               | MOD    | +86  / -0     |
| `src/manager/capability-manifest.ts`                   | MOD    | +49  / -1     |
| `src/manager/__tests__/capability-manifest.test.ts`    | MOD    | +111 / -0     |

## Commits

- `b574330` — feat(117-08): T01 — add buildAgentAwarenessBlock() to src/advisor/prompts.ts
- `1d04959` — feat(117-08): T02 — inject advisor bullet + protocol into capability-manifest.ts
- `f2e364c` — test(117-08): T03 — extend capability-manifest.test.ts with advisor cases
- `e12e433` — docs(117-08): summary (initial draft, superseded by this revision)
- `0c74fba` — fix(117-08): protocol points to subagent-thread by skill name, not MCP tool name (Rule 1 auto-fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Advisor protocol referenced `spawn_subagent_thread` MCP tool name verbatim, breaking session-config test assertion**

- **Found during:** post-completion full-suite run (`npm test`) — advisor consultation flagged that PLAN.md verify-step `npm run build` and a full-suite run had not been executed yet.
- **Issue:** my T01 prose draft included the literal token `spawn_subagent_thread` (matching the MCP tool name) as a pointer to the alternative tool. The capability manifest runs for any agent with at least one opt-in (`skills.length > 0`), so the protocol prose leaked the tool name across `session-config.test.ts:153` — `does NOT include guidance when agent has other skills but not subagent-thread` — which asserts the prompt does NOT contain `spawn_subagent_thread` for agents that have OTHER skills but not the subagent-thread skill.
- **Fix:** rewrite the pointer in `buildAgentAwarenessBlock` to reference `"the subagent-thread skill"` (skill name) instead of `"spawn_subagent_thread"` (MCP tool name). Identical intent; preserves the negative assertion. Also updated CM-ADV-A to assert the substring `"subagent-thread skill"` rather than the MCP tool name.
- **Files modified:** `src/advisor/prompts.ts`, `src/manager/__tests__/capability-manifest.test.ts`
- **Commit:** `0c74fba fix(117-08): protocol points to subagent-thread by skill name, not MCP tool name`

### Scope clarification (orchestrator-visible — see top of summary)

The orchestrator's prompt description named `context-assembler.ts` for T03; PLAN.md `must_haves` explicitly say context-assembler is NOT modified. Plan-first per advisor consultation. No assembler files were touched.

## Pre-existing flakes (out of scope)

Full-suite run also surfaces these pre-existing failures, verified by checking out the pre-117-08 commit (`a23e0cd`) and re-running the suite — same set fails there. Logged but NOT fixed per the executor scope-boundary rule:

- `src/openai/__tests__/session-continuity.test.ts` — `v1 legacy rows are copied to v2 exactly once on first post-migration boot` (5s timeout)
- `src/cli/commands/__tests__/migrate-openclaw-complete.test.ts` — SC-3 / SC-4 (5s timeouts on Phase 82 migration tests)
- `src/manager/__tests__/session-config.test.ts` — 5 pre-existing failures (`fingerprint + top-3 hot memories` size budget at 2800, `resume summary budget` strategy assertion, two `Phase 73 brief cache wiring` cases, and `MEM-01-C2` 50KB-truncation marker assertion). All fail on `a23e0cd` (pre-117-08) too.
- `src/manager/__tests__/daemon-openai.test.ts` — 4 startOpenAiEndpoint pre-existing failures
- Various dream-prompt-builder / conversation-brief / config-mapper / memory-translator / verifier / keys.test.ts pre-existing failures

Deferred — none of these touch advisor / capability-manifest paths, none were introduced by 117-08.

## Out of scope (per plan, deferred)

- `/verbose` slash command (Plan 117-11)
- Discord visibility (💭 reaction + footer in chat) (Plan 117-09)
- IPC handler + MCP gating (Plan 117-07)
- Live budget hint (Plan 117-04 owns the runtime counter; manifest hint stays at the static `10`)

## Manual verification (deferred to 117-10)

Per the plan: "Manual: bring up `test-agent` (Plan 117-10 smoke), ask it 'what's in your capability list?' — confirm response mentions `advisor`." Not exercised here; will be validated in 117-10 smoke.

## Self-Check: PASSED

- `src/advisor/prompts.ts` exports `buildAgentAwarenessBlock` — FOUND (lines 49-127 of file)
- `src/manager/capability-manifest.ts` imports and calls the helper — FOUND (import line + section 10b)
- `src/manager/__tests__/capability-manifest.test.ts` carries CM-ADV-A/B/C/D/MINIMAL — FOUND (29/29 tests pass)
- Commit `b574330` (T01) — FOUND in `git log`
- Commit `1d04959` (T02) — FOUND in `git log`
- Commit `f2e364c` (T03) — FOUND in `git log`
- `capability-probes.ts` untouched — CONFIRMED (`grep -n "advisor" ...` exits 1, zero matches)
- `context-assembler.ts` untouched — CONFIRMED (`git diff --name-only HEAD~3 HEAD` shows only the three intended files)
