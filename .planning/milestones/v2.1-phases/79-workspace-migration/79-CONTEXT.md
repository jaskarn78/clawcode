# Phase 79: Workspace Migration - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `workspace-copier.ts` + wire it into the apply pipeline so that each migrated agent's source workspace at `~/.openclaw/workspace-<name>/` is copied verbatim to the ClawCode target (`<basePath>/` or shared `<basePath>/` for finmentum family). Preserve `.git/`, skip venv self-symlinks, hash-witness every file, rollback per-agent on mismatch. Archive OpenClaw sessions under `<target>/archive/openclaw-sessions/` for read-only reference (never replayed into ConversationStore).

Delivers WORK-01 (markdown + memory/ + .learnings/ + archive/), WORK-02 (shared basePath with per-agent file/dir overrides — already enabled by Phase 75), WORK-03 (.git verbatim preservation), WORK-04 (archive copy without ConversationStore replay), WORK-05 (byte-exact non-text blobs + mtime preservation).

</domain>

<decisions>
## Implementation Decisions

### Copy Mechanism & Filter Rules
- **Library:** Node 22 `fs.promises.cp` with `{recursive: true, verbatimSymlinks: true, preserveTimestamps: true, filter}`. Zero new deps; verified in `.planning/research/STACK.md`. `verbatimSymlinks: true` is critical — prevents infinite recursion on venv `lib64 → lib` self-symlinks.
- **Filter predicate skips:** `node_modules/`, `.venv/`, `venv/`, `env/`, `__pycache__/`, `*.pyc`, `*.pyo`, `.DS_Store`, and self-referential symlinks (detected via `lstat` + `realpath` where `realpath(link)` is an ancestor of `link`).
- **Filter predicate keeps:** `.git/` (WORK-03), all markdown, `memory/`, `.learnings/`, `archive/`, image/PDF/binary blobs.
- **Hash witness:** Post-copy sweep computes sha256 of every regular file in target. Compare to source sha256. For each file, append ledger row `{step: "workspace-copy:hash-witness", outcome: "allow" | "refuse", file_hashes: {src: <sha>, dst: <sha>}}`. On any mismatch → refuse, rollback that agent.
- **Rollback granularity:** Per-agent. If hash-witness fails for agent X, `fs.rm(targetWorkspace, {recursive: true, force: true})` for X only. Ledger row `status: "rolled-back"`. Other agents in the run proceed untouched.
- **Sequential copy:** Agents processed sequentially (NOT parallel). Matches STATE.md decision ("YAML write contention + embedder singleton non-reentrancy"). Phase 80 re-embedder will be non-reentrant too.

### Finmentum Source Layout (Non-Uniform)
On-box inspection 2026-04-20:
- `~/.openclaw/workspace-finmentum/` — has SOUL.md + IDENTITY.md + full markdown set + memory/ + .learnings/ + archive/ — primary `finmentum` agent source
- `~/.openclaw/workspace-finmentum-content-creator/` — has its own SOUL.md + IDENTITY.md — dedicated agent with its own content
- `~/.openclaw/workspace-fin-acquisition/`, `-fin-research/`, `-fin-playground/`, `-fin-tax/` — only contain `uploads/` dir; these sub-agents share `workspace-finmentum` for SOUL/IDENTITY in OpenClaw's runtime

**Migration strategy for finmentum family (5 agents):**
- Primary copy: `~/.openclaw/workspace-finmentum/` → `<shared-basePath>/` (full tree incl. SOUL/IDENTITY/memory/.learnings/archive)
- For `finmentum-content-creator` (dedicated source): copy its own workspace to `<shared-basePath>/soul/finmentum-content-creator.md` + `<shared-basePath>/identity/finmentum-content-creator.md` (per-agent soulFile/identityFile target paths from Phase 78 config-mapper)
- For sub-agents without own workspace content (fin-acquisition/-research/-playground/-tax): copy their `uploads/` only to `<shared-basePath>/uploads/<agent>/`. For soulFile/identityFile: point to the primary's (shared) SOUL.md/IDENTITY.md — they inherit from the finmentum parent. Config-mapper's output for these agents sets `soulFile: <shared>/SOUL.md` (same path for all, which is intentional because they share persona).
- Each of the 5 gets its own distinct `memoryPath` per Phase 75 (memoryPath is already per-agent-unique by design).

### Session Archive & ConversationStore Isolation
- **Archive target:** `<target-workspace>/archive/openclaw-sessions/`. Source: `~/.openclaw/agents/<name>/sessions/` (OpenClaw per-agent session directory). Copied full tree, verbatim.
- **ConversationStore replay prevention:** Migrator NEVER calls ConversationStore write APIs during workspace copy. Assertion: after full run, `SELECT COUNT(*) FROM turns WHERE provenance LIKE '%openclaw%'` in the per-agent DB returns 0. This is passive (migrator just doesn't touch that API); no filter needed in ConversationStore code.
- Test: integration test opens the target DB post-apply and runs the SELECT to assert 0 rows.

### Claude's Discretion
- Exact helper signatures in `workspace-copier.ts` — follow Phase 76/78 module conventions
- Test structure — Phase 76/77/78 patterns (unit + integration)
- Error message copy — keep actionable, consistent style
- Whether to chunk hash witness by file size or always sha256 full file — always full file (Node crypto is fast enough; total ~2,617 chunks + markdown + blobs = a few hundred MB at most)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/migration/openclaw-config-reader.ts` — OpenclawSourceInventory has `agentDir`; extend to include `sourceWorkspace` path (derived: `~/.openclaw/workspace-<name>/`)
- `src/migration/config-mapper.ts` — Phase 78 produces MappedAgentNode with `soulFile`/`identityFile` target paths. Wave 2 of 79 consumes these as copy destinations.
- `src/migration/ledger.ts` — extended schema with `step`, `outcome`, `file_hashes` (Phase 77)
- `src/migration/guards.ts` — `assertReadOnlySource()` already prevents write to `~/.openclaw/`
- `src/migration/fs-guard.ts` — runtime interceptor; hash-witness READS from `~/.openclaw/` are fine, WRITES would throw
- Node 22 `fs.promises.cp` + `fs.rm` + `fs.readdir` built-ins

### Established Patterns
- New module in `src/migration/workspace-copier.ts` + sibling tests
- Env-var override for test isolation — `CLAWCODE_OPENCLAW_ROOT` (source), `CLAWCODE_WORKSPACE_TARGET_ROOT` (target)
- Ledger witness rows per-file (high volume OK — JSONL append is cheap)

### Integration Points
- New module: `src/migration/workspace-copier.ts` — exports `copyAgentWorkspace(source, target, {filter, hashWitness, ledgerPath})`; returns `{pass: boolean, filesCopied: number, hashMismatches: string[]}`.
- New module: `src/migration/session-archiver.ts` — copies `~/.openclaw/agents/<name>/sessions/` to `<target>/archive/openclaw-sessions/`. Simpler wrapper on `fs.cp`.
- Extend: `src/cli/commands/migrate-openclaw.ts` runApplyAction — after YAML write (Phase 78), invoke workspace-copier per agent, hash-witness, rollback on fail, session-archive.
- Extend: `src/migration/apply-preflight.ts` orchestrator — add workspace-copier step after secret scan (or keep it strictly apply-only in migrate-openclaw.ts; judgment at plan time).

</code_context>

<specifics>
## Specific Ideas

- `find <target> -xtype l` returns zero broken symlinks — specific test command per success criterion #1.
- `.git fsck` must pass on copied repo — specific test command per success criterion #3.
- Hash-witness ledger row schema: `{path: string, src_sha: string, dst_sha: string, bytes: number}` keyed under `file_hashes` record.
- Self-symlink detection: if `lstat(path).isSymbolicLink()` AND `realpath(path)` is within the source tree AND resolves to a parent of `path`, skip (prevents infinite loop on `lib64 → lib`).
- Per-agent rollback: on any hash-witness failure, `fs.rm(targetWorkspace, {recursive: true, force: true})` + ledger `status: "rolled-back"`. Operator can re-run apply after fixing source.

</specifics>

<deferred>
## Deferred Ideas

- Memory re-embedding (reading source `~/.openclaw/memory/<name>.sqlite` chunks and inserting into target `memories.db` with fresh 384-dim embeddings) — Phase 80. Workspace copy covers markdown memory files (`memory/*.md`, `.learnings/*.md`); sqlite chunks are separate.
- `verify` / `rollback` / `resume` / `fork` subcommands — Phase 81
- Pilot + cutover + complete — Phase 82
- Parallel agent copy — deferred per embedder non-reentrancy constraint
- ConversationStore filter code (skip archive paths on replay) — not needed; migrator passively doesn't write to ConversationStore
- Compression / deduplication of archived sessions — out of scope; raw copy

</deferred>
