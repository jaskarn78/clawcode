---
phase: 94-tool-reliability-self-awareness
plan: 04
subsystem: manager
tags: [mcp, tool-call-error, llm-tool-result, di-pure, alternatives, classification]

# Dependency graph
requires:
  - phase: 85-mcp-tool-awareness-reliability
    provides: McpServerState type, TOOL-04 verbatim error pass-through pattern
  - phase: 94-tool-reliability-self-awareness/01-capability-probe-primitive
    provides: CapabilityProbeStatus 5-value union, capabilityProbe?: McpServerState field, McpServerState snapshot map per agent
provides:
  - ToolCallError discriminated-shape interface with kind/tool/errorClass/message/suggestion?/alternatives? — D-06 contract Plans 94-05 (auto-injected tool internal failures) + 94-07 (display) consume
  - ErrorClass 5-value enum (transient|auth|quota|permission|unknown) — locked at the contract layer with static-grep regression pin (12 literal occurrences in tool-call-error.ts)
  - classifyToolError(error: string|Error): ErrorClass — pure regex-based classifier with deterministic priority order (auth → quota → permission → transient → unknown)
  - wrapMcpToolError(rawError, context): ToolCallError — pure factory returning frozen object; verbatim-message pass-through (Phase 85 TOOL-04 inheritance); empty alternatives array omitted (cleaner JSON for the LLM tool-result slot)
  - findAlternativeAgents(toolName, mcpStateProvider): readonly string[] — pure D-07 helper; reads per-agent snapshots, filters to capabilityProbe.status === "ready"; default tool→server heuristic handles `mcp__<server>__*` (SDK-prefixed) and `<server>_*` (server-injection-pattern)
  - McpStateProvider DI surface — abstract interface over the per-agent snapshot map; daemon edge will wire this from SessionManager once Plan 94-04 reaches production wiring (TurnDispatcher accepts it as additive-optional today so existing tests pass unchanged)
  - TurnDispatcher.executeMcpTool(toolName, executor): ExecuteMcpToolResult — single-source-of-truth MCP tool-call wrap site; single-attempt-then-wrap (NO silent retry); LLM receives raw content on success or JSON-stringified ToolCallError with isError=true on rejection
  - mcpStateProvider + toolErrorSuggestion additive-optional fields on TurnDispatcherOptions — Phase 86/89 schema-extension blueprint
affects: [94-05-auto-injected-tools, 94-07-tools-display, 94-03-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-DI module pattern (no fs/SDK/clock/logger imports) — verified by static-grep regression pins; mirrors Phase 94 Plan 01 capability-probe.ts and Phase 85 readiness.ts purity invariants"
    - "Verbatim-message pass-through (Phase 85 TOOL-04 inheritance) — wrapped.message === source error.message exact substring; no truncation, no rewriting; operator inspects + redacts upstream if needed"
    - "Discriminated-union shape with literal kind discriminator — `kind: \"ToolCallError\"` allows future expansion of the LLM tool-result variant union without breaking type-narrowing in existing consumers"
    - "Object.freeze on output (CLAUDE.md immutability rule) — frozen ToolCallError + frozen alternatives array; consumers cannot mutate the cross-reference list"
    - "Single-source-of-truth call site pattern — TurnDispatcher.executeMcpTool is the one method through which production MCP tool calls flow for the wrap path; static-grep against the wrap site prevents bypass"
    - "Single-attempt-then-wrap (no silent retry) — recovery (Plan 94-03) is heartbeat-driven at the connection layer; tool-execution layer is single-call-or-wrap so the LLM sees the structured failure and adapts naturally"
    - "Default tool→server heuristic with explicit DI override — handles two common naming conventions (`mcp__<server>__*` SDK-prefixed and `<server>_*` server-injection-pattern); the McpStateProvider DI surface allows test stubs to short-circuit ambiguous cases"

key-files:
  created:
    - src/manager/tool-call-error.ts
    - src/manager/find-alternative-agents.ts
    - src/manager/__tests__/tool-call-error.test.ts
    - src/manager/__tests__/find-alternative-agents.test.ts
    - src/manager/__tests__/turn-dispatcher-tool-error.test.ts
  modified:
    - src/manager/turn-dispatcher.ts
    - .planning/phases/94-tool-reliability-self-awareness/deferred-items.md

key-decisions:
  - "5-value ErrorClass enum LOCKED at contract layer (transient|auth|quota|permission|unknown) — verified by 12 literal occurrences in tool-call-error.ts; adding a 6th value cascades through Plans 94-05 (renderer) + 94-07 (display) and requires explicit STATE.md decision"
  - "Verbatim message pass-through preserved (Phase 85 TOOL-04 inheritance) — wrapped.message carries err.message exact substring; no wrapping, no truncation, no rewriting; pinned by TCE-VERBATIM (Playwright sentinel error string from D-CONTEXT) + TCE-NO-LEAK (auth-failed-for-SECRET test) + multi-line preservation test"
  - "Classification regex priority order (auth → quota → permission → transient → unknown) — when 'HTTP 401 timeout' matches both auth and transient, auth wins because the more specific class better signals what the LLM should do; pinned by TCE-PRIORITY tests"
  - "Empty alternatives array OMITTED from JSON output (not serialized as `alternatives: []`) — cleaner JSON for the LLM tool-result slot; the LLM doesn't need to read an empty list to know there are no alternatives; pinned by TCE-ALT-empty test"
  - "Single-attempt-then-wrap: TurnDispatcher.executeMcpTool calls the executor exactly ONCE before wrapping; recovery (Plan 94-03) is heartbeat-driven at the connection layer, NOT at the tool-execution layer; the LLM sees the structured failure and adapts naturally (asks the user, switches to alternative agent) instead of silently retrying the same bad call"
  - "TurnDispatcher integration via new public method `executeMcpTool` rather than refactoring iterateUntilResult: production MCP tool calls flow through the SDK driverIter (no direct callMcpTool path on the dispatcher); the new method gives 94-05 (auto-injected tools) a wrap-route they can hit directly + provides the single-source-of-truth seam for future direct-MCP-call sites; existing SDK tool-call flow is unaffected this plan"
  - "mcpStateProvider DI is additive-optional on TurnDispatcherOptions — when absent, ToolCallError.alternatives is undefined (no field); existing tests without the field continue to pass; daemon edge wires the provider once SessionManager construction is touched in a future plan"
  - "Default tool→server heuristic tries SDK-prefix shape first (`mcp__<server>__*`) so server names containing underscores (e.g. `finmentum_db`) still resolve; falls back to leading-segment match (`<server>_*`) otherwise; ambiguous bare-name tools yield empty alternatives (cannot disambiguate which MCP backs them)"

patterns-established:
  - "ToolCallError discriminated-shape JSON-serializable contract for LLM tool-result slot — mirrors Phase 88/90 SkillInstallOutcome / PluginInstallOutcome discriminated-union exhaustive-switch idiom; v1 ships a singleton variant (kind: 'ToolCallError'), future MCP-result wrapping may expand the union"
  - "Pure-DI helper module pattern across Phase 94 — tool-call-error.ts + find-alternative-agents.ts mirror capability-probe.ts purity invariants (no fs/SDK/clock/logger imports); all I/O DI'd through provider abstractions"
  - "Single-source-of-truth wrap method on TurnDispatcher — production tool-call execution paths funnel through executeMcpTool; static-grep can verify no direct MCP call bypasses the wrap (regression pin candidate for future plans)"

requirements-completed: [TOOL-07]

# Metrics
duration: 17min
completed: 2026-04-25
---

# Phase 94 Plan 04: Honest ToolCallError schema + executor wrap Summary

**D-06 ToolCallError discriminated-shape contract for the LLM tool-result slot. Mid-turn MCP tool rejections wrap into a 5-value ErrorClass (transient|auth|quota|permission|unknown) + verbatim message + cross-agent alternatives, so the LLM adapts naturally instead of silently retrying or surfacing a raw exception.**

## Performance

- **Duration:** 17 min
- **Started:** 2026-04-25T04:09:18Z
- **Completed:** 2026-04-25T04:26:24Z
- **Tasks:** 2 (TDD: RED → GREEN)
- **Files created:** 5
- **Files modified:** 2

## Accomplishments

- **D-06 ToolCallError schema landed.** When a tool that PASSED the capability probe (Plan 94-01) still fails mid-turn — transient network blip, auth token expiry race, quota burst, permission revocation — the executor wraps the failure into a structured discriminated-shape object the LLM receives in the tool-result slot. LLM adapts naturally: tries an alternative agent, asks the user to refresh credentials, waits out the quota window. No silent retries. No raw exceptions surfacing to the user.
- **5-value ErrorClass enum locked at the contract layer.** `transient | auth | quota | permission | unknown` — 12 literal occurrences in tool-call-error.ts pinned by static-grep. Adding a 6th value cascades through Plans 94-05 (renderer) + 94-07 (display) and requires an explicit STATE.md decision.
- **Verbatim-message pass-through preserved (Phase 85 TOOL-04 inheritance).** `wrapped.message === err.message` exact substring; no truncation, no rewriting. The exact Playwright sentinel from D-CONTEXT specifics ("Executable doesn't exist at /home/clawcode/.cache/ms-playwright/chromium-1187/chrome-linux/chrome") survives byte-for-byte through the wrap. Multi-line errors preserved. No-leak: wrapper does NOT augment messages with env values or secrets.
- **Cross-agent D-07 alternatives populated via pure helper.** `findAlternativeAgents(toolName, mcpStateProvider)` reads per-agent capabilityProbe snapshots and filters to `status === "ready"` — degraded/failed/reconnecting/unknown agents excluded. Sorted alphabetically + frozen. Tolerates legacy Phase 85 snapshots without `capabilityProbe` field (read as not-ready, excluded). Default tool→server heuristic handles `mcp__<server>__*` (SDK-prefixed) AND `<server>_*` (server-injection-pattern).
- **TurnDispatcher single-source-of-truth wrap method.** `executeMcpTool(toolName, executor)` is the one entry point through which production tool calls flow for the wrap path. Single-attempt-then-wrap (NO silent retry inside the dispatcher) — recovery (Plan 94-03) is heartbeat-driven at the connection layer, NOT at the tool-execution layer. Plan 94-05 (auto-injected tools) hits this directly when its internal failures need wrapping.
- **Zero new npm deps; build clean; 73 tests pass across 5 files** (21 tool-call-error + 8 find-alternative-agents + 4 turn-dispatcher-tool-error + 32 unchanged turn-dispatcher tests + 8 turn-dispatcher-skill-effort tests). 12 pre-existing manager test failures verified pre-existing via `git stash` baseline run; net-zero new failure surface from this plan.

## Task Commits

1. **Task 1: 33 failing tests (RED)** — `ebe75de` (test)
2. **Task 2: implement modules + TurnDispatcher integration (GREEN)** — `6630111` (feat)

_Note: TDD task pair — Task 1 wrote failing tests against not-yet-existing modules + the TurnDispatcher.executeMcpTool API; Task 2 made the failing tests pass via tool-call-error.ts + find-alternative-agents.ts implementations + the executeMcpTool wrap method + DI seams._

## Files Created/Modified

### Created

- **`src/manager/tool-call-error.ts`** — Pure module. `ErrorClass` 5-value union; `ToolCallError` discriminated-shape interface (kind/tool/errorClass/message/suggestion?/alternatives?); `classifyToolError(error: string|Error): ErrorClass` deterministic regex classifier with priority order auth → quota → permission → transient → unknown; `wrapMcpToolError(rawError, context): ToolCallError` factory returning frozen object with verbatim-message pass-through. No fs imports, no SDK imports, no clock construction, no logger — purity verified by static-grep.
- **`src/manager/find-alternative-agents.ts`** — Pure module. `McpStateProvider` DI surface (listAgents + getStateFor + optional toolToServer); `findAlternativeAgents(toolName, provider): readonly string[]` reads per-agent snapshots, filters to `capabilityProbe?.status === "ready"`; default heuristic handles SDK-prefix `mcp__<server>__*` first then leading-segment `<server>_*` fallback; sorted + frozen output.
- **`src/manager/__tests__/tool-call-error.test.ts`** — 21 tests across 2 describe blocks. TCE-CLASS-1..5 (5-value enum classification), TCE-CLASS priority order pin, TCE-VERBATIM (Playwright sentinel) + multi-line preservation + NO-LEAK; TCE-DISCRIMINATOR (kind literal); TCE-CLASSIFY (cross-product against classifyToolError); TCE-JSON (round-trip survival); TCE-ALT (populated/empty/absent variants); TCE-SUGGESTION (populated/absent); TCE-IMMUTABLE (frozen output + frozen alternatives); TCE-STRING-ERR (string input); TCE-TOOL (tool field passthrough).
- **`src/manager/__tests__/find-alternative-agents.test.ts`** — 8 tests. FAA-1 happy (3 agents, 2 ready); FAA-2 no-alternatives; FAA-3 missing-mcp; FAA-4 reconnecting/failed/unknown all excluded; FAA-5 missing-capability-probe field (legacy snapshot); FAA-6 default heuristic mcp__<server>__ prefix; FAA-7 immutable result frozen; FAA-8 unmappable tool name (frozen empty).
- **`src/manager/__tests__/turn-dispatcher-tool-error.test.ts`** — 4 tests. TD-NO-RETRY (single executor invocation + structured ToolCallError JSON in content + isError=true); TD-PASS-THROUGH (success returns content unchanged); TD-ALTERNATIVES (mcpStateProvider populates alternatives); TD-VERBATIM (Playwright error preserved through dispatcher).

### Modified

- **`src/manager/turn-dispatcher.ts`** — Imports `wrapMcpToolError` + `ErrorClass` + `ToolCallError` from tool-call-error.js; imports `findAlternativeAgents` + `McpStateProvider` from find-alternative-agents.js. Added `mcpStateProvider?: McpStateProvider` + `toolErrorSuggestion?: (errorClass) => string | undefined` to `TurnDispatcherOptions` (additive-optional — existing tests pass unchanged). Added `ExecuteMcpToolResult` interface ({content: string, isError: boolean}). Added public `executeMcpTool(toolName, executor): Promise<ExecuteMcpToolResult>` method — single-source-of-truth wrap site. Best-effort log on rejection (observational; never breaks the wrap path).
- **`.planning/phases/94-tool-reliability-self-awareness/deferred-items.md`** — Logged 12 pre-existing manager test failures across 4 files (bootstrap-integration, daemon-openai, daemon-warmup-probe, restart-greeting) verified pre-existing via `git stash` baseline run. Net-zero new failure surface from this plan; root causes are 4 independent regressions in unrelated areas — recommended fix path is a small dedicated cleanup phase.

## Decisions Made

- **5-value ErrorClass enum LOCKED at the contract layer.** Adding a 6th value (`server-error`, `partial`, etc.) cascades through Plans 94-05 (renderer) + 94-07 (display) and requires explicit STATE.md decision.
- **Classification regex priority order: auth → quota → permission → transient → unknown.** When "HTTP 401 timeout" matches both auth and transient, auth wins — more specific class better signals what the LLM should do.
- **Empty alternatives array OMITTED from JSON output** (not serialized as `alternatives: []`). Cleaner JSON for the LLM tool-result slot; the LLM doesn't need to read an empty list to know there are no alternatives.
- **TurnDispatcher integration via new public method `executeMcpTool` rather than refactoring `iterateUntilResult`.** Production MCP tool calls flow through the SDK `driverIter` inside the persistent session handle — there's no direct `callMcpTool` path on the dispatcher to intercept. The new method gives Plan 94-05 (auto-injected tools) a wrap-route they can hit directly when their internal failures need wrapping + provides the single-source-of-truth seam for future direct-MCP-call sites. The existing SDK tool-call flow inside the persistent session handle is unaffected this plan; it continues to use the SDK's own tool-result rendering.
- **mcpStateProvider DI is additive-optional on TurnDispatcherOptions.** When absent, `ToolCallError.alternatives` is undefined (no field). Existing tests without the field continue to pass. Daemon edge wires the provider once SessionManager construction is touched in a follow-up plan.
- **Default tool→server heuristic tries SDK-prefix shape first** (`mcp__<server>__*`). Server names containing underscores (e.g. `finmentum_db`) still resolve correctly. Falls back to leading-segment match. Bare-name tools yield empty alternatives — cannot disambiguate which MCP backs them.
- **Object.freeze on output + frozen alternatives array** (CLAUDE.md immutability rule). Consumers cannot mutate the cross-reference list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Static-grep self-trip in module docblock comments**
- **Found during:** Task 2 (purity acceptance grep verification)
- **Issue:** The module docblock in both `tool-call-error.ts` and `find-alternative-agents.ts` documented the static-grep regression pin INLINE — quoting the regex pattern (`! grep -E "from \"node:fs|new Date\\(\\)|setTimeout|process\\.env" ...`). The plan's purity grep pin then matched its own self-reference inside the comment, false-positive-failing the purity check.
- **Fix:** Replaced the inline regex quotes with prose ("No fs imports, no clock construction, no timers, no env access — see plan rules section"). Same intent communicated; no false-positive grep matches.
- **Files modified:** `src/manager/tool-call-error.ts`, `src/manager/find-alternative-agents.ts`
- **Verification:** Both purity pins PASS after the edit:
  - `! grep -E "from \"node:fs|from \"@anthropic-ai/claude-agent-sdk|process\\.env|new Date\\(\\)" src/manager/tool-call-error.ts` → empty
  - `! grep -E "from \"node:fs|new Date\\(\\)|setTimeout|process\\.env" src/manager/find-alternative-agents.ts` → empty
- **Committed in:** `6630111` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — Blocking). Self-trip was a documentation hygiene issue, not a behavior bug.
**Impact on plan:** Net-zero behavior change. Static-grep pins now match the actual code surface, not their own self-reference.

## Issues Encountered

- The plan referenced TurnDispatcher's `try/catch around callMcpTool` integration site — but production MCP tool calls actually flow through the SDK `driverIter` inside the persistent session handle (`iterateUntilResult` in `persistent-session-handle.ts`), NOT through any direct method on the dispatcher itself. The plan acknowledged this: "if the existing TurnDispatcher API doesn't expose a hook for this test, the implementation in Task 2 may need a small refactor to expose a tool-result-rendering DI seam." Resolution: added a public `executeMcpTool(toolName, executor)` method on TurnDispatcher as the single-source-of-truth wrap site — Plan 94-05 (auto-injected tools whose own implementations may reject) hits it directly, and the seam is in place for any future direct-MCP-call sites. Existing SDK tool-call flow inside the persistent session handle is unaffected.
- 12 pre-existing manager test failures surfaced during the full sweep (bootstrap-integration 2, daemon-openai 6, daemon-warmup-probe 1, restart-greeting 2). All verified pre-existing via `git stash` baseline run. Documented in `deferred-items.md` with root-cause categorization. Out of scope for Plan 94-04.

## User Setup Required

None — no external service configuration required. Pure-module schema + dispatcher integration; daemon edge wiring of `mcpStateProvider` happens in a follow-up plan when SessionManager construction is touched.

## Next Phase Readiness

- **Plan 94-05 (auto-injected tools — clawcode_fetch_discord_messages + clawcode_share_file):** can call `dispatcher.executeMcpTool(toolName, () => internalImpl())` to wrap their internal failures into the same ToolCallError shape the LLM expects. The 5-value ErrorClass enum and verbatim-message contract are locked.
- **Plan 94-07 (/clawcode-tools display):** can render the per-class status table using ErrorClass literals (transient/auth/quota/permission/unknown) and the cross-agent alternatives line by reading `findAlternativeAgents` directly (or by reading historical ToolCallError.alternatives from a future log surface — out of scope this plan).
- **Plan 94-03 (recovery):** the verbatim error in `capabilityProbe.error` (Plan 94-01 already populates this) is the input for recovery pattern matching. Plan 94-04's wrap is orthogonal — it operates at the LLM tool-result-boundary, not the connection layer where Plan 94-03 lives. The two plans don't conflict.
- **Daemon edge wiring (follow-up):** when `SessionManager` exposes `getMcpStateForAgent(agent)` (already exists per Plan 85), the daemon can construct an `McpStateProvider` and pass it as `mcpStateProvider` to `TurnDispatcher` — at that point alternatives populate live in production. Today the provider is additive-optional; tests cover the wired-and-unwired paths.

**No blockers.** The contract is locked, the tests are green (73 in scope), the build is clean, the wrap path is in place, the McpStateProvider DI surface is defined for future wiring.

## Self-Check: PASSED

Verified:
- `src/manager/tool-call-error.ts` exists; contains `export function classifyToolError`, `export function wrapMcpToolError`, `kind: "ToolCallError"` discriminator, `Object.freeze`, 5-value ErrorClass enum (12 literal occurrences); passes purity static-grep pin (no fs/SDK/clock/logger).
- `src/manager/find-alternative-agents.ts` exists; contains `export function findAlternativeAgents`, `capabilityProbe?.status === "ready"` filter, `Object.freeze` on output; passes purity static-grep pin (no fs/clock/timers/env).
- `src/manager/turn-dispatcher.ts` modified; contains `wrapMcpToolError` import + `executeMcpTool` method + `mcpStateProvider` + `toolErrorSuggestion` DI options.
- `npx vitest run src/manager/__tests__/tool-call-error.test.ts src/manager/__tests__/find-alternative-agents.test.ts src/manager/__tests__/turn-dispatcher-tool-error.test.ts src/manager/__tests__/turn-dispatcher.test.ts src/manager/__tests__/turn-dispatcher-skill-effort.test.ts --reporter=dot` — 73 tests pass across 5 files.
- `npm run build` exits 0; `dist/cli/index.js` 1.66 MB.
- `git diff package.json` empty (zero new npm deps).
- Commits `ebe75de` (test) + `6630111` (feat) exist on `master`.
- 12 pre-existing manager test failures verified pre-existing via `git stash` baseline; documented in `deferred-items.md`. Net-zero new failure surface from Plan 04.

---
*Phase: 94-tool-reliability-self-awareness*
*Plan: 04*
*Completed: 2026-04-25*
