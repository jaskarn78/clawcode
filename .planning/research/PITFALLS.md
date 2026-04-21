# Pitfalls Research — v2.2 OpenClaw Parity & Polish

**Domain:** Adding four parity features to a shipped, production multi-agent orchestration system (15 agents, active Discord bindings, freshly-completed v2.1 migration).
**Researched:** 2026-04-21
**Confidence:** HIGH (all code paths verified in the live repo; SDK 0.2.97 API surface confirmed against `node_modules/.../sdk.d.ts`; SKILL.md drift confirmed by diffing real files in `~/.openclaw/skills/` vs `~/.clawcode/skills/`).

Each pitfall is specific to adding these features to THIS codebase. Generic "SDK usage" advice omitted. Where possible, warning signs are given as grep-able code patterns and prevention strategies include concrete code-level guards.

---

## Critical Pitfalls

### Pitfall 1: `setEffort()` stores the level but never wires it to the SDK's `setMaxThinkingTokens()` — the config is a lie

**What goes wrong:**
`src/manager/persistent-session-handle.ts:599-602` currently does:
```ts
setEffort(level): void {
  currentEffort = level;
  // Future: q.setMaxThinkingTokens() wiring — out of scope per 73-RESEARCH §"Don't hand-roll".
}
```
`setEffort` mutates a local variable that nothing else reads. `q.setMaxThinkingTokens(...)` is never called. `/clawcode-effort high` logs success, but the SDK query keeps using the default thinking budget. Every existing effort test passes because the tests only assert the stored value, not the behavior.

**Why it happens:**
Phase 73 deliberately deferred wiring (`"out of scope per 73-RESEARCH"`). The comment is right there. But a well-meaning v2.2 dev reads the slash-command handler, sees `setEffortForAgent` already routed, runs `/clawcode-effort max`, sees the happy-path reply, and concludes "already done."

**How to avoid:**
Phase 2 kick-off task: wire `q.setMaxThinkingTokens(tokenBudgetForEffort(level))` inside `setEffort`, where `tokenBudgetForEffort` is a pure function mapping `low|medium|high|max` → a token number (e.g., `low=0, medium=4000, high=16000, max=32000`). Back it with an integration test that asserts a turn executed after `setEffort("high")` carries `thinking.budgetTokens >= 16000` — spy the iterator, not the handle state. Also use the SDK's newer `thinking` option (`sdk.d.ts:1170`) where applicable, and note `setMaxThinkingTokens` is marked `@deprecated` (`sdk.d.ts:1713-1721`) — prefer passing `thinking: { type: 'enabled', budgetTokens: N }` on the per-turn query options if the 0.2.97 API supports mid-session override.

**Warning signs:**
- `grep -n "q.setMaxThinkingTokens\|thinking:" src/manager/persistent-session-handle.ts` returns no hits after the phase is "done"
- Effort CLI reports success, but Anthropic dashboard shows identical `cache_creation_input_tokens` and response latency across effort levels
- No test file asserts thinking tokens actually change the outgoing query

**Phase to address:** Phase 2 (Extended-thinking mapping) — MUST land with integration test spying on query options.

---

### Pitfall 2: `max` effort on Haiku silently falls back, breaking user expectations

**What goes wrong:**
`sdk.d.ts:1178` explicitly states `'max' — Maximum effort (Opus 4.6 only)`. The SDK also exposes `supportsEffort` and `availableEffortLevels` per model (`sdk.d.ts:892-896`). Of the 15 agents, the default model is `haiku` (per `defaultsSchema.model.default("haiku")`). `/clawcode-effort max` on a Haiku-bound agent is either silently downgraded by the SDK or throws — the UX tells the user "Effort set to **max**" either way.

**Why it happens:**
The effort slash command in `slash-commands.ts:264-284` validates against a hardcoded `["low", "medium", "high", "max"]` list with no cross-check against the agent's bound model. The resolved model is known at that moment (agent config is already loaded), but the handler doesn't consult it.

**How to avoid:**
Before calling `setEffortForAgent`, read `agentConfig.model` (or effective resolved model) and reject `max` on non-Opus. Even better, call the SDK's model capability API at boot and cache `agent → Set<EffortLevel>`, then validate from that. Emit a user-visible error: `"max effort is only supported on Opus. Current model: haiku. Use /clawcode-model opus first, or pick high."`

**Warning signs:**
- `slash-commands.ts:266` `validLevels = ["low", "medium", "high", "max"]` is a hardcoded literal
- No lookup of `resolvedAgents.find(a => a.name === agentName).model` before accepting level
- SDK error logs containing `"effort level not supported"` after the command appears to succeed

**Phase to address:** Phase 2 (Extended-thinking mapping) — guard in the slash handler before the IPC dispatch.

---

### Pitfall 3: Fork-escalated Opus sessions inherit the agent's effort setting — effort state survives fork, cost explodes

**What goes wrong:**
Session forking (`session-manager.ts:546-559` via `buildForkConfig`) creates an ephemeral escalated session. If `currentEffort = "high"` on the parent when the fork triggers, the fork inherits it. Now an Opus advisor runs with `thinking.budgetTokens=16000+` on every sub-turn — the v1.5 cost-optimization phase's whole point was that advisor escalations are short-lived and auditable. A 10-turn advisor thread at `high` effort costs 10x what the researchers modeled.

**Why it happens:**
`buildForkConfig` copies the parent's resolved config; `effort` is a first-class field on `AgentConfig` (`schema.ts:668`). No code path resets effort on fork.

**How to avoid:**
In `buildForkConfig` or `forkSession`, force `effort = "low"` on the forked config regardless of parent state. If the user explicitly wants deep-thinking escalations, they can `/clawcode-effort` the fork post-creation. Add a test that creates a parent handle at `effort=max`, forks, and asserts the fork's `getEffort()` returns `"low"`.

**Warning signs:**
- `grep -n "effort" src/manager/fork.ts` returns no defensive reset
- Cost tracking shows forked sessions (names ending in `-fork-{nanoid}`) with token budgets >4x the parent model expectation
- Opus advisor turn count spikes after v2.2 ship

**Phase to address:** Phase 2 (Extended-thinking mapping) — same phase that wires effort, must also quarantine it from fork.

---

### Pitfall 4: Extending `effortSchema` / adding new reasoning fields breaks v2.1-migrated YAMLs

**What goes wrong:**
`schema.ts:13` defines `effortSchema = z.enum(["low", "medium", "high", "max"])` and `agentSchema.effort` defaults to `"low"`. The 15 migrated agents already wrote `effort: low` into their clawcode.yaml during v2.1 apply (`effortSchema.default("low")` baked it in). If v2.2 adds a new field like `reasoning_effort` or `thinkingBudget` at the agent level WITHOUT preserving `effort`, the v2.1 ledger + rollback invariants break (`verify` compares shipped config against apply-time snapshot).

Worse: if v2.2 renames `effort` → `reasoning_effort` to align with OpenClaw's field name (Ramy-style naming drift), the Zod parse fails loud on boot of all 15 agents post-restart. Fail-loud is good in a greenfield, catastrophic on a production fleet.

**Why it happens:**
Schema evolution temptation — "OpenClaw calls it `reasoning_effort`, let's unify." The migration CLI already mapped OpenClaw's `reasoning_effort` → ClawCode's `effort` in v2.1, so changing the ClawCode field name now un-does that mapping.

**How to avoid:**
1. KEEP `effort` as the canonical field name. Do not rename.
2. If you need to add a second dimension (e.g., explicit `thinkingBudget: number` override), add it as a NEW optional field next to `effort`. Make it optional with no default.
3. Add a Zod `superRefine` rule: `if thinkingBudget set, effort must be compatible`. Fail at config-load, not at runtime.
4. Run `clawcode migrate openclaw verify` across the full fleet as part of Phase 2 acceptance gate — the v2.1 verifier already checks config-shape invariants per agent.

**Warning signs:**
- PR diff touches `effortSchema` or renames `effort` field
- Zod `.strict()` mode added to `agentSchema` without a migration (Zod 4 defaults to strip-unknown, which is forgiving; strict flips the contract)
- `.planning/milestones/v2.1-migration-report.md` invariants no longer pass after v2.2 changes

**Phase to address:** Phase 2 (Extended-thinking mapping). Cross-reference v2.1 migration invariants in the phase's success criteria.

---

### Pitfall 5: `/clawcode-model` write-back to clawcode.yaml triggers hot-reload mid-turn, session restarts, active stream dies

**What goes wrong:**
`agents.*.model` is explicitly classified as NON-reloadable (`src/config/types.ts:58`: `"agents.*.model"`). The comment on `agents.*.memoryPath` spells out the pattern: changing these fields requires `systemctl stop && apply && systemctl start`.

If `/clawcode-model opus` writes the new value into clawcode.yaml (like OpenClaw's picker does), the chokidar-driven config-reloader will detect a `agents.<name>.model` change, classify it as non-reloadable, and — depending on reloader policy — either log-and-ignore, or trigger a session restart. In the middle of a user's in-flight turn. The streaming reply dies, the user sees an error, the in-flight `Turn` is orphaned.

**Why it happens:**
OpenClaw's picker wrote to OpenClaw's config directly (stateless bridge, no persistent sessions to worry about). Porting that pattern naively to ClawCode bypasses the session-lifecycle invariants.

**How to avoid:**
1. For `/clawcode-model`, DO NOT write to clawcode.yaml as the primary action. Instead:
   - Call a new `sessionManager.setModelForAgent(name, model)` method (mirroring `setEffortForAgent`). Takes effect on next turn only — no YAML mutation, no restart.
   - If the user wants the change to PERSIST across daemon restarts, offer a follow-up `/clawcode-model-persist` that writes YAML + warns `"requires agent restart to take effect; will apply on next /clawcode-restart"`.
2. If you MUST write YAML (product decision), write it in a way the config-reloader skips — e.g., use a separate `~/.clawcode/runtime-overrides/{agent}.yaml` file that the loader merges in-memory but the hot-reload watcher ignores.
3. Explicit test: emit a fake chokidar event with an `agents.*.model` change during an active turn; assert the turn completes and the session is NOT restarted until idle.

**Warning signs:**
- PR touches clawcode.yaml writer in the model-picker code path
- No new `session-manager.ts:setModelForAgent` method
- `grep -n "writeFileSync\|yaml.stringify" src/discord/` returns hits in the new picker code
- `.planning/debug/` acquires a new entry about "session restart during /model"

**Phase to address:** Phase 3 (Dual model picker). Must be decided BEFORE any write-back logic lands.

---

### Pitfall 6: OpenClaw picker and ClawCode picker both write clawcode.yaml — lost updates, corrupted YAML

**What goes wrong:**
The v2.2 goal says "keep OpenClaw's existing picker alive but make it read from the bound agent's clawcode.yaml allowed-model list." If "keep alive" means the OpenClaw picker also *writes* to clawcode.yaml, you have two processes with no shared lock editing the same file. YAML doesn't merge — last-writer-wins. Worse, `yaml` v2.8.3 (package.json) uses document-AST preservation; a partial write from one picker while the other has a stale AST cached produces a broken file.

The v2.1 migration already uses the atomic-temp+rename pattern (`.planning/PROJECT.md:88`: "atomic YAML writer — … Document-AST comment preservation with atomic temp+rename"). But atomic rename guards against crash-mid-write, not concurrent writers.

**Why it happens:**
The two pickers are in different runtimes (OpenClaw bridge = Node.js child of the bridge daemon; ClawCode = ClawCode daemon). No shared mutex, no fcntl lock, no sqlite-coordinated transaction.

**How to avoid:**
1. Make the OpenClaw picker READ-ONLY against clawcode.yaml. Source of truth for the allowed-model list is clawcode.yaml; source of truth for the *selected* model is a runtime state in the ClawCode daemon (not the file).
2. OpenClaw picker should call a ClawCode IPC endpoint (`sendIpcRequest(SOCKET_PATH, "set-model", {agent, model})`) which ClawCode owns. All writes serialized inside the daemon.
3. Use `flock(2)` on clawcode.yaml if two processes MUST write — but this is an escape hatch, not a design.
4. Document the ownership rule in `CLAUDE.md`: "clawcode.yaml is owned by the ClawCode daemon. External processes must use IPC."

**Warning signs:**
- Both bridge and daemon import `yaml` and have writer code paths
- `flock` / advisory-lock helpers appear (signals the author realized the race but didn't redesign)
- `.planning/debug/` logs like "clawcode.yaml parse error on boot, last written by openclaw-bridge"

**Phase to address:** Phase 3 (Dual model picker). Decide ownership before implementation.

---

### Pitfall 7: Stale allowed-model list — picker offers Opus after budget exhausted, agent can't actually use it

**What goes wrong:**
v1.5 introduced `escalationBudget` (daily/weekly Opus/Sonnet caps per agent — `schema.ts:679-688`). The picker reads the agent's allowed-model list (static from YAML) and offers `[haiku, sonnet, opus]`. User picks `opus`. The budget tracker rejects the next turn with `"weekly opus budget exhausted"`. User sees the rejection, thinks ClawCode is broken.

**Why it happens:**
The "allowed list" in YAML is a capability declaration, not a runtime-availability check. Budget state lives in the ClawCode daemon; the picker doesn't consult it.

**How to avoid:**
Picker rendering must ask the daemon for *effective available models right now*, not the static YAML list. Add an IPC method `get-available-models` that returns the allowed list minus models whose budget is exhausted or whose provider is health-checked down (if applicable). Annotate the picker UI: `"opus (exhausted — resets Monday)"` — disable the entry but show why.

Verification: manually exhaust Opus budget (set daily=1, burn it), then run picker; Opus row should appear greyed with reason text.

**Warning signs:**
- Picker code reads `config.agent.allowedModels` or similar static list with no IPC call
- No handling of `BudgetExhaustedError` in the picker UI
- Support log: "user keeps trying opus, getting errors"

**Phase to address:** Phase 3 (Dual model picker) — acceptance criteria must include budget-aware rendering.

---

### Pitfall 8: SDK dispatch gap — sending `/clear` as a text prompt does NOT execute it; LLM just acknowledges

**What goes wrong:**
This is THE biggest technical risk for Phase 4. The existing slash-command handler formats commands as text prompts (`formatCommandMessage` at `slash-commands.ts:619-641`) and sends them via `sessionManager.streamFromAgent`. For CONTENT commands (`/clawcode-memory → "Search your memory for: foo"`), this works because the agent interprets the prompt and uses tools.

But native CC commands like `/clear`, `/compact`, `/memory`, `/agents`, `/permissions` are **CLI/session-level control commands**, NOT prompts the LLM acts on. The `claude` CLI handles them before the LLM sees them. Inside the Agent SDK's `query()` iterator, there is no equivalent entry point — sending the literal string `"/clear"` causes the LLM to output `"I've cleared the context"` as text while the actual session context is untouched. Silent correctness failure, no error anywhere.

**Why it happens:**
Claude Code CLI users interact with these commands via an interactive TUI that intercepts the slash. The Agent SDK's programmatic surface is a different beast — `query()` + message events. Not every CLI slash command has an SDK equivalent. The `sdk.d.ts` 1.7K-line surface exposes `interrupt`, `setMaxThinkingTokens`, session `forkSession`, `resume` — but not a generic "execute slash command" dispatch.

**How to avoid:**
**Before building ANY native CC slash routing, audit each command for SDK reachability.** For each:

| CC command | SDK equivalent | Action |
|---|---|---|
| `/clear` | No direct. Need to end session + start fresh w/ new `session_id` | Implement via `sessionManager.resetAgent(name)` |
| `/compact` | No direct. Already routed via `clawcode-compact` prompt | Keep existing text-prompt pattern (LLM can trigger memory_compact internally) |
| `/model` | No direct. Use `setModelForAgent` per Pitfall 5 | IPC to daemon |
| `/memory` | No direct. Already routed via `clawcode-memory` | Keep existing pattern |
| `/agents` | Lists subagent defs. Read `agents` option from session | Daemon IPC returning static list |
| `/mcp` | MCP server status. Query SDK's MCP server registry | Daemon IPC (SECURITY: see Pitfall 12) |
| `/cost` | Return session usage. Read from `ConversationStore`/`UsageTracker` | Daemon IPC |
| `/todos` | Agent's TodoWrite state. Not persisted by SDK | Skip for v2.2 OR intercept TodoWrite tool calls |
| `/permissions` | Tool permission state. Read from session options | Daemon IPC, read-only |
| `/init` | Creates CLAUDE.md. Pure filesystem op | Agent-routed prompt OR daemon file write |
| `/review`, `/security-review` | Prompt-style. Route via text | Text-prompt pattern, fine |

Rule: if the command has no SDK control-plane equivalent, it MUST be implemented on the ClawCode side (daemon logic + IPC), not sent as a prompt. Add a `nativeBehavior: "sdk-controlled" | "prompt-routed" | "daemon-owned"` discriminator in the command definition so authors cannot accidentally text-route a control command.

**Warning signs:**
- PR adds `DEFAULT_SLASH_COMMANDS` entries with `claudeCommand: "/clear"` or similar literal-CLI strings
- No corresponding `SessionManager` method for the new command's semantics
- Manual QA: run `/clear`, then ask agent "do you remember what we talked about?" — agent remembers. The command lied.

**Phase to address:** Phase 4 (Native CC slash commands). Must start with the audit table, not with code.

---

### Pitfall 9: Registering native CC commands per-agent explodes past Discord's 100-command-per-guild limit

**What goes wrong:**
Discord allows max 100 global application commands per application, and max 100 guild commands per guild. ClawCode currently uses guild-scoped commands (`slash-commands.ts:126-174`: `Routes.applicationGuildCommands`). The current registration loop also DEDUPES by command name (`seenNames` set, line 129-139) — so "per-agent" already means "one command, dispatched-by-channel."

If v2.2 naively registers 20 native CC commands × 15 agents = 300 distinct registrations, the `rest.put` call fails with Discord 400 after the 100th command. Even worse: if you add model-namespaced variants (`/clawdy-clear`, `/finmentum-clear`, etc.) to make each agent identifiable, you hit the limit immediately.

**Why it happens:**
Thinking "one command per agent for isolation" before reading the existing registration code. The existing pattern (dedupe by name, dispatch-by-channel) already solves this — native CC commands just need to follow it.

**How to avoid:**
1. Register each native CC command ONCE per guild, not per agent. Dispatch is by `interaction.channelId → getAgentForChannel(routingTable)` — same pattern as existing `clawcode-*` commands (`slash-commands.ts:211`).
2. Budget sanity check before register: `assert allCommands.length <= 90` (reserve 10 slots for future). Log at startup with count.
3. If you truly need per-agent variants (e.g., admin vs user), use Discord's `default_member_permissions` on the command def, not separate commands.
4. Hard rate-limit awareness: `rest.put` for bulk overwrite on a single guild is one API call; no per-command registration churn needed. But registering across guilds has global rate limits — space guilds over time if you expand beyond one server.

**Warning signs:**
- `grep -n "for.*agent.*rest.put\|\.put(.*applicationCommand" src/discord/` shows per-agent registration
- Count of `CONTROL_COMMANDS` + `DEFAULT_SLASH_COMMANDS` + native additions exceeds 80
- Discord API log shows `"error": { "code": 30034 }` (max application commands reached)

**Phase to address:** Phase 4 (Native CC slash commands) — follow the existing dedupe pattern, add a pre-flight count assert.

---

### Pitfall 10: Namespace collision — `/model` native vs `/clawcode-model` dual picker vs OpenClaw picker

**What goes wrong:**
Three things want to own `/model`:
1. The v2.2 dual-picker plan wants a native `/clawcode-model` slash command (Phase 3).
2. The v2.2 native-CC plan wants to expose CC's `/model` command (Phase 4).
3. Bare `/model` is in `DEFAULT_SLASH_COMMANDS` already (`slash-types.ts:102-114`, name `"clawcode-model"`) — wait, it's namespaced. Good. But the user reads CC docs, types `/model opus`, Discord autocompletes to nothing, confused.

If Phase 4 registers a bare `/model` (to mirror CC's native surface), and Phase 3 has `/clawcode-model`, you have two slash commands doing similar-but-different things. Users get:
- `/model opus` → (Phase 4 native-CC handler, may or may not persist depending on Pitfall 5)
- `/clawcode-model opus` → (Phase 3 dual-picker handler, persists to clawcode.yaml via IPC)

**Why it happens:**
"Let's give Discord users the exact CC CLI experience" pulls toward bare-name commands. "Let's not conflict with other Discord bots in the same server" pulls toward `clawcode-*` namespace. The two pull apart.

**How to avoid:**
1. Pick ONE convention: ALL ClawCode slash commands are `clawcode-*` namespaced. No bare `/model`, `/clear`, `/memory`. Rationale: Discord guilds often have many bots; bare-name collisions with community bots are common and produce confusing dispatch errors.
2. Document the namespace rule in CLAUDE.md and add a lint rule / zod validator: `slashCommandEntrySchema.name.regex(/^clawcode-/)`.
3. For Phase 3: ONE `/clawcode-model` that handles both "show picker" (no arg) and "set model" (with arg). Deprecate the OpenClaw picker in-place (still functional, UI hint says "see /clawcode-model in ClawCode channels").

**Warning signs:**
- New `DEFAULT_SLASH_COMMANDS` entries without the `clawcode-` prefix
- Two command entries with overlapping `claudeCommand` handlers
- Discord user reports: "I typed /model, I'm not sure which one just ran"

**Phase to address:** Phase 3 AND Phase 4. Decide the namespace convention up-front (first task of Phase 3).

---

### Pitfall 11: `/clear` wipes ConversationStore, orphans in-flight summarization, deletes memories users rely on

**What goes wrong:**
Naive `/clear` = "reset context" as CC users know it. In ClawCode, the session context is built from:
1. Hot-tier memories (SQLite, per agent)
2. ConversationStore (recent turns, FTS5)
3. Session-summary memory entries (v1.9 resume auto-injection)
4. Context-assembly pipeline output

"Clear" is ambiguous. Does `/clear`:
- End the current SDK session only (next turn starts with fresh session_id, but all memory remains)?
- Also wipe hot-tier memories?
- Also delete ConversationStore rows?
- Also delete session-summary MemoryEntries (tagged `"session-summary"`)?

If `/clear` deletes too much, a user who ran it to "start fresh on this topic" loses weeks of memory. If it deletes too little, the LLM still has context injected from hot-tier and the user sees the "reset" didn't work.

Also: `session-summary` compression (v1.9 SESS-01/04) may be running WHEN `/clear` fires. Deleting session rows mid-summarization writes an incomplete summary referencing deleted turn IDs. Referential integrity breaks.

**Why it happens:**
Overloading a single command that means different things in different runtimes.

**How to avoid:**
1. Be explicit in naming: `/clawcode-session-reset` (ends SDK session only, memory intact) vs `/clawcode-memory-purge` (destructive, requires confirmation + admin role).
2. Never expose bare `/clear` without documenting exactly what it does. Put the doc in the slash command `description` field (Discord shows it in autocomplete).
3. On any destructive path: check for in-flight summarization (`sessionSummarizer.isRunning(agentName)`) and either wait or abort the destructive op with a clear error.
4. Default to the LEAST destructive interpretation. The memory system has auto-consolidation + decay; letting those take care of "clearing" is usually the right answer.

**Warning signs:**
- A command named `/clear` or `/clearAll` exists with no qualifier
- Destructive handler lacks a `requireConfirmation` option parameter
- `grep -n "DELETE FROM\|memoryStore.purge\|conversationStore.delete" src/discord/` returns hits — DB writes should not live in the Discord layer

**Phase to address:** Phase 4 (Native CC slash commands) + coordination with memory system owner.

---

### Pitfall 12: `/mcp` exposes env vars, command paths, OR 1Password references in Discord

**What goes wrong:**
`mcpServerSchema` has `env: Record<string, string>` (`schema.ts:175`) and `command: string` (line 174). CC's native `/mcp` lists servers with their configs. If the ClawCode equivalent dumps `mcpServerSchema` contents to Discord:
- `command: "/usr/local/bin/mcp-mysql"` leaks binary paths
- `env: { MYSQL_PASSWORD: "op://vault/item/password" }` leaks 1Password references (not the password itself, but attackers learn the vault layout)
- `env: { MYSQL_PASSWORD: "actualsecret" }` — if ANY agent has literal secrets (not op:// refs), they leak directly

The v2.1 migration's pre-flight already has secret-shape detection (`src/util/scanSecrets.ts` per PROJECT.md:87). But secret-shape scanning catches `sk-*`-style patterns, not custom DB passwords.

**Why it happens:**
Trivial to implement `/mcp` as "dump the server list to chat." CC CLI does this safely because the terminal is single-user. Discord is multi-user.

**How to avoid:**
1. `/clawcode-mcp` lists server NAMES only. No `command`, no `args`, no `env` in the Discord output.
2. For debugging, add a separate `clawcode mcp show <server>` CLI that runs with the operator's terminal privileges, not Discord.
3. If the Discord output MUST include command/args, apply `scanSecrets` + redact any `env` value that looks sensitive; always redact `env` values ending in `_TOKEN`, `_PASSWORD`, `_KEY`, `_SECRET`.
4. Role-gate `/clawcode-mcp` behind Discord `default_member_permissions` (admin only), same as `/clawcode-agent-create`.

**Warning signs:**
- `/mcp` handler returns any value from `config.mcpServers.*.env`
- No `scanSecrets` call on the Discord-bound MCP response
- PR adds a full config dump to a slash command reply

**Phase to address:** Phase 4 (Native CC slash commands) — pair with security-reviewer agent for the audit.

---

### Pitfall 13: Finmentum-specific skills pollute non-finmentum agents via `defaults.skills`

**What goes wrong:**
`~/.openclaw/skills/` contains domain-specific skills: `finmentum-crm` (tied to Finmentum MySQL DB at `100.117.234.17:3306`), `tuya-ac` (home automation for one house), `power-apps-builder` (specific to Ramy's Power Apps workflow). These SHOULD NOT be linked into Clawdy, the admin agent, or any agent outside the finmentum family.

If the v2.2 migration is sloppy — e.g., `clawcode migrate skills --all` copies everything into `~/.clawcode/skills/`, then assigns them via `defaults.skills: [all-discovered-skills]` — every agent boots with MySQL connection strings and Tuya API keys visible in its system prompt. Skill scanner (`src/skills/scanner.ts`) pulls the first paragraph (`extractDescription`) into the catalog; `finmentum-crm`'s first paragraph reveals the DB host, port, username, and password (confirmed by the `head -30` output above: the credentials are literally in the skill description).

**Why it happens:**
Convenience — "let's migrate everything and let agents opt in." But `defaults.skills` cascades to every agent.

**How to avoid:**
1. Migrate skills into `~/.clawcode/skills/` (global pool) but do NOT auto-assign them in `defaults.skills`. Each agent gets an explicit per-agent assignment.
2. Audit skill descriptions for embedded secrets BEFORE migration. Run `scanSecrets` against every `SKILL.md` frontmatter + first paragraph. For any skill with embedded creds:
   - Move creds to MCP server env (op:// refs)
   - Strip the example from SKILL.md
3. Tag skills as `scope: fleet | agent-family-finmentum | single-agent` in frontmatter. Linker rejects cross-scope assignments.
4. Verification: after migration, boot a non-finmentum agent, inspect its resolved system prompt, assert no finmentum strings appear.

**Warning signs:**
- `grep -r "100.117.234.17\|MYSQL_PASSWORD\|op://" ~/.clawcode/skills/` returns hits
- Clawdy or admin agents have `finmentum-crm` in their linked skills
- Any agent prints DB creds in `clawcode-status` output

**Phase to address:** Phase 1 (Skills migration) — secret audit is a gating step, not a follow-up.

---

### Pitfall 14: SKILL.md frontmatter format drift breaks both OpenClaw and ClawCode scanners

**What goes wrong:**
Verified drift between the two formats:

**OpenClaw (`~/.openclaw/skills/cognitive-memory/SKILL.md`):**
```yaml
---
name: cognitive-memory
description: Intelligent multi-store memory system...
---
```

**ClawCode (`~/.clawcode/skills/subagent-thread/SKILL.md`):**
```yaml
---
version: 1.0
---
```

ClawCode's `scanSkillsDirectory` (`src/skills/scanner.ts`) extracts ONLY `version` from frontmatter (line 10-18) and pulls description from the first paragraph of body (line 25-43). OpenClaw's format has `name` + `description` in frontmatter, no `version`, and body starts with `# Title` (which extractDescription picks up as single-line description — wrong).

If you migrate OpenClaw skills as-is into ClawCode:
- `extractVersion` returns `null` for every skill (no `version` field)
- `extractDescription` returns `"# Cognitive Memory System"` (just the H1 title) instead of the actual description
- The catalog entry is near-useless for discoverability
- Claude Code's own loader may refuse skills missing `version` (depends on CC CLI version)

**Why it happens:**
Two independent skill formats evolved in parallel. Neither scanner validates the other's contract.

**How to avoid:**
1. Migration CLI (Phase 1) must REWRITE frontmatter during copy:
   - Preserve OpenClaw's `name` + `description`
   - Add `version: "1.0.0"` if absent
   - Normalize to ClawCode's format: BOTH `description` in frontmatter AND first paragraph of body (belt-and-suspenders for future scanner changes)
2. Add a schema for SKILL.md frontmatter (zod): `{ name: string, description: string, version: string, scope?: 'fleet'|'family-*'|'agent-*' }`.
3. Upgrade `scanner.ts` to parse `description` from frontmatter with fallback to first paragraph (belt-and-suspenders).
4. Verification post-migration: boot the daemon, run `clawcode skills list`, assert every migrated skill has a non-empty description AND a version.

**Warning signs:**
- `scanner.ts` returns catalog entries with `description === ""` or `description.startsWith("#")`
- CC CLI logs: `"skipping skill foo: missing required frontmatter field"`
- Grep for `/^---\n[^-]/` in migrated skills shows inconsistent frontmatter shapes

**Phase to address:** Phase 1 (Skills migration) — format converter is a required sub-phase.

---

### Pitfall 15: Symlink collision — OpenClaw `openclaw-config` skill clobbers ClawCode equivalent

**What goes wrong:**
`~/.openclaw/skills/openclaw-config/` contains OpenClaw-specific config scaffolding. If migration copies into `~/.clawcode/skills/openclaw-config/` and the linker (`src/skills/linker.ts`) blindly creates symlinks from agent workspaces, any agent with `skills: [openclaw-config]` in its YAML (e.g., from v2.1-migrated configs that still reference the old skill name) gets a broken skill that refers to OpenClaw runtime state — sqlite paths, env vars — that don't exist in ClawCode.

Linker behavior (confirmed line 44-63): if a non-symlink file/dir exists at the link path, it SKIPS with a warning. But if an existing symlink points to the wrong target, it UNLINKS and recreates (line 51-53). So a second migration run can silently replace a correct ClawCode-native skill with the OpenClaw import.

**Why it happens:**
Skill name collisions between the two catalogs. Same name, different content, different expected runtime.

**How to avoid:**
1. Migration should rename on collision, not overwrite: if `~/.clawcode/skills/{name}` exists AND content differs, migrate as `{name}-openclaw-imported` and log the rename.
2. Add a skill-registry audit step post-migration: for each skill, check its SKILL.md for references to OpenClaw-specific paths (`~/.openclaw/`, `~/.clawdbot/`, OpenClaw-specific env vars like `OPENCLAW_*`). Any skill that passes the audit is safe; failures require manual port.
3. Make the linker idempotent per Pitfall 16 (rerunning migration MUST NOT change state if nothing has changed).

**Warning signs:**
- Two skills with the same name across `~/.openclaw/skills/` and `~/.clawcode/skills/`
- A migration run reports "created symlink" for a skill on re-run (should report "skip, already correct")
- Skill body references `~/.clawdbot/clawdbot.json` or similar OpenClaw-era paths

**Phase to address:** Phase 1 (Skills migration) — collision resolution before linker wiring.

---

### Pitfall 16: Non-idempotent skill migration duplicates or corrupts on re-run

**What goes wrong:**
Migration CLI users run `clawcode migrate skills` twice "just to be sure." If not idempotent:
- Directories appended-to (second copy nested inside first)
- SKILL.md frontmatter double-rewritten (version bumped, description prefixed, etc.)
- Linker symlinks create-unlink-create cycles that race against ongoing daemon reads

v2.1's memory migration used `origin_id UNIQUE` idempotency (PROJECT.md:90). Skills need the same pattern.

**Why it happens:**
Skills feel "simple" (just files). Idempotency thinking slips.

**How to avoid:**
1. Content-hash guard: before copying a skill, hash source SKILL.md (and all files in skill dir). If destination hash matches, skip silently.
2. Frontmatter rewrite is idempotent by construction: normalize to a canonical shape (sorted keys, fixed quote style). Re-running the rewrite on already-normalized frontmatter is a no-op.
3. Linker already is idempotent for the common case (line 48-51: "Already correct, skip"). Don't regress this in Phase 1 changes.
4. Test: run the full migration command twice in a fresh container; diff the filesystem snapshots; expected diff = empty.

**Warning signs:**
- Skill directories nested inside themselves (`power-apps-builder/power-apps-builder/`)
- SKILL.md frontmatter with multiple `---` blocks
- Second migration run reports `"copied N skills"` when zero were newly migrated

**Phase to address:** Phase 1 (Skills migration) — idempotency is a gate-criterion, not a nice-to-have.

---

### Pitfall 17: Skills referencing native CC slash commands (feature 4) break if command dispatch semantics change

**What goes wrong:**
Cross-feature. Migrated skills may contain instructions like `"Run /memory search foo"` or `"Use /compact when context fills."` If Phase 4 decides that `/memory` (bare) doesn't exist but `/clawcode-memory` does (per Pitfall 10), and skills aren't updated, the agent tries to execute commands that don't exist. Depending on dispatch semantics (see Pitfall 8), the command is either rejected with a clear error, or silently treated as text and the LLM invents a plausible response.

**Why it happens:**
Skills written against OpenClaw or against the CC CLI carry hard-coded command names. No schema enforces a dependency on specific commands.

**How to avoid:**
1. During Phase 1 migration, grep every SKILL.md for slash patterns (`\s/[a-z]+`). Flag them. For each, decide: rewrite to the `clawcode-*` namespace, or add an equivalent command under the chosen namespace.
2. Publish a canonical command reference in the ClawCode docs and reference it from SKILL.md files (link, not copy).
3. In Phase 4, maintain a deprecated-aliases table (`"/memory" → "/clawcode-memory"`) that the interaction handler transparently routes. Log a deprecation warning to the agent so it self-corrects its outputs.

**Warning signs:**
- `grep -rn "\s/[a-z][a-z-]*" ~/.clawcode/skills/` returns hits after migration
- Agent output in Discord: "I'll use /memory search..." followed by silence or confabulated result

**Phase to address:** Phase 1 (Skills migration) discovery, Phase 4 (Native CC slash) alias routing.

---

### Pitfall 18: `self-improving-agent` skill re-writes its own workspace files — unsafe in a shared basePath

**What goes wrong:**
`~/.openclaw/skills/self-improving-agent/` edits agent files in-place. v2.1 introduced shared-basePath support for the finmentum family (`schema.ts:649` `memoryPath`) — multiple agents point at ONE workspace for SOUL.md but separate memoryPaths for isolation. A self-modifying skill writing to `<workspace>/SOUL.md` now affects every agent sharing that basePath. Two agents running the skill concurrently race each other's writes.

**Why it happens:**
The skill was designed before shared-basePath existed. Phase 75 invariants (PROJECT.md:85) were not a constraint at skill authoring time.

**How to avoid:**
1. Audit self-modifying skills for write paths. Any skill that writes to `workspace/*` must be scope-flagged (per Pitfall 13): `scope: single-agent` or `scope: family-owner-only`.
2. Linker refuses to install a `scope: single-agent` skill on an agent that shares its basePath with siblings (the config has `memoryPath` set AND another agent has the same `workspace`).
3. Phase 2-complete test: run self-improving-agent on a shared-basePath agent; assert it refuses with a clear error, not a silent race.

**Warning signs:**
- Grep `writeFile.*SOUL\|writeFile.*IDENTITY` in skill bodies or scripts
- Finmentum agent siblings see each other's SOUL edits
- Concurrent file-modification-time stamps on shared workspace files

**Phase to address:** Phase 1 (Skills migration) — scope-flag enforcement.

---

## Cross-Feature Pitfalls

### Cross-Pitfall A: Extending clawcode.yaml schema (feature 2) invalidates v2.1-migrated configs

**What goes wrong:**
Feature 2 (effort mapping) may want to add fields like `thinkingBudget`, `reasoning_effort` aliases, or per-effort cost overrides. The 15 v2.1-migrated agents have fixed YAMLs; a schema change that isn't additive-with-defaults breaks them on load.

**How to avoid:**
- All new agent-level fields in Phase 2: `z.TYPE().optional()` with no default OR `.default(SAFE_VALUE)` matching current behavior. Never introduce a required new field.
- Re-run `clawcode migrate openclaw verify` as Phase 2 final step.

**Warning signs:**
- Zod `.strict()` appears on `agentSchema`
- New fields without `.optional()` or defaults
- v2.1 verify breaks post-phase

**Phase to address:** Phase 2.

---

### Cross-Pitfall B: Namespace shared between Phase 3 model picker and Phase 4 native CC commands

**What goes wrong:**
Described in Pitfall 10. If Phase 3 ships `/clawcode-model` with one set of semantics, then Phase 4 adds `/model` (bare) with different semantics, users are confused and the dual picker's value proposition breaks.

**How to avoid:**
Decide namespace convention BEFORE Phase 3 kickoff. Convention: all ClawCode Discord commands MUST be prefixed `clawcode-`. Native-CC parity commands are `/clawcode-clear`, `/clawcode-memory`, etc. Phase 4 does not add bare commands.

**Warning signs:**
Any new `DEFAULT_SLASH_COMMANDS` entry lacking `clawcode-` prefix.

**Phase to address:** Phase 3 (namespace decision), Phase 4 (implementation follows convention).

---

### Cross-Pitfall C: Skills (feature 1) reference commands whose dispatch (feature 4) is not yet implemented

Described in Pitfall 17. Sequencing matters:
- Phase 1 produces the skill corpus + flags slash-command references.
- Phase 4 owns the alias/routing table that makes those references work.
- If Phase 1 ships and Phase 4 is delayed, migrated skills emit dead commands in agent outputs.

**How to avoid:**
Phase 1 acceptance criterion: "zero unresolved slash references in migrated skills." If Phase 4's command set isn't finalized, Phase 1 must rewrite skill text (via sed-style script in the migration CLI) to use `clawcode-status`-style defaults that already exist.

**Phase to address:** Phase 1 acceptance criteria + Phase 4 sequencing.

---

### Cross-Pitfall D: Hot-reload classification for new fields

Any new top-level or agent-level field added in v2.2 (effort-related, model-allowed-list, slash-command entries) must be explicitly classified in `RELOADABLE_FIELDS` / `NON_RELOADABLE_FIELDS` (`src/config/types.ts:45-67`). Forgetting the classification means the differ defaults to non-reloadable (line 148), which is safe-but-surprising: a cosmetic change requires daemon restart.

**How to avoid:**
- Every PR that touches `schema.ts` must also touch `types.ts` RELOADABLE/NON_RELOADABLE sets.
- Add a unit test: enumerate every `agents.*.<field>` in the schema, assert each appears in one of the two sets.

**Phase to address:** All phases adding schema fields (Phase 2, potentially Phase 3, potentially Phase 4).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Text-prompt native CC commands instead of control-plane dispatch | Ships fast; LLM "responds" plausibly | Silent correctness failures (Pitfall 8); command guarantees lie | Never for `/clear`, `/model`, `/compact`, `/mcp`. Acceptable ONLY for prompt-like ones (`/review`, `/security-review`). |
| Writing clawcode.yaml from the OpenClaw picker | Preserves v2.1 UX without ClawCode IPC work | Lost updates (Pitfall 6); partial YAML corruption; config-reload races (Pitfall 5) | Never. Use IPC. |
| Skipping idempotency checks in skills migration | Smaller migration CLI diff | Silent corruption on re-run; hard-to-reproduce bugs | Never. Idempotency is the migration contract. |
| Migrating finmentum skills to all agents | "Just get everything over" | Secret leaks (Pitfall 13); SOUL drift; cross-family confusion | Never. Explicit per-agent assignment only. |
| Bare `/model`, `/memory`, `/clear` instead of `clawcode-*` prefixed | Perfect CC CLI parity | Collision with community Discord bots; Pitfall 10 | Only if ClawCode deployments are guaranteed to never share a guild with other bots — essentially never. |
| Defaulting thinking tokens `high` across all agents | Simple mental model | Cost blowout (Pitfall 3); no guard against Haiku unsupported (Pitfall 2) | Only for Opus-bound admin agents with explicit budget monitoring. |
| Linker eager-rewriting existing symlinks | Always-correct state | Races with live daemon reads; can silently replace native ClawCode skills with OpenClaw imports (Pitfall 15) | Default (current behavior is fine); add content-hash guard if skill re-migrations become common. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Agent SDK 0.2.97 | Calling `q.setMaxThinkingTokens()` expecting v4-style behavior | Read `sdk.d.ts:1713` — deprecated in favor of per-query `thinking` option. On Opus 4.6, `setMaxThinkingTokens(0)` = off, positive = adaptive. |
| Discord Application Commands API | Registering per-agent variants (300 commands) | Register once per guild, dispatch-by-channel (existing pattern at `slash-commands.ts:126-174`). Hard cap: 100/guild, 100 global. |
| chokidar config watcher | Assuming `agents.*.model` edits are reloadable | It's explicitly non-reloadable (`types.ts:58`). Write-back triggers full session restart. |
| `yaml` v2.8.3 Document AST | Concurrent writers from two processes | Atomic temp+rename does NOT prevent concurrent writers — only crash-mid-write. Use IPC for serialized writes. |
| MCP server env vars (1Password refs) | Dumping `mcpServerSchema.env` to Discord | Redact all env values in Discord output; expose only via local CLI. |
| Skill linker symlinks | Assuming file-based skills are non-racy | Daemon reads SKILL.md at boot + heartbeat; mid-migration linker changes can return partial reads. Quiesce or snapshot before linker writes. |
| Session fork (`forkSession`) | Expecting effort/thinking state to be fresh | Forks inherit parent state including `currentEffort`. Reset in `buildForkConfig`. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-agent slash command registration | Discord 400 `code: 30034` | Dedupe by name, dispatch-by-channel | At 5 agents × 20 commands = 100 |
| Effort `max` on every turn | 5-10× token cost, latency spike | Guard by model capability; budget per-agent | At first admin-heavy day |
| Thinking tokens breaking prompt cache | `cache_read_input_tokens` stays 0 turn-over-turn | Verify cache hit rate post-effort-wire; thinking-token inclusion may invalidate cached prefix if v1.7 caching puts them in the cached block | Detected only by monitoring, not by test |
| Skill scanner on every heartbeat with 200+ skills | CPU spike; file I/O churn | Cache `scanSkillsDirectory` output; invalidate only on chokidar SKILL.md change | At ~50 skills with 60s heartbeat |
| Loading full ConversationStore for `/clawcode-cost` | Slow response, DB contention | Query aggregated view, not raw rows | After a few weeks of per-agent conversation history |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `/mcp` dumps env including 1Password vault refs | Attackers map vault structure; correlate to exfiltration | Redact all env; expose server names only |
| Finmentum-CRM skill description contains literal DB creds (confirmed in source file) | Any agent with the skill linked leaks MySQL creds in system prompt | Strip creds from SKILL.md; move to MCP env with op:// refs before migration |
| `/clawcode-model` settable by any Discord user | Budget exhaustion attack: user escalates every agent to Opus, burns weekly budget in one session | `default_member_permissions` on model-changing commands, or ACL via existing `security.allowlist` |
| `/clawcode-agent-create` reachable in unprivileged channels | Account takeover via malicious agent creation | Already requires name+soul; add admin-only role gate if not present |
| `/clear` with no audit trail | Destructive op untraceable | Emit config-audit JSONL entry (`config/audit.ts` pattern from v1.2) for every destructive slash command |
| Symlink traversal in skills migration | Symlink in source skill pointing outside the skills tree exfiltrates files on copy | `fs.cp` with `dereference: false` + explicit path-boundary check |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `/clawcode-effort max` replies "Effort set to max" when model doesn't support it | User thinks agent is thinking deeply; it isn't | Validate against model capability; reply with downgrade notice |
| Picker shows exhausted-budget models as available | User picks Opus, first turn errors | Annotate unavailable models with reason in the picker UI |
| `/clawcode-clear` wipes memory users rely on | Weeks of context gone, no undo | Confirmation flow + named qualifier (`-session` vs `-memory`) |
| Two pickers (OpenClaw + ClawCode) with similar names, different behaviors | User learns the wrong one, reports "bug" | Deprecate OpenClaw picker visibly; UI hint `"use /clawcode-model"` in OpenClaw picker output |
| Native CC commands register with CC-CLI descriptions ("clears the context") | Users expect CC CLI semantics; ClawCode semantics differ | Rewrite descriptions to clarify ClawCode behavior; link to docs |

---

## "Looks Done But Isn't" Checklist

- [ ] **Effort slash command:** setEffort actually calls `q.setMaxThinkingTokens` (or passes `thinking` on the query) — verify by spying on query options, not handle state
- [ ] **Effort slash command:** rejected `max` on Haiku-bound agents with a useful error
- [ ] **Effort slash command:** forks reset to `low` regardless of parent effort
- [ ] **Dual model picker:** neither picker writes clawcode.yaml directly; all mutations go through daemon IPC
- [ ] **Dual model picker:** available-models list accounts for budget state, not just YAML allowlist
- [ ] **Native CC commands:** every command has an explicit `nativeBehavior` tag (`sdk-controlled | prompt-routed | daemon-owned`)
- [ ] **Native CC commands:** slash command count at daemon boot verified `<= 90`
- [ ] **Native CC commands:** no bare `/model`, `/clear`, `/memory` — all prefixed `clawcode-`
- [ ] **Native CC commands:** `/mcp` output redacts all env values and sensitive fields
- [ ] **Skills migration:** re-running migration CLI twice produces identical filesystem state (idempotency verified by hash)
- [ ] **Skills migration:** `grep -r "op://\|_PASSWORD\|_TOKEN\|_KEY" ~/.clawcode/skills/` returns zero hits
- [ ] **Skills migration:** finmentum-* skills only linked into finmentum-family agents (no cross-contamination)
- [ ] **Skills migration:** scanner extracts useful descriptions for all migrated skills (none defaulted to `""` or `"# Title"`)
- [ ] **Skills migration:** every SKILL.md passes a zod frontmatter schema check
- [ ] **Schema evolution:** `clawcode migrate openclaw verify` passes on all 15 agents after v2.2 ship
- [ ] **Schema evolution:** every new field in `schema.ts` has a matching entry in `RELOADABLE_FIELDS` or `NON_RELOADABLE_FIELDS`
- [ ] **Cross-feature:** audit every migrated SKILL.md for slash references; each reference resolves to a registered command post-Phase 4

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Effort never wired (Pitfall 1) | LOW | Land the wiring + integration test in a hotfix; no data loss |
| Cost blowout from unguarded `max` (Pitfall 3) | MEDIUM | Retroactive budget cap enforcement; audit the week's costs; refund via `/clawcode-usage` correction |
| Schema break on v2.1 configs (Pitfall 4, Cross-A) | HIGH | Roll back v2.2; re-run v2.1 verify; re-apply v2.2 with fixed schema |
| Lost YAML updates from dual writer (Pitfall 6) | MEDIUM | Restore from JSONL audit trail (v1.2 config audit); re-apply missing writes manually |
| Finmentum creds leaked to all agents (Pitfall 13) | HIGH | Rotate DB creds; purge affected agent memories (`memory_purge` per-agent); re-migrate with secret scanner |
| `/clear` wiped memories (Pitfall 11) | HIGH-to-UNRECOVERABLE | If cold-archive still intact, re-warm; otherwise, memories gone. Prevent recurrence with confirmation + named commands |
| Discord 100-command limit hit (Pitfall 9) | LOW | Remove duplicates; bulk-overwrite with slimmed list |
| SDK dispatch gap (Pitfall 8) | MEDIUM | Identify affected commands; replace text-prompt routing with daemon-owned implementations |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1: setEffort never wired | Phase 2 | Integration test spies on outgoing query's `thinking` option |
| 2: `max` on Haiku | Phase 2 | Unit test: `/clawcode-effort max` on haiku agent returns error |
| 3: Fork inherits effort | Phase 2 | Unit test: fork from parent with effort=max, assert fork.getEffort()==='low' |
| 4: Schema break on v2.1 configs | Phase 2 | Post-phase `clawcode migrate openclaw verify` passes on all 15 |
| 5: `/clawcode-model` hot-reload race | Phase 3 | Test: fire chokidar event mid-turn; assert turn completes, no restart |
| 6: Dual-writer YAML corruption | Phase 3 | Design decision: IPC-only write path; code review gate |
| 7: Stale allowed-model list | Phase 3 | Test: exhaust budget; picker shows Opus with "(exhausted)" annotation |
| 8: SDK dispatch gap | Phase 4 | Audit table exists; every native-CC command has `nativeBehavior` tag |
| 9: Discord 100-command limit | Phase 4 | Boot-time assert `allCommands.length <= 90`; CI check |
| 10: Namespace collision | Phase 3 (decision), Phase 4 (enforcement) | Lint rule: all command names match `^clawcode-` |
| 11: `/clear` destructive | Phase 4 | Destructive commands require confirmation + audit log entry |
| 12: `/mcp` leaks config | Phase 4 | Security-reviewer agent audits `/clawcode-mcp` output before ship |
| 13: Finmentum creds in skills | Phase 1 | `scanSecrets` on all SKILL.md; zero hits post-migration |
| 14: SKILL.md format drift | Phase 1 | Zod schema enforced at migration; scanner reads description from frontmatter |
| 15: Symlink collision | Phase 1 | Migration renames on collision; zero overwrites of ClawCode-native skills |
| 16: Non-idempotent migration | Phase 1 | Re-run produces empty diff; hash-based skip in place |
| 17: Dead slash refs in skills | Phase 1 (detection), Phase 4 (alias) | Grep audit post-migration; every slash ref resolves |
| 18: Self-modifying skills in shared basePath | Phase 1 | Scope flag on skills; linker refuses cross-scope assignments |
| Cross-A: Schema extensions break v2.1 | Phase 2 | All new fields optional or defaulted; v2.1 verify passes |
| Cross-B: Phase 3/4 namespace collision | Phase 3 kickoff | Namespace convention documented and enforced |
| Cross-C: Skills reference unshipped commands | Phase 1 | Phase 1 rewrites references OR Phase 4 ships alias table |
| Cross-D: New fields unclassified for hot-reload | Every phase touching schema | Unit test enumerates schema fields, asserts each classified |

---

## Sources

- `/home/jjagpal/.openclaw/workspace-coding/src/config/schema.ts` — lines 7-84 (effort schema, model schema); 640-701 (agent schema with effort field); 940-983 (superRefine enforcement)
- `/home/jjagpal/.openclaw/workspace-coding/src/config/types.ts` — lines 45-79 (RELOADABLE/NON_RELOADABLE classification)
- `/home/jjagpal/.openclaw/workspace-coding/src/config/differ.ts` — field-level diff + pattern matching
- `/home/jjagpal/.openclaw/workspace-coding/src/discord/slash-commands.ts` — lines 126-174 (dedupe by name, per-guild register); 264-284 (effort handler); 357-478 (control-command IPC dispatch)
- `/home/jjagpal/.openclaw/workspace-coding/src/discord/slash-types.ts` — full file (DEFAULT_SLASH_COMMANDS + CONTROL_COMMANDS)
- `/home/jjagpal/.openclaw/workspace-coding/src/skills/scanner.ts` — lines 10-43 (frontmatter + description extraction)
- `/home/jjagpal/.openclaw/workspace-coding/src/skills/linker.ts` — lines 43-63 (symlink idempotency logic)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-manager.ts` — lines 526-537 (setEffortForAgent/getEffortForAgent); 546-559 (forkSession)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/persistent-session-handle.ts` — lines 85-96 (currentEffort init); 599-606 (setEffort TODO comment)
- `/home/jjagpal/openclaw-claude-bridge/src/claude.js` — lines 41-58 (mapEffort), 116-121 (MAX_THINKING_TOKENS=0 disable logic)
- `/home/jjagpal/.openclaw/workspace-coding/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — lines 85-91 (agent effort), 428-433 (effort level doc), 892-904 (model capability lookup), 1159-1190 (thinking + effort options), 1713-1721 (setMaxThinkingTokens deprecation)
- `/home/jjagpal/.openclaw/workspace-coding/package.json` — SDK pinned at ^0.2.97
- `~/.openclaw/skills/cognitive-memory/SKILL.md`, `finmentum-crm/SKILL.md`, `power-apps-builder/SKILL.md` — frontmatter format samples (verified by direct read)
- `~/.clawcode/skills/subagent-thread/SKILL.md` — ClawCode frontmatter format sample
- `.planning/PROJECT.md` — v2.1 migration invariants (lines 85-92); v2.2 goal statement (lines 96-105)

---
*Pitfalls research for: v2.2 OpenClaw Parity & Polish*
*Researched: 2026-04-21*
