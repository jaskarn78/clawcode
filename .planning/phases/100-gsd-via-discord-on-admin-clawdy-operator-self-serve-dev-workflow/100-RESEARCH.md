# Phase 100: GSD-via-Discord on Admin Clawdy - Research

**Researched:** 2026-04-26
**Domain:** Claude Agent SDK setting sources + ClawCode slash dispatcher + subagent thread routing
**Confidence:** HIGH (every load-bearing claim verified against in-tree SDK types, official Claude Code docs, and existing ClawCode source)

## Summary

Phase 100 wires three small surfaces together so the operator can drive `/gsd:autonomous`, `/gsd:plan-phase`, `/gsd:execute-phase`, `/gsd:debug`, and `/gsd:quick` from the `#admin-clawdy` Discord channel. The Agent SDK already supports the underlying primitive (`settingSources: ["user", "project"]` loads `~/.claude/commands/`, `~/.claude/skills/`, and `~/.claude/CLAUDE.md`), the subagent thread spawner already exists with auto-relay shipped 2026-04-26, and the ClawCode slash dispatcher already has 11 inline-handler-short-circuit precedents to follow. The work is plumbing — additive `settingSources` + `gsd.projectDir` schema fields, 5 new `slashCommands:` entries on Admin Clawdy, a 12th inline short-circuit in `slash-commands.ts:handleInteraction` that pre-spawns a subagent thread for long-runners, and a small install helper for the `clawcode`-user-side `~/.claude/` symlink + sandbox `git init`.

**Primary recommendation:** Treat `~/.claude/commands/` (NOT `~/.claude/skills/`) as the SDK-discoverable surface for `/gsd:*` slash commands. The CONTEXT.md mentions `~/.claude/get-shit-done/skills/gsd/*.md` — that path does not exist on the host. The actual SDK-loaded surface is `~/.claude/commands/gsd/*.md`. Symlink BOTH `~/.claude/commands/gsd/` AND `~/.claude/get-shit-done/` so the slash dispatcher sees the commands AND the workflow execution-context files (`@$HOME/.claude/get-shit-done/workflows/*.md`) the commands `@`-include. Validation Architecture below has the full breakdown.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Skills delivery to clawcode user
- **Symlink** `/home/jjagpal/.claude/get-shit-done/` → `/home/clawcode/.claude/get-shit-done/`. Atomic install, auto-updates whenever jjagpal edits the skills directory. Operator manages skill content; ClawCode side never copies.
- **Only Admin Clawdy** gets these skills loaded. Precise scope — other agents (fin-acquisition, content-creator, etc.) keep their existing skill lists; no risk of accidental GSD invocations from production agents.
- **Per-agent `settingSources` field** in clawcode.yaml (new optional `agent.settingSources?: string[]`, default `["project"]`). Admin Clawdy sets `settingSources: ["project", "user"]` so the SDK loads `~/.claude/skills/` (which includes the symlinked GSD skills). All other agents stay at `["project"]` — no behavior change.
- **Hot-reload via existing config-watcher**. Yaml edits to `settingSources` trigger config differ → agent restart with new SDK options. No restart on skill-content changes (SDK re-reads on next session start, which happens often enough).

#### Project workspace resolution
- **New `gsd.projectDir?: string` field** on agent config. When set, GSD operations run with that directory as cwd. When unset, fall back to `agent.workspace`. Single source of truth — no per-message switcher.
- **Smoke test target:** fresh empty project at `/opt/clawcode-projects/sandbox/` on clawdy. Pre-create with `git init` + initial empty commit. Wipeable; no risk to real repos.
- **Local commits only** for Phase 100. GSD's `gsd-tools.cjs commit` writes locally; pushing is manual via the operator's terminal. No `gh` CLI auth, no SSH keypair, no GitHub device-code in this phase. Defer to Phase 101 if remote ops surface as a need.
- **Single-operator** assumption. No soft-lock around active workflows; one workflow at a time is the operator's responsibility. Race-condition handling deferred.

#### Slash command routing
- **Both paths** for invocation:
  - **(a) ClawCode-side dispatcher:** add 5 slash entries to Admin Clawdy's `slashCommands:` field — `/gsd-autonomous`, `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-debug`, `/gsd-quick`. Each entry's `claudeCommand` rewrites the Discord-compatible name back to the canonical `/gsd:*` form (e.g., `/gsd-plan-phase` → `claudeCommand: "/gsd:plan-phase {phase}"`). Discord forbids `:` in slash names, so the dispatcher is the bridge.
  - **(b) Plain message body:** `/gsd:autonomous` typed directly works because `settingSources: ["user"]` lets the SDK auto-recognize user-level skills. This is the always-available fallback for skills not exposed via Discord slash.
- **Plain-text arguments** after the command — `/gsd-plan-phase 100 --skip-research` becomes `/gsd:plan-phase 100 --skip-research`. No typed Discord options for now.
- **In-thread Q&A** — when GSD's smart-discuss asks the user a question, it posts in the active subthread. Operator answers in the same thread; agent reads thread history.
- **5 slash commands ship in Phase 100.** The full GSD skill list (15+) remains available via plain message body.

#### Auto-thread + artifact relay
- **Long-runners auto-thread:** `/gsd-autonomous`, `/gsd-execute-phase`, `/gsd-plan-phase`. Pre-spawn subagent thread BEFORE invoking the skill, passing the GSD command as the subagent's initial task. Short ones (`/gsd-quick`, `/gsd-debug`) stay inline.
- **Thread naming:** `gsd:<command>:<phase-or-target>` — `gsd:autonomous:100`, `gsd:plan:100`, `gsd:execute:100`.
- **Main-channel summary on completion:** one-line — `Phase 100 ✅ done — 4 plans, 12 commits. Thread: <URL>. Artifacts: .planning/phases/100-<slug>/`. Phase 99-M auto-relay extends to include artifact paths.
- **Auto-commit per phase** matching existing GSD behavior. Operator reviews with `git log` after the run.

### Claude's Discretion

(None explicitly carved out — CONTEXT.md presents all 4 grey areas as locked decisions. The planner has discretion on implementation ordering, test fixtures, and which file to put the inline short-circuit in.)

### Deferred Ideas (OUT OF SCOPE)

- **Multi-operator coordination + soft-lock around active workflows.**
- **Remote git auth (push, gh CLI, GitHub device-code).** Local commits only.
- **Per-message project switcher** (`/gsd-set-project /opt/foo`).
- **Typed Discord slash command options** for GSD args.
- **ButtonBuilder embeds** for grey-area question UX.
- **Slash entries for the remaining GSD skills** (audit-milestone, cleanup, complete-milestone, new-project, new-milestone, etc.).
- **Per-agent GSD state isolation.** No `dev-clawdy` agent, no per-project agents.
</user_constraints>

<phase_requirements>
## Phase Requirements

No explicit requirement IDs were provided. Phase 100 is greenfield within v2.7 — the user describes 4 grey-area decisions in CONTEXT.md, and this research informs the planner on how to implement them.

| Implicit Requirement | Description | Research Support |
|----------------------|-------------|------------------|
| GSD-01 | Operator can invoke `/gsd-*` Discord slash commands from `#admin-clawdy` | Standard Stack §"discord.js slashCommandEntrySchema", Architecture Patterns §"12th Inline-Handler Short-Circuit" |
| GSD-02 | Operator can also type `/gsd:*` plain text and have the SDK dispatch it | Standard Stack §"Claude Agent SDK 0.2.97 settingSources", Validation Architecture §"REQ-GSD-02" |
| GSD-03 | Long-runners (`autonomous`, `plan-phase`, `execute-phase`) auto-spawn subagent threads | Architecture Patterns §"Auto-thread pre-spawn before turn dispatch" |
| GSD-04 | GSD operates against `gsd.projectDir`, not Admin Clawdy's workspace | Architecture Patterns §"Per-agent cwd plumbing" |
| GSD-05 | Skills directory + GSD library accessible to `clawcode` system user | Architecture Patterns §"Symlink layout" + Common Pitfalls §"Symlink discovery bug" |
| GSD-06 | Phase 99-M auto-relay extends to surface artifact paths in parent's main-channel summary | Architecture Patterns §"Phase 99-M auto-relay extension" |
| GSD-07 | `settingSources` and `gsd.projectDir` reload via existing chokidar watcher | Architecture Patterns §"Reloadable classification" |
</phase_requirements>

## Standard Stack

### Core (already installed — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.97 (pinned EXACT) | `settingSources: ["user","project"]` is the SDK option that loads `~/.claude/commands/` + `~/.claude/skills/` + `~/.claude/CLAUDE.md` into a session. Pre-1.0 — pin exact per v2.2 PROJECT.md decision. | The SDK option *is* the primitive; no alternative exists. |
| `discord.js` | 14.26.2 | Slash command registration via `REST.put(Routes.applicationGuildCommands)`. Already wires every `slashCommands:` entry from `clawcode.yaml`. | Used in `src/discord/slash-commands.ts:register`. |
| `zod` | 4.3.6 (`zod/v4`) | Additive optional schema fields for `agent.settingSources?: string[]` and `agent.gsd.projectDir?: string`. 11 prior applications of the additive-optional schema blueprint in this codebase. | `src/config/schema.ts` is the single zod entry point. |
| `chokidar` | 5.0.0 | Existing config watcher (`src/config/watcher.ts`) detects edits to `clawcode.yaml`. Differ classifies fields against `RELOADABLE_FIELDS`. | No change needed beyond adding the new field paths to `RELOADABLE_FIELDS`. |

**No new npm dependencies.** v2.2 zero-new-deps discipline preserved (extended through v2.7).

### Pre-existing Reusable Code

| Asset | Location | What it gives Phase 100 |
|-------|----------|-------------------------|
| `SubagentThreadSpawner.spawnInThread()` | `src/discord/subagent-thread-spawner.ts:145` | Creates Discord thread, starts subagent session, persists binding, kicks off async initial-prompt with caller-provided `task` string. |
| `SubagentThreadSpawner.relayCompletionToParent()` | `src/discord/subagent-thread-spawner.ts:81` | Phase 99-M (shipped 2026-04-26) — fetches subagent's last reply on session-end and dispatches synthetic turn to parent. **Phase 100 extends the relay prompt to include artifact paths.** |
| `slashCommandEntrySchema` | `src/config/schema.ts:318` | `name` regex `/^[\w-]+$/`, max 32 chars. **Verified: all 5 GSD names (`gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-debug`, `gsd-quick`) pass.** |
| `formatCommandMessage()` | `src/discord/slash-commands.ts:3923` | Replaces `{optionName}` placeholders in `claudeCommand` with values; appends unmatched options as `key: value` lines. **The 5 GSD entries use this for arg passthrough.** |
| `resolveAgentConfig()` | `src/config/loader.ts:111` | 11 prior precedents for additive-optional fields (`memoryAutoLoad`, `greetOnRestart`, `allowedModels`, `fileAccess`, `outputDir`, `dream`, etc.). |
| Inline-handler-short-circuit pattern | `src/discord/slash-commands.ts:handleInteraction` | 11 prior `if (commandName === "clawcode-X") { await this.handleXCommand(...); return; }` carve-outs **BEFORE** `CONTROL_COMMANDS.find` and the agent-routed branch. Phase 100 adds the **12th**. |
| `RELOADABLE_FIELDS` | `src/config/types.ts:45` | Set of dotted-path patterns. Adding `agents.*.settingSources`, `agents.*.gsd.projectDir`, `defaults.gsd.projectDir` keeps a YAML edit reloadable. |
| `TurnDispatcher.dispatch()` | `src/manager/turn-dispatcher.ts` | Sends a turn to an agent with a `TurnOrigin`. Used by Phase 99-M relay; Phase 100's auto-thread flow reuses it for the subagent's initial prompt. |

**Version verification:**
```bash
npm view @anthropic-ai/claude-agent-sdk version  # → 0.2.97 (locked in package.json)
```
SDK shipped Mar 2026; `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1394` confirms `settingSources?: SettingSource[]` and `:4224` confirms `SettingSource = 'user' | 'project' | 'local'`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Symlink `~/.claude/get-shit-done/` + `~/.claude/commands/gsd/` | Copy with `cp -r` | Symlink = atomic auto-update; copy = stale until re-run. Locked decision: SYMLINK. **But see Common Pitfalls §"Symlink discovery"** — symlinks at `~/.claude/skills/` have a known scanning bug. The SAFE symlink target is the parent directories (`~/.claude/commands/`, `~/.claude/get-shit-done/`), not nested skill folders. |
| Per-agent `settingSources` | Daemon-wide flag | Per-agent isolation matches the locked decision: only Admin Clawdy gets `["project","user"]`; production agents keep `["project"]`. Daemon-wide would leak GSD into production. |
| Auto-thread pre-spawn at slash dispatcher | Auto-thread inside the GSD skill itself | Pre-spawn keeps the dispatcher in control of the thread name (`gsd:<cmd>:<target>`) and avoids the agent re-spawning a thread for every long-running invocation. The Phase 99-K directive already tells agents to subthread >30s work; pre-spawn is the Phase 100 belt that complements that suspenders. |
| Plain-text args (`/gsd-plan-phase 100 --skip-research`) | Typed Discord options (separate fields per arg) | Locked decision: PLAIN TEXT. Reasons: GSD args are positional/free-form; typed-option YAML schema bloat isn't worth it for 5 commands. |

## Architecture Patterns

### Recommended File Structure
```
src/
├── config/
│   ├── schema.ts                            # Add optional agent.settingSources + agent.gsd.projectDir
│   ├── loader.ts                            # resolveAgentConfig: thread new fields into ResolvedAgentConfig
│   └── types.ts                             # RELOADABLE_FIELDS: add new paths
├── manager/
│   ├── session-adapter.ts                   # Read settingSources + cwd from config (lines 588, 627, 592, 631)
│   └── types.ts                             # AgentSessionConfig: add optional settingSources field
├── discord/
│   ├── slash-commands.ts                    # 12th inline short-circuit for /gsd-* commands
│   └── subagent-thread-spawner.ts           # Extend relayCompletionToParent prompt with artifact paths
├── shared/
│   └── types.ts                             # ResolvedAgentConfig: add settingSources + gsd fields
└── cli/commands/
    └── install-gsd.ts (NEW)                 # One-shot installer: symlinks + sandbox git init
```

### Pattern 1: Additive-Optional Schema (12th application)
**What:** Add `settingSources?: SettingSource[]` and `gsd?: { projectDir?: string }` to `agentSchema`. Add resolver fallback in `resolveAgentConfig`. Add path entries to `RELOADABLE_FIELDS`.
**When to use:** Every per-agent config field added in v2.x has followed this exact shape (Phase 83 effort, 86 allowedModels, 89 greetOnRestart, 90 memoryAutoLoad, 96 fileAccess, etc.).
**Example:**
```typescript
// src/config/schema.ts (agentSchema, additive)
settingSources: z.array(z.enum(["project", "user", "local"])).optional(),
gsd: z.object({
  projectDir: z.string().min(1).optional(),
}).optional(),

// src/config/loader.ts:resolveAgentConfig
return {
  ...rest,
  // Phase 100 — settingSources defaults to ["project"] when omitted (matches
  // the hardcoded value being replaced in session-adapter.ts:588,592,627,631).
  // Admin Clawdy's clawcode.yaml entry sets ["project","user"] so the SDK
  // loads ~/.claude/commands/ + ~/.claude/skills/ + ~/.claude/CLAUDE.md.
  settingSources: agent.settingSources ?? ["project"],
  // Phase 100 — gsd.projectDir overrides cwd at session boot when set;
  // session-adapter.ts reads it. expandHome() in the resolver handles ~/.
  gsd: agent.gsd?.projectDir
    ? { projectDir: expandHome(agent.gsd.projectDir) }
    : undefined,
};
```
**Source:** `src/config/loader.ts:296-388` shows the existing return-shape with 18+ resolved fields. Drop the new entries in alphabetical-ish position.

### Pattern 2: 12th Inline-Handler Short-Circuit
**What:** Add `if (commandName === "gsd-autonomous" || commandName === "gsd-plan-phase" || commandName === "gsd-execute-phase") { await this.handleGsdLongRunner(interaction); return; }` BEFORE `CONTROL_COMMANDS.find`. Short ones (`gsd-debug`, `gsd-quick`) fall through to the existing agent-routed branch (their `claudeCommand` already rewrites to `/gsd:debug` / `/gsd:quick`).
**When to use:** Any new Discord slash command that needs a non-default dispatch path. 11 prior applications: clawcode-tools (85), clawcode-model (86), clawcode-permissions (87), clawcode-skills-browse (88), clawcode-skills (88), clawcode-plugins-browse (90), clawcode-clawhub-auth (90), clawcode-sync-status (91), clawcode-cutover-verify (92), clawcode-dream (95), clawcode-probe-fs (96).
**Example:**
```typescript
// src/discord/slash-commands.ts:handleInteraction (~line 1230, AFTER clawcode-dream, BEFORE CONTROL_COMMANDS.find)

// Phase 100 GSD-01..03 — 12th application of the inline-handler-short-circuit
// pattern. Long-runner GSD commands pre-spawn a subagent thread so the main
// channel stays free; the subagent inherits Admin Clawdy's settingSources
// (["project","user"]) and runs the canonical `/gsd:*` skill directly.
const LONG_RUNNERS = new Set(["gsd-autonomous", "gsd-plan-phase", "gsd-execute-phase"]);
if (LONG_RUNNERS.has(commandName)) {
  await this.handleGsdLongRunner(interaction, commandName);
  return;
}
// /gsd-debug and /gsd-quick fall through to the legacy agent-routed branch.
// Their `claudeCommand` ("/gsd:debug {issue}" / "/gsd:quick {task}") rewrites
// to the canonical SDK form via formatCommandMessage's placeholder substitution.
```

### Pattern 3: Auto-thread Pre-spawn
**What:** Inside `handleGsdLongRunner`, call `subagentThreadSpawner.spawnInThread({ parentAgentName: "admin-clawdy", threadName: "gsd:<cmd>:<target>", task: "/gsd:<command> <args>" })` BEFORE replying. The spawner's existing `postInitialMessage` sends the `task` as the subagent's first user message — the SDK then dispatches the slash command (because the subagent inherits `settingSources: ["user"]` from the parent's resolved config).
**Why it works:** `SubagentThreadSpawner.spawnInThread` (line 145) builds `subagentConfig: ResolvedAgentConfig = { ...parentConfig, name: sessionName, model, channels: [], soul: ..., schedules: [], slashCommands: [], webhook }` — the spread inherits `settingSources` and `gsd` automatically once those fields are added to `ResolvedAgentConfig`. The subagent sees the same `~/.claude/commands/gsd/*.md` files as the parent.
**Race-condition safety:** `postInitialMessage` is `void`'d (fire-and-forget). The slash interaction reply happens synchronously; the subagent's first turn runs in the background. No race because `startAgent` resolves AFTER the SDK session is initialized.

### Pattern 4: Phase 99-M Auto-relay Extension
**What:** `relayCompletionToParent()` at `subagent-thread-spawner.ts:81` already builds a relay prompt from the subagent's last assistant message. Phase 100 extends it to ALSO include artifact paths from the GSD `init phase-op` output.
**How:**
- The subagent's GSD skill (`autonomous.md` / `execute-phase.md`) writes artifacts under `.planning/phases/<phase>/`.
- After the subagent's session ends, the parent reads `.planning/phases/<phase>/` and lists `*.md` files via the existing `Read`/`Glob` tools.
- The relay prompt becomes: *"Your subagent in thread X just finished. Last reply: <text>. Artifacts written: <paths>. Briefly summarize for the user in main channel (1-3 sentences max)."*
**Source:** `subagent-thread-spawner.ts:108-114` — the relay prompt is hand-built; extending it is a string append.

### Pattern 5: Per-agent cwd plumbing
**What:** `session-adapter.ts:588` and `:627` hardcode `cwd: config.workspace`. Phase 100 changes both call sites to `cwd: config.gsd?.projectDir ?? config.workspace`. The SDK then operates on the project repo, not Admin Clawdy's home directory.
**Hot-reload semantics:** `cwd` is part of `baseOptions` passed to `sdk.query` at session start. Changing `gsd.projectDir` requires a session restart for the new cwd to take effect. **`agents.*.gsd.projectDir` is RELOADABLE in the differ sense** (no daemon bounce needed) but takes effect on **NEXT agent restart**, not next turn. Document this in the schema comment.

### Anti-Patterns to Avoid
- **DO NOT** copy `~/.claude/commands/gsd/*.md` into the workspace `skills/` directory. The locked decision is SYMLINK. Copies go stale; symlinks auto-update.
- **DO NOT** put GSD slash entries in `defaults.slashCommands` or in `DEFAULT_SLASH_COMMANDS`. Locked decision: ONLY ADMIN CLAWDY. Production agents must not see them.
- **DO NOT** put the auto-thread logic inside the GSD skill itself. The slash dispatcher pre-spawns; the skill runs whatever cwd-bound work it needs without knowing it's in a thread.
- **DO NOT** introduce typed Discord options for the GSD args. Locked decision: PLAIN TEXT. The `claudeCommand: "/gsd:plan-phase {phase}"` pattern with positional placeholder is sufficient.
- **DO NOT** pass `settingSources` through `AgentSessionConfig` and `transformMcpServersForSdk` separately — pass it directly into `baseOptions` in `SdkSessionAdapter.createSession` / `resumeSession`. The plumbing is exactly two lines × two methods = four lines of code change in `session-adapter.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auto-recognize `/gsd:*` typed in Discord | A custom regex matcher in `bridge.ts` | The SDK does it natively when `settingSources: ["user"]`. The user-level `~/.claude/commands/gsd/*.md` files are auto-discovered by Claude Code. | The SDK's slash-command dispatcher is documented behavior. Source: [code.claude.com/docs/en/slash-commands](https://code.claude.com/docs/en/slash-commands). Reinventing it would diverge from CLI behavior. |
| Symlink discovery for the `clawcode` user | A custom watcher / re-scanner | A plain `ln -s` of the parent directory (`~/.claude/get-shit-done/`, `~/.claude/commands/gsd/`) — NOT the per-skill subfolders. | The known symlink-scan bug (Issue #14836) only affects symlinks INSIDE `~/.claude/skills/`. Symlinking the entire `commands/gsd/` folder works because Claude Code resolves the parent directory once. |
| Sandbox project bootstrap | A wrapped CLI subcommand | Operator runs `git init && git commit --allow-empty -m "init"` once on `/opt/clawcode-projects/sandbox/`. | This is a one-time install step. A wrapper command for it would be over-engineering. The runbook section can include the 2-line snippet. |
| Subagent thread initial-prompt invocation | A new IPC method | `SubagentThreadSpawner.spawnInThread({ task: "/gsd:..." })` already exists. The `task` parameter becomes the subagent's first user message, which the SDK dispatches as a slash command. | The plumbing is already there; Phase 31 + 99-M shipped it. |
| Artifact path extraction for relay | A bespoke parser | Read `.planning/phases/<phase>/` via existing `Read`/`Glob` tools at relay time. The GSD `init phase-op` output is already JSON; the relay prompt can reference paths produced by `gsd-tools.cjs phase-plan-index <phase>`. | No new code; reuse existing GSD tools. |

**Key insight:** Phase 100 is **5 new fields, 1 new inline handler, 1 install helper, 1 prompt extension**. Total source-line delta is small (<300 lines including tests).

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 100 is greenfield (no rename/migration). | None. |
| Live service config | Discord slash command registry (per-guild). On agent restart, `SlashCommandHandler.register()` calls `REST.put(Routes.applicationGuildCommands)` which OVERWRITES the per-guild command set. The 5 new `/gsd-*` entries need 1 boot cycle to register — Discord shows them after the daemon restarts. | Daemon restart re-registers slash commands automatically (existing behavior). No manual API patch. |
| OS-registered state | systemd unit `clawcode.service` on the clawdy host (Phase 91 deploy-runbook). The new install helper (`/home/clawcode/.claude/get-shit-done/` symlink + `/opt/clawcode-projects/sandbox/`) does NOT touch systemd. | None — Phase 100 install is pre-daemon-start file-system work; systemd is unaffected. |
| Secrets/env vars | None. GSD does not read any new env vars. Existing `DISCORD_BOT_TOKEN` (sourced from `op://`) is unchanged. | None. |
| Build artifacts / installed packages | The Phase 100 install helper creates two symlinks under `/home/clawcode/.claude/`. If the script is re-run, the existing symlinks must be replaced atomically (`ln -sfn` on Linux) — not appended. | One-shot script idempotency: `rm -f /home/clawcode/.claude/get-shit-done && ln -s /home/jjagpal/.claude/get-shit-done /home/clawcode/.claude/get-shit-done`. |

## Common Pitfalls

### Pitfall 1: Symlink Discovery Bug (CRITICAL)
**What goes wrong:** Symlinking `~/.claude/skills/<skill-name>` into a directory tree fails Claude Code's `/skills` validation phase, even though the skill executes correctly when invoked. Issues [#14836](https://github.com/anthropics/claude-code/issues/14836) and [#25367](https://github.com/anthropics/claude-code/issues/25367) document this.
**Why it happens:** The skill scanner uses `find` without the `-L` flag, so symlinked subdirectories under `~/.claude/skills/` are skipped during discovery. Execution works because file-read resolves symlinks transparently.
**How to avoid:**
- The CONTEXT.md prescribes symlinking `~/.claude/get-shit-done/` (the GSD library, NOT a skill). This is FINE — that path is `@`-included by `commands/gsd/*.md` files, not scanned by the skill discovery code.
- For the actual SDK-discoverable surface, symlink the PARENT directory `~/.claude/commands/gsd/` (the whole directory, one symlink) — NOT individual `.md` files.
- DO NOT symlink individual files inside `~/.claude/skills/` — that triggers the bug.
**Warning signs:** `/gsd:plan-phase` typed in Discord returns "Unknown skill" while the underlying file is readable.
**Verification:** After install, `find -L /home/clawcode/.claude/commands -name "*.md"` should list `gsd/plan-phase.md`, `gsd/autonomous.md`, etc. If `find` (without `-L`) returns nothing, the symlink target is wrong.

### Pitfall 2: CONTEXT.md Path Ambiguity
**What goes wrong:** CONTEXT.md L21 says symlink `/home/jjagpal/.claude/get-shit-done/` → `/home/clawcode/.claude/get-shit-done/`. CONTEXT.md L56 says "all 18 GSD skills live here" at `~/.claude/get-shit-done/skills/gsd/*.md`.
**Why it happens:** That path **does not exist**. The actual layout is:
- `~/.claude/get-shit-done/` — workflow content + binaries (NOT slash commands)
- `~/.claude/commands/gsd/*.md` — the actual SDK-discoverable slash commands
- `~/.claude/skills/<skill-name>/SKILL.md` — user-level Skills (only `subagent-thread` here)
**How to avoid:** The install helper MUST create BOTH symlinks:
1. `ln -s /home/jjagpal/.claude/get-shit-done /home/clawcode/.claude/get-shit-done` — gives the SDK the workflow content the slash commands `@`-include.
2. `ln -s /home/jjagpal/.claude/commands/gsd /home/clawcode/.claude/commands/gsd` — gives the SDK the actual slash command files.
And it MUST `mkdir -p /home/clawcode/.claude/commands/` first if the parent doesn't exist.
**Warning signs:** SDK `initializationResult().commands` doesn't include any `/gsd:*` entries.

### Pitfall 3: settingSources Empty-Array Fallback
**What goes wrong:** Passing `settingSources: []` to the SDK disables all filesystem settings (NO user, NO project, NO local). Skills, CLAUDE.md, and rules are not loaded.
**Why it happens:** Per [SDK docs](https://code.claude.com/docs/en/agent-sdk/claude-code-features): "When omitted or empty, no filesystem settings are loaded (SDK isolation mode)."
**How to avoid:** The schema default for `settingSources` is `["project"]`, not `[]`. Validate via:
```typescript
// src/config/schema.ts
settingSources: z.array(z.enum(["project", "user", "local"])).min(1).optional(),
// `.min(1)` rejects [] at parse time — operators must explicitly say what they want loaded.
```
**Warning signs:** Admin Clawdy's session has no skill descriptions in its system prompt.

### Pitfall 4: Race Between Slash Reply and Subagent Thread Spawn
**What goes wrong:** Discord interactions must be acknowledged within 3 seconds (deferReply pattern). `spawnInThread` involves Discord API calls (thread create) + SDK session start (~500ms-2s). If the dispatcher awaits the spawn synchronously before replying, slow networks cause "interaction failed" UI.
**Why it happens:** The Discord interaction token expires after 3s without `deferReply()`.
**How to avoid:**
1. Call `interaction.deferReply({ ephemeral: false })` IMMEDIATELY at the top of `handleGsdLongRunner`.
2. Then spawn the thread (this can take a few seconds).
3. Then `interaction.editReply` with the thread URL + ack message.
The existing `clawcode-tools` / `clawcode-model` handlers all use this pattern; copy it verbatim.
**Warning signs:** Operator sees "The application did not respond" instead of a thread link.

### Pitfall 5: Discord Slash Command Cap (90/guild)
**What goes wrong:** `MAX_COMMANDS_PER_GUILD = 90` (`src/discord/slash-commands.ts:136`). Adding 5 GSD entries pushes the total higher.
**Why it happens:** Discord caps at 100/guild; ClawCode reserves 10 as buffer.
**How to avoid:** Phase 96 deploy was at 16/100 control-command count. v2.5/v2.6 added `clawcode-cutover-verify`, `clawcode-dream`, `clawcode-probe-fs`. Phase 100 adds 5 more (`gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-debug`, `gsd-quick`). Re-grep `src/` for total command count BEFORE register; pre-flight assertion (line 1078) throws if `body.length > 90`. The 5 new entries land Admin Clawdy's slash count well under 90 — but verify with the test fixture.
**Warning signs:** `failed to register slash commands` log + Discord shows partial command list.

### Pitfall 6: SDK Pre-1.0 Breaking Changes
**What goes wrong:** `@anthropic-ai/claude-agent-sdk` is at 0.2.97; minor version bumps may break `settingSources` enum values or SDKControlInitializeResponse shape.
**Why it happens:** Pre-1.0 — explicitly documented in `sdk-types.ts` migration notes.
**How to avoid:** Pin EXACT in `package.json` (already done — `0.2.97` not `^0.2.97`). When upgrading, run the v2.2 SDK canary test pattern (Phase 83 spy harness) to verify `settingSources` still flows.
**Warning signs:** Type errors at `session-adapter.ts:592` after `npm update`.

### Pitfall 7: Multi-process clawcode user Skill Cache
**What goes wrong:** If the daemon is running and the operator edits `~/.claude/commands/gsd/plan-phase.md` (via the symlinked file), the change takes effect on **NEXT session start**, not immediately.
**Why it happens:** SDK reads skills at session-start; live-change-detection in CLI mode is documented but the SDK behavior at this version may not match.
**How to avoid:** Document this in the runbook. For Phase 100 dev, restarting the agent (`clawcode restart admin-clawdy`) is sufficient. Long-term, GSD skill content rarely changes during a workflow.
**Warning signs:** Operator edits a workflow file mid-`/gsd-autonomous` run; subagent uses old version.

### Pitfall 8: Plan File Slugification
**What goes wrong:** Phase directory names follow `phases/<NN>-<slug>/`. Currently Phase 100 has slug `gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow` (89 chars). Some filesystems / Discord embeds truncate paths.
**Why it happens:** Long phase names from natural-language descriptions.
**How to avoid:** This is informational; not blocking for Phase 100. The relay prompt's "Artifacts: <paths>" line should use the relative path `.planning/phases/100-<slug>/`, not absolute, to keep messages short.

## Code Examples

Verified patterns from existing source:

### Example 1: SettingSources flow into baseOptions
```typescript
// src/manager/session-adapter.ts:585-596 (BEFORE — current state)
const baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string } = {
  model: resolveModelId(config.model),
  effort: config.effort,
  cwd: config.workspace,                   // ← Phase 100: change to (config as any).gsd?.projectDir ?? config.workspace
  systemPrompt: buildSystemPromptOption(config.systemPrompt),
  permissionMode: "bypassPermissions",
  settingSources: ["project"],             // ← Phase 100: change to config.settingSources ?? ["project"]
  env: buildCleanEnv(),
  ...(config.mutableSuffix ? { mutableSuffix: config.mutableSuffix } : {}),
  ...(mcpServers ? { mcpServers } : {}),
};
```

```typescript
// src/manager/session-adapter.ts:585-596 (AFTER — Phase 100)
const baseOptions: SdkQueryOptions & { readonly mutableSuffix?: string } = {
  model: resolveModelId(config.model),
  effort: config.effort,
  // Phase 100 GSD-04 — gsd.projectDir overrides workspace when set; the SDK
  // session uses that as cwd so `.planning/` writes land in the project repo.
  cwd: config.gsd?.projectDir ?? config.workspace,
  systemPrompt: buildSystemPromptOption(config.systemPrompt),
  permissionMode: "bypassPermissions",
  // Phase 100 GSD-02 — per-agent settingSources lets Admin Clawdy load
  // ~/.claude/commands/ + ~/.claude/skills/ + ~/.claude/CLAUDE.md so the SDK
  // auto-recognizes /gsd:* slash commands typed in Discord message bodies.
  settingSources: config.settingSources ?? ["project"],
  env: buildCleanEnv(),
  ...(config.mutableSuffix ? { mutableSuffix: config.mutableSuffix } : {}),
  ...(mcpServers ? { mcpServers } : {}),
};
```
**Source:** Verified against `src/manager/session-adapter.ts:585-596` (createSession) and `:624-636` (resumeSession). Both call sites need the same change.

### Example 2: Admin Clawdy slashCommands entries
```yaml
# clawcode.yaml — admin-clawdy agent block (NEW for Phase 100; admin-clawdy
# itself does not exist in the dev repo's clawcode.yaml — it's a deploy-only
# entity. The 5 entries below land in production clawcode.yaml on clawdy.)
agents:
  - name: admin-clawdy
    # ... existing fields ...
    settingSources: [project, user]    # Phase 100 GSD-02 — load ~/.claude/commands/
    gsd:
      projectDir: /opt/clawcode-projects/sandbox  # Phase 100 GSD-04 — sandbox target
    slashCommands:
      - name: gsd-autonomous
        description: Run all remaining phases autonomously
        claudeCommand: "/gsd:autonomous {args}"
        options:
          - name: args
            type: 3      # STRING
            description: "Optional flags (e.g. --from 100)"
            required: false
      - name: gsd-plan-phase
        description: Create phase plan with verification loop
        claudeCommand: "/gsd:plan-phase {phase}"
        options:
          - name: phase
            type: 3
            description: "Phase number + optional flags"
            required: false
      - name: gsd-execute-phase
        description: Execute all plans in a phase
        claudeCommand: "/gsd:execute-phase {phase}"
        options:
          - name: phase
            type: 3
            description: "Phase number + optional flags"
            required: false
      - name: gsd-debug
        description: Systematic debugging with persistent state
        claudeCommand: "/gsd:debug {issue}"
        options:
          - name: issue
            type: 3
            description: "Issue description"
            required: true
      - name: gsd-quick
        description: Quick task with GSD guarantees
        claudeCommand: "/gsd:quick {task}"
        options:
          - name: task
            type: 3
            description: "Task description"
            required: true
```
**Verified:** Names pass `slashCommandEntrySchema` regex `/^[\w-]+$/` (max 32 chars). Discord regex `^[-_'\p{L}\p{N}]{1,32}$` accepts hyphens but not colons (confirmed via [Discord API discussion #4070](https://github.com/discord/discord-api-docs/discussions/4070)).

### Example 3: Inline short-circuit + auto-thread spawn
```typescript
// src/discord/slash-commands.ts (~line 1230, AFTER /clawcode-probe-fs)

// Phase 100 GSD-01..03 — 12th application of the inline-handler-short-circuit
// pattern (Phases 85/86/87/88/90/91/92/95/96). Long-runner GSD commands
// pre-spawn a subagent thread so the main channel stays free.
// Short-runners (gsd-debug, gsd-quick) fall through to the legacy agent-routed
// branch where claudeCommand template substitution rewrites to the canonical
// /gsd:* form.
const GSD_LONG_RUNNERS: ReadonlySet<string> = new Set([
  "gsd-autonomous",
  "gsd-plan-phase",
  "gsd-execute-phase",
]);
if (GSD_LONG_RUNNERS.has(commandName)) {
  await this.handleGsdLongRunner(interaction, commandName);
  return;
}

// (existing CONTROL_COMMANDS.find branch follows below)
```

```typescript
// src/discord/slash-commands.ts — new method on SlashCommandHandler

/**
 * Phase 100 GSD-01..03 — handle long-runner /gsd-* slash commands.
 *
 * Flow:
 *   1. Defer reply (3s Discord ack window).
 *   2. Resolve Admin Clawdy from the channel binding (must match).
 *   3. Build canonical SDK slash form via formatCommandMessage.
 *   4. Pre-spawn a subagent thread with the canonical command as `task`.
 *   5. EditReply with thread URL + brief ack.
 *
 * Phase 99-M auto-relay handles the parent-side completion summary on
 * subagent session end.
 */
private async handleGsdLongRunner(
  interaction: ChatInputCommandInteraction,
  commandName: string,
): Promise<void> {
  await interaction.deferReply({ ephemeral: false });

  const channelId = interaction.channelId;
  const agentName = getAgentForChannel(this.routingTable, channelId);
  if (agentName !== "admin-clawdy") {
    await interaction.editReply("/gsd-* commands are restricted to #admin-clawdy.");
    return;
  }

  // Resolve the slash entry to get its claudeCommand template
  const agentConfig = this.resolvedAgents.find((a) => a.name === agentName);
  const cmdDef = agentConfig?.slashCommands.find((c) => c.name === commandName);
  if (!cmdDef) {
    await interaction.editReply(`Unknown command: /${commandName}`);
    return;
  }

  // Extract args and rewrite to canonical /gsd:* form
  const options = new Map<string, string | number | boolean>();
  for (const opt of cmdDef.options) {
    const v = interaction.options.get(opt.name)?.value;
    if (v !== null && v !== undefined) options.set(opt.name, v);
  }
  const canonicalSlash = formatCommandMessage(cmdDef, options);  // e.g. "/gsd:autonomous --from 100"

  // Build thread name: gsd:autonomous:100 / gsd:plan:100 / gsd:execute:100
  const phaseArg = String(options.get("phase") ?? options.get("args") ?? "").split(/\s+/)[0] ?? "";
  const shortName = commandName.replace(/^gsd-/, "").replace(/-phase$/, "");  // autonomous|plan|execute
  const threadName = phaseArg ? `gsd:${shortName}:${phaseArg}` : `gsd:${shortName}`;

  if (!this.subagentThreadSpawner) {
    await interaction.editReply("Subagent thread spawning unavailable (no Discord bridge).");
    return;
  }

  try {
    const result = await this.subagentThreadSpawner.spawnInThread({
      parentAgentName: agentName,
      threadName,
      task: canonicalSlash,
    });
    const threadUrl = `https://discord.com/channels/${interaction.guildId}/${result.threadId}`;
    await interaction.editReply(
      `🚀 Spawned ${threadName} subthread for ${canonicalSlash}\nThread: ${threadUrl}\n_Working in subthread; main channel summary on completion._`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to spawn /gsd-* subthread: ${msg}`);
  }
}
```
**Source:** Pattern derived from `handleSkillsBrowseCommand` (line ~1170), `handleDreamCommand` (line ~1240), `handleProbeFsCommand` (line ~1255). Subagent spawner usage cross-referenced with `daemon.ts:4783` (the existing IPC `spawn-subagent-thread` invocation site).

### Example 4: SubagentThreadSpawner forwards settingSources
```typescript
// src/discord/subagent-thread-spawner.ts:210-219 — already does ...parentConfig
// spread; once ResolvedAgentConfig has settingSources + gsd, the subagent
// inherits them automatically. No change needed beyond ensuring the spread
// preserves them (verify in test).

const subagentConfig: ResolvedAgentConfig = {
  ...parentConfig,                     // ← inherits settingSources + gsd
  name: sessionName,
  model,
  channels: [],
  soul: (config.systemPrompt ?? parentConfig.soul ?? "") + threadContext,
  schedules: [],
  slashCommands: [],
  webhook,
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.claude/commands/<name>.md` only | `.claude/skills/<name>/SKILL.md` (preferred) OR `.claude/commands/<name>.md` (legacy, still works) | Claude Code 2.x (early 2026) — "Custom commands have been merged into skills" | GSD lives in `~/.claude/commands/gsd/*.md`, which is the legacy form. It works. Optional future migration to `.claude/skills/gsd-*/SKILL.md` would enable model-invocation. Phase 100 sticks with commands. |
| Hardcoded `settingSources: ["project"]` | Per-agent config field | Phase 100 | Admin Clawdy gets `["project","user"]`; production agents stay isolated. |
| Subagent thread spawned only via MCP tool (`spawn_subagent_thread`) | Spawned by MCP tool OR by slash dispatcher pre-flight | Phase 100 | Two-call-site spawner; existing test coverage applies. |

**Deprecated/outdated:**
- Pre-Phase-87 `claudeCommand` empty-string fallback for the "removed clawcode-compact / clawcode-usage" entries — irrelevant to Phase 100 (5 new GSD entries all have populated `claudeCommand`).
- `settingSources` defaulting to `["user","project","local"]` when omitted — locked-in via the v2.2 hardcoded `["project"]`. Phase 100 does NOT revert to the SDK default; the explicit per-agent value is the single source of truth.

## Open Questions

1. **Should `defaults.gsd.projectDir` exist for fleet-wide defaulting?**
   - What we know: Locked decision says "single configured `gsd.projectDir`" on Admin Clawdy. Other agents won't have it set.
   - What's unclear: Whether defining `defaults.gsd` is worth the schema entry, or if pure per-agent `gsd.projectDir` is cleaner.
   - Recommendation: Skip `defaults.gsd` entirely. Per-agent only. If a future Phase 101 introduces multiple "dev agents," each gets its own `gsd.projectDir`.

2. **What happens if Admin Clawdy doesn't exist in the local dev repo's clawcode.yaml?**
   - What we know: The local `clawcode.yaml` has no `admin-clawdy` entry. It's referenced in source comments and tests but lives only on the production clawdy host.
   - What's unclear: Whether Phase 100 plans should add admin-clawdy to the local clawcode.yaml or assume it exists on clawdy already.
   - Recommendation: Phase 100 plans should add a smoke-test agent (`admin-clawdy` or equivalent) to the dev `clawcode.yaml` so vitest fixtures can exercise the flow. The production deployment of admin-clawdy is the operator's manual step, documented in a deploy-runbook section.

3. **Is `~/.claude/commands/` watched live, or only at session start?**
   - What we know: Per [code.claude.com/docs/en/slash-commands](https://code.claude.com/docs/en/slash-commands), Claude Code watches skill directories for live changes. Commands directories: less clear. The SDK 0.2.97 may not implement live-watch in the same way as the CLI.
   - What's unclear: Whether mid-session edits to `~/.claude/commands/gsd/plan-phase.md` are picked up by an active Admin Clawdy session.
   - Recommendation: Document the conservative assumption ("changes apply on next session restart"). If live-watch works in the SDK, it's a bonus.

4. **Does clawcode-user need its own `~/.claude/CLAUDE.md`?**
   - What we know: `settingSources: ["user"]` loads `~/.claude/CLAUDE.md` if present. The dev jjagpal user has one (the global instructions in this session). The clawcode user does not.
   - What's unclear: Whether `~/.claude/CLAUDE.md` should also be symlinked or whether Admin Clawdy's per-agent `IDENTITY.md`/`SOUL.md` is sufficient.
   - Recommendation: DO NOT symlink `~/.claude/CLAUDE.md`. Admin Clawdy's identity is per-agent (existing pattern). The user-level CLAUDE.md is jjagpal's personal config and shouldn't bleed into the production Admin Clawdy session.

5. **What's the test strategy for the auto-thread pre-spawn race?**
   - What we know: Pitfall 4 — Discord 3s ack window vs. spawn latency.
   - What's unclear: How to assert the deferReply happens BEFORE the spawn in tests (timing-sensitive).
   - Recommendation: Vitest fake-timers + `vi.spyOn(interaction, "deferReply")` to assert call order. Don't measure wall-clock; assert call-order invariant.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All ClawCode code | ✓ | 22.x LTS | — |
| `@anthropic-ai/claude-agent-sdk` | session-adapter.ts | ✓ | 0.2.97 (locked) | — |
| `discord.js` | slash-commands.ts | ✓ | 14.26.2 | — |
| `~/.claude/commands/gsd/*.md` | SDK slash dispatch | ✓ on jjagpal host | — | — (must be symlinked to clawcode user on prod) |
| `~/.claude/get-shit-done/` | GSD workflow `@`-includes | ✓ on jjagpal host | — | — (must be symlinked) |
| `clawcode` system user on clawdy host | Daemon runs as this user | ✓ (per `.planning/migration/ledger.jsonl` and v2.4 deploy-runbook) | n/a | — |
| `/opt/clawcode-projects/sandbox/` | Smoke-test target | ✗ — needs `mkdir + git init + initial empty commit` | — | Operator can use any wipeable empty repo |
| `git` CLI | `gsd-tools.cjs commit` | ✓ on clawdy host (used by Phase 91 sync) | — | — |
| `gh` CLI | NOT NEEDED — local commits only per locked decision | n/a | — | — |
| Discord guild slash command quota | < 90/guild | ✓ (~16-25/guild current — Phase 96 deploy reported this) | — | — |

**Missing dependencies with no fallback:**
- `/opt/clawcode-projects/sandbox/` — needs first-time `mkdir -p && git init && git commit --allow-empty -m "init"`. The Phase 100 install helper handles this.

**Missing dependencies with fallback:**
- None. Symlinks must be created (no fallback) but they're trivial.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | `/home/jjagpal/.openclaw/workspace-coding/vitest.config.ts` |
| Quick run command | `npm test -- --run src/config/__tests__/loader.test.ts` (per-file) |
| Full suite command | `npm test` (runs all `**/*.test.ts` excluding `.claude/worktrees/`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GSD-01 | 5 new slashCommandEntrySchema entries pass parse | unit | `npm test -- --run src/config/__tests__/schema.test.ts -t 'gsd-'` | ❌ Wave 0 — extend `schema.test.ts` |
| GSD-02 | settingSources flows from ResolvedAgentConfig into baseOptions | unit | `npm test -- --run src/manager/__tests__/session-adapter.test.ts -t 'settingSources'` | ❌ Wave 0 — new test |
| GSD-03 | Long-runner slash command pre-spawns subagent thread | unit | `npm test -- --run src/discord/__tests__/slash-commands-gsd.test.ts` | ❌ Wave 0 — new file |
| GSD-04 | gsd.projectDir overrides workspace as cwd | unit | `npm test -- --run src/manager/__tests__/session-adapter.test.ts -t 'gsd.projectDir cwd'` | ❌ Wave 0 — new test |
| GSD-05 | Symlink-based install command writes correct symlinks | unit | `npm test -- --run src/cli/commands/__tests__/install-gsd.test.ts` | ❌ Wave 0 — new file |
| GSD-06 | relayCompletionToParent appends artifact paths | unit | `npm test -- --run src/discord/subagent-thread-spawner.test.ts -t 'artifact paths'` | ❌ Wave 0 — extend existing |
| GSD-07 | settingSources + gsd.projectDir classified reloadable in differ | unit | `npm test -- --run src/config/__tests__/differ.test.ts -t 'settingSources reloadable'` | ❌ Wave 0 — new tests in existing file |
| GSD-08 | Discord interaction defer happens BEFORE thread spawn (3s race) | unit | `npm test -- --run src/discord/__tests__/slash-commands-gsd.test.ts -t 'deferReply order'` | ❌ Wave 0 — new test |
| GSD-09 | Admin Clawdy is the only agent that gets long-runner slash dispatch | unit | `npm test -- --run src/discord/__tests__/slash-commands-gsd.test.ts -t 'admin-clawdy guard'` | ❌ Wave 0 — new test |
| GSD-10 | Smoke test: /gsd-autonomous in #admin-clawdy spawns thread + dispatches /gsd:autonomous | manual-only | n/a (operator runs in deploy) | n/a |

### Sampling Rate
- **Per task commit:** `npm test -- --run <changed-file-path>` (Wave 0 unit tests for that task's slice)
- **Per wave merge:** `npm test` (full suite green)
- **Phase gate:** Full suite green + manual smoke test (GSD-10) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/discord/__tests__/slash-commands-gsd.test.ts` — covers GSD-01, GSD-03, GSD-08, GSD-09 (new file)
- [ ] `src/cli/commands/__tests__/install-gsd.test.ts` — covers GSD-05 (new file, requires `node:fs/promises` symlink mocks)
- [ ] Extensions to `src/config/__tests__/schema.test.ts` — additive `agent.settingSources` + `agent.gsd` parse tests (Rule 3 cascade: ~22 fixture configs may need `settingSources: undefined` keys, mirroring Phase 89/90/96 cascades)
- [ ] Extensions to `src/manager/__tests__/session-adapter.test.ts` — `settingSources` + `gsd.projectDir → cwd` flow tests
- [ ] Extensions to `src/discord/subagent-thread-spawner.test.ts` — relay prompt artifact path append
- [ ] Extensions to `src/config/__tests__/differ.test.ts` — `settingSources` and `gsd.projectDir` classified reloadable

*(Test infrastructure already in place: vitest 4.1.3, `__tests__/` co-location, MockSessionAdapter for SDK isolation, makeAgentConfig/makeConfig fixtures in existing test files. No framework install needed.)*

## Sources

### Primary (HIGH confidence)
- **Claude Agent SDK 0.2.97 type definitions** — `/home/jjagpal/.openclaw/workspace-coding/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
  - `:1394` — `settingSources?: SettingSource[]` field
  - `:4224` — `SettingSource = 'user' | 'project' | 'local'`
  - `:1748` — `initializationResult()` returns `commands` for slash discovery
  - `:4239` — `SlashCommand` shape
- **Claude Code SDK official docs (2026)**
  - [Agent Skills in the SDK](https://code.claude.com/docs/en/agent-sdk/skills) — `settingSources: ["user", "project"]` loads `~/.claude/skills/`
  - [Use Claude Code features in the SDK](https://code.claude.com/docs/en/agent-sdk/claude-code-features) — settingSources behavior, what each source loads
  - [Slash Commands in the SDK](https://code.claude.com/docs/en/agent-sdk/slash-commands) — `~/.claude/commands/` legacy form, frontmatter, namespacing
  - [Extend Claude with skills](https://code.claude.com/docs/en/slash-commands) — commands & skills unified in 2026, frontmatter reference, live change detection
- **ClawCode source (verified by reading)**
  - `src/manager/session-adapter.ts:585-636` — hardcoded `cwd` + `settingSources: ["project"]`
  - `src/config/schema.ts:318-323` — `slashCommandEntrySchema`
  - `src/config/schema.ts:861-1022` — `agentSchema`
  - `src/config/loader.ts:111-388` — `resolveAgentConfig`
  - `src/discord/slash-commands.ts:1126-1508` — `handleInteraction` (the dispatcher with 11 inline short-circuits)
  - `src/discord/subagent-thread-spawner.ts:81-323` — `spawnInThread` + `relayCompletionToParent` (Phase 99-M)
  - `src/config/types.ts:45-133` — `RELOADABLE_FIELDS`
  - `src/shared/types.ts:5-304` — `ResolvedAgentConfig`
- **CONTEXT.md** (`.planning/phases/100-.../100-CONTEXT.md`) — locked decisions

### Secondary (MEDIUM confidence — verified with primary)
- [Discord API Discussion #4070](https://github.com/discord/discord-api-docs/discussions/4070) — slash command name regex `^[-_'\p{L}\p{N}]{1,32}$`, max 32 chars (verified by running JS regex on the 5 GSD names)
- [GitHub Issue #14836 (claude-code)](https://github.com/anthropics/claude-code/issues/14836) — symlink discovery bug for `~/.claude/skills/`
- [GitHub Issue #25367 (claude-code)](https://github.com/anthropics/claude-code/issues/25367) — symlinked skills directory validation failure (status: duplicate of #14836, partially resolved at execution layer)

### Tertiary (LOW confidence — flagged for live validation)
- Live-watch behavior of `~/.claude/commands/` in SDK 0.2.97 — docs are CLI-focused; SDK behavior may differ. Open Question 3 above.
- Whether `~/.claude/commands/gsd/plan-phase.md` with frontmatter `name: gsd:plan-phase` (colon in name field) registers under the namespaced `/gsd:plan-phase` syntax in the SDK. Per [docs](https://code.claude.com/docs/en/slash-commands), the directory provides the namespace prefix. Empirical verification recommended via `Query.initializationResult()` log inspection during Wave 1 implementation.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — every library + version verified against `package.json` + in-tree types + npm registry
- Architecture: **HIGH** — patterns are 11+ prior applications in the same codebase; existing source provides verbatim templates
- Pitfalls: **HIGH for #1-7** (symlink bug, CONTEXT path ambiguity, settingSources empty, Discord race, slash cap, SDK pre-1.0, edit cache) — all backed by docs/issues/source. **MEDIUM for #8** (slugification, informational only)
- Validation: **HIGH** — vitest is in use; test patterns derived from 11 prior phases' acceptance grep pins
- Open questions: 5 items, none blocking — all are recommendations, not unknowns

**Research date:** 2026-04-26
**Valid until:** 2026-05-15 (3 weeks — SDK 0.2.x is fast-moving; re-verify settingSources stability if minor version bumps)

## RESEARCH COMPLETE

**Phase:** 100 - GSD-via-Discord on Admin Clawdy
**Confidence:** HIGH

### Key Findings
- The SDK primitive (`settingSources: ["user","project"]`) is documented and present at `sdk.d.ts:1394`. Setting it on the per-agent base options unlocks user-level `~/.claude/commands/`, `~/.claude/skills/`, and `~/.claude/CLAUDE.md` loading.
- All 5 Discord slash names (`gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-debug`, `gsd-quick`) pass both `slashCommandEntrySchema` regex and Discord API regex; max length 17 chars vs. 32 cap.
- The CONTEXT.md path `~/.claude/get-shit-done/skills/gsd/*.md` does NOT exist on the host. The actual SDK-discoverable surface is `~/.claude/commands/gsd/*.md`. Phase 100 install MUST symlink BOTH `~/.claude/get-shit-done/` AND `~/.claude/commands/gsd/` to the clawcode user.
- The 12th inline-handler-short-circuit pattern is well-established in `src/discord/slash-commands.ts` (11 prior precedents from Phases 85-96). Phase 100's `handleGsdLongRunner` follows the exact same shape.
- `SubagentThreadSpawner.spawnInThread` (already shipped) accepts a `task` parameter that becomes the subagent's first user message. Passing `task: "/gsd:autonomous --from 100"` works because the subagent inherits `settingSources: ["user"]` via the `...parentConfig` spread at line 211.
- Phase 99-M auto-relay (`relayCompletionToParent`) shipped 2026-04-26 — Phase 100 extends the relay prompt with artifact paths; no architectural change needed.
- 7 known pitfalls identified, all with source-verified mitigations. The CRITICAL one is Pitfall 1 (symlink discovery bug) — its scope is confined to `~/.claude/skills/`, not `~/.claude/commands/`, so the Phase 100 symlink layout sidesteps it.
- Zero new npm dependencies. v2.2 zero-new-deps discipline preserved through v2.7.

### File Created
`/home/jjagpal/.openclaw/workspace-coding/.planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/100-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | Every version verified against installed `node_modules` + npm registry |
| Architecture | HIGH | 11 prior applications of the same patterns in this codebase |
| Pitfalls | HIGH | 7 of 7 backed by docs / GitHub issues / in-tree source verification |
| Validation | HIGH | vitest 4.1.3 already in use; test pattern derived from Phase 85/86/89/90/96 acceptance grep pins |

### Open Questions
1. Should `defaults.gsd.projectDir` exist? Recommendation: NO — per-agent only.
2. Add `admin-clawdy` to local clawcode.yaml for fixtures? Recommendation: YES, in test fixtures + dev clawcode.yaml.
3. Live-watch behavior of `~/.claude/commands/` in SDK 0.2.97 — undocumented for SDK; assume "next session restart" conservatively.
4. Symlink `~/.claude/CLAUDE.md`? Recommendation: NO — keep clawcode user's identity per-agent.
5. Test the deferReply→spawn race with vi.spyOn call-order assertions, not wall-clock timing.

### Ready for Planning
Research complete. Planner can now create PLAN.md files with the architecture patterns, sample code, and test strategy above. Recommended task slicing:
- **Task 1:** Schema + loader + types (additive `settingSources` + `gsd.projectDir`)
- **Task 2:** session-adapter.ts wiring (4-line change × 2 methods + tests)
- **Task 3:** Differ classification + reloadable tests
- **Task 4:** SlashCommandHandler.handleGsdLongRunner + tests
- **Task 5:** Phase 99-M relay extension (artifact paths)
- **Task 6:** Install helper CLI subcommand + tests
- **Task 7:** Admin Clawdy clawcode.yaml entries (5 slashCommands, settingSources, gsd.projectDir) — dev fixture + production deploy-runbook section
- **Task 8:** Smoke test runbook (operator types `/gsd-autonomous` in test channel; verify thread spawn + Phase 99-M relay)
