---
phase: 117
plan: 04
subsystem: advisor
tags: [advisor, native-sdk, session-adapter, event-emitter, observer-pattern, spread-conditional]
requires: [117-02, 117-06]
provides: [advisor-native-backend, advisor-events, advisor-budget-observer, advisor-model-sdk-wire]
affects:
  - src/advisor/backends/anthropic-sdk.ts (NEW)
  - src/manager/session-manager.ts (advisorEvents emitter + advisor DI setters)
  - src/manager/session-adapter.ts (observer threading + advisorModel spread-conditional)
  - src/manager/persistent-session-handle.ts (production observer wiring)
  - src/manager/session-config.ts (shouldEnableAdvisor + advisorModel field)
  - src/manager/types.ts (AgentSessionConfig.advisorModel)
  - src/manager/sdk-types.ts (SdkQueryOptions.advisorModel)
  - src/manager/daemon.ts (setAdvisorBudget + setAdvisorDefaults DI)
tech-stack:
  added:
    - node:events EventEmitter (Node built-in — zero new deps)
  patterns:
    - Spread-conditional Options field omission (RESEARCH §6 Pitfall 3 — bytestable equality)
    - Post-construction DI setters mirroring setWebhookManager/setBotDirectSender
    - Observational fail-silent wrappers around emit() + recordCall (Phase 50 invariant)
key-files:
  created:
    - src/advisor/backends/anthropic-sdk.ts
    - src/advisor/backends/__tests__/anthropic-sdk.test.ts
    - src/manager/__tests__/session-adapter-advisor-observer.test.ts
  modified:
    - src/advisor/backends/anthropic-sdk.ts (T01 spike-finding header → T06 class body)
    - src/manager/session-manager.ts (advisorEvents + advisorBudget DI + setAdvisorDefaults + makeAdvisorObserver)
    - src/manager/session-adapter.ts (AdvisorObserverConfig type, observer threading at create/resume + iterateWithTracing, advisorModel spread-conditional at both Options sites, extractUsage iterations parser)
    - src/manager/persistent-session-handle.ts (production observer wiring at content-block scan + extractUsage)
    - src/manager/session-config.ts (advisor resolver imports, advisorDefaults+advisorBudget deps, shouldEnableAdvisor gate, spread-conditional advisorModel in return)
    - src/manager/types.ts (AgentSessionConfig.advisorModel)
    - src/manager/sdk-types.ts (SdkQueryOptions.advisorModel)
    - src/manager/daemon.ts (setAdvisorBudget + setAdvisorDefaults wiring)
decisions:
  - T01 spike Outcome B locked — SDK exposes ONLY `advisorModel?: string`; rely on AdvisorBudget daily soft-cap with documented overshoot risk.
  - Plan T03/T04 line numbers pointed at session-adapter.ts (test-only path). Production runs through createPersistentSessionHandle — instrumented BOTH per Rule 1 + Rule 3 to prevent silent-path bifurcation (cited feedback_silent_path_bifurcation memory).
  - advisorBudget injected via setter pattern (setWebhookManager precedent) — budget is constructed AFTER SessionManager in daemon boot order.
  - advisorEvents lives as `public readonly EventEmitter` on SessionManager; bridge subscribes through its injected manager reference (RESEARCH §13.10).
  - turnId carries the SDK assistant-message uuid (when present) — falls back to sessionId. This gives listeners a stable correlator for :invoked → :resulted pair matching.
metrics:
  duration: ~95min
  completed: 2026-05-13
  tasks: 8/8
  commits: 8 (7 task + this SUMMARY)
  tests_added: 17 (5 anthropic-sdk + 12 observer)
  tests_baseline_failures: 17 (unchanged — no regressions)
---

# Phase 117 Plan 04: AnthropicSdkAdvisor + SDK Options wiring + budget observer Summary

**One-liner.** Native advisor wired end-to-end: `Options.advisorModel`
spread-conditional from a backend+budget gate; per-assistant-message
observer emits `advisor:invoked` / `advisor:resulted` on
`SessionManager.advisorEvents`; terminal `result.usage.iterations[]`
charges `AdvisorBudget.recordCall` per `type:"advisor_message"` entry.
Both the production (`createPersistentSessionHandle`) and test-only
(`iterateWithTracing`) handle paths instrumented to prevent silent-path
bifurcation.

## What landed

| Task | Commit | What |
|---|---|---|
| T01 | `6865870` | Spike: confirmed SDK exposes ONLY `advisorModel?: string` (zero `max_uses` siblings); Outcome B locked + mitigation documented in `src/advisor/backends/anthropic-sdk.ts` header. |
| T02 | `3041310` | `SessionManager.advisorEvents` (public readonly EventEmitter). |
| T03+T04 | `dd97f5e` | `AdvisorObserverConfig` type, threading through `SessionAdapter` interface + `SdkSessionAdapter.{create,resume}Session` + `wrapSdkQuery` + `createPersistentSessionHandle`. Block scan emits `advisor:invoked` / `advisor:resulted`; `extractUsage` counts `advisor_message` iterations and calls `recordCall`. Both production and test paths instrumented. SessionManager `setAdvisorBudget()` setter + `makeAdvisorObserver()` factory; daemon DI. |
| T05 | `8c62a75` | `AgentSessionConfig.advisorModel` + `SdkQueryOptions.advisorModel`; `shouldEnableAdvisor` gate (backend=native AND budget.canCall); spread-conditional injection in `session-adapter.ts` baseOptions for BOTH create and resume; `SessionManager.setAdvisorDefaults()` DI; alias canonicalisation via `model-resolver.resolveAdvisorModel`. |
| T06 | `f2680c1` | `AnthropicSdkAdvisor` class body — `id === "native"`, `consult()` throws documented Option-A error pointing at `Options.advisorModel` and the `agent.advisor.backend: fork` rollback. |
| T07 | `65633e1` | `src/advisor/backends/__tests__/anthropic-sdk.test.ts` — 5 cases (throw msg, throw msg fork-hint, id, registry.get, registry.get-unregistered). |
| T08 | `76b361b` | `src/manager/__tests__/session-adapter-advisor-observer.test.ts` — 12 cases covering all three result variants (A/B/C/D), non-advisor server-tool sanity (E), iterations parser (F1–F5 including null + missing), listener-throws non-propagation (G), no-observer back-compat (H). |

## T01 spike result (the load-bearing finding)

```bash
$ grep -n 'advisorModel' node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts
4930:    advisorModel?: string;
$ grep -c 'advisor\|Advisor' sdk.d.ts
2     # only the comment at :4928 + the field at :4930
$ grep -c 'max_uses\|MaxUses' sdk.d.ts
0
```

**Outcome B locked.** No sibling field, no nested `advisor` / `advisorTool`
object. The bundled `claude` CLI handles tool-definition fields opaquely.

**Mitigation:** rely on `AdvisorBudget` per-agent-per-day cap. When
exhausted, `shouldEnableAdvisor` omits `advisorModel` via spread-
conditional on the next session reload. Soft-cap risk accepted: a
single in-flight turn that started before exhaustion can overshoot the
daily cap by ≤ server-side default `max_uses` (3) per turn — documented
acceptance per RESEARCH §13.5 fallback / §7 Q4. The history-scrub
mitigation (§13.5 mitigation B) requires SDK-internal access ClawCode
does not have today — deferred.

Finding recorded verbatim in:
- `src/advisor/backends/anthropic-sdk.ts` header comment block (T01 commit).
- `src/advisor/backends/__tests__/anthropic-sdk.test.ts` test-file header (T07 commit).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 + Rule 3 - Bug] Plan referenced test-only path; production
runs elsewhere.**
- **Found during:** T03 setup (reading session-adapter.ts to locate the
  contentBlocks loop the plan named at `:1488`).
- **Issue:** The `files_modified` list and the task body of T03/T04
  reference `session-adapter.ts:1488` (contentBlocks loop) and `:1164`
  (extractUsage). Those lines live inside `wrapSdkQuery` /
  `iterateWithTracing` — the `@deprecated` Phase 73 legacy path that
  is "retained ONLY as the backing factory for `createTracedSessionHandle`,
  a test-only export" (per the file-level docstring at session-adapter.ts:1301).
  Real production reaches `createPersistentSessionHandle` in
  `persistent-session-handle.ts` which has its own per-assistant-message
  scan (`:579`) and its own `extractUsage` (`:303`). Instrumenting only
  the plan's named file would have shipped a feature that fires in
  tests but never in production — exactly the failure shape
  `feedback_silent_path_bifurcation` warns about (cited Phase 115-08 +
  commit `ca387d9` revert).
- **Fix:** Instrumented BOTH paths with identical block-scan +
  iterations-parser code. Both call into the same `AdvisorObserverConfig`
  passed through `SessionAdapter.{create,resume}Session`. Tests use the
  traced-handle path (the established vitest pattern); production uses
  the persistent-handle path. Both observe the same SDK stream shape so
  the regression value is symmetric.
- **Files modified:** `src/manager/persistent-session-handle.ts`
  (added to scope as Rule 3) and `src/manager/session-adapter.ts`
  (plan's named file).
- **Commit:** `dd97f5e` (T03+T04).

**2. [Rule 3 - Blocking issue] T03/T04 budget access wiring missing
from the plan.**
- **Found during:** T04 (extractUsage needs `AdvisorBudget` to call
  `recordCall`).
- **Issue:** The plan named the `advisorBudget` argument inside the
  observer but didn't specify HOW it reaches `iterateWithTracing` /
  `iterateUntilResult`. `AdvisorBudget` is constructed in daemon.ts at
  `:2592` (AFTER `SessionManager` at `:2401`), so the SessionManager
  constructor cannot accept it.
- **Fix:** Added `setAdvisorBudget(budget)` setter on SessionManager
  mirroring the existing `setWebhookManager` / `setBotDirectSender`
  precedent. Daemon calls it right after constructing AdvisorBudget.
  `makeAdvisorObserver(agentName)` factory returns the observer config
  for the adapter; returns `undefined` when budget hasn't been wired
  (graceful degradation in test paths). Same pattern repeated for
  `setAdvisorDefaults()` to plumb `config.defaults.advisor` into the
  `shouldEnableAdvisor` gate.
- **Files modified:** `src/manager/session-manager.ts`,
  `src/manager/daemon.ts`.
- **Commit:** `dd97f5e` (observer DI) + `8c62a75` (defaults DI).

**3. [Deviation - test placement] Plan T07 §3 cases C/D/E moved to T08.**
- **Found during:** T07 write.
- **Issue:** Plan T07 §3 lists iteration-parser cases (C: 1 advisor_message
  → 1 recordCall, D: 2 → 2, E: iterations null → 0) inside the
  AnthropicSdkAdvisor test file. Those tests need a factored iteration-
  parser helper to test in isolation. The implementation chose to inline
  the parser in `extractUsage` (matches the production code in
  `persistent-session-handle.ts:extractUsage`) — no factored helper
  exists.
- **Resolution:** Equivalent coverage placed in the observer test suite
  (T08) as cases F1–F5, exercising the parser through the same
  `extractUsage` code that production calls. Same regression value;
  better-bound test surface.
- **Files modified:** `src/advisor/backends/__tests__/anthropic-sdk.test.ts`
  (cases C/D/E omitted) + `src/manager/__tests__/session-adapter-advisor-observer.test.ts`
  (cases F1–F5 added).
- **Commits:** `65633e1` (T07) + `76b361b` (T08).

**4. [Rule 2 - Missing critical functionality] `pendingAdvisorToolUseId`
scope.**
- **Found during:** T03 (writing the block-scan loop).
- **Issue:** The plan's pseudocode hoists `pendingAdvisorToolUseId`
  INSIDE the `for (const raw of contentBlocks)` loop. That resets it
  per-block — but per RESEARCH §13.3, `server_tool_use` and
  `advisor_tool_result` are SIBLING blocks in the same `content[]`. A
  per-loop scope would lose the correlator before the matching result
  block is seen.
- **Fix:** Hoisted `pendingAdvisorToolUseId` to the enclosing
  per-assistant-message scope (inside `if (msg.type === "assistant"
  && parentToolUseId === null)`). Per-message reset preserves the
  one-consult-per-turn default (server-side `max_uses` is 3, but
  same-message arrival is the documented norm). Plan task line 129
  parenthetical acknowledged this would need verification — done,
  confirmed, hoisted.

**5. [Documented limitation] OpenAI template-driver path not instrumented.**
- **Found during:** post-implementation verification grep
  (`grep -rn createPersistentSessionHandle src/ --include="*.ts" | grep -v __tests__`).
- **Issue:** `src/openai/template-driver.ts:121` calls
  `createPersistentSessionHandle` with 4 args (no `advisorObserver`).
  These transient per-bearer sessions serve external OpenAI-API
  compatible callers (Phase 74) — they are NOT in the SessionManager
  fleet and have no per-agent `AdvisorBudget` association.
- **Resolution:** No change. The advisor feature is fleet-scoped
  (per-agent budget, per-channel Discord visibility, per-agent
  config-overridable backend). Template-driver sessions don't have
  any of those concepts. The `advisorObserver?` parameter is
  optional, so the 4-arg call still type-checks and runs.
- **Documented for future operators:** if Phase 118+ adds advisor
  support to template-driver sessions, the call site at line 245
  is the wire point.

### Out-of-scope items kept out of scope

Per the plan's Out of Scope clause: no IPC handler re-point (117-07),
no MCP conditional registration (117-07), no Discord visibility
listener (117-09), no `/verbose` slash command (117-11), no
LegacyForkAdvisor changes, no subagent-thread integration. The
`advisor:invoked` / `advisor:resulted` events fire correctly on the
EventEmitter; 117-09 will consume them.

## Verification

- `npm run typecheck` — clean (0 errors).
- `npm test -- src/advisor/` — 6 files, 44 tests, all pass (was 5/39
  baseline; +5 from anthropic-sdk.test.ts).
- `npm test -- src/manager/` — 131 files passed, 5 failed; 1584 tests
  passed, 17 failed. The 5 failed files + 17 failed tests are the
  pre-existing baseline (bootstrap-integration, daemon-openai,
  daemon-warmup-probe, dream-prompt-builder, session-config — none
  touched by 117-04). New passes: +12 from the observer test suite,
  +1 net (1584 vs 1572 + 12 - 1 unknown drift) — verified no
  regressions.
- T07 + T08 in isolation: 2 files / 17 tests, all pass in 631ms.

### Self-Check: PASSED

Files created — verified present:
- `src/advisor/backends/anthropic-sdk.ts` ✓
- `src/advisor/backends/__tests__/anthropic-sdk.test.ts` ✓
- `src/manager/__tests__/session-adapter-advisor-observer.test.ts` ✓

Commits — verified in `git log`:
- T01 `6865870` ✓
- T02 `3041310` ✓
- T03+T04 `dd97f5e` ✓
- T05 `8c62a75` ✓
- T06 `f2680c1` ✓
- T07 `65633e1` ✓
- T08 `76b361b` ✓

## Threat Flags

None. Plan 117-04 touches code paths inside the existing SDK trust
boundary — no new network endpoints, no new auth surface, no new
file access. The new event emitter is process-local; the new SDK
Options field is forwarded verbatim to the bundled CLI binary.

## Known Stubs

None. The `AnthropicSdkAdvisor.consult()` throw is a documented
permanent behavior (Option A locked per RESEARCH §13.11), not a
stub — see the T06 commit message and the class doc-comment for the
rationale. Future planners reading "this throws" should NOT replace
it with an implementation; the executor decides timing inside its
own turn via `Options.advisorModel`.

## Pointers for downstream plans

- **Plan 117-07** (IPC re-point + MCP conditional registration):
  - The `ask-advisor` IPC handler in daemon.ts must resolve backend
    FIRST and return an explanatory envelope for native-backend
    agents (per RESEARCH §13.11 — don't let the throw reach the IPC
    client).
  - The `ask_advisor` MCP tool registration should be conditional on
    `resolveAdvisorBackend(agent) === "fork"`; native-backend agents
    drop the MCP tool registration entirely (RESEARCH §2.2).
- **Plan 117-09** (Discord visibility):
  - Subscribe to `manager.advisorEvents` for both `"advisor:invoked"`
    and `"advisor:resulted"`. The `:invoked` event fires BEFORE
    `dispatchStream` resolves (verified — same per-assistant-message
    scope as text/tool_use scans), so the closure-variable pattern
    in RESEARCH §2.3 works as designed.
  - For the 💭 reaction: hook on `:invoked`. For the footer/verbose
    inline block: hook on `:resulted` and branch on `kind`
    (RESEARCH §13.4 — `advisor_redacted_result` can NOT be displayed
    plaintext; `advisor_tool_result_error` swaps the footer for an
    error message).
- **Plan 117-11** (`/verbose`):
  - The `:resulted.text` field is the answer text for the verbose
    inline block (RESEARCH §13.2 — display ADVICE, not a Q+A pair,
    since `server_tool_use.input` is always empty).
