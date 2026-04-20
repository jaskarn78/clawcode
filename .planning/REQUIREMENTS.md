# Requirements — Milestone v2.1: OpenClaw Agent Migration

**Status:** Active
**Started:** 2026-04-20
**Total requirements:** 31

**Milestone goal:** Port all 15 active OpenClaw agents to dedicated ClawCode agents with memories, workspaces, identities, souls, and tool access preserved — every migrated agent gains native fork-to-Opus subagent spawning.

**User decisions (from research discussion):**
- SOUL/IDENTITY: hybrid — `soulFile:` + `identityFile:` YAML pointers, content lives in workspace files
- Bot identity: dual-run during pilot, per-agent cutover after verification
- Session history: archive-only pointer at `<workspace>/archive/openclaw-sessions/`, no replay
- Fork-to-Opus budget: unlimited per agent (no new fleet ceiling in this milestone)

**In-scope agents (15):**
- Finmentum family (5, shared workspace): `fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum-content-creator`
- Dedicated workspace (10): `general`, `work`, `projects`, `research`, `personal`, `shopping`, `local-clawdy`, `kimi`, `card-planner`, `card-generator`

---

## v2.1 Requirements

### Shared-Workspace Runtime (SHARED-*)

Prerequisite — add runtime support for multiple agents pointing at one workspace without memory/inbox collisions. Blocks all finmentum-family migration work.

- [x] **SHARED-01**: User (as config author) can declare multiple agents in `clawcode.yaml` that reference the same `basePath` and have each agent open an isolated `memories.db` via a per-agent `memoryPath:` override, with no cross-agent write to another agent's memory file.
- [x] **SHARED-02**: User (as operator) can confirm that shared-workspace agents each get their own `inbox/`, heartbeat log, and session-state directory so chokidar watchers, message routing, and consolidation jobs never fire on another agent's events.
- [x] **SHARED-03**: User (as operator) can observe that all 5 finmentum agents boot cleanly on the same shared workspace with no file-lock errors, no duplicate auto-linker runs, and no cross-agent pollution in `memory_lookup` results.

### Migration CLI (MIGR-*)

User-facing `clawcode migrate openclaw` command — plan, apply, rollback, resume. State journal at `.planning/migration/ledger.jsonl`.

- [x] **MIGR-01**: User (as operator) can run `clawcode migrate openclaw plan` and see a per-agent table (source name, target `basePath`, memory count, MCP servers mapped, Discord channel) with color-coded diff, writes nothing.
- [x] **MIGR-02**: User (as operator) can run `clawcode migrate openclaw apply [--only <agent>]` and have the CLI refuse if the OpenClaw daemon (`openclaw-gateway.service`) is running, refuse if any raw non-`op://` secret would be written to `clawcode.yaml`, and refuse if any Discord channel ID already appears on an existing ClawCode agent.
- [ ] **MIGR-03**: User (as operator) can re-run `clawcode migrate openclaw apply` after partial success and have only un-migrated agents processed (idempotent; ledger-driven resume), with already-migrated memories deduped via `origin_id`.
- [ ] **MIGR-04**: User (as operator) can run `clawcode migrate openclaw verify [<agent>]` after apply and see pass/fail checks for: workspace files present, memory count within ±5% of source, Discord channel reachable, agent boots on daemon restart.
- [ ] **MIGR-05**: User (as operator) can run `clawcode migrate openclaw rollback <agent>` and have the CLI remove that agent's entries from `clawcode.yaml`, delete its ClawCode workspace + memory DB, and leave the source OpenClaw state fully intact.
- [x] **MIGR-06**: User (as operator) can observe that every migration action writes a structured JSONL entry to `.planning/migration/ledger.jsonl` with timestamp, agent, step, outcome, and file-hash witnesses.
- [x] **MIGR-07**: User (as operator) can trust that the migrator never modifies, deletes, or renames any file under `~/.openclaw/` — source system remains untouched for fallback.
- [x] **MIGR-08**: User (as operator) can run `clawcode migrate openclaw list` at any time and see which of the 15 agents are `pending` / `migrated` / `verified` / `rolled-back` with the corresponding ledger rows.

### Config Mapping (CONF-*)

Mapping from `openclaw.json` agent entries to `clawcode.yaml` agents array, with SOUL/IDENTITY as file pointers.

- [x] **CONF-01**: User (as operator) can trust that each migrated agent's `clawcode.yaml` entry carries a `soulFile:` pointing to `<workspace>/SOUL.md` and an `identityFile:` pointing to `<workspace>/IDENTITY.md`, with content read lazily at agent boot — no inline content duplication.
- [x] **CONF-02**: User (as operator) can trust that MCP servers declared per-agent in `openclaw.json` are mapped to `mcpServers:` references in the new `clawcode.yaml` entry, with existing ClawCode MCP patterns (clawcode + 1password auto-injection) preserved and unknown servers flagged in the plan output.
- [x] **CONF-03**: User (as operator) can trust that each migrated agent's model selection is mapped from OpenClaw's model id to the closest ClawCode-equivalent (e.g. `anthropic-api/claude-sonnet-4-6` passes through, `clawcode/admin-clawdy` stays as-is), with any unmappable model flagged in the plan and configurable via `--model-map` override.
- [x] **CONF-04**: User (as operator) can trust that the migrator writes to `clawcode.yaml` via atomic temp-file + rename so the daemon's chokidar watcher never sees a partially-written file, and the YAML round-trip preserves all existing comments and key ordering.

### Workspace Migration (WORK-*)

Per-agent file copy from `~/.openclaw/workspace-<name>/` to ClawCode target workspace.

- [ ] **WORK-01**: User (as operator) can trust that each migrated agent's workspace contains the source `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `CLAUDE.md`, `MEMORY.md`, `memory/`, `.learnings/`, and `archive/` — copied with symlink filter that excludes Python venv self-symlinks (`lib64 -> lib` trap verified in finmentum workspace).
- [ ] **WORK-02**: User (as operator) can trust that the 5 finmentum-family agents all resolve to the same ClawCode workspace path (shared `basePath`) while keeping per-agent `memoryPath`, soulFile, identityFile, and inbox in distinct files/subdirs.
- [ ] **WORK-03**: User (as operator) can trust that any `.git` directory in a source workspace is preserved verbatim (so the agent's existing git history isn't re-initialized or corrupted).
- [x] **WORK-04**: User (via migrated agent) can read the archived OpenClaw sessions at `<workspace>/archive/openclaw-sessions/*.jsonl` as read-only reference, with the migrator copying the full session tree but NOT replaying into ConversationStore.
- [ ] **WORK-05**: User (as operator) can trust that file permissions, timestamps, and non-text blobs (images, PDFs in `.learnings/`) survive the copy without corruption — verified by hash-witness post-copy check.

### Memory Translation (MEM-*)

OpenClaw workspace markdown → ClawCode `memories.db` with re-embedding.

- [ ] **MEM-01**: User (as migrated agent) can retrieve memories via `memory_lookup` MCP tool that originated from the source OpenClaw agent's `MEMORY.md` + `memory/*.md` files, with the full text content preserved verbatim (no LLM rewriting, no summarization).
- [ ] **MEM-02**: User (as operator) can trust that each migrated memory row in ClawCode's `memories` table carries an `origin_id` UNIQUE column (format: `openclaw:<agent>:<source-path-hash>`) so re-running the migrator does not create duplicates.
- [ ] **MEM-03**: User (as operator) can trust that all migrated memories are re-embedded via the resident `all-MiniLM-L6-v2` singleton (384-dim) and inserted through the public `MemoryStore.insert()` API — never raw SQL against `vec_memories`.
- [ ] **MEM-04**: User (as migrated agent) can retrieve `.learnings/*.md` entries as first-class memories via `memory_lookup` with a `tag: "learning"` classifier, so legacy learnings become searchable from day one.
- [ ] **MEM-05**: User (as operator) can trust that the migrator reads the workspace markdown (NOT the OpenClaw `chunks` table from its file-RAG sqlite) as source of truth — the OpenClaw sqlite is a derived index and may be stale.

### Fork-to-Opus Subagents (FORK-*)

Verify every migrated agent retains v1.5 fork-based Opus escalation.

- [ ] **FORK-01**: User (as migrated agent) can invoke the existing fork-to-Opus escalation path (`forkSession` with Opus model override) regardless of the agent's primary model (Sonnet, Haiku, MiniMax, or Gemini) — no per-agent config change required.
- [ ] **FORK-02**: User (as operator) can confirm via `clawcode costs --agent <name>` that fork-to-Opus turns appear in the cost ledger for each migrated agent, with no budget ceiling enforced (unlimited per user decision).

### Operational Cutover (OPS-*)

Pilot → per-agent cutover → dual-run guardrails.

- [ ] **OPS-01**: User (as operator) can migrate a single low-risk pilot agent (`personal` or `local-clawdy`) first and verify end-to-end behavior before migrating the remaining 14 — pilot selection surfaces in plan output.
- [ ] **OPS-02**: User (as operator) can run OpenClaw and ClawCode side-by-side during pilot with dual bots present in each migrated agent's Discord channel, with a clear cutover command (`clawcode migrate openclaw cutover <agent>`) that removes the OpenClaw bot's channel access per-agent after user verification.
- [x] **OPS-03**: User (as operator) can trust that the migrator refuses to proceed if both bots would otherwise reply to the same message (same channel ID bound to both an OpenClaw agent AND a ClawCode agent with overlapping activation rules) — hard fail with channel collision report.
- [ ] **OPS-04**: User (as operator) can execute a final `clawcode migrate openclaw complete` step that writes a migration report to `.planning/milestones/v2.1-migration-report.md` summarizing per-agent outcomes, memory-count deltas, Discord cutover timestamps, and any pending rollbacks.

---

## Future Requirements

Deferred from v2.1 scope — captured for future milestones:

- **Session replay** — import OpenClaw `sessions/*.jsonl` turns into ConversationStore with provenance. Rejected for v2.1 because JSONL shape doesn't cleanly retrofit into v1.9 ConversationStore provenance fields. (considered v2.2+)
- **Fleet-scale fork budget ceiling** — per-agent daily Opus spending caps enforced daemon-side. Rejected per user decision (unlimited); revisit if costs become a concern.
- **Memory schema v2** — knowledge-graph edges re-hydrated from OpenClaw relationships. Rejected because OpenClaw's file-RAG has no edge model; v1.6 auto-linker will rebuild edges organically post-migration.
- **Cross-agent memory sharing** — explicit cross-agent reads within finmentum family. Rejected per PROJECT.md ("Shared global memory — violates workspace isolation").
- **Multi-bot identity reconciliation** — smart merge of Clawdbot + OpenClaw-bot presence beyond dual-run. Rejected; dual-run → cutover is sufficient.

---

## Out of Scope

Explicitly not in this milestone, with reasoning:

- **Replaying 413+ session JSONL archives into ConversationStore** — cost-prohibitive; provenance fidelity gap; archive-only pointer is the accepted pattern (matches Codex CLI / AnythingLLM).
- **Automatic personality evolution during migration** — SOUL.md contents copied verbatim; any LLM-rewriting of soul violates PROJECT.md explicit Out-of-Scope.
- **Translating OpenClaw sqlite embeddings** — dimension mismatch (3072 vs. 384) makes blob copy impossible; re-embed from source text is the only path.
- **Copying plaintext Discord bot token from `openclaw.json`** — migrator hard-refuses any raw-secret value in `clawcode.yaml`.
- **Deleting or modifying source OpenClaw state** — migrator is non-destructive; OpenClaw continues to function during and after migration.
- **Inline SOUL/IDENTITY embedding in clawcode.yaml** — file-pointer hybrid chosen for editability and diff-ability.
- **Migrating non-active OpenClaw agents** — `0`, `4`, `claude`, `claude-code`, `claude-opus`, `claudecode`, `default`, `finmentum`, `main`, `openai-codex` directories exist but are not in the `agents.list` active set.

---

## Traceability

Populated by roadmapper — maps each REQ-ID to the phase that delivers it.

| REQ-ID | Phase | Status |
|--------|-------|--------|
| SHARED-01 | Phase 75: Shared-Workspace Runtime Support | Complete |
| SHARED-02 | Phase 75: Shared-Workspace Runtime Support | Complete |
| SHARED-03 | Phase 75: Shared-Workspace Runtime Support | Complete |
| MIGR-01 | Phase 76: Migration CLI Read-Side + Dry-Run | Complete |
| MIGR-08 | Phase 76: Migration CLI Read-Side + Dry-Run | Complete |
| MIGR-02 | Phase 77: Pre-flight Guards + Safety Rails | Complete |
| MIGR-06 | Phase 77: Pre-flight Guards + Safety Rails | Complete |
| MIGR-07 | Phase 77: Pre-flight Guards + Safety Rails | Complete |
| OPS-03 | Phase 77: Pre-flight Guards + Safety Rails | Complete |
| CONF-01 | Phase 78: Config Mapping + YAML Writer | Complete |
| CONF-02 | Phase 78: Config Mapping + YAML Writer | Complete |
| CONF-03 | Phase 78: Config Mapping + YAML Writer | Complete |
| CONF-04 | Phase 78: Config Mapping + YAML Writer | Complete |
| WORK-01 | Phase 79: Workspace Migration | Pending |
| WORK-02 | Phase 79: Workspace Migration | Pending |
| WORK-03 | Phase 79: Workspace Migration | Pending |
| WORK-04 | Phase 79: Workspace Migration | Complete |
| WORK-05 | Phase 79: Workspace Migration | Pending |
| MEM-01 | Phase 80: Memory Translation + Re-embedding | Pending |
| MEM-02 | Phase 80: Memory Translation + Re-embedding | Pending |
| MEM-03 | Phase 80: Memory Translation + Re-embedding | Pending |
| MEM-04 | Phase 80: Memory Translation + Re-embedding | Pending |
| MEM-05 | Phase 80: Memory Translation + Re-embedding | Pending |
| MIGR-03 | Phase 81: Verify + Rollback + Resume + Fork | Pending |
| MIGR-04 | Phase 81: Verify + Rollback + Resume + Fork | Pending |
| MIGR-05 | Phase 81: Verify + Rollback + Resume + Fork | Pending |
| FORK-01 | Phase 81: Verify + Rollback + Resume + Fork | Pending |
| FORK-02 | Phase 81: Verify + Rollback + Resume + Fork | Pending |
| OPS-01 | Phase 82: Pilot + Cutover + Completion | Pending |
| OPS-02 | Phase 82: Pilot + Cutover + Completion | Pending |
| OPS-04 | Phase 82: Pilot + Cutover + Completion | Pending |

**Coverage:** 31/31 requirements mapped — zero orphans, zero duplicates.
