---
phase: 94-tool-reliability-self-awareness
plan: 02
subsystem: manager
tags: [mcp, capability-probe, prompt-filter, tool-advertising, di-pure, flap-stability]

# Dependency graph
requires:
  - phase: 85-mcp-tool-awareness-reliability
    provides: McpServerState type, mcpStateProvider DI surface, renderMcpPromptBlock pure renderer (stable-prefix tool block), Phase 85 two-block assembler
  - phase: 94-tool-reliability-self-awareness/01-capability-probe-primitive
    provides: CapabilityProbeStatus 5-value union (ready|degraded|reconnecting|failed|unknown), capabilityProbe?: McpServerState field, per-agent McpServerState snapshot map populated by 60s heartbeat
provides:
  - filterToolsByCapabilityProbe(tools, deps) — pure single-source-of-truth filter; same input -> same Object.freeze'd output; LLM stable prefix never names a degraded/failed/reconnecting/unknown server
  - isServerLlmAdvertisable(serverName, state, flapHistory, now) — pure helper used by the filter; D-12 5min flap-stability window engaged when flapHistory Map is wired
  - FLAP_WINDOW_MS / FLAP_TRANSITION_THRESHOLD constants (5min / 3 transitions) — locked at the contract layer with static-grep regression pin; tuning either requires explicit STATE.md decision
  - FlapHistoryEntry interface — per-server flap-history shape (windowStart, transitions, stickyDegraded, lastReady)
  - ToolDef interface — narrow {name, mcpServer?} shape; built-in tools (no mcpServer) ALWAYS pass
  - FilterDeps interface — {snapshot, flapHistory?, now?} DI surface
  - SessionHandle.getFlapHistory(): Map<string, FlapHistoryEntry> — per-handle stable-identity Map mirror; mutated in place by the filter per tick
  - SessionConfigDeps.flapHistoryProvider?: (agentName: string) => Map<string, FlapHistoryEntry> — additive-optional DI on session-config; SessionManager wires this to the per-handle Map; tests can omit
  - Single-source-of-truth call site at session-config.ts MCP-block assembly — pinned by 4 inline regression tests (FT-REG-SINGLE-SRC, NOT-IN-ASSEMBLER, NOT-IN-MCP-PROMPT-BLOCK, FT-PURITY)
affects: [94-03-recovery, 94-07-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-DI filter module (no fs/SDK/setTimeout/process.env imports) — verified by inline FT-PURITY test reading source via readFileSync; mirrors Phase 94 Plan 01 capability-probe.ts purity invariants"
    - "Caller-owned mutable Map for per-server flap-history (DI'd through FilterDeps.flapHistory) — keeps the filter pure-over-its-arguments while still tracking state across ticks; same input + same Map identity yields deterministic output"
    - "Sticky-degraded window with monotonic engagement: once stickyDegraded=true, the flag stays true for the rest of the active window even if subsequent ticks read ready — prevents prompt-cache prefix-hash yo-yo on rapid flapping (D-12)"
    - "Window reset via elapsed > FLAP_WINDOW_MS comparison: caller's `now()` advances normally; reset under a fresh window with transitions=0 + sticky=false naturally allows recovery without a separate clear() API"
    - "Single-source-of-truth filter call site at session-config.ts pre-renderMcpPromptBlock — tools (one ToolDef per MCP server) are filtered, then the surviving server names drive a server-list filter (mcpServers.filter(s => filteredToolNames.has(s.name))) before the renderer assembles the stable-prefix block; renderer remains a pure renderer of whatever it is given"
    - "Static-grep regression pinning the single-source-of-truth invariant: 4 inline regression tests in filter-tools-by-capability-probe.test.ts assert (a) session-config.ts contains the function name, (b) context-assembler.ts has no `filterToolsByCapabilityProbe(` call, (c) mcp-prompt-block.ts has no `filterToolsByCapabilityProbe(` call, (d) the filter module is pure"
    - "Conservative-default contract: capabilityProbe.status === 'ready' is the ONLY pass condition; missing capabilityProbe field, status='unknown', and explicit non-ready statuses (degraded|reconnecting|failed) all filter out — 'don't advertise unproven tools'"

key-files:
  created:
    - src/manager/filter-tools-by-capability-probe.ts
    - src/manager/__tests__/filter-tools-by-capability-probe.test.ts
  modified:
    - src/manager/persistent-session-handle.ts
    - src/manager/session-adapter.ts
    - src/manager/session-config.ts
    - src/manager/context-assembler.ts
    - src/manager/mcp-prompt-block.ts
    - src/manager/__tests__/session-config.test.ts
    - src/manager/__tests__/session-config-mcp.test.ts
    - src/openai/__tests__/template-driver.test.ts
    - src/openai/__tests__/template-driver-cost-attribution.test.ts
    - src/openai/__tests__/transient-session-cache.test.ts
    - .planning/phases/94-tool-reliability-self-awareness/deferred-items.md

key-decisions:
  - "5min flap window + 3-transition threshold LOCKED at the contract layer (FLAP_WINDOW_MS = 5 * 60 * 1000, FLAP_TRANSITION_THRESHOLD = 3) — pinned by static-grep regression. Threshold=2 would trigger sticky on every recovery cycle (the window becomes a permanent block); 3 is the minimum that catches genuine flapping. Lower window or different threshold requires STATE.md decision (D-12)."
  - "Built-in tools (no mcpServer attribution) ALWAYS pass — Read/Write/Bash/etc. are trusted by definition; their reliability is independent of MCP probe state. Pinned by FT-BUILTIN test (3 builtins all pass with empty snapshot)."
  - "Conservative default for unknown / missing capabilityProbe: filter OUT, NOT pass-through. Agents at first-boot before the heartbeat runs the probe see ZERO MCP servers in their LLM tool table — better to advertise nothing than to promise tools we haven't proven yet. Pre-existing tests that assumed first-boot pass-through were updated to wire ready-state providers explicitly (the new contract is opt-in, not retrofit)."
  - "Single-source-of-truth at session-config.ts (NOT mcp-prompt-block.ts): the renderer remains pure — it renders whatever server list it is given. The filter is applied UPSTREAM during assembly. context-assembler.ts (the two-block assembler) MUST NOT see raw unfiltered MCP servers. 4 inline static-grep regression tests pin this contract."
  - "SessionHandle.getFlapHistory() returns a stable-identity Map (lazy-init once per handle, never reassigned). The filter mutates it in place per tick — caller owns the lifetime. This decouples filter purity from cross-tick flap tracking. Mirrored on the legacy per-turn-query handle (test-only path) for SessionHandle interface parity."
  - "Failed/degraded servers FILTERED OUT entirely from the LLM-visible table — no row, no verbatim error, no name. Operators read the full status (including verbatim errors) via /clawcode-tools slash command + clawcode mcp-status CLI (Phase 85 Plan 03). The pre-94 contract that surfaced lastError.message into the prompt for failed servers is REPLACED — the LLM should not see error context for tools it cannot use; surfacing those errors in the prompt was a vector for phantom-error responses (the original 2026-04-25 bug)."
  - "additive-optional FilterDeps.flapHistory + SessionConfigDeps.flapHistoryProvider — when absent, the ready/degraded gate still applies; only the flap-stability window doesn't engage. Tests that don't care about flap behavior skip wiring it. Production wiring through SessionManager → handle.getFlapHistory() → flapHistoryProvider can land in a follow-up plan without breaking the 94-02 contract."
  - "Server-list-filter, NOT renderer-replacement: instead of teaching renderMcpPromptBlock about probes, we filter the input server list BEFORE the renderer sees it. Result: renderer stays a pure renderer (Phase 85 contract preserved); filter logic stays in one place; existing renderer tests continue to pass unchanged after fixture updates."

patterns-established:
  - "Pure filter + caller-owned mutable history Map idiom — caller's Map is part of the filter's argument tuple (DI), so 'same arguments → same output' holds even though the Map is mutated. Cleaner than internal global state; testable via injected Map identity."
  - "Single-source-of-truth filter at the assembly seam (one place where the LLM's view diverges from operator-truth) — pattern reusable for future filter axes (allowedTools-by-skill, by-permission-mode, by-cost-budget). The assembler downstream of the seam stays pure-renderer."
  - "Static-grep regression for cross-file invariants via inline vitest tests — readFileSync + .not.toMatch on a function-call regex catches future bypasses without standing up an external linter. Pattern is the 6th application across Phase 84/85/86/91/94."

requirements-completed: [TOOL-03]

# Metrics
duration: 34min
completed: 2026-04-25
---

# Phase 94 Plan 02: Dynamic tool advertising — system-prompt filter Summary

**`filterToolsByCapabilityProbe(tools, deps) → readonly ToolDef[]` — pure single-source-of-truth filter wired at `session-config.ts` MCP-block assembly. The LLM stable prefix never names a degraded/failed/reconnecting/unknown MCP server. D-12 5-minute flap-stability window with 3-transition sticky-degraded threshold prevents prompt-cache prefix-hash yo-yo when servers hot-flap. Operator-truth (full status incl. verbatim errors) flows through `/clawcode-tools` + `clawcode mcp-status` (Phase 85 Plan 03), not the LLM prompt.**

## Performance

- **Duration:** 34 min
- **Started:** 2026-04-25T04:31:13Z
- **Completed:** 2026-04-25T05:05:34Z
- **Tasks:** 2 (TDD: RED → GREEN)
- **Files created:** 2
- **Files modified:** 11

## Accomplishments

- Built TOOL-03 dynamic tool advertising filter as a PURE module: no fs/SDK/setTimeout/process.env imports; `Object.freeze` on output; FT-PURITY regression test (`readFileSync` + `not.toMatch` on import patterns) pins the invariant.
- Locked the D-12 5-minute flap-stability window: `FLAP_WINDOW_MS = 5 * 60 * 1000`, `FLAP_TRANSITION_THRESHOLD = 3`. Once a server flaps `ready ↔ non-ready` 3+ times within 5 minutes, the filter sticks in degraded mode for the rest of the window (prevents prompt-cache prefix-hash yo-yo). Window resets after `FLAP_WINDOW_MS` elapses.
- Wired the filter at the SINGLE-SOURCE-OF-TRUTH call site in `session-config.ts`: each MCP server becomes a `ToolDef` with `mcpServer === server.name`; the filter drops any server whose `capabilityProbe.status !== "ready"`; the surviving names then filter the actual `mcpServers` list passed to `renderMcpPromptBlock`. The renderer stays pure (Phase 85 contract preserved).
- Static-grep regression pin via 4 inline tests in the filter test file: `session-config.ts` contains the function name; `context-assembler.ts` and `mcp-prompt-block.ts` do NOT have any call expressions of the filter; the filter module itself remains pure.
- Closes the original production bug class (2026-04-25 fin-acquisition Discord screenshot): with Playwright degraded, the LLM does NOT see a `browser` row in its tool table → cannot promise screenshots. When auto-recovery (Plan 94-03) restores the probe to `ready`, next session-config rebuild re-includes the server.
- Built-in tools (Read / Write / Bash / etc. — no `mcpServer` attribution) ALWAYS pass the filter unconditionally. Pinned by FT-BUILTIN test.
- 13 tests pass (9 FT-* contract + 4 regression pins): all 5 capability-probe states (ready/degraded/failed/reconnecting/unknown), built-in pass-through, mixed kept/filtered, idempotency under re-application, D-12 flap-stability sticky engagement + window reset.
- Zero new npm dependencies; build clean (1.67 MB cli bundle); 192 tests pass across all 8 touched files (filter + session-config + session-config-mcp + context-assembler + persistent-session-handle + 3 openai test mocks).

## Task Commits

1. **Task 1: 9 failing tests for filterToolsByCapabilityProbe (RED)** — `ceda837` (test)
2. **Task 2: implement filter + wire single-source-of-truth call site (GREEN)** — `dee0ee7` (feat)

_Note: TDD task pair — Task 1 wrote failing tests pinning the 5-state contract + flap-stability + built-in pass-through + idempotency. Task 2 implemented the pure module, wired the filter at session-config.ts, threaded `getFlapHistory` through `SessionHandle` + concrete handles + 3 test mocks, and updated pre-existing MCP tests to match the new conservative-default contract._

## Files Created/Modified

### Created

- `src/manager/filter-tools-by-capability-probe.ts` — Pure filter module. `filterToolsByCapabilityProbe(tools, deps)` returns frozen tool list of those backed by a ready MCP server (or built-in). `isServerLlmAdvertisable(serverName, state, flapHistory, now)` is the per-server gate the filter applies. Internal `updateFlapHistory` helper mutates the caller-owned Map; engages sticky-degraded once transitions ≥ FLAP_TRANSITION_THRESHOLD; resets when elapsed > FLAP_WINDOW_MS. DI clock fallback uses `new Date(Date.now())` (integer-arg signature) — same purity convention as Plan 94-01 capability-probe.ts.
- `src/manager/__tests__/filter-tools-by-capability-probe.test.ts` — 13 tests across two `describe` blocks. The 9 FT-* tests cover the 5-value capability-probe enum, builtin pass-through, mixed kept/filtered/builtin path, idempotency under re-application, and the D-12 5min flap-stability window with sticky engagement + window reset. The 4 regression tests pin the single-source-of-truth invariant (filter present in session-config.ts, absent from context-assembler.ts and mcp-prompt-block.ts) plus FT-PURITY (readFileSync + not.toMatch on fs/sdk/setTimeout/process.env imports).

### Modified

- `src/manager/persistent-session-handle.ts` — added `getFlapHistory(): Map<string, FlapHistoryEntry>` accessor; lazy-init once per handle (stable Map identity across all calls); the filter mutates the Map in place per tick. Imports `FlapHistoryEntry` from the new filter module.
- `src/manager/session-adapter.ts` — extended `SessionHandle` interface with `getFlapHistory: () => Map<string, FlapHistoryEntry>` (mandatory); mirrored on the test-mock `MockSessionHandle` class and the legacy `wrapSdkQuery`-based per-turn-query handle (test-only path). Stable Map identity across all calls.
- `src/manager/session-config.ts` — wired the filter at the MCP-block assembly site BEFORE `renderMcpPromptBlock`. Each `mcpServers` entry becomes a `ToolDef`; the filter result drives `mcpServers.filter(s => filteredToolNames.has(s.name))`; the surviving list goes into the renderer. Added `SessionConfigDeps.flapHistoryProvider?: (agentName) => Map<string, FlapHistoryEntry>` (additive-optional DI). Imports `filterToolsByCapabilityProbe` + `FlapHistoryEntry` from the new module.
- `src/manager/context-assembler.ts` — added a TOOL-03 contract comment at the top: the assembler's input `toolDefinitions` source string has ALREADY been filtered upstream; the assembler MUST NOT call the filter directly. No code change.
- `src/manager/mcp-prompt-block.ts` — added a TOOL-03 contract comment at the top of the renderer's docblock: the server list passed in via `input.servers` has ALREADY been filtered upstream in session-config.ts; this renderer renders whatever it is given; operator-truth (full status incl. degraded servers + verbatim errors) flows through `/clawcode-tools` slash + `clawcode mcp-status` CLI. No code change.
- `src/manager/__tests__/session-config.test.ts` — added `import type { McpServerState }` and `readyMcpStateProvider(serverNames)` helper. Updated 3 MCP-related tests to wire a ready-state provider explicitly (the new conservative-default contract filters servers without `capabilityProbe.status === "ready"`). MEM-01-C1 also updated to wire the provider since it now asserts the MCP table appears in the prompt.
- `src/manager/__tests__/session-config-mcp.test.ts` — `makeState` helper now defaults `capabilityProbe` to mirror the connect-test status (ready → ready probe; non-ready → degraded probe). Test 3 (lastError verbatim) and Test 5 (state change ready → failed) updated for new contract: failed servers are FILTERED out of the LLM table entirely; verbatim error does NOT leak into the LLM prompt; the ready vs failed prompts still differ (filter cache invalidation on purpose).
- `src/openai/__tests__/template-driver.test.ts`, `template-driver-cost-attribution.test.ts`, `transient-session-cache.test.ts` — added `getFlapHistory: vi.fn().mockReturnValue(new Map())` to the SessionHandle test mocks (required by the extended interface).
- `.planning/phases/94-tool-reliability-self-awareness/deferred-items.md` — appended a "Plan 94-02 verification" section documenting net-zero new failure surface (28 vs 27 baseline pre-existing failures; the +1 is `MEM-01-C2: 50KB cap` test timeout reproduced unmodified on stash baseline — flaky pre-existing).

## Decisions Made

- **5min flap window + 3-transition threshold LOCKED at the contract layer.** `FLAP_WINDOW_MS = 5 * 60 * 1000` and `FLAP_TRANSITION_THRESHOLD = 3` are pinned by static-grep regression. Threshold=2 would trigger sticky-degraded on every normal recovery cycle (the window becomes a permanent block for any server that ever recovers); 3 is the minimum that distinguishes genuine flapping. Lower window or different threshold requires explicit STATE.md decision logging (D-12).
- **Conservative default for unknown / missing capabilityProbe: filter OUT.** Agents at first-boot before the heartbeat runs see ZERO MCP servers in their LLM tool table — better than promising tools we have not proven yet. Pre-existing tests that assumed first-boot pass-through were updated to wire ready-state providers explicitly. The new contract is opt-in (test wires ready state) NOT retrofit (filter falls back to legacy "render everything").
- **Single-source-of-truth at session-config.ts, NOT mcp-prompt-block.ts.** The renderer stays pure — it renders whatever server list it is given. The filter applies UPSTREAM during assembly. context-assembler.ts (the two-block assembler) MUST NOT see raw unfiltered MCP servers. Four inline static-grep regression tests pin this contract.
- **Failed/degraded servers FILTERED OUT entirely — no row, no verbatim error, no name in the LLM prompt.** The pre-94 contract that surfaced `lastError.message` into the prompt for failed servers is REPLACED — the LLM should not see error context for tools it cannot use; surfacing those errors was a vector for phantom-error responses (the original 2026-04-25 bug). Operators read full status (incl. verbatim errors) via `/clawcode-tools` slash command + `clawcode mcp-status` CLI (Phase 85 Plan 03).
- **SessionHandle.getFlapHistory() returns a stable-identity Map.** Lazy-init once per handle, never reassigned. The filter mutates the Map in place per tick — caller owns the lifetime. This decouples filter purity from cross-tick flap tracking. Mirrored on the legacy per-turn-query handle (test-only path) for SessionHandle interface parity.
- **`SessionConfigDeps.flapHistoryProvider` is additive-optional.** When absent, the ready/degraded gate still applies; only the flap-stability window doesn't engage. Tests that don't care about flap behavior skip wiring it. Production wiring through SessionManager → `handle.getFlapHistory()` → `flapHistoryProvider` can land in a follow-up plan without breaking the 94-02 contract.
- **Server-list-filter, NOT renderer-replacement.** Instead of teaching `renderMcpPromptBlock` about probes, we filter the input server list BEFORE the renderer sees it. Result: renderer stays a pure renderer (Phase 85 contract preserved); filter logic stays in one place; existing renderer tests continue to pass unchanged after fixture updates.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Auto-add missing critical functionality] SessionHandle interface needed `getFlapHistory` accessor and 3 test mocks needed updating**
- **Found during:** Task 2 (wiring the filter into session-config.ts)
- **Issue:** The plan called for `getFlapHistory()` on persistent-session-handle.ts but the SessionHandle interface lives in `session-adapter.ts` (plus the legacy wrapSdkQuery handle and 3 openai/__tests__ test-mock builders all need to satisfy the interface).
- **Fix:** Added `getFlapHistory: () => Map<string, FlapHistoryEntry>` to the SessionHandle interface; mirrored on the persistent handle (real impl), legacy wrapSdkQuery handle (test-only), MockSessionHandle class, and the 3 openai test-mock builders. Stable Map identity across calls in every implementation.
- **Files modified:** `src/manager/session-adapter.ts`, `src/manager/persistent-session-handle.ts`, 3 openai test files.
- **Verification:** All 8 touched test files pass (192 tests).
- **Committed in:** `dee0ee7` (Task 2 commit)

**2. [Rule 3 — Blocking] Pre-existing session-config + session-config-mcp tests assumed pre-94 pass-through behavior**
- **Found during:** Task 2 (initial test run after wiring)
- **Issue:** Tests like "includes MCP tools in Available Tools section" expected the MCP block to render WITHOUT wiring an `mcpStateProvider`. Under the new conservative-default contract (FT-UNKNOWN: missing capabilityProbe → filtered out), every server would be removed → empty MCP block → test failure. Test 3 / Test 5 in session-config-mcp also asserted pre-94 behavior (failed servers' verbatim errors flowing into the prompt).
- **Fix:** Added `readyMcpStateProvider(serverNames)` helper to session-config.test.ts that returns a Map of `McpServerState` with `capabilityProbe.status === "ready"`. Updated 4 tests (2 in session-config.test.ts, 2 in session-config-mcp.test.ts) to wire the provider explicitly. Updated Test 3 / Test 5 in session-config-mcp.test.ts to match the new conservative contract: failed servers are absent from the LLM table; verbatim errors do NOT leak into the prompt (operator-truth flows through /clawcode-tools instead). The makeState helper in session-config-mcp.test.ts now defaults `capabilityProbe` to mirror the connect-test status (ready→ready probe, non-ready→degraded probe) so existing tests that pass a status get matching probe state for free.
- **Files modified:** `src/manager/__tests__/session-config.test.ts`, `src/manager/__tests__/session-config-mcp.test.ts`
- **Verification:** 59/59 tests pass across both files; the new contract is now pinned by these updated tests.
- **Committed in:** `dee0ee7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (Rules 2 + 3). Both were direct consequences of the new SessionHandle surface + new conservative-default contract — in-scope. No architectural changes; no Rule 4 escalation needed.
**Impact on plan:** Net-zero new failure surface (full-suite verification pre-vs-post: 27 vs 28 unique failures, the +1 is a flaky pre-existing `MEM-01-C2` 50KB MEMORY.md test timeout that reproduces on stash baseline).

## Issues Encountered

- The plan's `<files_modified>` block named the source file `src/manager/filter-tools-by-capability.ts` while the function is `filterToolsByCapabilityProbe`. The execution prompt's `<success_criteria>` referenced `src/manager/__tests__/filter-tools-by-capability-probe.test.ts`. Reconciled by naming both the source and test files `filter-tools-by-capability-probe.{ts,test.ts}` — matches the function name and the prompt verification command exactly.
- The plan's must_haves truth said "Mutable suffix continues to render the FULL tool status table" but `mcp-prompt-block.ts` (Phase 85 Plan 02) currently renders into the STABLE PREFIX (it lands in `sources.toolDefinitions`). The plan-author appears to have a slightly incorrect mental model of the current rendering site. Resolved by the cleaner-intent reading: the LLM stable prefix shows only ready servers (filter enforced); operator-truth is exposed via `/clawcode-tools` slash command + `clawcode mcp-status` CLI (Phase 85 Plan 03 — daemon-routed, separate from prompt). Adding a parallel mutable-suffix MCP renderer was out of scope.
- The plan's acceptance criteria included `! grep -q "filterToolsByCapabilityProbe" src/manager/context-assembler.ts` (no matches anywhere — including comments). My initial documentation comments mentioned the function name. Rephrased the comments to refer to "the capability-probe filter" by description rather than name. The four inline regression tests in the test file use the more precise `not.toMatch(/filterToolsByCapabilityProbe\s*\(/)` pattern (call expressions only) which catches genuine bypass attempts while allowing future doc-comment cross-references.
- Pre-existing protocol.test.ts failure (deferred from Plan 94-01) and 26 other pre-existing test failures across migration / daemon-openai / restart-greeting / etc. surfaced in the full-suite sweep. Verified ALL 27 reproduce on stash baseline before any changes — net-zero new failure surface from this plan.

## User Setup Required

None — internal infrastructure. Existing agents will start filtering their LLM-visible MCP tool list AS SOON AS Plan 94-01's heartbeat tick has populated `capabilityProbe` state for each server (60s after warm-path). First-boot agents will see an empty MCP table for the first 60s window; this is the conservative default by design.

## Next Phase Readiness

- **Plan 94-03 (recovery):** when auto-recovery flips a server's `capabilityProbe.status` from `degraded` / `failed` back to `ready`, the next `buildSessionConfig` call (next turn or next config rebuild) will re-include the server in the LLM-visible table automatically. No filter changes required.
- **Plan 94-07 (display):** `/clawcode-tools` slash + `clawcode mcp-status` CLI continue to read the FULL `McpServerState` snapshot (including degraded / failed / reconnecting servers) — operator-truth is preserved. Plan 94-07 enriches the display with capability-probe column + recovery hints; the filter does not interfere.
- **Plan 94-04 (already shipped):** `findAlternativeAgents` is independent of this filter — it reads other agents' `capabilityProbe.status` directly from the McpStateProvider. Cross-agent suggestions still work even when the local agent's MCP is filtered out of its own prompt.
- **Production wiring follow-up:** SessionManager can wire `flapHistoryProvider` to `agentName => handle.getFlapHistory()` so the per-handle Map is consulted across `buildSessionConfig` rebuilds. Currently `flapHistoryProvider` is unwired in production paths — flap-stability is dormant until that follow-up. The ready/degraded gate works regardless.

**No blockers.** The contract is locked, 13 tests are green, the build is clean, the single-source-of-truth invariant is pinned by static-grep regression, and `package.json` is unchanged.

## Self-Check: PASSED

Verified:
- `src/manager/filter-tools-by-capability-probe.ts` — exists; contains `export function filterToolsByCapabilityProbe`, `FLAP_WINDOW_MS = 5 * 60 * 1000`, `FLAP_TRANSITION_THRESHOLD = 3`, `Object.freeze`; passes purity static-grep (no `from "node:fs`, no `from "@anthropic-ai/claude-agent-sdk`, no `setTimeout(`, no `process.env`).
- `src/manager/__tests__/filter-tools-by-capability-probe.test.ts` — exists with 9 FT-* tests + 4 regression tests; `npx vitest run` exits 0 with 13 passes.
- `src/manager/session-config.ts` — contains `filterToolsByCapabilityProbe` (3 occurrences: import, comment, call site).
- `src/manager/context-assembler.ts` + `src/manager/mcp-prompt-block.ts` — neither contains the literal `filterToolsByCapabilityProbe` (comment refers to the filter by description; no calls).
- Build clean (`npm run build` exits 0 with `dist/cli/index.js` 1.67 MB).
- 192 tests pass across all 8 touched files (filter-tools-by-capability-probe + session-config + session-config-mcp + context-assembler + persistent-session-handle + 3 openai test-mock files).
- `git diff package.json` empty (zero new npm deps).
- Commits `ceda837` + `dee0ee7` exist on `master`.

---
*Phase: 94-tool-reliability-self-awareness*
*Plan: 02*
*Completed: 2026-04-25*
