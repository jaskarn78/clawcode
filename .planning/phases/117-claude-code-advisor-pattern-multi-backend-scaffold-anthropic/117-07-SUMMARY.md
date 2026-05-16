---
phase: 117
plan: 07
subsystem: advisor
tags: [advisor, ipc, dispatch, backend-gate, native-short-circuit, deferral]
requires: ["117-02", "117-03", "117-04", "117-05", "117-06"]
provides:
  - DefaultAdvisorService composed at daemon boot with BackendRegistry containing LegacyForkAdvisor + AnthropicSdkAdvisor
  - handleAskAdvisor(deps, params) — exported IPC handler body, testable in isolation
  - ask-advisor IPC handler dispatches through AdvisorService; native backend short-circuits with RESEARCH §13.11 explanatory response
  - Single source of truth for ADVISOR_RESPONSE_MAX_LENGTH truncation (lives in DefaultAdvisorService.ask)
  - backend discriminator on the IPC response envelope ({answer, budget_remaining, backend})
affects:
  - src/manager/daemon.ts (ask-advisor IPC handler body)
tech-stack:
  added: []
  patterns:
    - Handler extraction precedent (forkAdvisorConsult) extended to per-task dispatch helper
    - Native short-circuit at the IPC boundary (RESEARCH §13.11 Option A)
key-files:
  created:
    - src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts
  modified:
    - src/manager/daemon.ts (AdvisorService composition + handleAskAdvisor extraction + ask-advisor body rewrite)
decisions:
  - "T03 (server.ts conditional ask_advisor registration) deferred — architecturally infeasible under the plan's constraints. The MCP server has no per-agent identity at startup; the auto-injected `clawcode` MCP entry in `src/config/loader.ts:296` carries `env: {}` (no CLAWCODE_AGENT). Gating registration would require either (a) injecting CLAWCODE_AGENT into the loader entry (touches resolved-config bytes, crosses into 117-06 territory) AND adding a backend-resolution path readable from the MCP process (currently absent), or (b) a new IPC method (forbidden by plan). T02's IPC short-circuit preserves user-visible correctness: native agents calling `ask_advisor` receive the explanatory short-circuit response. The tool stays in `tools/list` but is effectively a no-op for native agents — cosmetic gap, not correctness gap. Must_have line 18 (`server.ts:925 ask_advisor gated on resolveAdvisorBackend === 'fork'`) marked unsatisfied-by-design pending a follow-up plan that owns BOTH pieces."
  - "Memory-context retrieval (top-5 semantic memories via embedder + SemanticSearch, threaded into buildAdvisorSystemPrompt) DROPPED. `AdvisorServiceDeps.resolveSystemPrompt` is synchronous `(agent) => string` with no memory hook. Widening the service surface is a 117-02 change, out of scope. Native agents retrieve memory through in-session MCP tools; fork agents have `clawcode_memory_search` / `memory_lookup` MCP tools as an equivalent surface. Deliberate parity loss for the rollback path."
  - "Native short-circuit returns `advisorBudget.getRemaining(agent)` directly (bypassing AdvisorService) because no backend dispatch occurs — `AnthropicSdkAdvisor.consult()` throws by design (per RESEARCH §13.11 Option A locked). Going through the service would invoke the registry get + system-prompt resolve only to throw at backend.consult(); short-circuiting at the IPC boundary is cleaner and matches the user-visible message contract."
  - "Handler extracted as `handleAskAdvisor(deps, params)` next to `forkAdvisorConsult` (~daemon.ts:1790) rather than inlined in the switch arm. The `case 'ask-advisor':` block is now 6 lines (validation + delegation), down from ~60 inline lines. Extraction parallels the 117-03 precedent and enables direct unit-testing without standing up the daemon."
  - "Cast `manager.getAgentConfig(agent) as unknown as { advisor?: { backend?: string } }` mirrors session-config.ts:1187. `ResolvedAgentConfig` does not currently expose `advisor?` on its type (Plan 117-06 left it schema-side only). When 117-06 grows the resolved-type alias, both call sites can drop the cast in one sweep."
  - "T05 (mcp/server.test.ts conditional registration assertions) skipped — its premise (the `if (backendId === 'fork')` wrap) does not exist after T03's deferral. Adding tests for behavior that isn't implemented would fabricate coverage. The existing server.test.ts baseline (1 pre-existing failure on `has exactly 22 tools defined`) is unchanged — verified."
metrics:
  duration: ~75 minutes
  completed: 2026-05-13
  tasks_completed: 3/5  # T01, T02, T04 — T03 deferred, T05 skipped
  files_changed: 2 (1 modified, 1 created)
  tests_added: 7
  baseline_tests: "73 failed | 6792 passed | 7 skipped (6872 total) — pre-execution"
  commits: 3
---

# Phase 117 Plan 07: Re-point IPC handler at `AdvisorService`; T03 deferral Summary

**One-liner:** `ask-advisor` IPC handler dispatches through `AdvisorService.ask` for fork-backend agents and short-circuits with RESEARCH §13.11 explanatory response for native-backend agents; the duplicate `ADVISOR_RESPONSE_MAX_LENGTH` truncation + `recordCall` ordering moves to `DefaultAdvisorService.ask` (single source of truth). T03 MCP conditional registration deferred — current architecture forbids per-agent gating at MCP startup; T02's IPC short-circuit preserves user-visible correctness regardless.

## What landed

The daemon's `case "ask-advisor"` IPC handler — which used to inline ~60 lines of fork dispatch, memory-context retrieval, truncation, and budget enforcement — is now a thin 6-line delegation to an exported `handleAskAdvisor(deps, params)` helper. The helper:

1. Resolves the backend via `resolveAdvisorBackend(agentConfig, defaults)` (loader.ts:1068).
2. **Native backend:** returns the RESEARCH §13.11 short-circuit response — `{answer: "Advisor runs in-session…", budget_remaining: <budget>, backend: "native"}`. Tells operators+models to flip `agent.advisor.backend: fork` if they want synchronous behavior. No `AdvisorService.ask` call.
3. **Fork backend:** dispatches via `advisorService.ask({agent, question})`. The service owns budget gate + truncation to `ADVISOR_RESPONSE_MAX_LENGTH` + `recordCall` ordering (Plan 117-02 T06). Returns the service's `{answer, budgetRemaining, backend}` re-mapped to the IPC envelope `{answer, budget_remaining, backend}`.

At daemon boot, `DefaultAdvisorService` is composed with a `BackendRegistry` carrying both `LegacyForkAdvisor` (operator rollback path) and `AnthropicSdkAdvisor` (native marker — `consult()` throws by design). `PortableForkAdvisor` is intentionally not registered (scaffold-only per Plan 117-05). The service closes over `config.defaults.advisor` for the resolver fall-through.

## Goal vs Outcome

- **Goal:** Replace daemon's inline fork dispatch with `AdvisorService` routing; gate MCP `ask_advisor` registration for native-backend agents (drop tool from `tools/list`).
- **Outcome:** IPC dispatch fully rewired through `AdvisorService` for fork agents, short-circuited for native agents at the IPC boundary. **MCP conditional registration deferred** — architecturally infeasible under the plan's constraints (see Deviations). User-visible correctness preserved by the IPC short-circuit regardless of `tools/list` membership.

## Tasks Completed

| Task | Subject                                                                                   | Commit  | Status     |
| ---- | ----------------------------------------------------------------------------------------- | ------- | ---------- |
| T01  | Compose `DefaultAdvisorService` at daemon boot; thread `advisorService` through routeMethod| 4615675 *| Landed     |
| T02  | Re-point `ask-advisor` IPC handler at `AdvisorService`; truncation + memory-drop          | 4673872  | Landed     |
| T03  | Gate `server.tool("ask_advisor", …)` registration on resolved backend                     | —        | Deferred   |
| T04  | `daemon-ask-advisor-dispatch.test.ts` — 7 assertions (A/B/C/C2/C3/D/E)                    | 3c6c835  | Landed     |
| T05  | MCP server.test.ts conditional-registration cases                                          | —        | Skipped (predicate on T03) |

\* T01 landed inside commit `4615675` (titled "117-09 T03") due to a concurrent-commit index race with the parallel agent running plans 117-08 and 117-09 against the same working tree. The 91-line daemon.ts delta in that commit is verbatim the T01 implementation. Subsequent commits use `git commit -o` to prevent recurrence. The code is correct and present at HEAD; only the commit-message audit trail is affected.

## Files

### Modified

- **`src/manager/daemon.ts`** (~150 net lines vs pre-T01)
  - +14 lines of imports (DefaultAdvisorService + BackendRegistry + LegacyForkAdvisor + AnthropicSdkAdvisor + resolveAdvisor*Config + BackendId).
  - +44 lines AdvisorService composition at boot (after `manager.setAdvisorDefaults`, ~line 2611).
  - +10 lines routeMethod signature extension (`advisorService: AdvisorService`, `advisorDefaults: …`).
  - +6 lines per call-site update at the three `routeMethod(...)` invocations (lines ~3622, ~3683, ~6952).
  - +101 lines `handleAskAdvisor(deps, params)` + `AskAdvisorDeps` interface (next to `forkAdvisorConsult`, ~line 1790).
  - −58 lines deleted from the inline `case "ask-advisor":` body (memory-context retrieval block, inline budget check, fork dispatch, truncation, recordCall).
  - +14 lines new minimal `case "ask-advisor":` body (validation + delegation to `handleAskAdvisor`).
  - −1 line `ADVISOR_RESPONSE_MAX_LENGTH` import removed (no longer referenced in production code; only in comments).

### Created

- **`src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts`** (305 lines, 7 assertions)
  - **A** fork dispatch: `AdvisorService.ask` invoked once with `{agent, question}`; response is `{answer, budget_remaining, backend: 'fork'}` sourced from service.
  - **B** native short-circuit: `AdvisorService.ask` NOT called; `answer` matches `/runs in-session/i`; `budget_remaining` from `AdvisorBudget.getRemaining`; `backend: 'native'`.
  - **C** default native: per-agent + defaults both empty → falls through to hardcoded "native" baseline → short-circuit.
  - **C2** defaults select native: per-agent omitted, defaults `'native'` → short-circuit.
  - **C3** defaults select fork: per-agent omitted, defaults `'fork'` → dispatch.
  - **D** response shape preservation: exactly 3 keys `{answer, backend, budget_remaining}` for both branches.
  - **E** precedence: per-agent `'fork'` beats defaults `'native'` → dispatch.

## Test Results

```
src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts
  7 passed (7)

src/advisor/  (regression check — 4 files)
  29 passed (29)

src/manager/__tests__/session-adapter-advisor-observer.test.ts
  all passed (no regressions from T01 routeMethod signature change)

src/mcp/server.test.ts
  36 passed | 1 failed (pre-existing baseline failure on
  "has exactly 22 tools defined" — unchanged by this plan)
```

Baseline pre-execution: 73 failed | 6792 passed | 7 skipped (6872 total).
Post-execution: 57 failed | 6827 passed | 7 skipped (6891 total).
Delta: +19 total tests (this plan added 7; parallel-wave plans 117-08/117-09 added the remainder); passed +35; failed −16 (parallel agents fixed pre-existing failures during this session window). **No new failures from this plan** — the regression baseline shrank rather than grew.

## Deviations from Plan

### T03 — Deferred (architectural)

**Trigger:** Plan T03 instructs to gate `server.tool("ask_advisor", …)` registration in `src/mcp/server.ts:925` on the resolved backend (`resolveAdvisorBackend(agentName) === "fork"`). The task assumes `agentName` is available at MCP server startup.

**Investigation finding:**
- `src/mcp/server.ts:1491 startMcpServer()` calls `createMcpServer()` with no agent context.
- Source comment at `server.ts:170` explicitly: "stdio `clawcode mcp` path — no agent context".
- The auto-injected `clawcode` MCP entry in `src/config/loader.ts:296` has `env: {}` — no `CLAWCODE_AGENT` (in contrast to the shim MCP entries at lines 379+ which DO inject it via `buildShimEnv`).
- Even if CLAWCODE_AGENT were injected, the MCP process cannot resolve backend without either re-parsing clawcode.yaml from disk (no current path) or a new IPC method (forbidden by plan).

**Decision:** Defer T03 to a follow-up plan that owns both pieces:
1. Loader.ts: inject `CLAWCODE_AGENT: agent.name` into the clawcode MCP entry (matches existing Phase 110 shim pattern).
2. MCP server: read agent env at startup; gate `ask_advisor` on the resolved backend, sourced via a new probe mechanism (extend the existing `status` IPC response with backend, or accept a new IPC method when the prohibition relaxes).

**Mitigation in 117-07 (T02 already covers this):** Native agents calling `ask_advisor` via MCP route through the IPC handler, which short-circuits with the RESEARCH §13.11 explanatory response. User-visible behavior is correct — the cosmetic gap is the tool's presence in `tools/list` and the lack of compile-time-style "this tool doesn't exist for you" feedback.

**Must_have line 18 (`server.ts:925 ask_advisor gated on resolveAdvisorBackend === "fork"`):** marked **unsatisfied-by-design** pending the follow-up.

### T05 — Skipped (predicate on T03)

T05 asserts two cases: `server.tool("ask_advisor", …)` IS called when backend resolves to fork; NOT called when native. Both assertions are moot when the `if (backendId === "fork")` wrap doesn't exist. Adding mock-based tests for the deferred behavior would fabricate coverage; instead this plan verifies the existing `src/mcp/server.test.ts` baseline is unchanged (1 pre-existing failure, no new fails).

### Memory-context retrieval — DROPPED (design)

The pre-117-07 inline handler retrieved the top-5 semantic memories (via `manager.getEmbedder().embed(question)` + `SemanticSearch`) and threaded them into `buildAdvisorSystemPrompt(agentName, memoryContext)`. `AdvisorServiceDeps.resolveSystemPrompt` is signed as `(agent: string) => string` — synchronous, no question, no memory hook. Widening the service surface to re-thread memory is a 117-02 change, out of scope for 117-07.

Fork-backend agents lose memory-context injection in the advisor system prompt as a result. Native agents don't need it (the executor has in-session memory MCP tools). Fork agents retain access to `clawcode_memory_search` / `memory_lookup` MCP tools too — graceful parity loss for the rollback path. Documented at the daemon-boot composition site so future readers see the constraint.

### Concurrent-commit race (audit trail blemish)

T01's daemon.ts changes were swept into commit `4615675` (parallel agent's 117-09 T03 commit) due to a shared-index race between parallel agents running 117-08 + 117-09 + 117-07 against the same working tree. The code is correct and at HEAD; only the audit trail is affected. Subsequent commits (T02, T04) use `git commit -o <path>` to prevent recurrence.

## Verification

- `npm run typecheck` — green (pre-existing unrelated errors in 117-09 wave's untracked `bridge-advisor-footer.test.ts` are not from this plan).
- New dispatch suite: 7/7 pass.
- Advisor suite regression check: 29/29 pass.
- MCP server suite: baseline preserved (1 pre-existing fail, unchanged).
- IPC method name `ask-advisor` preserved at `src/ipc/protocol.ts:168` (no rename).
- MCP tool name `ask_advisor` preserved at `src/mcp/server.ts:91` (schema unchanged).
- `AdvisorBudget` 10/day cap stays in effect — fork path checks via `AdvisorService.ask` (budget gate at line 68 of `src/advisor/service.ts`); native short-circuit reads `getRemaining` directly without changing the count.
- `ADVISOR_RESPONSE_MAX_LENGTH` truncation single-sourced at `src/advisor/service.ts:91–94`. Verified zero copies elsewhere (`forkAdvisorConsult` body untouched; daemon handler no longer truncates).

## Reference

- `.planning/phases/117-.../117-07-PLAN.md`
- `.planning/phases/117-.../117-CONTEXT.md` (`<canonical_refs>` — daemon.ts:9805 + mcp/server.ts:91/:925)
- `.planning/phases/117-.../117-RESEARCH.md` (§2 Gate 2; §13.11; §5 Plan 117-07)
- `src/advisor/service.ts` (DefaultAdvisorService.ask — single source of truth for truncation + recordCall)
- `src/config/loader.ts:1068` (resolveAdvisorBackend)

## Self-Check: PASSED

- File `src/manager/__tests__/daemon-ask-advisor-dispatch.test.ts` — FOUND.
- File `.planning/phases/117-…/117-07-SUMMARY.md` — FOUND (this file).
- Daemon edits at `src/manager/daemon.ts` — FOUND (handleAskAdvisor + AskAdvisorDeps exported; AdvisorService composed at boot; ask-advisor IPC body delegates to handler).
- Commit `4615675` (T01 — carried inside concurrent 117-09 T03 commit due to index race) — FOUND.
- Commit `4673872` (T02 — IPC handler rewrite) — FOUND.
- Commit `3c6c835` (T04 — dispatch test) — FOUND.
