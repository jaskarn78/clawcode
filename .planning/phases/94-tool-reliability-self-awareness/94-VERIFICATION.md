---
phase: 94-tool-reliability-self-awareness
verified: 2026-04-25T06:22:37Z
status: gaps_found
score: 9/12 must-haves verified
gaps:
  - truth: "On agent boot, probeAllMcpCapabilities runs in parallel for every configured MCP server"
    status: partial
    reason: "No boot-time probe invocation found. HeartbeatRunner uses setInterval only — first probe fires 60s after start, not at boot. The on-demand mcp-probe IPC exists, but the plan's truth specifies boot-time execution."
    artifacts:
      - path: "src/heartbeat/runner.ts"
        issue: "start() uses setInterval — no immediate first tick at agent boot"
      - path: "src/manager/session-manager.ts"
        issue: "startAgent() does not call probeAllMcpCapabilities"
      - path: "src/manager/daemon.ts"
        issue: "Daemon startup sequence has no probeAllMcpCapabilities call"
    missing:
      - "Call probeAllMcpCapabilities on agent start (e.g., in startAgent or as a fire-and-forget in HeartbeatRunner.start())"

  - truth: "callTool is wired for real MCP calls in capability probe and mcp-probe IPC"
    status: failed
    reason: "daemon.ts mcp-probe IPC uses stub callTool that throws 'callTool not yet wired (Plan 94-03 picks this up)'. heartbeat mcp-reconnect.ts also uses stub callTool. Real tool invocation is deferred."
    artifacts:
      - path: "src/manager/daemon.ts"
        issue: "Line 4364-4367: callTool stub throws — probe always falls back to listTools default, never exercises real MCP tool calls"
      - path: "src/heartbeat/checks/mcp-reconnect.ts"
        issue: "stubDeps with synthetic callTool (not real MCP callTool) — probe does not verify actual tool execution"
    missing:
      - "Wire real callTool from Claude Agent SDK at the daemon edge (Plan 94-03 deferred item)"

  - truth: "Tools work end-to-end: clawcode_fetch_discord_messages returns N messages; clawcode_share_file returns CDN URL"
    status: failed
    reason: "clawcodeFetchDiscordMessages and clawcodeShareFile handler functions are defined but never called from non-test code. No production wiring of deps (fetchMessages, sendViaWebhook, stat) exists anywhere in the codebase. Tools are advertised in system prompt text only — agents see the tool names in the prompt but cannot actually execute them."
    artifacts:
      - path: "src/manager/tools/clawcode-fetch-discord-messages.ts"
        issue: "Handler function defined but no production wiring — clawcodeFetchDiscordMessages() is never called outside tests"
      - path: "src/manager/tools/clawcode-share-file.ts"
        issue: "Handler function defined but no production wiring — clawcodeShareFile() is never called outside tests"
      - path: "src/manager/session-config.ts"
        issue: "Only adds tool names to toolDefinitionsStr (system prompt text) — not registered as SDK-callable tool definitions with dispatch handlers"
    missing:
      - "Register tool definitions in SDK tool slot (input_schema arrays) so the LLM can actually call them"
      - "Wire production deps: fetchMessages → discord.js client.channels.fetch; sendViaWebhook → webhook-manager; stat → fs.promises.stat"
      - "Wire tool dispatch handler in daemon/session-adapter so tool_use events for clawcode_fetch/share reach the handler functions"
human_verification:
  - test: "Verify /clawcode-tools select-menu pagination behavior at 25+ servers"
    expected: "Embed shows first 25 servers with note 'Showing first 25 of N servers'; subsequent servers not visible in initial render"
    why_human: "Requires a live Discord environment with 25+ MCP servers configured"
  - test: "Verify capability probe status emojis render correctly in /clawcode-tools embed"
    expected: "ready=✅, degraded=🟡, failed=🔴, reconnecting=⏳, unknown=❓ appear in embed fields"
    why_human: "Requires live Discord bot with /clawcode-tools slash command registered"
---

# Phase 94: Tool Reliability Self-Awareness Verification Report

**Phase Goal:** Eliminate the class of bugs where agents confidently advertise capabilities (tools, MCP-backed features) that fail at execution time. Every tool an agent claims to have must be probed-as-actually-working at boot/heartbeat, and tools whose backing infrastructure is currently broken must be filtered out of the system prompt so the LLM never promises what it can't deliver. Adds default Discord thread-message fetcher + file-sharing-via-Discord-URL helpers for cross-agent UX consistency.

**Verified:** 2026-04-25T06:22:37Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                              | Status      | Evidence                                                                                     |
|----|---------------------------------------------------------------------------------------------------|-------------|----------------------------------------------------------------------------------------------|
| 1  | CapabilityProbeStatus 5-value enum exists and drives probe outcomes                               | VERIFIED    | `src/manager/persistent-session-handle.ts` exports `CapabilityProbeStatus` + `CapabilityProbeSnapshot`; 5 literals confirmed (≥5 matches) |
| 2  | probeMcpCapability / probeAllMcpCapabilities DI-pure primitives with 10s timeout                  | VERIFIED    | `src/manager/capability-probe.ts` 211 lines; PROBE_TIMEOUT_MS=10_000; no SDK/fs imports; parallel-independence pinned |
| 3  | 13-entry PROBE_REGISTRY with vaults_list, AAPL, SELECT 1, browser_snapshot D-01 shapes            | VERIFIED    | `src/manager/capability-probes.ts` 258 lines; 13 r.set() calls; all D-01 literals confirmed |
| 4  | On agent boot, probeAllMcpCapabilities runs for every MCP server                                  | PARTIAL     | Heartbeat runs at 60s intervals via setInterval only — no boot-time invocation in startAgent/daemon startup |
| 5  | Heartbeat tick (60s mcp-reconnect) re-runs probeAllMcpCapabilities and persists results           | VERIFIED    | `src/heartbeat/checks/mcp-reconnect.ts` imports and calls probeAllMcpCapabilities; capabilityProbe fields written to McpServerState |
| 6  | clawcode mcp-probe CLI + daemon mcp-probe IPC for on-demand triggering                            | VERIFIED    | `src/cli/commands/mcp.ts` has mcp-probe subcommand; daemon.ts has `case "mcp-probe"` handler |
| 7  | callTool is wired for real MCP calls (not stub)                                                   | FAILED      | daemon.ts mcp-probe handler uses stub callTool that throws "not yet wired (Plan 94-03 picks this up)" |
| 8  | filterToolsByCapabilityProbe filters degraded/failed/unknown tools from LLM stable prefix         | VERIFIED    | `src/manager/filter-tools-by-capability-probe.ts` 215 lines; FLAP_WINDOW_MS=5min; FLAP_TRANSITION_THRESHOLD=3; single call site in session-config.ts |
| 9  | Recovery handlers: playwright-chromium, op-refresh, subprocess-restart wired in heartbeat         | VERIFIED    | `src/manager/recovery/` 5 modules; registry.ts has RECOVERY_REGISTRY; mcp-reconnect.ts calls runRecoveryForServer; bounded 3/hr + adminAlert |
| 10 | ToolCallError 5-value ErrorClass + wrapMcpToolError + TurnDispatcher wrapping                     | VERIFIED    | `src/manager/tool-call-error.ts` 153 lines (below 180 min but all key exports present); TurnDispatcher.executeMcpTool calls wrapMcpToolError |
| 11 | clawcode_fetch_discord_messages + clawcode_share_file work end-to-end                             | FAILED      | Tool handler functions defined but NOT wired in production — no dispatch from daemon/session to the handlers; system prompt text only |
| 12 | defaults.systemPromptDirectives + /clawcode-tools + mcp-status CLI surface upgrades               | VERIFIED    | schema.ts has systemPromptDirectives; loader.ts has resolveSystemPromptDirectives; assembler integrates; slash-commands.ts has capabilityProbe column + findAlternativeAgents; mcp-status.ts has capabilityProbe column |

**Score:** 9/12 truths verified

---

## Required Artifacts

| Artifact                                                           | Min Lines | Actual | Status     | Details                                                                         |
|-------------------------------------------------------------------|-----------|--------|------------|---------------------------------------------------------------------------------|
| `src/manager/capability-probe.ts`                                  | 180       | 211    | VERIFIED   | DI-pure; PROBE_TIMEOUT_MS=10_000; probeMcpCapability + probeAllMcpCapabilities exported |
| `src/manager/capability-probes.ts`                                 | 220       | 258    | VERIFIED   | 13 registry entries; all D-01 probe shapes present                              |
| `src/manager/__tests__/capability-probe.test.ts`                   | 280       | 256    | STUB (lines)| 10 it() blocks pass; PT-PARALLEL-INDEPENDENCE + PT-4 sentinel pins present; 24 lines under min |
| `src/manager/persistent-session-handle.ts (EXTEND)`                | —         | —      | VERIFIED   | CapabilityProbeStatus + CapabilityProbeSnapshot exported; capabilityProbe?: additive-optional |
| `src/heartbeat/checks/mcp-reconnect.ts (EXTEND)`                   | —         | —      | VERIFIED   | probeAllMcpCapabilities called after connect-test; results persisted via setMcpState |
| `src/manager/daemon.ts (EXTEND)`                                   | —         | —      | PARTIAL    | list-mcp-status includes capabilityProbe; mcp-probe IPC exists but callTool is stubbed |
| `src/cli/commands/mcp.ts (EXTEND)`                                 | —         | —      | VERIFIED   | mcp-probe subcommand registered                                                  |
| `src/manager/filter-tools-by-capability-probe.ts`                  | 180       | 215    | VERIFIED   | filterToolsByCapabilityProbe pure; Object.freeze; FLAP_WINDOW_MS=5min; FLAP_TRANSITION_THRESHOLD=3 |
| `src/manager/__tests__/filter-tools-by-capability-probe.test.ts`   | 240       | 310    | VERIFIED   | 13 it() blocks; FT-FLAP-STABILITY; FT-RECONNECTING; FT-UNKNOWN present          |
| `src/manager/recovery/types.ts`                                    | 90        | 125    | VERIFIED   | RecoveryOutcome 4-variant union; MAX_ATTEMPTS_PER_HOUR=3; ATTEMPT_WINDOW_MS=1hr |
| `src/manager/recovery/registry.ts`                                 | 200       | 178    | STUB (lines)| All key functions present; 22 lines under min; RECOVERY_REGISTRY + runRecoveryForServer + adminAlert |
| `src/manager/recovery/playwright-chromium.ts`                      | 90        | 75     | STUB (lines)| Core behavior present (npx playwright install, execFile, RecoveryOutcome); 15 lines under min |
| `src/manager/recovery/op-refresh.ts`                               | 130       | 96     | STUB (lines)| Core behavior present; 34 lines under min                                       |
| `src/manager/recovery/subprocess-restart.ts`                       | 90        | 68     | STUB (lines)| Core behavior present (5-min threshold, killSubprocess); 22 lines under min     |
| `src/manager/tool-call-error.ts`                                   | 180       | 153    | STUB (lines)| ErrorClass 5 values; wrapMcpToolError; classifyToolError all present; 27 lines under min |
| `src/manager/find-alternative-agents.ts`                           | 90        | 93     | VERIFIED   | findAlternativeAgents pure function; reads capabilityProbe.status                |
| `src/manager/__tests__/tool-call-error.test.ts`                    | 200       | 230    | VERIFIED   | 29 it() blocks across 2 test files                                               |
| `src/manager/tools/clawcode-fetch-discord-messages.ts`             | 130       | 141    | ORPHANED   | Handler function exists and is DI-pure; NOT wired in production dispatch         |
| `src/manager/tools/clawcode-share-file.ts`                         | 200       | 250    | ORPHANED   | Handler function exists; security boundary + 25MB cap correct; NOT wired in production |
| `src/manager/__tests__/clawcode-fetch-discord-messages.test.ts`    | 180       | 126    | STUB (lines)| 5 it() blocks (plan specifies 5); 54 lines under min                             |
| `src/manager/__tests__/clawcode-share-file.test.ts`                | 240       | 170    | STUB (lines)| 6 it() blocks (plan specifies 6); 70 lines under min                             |
| `src/config/schema.ts (EXTEND)`                                    | 50        | —      | VERIFIED   | systemPromptDirectiveSchema; DEFAULT_SYSTEM_PROMPT_DIRECTIVES with file-sharing + cross-agent-routing |
| `src/config/loader.ts (EXTEND)`                                    | 60        | —      | VERIFIED   | resolveSystemPromptDirectives exported at line 562                               |
| `src/manager/context-assembler.ts (EXTEND)`                        | —         | —      | VERIFIED   | systemPromptDirectives prepended to stable prefix before tool block              |
| `src/discord/slash-commands.ts (EXTEND)`                           | —         | —      | VERIFIED   | capabilityProbe column; findAlternativeAgents; paginateRows at EMBED_LINE_CAP=25 |
| `src/cli/commands/mcp-status.ts (EXTEND)`                          | —         | —      | VERIFIED   | capabilityProbe column; CLI parity with Discord embed                            |

---

## Key Link Verification

| From                                        | To                                                 | Via                                 | Status      | Details                                                                  |
|---------------------------------------------|----------------------------------------------------|-------------------------------------|-------------|--------------------------------------------------------------------------|
| `mcp-reconnect.ts`                          | `capability-probe.ts probeAllMcpCapabilities`       | Import + invoke after connect-test   | VERIFIED    | grep confirms call at line 365                                            |
| `mcp-reconnect.ts`                          | `recovery/registry.ts runRecoveryForServer`         | Import + invoke for degraded servers | VERIFIED    | grep confirms runRecoveryForServer called                                 |
| `capability-probe.ts`                       | `persistent-session-handle.ts setMcpState`          | deps.setMcpState() with capabilityProbe | VERIFIED | deps-based DI; production wires setMcpState at heartbeat edge            |
| `daemon.ts list-mcp-status`                 | `SessionHandle.getMcpState()`                       | Reads capabilityProbe field           | VERIFIED    | capabilityProbe in list-mcp-status payload at line 4312                  |
| `daemon.ts mcp-probe IPC`                   | `probeAllMcpCapabilities`                           | Dynamic import + call                 | PARTIAL     | Calls probeAllMcpCapabilities but with stub callTool — real MCP calls not exercised |
| `cli/commands/mcp.ts mcp-probe`             | `ipcClient.send method=mcp-probe`                   | IPC send                              | VERIFIED    | mcp-probe subcommand confirmed in mcp.ts                                  |
| `session-config.ts`                         | `filter-tools-by-capability-probe.ts`               | Single-source filterToolsByCapabilityProbe | VERIFIED | Confirmed in session-config.ts at line 403; NOT in assembler/prompt-block |
| `turn-dispatcher.ts`                        | `tool-call-error.ts wrapMcpToolError`               | catch block in executeMcpTool         | VERIFIED    | wrapMcpToolError called in executeMcpTool                                 |
| `slash-commands.ts /clawcode-tools`         | `findAlternativeAgents`                             | daemon-computed alternatives field    | VERIFIED    | daemon.ts computes alternatives via findAlternativeAgents; slash-commands reads IPC payload |
| `session-config.ts`                         | `tools/clawcode-fetch-discord-messages.ts`          | Import + advertise in toolDefinitionsStr | PARTIAL | Imported and mentioned in system prompt text; NOT registered as callable SDK tool with handler |
| `session-config.ts`                         | `tools/clawcode-share-file.ts`                      | Import + advertise in toolDefinitionsStr | PARTIAL | Same as above — system prompt text only, no production dispatch wiring     |
| `context-assembler.ts`                      | `resolveSystemPromptDirectives`                     | Prepend to stable prefix              | VERIFIED    | systemPromptDirectives prepended at assembler line 711                   |

---

## Data-Flow Trace (Level 4)

| Artifact                        | Data Variable         | Source                              | Produces Real Data | Status        |
|--------------------------------|-----------------------|-------------------------------------|-------------------|---------------|
| `mcp-reconnect.ts heartbeat`   | probeResults Map       | probeAllMcpCapabilities (stub callTool) | No (stubbed)     | STATIC — stub callTool always falls to listTools default-fallback; no real MCP tool invoked |
| `slash-commands.ts /clawcode-tools` | mcpState entries   | list-mcp-status IPC payload          | Yes (from getMcpState) | FLOWING — real state from SessionHandle |
| `session-config.ts toolDefinitionsStr` | tool descriptions | tool module DEF constants         | Yes (constants)    | FLOWING — DEF names/descriptions reach system prompt |
| `clawcode-fetch-discord-messages.ts` | messages array   | deps.fetchMessages (never wired)     | No                | DISCONNECTED — handler defined but no caller in prod code |
| `clawcode-share-file.ts`        | url string            | deps.sendViaWebhook (never wired)    | No                | DISCONNECTED — handler defined but no caller in prod code |

---

## Behavioral Spot-Checks

| Behavior                                         | Command / Check                                                                 | Result                                    | Status  |
|--------------------------------------------------|---------------------------------------------------------------------------------|-------------------------------------------|---------|
| All 148 phase-94 tests pass                      | `npx vitest run [17 test files] --reporter=dot`                                 | 148 passed (17 files)                     | PASS    |
| PROBE_TIMEOUT_MS pinned at 10s                   | `grep -q "PROBE_TIMEOUT_MS = 10_000" capability-probe.ts`                       | Found                                     | PASS    |
| 13 PROBE_REGISTRY entries                        | `grep -c "r.set(" capability-probes.ts` = 13                                    | 13                                        | PASS    |
| capability-probe.ts DI-pure (no SDK/fs imports)  | No SDK or node:fs imports in capability-probe.ts                                | Confirmed                                 | PASS    |
| filterToolsByCapabilityProbe single call site     | In session-config.ts only; NOT in context-assembler.ts or mcp-prompt-block.ts  | Confirmed                                 | PASS    |
| D-12 flap window at 5min                         | `FLAP_WINDOW_MS = 5 * 60 * 1000` in filter module                               | Confirmed                                 | PASS    |
| Bounded recovery: 3/hr + adminAlert              | MAX_ATTEMPTS_PER_HOUR=3; adminAlert called at 3rd failure                       | Confirmed in registry.ts                  | PASS    |
| clawcode_share_file production wiring             | `grep -rn "clawcodeShareFile" src/ | grep -v test`                              | Only found in tools/ file itself          | FAIL    |
| Boot-time probe invocation                       | `grep -rn "probeAllMcpCapabilities" session-manager.ts daemon-entry.ts`         | Not found                                 | FAIL    |

---

## Requirements Coverage

| Requirement | Source Plan | Status   | Evidence                                                                                   |
|-------------|-------------|----------|--------------------------------------------------------------------------------------------|
| TOOL-01     | 94-01       | PARTIAL  | probeMcpCapability exists; boot-time invocation missing; callTool stub means real calls never fire |
| TOOL-02     | 94-01       | VERIFIED | 13-entry PROBE_REGISTRY with correct D-01 probe shapes; default-fallback for unknown servers |
| TOOL-03     | 94-02       | VERIFIED | filterToolsByCapabilityProbe pure function; single call site; D-12 flap-stability; 13 tests pass |
| TOOL-04     | 94-03       | PARTIAL  | playwrightChromiumHandler exists with execFile pattern; but real callTool not wired means degraded detection is incomplete |
| TOOL-05     | 94-03       | VERIFIED | opRefreshHandler exists; matches op:// auth errors; recover() re-runs op read                |
| TOOL-06     | 94-03       | VERIFIED | subprocessRestartHandler exists; 5-min degraded threshold; killSubprocess DI                 |
| TOOL-07     | 94-04       | VERIFIED | ToolCallError schema; ErrorClass 5-value enum; wrapMcpToolError; TurnDispatcher.executeMcpTool wraps rejections |
| TOOL-08     | 94-05       | PARTIAL  | clawcodeFetchDiscordMessages defined; system prompt advertises it; no production dispatch wiring |
| TOOL-09     | 94-05       | PARTIAL  | clawcodeShareFile defined; security boundary + 25MB cap correct; no production dispatch wiring |
| TOOL-10     | 94-06       | VERIFIED | systemPromptDirectives schema + resolver + assembler integration; file-sharing + cross-agent-routing defaults shipped |
| TOOL-11     | 94-07       | VERIFIED | /clawcode-tools embed with capabilityProbe column + STATUS_EMOJI; mcp-status CLI parity; paginateRows at EMBED_LINE_CAP=25 |
| TOOL-12     | 94-07       | VERIFIED | findAlternativeAgents wired in daemon list-mcp-status; alternatives field in IPC payload; slash-commands renders "Healthy alternatives" line |

---

## Anti-Patterns Found

| File                                                | Line       | Pattern                                    | Severity | Impact                                                                |
|-----------------------------------------------------|------------|--------------------------------------------|----------|-----------------------------------------------------------------------|
| `src/manager/daemon.ts`                             | 4364-4367  | callTool stub throws — not real wiring     | WARNING  | mcp-probe IPC always uses listTools fallback; capability probe never verifies actual tool execution |
| `src/manager/tools/clawcode-fetch-discord-messages.ts` | All     | Handler defined but never called from prod  | BLOCKER  | TOOL-08 end-to-end truth fails; tool advertised in prompt but not executable |
| `src/manager/tools/clawcode-share-file.ts`         | All        | Handler defined but never called from prod  | BLOCKER  | TOOL-09 end-to-end truth fails; tool advertised in prompt but not executable |
| `src/manager/__tests__/capability-probe.test.ts`   | —          | 256 lines vs. plan's 280 min (24 short)    | INFO     | Plan min_lines not met; 10 it() blocks all pass — functionally adequate |
| Multiple recovery modules                           | —          | Below plan min_lines (registry 178/200, playwright 75/90, op-refresh 96/130, subprocess 68/90) | INFO | All key behaviors present; line counts are targets not hard requirements |
| `src/manager/tool-call-error.ts`                    | —          | 153 lines vs. plan's 180 min (27 short)    | INFO     | All key exports present; functionally complete despite lower line count |
| `src/manager/__tests__/clawcode-*.test.ts`         | —          | 126/180 lines and 170/240 lines under plan min | INFO  | Correct test count (5+6=11 it() blocks); tests all pass                |

---

## Human Verification Required

### 1. /clawcode-tools Pagination at 25+ Servers

**Test:** Configure more than 25 MCP servers for an agent, then run `/clawcode-tools` in Discord.
**Expected:** First 25 servers shown in embed fields with footer note "Showing first 25 of N servers (Discord embed cap)".
**Why human:** Requires live Discord environment with 25+ configured MCP servers; paginateRows logic verified in unit tests but embed rendering requires actual Discord.

### 2. Status Emoji Visual Rendering

**Test:** With servers in each of the 5 capability probe states (ready/degraded/failed/reconnecting/unknown), run `/clawcode-tools`.
**Expected:** Each server shows the correct emoji: ✅/🟡/🔴/⏳/❓.
**Why human:** STATUS_EMOJI map verified in code but Unicode emoji rendering in Discord embed requires live test.

---

## Gaps Summary

Three gaps block full goal achievement:

**Gap 1 — Boot-time probe missing (TOOL-01 partial).** The plan's truth specifies probeAllMcpCapabilities runs "on agent boot" but the implementation only runs it at the first heartbeat tick (60s after boot). An agent starts with `capabilityProbe: undefined` on all servers for the first 60 seconds. This means the filter (TOOL-03) treats all tools as unknown (filtered out) until the first tick fires — the LLM would see no MCP-backed tools for the first minute after restart.

**Gap 2 — callTool not wired (TOOL-01/04 partial).** The mcp-probe IPC and heartbeat tick both use a stub callTool that throws "not yet wired". The Plan 01 SUMMARY acknowledges this ("registry entries with real callTool wiring activate when Plan 94-03 lifts the override") but the Plan 94-03 deferred items do not record completing this wiring. All probes fall back to the listTools default-fallback, meaning the probe never actually invokes a representative MCP tool call (e.g., vaults_list, quote(AAPL), SELECT 1) — it only lists tools. This undermines the core Phase 94 promise of "actually-callable RIGHT NOW" verification.

**Gap 3 — TOOL-08/09 tools are advertised but not executable (TOOL-08/09 partial).** clawcode_fetch_discord_messages and clawcode_share_file are mentioned in the system prompt text so the LLM sees their names and descriptions, but neither handler function is wired into any production dispatch path. The AgentSessionConfig has no custom tools field, and no daemon/session-adapter code routes tool_use events for these names to the handler functions. If an agent calls clawcode_fetch_discord_messages, the SDK will not find a handler and will return an error — contradicting the "auto-injected tool list" claim.

Gaps 1 and 2 are recorded as deferred in the phase documentation and were anticipated during implementation. Gap 3 is the most impactful from a user-visible goal perspective.

---

_Verified: 2026-04-25T06:22:37Z_
_Verifier: Claude (gsd-verifier)_
