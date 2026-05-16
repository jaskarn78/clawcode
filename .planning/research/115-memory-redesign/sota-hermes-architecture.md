# SOTA: Nous Research Hermes Agent — Memory Architecture

**Researched:** 2026-05-07
**Operator anchor:** "Hermes is our target reference"
**Confidence:** HIGH for architecture/storage layout (deepwiki + GitHub source confirmed); MEDIUM for behavioral edge cases (some pages 404, some details inferred from blog posts).

---

## TL;DR — The 7 Things ClawCode Should Copy

1. **Two-axis storage:** SQLite session DB (`hermes_state.py`) **for conversation persistence** + flat markdown files (`SOUL.md`, `MEMORY.md`, `USER.md`) **for curated context**. Two stores, two purposes — not one universal "memory store."
2. **Hard character cap on injected context files.** `CONTEXT_FILE_MAX_CHARS = 20_000`. Over budget → head/tail truncation (70/20 ratio). Structural fix for "33K append → 400 rejection."
3. **FTS5 for session search, not vectors.** Two FTS5 virtual tables (unicode61 + trigram for CJK/substring). No embeddings in the core path — the agent calls `session_search` as a tool and an LLM summarizes results when it needs cross-session recall.
4. **Pluggable external memory provider** (v0.7.0 refactor). Built-in is always on; one external (Honcho/Mem0/Supermemory/etc.) optionally layered. Memory provider is an ABC, not hardwired.
5. **Dynamic memory placed AFTER the cached system prefix** so prompt caching survives memory updates. Static prompt = cached. Honcho snippet = dynamic, post-breakpoint.
6. **Three-phase context compression triggered at 50% of context window:** (a) replace old tool outputs with 1-line summaries (no LLM), (b) protect head + ~20K-token tail, (c) LLM-summarize the middle into a structured summary.
7. **Async write frequency by default.** `write_frequency: "async"` — memory updates flush via background queue, do not block the turn. Failure of memory backend never wedges the agent.

---

## 1. Storage layout

### 1.1 SQLite session database — `hermes_state.py`

**Schema version 11** (current). Two real tables + two FTS5 virtual tables.

#### `sessions` table — one row per conversation session

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Session UUID |
| `source` | TEXT | `cli`, `telegram`, `discord`, `tui`, etc. |
| `user_id` | TEXT | Per-platform user identifier |
| `model` | TEXT | LLM model ID at session start |
| `model_config` | TEXT (JSON) | Model parameters |
| `system_prompt` | TEXT | Verbatim system prompt for this session |
| `parent_session_id` | TEXT | Compression chain — links a continued session back to its predecessor |
| `started_at`, `ended_at` | REAL | Unix timestamps |
| `end_reason` | TEXT | Why the session ended |
| `message_count`, `tool_call_count` | INT | Counters |
| `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens` | INT | Token accounting |
| `billing_provider`, `billing_base_url`, `billing_mode` | TEXT | Cost tracking |
| `estimated_cost_usd`, `actual_cost_usd`, `cost_status`, `cost_source` | mixed | Cost reconciliation |
| `pricing_version` | TEXT | Pricing snapshot used |
| `title` | TEXT | Auto-generated; uniqueness enforced via `idx_sessions_title_unique` |
| `api_call_count` | INT | Counter |

#### `messages` table — one row per turn

| Column | Type | Notes |
|--------|------|-------|
| `id` | INT PK AUTOINCREMENT | |
| `session_id` | TEXT FK → sessions(id) | |
| `role` | TEXT | `user`, `assistant`, `tool`, `system` |
| `content` | TEXT | Raw message body |
| `timestamp` | REAL | Unix timestamp |
| `tool_call_id`, `tool_calls` (TEXT JSON), `tool_name` | mixed | Tool dispatch metadata |
| `token_count`, `finish_reason` | mixed | Per-message accounting |
| `reasoning`, `reasoning_content`, `reasoning_details` | TEXT | OpenAI reasoning models |
| `codex_reasoning_items`, `codex_message_items` | TEXT | OpenAI Responses API blob |

#### Indexes

- `idx_sessions_source` (source)
- `idx_sessions_parent` (parent_session_id) — walking compression chains
- `idx_sessions_started` (started_at)
- `idx_messages_session` (session_id, timestamp) — the workhorse for replay
- `idx_sessions_title_unique` (title) — per-source uniqueness

#### FTS5 virtual tables

```
messages_fts            -- tokenizer: unicode61
  indexes: content + tool_name + tool_calls

messages_fts_trigram    -- tokenizer: trigram
  purpose: CJK + arbitrary-substring search
  rationale: unicode61 splits on word boundaries that don't exist in
             logographic scripts; trigram gives 3-byte sliding-window matches
```

Triggers auto-sync both FTS tables on INSERT/UPDATE/DELETE of `messages`.

### 1.2 Concurrency model

Hermes runs **multiple processes** writing to the same `state.db` (CLI, gateway, telegram adapter, discord adapter, cron jobs). Single SQLite file, WAL mode, application-level retry:

- **WAL mode**: concurrent readers + one writer
- **`BEGIN IMMEDIATE`** at transaction start to acquire WAL write lock predictably
- **Retry on lock contention** with random jitter 20–150ms (not deterministic backoff — avoids convoy effects)
- `_WRITE_MAX_RETRIES = 15`
- `_CHECKPOINT_EVERY_N_WRITES = 50` — passive WAL checkpoint to bound WAL file growth

This pattern is directly applicable to ClawCode running 11 concurrent agents on one host. ClawCode currently does per-agent SQLite (no contention) — but if cross-agent search is ever needed, this is how Hermes did it.

### 1.3 Markdown context files — the "always-injected" tier

Three files per profile, in `~/.hermes/memories/` (or platform-specific subdirs):

- **`SOUL.md`** — agent identity / personality / mission. Seeded from `DEFAULT_SOUL_MD` if absent. Operator-curated.
- **`MEMORY.md`** — agent's curated long-term notes. Agent-writable via tool calls and "periodic nudges." Operator-readable.
- **`USER.md`** — the agent's model of the user. Built up over sessions.

These three files are the "primary key" of cross-session continuity. They are the part the agent re-reads at the start of every session.

**Hard cap on injected size:** `CONTEXT_FILE_MAX_CHARS = 20_000`. When a context file exceeds this, the prompt builder applies head/tail truncation: 70% from the head, 20% from the tail. **This is the structural fix to a 33K-char append failure** — Hermes does not let any one context file get into the prompt at full length without bounds-checking it first.

---

## 2. Prompt assembly

Source: `agent/prompt_builder.py`. The system prompt is composed from constant template blocks in this order (caller is `AIAgent._build_system_prompt`):

1. **Agent identity** — `DEFAULT_AGENT_IDENTITY` block.
2. **Platform hints** — `PLATFORM_HINTS[platform]`. WhatsApp/Telegram/Discord/CLI all get different guidance about message length, markdown rendering, etc.
3. **Environment hints** — `build_environment_hints()`. Detects WSL, injects path translation guidance.
4. **Skills index** — `build_skills_system_prompt()`. Scans `~/.hermes/skills/` and external dirs. Builds a **mandatory skills manifest** the agent must consult before replying.
5. **Tool-use enforcement** — model-family-specific steering. `TOOL_USE_ENFORCEMENT_GUIDANCE`, `OPENAI_MODEL_EXECUTION_GUIDANCE`, `GOOGLE_MODEL_OPERATIONAL_GUIDANCE` for GPT/Gemini/Gemma/Grok.
6. **Guidance blocks** — `MEMORY_GUIDANCE`, `SESSION_SEARCH_GUIDANCE`, `SKILLS_GUIDANCE`, `KANBAN_GUIDANCE`, `HERMES_AGENT_HELP_GUIDANCE`. Static text teaching the agent how its tools work.
7. **Nous subscription info** — feature gating.
8. **Context files** — `_scan_context_content()` reads SOUL.md / MEMORY.md / USER.md, strips YAML frontmatter, applies prompt-injection-pattern detection, returns `[BLOCKED: ...]` if threats found, truncates to `CONTEXT_FILE_MAX_CHARS`.
9. **Memory provider snippet** (if external provider enabled — Honcho dialectic block etc.) — placed **AFTER** Anthropic's cache breakpoint so caching survives memory updates.

### Skills injection: every turn, with two-layer cache

```
Skills index — assembled by build_skills_system_prompt():
  L1 cache: in-process LRU (OrderedDict, max 8 entries)
  L2 cache: disk snapshot at .skills_prompt_snapshot.json
            invalidated by mtime/size manifest of the skills/ dir
  Filtered by:
    - platform compatibility (skill's frontmatter declares supported platforms)
    - disabled-skill list (~/.hermes/config.yaml)
    - tool availability (skill needs tools the agent doesn't have → hidden)
  External skill dirs (config.skills.external_dirs) scanned;
    local skills take precedence on name collision
```

Skills are presented as **descriptions + load instructions**, not full bodies. The agent loads a skill's actual content via tool call when it decides to use that skill.

---

## 3. Honcho — pluggable external memory (the dialectic layer)

Source: `plugins/memory/honcho/`, `agent/memory_manager.py`, `agent/memory_provider.py`.

### 3.1 What it is

Honcho is an external service (cloud or self-hosted, AGPL/MIT mix) that adds **dialectic user modeling** on top of Hermes' built-in memory. It is the default external provider but is fully optional — built-in MEMORY.md / USER.md / FTS5 work alone.

The architectural primitive that matters: **`MemoryProvider` ABC introduced in v0.7.0** decouples the agent loop from the memory backend. Hermes ships nine providers (Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, Supermemory, plus built-in fallback). Only one external provider is active at a time; built-in is always running alongside.

### 3.2 Configuration shape

`$HERMES_HOME/honcho.json` (resolution chain: profile → default profile → global legacy `~/.honcho/config.json` → env vars):

```jsonc
{
  "api_key": "...",
  "workspace_id": "hermes",          // logical container
  "peer_name": "alice",              // user identity
  "ai_peer": "hermes",               // agent identity (per-profile distinct)
  "write_frequency": "async",        // | "turn" | "session" | <int N turns>
  "recall_mode": "hybrid",           // | "context" | "tools"
  "context_cadence": 1,              // turns between base-context refresh
  "dialectic_cadence": 2,            // turns between LLM dialectic calls (1-5)
  "dialectic_depth": 1               // reasoning passes per call (1-3)
}
```

### 3.3 Two-layer context injection

Per turn, Honcho assembles **two layers** that get injected into the system prompt (after the cache breakpoint):

**Base context layer** (refreshed per `context_cadence`):
- Session summary
- User representation
- User peer card
- AI self-representation
- AI identity card

**Dialectic supplement** (refreshed per `dialectic_cadence`):
- LLM-synthesized reasoning answering "given what's been discussed, what context about this user is most relevant?"
- Auto-selects between cold-start prompt ("Who is this person, generally?") and warm prompt ("Given session-so-far, what matters?")
- Multi-pass: pass 0 initial → pass 1 self-audit → pass 2 reconciliation, controlled by `dialectic_depth`

### 3.4 Five tools exposed to the agent

| Tool | Purpose |
|------|---------|
| `honcho_profile` | Read/update peer card (curated facts snapshot) |
| `honcho_search` | Semantic search across stored context excerpts |
| `honcho_context` | Full session context snapshot (summary + representation + card + messages) |
| `honcho_reasoning` | LLM-synthesized dialectic Q&A |
| `honcho_conclude` | Create/delete persistent peer conclusions |

The agent calls these on demand. **Recall mode `tools`** disables the always-injected dialectic supplement entirely — memory is purely tool-mediated. **Recall mode `context`** is the inverse — push everything via context, no tools. **`hybrid`** does both (default).

This `recall_mode` switch is the explicit knob for the trade Phase 115 needs to make: ClawCode is currently `context`-equivalent (push everything every turn), and the wedge says it should at minimum offer `hybrid` and ideally `tools` for non-priority memory.

### 3.5 Async write loop

`write_frequency: "async"` (default) runs a background thread `_async_writer_loop` consuming an `_async_queue`. The agent's response path never blocks on Honcho writes. **Honcho outage ≠ agent wedge** — writes during outages are dropped (the README is explicit: "memory backend outages don't halt responses (though updates during outages are lost)").

### 3.6 Cache-breakpoint placement (HIGH-VALUE pattern)

> "Honcho's dynamic snippet appears *after* Anthropic's cached system prefix. The static system prompt leverages prompt caching on models like Claude Sonnet 4.6, while the memory layer remains dynamic. This architectural choice prevents expensive cache misses from memory updates."
> — `hermesagents.net/blog/memory-architecture-honcho-and-beyond/`

This is the specific implementation choice ClawCode should copy verbatim. The static identity / SOUL / skills index = cached. Per-turn dynamic memory snippet = post-breakpoint. Updating the dynamic block doesn't bust the cache on the rest.

---

## 4. Context compression — `agent/context_compressor.py`

This is the **runtime defense** that fires when the conversation grows past what cache + memory tiers can hold. Hermes treats it as orthogonal to memory — it compresses the *active turn buffer*, not the persistent memory tier.

### 4.1 Trigger

```
threshold_tokens = max(context_length × threshold_percent, MINIMUM_CONTEXT_LENGTH)
```

Default `threshold_percent = 0.50` — fire at 50% of model's context window.

**Anti-thrashing protection:** if the last two compressions each saved <10% of tokens, skip the next one.

### 4.2 Three phases

**Phase 1 — Tool-output pruning (NO LLM)**

- Replace old tool results with 1-line summaries: `[terminal] ran npm test → exit 0, 47 lines output`
- Deduplicate identical tool results
- Truncate large tool-call args in assistant messages outside the protected tail

This phase alone often saves enough that Phase 3 doesn't fire. Cheap.

**Phase 2 — Message protection bands**

- **Head**: system prompt + first exchange — NEVER compressed
- **Tail**: most recent messages totaling ~20K tokens — NEVER compressed
- **Middle**: the eviction zone

**Phase 3 — LLM summarization of the middle**

Generates a structured summary with these sections:
- Active Task
- Goal
- Completed Actions
- Resolved Questions
- Pending User Asks
- Remaining Work

Uses an **auxiliary LLM** (cheaper/faster than main model). Iterative: subsequent compressions update the previous summary in place rather than starting from scratch ("preserves all existing information that is still relevant; adds new completed actions").

The summary is **prepended to the first retained tail message** with a `SUMMARY_PREFIX` marker. The agent is instructed: "treat it as background reference, NOT as active instructions."

### 4.3 Summary token budget

```
summary_tokens = max(content_tokens × 0.20,
                     2000,
                     min(context_length × 0.05, 12_000))
```

Floor: 2000 tokens. Ceiling: 12K tokens. Scales with the size of the content being compressed.

### 4.4 Pluggable

`agent/context_engine.py` is an ABC. Custom compression strategies plug in. ClawCode's existing `src/memory/compaction.ts` could be made a comparable strategy interface for testability.

---

## 5. Skills system (procedural memory)

Auto-skill creation: the README claims "autonomous skill creation after complex tasks." The deepwiki skills page didn't expose the trigger threshold, but the operator's "5+ tool-calls trigger" matches the publicly stated pattern from the README's "creates skills from experience" framing. **Confidence: MEDIUM** — the architectural shape (skills as files in `~/.hermes/skills/`, scanned at prompt-build time, indexed not embedded) is HIGH-confidence; the exact trigger threshold is reported by sources but I did not see it in source code.

What is documented:
- Skills live in `~/.hermes/skills/` and external dirs (config-listed)
- Compatible with `agentskills.io` open standard (frontmatter: `name`, `description`)
- Skills can be **created**, **enabled/disabled**, **self-improved during use**
- Two-layer cache (in-process LRU + disk snapshot) means scanning skills doesn't get expensive
- The skills index injected into the prompt is descriptions + load instructions, not bodies — agent fetches a skill's body via tool call when ready to use it

For ClawCode, skills are global (`~/.clawcode/skills/`), per-project notes already say so. The pattern Hermes uses — **inject the index, lazy-load the body** — is directly applicable and is the same pattern ClawCode's existing v2.2 skills migration ended at.

---

## 6. `hermes claw migrate` — what THEY consider canonical agent memory

The migration command (verified via `hermes-agent.nousresearch.com/docs/guides/migrate-from-openclaw` and `optional-skills/migration/openclaw-migration/SKILL.md`) accepts these source surfaces:

- `~/.openclaw/` (default; auto-detected by `hermes setup`)
- `~/.clawdbot/` and `~/.moltbot/` (legacy aliases auto-detected)

Migration imports:

- **Settings** — config.yaml mapping
- **Memories** — markdown files (SOUL.md, MEMORY.md, etc.) copied/transformed
- **Skills** — frontmatter-tagged skill directories
- **API keys** — only with `--preset full`; `--preset user-data` skips secrets

Flags:
- `--dry-run` — preview without writes
- `--overwrite` — clobber existing
- Idempotent — `origin_id UNIQUE` pattern (matches what ClawCode v2.1 uses for skills migration)

**Implication:** the Hermes team considers (a) markdown context files (b) skills directories (c) config keys to be the canonical memory surface — **NOT** the SQLite session DB. The session DB is conversation history and is treated as ephemeral relative to migration. This is a strong signal: when Hermes thinks "what is the agent's memory?" it means SOUL.md / MEMORY.md / USER.md / skills/, not the FTS5 message index.

For ClawCode this argues: when Phase 115 redesigns memory, treat the markdown vault as the durable identity layer and the conversation/chunk SQLite as a lossy, compactable layer that can be rebuilt from the vault if needed.

---

## 7. Pitfalls / open questions

### 7.1 What I could verify

- Storage layout (HIGH — `hermes_state.py` schema confirmed via deepwiki extraction)
- FTS5 setup with two tokenizers (HIGH — explicit in source)
- WAL + retry pattern for concurrent processes (HIGH)
- Context-file 20K hard cap with 70/20 truncation (HIGH — `prompt_builder.py` constants)
- Compression algorithm (HIGH — three phases verified in `context_compressor.py`)
- Honcho config keys and tools (HIGH — official docs page)
- Cache-breakpoint placement for dynamic memory (MEDIUM — sourced from blog post, not source code; architecturally consistent with how Anthropic prompt caching works)

### 7.2 What I could NOT verify

- **Auto-skill creation trigger threshold** — `5+ tool calls` is the operator's recollection; sources confirm the *pattern* (autonomous skill creation from experience) but I didn't see the numeric threshold in source code.
- **Built-in fallback fact-store schema** — when no external provider is selected, Hermes uses a SQLite-backed fact store. The deepwiki page mentioned it ("SQLite-backed fact store requiring no external dependencies") but I didn't extract the schema.
- **`MEMORY_GUIDANCE` / `SESSION_SEARCH_GUIDANCE` text bodies** — these are static blocks in `prompt_builder.py` that teach the agent how to use its memory tools. Worth fetching directly when implementing ClawCode's equivalent.
- **`periodic nudges to persist knowledge`** — README mentions this, exact mechanism not surfaced. Likely a system-prompt-level reminder rather than a code path.

### 7.3 Hermes patterns ClawCode probably should NOT copy

- **Single shared `state.db` across all platforms** — Hermes shares one DB across CLI/discord/telegram/cron. ClawCode's per-agent SQLite is better for isolation (an agent crash can't corrupt another's memory). Don't regress this.
- **Honcho as the default** — Honcho requires either cloud or self-hosting. ClawCode running on a $5 VPS with 11 agents shouldn't add a service dependency for the default path. The built-in tier (markdown + FTS5) is the right default.
- **Profile model where one process owns multiple users** — ClawCode's "one agent process per agent identity" is cleaner than Hermes' "one gateway process serving N users" for the multi-agent-per-host case.

---

## 8. Concrete patterns to copy for Phase 115

| Pattern | Where Hermes does it | ClawCode adoption |
|---------|----------------------|-------------------|
| 20K-char hard cap on always-injected files | `CONTEXT_FILE_MAX_CHARS` in `prompt_builder.py` | Bound MEMORY.md / SOUL.md / USER.md before assembly. Overflow → recent-tail kept, oldest-mid summarized into a separate compaction file. |
| Dynamic memory after cache breakpoint | Honcho snippet placement | ClawCode already uses Anthropic prompt caching; insert per-turn dynamic memory after the static identity block, not before. |
| Tool-mediated lazy recall | `recall_mode: "tools"` | Expose `clawcode-memory-search` as a primary path. Currently injected always — flip the default for non-priority memory. |
| FTS5 with two tokenizers | `messages_fts` + `messages_fts_trigram` | Operator hasn't requested CJK but trigram also helps with arbitrary substring queries (function names, error fragments). Cheap addition. |
| Three-phase compression | `context_compressor.py` | ClawCode's `src/memory/compaction.ts` already exists. Audit whether Phase 1 (tool-output pruning, no LLM) is implemented — if not, that alone may bound 80% of bloat for free. |
| Async write frequency | `write_frequency: "async"` default | Memory writes via background queue, not on the response path. Memory failure doesn't wedge the agent. |
| Two-layer skill cache | LRU + disk snapshot | ClawCode skills loader should cache index, lazy-load bodies. |
| Pluggable memory provider ABC | `MemoryProvider` (v0.7.0 refactor) | If Phase 115 wants future optionality (e.g., add Honcho as an opt-in), introduce the abstraction up front. Otherwise document the single concrete implementation cleanly. |

---

## Sources

- [hermes_state.py via DeepWiki extraction](https://deepwiki.com/NousResearch/hermes-agent) — schema v11, FTS5 layout, WAL+retry
- [Architecture overview — DeepWiki](https://deepwiki.com/nousresearch-hermes-agent/hermes-agent) — component diagram, prompt assembly pipeline
- [README — `NousResearch/hermes-agent`](https://github.com/NousResearch/hermes-agent/blob/main/README.md) — overview, learning loop description
- [`prompt_builder.py` extraction](https://github.com/NousResearch/hermes-agent/blob/main/agent/prompt_builder.py) — `CONTEXT_FILE_MAX_CHARS = 20_000`, head/tail truncation ratios, skills index assembly
- [`context_compressor.py` extraction](https://github.com/NousResearch/hermes-agent/blob/main/agent/context_compressor.py) — three-phase compression, threshold formulas, summary structure
- [Memory Providers official doc](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers) — pluggable provider catalog, config keys
- [Honcho integration doc](https://hermes-agent.nousresearch.com/docs/user-guide/features/honcho) — write-frequency / recall-mode / dialectic config
- [Memory architecture blog](https://hermesagents.net/blog/memory-architecture-honcho-and-beyond/) — design history (v0.4 structured summaries → v0.7 pluggable provider ABC), cache-breakpoint placement rationale
- [openclaw-migration SKILL.md](https://github.com/NousResearch/hermes-agent/blob/main/optional-skills/migration/openclaw-migration/SKILL.md) — what Hermes considers canonical agent memory at migration time
- [Migrate from OpenClaw guide](https://hermes-agent.nousresearch.com/docs/guides/migrate-from-openclaw) — `hermes claw migrate` command reference
