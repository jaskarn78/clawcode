# Phase 115: Memory + context + prompt-cache redesign - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 115-Memory + context + prompt-cache redesign
**Mode:** Operator delegated all gray-area decisions to Claude with directive *"Can you decide what's best to achieve optimal results with quick responses based on my usage?"*
**Areas discussed:** Tier 1 char cap target, Embedding + migration plan, Phase 95 promotion override, Wave plan + sub-scope cuts + 1h-TTL + scoping (bundled)

---

## Initial gray-area selection (multi-select)

| Option | Description | Selected |
|---|---|---|
| Tier 1 char cap target | Two-cap framing: bounded always-injected tier (SOUL+MEMORY+USER+reflections) and total stable-prefix cap. Synthesis recommended 16K chars bounded + 8K tokens total-prefix p95. | ✓ (Claude-decided) |
| Embedding + migration plan | MiniLM-L6 → bge-small-en-v1.5 + int8 quantization. Migration approach: one-shot / dual-write / lazy. Phase 90 explicitly punted here. | ✓ (Claude-decided) |
| Phase 95 promotion override | Conflict with prior decision — Phase 95 D-04 locked operator-review-only; sub-scope 8 proposes auto-apply with veto. Override / keep / hybrid. | ✓ (Claude-decided) |
| Wave plan + sub-scope cuts + 1h-TTL + scoping | Bundles four sequencing decisions: scope cuts, wave ordering, 1h-TTL ship/defer, finmentum per-agent vs per-workspace. | ✓ (Claude-decided) |

**User's choice:** Free-text — *"Can you decide what's best to achieve optimal results with quick responses based on my usage?"*

**Notes:** Operator delegated decision-making to Claude based on usage profile (11-agent fleet on single host, finmentum family agents, fin-acquisition Ramy-paced thread, Discord-paced single-turn cadence as dominant pattern, plus background dream/cron-driven turns). Claude proceeded to lock all decisions using research-synthesis defaults + prior-phase constraints + alignment with operator's stated headline priorities (responsiveness + retention).

---

## Tier 1 char cap target

| Option | Description | Selected |
|---|---|---|
| 16K chars bounded tier (~4K tokens) | Synthesis recommendation §1.1; tighter than Hermes' 20K to leave headroom on 11-agent box | ✓ |
| 12K chars bounded tier | Tighter; risks fin-acq curated memory (~1,182 memories) overflow during normal growth | |
| 20K chars bounded tier | Hermes-equivalent; gives no margin under fin-acq's 33K observed failure point | |
| 8K chars bounded tier | Too aggressive; cuts MEMORY.md to single-page-equivalent | |

**User's choice:** Claude-decided per delegation: 16K chars bounded tier + 8K tokens total stable prefix.

**Notes:** Two-cap framing locks both the inner bounded-tier cap (16K chars / ~4K tokens) AND outer total-prefix cap (8K tokens, matches roadmap acceptance criterion p95 ≤ 8K). Per-section budgets in tokens (not chars — fixes existing chars-vs-tokens unit mismatch in `context-assembler.ts:494-513`). Replaces `warn-and-keep` no-op with real `drop-lowest-importance` for `identity` (sectionable: SOUL fingerprint > IDENTITY.md > capability manifest > MEMORY.md last-loaded). Overflow strategy: head-tail 70/20 truncation + daemon-side warn surfaced to dashboard (sub-scope 13c). Priority dream-pass trigger when truncation fires twice in 24h.

---

## Embedding + migration plan

| Option | Description | Selected |
|---|---|---|
| bge-small-en-v1.5 + int8 quantization | Apache 2.0, MTEB 62.17, 384-dim native, ~33MB ONNX. Battle-tested ONNX path. | ✓ |
| Jina v5-nano + int8 | ONNX path larger, less battle-tested in @huggingface/transformers | |
| gte-small + int8 | MTEB ~62; weaker ONNX deployment proof | |
| Stay on MiniLM-L6 | 2019-vintage MTEB ~56; foregoes 5-7 MTEB recall improvement | |

**User's choice:** Claude-decided: bge-small-en-v1.5 + int8 quantization.

| Migration approach option | Description | Selected |
|---|---|---|
| Dual-write transition + background batch re-embed | T+0 → T+7d dual-write; T+7d → T+14d background re-embed at 5% CPU; T+14d cutover. ~92 wall-clock hours fits cleanly. | ✓ |
| One-shot re-embed all agents | 11 agents × ~30K vectors single batch — no rollback path; Phase 99-A regression pin shows we got bitten by single-path migrations before | |
| Lazy on-access re-embed | Synthesis §1.5 requires async-only writes; on-access lands embed cost on response path (latency hit, defeats phase goal) | |

**User's choice:** Claude-decided: dual-write transition.

**Notes:** Migration state machine and progress tracked in `migrations.embeddingV2.<agentName>` per-agent. Operator can force-cutover or rollback via `clawcode memory migrate-embeddings --force-cutover|--rollback`. bge-small ONNX inference ~50ms per vector; 330K total vectors at 5% CPU budget = 4 days wall-clock, fits T+7d → T+14d window.

---

## Phase 95 promotion override

| Option | Description | Selected |
|---|---|---|
| HYBRID (3-tier policy) | Auto-apply additive entries with priorityScore >= 80; operator-review for mutations + merges; priority dream-pass on tier-1 overflow can mutate with 30-min veto window | ✓ |
| OVERRIDE (full auto-apply with veto) | Sub-scope 8 as proposed — auto-apply everything with operator veto; reduces operator friction but risks losing prior-decision spirit | |
| KEEP (Phase 95 D-04 unchanged) | Operator-review-only as today; bounded tier (D-01) won't recover from over-cap automatically; defeats sub-scope 8's consolidation-engine goal | |

**User's choice:** Claude-decided: HYBRID three-tier policy.

**Notes:** Resolves the conflict between Phase 95 D-04 (operator-review-only) and Phase 115 sub-scope 8 (auto-apply with veto). Three tiers: (1) `newWikilinks` always auto, unchanged from D-04; (2) `promotionCandidates` ADDITIVE auto with priorityScore >= 80, 30-min Discord veto window; (3) `suggestedConsolidations` and MUTATING `promotionCandidates` operator-required (D-04 unchanged for these). Forced-priority pass (D-05 trigger) overrides priorityScore floor and ALLOWS mutation with 30-min veto — overflow forces compaction. Agent-curated promotion via `clawcode_memory_archive` lazy-load tool bypasses review entirely (agent's own decision is operator-trusted).

---

## Wave plan + sub-scope cuts + 1h-TTL + scoping (bundled)

### Sub-scope inclusion

| Decision | Selected |
|---|---|
| Keep all 17 sub-scopes (with sub-scope 6 measurement-gated) | ✓ |
| Cut some sub-scopes (e.g., 9, 12) | |

**Rationale for keeping all:** v2.8 milestone is "Performance + Reliability" — sub-scope 12 (cross-agent transactionality) is reliability work, sub-scope 9 (no-LLM tool-output prune) is a free win. Both small additions that fit milestone theme.

### 1h-TTL direct-SDK fast-path (was operator gray area `b`)

| Option | Description | Selected |
|---|---|---|
| Measurement-gated (6-A ships, 6-B if rate <30%) | Instrument `tool_use_rate_per_turn` first; ship 6-B fast-path only if measurement supports | ✓ |
| Always ship 6-B in 115 | Risks shipping a fast-path that saves nothing on tool-heavy turns | |
| Defer 6 entirely to follow-on | Loses the cache hit-rate win for Discord-paced agents | |

**User's choice:** Claude-decided: measurement-gated.

**Notes:** Roadmap explicitly states *"Decision based on measured tool_use rate from `traces.db`."* — this codifies the gate. 6-A ships in wave 3 plan 9; 6-B ships in wave 4 plan 10 IF measurement supports. Punt path produces measurement artifact for next phase.

### Per-agent vs per-workspace tier scoping (was operator gray area `e`)

| Option | Description | Selected |
|---|---|---|
| Per-agent default + per-workspace OPTIONAL via config flag | Matches Phase 90 lock for default; opens finmentum family to opt-in workspace MEMORY.md | ✓ |
| Always per-agent | Forces finmentum operators to manually duplicate shared facts across agents | |
| Always per-workspace | Breaks Phase 90 isolation lock; breaks single-agent fleets | |

**User's choice:** Claude-decided: per-agent default, per-workspace opt-in.

**Notes:** `defaults.memory.tier1ScopingPolicy: "per-agent" | "per-workspace"` config knob. Tier 2 (chunks) stays per-agent ALWAYS (Phase 90 lock). Workspace MEMORY.md curation: Phase 95 dreaming fires per-agent; promotionCandidates targeting "workspace" scope reviewed by ANY agent in workspace via Discord summary; first-to-veto wins.

### Wave plan (5 waves, ~10 plans)

**Wave 0 — Baseline:** Plan 1 = sub-scope 16(a-b).
**Wave 1 — Quick wins:** Plan 2 = sub-scopes 2, 3, 4. Plan 3 = sub-scopes 13(a-c), 14.
**Wave 2 — Structural:** Plan 4 = sub-scopes 1, 11, 9. Plan 5 = sub-scope 5. Plan 6 = sub-scopes 7, 8. Plan 7 = sub-scope 10.
**Wave 3 — Performance:** Plan 8 = sub-scope 15. Plan 9 = sub-scope 17 + 6-A.
**Wave 4 — Closeout:** Plan 10 = sub-scope 12, 16(c), 6-B (gated), perf-comparisons report.

**Notes:** Plans 4 and 5 may run parallel (per `.planning/config.json` `parallelization: true`). Top of 6-10 plan range; phase is large but cleanly cuttable.

---

## Claude's Discretion

The following implementation details are NOT pre-decided and the planner can choose:

- Exact file/module locations for new code (e.g., `src/memory/tools/` is the natural choice for the four new MCP tools, but planner refines)
- Internal interface shapes for the four new memory tools — planner specs from research synthesis §2.3
- Exact SQLite schema for `vec_memories_v2` (column naming, foreign-key strategy)
- Test fixtures for migration regression (per-agent, dual-write transition, batch re-embed checkpointing)
- Discord embed format for priority-dream-pass review summary
- Specific DI shapes for `dream-auto-apply.ts` extension supporting D-10's three-tier policy
- Background-job CPU-budget mechanism (signals + nice level vs in-process scheduler vs cron)
- Exact name of the `clawcode_memory_*` MCP tools (synthesis suggests `clawcode-memory-search` / `-recall` / `-edit` / `-archive`; planner can prefix differently if it conflicts with existing tool names)

## Deferred Ideas

Nothing surfaced during discussion that wasn't already in the roadmap's out-of-scope list. The following remain explicitly deferred (named so they don't get re-discovered):

- Auto-skill creation pipeline (Hermes 5+ tool-calls trigger). Stays in Phase 999.42.
- Cross-host memory sync. Single-host only this phase.
- Cross-agent KG (knowledge graph) sharing across agents. Phase 115 keeps Tier 2 per-agent.
- Three-phase Hermes-style compression Phases 2 + 3 (LLM mid-summarization, drop oldest). Sub-scope 9 ships only no-LLM Phase 1.
- Switching off `better-sqlite3` + `sqlite-vec`.
- Operator-readable memory format (operator confirmed not required).
- Sub-scope 6-B (direct-SDK 1h-TTL fast-path) if measurement gate doesn't fire — carried to follow-on phase with measurement artifact.
