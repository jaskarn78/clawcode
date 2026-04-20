# Project Research Summary

**Project:** ClawCode v2.1 — OpenClaw Agent Migration
**Domain:** One-shot CLI data migration — multi-agent orchestration system (15 live agents, shared workspace subcase, live coexistence)
**Researched:** 2026-04-20
**Confidence:** HIGH (all findings grounded in on-box source inspection, live daemon state, and real DB schema verification)

---

## MUST-READ FINDINGS (READ BEFORE ANYTHING ELSE)

Four findings that change the shape of the roadmap if missed:

**1. Re-embedding is mandatory, not optional.**
OpenClaw uses gemini-embedding-001 at 3072 dims; ClawCode's `vec_memories` is locked to 384-dim MiniLM. These are different models in different vector spaces — no slicing, projecting, or normalizing bridges them. Every source chunk must be re-embedded from its raw text via ClawCode's existing `EmbeddingService` singleton. Cost: ~131 seconds wall time for 2,617 real chunks, zero API spend. Scope this as "text → re-embed → insert," not "blob copy."

**2. OpenClaw is live and uses a different Discord bot token.**
`openclaw-gateway.service` is running right now (PID 755761, ~1.3GB RSS). Its Discord bot token (`MTQ3MDE2MjYzMDY4NDcwNDg4MQ...`, bot ID 1470162630684704881) is a different identity from ClawCode's Clawdbot (`op://clawdbot/Clawdbot Discord Token/credential`). During any overlap window, both bots will receive and respond to the same Discord messages. The cutover protocol must explicitly unbind each agent from OpenClaw before binding it in ClawCode. Migration CLI must enforce this as a hard precheck, not operator discipline.

**3. Shared-workspace support does not exist today — it is a prerequisite, not a migration concern.**
Five finmentum agents share one workspace on disk. ClawCode's `session-memory.ts` unconditionally opens `<workspace>/memory/memories.db` — five agents on the same workspace would open the same DB, cross-pollinating memory across distinct identities. This is broken today. The fix is an optional `memoryPath` field in `agentSchema` (~15 lines across 3 files), but it must land as a dedicated prerequisite phase before any finmentum agent is migrated. It is not a migration-tool problem; it is a runtime feature addition.

**4. The plaintext Discord bot token in `openclaw.json` must never be copied into `clawcode.yaml`.**
OpenClaw stores the bot token as a literal string. A naive "copy over what's there" migrator would write this into `clawcode.yaml`, which lives in a git-tracked repo. This is a critical security failure: plaintext secret in git history, plus re-exposure of any key that has been rotated since OpenClaw captured it. The migrator must whitelist only opaque references (channel IDs, `op://` refs, named MCP server refs) and refuse — not warn — if it encounters a raw secret-shaped value. Add a secret-scan pre-commit hook for `clawcode.yaml`.

---

## Executive Summary

This milestone ports 15 active OpenClaw agents into ClawCode's native agent model. The work is best understood as a pipeline of four separable ETL problems: config mapping (OpenClaw JSON format → ClawCode YAML), workspace file migration (rsync with explicit excludes + absolute-path rewrite), memory translation (re-embed from markdown source files, not sqlite chunks), and Discord channel rebinding (one bot out, one bot in). Each problem has a clean solution using only ClawCode's existing stack — no new npm dependencies are required for any phase of v2.1.

The critical path constraint is dependency ordering. Two prerequisite features must be built before the migration CLI runs against real agents: (a) fleet-scale fork budget enforcement, because 15 newly-migrated agents with uncoordinated Opus escalation decisions have no spending ceiling today, and (b) shared-workspace support via the `memoryPath` field, because without it the finmentum family of 5 agents cannot have isolated memories while sharing a workspace directory. Both are small code changes (one a budget gate in `manager/fork.ts`, the other ~15 lines across schema/loader/session-memory), but they block the migration entirely if skipped.

The dominant risk across all phases is the "looks done but isn't" class of failure: embeddings written with wrong dimensions, secrets inlined rather than referenced, workspace files copied with broken symlinks or path references to the old location, and Discord channels left bound on both bots simultaneously. Research identified 15 distinct pitfalls; the top cluster (embedding mismatch, duplicate memory on re-run, live-daemon copy corruption, shared-workspace write contention, secret leakage) all have the same prevention pattern: build the migrator with explicit hard assertions and pre-flight validation that refuses to proceed rather than silently producing corrupt state.

---

## Key Findings

### Recommended Stack

**Zero new runtime dependencies.** The migration CLI ships entirely on ClawCode's existing stack: `better-sqlite3` for DB reads, `sqlite-vec` loaded on the target handle for writes, `@huggingface/transformers` singleton for re-embedding, `commander` for CLI subcommands, `yaml` (eemeli, comment-preserving) for YAML rewriting, `zod` for config validation, `pino` for structured audit logs, `date-fns` for timestamp translation, and Node 22's built-in `fs.promises.cp` for workspace file copy. No substitutes are needed; the "zero new deps" answer is confirmed.

The one library worth evaluating post-MVP is `diff@^9` or `jsondiffpatch@0.7.3` if reviewers ask for unified YAML diff output in the dry-run UI. Do not add it speculatively — the plan preview is a structured table, not a free-form diff, and hand-rolled rendering is sufficient for 15 agents times a handful of fields.

**Core technologies (reused, not added):**
- `better-sqlite3@12.8.0` — read OpenClaw source DB via `ATTACH DATABASE ... AS src` (read-only URI); write ClawCode `memories.db`
- `sqlite-vec@0.1.9` — load on target handle before inserting into `vec_memories`; not needed to read source (source embeddings are TEXT columns)
- `@huggingface/transformers@4.0.1` — re-embed all 2,617 source chunks via the existing `getEmbedder()` singleton; warm-path is already in v1.7
- `yaml@2.8.3` (eemeli) — `parseDocument()` + `doc.createNode()` for comment-preserving YAML append; the pattern already exists in `agent-provisioner.ts`
- Node 22 `fs.promises.cp` — workspace copy with `{ verbatimSymlinks: true, preserveTimestamps: true, filter }` (exclude `node_modules`, venv symlinks)

**Key version risk:** `@anthropic-ai/claude-agent-sdk` is pre-1.0. Pin exact version in `package.json`. Breaking changes between minor versions are expected.

### Expected Features

**Must have (P1 — v2.1.0 launch):**
- `clawcode migrate openclaw list` — enumerate all 15 source agents with key metadata; no writes
- `clawcode migrate openclaw plan [--agent X]` — full dry-run with per-agent diff table (config fields, file list, memory chunk counts, warnings)
- `clawcode migrate openclaw apply [--agent X] [--yes]` — explicit apply with confirmation prompt
- Pre-flight validation — fail fast with actionable error list before any write
- State file / journal at `~/.clawcode/migrate/state.json` — per-(agent, domain) status tracking
- Idempotent re-run — second apply skips succeeded units, retries failed ones
- Resume-from-failure — failed units retry; succeeded units skip
- Per-agent selection — migrate subsets; validate against source manifest
- Config mapping — `openclaw.json` agent entry to `clawcode.yaml` agent block; SOUL/IDENTITY stored as workspace files, never inlined
- Workspace file copy — SOUL.md, IDENTITY.md, USER.md, TOOLS.md, CLAUDE.md, archive/, .learnings/ (pure copy in v2.1.0)
- Shared-workspace support for finmentum (Pattern A: per-agent `basePath` override + per-agent `memoryPath`) — not deferrable, explicit user requirement
- Memory translation + re-embedding — read markdown source files (not sqlite), re-embed, insert into `memories.db` via `MemoryStore.insert()` public API
- Credential preservation — `op://` references copied verbatim; any raw secret-shaped value causes hard refusal
- Post-migration verification — per-agent smoke test (config parses, DB opens, daemon can load)
- Rollback — `clawcode migrate openclaw undo [--agent X]` unwinds target-side writes; shared-workspace rollback removes only `memoryPath` subdir, not the shared workspace dir
- Structured logs — pino JSONL to `~/.clawcode/migrate/logs/<ts>.jsonl` + human-readable stdout progress

**Should have (P2 — v2.1.x after validation):**
- Last-N session warm-link — import recent 3 sessions into ConversationStore so agents wake with continuity; rest archived as cold pointer
- `.learnings/` to MemoryEntry translation — makes learning notes searchable via `memory_lookup` on day one
- Plan-file mode (`--plan <path>` / `--apply <path>`) — Terraform-style TOCTOU safety
- Semantic memory dedup — cosine-similarity merge pass (cosine > 0.95); tune threshold on real corpora
- Identity-drift detection — embed SOUL.md pre/post, assert cosine ~1.0; cheap insurance

**Defer (v2.2+ or not at all):**
- Interactive TUI review — only if 15-agent terminal-diff review proves slow in practice
- Two-way sync OpenClaw to ClawCode — dual-master is a footgun; do not implement
- LLM-powered schema translation (use Opus to "improve" memories during migration) — violates PROJECT.md personality-evolution out-of-scope
- Full JSONL session replay into ConversationStore — format mismatch, provenance mismatches FTS5 schema; archive-only is the correct decision

### Architecture Approach

The migration lives in a new top-level `src/migration/` module structured as classic ETL: `openclaw/` adapters (Extract), `translate/` pure mappers with no I/O (Transform), and `writers/` for the three write targets — YAML config, workspace filesystem, and memories DB (Load). This isolation keeps migration code out of hot-path modules (`src/config/`, `src/memory/`) and makes the module deletable after v2.1 without grep-sweeping. The CLI entry point at `src/cli/commands/migrate.ts` is a thin wrapper that builds a `MigrationPlan` and hands off to `executor.ts`. The only existing modules that need modification are minimal: `config/schema.ts` (+1 optional field), `config/loader.ts` (~5 lines), `manager/session-memory.ts` (~3 lines), `cli/index.ts` (+1 line).

**Major components:**
1. `src/migration/openclaw/` — config reader, workspace scanner, sqlite reader (via ATTACH), binding resolver; pure readers against the source system
2. `src/migration/translate/` — agent-mapper, model-mapper, mcp-mapper, memory-mapper; pure functions with no I/O, trivially unit-testable with fixture data
3. `src/migration/writers/` — yaml-writer (parseDocument + add + write), workspace-writer (fs.cp with filter), memory-writer (MemoryStore.insert x N files with EmbeddingService); all I/O is here
4. `src/migration/plan/` — planner builds MigrationPlan (read-only), diff renders per-agent table for dry-run output
5. `src/migration/executor.ts` — orchestrates per-agent atomic cutover: memory first, workspace files second, YAML append last (config write is the commit point)
6. `src/migration/rollback.ts` — reads ledger, removes YAML entry, deletes per-agent paths (respects shared-workspace flag)

**Build order (per agent, sequential, not parallel):** Memory translation → workspace file copy → YAML append. Config write is always last because once an agent is in the YAML, a daemon restart will try to boot it. Parallel migration is an anti-pattern: YAML write contention + ONNX embedder not reentrant + opaque failure reporting.

**Critical architecture finding:** Hot-reload cannot activate new agents. `config/differ.ts` marks added agents as `reloadable: false`; `config/watcher.ts` logs a warning and does nothing. Migrated agents only boot after `systemctl restart clawcode`. Migrator must pre-flight with a daemon-running check and refuse `--apply` if daemon is up.

### Critical Pitfalls

1. **Embedding dimension mismatch silently corrupts `vec_memories`** — Never copy `chunks.embedding` from source. Always re-embed from `chunks.text`. After write, assert `SELECT vec_length(embedding) FROM vec_memories LIMIT 1 == 384`. Run 5 known-good semantic queries per migrated agent to verify parity before proceeding. Severity: CRITICAL.

2. **Re-running the migrator produces duplicate memories** — `memories` table has no UNIQUE on content, only on `id`. Add an `origin_id TEXT UNIQUE` column (value: `"openclaw:{agent}:{chunks.id}"`) and use `INSERT OR IGNORE` / `ON CONFLICT DO UPDATE`. This is a 1-line schema addition; retrofit is expensive. Design it in before the first row is written. Severity: HIGH.

3. **Plaintext secrets from `openclaw.json` re-introduced into `clawcode.yaml`** — OpenClaw stores the Discord bot token as a literal string. Migrator must whitelist-copy only opaque references (channel IDs, `op://` refs, MCP server names) and hard-refuse on any value matching secret patterns. Add a git pre-commit hook that secret-scans `clawcode.yaml`. Severity: CRITICAL.

4. **Shared-workspace write contention for finmentum (5 agents, 1 dir)** — Five agents with no per-agent namespace in the shared workspace will race on MEMORY.md, inbox/, .learnings/, and chokidar will fire 5x per change. Implement Pattern A (per-agent subdir inside shared workspace + `memoryPath` field) as a prerequisite phase before migrating any finmentum agent. Severity: HIGH.

5. **Discord coexistence — both bots respond to the same channel** — OpenClaw gateway is live. During staged migration, any channel bound in both systems produces duplicate replies. Cutover protocol: migrate memories+workspace, validate, remove OpenClaw binding, add ClawCode binding, observe 15 minutes. Migration CLI must enforce a hard precheck: refuse to apply if a channel ID appears in both `openclaw.json:bindings` and `clawcode.yaml:agents[*].channels`. Severity: HIGH.

---

## Implications for Roadmap

Both FEATURES.md and PITFALLS.md independently converged on the same recommendation: build two prerequisite phases before the migration CLI exists. The roadmapper should treat this as a hard dependency, not a suggestion.

### Phase 1: Fleet-Scale Fork Budgeting (Prerequisite)
**Rationale:** 15 newly-migrated agents all have fork-to-Opus capability. No global spending ceiling exists today. Budget explosion is non-recoverable (money spent). This must be live before any agent is migrated so the constraint is enforced from day one of multi-agent operation. Small code surface: budget gate in `manager/fork.ts` + global fleet ceiling in `usage/budget.ts` + kill-switch `defaults.forkEnabled` in config schema.
**Delivers:** Hard fork refusal with Discord notification when per-agent or fleet ceiling is exceeded; conservative default budget for newly-migrated agents ($1/day, revise after 2 weeks)
**Addresses:** Pitfall 13 (fork budget explosion across 15 agents)
**Research flag:** Standard pattern — skip research phase

### Phase 2: Shared-Workspace Runtime Support (Prerequisite)
**Rationale:** Finmentum family (5 agents, 1 shared workspace) cannot be migrated at all without this. The fix is ~15 lines across 3 files but must land and be tested before any finmentum agent touches the migration path.
**Delivers:** Optional `agent.memoryPath` in `agentSchema`; `resolveAgentConfig` threads it through; `session-memory.ts` uses it. Two agents pointing at the same workspace now get distinct memory DBs. Zero impact on the 10 non-shared agents.
**Key schema changes:** `config/schema.ts` +1 line, `config/loader.ts` ~5 lines, `manager/session-memory.ts` ~3 lines
**Addresses:** Pitfall 4 (shared-workspace write contention)
**Research flag:** Architecture clear from source inspection — skip research phase

### Phase 3: Migration CLI Skeleton — Read Side + Dry-Run
**Rationale:** Build the read path and dry-run renderer before writing anything. Produces a shipping slice (`clawcode migrate openclaw plan`) that gives full visibility into what will be migrated with zero risk. Also establishes the state file journal schema that every subsequent phase depends on.
**Delivers:** `clawcode migrate openclaw list` + `plan [--agent X]`; per-agent diff table; pre-flight validation; state file; no writes
**Implements:** `src/migration/openclaw/` + `src/migration/translate/` + `src/migration/plan/`
**Addresses:** Pitfall 9 (hot-reload mid-migration), Pitfall 15 (workspace structure variance — manifest displayed in plan)
**Research flag:** ETL read-path is standard — skip research phase

### Phase 4: Config Mapping + Secret Guard
**Rationale:** Config mapping is the decision-point for SOUL/IDENTITY inline vs. file-reference, MCP server name resolution, and secret handling. Must be built before the write side. Secret guard must be enforced here — after this phase, no secret can reach `clawcode.yaml` regardless of operator action.
**Delivers:** `agent-mapper.ts` + `mcp-mapper.ts` + `model-mapper.ts`; secret-pattern hard refusal; `yaml-writer.ts` using `parseDocument` (extracted from `agent-provisioner.ts`); SOUL/IDENTITY stored as workspace files with `soulFile:` reference, never inlined
**Addresses:** Pitfall 6 (plaintext secrets), Pitfall 14 (identity inline bloats config and breaks editing workflow)
**Research flag:** YAML comment-preserving pattern already exists in `agent-provisioner.ts` — reuse, not research

### Phase 5: Workspace Migration
**Rationale:** File copy is logically independent of memory translation and simpler to validate. Ship it first so the workspace side is verified before the more complex memory path begins.
**Delivers:** `workspace-writer.ts` using `fs.promises.cp` with explicit filter; absolute-path rewrite pass (`/home/jjagpal/.openclaw/workspace-<name>/` to new path); post-copy assertions: grep for old paths returns empty, broken symlinks = 0, `git fsck` passes
**Addresses:** Pitfall 7 (fs.cp on git-repo workspaces), Pitfall 15 (per-agent manifest drives file selection)
**Research flag:** Skip research phase — Node 22 `fs.cp` options verified

### Phase 6: Memory Translation + Re-embedding
**Rationale:** Memory translation is the highest-complexity phase and runs last among write phases so failures don't corrupt an already-committed config. Source of truth is workspace markdown (MEMORY.md, memory/*.md, .learnings/*.md) — not the sqlite chunks (which are a derived file-RAG index). The sqlite is consulted only to detect files deleted from disk.
**Delivers:** `memory-writer.ts` using `MemoryStore.insert()` public API (never raw SQL); `origin_id TEXT UNIQUE` column for idempotency; re-embed via `EmbeddingService` singleton (warm-path); per-agent post-write assertions: `vec_length()==384`, 5 known-good semantic queries
**Addresses:** Pitfall 1 (embedding dimension mismatch), Pitfall 2 (duplicate memories on re-run), Pitfall 12 (disk vs sqlite drift)
**Research flag:** Skip research phase — source schema verified, API path clear

### Phase 7: Executor, Rollback, and Session History Decision
**Rationale:** Wire the write-side phases into the per-agent atomic cutover protocol. Build rollback before any real migration runs — this is the "write the inverse before you run the migration" rule. Ratify the session history decision as archive-only to prevent a future contributor from attempting ConversationStore replay.
**Delivers:** `executor.ts` (sequential per-agent cutover, ledger append); `rollback.ts`; `clawcode migrate openclaw apply` works end-to-end; explicit "session history: archive-only" ADR documented; JSONL archives copied to `<workspace>/archive/openclaw-sessions/` as cold artifact
**Addresses:** Pitfall 3 (live-daemon copy — daemon-running precheck in apply), Pitfall 8 (JSONL replay), Pitfall 9 (atomic rename for YAML write), Pitfall 11 (partial failure with no rollback)
**Research flag:** Standard migration cutover protocol — skip research phase

### Phase 8: Pilot Migration (personal or local-clawdy)
**Rationale:** Run the real migration against the lowest-risk agent (smallest DB, lowest activity, not business-critical) before touching any production agent. Validates the full end-to-end path including stopping daemon, applying, restarting, verifying the agent responds in Discord with memory intact.
**Delivers:** First real agent live on ClawCode; full run of the "looks done but isn't" checklist; rollback tested end-to-end
**Research flag:** N/A — operational phase

### Phase 9: Finmentum Family Migration
**Rationale:** Shared-workspace logic gets its first production test. All 5 finmentum agents migrated using Pattern A (per-agent subdirs, distinct memory DBs). Run sequentially; validate each before the next.
**Delivers:** 5 finmentum agents live on ClawCode; shared workspace exercised under real concurrent load
**Addresses:** Pitfall 4 (shared-workspace write contention in production)
**Research flag:** N/A — operational phase

### Phase 10: Remaining Agents + Cutover Protocol
**Rationale:** Migrate the remaining 10 non-finmentum agents one at a time. Per-agent cutover: migrate, validate parity, remove OpenClaw binding, add ClawCode binding, observe 15 minutes, confirm no duplicate replies. Retire OpenClaw service once all agents are cut over.
**Delivers:** All 15 agents live on ClawCode; OpenClaw gateway stopped; `openclaw.json:bindings` empty; no shared channel IDs between both systems
**Addresses:** Pitfall 5 (Discord bot identity divergence), Pitfall 10 (coexistence double-replies)
**Research flag:** N/A — operational phase

### Phase Ordering Rationale

Three hard dependencies drive the sequence:

1. **Phase 1 and Phase 2 block everything else.** Fork budgeting must be live before any agent is migrated (financial risk). Shared-workspace support must exist before finmentum can be scoped in the migration plan at all. Both are small code changes but they are blockers.

2. **Config write is always the commit point.** All write phases (memory, workspace, config) must execute in that order. Reversing this order produces half-configured agents on the next daemon restart.

3. **Dry-run and rollback before any real apply.** The state file journal, idempotency, and rollback subcommand must be designed in Phase 3 (before any writes exist) because they are consumed by every subsequent phase. Retrofitting them is the path to "8 of 15 done + bug found = no way back."

### Open Questions for User / Roadmapper

These remain unresolved and need explicit decisions before or during planning:

1. **SOUL location — inline in `clawcode.yaml` or `soulFile:` workspace reference?** Research recommendation: workspace file with `soulFile:` reference. Current `test-agent` uses inline. This decision affects Phase 4 (config mapping) and whether Phase 2 needs a new schema field.

2. **Bot identity transition — keep OpenClaw bot avatar/name or move to Clawdbot?** Affects whether users see the same bot identity pre/post migration (continuity) or a visible transition (clarity). Drives webhook display name in `webhook-provisioner`. Decide before Phase 10.

3. **Session history fidelity — archive-only confirmed, or import last-N sessions?** Research recommends archive-only for v2.1.0 and session warm-link (last 3 sessions imported to ConversationStore) as a v2.1.x follow-up. User must confirm this tradeoff. Affects Phase 7 scope.

4. **Fork budget ceiling — what is the per-agent daily limit for newly-migrated agents?** Research recommends $1/day as a conservative default, revised upward after 2 weeks of observed behavior. User must ratify the number. Affects Phase 1 implementation.

### Research Flags

**Needs `/gsd:research-phase` during planning:**
- None identified. All phases have clear, verified implementation paths based on on-box source inspection.

**Standard patterns (skip research phase):**
- All 7 build phases (1-7) — architecture, APIs, and integration points are all verified against live code and real data

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All dependency decisions verified via live spike against real OpenClaw DB and ClawCode source. Zero new deps confirmed. |
| Features | HIGH | Table-stakes set drawn from Alembic/Terraform/dbt patterns plus explicit user requirements. Shared-workspace and memory re-embedding confirmed as non-deferrable. |
| Architecture | HIGH | All integration points verified via direct source inspection of schema.ts, session-memory.ts, differ.ts, agent-provisioner.ts, and real DB schemas. Module structure follows existing ClawCode conventions. |
| Pitfalls | HIGH | Every critical pitfall tied to a verified on-box fact (live daemon PID, real embedding dimensions from sqlite meta table, plaintext token in openclaw.json). Not inferred from docs. |

**Overall confidence: HIGH**

### Gaps to Address

- **Finmentum workspace internal layout:** Which markdown files inside `workspace-finmentum/` are per-agent memory vs. shared project files vs. financial data that should not be embedded. Requires a one-time inspection walk before coding Phase 9. Flag for workspace-migration phase planning.

- **Credential reference format across all 15 agents' MCP configs:** Confirmed `op://` for the top-level Discord token. Unknown whether all 15 agent MCP configs use `op://` consistently or mix env vars, plaintext, or other formats. Pre-flight validation in Phase 3 catches this at runtime; Phase 4 secret-guard enforces it.

- **OpenClaw session JSONL turn shape:** Exact fields, timestamp format, and turn boundary representation. Only relevant if session warm-link (P2 feature) is scoped into v2.1.x. Not a v2.1.0 blocker; archive-only decision sidesteps it.

- **`clawcode.yaml:agents[*].soulFile` field:** Does not exist yet. If the user decides on file-reference over inline for SOUL/IDENTITY, Phase 2 needs to add this field to `agentSchema`. Needs user decision before Phase 2 scope is finalized.

---

## Sources

### Primary (HIGH confidence — live on-box verification)
- Direct sqlite inspection — `~/.openclaw/memory/*.sqlite` schemas + `SELECT value FROM meta WHERE key='memory_index_meta_v1'` confirming gemini-embedding-001, 3072-dim, TEXT storage format for all populated agents
- Live spike — Node script ATTACHing `fin-acquisition.sqlite` via `better-sqlite3` + `sqlite-vec`, reading 597 chunks; confirms read path end-to-end
- ClawCode source — `src/config/schema.ts:640-686`, `src/config/loader.ts:143-176`, `src/config/differ.ts:78-84`, `src/config/watcher.ts:135-141`, `src/manager/agent-provisioner.ts:103-132`, `src/manager/session-memory.ts:51-124`, `src/agent/workspace.ts:39-99`, `src/memory/store.ts:53-100`
- Live system state — `systemctl --user list-units`, `ps auxf` confirming `openclaw-gateway.service` active, PID 755761, ~1.3GB RSS
- `openclaw.json:2067-2451` — 15 agents verified, finmentum shared-workspace pattern confirmed at lines 2313-2375, plaintext bot token confirmed

### Secondary (MEDIUM confidence — documentation + community sources)
- [Node 22 `fs.promises.cp` docs](https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisescpsrc-dest-options) — `verbatimSymlinks`, `preserveTimestamps`, `filter` options verified
- [sqlite-vec JS docs](https://alexgarcia.xyz/sqlite-vec/js.html) — ATTACH + extension loading pattern (upgraded to HIGH by live spike)
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — sync transactions, ATTACH, prepared statements
- [souls.zip — What Makes a Soul File Actually Work](https://souls.zip/notes/what-makes-a-soul-file-actually-work-patterns-from-engineering-30-agent-identiti) — 200-500 word sweet spot, markdown over JSON
- [Alembic Documentation](https://alembic.sqlalchemy.org/en/latest/autogenerate.html) — state tracking, version table, idempotency pattern
- [Advanced RAG Techniques (Neo4j)](https://neo4j.com/blog/genai/advanced-rag-techniques/) — re-embedding on model upgrades as standard practice
- npm registry — all version numbers verified via `npm view` on 2026-04-20

### Tertiary (MEDIUM confidence — prior-art analysis)
- Terraform, dbt, kubectl migration patterns — table-stakes feature set baseline
- Codex CLI JSONL archive pattern — "archive + resume pointer, not replay" recommendation
- AWS Migration Rollback Strategies — snapshot-before-apply, forward-only with inverse-first

---
*Research completed: 2026-04-20*
*Ready for roadmap: yes*
