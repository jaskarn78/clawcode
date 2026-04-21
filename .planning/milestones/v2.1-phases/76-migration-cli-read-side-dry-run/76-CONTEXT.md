# Phase 76: Migration CLI Read-Side + Dry-Run - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Introduce two read-only migration CLI subcommands — `clawcode migrate openclaw list` and `clawcode migrate openclaw plan` — that surface the state of every active OpenClaw agent and the per-agent diff that a future `apply` would produce. Write nothing to `~/.clawcode/` or `clawcode.yaml`. Write a single append-only ledger to `.planning/migration/ledger.jsonl` that downstream phases (77–82) consume.

Delivers MIGR-01 (dry-run plan output) and MIGR-08 (status tracking). Does NOT deliver apply, verify, rollback, cutover, or complete — those are Phases 77–82.

</domain>

<decisions>
## Implementation Decisions

### Source Discovery & Agent Inventory
- **Agent source of truth:** Parse `~/.openclaw/openclaw.json` `agents:` section (line 1891+ in the sample captured 2026-04-20). Canonical — it's what the OpenClaw daemon reads.
- **Memory chunk count source:** Open `~/.openclaw/memory/<name>.sqlite` read-only via better-sqlite3, `SELECT COUNT(*) FROM chunks`. Matches the approach in `.planning/research/STACK.md`. 7 agents populated (~2,617 total chunks), 8 empty as of 2026-04-20.
- **Discord channel binding:** Read from the agent entry in `openclaw.json` (`channelId` / `channels` field — confirm exact key during planning codebase scout).
- **Finmentum family detection:** Hard-coded list of 5 agent names: `fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum-content-creator`. All 5 mapped to shared `basePath: ~/.clawcode/agents/finmentum` with distinct `memoryPath:` values (SHARED-01 contract from Phase 75). Hardcoded — explicit roadmap decision; dynamic heuristic risks mis-grouping `finmentum-dashboard` / `finmentum-studio`.

### CLI Shape & Output
- **Command structure:** Nested commander subcommand `clawcode migrate openclaw <sub>` — matches existing `clawcode mcp <sub>` pattern in `src/cli/commands/mcp.ts`.
- **Subcommands in scope:** `list`, `plan`, `plan --agent <name>` only. `apply`, `verify`, `rollback`, `cutover`, `complete` are Phases 77–82.
- **Table rendering:** Zero new npm deps. Extend `src/cli/output.ts` if needed; use aligned-column printing + ANSI color codes inline. Respect `NO_COLOR` env var.
- **Color scheme:** green = new (agent to be migrated), yellow = warning (unknown MCP server, ambiguous mapping), red = conflict (Discord channel collision would happen on apply). Diff legend printed at top of `plan` output.

### Ledger & Determinism
- **Ledger path:** `.planning/migration/ledger.jsonl` exactly per roadmap. Committed to repo (git-diffable audit trail). Directory created on first write.
- **Ledger row schema:** `{ts: ISO, action: "plan"|"apply"|"verify"|"rollback"|"cutover", agent: string, status: "pending"|"migrated"|"verified"|"rolled-back", source_hash: string, target_hash: string, notes?: string}`. Append-only JSONL, one row per state transition.
- **Bootstrap:** First `plan` run writes 15 `{action:"plan", status:"pending"}` rows, one per active OpenClaw agent. Subsequent `plan` runs append a single `{action:"plan", status:"re-planned"}` row with fresh source_hash if content changed (idempotent otherwise).
- **Plan output determinism:** Sort agents by name alphabetically; serialize JSON diffs with stable key order; emit SHA256 hash at end of `plan` output. Test asserts `plan` output hash is stable across two consecutive runs on the same source.
- **Zero-write enforcement:** Integration test spies on `fs.writeFile*`/`fs.mkdir*` and asserts zero calls with paths matching `~/.clawcode/` or `clawcode.yaml` during `list` and `plan`. `.planning/migration/` writes are allowed (and required for ledger).
- **`list` status source:** After first `plan` is run, `list` reads per-agent status from the ledger (last row per agent). Never reads from the target filesystem — target doesn't exist yet in Phase 76.

### Claude's Discretion
- Exact commander subcommand registration API (e.g., `.command("migrate openclaw list")` vs. nested sub-programs) — match whatever `mcp.ts` already does
- Error message copy for unknown-agent / missing-openclaw.json scenarios — keep actionable and consistent with existing CLI errors
- Color palette hex/ANSI choice — pick whatever `output.ts` already exposes
- Test file organization — unit for readers/mapper, integration for end-to-end CLI invocation against fixture `openclaw.json`

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/index.ts` — commander-based CLI entry; `registerXCommand(program)` pattern used by all 50+ existing subcommands
- `src/cli/output.ts` — existing cliLog/cliError helpers, ANSI-color aware
- `src/cli/commands/mcp.ts` — reference for nested-subcommand registration (`clawcode mcp <sub>`)
- `better-sqlite3` — already project dep; read-only SQLite via `new Database(path, {readonly: true})`
- `yaml` package — already in use, comment-preserving Document AST available for downstream phases (not needed in Phase 76 — no YAML writes here)
- `zod` — validate parsed openclaw.json agents section

### Established Patterns
- CLI commands live in `src/cli/commands/<name>.ts`, export a `registerXCommand(program: Command)` function
- Tests live in `src/cli/commands/__tests__/` (sibling) or `*.test.ts` colocated
- Zod schemas for external-file inputs (matches `.planning/research/STACK.md` recommendation)
- `src/cli/output.ts` used by all commands — do not introduce chalk/picocolors

### Integration Points
- New files under `src/migration/` for reusable logic (consumed by Phases 77–82):
  - `openclaw-config-reader.ts` — parse ~/.openclaw/openclaw.json + zod validation
  - `source-memory-reader.ts` — read-only sqlite for chunk counts
  - `diff-builder.ts` — assemble per-agent diff from source + finmentum grouping rules
  - `ledger.ts` — append-only JSONL read/write helpers with schema validation
- New CLI command module: `src/cli/commands/migrate-openclaw.ts` registered in `src/cli/index.ts`
- New ledger dir: `.planning/migration/` (created by CLI on first write; add to git)

</code_context>

<specifics>
## Specific Ideas

- 15 active OpenClaw agents — `general`, `work`, `projects`, `research`, `personal`, `shopping`, `local-clawdy`, `kimi`, `fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum`, `finmentum-content-creator`, `main` (confirm exact list from openclaw.json during planning scout — this is based on `agentDir` paths observed).
- 5 finmentum agents (listed above in Decisions) map to one shared `basePath` with 5 distinct `memoryPath:` fields — this is THE load-bearing use case for Phase 75's work.
- Plan output table columns: `Name | Source Path | Memories | MCP Count | Discord Channel | Status`. Warnings emitted below the table as a separate section (one line per warning).
- `--agent <name>` exit codes: 0 on success, 1 on unknown agent (actionable error message like `Unknown OpenClaw agent: '<name>'. Available: general, work, ...`).

</specifics>

<deferred>
## Deferred Ideas

- `apply` / `verify` / `rollback` / `cutover` / `complete` subcommands — Phases 77–82
- YAML writer for `clawcode.yaml` merges — Phase 78
- Secret-shape detection / pre-flight guards — Phase 77
- Markdown-chunk splitting rules for memory translation — Phase 80
- Pretty structured diff library (e.g., `jsondiffpatch`) — deferred; hand-rolled aligned-column diff suffices for this phase per STACK.md
- Programmatic ledger query API (e.g., `migration.getStatus(agent)` as a module export) — possible but not required for Phase 76 UX; revisit in Phase 81

</deferred>
