---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: OpenClaw Agent Migration
status: Phase complete — ready for verification
stopped_at: Completed 78-03-PLAN.md
last_updated: "2026-04-20T19:41:07.575Z"
last_activity: 2026-04-20
progress:
  total_phases: 14
  completed_phases: 10
  total_plans: 28
  completed_plans: 28
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 78 — config-mapping-yaml-writer

## Current Position

Phase: 78 (config-mapping-yaml-writer) — EXECUTING
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
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 03]: Per-test timeout extensions (15s/20s) on MemoryStore-heavy tests — sqlite-vec cold-start + migrations + auto-linker exceed the 5s vitest default under parallel test load. Pure test-framework config; zero production impact.
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 03]: Integration test asserts error-message TEXT not just success===false — pins the UX contract that schema + loadConfig both surface BOTH conflicting agent names when memoryPath collides.
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 04]: Context-summary READ path in session-config.ts:318 now resolves against config.memoryPath (not config.workspace) — closes 75-VERIFICATION.md Truth #7 asymmetry. One-line fix with inline rationale comment + pinned regression test.
- [Phase 75-shared-workspace-runtime-support]: [Phase 75 Plan 04]: Context-summary test assertion uses (systemPrompt + mutableSuffix) combined block — Phase 52 two-block wiring routes resume summary into MUTABLE suffix; plan spec asked for systemPrompt only, primary regression guard (toHaveBeenCalledWith) is unchanged and unambiguous.
- [Phase 76-migration-cli-read-side-dry-run]: [Phase 76 Plan 01]: FINMENTUM_FAMILY_IDS hardcoded (D-Finmentum) — dynamic heuristic risks mis-grouping finmentum-dashboard/studio; 5 ids frozen.
- [Phase 76-migration-cli-read-side-dry-run]: [Phase 76 Plan 01]: openclawBindingSchema uses .passthrough() — tolerates real on-box extra fields (type:'route', accountId) without weakening required-field checks; needed for the finmentum-content-creator binding.
- [Phase 76-migration-cli-read-side-dry-run]: [Phase 76 Plan 01]: Ledger validated on WRITE pre-mkdir — bad rows never create .planning/migration/ directory; enforces append-only invariant at write side, not reader side.
- [Phase 76-migration-cli-read-side-dry-run]: [Phase 76 Plan 01]: latestStatusByAgent uses insert-order last-write-wins (NOT ts-sort) — append-only file ordering is the truth source; wall-clock skew across apply/verify rows would misreshuffle under ts-sort.
- [Phase 76]: [Phase 76 Plan 02]: generatedAt excluded from planHash via Omit<PlanReport, 'planHash'|'generatedAt'> — compiler prevents tainting; canonicalize() sorts keys at every nesting level (V8 insertion-order is unsafe across refactors).
- [Phase 76]: [Phase 76 Plan 02]: Finmentum 5-agent collapse resolved via getTargetBasePath returning shared <root>/finmentum + getTargetMemoryPath returning distinct <root>/finmentum/memory/<id> — honors SHARED-01 workspace contract from Phase 75.
- [Phase 76]: [Phase 76 Plan 02]: Warnings-as-data (never throw) — buildPlan emits 4-kind PlanWarning array; unknown-agent-filter warning is what Wave 3 CLI translates to exit(1), kept out of buildPlan to preserve pure-function contract.
- [Phase 76]: [Phase 76 Plan 02]: Pinned expected-diff.json fixture with FIXED_NOW 2026-04-20T00:00Z — 15 agents, 17 warnings, planHash 46a8f3b5b278; byte-parity test catches shape drift, forces intentional fixture updates on any AgentPlan/PlanReport field change.
- [Phase 76]: [Phase 76 Plan 03]: vi.mock + vi.hoisted factory pattern replaces vi.spyOn for ESM fs namespaces — node:fs/promises exports are non-configurable in Node 22; idiomatic vitest ESM spy mechanism now standard for Phases 77+.
- [Phase 76]: [Phase 76 Plan 03]: Env-var override namespace CLAWCODE_OPENCLAW_JSON / _MEMORY_DIR / _AGENTS_ROOT / _LEDGER_PATH — reusable by Phases 77-82 pre-flight/apply/verify tests for tmp-fixture isolation without DI refactor of commander.
- [Phase 76]: [Phase 76 Plan 03]: Action handlers (runListAction/runPlanAction) return numeric exit codes instead of calling process.exit directly — decouples business logic from CLI harness, integration-testable without process-exit guards.
- [Phase 77]: [Phase 77 Plan 01]: Ledger schema extension is ADDITIVE-ONLY — step/outcome/file_hashes all .optional(); Phase 76 rows round-trip unchanged; dedicated 'ledger schema extensions (Phase 77)' describe block with isolated fixtures keeps Phase 76 suite byte-stable as regression pin.
- [Phase 77]: [Phase 77 Plan 01]: LEDGER_OUTCOMES is a CLOSED enum ['allow','refuse'] — narrower than existing LEDGER_STATUSES; refuse pairs with status:'pending' because a refused guard never advances state. file_hashes enforces non-empty keys AND values via z.record(z.string().min(1), z.string().min(1)).
- [Phase 77]: [Phase 77 Plan 02]: Zero new deps — replaced execa (listed in CONTEXT as in-deps but missing from package.json) with node:child_process.execFile shim behind the execaRunner DI param. Default runner wraps execFile with execa-compatible {stdout, exitCode} Promise shape.
- [Phase 77]: [Phase 77 Plan 02]: Secret classification three-phase order: explicit known-secret prefix (sk-/MT-) ALWAYS refuses over whitelist over high-entropy fallback. Discovered during TDD — sk- tokens satisfy SHORT_IDENT (/[a-z0-9-]+/) and whitelist-first silently passed them. Pinned in sk-refuse + op://allow regression tests.
- [Phase 77]: [Phase 77 Plan 02]: pre-flight:readonly orchestrator witness row (not a stub) — Plan 03 owns the actual fs.writeFile/appendFile/mkdir interceptor install. Orchestrator records the canonical row so 4-row ledger sequence is intact even before Plan 03 lands.
- [Phase 77]: fs-guard uses CJS-module patching (ESM namespace objects frozen) — default-import callers covered; named-import callers not, static-grep regression is primary MIGR-07 line of defense
- [Phase 77]: Static /tmp/cc-agents path in tests — mkdtempSync's alnum suffix trips scanSecrets high-entropy threshold on targetBasePath (real production concern for Phase 78+)
- [Phase 77]: stripEntropicModels fixture helper normalizes real model names (anthropic-api/claude-sonnet-4-6, 4.0+ entropy) to whitelist short-idents for non-secret-path tests
- [Phase 78-config-mapping-yaml-writer]: [Phase 78 Plan 01]: Phase 78 mutual-exclusion guard appended INSIDE existing Phase 75 superRefine arrow function (single superRefine chain — Zod doesn't support chaining a second). Regression test asserts both blocks fire independently.
- [Phase 78-config-mapping-yaml-writer]: [Phase 78 Plan 01]: Error message copy pinned verbatim — literal 'cannot be used together' substring with agent name inline; grep-verifiable contract called out in critical_constraints.
- [Phase 78-config-mapping-yaml-writer]: [Phase 78 Plan 01]: Silent fall-through on read errors at every precedence step — configured-but-deleted soulFile doesn't crash session boot; last branch falls back to config.soul ?? ''.
- [Phase 78-config-mapping-yaml-writer]: [Phase 78 Plan 01]: storeSoulMemory + differ.ts intentionally untouched per plan scope; follow-ups tracked in deferred-items.md for Plan 02/03 to address once yaml-writer is in place.
- [Phase 78]: [Phase 78 Plan 02]: UNMAPPABLE_MODEL_WARNING_TEMPLATE literal pinned byte-exact — em-dash U+2014, angle-bracket placeholders, double-quotes inside override example. renderUnmappableModelWarning(id) substitutes <id> twice; <clawcode-id> stays literal so operators see override shape.
- [Phase 78]: [Phase 78 Plan 02]: config-mapper emits STRUCTURED warnings only ({kind,id,agent} | {kind,name,agent}) — literal warning copy render deferred to CLI/Plan 03. Keeps mapper decoupled from copy format and PlanWarning-assignable via field widening (id/name -> detail).
- [Phase 78]: [Phase 78 Plan 02]: AUTO_INJECT_MCP = ['clawcode', '1password'] dedup-aware — explicit user declaration silently absorbed via seen Set<string>; prevents duplicate YAML refs. Unknown per-agent MCP names emit soft unknown-mcp-server warning (not hard error) per 78-CONTEXT D-mcp.
- [Phase 78]: [Phase 78 Plan 02]: migrateOpenclawHandlers mutable dispatch holder over vi.spyOn/vi.mock — ESM named-import bindings frozen; dispatch-holder property swap works at commander closure call-time. Simpler than vi.hoisted + vi.mock factory for CLI integration tests.
- [Phase 78]: [Phase 78 Plan 02]: --model-map parse error inside .action() handler (NOT commander argParser) — fail-fast exit(1) + literal 'invalid --model-map syntax' stderr BEFORE ledger/fs-guard touch. Matches Phase 77 error surfacing convention.
- [Phase 78]: [Phase 78 Plan 02]: runPlanAction/runApplyAction plumb modelMap but don't consume yet — Plan 03 yaml-writer is the actual consumer. void _modelMap + inline 'Plan 03 consumes' comment documents intent; tsc satisfied by typed parameter.
- [Phase 78]: [Phase 78 Plan 03]: Pre-write scanSecrets shim walks operator-input-ish fields only (name/model/channels/mcpServers) — path fields excluded to avoid false-positive high-entropy refusal on SOUL.md-terminated absolute paths. hasSecretPrefix still runs for sk-/MT- embedded in those shapes.
- [Phase 78]: [Phase 78 Plan 03]: guards.ts isWhitelisted additively widened with ABSOLUTE_PATH_PREFIX + MODEL_ID_SHAPE — closes Phase 77 STATE.md 'Phase 78+ concern' on migrator-generated data. Order: hasSecretPrefix → whitelist → high-entropy fallback preserved; 21/21 guards tests unchanged.
- [Phase 78]: [Phase 78 Plan 03]: writerFs mutable dispatch holder (readFile/writeFile/rename/unlink) for ESM-safe test monkey-patching — mirrors Phase 78-02 migrateOpenclawHandlers. Avoids vi.spyOn on frozen node:fs/promises bindings.
- [Phase 78]: [Phase 78 Plan 03]: APPLY_NOT_IMPLEMENTED_MESSAGE kept as @deprecated EXPORT (not deleted) — backward-compat for external tooling that grepped during Phase 77 ship. Runtime no longer emits on success; JSDoc @deprecated signals intent.
- [Phase 78]: [Phase 78 Plan 03]: yaml package normalizes double-space comments to single-space on round-trip — fixture clawcode.before.yaml uses single-space form so byte-exact line-subsequence check passes without a normalization step.

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
| Phase 75-shared-workspace-runtime-support P03 | 11min | 1 tasks | 1 files |
| Phase 75-shared-workspace-runtime-support P04 | 8min | 2 tasks | 2 files |
| Phase 76-migration-cli-read-side-dry-run P01 | 5min | 3 tasks | 7 files |
| Phase 76 P02 | 4min | 1 tasks | 3 files |
| Phase 76 P03 | 8min | 3 tasks | 4 files |
| Phase 77 P01 | 5min | 2 tasks | 2 files |
| Phase 77 P02 | ~7min | 2 tasks | 5 files |
| Phase 77 P03 | 25min | 2 tasks | 3 files |
| Phase 78-config-mapping-yaml-writer P01 | 6min | 2 tasks | 7 files |
| Phase 78 P02 | 11min | 2 tasks | 9 files |
| Phase 78 P03 | 32min | 2 tasks | 9 files |

## Session Continuity

Last activity: 2026-04-20
Stopped at: Completed 78-03-PLAN.md
Resume file: None
