# SOTA: Hierarchical / Tiered Agent Memory

**Researched:** 2026-05-07
**Coverage:** Letta (MemGPT), Stanford Generative Agents, Reflexion, Sleep-Time Compute, rolling-summarization patterns.
**Confidence:** HIGH for Letta tier names + sleep-time compute (papers + official docs); MEDIUM for some Letta numerics (per-block char limits are configurable, no documented universal default).

---

## TL;DR

Three convergent patterns across every tiered-memory system worth studying:

1. **Two-tier minimum: bounded in-context vs unbounded out-of-context.** The bounded tier has a hard size limit; everything else is searchable. This is the structural shape of Letta (core/recall/archival), MemGPT, Hermes (MEMORY.md vs FTS5 sessions), and ChatGPT (stored facts vs conversation summaries).
2. **The agent is a participant, not a passive subject, of its own memory.** It calls memory functions during reasoning to insert/replace/search. Memory is not magic middleware — it's a tool surface.
3. **Asynchronous reflection > synchronous extraction.** Sleep-time agents (Letta), dreaming (ClawCode Phase 95), Generative-Agents reflection — the pattern is the same: shift expensive memory consolidation off the response path into idle time.

---

## 1. Letta / MemGPT — the canonical tiered architecture

Source: `docs.letta.com/concepts/memgpt`, `docs.letta.com/advanced/memory-management`, `letta.com/blog/agent-memory`, original MemGPT paper.

### 1.1 The four tiers

| Tier | Where | Always in context? | Searchable? | Who writes? |
|------|-------|--------------------|--------------|-------------|
| Message Buffer | Recent turns of current session | YES (until evicted) | N/A — it IS the context | System (turn append) |
| **Core Memory** | Pinned blocks in system prompt | YES — every turn | No (it's right there) | Agent (via tool call) + sleep-time agent |
| **Recall Memory** | Conversation history table | NO | YES — date + text search tools | System (auto on turn end) |
| **Archival Memory** | External vector / graph DB | NO | YES — semantic search tool | Agent (via tool call) |

The OS analogy from the MemGPT paper:
- Core memory ≈ RAM (fast, scarce, in context)
- Archival memory ≈ disk (slow, abundant, searched on demand)
- The agent is the program that calls "swap-in" / "swap-out" via function calls.

### 1.2 Core memory — the in-context tier

Each core-memory block has:
- **Label** (e.g., `human`, `persona`, `task`)
- **Description** (semantic role)
- **Value** (the actual text in context)
- **Character limit** (configurable per block; no universal default — operator-set)

When the agent decides something is worth being permanently in-context, it calls `memory_insert` / `memory_replace` to update the relevant block. When the block exceeds its char_limit, the write fails — agent must compact or move content to archival.

**Pattern: structurally enforce the budget at write time.** The block char_limit is not advisory; the tool returns an error and the agent must respond. This is the same enforcement pattern as Hermes' `CONTEXT_FILE_MAX_CHARS = 20_000` cap, applied at finer granularity (per-block instead of per-file).

### 1.3 Recall memory

Recall is the FULL conversation history, persisted to disk on every turn. The agent has two default tools to search it:

- `conversation_search(query)` — text/semantic search over messages
- `conversation_search_date(start, end)` — temporal lookup

This tier is *automatic* — system writes it without the agent's input. The agent only reads it on demand. Equivalent to Hermes' `messages_fts` table.

### 1.4 Archival memory

External vector DB (or graph DB — pluggable). Tools:
- `archival_insert(content)` — agent decides what's worth long-term storage
- `archival_search(query)` — semantic retrieval

Unlike recall (raw history), archival is **agent-curated processed knowledge**. The agent extracts, distills, and writes facts here.

### 1.5 Eviction & compression

When the message buffer fills:
- ~70% of older messages are removed
- Recursive summarization: older messages have less weight in the summary, recent ones more
- The summary becomes part of the system prompt context

This matches Hermes' three-phase compression pattern but is less detailed in public docs. The key shared design: **head + tail protected, middle compressed**.

### 1.6 Sleep-time agents (Letta, 2025)

Paper: *Sleep-time Compute: Beyond Inference Scaling at Test-time* (Lin, Snell, Wang, Packer, Wooders, Stoica, Gonzalez — arXiv:2504.13171, April 2025).

**The mechanism:**

1. Sleep-time agent triggers every N steps (default `sleeptime_agent_frequency = 5`) — i.e., after every 5 primary-agent turns.
2. Sleep agent **shares memory blocks** with the primary agent — same blocks, async write access.
3. Sleep agent's job: select a memory block whose info hasn't yet been merged into the running summary, generate a `new_memory` string combining old summary + new facts + inferences, remove redundant lines, update outdated statements, write the updated string back.
4. Runs **asynchronously** — primary agent doesn't wait. Memory updates appear "for free" from the primary's perspective.

**The result:** "5× cut in live token budgets" (paper claim) by shifting the merge-and-reason work from per-turn inference to idle time. Accuracy on AIME / GSM either matched or improved.

**Configuration:**

```python
agent = client.agents.create(
    enable_sleeptime=True,
    memory_blocks=[
        {"value": "", "label": "human"},
        {"value": "You are a helpful assistant.", "label": "persona"},
    ],
    model="anthropic/claude-3-7-sonnet-20250219"
)
```

**Important — this is the SAME pattern as ClawCode's Phase 95 dreaming:**
- Idle-time trigger ✓
- Shared memory blocks ✓ (Phase 95: shared markdown vault + memory_chunks)
- Agent-decided promotions ✓ (Phase 95: `promotionCandidates` for operator review)
- Background LLM pass ✓ (Phase 95: Haiku-class default model)

ClawCode Phase 95 was designed before / independently from the Letta paper but converged on the same architecture. **Phase 115 should explicitly tie its memory redesign to Phase 95 dreaming as the sleep-time-compute leg, not propose a parallel system.**

---

## 2. Stanford Generative Agents (Park et al, 2023)

Foundational paper for "agent memory" as a concept. Three-component architecture:

### 2.1 Memory stream

Append-only log of observations. Each observation is a string with:
- `timestamp` (when it happened)
- `last_accessed` (when last retrieved)
- `importance` (0–10 score, LLM-rated at write time)
- `text` (the observation itself)

Observations include both perceptions (what the agent saw/heard) and reflections (synthesized insights — see below).

### 2.2 Retrieval — three-component scoring

When the agent needs context for a decision:

```
score(memory) = recency × importance × relevance
```

- **Recency**: exponential decay since `last_accessed`, decay factor 0.99 / hour
- **Importance**: the LLM-rated 0–10 score from write time
- **Relevance**: cosine similarity between memory embedding and current query embedding

Top-k by score → injected into prompt. **`last_accessed` is updated on retrieval** — frequently-used memories stay fresh.

### 2.3 Reflection

Periodic background pass: when the sum of importance scores of recent observations crosses a threshold, the agent runs a reflection step:
1. Generate the top-3 most salient questions from recent memory
2. For each question, retrieve relevant memories
3. Generate insights as new (synthesized) observations, written back to the stream with their own importance/timestamp

Reflections are themselves retrievable. Recursive — reflections can reference earlier reflections.

### 2.4 What's worth copying for ClawCode

- **Importance score at write time** — cheap LLM call, makes retrieval rankings dramatically better than recency-only
- **Updating `last_accessed` on retrieval** — keeps useful old memories from decaying
- **Reflection as a write of higher-order observations into the same store** — not a separate "reflections" table, just tagged observations. Operationally simple.
- **Threshold-based reflection trigger** — fires when importance accumulates, not on a clock. Matches workload.

### 2.5 What's NOT worth copying

- The 0.99/hour decay constant — far too slow for an agent that runs continuously. ClawCode would want hours-to-days timescale, not an instantaneous decay over a 1.5-hour simulation.
- 0–10 importance from a single LLM call is noisy. Letta-style agent-curated tiers are more robust.

---

## 3. Reflexion (Shinn et al, 2023)

A different angle: not memory storage, but **memory of failures** for self-improvement.

### 3.1 The pattern

After a task ends (success OR failure), the agent generates a *reflection* — a verbal self-critique of what went wrong / right. Reflections are stored and **prepended to the system prompt** on the next attempt at a similar task.

Storage shape: a list of textual reflections, optionally indexed by task type.

### 3.2 Relevance to ClawCode

Marginal for the wedge problem — Reflexion is about iterative task retry, not multi-session continuity across diverse interactions. **Skip in synthesis** unless ClawCode wants a dedicated "lessons learned from past task failures" surface (which would be small, auditable, and would cost <2K tokens to inject).

---

## 4. Rolling-summarization chain

The simplest non-trivial pattern. Used by ChatGPT, Hermes context_compressor, Letta recall eviction, MemGPT main-context compression.

### 4.1 The shape

```
turn N:
  prompt = static_system_prompt
         + rolling_summary_v(N-1)
         + recent_messages[N-K : N]
         + user_message_N

after turn N:
  rolling_summary_vN = LLM_summarize(rolling_summary_v(N-1) + recent_messages[N-K : N-K+1])
  // add the oldest message in the recent window into the summary,
  // keep recent_messages[N-K+1 : N] alive
```

### 4.2 Failure modes

- **Information decay.** Each summarization pass is lossy; details compound-erode. After N passes, specific facts become wrong or fabricated.
- **No keyword recall.** Summary is fluent but doesn't hit specific names/IDs. A hybrid layer (FTS5 over the original messages OR a per-fact extracted layer) is required.
- **Drift.** The summary slowly mutates from "what happened" toward "what the LLM thinks should have happened."

### 4.3 Mitigations (all observed in production systems)

- **Hermes**: structured summary format with mandatory sections (Active Task, Goal, Completed Actions, etc.) — constrained format slows drift
- **Hermes**: head + 20K-token tail never compressed
- **Letta**: archival memory tier holds *facts*, not summary text — facts are individually retrievable so summary erosion doesn't lose them
- **Iterative summary** (Hermes): each compression updates the previous summary rather than re-summarizing the original — preserves prior structure

### 4.4 Verdict

**Necessary but not sufficient.** Rolling summary handles "this very long single-session conversation"; it does NOT handle "what happened across sessions over months." Pair with FTS5 + agent-curated tier (Letta core / Hermes MEMORY.md).

---

## 5. Episodic vs semantic memory separation

A pattern that appears under different names across systems:

| System | "Episodic" tier | "Semantic" tier |
|--------|-----------------|-----------------|
| Letta | recall_memory (raw conversation history) | archival_memory (curated facts in vector DB) |
| Hermes | `messages` + FTS5 | MEMORY.md / USER.md / Honcho peer card |
| Generative Agents | observations | reflections |
| Mem0 | conversation history (impl-detail) | extracted natural-language facts |
| Cognee | session memory | permanent memory (knowledge graph) |
| ChatGPT | conversation summaries | stored facts ("dossier") |

**Insight:** every successful system has both. Episodic is cheap to write (capture everything), expensive to retrieve (search at query time). Semantic is expensive to write (LLM extraction / curation), cheap to retrieve (always-injected or top-k).

For ClawCode's wedge: the failure is on the *semantic* side — too much always-injected. Fix: bound semantic, push the rest into episodic that the agent searches on demand.

---

## 6. Sleep-time compute / autonomous reflection — the convergence

Three independent designs, same pattern:

| System | Trigger | Acts on | Output |
|--------|---------|---------|--------|
| Generative Agents reflection | importance threshold accumulated | recent observations | new high-level observations (recursive) |
| Letta sleep-time agent | every N primary turns (default 5) | shared memory blocks | rewritten block content |
| ClawCode Phase 95 dreaming | per-agent idle window (default 30min) | recent memory chunks + MEMORY.md + session summaries | new wikilinks (auto), promotion candidates (operator-review), themed reflection, suggested consolidations |

**All three:** async, reads recent + summarizes + writes back into same memory tier the agent uses. None is keyword/vector-tuned consolidation; all rely on the LLM's own structuring sense.

**Phase 115 implication:** ClawCode already has the dreaming primitive. Phase 115 should redesign the **inputs** to dreaming (which memory tiers it reads, which it writes), not propose dreaming as new infrastructure.

---

## 7. Patterns to copy / patterns to skip

### Adopt for Phase 115

| Pattern | Source | Why |
|---------|--------|-----|
| Bounded in-context tier with structurally enforced char_limit | Letta core blocks, Hermes 20K cap | Direct fix for 33K append failure |
| Tool-mediated retrieval for unbounded tier | Letta archival_search, Hermes session_search, Mem0 retrieval | Agent loads only what's relevant per turn |
| Episodic + semantic split | All systems | Episodic = full-history FTS5; semantic = curated MEMORY.md |
| Importance-scored writes | Generative Agents | Cheap LLM call, big retrieval-quality win |
| Reflection as recursive memory writes | Generative Agents | Phase 95 already does this — keep |
| Async sleep-time consolidation | Letta, Phase 95 | Already in place; keep tying to it |
| Iterative structured summary (sections, not free-form) | Hermes | Slows drift, easier to validate |
| `last_accessed` updated on retrieval | Generative Agents | Prevents useful-but-old from decaying |

### Don't adopt

| Pattern | Source | Why |
|---------|--------|-----|
| 0.99/hour exponential decay | Generative Agents | Wrong timescale for persistent agents — would forget yesterday |
| Single-block character limit (one bucket) | Naive MemGPT | Letta's per-block limits are better; multiple semantic categories with their own budgets |
| Hardwired memory backend | Pre-v0.7 Hermes | Don't pre-bake — at minimum keep a `MemoryProvider` ABC |
| Per-task reflection only | Reflexion | Multi-session continuity needs per-time reflection too |
| Vector-only retrieval | Pure Mem0 | Hybrid (FTS5 + vector) is empirically better at scale |

---

## 8. Open questions for Phase 115 implementation

1. **What's the bounded-tier budget for ClawCode?** Hermes uses 20K chars; Letta uses per-block configurable. ClawCode's wedge fired at 33K → so the cap should be well below that, AND the cap must be enforced before append. Suggest 16K total across SOUL.md + MEMORY.md + USER.md as a starting budget.

2. **How is overflow handled?** Hermes head/tail truncates. Letta block-level errors out and forces the agent to compact. ClawCode has dreaming — overflow could *trigger* a dream pass to consolidate, returning the bounded tier under budget by next assembly.

3. **What lazy tools does the agent get?**
   - Minimum: `clawcode-memory-search` (FTS5 + vector hybrid)
   - Phase 95-aligned: `clawcode-memory-recall-by-link` (follow wikilinks)
   - Letta-aligned: `clawcode-archival-insert` (agent-curated promotions)

4. **Is there a per-block char_limit OR a per-tier total?** Letta uses per-block for fine-grained control. Hermes uses per-file. Recommend per-tier total with a head/tail truncation fallback for the file overflow case AND a per-block warning for the Letta-style structured case.

5. **Where does the cache breakpoint go?** Anthropic prompt caching is in play. Static identity (SOUL.md if rendered immutably) before the breakpoint; dynamic Honcho-style snippet (recent reflections, current focus) after.

---

## Sources

- [Letta MemGPT concepts](https://docs.letta.com/concepts/memgpt/) — tier definitions
- [Letta sleep-time agents guide](https://docs.letta.com/guides/agents/architectures/sleeptime/) — `sleeptime_agent_frequency = 5`, shared memory blocks
- [Sleep-time compute paper](https://arxiv.org/html/2504.13171v1) — Lin, Snell, Wang, Packer, Wooders, Stoica, Gonzalez (April 2025)
- [Letta blog: Agent Memory](https://www.letta.com/blog/agent-memory) — four-tier architecture
- [MemGPT paper: Towards LLMs as Operating Systems](https://www.leoniemonigatti.com/papers/memgpt.html) — original OS analogy
- Park et al, *Generative Agents: Interactive Simulacra of Human Behavior* (2023) — recency × importance × relevance, reflection mechanism
- Shinn et al, *Reflexion* (2023) — verbal self-critique pattern
- [DEV.to comparative deep-dive (2026)](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3) — synthesis perspective
- Internal: `.planning/phases/95-memory-dreaming-autonomous-reflection-and-consolidation/95-CONTEXT.md` — ClawCode's dreaming design (independently arrived at sleep-time-compute pattern)
