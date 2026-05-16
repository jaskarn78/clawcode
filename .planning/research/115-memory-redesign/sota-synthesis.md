# SOTA Synthesis — Phase 115 Memory Redesign

**Researched:** 2026-05-07
**Constraint that drives this synthesis:** "33K-char append → Anthropic 400 rejection wedge across 11 concurrent agents on one host, each with its own SQLite memory store."

The synthesis is graded against that specific failure. Patterns that bound prompt size while preserving multi-session recall rank high. Generic "best practices" that don't address the wedge are not promoted.

---

## 1. Convergent SOTA patterns (multiple successful systems agree)

### 1.1 Hard structural cap on the always-injected tier — STRONG SIGNAL

| System | Cap | Enforcement |
|--------|-----|-------------|
| Hermes | `CONTEXT_FILE_MAX_CHARS = 20_000` per file | Truncate at write/read time, 70% head + 20% tail |
| Letta core blocks | Per-block configurable `char_limit` | Tool returns error on overflow; agent must compact |
| ChatGPT stored facts | Implicit char cap (~hundreds of facts max observed) | OpenAI compacts dossier periodically |
| Anthropic memory tool guidance | "Consider tracking memory file sizes and preventing files from growing too large" | Application-implemented |

**Insight:** every production system bounds the always-injected tier *structurally*, not by hope. ClawCode's wedge is exactly the absence of this.

**Phase 115 decision: HARD CAP on the bounded tier. Enforced at write time, not assembly time. Numeric proposal: `INJECTED_MEMORY_MAX_CHARS = 16_000` (well under the 33K observed failure point, generous enough for SOUL.md + a curated MEMORY.md).**

### 1.2 Tool-mediated lazy recall is the consensus winner — STRONG SIGNAL

Every successful 2025-2026 system exposes the bulk of memory as agent-callable tools, not always-injected text:

- Anthropic memory tool: 100% lazy (`view`, `create`, `str_replace`, etc. — agent must call to see anything)
- Letta archival: `archival_search` tool
- Hermes Honcho `recall_mode: "tools"` mode
- Mem0: vector retrieval at query time
- Zep: graph traversal tools

The anti-pattern these all moved away from: "stuff everything we know about the user/conversation into the prompt every turn." That is what ClawCode is doing today.

**Phase 115 decision: SHIFT default from always-inject to tool-mediated for any memory beyond the 16K hard-cap tier. Provide `clawcode-memory-search` (FTS5 + vector hybrid), `clawcode-memory-recall-by-link` (follow wikilinks from Phase 36-41), and possibly `clawcode-memory-archive-insert` (Letta-style agent-curated promotion).**

### 1.3 Dynamic memory placed AFTER the cache breakpoint — STRONG SIGNAL

Hermes' design choice (per the Honcho-architecture blog post) is the only documented production example, but it's architecturally consistent with how Anthropic prompt caching works:

> "Honcho's dynamic snippet appears *after* Anthropic's cached system prefix. The static system prompt leverages prompt caching on models like Claude Sonnet 4.6, while the memory layer remains dynamic."

ClawCode is a Claude-family-only system. Prompt caching is a meaningful cost lever at 11-agent scale. **Don't blow the cache on every memory write.**

**Phase 115 decision: structure the system prompt as `[static identity + SOUL.md (if rendered immutably)] + [CACHE BREAKPOINT] + [dynamic memory snippet, capped at 16K]`. Static portion is stable across days; dynamic portion changes per turn but only changes the post-breakpoint suffix.**

### 1.4 Episodic + semantic split — STRONG SIGNAL

| System | Episodic (raw history) | Semantic (curated) |
|--------|------------------------|--------------------|
| Hermes | `messages` + FTS5 | MEMORY.md / Honcho peer card |
| Letta | recall_memory | core_memory + archival_memory |
| ChatGPT | conversation summaries | stored facts dossier |
| Mem0 | (impl detail) | extracted natural-language facts |
| Cognee | session memory | permanent memory (graph) |

Every successful system has both. **Episodic is cheap to write, expensive to retrieve. Semantic is expensive to write, cheap to retrieve.**

**Phase 115 decision: keep the existing markdown vault + memory_chunks SQLite as the episodic tier. Promote a curated subset (the bounded 16K tier) as the semantic tier. Make the boundary explicit in the data model — currently it's implicit.**

### 1.5 Async writes, never on the response path — STRONG SIGNAL

| System | Default |
|--------|---------|
| Hermes Honcho | `write_frequency: "async"` |
| Anthropic memory tool | All writes are tool calls; no implicit auto-write on response path |
| Letta sleep-time agent | All consolidation runs in a separate async agent |
| Mem0 | Background fact extraction |

The case is clearest from Hermes: "memory backend outages don't halt responses (though updates during outages are lost)." Memory failure must never wedge the agent.

**Phase 115 decision: any synchronous append of memory into the prompt-assembly path is a bug. All memory writes go through async queues. The bounded-tier files (SOUL.md / MEMORY.md / USER.md) are only *read* by prompt assembly; writes are coordinated by Phase 95 dreaming and the agent's explicit tool calls.**

### 1.6 Async reflection / sleep-time compute — STRONG SIGNAL

| System | Trigger | Output |
|--------|---------|--------|
| Letta sleep-time agent | every 5 primary turns (default) | rewritten memory blocks |
| ClawCode Phase 95 | per-agent idle window (default 30min) | wikilinks (auto), promotion candidates (review), themed reflection |
| Generative Agents reflection | importance threshold accumulated | new high-level observations |
| Cognee Memify | continuous incremental | pruned/reweighted graph |

ClawCode already designed and (per Phase 95 status) shipped this primitive **independently** of the Letta sleep-time-compute paper. **The architectural convergence is strong validation.**

**Phase 115 decision: Phase 115 does NOT add a parallel reflection mechanism. It RE-WIRES dreaming so that:**
1. Dreaming is the primary consolidation path that keeps the bounded tier under its 16K cap.
2. Promotion candidates flow into MEMORY.md (the bounded tier) via operator review, NOT auto-applied — preserving Phase 95's D-04 decision.
3. Dreams have a NEW knob: when prompt assembly observes the bounded tier near its cap, it can schedule a priority dream pass to compress.

### 1.7 Three-phase compression (separate from memory tiers) — STRONG SIGNAL

Hermes' `context_compressor.py` is the cleanest documented design. The split is what matters:

- **Phase 1 (no LLM):** replace old tool outputs with 1-line summaries. Cheap, often sufficient.
- **Phase 2 (no LLM):** protect head + ~20K-token tail. Don't touch.
- **Phase 3 (LLM):** summarize the middle into a structured format with mandatory sections (Active Task / Goal / Completed / Resolved / Pending / Remaining).

Trigger: 50% of context window. Anti-thrashing: skip if last 2 compressions saved <10% each.

**Phase 115 decision: ClawCode's existing `src/memory/compaction.ts` should be audited against this three-phase split. The cheap Phase 1 (tool-output summarization without LLM) often saves enough alone. If ClawCode currently does only the LLM phase, adding the cheap phase up front may resolve a meaningful share of bloat events for free.**

---

## 2. ClawCode-specific design recommendations

### 2.1 Storage tiers for Phase 115

```
TIER 0 — IMMUTABLE STATIC (cached prefix)
  ┌─ SOUL.md (agent identity)
  └─ Static skill index summary
  Always injected. Operator-curated. Rarely changes.
  Total budget: ~4K chars.

[CACHE BREAKPOINT]

TIER 1 — BOUNDED DYNAMIC (agent-curated semantic memory)
  ┌─ MEMORY.md (curated long-term notes)
  ├─ USER.md (model of the user/operator)
  └─ Recent reflections snippet (3 most recent dream passes)
  Always injected. Hard-capped at 16K chars total. Overflow forces dream-driven compaction.

TIER 2 — EPISODIC SEARCHABLE (full history)
  ┌─ memory_chunks SQLite + FTS5 + sqlite-vec
  ├─ Conversation summaries (Phase 65 — already exists)
  └─ Per-session summary.md (inherited from Claude Code Session Memory)
  Tool-mediated only. Agent calls clawcode-memory-search to retrieve.
  Unbounded growth (subject to retention policies).

TIER 3 — SLEEP-TIME CONSOLIDATION (existing Phase 95 dreaming)
  Idle-time async pass. Reads Tier 2, writes proposed updates to Tier 1.
  Promotions/consolidations require operator review (no auto-apply to MEMORY.md).
```

### 2.2 The 33K-char failure: where it goes

Today's failure path (inferred from task statement — needs verification against `src/`):
- `appendMemoryContext()` or equivalent assembles every relevant memory entry into the prompt
- No size budget enforced
- Long-running agents accumulate enough that the append crosses 33K chars
- Anthropic API rejects with 400

Fix path:
1. **Enforce Tier 1 budget at assembly time.** If MEMORY.md + USER.md + recent-reflections > 16K chars, truncate via Hermes-style head/tail (70/20) AND log a warning.
2. **Schedule a priority dream pass** when truncation fires twice in succession — compaction is the long-term remedy.
3. **Move what was being appended to Tier 2.** Stop injecting full memory chunks into the prompt; let the agent retrieve them via `clawcode-memory-search`.
4. **Add a system-prompt instruction** (Anthropic-memory-tool style): "Your bounded memory is in MEMORY.md. For older context, search via `clawcode-memory-search`. Older memories are not in your prompt."

### 2.3 Tools the agent gets

Modeled on Anthropic's `memory_20250818` interface where it makes sense; extends with semantic search:

| Tool | Operates on | Purpose |
|------|-------------|---------|
| `clawcode-memory-view` | Tier 1 files | Read MEMORY.md / USER.md (lazy alternative if not auto-injected) |
| `clawcode-memory-edit` | Tier 1 files | str_replace / insert into MEMORY.md or USER.md |
| `clawcode-memory-search` | Tier 2 chunks | FTS5 + sqlite-vec hybrid search |
| `clawcode-memory-recall` | Tier 2 by wikilink | Follow Phase 36-41 wikilinks from a known anchor |
| `clawcode-memory-archive` | Tier 2 → Tier 1 | Agent-curated promotion (Letta archival_insert pattern) |
| `clawcode-memory-summarize` | Tier 1 | Force a compaction pass when the agent self-detects the cap |

### 2.4 What to deprecate

- **Synchronous "append all matching memory chunks" into the prompt.** This is the proximate cause of the wedge. Replace with the bounded-tier injection + tool-mediated search.
- **"Memory entry" as the universal storage unit.** Replace with the explicit two-tier model (curated facts in MD files + episodic chunks in SQLite). One unit type for both is what made the boundary fuzzy.
- **Implicit assumption that more memory = better recall.** Empirically false (per Mem0 paper: 1764 tokens injected outperforms 26K tokens injected on LOCOMO). Curated bounded memory + tool-mediated retrieval beats unbounded injection.

### 2.5 What to keep

- ClawCode's per-agent SQLite isolation. (Hermes shares a state.db across processes; ClawCode's design is better for the multi-agent-per-host case — don't regress.)
- Markdown vault as the canonical durable identity layer. (Hermes treats this the same way; their `claw migrate` only imports MD files + skills + config, not the FTS5 conversation history.)
- Phase 95 dreaming. (Letta's sleep-time-compute paper validates this design; treat dreaming as the consolidation engine for Tier 1.)
- Phase 36-41 wikilinks. (Lightweight graph that doesn't require Postgres+Graphiti — sufficient at our scale.)
- sqlite-vec + FTS5 for Tier 2 search. (Hermes' choice, our existing stack — empirically sufficient at <100K-vector scale.)

---

## 3. Patterns observed but explicitly NOT adopted

| Pattern | Rejected because |
|---------|------------------|
| Vector DB as primary store (Mem0, Cognee) | sqlite-vec is sufficient at our 10K-100K-vectors-per-agent scale; full vector DB adds operational weight without recall improvement at this scale |
| Temporal knowledge graph (Zep/Graphiti) | Real capability gain on temporal-reasoning queries, but requires Postgres + Graphiti; our agents don't have heavy temporal reasoning needs that warrant the operational cost |
| LLM-judge dedup on every write (Mem0) | Per-write LLM call across 11 agents × hundreds of writes/day is real cost; ClawCode's existing dedup-by-origin_id (Phase 99) is good enough |
| Per-task reflection only (Reflexion) | Not a fit for chat-style multi-session continuity; episodic+semantic split addresses this better |
| 0.99/hour exponential decay (Generative Agents) | Wrong timescale for persistent agents; would forget yesterday |
| Cloud-only memory backends (Honcho cloud, Mem0, Zep cloud, RetainDB) | Adds external dependency for the default path; ClawCode's $5-VPS positioning argues for local-only default |

---

## 4. Common failure modes (avoidable)

From the design history of these systems (especially Hermes' v0.4 → v0.7 evolution and Letta's MemGPT → sleep-time progression):

1. **"Memory" treated as a single flat thing.** The successful systems all split into multiple tiers with different read/write contracts. Don't ship a single `memory_entries` table and hope the agent figures it out.
2. **Synchronous extraction blocking response.** Mem0's per-message LLM extraction added latency; async fixes that. Hermes default is async.
3. **Cache busted on every memory update.** Hermes explicitly architected around this. Pay attention to where the breakpoint lands.
4. **Always-injected layer growing unbounded.** The exact wedge ClawCode hit. Hermes caps at 20K with explicit truncation; Letta blocks have per-block char_limits.
5. **Memory backend outage wedges the agent.** Hermes drops writes during outages and continues. ClawCode's current design must verify it has the same property — if `appendMemoryContext` ever throws in the prompt-assembly path, the agent wedges.
6. **Information decay through repeated summarization.** Each summary pass is lossy. Mitigations: structured-format summaries (Hermes), iterative-update (don't re-summarize from scratch), separate facts tier (Letta archival, Mem0 facts) so specifics survive even when narrative drifts.
7. **Vector retrieval that doesn't hit specific names/IDs.** FTS5 + vector hybrid is empirically better than vector alone for product use cases. ClawCode already uses this.
8. **Hardwired memory provider.** Hermes shipped a hardwired Honcho integration in v0.6 and refactored to a `MemoryProvider` ABC in v0.7. Worth introducing the abstraction up front even if there's only one implementation initially.

---

## 5. Key open questions for the planning phase

1. **Verify the proximate cause.** I inferred the wedge details from the task statement; the planner should `grep` the codebase for whatever assembles memory into the prompt and confirm. Possible filenames: `src/memory/context-injection.ts`, `src/agent/prompt-builder.ts`, `src/session/turn-builder.ts`. Check git log for recent additions touching memory chunk ingestion into the prompt.
2. **What's currently always-injected and at what size?** Read the specific bytes the prompt is being built from, on a wedged session. Knowing actual contents is the difference between "we need a 16K cap" and "we need a different boundary entirely."
3. **Is prompt caching active?** ClawCode uses Anthropic prompt caching for static system prompts somewhere. Confirm before designing where the cache breakpoint goes; if caching isn't active for this code path, the post-breakpoint placement story changes.
4. **What does Phase 95 currently do with promotions?** Phase 95-CONTEXT.md says promotion candidates SURFACE for operator review and don't auto-apply. Is the operator actually reviewing? If not, MEMORY.md is stagnant; the bounded tier won't recover from over-cap automatically. Decide whether Phase 115 changes the auto-apply policy or builds a friction-reducing review UI.
5. **Per-agent vs shared semantic tier?** Hermes' built-in fallback is per-profile. Letta's blocks are per-agent unless explicitly shared. ClawCode runs agents that DO sometimes need shared memory (the `finmentum` family shares basePath per Phase 99). Decide whether the bounded tier is per-agent or per-workspace at design time.
6. **Migration plan for existing memory entries.** If today's memory_entries table is reshaped into "Tier 1 (file-backed) vs Tier 2 (chunk-backed)," existing entries need to be classified. Treat this as a migration phase, not an in-place transform.

---

## 6. One-page recommendation

```
Phase 115 ships:

1. Hard 16K-char cap on always-injected memory (SOUL.md + MEMORY.md + USER.md
   + recent reflections snippet). Enforced at assembly time with head/tail
   truncation fallback. Logs warning + schedules priority dream when fired.

2. Cache-breakpoint placement: static identity before, dynamic memory after.

3. Tool surface for lazy recall: clawcode-memory-search (FTS5 + sqlite-vec
   hybrid), clawcode-memory-recall (wikilink follow), clawcode-memory-edit
   (Anthropic memory_20250818 contract on MEMORY.md / USER.md),
   clawcode-memory-archive (agent-curated promotion).

4. System-prompt instruction teaching the agent the protocol:
   "Your curated memory is in MEMORY.md and USER.md, always shown.
    For older context, call clawcode-memory-search.
    Record significant new facts via clawcode-memory-edit."

5. Audit src/memory/compaction.ts against Hermes' three-phase split. Add
   tool-output-pruning Phase 1 (no LLM) if missing.

6. Phase 95 dreaming becomes the consolidation engine for Tier 1. New
   trigger: priority pass when bounded tier nears cap.

7. Memory writes are NEVER synchronous on the response path. Verify and
   regression-test that memory backend errors do not wedge the agent.

8. Migration: classify existing memory_entries into Tier 1 vs Tier 2 at
   migration time. Default: everything goes to Tier 2; operator promotes
   the small curated set into MEMORY.md.

The wedge is fixed by point 1 alone (structural enforcement of the cap).
The other points convert ClawCode from "wedge-prone with workarounds" to
"convergent with SOTA" — Hermes + Letta + Anthropic memory tool patterns.
```

---

## 7. Confidence and gaps

| Claim | Confidence | Note |
|-------|------------|------|
| Hermes uses 20K char cap with 70/20 truncation | HIGH | `prompt_builder.py` constants extracted directly |
| Letta uses per-block configurable char_limit | HIGH | docs.letta.com explicit |
| Cache breakpoint placement is the right pattern | MEDIUM | sourced from Hermes blog post; consistent with Anthropic caching mechanics; would benefit from direct test on ClawCode |
| Async writes are the convergent default | HIGH | Hermes default + Letta sleep-time + Anthropic tool model |
| Vector DB overkill at our scale | MEDIUM | based on Mem0 paper's 1764-token injection performing well; ClawCode's actual scale could grow |
| Letta sleep-time = ClawCode dreaming | HIGH | Phase 95 design predates Letta paper but converges; clear architectural match |
| 16K-char specific budget | LOW | proposed number, not externally validated; should be tuned during planning based on actual assembly measurements |

**Things I did NOT verify:**
- ClawCode's current memory injection code path (inferred from task statement only)
- Hermes' `MEMORY_GUIDANCE` text body (not extracted; useful for ClawCode equivalent)
- Hermes built-in fallback fact-store schema (the SQLite schema for the case when no external memory provider is active — saw the reference, didn't extract)
- Letta exact default char_limits for built-in blocks (configurable, no documented universal default)
- Auto-skill creation trigger threshold in Hermes (operator's "5+ tool calls" matches the pattern but I didn't see the numeric threshold in source)

These gaps are flagged for the planner to verify or backfill rather than guessed.

---

## Cross-references

- `sota-hermes-architecture.md` — full Hermes deep-dive (storage, prompt, compression, Honcho, migration)
- `sota-hierarchical-memory.md` — Letta tiers, sleep-time compute, Generative Agents, rolling-summary patterns
- `sota-memory-products.md` — Mem0 / Zep / Cognee / ChatGPT / Anthropic memory tool / Claude Code Session Memory
- Internal: `.planning/phases/95-memory-dreaming-autonomous-reflection-and-consolidation/95-CONTEXT.md` — existing dreaming primitive
- Internal: `.planning/phases/107-memory-pipeline-integrity-dream-json-vec-memories-orphan-cleanup/` — existing memory pipeline pitfalls
- Internal: `.planning/phases/99-memory-translator-and-sync-hygiene/` — existing dedup/sync patterns
