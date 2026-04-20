---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: OpenClaw Agent Migration
status: Ready to execute
stopped_at: Completed 75-02-PLAN.md (runtime consumers wired up). Ready for 75-03 (5-agent finmentum integration test).
last_updated: "2026-04-20T14:14:43.828Z"
last_activity: 2026-04-20
progress:
  total_phases: 14
  completed_phases: 6
  total_plans: 18
  completed_plans: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 75 — shared-workspace-runtime-support

## Current Position

Phase: 75 (shared-workspace-runtime-support) — EXECUTING
Plan: 3 of 3

## Performance Metrics

**Velocity:**

- Total plans completed: 70+ (v1.0-v2.0 across 11 milestones)
- Average duration: ~3.5 min
- Total execution time: ~4+ hours

**Recent Trend:**

- v2.0 plans: stable 10-32min each
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.1 Roadmap]: Zero new npm deps — entire milestone runs on existing stack (better-sqlite3, sqlite-vec, @huggingface/transformers, yaml, zod, pino, Node 22 fs.cp).
- [v2.1 Roadmap]: Re-embedding is MANDATORY not optional — OpenClaw uses gemini-embedding-001 (3072-dim) or embeddinggemma (768-dim); ClawCode vec_memories is locked to 384-dim MiniLM. ~131 seconds wall time for 2,617 real chunks, zero API spend.
- [v2.1 Roadmap]: Source of truth for memory translation is WORKSPACE MARKDOWN (MEMORY.md + memory/*.md + .learnings/*.md), not the OpenClaw sqlite chunks table (which is a derived file-RAG index and may be stale).
- [v2.1 Roadmap]: SOUL/IDENTITY stored as workspace files with `soulFile:` + `identityFile:` YAML pointers — never inlined into clawcode.yaml (avoids 3k-line config bloat and preserves file-based editing workflow).
- [v2.1 Roadmap]: Secret guard is a HARD REFUSAL not a warning — migrator rejects any raw secret-shaped value in clawcode.yaml; whitelists only opaque references (channel IDs, op:// refs, named MCP server refs).
- [v2.1 Roadmap]: Shared-workspace support (Phase 75) is a PREREQUISITE runtime feature addition — not a migration concern. Blocks all finmentum migration; zero impact on 10 dedicated-workspace agents. ~15 LOC across 3 files.
- [v2.1 Roadmap]: Non-destructive to source — migrator NEVER modifies, deletes, or renames any file under `~/.openclaw/`. OpenClaw daemon runs fine during/after migration (until per-agent cutover removes its Discord bindings).
- [v2.1 Roadmap]: Discord cutover is dual-run → per-agent — both bots are present during pilot, then `clawcode migrate openclaw cutover <agent>` unbinds the OpenClaw bot per-agent after user verification. Hard pre-flight check: refuse apply if a channel ID is bound on both sides with overlapping activation.
- [v2.1 Roadmap]: Session history is archive-only (copied to `<workspace>/archive/openclaw-sessions/`), NOT replayed into v1.9 ConversationStore — format/provenance mismatch makes replay cost-prohibitive and correctness-risky.
- [v2.1 Roadmap]: Fork-to-Opus is unlimited per migrated agent (user decision) — no new fleet ceiling in v2.1; revisit if costs become a concern (deferred to future milestone).
- [v2.1 Roadmap]: Per-agent atomic cutover — memory → workspace → config (YAML append is the commit point). Agents in sequence, not parallel (YAML write contention + embedder singleton non-reentrancy).
- [v2.1 Roadmap]: Pilot agent is `personal` or `local-clawdy` — smallest DB, lowest activity, not business-critical. Full end-to-end run + rollback rehearsal on pilot BEFORE the other 14 agents.
- [v2.1 Roadmap]: Phase ordering is load-bearing — SHARED (prerequisite) → read-side CLI → guards+ledger → config mapping → workspace copy → memory translation → verify/rollback/fork → pilot+cutover+complete. Memory comes AFTER workspace because markdown files must exist at target paths before memory reader parses them.
- [v2.0 Roadmap]: Bearer-key = session boundary — one isolated ConversationStore session per API key (OPENAI-05). No multi-user-per-key fan-out until v2.1 "Multi-User Foundations".
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 01]: Schema-level raw-string conflict detection via superRefine — path normalization (trailing slashes, ./ prefixes) deferred to loader.ts in Plan 02. Schema test documents boundary.
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 01]: ResolvedAgentConfig.memoryPath is REQUIRED (not optional) — loader guarantees fallback to workspace; downstream consumers read unconditionally (no optional-chaining). Forced 13 test-fixture updates but preserves zero-optional-chain runtime pattern.
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 02]: memoryPath expansion is conditional — expandHome called only when agent.memoryPath set; fallback inherits resolvedWorkspace as-is. Preserves pre-existing loader behavior of not expanding agent.workspace when YAML-set.
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 02]: Signature renames (logResult: workspace→memoryPath, saveContextSummary: workspace→memoryPath) over config-object threading — minimum-diff change since both methods took path strings.

### Phase 74 / v2.0 closing decisions (for reference)

- [Phase 74]: caller-identity routing runs BEFORE scope-aware authz — enables malformed openclaw: syntax on pinned key to surface as 400 malformed_caller; zero Phase 69 regression
- [Phase 74]: systemPrompt passed as STRING (Pitfall 2) to createPersistentSessionHandle — REPLACES SDK kernel prompt for transient sessions; preset+append NOT used
- [Phase 74]: CLAWCODE_TRANSIENT_CWD fixed at module scope (~/.clawcode/manager/transient); driver never reads caller workspace/cwd/metadata (Pitfall 4 guard, grep-enforced)
- [Phase 74]: TransientSessionCache LRU+TTL with close-on-evict — handle.close() errors caught + logged; cache invariants hold under SDK subprocess crash
- [Phase 74]: denyScopeAll gate placement inside scope='all' branch (not pre-branch) — colocates with other scope-resolution logic; pinned-key mismatch stays agent_mismatch, openclaw-template branch bypasses entirely
- [Phase 74]: Fleet-anchor UsageTracker lookup for transient turns — agent column ('openclaw:<slug>') keeps rows distinguishable; zero schema change required; Pitfall 8 non-fatal on missing tracker
- [Phase 74]: Tier encoded in model column NEVER agent column — CONTEXT D-04 confirmed: one cost row per caller, not per (caller, tier); agent='openclaw:<slug>' never contains tier suffix
- [Phase 74]: Shutdown drain order — transientCache.closeAll() BEFORE server.close() — in-flight SDK subprocesses abort cleanly before socket yanking

### Roadmap Evolution

- 2026-04-18: Milestone v1.9 Persistent Conversation Memory shipped (Phases 64-68 + 68.1)
- 2026-04-18: Milestone v2.0 Open Endpoint + Eyes & Hands started — 20 requirements defined across 4 categories
- 2026-04-18: v2.0 roadmap created — 4 phases (69-72), 20/20 requirements mapped 1:1, zero orphans
- 2026-04-19: Phase 73 added — OpenClaw endpoint latency
- 2026-04-19: Phase 74 added — Seamless OpenClaw backend (caller-provided agent config)
- 2026-04-20: v2.0 complete (Phases 69-74 shipped); v2.1 OpenClaw Agent Migration milestone opened
- 2026-04-20: v2.1 research complete — STACK/FEATURES/ARCHITECTURE/PITFALLS/SUMMARY across `.planning/research/`
- 2026-04-20: v2.1 roadmap created — 8 phases (75-82), 31 requirements mapped 1:1 across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS

### Pending Todos

- `/gsd:plan-phase 75` — decompose Shared-Workspace Runtime Support into plans (estimated 1-2 plans given the ~15 LOC surface)
- Consider `/gsd:research-phase 80` before planning Memory Translation — source sqlite schema is already in STACK.md but markdown-section splitting rules and origin_id format need confirmation

### Blockers/Concerns

- **OpenClaw daemon must be stopped during `apply`** — pre-flight guard (Phase 77) enforces this; operator-side systemctl command needs to be documented in runbook.
- **Finmentum workspace internal layout** — which markdown files inside `workspace-finmentum/` are per-agent memory vs. shared project files vs. financial data that should NOT be embedded. Requires a one-time inspection walk during Phase 79 / Phase 80 planning.
- **Credential reference format across all 15 agents' MCP configs** — confirmed `op://` for the top-level Discord token, but unclear whether all 15 agent-level MCP configs use `op://` consistently. Pre-flight validation in Phase 77 catches this; Phase 78 secret-guard enforces it.
- **Hot-reload cannot activate new agents** — `config/differ.ts` marks added agents `reloadable: false`. Migration workflow requires `systemctl stop clawcode && apply && systemctl start clawcode` per the Phase 77 pre-flight check.
- **12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only)** — legacy carry-over, not blocking.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-sux | Fix schedule display field mismatch and add registry ghost-entry reconciliation | 2026-04-18 | 3d4ff24 | [260418-sux-fix-schedule-display-field-mismatch-and-](./quick/260418-sux-fix-schedule-display-field-mismatch-and-/) |
| 260419-jtk | Harden OpenAI streaming for OpenClaw: usage trailing chunk + tool-call verify + warm-path startup race | 2026-04-19 | 18252fe | [260419-jtk-harden-openai-streaming-for-openclaw-emi](./quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/) |
| 260419-mvh | Fix initMemory→warm-path cascade + add OpenAI request/payload JSONL logging + `openai-log tail` CLI | 2026-04-19 | 34dfb83 | [260419-mvh-fix-initmemory-warm-path-cascade-add-ope](./quick/260419-mvh-fix-initmemory-warm-path-cascade-add-ope/) |
| 260419-nic | Discord `/clawcode-interrupt` + `/clawcode-steer` slash commands — mid-turn abort + steering via Phase 73 interrupt primitive | 2026-04-19 | 8ff6780 | [260419-nic-add-discord-stop-and-steer-slash-command](./quick/260419-nic-add-discord-stop-and-steer-slash-command/) |
| 260419-p51 | Multi-agent bearer keys (scope=all) + composite-PK session index + fork-escalation regression pin + spawn-subagent UX docs | 2026-04-19 | edecd6e | [260419-p51-multi-agent-bearer-keys-fork-escalation-](./quick/260419-p51-multi-agent-bearer-keys-fork-escalation-/) |
| 260419-q2z | Registry atomic write + recovery + `clawcode registry repair` CLI + always-summarize short sessions + graceful shutdown drain (FIX A+B+C) | 2026-04-19 | fa34ef3 | [260419-q2z-registry-atomic-write-graceful-shutdown-](./quick/260419-q2z-registry-atomic-write-graceful-shutdown-/) |
| Phase 69 P01 | 13 | 3 tasks | 7 files |
| Phase 69-openai-compatible-endpoint P02 | 24 | 4 tasks | 9 files |
| Phase 69-openai-compatible-endpoint P03 | 18 | 5 tasks | 16 files |
| Phase 70-browser-automation-mcp P01 | 15min | 3 tasks | 9 files |
| Phase 70-browser-automation-mcp P02 | 20min | 3 tasks | 14 files |
| Phase 70-browser-automation-mcp P03 | 27min | 3 tasks | 12 files |
| Phase 71 P01 | 21 min | 3 tasks | 16 files |
| Phase 71-web-search-mcp P02 | 10 min | 2 tasks | 10 files |
| Phase 72-image-generation-mcp P01 | 32min | 3 tasks | 20 files |
| Phase 72-image-generation-mcp P02 | 24 min | 2 tasks | 16 files |
| Phase 74 P01 | 22min | 3 tasks | 10 files |
| Phase 74 P02 | 19min | 3 tasks | 7 files |
| Phase 75-shared-workspace-runtime-support P01 | 10min | 2 tasks | 19 files |
| Phase 75-shared-workspace-runtime-support P02 | 14min | 2 tasks | 10 files |

## Session Continuity

Last activity: 2026-04-20
Stopped at: Completed 75-02-PLAN.md (runtime consumers wired up). Ready for 75-03 (5-agent finmentum integration test).
Resume file: None
