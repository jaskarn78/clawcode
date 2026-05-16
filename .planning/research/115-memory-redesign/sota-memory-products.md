# SOTA: Production Agent-Memory Products & Consumer-Grade Memory

**Researched:** 2026-05-07
**Coverage:** Mem0, Zep (Graphiti), A-MEM, Cognee, plus consumer-grade (ChatGPT, Claude memory tool, Claude Code Session Memory).
**Confidence:** HIGH for ChatGPT and Claude memory tool (official docs); MEDIUM for Mem0/Zep/Cognee (vendor-published — benchmark wars suggest some claims should be treated cautiously).

---

## TL;DR

The production landscape splits cleanly:

- **Consumer-grade**: extracted-facts injected as a separate always-on block + conversation summaries. Not RAG. (ChatGPT, Claude memory tool — file-based.)
- **Production B2B agent memory**: vector + graph + temporal validity windows. Tool-callable. Async writes. (Mem0, Zep, Cognee.)
- **No clear benchmark winner.** Vendor-published results disagree wildly. Don't choose by benchmark — choose by architecture fit.

For ClawCode at 11 agents × ~10K-100K memories per agent, the consumer-grade pattern is a closer fit than the B2B pattern. Vector DBs are overkill at this scale; FTS5 + structured markdown gets >90% of the value at <10% of the operational cost.

---

## 1. Mem0 — fact extraction + LLM-judge dedup

Source: arXiv:2504.19413v1 (April 2025).

### 1.1 Storage

Dense **natural-language text facts**. Not vectors-as-primary. Not graphs.
- Base Mem0: ~7K tokens stored per conversation
- Mem0^g (graph variant): ~14K tokens, adds entity-relationship triplets

Compare Zep at 600K+ tokens per conversation (massive — see §2). Compare full-context (no memory) at 26K tokens per conversation.

### 1.2 Write pipeline

**Trigger:** every new message pair `(m_{t-1}, m_t)`. Incremental, not session-end.

**Extraction:** an LLM extractor `φ` receives:
- Global summary `S`
- Recent message window `m=10`
- Current exchange

Returns candidate facts `Ω` as natural-language strings.

**Dedup via LLM-judge:** for each candidate fact, retrieve top `s=10` similar memories via vector embedding, present to an LLM via function-calling. LLM picks one of:
- `ADD` — new fact, no semantic equivalent
- `UPDATE` — existing memory should be augmented
- `DELETE` — contradicts existing, remove that one
- `NOOP` — nothing to do

This is **the most distinctive Mem0 pattern**: dedup is an LLM call, not a similarity threshold or hard rule.

### 1.3 Retrieval

Vector similarity. At query time returns memories matching the semantic profile. The paper doesn't fully spec retrieval — it's primarily about the write-side fact extraction.

**Injection budget**: Mem0 retrieves on average **1764 tokens** per turn (vs full-context's 26K). p50 search latency 0.148s. **91% lower p95 latency** than full-context.

### 1.4 What's worth copying for ClawCode

- **LLM-judge dedup** is interesting in concept. In practice, expensive at scale (LLM call per write × 11 agents × hundreds of writes/day = real money).
- **Fact extraction with explicit categories** (`ADD`/`UPDATE`/`DELETE`/`NOOP`) is a useful constraint. Cleaner than letting the LLM emit freeform memory updates.
- **Inject ~2K tokens per turn, not everything** — direct counterpoint to ClawCode's 33K append.

### 1.5 What's not worth copying

- Cloud-only by default (lock-in)
- Vector-required by design — overkill for 10K memories
- Fact-extraction LLM call on every turn doubles inference cost

---

## 2. Zep — Graphiti temporal knowledge graph

Source: getzep.com, blog dispute with Mem0.

### 2.1 Storage

**Temporal knowledge graph.** Entities have validity windows (`valid_from`, `valid_to`). Edges represent relationships. Conversation episodes are stored as graph updates rather than text dumps.

Backend: Graphiti, Zep's open-source temporal-graph engine.

### 2.2 Retrieval

**Hybrid:**
- Semantic embeddings (vector)
- BM25 keyword search
- Graph traversal (hop through entities)

Concurrent search, p95 latency 0.632s with proper config.

### 2.3 What sets it apart

- **Temporal reasoning.** "What did the user prefer in March vs May?" is a first-class query. Validity windows let the graph express "this fact was true then, this fact is true now."
- **Entity resolution at write time.** When the user mentions "Alice" again, Graphiti links to the existing Alice entity rather than creating a new one. This is the same problem ClawCode hit in Phase 99 (memory-translator-and-sync-hygiene) — entity dedup across natural-language utterances is hard.

### 2.4 The benchmark dispute

LOCOMO scores: Zep originally claimed 84%, Mem0 corrected to 58.44%, Zep counter-claimed 75.14%. Both vendors contest the other's methodology. **Don't trust either headline number.** What's verifiable: Zep is more capable on **temporal reasoning** queries; Mem0 is leaner on **storage cost**.

### 2.5 ClawCode applicability

Zep's pattern is overkill for ClawCode's scale:
- Each agent stores 10K-100K memories. Not millions.
- ClawCode's wikilinks (Phase 36-41 auto-linker) already provide a lightweight graph.
- Adding a real graph backend would require Postgres + Graphiti — a service ClawCode currently does not run.

**Verdict: skip.** The temporal-reasoning capability is real but doesn't address Phase 115's wedge.

---

## 3. A-MEM

Source: comparative benchmarks via DEV.to and Cognee blog.

A-MEM lags by **>25 points** in J-score on LOCOMO vs Mem0/Zep/Letta. The gap is attributed to "fine-grained, structured memory indexing" being absent — A-MEM uses simpler retrieval.

**No standout architectural pattern unique to A-MEM.** Skip.

---

## 4. Cognee — knowledge-graph memory with ECL pipeline

Source: cognee.ai, github.com/topoteretes/cognee.

### 4.1 ECL pipeline

**Extract → Cognify → Load**

1. **Add (Ingest)**: `cognee.add()` — extracts text, flattens JSON, dedupes, stores in Cognee/LanceDB.
2. **Cognify (Graph + Embeddings)**: `cognee.cognify()` — extracts entities and relationships, builds triplets, chunks text, generates embeddings. With `temporal_cognify=True` adds time-aware facts.
3. **Memify (Optimize)**: `cognee.memify()` — prunes stale nodes, strengthens frequent connections, reweights edges. Incremental — graph evolves as new data arrives.
4. **Search**: `cognee.search()` — mixes vector + graph traversal.

### 4.2 Two-layer split

- **Session memory** — short-term working memory for agents. Loads relevant embeddings + graph fragments into runtime context.
- **Permanent memory** — long-term knowledge artifacts: user data, interaction traces, external documents, derived relationships. Continuously cross-connected in the graph while remaining linked to vector representations.

### 4.3 ClawCode applicability

Cognee's `Memify` step is the most novel idea: **active graph-pruning** as a recurring background pass. Not just adding nodes but actively removing/reweighting them based on access patterns.

For ClawCode this maps cleanly to Phase 95 dreaming + a yet-to-implement pruning step. Worth flagging as a future enhancement (Phase 115+1).

The full Cognee stack (LanceDB + graph backend) is too heavy. Pattern, not product.

---

## 5. ChatGPT memory architecture (April 2025 onwards)

Source: OpenAI help center, reverse-engineering writeups (Embrace The Red, llmrefs, manthanguptaa).

### 5.1 Four-layer context window

Per turn, ChatGPT receives:

1. **System Instructions** (model behavior)
2. **Developer Instructions** (custom GPT etc.)
3. **Session Metadata** (timezone, plan, current chat ID — ephemeral, not persisted)
4. **User Memory (Stored Facts)** — explicit fact dossier
5. **Recent Conversations Summary** — periodic LLM-generated summaries
6. **Current Session Messages**

**Critical:** ChatGPT does NOT use RAG against past conversations. There is no vector DB the model queries dynamically. Memory is **always-injected as text blocks**.

### 5.2 Stored facts

The model has a tool to write stable, long-term facts about the user. Example user dossier might have 33+ stored facts as enumerated bullets. Every prompt includes this dossier verbatim.

Trigger to write: model decides during a conversation that "this is worth remembering" and calls the memory-write tool.

### 5.3 Conversation summaries

OpenAI periodically generates dense, AI-written summaries from conversation history. Hundreds of past conversations get condensed into detailed paragraphs. These are injected on top of (not replacing) stored facts.

### 5.4 Why this matters for ClawCode

This is the **simplest workable cross-session memory that scales to a billion users**. No RAG, no vectors, no graph. Just:
- Extracted facts (a finite list)
- Conversation summaries (lossy, periodic)
- Always-injected as text

For ClawCode at 11 agents, this is closer to fit than any B2B product. The 33K-char wedge is exactly what happens when the always-injected layer grows unbounded — ChatGPT presumably caps the dossier at some character count and forces compaction. ClawCode needs the same cap.

---

## 6. Claude memory tool (Anthropic native, beta `memory_20250818`)

Source: `platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool` (full doc fetched).

### 6.1 The contract

A **client-side tool** the agent calls to manage files in `/memories`. Anthropic provides the *interface*; the application provides the *backend* (filesystem, DB, encrypted store, whatever).

Six commands:
- `view` — list directory or read file (with optional line range)
- `create` — new file
- `str_replace` — text replace in a file
- `insert` — insert text at a specific line
- `delete` — file or directory
- `rename` — move/rename

### 6.2 The protocol

System prompt automatically includes:

```
IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE.
MEMORY PROTOCOL:
1. Use the `view` command of your `memory` tool to check for earlier progress.
2. ... (work on the task) ...
   - As you make progress, record status / progress / thoughts etc in your memory.
ASSUME INTERRUPTION: Your context window might be reset at any moment, so
you risk losing any progress that is not recorded in your memory directory.
```

The agent is **not given memory contents in the prompt**. It must call `view /memories` at the start of every task to discover what's there. **Pure lazy-load.**

### 6.3 Pattern: "just-in-time context retrieval"

> "This is the key primitive for just-in-time context retrieval: rather than loading all relevant information upfront, agents store what they learn in memory and pull it back on demand. This keeps the active context focused on what's currently relevant."
> — Anthropic memory tool docs

### 6.4 Pairs with compaction

Anthropic's compaction (server-side conversation summarization at context-window approach) + memory tool:
- Compaction handles "this very long conversation" — server-side
- Memory tool persists important info **across** compaction boundaries
- Agent re-reads memory directory after a compaction to recover state

### 6.5 ClawCode applicability — VERY HIGH

This is the closest production-shipped pattern to what Phase 115 should ship:

| Anthropic memory tool | ClawCode equivalent |
|-----------------------|---------------------|
| `/memories` directory | `~/.clawcode/agents/<agent>/memory/` markdown vault (already exists) |
| `view`, `create`, `str_replace`, `insert`, `delete`, `rename` commands | Existing Phase 36-41 memory tools, slightly extended |
| Always-view-on-start prompt protocol | Static SOUL.md + a "check your memory directory at session start" instruction in the system prompt |
| Pairs with server-side compaction | ClawCode already has compaction.ts |
| Path traversal protection (`/memories` only) | Same — agent can only touch its own workspace |

**Concrete recommendation:** Phase 115 should consider modeling its memory tool surface on Anthropic's `memory_20250818` API. Even if the implementation is bespoke, the *contract* the agent sees should be familiar — the agent already knows this protocol from training.

---

## 7. Claude Code Session Memory

Source: `claudefa.st/blog/guide/mechanics/session-memory`, `code.claude.com/docs/en/memory`.

### 7.1 What it does

Native auto-memory in Claude Code (since v2.0.64, prominently visible from v2.1.30/v2.1.31 in early 2026). Watches conversations, extracts important parts, saves structured summaries to disk WITHOUT user input.

### 7.2 Storage

`~/.claude/projects/<project-hash>/<session-id>/session-memory/summary.md`

One directory per session. Each summary is a structured markdown file. Accumulates over time, building per-project session history.

### 7.3 Distinction from CLAUDE.md

- **CLAUDE.md**: user-written, persistent project context. Manual.
- **Session Memory**: agent-written, auto. "Build commands, debugging insights, architecture notes, code style preferences, workflow habits."

The two layers complement: CLAUDE.md = operator's intent, Session Memory = agent's accumulated observations.

### 7.4 Constraints

Available only on first-party Anthropic API. Bedrock / Vertex / Foundry users don't get it.

### 7.5 ClawCode mapping

ClawCode runs on Claude Code. Claude Code's Session Memory is layered ON TOP of whatever ClawCode does. **ClawCode's Phase 115 memory should NOT duplicate Session Memory.** Specifically:
- Don't write per-session auto-summaries (Claude Code does this for free)
- DO consolidate multi-session insights into MEMORY.md (Claude Code's per-session summaries don't automatically merge)
- DO expose ClawCode memory to the Claude Code agent via tool calls — both layers visible to the model

---

## 8. Comparison matrix: which pattern for ClawCode?

| System | Storage | Always-injected | Lazy-load | Async writes | Backend complexity | Fit for ClawCode wedge |
|--------|---------|-----------------|-----------|--------------|--------------------|------------------------|
| ChatGPT | Facts dossier + summaries | YES (capped) | NO | YES | Low (text + LLM) | High |
| Claude memory tool | `/memories` filesystem | NO | YES (every command) | App-defined | Low (fs) | Very high |
| Claude Code Session Memory | Per-session summary.md | NO | YES (re-read at start) | YES | Low (fs) | Already inherited |
| Hermes | MEMORY.md + FTS5 + Honcho | Bounded (20K cap) | YES (FTS + tools) | YES | Low to medium (SQLite) | Very high |
| Letta | Core blocks + recall + archival | Bounded (per-block char_limit) | YES (multiple tools) | YES | Medium (vector DB) | High pattern, medium impl |
| Mem0 | Extracted facts + vectors | YES (~2K tokens) | YES | YES | Medium (vector + LLM) | Medium |
| Zep | Temporal knowledge graph | NO (tool-fetched) | YES | YES | High (Postgres + Graphiti) | Low (overkill) |
| Cognee | Vector + graph + ECL pipeline | NO (tool-fetched) | YES | YES | High (LanceDB + graph) | Low (overkill) |
| A-MEM | Simpler retrieval | varies | YES | YES | Low | Skip (worse on benchmarks) |

**Best architectural fit for ClawCode at 11 agents × tens-of-thousands of memories:**
1. Anthropic memory tool contract (interface)
2. Hermes layout (MEMORY.md + SOUL.md + USER.md + SQLite FTS5)
3. ChatGPT-style fact dossier with hard char cap (always-injected portion)
4. Letta-style tier names for the agent's mental model

This composition is what `sota-synthesis.md` should pull together.

---

## 9. State of agent memory, May 2026

Themes from the 2026 comparison articles:

1. **The "memory layer" is the new "vector store" of 2024.** Every framework now ships one or claims to integrate with one.
2. **Benchmark wars are unreliable.** Vendor-published LOCOMO and LongMemEval scores have diverged 25+ points between competing claims. Trust the architecture, not the headline number.
3. **Tool-mediated retrieval is the consensus winner.** Pure always-inject is dead at production scale.
4. **Knowledge graphs have niche dominance.** When entity-tracking and temporal reasoning matter, Zep/Graphiti/Cognee win. For most chat-style agents, FTS5 + facts is enough.
5. **Sleep-time / async consolidation is rapidly adopted.** Letta, Cognee Memify, Hermes Honcho async writes — the production answer to "expensive memory ops" is "do them when nobody's looking."
6. **Pluggable memory provider ABCs are appearing in agent frameworks.** Hermes shipped one in v0.7.0. LangChain/LangGraph have similar abstractions in `langmem`. The lock-in concern around any single vendor is being designed out.

---

## Sources

- [Mem0 paper (arXiv:2504.19413)](https://arxiv.org/html/2504.19413v1)
- [Zep blog: Is Mem0 Really SOTA](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
- [Cognee architecture overview](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory)
- [State of AI Agent Memory 2026 (Mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Cognee AI memory tools evaluation](https://www.cognee.ai/blog/deep-dives/ai-memory-tools-evaluation)
- [DEV.to 2026 benchmark comparison](https://dev.to/varun_pratapbhardwaj_b13/5-ai-agent-memory-systems-compared-mem0-zep-letta-supermemory-superlocalmemory-2026-benchmark-59p3)
- [ChatGPT memory reverse-engineered (Embrace The Red)](https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/)
- [How ChatGPT memory works (llmrefs)](https://llmrefs.com/blog/reverse-engineering-chatgpt-memory)
- [OpenAI memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
- [Anthropic memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Claude Code Session Memory](https://claudefa.st/blog/guide/mechanics/session-memory)
- [Claude Code memory docs](https://code.claude.com/docs/en/memory)
- [Anthropic context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
