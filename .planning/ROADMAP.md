# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :construction: **v1.4 Agent Runtime** - Phases 33-34 (in progress)

## Phases

<details>
<summary>v1.0 Core Multi-Agent System (Phases 1-5) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phases 1-5 delivered: central config, agent lifecycle, Discord routing, per-agent memory, heartbeat framework.

</details>

<details>
<summary>v1.1 Advanced Intelligence (Phases 6-20) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

Phases 6-20 delivered: memory consolidation, relevance/dedup, tiered storage, task scheduling, skills registry, agent collaboration, Discord slash commands, attachments, thread bindings, webhook identities, session forking, context summaries, MCP bridge, reaction handling, memory search CLI.

</details>

<details>
<summary>v1.2 Production Hardening & Platform Parity (Phases 21-30) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

Phases 21-30 delivered: tech debt cleanup, config hot-reload, context health zones, episode memory, delivery queue, subagent Discord threads, security & execution approval, agent bootstrap, web dashboard.

</details>

### v1.3 Agent Integrations (In Progress)

**Milestone Goal:** Complete subagent-thread UX and enable agents to connect to external MCP servers.

- [x] **Phase 31: Subagent Thread Skill** - Skill wrapper and system prompt guidance so agents naturally use Discord threads for subagent work (completed 2026-04-09)
- [x] **Phase 32: MCP Client Consumption** - Per-agent MCP server config, daemon activation, tool discovery, health checks, and CLI visibility (completed 2026-04-09)

## Phase Details

### Phase 31: Subagent Thread Skill
**Goal**: Agents seamlessly create Discord-visible subagent threads through a natural skill interface instead of raw IPC
**Depends on**: Phase 27 (subagent Discord thread spawning infrastructure)
**Requirements**: SASK-01, SASK-02, SASK-03, SASK-04
**Success Criteria** (what must be TRUE):
  1. An agent can invoke a skill that spawns a subagent in a dedicated Discord thread, returning the thread URL and session name
  2. The skill gracefully reports clear error messages when Discord client is unavailable or no channel is bound
  3. Agent system prompts guide the agent to prefer the subagent thread skill over the raw Agent tool when Discord visibility is desired
**Plans:** 2/2 plans complete
Plans:
- [x] 31-01-PLAN.md -- Skill infrastructure: SKILL.md, CLI spawn-thread command, MCP spawn_subagent_thread tool
- [x] 31-02-PLAN.md -- System prompt guidance injection in buildSessionConfig

### Phase 32: MCP Client Consumption
**Goal**: Agents can connect to and use tools from external MCP servers configured per-agent in clawcode.yaml
**Depends on**: Phase 31 (completes subagent work first; independent technically but ordered for milestone flow)
**Requirements**: MCPC-01, MCPC-02, MCPC-03, MCPC-04, MCPC-05, MCPC-06
**Success Criteria** (what must be TRUE):
  1. Operators can define MCP servers in clawcode.yaml per agent (name, command, args, env) with shared definitions reusable across agents
  2. The daemon passes MCP server configs to agent sessions so Claude Code natively activates them on startup
  3. Agent system prompts list available MCP tools with descriptions so agents know what external tools they can use
  4. Running `clawcode mcp-servers` shows configured MCP servers per agent with health/connectivity status
  5. MCP server health is verifiable -- the daemon can confirm servers start and respond before marking them active
**Plans:** 2/2 plans complete
Plans:
- [x] 32-01-PLAN.md -- Config schema, types, resolution, and SDK session passthrough (MCPC-01, MCPC-02, MCPC-06)
- [x] 32-02-PLAN.md -- System prompt MCP tools injection, health checks, CLI mcp-servers command (MCPC-03, MCPC-04, MCPC-05)

### v1.4 Agent Runtime (In Progress)

**Milestone Goal:** Deploy ClawCode to actually run agents — install the subagent-thread skill globally and build a standalone agent runner that starts, manages, and hot-restarts a single agent process via the Claude Agent SDK.

- [ ] **Phase 33: Global Skill Install** - Install workspace skills to ~/.claude/skills/ at daemon startup so agents can access them outside the daemon's skill injection path
- [ ] **Phase 34: Standalone Agent Runner** - Build `src/agent/runner.ts` — a self-contained runner that starts a single agent via SdkSessionAdapter, connects it to Discord via DiscordBridge, and manages its full lifecycle (start, hot-restart, graceful stop) without needing the full daemon

### Phase 33: Global Skill Install
**Goal**: Skills defined in workspace `skills/` are automatically installed to `~/.claude/skills/` at daemon startup so agents running as raw Claude Code sessions (outside the daemon) can also access them
**Depends on**: Phase 31 (subagent-thread skill exists in skills/)
**Requirements**: GSKIN-01, GSKIN-02
**Success Criteria** (what must be TRUE):
  1. `~/.claude/skills/subagent-thread/SKILL.md` exists and matches the workspace's `skills/subagent-thread/SKILL.md`
  2. Daemon startup copies all workspace skills to `~/.claude/skills/` before starting agent sessions
**Plans:** 0/1 plans complete
Plans:
- [ ] 33-01-PLAN.md -- Skill installer: copy workspace skills to ~/.claude/skills/ at daemon startup

### Phase 34: Standalone Agent Runner
**Goal**: A lightweight `clawcode run <agent>` command that starts a single named agent — SDK session + Discord bridge + lifecycle management — without the full daemon overhead
**Depends on**: Phase 33 (skills installed), Phase 1 (SdkSessionAdapter), Phase 3 (DiscordBridge)
**Requirements**: RUNNER-01, RUNNER-02, RUNNER-03
**Success Criteria** (what must be TRUE):
  1. `clawcode run test-agent` starts the test-agent session, connects it to its Discord channel, and keeps it running
  2. The runner hot-restarts the agent on crash (exponential backoff, max 3 attempts)
  3. Ctrl+C gracefully stops the agent and cleans up resources
**Plans:** 0/2 plans complete
Plans:
- [ ] 34-01-PLAN.md -- AgentRunner class: SDK session + DiscordBridge wiring + crash recovery
- [ ] 34-02-PLAN.md -- CLI `clawcode run <agent>` command + graceful shutdown signal handling

## Progress

**Execution Order:** Phases execute in numeric order: 31, 32, 33, 34.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 | v1.0 | - | Complete | 2026-04-09 |
| 6-20 | v1.1 | - | Complete | 2026-04-09 |
| 21-30 | v1.2 | - | Complete | 2026-04-09 |
| 31. Subagent Thread Skill | v1.3 | 2/2 | Complete | 2026-04-09 |
| 32. MCP Client Consumption | v1.3 | 2/2 | Complete | 2026-04-09 |
| 33. Global Skill Install | v1.4 | 0/1 | Not Started | - |
| 34. Standalone Agent Runner | v1.4 | 0/2 | Not Started | - |
