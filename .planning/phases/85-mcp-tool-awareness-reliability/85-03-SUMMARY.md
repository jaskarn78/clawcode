---
phase: 85-mcp-tool-awareness-reliability
plan: 03
subsystem: observability
tags: [discord, slash-commands, cli, mcp, embed-builder, control-commands, ui-01]
requires:
  - phase: 85-01
    provides: list-mcp-status IPC method, McpServerState shape, SessionManager.getMcpStateForAgent
provides:
  - /clawcode-tools Discord slash command (CONTROL_COMMANDS, daemon-routed)
  - clawcode mcp-status CLI subcommand (operator terminal parity)
  - resolveEmbedColor / formatRelativeTime module helpers (exported)
  - formatMcpStatusTable pure renderer (unit-testable)
affects:
  - future Discord slash commands consuming IPC state (pattern template)
  - Phase 87 (native CC slash commands) — Discord 100-cap accounting (now at 16/100)
tech-stack:
  added: []
  patterns:
    - "CONTROL_COMMANDS inline dispatch branch before generic handleControlCommand (EmbedBuilder vs text blob)"
    - "Module-scope helpers (STATUS_EMOJI, resolveEmbedColor, formatRelativeTime) hoisted out of class for pure unit tests"
    - "Dual-surface operator observability — same list-mcp-status IPC feeds both Discord ephemeral embed + CLI table"
    - "Verbatim lastError pass-through from Plan 01 → Plan 03 (no rewording at the UI boundary)"
key-files:
  created:
    - src/discord/__tests__/slash-commands-tools.test.ts
    - src/cli/commands/mcp-status.ts
    - src/cli/commands/__tests__/mcp-status.test.ts
  modified:
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/cli/index.ts
    - src/discord/__tests__/slash-types.test.ts
    - src/discord/__tests__/slash-commands.test.ts
key-decisions:
  - "/clawcode-tools is a CONTROL_COMMANDS entry (daemon-routed, zero LLM turn cost) with a dedicated inline dispatch branch BEFORE generic handleControlCommand — required because the generic dispatcher renders replies as text blobs, but UI-01 demands a native Discord EmbedBuilder for the status view."
  - "CLI command name deviation: shipped as `clawcode mcp-status` (not `clawcode tools` as plan wrote) because `src/cli/commands/tools.ts` is already occupied by Phase 55's per-tool call latency command (p50/p95/p99 SLO reporting). Using `tools` would have deleted a shipped feature. `mcp-status` parallels the existing `mcp-servers` command and keeps the MCP-subsystem namespace coherent."
  - "EmbedBuilder (not StringSelectMenuBuilder) because the surface is informational, not interactive — a select-menu would imply the operator picks one server to act on. Ephemeral (not public) so per-agent state doesn't leak to channel observers."
  - "Discord reply is always ephemeral — per-agent MCP state could reveal which servers are down to passive channel observers who don't need that info. Operator-only by default; explicit sharing is a conscious action (copy-paste)."
  - "Server field name carries the status emoji prefix + (optional) suffix only when the server is NOT ready — a ready optional MCP doesn't need the annotation. Operator cares about 'what's down, and does it matter?'"
  - "CLI --agent is REQUIRED (not optional with fallback) — there's no channel binding to infer from in a terminal. Matches `clawcode start -a <name>` pattern on other agent-targeted subcommands."
  - "Shared verbatim-error pass-through from Plan 01's McpServerState.lastError through both surfaces — tests pin 'Failed to start: ENOENT' character-for-character in embed field value AND CLI table cell. No rewording, no wrapping anywhere in the UI path."
  - "Pitfall 9 closure: pre-flight count assertion `CONTROL_COMMANDS.length + DEFAULT_SLASH_COMMANDS.length <= 90` in test file — guards future additions against the Discord 100-per-guild cap. Current count after Plan 03: 16 / 100."
  - "Pitfall 12 closure: neither surface exposes `command`, `args`, or `env` fields — only readiness state (name/status/lastSuccess/failureCount/lastError). MCP env secrets cannot leak through this observability path."
patterns-established:
  - "Inline CONTROL_COMMANDS dispatch: when a command needs a non-text reply (EmbedBuilder, button row), branch before the generic handleControlCommand and render the rich element directly. Generic dispatcher stays text-only."
  - "Dual operator surface: one IPC method (list-mcp-status) feeds both the Discord ephemeral UI and the CLI table. Single source of truth, two renderers."
requirements-completed:
  - TOOL-06
  - UI-01
duration: 20min
completed: 2026-04-21
---

# Phase 85 Plan 03: /clawcode-tools + mcp-status Summary

**`/clawcode-tools` Discord slash command (EmbedBuilder, CONTROL_COMMANDS, daemon-routed) + `clawcode mcp-status` CLI subcommand — both consume Plan 01's list-mcp-status IPC to show per-agent MCP readiness (ready / degraded / failed / reconnecting / unknown) with verbatim lastError pass-through.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-21T20:04:00Z
- **Completed:** 2026-04-21T20:24:00Z
- **Tasks:** 2 (TDD, each RED→GREEN)
- **Files created:** 3 (1 test + 1 source + 1 test)
- **Files modified:** 5 (slash-types, slash-commands, cli/index, 2 existing test files for count updates)

## Accomplishments

- `/clawcode-tools` Discord slash: CONTROL_COMMANDS entry routing to `list-mcp-status` IPC, rendering ephemeral EmbedBuilder with per-server fields (emoji prefix + `(optional)` suffix + last-success relative time + failures count + verbatim lastError)
- `clawcode mcp-status --agent <name>` CLI subcommand: 6-column aligned table (AGENT / SERVER / STATUS / LAST SUCCESS / FAILURES / LAST ERROR); same IPC, same semantics, terminal-friendly
- Channel-bound inference for the Discord path: omitted `agent` option falls back to `getAgentForChannel()` — ephemeral error when both are missing (no IPC call spent)
- TOOL-04 end-to-end pass-through pinned on both surfaces: `Failed to start: ENOENT` asserted character-for-character in both the Discord embed field value and the CLI table cell
- Pitfall 9 closure: pre-flight count assertion locks the Discord 100-per-guild cap at ≤90 (current: 16)
- Pitfall 12 closure: no `command`/`args`/`env` fields in either surface — MCP env secrets cannot leak through observability

## Task Commits

TDD execution — each task ships a RED test commit and a GREEN implementation commit.

1. **Task 1: `/clawcode-tools` Discord slash command (CONTROL_COMMANDS entry + inline EmbedBuilder handler + tests)**
   - `019b3a3` — `test(85-03): add failing tests for /clawcode-tools Discord slash command` (RED)
   - `c83fe24` — `feat(85-03): /clawcode-tools Discord slash command (TOOL-06 / UI-01)` (GREEN)
2. **Task 2: `clawcode mcp-status` CLI subcommand (operator terminal parity)**
   - `7e68b44` — `test(85-03): add failing tests for clawcode mcp-status CLI subcommand` (RED)
   - `38c5855` — `feat(85-03): clawcode mcp-status CLI subcommand (operator terminal parity)` (GREEN)

**Plan metadata commit:** pending (this SUMMARY + STATE + ROADMAP update).

## Files Created/Modified

### Created

- `src/discord/__tests__/slash-commands-tools.test.ts` — 10 tests (CONTROL_COMMANDS shape, Pitfall 9 count cap, empty-servers ephemeral reply, populated EmbedBuilder with 3 status tiers, verbatim lastError pass-through, channel-inference, ephemeral error on unbound channel, optional `(optional)` suffix, `last success: never` when `lastSuccessAt === null`).
- `src/cli/commands/mcp-status.ts` — 168 lines. Exports `McpStatusServer`, `McpStatusResponse`, `formatMcpStatusTable` (pure), `registerMcpStatusCommand`. Mirrors `mcp-servers.ts` shape line-for-line (same imports, same error handling).
- `src/cli/commands/__tests__/mcp-status.test.ts` — 7 tests on the pure formatter + commander registration.

### Modified

- `src/discord/slash-types.ts` — appended `clawcode-tools` CONTROL_COMMANDS entry with `ipcMethod: "list-mcp-status"` + optional string `agent` option.
- `src/discord/slash-commands.ts` — imported `EmbedBuilder`; added module-scope helpers (`STATUS_EMOJI`, `resolveEmbedColor`, `formatRelativeTime`, `ToolsIpcServer`/`ToolsIpcResponse` types); inserted inline dispatch branch (`if (commandName === "clawcode-tools") { await this.handleToolsCommand(...); return; }`) BEFORE the generic `handleControlCommand` dispatch; implemented the private `handleToolsCommand` method (agent resolution → defer ephemeral → IPC call → empty-server short-circuit → EmbedBuilder assembly with per-server fields → editReply).
- `src/cli/index.ts` — imported `registerMcpStatusCommand`; invoked alongside `registerMcpServersCommand`.
- `src/discord/__tests__/slash-types.test.ts` — bumped `CONTROL_COMMANDS.length` assertion 7 → 8; added `"list-mcp-status"` to validMethods list.
- `src/discord/__tests__/slash-commands.test.ts` — bumped combined `DEFAULT + CONTROL` count 15 → 16.

## Decisions Made

See `key-decisions` in frontmatter for the full list. Highlights:

- **CONTROL_COMMANDS + inline dispatch branch:** the generic `handleControlCommand` renders replies as text blobs. UI-01 demands a native Discord EmbedBuilder, so `/clawcode-tools` gets a dedicated branch in `handleInteraction` that runs BEFORE the generic control-dispatch. The command is still a CONTROL_COMMANDS entry (registered through the same loop, respected by the 100-cap guard, daemon-routed via the same IPC pattern) — the inline branch just owns the rendering.
- **`clawcode mcp-status` CLI name (plan specified `clawcode tools`):** the plan author didn't realize `src/cli/commands/tools.ts` already exists (Phase 55 — per-tool call latency with p50/p95/p99 SLO reporting). Using the `tools` name would have replaced the Phase 55 feature. `mcp-status` parallels the existing `mcp-servers` CLI and stays in the MCP-subsystem namespace without feature-loss. The Discord slash stays `/clawcode-tools` as planned — the Discord command-name space is independent of the CLI subcommand-name space.
- **Ephemeral Discord reply:** per-agent state (which servers are down, which are optional) is operator-only information. Non-ephemeral would leak this to passive channel observers.
- **CLI `--agent` required (no fallback):** the terminal has no channel binding to infer from. Matches existing `clawcode start -a <name>` convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] CLI command name collision with Phase 55 `tools`**

- **Found during:** Task 2 setup (before RED tests)
- **Issue:** Plan called for `clawcode tools` CLI subcommand, but `src/cli/commands/tools.ts` already exists (Phase 55 Plan 03 — per-tool call latency with p50/p95/p99 SLO reporting) and is wired into `src/cli/index.ts` at line 41/171. Writing a new `tools.ts` would have clobbered the existing feature; using the same `program.command("tools")` would have double-registered in commander.
- **Fix:** Created `src/cli/commands/mcp-status.ts` instead and wired it as `program.command("mcp-status")`. Command reads as a status-verb subcommand of the MCP subsystem and parallels the existing `mcp-servers` CLI. The Discord slash stays `/clawcode-tools` as the plan wrote (Discord command-name space is independent).
- **Files modified:** Created `src/cli/commands/mcp-status.ts` + `src/cli/commands/__tests__/mcp-status.test.ts`; wired via `src/cli/index.ts`.
- **Verification:** `npx vitest run src/cli/commands/__tests__/` — all 261 CLI tests green, including Phase 55's `tools.test.ts` (preserved).
- **Committed in:** `7e68b44` (RED) + `38c5855` (GREEN).

**2. [Rule 1 — Bug] Pre-existing test count assertions broke after adding the 8th CONTROL_COMMANDS entry**

- **Found during:** Task 1 GREEN phase (after adding `clawcode-tools` to CONTROL_COMMANDS, ran full discord test suite)
- **Issue:** Two pre-existing tests hardcoded the CONTROL_COMMANDS length (7) and the combined DEFAULT+CONTROL count (15) as invariants. Adding the new entry correctly flipped them to 8 and 16 respectively, failing the assertions.
- **Fix:** Updated `src/discord/__tests__/slash-types.test.ts` to expect 8 and added `"list-mcp-status"` to the `validMethods` list; updated `src/discord/__tests__/slash-commands.test.ts` to expect 16 on the combined count line. Mechanical, no semantic change.
- **Files modified:** `src/discord/__tests__/slash-types.test.ts`, `src/discord/__tests__/slash-commands.test.ts`.
- **Verification:** 64 discord tests green.
- **Committed in:** `c83fe24` (bundled with the Task 1 GREEN commit).

---

**Total deviations:** 2 auto-fixed (1 blocking naming collision, 1 mechanical count-update).
**Impact on plan:** Zero scope creep; zero feature loss. The CLI name change preserves Phase 55's `tools` feature while still shipping the operator-terminal parity the plan mandated. The count updates were mandatory — existing tests were asserting pre-Plan-03 invariants.

## Issues Encountered

- One flaky test observed during broader regression sweeps: `src/cli/commands/__tests__/migrate-openclaw-complete.test.ts > Phase 82 Plan 02 — complete subcommand > SC-3` failed once under high concurrency (running 19 test files in parallel), passed every subsequent run including when isolated. Pre-existing flake unrelated to this plan's changes — not introduced by Plan 03.

## Observability Chain (post-Phase-85)

Three operator surfaces now share Plan 01's `list-mcp-status` state map:

1. **System prompt (Plan 02):** `renderMcpPromptBlock` embeds the live tool-status table in the agent's stable prefix — the agent sees what's actually ready at turn start.
2. **Discord slash (Plan 03):** `/clawcode-tools` — ephemeral EmbedBuilder with color-coded per-server fields. Zero LLM turn cost. Works from any agent-bound channel.
3. **CLI (Plan 03):** `clawcode mcp-status --agent <name>` — same data, 6-column aligned table, terminal-friendly. Works when Discord is unavailable (dashboard debugging, SSH into server, etc.).

All three surfaces read the SAME in-memory map populated by the warm-path gate + `mcp-reconnect` heartbeat. Single source of truth; three renderers.

## User Setup Required

None. No environment variables, no dashboard changes. The command ships live the moment `clawcode-tools` appears in a guild's slash-command registration (happens automatically on next daemon start via the existing bulk PUT to Discord REST).

Optional post-ship manual smoke (once daemon is running):

```bash
clawcode mcp-status --agent clawdy
# Expect 6-column table with per-server readiness rows.
```

In Discord (in an agent-bound channel):

```
/clawcode-tools
# Expect ephemeral embed titled "MCP Tools · <agent>" with per-server fields.
```

## Next Phase Readiness

- Phase 85 is complete (all 3 plans shipped).
- TOOL-01/02/03/04/05/06/07 + UI-01 all satisfied by the phase.
- Phase 85 unblocks the phantom-error user report: operator can now run `/clawcode-tools` and see `1password: ready · last success 12s ago · 0 failures` to catch agents confabulating MCP misconfiguration.

## Known Stubs

None — scanned all created + modified files for `TODO`/`FIXME`/`placeholder`/`coming soon`/`not available`/empty returns; only matches are pre-existing code in unrelated helpers (`formatCommandMessage`'s placeholder-substitution variable name).

## Self-Check: PASSED

Files verified on disk:
- `src/discord/__tests__/slash-commands-tools.test.ts` — FOUND
- `src/cli/commands/mcp-status.ts` — FOUND
- `src/cli/commands/__tests__/mcp-status.test.ts` — FOUND
- `src/discord/slash-types.ts` — FOUND (modified)
- `src/discord/slash-commands.ts` — FOUND (modified)
- `src/cli/index.ts` — FOUND (modified)
- `.planning/phases/85-mcp-tool-awareness-reliability/85-03-SUMMARY.md` — FOUND

Commits verified in git history:
- `019b3a3` — test RED (Task 1) — FOUND
- `c83fe24` — feat GREEN (Task 1) — FOUND
- `7e68b44` — test RED (Task 2) — FOUND
- `38c5855` — feat GREEN (Task 2) — FOUND

---
*Phase: 85-mcp-tool-awareness-reliability*
*Plan: 03*
*Completed: 2026-04-21*
