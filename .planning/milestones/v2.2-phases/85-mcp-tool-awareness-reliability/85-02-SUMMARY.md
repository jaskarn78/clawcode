---
phase: 85-mcp-tool-awareness-reliability
plan: 02
subsystem: prompt-assembly
tags: [mcp, prompt-cache, stable-prefix, tool-awareness, phantom-error-fix, security-pitfall-12]
requires:
  - phase: 85-mcp-tool-awareness-reliability
    provides: [McpServerState, SessionManager.getMcpStateForAgent, SessionHandle.getMcpState]
provides:
  - renderMcpPromptBlock
  - MCP_PREAUTH_STATEMENT
  - MCP_VERBATIM_ERROR_RULE
  - SessionConfigDeps.mcpStateProvider
  - "Stable-prefix MCP tools section (heading + preauth statement + live status table + verbatim-error rule)"
affects:
  - src/manager/mcp-prompt-block.ts
  - src/manager/session-config.ts
  - src/manager/session-manager.ts
tech-stack:
  added: []
  patterns:
    - "pure prompt-section renderer (zero I/O, zero logger, typed input, deterministic output) — unit-testable without mocks"
    - "canonical string constants exported for static-grep regression pins (MCP_PREAUTH_STATEMENT, MCP_VERBATIM_ERROR_RULE)"
    - "optional dep injection (mcpStateProvider) with graceful empty-Map fallback — keeps tests + legacy bootstrap paths working without wiring live state"
    - "markdown-table rendering with pipe-escape + newline-collapse — preserves table validity while keeping error text verbatim (TOOL-04 pass-through)"
key-files:
  created:
    - src/manager/mcp-prompt-block.ts
    - src/manager/__tests__/mcp-prompt-block.test.ts
    - src/manager/__tests__/session-config-mcp.test.ts
  modified:
    - src/manager/session-config.ts
    - src/manager/session-manager.ts
    - src/manager/__tests__/session-config.test.ts
key-decisions:
  - "MCP_VERBATIM_ERROR_RULE constant is a SINGLE-LINE string literal (not multi-line concatenation) so the plan's static-grep verification command `grep \"include the actual error message verbatim\" src/manager/mcp-prompt-block.ts` finds exactly one hit. Multi-line concatenation was my first take; had to collapse it when the grep pin returned zero."
  - "Tools column hard-coded to U+2014 em dash in v2.2 — populating it with real tool names requires calling q.mcpServerStatus() at prompt-build time (out of scope for Plan 01, and would force the stable prefix to recompute whenever a server's tool inventory drifts). Pinned the em-dash shape now so a later plan can populate it without a prompt-shape change that invalidates the cache hash."
  - "mcpStateProvider is OPTIONAL on SessionConfigDeps. Absent → empty Map → every server renders `status: unknown`. Rationale: legacy bootstrap paths + zero-setup tests don't need to wire state; the prompt still carries the preauth framing + server list so the phantom-error class is closed even before the first heartbeat tick."
  - "Optional-server annotation only appears when status !== 'ready' (failed/degraded/reconnecting/unknown get '(optional)'; ready stays clean). Rationale: 'ready (optional)' would be visual noise — operators care about the annotation precisely when the server is NOT working, because that's the moment they want to know whether it blocked startup."
  - "Pitfall 12 closure made DEFAULT by narrowing the renderer's accepted server shape to `Pick<McpServerSchemaConfig, \"name\"> & { optional? }`. Even if a future edit tries to add `command` or `env` into a table cell, it would have to re-widen the type AND bypass the test-8 grep assertion — two independent regression pins."
  - "`SessionManager.configDeps` gets ONE additive line wiring `mcpStateProvider: (name) => this.getMcpStateForAgent(name)`. getMcpStateForAgent already existed from Plan 01; no wiring-order change; configDeps stays backward-compatible with every caller (startAgent + warm-session-reuse code path)."
  - "Updated 3 legacy MCP assertions in session-config.test.ts to match the new markdown-table shape. The old assertions pinned the command/args leak we are explicitly removing (Pitfall 12), so a test update was mandatory — not a deviation from spec, an execution of spec."
requirements-completed: [TOOL-02, TOOL-05, TOOL-07]
metrics:
  duration: "13min 24s"
  duration_seconds: 804
  tests_added: 17
  files_created: 3
  files_modified: 3
  completed: "2026-04-21T20:18:02Z"
---

# Phase 85 Plan 02: Prompt-Builder MCP Tools Section Summary

**One-liner:** Replaced the legacy MCP bullet-list (which leaked `command`/`args` into every prompt) with a pure `renderMcpPromptBlock` helper that emits a pre-authenticated framing statement + live per-server status table + verbatim-error rule, all landing in the v1.7 stable cached prefix so compaction can't evict them.

## Performance

- **Duration:** 13min 24s
- **Started:** 2026-04-21T20:04:38Z
- **Completed:** 2026-04-21T20:18:02Z
- **Tasks:** 2 (TDD — each RED + GREEN)
- **Files created:** 3 (1 source + 2 test)
- **Files modified:** 3 (session-config.ts, session-manager.ts, session-config.test.ts — legacy assertions updated)
- **Tests added:** 17 (10 unit + 7 integration)
- **Regression:** 110 adjacent tests (session-config / context-assembler / session-manager / warm-path-mcp-gate / mcp-session) — all green

## Accomplishments

- `renderMcpPromptBlock({servers, stateByName})` ships as a pure module with 10 unit tests pinning every truth in the plan's `must_haves` block
- `session-config.ts:289-298` legacy bullet-list (with its `command`/`args` leak) is **gone** — Pitfall 12 closed
- Preauth statement AND verbatim-error rule both land in `result.systemPrompt` (stable prefix) — integration test Test 1 pins this; mutable suffix contains neither string
- `SessionManager.getMcpStateForAgent` (Plan 01) → `configDeps.mcpStateProvider` (Plan 02) → `renderMcpPromptBlock({stateByName})` — the live state reaches the prompt surface via one clean dependency chain
- Cache discipline: identical state → byte-identical prompt; state change invalidates the cache on purpose
- Zero pre-authenticated block for zero-MCP agents — no empty tables in anyone's prompt

## Task Commits

Each task was executed as a TDD pair (RED → GREEN):

1. **Task 1 RED** — `ee0e46a` — `test(85-02): add failing tests for mcp-prompt-block` (10 unit tests)
2. **Task 1 GREEN** — `121a911` — `feat(85-02): implement mcp-prompt-block pure renderer`
3. **Task 2 RED** — `4983dcb` — `test(85-02): add failing integration tests for session-config MCP block` (7 integration tests)
4. **Task 2 GREEN** — `7bf90d9` — `feat(85-02): wire renderMcpPromptBlock into session-config + thread mcpStateProvider`

**Plan metadata commit:** pending (created at step `git_commit_metadata`)

**Note:** Task 2 GREEN also included the legacy-test update for `session-config.test.ts` (3 assertions adjusted to match the new markdown-table format). Committed atomically with the wire-up so the full regression stays green at every point in history — no intermediate red state.

## Files Created/Modified

### Created

- `src/manager/mcp-prompt-block.ts` (148 lines) — pure renderer + `MCP_PREAUTH_STATEMENT` + `MCP_VERBATIM_ERROR_RULE` constants
- `src/manager/__tests__/mcp-prompt-block.test.ts` (254 lines) — 10 unit tests pinning preauth string, verbatim rule, table shape across all 5 statuses, lastError pass-through, empty-servers short-circuit, em-dash Tools column, optional annotation, Pitfall 12 closure, pipe/newline escaping
- `src/manager/__tests__/session-config-mcp.test.ts` (259 lines) — 7 integration tests pinning stable-prefix placement, no-MCP agent case, state provider pass-through, cache stability + invalidation, Pitfall 12 closure at the session-config boundary

### Modified

- `src/manager/session-config.ts` — added `renderMcpPromptBlock` + `McpServerState` type imports; added optional `mcpStateProvider` to `SessionConfigDeps`; replaced the legacy MCP bullet-list (lines 289-298) with a helper call threaded through `toolDefinitionsStr`
- `src/manager/session-manager.ts` — one-line addition to `configDeps` wiring `mcpStateProvider: (name) => this.getMcpStateForAgent(name)`
- `src/manager/__tests__/session-config.test.ts` — updated 3 assertions in the legacy MCP-tools-injection describe block to match the new markdown-table format and to pin the absence of the old command/args leak

## How the State Flows

```
SessionManager.getMcpStateForAgent(name)       <-- Plan 01 mirror, refreshed each heartbeat tick
  → configDeps.mcpStateProvider(name)          <-- Plan 02 one-line wiring
    → buildSessionConfig deps.mcpStateProvider
      → renderMcpPromptBlock({ servers, stateByName })
        → toolDefinitionsStr
          → sources.toolDefinitions
            → assembleContext(...).stablePrefix   <-- v1.7 two-block assembly — STABLE
              → AgentSessionConfig.systemPrompt
                → SDK preset.append (cached)
```

Every hop is typed, nullable-safe, and regression-pinned. When the state provider is absent (tests, first-boot before heartbeat tick), the renderer falls back to an empty Map and every server row reads `status: unknown` — the preauth framing still lands and closes the phantom-error class even before live state is available.

## Why STABLE PREFIX Placement Matters

TOOL-07 requires the preauth statement and verbatim-error rule to survive compaction. The v1.7 two-block assembler routes `sources.toolDefinitions` into the stable prefix (cached by SDK `systemPrompt.append`), and the mutable suffix into a per-turn preamble. Compaction touches the mutable suffix; it does not rebuild the stable prefix. Routing the MCP block through `toolDefinitions` gives us eviction-proof placement without any new plumbing.

**What we explicitly did NOT do:** threading MCP state through `conversationContext` (the mutable-suffix slot the Plan 01 SUMMARY briefly mentioned). That path evicts on compaction — Phase 67 pitfall. The plan's Step D anti-pattern list called this out; the integration test Test 1 pins it by asserting the strings appear in `systemPrompt` AND do NOT appear in `mutableSuffix`.

## Tools Column Migration Path

Today: `| server-name | ready | — | |`. The em dash is U+2014, asserted by a dedicated unit test (Test 6) so a `replaceAll("—", "--")` edit would fail.

To populate it, a future plan wires `q.mcpServerStatus()` at prompt-build time, returns the exposed tool names, and the renderer becomes:

```typescript
const tools = state?.toolNames?.length
  ? state.toolNames.join(", ")
  : "\u2014";
```

Because the column ALREADY exists in the table shape, this change is prompt-hash-compatible — existing caches don't invalidate just because one row's Tools cell gained a value.

## Removed Security Leak (Pitfall 12)

The legacy block rendered `` `- **${server.name}**: `${server.command} ${server.args.join(" ")}` `` into every agent's system prompt. That's the literal shell command used to spawn the MCP server — including any argv secrets, file paths, and tool names an operator would consider internal.

The new renderer's accepted server shape is `Pick<McpServerSchemaConfig, "name"> & { optional? }`. Even if a future edit tries to add `command` or `env` into a table cell, it would have to:

1. Re-widen the `RenderableServer` type (caught by review)
2. Bypass Test 8's four `not.toContain` assertions on command/args/env values
3. Bypass the session-config-mcp integration test's Pitfall-12 closure assertion

Two independent regression pins. The leak cannot silently come back.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] MCP_VERBATIM_ERROR_RULE was multi-line concatenation; static-grep pin returned zero hits**

- **Found during:** Task 1 GREEN verification
- **Issue:** I initially wrote the constant as a 3-line `"..." + "verbatim..." + "..."` concatenation for readability. That satisfied the runtime assertion (`toContain(MCP_VERBATIM_ERROR_RULE)`) but broke the plan's static-grep verification: `grep "include the actual error message verbatim"` returned zero because the phrase was split across two string literals at the source-code level.
- **Fix:** Collapsed the constant to a single-line string literal in `mcp-prompt-block.ts:58`. Same runtime value, but the plan's grep regression now finds exactly one hit.
- **Files modified:** `src/manager/mcp-prompt-block.ts`
- **Verification:** `grep -n "include the actual error message verbatim" src/manager/mcp-prompt-block.ts` returns exactly 1 hit on line 58. All 10 unit tests still green after the collapse.
- **Commit:** `121a911` (Task 1 GREEN — included in the initial commit after the in-flight fix)

**2. [Rule 3 - Blocking] Legacy session-config.test.ts MCP assertions pinned the format we are removing**

- **Found during:** Task 2 GREEN regression run
- **Issue:** `src/manager/__tests__/session-config.test.ts` lines 158-162 asserted `toContain("**finnhub**")` and `toContain("\`npx -y finnhub-mcp\`")` against the legacy bullet-list output. Those assertions pin the exact format the plan explicitly removes (Pitfall 12 closure). Without an update, Task 2 GREEN would break the full regression suite.
- **Fix:** Replaced the 3 assertions with assertions against the new markdown-table format (`| finnhub | unknown |`) AND added regression pins for the removed command/args/env leak (`not.toContain(...)`). Renamed the `it` title to reflect the Pitfall 12 closure explicitly.
- **Files modified:** `src/manager/__tests__/session-config.test.ts`
- **Verification:** `npx vitest run src/manager/__tests__/session-config.test.ts` — 45/45 tests green.
- **Commit:** `7bf90d9` (Task 2 GREEN — grouped atomically with the wire-up so master never saw a red intermediate state)

**3. [Rule 2 - Missing Critical] Also updated the two "no MCP content" absence tests in the same legacy describe block**

- **Found during:** Task 2 GREEN regression review
- **Issue:** Sibling tests at lines 164-175 asserted `not.toContain("MCP servers are configured")` — the legacy phrase is gone, so these assertions would now trivially pass on any output. The tests still verified the absence behavior but did so against a string nobody was emitting anymore — pin rot.
- **Fix:** Updated both absence assertions to check for the new canonical markers: `not.toContain("MCP tools are pre-authenticated")` and `not.toContain("| Server | Status | Tools | Last Error |")`. Now the tests actually regression-pin the v2.2 empty-MCP behavior.
- **Files modified:** `src/manager/__tests__/session-config.test.ts`
- **Verification:** same run as Rule 3 #2 — both tests pass.
- **Commit:** `7bf90d9`

---

**Total deviations:** 3 auto-fixed (1 blocking + 1 blocking + 1 missing critical). **Impact:** All three were mechanical contract updates required by Pitfall 12 closure + static-grep pin discipline. Zero scope creep. The core plan (build the renderer, wire it, pin the stable-prefix placement) executed exactly as written.

### Auth Gates — None

No authentication required during execution (all work was local TypeScript + vitest).

## Issues Encountered

Pre-existing test failures in `src/manager/__tests__/bootstrap-integration.test.ts` (2 tests), `daemon-openai.test.ts` (7 tests), `session-memory-warmup.test.ts` (2 tests), and a couple of others — all failing with `memoryPath` undefined, `startOpenAiServer` not-called, and warmup-probe expectations that don't involve this plan. Confirmed pre-existing by `git stash && vitest && git stash pop` — same failures without my commits. Out of scope for Plan 85-02; logging for possible future investigation but NOT a blocker here.

## User Setup Required

None — no external service configuration needed.

## Next Phase Readiness

- Plan 85-02 + Plan 85-03 both land in Wave 2 and touch disjoint files (85-02 owns `mcp-prompt-block.ts` + `session-config.ts` + `session-manager.ts`; 85-03 owns `slash-types.ts` + `slash-commands.ts` + `cli/commands/tools.ts`). Both executed in parallel without merge conflicts.
- With TOOL-02, TOOL-05, TOOL-07 closed on the prompt-assembly side, the phantom-error class is structurally impossible from a fresh agent boot: system prompt now carries authoritative framing ("pre-authenticated"), live status ("ready"/"failed"/"unknown"), and verbatim-error wording — all in the eviction-proof stable prefix.
- Follow-up (outside phase scope): wire `q.mcpServerStatus()` to populate the Tools column with real exposed-tool names. The em-dash-placeholder was intentional in this plan to keep the scope tight.

## Known Stubs — None

No stub patterns introduced. The em-dash Tools column is a pinned placeholder with a documented migration path (Test 6 asserts the em-dash shape so the migration is visible); not a stub flowing broken data into UI.

## Self-Check: PASSED

- `[ -f src/manager/mcp-prompt-block.ts ]` → FOUND
- `[ -f src/manager/__tests__/mcp-prompt-block.test.ts ]` → FOUND
- `[ -f src/manager/__tests__/session-config-mcp.test.ts ]` → FOUND
- `git log --oneline | grep ee0e46a` → `test(85-02): add failing tests for mcp-prompt-block` FOUND
- `git log --oneline | grep 121a911` → `feat(85-02): implement mcp-prompt-block pure renderer` FOUND
- `git log --oneline | grep 4983dcb` → `test(85-02): add failing integration tests for session-config MCP block` FOUND
- `git log --oneline | grep 7bf90d9` → `feat(85-02): wire renderMcpPromptBlock into session-config + thread mcpStateProvider` FOUND
- `grep -c "The following external MCP servers are configured" src/manager/session-config.ts` → 0 (legacy leak gone)
- `grep -n "MCP tools are pre-authenticated" src/manager/mcp-prompt-block.ts` → 2 (JSDoc + constant)
- `grep -n "include the actual error message verbatim" src/manager/mcp-prompt-block.ts` → 1 (constant)
- Full targeted regression (session-config + context-assembler + session-manager + warm-path-mcp-gate + mcp-session + mcp-prompt-block + session-config-mcp): 121 tests green, 0 failures from this plan

---

*Phase: 85-mcp-tool-awareness-reliability*
*Completed: 2026-04-21*
