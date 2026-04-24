# Architecture Research — v2.1 OpenClaw Agent Migration

**Domain:** Cross-system one-shot agent migration on a running daemon
**Researched:** 2026-04-20
**Confidence:** HIGH (integration points grounded in actual source; empirical answers to all 7 questions)

## TL;DR for the Roadmapper

1. Put everything under a **new top-level `src/migration/` module**. It's a one-shot ETL job, not a steady-state subsystem — don't pollute `src/config/`, `src/memory/`, `src/cli/` with permanent migration code.
2. **Shared workspace is SUPPORTED TODAY** via `agent.workspace: z.string().optional()`. 5 finmentum agents pointing at the same `workspace` path works as-is — but **memory DBs would collide**. The smallest-diff fix: add an optional `memoryPath` field to `agentSchema` so workspace-sharing agents can keep distinct memories at `<workspace>/memory/<agent-id>/memories.db`. One ~20-line schema change, one branch in `session-memory.ts`.
3. **Memory translation must re-embed** — OpenClaw uses 3072-dim gemini vectors, ClawCode uses 384-dim MiniLM. Translation is "read source markdown → `MemoryStore.insert()`", not "copy rows". Use the public `MemoryStore` + `EmbeddingService` API, never raw SQL.
4. **Config rewriting: use `yaml.parseDocument`** (comment-preserving). The pattern already exists in `src/manager/agent-provisioner.ts` lines 103–132. Do NOT round-trip through Zod.
5. **Hot-reload path is INSUFFICIENT for new agents** — `config/differ.ts` marks added agents as `reloadable: false` (warns only). Migration must either (a) take daemon down for agent activation, or (b) extend `ConfigReloader` to call `SessionManager.startAgent()` for net-new entries. Recommend (a) for v2.1 — simpler and the agents aren't running yet.
6. **Rollback: per-agent atomic cutover.** Each agent is independent. Dry-run → stage → commit, with the YAML config write being the last step (single point of cutover per agent). Failed agents leave no trace; succeeded ones stay.
7. **Build order: memory → config → activation.** Memory translation is reversible (new DB files, can be deleted). Config append is the commit. Daemon restart is the activation. This ordering means failures during memory translation don't corrupt the running system.

## Existing Architecture (what we're plugging into)

```
┌───────────────────────────────────────────────────────────────────────┐
│                    ClawCode Daemon (~/.clawcode/manager)              │
├───────────────────────────────────────────────────────────────────────┤
│  ConfigWatcher (chokidar, 500ms debounce)                             │
│       ↓ diff                                                          │
│  ConfigReloader → {routing, scheduler, heartbeat, skills, webhooks}   │
│       ↓ (reloadable-only, add/remove agent = NOT reloadable)          │
│  SessionManager → per-agent PersistentSessionHandle                   │
│                                                                       │
│  AgentMemoryManager                                                   │
│    ├── memoryStores   Map<agentName, MemoryStore>                     │
│    ├── sessionLoggers, compactionManagers, tierManagers               │
│    ├── episodeStores, documentStores, conversationStores              │
│    └── EmbeddingService (shared singleton — 384-dim MiniLM)           │
└───────────────────────────────────────────────────────────────────────┘
                            ↓ reads
┌─────────────────────────┬─────────────────────────────────────────────┐
│   clawcode.yaml         │   Per-agent workspace                       │
│   (single-file config)  │   ~/.clawcode/agents/<name>/                │
│                         │     ├── SOUL.md, IDENTITY.md                │
│   version: 1            │     ├── memory/memories.db (WAL)            │
│   defaults: {...}       │     ├── memory/usage.db                     │
│   mcpServers: {...}     │     ├── skills/                             │
│   agents: [ {...} ]     │     └── traces.db                           │
└─────────────────────────┴─────────────────────────────────────────────┘
```

### What ClawCode Expects

| Field | Shape |
|---|---|
| `agents[].name` | unique string |
| `agents[].workspace` | optional absolute path; defaults to `join(defaults.basePath, name)` |
| `agents[].channels` | `string[]` of Discord channel IDs |
| `agents[].mcpServers` | `(string \| object)[]` — string refs to `mcpServers` map, or inline objects |
| `agents[].soul`, `agents[].identity` | inline block literal OR `~/path/to/file.md` |
| `agents[].subagentModel` | optional; if absent, escalation falls back to `defaults.model === "opus"` check |

### What OpenClaw Provides

| OpenClaw Concept | Location | ClawCode Equivalent |
|---|---|---|
| Agent entry | `openclaw.json: agents.list[]` | `clawcode.yaml: agents[]` |
| Workspace | `/home/jjagpal/.openclaw/workspace-<slug>/` | `<basePath>/<name>/` or explicit `workspace:` |
| Memory SQLite | `~/.openclaw/memory/<id>.sqlite` (files+chunks+chunks_vec, **3072-dim gemini**) | `<workspace>/memory/memories.db` (memories+vec_memories, **384-dim MiniLM**) |
| Identity files | workspace `IDENTITY.md`, `SOUL.md`, `USER.md`, `TOOLS.md`, `CLAUDE.md` | inline `soul:`/`identity:` in YAML OR workspace file; `createWorkspace()` preserves existing files when inline values are undefined |
| Discord channel binding | top-level `bindings[].peer.id` keyed by `agentId` | `agents[].channels[]` |
| MCP servers | global config | per-agent `agents[].mcpServers: string[]` refs into global `mcpServers:` map |
| Subagent model | `subagents.model` | `agents[].subagentModel` |

## Recommended Project Structure

```
src/
├── migration/                       # NEW — entire module is new
│   ├── openclaw/                    # Source-system adapters
│   │   ├── config-reader.ts         # Parse openclaw.json → normalized shape
│   │   ├── workspace-scanner.ts     # Enumerate workspace files (MEMORY.md, memory/*.md, .learnings/, etc.)
│   │   ├── sqlite-reader.ts         # Read ~/.openclaw/memory/<id>.sqlite (files + chunks tables)
│   │   ├── binding-resolver.ts      # Cross-ref agentId → channelId via bindings[]
│   │   └── types.ts                 # OpenClawAgent, OpenClawBinding, SourceMemoryFile
│   ├── translate/                   # Pure functions — no I/O
│   │   ├── agent-mapper.ts          # OpenClawAgent → ClawCode agent YAML entry
│   │   ├── model-mapper.ts          # "anthropic-api/claude-sonnet-4-6" → "sonnet"
│   │   ├── mcp-mapper.ts            # Decide which global mcpServers the agent needs
│   │   └── memory-mapper.ts         # Source file → CreateMemoryInput[] (chunk, tag, importance)
│   ├── writers/                     # I/O boundary
│   │   ├── yaml-writer.ts           # parseDocument(clawcode.yaml) + add agent + write
│   │   ├── workspace-writer.ts      # Copy/link files into ClawCode workspace (shared-aware)
│   │   └── memory-writer.ts         # Call MemoryStore.insert() with fresh embeddings
│   ├── plan/                        # Staging
│   │   ├── planner.ts               # Build MigrationPlan (read-only — drives dry-run)
│   │   ├── diff.ts                  # Per-agent diff renderer for CLI output
│   │   └── types.ts                 # MigrationPlan, AgentMigrationStep, MigrationResult
│   ├── executor.ts                  # Sequence plan.steps, per-agent atomic cutover
│   ├── rollback.ts                  # Undo a committed per-agent migration
│   └── index.ts                     # Barrel export
│
├── cli/commands/
│   └── migrate.ts                   # NEW — `clawcode migrate openclaw [--dry-run] [--agent <name>]`
│                                    #       thin wrapper that builds plan + invokes executor
│
└── [TOUCHED FILES — minimal changes]
    ├── config/schema.ts             # +1 field: agent.memoryPath: z.string().optional()
    ├── shared/types.ts              # +1 field: ResolvedAgentConfig.memoryPath
    ├── config/loader.ts             # ~5 lines: thread memoryPath through resolveAgentConfig
    ├── manager/session-memory.ts    # ~3 lines: use config.memoryPath ?? join(workspace, "memory")
    ├── cli/index.ts                 # +1 line: registerMigrateCommand(program)
    └── agent/workspace.ts           # UNCHANGED — existing idempotency logic handles shared case
```

### Rationale

- **`src/migration/` is a new top-level module** because migration is an ETL job with a shelf life. After v2.1 ships the admin will run it once or twice, then the code is dead weight for the daemon process. Isolating it means we can delete it cleanly later without grep-sweeping `src/config/` and `src/memory/`.
- **`migration/openclaw/`, `migration/translate/`, `migration/writers/` split** is the classic Extract / Transform / Load separation. `translate/` has zero I/O, which makes testing the model/mcp/memory mappers trivially pure.
- **`cli/commands/migrate.ts` stays tiny** — it parses flags, builds a `MigrationPlan` via the planner, then hands off to the executor. Follows the shape of `agent-create.ts` (which provisions a single agent via a pure function).
- **Touched files add ONE new field (`memoryPath`)**. Nothing else in the existing code needs to change. Workspace idempotency (created in v1.0 via `createWorkspace()`) already handles the shared-workspace case — if two agents point at the same workspace, the second one skips file writes if they already exist.

## Answers to the Seven Questions

### Q1. Migration logic — new module or extend existing?

**New module at `src/migration/`.** Three reasons:

1. **Lifecycle mismatch.** `src/config/` and `src/memory/` are hot-path modules loaded into every agent's runtime. Migration runs once from the CLI. Coupling them means extra bundle size forever.
2. **Dependency direction.** Migration imports FROM `src/config/loader.ts`, `src/memory/store.ts`, `src/agent/workspace.ts` — not the other way around. A new top-level module keeps the dependency graph acyclic.
3. **Testability.** Migration's E2E test needs a fixture openclaw.json + fixture sqlite + fixture workspace. Putting those fixtures under `src/migration/__tests__/` keeps them scoped.

**Exception:** `cli/commands/migrate.ts` lives alongside its siblings. That's the established pattern (see `agent-create.ts`, `fork.ts`, etc.). It's the thinnest possible wrapper.

### Q2. Shared-workspace support (the finmentum-5 pattern)

**Shared workspace is SUPPORTED TODAY with one caveat.** `agentSchema.workspace` is `z.string().optional()` (schema.ts:642). `resolveAgentConfig()` (loader.ts:153) uses the explicit path if present, falling back to `join(basePath, name)`. Five agents pointing at `/home/jjagpal/.openclaw/workspace-finmentum` just works — `createWorkspace()` is idempotent and preserves existing files.

**BUT** — `AgentMemoryManager.initMemory()` (session-memory.ts:58) unconditionally opens `<workspace>/memory/memories.db`. Five agents on the same workspace = five processes opening the same DB file. WAL mode handles multi-writer safely on disk, BUT ClawCode's memory model is per-agent — shared memory DBs would cross-pollinate hot tier, auto-linker neighbors, and ConversationStore sessions between distinct identities. That violates the per-agent isolation invariant.

**Smallest-diff fix:**

```ts
// config/schema.ts — add to agentSchema
memoryPath: z.string().optional(),   // NEW — absolute path or tilde-prefixed
```

```ts
// config/loader.ts — thread into ResolvedAgentConfig
memoryPath: agent.memoryPath
  ? expandHome(agent.memoryPath)
  : join(agent.workspace ?? join(defaults.basePath, agent.name), "memory"),
```

```ts
// manager/session-memory.ts — line 53 becomes:
const memoryDir = config.memoryPath;  // already resolved
```

Migration then writes for each finmentum agent:

```yaml
- name: fin-acquisition
  workspace: ~/.clawcode/agents/finmentum-shared    # SHARED
  memoryPath: ~/.clawcode/agents/finmentum-shared/memory/fin-acquisition  # PER-AGENT
```

This is ~15 lines total across 3 files. The non-finmentum 10 agents omit `memoryPath` and get the legacy default. Backward compatible.

**Answer the sub-question directly:** Yes, workspace-sharing is supported today. No, memory is not isolated today in the shared case. The fix is additive (one optional field), zero-impact for the 10 non-shared agents.

### Q3. Memory translation — where and how?

**Location:** `src/migration/writers/memory-writer.ts`.

**API:** Reuse `MemoryStore.insert(input, embedding)`. NEVER write raw SQL.

**Why the public API, not raw SQL:**

- `MemoryStore.insert()` does five things beyond the INSERT: dedup check (`checkForDuplicate`), wikilink extraction (`extractWikilinks`), importance scoring (`calculateImportance`), auto-linking (`autoLinkMemory` KNN neighbors), and the vec_memories write. Bypassing means losing all of those.
- OpenClaw embeddings are 3072-dim gemini vectors; ClawCode's `vec_memories` virtual table is locked to 384-dim float32 at schema creation time. **Raw-SQL copy would fail the INSERT with a dimension mismatch.** Re-embedding is not optional.
- The auto-linker heartbeat would eventually fix up missing neighbor edges, but that's ~6h of weak memories with no graph structure. Doing it through `insert()` gets the graph hot on day one.

**Translation shape:**

```
OpenClaw source                 →  ClawCode target
─────────────────────────────────────────────────────────────────────
<workspace>/MEMORY.md            →  one MemoryEntry per H2 section (splitMarkdownSections)
                                    source: "manual", importance: 0.7,
                                    tags: ["migrated", "from-openclaw", agentId]

<workspace>/memory/*.md          →  one MemoryEntry per file, source: "consolidation"
                                    (these are the daily/weekly digest logs)
                                    importance: decays with file mtime age

<workspace>/.learnings/*.md      →  source: "manual", importance: 0.85
                                    (learnings are hard-won, high value)

~/.openclaw/memory/*.sqlite      →  SKIP. It's a derived file-RAG index over the
                                    markdown above. Re-chunking the markdown through
                                    ClawCode's DocumentStore is equivalent and cleaner.

Optional phase-2:
<workspace>/MEMORY.md chunks     →  DocumentStore.ingest() for RAG search (separate
                                    from memory — uses the existing documents
                                    subsystem, not memories.db)
```

The writer is a ~100-line function: `for each source file → parse → map to CreateMemoryInput → embedder.embed(content) → store.insert(input, embedding)`.

### Q4. Config rewriting — parse-tree or Zod round-trip?

**Use `yaml.parseDocument`** (comment-preserving parse tree). Zod round-trip is a non-starter because `loadConfig()` returns plain JS objects — comments, block-literal markers, and key ordering are lost by the time the Zod result hands back to you.

**Proof this works:** `src/manager/agent-provisioner.ts` already implements this exact pattern (lines 103–132) for the `clawcode create-agent` flow. The migration writer follows the same recipe:

```ts
const doc = parseDocument(await readFile(configPath, "utf-8"));
const agents = doc.get("agents");
// Guard: existing name, malformed sequence
agents.add(doc.createNode({
  name, workspace, channels, model,
  mcpServers: [...],
  soul: doc.createNode(soulText, { type: "BLOCK_LITERAL" }),
  identity: doc.createNode(identityText, { type: "BLOCK_LITERAL" }),
}));
await writeFile(configPath, String(doc), "utf-8");
```

**Validation after write:** Immediately call `loadConfig()` on the just-written file. Zod parse failure = rollback the write.

**Pattern reuse:** Extract the `parseDocument`-based append logic out of `agent-provisioner.ts` into `src/migration/writers/yaml-writer.ts` so both code paths share it. That's a refactor, not a rewrite — the function is already pure enough to hoist.

### Q5. Hot-reload implications

**Adding 15 agents under hot-reload does NOT boot them.** Evidence: `src/config/differ.ts:78-84` marks added agents as `reloadable: false`:

```ts
// Check for added agents
for (const [name, newAgent] of newMap) {
  if (!oldMap.has(name)) {
    changes.push({
      fieldPath: `agents.${name}`,
      oldValue: undefined,
      newValue: newAgent,
      reloadable: false,      // ← not live
    });
  }
}
```

And `config/watcher.ts:135-141` just logs a warning:

```ts
for (const change of diff.changes) {
  if (!change.reloadable) {
    this.log.warn(..., "requires daemon restart to take effect");
  }
}
```

So if migration writes to clawcode.yaml while the daemon is running, chokidar fires, the diff recognizes 15 added agents, the watcher records the audit trail entry, and does NOTHING else. The 15 new agents sit inactive until `systemctl restart clawcode` (or equivalent).

**Recommendation: "Stop daemon, migrate, start daemon."** Reasons:

1. The agents aren't running yet — there's nothing live to preserve. A restart is free.
2. It makes the operation atomic from the admin's perspective: service down → 3 minutes of data work → service up with 15 new agents visible.
3. Alternative (teach `ConfigReloader` to call `sessionManager.startAgent(newConfig)` for net-new entries) is ~50 lines but exposes the live system to half-migrated state if a single agent fails mid-batch.
4. The existing `start-all.ts` command already boots agents that aren't running, so post-restart the daemon picks everything up via its normal startup path.

**Sub-concern:** chokidar will still fire during the migration if the daemon is running. Solution: the migrator pre-flights with `isDaemonRunning()` (check pid file or IPC ping) and refuses to proceed if the daemon is up. Message: `"clawcode daemon is running. Run 'clawcode stop' first, then re-run the migration."`

### Q6. Rollback architecture

**Per-agent atomic cutover, NOT all-or-nothing transaction.** Rationale:

- Agents are independent — finmentum-content-creator's migration failure should not abort general/work/projects/research.
- SQLite has no cross-file transactions. A single "all 15 agents or none" transaction across 15 distinct DB files + 1 YAML + 15 workspace dirs is impossible without a filesystem snapshot (overkill).
- The admin will likely want to run with `--agent <name>` for individual cutovers during first validation, then batch the rest.

**Per-agent cutover protocol:**

```
For each agent in order:
  1. STAGE (reversible)
     a. Create <basePath>/<name>/ workspace (mkdir -p)
     b. Copy SOUL.md/IDENTITY.md/USER.md/etc. from source workspace
        (skip if shared-workspace and target already has files — idempotent)
     c. Open new memories.db at <memoryPath>/memories.db
     d. For each source markdown file → embed → MemoryStore.insert()
     e. If ANY step a-d fails: rm -rf <basePath>/<name>/ AND <memoryPath>/. Continue to next agent.

  2. COMMIT (single point of cutover)
     a. parseDocument(clawcode.yaml)
     b. doc.get("agents").add(newAgentNode)
     c. await writeFile(clawcode.yaml, String(doc))
     d. loadConfig(clawcode.yaml) — validate write
     e. If validation fails: restore YAML from in-memory backup. Treat stage dirs as stranded — log for manual cleanup.

  3. RECORD
     a. Append migration record to .planning/migration/ledger.jsonl:
        { agentId, status: "migrated", ts, workspace, memoryPath, memoriesMigrated: N }
```

**Rollback command:** `clawcode migrate openclaw --rollback <agent>`:
1. Parse ledger → find the record for `<agent>`
2. `parseDocument` config → remove the agent entry → write back
3. `rm -rf` the workspace (only if not shared) and memory directory
4. Append `{status: "rolled-back"}` to ledger

**Shared-workspace interaction:** For the 5 finmentum agents, the rollback of one agent must NOT delete the shared workspace. The ledger records `sharedWorkspace: true` so rollback skips the `rm -rf` on the workspace — only the per-agent `memoryPath` subdirectory gets removed.

### Q7. Build order: config-first, memory-first, or parallel?

**Memory → workspace files → config (per agent), agents in sequence, not parallel.**

Full ordering, with rationale:

1. **Migration plan (read-only)** — parse openclaw.json, enumerate 15 agents, check source workspaces exist, dry-run output. This is always safe.
2. **Per-agent staging (memory first, then workspace):**
    a. **Memory translation** first. If embedding/insertion fails (OOM on a 10MB `MEMORY.md`, sqlite-vec dimension error, etc.), the failure is isolated to `<memoryPath>/memories.db` — delete and retry. No config has been touched.
    b. **Workspace file copy** second. This is cheap and nearly infallible (just fs operations). Doing it after memory means if memory fails we skip the file copy entirely.
3. **Per-agent commit (config last):**
    c. **YAML append** last. Once the YAML is written the agent is "real" — a daemon restart will try to boot it. So we only write when stages (a) and (b) succeeded.
4. **Agents in sequence, not parallel.** Parallel agent migration saves wall-clock time (15 agents × ~20s each = 5 min sequential vs ~1 min parallel) but introduces:
    - YAML write contention (15 processes racing on `clawcode.yaml`).
    - Embedder singleton contention (the shared MiniLM ONNX runtime is not thread-safe across concurrent embeds — serializing is safer).
    - Unclear failure reporting (which agent failed?).
    Sequential is fine for a one-shot 3–5 min operation.
5. **Daemon restart** — after all agents migrated (or after partial migration with `--agent <name>`). Not automated by the migration tool; the admin decides when.

**Why NOT config-first (the alternative):**

Config-first ("write all 15 agent entries to YAML, then fill their workspaces") would mean: if the daemon is accidentally running, chokidar fires, diff records 15 non-reloadable additions, and on next restart the daemon tries to boot 15 agents with empty workspaces and no memory DBs. `AgentMemoryManager.initMemory()` would create empty `memories.db` files. First user message to each agent would land with zero context and zero identity. The YAML is the commit point and should happen last.

**Why NOT parallel:**

Covered above. Short version: embedder contention + YAML race + opaque failures.

## Key Data Flows

### Migration Flow (new)

```
CLI invocation
    ↓
MigrationPlanner.build()
    → openclaw/config-reader.ts parses openclaw.json
    → openclaw/binding-resolver.ts joins agents×bindings
    → openclaw/workspace-scanner.ts enumerates source files
    → translate/agent-mapper.ts produces target agent YAML shape
    ↓
MigrationPlan (read-only: per-agent steps + totals)
    ↓
[dry-run]    → render as table, exit 0
[apply]      → MigrationExecutor.run(plan)
                 ├── For each agent (sequential):
                 │    ├── writers/memory-writer.ts  (MemoryStore.insert × N files)
                 │    ├── writers/workspace-writer.ts  (fs copy)
                 │    └── writers/yaml-writer.ts  (parseDocument + add + write)
                 └── Ledger append after each success
```

### Runtime Data Flow (unchanged by migration — we feed into existing pipeline)

```
Discord msg → Plugin → SessionManager.handle(turnOrigin)
                             ↓
                       PersistentSessionHandle (per agent)
                             ↓
                       Claude Code subprocess (cwd = workspace)
                             ↓ loads
                       SOUL.md + IDENTITY.md + MemoryStore (via MCP memory_lookup)
                             ↓
                       Response → webhook → Discord channel
```

## Anti-Patterns (things NOT to do)

### Anti-Pattern 1: Raw SQL into memories.db

**What people do:** `ATTACH DATABASE` the OpenClaw sqlite and INSERT rows across.
**Why wrong:** Embeddings incompatible (3072 vs 384 dims) — the `vec_memories` virtual table rejects the INSERT. Plus auto-linking, importance scoring, and wikilink graph extraction all skipped.
**Do instead:** Use `MemoryStore.insert(input, embedding)`. Re-embed via `EmbeddingService`. Takes ~50ms per memory, ~3 min for 15 agents' worth.

### Anti-Pattern 2: Zod-round-trip YAML rewrite

**What people do:** `const cfg = await loadConfig(path); cfg.agents.push(newAgent); await writeFile(path, stringify(cfg))`.
**Why wrong:** Destroys all comments in clawcode.yaml. The existing file has op:// references, Phase XX annotations, and documentation comments that are load-bearing for future humans reading the file.
**Do instead:** `parseDocument` + `doc.get("agents").add(doc.createNode(...))` + `String(doc)`. The pattern exists in `agent-provisioner.ts`.

### Anti-Pattern 3: Running migration against a live daemon

**What people do:** `clawcode migrate openclaw` while daemon is running, expecting hot-reload to pick up.
**Why wrong:** Added agents are `reloadable: false`. The daemon logs warnings, keeps running, but the new agents are inert. User thinks migration succeeded because nothing errored, but the agents don't respond to Discord.
**Do instead:** Migrator pre-flights with a "daemon running?" check and refuses. Explicit stop → migrate → start.

### Anti-Pattern 4: Parallel agent migration

**What people do:** `Promise.all(agents.map(migrateAgent))` to save wall-clock time.
**Why wrong:** YAML file race (15 processes writing clawcode.yaml), shared `EmbeddingService` singleton (ONNX runtime not reentrant), and opaque failure reporting.
**Do instead:** Sequential `for...of`. Total runtime is ~3–5 min — not a UX problem for a one-shot migration.

### Anti-Pattern 5: Migrating sqlite as source of truth

**What people do:** Read `~/.openclaw/memory/<id>.sqlite` as the primary migration source; treat workspace markdown as secondary.
**Why wrong:** The sqlite is a file-RAG derived index over the markdown. Its rows are chunks, not memories. Pulling chunks into `memories.db` produces fragmented, undersized memories with mid-sentence boundaries.
**Do instead:** Migrate the workspace markdown (MEMORY.md, memory/*.md, .learnings/*.md) as primary. Ignore the sqlite entirely — it'll be reconstructed by the auto-linker heartbeat + DocumentStore post-migration.

## Scaling Considerations

One-shot migration, 15 agents, ~30MB of markdown total. Scaling is not a concern.

| Scale | Adjustment |
|---|---|
| 15 agents (this milestone) | Sequential, 3–5 min, zero ops |
| 100 agents (hypothetical) | Still sequential; ~30 min wall clock. Fine for a one-shot. |
| 1000+ agents | Would need batching + checkpointed ledger to resume after partial failures. Not in scope. |

## Integration Points

### Modules Read (unchanged)

| Module | Used For |
|---|---|
| `src/config/loader.ts: loadConfig` | Post-write validation — confirms the YAML still parses after append |
| `src/config/schema.ts: agentSchema` | Source of truth for what fields a target agent needs |
| `src/memory/store.ts: MemoryStore` | Per-agent DB open + insert |
| `src/memory/embedder.ts: EmbeddingService` | Fresh 384-dim embeddings |
| `src/agent/workspace.ts: createWorkspace` | Idempotent workspace scaffolding (handles shared case) |
| `src/shared/errors.ts` | Typed errors for CLI output |

### Modules Modified (minimal)

| Module | Change | Size |
|---|---|---|
| `src/config/schema.ts` | Add `memoryPath: z.string().optional()` to `agentSchema` | +1 line |
| `src/shared/types.ts` | Add `memoryPath: string` to `ResolvedAgentConfig` | +1 line |
| `src/config/loader.ts` | Resolve `memoryPath` default in `resolveAgentConfig` | ~5 lines |
| `src/manager/session-memory.ts` | Use `config.memoryPath` instead of `join(workspace, "memory")` | ~3 lines |
| `src/cli/index.ts` | `registerMigrateCommand(program)` | +1 line |
| `src/manager/agent-provisioner.ts` | Refactor `appendAgentToConfig` out to `src/migration/writers/yaml-writer.ts` (shared helper) | ~30 lines moved |

### Modules Created (new)

| Module | Purpose |
|---|---|
| `src/migration/openclaw/*` | Read + parse OpenClaw artifacts |
| `src/migration/translate/*` | Pure mappers — no I/O |
| `src/migration/writers/*` | I/O boundary for YAML, FS, memory DB |
| `src/migration/plan/*` | MigrationPlan shape + dry-run diff |
| `src/migration/executor.ts` | Orchestrate per-agent steps |
| `src/migration/rollback.ts` | Undo a migration |
| `src/migration/index.ts` | Barrel export |
| `src/cli/commands/migrate.ts` | CLI wrapper |
| `src/migration/__tests__/*` | Fixture-driven E2E tests |

## Suggested Phase Boundaries for the Roadmapper

These are arch-informed suggestions. Roadmapper owns the final call.

**Phase A — Foundations (no migration logic yet, zero user-visible change)**
- Add `agent.memoryPath` schema field + loader resolution + session-memory rewire
- Refactor `appendAgentToConfig` into shared `src/migration/writers/yaml-writer.ts`
- Tests: verify 2 agents pointing at the same workspace get distinct memory DBs

**Phase B — Read side (OpenClaw adapters)**
- `src/migration/openclaw/{config-reader, workspace-scanner, sqlite-reader, binding-resolver}.ts`
- `src/migration/translate/*` pure mappers
- Tests with fixture openclaw.json + fixture workspace

**Phase C — Dry-run planner**
- `src/migration/plan/{planner, diff}.ts`
- `cli/commands/migrate.ts --dry-run` renders per-agent plan
- No writes yet — this alone is a useful shipping slice (admin can see what WOULD migrate)

**Phase D — Write side (memory + workspace)**
- `src/migration/writers/{memory-writer, workspace-writer}.ts`
- Per-agent staging that is fully reversible (can be deleted)
- Tests: actually migrate a fixture agent, verify memories.db populated

**Phase E — Commit side (YAML writer + executor + ledger)**
- `src/migration/writers/yaml-writer.ts`
- `src/migration/executor.ts` — per-agent atomic cutover
- `.planning/migration/ledger.jsonl` append
- `cli/commands/migrate.ts --apply` works end-to-end

**Phase F — Rollback + operational polish**
- `src/migration/rollback.ts`
- Pre-flight daemon-running check
- CLI output: progress, ledger view, `--rollback <agent>` subcommand

**Phase G — Production run**
- Stop daemon
- `clawcode migrate openclaw --apply`
- Start daemon, verify all 15 agents boot, respond in Discord, have memory

## Sources

Direct source inspection (confidence: HIGH, verified at 2026-04-20):
- `/home/jjagpal/.openclaw/workspace-coding/src/config/schema.ts:640-686` — `agentSchema` has `workspace` optional; no `memoryPath` field today
- `/home/jjagpal/.openclaw/workspace-coding/src/config/loader.ts:143-176` — `resolveAgentConfig` workspace fallback logic
- `/home/jjagpal/.openclaw/workspace-coding/src/config/differ.ts:78-84` — added agents marked `reloadable: false`
- `/home/jjagpal/.openclaw/workspace-coding/src/config/watcher.ts:135-141` — non-reloadable changes log warning only
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/agent-provisioner.ts:103-132` — existing `parseDocument`-based YAML append (reference pattern)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-memory.ts:51-124` — `AgentMemoryManager.initMemory` hardcodes `<workspace>/memory`
- `/home/jjagpal/.openclaw/workspace-coding/src/agent/workspace.ts:39-99` — `createWorkspace` idempotent; preserves existing SOUL.md/IDENTITY.md
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/store.ts:53-100` — `MemoryStore` constructor + `insert` method
- `/home/jjagpal/.openclaw/openclaw.json:2067-2451` — `agents.list[]` shape (15 agents verified, finmentum shared-workspace pattern confirmed at lines 2313-2375)
- `sqlite3 ~/.openclaw/memory/finmentum-content-creator.sqlite` — schema: `files`, `chunks (embedding TEXT, model TEXT)`, `chunks_fts`, `chunks_vec vec0(embedding FLOAT[3072])`. 31 files, 224 chunks, `gemini-embedding-001` model confirmed.

---
*Architecture research for: OpenClaw → ClawCode one-shot agent migration*
*Researched: 2026-04-20*
