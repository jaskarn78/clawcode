# Phase 100: GSD-via-Discord on Admin Clawdy - Context

**Gathered:** 2026-04-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Operator can drive a full GSD workflow (`/gsd:plan-phase`, `/gsd:execute-phase`, `/gsd:autonomous`, `/gsd:debug`, `/gsd:quick`) from the `#admin-clawdy` Discord channel. Long-running workflows auto-spawn a subagent thread so the main channel stays free; the parent agent posts a one-line summary + thread URL + artifact paths back to main when work completes (Phase 99-M auto-relay handles the parent-side post).

**In scope:** Skill delivery to the `clawcode` system user, per-agent `settingSources` config field, project-cwd resolution via new `gsd.projectDir` field, ClawCode-side slash dispatcher for 5 GSD commands, auto-thread routing for long-runners, smoke test on a fresh sandbox project on clawdy.

**Out of scope:** Multi-operator coordination, remote git push (`gh` CLI / SSH key setup), per-message project switcher, ButtonBuilder-rich UX for grey-area prompts, slash entries for every GSD skill (only the 5 most common ship in this phase).

</domain>

<decisions>
## Implementation Decisions

### Skills delivery to clawcode user
- **Symlink** `/home/jjagpal/.claude/get-shit-done/` → `/home/clawcode/.claude/get-shit-done/`. Atomic install, auto-updates whenever jjagpal edits the skills directory. Operator manages skill content; ClawCode side never copies.
- **Only Admin Clawdy** gets these skills loaded. Precise scope — other agents (fin-acquisition, content-creator, etc.) keep their existing skill lists; no risk of accidental GSD invocations from production agents.
- **Per-agent `settingSources` field** in clawcode.yaml (new optional `agent.settingSources?: string[]`, default `["project"]`). Admin Clawdy sets `settingSources: ["project", "user"]` so the SDK loads `~/.claude/skills/` (which includes the symlinked GSD skills). All other agents stay at `["project"]` — no behavior change.
- **Hot-reload via existing config-watcher**. Yaml edits to `settingSources` trigger config differ → agent restart with new SDK options. No restart on skill-content changes (SDK re-reads on next session start, which happens often enough).

### Project workspace resolution
- **New `gsd.projectDir?: string` field** on agent config. When set, GSD operations run with that directory as cwd. When unset, fall back to `agent.workspace`. Single source of truth — no per-message switcher.
- **Smoke test target:** fresh empty project at `/opt/clawcode-projects/sandbox/` on clawdy. Pre-create with `git init` + initial empty commit. Wipeable; no risk to real repos.
- **Local commits only** for Phase 100. GSD's `gsd-tools.cjs commit` writes locally; pushing is manual via the operator's terminal. No `gh` CLI auth, no SSH keypair, no GitHub device-code in this phase. Defer to Phase 101 if remote ops surface as a need.
- **Single-operator** assumption. No soft-lock around active workflows; one workflow at a time is the operator's responsibility. Race-condition handling deferred.

### Slash command routing
- **Both paths** for invocation:
  - **(a) ClawCode-side dispatcher:** add 5 slash entries to Admin Clawdy's `slashCommands:` field — `/gsd-autonomous`, `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-debug`, `/gsd-quick`. Each entry's `claudeCommand` rewrites the Discord-compatible name back to the canonical `/gsd:*` form (e.g., `/gsd-plan-phase` → `claudeCommand: "/gsd:plan-phase {phase}"`). Discord forbids `:` in slash names, so the dispatcher is the bridge.
  - **(b) Plain message body:** `/gsd:autonomous` typed directly works because `settingSources: ["user"]` lets the SDK auto-recognize user-level skills. This is the always-available fallback for skills not exposed via Discord slash.
- **Plain-text arguments** after the command — `/gsd-plan-phase 100 --skip-research` becomes `/gsd:plan-phase 100 --skip-research`. No typed Discord options for now (the YAML schema for typed options grows fast and most GSD args are positional/free-form).
- **In-thread Q&A** — when GSD's smart-discuss asks the user a question (AskUserQuestion-style), it posts in the active subthread. Operator answers in the same thread; agent reads thread history to capture the response. No ButtonBuilder embed.
- **5 slash commands ship in Phase 100.** The full GSD skill list (15+) remains available via plain message body (`/gsd:audit-milestone`, `/gsd:cleanup`, etc.) — only the most common entry points get a Discord menu shortcut.

### Auto-thread + artifact relay
- **Long-runners auto-thread:** `/gsd-autonomous`, `/gsd-execute-phase`, `/gsd-plan-phase`. The dispatcher detects these slash names and pre-spawns a subagent thread BEFORE invoking the skill, passing the GSD command as the subagent's initial task. Short ones (`/gsd-quick`, `/gsd-debug`) stay inline unless their internal logic decides to thread (Phase 99-K directive still applies).
- **Thread naming:** `gsd:<command>:<phase-or-target>` — `gsd:autonomous:100`, `gsd:plan:100`, `gsd:execute:100`. Sortable in Discord's thread sidebar.
- **Main-channel summary on completion:** one-line — `Phase 100 ✅ done — 4 plans, 12 commits. Thread: <URL>. Artifacts: .planning/phases/100-<slug>/`. Phase 99-M auto-relay (`relayCompletionToParent`) already runs on subagent session end; we extend it to include artifact paths from the GSD `init phase-op` output.
- **Auto-commit per phase** matching existing GSD behavior — `gsd-tools.cjs commit` calls in the workflows write commits locally as artifacts complete. Operator reviews with `git log` after the run.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/discord/subagent-thread-spawner.ts` — spawns subagent in Discord thread (`spawnInThread`), handles webhook identity, persists binding, runs initial-prompt async. Phase 99-M auto-relay (`relayCompletionToParent`) already shipped — runs on subagent session-end and posts summary to parent's bound channel.
- `src/config/schema.ts:slashCommandEntrySchema` — existing schema for ClawCode-side slash commands. Each entry has `name`, `description`, `claudeCommand`, optional `options[]`. Used by `/clawcode-status`, `/clawcode-dream`, etc.
- `src/manager/session-adapter.ts:588,627` — `cwd: config.workspace, settingSources: ["project"]` is hardcoded in two places. Phase 100 makes both readable from agent config.
- `src/config/loader.ts:resolveAgentConfig` — already has the per-agent override pattern. Adding `gsd.projectDir` and `settingSources` follows existing precedent.
- `~/.claude/get-shit-done/skills/gsd/*.md` — all 18 GSD skills live here. Symlink target.

### Established Patterns
- **Per-agent config overrides:** the loader's `resolveAgentConfig` merges `defaults.X` ← `agent.X` for many fields (`heartbeat`, `model`, `effort`, etc.). Phase 100 follows this pattern for `settingSources` and `gsd.projectDir`.
- **Config hot-reload via differ:** `src/config/watcher.ts` + `differ.ts` already detect agent-config changes and restart only the affected agents. No new infra needed.
- **Discord slash dispatcher:** `src/discord/` registers ClawCode slashCommands at boot via `discord.js`. Adding 5 GSD entries plumbs through the existing dispatch path; no new discord.js APIs.
- **Subagent thread spawning:** `subagent-thread-spawner.spawnInThread()` is invoked from the `spawn_subagent_thread` MCP tool (Phase 31). Phase 100 adds a second invocation site: the slash-command dispatcher pre-spawns when it sees a long-runner.
- **Per-source settingSources:** Claude Agent SDK accepts `settingSources?: string[]` ("project" | "user" | "local"). The current code passes a hardcoded `["project"]`; we make it agent-configurable.

### Integration Points
- `src/discord/<slash-command-handler>.ts` — where the slash dispatcher detects `/gsd-*` names and either pre-spawns a subagent thread (long-runners) or sends `claudeCommand` inline (short).
- `src/manager/session-adapter.ts:588,627` — accept `settingSources` and `cwd` from config instead of hardcoding.
- `src/config/schema.ts` — extend `agentSchema` with `settingSources?: string[]` and `gsd: { projectDir?: string }?`.
- `src/config/loader.ts:resolveAgentConfig` — pass new fields through; default `settingSources` to `["project"]` for back-compat.
- New install/setup helper: a small CLI subcommand or one-shot script that creates the symlink (`/home/jjagpal/.claude/get-shit-done/` → `/home/clawcode/.claude/get-shit-done/`) and `/opt/clawcode-projects/sandbox/` (with `git init`).

</code_context>

<specifics>
## Specific Ideas

- The 5 Discord slash commands shipping in Phase 100: `gsd-autonomous`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-debug`, `gsd-quick`. Names use `-` because Discord slash command names cannot contain `:` (Discord API restriction).
- Each Discord slash entry's `claudeCommand` rewrites name → canonical (e.g., `claudeCommand: "/gsd:plan-phase {phase}"`). The `{phase}` placeholder uses the existing slashCommandOptionSchema choices/text mechanism.
- For grey-area prompts during `/gsd:autonomous` (the AskUserQuestion calls inside the workflow), the operator answers in the subthread. The agent reads thread history (already wired via Phase 31 thread fetch) to capture the response.
- Sandbox path `/opt/clawcode-projects/sandbox/` is purely for smoke-testing Phase 100 itself. Future projects live wherever the operator points `gsd.projectDir`.
- The Phase 99-M auto-relay format extends with artifact paths — the relay prompt already includes the thread's last assistant message; we add a structured "Artifacts: <paths>" line so the parent's summary includes them.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-operator coordination + soft-lock around active workflows.** Phase 100 assumes single-operator; if you and another collaborator both kick off `/gsd-autonomous` simultaneously, they'd race. Defer until that becomes a real problem.
- **Remote git auth (push, gh CLI, GitHub device-code).** Local commits only for Phase 100. PRs / pushes / `gh pr create` defer to a later phase.
- **Per-message project switcher** (`/gsd-set-project /opt/foo`). Defer until single `gsd.projectDir` proves insufficient.
- **Typed Discord slash command options** for GSD args (vs. plain-text). The YAML schema bloat isn't worth it until operators ask.
- **ButtonBuilder embeds** for grey-area question UX. In-thread plain text Q&A is enough for Phase 100.
- **Slash entries for the remaining GSD skills** (`audit-milestone`, `cleanup`, `complete-milestone`, `new-project`, `new-milestone`, etc.). They remain available via plain `/gsd:*` text — only the 5 most-common get a Discord menu entry. Add more if usage justifies.
- **Per-agent GSD state isolation.** If Phase 101 introduces a `dev-clawdy` agent or per-project agents, each needs its own `gsd.projectDir` and possibly its own `.planning/` base. Out of scope here — Admin Clawdy operates on one project at a time via its single configured `gsd.projectDir`.

</deferred>
