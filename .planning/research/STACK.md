# Stack Research — v2.2 OpenClaw Parity & Polish

**Domain:** Subsequent-milestone stack delta for an existing TypeScript multi-agent daemon built on Claude Agent SDK + discord.js + better-sqlite3.
**Researched:** 2026-04-21
**Confidence:** HIGH (every key claim verified against installed `sdk.d.ts` on disk and/or `npm view`)

---

## TL;DR — Zero New Runtime Dependencies

All four v2.2 features ship with **zero new `dependencies`** and **one optional `devDependencies` entry** (`gray-matter`, only if the skills migration utility is retained as a standalone script rather than one-shot code).

| Feature | New dep? | Rationale |
|---------|----------|-----------|
| 1. Skills library migration | **None required** | Existing `src/skills/scanner.ts` already parses the same YAML-frontmatter format OpenClaw uses. One-shot migration can be a Node-native `readFile` + regex tool inside `src/cli/`. |
| 2. Extended-thinking effort mapping | **None** | `@anthropic-ai/claude-agent-sdk@0.2.97` already on-box exposes `thinking: ThinkingConfig` + `query.setMaxThinkingTokens()`. Existing `handle.setEffort()` stub (src/manager/persistent-session-handle.ts:599-602) documents the missing wiring. |
| 3. Dual Discord model picker | **None** | `discord.js@14.26.2` already includes `StringSelectMenuBuilder`, autocomplete interactions, `ApplicationCommandOptionType`. Existing OpenClaw picker pref file (`~/.openclaw/discord/model-picker-preferences.json`) is plain JSON — `fs.readFile` + `JSON.parse` suffices. |
| 4. Native CC slash commands in Discord | **None** | SDK `Query.supportedCommands()` returns `SlashCommand[]`; slash commands dispatched as normal user-prompt strings (e.g., `"/compact"`) through the existing `query.input` stream. `Query.setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `endSession` cover the control-plane commands directly. |

> The quality gate ("zero new deps preferred") is met for the core feature set. The one candidate new dep (`gray-matter@4.0.3`, dev-only) is **explicitly not required** — our in-tree `extractVersion` / `extractDescription` regex in `src/skills/scanner.ts:10-43` already handles every SKILL.md shape found in `~/.openclaw/skills/`.

---

## Existing Stack (Inventory — do NOT re-add)

Verified against `/home/jjagpal/.openclaw/workspace-coding/package.json`:

| Package | Installed | Notes |
|---------|-----------|-------|
| `@anthropic-ai/claude-agent-sdk` | `^0.2.97` (npm latest `0.2.116` as of 2026-04-21) | Pre-1.0 — minor-version breakage risk flagged below |
| `discord.js` | `^14.26.2` (npm latest `14.26.3`) | Covers select menus + autocomplete natively |
| `better-sqlite3` | `^12.8.0` | n/a for v2.2 |
| `sqlite-vec` | `^0.1.9` | n/a for v2.2 |
| `@huggingface/transformers` | `^4.0.1` | n/a for v2.2 |
| `zod` | `^4.3.6` | Re-used for slash-command schema validation |
| `yaml` | `^2.8.3` | **Already present** — covers clawcode.yaml allowed-model parsing |
| `croner` | `^10.0.1` | n/a for v2.2 |
| `execa` | — *(NOT in package.json)* | Contradicts `CLAUDE.md` — execa is NOT an actual dep; use `node:child_process` if process spawning is ever needed |
| `pino` | `^9` | Structured logging for new slash-command paths |

---

## Feature-by-Feature Stack Delta

### 1. Skills Library Migration (`~/.openclaw/skills/` → ClawCode)

**Decision:** **Zero new deps.** Migration is a one-shot TypeScript script under `src/cli/` or `src/skills/` that reuses the existing scanner.

**What's on disk in `~/.openclaw/skills/`:**
```
cognitive-memory/      SKILL.md + UPGRADE.md + _meta.json + assets/ + references/ + scripts/
finmentum-crm/         SKILL.md only
frontend-design/       SKILL.md (+ LICENSE.txt referenced in frontmatter)
new-reel/              SKILL.md + references/ + scripts/
openclaw-config/       (nested structure)
power-apps-builder/    SKILL.md + references/
remotion/              SKILL.md + references/ + scripts/
self-improving-agent/  SKILL.md + .git/ + .learnings/ + assets/ + hooks/ + references/ + scripts/
tuya-ac/               SKILL.md + scripts/
workspace-janitor/     SKILL.md + scripts/
```

**Format gap analysis** — three SKILL.md shapes observed:

| Shape | Example | Handled by existing scanner? |
|-------|---------|------------------------------|
| Standard YAML frontmatter (`name` + `description`) | `finmentum-crm`, `power-apps-builder`, `new-reel`, `frontend-design` | ✅ Yes |
| Frontmatter with extra fields (`metadata:`, `license:`) | `self-improving-agent`, `frontend-design` | ✅ Yes — scanner extracts `version` only, ignores extras (non-lossy) |
| No frontmatter, plain-markdown H1 + description | `workspace-janitor`, `tuya-ac` | ⚠ Partial — scanner's `extractDescription` grabs first paragraph from `# workspace-janitor\n\nOrganizes loose files…` which is **the H1 itself**, not the tagline. Fix: extend `extractDescription` to skip leading `#` headings. |

**Recommended stack additions:** **None.** Extend `src/skills/scanner.ts:extractDescription` (10-line change) to skip leading H1/H2 lines. The scanner already handles every other case.

**Do NOT add:**
- ❌ `gray-matter` (4.0.3) — 20KB of dep for what 8 lines of regex already does. The scanner's `^---\n([\s\S]*?)\n---` pattern is equivalent for our fixed-shape frontmatter.
- ❌ `yaml-front-matter` — unmaintained (last release 2018).
- ❌ `js-yaml` (4.1.1) — we already have `yaml@2.8.3`; don't add a second YAML parser. Frontmatter fields used (`name`, `description`, `version`, `metadata`, `license`) are all simple scalars where regex wins.

**Migration utility shape (pseudocode, to live in `src/cli/migrate-skills.ts`):**
```typescript
import { scanSkillsDirectory } from "../skills/scanner.js";
import { installWorkspaceSkills } from "../skills/installer.js";

// 1. Scan ~/.openclaw/skills/ with existing scanner
// 2. Filter out: .retired suffix, `test` skill, `openclaw-config` (stale)
// 3. For each candidate, cp -r (preserving scripts/, references/, assets/) into
//    <clawcode>/skills/<name>/  then run installWorkspaceSkills.
// 4. Write migration report to .planning/milestones/v2.2-skills-migration.md.
```

Use `node:fs/promises` `cp({recursive: true})` (stable since Node 16.7) for tree copy — no `fs-extra` needed.

**Assets to migrate alongside SKILL.md:** `scripts/`, `references/`, `assets/`, `hooks/`, `.learnings/`. Skip `.git/` (self-improving-agent has a nested repo — would confuse clawcode's git boundary) and `_meta.json` (OpenClaw-specific, ignored by CC skill loader).

---

### 2. Extended-Thinking Effort Mapping (`reasoning_effort` → thinking tokens)

**Decision:** **Zero new deps.** The Claude Agent SDK on-box already exposes the full API surface. The existing `handle.setEffort()` stub (src/manager/persistent-session-handle.ts:599-602) literally leaves a `// Future: q.setMaxThinkingTokens() wiring` TODO comment — that's the gap to close.

**Verified SDK surface (`sdk.d.ts` @ 0.2.97):**

| API | Signature | Use |
|-----|-----------|-----|
| `query.setMaxThinkingTokens(n ⎮ null)` | `(max: number ⎮ null) => Promise<void>` | **Runtime control** — matches openclaw-claude-bridge's `env.MAX_THINKING_TOKENS` behavior. |
| `thinking: ThinkingConfig` (Options) | `{type:'adaptive'} ⎮ {type:'enabled', budgetTokens: N} ⎮ {type:'disabled'}` | **Session-start** option. `adaptive` is Opus 4.6+. |
| `effort: EffortLevel` (Options) | `'low' ⎮ 'medium' ⎮ 'high' ⎮ 'max'` | Session-start option. `'max'` is Opus 4.6 only per SDK docstring (sdk.d.ts:1178). |
| `ModelInfo.supportsEffort: boolean` | — | Gate `effort` option by model capability. |
| `ModelInfo.supportedEffortLevels` | `('low'⎮'medium'⎮'high'⎮'max')[]` | Model-specific allowed levels. |

**Port of `openclaw-claude-bridge/src/claude.js` `mapEffort` (lines 47-58):**

```typescript
// OC input:    'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
// CC effort:   'low' | 'medium' | 'high' | 'max'
const EFFORT_MAP: Record<string, EffortLevel> = {
  minimal: 'low',
  low:     'medium',
  medium:  'high',
  high:    'max',
  xhigh:   'max',
};

// Additionally, OC behavior (claude.js:116-118): when no reasoning_effort set,
// env.MAX_THINKING_TOKENS = '0' (thinking OFF). Translate to SDK:
//   thinking: { type: 'disabled' }   at session start,  OR
//   q.setMaxThinkingTokens(0)        at runtime.
```

**Preferred wiring plan (no new deps):**

1. **Session start** — In `src/manager/session-config.ts` (or wherever `buildSessionConfig` resolves options), map the agent-config `effort` field → SDK `effort:` and `thinking:`.
2. **Runtime override** — Rewire `createPersistentSessionHandle.setEffort` (persistent-session-handle.ts:599) to call the captured `query.setMaxThinkingTokens(effortToTokens(level))`. The Query reference is already held by the handle (it's what powers `.interrupt()`).
3. **Bonus** — Expose `effort` in agent config Zod schema (it's not in `clawcode.yaml` today; the ephemeral `handle.setEffort` is the only surface). Make it optional; default `'medium'`.

**Token budgets** (matches SDK `ThinkingEnabled.budgetTokens` semantics; numbers picked to mirror OC's behavior where `xhigh` was "max"):

```typescript
const EFFORT_TO_TOKENS: Record<EffortLevel, number> = {
  low:    1024,   // fast, minimal
  medium: 4096,   // default in OC bridge ("medium" → "high")
  high:   16384,
  max:    32768,  // Opus-4.6-only; falls back gracefully on non-Opus
};
```

**Version pin guidance:** Bump `@anthropic-ai/claude-agent-sdk` from `^0.2.97` → `^0.2.116` (current latest) **only if** v2.2 features require post-`0.2.97` fixes. The `thinking`, `effort`, and `setMaxThinkingTokens` APIs all exist at `0.2.97` — no bump needed for this feature. Do not move to a caret that crosses a minor (SDK is pre-1.0, treat `0.3.x` as a breaking upgrade).

**Do NOT add:**
- ❌ Any wrapper library (`@anthropic-ai/sdk` with raw thinking blocks) — the Agent SDK is the single orchestration layer, per existing Key Decisions in PROJECT.md.
- ❌ Environment-variable shim (`process.env.MAX_THINKING_TOKENS`) — that's an OC-bridge pattern for when you're spawning `claude` as a subprocess. We're in-process via SDK; set the knob directly.

---

### 3. Dual Discord Model Picker

**Decision:** **Zero new deps.** Both halves use primitives already in `discord.js@14.26.2` and Node-native fs.

**Part A: Keep OpenClaw's picker alive, source models from bound agent**

OpenClaw's picker reads `~/.openclaw/discord/model-picker-preferences.json` — verified shape:
```json
{ "version": 1, "entries": { "discord:default:guild:<guild>:user:<user>": { "recent": [...], "updatedAt": "..." } } }
```

**Integration:** No code change *inside* the existing OC picker (it lives in OpenClaw, not this repo). The parity work is read-side — produce the **model list** the picker consumes from `clawcode.yaml`. The agent's channel → agent name → allowed-models resolution already exists in `src/discord/router.ts` (`getAgentForChannel`). Add a thin resolver `getAllowedModelsForAgent(agentName)` that reads `agent.allowedModels` (new optional field in agent config; defaults to `[agent.model]`).

**Data flow:** OC picker → reads clawcode-exported file (e.g., `~/.clawcode/picker/<channelId>.json`) → user picks → writes back to `model-picker-preferences.json` → clawcode daemon's chokidar watcher picks up the change → `SessionManager.setModel(agentName, pickedModel)` via SDK `query.setModel()` (sdk.d.ts:1711).

**Part B: Native `/clawcode-model` (already exists — needs upgrade)**

The command is already registered in `src/discord/slash-types.ts:102-114` but currently routes through `claudeCommand: "Set my model to {model}"`, i.e., asks the agent to change its own model via natural language. That's the "indirect claudeCommand routing" tech debt called out in PROJECT.md ("Known tech debt").

**Upgrade plan:**
1. Add `control: true` + `ipcMethod: 'set-model'` on the existing `clawcode-model` entry (parallels how `clawcode-effort` already bypasses agent routing at slash-commands.ts:263-284).
2. Add a daemon IPC handler that calls `sessionHandle.query.setModel(model)` directly.
3. For UX sugar, convert the `model` option to **autocomplete**-driven using `discord.js` native autocomplete (`ApplicationCommandOptionType.String` + `autocomplete: true`). Handler resolves per-channel → agent → `allowedModels`.

**Verified discord.js primitives in use on-box:**
- `StringSelectMenuBuilder` (typings/index.d.ts:874) — for an inline picker if we ever want an ephemeral button-triggered UI.
- `ApplicationCommandOptionType` (typings/index.d.ts:105) — already used via the numeric type `3` in slash-types.ts.
- Autocomplete interactions — `interaction.isAutocomplete()` + `interaction.respond([{name, value}])` — first-class in 14.x.

**Cost of add:** ~80 LOC split across `src/discord/slash-commands.ts` (new `handleAutocomplete` branch), `src/manager/session-manager.ts` (new `setModelForAgent`), IPC wiring in `src/manager/daemon.ts`. No deps.

**Config schema addition (Zod, in `src/shared/types.ts`):**
```typescript
allowedModels: z.array(z.string()).optional()  // defaults to [model]
```

**Do NOT add:**
- ❌ `@discordjs/builders` as a separate dep — it's re-exported from `discord.js@14` already.
- ❌ Any slash-command decorator library (e.g., `discordx`, `@sapphire/framework`) — our command registry is a 200-line file and works fine.

---

### 4. Native Claude Code Slash Commands in Discord

**Decision:** **Zero new deps.** This is the most complex of the four but the SDK already exposes everything needed.

**Critical answer to the downstream-consumer question:**

> **Does `@anthropic-ai/claude-agent-sdk`'s `query()` method accept slash commands inline? Is there an API for executing them programmatically?**

**Answer: YES — two mechanisms, use both.**

1. **For content-style commands** (e.g., `/compact`, `/clear`, `/init`, `/review`, `/security-review`, `/todos`, `/memory`, `/agents`, `/mcp`, `/cost`) — **dispatch the raw string through the normal user-message input channel**. Confirmed by the SDK type `SDKLocalCommandOutputMessage` (sdk.d.ts:2475): *"Output from a local slash command (e.g. /voice, /cost). Displayed as assistant-style text in the transcript."* The SDK processes commands client-side and emits a `local_command_output` SDKMessage. The Options docstring at sdk.d.ts:69 even confirms this: *"Auto-submitted as the first user turn when this agent is the main thread agent. **Slash commands are processed.** Prepended to any user-provided prompt."* So sending `"/compact"` through `handle.send("/compact")` triggers the SDK's built-in compact handler.

2. **For control-plane commands** (e.g., `/model`, `/permissions`, native thinking/effort) — **use dedicated Query control methods** — they're faster, don't consume a turn, and return structured results:

| CC slash command | SDK method | Notes |
|------------------|------------|-------|
| `/model <name>` | `query.setModel(name?)` (sdk.d.ts:1711) | Runtime model switch |
| `/permissions <mode>` | `query.setPermissionMode(mode)` (sdk.d.ts:1704) | `'acceptEdits' ⎮ 'plan' ⎮ 'bypassPermissions' ⎮ 'default'` |
| (effort/thinking) | `query.setMaxThinkingTokens(n)` (sdk.d.ts:1728) | Already covered in Feature 2 |
| **discover available** | `query.supportedCommands(): Promise<SlashCommand[]>` (sdk.d.ts:1754) | **This is the key primitive for auto-registration.** |
| **enumerate models** | `query.supportedModels(): Promise<ModelInfo[]>` | Drives autocomplete for `/model` |
| **enumerate agents** | `query.supportedAgents(): Promise<AgentInfo[]>` | For `/agents` UX |

**SDK `SlashCommand` type (verified at sdk.d.ts:4239-4252):**
```typescript
export declare type SlashCommand = {
  name: string;         // skill/command name (no leading slash)
  description: string;
  argumentHint: string; // e.g., "<file>"
};
```

**Discord guild slash command limit:** 100 per application per guild (confirmed current Discord API limit; has been stable since 2021). ClawCode's existing inventory is **~13 commands** (slash-types.ts: 8 default + 5 control + recent `interrupt`/`steer` additions). Native CC commands from `claude` CLI ≈ 20-25 (the set listed in the question plus `/bug`, `/doctor`, `/ide`, `/logout`, `/pr-comments`, `/status`, `/vim`, plus plugin-registered ones). Worst case after v2.2: **~40 commands per guild**, well under 100.

**Command-inventory strategy:**

There's a naming collision risk: `/clawcode-memory` (clawcode) vs `/memory` (CC). Resolve at registration time by **prefixing** CC-native ones with `cc-` (e.g., `/cc-compact`, `/cc-clear`, `/cc-model`) — keeps clawcode's `/clawcode-*` namespace for daemon-direct operations and CC's for session-direct operations. Alternative: drop the `clawcode-` prefix on daemon commands and namespace CC ones with `cc-`. Call the shot during phase design; either way, no library needed — it's just the string concatenated at registration.

**Registration flow:**
```
Daemon boot → for each agent:
  await handle.query.supportedCommands()   // SDK call per session
  merge with clawcode-native + control commands
  dedup + prefix CC-native → register via discord.js REST.put
```

**Dispatch flow:**
```
Discord /cc-compact → SlashCommandHandler.handleInteraction
  → router.getAgentForChannel → agentName
  → sessionManager.streamFromAgent(agentName, "/compact", onChunk)
  → ProgressiveMessageEditor streams the SDKLocalCommandOutputMessage back
```

**For `/model`, `/permissions`, `/cost`** — skip the agent turn; dispatch via `handle.query.setModel(...)` / `setPermissionMode(...)` / read from the existing `UsageTracker`. Mirrors `clawcode-effort`'s direct path at slash-commands.ts:263-284.

**Do NOT add:**
- ❌ A subprocess shim that spawns `claude --print "/compact"` — we're in-process via the Agent SDK. The OC bridge pattern (claude.js spawn-based) does not apply.
- ❌ `@discordjs/rest` — already transitively present under `discord.js`.
- ❌ Any "slash-command parser" library — native string matching + Discord's own option system covers everything.

---

## Version Compatibility Matrix

| Package A | Package B | Verified? | Notes |
|-----------|-----------|-----------|-------|
| `@anthropic-ai/claude-agent-sdk@0.2.97` | Node 22 LTS | ✅ sdk.d.ts declares `engines.node >=18` | Stay on ^0.2.97 unless SDK bump needed — pre-1.0 minor-version breakage risk |
| `@anthropic-ai/claude-agent-sdk@0.2.97` | `discord.js@14.26.2` | ✅ Orthogonal runtimes | SDK is ESM-only; discord.js supports both — project is `"type": "module"`, no conflict |
| `discord.js@14.26.2` | Node 22 LTS | ✅ Official support matrix | v15 still pre-release; stay on 14 |
| `yaml@2.8.3` | existing skills scanner | ✅ Already used | Regex path is zero-dep and handles every observed SKILL.md shape; only reach for `yaml.parse` if we adopt multi-line `description:` blocks |
| `zod@4.3.6` | new `allowedModels` field | ✅ | `z.array(z.string()).optional()` — trivial |

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Regex frontmatter parser (existing `src/skills/scanner.ts`) | `gray-matter@4.0.3` | Only if a future SKILL.md needs nested YAML fields (arrays, objects in `description`). Not the case today. |
| SDK `query.setMaxThinkingTokens(n)` | Subprocess `env.MAX_THINKING_TOKENS` (OC bridge pattern) | Only if we abandon the SDK and go back to raw CLI spawn — contradicts existing Key Decisions. |
| `handle.send("/compact")` for content commands | Direct SDK internal hook | No reason; SDK already processes slash commands in the prompt path (`SDKLocalCommandOutputMessage`). |
| `discord.js` native autocomplete for `/cc-model` | Ephemeral `StringSelectMenuBuilder` button UI | Use the select menu if we want a click-to-choose UX outside the `/cc-model` command path (e.g., a `/cc-switch-model` flyout). Autocomplete is simpler and works inline. |
| Per-guild command registration (existing pattern) | Global commands | Global commands cache for up to 1 hour — slow for fleet restarts during dev. Keep per-guild. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `gray-matter` | 20KB transitive-dep tax for 8 lines of existing regex | `src/skills/scanner.ts` as-is (extend H1-skip for workspace-janitor-style files) |
| `js-yaml` | Would be a second YAML parser alongside `yaml@2.8.3` | `yaml@2.8.3` if multi-line YAML is ever needed |
| `chokidar@4` duplicate install | Already declared at `^5.0.0` in package.json | Existing chokidar for model-picker-preferences.json watching |
| Spawning `claude --print "/compact"` as subprocess | Re-introduces the OC-bridge architecture we replaced; loses streaming, session lineage | `handle.send("/compact")` through the existing SDK `Query` |
| Global slash-command registration | 1-hour propagation, noisy for 15-agent fleet across multiple guilds | Per-guild bulk `PUT` via REST (already the pattern in slash-commands.ts:162) |
| New env-var `MAX_THINKING_TOKENS` shim | OC pattern tailored to CLI subprocess; irrelevant in-process | `query.setMaxThinkingTokens(n)` + `thinking: ThinkingConfig` |
| Adding `@anthropic-ai/sdk` for raw thinking blocks | Duplicates the Agent SDK's responsibility; fights the Key Decision "Claude Agent SDK IS the orchestration layer" | Agent SDK only |
| `execa@9` | Not actually installed (CLAUDE.md is misleading here) and not needed for v2.2 | `node:child_process` if ever needed |

---

## Integration Map (Existing `src/` Tree)

| v2.2 Feature | Existing Modules Touched | New Files |
|--------------|--------------------------|-----------|
| 1. Skills migration | `src/skills/scanner.ts` (extend `extractDescription`), `src/skills/installer.ts` (already copies SKILL.md — extend to copy ancillary dirs) | `src/cli/migrate-skills.ts` (one-shot), `src/skills/migrate.ts` (logic, testable) |
| 2. Effort mapping | `src/manager/persistent-session-handle.ts:599-606` (wire `q.setMaxThinkingTokens`), `src/manager/session-adapter.ts:231-237` (mirror), `src/manager/session-config.ts` (thread `effort` from config into SDK `Options.effort` + `thinking:`), `src/shared/types.ts` (add `effort` + `thinkingBudget` to agent Zod schema) | `src/manager/effort-mapping.ts` (tiny — `EFFORT_MAP` + `EFFORT_TO_TOKENS` + two pure helpers, unit-testable) |
| 3. Dual model picker | `src/discord/slash-types.ts` (promote `clawcode-model` to control, add autocomplete), `src/discord/slash-commands.ts` (new `handleAutocomplete` branch), `src/manager/session-manager.ts` (new `setModelForAgent` → `handle.query.setModel`), `src/manager/daemon.ts` (IPC handler), `src/shared/types.ts` (`allowedModels`) | `src/discord/picker-bridge.ts` (chokidar-watched OC prefs file + emit IPC `setModelForAgent`) |
| 4. Native CC slash commands | `src/discord/slash-types.ts` + `src/discord/slash-commands.ts` (auto-register from `query.supportedCommands()`), `src/manager/session-manager.ts` (new `getSupportedCommands(agent)` passthrough), `src/manager/persistent-session-handle.ts` (expose `query.supportedCommands/Models/Agents` via handle) | `src/discord/cc-commands.ts` (pure registry builder — take `SlashCommand[]` from SDK + prefix with `cc-` + convert to `SlashCommandDef`) |

---

## Key Risks + Mitigations

1. **Claude Agent SDK pre-1.0 churn.** Versions `0.2.97` → `0.2.116` in the last milestone alone. The runtime-control surface used here (`setModel`, `setPermissionMode`, `setMaxThinkingTokens`, `supportedCommands`) is core and unlikely to break, but `ThinkingConfig.ThinkingAdaptive` is new (Opus 4.6+) and could shift. **Mitigation:** Pin exact version in package.json (`0.2.97` not `^0.2.97`) and run `npm view @anthropic-ai/claude-agent-sdk` in CI weekly.

2. **Discord 100-command-per-guild cap.** After v2.2 we're at ~40/guild. Safe for now; headroom for ~60 more (plugin/skill-generated CC commands count). **Mitigation:** emit a daemon startup warning at 80+ and fail registration at 100.

3. **SKILL.md format drift.** `self-improving-agent` has `metadata:` and `frontend-design` has `license:` — neither breaks the scanner today but any agent could write multi-line YAML descriptions tomorrow. **Mitigation:** keep a skill-format CI test using the current OC skill corpus as golden fixtures.

4. **OC picker preferences file race.** OC writes, ClawCode reads. On concurrent write during multi-agent model changes, chokidar could fire on a half-written file. **Mitigation:** guard `JSON.parse` + retry once after 50ms on parse failure (OC writes are atomic temp+rename, so the window is microseconds).

---

## Installation (no changes expected)

```bash
# No install commands needed for the v2.2 feature set.
# If the skills-migration script is retained long-term as a dev tool, consider:
# npm install -D gray-matter@4.0.3   # OPTIONAL, see "Alternatives Considered"
```

---

## Sources

- `@anthropic-ai/claude-agent-sdk@0.2.97` — `/home/jjagpal/.openclaw/workspace-coding/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (on-disk source of truth; HIGH confidence)
  - `SlashCommand` type at line 4239
  - `Query.supportedCommands()` at line 1754
  - `Query.setModel()` at line 1711
  - `Query.setPermissionMode()` at line 1704
  - `Query.setMaxThinkingTokens()` at line 1728
  - `ThinkingConfig`/`ThinkingAdaptive`/`ThinkingEnabled`/`ThinkingDisabled` at lines 4411-4427
  - `EffortLevel` at line 435
  - `SDKLocalCommandOutputMessage` at line 2475
  - Options.systemPrompt docstring "Slash commands are processed" at line 69
- `discord.js@14.26.2` — `/home/jjagpal/.openclaw/workspace-coding/node_modules/discord.js/typings/index.d.ts` (HIGH confidence; `StringSelectMenuBuilder`, `ApplicationCommandOptionType`)
- npm registry versions verified 2026-04-21:
  - `@anthropic-ai/claude-agent-sdk@0.2.116` (latest)
  - `discord.js@14.26.3` (latest 14.x; pre-release 15.x not recommended)
  - `gray-matter@4.0.3` (latest; last publish ~2023)
  - `js-yaml@4.1.1` (latest)
- Existing codebase evidence:
  - `src/manager/persistent-session-handle.ts:599-602` — the "Future: q.setMaxThinkingTokens() wiring" TODO comment
  - `src/discord/slash-commands.ts:263-284` — the `clawcode-effort` direct-path template for `/cc-*` commands
  - `src/skills/scanner.ts:10-43` — frontmatter regex already in place
  - `/home/jjagpal/openclaw-claude-bridge/src/claude.js:47-58, 108-118` — `mapEffort` + `MAX_THINKING_TOKENS` env-var logic to port
  - `/home/jjagpal/.openclaw/discord/model-picker-preferences.json` — shape verified
  - `/home/jjagpal/.openclaw/skills/*/SKILL.md` — format inventory verified

---

*Stack research for: ClawCode v2.2 OpenClaw Parity & Polish*
*Researched: 2026-04-21*
*Reviewed against on-disk SDK types and installed package.json — HIGH confidence for every recommendation*
