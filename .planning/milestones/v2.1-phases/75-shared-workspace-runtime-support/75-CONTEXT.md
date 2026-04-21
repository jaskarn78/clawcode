# Phase 75: Shared-Workspace Runtime Support - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add an optional `memoryPath:` field to agentSchema so multiple agents can reference the same `basePath` while each opening an isolated `memories.db`, inbox directory, heartbeat log, and session-state directory. This is a runtime feature addition (not a migration concern) that unblocks the 5-agent finmentum family in Phase 79+. Zero impact on the 10 dedicated-workspace agents (they don't set `memoryPath:`).

Delivers SHARED-01 (isolated memories.db), SHARED-02 (isolated inbox/heartbeat/session-state), SHARED-03 (finmentum family boots clean on shared workspace).

</domain>

<decisions>
## Implementation Decisions

### Override Field Semantics
- **Single `memoryPath:` field** controls all four per-agent private dirs (memory, inbox, heartbeat, session-state). Agents sharing a `basePath` differ only by `memoryPath:`. Single field matches roadmap language and keeps config surface minimal.
- **Fallback to `workspace:` path** when `memoryPath:` unset — zero behavior change for the 10 dedicated-workspace agents. The field is purely additive.
- **Path format:** absolute or relative, expanded via existing `expandHome()` helper. Both `~/...` and `./subdir` forms accepted (mirrors how `workspace:` is handled).
- **Conflict detection:** Zod `.superRefine()` at the full-config schema level — error at load time with an actionable message listing the conflicting agent names. Fail-fast prevents partial init and matches existing channel-conflict validation pattern.

### Claude's Discretion
- Exact call-site plumbing (how many touch-points in `session-memory.ts` + other consumers of `config.workspace` for the four dir types)
- Naming of helper functions / resolution order
- Test structure (unit vs integration) — use existing patterns in `src/config/__tests__/`

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `expandHome()` helper already used for `basePath` expansion (src/config/schema.ts)
- Zod `.superRefine()` pattern exists for channel-conflict validation in full-config schema
- `agentSchema` (src/config/schema.ts:640-686) has optional `workspace: z.string().optional()` — `memoryPath` slots in alongside
- Loader path resolution at `src/config/loader.ts:153` — single line to extend with `memoryPath ?? workspace` fallback

### Established Patterns
- Optional agent fields fall back to `defaults` or derive from higher-level fields (`workspace ?? join(defaults.basePath, agent.name)`)
- Memory DB path derived in `session-memory.ts:53`: `memoryDir = join(config.workspace, "memory")` — swap to `join(config.memoryPath ?? config.workspace, "memory")`
- Traces DB similarly derived at line 115 — same swap applies
- Per-agent inbox referenced via `collaboration/inbox.ts` (trigger source config) — needs audit

### Integration Points
- `src/config/schema.ts` — add field to agentSchema + full-config superRefine for conflict detection
- `src/config/loader.ts` — populate resolved `memoryPath` on the agent config object (default to `workspace`)
- `src/manager/session-memory.ts` — swap 2 call sites (`memoryDir`, `tracesDbPath`) to use resolved memoryPath
- Inbox / heartbeat / session-state consumers — audit during planning for additional touch-points
- `src/config/differ.ts` — confirm new field is detected as `reloadable: false` (matches constraint from STATE.md Blockers)

</code_context>

<specifics>
## Specific Ideas

- 5-agent finmentum family (`fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum-content-creator`) is the canonical test case — success criterion #3 requires all 5 to boot cleanly on shared workspace with no file-lock errors and no duplicate auto-linker runs.
- Two-agent minimum test: writes to agent A's memories.db never touch agent B's (verify via `sqlite3 .../A/memories.db "SELECT COUNT(*) FROM memories"` vs `.../B/memories.db`).
- Must coexist with hot-reload semantics: adding a new `memoryPath:`-bearing agent requires `systemctl stop clawcode && restart` (per existing Phase 77 blocker note), not hot-reload — confirm differ.ts marks this correctly.

</specifics>

<deferred>
## Deferred Ideas

- Four separate override fields (`inboxPath`, `heartbeatPath`, `sessionStatePath`) — rejected for this phase; can be re-introduced in a future milestone if independent overrides are ever requested. Single `memoryPath:` suffices for the finmentum use case.
- Per-agent `skillsPath` override — out of scope; skills are shared via `defaults.skillsPath`.
- Runtime rebind of `memoryPath:` (change without restart) — explicitly deferred per hot-reload blocker; `differ.ts` `reloadable: false` is the enforcement point.

</deferred>
