---
phase: 86-dual-discord-model-picker-core
plan: 03
subsystem: discord-slash-commands
tags: [clawcode-model, StringSelectMenuBuilder, ButtonBuilder, IPC-set-model, ModelNotAllowedError, UI-01, cache-invalidation, ephemeral-confirmation]

# Dependency graph
requires:
  - phase: 86-dual-discord-model-picker-core
    provides: "IPC set-model endpoint (handleSetModelIpc) with ManagerError {code:-32602, data:{kind,agent,attempted,allowed}} envelope from Plan 02 — consumed directly by the new /clawcode-model inline handler"
  - phase: 86-dual-discord-model-picker-core
    provides: "allowedModels resolved on ResolvedAgentConfig from Plan 01 — used as the StringSelectMenuBuilder option source"
provides:
  - "clawcode-model slash command converted to native StringSelectMenuBuilder picker (no-arg) + direct IPC dispatch (arg) — PROJECT.md tech debt line 150 closed"
  - "handleModelCommand inline handler at slash-commands.ts owns both paths — no-arg select-menu + arg dispatch funnel through shared dispatchModelChange"
  - "promptCacheInvalidationConfirm (MODEL-05) renders native Danger/Secondary button confirm dialog before mid-conversation model changes; cancel+timeout skip IPC"
  - "IpcError extended with optional data field (shared/errors.ts) + ipc/client.ts propagation — client-side consumers can now read structured JSON-RPC error payloads (data.kind, data.allowed) for domain-specific UI rendering"
  - "slash-types.ts clawcode-model definition: claudeCommand emptied, model option → required:false (LLM-prompt routing REMOVED fleet-wide)"
  - "17 new tests: 10 picker tests (NO-ARG-1..5, ARG-1..4, UI-01) + 7 confirmation tests (C1-C7) — all GREEN"
affects: [phase-87-setPermissionMode-slash-command, phase-88-skills-marketplace]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — discord.js 14.26.2 already on-box, types include StringSelectMenuBuilder/ButtonBuilder/ComponentType
  patterns:
    - "Inline slash-command handler short-circuit BEFORE CONTROL_COMMANDS dispatch — carves out native-component paths (EmbedBuilder, StringSelectMenuBuilder, ButtonBuilder) from the generic text-formatting branch. First applied in Phase 85 for /clawcode-tools; extended here for /clawcode-model."
    - "Shared dispatch helper between arg-path and select-menu path (dispatchModelChange + editMode flag) — both funnel through the same ModelNotAllowedError rendering + error handling. Blueprint for Phase 87 setPermissionMode and Phase 88 skills picker."
    - "Prefix-based customId filter for button collectors (model-confirm:{agent}: / model-cancel:{agent}:) — collision-safe across parallel picker invocations for different agents in the same channel."
    - "IpcError.data propagation — structured JSON-RPC error payloads survive the client boundary without a second round-trip. Plan 02 wired the server-side (ManagerError.data + ipc/server.ts catch); this plan wired the client-side (IpcError.data + ipc/client.ts propagation)."
    - "Conservative 'active conversation' heuristic via sessionManager.getModelForAgent() !== undefined — true after any setModel call OR after first turn resumes. Zero-cost alternative to ConversationStore DB lookup; biased toward showing the confirmation prompt when in doubt."

key-files:
  created:
    - src/discord/__tests__/slash-commands-model-picker.test.ts
    - src/discord/__tests__/slash-commands-model-confirm.test.ts
  modified:
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/shared/errors.ts
    - src/ipc/client.ts
    - src/discord/__tests__/slash-types.test.ts

key-decisions:
  - "claudeCommand emptied (not deleted). Keeps the SlashCommandDef shape stable — slashCommandDef.claudeCommand is a required non-optional string field, and emptying it (rather than making it optional) keeps every existing test, type guard, and REST registration code path byte-stable. The inline handler short-circuits before formatCommandMessage ever reads it."
  - "Prefix-based customId filter instead of exact-id match. Tests cannot inject the nonce without reaching into the handler's internals; prefix match (model-confirm:{agent}:) is both test-ergonomic AND collision-safe across parallel picker invocations (e.g. two operators picking for different agents). Exact-id match would be brittle against harnesses AND offer no security benefit (the nonce is 6 chars of entropy, not a crypto-grade token)."
  - "Shared dispatchModelChange with editMode flag. Arg-path calls deferReply first (editMode=false, → editReply in dispatch); select-menu path already called interaction.reply (editMode=true, → direct editReply). Keeping the dispatch logic in one place means the ModelNotAllowedError branch + persistence-failure render have ONE site to test/maintain."
  - "Extended IpcError with optional data (shared/errors.ts) + ipc/client.ts propagation. Plan 02 wired the server-side (ManagerError.data forwarded through ipc/server.ts catch), but the client's IpcError constructor only took (message, code) — the structured payload was dropped at the client boundary. Without this fix, the Plan 03 `data.kind === 'model-not-allowed'` branch would never fire. Treated as Rule 3 blocking."
  - "Conservative 'active model' signal via getModelForAgent !== undefined. Alternatives (sessions.has check / ConversationStore turn-count query) were explicitly traded off per the plan's interfaces block. The chosen signal is zero-cost, always available, and biased toward showing the confirmation prompt when in doubt — the UX cost of a spurious confirmation is a 1-click dismiss, while the cost of a missed warning is an invalidated prompt cache mid-conversation."
  - "Override (update) slash-types.test.ts regression tests for the new contract. Two pre-existing tests pinned the OLD contract (required:true, non-empty claudeCommand for every default command). Rather than mutate the tests to be vague, we kept them EXPLICIT about the Phase 86 break: one asserts `cmd.claudeCommand === ''` specifically for clawcode-model, the other asserts `required: false` for the model option. Future Phase 87/88 breaks will follow the same pattern."

patterns-established:
  - "Inline handler short-circuit pattern: a commandName-specific branch at the top of handleInteraction() owning both the no-arg and arg paths, sharing a private dispatch helper. Phase 85 /clawcode-tools set the precedent; Phase 86 /clawcode-model applied it; Phase 87 setPermissionMode + Phase 88 skills browser will follow."
  - "StringSelectMenuBuilder + 25-cap truncation + overflow note: the picker truncates allowedModels at Discord's hard cap and appends '(Showing first 25 of N.)' to the content string. Phase 87 autocomplete + Phase 88 skills browser should mirror exactly."
  - "ButtonBuilder confirm/cancel with prefix-based customId filter: Confirm = Danger style, Cancel = Secondary. Nonce in customId for per-invocation uniqueness; prefix match in the filter for collision safety across agents. Reusable anywhere confirmation is needed."
  - "Test harness for awaitMessageComponent: sequence-based mock (awaitSequence: [selectMenu, button]) that resolves in order. Keeps tests deterministic across the two-collector flow (select-menu → confirmation) without real Discord REST calls."
  - "IpcError.data client-side propagation: ALL domain errors that need client-side UI differentiation MUST carry {code, data} through the server's ManagerError AND survive the client's IpcError constructor. Phase 87's setPermissionMode will surface a similar typed-error envelope for permission-mode validation failures."

requirements-completed: [MODEL-02, MODEL-05]

# Metrics
duration: 9 min 39 s
completed: 2026-04-21
---

# Phase 86 Plan 03: /clawcode-model Slash Command Inline Handler Summary

**Replaced LLM-prompt routing for `/clawcode-model` with a native StringSelectMenuBuilder picker (no-arg) + direct IPC dispatch (arg), closed PROJECT.md tech-debt line 150, and added a ButtonBuilder cache-invalidation confirmation for mid-conversation model swaps — UI-01 compliant end-to-end.**

## Performance

- **Duration:** 9 min 39 s
- **Started:** 2026-04-21T21:21:05Z
- **Completed:** 2026-04-21T21:30:44Z
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files created:** 2
- **Files modified:** 5

## Accomplishments

- **PROJECT.md tech debt line 150 CLOSED.** The `/clawcode-model` command no longer routes through an LLM prompt ("Set my model to {model}" → agent's streamFromAgent). The inline handler at `slash-commands.ts:handleModelCommand` owns the full dispatch path — no LLM turn consumed, no format-command fallback, no agent-side parsing. Verified fleet-wide: `grep -rn "Set my model to" src/` returns only documentary comments, zero live routings.
- **UI-01 end-to-end for `/clawcode-model`.** No-arg path renders a native `StringSelectMenuBuilder` + `ActionRowBuilder` with one option per `allowedModels` entry (capped at 25, with overflow note). Confirmation renders native `ButtonBuilder` components (Danger + Secondary). Not a single free-text fallback anywhere in the flow.
- **MODEL-06 allowed-list rendering end-to-end.** When the daemon throws `ModelNotAllowedError` (Plan 01) and Plan 02 wraps it as `ManagerError {code:-32602, data:{kind, agent, attempted, allowed}}`, the new inline handler reads `err.data.allowed` and renders `'{attempted}' is not allowed for {agent}. Allowed: {list}` ephemerally — no second round-trip to SessionManager.
- **MODEL-05 cache-invalidation UX mirrors OpenClaw's `/model`.** Mid-conversation model changes (detected via `sessionManager.getModelForAgent() !== undefined` — any prior setModel OR active turn) surface a two-button confirm/cancel prompt warning about prompt-cache invalidation. Cancel + timeout paths do NOT fire IPC. Fresh-boot path (no active model) skips confirmation entirely.
- **17 new regression pins.** 10 picker tests (NO-ARG-1..5, ARG-1..4, UI-01) + 7 confirmation tests (C1-C7). All 17 GREEN; 181/181 discord suite tests pass.
- **Zero new TS errors, zero new npm deps.** 38 pre-plan → 38 post-plan (same pre-existing 38 errors documented in Plan 01 & 02 SUMMARIES — none of them touch Plan 03 code).

## Task Commits

Each task was committed atomically with `--no-verify` per parallel-execution protocol:

1. **Task 1 RED: failing tests for /clawcode-model inline handler** — `8a953e1` (test)
   - 10 tests pinning the new contract: NO-ARG-1..5 (picker render, 25-cap, select-menu → IPC, timeout, empty allowedModels), ARG-1..4 (direct IPC, ModelNotAllowedError allowed-list render, generic error, unbound channel), UI-01 (native components).
   - 9/10 fail against HEAD (old claudeCommand routes through streamFromAgent, not IPC). 1 passes (ARG-4 unbound-channel reuses the pre-existing guard in the default dispatch).

2. **Task 1 GREEN: implement inline handler + IpcError.data propagation** — `694d629` (feat)
   - `slash-types.ts`: `clawcode-model.claudeCommand = ""`, `options[0].required = false`.
   - `slash-commands.ts`: `handleModelCommand` short-circuit BEFORE `CONTROL_COMMANDS` dispatch; `dispatchModelChange` shared helper with `editMode` flag for arg vs select-menu paths; `StringSelectMenuBuilder` + `ActionRowBuilder` render with 25-cap + overflow note; `awaitMessageComponent` 30s TTL; `ModelNotAllowedError` allowed-list branch on `err.data.kind`.
   - `shared/errors.ts`: `IpcError` extended with optional `data` field (Rule 3 blocking fix — Plan 02 only wired the server side).
   - `ipc/client.ts`: propagate `response.error.data` through the `IpcError` constructor.
   - `slash-types.test.ts`: updated 2 regression tests for the new contract (Rule 3 blocking — pre-existing tests pinned the OLD contract we intentionally broke).

3. **Task 2 RED: failing tests for cache-invalidation confirmation** — `1b0b20f` (test)
   - 7 tests pinning MODEL-05: C1-C7 (active model → prompt; confirm → IPC; cancel → no IPC; timeout → no IPC; fresh boot → no prompt; select-menu path funnels through confirmation; prefix-based filter for collision safety).
   - 5/7 fail against Task 1 code (confirmation flow not yet wired); 2 pass (C5 fresh-boot + one where pathway happens to align).

4. **Task 2 GREEN: cache-invalidation confirmation** — `016f504` (feat)
   - `promptCacheInvalidationConfirm` helper: `ButtonBuilder` (Danger + Secondary), agent+nonce namespaced customIds, 30s TTL, prefix-based filter for collision safety.
   - `dispatchModelChange` gate: if `activeModel !== undefined` → call `promptCacheInvalidationConfirm` → outcome determines whether IPC fires.
   - Three outcomes: `confirmed` (fall through to IPC), `cancelled` ("Model change cancelled"), `timeout` ("Confirmation timed out").

_Plan metadata commit follows via `gsd-tools commit`._

## The Wire — Before/After

### `src/discord/slash-types.ts` — clawcode-model entry

**Before (pre-Phase-86):**
```typescript
{
  name: "clawcode-model",
  description: "Set the default model for an agent",
  claudeCommand: "Set my model to {model}",   // ← LLM-prompt routing
  options: [
    {
      name: "model",
      type: 3,
      description: "Model to use (haiku, sonnet, opus)",
      required: true,                          // ← forced arg
    },
  ],
},
```

**After (Phase 86 Plan 03):**
```typescript
{
  name: "clawcode-model",
  description: "Change the agent's model (opens a picker when no model is specified)",
  // Phase 86 MODEL-02 / MODEL-03 — LLM-prompt routing REMOVED. The inline
  // handler in slash-commands.ts owns both the no-arg (picker) and arg
  // (IPC dispatch) paths. claudeCommand is intentionally empty so any
  // accidental fallback to formatCommandMessage emits a no-op string that
  // the inline short-circuit prevents from ever being sent.
  claudeCommand: "",
  options: [
    {
      name: "model",
      type: 3,
      description: "Model alias (optional — omit to open picker)",
      required: false,                         // ← no-arg opens picker
    },
  ],
},
```

### `src/discord/slash-commands.ts` — handleInteraction dispatch order

```typescript
// Phase 85 — /clawcode-tools inline handler.
if (commandName === "clawcode-tools") {
  await this.handleToolsCommand(interaction);
  return;
}

// Phase 86 MODEL-02 / MODEL-03 — /clawcode-model inline handler.
// Routes ENTIRELY through IPC set-model (Plan 02). The old LLM-prompt
// routing (slash-types.ts claudeCommand "Set my model to {model}")
// has been REMOVED — this handler is the only dispatch path.
if (commandName === "clawcode-model") {
  await this.handleModelCommand(interaction);
  return;
}

// Check if this is a control command (daemon-direct, no agent needed)
const controlCmd = CONTROL_COMMANDS.find((c) => c.name === commandName);
// ...
```

### `src/discord/slash-commands.ts` — handleModelCommand (new, ~120 lines)

```typescript
private async handleModelCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const agentName = getAgentForChannel(this.routingTable, interaction.channelId);
  if (!agentName) {
    try { await interaction.reply({ content: "This channel is not bound to an agent.", ephemeral: true }); } catch {}
    return;
  }
  const agentConfig = this.resolvedAgents.find((a) => a.name === agentName);
  const allowed = [...(agentConfig?.allowedModels ?? [])];

  const modelArg = interaction.options.get("model")?.value;
  const model = typeof modelArg === "string" && modelArg.length > 0 ? modelArg : undefined;

  // Arg path — direct IPC dispatch.
  if (model !== undefined) {
    await this.dispatchModelChange(interaction, agentName, model, false);
    return;
  }

  // No-arg path — render the select-menu picker.
  if (allowed.length === 0) {
    try { await interaction.reply({ content: `No models available for ${agentName} (allowedModels is empty).`, ephemeral: true }); } catch {}
    return;
  }

  const capped = allowed.slice(0, DISCORD_SELECT_CAP);
  const overflow = allowed.length - capped.length;
  const nonce = Math.random().toString(36).slice(2, 8);
  const customId = `model-picker:${agentName}:${nonce}`;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Choose a model")
    .addOptions(capped.map((m) => new StringSelectMenuOptionBuilder().setLabel(m).setValue(m)));
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

  const overflowNote = overflow > 0 ? `\n(Showing first ${DISCORD_SELECT_CAP} of ${allowed.length}.)` : "";
  try {
    await interaction.reply({ content: `Pick a model for **${agentName}**.${overflowNote}`, components: [row], ephemeral: true });
  } catch (err) {
    this.log.error({ agent: agentName, error: (err as Error).message }, "failed to render model picker");
    return;
  }

  // Wait for the select-menu interaction (30s TTL).
  let followUp: StringSelectMenuInteraction;
  try {
    const channel = interaction.channel;
    if (!channel) throw new Error("interaction has no channel — cannot collect");
    followUp = (await channel.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.user.id === interaction.user.id && i.customId === customId,
      time: MODEL_PICKER_TTL_MS,
    })) as StringSelectMenuInteraction;
  } catch {
    try { await interaction.editReply({ content: "Model picker timed out (no selection in 30s).", components: [] }); } catch {}
    return;
  }

  const chosen = followUp.values[0];
  if (!chosen) {
    try { await followUp.update({ content: "No selection captured.", components: [] }); } catch {}
    return;
  }

  try { await followUp.update({ content: `Switching ${agentName} to **${chosen}**...`, components: [] }); } catch {}
  await this.dispatchModelChange(interaction, agentName, chosen, true);
}
```

### `src/discord/slash-commands.ts` — dispatchModelChange (shared, ~60 lines)

```typescript
private async dispatchModelChange(
  interaction: ChatInputCommandInteraction,
  agentName: string,
  model: string,
  editMode: boolean,
): Promise<void> {
  if (!editMode) {
    try { await interaction.deferReply({ ephemeral: true }); } catch {}
  }

  // Phase 86 MODEL-05 — cache-invalidation confirmation for mid-conversation
  // changes. Skip when the handle has no active model (fresh boot).
  let activeModel: string | undefined;
  try { activeModel = this.sessionManager.getModelForAgent(agentName); } catch { activeModel = undefined; }
  if (activeModel !== undefined) {
    const outcome = await this.promptCacheInvalidationConfirm(interaction, agentName, activeModel, model);
    if (outcome === "cancelled") {
      try { await interaction.editReply({ content: "Model change cancelled.", components: [] }); } catch {}
      return;
    }
    if (outcome === "timeout") {
      try { await interaction.editReply({ content: "Confirmation timed out.", components: [] }); } catch {}
      return;
    }
    // outcome === "confirmed" — fall through to IPC dispatch.
  }

  try {
    const res = (await sendIpcRequest(SOCKET_PATH, "set-model", { agent: agentName, model })) as {
      readonly agent: string; readonly old_model: string; readonly new_model: string;
      readonly persisted: boolean; readonly persist_error: string | null; readonly note: string;
    };
    const persistSuffix = res.persisted ? "" : `\n(Note: live swap OK, but YAML persistence failed: ${res.persist_error ?? "unknown"})`;
    const message = `Model set to **${res.new_model}** for ${agentName} (was ${res.old_model}).${persistSuffix}`;
    try { await interaction.editReply(message); } catch {}
  } catch (err) {
    // Plan 02 IPC envelope: ModelNotAllowedError carries `data.kind === "model-not-allowed"`.
    const maybe = err as { message?: string; data?: unknown };
    const data = maybe.data as { kind?: string; allowed?: readonly string[] } | undefined;
    let reply: string;
    if (data?.kind === "model-not-allowed" && Array.isArray(data.allowed)) {
      reply = `'${model}' is not allowed for ${agentName}. Allowed: ${data.allowed.join(", ")}`;
    } else {
      reply = `Failed to set model: ${maybe.message ?? String(err)}`;
    }
    try { await interaction.editReply(reply); } catch {}
  }
}
```

### `src/discord/slash-commands.ts` — promptCacheInvalidationConfirm (new, ~70 lines)

```typescript
private async promptCacheInvalidationConfirm(
  interaction: ChatInputCommandInteraction,
  agentName: string,
  oldModel: string,
  newModel: string,
): Promise<"confirmed" | "cancelled" | "timeout"> {
  const nonce = Math.random().toString(36).slice(2, 8);
  const confirmId = `model-confirm:${agentName}:${nonce}`;
  const cancelId = `model-cancel:${agentName}:${nonce}`;
  const confirmPrefix = `model-confirm:${agentName}:`;
  const cancelPrefix = `model-cancel:${agentName}:`;

  const confirm = new ButtonBuilder().setCustomId(confirmId).setLabel("Switch & invalidate cache").setStyle(ButtonStyle.Danger);
  const cancel = new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirm, cancel);

  const warning =
    `Changing from **${oldModel}** to **${newModel}** will invalidate the prompt cache ` +
    `for ${agentName}. The next turn will pay full-prefix token cost. Proceed?`;

  try { await interaction.editReply({ content: warning, components: [row] }); } catch { return "cancelled"; }

  let btn: ButtonInteraction;
  try {
    const channel = interaction.channel;
    if (!channel) throw new Error("interaction has no channel — cannot collect");
    btn = (await channel.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id &&
        (i.customId.startsWith(confirmPrefix) || i.customId.startsWith(cancelPrefix)),
      time: MODEL_CONFIRM_TTL_MS,
    })) as ButtonInteraction;
  } catch { return "timeout"; }

  const isConfirm = btn.customId.startsWith(confirmPrefix);
  try {
    await btn.update({
      content: isConfirm ? `Switching ${agentName} to **${newModel}**...` : "Cancelled.",
      components: [],
    });
  } catch {}

  return isConfirm ? "confirmed" : "cancelled";
}
```

### `src/shared/errors.ts` — IpcError.data extension

```typescript
export class IpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "IpcError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}
```

### `src/ipc/client.ts` — response.error.data propagation

```typescript
if (response.error) {
  // Phase 86 Plan 03 — preserve the JSON-RPC error envelope's `data`
  // field on the IpcError so domain-specific consumers (e.g.
  // /clawcode-model's ModelNotAllowedError renderer) can read
  // `err.data.kind` without a second round-trip.
  reject(new IpcError(response.error.message, response.error.code, response.error.data));
  return;
}
```

## Sample Discord UX (reply-text excerpts)

### No-arg picker (3 allowed models)
```
Pick a model for **clawdy**.

[ Select menu dropdown — Haiku | Sonnet | Opus ]
```

### No-arg picker (overflow — 27 allowed models)
```
Pick a model for **clawdy**.
(Showing first 25 of 27.)

[ Select menu dropdown — model-0 through model-24 ]
```

### Arg-path success (no active model — fresh boot)
```
/clawcode-model sonnet
→ Model set to **sonnet** for clawdy (was haiku).
```

### Arg-path failure (disallowed model)
```
/clawcode-model opus
→ 'opus' is not allowed for clawdy. Allowed: haiku, sonnet
```

### Mid-conversation confirmation (active model exists)
```
/clawcode-model sonnet

Changing from **haiku** to **sonnet** will invalidate the prompt cache for clawdy.
The next turn will pay full-prefix token cost. Proceed?

[ Switch & invalidate cache (Danger) ] [ Cancel (Secondary) ]

# User clicks Switch:
→ Switching clawdy to **sonnet**...
→ Model set to **sonnet** for clawdy (was haiku).

# OR User clicks Cancel:
→ Cancelled.
→ Model change cancelled.

# OR 30s with no click:
→ Confirmation timed out.
```

### Post-picker confirmation (active model exists, no-arg flow)
```
/clawcode-model
→ Pick a model for **clawdy**.
→ [ User picks "sonnet" from dropdown ]
→ Switching clawdy to **sonnet**...
→ Changing from **haiku** to **sonnet** will invalidate the prompt cache...
→ [ User clicks Switch ]
→ Switching clawdy to **sonnet**...
→ Model set to **sonnet** for clawdy (was haiku).
```

## UI-01 Compliance Checklist

- [x] **No-arg reply is a `components` payload, not free-text.** `interaction.reply({ components: [row], ephemeral: true })`; the `content` field holds a short prompt ("Pick a model for X") but the interactive surface is the StringSelectMenuBuilder — validated by test NO-ARG-1 and the UI-01 structural test.
- [x] **Confirmation dialog is ButtonBuilder + ActionRowBuilder.** Two buttons: Confirm (Danger style) + Cancel (Secondary style). No reaction-emoji pattern, no free-text "yes/no" parser — validated by tests C1-C3.
- [x] **Error rendering is ephemeral text, not embed.** `ModelNotAllowedError` and generic IPC errors render as ephemeral `editReply(string)`. Content-only replies are acceptable for error messages (UI-01 mandates structured components for INPUT surfaces, not error ephemerals).
- [x] **No claudeCommand fallback path active.** `claudeCommand: ""` + inline handler short-circuit means `formatCommandMessage` is never reached for `/clawcode-model`.
- [x] **Discord 25-option hard cap respected.** The picker truncates at `DISCORD_SELECT_CAP = 25` and appends `(Showing first 25 of N.)` to the content — validated by test NO-ARG-2.

## Test Coverage

### `slash-commands-model-picker.test.ts` (Task 1 — 10 tests)

| Test | Asserts | Status |
|------|---------|--------|
| NO-ARG-1 | interaction.reply called with components array containing StringSelectMenuBuilder whose options match allowedModels | PASS |
| NO-ARG-2 | allowedModels=27 → menu capped at 25; content contains "25 of 27" | PASS |
| NO-ARG-3 | select-menu interaction → sendIpcRequest called ONCE with (SOCKET_PATH, "set-model", {agent,model}) | PASS |
| NO-ARG-4 | awaitMessageComponent throws → editReply "timed out"; NO IPC call | PASS |
| NO-ARG-5 | empty allowedModels → ephemeral "No models available"; NO components rendered | PASS |
| ARG-1 | /clawcode-model sonnet → sendIpcRequest("set-model", {agent,model}); editReply contains sonnet + agent name | PASS |
| ARG-2 | IPC error with data.kind="model-not-allowed" → reply contains attempted model, "not allowed", and allowed list | PASS |
| ARG-3 | generic IPC error → reply contains error message; NO "Allowed:" branch | PASS |
| ARG-4 | unbound channel → ephemeral "not bound"; NO IPC call | PASS |
| UI-01 | no-arg reply is a components payload (not free-text) | PASS |

**10/10 green.**

### `slash-commands-model-confirm.test.ts` (Task 2 — 7 tests)

| Test | Asserts | Status |
|------|---------|--------|
| C1 | active model → editReply with "invalidate prompt cache" text BEFORE IPC | PASS |
| C2 | confirm button pattern → sendIpcRequest dispatched with chosen model | PASS |
| C3 | cancel button → NO sendIpcRequest; editReply contains "cancel" | PASS |
| C4 | awaitMessageComponent throws → NO IPC; editReply contains "timed out" | PASS |
| C5 | getModelForAgent undefined (fresh boot) → awaitMessageComponent NOT called; direct IPC dispatch | PASS |
| C6 | select-menu path + active model → TWO awaitMessageComponent calls (picker + confirm); IPC dispatched once | PASS |
| C7 | filter rejects "model-confirm:OTHER:..." for a different agent (collision safety); cancel path fires no IPC | PASS |

**7/7 green.**

## Files Created/Modified

### Created
- `src/discord/__tests__/slash-commands-model-picker.test.ts` (~510 lines) — 10 tests covering NO-ARG, ARG, and UI-01 paths.
- `src/discord/__tests__/slash-commands-model-confirm.test.ts` (~439 lines) — 7 tests covering C1-C7 confirmation flow.

### Modified (production)
- `src/discord/slash-types.ts` — clawcode-model entry: claudeCommand emptied, model option → required:false.
- `src/discord/slash-commands.ts` — added ActionRowBuilder/ButtonBuilder/ButtonStyle/ComponentType/StringSelectMenuBuilder/StringSelectMenuOptionBuilder imports + ButtonInteraction/StringSelectMenuInteraction types; MODEL_PICKER_TTL_MS + DISCORD_SELECT_CAP + MODEL_CONFIRM_TTL_MS constants; clawcode-model short-circuit in handleInteraction; handleModelCommand + dispatchModelChange + promptCacheInvalidationConfirm methods (~250 lines total).
- `src/shared/errors.ts` — IpcError extended with optional `data` field.
- `src/ipc/client.ts` — propagate `response.error.data` through IpcError.

### Modified (tests)
- `src/discord/__tests__/slash-types.test.ts` — updated 2 regression tests for the new contract (empty claudeCommand for clawcode-model + required:false on model option).

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **claudeCommand emptied (not deleted).** Keeps SlashCommandDef shape stable; inline handler short-circuits before formatCommandMessage.
2. **Prefix-based customId filter.** Test-ergonomic AND collision-safe across parallel picker invocations for different agents.
3. **Shared dispatchModelChange + editMode flag.** ONE site for the ModelNotAllowedError branch + persist-failure render.
4. **IpcError.data extension (Rule 3 blocking).** Plan 02 wired the server side; client boundary dropped `.data`. Without this, `data.kind === "model-not-allowed"` never fires.
5. **Conservative active-model signal.** `getModelForAgent() !== undefined` — zero-cost, always available, biased toward showing confirmation.
6. **Explicit regression-test updates for slash-types.test.ts.** Pinned the NEW contract (`claudeCommand === ""` for clawcode-model, `required: false` for model option) with an agent-name-specific branch — future phase breaks will follow this pattern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended IpcError with optional `data` field + wired through ipc/client.ts**
- **Found during:** Task 1 RED test design (ARG-2 for ModelNotAllowedError rendering)
- **Issue:** The plan's ARG-2 test asserts that the `/clawcode-model` handler reads `err.data.kind === "model-not-allowed"` from the IPC error. But the production path (ipc/client.ts:86) constructed `new IpcError(message, code)` — dropping `response.error.data` at the client boundary. Plan 02 wired the server side (ManagerError.data + ipc/server.ts forwarding), but never extended IpcError to receive it. Without this, the Plan 03 typed-error branch would NEVER fire in production; only in tests that inject a plain Error with a `.data` own property.
- **Fix:** Extended `IpcError` in `shared/errors.ts` with an optional `data` field + 3-arg constructor; updated `ipc/client.ts:86-89` to pass `response.error.data` through. Back-compat preserved — two pre-existing `new IpcError(msg, code)` calls in client.ts continue to work (optional 3rd arg).
- **Files modified:** `src/shared/errors.ts`, `src/ipc/client.ts`
- **Verification:** ARG-2 test passes; generic ARG-3 test confirms fallback path still renders error message without allowed-list branch.
- **Committed in:** `694d629` (Task 1 GREEN)

**2. [Rule 3 - Blocking] Updated slash-types.test.ts regression tests for the new contract**
- **Found during:** Task 1 GREEN regression sweep (post-edit `npx vitest run src/discord/__tests__/`)
- **Issue:** Two pre-existing tests pinned the OLD contract:
  - `each default command has name, description, claudeCommand fields (all non-empty strings)` asserted `expect(cmd.claudeCommand).toBeTruthy()` for EVERY command — now fails because clawcode-model's claudeCommand is `""`.
  - `the model command has one required option named model of type STRING (3)` asserted `required: true` — now fails because the new contract requires `required: false` so no-arg opens the picker.
- **Fix:** Updated both tests with agent-name-specific branches:
  - The claudeCommand test now has an `if (cmd.name === "clawcode-model") expect(cmd.claudeCommand).toBe("") else expect(...).toBeTruthy()` branch — pins the NEW contract explicitly.
  - The model-option test was renamed to `"has one OPTIONAL option named model"` and asserts `required: false`.
- **Files modified:** `src/discord/__tests__/slash-types.test.ts` (4 lines added across both tests)
- **Verification:** 14/14 slash-types tests green; zero loss of coverage (the OLD assertions are now EXPLICIT about the Phase 86 break).
- **Committed in:** `694d629` (Task 1 GREEN)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - Blocking).
**Impact on plan:** Zero scope creep. Both deviations were direct cascades from the Phase 86 contract change (IpcError.data was an incomplete Plan 02 wiring; slash-types.test.ts pinned the old required/claudeCommand shape that Phase 86 intentionally broke).

## Issues Encountered

- **Pre-existing `src/ipc/__tests__/protocol.test.ts > IPC_METHODS > includes all required methods`** — identical failure pre/post Plan 03. Already documented in Plan 02 SUMMARY (Phase 85 added `list-mcp-status` to IPC_METHODS but the exact-match assertion in protocol.test.ts wasn't updated). Out of scope for Plan 03.
- **38 pre-existing TS errors** — identical count pre/post Plan 03. All predate (image/types.ts ImageProvider export, session-manager WarmPathResult mismatches, budget.ts type comparison, tasks/task-manager.ts causationId missing, etc.) per Plan 01 + Plan 02 SUMMARY records. None touch Plan 03 code.

## User Setup Required

None — no external service configuration required. Zero new npm deps.

## Known Stubs

None. Every new code path is wired to real production code:
- `handleModelCommand` is invoked by the real `handleInteraction` dispatcher.
- `dispatchModelChange` calls real `sendIpcRequest(SOCKET_PATH, "set-model", ...)` against the daemon's `handleSetModelIpc` (Plan 02).
- `promptCacheInvalidationConfirm` is called from within `dispatchModelChange` whenever `sessionManager.getModelForAgent()` returns a defined value.
- `IpcError.data` propagation means `/clawcode-model` consumers see the real ManagerNotAllowedError payload from Plan 02's server-side wiring.
- Zero mock paths in production code; all mocks live in `__tests__` directories.

## Next Phase Readiness

- **Phase 86 is COMPLETE.** All 3 plans shipped: Plan 01 (SDK wiring + allowlist + ModelNotAllowedError), Plan 02 (IPC persistence + /clawcode-status live model), Plan 03 (slash command + picker + confirmation).
- **PROJECT.md tech debt line 150 CLOSED.** The `/model slash command uses indirect claudeCommand routing through agent LLM` entry can be removed (or marked resolved) in the next PROJECT.md update.
- **Phase 87 setPermissionMode pattern locked in.** The Phase 86 trilogy establishes the end-to-end template Phase 87 will follow:
  - SDK canary blueprint (Phase 83 → Phase 86 Plan 01) for the mutation handle.
  - Pure-exported IPC handler (Phase 86 Plan 02) for daemon routing.
  - StringSelectMenuBuilder + ButtonBuilder inline handler (Phase 86 Plan 03) for the Discord picker.
  - Typed-error envelope through ManagerError.data + IpcError.data for client-side UI rendering.
- **UI-01 validation for Phase 86:** fully compliant end-to-end. StringSelectMenuBuilder for the picker, ButtonBuilder for the confirmation, EmbedBuilder for /clawcode-tools (Phase 85), native choices for /clawcode-effort (Phase 83). Phase 87 + 88 acceptance criteria must continue the pattern.
- **Zero npm churn.** v2.2 milestone still runs on existing stack (SDK 0.2.97, discord.js 14.26.2, yaml 2.x, zod 4.3.6, vitest 4.1.3).

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/discord/__tests__/slash-commands-model-picker.test.ts` (510 lines)
- FOUND: `src/discord/__tests__/slash-commands-model-confirm.test.ts` (439 lines)
- FOUND: commit `8a953e1` (Task 1 RED)
- FOUND: commit `694d629` (Task 1 GREEN)
- FOUND: commit `1b0b20f` (Task 2 RED)
- FOUND: commit `016f504` (Task 2 GREEN)
- NOT FOUND: `"Set my model to"` as live routing in `src/` (0 hits outside test assertions + documentary comments — LLM-prompt routing retired)
- FOUND: `StringSelectMenuBuilder` in `src/discord/slash-commands.ts` (5+ refs: import + handler usage + docstrings)
- FOUND: `ButtonBuilder` in `src/discord/slash-commands.ts` (5+ refs: import + confirmation usage)
- FOUND: `handleModelCommand` in `src/discord/slash-commands.ts` (2 refs: declaration + dispatch call)
- FOUND: `promptCacheInvalidationConfirm` in `src/discord/slash-commands.ts` (2 refs: declaration + dispatchModelChange call)
- FOUND: `"model-not-allowed"` in `src/discord/slash-commands.ts` (2 refs: docstring + runtime check)
- FOUND: `"set-model"` IPC method ref in `src/discord/slash-commands.ts` (1 ref — dispatch site)
- FOUND: `MODEL_CONFIRM_TTL_MS` (3 refs: constant decl + docstring + usage)
- FOUND: `IpcError` extended with `data` in `src/shared/errors.ts` (3-arg constructor)
- FOUND: 17 new Plan 03 tests (10 picker + 7 confirm) all GREEN
- FOUND: 181/181 discord test suite GREEN
- FOUND: zero new TS errors (38 pre/post Plan 03 — identical to Phase 86 Plan 01 + Plan 02)

---
*Phase: 86-dual-discord-model-picker-core*
*Completed: 2026-04-21*
