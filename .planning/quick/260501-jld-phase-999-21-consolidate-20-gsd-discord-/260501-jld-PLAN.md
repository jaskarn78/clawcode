---
phase: 999.21-consolidate-gsd-discord-slash-commands
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/discord/slash-types.ts
  - src/discord/slash-commands.ts
  - src/discord/__tests__/slash-types-gsd-commands.test.ts
  - src/discord/__tests__/slash-commands-gsd.test.ts
  - src/discord/__tests__/slash-commands-gsd-register.test.ts
  - src/discord/__tests__/slash-commands-gsd-capability.test.ts
  - src/discord/__tests__/slash-commands-gsd-nested.test.ts
autonomous: true
requirements:
  - 999.21-CONSOLIDATE
must_haves:
  truths:
    - "Discord guild registers exactly ONE top-level command named `get-shit-done` (the 19 flat `gsd-*` entries no longer appear in the slash menu)"
    - "`/get-shit-done` exposes 19 nested subcommands whose subcommand-names map verbatim to the suffix of the old flat names (autonomous, plan-phase, execute-phase, debug, quick, new-project, new-milestone, add-phase, add-tests, audit-milestone, complete-milestone, cleanup, progress, verify-work, discuss-phase, do, fast, help, set-project)"
    - "Each subcommand's `claudeCommand` text is byte-identical to the pre-edit flat command's `claudeCommand` (e.g. `/gsd:autonomous {args}` for the `autonomous` subcommand)"
    - "`/get-shit-done set-project path:<abs>` still routes to `handleSetGsdProjectCommand` (inline handler) — NOT the generic claudeCommand-substitution path"
    - "`/get-shit-done autonomous`, `/get-shit-done plan-phase`, `/get-shit-done execute-phase` still spawn a subagent thread via `handleGsdLongRunner` (long-runner short-circuit preserved)"
    - "`/get-shit-done debug` and `/get-shit-done quick` (short-runners) still route through the legacy agent-routed branch with formatCommandMessage placeholder substitution intact"
    - "`bun tsc --noEmit` (or `npx tsc --noEmit`) passes; `bun test src/discord` (or `npx vitest run src/discord`) passes"
  artifacts:
    - path: "src/discord/slash-types.ts"
      provides: "Restructured GSD_SLASH_COMMANDS with `subcommandOf: 'get-shit-done'` field on each entry; SlashCommandDef type extended with optional `subcommandOf?: string`"
      contains: "subcommandOf: \"get-shit-done\""
    - path: "src/discord/slash-commands.ts"
      provides: "Registration loop groups subcommandOf entries into a single Discord builder; dispatch resolves nested commandName + getSubcommand() before all existing inline-handler short-circuits"
      contains: "get-shit-done"
    - path: "src/discord/__tests__/slash-commands-gsd-nested.test.ts"
      provides: "Regression test: registers exactly 1 top-level `get-shit-done` command with 19 subcommands; verbatim claudeCommand mapping for all wrapped entries; set-project subcommand routes to inline handler not generic path"
      min_lines: 60
  key_links:
    - from: "src/discord/slash-commands.ts (register loop)"
      to: "Discord REST PUT body"
      via: "single composite get-shit-done entry with options array of type=1 SUB_COMMAND children"
      pattern: "type:\\s*1"
    - from: "src/discord/slash-commands.ts (handleInteraction)"
      to: "existing inline handlers + GSD_LONG_RUNNERS + agent-routed branch"
      via: "early-stage rewrite: if commandName === 'get-shit-done' → derive subName via interaction.options.getSubcommand() and remap to legacy `gsd-${subName}` for all downstream code paths (single rewrite point preserves every existing carve-out)"
      pattern: "getSubcommand"
---

<objective>
Phase 999.21 — collapse the 19 flat `gsd-*` Discord slash commands into a single top-level `/get-shit-done` command with 19 nested subcommands.

Purpose:
  - Reclaim 18 slots in Discord's per-guild 100-command cap (the GSD set is the largest single block in the registration body).
  - Make the slash menu self-organizing — operators see one `get-shit-done` namespace instead of a wall of `gsd-*` entries.
  - Internal dispatch semantics stay byte-identical: claudeCommand text values, long-runner subagent-thread spawn, gsd-set-project inline handler, agent-routed short-runners (debug/quick) all preserved.

Output:
  - Restructured GSD_SLASH_COMMANDS in slash-types.ts (each entry gains `subcommandOf: "get-shit-done"`).
  - Registration + dispatch updates in slash-commands.ts (one composite entry on the wire; rewrite-to-flat-name at the dispatch entry point).
  - Existing 4 GSD test files updated for the nested form; one new regression test file pinning the consolidation.

NOTE on count: task_detail said "20" — the actual GSD_SLASH_COMMANDS array has 19 entries (verified: `grep -c "^    name: \"gsd-"` returns 19; existing test `slash-types-gsd-commands.test.ts:31` already pins `expect(GSD_SLASH_COMMANDS).toHaveLength(19)`). All counts in this plan use 19.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

@src/discord/slash-types.ts
@src/discord/slash-commands.ts
@src/discord/__tests__/slash-types-gsd-commands.test.ts
@src/discord/__tests__/slash-commands-gsd.test.ts
@src/discord/__tests__/slash-commands-gsd-register.test.ts
@src/discord/__tests__/slash-commands-gsd-capability.test.ts
@src/discord/__tests__/slash-commands-skills-browse.test.ts

<architectural_decision>
**Chosen: Option A (Wrap-and-keep) — recommended by task_detail and ratified after reading the code.**

Why A over B:
  - Each existing GSD_SLASH_COMMANDS entry stays in place; only adds an optional `subcommandOf?: string` field on SlashCommandDef and changes each entry's `name` from `"gsd-autonomous"` → `"autonomous"`.
  - claudeCommand text values stay byte-identical (this is the consolidation's hard invariant).
  - Existing dispatch carve-outs (handleSetGsdProjectCommand, handleGsdLongRunner, formatCommandMessage agent-routed branch) need ONE rewrite point at the top of handleInteraction — they continue to look up by the legacy flat name once we remap `get-shit-done`+`<sub>` → `gsd-<sub>` at entry. Minimal blast radius downstream.
  - The auto-inheritance loop (slash-commands.ts:1143) and the GSD_LONG_RUNNERS lookup (slash-commands.ts:1411) and `cmdDef = ...find((c) => c.name === commandName)` (slash-commands.ts:2133) all keep working unchanged because the rewrite-at-entry remaps to the same `gsd-*` strings they currently match against.

Option B (single composite SlashCommandDef with `subcommands: SubcommandDef[]`) was rejected: cleaner final shape but rewrites the dedup loop (slash-commands.ts:1124-1148), the long-runner cmdDef resolver (slash-commands.ts:2132-2134), and forces the existing 4 test files to be substantially rewritten rather than name-remapped.
</architectural_decision>

<dispatch_strategy>
**Single rewrite point at the top of handleInteraction (slash-commands.ts:1239).**

Before the existing `commandName === "clawcode-tools"` carve-out, add:

```typescript
// Phase 999.21 — /get-shit-done nested subcommand entry-point rewrite.
// Discord's nested-command shape arrives as commandName === "get-shit-done"
// with the actual command in interaction.options.getSubcommand(). Remap to
// the legacy flat `gsd-<sub>` form so every downstream dispatch carve-out
// (handleSetGsdProjectCommand at L1395, handleGsdLongRunner at L1411,
// agent-routed branch at L1467, GSD_LONG_RUNNERS lookup, cmdDef resolution)
// keeps working unchanged.
let commandName = interaction.commandName;
if (commandName === "get-shit-done") {
  const sub = interaction.options.getSubcommand(false);
  if (sub) {
    commandName = `gsd-${sub}`;
  }
}
```

The variable `commandName` is `const` today at line 1243 — change to `let` (already proposed above). Every existing carve-out that reads `commandName` continues to see `"gsd-autonomous"`, `"gsd-set-project"`, etc. unchanged.

For option extraction in the agent-routed branch (slash-commands.ts:1483-1493), `interaction.options.get(opt.name)` works against subcommand options by default in discord.js v14 (the lib auto-walks into the active subcommand). Verify in implementation; if not, switch to `interaction.options.getString(opt.name, false)` which DOES auto-walk.
</dispatch_strategy>

<registration_strategy>
**Group GSD entries into a single composite REST body element.**

In slash-commands.ts at the body-build step (line 1160), split `allCommands` into:
  - `topLevelOnly`: entries with no `subcommandOf` (clawcode-*, control commands).
  - `gsdGroup`: entries with `subcommandOf === "get-shit-done"` (all 19 GSD entries).

Emit ONE composite body item for the GSD group:

```typescript
if (gsdGroup.length > 0) {
  body.push({
    name: "get-shit-done",
    description: "GSD framework — phase planning, execution, debugging",
    options: gsdGroup.map((cmd) => ({
      name: cmd.name,           // "autonomous" / "plan-phase" / etc.
      description: cmd.description,
      type: 1,                  // SUB_COMMAND
      options: cmd.options.map((opt) => ({
        name: opt.name,
        type: opt.type,
        description: opt.description,
        required: opt.required,
        ...(opt.choices && opt.choices.length > 0
          ? { choices: opt.choices.map((c) => ({ name: c.name, value: c.value })) }
          : {}),
      })),
    })),
  });
}
```

Cap impact: 19 entries → 1 entry net (-18 against MAX_COMMANDS_PER_GUILD). Discord caps subcommands at 25 per top-level command — 19 fits.

`default_member_permissions` precedent: none of the 19 GSD entries currently set this, so no per-subcommand permission bitmask handling needed in v1. (Discord scopes `default_member_permissions` at the top-level command only — even if a subcommand wanted one, Discord would reject it. Note this in SUMMARY.md.)
</registration_strategy>

<naming_map>
| Old flat name (Discord) | New nested form (Discord) | New `name` in slash-types.ts | claudeCommand (UNCHANGED) |
|---|---|---|---|
| /gsd-autonomous | /get-shit-done autonomous | `autonomous` | `/gsd:autonomous {args}` |
| /gsd-plan-phase | /get-shit-done plan-phase | `plan-phase` | `/gsd:plan-phase {phase}` |
| /gsd-execute-phase | /get-shit-done execute-phase | `execute-phase` | `/gsd:execute-phase {phase}` |
| /gsd-debug | /get-shit-done debug | `debug` | `/gsd:debug {issue}` |
| /gsd-quick | /get-shit-done quick | `quick` | `/gsd:quick {task}` |
| /gsd-new-project | /get-shit-done new-project | `new-project` | `/gsd:new-project {args}` |
| /gsd-new-milestone | /get-shit-done new-milestone | `new-milestone` | `/gsd:new-milestone {args}` |
| /gsd-add-phase | /get-shit-done add-phase | `add-phase` | `/gsd:add-phase {args}` |
| /gsd-add-tests | /get-shit-done add-tests | `add-tests` | `/gsd:add-tests {args}` |
| /gsd-audit-milestone | /get-shit-done audit-milestone | `audit-milestone` | `/gsd:audit-milestone` |
| /gsd-complete-milestone | /get-shit-done complete-milestone | `complete-milestone` | `/gsd:complete-milestone {args}` |
| /gsd-cleanup | /get-shit-done cleanup | `cleanup` | `/gsd:cleanup` |
| /gsd-progress | /get-shit-done progress | `progress` | `/gsd:progress` |
| /gsd-verify-work | /get-shit-done verify-work | `verify-work` | `/gsd:verify-work {args}` |
| /gsd-discuss-phase | /get-shit-done discuss-phase | `discuss-phase` | `/gsd:discuss-phase {phase}` |
| /gsd-do | /get-shit-done do | `do` | `/gsd:do {task}` |
| /gsd-fast | /get-shit-done fast | `fast` | `/gsd:fast {task}` |
| /gsd-help | /get-shit-done help | `help` | `/gsd:help {args}` |
| /gsd-set-project | /get-shit-done set-project | `set-project` | `""` (inline handler) |

After the rewrite-at-entry remap (`get-shit-done`+`<sub>` → `gsd-<sub>`), all internal lookups by `commandName` see the same legacy strings.
</naming_map>

<constraints_verbatim>
- Phase 108 (parallel session) does NOT touch slash-types.ts or slash-commands.ts — safe to land in parallel.
- Phase 999.22 (next quick task) touches src/config/schema.ts only — also safe.
- claudeCommand text values for the 19 wrapped commands MUST be byte-identical pre/post (Task 3 adds a static assertion test that pins this).
- DO NOT change `clawcode-*` commands. DO NOT change the 57 `~/.claude/commands/gsd/*.md` source files.
- DO NOT touch the marketplace skillScope/agentScope code at slash-commands.ts:418-419 — different `gsd-*` references, unrelated to these slash commands.
- **Operator deploy note:** New top-level command name `/get-shit-done` must re-register with Discord (slash command cache). The 19 old `/gsd-*` entries stop appearing once the new registration replaces them. Document in SUMMARY.md.
</constraints_verbatim>

</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Restructure GSD_SLASH_COMMANDS to subcommand form + adjust SlashCommandDef type</name>
  <files>
    src/discord/slash-types.ts
    src/discord/__tests__/slash-types-gsd-commands.test.ts
  </files>
  <behavior>
    - SlashCommandDef gains optional `subcommandOf?: string` field (typed, documented).
    - Every entry in GSD_SLASH_COMMANDS gains `subcommandOf: "get-shit-done"`.
    - Every entry's `name` field is renamed from `"gsd-<x>"` → `"<x>"` per the naming_map table (e.g. `"gsd-autonomous"` → `"autonomous"`, `"gsd-set-project"` → `"set-project"`).
    - claudeCommand strings stay BYTE-IDENTICAL to pre-edit values (no whitespace, casing, or template-placeholder changes).
    - GSD_SLASH_COMMANDS still has exactly 19 entries.
    - Existing test `slash-types-gsd-commands.test.ts` is updated:
      - Length assertion stays `19` (already correct).
      - GS1c name-presence assertions update from `expect(names).toContain("gsd-autonomous")` → `expect(names).toContain("autonomous")` for all 5 originals AND all 14 follow-up names AND `set-project`.
      - Add a new GS1k test: every entry has `subcommandOf === "get-shit-done"`.
      - Add a new GS1l test: claudeCommand byte-identity table — for each of the 19 entries, assert exact string match against the pre-edit value (this is the byte-identity invariant pin).
      - GS1e (gsd-set-project empty claudeCommand) updates the find target to `"set-project"`.
      - GS1h (gsd-set-project path option) updates find target to `"set-project"`.
      - GS1i (gsd-autonomous args option) updates find target to `"autonomous"`.
      - GS1j (gsd-debug issue option) updates find target to `"debug"`.
  </behavior>
  <action>
    1. Read `src/discord/slash-types.ts` lines 64-110 (SlashCommandDef type) and lines 280-435 (GSD_SLASH_COMMANDS).
    2. Add `readonly subcommandOf?: string;` to `SlashCommandDef` type with a JSDoc block explaining: "Phase 999.21 — when set, the registration loop nests this entry under the named top-level command as a SUB_COMMAND (Discord type=1) instead of registering it as a standalone slash command. Internal dispatch (handleInteraction) rewrites `<top-level>+<sub>` back to the legacy flat name on entry so existing carve-outs keep working unchanged."
    3. Rewrite all 19 entries in GSD_SLASH_COMMANDS:
       - Change `name: "gsd-autonomous"` → `name: "autonomous"`. Add `subcommandOf: "get-shit-done"` immediately after the `name` line.
       - Repeat for all 19 entries per the naming_map table (suffix-only rename).
       - claudeCommand strings stay byte-identical. options arrays unchanged.
    4. Update the JSDoc block at slash-types.ts:255-279 to reflect the new shape: still single source of truth, now nested under `/get-shit-done`. Mention the rewrite-at-entry behavior.
    5. Update `src/discord/__tests__/slash-types-gsd-commands.test.ts`:
       - All `expect(names).toContain("gsd-X")` → `expect(names).toContain("X")` (suffix only).
       - All `find((c) => c.name === "gsd-set-project")` → `find((c) => c.name === "set-project")` (and similar for other named lookups).
       - Add GS1k: `for (const cmd of GSD_SLASH_COMMANDS) { expect(cmd.subcommandOf).toBe("get-shit-done"); }`.
       - Add GS1l: claudeCommand byte-identity table — a const map of { subname → expected claudeCommand } for all 19, asserted via forEach. Include the empty string for `set-project`. Use the table from the naming_map above verbatim.
    6. Run `npx tsc --noEmit src/discord/slash-types.ts` (whole project compiles via `npx tsc --noEmit` is fine too) — must pass.
    7. Run `npx vitest run src/discord/__tests__/slash-types-gsd-commands.test.ts` — must pass.

    Pitfall: this task ONLY touches slash-types.ts + its companion test. Do NOT touch slash-commands.ts in this task — Task 2 handles all dispatch + registration changes. Other test files (slash-commands-gsd*.test.ts) WILL break temporarily after this task lands and Task 2 fixes them. Run the full `bun test src/discord` only AFTER Task 2 completes.
  </action>
  <verify>
    <automated>npx vitest run src/discord/__tests__/slash-types-gsd-commands.test.ts &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>
    GSD_SLASH_COMMANDS has 19 entries each with `subcommandOf: "get-shit-done"` and stripped names. claudeCommand byte-identity test (GS1l) passes. tsc clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire registration grouping + dispatch rewrite-at-entry; fix existing 3 gsd test files</name>
  <files>
    src/discord/slash-commands.ts
    src/discord/__tests__/slash-commands-gsd.test.ts
    src/discord/__tests__/slash-commands-gsd-register.test.ts
    src/discord/__tests__/slash-commands-gsd-capability.test.ts
  </files>
  <behavior>
    - Registration loop in `register()` (slash-commands.ts ~L1160): `body` includes ONE composite `get-shit-done` entry (not 19 flat entries) when `hasGsdEnabledAgent` is true. The composite entry has 19 `options` items each with `type: 1` (SUB_COMMAND). Non-GSD top-level commands (clawcode-*, CONTROL_COMMANDS) remain unchanged.
    - `GSD_LONG_RUNNERS` set in slash-commands.ts:159-163 stays unchanged (`gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`) — the rewrite-at-entry remaps to these legacy strings.
    - `handleInteraction` (slash-commands.ts:1239): `commandName` becomes `let`; immediately after extraction, if `commandName === "get-shit-done"` then `commandName = "gsd-" + interaction.options.getSubcommand(false)`.
    - All existing inline-handler short-circuits, GSD_LONG_RUNNERS check, and agent-routed branch keep working without modification.
    - The auto-inheritance loop at slash-commands.ts:1143 keeps using `cmd.name` for `seenNames` dedup — but since `cmd.name` is now `"autonomous"` not `"gsd-autonomous"`, ensure no collision with future top-level command names. (Inspect: `seenNames` is keyed off the FULL flat top-level command name. Since GSD entries are now subcommands, they should NOT participate in `seenNames` dedup at the top-level command layer — they share the single `get-shit-done` slot. Fix: in the dedup loop, skip entries with `subcommandOf` set, then treat the synthesized `get-shit-done` composite as the deduped top-level entry.)
    - Specifically in the register() loop:
      - Phase 100 follow-up auto-inheritance loop (~L1142-1148): when `cmd.subcommandOf` is set, the entry is collected into a separate `gsdSubcommands` array and NOT pushed into `allCommands` directly (those are top-level only). seenNames check unchanged for top-levels.
      - After `allCommands` is built (post-CONTROL_COMMANDS append), if `gsdSubcommands.length > 0` synthesize the composite top-level body item described in `<registration_strategy>` and push it into `body` BEFORE the `MAX_COMMANDS_PER_GUILD` check (so the 1 composite entry counts, not 19).
    - Existing tests `slash-commands-gsd.test.ts`, `slash-commands-gsd-register.test.ts`, `slash-commands-gsd-capability.test.ts` must be updated to:
      - Mock `interaction.commandName = "get-shit-done"` and provide `interaction.options.getSubcommand(name?: boolean)` returning the appropriate subcommand string for any test that previously set `commandName = "gsd-X"`.
      - Where the test asserts the REST body contents (slash-commands-gsd-register.test.ts), update to expect ONE `get-shit-done` body item with 19 `options` entries (type=1) instead of 19 separate top-level body items.
      - Where capability/long-runner tests set `commandName = "gsd-autonomous"` etc., switch to `commandName = "get-shit-done"` + `options.getSubcommand` returning `"autonomous"`.
  </behavior>
  <action>
    1. Read slash-commands.ts:
       - L1124-1148 (auto-inheritance dedup loop)
       - L1159-1186 (body build + REST PUT)
       - L1239-1416 (handleInteraction entry + carve-outs)
       - L1466-1493 (agent-routed branch + option extraction)
       - L2088-2218 (handleGsdLongRunner — note where it reads `commandName` parameter; no change needed once the caller passes the remapped flat name).
    2. **Dispatch rewrite-at-entry** (handleInteraction, ~L1239-1244):
       - Change `const commandName = interaction.commandName;` → `let commandName = interaction.commandName;`
       - Immediately after: insert the `get-shit-done` → `gsd-${sub}` remap block from `<dispatch_strategy>`.
       - Add a defensive `if (!sub) { /* malformed — Discord guarantees a subcommand for top-levels with subcommands but log + return */ }` branch that logs and replies "Missing subcommand" ephemerally.
    3. **Registration grouping** (register, ~L1124-1186):
       - Build a `gsdSubcommands: SlashCommandDef[]` array. In the auto-inheritance loop, when `cmd.subcommandOf === "get-shit-done"`, push to `gsdSubcommands` instead of `allCommands`. (Defense: `seenNames` for nested still applies — push only if `!seenNames.has("get-shit-done:" + cmd.name)`, then add that key.)
       - Mirror the same skip-and-collect logic in the per-agent merge loop (slash-commands.ts:1124-1129) so any agent yaml entry that defines a `subcommandOf` field also gets routed into `gsdSubcommands`.
       - At the body-build step, after the existing `body = allCommands.map(...)`, append one composite GSD body item if `gsdSubcommands.length > 0`. Code per `<registration_strategy>`. Use `description: "GSD framework — phase planning, execution, debugging"`.
       - The MAX_COMMANDS_PER_GUILD check at L1191 now sees ONE entry for GSD instead of 19 — assertion still valid.
    4. **Agent-routed branch option extraction** (~L1483-1493): no change needed if discord.js v14 `interaction.options.get(name)` auto-walks into the active subcommand. **Verify by reading discord.js types in node_modules** before assuming. If it does NOT auto-walk, switch to `interaction.options.getString(opt.name, false) ?? interaction.options.getInteger(opt.name, false) ?? ...` typed-getter ladder which DOES auto-walk per discord.js v14 docs.
    5. **GSD_LONG_RUNNERS set unchanged** at L159-163 — the rewrite-at-entry already produces `gsd-autonomous` / `gsd-plan-phase` / `gsd-execute-phase` strings.
    6. **handleSetGsdProjectCommand path validation** (L2243+): unchanged. The carve-out check at L1395 (`if (commandName === "gsd-set-project")`) still matches because of the rewrite-at-entry.
    7. **Update `slash-commands-gsd.test.ts`** (547 lines): every `commandName: "gsd-X"` test interaction → `commandName: "get-shit-done"` + add `options.getSubcommand` mock returning `"X"`. Mirror the existing test's interaction-mock factory pattern; create a small helper `makeNestedInteraction(sub, args)` if useful.
    8. **Update `slash-commands-gsd-register.test.ts`** (167 lines): the body-shape assertions need to expect one `get-shit-done` entry whose `options` array has 19 type=1 children. Update name-presence loops accordingly.
    9. **Update `slash-commands-gsd-capability.test.ts`** (489 lines): same `commandName` + `getSubcommand` mock updates.
    10. Run `npx tsc --noEmit` — must pass.
    11. Run `npx vitest run src/discord` — must pass (all GSD test files + the unchanged skills-browse / model / etc. files).

    Pitfall 1 (`interaction.options.get` semantics): discord.js v14 `CommandInteractionOptionResolver.get(name)` returns the option from the resolved subcommand if a subcommand is active, but `options.getSubcommand()` MUST be called first to anchor it. The rewrite-at-entry block calls getSubcommand, so subsequent option lookups in handleGsdLongRunner (L2147) and the agent-routed branch (L1485) will resolve correctly. Verify by reading `node_modules/discord.js/typings/index.d.ts` `CommandInteractionOptionResolver` for the auto-walk behavior — if uncertain, switch to typed getters.

    Pitfall 2 (`setName` lower-case constraint): Discord rejects subcommand names with uppercase letters. All 19 names per the naming_map are already lower-kebab-case — verify once during implementation.

    Pitfall 3 (deferReply order): The early `getSubcommand` call happens BEFORE any deferReply. If the interaction is malformed and the call throws, the existing `interaction.reply({ ephemeral: true, content: "..." })` fallback covers it. No deferReply ordering change needed.

    Pitfall 4 (mock interaction shape in test files): existing tests build interactions like `{ commandName: "gsd-X", options: { get: vi.fn() } }`. After rewrite-at-entry, tests need `{ commandName: "get-shit-done", options: { get: vi.fn(), getSubcommand: vi.fn().mockReturnValue("X") } }`. Add helper to `slash-commands-gsd*.test.ts` files to reduce boilerplate.
  </action>
  <verify>
    <automated>npx tsc --noEmit &amp;&amp; npx vitest run src/discord</automated>
  </verify>
  <done>
    register() emits ONE `get-shit-done` body item with 19 type=1 sub-options; handleInteraction's rewrite-at-entry routes all 19 subcommands to their existing carve-outs (handleSetGsdProjectCommand, handleGsdLongRunner, agent-routed branch) byte-identically. All 4 existing GSD test files pass. tsc clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add nested-registration regression test pinning the consolidation invariants</name>
  <files>
    src/discord/__tests__/slash-commands-gsd-nested.test.ts
  </files>
  <behavior>
    New regression test file pins the four hard invariants of the consolidation:
    1. **Single top-level**: register() emits exactly ONE body item with `name === "get-shit-done"` (no flat `gsd-*` entries leak through).
    2. **19 subcommand options**: that entry's `options` array has exactly 19 items, each with `type === 1` (SUB_COMMAND), and the set of `option.name` values matches the 19 names from the naming_map (autonomous, plan-phase, execute-phase, debug, quick, new-project, new-milestone, add-phase, add-tests, audit-milestone, complete-milestone, cleanup, progress, verify-work, discuss-phase, do, fast, help, set-project).
    3. **claudeCommand byte-identity end-to-end**: import GSD_SLASH_COMMANDS, build a name→claudeCommand map, assert every entry's claudeCommand matches its expected pre-edit value verbatim (dup of GS1l in slash-types-gsd-commands.test.ts but here scoped to the registration body to catch any future register-loop bug that mutates claudeCommand on the way to Discord — defensive depth).
    4. **set-project routes to inline handler not generic path**: simulate an interaction with `commandName = "get-shit-done"` + `options.getSubcommand → "set-project"`. Assert that `handleSetGsdProjectCommand` is invoked (spy on the method) and that `formatCommandMessage` / TurnDispatcher / agent-routed branch are NOT called. Use vi.spyOn pattern from slash-commands-skills-browse.test.ts.
    5. **Long-runner routes preserved**: simulate `get-shit-done` + `autonomous` and assert `handleGsdLongRunner` is invoked (spy + mock subagentThreadSpawner). Mirror existing tests in slash-commands-gsd-capability.test.ts.
    6. **Short-runner routes preserved**: simulate `get-shit-done` + `debug` with `issue` option = "test-issue" and assert the agent-routed branch executes (formatCommandMessage produces `/gsd:debug test-issue` byte-identical to pre-edit behavior).
  </behavior>
  <action>
    1. Read `src/discord/__tests__/slash-commands-skills-browse.test.ts` (already in `<context>`) — copy the SlashCommandHandler test harness pattern: `stubLogger`, `makeAgent`, `stubSessionManager`, `makeHandler`. The harness gives a real SlashCommandHandler instance with mocked Discord client + IPC.
    2. Read `src/discord/__tests__/slash-commands-gsd-register.test.ts` for the body-shape assertion pattern (it captures the `rest.put` call's `body` arg via vi.mock on `@discordjs/rest`).
    3. Create `src/discord/__tests__/slash-commands-gsd-nested.test.ts` with describe block `"Phase 999.21 — /get-shit-done nested consolidation"`:
       - Test "GSDN-01: register emits exactly 1 top-level get-shit-done entry" — use the rest.put-capture pattern, assert `body.filter(e => e.name === "get-shit-done").length === 1` and no body entry has a `gsd-*` prefixed name.
       - Test "GSDN-02: composite entry has 19 type=1 subcommand options with the expected names" — assert the options array shape.
       - Test "GSDN-03: claudeCommand byte-identity preserved" — table-driven loop over the 19-entry naming_map with claudeCommand values.
       - Test "GSDN-04: set-project subcommand routes to handleSetGsdProjectCommand" — vi.spyOn the private method (or spy on the IPC mock) and assert the inline handler ran while `formatCommandMessage` did not.
       - Test "GSDN-05: autonomous subcommand routes to handleGsdLongRunner with subagent thread spawn" — mock `subagentThreadSpawner.spawnInThread` and assert it's called with `task: "/gsd:autonomous <args>"` byte-identical canonical form.
       - Test "GSDN-06: debug subcommand routes through agent-routed branch with formatCommandMessage producing '/gsd:debug <issue>' byte-identical" — mock the agent dispatch path and capture the formatted message.
    4. Run `npx vitest run src/discord/__tests__/slash-commands-gsd-nested.test.ts` — must pass.
    5. Run full `npx vitest run src/discord` + `npx tsc --noEmit` for final regression sweep.

    Pitfall: vi.spyOn on private class methods requires casting — use `(handler as unknown as { handleSetGsdProjectCommand: typeof handler["handleSetGsdProjectCommand"] }).handleSetGsdProjectCommand` pattern. Existing tests already do this for `handleInteraction` (slash-commands-skills-browse.test.ts:160) — copy the pattern.
  </action>
  <verify>
    <automated>npx vitest run src/discord/__tests__/slash-commands-gsd-nested.test.ts &amp;&amp; npx vitest run src/discord &amp;&amp; npx tsc --noEmit</automated>
  </verify>
  <done>
    New regression test file lives at the path above, contains 6 tests (GSDN-01 through GSDN-06), all passing. Full src/discord vitest run is green. tsc clean.
  </done>
</task>

</tasks>

<verification>
Final phase-level checks (run from repo root):

1. **Type check**: `npx tsc --noEmit` exits 0.
2. **Test suite**: `npx vitest run src/discord` — all GSD-related test files (slash-types-gsd-commands, slash-commands-gsd, slash-commands-gsd-register, slash-commands-gsd-capability, slash-commands-gsd-nested) plus all unchanged sibling test files pass.
3. **Byte-identity grep**: `grep -E '^    claudeCommand:' src/discord/slash-types.ts | grep -c '"/gsd:'` returns 18 (19 entries minus set-project's empty string). Compare against pre-edit count if possible (should be 18).
4. **Spot-check naming_map**: `grep -E 'name: "(autonomous|plan-phase|execute-phase|debug|quick|set-project)"' src/discord/slash-types.ts` returns 6 lines.
5. **No leaked flat names in Discord registration**: read register() output mentally — body for GSD-enabled guild has one `get-shit-done` entry, not 19 flat ones.
6. **Long-runner regression**: in interactive review, mentally trace `/get-shit-done autonomous args:--from 100` → rewrite-at-entry produces `commandName = "gsd-autonomous"` → GSD_LONG_RUNNERS.has("gsd-autonomous") → handleGsdLongRunner called → cmdDef found via `GSD_SLASH_COMMANDS.find((c) => c.name === "gsd-autonomous")` ❌ FAILS now because the entry's name is `"autonomous"` not `"gsd-autonomous"`.

   **Fix during Task 2**: at the cmdDef lookup in handleGsdLongRunner (slash-commands.ts:2132-2134), the lookup must search by the new naming. Two options:
     a. Strip the `gsd-` prefix before lookup: `const subName = commandName.replace(/^gsd-/, ""); const cmdDef = GSD_SLASH_COMMANDS.find((c) => c.name === subName);` — minimal change, keeps the rewrite-at-entry remap intact.
     b. Pass the original raw subcommand string through to handleGsdLongRunner.
   **Choose (a)** — the rewrite-at-entry remap makes `commandName = "gsd-autonomous"` for backward compat with GSD_LONG_RUNNERS check, then strip prefix at the cmdDef lookup site. Apply the same prefix-strip pattern at slash-commands.ts:1471 (agent-routed branch `agentCommands.find((c) => c.name === commandName)`) for short-runners (gsd-debug, gsd-quick).

   **Action item promoted to Task 2**: add the `commandName.replace(/^gsd-/, "")` strip at:
     - slash-commands.ts:1471 (agent-routed cmdDef lookup) — gated on `interaction.commandName === "get-shit-done"` so non-GSD agent commands stay name-matched as today.
     - slash-commands.ts:2133-2134 (handleGsdLongRunner cmdDef lookup) — unconditional strip since this function only runs for the 3 long-runners which are always under `get-shit-done`.
     - slash-commands.ts:2162 (`shortName` derivation in handleGsdLongRunner — already strips `gsd-` prefix, no change needed).
     - Also: `agentConfig.slashCommands.find((c) => c.name === commandName)` at L2133 — strip prefix here too.

7. **Operator deploy note for SUMMARY**: include a "Deploy" section telling the operator the next daemon restart will re-register the slash command set; the 19 old `/gsd-*` entries will disappear from the menu and `/get-shit-done` will appear with 19 nested choices. Discord may take up to 1 hour to invalidate cached client-side autocomplete; refresh the Discord client (Ctrl+R) to force.
</verification>

<success_criteria>
- [ ] All 19 GSD entries appear under `/get-shit-done <subcommand>` in the Discord slash menu.
- [ ] Zero flat `gsd-*` entries appear at the top level.
- [ ] Internal claudeCommand text values are byte-identical pre/post — pinned by GS1l (Task 1 test) AND GSDN-03 (Task 3 test).
- [ ] `set-project` subcommand still routes to inline handleSetGsdProjectCommand — pinned by GSDN-04.
- [ ] `autonomous` / `plan-phase` / `execute-phase` still pre-spawn subagent threads — pinned by GSDN-05.
- [ ] `debug` / `quick` / etc. (short-runners) still route through formatCommandMessage agent-routed branch — pinned by GSDN-06.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx vitest run src/discord` exits 0.
- [ ] No changes to ~/.claude/commands/gsd/*.md, no changes to clawcode-* commands, no changes to marketplace skillScope/agentScope code.
</success_criteria>

<output>
After all 3 tasks complete, create `.planning/quick/260501-jld-phase-999-21-consolidate-20-gsd-discord-/260501-jld-SUMMARY.md` per the standard quick-task summary template. Include:
  - Files changed (5 source/test + 1 new test).
  - Net Discord cap delta: -18 (19 flat entries → 1 composite).
  - Operator deploy note: next daemon restart re-registers; old /gsd-* disappear; /get-shit-done appears with 19 subs; Discord client cache may need Ctrl+R.
  - Confirmation that claudeCommand text values are byte-identical (cite GS1l + GSDN-03 test pins).
  - Confirmation that ~/.claude/commands/gsd/*.md (57 files) were not touched.
</output>
