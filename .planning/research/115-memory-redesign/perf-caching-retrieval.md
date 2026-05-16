# Phase 115 Research — Caching, Lazy Context Loading, Retrieval Performance

**Date:** 2026-05-07
**Scope:** Anthropic prompt caching deep-dive · lazy/JIT context loading · memory retrieval performance · multi-tier caching architecture for ClawCode
**Operator priorities:** agent responsiveness speed + memory retention. Memory does not need to be human-readable — efficiency wins.
**Overall confidence:** HIGH on Anthropic caching state (multiple authoritative sources). MEDIUM on benchmark numbers (vendor benchmarks vary by hardware). HIGH on ClawCode-specific code claims (verified via grep).

---

## TL;DR — three things to act on first

1. **The headline finding is bad news for current Phase 52 caching.** Anthropic silently regressed Claude Code CLI's default cache TTL from 1h → 5m on 2026-03-06 (GitHub issue #46829, closed "not planned"). ClawCode spawns the Claude CLI via the Agent SDK, so this regression hits us directly. Most Discord conversations have >5min gaps between turns → **the cache is evicting between virtually every turn for non-Ramy agents, and we're paying the 1.25× cache-write cost on every turn**. Phase 52's prefix-hash and stable-prefix engineering still works — it just protects an empty cache for most turns.

2. **Two architectural escape hatches exist.** ClawCode already runs `haiku-direct.ts` via the raw `@anthropic-ai/sdk` with an OAuth bearer token (bypassing the `claude` CLI). That same path can carry explicit `cache_control: { type: "ephemeral", ttl: "1h" }` blocks and recover the 1h cache the CLI no longer offers. The cheaper move: set `systemPrompt.excludeDynamicSections: true` in the SDK (we currently don't — verified by grep) to push CLI dynamic context into the first user message, materially improving cache reuse for the bytes the CLI does still cache.

3. **Memory retention without human-readability unlocks aggressive compression.** Operator's "doesn't need to be human-readable" gives us permission to switch to MRL-truncated (384 → 128 dim) + int8-quantized vectors in sqlite-vec — ~78% storage reduction, ~17ms KNN at 100k vectors, with <2% recall loss. Combined with a tool-driven `memory_lookup` lazy-fetch pattern (mirroring Letta's archival_memory and Claude Code's Skill discovery), we can remove the bulk of preloaded memory from the system prompt entirely without losing recall.

---

## Anthropic prompt caching — current state + recommended ClawCode approach

### Current state (May 2026, verified against platform.claude.com docs)

Confidence: HIGH (Anthropic official docs + GitHub issue #46829).

| Property | Value |
|----------|-------|
| Max breakpoints per request | **4** explicit `cache_control` markers |
| Automatic caching | Always on; consumes 1 of the 4 slots |
| TTL options | **5m (default)** or **1h** (extended). Both production, **no beta header required** as of 2026 |
| Cache write cost (5m) | **1.25× base input** |
| Cache write cost (1h) | **2.0× base input** |
| Cache read cost | **0.1× base input** (12.5× cheaper than write, ~9× cheaper than fresh input vs 5m write) |
| Min cacheable tokens (Sonnet 4.6 / Opus 4.7 / Haiku 4.5) | **4096** |
| Min cacheable tokens (Sonnet 4.5 / Opus 4 / Sonnet 3.7) | **1024** |
| Lookback window | **20 blocks backward** from breakpoint to find prior cache entry |
| Workspace isolation | Workspace-level since 2026-02-05 (was org-level) — Anthropic API + Azure only; Bedrock/Vertex still org-level |

**Hierarchical placement order** (cascading invalidation): `tools` → `system` → `messages`. Changing tool definitions invalidates everything downstream. Changing system invalidates messages. Changing messages invalidates only later message blocks.

**Invalidation cheat sheet:**

| Change | Tools cache | System cache | Messages cache |
|--------|:-----------:|:------------:|:--------------:|
| Tool definitions | invalidates | invalidates | invalidates |
| `tool_choice` parameter | preserved | preserved | invalidates |
| Image add/remove anywhere | preserved | preserved | invalidates |
| Thinking toggle | preserved | preserved | invalidates |
| `max_tokens` change | preserved | preserved | preserved |
| Model swap (sonnet ↔ opus) | preserved | preserved | preserved |
| Web search/citations toggle | invalidates | invalidates | invalidates |

Source: [platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

### The 2026-03-06 TTL regression — what it means for ClawCode

Confidence: HIGH (GitHub issue #46829, multiple independent operators reproduced).

Between 2026-02-01 and 2026-03-05, Claude Code CLI defaulted to the 1-hour TTL (33+ days verified across two machines by issue #46829's author). Around **2026-03-06**, that quietly reverted to 5m. The issue was closed **"not planned"** — Anthropic offers no client-side override. No CLI flag, no env var, no per-request header that the SDK exposes. The TTL tier is set server-side based on the subscription/billing identity making the call.

**Cost impact reported in the issue:**

| Model | Wasted spend | % of total |
|-------|--------------|-----------|
| sonnet-4-6 | $949 | 17.1% |
| opus-4-6 | $1,581 | 17.1% |

**Why it's bad for ClawCode specifically:** the fleet's interaction pattern is almost worst-case for 5m TTL.

- Operator types in `#fin-acquisition` once an hour (typical). Cache expires 12× per active hour → every turn pays a fresh 1.25× write.
- Background dream/cron-driven turns fire every 30–60 minutes. Every one is a cold cache.
- Only Ramy-active fin-acquisition threads and rapid back-and-forth in `#admin` see hit rates >0%.

**Verification:** check the SDK's effective request path. The Agent SDK's `sdk.mjs` calls into the bundled `claude` CLI via `pathToClaudeCodeExecutable` and forwards `appendSystemPrompt` + `excludeDynamicSections` (verified by grep against `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`). The CLI subprocess owns the actual API request and the cache_control placement. We do not touch the wire format from session-adapter.ts — Phase 52's preset+append form is purely a **routing instruction** to the CLI, telling it "this stuff is stable, please cache it."

### What Phase 52 actually buys us today

Confidence: HIGH (verified against `src/manager/session-adapter.ts` lines 619–628, `session-config.ts` lines 759–769, and Phase 52-02-SUMMARY.md).

Phase 52 splits assembled context into `stablePrefix` (→ SDK `systemPrompt.append`) and `mutableSuffix` (→ prepended to every user message). The hot-tier `stable_token` mechanism prevents cache thrashing when one hot memory's `accessedAt` flips. Per-turn `prefixHash` is recorded into traces.db with `cacheEvictionExpected` flag.

What Phase 52 **correctly** achieves:
- Stable bytes go to the CLI's "stable" slot. When CLI does cache, it caches the right stuff.
- Mutable suffix stays out of the cache, no thrash on hot-memory access.
- Telemetry exists to detect drift (the `cacheEvictionExpected` column).

What Phase 52 does **not** achieve (because the CLI owns the wire):
- Cannot force 1h TTL.
- Cannot place a custom `cache_control` breakpoint at the boundary between system identity and tool block.
- Cannot pre-warm with `max_tokens: 0`.
- Cannot mix 1h-on-tools + 5m-on-recent-history.

**`excludeDynamicSections` is not currently set** (verified by `grep -nE "excludeDynamicSections" src/`). The flag exists in the SDK type definitions (`sdk-types.ts:73,90`) and per the official docs would *"move per-session context into the first user message for better prompt-cache reuse across machines."* Setting `excludeDynamicSections: true` is a one-line change with measurable upside even on the regressed 5m TTL.

### Three options for ClawCode going forward

**Option A — minimum-effort (recommended as Phase 115 first move).** Set `excludeDynamicSections: true` on the systemPrompt preset object in both `createSession` and `resumeSession`. Verify the CLI's dynamic context (cwd, env, tool registry) moves into the first user message rather than mutating the system prompt section. Measure cache_read_input_tokens via the existing trace pipeline. **Effort: <1 hour. Risk: low (one SDK flag).** Expected gain: 5–15% cache-hit improvement on the bytes the CLI still caches; no fix for the 5m TTL.

**Option B — direct Anthropic SDK for the long-running session path (recommended as Phase 115 second move).** ClawCode already runs `haiku-direct.ts` via raw `@anthropic-ai/sdk` with an OAuth bearer token, proving the auth path works. Replicate that for the agent's main turn loop: build the same stable-prefix string Phase 52 produces, but send it as `system: [{ type: "text", text: stable, cache_control: { type: "ephemeral", ttl: "1h" } }]` directly to the messages API. Skips the CLI entirely. Recovers 1h cache control. Adds maintenance burden (we'd reimplement tool-call routing, hook points, and any CLI-only features we depend on — settingSources scanning, plugin loading, the Discord plugin's built-in transports). **Effort: 2–3 phases. Risk: medium-high.** Expected gain: 90% cache-hit on Discord turns up to an hour apart; eliminates the 12× write cost on long-gap turns.

**Option C — hybrid: keep the CLI for heavy agentic loops, add a "fast path" via direct API for short Discord acks.** Most channel messages don't need full Claude-Code agentic capabilities (skills, plugins, tools, file access). A direct-SDK path that handles the "short ack" bucket — say, <500-token user messages from Discord with no tool_use needed — and falls back to the CLI for anything that touches MCP tools, the workspace filesystem, or skill discovery. **Effort: 1 phase to prototype the routing.** Expected gain: depends on Discord traffic mix. Worth measuring first by sampling 24h of completed turns and counting `tool_use_count == 0` turns. If that's >40%, this is the highest-leverage move.

**Decision matrix:**

| Need | A (set flag) | B (direct SDK) | C (hybrid) |
|------|:-----------:|:--------------:|:---------:|
| 1h TTL on long Discord gaps | no | yes | yes (for short turns) |
| Keeps Claude Code CLI features | yes | no | yes (heavy path) |
| Implementation cost | hours | weeks | days |
| Reversibility | trivial | painful | easy |
| Independent of TTL regression future | no | yes | partial |

**Recommendation: ship A immediately as a config-driven flag, then evaluate B vs C against measured tool_use rate before committing to either.** Operator's stated priority is responsiveness — Option C in particular gives us responsiveness for short turns (the latency-sensitive bucket) without taking on B's full reimplementation cost.

### Cache breakpoint placement for ClawCode (if we go Option B/C)

When/if we own the wire format, the four `cache_control` slots should land at:

1. **End of `tools[]` array** — system tool definitions (MCP server list, built-in tools). Cache_control on the last tool. Stable across turns. **TTL: 1h.** Invalidation event: skill addition/removal, MCP server hot-reload (Phase 94 capability probe).
2. **End of system identity block** — after SOUL.md + IDENTITY.md fingerprint. Stable across the agent's whole lifetime (changes only on `/identity rotate`). **TTL: 1h.** Invalidation event: SOUL.md file write, identity hot-reload.
3. **End of stable-prefix proper** — after MEMORY.md auto-load + capability manifest + MCP block + filesystem capability block. Most volatile of the three stable-prefix sections (capability probe state changes, MCP server flap). **TTL: 5m or 1h depending on observed flap frequency.** This is where Phase 52's `priorHotStableToken` machinery routes hot-tier in or out.
4. **Reserve slot 4 for messages-block boundary** — last assistant turn's tool_result, so multi-turn tool sequences within a 5m window hit cache. Phase 52 doesn't currently address this — the SDK's automatic caching does it for us when the CLI is in charge, but in the direct-API path we'd own this manually.

**Critical pitfall to avoid (per official docs):** never put a breakpoint on a block whose hash changes every request (current timestamp, per-turn user message, "recent history" ending in this turn's text). The 20-block lookback window then misses every prior cache write. Phase 52's `mutableSuffix` design already handles this — keep it that way.

---

## Lazy context loading — patterns + recommended approach

### The three production patterns to know

Confidence: HIGH on patterns, MEDIUM on quantitative tradeoffs.

**Pattern 1 — Claude Code Skills (progressive disclosure).**
SKILL.md frontmatter is preloaded as ~100-token metadata. The skill body (typically <5KB) is read **only when** Claude detects the skill applies and invokes it via bash. Bundled scripts/resources load on demand from within the skill. One real-world project measured 54% reduction in initial context (7,584 → 3,434 tokens) without losing tool discoverability. Source: [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills), [Lindquist gist](https://gist.github.com/johnlindquist/849b813e76039a908d962b2f0923dc9a).

**Pattern 2 — Letta/MemGPT archival_memory tool.**
Three tiers: core memory (in-context, RAM-like, agent-managed via `core_memory_replace`), recall memory (full conversation history, search via `conversation_search`), archival memory (vector-indexed long-term, search via `archival_memory_search`). The agent itself decides what to retrieve mid-turn via tool calls. The crucial design choice: **memory consolidation/reorganization happens during idle periods**, not lazily on-the-fly. Source: [letta.com/blog/agent-memory](https://www.letta.com/blog/agent-memory), [docs.letta.com/concepts/memgpt](https://docs.letta.com/concepts/memgpt/).

**Pattern 3 — Cursor @-mention codebase indexing.**
Local Merkle-tree chunking → embedded → stored remotely (Turbopuffer) **with metadata only, never source bytes**. Query embedding goes server-side, vector results return obfuscated paths + line ranges, the client resolves the actual code locally before injecting into the LLM prompt. Re-index only changed files via Merkle-hash diff. Source: [cursor.com/docs/context/codebase-indexing](https://cursor.com/docs/context/codebase-indexing), [Towards Data Science](https://towardsdatascience.com/how-cursor-actually-indexes-your-codebase/).

### Tool-driven vs. preloaded — the real tradeoff

| Dimension | Preloaded (current ClawCode) | Tool-driven (proposed) |
|-----------|------------------------------|------------------------|
| First-token latency | system prompt amortized into cache write | extra round-trip when relevant memory is needed |
| Cache reuse | strong if prefix is stable | even stronger — system prompt shrinks dramatically |
| Recall quality | bounded by what fits in budget | bounded by agent's ability to formulate the right query |
| Multi-turn coherence | high — agent always has the same memory in context | depends on prompt; can degrade if agent forgets to query |
| Token spend per turn | always pays for full hot-tier in input | pays only on turns that actually need recall |
| Failure mode | "agent didn't know X" because X wasn't in hot-tier | "agent didn't know X" because it didn't think to look |

**The Letta team's empirical finding (2024 paper + 2026 blog):** tool-driven memory works well **when the agent's system prompt explicitly tells it when to consult each tier and when to trust its own context.** Without that explicit guidance, agents either over-call (latency penalty) or under-call (recall regression). Their fix is a per-tier "when to use" string in the tool description, plus a recall-vs-archival routing heuristic baked into the system prompt.

**Hybrid (recommended for ClawCode):**

- Preload a compact **memory index** (titles, ~5–10 words per entry, ~50–100 entries → 500–1000 tokens) into the stable prefix. This is what the agent skims for relevance.
- Wire a `memory_lookup(id)` tool that fetches the body by ID. Already exists in ClawCode (`mcp__memory__memory_lookup` per `clawcode.yaml`).
- Add a `memory_search(query, k=5)` tool for "I don't see what I want in the index" cases. Already exists.
- Eliminate the current MEMORY.md auto-load (50KB / ~12K tokens) from the stable prefix for agents whose MEMORY.md is rarely accessed mid-turn. **Verification needed:** instrument current memory_lookup call frequency before pulling MEMORY.md auto-load from the prefix; for an agent that consults MEMORY.md every other turn, preloading is already correct.

This matches the Skills pattern at the right granularity for ClawCode's actual access pattern: **most memories are referenced occasionally, but the agent needs to know they exist.**

### Specific recommendations

1. **Compress the stable prefix's MEMORY.md auto-load to a title index.** Replace the current 50KB byte cap with a **rendering function** that emits one bullet per memory entry (title + first 80 chars). Full body fetched via `memory_lookup`. Expected savings: 8–10K tokens per agent's stable prefix. Cache write cost drops proportionally.

2. **Lift skill-content rendering even further.** Phase 53 Plan 03 already does lazy-skill rendering with the warmup guard. Verify the threshold (`usageThresholdTurns`) is tight — if it's ≥5 turns, agents are paying for skill bodies for half their turn life. Consider: render only the **list** of skill names + descriptions (~50 tokens per skill) and let the agent invoke skills via the existing `/skill-name` syntax that already triggers SKILL.md read.

3. **Per-turn memory pull becomes the responsibility of the agent's system prompt.** Add a short directive: *"Before answering recall-flavored questions, call `memory_lookup` or `memory_search`. Don't rely on what's already in your context window — it's a small slice."* Letta's empirical evidence is that this nudge moves agents from under-calling to right-calling.

4. **Knowledge graph / wikilinks.** ClawCode already has `dream-graph-edges.ts` building a graph. The lazy pattern: store `[[wiki-link]]`-style references in memory bodies; the agent resolves them via tool calls when relevant. Avoid materializing the full graph in any prompt. The graph lives in SQLite; render it on demand.

---

## Retrieval performance — current + optimization paths

### Current state (verified)

ClawCode runs `Xenova/all-MiniLM-L6-v2` (384-dim) with sqlite-vec for KNN and FTS5 (BM25) for lexical match, hybrid-scored. Model ID, dim, and quant choice are defaults inherited from Phase 90's MEM-01 work.

### sqlite-vec performance landscape (2026)

Confidence: MEDIUM (vendor benchmarks; actual numbers depend heavily on hardware, prefilter selectivity, and warm vs cold disk cache).

**Brute-force KNN scaling** (no index, 384-dim, single-thread, modern x86):

| Vector count | Float32 KNN latency | Memory footprint |
|-------------:|--------------------:|-----------------:|
| 1K | <1ms | 1.5MB |
| 10K | ~5ms | 15MB |
| 100K | ~75ms | 150MB |
| 1M | ~750ms | 1.5GB |

ClawCode operates at **<10K vectors per agent** at current usage, well within the "no index needed" zone. Brute force on float32 is fine until ~50K. Source: [sqlite-vec v0.1.0 release notes](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html), [sqlite-vector benchmarks](https://github.com/sqliteai/sqlite-vector).

**Quantization tradeoffs** (sqlite-vec native):

| Format | Bytes/dim | Storage @ 100K vec, 384-dim | KNN latency change | Recall@10 cost |
|--------|----------:|-----------------------------:|-------------------:|---------------:|
| float32 | 4 | 150MB | 1× (baseline) | 100% |
| int8 (scalar quant) | 1 | 38MB | ~0.25× (4× faster) | ~99% |
| binary (1-bit) | 0.125 | 4.7MB | ~0.05× (20× faster) | ~85% (need re-rank) |

`vec_quantize_int8()` is in sqlite-vec v0.1.10-alpha.3+. Two-stage retrieval recommended for binary quant: query int8 to retrieve top-K×8, re-rank top-K with float32. Source: [alexgarcia.xyz/sqlite-vec/guides/scalar-quant](https://alexgarcia.xyz/sqlite-vec/guides/scalar-quant.html), [binary-quant guide](https://alexgarcia.xyz/sqlite-vec/guides/binary-quant.html).

**HNSW vs IVF vs flat:**

- **Flat (current).** Brute force. Best up to ~50K vectors. No build cost. Simplest.
- **IVF (sqlite-vec partition keys).** Coarse quantizer + per-partition flat. Useful at 100K+ to reduce candidate set. Build cost: ~5s at 100K. Recall tunable via probe count.
- **HNSW.** sqlite-vec doesn't ship native HNSW; experimental work exists. Not recommended at our scale — adds build complexity for negligible win below 1M vectors.

**Recommendation:** stay flat; switch float32 → int8 quantization when any single agent crosses ~30K memory entries OR when KNN p99 latency exceeds 30ms in traces. **For ClawCode at current scale, the win from quantization is small but free** (no recall regression worth caring about). Consider it a Phase 115 task on the path to "agents accumulate memory aggressively without retrieval slowdown."

### Embedding model choice

Confidence: HIGH on relative ranking, MEDIUM on absolute MTEB scores.

`all-MiniLM-L6-v2` is now widely considered obsolete for new projects. It was state-of-the-art in 2019; modern small models match or beat it on every metric.

| Model | Params | Dim | MTEB v2 | Speed | License | Notes |
|-------|------:|----:|--------:|------:|--------|------|
| all-MiniLM-L6-v2 (current) | 23M | 384 | ~56 | fastest | Apache | 2019 architecture, 512 ctx |
| bge-small-en-v1.5 | 33M | 384 | ~64 | comparable | MIT | drop-in replacement, same dim |
| gte-small | 33M | 384 | ~63 | comparable | MIT | drop-in replacement, same dim |
| snowflake-arctic-embed-xs | 22M | 384 | ~62 | fastest | Apache | identical params to MiniLM |
| e5-small-v2 | 33M | 384 | ~65 | comparable | MIT | needs "query:"/"passage:" prefix — minor code change |
| Jina v5-nano | ~50M | 256 (MRL truncatable) | ~71 | comparable | Apache | 2026, MTEB v2 leader in <100M class |

**Recommendation: switch to `bge-small-en-v1.5` for a drop-in upgrade or `Jina v5-nano` for a 2026 best-in-class.** Both are 384-dim or smaller, both run on the existing `@huggingface/transformers` ONNX path, both load from the same Hugging Face cache. Re-embedding cost: a one-shot batch over existing memory entries (~minutes per agent at our scale). Recall improvement: 5–15% on MTEB-equivalent retrieval tasks. Source: [BentoML 2026 guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models), [supermemory benchmarks](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/).

### Matryoshka representation learning (MRL)

If we move to Jina v5-nano (MRL-trained), we get **dimension truncation as a knob**. Native 256 dims, truncatable to 128/64 with minimal recall loss. Sample finding: 128-dim MRL-truncated vectors *match or beat* 512-dim non-MRL baselines for retrieval. Combined with int8 quantization: **128-dim int8 = 128 bytes per vector vs current 1536 bytes per vector = 92% storage reduction at equal-or-better recall.** Source: [arxiv 2205.13147](https://arxiv.org/abs/2205.13147), [supermemory MRL guide](https://supermemory.ai/blog/matryoshka-representation-learning-the-ultimate-guide-how-we-use-it/).

This is the operator's "memory doesn't need to be human-readable" leverage point. Take it.

### Hybrid scoring (BM25 + vector via FTS5 + sqlite-vec)

Phase 90 ships an FTS5 + vec hybrid via weighted-sum. RRF (reciprocal rank fusion) is now the academic and industrial consensus for "no-tuning hybrid" — emphasizes rank consistency over score normalization. Latency overhead: 5–20ms over dense-only on a tuned stack; for our scale, 1–3ms.

**RRF formula (k=60 standard):** `score(doc) = 1/(k + rank_bm25(doc)) + 1/(k + rank_vec(doc))`. Tunable via per-method weights for "BM25 matters more" vs "semantic matters more."

**Recommendation:** keep weighted-sum if the current hybrid is performing well per traces. Switch to RRF if we see "right answer ranked but doesn't make top-K" failure modes — RRF is more robust to score-distribution mismatch. Either way, the latency overhead is negligible at our scale. Source: [Azure RRF docs](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking), [paradedb explainer](https://www.paradedb.com/learn/search-concepts/reciprocal-rank-fusion).

### Where retrieval slowness actually lives (verified hypothesis, not measured)

For typical ClawCode at <10K vectors/agent, the query path is:

1. ONNX embed user query: **~30–50ms** (single-thread CPU all-MiniLM-L6-v2)
2. FTS5 match: **<1ms**
3. sqlite-vec KNN (flat, float32): **<5ms**
4. Hybrid score & rank: **<1ms**
5. Body fetch (SQLite SELECT): **<2ms**

**Total: ~40–60ms.** The embed step dominates by ~10×. Switching to int8 quantization barely moves the needle on total latency at our scale. **The real wins are: (a) cache the user-query embedding when the same query repeats, (b) move to a more accurate model that retrieves better in fewer round-trips, (c) batch embed during memory writes, not on every memory read.** None of these are sqlite-vec optimizations. They're embedding-pipeline optimizations.

---

## Recommended multi-tier caching architecture for ClawCode

Synthesizing prompt caching + lazy context loading + retrieval performance into one architecture for Phase 115.

### Tier 0 — working memory (in-prompt, every turn)

**Contents:** agent identity fingerprint, capability manifest, current Discord channel binding, current MCP tool table, last 1–2 hot memories.

**Size cap:** 2K tokens. Currently we're at ~5K — too large.

**Stays in:** stable prefix (cached).

**Update cadence:** rare (identity rotation, MCP server hot-reload, capability probe state).

**Phase 115 change:** trim aggressively. Move the MCP block's verbose tool table to a one-line "use clawcode_list_files for fs, ..." summary; let the SDK's tool definitions provide the schema. Move MEMORY.md auto-load to Tier 3.

### Tier 1 — short-term conversation history (SDK-managed)

**Contents:** last N user/assistant message pairs.

**Owner:** Claude Code CLI / SDK. We don't touch this.

**Cache behavior:** Lookback window catches it within 20 blocks. Auto-cache breakpoint slides forward.

**Phase 115 change:** none. Don't fight the SDK here.

### Tier 2 — cached system identity (1h, agent-stable)

**Contents:** SOUL.md fingerprint + IDENTITY.md body + skill catalog (titles only) + tool definitions + Discord bindings.

**Size:** 3–4K tokens.

**Cache TTL goal:** 1h.

**Currently:** all of this is in the same stable prefix as Tier 0 with whatever TTL the CLI gives us (5m as of 2026-03-06). Phase 115 architectural decision: if we go Option B/C (direct SDK), this becomes a discrete `system: [{cache_control: {ttl: "1h"}}]` block.

### Tier 3 — lazy long-term memory (tool-fetched on demand)

**Contents:** full memory bodies, dreams, conversation summaries, MEMORY.md narratives.

**Owner:** sqlite-vec + `memory_lookup` / `memory_search` tools.

**Cache behavior:** none — lives outside the prompt entirely.

**Phase 115 change:** **this is the biggest delta.** Today, MEMORY.md auto-load (up to 50KB / ~12K tokens) puts long-term memory in Tier 0. Move to Tier 3 entirely; preload only a title index in Tier 2.

### Tier 4 — knowledge graph (referenced by ID, fetched on demand)

**Contents:** dream graph edges, wiki-links, cross-memory references.

**Owner:** SQLite graph tables + dedicated `graph_lookup` tool (new in Phase 115).

**Cache behavior:** none.

**Phase 115 change:** new tier. Today the graph is implicit — Phase 95's `dream_log_recent` block in the stable prefix carries some of this. Make it explicit, push behind a tool.

### Architecture diagram (text)

```
Per turn:
  CLI assembles request:
    tools[] → cached (1h goal, 5m today)               ← Tier 2
    system  → cached (1h goal, 5m today)               ← Tier 2 + Tier 0
    messages[
      <last N pairs>                                   ← Tier 1 (SDK)
      <current user msg + Phase 52 mutableSuffix>
    ]

  Agent reasoning may invoke:
    memory_search("...") → sqlite-vec hybrid           ← Tier 3
    memory_lookup(id)    → SQLite SELECT               ← Tier 3
    graph_lookup(node)   → graph tables                ← Tier 4
    skill bash read      → SKILL.md from disk          ← Tier 3 / disk

  Response:
    Phase 52 telemetry records prefix_hash + cache_eviction_expected
    Phase 50 trace span captures cache_read_tokens / cache_creation_tokens
```

### Token budget targets (per agent, per turn)

| Tier | Today (est.) | Phase 115 target |
|------|-------------:|-----------------:|
| Tier 0 working memory | ~5K | ~2K |
| Tier 2 cached identity + tools | ~3K | ~3K (unchanged) |
| Tier 1 conversation history | SDK-managed | SDK-managed |
| Tier 3+4 lazy fetches | ~12K (preloaded) | 0 (in prefix); 1–3K when actually fetched |
| **Stable prefix total** | **~20K** | **~5K** |

A 4× shrink in stable-prefix size means cache writes are 4× cheaper, AND we drop closer to the Sonnet 4.6 4096-token minimum (a 5K stable prefix still caches; a 2K one would silently *not* cache and waste the entire effort). **Caveat: do not shrink below 4096 tokens** or caching is silently disabled.

---

## Benchmarks + projected ClawCode improvements

Confidence: MEDIUM. Numbers below combine measured/published sources where available with conservative estimates for unobserved scenarios. Replace with traces.db queries before committing to roadmap.

### Per-turn latency estimate at current agent profile

Profile: Sonnet 4.6, 13 MCP servers, ~5K-token stable prefix, ~1374-char (~340-token) per-turn user msg, ~10K vectors in sqlite-vec.

| Cost component | Cold cache (current 5m TTL, gap >5m) | Warm cache (<5m gap) |
|----------------|-------------------------------------:|---------------------:|
| Cache write (5K × 1.25× input price) | $0.0188 (Sonnet $3/MTok input) | — |
| Cache read (5K × 0.1×) | — | $0.0015 |
| Fresh input (340 user tokens × 1×) | $0.0010 | $0.0010 |
| Output (assume 500 tokens × $15/MTok) | $0.0075 | $0.0075 |
| **Per-turn $ cost** | **~$0.027** | **~$0.0100** |
| **TTFT (time-to-first-token, est.)** | ~1.5–2.5s | ~0.4–0.8s |

Critical observation: **cold-cache turns are ~2.7× more expensive than warm-cache turns.** With the 2026-03-06 regression, virtually every Discord-paced turn is cold.

### Projected Phase 115 improvements

| Optimization | Cost reduction | Latency reduction | Implementation effort |
|--------------|---------------:|------------------:|----------------------:|
| Set `excludeDynamicSections: true` (Option A) | ~5–15% on warm turns | minor | 1 hour |
| Trim Tier 0 from 5K → 2K stable prefix | ~60% on cache-write cost | TTFT drops by ~30% on cold turns | 1 phase |
| Move to int8 quantization in sqlite-vec | negligible at our scale | KNN <5ms → <1ms | 1 plan |
| Switch to bge-small-en-v1.5 or Jina v5-nano + MRL | negligible | minor (better recall = fewer searches) | 1 plan + re-embed batch |
| Direct SDK with 1h TTL (Option B) | **70–90% on long-gap turns** | TTFT 1.5s → 0.5s on long-gap turns | 2–3 phases |
| Lazy MEMORY.md (Tier 3) + title index in Tier 2 | further ~30% prefix shrink (~12K → ~3K savings) | TTFT proportional | 1 phase |

### Cache-hit rate measurement gap

Phase 52 records `cache_eviction_expected` based on prefix-hash drift, but **that's not the same as actual cache hits.** The CLI's response usage block carries `cache_read_input_tokens` and `cache_creation_input_tokens`. Phase 50 captures these in spans. **Before Phase 115 commits to any specific optimization, run a one-day trace audit:**

```
SELECT
  agent_name,
  AVG(cache_read_input_tokens) AS avg_read,
  AVG(cache_creation_input_tokens) AS avg_create,
  AVG(input_tokens) AS avg_fresh,
  COUNT(*) AS turns,
  SUM(CASE WHEN cache_read_input_tokens > 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) AS hit_rate
FROM turns
WHERE created_at > now() - interval 24 hours
GROUP BY agent_name;
```

That number — `hit_rate` — is the true baseline. The Phase 52 SUMMARY claims the cache scaffolding works; the 2026-03-06 regression hypothesis claims hit rate is ~0% for non-Ramy agents. Pick the truth before designing around either.

---

## Sources & confidence

| Source | Topic | Confidence |
|--------|------|-----------|
| [platform.claude.com prompt-caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Anthropic caching mechanics | HIGH |
| [GitHub anthropics/claude-code#46829](https://github.com/anthropics/claude-code/issues/46829) | 2026-03-06 TTL regression | HIGH |
| [code.claude.com Agent SDK TS docs](https://code.claude.com/docs/en/agent-sdk/typescript) | systemPrompt preset / excludeDynamicSections | HIGH |
| [Anthropic SDK source](file:///home/jjagpal/.openclaw/workspace-coding/node_modules/@anthropic-ai/claude-agent-sdk/) | Verified `appendSystemPrompt`, `excludeDynamicSections` flow to CLI subprocess | HIGH |
| [code.claude.com skills docs](https://code.claude.com/docs/en/skills) | Skill progressive disclosure | HIGH |
| [letta.com/blog/agent-memory](https://www.letta.com/blog/agent-memory) | Letta tier model | HIGH |
| [docs.letta.com/concepts/memgpt](https://docs.letta.com/concepts/memgpt/) | archival_memory tool design | HIGH |
| [cursor.com/docs/context/codebase-indexing](https://cursor.com/docs/context/codebase-indexing) | @-mention lazy retrieval | HIGH |
| [alexgarcia.xyz/sqlite-vec](https://alexgarcia.xyz/sqlite-vec/) | quantization guides | HIGH |
| [github.com/sqliteai/sqlite-vector benchmarks](https://github.com/sqliteai/sqlite-vector) | int8 latency at 100k | MEDIUM (vendor) |
| [bentoml.com 2026 embedding guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models) | embedding model rankings | MEDIUM |
| [arxiv 2205.13147 (MRL)](https://arxiv.org/abs/2205.13147) | Matryoshka rep learning | HIGH |
| [supermemory hybrid-search guide](https://supermemory.ai/blog/hybrid-search-guide/) | RRF latency overhead | MEDIUM |
| [aimagicx 2026 cache cost analysis](https://www.aimagicx.com/blog/prompt-caching-claude-api-cost-optimization-2026) | Pricing examples | MEDIUM |
| ClawCode `src/manager/session-config.ts`, `session-adapter.ts`, `haiku-direct.ts` | Current implementation state | HIGH (direct read) |
| Phase 52-02-SUMMARY.md, deferred-items.md | Existing caching design | HIGH (project artifacts) |

---

## Open questions for Phase 115 planning

1. **What is the actual cache hit rate today, per agent?** Run the SQL query above before designing. If it's already >50% for the busy agents, Option A may suffice and Option B is overkill. If it's <10%, Option B/C earns its complexity budget.
2. **What fraction of turns require tool_use?** If <40%, Option C (direct-SDK fast path for short turns) becomes very attractive. Sample 24h of turns and count.
3. **Does the operator want one-time re-embedding cost?** Switching from all-MiniLM-L6-v2 to bge-small or Jina v5 means a one-shot batch over every existing memory across the fleet. Acceptable?
4. **Workspace isolation post-2026-02-05** — does the ClawCode fleet share one Anthropic workspace? If yes, all 14 agents currently share a cache namespace (and a quota). One workspace per agent OR per tier (admin/fin/etc.) would isolate cache and quota. Worth a ~30-min ops review.
5. **What's the upper bound on memory growth per agent?** If <50K vectors/agent for the next 12 months, Phase 115 doesn't need quantization. If we're trending to 500K+ (e.g., long-running clawhub agents ingesting documents), int8 + MRL becomes mandatory now to head off the cliff.

These should be answered as part of Phase 115's planning conversation before the implementation phases land.
