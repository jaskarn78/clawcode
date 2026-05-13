# Architecture Research — v2.2 OpenClaw Parity & Polish

**Domain:** Integration research — four parity features into an established v1.0-v2.1 ClawCode architecture
**Researched:** 2026-04-21
**Confidence:** HIGH for features 1-3 (existing code directly inspected); MEDIUM for feature 4 dispatch path (requires SDK probe before committing to an implementation)

---

## Summary of Integration Strategy

The v2.2 work is **almost entirely additive**. Three of four features slot into existing modules with small surface changes:

| Feature | Existing skeleton status | Net new code |
|---------|--------------------------|--------------|
| 1. Skills library migration | Scanner/installer/linker already ship SKILL.md-based. Source-tree contents are SKILL.md-based. | One translator module + one CLI subcommand |
| 2. Extended-thinking effort mapping | `effort` is already on agent schema, threaded through `session-adapter.ts`, forwarded to SDK on every turn via `SdkQueryOptions.effort`. IPC methods `set-effort` / `get-effort` live. | One missing wire: `q.setMaxThinkingTokens()` call inside `persistent-session-handle.ts::setEffort` |
| 3. Dual Discord model picker | `/clawcode-model` slash command exists but currently routes indirectly through the agent LLM (known tech debt from v1.5). OpenClaw picker is external. | New `allowedModels` schema field, direct IPC call (not LLM routing), file-read contract for the external picker |
| 4. Native CC slash commands | Slash-command registration loop already iterates per-agent. SDK exposes `q.setModel`, `q.setMaxThinkingTokens`, `q.setPermissionMode` — no runtime API for arbitrary slash commands. | New registration expansion + **dispatch probe spike** required |

**The build order below is driven by real dependencies, not feature alphabetization.** Feature 2 blocks nothing. Feature 1 blocks nothing. Feature 3 adds a schema field that Feature 4 registration re-uses. Feature 4 has the unknown and should go last — but its registration half can overlap with Feature 3.

---

## Existing Architecture (What's Already There)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Daemon Process                                │
│  src/manager/daemon.ts (startDaemon) — central orchestrator              │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │ SessionManager   │  │ IPC Server       │  │ ConfigReloader   │       │
│  │  - startAgent    │  │  - JSON-RPC 2.0  │  │  - hot-reload    │       │
│  │  - setEffort     │  │  - 80+ methods   │  │  - field-path    │       │
│  │  - setModel      │  │  - Unix socket   │  │     routing      │       │
│  └────────┬─────────┘  └──────────────────┘  └──────────────────┘       │
│           │                                                              │
│  ┌────────▼─────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │ PersistentSession │  │ SlashCommand    │  │ DiscordBridge   │        │
│  │ Handle (per-agent)│  │ Handler         │  │  - messageCreate│        │
│  │  - ONE sdk.query  │  │  - register()   │  │  - TurnDispatch │        │
│  │  - setEffort slot │  │  - handleInter- │  │  - capture      │        │
│  │  - Interrupt       │  │     action      │  │                  │        │
│  └───────────────────┘  └──────────────────┘  └──────────────────┘       │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ Skills: scanner → installer → linker (per-agent symlinks) │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ Migration: openclaw-config-reader → diff-builder →        │          │
│  │            guards → {config-mapper, memory-translator,     │          │
│  │            workspace-copier, yaml-writer} → verifier       │          │
│  └───────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
           │                             │                   │
           ▼                             ▼                   ▼
   [Claude Agent SDK]              [better-sqlite3]     [Discord REST/WS]
   per-agent sdk.query()           per-agent memories   discord.js 14
```

### Contracts That Must Not Change

These are load-bearing across v1.0-v2.1. v2.2 must extend, not replace:

| Contract | Location | Why frozen |
|----------|----------|-----------|
| `SessionHandle` public surface | `src/manager/session-adapter.ts:140` + mirror in `persistent-session-handle.ts` | Used by warm-path-check, recovery, dispatcher. Adding methods is fine; changing signatures breaks consumers. |
| `TurnDispatcher.dispatch` / `dispatchStream` | `src/manager/turn-dispatcher.ts:96,132` | DiscordBridge, TaskScheduler, future Phase 59 handoff all call this. |
| `SessionManager.setEffortForAgent` / `getEffortForAgent` | `src/manager/session-manager.ts:527,534` | Already consumed by IPC `set-effort` and slash-command handler. |
| `IPC_METHODS` tuple | `src/ipc/protocol.ts:7-101` | Zod-validated enum — adding is safe; renaming is not. `set-effort` / `get-effort` already present (currently no-op on thinking tokens). |
| `SkillsCatalog` map shape (`name → SkillEntry`) | `src/skills/types.ts` | Scanner, linker, and daemon startup wiring all read this contract. |
| `ResolvedAgentConfig.effort` / `.model` | `src/config/schema.ts:668,651` | Threaded through `buildSessionConfig` → `SdkQueryOptions.effort` on every turn. |
| `DEFAULT_SLASH_COMMANDS` identifiers | `src/discord/slash-types.ts:50` | `clawcode-*` prefix is the namespace convention; shadowing bare `/clear` etc. goes against this. |

---

## Feature 1 — Skills Library Migration

### Current State (Inspected)

- **Scanner** (`src/skills/scanner.ts`) reads any directory of skill folders where each subdirectory has a `SKILL.md` with YAML frontmatter (`name`, `description`, `version`). Non-`SKILL.md` directories are skipped with a warning. Contract is well-defined and generic.
- **Installer** (`src/skills/installer.ts`) copies `<workspaceSkillsDir>/<skill>/SKILL.md` → `~/.claude/skills/<skill>/SKILL.md` (content-identical check to skip). Called once at daemon startup (`daemon.ts:452`).
- **Linker** (`src/skills/linker.ts`) creates symlinks in each agent's workspace `skills/` directory pointing to the canonical skill directory. Called per-agent at `daemon.ts:458`.
- **Source skills** (`~/.openclaw/skills/`) audited: `cognitive-memory`, `finmentum-crm`, `frontend-design`, `new-reel`, `openclaw-config`, `power-apps-builder`, `remotion`, `self-improving-agent`, `tuya-ac`, `workspace-janitor` (+ retired/test). All have `SKILL.md` with standard frontmatter (`name:`, `description:`).

### Integration Point

**The OpenClaw skills do not need a structural translator.** They are already SKILL.md-based and compatible with `scanSkillsDirectory()`. What they need:

1. **Content rewrites** (skill-by-skill) for OpenClaw-specific references:
   - `~/.openclaw/skills/` absolute paths → `~/.clawcode/skills/` (or `workspace/skills/`)
   - `clawdbot.json` / `moltbot.json` config references → `clawcode.yaml`
   - `finmentum-content-creator.retired` → skip (already retired)
   - MCP server names (e.g., `finmentum-db`) — verify these exist in target `clawcode.yaml` or the skill will fail at runtime
2. **Frontmatter validation** — confirm every ported skill has `name` and `description` (scanner accepts either; some OpenClaw skills may be under-specified).
3. **Per-agent assignment** — decide which agents get which skills (the `skills: []` array on `agentSchema` in `config/schema.ts:652`). Currently empty for most agents.

### Where the Migration Tool Lives

**Recommendation: standalone `clawcode migrate openclaw skills` subcommand, NOT a reuse of the v2.1 migration pipeline.**

Rationale:
- v2.1 pipeline is a fleet-atomic, ledger-tracked, guarded, zero-source-modification apparatus designed for per-agent workspace + memory + config migration. Skills are global (`~/.clawcode/skills/`), not per-agent, so the ledger/rollback model doesn't cleanly map.
- Ledger already differentiates per-agent rows; injecting skill-scope rows pollutes the v2.1 report schema.
- A new subcommand lets the operator run skill migration independently of fleet migration (skills may land after an agent is already migrated).

Implementation plan:
- **New file:** `src/migration/skills-translator.ts` — pure functions: `discoverOpenclawSkills(srcDir)`, `rewriteSkillContent(content, rewrites)`, `planSkillMigration(src, dst)`, `applySkillMigration(plan, dstDir)`.
- **New CLI:** `src/cli/commands/migrate-skills.ts` — `list`, `plan`, `apply`, `verify` subcommands mirroring the v2.1 CLI's verb structure but scoped to skills.
- **Rewrite rules** as a single typed table in `skills-translator.ts`, applied via `content.replaceAll()`. No AST parsing — skills are markdown.

### Idempotency Contract

- `plan` reads source, computes SHA256 of rewritten content, compares against destination. Writes nothing.
- `apply` writes only if destination SHA256 differs. Uses atomic temp+rename (same pattern as `yaml-writer.ts:atomicWrite`).
- Re-running `apply` with no source changes produces zero filesystem mutations (matches `installer.ts` behavior).

### Verification Integration Point

"Verify they load correctly per-agent via the existing linker" maps to:

1. After `apply`, run `scanSkillsDirectory(skillsPath)` → assert translator output is discoverable.
2. For each agent config with `skills: [migratedSkillName]`, run `linkAgentSkills(agent.workspace + "/skills", agent.skills, catalog)` in dry-run mode (add a `dryRun: true` parameter to linker — trivially backward-compat).
3. Emit a pass/fail table: `{agent, skillName, linked: bool, reason?}`.

The verifier naturally belongs as `verify` subcommand under `migrate-skills` — not under the v2.1 verifier (which checks agent-level invariants).

---

## Feature 2 — Extended-Thinking Effort Mapping

### Current State (Inspected — This Is Mostly Done)

The schema, IPC, slash command, and session-adapter wiring all exist. Chronology of existing plumbing:

```
clawcode.yaml agent.effort: "low|medium|high|max"   [config/schema.ts:668]
        ↓
ResolvedAgentConfig.effort
        ↓
buildSessionConfig(config) → AgentSessionConfig.effort  [session-config.ts:143,518]
        ↓
SdkSessionAdapter.createSession → baseOptions.effort    [session-adapter.ts:411,450]
        ↓
createPersistentSessionHandle → sdk.query({options: {effort}})  [persistent-session-handle.ts:91]
        ↓
Per-turn: buildOptions spreads `...baseOptions, effort: currentEffort, resume: sessionId`
```

And for runtime updates:

```
Discord: /clawcode-effort level:high
    ↓
slash-commands.ts:264 (short-circuits, does NOT route through agent)
    ↓
sessionManager.setEffortForAgent(name, level)      [session-manager.ts:527]
    ↓
handle.setEffort(level)                             [persistent-session-handle.ts:599]
    ↓
currentEffort = level   [takes effect on next turn via buildOptions]
```

**The SDK's `effort` field is the right primitive.** `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1182` declares `effort?: EffortLevel` on `Options`, and it documents: *"Controls how much effort Claude puts into its response. Works with adaptive thinking to guide thinking depth."* This is what the OpenClaw bridge was approximating by spawning the CLI with `--effort`.

### The Missing Wire

`persistent-session-handle.ts:601` contains a `// Future: q.setMaxThinkingTokens()` comment. The OpenClaw bridge (`openclaw-claude-bridge/src/claude.js:116-118`) sets `env.MAX_THINKING_TOKENS = '0'` when the caller passes no `reasoning_effort`. This is the "thinking off" signal. The SDK exposes this directly:

```typescript
// sdk.d.ts:1728
setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
```

### Integration Point

**File:** `src/manager/persistent-session-handle.ts`
**Change:** one-line extension to the existing `setEffort()` method (line 599).

```typescript
setEffort(level: "low" | "medium" | "high" | "max"): void {
  currentEffort = level;
  // v2.2 — runtime thinking-tokens toggle for "off" semantics.
  // Treat explicit level === "low" as "thinking enabled but minimal"
  // (matches SDK docs). The OpenClaw parity case (thinking=off when
  // effort is null) maps to a dedicated "off" value if the product
  // needs it — otherwise "low" is already the SDK's minimal preset.
  void q.setMaxThinkingTokens(null);  // clear any prior hard cap
},
```

**Nothing else should move.** The schema already ships `effortSchema = z.enum(["low","medium","high","max"])` (`config/schema.ts:13`). No Zod change needed.

### Per-message vs Per-agent

Currently: **per-agent only** (config default + runtime slash-command override). The Discord message model (Phase 65+) does not thread a per-message effort. Recommendation: keep it per-agent. Per-message effort would require:

- A new message prefix parser (e.g., `[effort:high] What's the plan?`) — high-maintenance UX.
- SDK's `setMaxThinkingTokens()` is async and racy if invoked per-turn concurrently with dispatch.

If per-message is eventually wanted, it should be a dedicated phase with its own research.

### Who Owns Model/Effort Today

- **Model:** `ResolvedAgentConfig.model` (config) → `resolveModelId()` at `session-adapter.ts:410,449` → `SdkQueryOptions.model`. Runtime override via `IPC set-model` at `daemon.ts:2550` — but this is a **config mutation** (rewrites in-memory `configs[idx]`) and "takes effect on next session", NOT the live turn. Tech debt noted in PROJECT.md.
- **Effort:** `ResolvedAgentConfig.effort` (config) → `SdkQueryOptions.effort` on every turn. Runtime override is **live** via `handle.setEffort()` — the per-turn `buildOptions` re-reads `currentEffort` (`session-adapter.ts:618`).

**Effort is already the pattern to follow for Feature 3.**

---

## Feature 3 — Dual Discord Model Picker

### Architecture Decision: Two Pickers, One Truth

```
┌──────────────────────────────────────────────────────────────┐
│                OpenClaw model picker (external)              │
│                 - reads:  ~/.clawcode/model-allowlist.json   │ ← NEW FILE
│                 - writes: (none — read-only)                  │
└─────────────────────────────┬────────────────────────────────┘
                              │ reads file snapshot
                              │
┌─────────────────────────────▼────────────────────────────────┐
│              clawcode.yaml agent[N].allowedModels: [...]     │ ← NEW FIELD
│              (single source of truth)                         │
└─────────────────────────────┬────────────────────────────────┘
                              │ daemon watches via ConfigWatcher
                              │
┌─────────────────────────────▼────────────────────────────────┐
│   Daemon: materializes model-allowlist.json on boot + on     │ ← NEW SMALL MODULE
│   hot-reload (drops via atomic write).                        │
│                                                               │
│   Native /clawcode-model (existing slash command):           │
│     - TODAY: routes claudeCommand="Set my model to {model}"  │ ← REPLACE
│              through the agent LLM (v1.5 tech debt)           │
│     - v2.2:  handle directly in slash-commands.ts like        │
│              /clawcode-effort — IPC set-model straight to     │
│              SessionManager, bypass LLM                        │
└───────────────────────────────────────────────────────────────┘
```

### Why a File, Not an HTTP/IPC Contract

Two options were considered:

| Option | Pros | Cons |
|--------|------|------|
| OpenClaw picker stats+parses `clawcode.yaml` directly | Zero new surface in clawcode | OpenClaw picker must understand YAML, Zod schema, agent resolution, defaults cascade, `expandHome()` — it becomes a second source of truth implementation |
| OpenClaw picker reads a materialized JSON file (`~/.clawcode/model-allowlist.json`) | Pre-resolved, pre-validated, trivially parseable. Daemon controls the schema. | One new file + one new materializer (~40 LOC). |
| OpenClaw picker calls daemon over HTTP/IPC | Always live | Cross-process lifecycle coupling: if daemon is down, picker breaks. Requires new auth surface. |

**Recommendation: materialized JSON file.** Matches `src/discord/router.ts` pattern of resolved runtime state written once at boot. File schema:

```json
{
  "version": 1,
  "updatedAt": "2026-04-21T...",
  "agents": {
    "clawdy":        { "channelId": "1234...", "allowedModels": ["haiku", "sonnet", "opus"], "defaultModel": "opus" },
    "fin-acquisition": { "channelId": "5678...", "allowedModels": ["haiku", "sonnet"], "defaultModel": "sonnet" }
  }
}
```

The OpenClaw picker already looks up by channel (see `model-picker-preferences.json:entries["discord:default:guild:X:user:Y"]` shape). A channel-indexed lookup in the new file is trivial for it.

### Integration Points

| Component | File | Change |
|-----------|------|--------|
| Schema | `src/config/schema.ts` | Add `allowedModels: z.array(modelSchema).optional()` to `agentSchema` (~line 668). Default to `[config.model]` at resolve time if unset. |
| Materializer | `src/discord/model-allowlist-writer.ts` (NEW) | Pure function `buildAllowlist(resolvedAgents, routingTable) → object`; atomic write at `~/.clawcode/model-allowlist.json`. Called at daemon boot **and** from `ConfigReloader` when field-path matches `agents.*.allowedModels` or `agents.*.model` or `agents.*.channels`. |
| Slash dispatch | `src/discord/slash-commands.ts:263-285` | Extend the `/clawcode-effort` short-circuit pattern with a `/clawcode-model` short-circuit that calls `sendIpcRequest(SOCKET_PATH, "set-model", {agent, model})` instead of routing `claudeCommand` through the LLM. Validate `model ∈ allowedModels` BEFORE dispatch. |
| IPC `set-model` | `src/manager/daemon.ts:2550` | **Current code only rewrites the config array — does NOT update the live session.** For v2.2: after the config mutation, call the SDK's `q.setModel(resolveModelId(newModel))` via a new `SessionHandle.setModel()` method on `persistent-session-handle.ts` — mirrors `setEffort`. |
| Persistent handle | `src/manager/persistent-session-handle.ts` | Add `setModel(id)` that calls `q.setModel(id)` (SDK method at `sdk.d.ts:1711`). Like `setEffort`, also update a `currentModel` field so next turn's options reflect it. |
| SDK types | `src/manager/sdk-types.ts:163-169` | Add `setModel(model?: string): Promise<void>` to `SdkQuery` type. |

### Persistence Strategy

**Do NOT write runtime model changes back to `clawcode.yaml`.** Matches existing `set-effort` semantics (runtime override, lost on daemon restart — agent starts with config's default). Writing to YAML would fight the config-watcher hot-reload loop and risk corrupting operator comments (despite `yaml-writer.ts` comment-preservation).

If persistence-across-restart is wanted later: a per-agent `.runtime-state.json` file next to the workspace (separate from config). Not v2.2 scope.

---

## Feature 4 — Native Claude Code Slash Commands in Discord

### The Core Question

**Can `/clear`, `/compact`, `/model`, `/memory`, `/agents`, `/mcp`, `/cost`, `/todos`, `/init`, `/permissions`, `/review`, `/security-review` be dispatched into a running `sdk.query()` session?**

Answer from inspecting the SDK types (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`):

| CC command | SDK surface | Dispatchable into running session? |
|------------|-------------|-------------------------------------|
| `/clear` | None — CLI resets REPL context | **No** via SDK. Would require session tear-down + restart with fresh resume. |
| `/compact` | None explicit — CC's compaction is internal. ClawCode already has its own compaction (`src/memory/compaction.ts`). | **Map to existing** — send `"Trigger context compaction now"` via TurnDispatcher. Already wired as `clawcode-compact`. |
| `/model` | `q.setModel(model?)` at `sdk.d.ts:1711` | **Yes, live.** This is Feature 3's dispatch path. |
| `/memory` | None — CLI's `/memory` shows CLAUDE.md. | **No via SDK.** Could map to ClawCode's `memory-lookup` IPC + reply in Discord. |
| `/agents` | None — CLI shows available subagents. | **No via SDK directly.** Map to reading `skillsCatalog` + `resolvedAgents` and replying. |
| `/mcp` | `q.mcpServerStatus()` at `sdk.d.ts` (already used) | **Yes** — already exposed as `mcp-servers` IPC. |
| `/cost` | None — SDK reports cost on result messages. | Already surfaced as `clawcode-usage`. |
| `/todos` | None — CLI's todo tool is internal. | **No** — skip or map to memory-tag query. |
| `/init` | None — one-shot CC command. | **No** — not meaningful per-session. |
| `/permissions` | `q.setPermissionMode(mode)` at `sdk.d.ts:1704` | **Yes, live.** |
| `/review`, `/security-review` | These are CC skills (prompts), not runtime API calls. | **Yes via TurnDispatcher** — dispatch the equivalent prompt text. |

### Integration Sub-Path (a) — Registration

Discord commands are registered per-guild in bulk at `slash-commands.ts:110-175` (`SlashCommandHandler.register()`). The loop iterates `resolvedAgents`, merges per-agent `slashCommands` with `DEFAULT_SLASH_COMMANDS`, deduplicates by name, and adds `CONTROL_COMMANDS`.

**Namespacing strategy — keep the `clawcode-*` prefix.**

Rationale:
- Discord commands are **guild-scoped** and the bot is shared across OpenClaw-owned channels and ClawCode-owned channels. Bare `/clear` would fight OpenClaw's existing `/clear` (the picker's runtime's own).
- The `clawcode-*` prefix is already the convention (`clawcode-fleet`, `clawcode-start`, `clawcode-effort`).
- Users dislike two-level typing, so prefer **shortest meaningful name**: `/clawcode-clear`, `/clawcode-model`, `/clawcode-permissions`, etc. This matches v1.6 registrations exactly.

**Implementation:** extend `DEFAULT_SLASH_COMMANDS` in `src/discord/slash-types.ts` with the mappable subset. Each entry needs a `claudeCommand` (for the TurnDispatcher path) OR a `ipcMethod` / direct handler (for the SDK-API path).

A **third category** emerges: commands whose handler is inline in `slash-commands.ts` like `/clawcode-effort` is today (line 264). The dispatch table grows from "LLM routing vs control IPC" (2 categories) to:

1. **LLM-routed** (default) — `claudeCommand` sent via TurnDispatcher.
2. **Daemon IPC** — `ipcMethod` dispatches to daemon-direct handler (e.g., `clawcode-start`, `clawcode-fleet`).
3. **Session-native** (NEW) — inline handler calls `SessionHandle.{setModel, setPermissionMode, setMaxThinkingTokens}` directly.

### Integration Sub-Path (b) — Dispatch

Three options per the prompt; evidence-based verdict per command:

#### Option (i) — Send `"/clear"` as a prompt turn through TurnDispatcher

**Verdict: rejected as universal strategy.** The SDK's `query({prompt, options})` treats the prompt as user message content — there is no evidence the CC SDK interprets leading-slash strings as slash commands once you're running in streaming-input mode (`includePartialMessages: true`). That slash-command interpretation is a CLI REPL feature; SDK sessions don't have a REPL layer. Confirmed by code reading `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — no slash-command parser surface on `Query` or `Options`.

**However:** this IS the right strategy for commands whose intent is a prompt (`/review`, `/security-review`, `/compact` semantics) — dispatch the **equivalent prompt text**, not the literal `/slash`.

#### Option (ii) — Special-cased IPC method calling SDK's command API directly

**Verdict: the correct strategy for the three SDK-exposed runtime knobs.** The SDK already offers:

```typescript
// sdk.d.ts
q.setModel(model?)                // v2.2 Feature 3 path
q.setPermissionMode(mode)         // v2.2 Feature 4 path  
q.setMaxThinkingTokens(n)         // v2.2 Feature 2 path
q.mcpServerStatus()               // already exposed as IPC mcp-servers
q.setMcpServers(servers)          // dynamic MCP swap — beyond v2.2 scope
```

Each wraps as a `SessionHandle.setX()` method (pattern from existing `setEffort`) → `SessionManager.setXForAgent()` wrapper → IPC method → slash command inline handler.

#### Option (iii) — Restart the session with special args

**Verdict: only required for `/clear`.** The SDK has no live "clear context" primitive that's observably equivalent to the CLI's `/clear`. To honor `/clear` semantics: `SessionManager.restartAgent(name, config)` (already public, `session-manager.ts:704`) with a config that skips conversation-brief injection. Slight schema plumbing needed — a `skipResumeSummary: true` option flag on `SendOptions` would need to thread down, OR use an existing fork primitive (`buildForkConfig` at `src/manager/fork.ts`) and replace the agent's handle with a fresh session. Non-trivial — mark for a deeper research spike if this is desired.

### Recommendation: Tiered Implementation

**Tier 1 — SDK-native (v2.2):** `/clawcode-model`, `/clawcode-permissions`, `/clawcode-compact` (ClawCode's own), plus the existing `/clawcode-effort`. Uses session-handle `setX()` wrappers.

**Tier 2 — Prompt re-routes (v2.2):** `/clawcode-review`, `/clawcode-security-review`, `/clawcode-agents` (list skills + subagents from registry). Uses TurnDispatcher with canonical prompt text (like the existing `/clawcode-memory`).

**Tier 3 — Defer (post-v2.2 or research spike):** `/clawcode-clear` (session reset), `/clawcode-init` (not meaningful per-session), `/clawcode-todos` (no SDK primitive).

### Integration Points (Feature 4)

| Component | File | Change |
|-----------|------|--------|
| Command registry | `src/discord/slash-types.ts:50` | Add Tier 1 + Tier 2 entries. Each inline-handled command gets a sentinel like `__cc_native__` in `claudeCommand` so slash-commands.ts can short-circuit. |
| Session handle | `src/manager/persistent-session-handle.ts` | New methods: `setModel(id)`, `setPermissionMode(mode)`. Both thin wrappers over `q.setX()`. Mirror `setEffort` line 599. |
| SessionManager wrappers | `src/manager/session-manager.ts:527-537` | New methods `setModelForAgent(name, model)`, `setPermissionModeForAgent(name, mode)` — identical pattern to `setEffortForAgent`. |
| IPC methods | `src/ipc/protocol.ts:7-101` | Add `"set-permission-mode"` to `IPC_METHODS` (set-model already exists but must be reworked — see Feature 3). |
| Daemon case handlers | `src/manager/daemon.ts` | Add `case "set-permission-mode":` sibling to `case "set-effort":` at line 1800. |
| Slash dispatch | `src/discord/slash-commands.ts:264` | Extend the `/clawcode-effort` short-circuit pattern with a pure function `dispatchNativeSlashCommand(name, opts, sessionManager)` that returns a reply string. Pure-function extraction follows the v1.8 quick-task pattern used by `handleInterruptSlash` / `handleSteerSlash`. |
| SDK types | `src/manager/sdk-types.ts:163` | Add `setModel(model?): Promise<void>`, `setPermissionMode(mode): Promise<void>`, `setMaxThinkingTokens(n): Promise<void>` to `SdkQuery`. |

### Dispatch Spike (Required Before Commit)

Before writing the v2.2 phase plan for Feature 4, run a **30-minute spike** against the actual SDK in a throwaway script:

1. Spin up a `sdk.query({prompt: asyncIterable, options: {effort: "low"}})`.
2. Capture the `q` handle.
3. Call `await q.setModel("claude-haiku-4-5")` mid-session.
4. Push a user message, inspect the `result` message's `model` field — does it reflect the new model?
5. Repeat for `setPermissionMode` and `setMaxThinkingTokens`.
6. Confirm no exceptions, no state corruption on the driver iterator (the single `driverIter` capture at `persistent-session-handle.ts:87`).

This spike answers the "does it actually work mid-session" question that the type definitions alone don't settle. It should produce a one-paragraph confirmation note checked into `.planning/research/` before phase planning.

---

## Data Flow (All Four Features)

### Feature 2 — `/clawcode-effort level:high`

```
Discord interaction
    ↓
slash-commands.ts:264 short-circuit
    ↓
sessionManager.setEffortForAgent("fin-acquisition", "high")
    ↓
handle.setEffort("high")                    [persistent-session-handle.ts:599]
    ↓
currentEffort = "high"  + q.setMaxThinkingTokens(null)   ← NEW WIRE
    ↓  (on next user turn)
buildOptions() spreads {effort: "high"} into sdk.query options
    ↓
SDK adaptive thinking activates
```

### Feature 3 — `/clawcode-model model:opus`

```
Discord interaction
    ↓
slash-commands.ts (NEW short-circuit mirroring /clawcode-effort)
    ↓
Validate model ∈ agent.allowedModels
    ↓
sendIpcRequest("set-model", {agent, model: "opus"})
    ↓
daemon.ts case "set-model":
  - Validate with modelSchema.safeParse()
  - Rewrite configs[idx].model
  - sessionManager.setModelForAgent(name, "opus")   ← NEW SIDE EFFECT
      ↓
      handle.setModel(resolveModelId("opus"))        ← NEW METHOD
      ↓
      await q.setModel("claude-opus-4-7")            [SDK API]
      ↓
      currentModel = "opus"  (affects next-turn buildOptions)
```

### Feature 4 — `/clawcode-permissions mode:acceptEdits`

```
Discord interaction
    ↓
slash-commands.ts (new short-circuit, same pattern as /clawcode-effort)
    ↓
dispatchNativeSlashCommand("permissions", {mode: "acceptEdits"}, sm)
    ↓
sessionManager.setPermissionModeForAgent(name, "acceptEdits")
    ↓
handle.setPermissionMode("acceptEdits")              ← NEW METHOD
    ↓
await q.setPermissionMode("acceptEdits")             [SDK API]
    ↓
Reply in Discord: "Permission mode set to acceptEdits."
```

### Feature 1 — `clawcode migrate openclaw skills apply`

```
CLI invocation
    ↓
migrate-skills.ts action handler
    ↓
skills-translator.ts::discoverOpenclawSkills("~/.openclaw/skills/")
    ↓ {name, path, contentSha256}[]
planSkillMigration(src, dst) → PlanReport
    ↓
(optional) scanSecrets() — reuse src/migration/guards.ts:scanSecrets
    ↓
applySkillMigration(plan, "~/.clawcode/skills/")
  - atomic temp+rename per skill
  - skip if destSha256 === srcSha256
    ↓
scanSkillsDirectory() → assert new skills discoverable
    ↓
for each agent: linkAgentSkills(agent.skills, dryRun=true) → pass/fail table
    ↓
Report
```

---

## Recommended Build Order

Dependencies (arrow = "must finish before"):

```
        Feature 1 (Skills)  ──(none)──→ ship
        
        Feature 2 (Effort)  ──(none)──→ ship
        
                              ┌─→ Feature 4 registration
        Feature 3 (Model) ────┤     (reuses allowedModels)
                              └─→ Feature 4 SDK-native dispatch
                                    (requires setModel spike)
```

### Phase sequence (justified):

**Phase v2.2.1 — Effort → MAX_THINKING wire (Feature 2).**
Zero new surface. One-line SDK call. Highest value-to-risk ratio. Validates SDK `setMaxThinkingTokens` plumbing and exercises the existing `setEffort` pathway under real load — this is the canary for Feature 4's SDK-native dispatch strategy. **If `q.setMaxThinkingTokens()` races the driver iterator, Feature 4 is in trouble too — better to know now.**

**Phase v2.2.2 — Skills library migration (Feature 1).**
Fully independent. Can run in parallel with Phase v2.2.1 if two agents work the milestone. Unblocks downstream skill-per-agent assignment work. No risk to running daemon (CLI-only).

**Phase v2.2.3 — Model picker dual path (Feature 3).**
Introduces the `allowedModels` schema field, the materialized JSON allowlist, and the direct-IPC `/clawcode-model` dispatch. Fixes the v1.5 tech debt (`/model` routing through agent LLM). **Must land before Feature 4 because:**
  - Feature 4's `setModelForAgent` SessionHandle method is the load-bearing work.
  - `allowedModels` validation is reused by Feature 4's `/clawcode-model` entry.
  - The external OpenClaw picker needs the file contract; ships independently of Feature 4.

**Phase v2.2.4 — Native CC slash commands (Feature 4) — PRECEDED BY SDK SPIKE.**
Tier 1 (SDK-native) + Tier 2 (prompt re-routes). Tier 3 deferred. Requires spike first to confirm `q.setModel` / `q.setPermissionMode` mid-session behavior. This is the riskiest feature — scheduling it last maximizes learning from the three prior phases.

### Inter-phase contract changes to watch

| Phase | Public contract change | Risk |
|-------|-----------------------|------|
| 2.2.1 | `SessionHandle.setEffort` gets SDK side effect. | LOW — existing callers already invoke it; the side effect is additive. |
| 2.2.2 | None — pure CLI. | ZERO |
| 2.2.3 | `agentSchema.allowedModels` added (optional). `SessionHandle.setModel` new method. IPC `set-model` gains side-effect (live session update). | LOW-MEDIUM — `set-model` semantic shift from "next session" → "live" is observable; document in phase COMPLETION notes. |
| 2.2.4 | New SessionHandle methods, new IPC methods. | MEDIUM — untested SDK paths. Spike mitigates. |

---

## Anti-Patterns (Domain-Specific)

### Anti-Pattern 1: Writing runtime overrides back to `clawcode.yaml`

**Mistake:** Implementing `/clawcode-model` by rewriting `clawcode.yaml` so the change persists.
**Why wrong:** Fights the `ConfigWatcher` hot-reload loop; risks corrupting operator-authored comments; creates a race between daemon self-write and operator hand-edit.
**Do instead:** Runtime-only override on `SessionHandle`. If persistence is wanted, use a separate `.runtime-state.json` next to the workspace.

### Anti-Pattern 2: Translating SKILL.md files through an AST

**Mistake:** Building a markdown AST walker for the skills translator "for correctness."
**Why wrong:** Skills are loosely-structured prose. AST complexity buys nothing; regex-based `content.replaceAll()` for the handful of known paths (`~/.openclaw/skills/` → `~/.clawcode/skills/`, `clawdbot.json` → `clawcode.yaml`) is one screen of code.
**Do instead:** Typed rewrite-rules table in `skills-translator.ts`, one pass per rule.

### Anti-Pattern 3: Registering bare `/clear` or `/model` in Discord

**Mistake:** Mirroring the Claude Code CLI's exact command names in Discord.
**Why wrong:** Collides with OpenClaw's bot scope, breaks the `clawcode-*` namespace convention, confuses operators in hybrid guilds during the v2.1 → v2.2 migration window.
**Do instead:** Keep the `clawcode-*` prefix. Users learn one convention.

### Anti-Pattern 4: Treating `/clear` as dispatchable

**Mistake:** Sending the literal string `"/clear"` to the agent and hoping the SDK interprets it.
**Why wrong:** The CC CLI's slash-command parser is a REPL feature. The SDK's `Query` interface has no slash-parser surface. The agent will literally reply `"I cleared my context"` as text while doing nothing.
**Do instead:** If `/clear` semantics are required, restart the session via `sessionManager.restartAgent()` with resume-summary suppression. Or defer as not-v2.2.

---

## Sources

- `src/config/schema.ts` — `effortSchema` at line 13, `agentSchema` at 640-701
- `src/manager/persistent-session-handle.ts:599` — `setEffort` with the "Future:" comment for max-thinking-tokens wiring
- `src/manager/session-adapter.ts:411,618` — proof that `effort` is threaded into every per-turn `sdk.query` options
- `src/manager/session-manager.ts:527-537` — `setEffortForAgent` pattern to mirror for Feature 3/4
- `src/manager/daemon.ts:1800-1808, 2550-2587` — existing `set-effort`, `set-model` IPC handlers
- `src/discord/slash-commands.ts:264-285` — `/clawcode-effort` short-circuit template
- `src/discord/slash-types.ts:50-128` — `DEFAULT_SLASH_COMMANDS` with `clawcode-*` naming
- `src/ipc/protocol.ts:7-101` — complete `IPC_METHODS` enum (`set-effort`, `get-effort`, `set-model` already present)
- `src/skills/{scanner,installer,linker,types}.ts` — the full SKILL.md pipeline
- `src/migration/*.ts` — v2.1 migration pipeline (reuse `atomic write`, `scanSecrets`, `ledger` patterns)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1182,1704,1711,1728` — SDK-native `effort`, `setPermissionMode`, `setModel`, `setMaxThinkingTokens`
- `openclaw-claude-bridge/src/claude.js:48-121` — OpenClaw's `mapEffort` + `MAX_THINKING_TOKENS=0` pattern (reference implementation for Feature 2)
- `/home/jjagpal/.openclaw/skills/` — audit of source skills for Feature 1
- `/home/jjagpal/.openclaw/openclaw.json` — confirms OpenClaw stores `agents.defaults.models` as map (informs Feature 3 file format)

---
*Architecture research for: v2.2 OpenClaw Parity & Polish*
*Researched: 2026-04-21*
