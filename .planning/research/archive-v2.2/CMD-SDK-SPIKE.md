# CMD-00 SDK Spike Results

**Date:** 2026-04-21
**SDK version:** `@anthropic-ai/claude-agent-sdk@0.2.97` (on-disk)
**Source-of-truth file:** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
**Confidence:** HIGH — all claims verified against installed `.d.ts` with line numbers.

---

## Concurrency Safety (Q.setX mid-session)

All three setters are declared on the same `Query` interface under the same docstring header: **"The following methods are control requests, and are only supported when streaming input/output is used."** (sdk.d.ts:1690-1692). They share one transport — the SDK's control-request channel — so concurrency semantics are identical across them.

- **`setModel(model?: string): Promise<void>`** (sdk.d.ts:1711) — **CONFIRMED** via Phase 86 spy tests (`persistent-session-handle-model.test.ts`, 5 GREEN). Fire-and-forget + `.catch(logAndSwallow)` pattern proven safe against the captured `driverIter` (persistent-session-handle.ts:636-648).
- **`setPermissionMode(mode: PermissionMode): Promise<void>`** (sdk.d.ts:1704) — **CONFIRMED SAFE BY DESIGN** (same interface, same control-request channel as setModel/setMaxThinkingTokens). Not yet called in production, but the signature + streaming-input contract are identical. `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'` (sdk.d.ts:1512).
- **`setMaxThinkingTokens(n | null): Promise<void>`** (sdk.d.ts:1728) — **CONFIRMED** via Phase 83 spy tests (`persistent-session-handle-effort.test.ts`, 8 GREEN). Note: `@deprecated` in favor of per-query `thinking` option (sdk.d.ts:1721-1724) — still works, just not preferred for new greenfield work.

**Concurrency pattern to replicate for `setPermissionMode`** (mirror of persistent-session-handle.ts:636-648, Phase 86 blueprint):

```ts
setPermissionMode(mode: PermissionMode): void {
  currentPermissionMode = mode;
  void q.setPermissionMode(mode).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[permission] setPermissionMode(${mode}) failed: ${msg}`);
  });
},
```

Synchronous dispatch, fire-and-forget with `.catch` log-and-swallow — slash/IPC paths cannot yield, and transient SDK failure must never crash a healthy turn.

---

## Init Manifest Shape (`system/init.slash_commands`)

**`SDKSystemMessage` — sdk.d.ts:2769-2798.** Emitted once at session start (`subtype: 'init'`). Key fields:

```ts
export declare type SDKSystemMessage = {
    type: 'system';
    subtype: 'init';
    agents?: string[];
    apiKeySource: ApiKeySource;
    betas?: string[];
    claude_code_version: string;
    cwd: string;
    tools: string[];
    mcp_servers: { name: string; status: string }[];
    model: string;
    permissionMode: PermissionMode;
    slash_commands: string[];    // ← sdk.d.ts:2787 — BARE STRING ARRAY, names only
    output_style: string;
    skills: string[];            // ← sdk.d.ts:2789 — bundled skills live HERE, not in slash_commands
    plugins: { name: string; path: string }[];
    fast_mode_state?: FastModeState;
    uuid: UUID;
    session_id: string;
};
```

**Critical finding — two separate surfaces for command discovery:**

1. **`SDKSystemMessage.slash_commands: string[]`** (line 2787) — bare string array of command **names only**. No descriptions, no argument hints. Useful for a lightweight "does this command exist" check but NOT sufficient to populate Discord slash descriptions.
2. **`Query.supportedCommands(): Promise<SlashCommand[]>`** (sdk.d.ts:1754) — rich shape with `{name, description, argumentHint}` per entry. **This is the primitive to use for CMD-01 registration.**

The `SlashCommand` type (sdk.d.ts:4239-4252):
```ts
export declare type SlashCommand = {
    name: string;          // without leading slash
    description: string;
    argumentHint: string;  // e.g., "<file>"
};
```

**Also exposed — `Query.initializationResult()`** (sdk.d.ts:1748) returns `SDKControlInitializeResponse` (sdk.d.ts:2206-2218) with `{commands: SlashCommand[], agents, output_style, available_output_styles, models, account, fast_mode_state}`. Superset of `supportedCommands()` — one-call idiom for full session capability snapshot at boot.

**Bundled skills (`/simplify`, `/debug`, `/batch`, `/loop`, `/claude-api`)** — live in the separate `skills: string[]` field of `SDKSystemMessage` (line 2789), not in `slash_commands`. The SDK also exposes `Query.supportedAgents()` and a rich `AgentInfo[]` (line 2208) — skills and agents are first-class and enumerable WITHOUT being in the slash-command manifest.

---

## Dispatch Classification per Command

The SDK has NO generic "dispatch an arbitrary slash command" primitive. Three real paths exist:

| Native Command    | SDK-dispatchable? | Path                                                                                                |
|-------------------|-------------------|-----------------------------------------------------------------------------------------------------|
| `/model [name]`   | ✅ Yes, live      | **control-plane** — `Query.setModel(model?)` (sdk.d.ts:1711)                                        |
| `/permissions <mode>` | ✅ Yes, live | **control-plane** — `Query.setPermissionMode(mode)` (sdk.d.ts:1704)                                 |
| `/thinking` / effort  | ✅ Yes, live | **control-plane** — `Query.setMaxThinkingTokens(n)` (sdk.d.ts:1728), preferably `thinking` option   |
| `/compact`        | ⚠ Prompt-route   | **prompt-channel** — send as user text; produces `SDKLocalCommandOutputMessage` (sdk.d.ts:2475)     |
| `/review`, `/security-review` | ⚠ Prompt-route | **prompt-channel** — send canonical prompt text through normal input                    |
| `/cost`           | ⚠ Daemon-owned   | **not-available via SDK** — read from local `UsageTracker` / ConversationStore                      |
| `/mcp`            | ⚠ Daemon-owned   | **control-plane (read)** — `Query.mcpServerStatus()` (sdk.d.ts:1767+). NEVER dump env values to Discord |
| `/config`         | ⚠ Partial        | **control-plane** — `Query.applyFlagSettings(settings)` (sdk.d.ts:1741) for settings merge           |
| `/export <file>`  | ❌ No            | **not-available** — no SDK surface; CLI-only REPL feature                                            |
| `/clear`          | ❌ No            | **session-restart** — PITFALLS.md §8 confirmed; no live primitive. Use `sessionManager.restartAgent()` |
| `/memory`, `/todos`, `/agents`, `/init` | ❌ No | **not-available** — map to ClawCode-native equivalents (see ARCHITECTURE Tier 3)            |

**Evidence for prompt-channel claim:** `SDKLocalCommandOutputMessage` (sdk.d.ts:2475-2481) — the SDK emits a `local_command_output` system message when it processes a built-in command from prompt input. Options docstring (STACK.md §4) confirms "Slash commands are processed" in prompts. PITFALLS §8 flags the risk: only prompt-LIKE commands (review, compact semantics) should use this path; control commands like `/clear` emit confabulated responses, not real state changes.

---

## Runtime Enumeration (CMD-01 foundation)

**Yes — `Query.supportedCommands(): Promise<SlashCommand[]>` is the primitive** (sdk.d.ts:1754). Call once per agent session post-init; merge with `DEFAULT_SLASH_COMMANDS` + CONTROL_COMMANDS; dedupe by name; register per-guild.

Prefer `Query.initializationResult()` (sdk.d.ts:1748) when the agent also needs models + skills + agents enumerated at the same moment — single round-trip vs three separate calls.

---

## Recommendation for Phase 87

1. **Registration loop (CMD-01):** At daemon boot, call `handle.query.initializationResult()` per agent. Extract `commands[]`, prefix each with `clawcode-cc-` (PITFALLS §10 namespace guard). Merge with existing `DEFAULT_SLASH_COMMANDS`. Assert total count ≤ 90 (PITFALLS §9 Discord limit). Register per-guild bulk.

2. **Dispatch fork (CMD-02+):** Add a three-way discriminator to slash command entries (`nativeBehavior: 'control-plane' | 'prompt-channel' | 'daemon-owned'`). For `control-plane`: add `handle.setPermissionMode(mode)` mirroring `setModel`/`setEffort` — same fire-and-forget + `.catch(logAndSwallow)` blueprint. For `prompt-channel`: route through existing `streamFromAgent` with canonical text. For `daemon-owned`: inline handler in `slash-commands.ts`.

3. **`setPermissionMode` wiring:** Add `currentPermissionMode` field to `persistent-session-handle.ts` (mirror of `currentModel` at line 102). Spy-test it in `persistent-session-handle-permission.test.ts` with the exact Phase 83/86 harness pattern — 5 tests: single call → spy hit, double call → ordered, getPermissionMode parity, rejection log-and-swallow, no-throw pre-turn.

4. **Skip `/export` entirely for v2.2** — no SDK surface, no in-process path. Add to deferred list.

5. **Bundled skills** — enumerate via `SDKSystemMessage.skills[]` (captured once at init) OR `Query.supportedCommands()` (if they surface there in this SDK build — verify empirically in CMD-01, docs don't say). They are NOT guaranteed to appear in `slash_commands[]`.

**Caveats / additional research:**
- The docs example showing 3 `slash_commands` items is stale / minimal. Real size depends on skills + plugins installed — will verify empirically once CMD-01 lands.
- `setMaxThinkingTokens` is `@deprecated` (sdk.d.ts:1721) — Phase 83 wiring still works but future-proof by preferring per-query `thinking` option for greenfield additions.

---

## Sources

- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — 1512 (PermissionMode), 1690-1766 (control-request block), 2206-2218 (SDKControlInitializeResponse), 2475-2481 (SDKLocalCommandOutputMessage), 2769-2798 (SDKSystemMessage), 4239-4252 (SlashCommand)
- `src/manager/persistent-session-handle.ts:616-648` — Phase 83/86 wired setter blueprint
- `src/manager/__tests__/persistent-session-handle-{effort,model}.test.ts` — spy-test harness (8 + 5 GREEN)
- `.planning/research/PITFALLS.md` §8, §9, §10 — dispatch gap, command limit, namespace
- `.planning/research/ARCHITECTURE.md` Phase 87 — Tier 1/2/3 dispatch strategy
