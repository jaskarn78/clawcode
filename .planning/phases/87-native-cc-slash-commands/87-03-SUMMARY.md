---
phase: 87-native-cc-slash-commands
plan: 03
subsystem: discord-dispatch+prompt-channel-carve-out
tags: [claude-agent-sdk, local_command_output, prompt-channel, turn-dispatcher, progressive-message-editor, cmd-03, cmd-06, tool-04-pattern, verbatim-error, v1.7-streaming-reuse]

# Dependency graph
requires:
  - phase: 87-native-cc-slash-commands
    plan: 01
    provides: "SlashCommandDef.nativeBehavior discriminator + buildNativeCommandDefs output flowing through register loop so `nativeBehavior='prompt-channel'` entries land on each agent's resolved slashCommands set"
  - phase: 85-mcp-tool-awareness-reliability
    plan: 03
    provides: "TOOL-04 verbatim-error-pass-through pattern (the lastError string rendered raw in /clawcode-tools embed) — applied here at the slash-command dispatch layer (editReply surfaces ACTUAL SDK error text, not a generic blob)"
  - phase: 57-turndispatcher-foundation
    provides: "TurnDispatcher.dispatchStream(origin, agent, message, onChunk) — single chokepoint Plan 03 dispatches through so origin kind='discord' + source.id=channelId propagates to the trace row"
  - phase: 54-streaming-cadence
    provides: "ProgressiveMessageEditor with editIntervalMs + Discord 2000-char truncation — REUSED verbatim (zero new streaming primitive introduced)"
provides:
  - "buildNativePromptString(commandName, args): string — canonical '/<name> <args>' format, clawcode- prefix stripped idempotently, whitespace-trimmed args, verbatim passthrough (no escaping)"
  - "findNativePromptChannelCommand — SlashCommandHandler private helper that resolves a nativeBehavior='prompt-channel' def across all resolvedAgents"
  - "dispatchNativePromptCommand — SlashCommandHandler private method mirroring the agent-routed streaming flow but substituting the canonical prompt + TurnDispatcher.dispatchStream for formatCommandMessage + sessionManager.streamFromAgent"
  - "Carve-out branch in handleInteraction between CONTROL_COMMANDS and the legacy agent-routed branch — ensures native-CC prompt-channel entries NEVER fall through to the formatCommandMessage + claudeCommand template path"
affects: [phase-88-skills-marketplace, future-sdk-additions]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps
  patterns:
    - "Dispatch-fork carve-out ordering: dedicated inline handlers (clawcode-tools/clawcode-model/CONTROL_COMMANDS) → prompt-channel carve-out → legacy agent-routed. Plans 02/03 both add branches to this ladder; ordering is a HARD invariant (stray prompt-channel entry with colliding name MUST lose to the dedicated inline handler — pinned by P4 test)."
    - "Verbatim-error-pass-through at the slash-command layer: editor.dispose on dispatchStream throw + editReply with `Command failed: ${msg}` where msg is the SDK error text unchanged. Copies Phase 85 TOOL-04's embed renderer discipline up to the interaction reply surface."
    - "Canonical prompt-string as pure helper: buildNativePromptString has zero dependencies — any caller (tests, future CLI, OpenClaw bridge replay) gets the same SDK-compatible output without importing the Discord handler."

key-files:
  created:
    - src/discord/__tests__/slash-commands-prompt-channel.test.ts
  modified:
    - src/manager/native-cc-commands.ts
    - src/manager/__tests__/native-cc-commands.test.ts
    - src/discord/slash-commands.ts

key-decisions:
  - "Prompt format strips the clawcode- prefix idempotently — the SDK's local-command dispatcher (sdk.d.ts:2475 SDKLocalCommandOutputMessage) has no knowledge of the clawcode namespace. Both `clawcode-compact` and `compact` must yield `/compact`. Pinned by the 'accepts BARE name' test."
  - "Args are passed to the SDK VERBATIM (no escape, no quote, no wrap). Over-escaping silently breaks arg passthrough; the SDK parses the entire literal after the first space against its own argument-hint grammar. Pinned by the 'does NOT escape/quote' test using quotes + brackets + $var."
  - "Empty / whitespace-only / missing args → no trailing space (`/compact`, never `/compact `). The SDK's parser treats `/compact ` and `/compact` identically in observation, but the trailing-space form prints ugly in Discord echoes and breaks strict string-match assertions."
  - "Dispatch carve-out ordering: clawcode-model → clawcode-tools → CONTROL_COMMANDS → prompt-channel → legacy agent-routed. Dedicated inline handlers ALWAYS win over a stray prompt-channel entry sharing their name (defense-in-depth — if an agent's clawcode.yaml somehow registered a prompt-channel duplicate of clawcode-tools, the tools embed still renders correctly)."
  - "dispatchNativePromptCommand reuses ProgressiveMessageEditor verbatim with editIntervalMs:1500 — matches the agent-routed flow in handleInteraction at lines ~620-700. No new streaming primitive introduced (plan requirement CMD-06)."
  - "Origin construction uses makeRootOrigin('discord', channelId) — same shape as the legacy agent-routed path. Keeps the trace row's source.id consistent whether a Discord message invoked a slash command or a direct text message."
  - "findNativePromptChannelCommand walks ALL resolvedAgents (not just the bound agent) and returns the first nativeBehavior='prompt-channel' match. Rationale: prompt-channel entries are agent-agnostic by definition (the dispatch target is the channel's bound agent, not the first agent that reported the SDK command). Scanning all agents tolerates fleet-wide dedupe that register() performs."
  - "Error text surfaces VERBATIM (`Command failed: ${msg}` where msg is err.message — no rewording). Solves the phantom-error class Phase 85 TOOL-04 fixed at the MCP layer: executor-friendly Discord UX depends on seeing the ACTUAL SDK complaint, not a generic 'command failed' blob."

patterns-established:
  - "Pure prompt-string helper as extraction point: buildNativePromptString is a single-expression function with a regex-replace + trim + ternary. Lives next to the classifier so Plans 02/03 and any future consumer share one definition of canonical dispatch format."
  - "Discord-layer verbatim error surfacing: mirrors Phase 85 TOOL-04's embed renderer pattern in the editReply call. Sets the expectation that every new native-dispatch path (Plan 88 marketplace, future CLI-bridged invocations) surfaces SDK errors unchanged."

requirements-completed: [CMD-03, CMD-06]

# Metrics
duration: 6min 12s
completed: 2026-04-21
---

# Phase 87 Plan 03: Native CC Slash Commands — Prompt-Channel Dispatch Summary

**Prompt-channel native-CC commands (`/clawcode-compact`, `/clawcode-context`, `/clawcode-cost`, `/clawcode-help`, `/clawcode-hooks`, ...) now dispatch as canonical `/<name> <args>` prompt strings through TurnDispatcher.dispatchStream; output streams via the v1.7 ProgressiveMessageEditor (zero new streaming primitive); SDK errors surface verbatim (Phase 85 TOOL-04 pattern applied at the slash-command layer).**

## Performance

- **Duration:** 6 min 12 s
- **Tasks:** 1 (TDD RED → GREEN, committed separately)
- **Files changed:** 3 modified, 1 created
- **Tests:** 50 GREEN across 2 test files (42 native-cc-commands + 8 prompt-channel integration; net +19 new tests over pre-plan baseline — 11 buildNativePromptString + 8 dispatchNativePromptCommand)
- **TSC:** Zero new errors in Plan 03's touched files (verified via `grep -E "native-cc-commands|slash-commands|prompt-channel"` against tsc output — empty match)

## What landed

### Task 1 — buildNativePromptString helper + carve-out dispatch (commits 9c7e643 RED, 44e9374 GREEN)

1. `src/manager/native-cc-commands.ts` — appended `buildNativePromptString(commandName, args)`:
   ```ts
   export function buildNativePromptString(
     commandName: string,
     args: string | undefined,
   ): string {
     const bare = commandName.replace(/^clawcode-/, "");
     const trimmed = (args ?? "").trim();
     return trimmed.length > 0 ? `/${bare} ${trimmed}` : `/${bare}`;
   }
   ```
2. `src/discord/slash-commands.ts` — added:
   - Import of `buildNativePromptString` from native-cc-commands.
   - Carve-out branch in `handleInteraction` (after CONTROL_COMMANDS, before legacy agent-routed):
     ```ts
     const nativeDef = this.findNativePromptChannelCommand(commandName);
     if (nativeDef) {
       await this.dispatchNativePromptCommand(interaction, nativeDef);
       return;
     }
     ```
   - Private method `findNativePromptChannelCommand(name)` — walks `resolvedAgents` + `resolveAgentCommands` to find the first `nativeBehavior === "prompt-channel"` match.
   - Private method `dispatchNativePromptCommand(interaction, cmd)` — mirrors the agent-routed streaming flow with `TurnDispatcher.dispatchStream` substituting for `sessionManager.streamFromAgent` and `buildNativePromptString` substituting for `formatCommandMessage`. Editor creation, truncation, and empty-response handling are byte-identical to the legacy flow.
3. `src/manager/__tests__/native-cc-commands.test.ts` — 11 new tests for `buildNativePromptString` (prefix strip, whitespace trim, verbatim args, no-over-escaping, bare-name acceptance).
4. `src/discord/__tests__/slash-commands-prompt-channel.test.ts` — NEW 8-test integration suite (P1-P8) exercising the carve-out end-to-end with stubbed TurnDispatcher + stubbed Discord interaction mocks.

## End-to-end dispatch trace — `/clawcode-compact`

| Step | Layer | What happens |
| ---- | ----- | ------------ |
| 1    | SDK enumeration (Plan 01) | Agent's `SessionHandle.getSupportedCommands()` via `Query.initializationResult()` reports `{name:"compact", description:"Clear conversation history but keep a summary in context", argumentHint:""}` |
| 2    | Classification (Plan 01)  | `classifyCommand("compact")` → `"prompt-channel"` (default for non-setter commands per CMD-00 spike) |
| 3    | Registration (Plan 01)    | `buildNativeCommandDefs` emits `{name:"clawcode-compact", nativeBehavior:"prompt-channel", options:[]}`; `register()` uploads it via Discord REST |
| 4    | User invocation           | User types `/clawcode-compact` in Discord; Discord calls the bot's `interactionCreate` event |
| 5    | Carve-out (Plan 03)       | `handleInteraction` walks: clawcode-model → clawcode-tools → CONTROL_COMMANDS → `findNativePromptChannelCommand("clawcode-compact")` matches → `dispatchNativePromptCommand(interaction, def)` |
| 6    | Prompt builder (Plan 03)  | `buildNativePromptString("clawcode-compact", undefined)` → `"/compact"` |
| 7    | TurnDispatcher            | `turnDispatcher.dispatchStream(origin=makeRootOrigin("discord", channelId), agent="clawdy", message="/compact", onChunk)` — opens Turn + threads origin + calls SessionManager.streamFromAgent |
| 8    | SDK                       | SDK sees `/compact` in prompt input, emits `SDKLocalCommandOutputMessage` (sdk.d.ts:2475), runs its local compact handler, streams the response back |
| 9    | ProgressiveMessageEditor  | `editor.update(accumulated)` per chunk (throttled to 1500ms); `editor.flush()` on completion; Discord `editReply` shows the final text |
| 10   | Trace row                 | Turn ends with success; persisted with source.kind=`"discord"`, source.id=`channelId`, rootTurnId=`"discord:<nanoid>"` — stitched with the rest of the Discord trace chain |

## Three dispatch paths in production after Plan 03

| Path | Example commands | How | Plan |
| ---- | ---------------- | --- | ---- |
| **Control-plane** | `/clawcode-model`, `/clawcode-effort`, `/clawcode-permissions` | SDK `Query.setX()` mid-session mutation, zero LLM turn | Phase 86 (setModel), Phase 83 (setMaxThinkingTokens), Plan 02 (setPermissionMode) |
| **Prompt-channel** | `/clawcode-compact`, `/clawcode-context`, `/clawcode-cost`, `/clawcode-help`, `/clawcode-hooks`, `/clawcode-agents`, `/clawcode-skills`, ... | TurnDispatcher.dispatchStream with `/<name> <args>` string → SDK emits `SDKLocalCommandOutputMessage` | **Plan 03 (this)** |
| **Legacy agent-routed** | `/clawcode-memory`, `/clawcode-schedule`, `/clawcode-health`, `/clawcode-status` (daemon short-circuit for status) | `formatCommandMessage(def, options)` + `sessionManager.streamFromAgent` with the agent's `claudeCommand` LLM prompt | Pre-Phase 87 (static DEFAULT_SLASH_COMMANDS + agent slashCommands overrides) |

## Carve-out ordering invariant (pinned by P4 test)

```
handleInteraction:
  clawcode-tools      →  handleToolsCommand        (Phase 85 Plan 03 — EmbedBuilder)
  clawcode-model      →  handleModelCommand        (Phase 86 Plan 03 — picker + IPC)
  CONTROL_COMMANDS.*  →  handleControlCommand      (daemon-routed IPC)
  [PLAN 03 CARVE-OUT] →  dispatchNativePromptCommand  (nativeBehavior='prompt-channel')
  [default]           →  sessionManager.streamFromAgent + formatCommandMessage
                           (legacy agent-routed)
```

Stray prompt-channel entries with names colliding with the dedicated inline handlers lose — pinned by P4 (stray `clawcode-tools` prompt-channel entry still goes to `handleToolsCommand`, never to `dispatchStream`).

## Verbatim-error surfacing (Phase 85 TOOL-04 pattern at the slash layer)

```ts
catch (err) {
  editor.dispose();
  const msg = err instanceof Error ? err.message : String(err);
  // ... log ...
  await interaction.editReply(`Command failed: ${msg}`);
}
```

Key property: `msg` is the SDK's thrown error message unchanged (same discipline as Phase 85 Plan 03's embed renderer passing `lastError` through to the field body). Before this plan: a /compact failing on "context too small" would surface as the legacy handler's generic blob; after: user sees `Command failed: Compact failed: context too small` verbatim. Pinned by P5 test.

## Verification

```bash
npx vitest run \
  src/manager/__tests__/native-cc-commands.test.ts \
  src/discord/__tests__/slash-commands-prompt-channel.test.ts
# Test Files  2 passed (2)
# Tests       50 passed (50)

# Grep-based verification (from plan verification section):
grep -c "dispatchNativePromptCommand" src/discord/slash-commands.ts
# 2 (carve-out call + method definition — plan required ≥ 2)
grep -c "ProgressiveMessageEditor" src/discord/slash-commands.ts
# 5 (import + existing agent-routed + new prompt-channel use + references)
# Plan required ≥ 3 — exceeds comfortably; confirms REUSE not re-implementation.

# Streaming primitive invariant — zero new exports in streaming.ts:
git diff HEAD~2 src/discord/streaming.ts
# (empty — file untouched)

# TSC delta for Plan 03's touched files — zero new errors:
npx tsc --noEmit 2>&1 | grep "error TS" | grep -E "native-cc-commands|slash-commands|prompt-channel"
# (empty match)
```

## Deviations from Plan

### None

Plan executed exactly as written. No authentication gates. No architectural surprises. The plan's dispatch trace + carve-out ordering + verbatim-error requirements landed verbatim.

The TSC global error count rose from 38 (Plan 01 baseline) to 61 due to Plan 02's parallel commits on the same working tree (Plan 02 added `setPermissionMode`/`getPermissionMode` to the SessionHandle type, which cascaded through the Phase 86-style Rule-3 update to openai test mocks and through the new Plan 02 test files). Those errors are attributable to Plan 02's in-flight execution; Plan 03's files contribute zero new TSC errors.

## Plan 02 + 03 merge-safety confirmation

Plan 02 and Plan 03 ran in parallel against the same working tree. Confirmed merge-safe:

| File | Plan 02 touch | Plan 03 touch | Conflict? |
| ---- | ------------- | ------------- | --------- |
| `src/discord/slash-commands.ts` | `handlePermissionsCommand` private method + carve-out before CONTROL_COMMANDS | `findNativePromptChannelCommand` + `dispatchNativePromptCommand` private methods + carve-out AFTER CONTROL_COMMANDS | No — adjacent additions to different sections of the if/else ladder |
| `src/manager/native-cc-commands.ts` | — | Append `buildNativePromptString` | No — Plan 02 did not touch |
| `src/manager/persistent-session-handle.ts` | setPermissionMode/getPermissionMode | — | No — Plan 03 did not touch |
| `src/manager/session-manager.ts` | setPermissionModeForAgent/getPermissionModeForAgent | — | No — Plan 03 did not touch |
| `src/ipc/protocol.ts` | set-permission-mode method | — | No — Plan 03 did not touch |
| `src/manager/daemon.ts` | handleSetPermissionModeIpc wire | — | No — Plan 03 did not touch |

## Self-Check: PASSED

- Files claimed in `key-files` exist on disk (verified via `ls`):
  - FOUND: `src/manager/native-cc-commands.ts`
  - FOUND: `src/manager/__tests__/native-cc-commands.test.ts`
  - FOUND: `src/discord/slash-commands.ts`
  - FOUND: `src/discord/__tests__/slash-commands-prompt-channel.test.ts`
- Commits claimed reachable via `git log --oneline -10`:
  - FOUND: `9c7e643` (RED)
  - FOUND: `44e9374` (GREEN)
- Test counts claimed match `npx vitest run` output: 50/50 GREEN.
- Grep invariants from plan's verification section all pass.
