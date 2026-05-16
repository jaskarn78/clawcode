# ClawCode Memory + Retrieval Subsystem — Current-State Map (Phase 115 Redesign Research)

**Date:** 2026-05-07
**Trigger:** fin-acquisition prompt swelled to 33K chars and triggered Anthropic 400 rejections.
**Scope:** Map the full memory-write + memory-read pipeline before redesign.

This document is descriptive of current behavior, not prescriptive of the redesign. Every claim carries a `path:line` citation.

---

## Table of Contents

1. [Tables & Schemas](#1-tables--schemas)
2. [Write Paths](#2-write-paths)
3. [Read Paths (what gets injected into the prompt)](#3-read-paths-what-gets-injected-into-the-prompt)
4. [Tier System (hot / warm / cold)](#4-tier-system-hot--warm--cold)
5. [Retrieval Shape (Phase 90 hybrid-RRF + legacy paths)](#5-retrieval-shape-phase-90-hybrid-rrf--legacy-paths)
6. [Pain Points / Smells / Data Hygiene Gaps](#6-pain-points--smells--data-hygiene-gaps)
7. [Per-Agent File Layout on Disk](#7-per-agent-file-layout-on-disk)

---

## 1. Tables & Schemas

All per-agent SQLite live in `<memoryPath>/memories.db` (better-sqlite3 with WAL mode, sqlite-vec extension loaded).
Constructed in `src/manager/session-memory.ts:52-138` via `AgentMemoryManager.initMemory`.
Schema bootstrap + migrations live in `src/memory/store.ts:658-1110`.

### 1.1 `memories` — owned-memory rows

`src/memory/store.ts:660-670` (initial DDL) and `src/memory/store.ts:715-732` / `:777-796` (CHECK migrations).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | nanoid |
| `content` | TEXT NOT NULL | Full body — never truncated at the column level. |
| `source` | TEXT CHECK IN (`conversation`, `manual`, `system`, `consolidation`, `episode`) | See `memorySourceSchema` at `src/memory/schema.ts:4-10`. |
| `importance` | REAL [0..1], default 0.5 | |
| `access_count` | INTEGER, default 0 | |
| `tags` | TEXT (JSON-stringified array), default `'[]'` | |
| `created_at` / `updated_at` / `accessed_at` | TEXT (ISO 8601) | |
| `tier` | TEXT CHECK IN (`hot`, `warm`, `cold`), default `warm` | Added by `migrateTierColumn` `:739-750`. New rows always start at `warm` (`store.ts:1431-1434`). |
| `source_turn_ids` | TEXT (JSON array) NULL | Lineage to `conversation_turns.id` (CONV-03). Added by `migrateSourceTurnIds` `:879-889`. |
| `origin_id` | TEXT NULL, UNIQUE WHERE NOT NULL | Phase-80 idempotency for OpenClaw imports. Added by `migrateOriginIdColumn` `:1041-1054`. |

### 1.2 `vec_memories` — sqlite-vec virtual table for owned memories

`src/memory/store.ts:680-684`.
```sql
CREATE VIRTUAL TABLE vec_memories USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);
```
- 384-dim cosine. Backed by `@huggingface/transformers` MiniLM-L6-v2 via `EmbeddingService` (`src/memory/embedder.ts:22-81`).
- One row per `memories.id` written atomically inside `MemoryStore.insert` transaction (`store.ts:221`).
- **Cold-archived memories are deleted from `vec_memories` entirely** — `tier-manager.ts:128` (`store.delete(entry.id)`) and `episode-archival.ts:56`.

### 1.3 `memory_links` — wikilink graph edges

`src/memory/store.ts:803-815` (`migrateGraphLinks`).
```sql
CREATE TABLE memory_links (
  source_id TEXT, target_id TEXT, link_text TEXT, created_at TEXT,
  PRIMARY KEY (source_id, target_id),
  FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX idx_memory_links_target ON memory_links(target_id);
```
Two writers:
1. **Wikilinks** — `extractWikilinks` regex `\[\[([^\]]+)\]\]` in `src/memory/graph.ts:14, 24-36`. Edges built inside `MemoryStore.insert` at `store.ts:223-230` and after merge at `:147-156`.
2. **Auto-linker** — KNN cosine ≥ 0.6 over `vec_memories`, bidirectional `link_text='auto:similar'`. Eager call from `store.insert` (`store.ts:251` via `autoLinkMemory`); periodic batch via heartbeat at 6h (`src/heartbeat/checks/auto-linker.ts:17-19, 43`). Implementation in `src/memory/similarity.ts:51-244`.

### 1.4 `session_logs` — daily-log file ledger

`src/memory/store.ts:672-678`. Tracks `<workspace>/memory/YYYY-MM-DD.md` entry counts for `consolidation.ts` to detect unconsolidated weeks. Not a content store.

### 1.5 `conversation_sessions` — Phase 64 session lifecycle

`src/memory/store.ts:826-844` (`migrateConversationTables`).
| Column | Type |
|---|---|
| `id` TEXT PK, `agent_name`, `started_at`, `ended_at` | |
| `turn_count`, `total_tokens` | INTEGER |
| `summary_memory_id` TEXT NULL | FK to `memories.id` (set by `markSummarized`) |
| `status` TEXT CHECK IN (`active`, `ended`, `crashed`, `summarized`) | State machine in `ConversationStore` `src/memory/conversation-store.ts:165-287` |

Indexes: `idx_sessions_agent`, `idx_sessions_status`, `idx_sessions_started`.

### 1.6 `conversation_turns` — per-turn raw transcript

`src/memory/store.ts:846-871` + `migrateInstructionFlags` `:896-906`.
| Column | Type | Notes |
|---|---|---|
| `id`, `session_id`, `turn_index`, `role`, `content` | TEXT | role CHECK IN (`user`, `assistant`, `system`) |
| `token_count` | INTEGER NULL | |
| `channel_id`, `discord_user_id`, `discord_message_id` | TEXT NULL | |
| `is_trusted_channel` | INTEGER (0/1) | SEC-01 — only trusted-channel turns enter FTS search by default. |
| `origin` | TEXT NULL | |
| `instruction_flags` | TEXT JSON NULL | SEC-02 prompt-injection detection. |
| `created_at` | TEXT | |

UNIQUE INDEX `idx_turns_session_order(session_id, turn_index, role)` — enables idempotent INSERT-OR-IGNORE for translator imports (`src/sync/conversation-turn-translator.ts`).

### 1.7 `conversation_turns_fts` — Phase 68 FTS5 index

`src/memory/store.ts:922-969`.
- External-content FTS5 over `conversation_turns.content`.
- Tokenizer `unicode61 remove_diacritics 2`.
- AI / AD / AU triggers (`store.ts:938-957`) keep it in sync automatically.
- One-shot backfill on first migration (`:959-968`).

### 1.8 `memory_files` — Phase 90 file-scanner ledger

`src/memory/store.ts:1080-1086`.
```sql
CREATE TABLE memory_files (
  path TEXT PRIMARY KEY,
  mtime_ms INTEGER, sha256 TEXT, chunk_count INTEGER, indexed_at TEXT
);
```
Idempotency gate keyed by absolute path + sha256. `MemoryScanner` short-circuits re-embedding when `getMemoryFileSha256` matches the on-disk content (`store.ts:1259-1264`, `memory-scanner.ts:192-194`).

### 1.9 `memory_chunks` — H2-split workspace memory chunks

`src/memory/store.ts:1087-1098`.
| Column | Type | Notes |
|---|---|---|
| `id` TEXT PK | | nanoid |
| `path` TEXT, `chunk_index` INT | | indexed via `idx_memory_chunks_path` |
| `heading` TEXT NULL, `body` TEXT | | H2 heading + body |
| `token_count` INT | | char/4 estimate (`memory-chunks.ts:18`) |
| `score_weight` REAL | | path-derived nudge: `+0.2` vault, `+0.1` procedures, `-0.2` archive (`memory-chunks.ts:150-155`) |
| `file_mtime_ms` INT | | drives D-24 time-window filter |
| `created_at` TEXT | | |

Chunker: `chunkMarkdownByH2` (`memory-chunks.ts:42-120`) — soft cap 800 tokens, hard cap 1000, splits oversized H2 sections on paragraph boundaries.

### 1.10 `vec_memory_chunks` — sqlite-vec for chunks

`src/memory/store.ts:1099-1102`. Same shape as `vec_memories` but keyed by `chunk_id`.

### 1.11 `memory_chunks_fts` — FTS5 for chunks

`src/memory/store.ts:1103-1108`.
- Contentless mode (`content=''`); `chunk_id` UNINDEXED column joins back to `memory_chunks`.
- Body + heading indexed; FTS5 query sanitised via `[^a-zA-Z0-9_ ]+` strip in `searchMemoryChunksFts` (`store.ts:1292-1311`) — drops `:`, `()`, `"`, etc. that crash the parser.

### 1.12 `api_key_sessions_v2` — bearer-key → Claude-session mapping

`src/memory/store.ts:1004-1014`. Composite PK `(key_hash, agent_name)`. Out of scope for memory retrieval but lives in the same DB connection.

### 1.13 Other artifacts in the same DB (`store.getDatabase()` shared connection)

- `EpisodeStore` (`src/memory/episode-store.ts`) writes to `memories` with `source='episode'`.
- `DocumentStore` (`src/documents/store.ts`) creates its own tables but shares the connection (`session-memory.ts:104`).
- `traces.db` and `usage.db` are SEPARATE files (`session-memory.ts:122, 112`) — not part of this map.

---

## 2. Write Paths

**Every code path that creates rows in `memories`, `vec_memories`, `memory_chunks`, `vec_memory_chunks`, or `memory_chunks_fts`.** Numbered for cross-reference.

### 2.1 Manual save via MCP `memory_save` tool — `src/manager/daemon.ts:7532-7547`
```text
MCP tool memory_save → IPC "memory-save" → store.insert({ content, source: "conversation", importance, tags }, embedding)
```
- Caller passes raw text + tags. `embedder.embed(content)` is awaited at `daemon.ts:7544` (blocks the IPC reply on first warmup).
- `source: "conversation"` is hard-coded — agents cannot choose.
- Goes through `MemoryStore.insert` dedup path (`store.ts:122-279`): cosine ≥ 0.85 against existing `vec_memories` triggers `mergeMemory` (`dedup.ts`) instead of a new insert. Eager `autoLinkMemory` runs after.
- New row defaults to `tier='warm'`, `access_count=0`.

### 2.2 Session-end summarisation — `src/memory/session-summarizer.ts:180-423`
- Triggered on session `ended`/`crashed` status by `SessionManager` (around `session-manager.ts:2504-2640`).
- Pipeline: load turns → buildSessionSummarizationPrompt (`:58-105`, ~30K char cap) → Haiku call w/ 30s timeout (`:39`) → on success: insert MemoryEntry; on timeout/error: `buildRawTurnFallback` dumps ALL raw turns into one MemoryEntry tagged `raw-fallback` (`:115-125, 268-282`).
- Tags: `["session-summary", "session:<id>", optional "raw-fallback" | "short"]`.
- `source: "conversation"`, `importance: 0.78`, `skipDedup: true`, `sourceTurnIds: [...]`.
- Insert at `session-summarizer.ts:315`.
- After insert + `markSummarized` succeeds, **raw `conversation_turns` rows for that session are deleted** (`session-summarizer.ts:373-397`, `conversation-store.ts:476-479`). Session row stays for resume-brief gap math.

### 2.3 Mid-session flush — `src/memory/session-summarizer.ts:573` + `src/memory/memory-flush.ts:166-291`
- `MemoryFlushTimer` runs every 15min by default (`memory-flush.ts:38`, configurable via `defaults.memoryFlushIntervalMs`).
- Skip heuristic at `memory-flush.ts:101-118` — needs ≥1 user turn AND ≥1 assistant turn that's either ≥200 chars or contains `tool_use` substring.
- TWO outputs:
  1. A markdown file `<workspace>/memory/YYYY-MM-DD-HHMM.md` (`:266-278`) — picked up by chokidar scanner → indexed as `memory_chunks` (path 2.6).
  2. A `MemoryEntry` row with tags `["mid-session", "session:<id>", "flush:N"]` (`session-summarizer.ts:573`).

### 2.4 Cue file write — `src/memory/memory-cue.ts:102-135`
- Triggered post-turn by `TurnDispatcher.maybeFireCueHook` when user-turn text matches `MEMORY_CUE_REGEX` (`memory-cue.ts:44-45` — `remember`, `keep this in long-term memory`, `standing rule`, `don't forget`, `note for later`, `save to memory`).
- Writes `<workspace>/memory/YYYY-MM-DD-remember-<nanoid4>.md` with frontmatter (`type: cue`, `cue: "..."`, optional `discord_link`).
- Indexed by chokidar scanner as `memory_chunks` (path 2.6). NOT directly written to `memories` table.
- ✅ Discord reaction posted via `discordReact` DI hook (`turn-dispatcher.ts:333`).

### 2.5 Subagent return capture — `src/memory/subagent-capture.ts`
- Triggered by Task-tool return event in `TurnDispatcher.handleTaskToolReturn`.
- Excludes `gsd-*` subagent types (`subagent-capture.ts:46`).
- Writes `<workspace>/memory/YYYY-MM-DD-subagent-<slug>[-<nanoid4>].md` with frontmatter (`spawned_at`, `duration_ms`, `subagent_type`, `task_description`) and a `## Return Summary` section.
- Indexed by chokidar scanner (path 2.6).

### 2.6 File-scanner indexing → `memory_chunks` + vec + FTS — `src/memory/memory-scanner.ts:184-240`
- Watcher: chokidar v5, `awaitWriteFinish: 300ms`, watches `<workspace>/memory` recursively.
- `shouldIndexMemoryPath` (`memory-scanner.ts:44-55`) excludes:
  - non-`.md` files
  - `memory/subagent-*` (Phase 90-03 territory)
  - root `MEMORY.md` at workspace root (NOT under `memory/`)
  - `HEARTBEAT.md`
- For each eligible file: read → sha256 → if matches `memory_files.sha256` → SKIP. Else delete-then-insert via `store.deleteMemoryChunksByPath` + `chunkMarkdownByH2` + per-chunk embed + `store.insertMemoryChunk` (atomic txn at `store.ts:1135-1177`).
- One embed per chunk (≤800 tokens).
- `backfill()` (`:156-174`) is the boot-time one-shot.

**Critical:** Three writers feed this single ingestion path: `memory-flush.ts` (2.3), `memory-cue.ts` (2.4), `subagent-capture.ts` (2.5), plus operator-authored files under `memory/` (vault, procedures, archive, dated session notes).

### 2.7 Episode recording — `src/memory/episode-store.ts:73-95`
- `EpisodeStore.recordEpisode` formats content as `[Episode: {title}]\n\n{summary}` and writes to `memories` with `source='episode'`, tags `["episode", ...userTags]`, `skipDedup: true`.
- Used by external IPC `record-episode` (search `daemon.ts` for `"record-episode"`).

### 2.8 Compaction-driven summary — `src/memory/compaction.ts:117`
- `CompactionManager.compact` (Phase 50/52) summarises old conversation history when context fill crosses threshold and inserts a `source='consolidation'` row. Replaces older entries.

### 2.9 Weekly + monthly digests — `src/memory/consolidation.ts:322, 377`
- `consolidationCron` (every day at 03:00 per `consolidationConfigSchema.schedule` default `"0 3 * * *"` at `schema.ts:26`) detects unconsolidated weeks/months from `<memoryDir>/YYYY-MM-DD.md` files, runs Haiku, writes `<memoryDir>/digests/weekly-YYYY-WNN.md` AND inserts a `source='consolidation'` row in `memories`.
- The markdown digest file ALSO gets indexed by `memory-scanner.ts` (path 2.6) — same content lands in two places.

### 2.10 Subagent-thread capture (Phase 91) — `src/memory/subagent-capture.ts` — see 2.5.

### Summary of writers to the **`memories`** table

| Writer | Source | File:line |
|---|---|---|
| `memory_save` MCP tool | `conversation` | `daemon.ts:7545` |
| Session-end summarise | `conversation` (tagged `session-summary`) | `session-summarizer.ts:315` |
| Mid-session flush | `conversation` (tagged `mid-session`) | `session-summarizer.ts:573` |
| Episode | `episode` | `episode-store.ts:85` |
| Compaction | `consolidation` | `compaction.ts:117` |
| Weekly/monthly digest | `consolidation` | `consolidation.ts:322, 377` |
| Re-warm from cold | `system` (preserves original) | `tier-manager.ts:178-194` |

### Summary of writers to **`memory_chunks` / `vec_memory_chunks` / `memory_chunks_fts`**

ONE writer: `MemoryStore.insertMemoryChunk` at `store.ts:1122-1179`, called only from `MemoryScanner.handleUpsert` at `memory-scanner.ts:219`. Fed by chokidar over four file patterns:
- Operator-authored `memory/**/*.md`
- Dated session flush `memory/YYYY-MM-DD-HHMM.md` (writer 2.3)
- Cue files `memory/YYYY-MM-DD-remember-*.md` (writer 2.4)
- Subagent capture `memory/YYYY-MM-DD-subagent-*.md` (writer 2.5)
- Weekly/monthly digests in `memory/digests/*.md` (writer 2.9)

---

## 3. Read Paths (what gets injected into the prompt)

There are **three injection regions** per turn, each fed from different sources:

### 3.1 Stable prefix (system prompt, cached across turns)

Built once per session-config rebuild in `src/manager/session-config.ts`, assembled by `assembleContext` at `src/manager/context-assembler.ts:686-869`. Order, top-to-bottom:

| Slot | Source | File:line | Budget enforcement |
|---|---|---|---|
| system_prompt_directives | `renderSystemPromptDirectiveBlock` | `context-assembler.ts:760-762` | none (pre-rendered) |
| identity (incl. SOUL.md folded in, plus capability manifest, plus injected `Your name is X. When using memory_lookup, pass 'X' as the agent parameter.` line) | `session-config.ts:355-373` | passed through `enforceWarnAndKeep` for `identity` budget 1000 (`context-assembler.ts:343, 700`); **never truncated**, only warns |
| **MEMORY.md auto-load** | `<workspace>/MEMORY.md` raw read | `session-config.ts:382-402` | **50 KB hard byte cap** (`MEMORY_AUTOLOAD_MAX_BYTES` near `session-config.ts:63`). 50 KB ≈ 12,500 tokens. Truncated tail gets `…(truncated at 50KB cap)` marker. |
| `## Key Memories` (hot tier) | `tierManager.getHotMemories().slice(0, 3)` rendered as `- {content}\n` bullets | `session-config.ts:412-421` (build), `context-assembler.ts:776-787` (place), `tier-manager.ts:313-317` (source) | `selectHotMemoriesWithinBudget` at `context-assembler.ts:552-601`. Budget `hot_tier=3000` tokens (`context-assembler.ts:347`). Drop-lowest-importance strategy. **Top-3 only — most agents have far more hot memories than 3.** |
| `## Available Tools` (skills_header + toolDefinitions, MCP block) | `session-config.ts:431-461, 463-578` | `truncate-bullets` strategy at `skills_header=1500`; `toolDefinitions=2000` budget (`context-assembler.ts:253-259, 343`); concatenated and bullet-truncated at `context-assembler.ts:790-799` |
| `<tool_status></tool_status><filesystem_capability>…</filesystem_capability><dream_log_recent></dream_log_recent>` | `renderFilesystemCapabilityBlock` | `session-config.ts:692-695`, `context-assembler.ts:828-834` | none |
| Delegates block | `renderDelegatesBlock(config.delegates)` | `context-assembler.ts:845-847` | none |
| `## Related Context` (graph context) | currently always `""` | `session-config.ts:726`, `context-assembler.ts:849-855` | `graphContext=2000` |

**Hot-tier cache-stability quirk:** if the `hotStableToken` (sha256 of top-3 hot memory `id:accessedAt`) differs between the current and prior turn, hot tier slides to the mutable suffix for ONE turn (`context-assembler.ts:776-787`) to preserve cache. Computed at `tier-manager.ts:331-338`.

### 3.2 Mutable suffix (per-turn user-message preamble)

Prepended to the user message before send. Order, top-to-bottom (`context-assembler.ts:857-880`-ish):

| Slot | Source | File:line | Budget |
|---|---|---|---|
| Discord bindings | `session-config.ts:580-590` | hard-coded text |
| `## Recent Sessions` (conversation brief) | `assembleConversationBrief` reading session-summary tagged memories | `conversation-brief.ts:133-267`, threaded at `session-config.ts:632-680` | `conversationContextBudget=2000` tokens default (`schema.ts:87`); accumulate-strategy at `conversation-brief.ts:194-225`; gap-skip when last terminated session < 4h ago (`conversation-brief.ts:140-170`) |
| Per-turn summary | currently always `""` | `session-config.ts:733` | `per_turn_summary=500` |
| **Resume summary** | `loadLatestSummary(<memoryDir>/context-summary.md)` (file written by compaction at `tier-manager.ts:206`-ish) | `context-summary.ts:161-188`, `session-config.ts:598-619` | `resumeSummaryBudget=1500` enforced via `enforceSummaryBudget` (`context-summary.ts:210-301`) — hard-truncate fallback if regen unwired |
| Hot-tier (only when stable token changed this turn) | see above |  | (already counted under stable prefix) |

### 3.3 Per-turn `<memory-context>` block (Phase 90 MEM-03)

Wraps the user message inside `dispatch` / `dispatchStream` BEFORE send (`turn-dispatcher.ts:574, 635, 686-711`).

```typescript
// turn-dispatcher.ts:686-711
private async augmentWithMemoryContext(agentName, message) {
  if (!this.memoryRetriever) return message;
  const query = message.trim();
  if (query.length === 0) return message;
  const chunks = await this.memoryRetriever(agentName, query);
  if (chunks.length === 0) return message;
  const rendered = chunks.map(c => `### ${c.heading ?? c.path}\n${c.body}`).join("\n\n");
  return `<memory-context source="hybrid-rrf" chunks="${chunks.length}">\n${rendered}\n</memory-context>\n\n` + message;
}
```

- The `memoryRetriever` closure is built at `session-manager.ts:565-582` and forwards to `retrieveMemoryChunks` (path 5.1).
- **Runs on every turn** that has `memoryRetriever` wired AND the user message is non-empty after trim. No length floor — even `"ok"` triggers the embed + 2 vec queries + 1 FTS query.
- Fail-open: any retriever throw → continues with raw message (`turn-dispatcher.ts:704-710`).

### 3.4 On-demand reads (LLM-initiated)

| Tool | IPC method | Handler | Notes |
|---|---|---|---|
| `memory_lookup` | `memory-lookup` | `daemon.ts:6220-6263` → `invokeMemoryLookup` (`src/manager/memory-lookup-handler.ts:114-217`) | Scope `memories` (legacy), `conversations`, or `all`. See §5.2. |
| `memory_save` | `memory-save` | `daemon.ts:7532-7547` | See 2.1. |
| `memory-search` (CLI/admin only — no MCP) | `memory-search` | `daemon.ts:6190-6218` | Returns full memories via SemanticSearch with combinedScore — used by ops scripts. |
| `memory-graph` | `memory-graph` | `daemon.ts:7549-7559` → `handleMemoryGraphIpc` | Returns graph nodes+links for the dashboard. |
| `memory-cleanup-orphans` | `memory-cleanup-orphans` | `daemon.ts:4465`-ish → `store.cleanupOrphans` (`store.ts:508-523`) | Removes vec_memories rows whose memory_id no longer exists. |
| `memory-list` | `memory-list` | `daemon.ts:6564` | List recent. |

### 3.5 Dream-pass reads — `src/manager/dream-pass.ts:200-337`
- Reads `memoryStore.getRecentChunks(agent, 30)` + `<memoryRoot>/MEMORY.md` + `conversationStore.getRecentSummaries(agent, 3)` + `<memoryRoot>/graph-edges.json`.
- Builds a structured prompt, dispatches to a chosen model, parses JSON output. Phase 95-02 auto-applier (`dream-auto-apply.ts`) writes back into MEMORY.md + graph-edges.
- Read scope is "everything dream needs" — separate from the per-turn retriever.

### 3.6 IPC handlers in daemon (selected, all in `src/manager/daemon.ts`)

| Method | Line |
|---|---|
| `memory-lookup` | 6220 |
| `memory-search` | 6190 |
| `memory-save` | 7532 |
| `memory-list` | 6564 |
| `memory-graph` | 7549 |
| `memory-cleanup-orphans` | 4465 |
| `tier-maintenance-tick` | 7562 |

---

## 4. Tier System (hot / warm / cold)

`src/memory/tiers.ts` (pure decisions) + `src/memory/tier-manager.ts` (orchestration).

### 4.1 Default thresholds
`src/memory/tiers.ts:36-43` (`DEFAULT_TIER_CONFIG`):
- `hotAccessThreshold: 3` — minimum access_count to qualify for promote.
- `hotAccessWindowDays: 7` — accessedAt must be within this window.
- `hotDemotionDays: 7` — hot rows untouched for ≥7 days demote to warm.
- `coldRelevanceThreshold: 0.05` — warm rows with `relevance_score < 0.05` archive to cold.
- `hotBudget: 20` — global cap on hot rows.
- `centralityPromoteThreshold: 5` — Phase 100-fu — backlink count ≥ 5 promotes regardless of access (added because `fin-acquisition` had 1,161/1,182 memories at `access_count=0` despite 7,338 wikilink edges; see comment at `tiers.ts:24-31`).

### 4.2 Promote: warm → hot
`tiers.ts:66-95` (`shouldPromoteToHot`):
- Path 1 (access): `accessCount >= 3 AND daysSinceAccess <= 7`.
- Path 2 (centrality): `backlinkCount >= 5`.

### 4.3 Demote: hot → warm
`tiers.ts:108-115` (`shouldDemoteToWarm`): `daysSinceAccess >= 7`.

### 4.4 Archive: warm → cold
`tiers.ts:129-141` (`shouldArchiveToCold`): `relevance_score < 0.05` where score = `importance * 0.5^(daysSinceAccess / 30)` (`decay.ts:27-43`).

Cold archive flow (`tier-manager.ts:97-132`):
- Read embedding from `vec_memories`.
- Write `<memoryDir>/archive/cold/<id>-<slug>.md` with YAML frontmatter (id, source, importance, access_count, tags, timestamps, **embedding_base64**).
- Call `store.delete(entry.id)` — removes BOTH `memories` AND `vec_memories` rows.

Re-warm (`tier-manager.ts:141-230`):
- Read cold file, parse frontmatter, **re-embed content fresh** (NOT base64-decoded — embedding_base64 is dead-letter), insert with original id + `accessCount + 1` + `tier='warm'`.
- Re-extract wikilinks. Delete the cold file.

### 4.5 Episodes archive separately
**`source='episode'` rows take a different path.** `episode-archival.ts:34-72`:
- Cutoff: `archivalAgeDays` (default 90) by `created_at`.
- Action: `updateTier(id, 'cold')` AND `DELETE FROM vec_memories WHERE memory_id = ?`.
- **The `memories` row stays** (orphan `memories`-without-`vec_memories`). Hidden from semantic search but still readable via `getById` / tag queries.
- Triggered: search `daemon.ts` for `archiveOldEpisodes` calls.

### 4.6 Heartbeat orchestration
- **Tier maintenance** every 6h: `src/heartbeat/checks/tier-maintenance.ts:17` — interval 21600s, calls `tierManager.runMaintenance()` per agent.
- **Auto-linker** every 6h: `src/heartbeat/checks/auto-linker.ts:19` — calls `discoverAutoLinks(memoryStore)`.
- **Memory consolidation** daily 03:00 (cron): `consolidation.ts` (search daemon for `daily-summary-cron` / `consolidationConfigSchema`).
- Maintenance can also be triggered on-demand via `tier-maintenance-tick` IPC (`daemon.ts:7562-7587`).

### 4.7 What gets injected from each tier
- **Hot**: top-3 (sorted by importance desc) injected into stable prefix as `## Key Memories` bullets (`session-config.ts:412-421`). Hot stable token controls cache placement.
- **Warm**: invisible by default. Only reachable via `memory_lookup` / `memory-search` / `retrieveMemoryChunks` (vec search hits any non-cold memory).
- **Cold**: invisible to ALL retrieval paths — `vec_memories` row is gone. Only re-warm via `TierManager.rewarmFromCold` or operator script.

### 4.8 Promotion candidate selection
`tier-manager.ts:268, store.ts:578-605` (`listWarmCandidatesForPromotion`) — orders by `backlink_count DESC, accessed_at DESC`, scans up to 5000 warm rows. Replaced original 100-row + accessed_at-only ordering after Phase 999.8 follow-up showed centrality hubs never reached the scan window.

---

## 5. Retrieval Shape (Phase 90 hybrid-RRF + legacy paths)

### 5.1 Pre-turn auto-injection — `retrieveMemoryChunks` (`src/memory/memory-retrieval.ts:124-245`)

This is the path that produces the `<memory-context>` block (§3.3).

**Pipeline:**
1. Embed query via MiniLM (full user message — 200-word truncation in embedder at `embedder.ts:13, 84-88`).
2. **Three rankers fan out in parallel** (`memory-retrieval.ts:143-147`):
   - `searchMemoryChunksVec(qEmb, 20)` — cosine top-20 over `vec_memory_chunks` (`store.ts:1271-1284`).
   - `searchMemoryChunksFts(query, 20)` — FTS5 top-20 over `memory_chunks_fts` (`store.ts:1292-1311`).
   - `searchMemoriesVec(qEmb, 20)` — cosine top-20 over `vec_memories` (the agent's owned memory rows) (`store.ts:1324-1344`). **Phase 100-fu** addition.
3. **Fuse via Reciprocal Rank Fusion** (`rrfFuse` at `memory-retrieval.ts:67-90`):
   - `score(doc) = sum_over_rankers(1 / (k + rank + 1))` with `RRF_K=60`.
   - Chunks side: vec + FTS fused. Memories side: pseudo-RRF with vec only (no FTS index for `memories`).
4. **Hydrate** via `getMemoryChunk` / `getMemoryForRetrieval` (`store.ts:1356-1391, 1397-1423`). Skips stale ids silently.
   - Note: `getMemoryForRetrieval` does NOT bump `access_count` (`store.ts:1346-1355` — intentional, to keep auto-retrieval out of the recency signal). `getMemoryChunk` likewise read-only.
   - But chunks side runs through `SemanticSearch.search` only when called via `memory_lookup` legacy path — not here. The vec lookup at `searchMemoryChunksVec` does NOT bump anything.
5. **Apply path-derived weight** post-fusion: `fusedScore += scoreWeight` (vault +0.2, procedures +0.1, archive -0.2).
6. **Time-window filter** via `applyTimeWindowFilter` (`memory-chunks.ts:166-175`): drop chunks where `file_mtime_ms < now - 14*86_400_000`. **Vault and procedures paths bypass the filter regardless of mtime.** Memory-side hits get synthesised `path = "memory:<id>"`, `file_mtime_ms = now` → always pass (`memory-retrieval.ts:202-215`).
7. **Resort by fusedScore desc**, slice to `topK`.
8. **Token-budget truncate**: stop accumulating when `cumulative body chars > tokenBudget * 4` (default `tokenBudget=2000` → 8000 chars). Always emits at least the first chunk.

**Wired knobs:**
- `topK` from `agentConfig.memoryRetrievalTopK` (default 5, max 50). Read at `session-manager.ts:571`.
- `timeWindowDays` HARD-CODED to 14 at `session-manager.ts:579`.
- `tokenBudget` HARD-CODED to default 2000 at `memory-retrieval.ts:128`. **The configured `defaults.memoryRetrievalTokenBudget` field at `src/config/schema.ts:1426` is NEVER FORWARDED — see Pain Point #1.**

### 5.2 `memory_lookup` MCP tool — legacy + scoped paths

Tool definition: `src/mcp/server.ts:619-704`. Idempotent within a Turn (per-turn tool-cache).
IPC handler: `daemon.ts:6220-6263` → `invokeMemoryLookup` (`src/manager/memory-lookup-handler.ts:114-217`).

Branching at `memory-lookup-handler.ts:140`:

#### 5.2.1 Legacy path: `scope='memories'` AND `page=0`
1. Embed query via MiniLM.
2. `GraphSearch.search(qEmb, limit)` (`src/memory/graph-search.ts:49-157`):
   - KNN top-K via `SemanticSearch.search` (over-fetches 2x → score+rerank → trim → bumps access_count for top-K, `search.ts:73-115`).
   - For each KNN hit, fetch forward + backlinks (`memory_links`), compute cosine vs query embedding, include neighbors with `similarity ≥ 0.6` (`graph-search.ts:38-47, 83`).
   - **Bumps access_count for graph-walked neighbors** (`graph-search.ts:107-110`) — Phase 100-fu added this so heavy-linked hubs can promote.
   - Caps total at `maxTotalResults` (config default in `graph-search.types.ts`).
3. **Returns FULL memory body** (`memory-lookup-handler.ts:153-161`):
   ```typescript
   { id, content: r.content, relevance_score, tags, created_at, source, linked_from }
   ```
   No truncation. `limit` is clamped to MAX_RESULTS_PER_PAGE=10 at `:131-133`.

#### 5.2.2 New path: `scope='conversations' | 'all'` OR `page > 0` OR Gap-4 fallback
1. `searchByScope` (`src/memory/conversation-search.ts:73-211`):
   - **Path 1 — memories**: `memoryStore.listRecent(200)`, filter out `session-summary` tag, **case-insensitive substring match on `content`** (`conversation-search.ts:97-122, 218-221`). Importance + decay scoring (`combinedScore = importance*0.7 + decay*0.3`, half-life 14 days for conversations).
   - **Path 2 — session summaries**: `memoryStore.findByTag("session-summary")` (NO LIMIT — full scan, see §6 #6), substring filter, same scoring.
   - **Path 3 — raw turns**: `conversationStore.searchTurns` via FTS5 (`conversation-store.ts:500-548`) — phrase-quoted query, `is_trusted_channel=1` filter by default, BM25-ranked. Over-fetch 30, normalise BM25 via `1/(1 + |bm25|)`.
2. Dedup-prefer-summary for `scope='all'` (`conversation-search.ts:290-304`).
3. Sort by combinedScore desc, secondary `createdAt DESC`.
4. **Snippet truncate to 500 chars** (`conversation-search.ts:236-239`, `SNIPPET_MAX_CHARS=500` at `conversation-search.types.ts:64`).
5. Pagination via `offset + slice + hasMore`.

#### 5.2.3 Gap-4 fallback
`memory-lookup-handler.ts:118-165` — if caller didn't *explicitly* set scope and the legacy path returned 0 results, fall through to `searchByScope({ scope: 'all', ... })`. Preserves backward-compat byte-shape only when scope was explicitly set.

### 5.3 `memory-search` IPC — operator path

`daemon.ts:6190-6218`. Pure `SemanticSearch.search` (`src/memory/search.ts:36-115`):
- KNN top-K with 2x over-fetch.
- `combinedScore = semantic*0.7 + decay*0.3` (`relevance.ts:54-85`), then importance multiplicative boost `combinedScore * (0.7 + 0.3*importance)` (`search.ts:89-92`).
- Bumps `access_count` and `accessed_at` for top-K (after scoring, before return — Pitfall 6 in original PLAN).
- **Returns FULL content** to caller. No size cap. Used by `clawcode memory search` CLI.

### 5.4 Conversation-brief retrieval — see §3.2 row "## Recent Sessions"

`conversation-brief.ts:133-267` runs at session-config build time (NOT per-turn).
- Calls `memoryStore.findByTag("session-summary")` (NO LIMIT — `store.ts:632-651`).
- Calls `conversationStore.listRecentTerminatedSessions(agent, 1)` for gap math.
- Cached by terminated-session-id fingerprint at `session-config.ts:639-679` (`conversation-brief-cache.ts`).

### 5.5 `MEMORY.md` auto-load — see §3.1

`session-config.ts:382-402`. Single 50KB byte read, NO retrieval logic — straight concatenation into stable prefix.

### 5.6 Hot-tier injection — see §3.1

`tierManager.getHotMemories().slice(0, 3)` (`tier-manager.ts:313-317`) → top-3 by importance desc → `- {content}\n` bullets. NO truncation per row.

### 5.7 Fingerprint (`SOUL.md`) extraction — `src/memory/fingerprint.ts`

Read at session-config time only. Renders ~300-token markdown with traits/style/constraints from SOUL.md. Hard-cap `MAX_OUTPUT_CHARS=1200`. Lands inside identity block. Not retrieval per se — sourcing for the prompt.

---

## 6. Pain Points / Smells / Data Hygiene Gaps

The fin-acquisition incident proved the system has multiple unbounded surfaces. These are the gaps an honest map must surface — every one is reachable from current code paths.

### #1 — DEAD CONFIG KNOB: `memoryRetrievalTokenBudget` is unwired
**File:line:** `src/config/schema.ts:1426` (default 2000) declared in `defaults` resolved schema; **NOT** forwarded by `SessionManager.getMemoryRetrieverForAgent` at `src/manager/session-manager.ts:565-582`.

```typescript
// session-manager.ts:573-580
return async (query: string) => {
  return retrieveMemoryChunks({
    query, store, embed,
    topK,                  // ← from config
    timeWindowDays: 14,    // ← hard-coded
    // tokenBudget         ← MISSING
  });
};
```

`retrieveMemoryChunks` falls through to its hard-coded default `tokenBudget = 2000` (`memory-retrieval.ts:128`). Per-agent override impossible without source change. Operators cannot tighten `<memory-context>` for any agent.

### #2 — Legacy `memory_lookup` returns untruncated bodies
**File:line:** `src/manager/memory-lookup-handler.ts:140-163` (the `scope='memories' && page=0` branch — i.e. the agent-facing default).

Returns:
```typescript
{ id, content: r.content, relevance_score, tags, created_at, source, linked_from }
```

`r.content` is the raw body string from `memories.content`. With `limit=5` (default) and individual session-summary memories regularly ≥ 2 KB, an LLM-initiated `memory_lookup` can stuff 10+ KB into the next turn's tool_result. The new path snippets to 500 chars (`conversation-search.types.ts:64`); the legacy path does not.

### #3 — No source/tag filter at hybrid retrieval
**File:line:** `searchMemoriesVec` at `store.ts:1324-1344` and `searchMemoryChunksVec` at `store.ts:1271-1284` accept *only* a query embedding and limit. The fan-out at `memory-retrieval.ts:143-147` merges everything.

Consequences:
- A `session-summary`-tagged memory can land in the pre-turn `<memory-context>` AND the resume-brief AND, if it's hot-promoted, the `## Key Memories` block — same content rendered three times.
- An `episode`-source memory can mix freely with `manual` notes in the same `<memory-context>`.
- Operator-authored vault rules in `memory_chunks` can rank below a stale `session-summary` row from `vec_memories` because both feeds are RRF-fused without source priority.

### #4 — `MEMORY.md` 50 KB hard cap, ZERO downstream budgeting
**File:line:** `src/manager/session-config.ts:388, 397` (`Buffer.byteLength > MEMORY_AUTOLOAD_MAX_BYTES`).

50 KB of UTF-8 markdown is roughly 12,500 tokens (4 chars/token approximation matches the rest of the codebase). It lands directly inside the `identity` slot — and the `identity` slot's `enforceWarnAndKeep` strategy at `context-assembler.ts:494-513` **explicitly never truncates**. Once the operator's `MEMORY.md` grows past comfortable, only a manual edit shrinks it.

### #5 — `<memory-context>` runs on every turn, no length floor
**File:line:** `turn-dispatcher.ts:574, 635, 686-711`.

```typescript
const query = message.trim();
if (query.length === 0) return message;
const chunks = await this.memoryRetriever(agentName, query);
```

A user message of `"ok"` or `"thanks"` triggers:
- 1 MiniLM forward pass (~50ms)
- 2 sqlite-vec MATCH queries (vec_memory_chunks + vec_memories @ k=20)
- 1 FTS5 BM25 query
- Hydrate up to 60 candidate chunks
- Time-window + sort + token-budget truncate

The retrieved chunks then get prepended to the user message — even when the message clearly doesn't warrant it. No skip heuristic, no min-length gate.

### #6 — `findByTag('session-summary')` has no LIMIT
**File:line:** `src/memory/store.ts:632-651` (the prepared SQL has no LIMIT clause); callers at `conversation-brief.ts:176` and `conversation-search.ts:129`.

Over a year of daily sessions, this is thousands of rows fetched into JS, sorted by `createdAt`, sliced. `conversation-brief.ts` does it on every session-config build (cached, but cache invalidates on every new terminated session). `conversation-search.ts` does it on every scope='all' or 'conversations' `memory_lookup`.

### #7 — `source='conversation'` rows never archive automatically
**File:line:** `src/memory/episode-archival.ts:46` archives ONLY `WHERE source = 'episode'`.

Cold-archive via `tier-manager.ts:runMaintenance` triggers when `relevance_score < 0.05` (`tiers.ts:129-141`), but session summaries have `importance=0.78` (`session-summarizer.ts:45`) — at that base, decay needs `accessedAt` ≥ 4× half-life (≈120 days at 30-day half-life) to drop below 0.05. The `accessedAt` is bumped every time the row is hit by `SemanticSearch.search` or `GraphSearch.search` graph-walk — which it WILL be repeatedly because session summaries are frequent semantic neighbours.

Result: session summaries pile up forever in `memories` + `vec_memories`. A 2-year-old agent has tens of thousands of them.

### #8 — Disk-side memory files never prune
**File:line:** Three writers, no retention:
- Cue files (`memory-cue.ts:102-135`)
- Mid-session flush files (`memory-flush.ts:213-290`)
- Subagent capture files (`subagent-capture.ts`)

All write to `<workspace>/memory/YYYY-MM-DD-*.md`. All get scanner-indexed into `memory_chunks` (path 2.6). NO retention sweep. The `applyTimeWindowFilter` at `memory-chunks.ts:166-175` excludes them from retrieval AFTER 14 days (unless under `vault/` or `procedures/`) — but the rows + embeddings stay in SQLite forever, growing the DB and the `vec_memory_chunks` index.

### #9 — Embedder truncates query at 200 words silently
**File:line:** `src/memory/embedder.ts:13, 84-88` (`MAX_WORDS=200`).

A long user message (e.g. paste of an error trace) gets word-split, sliced to 200 words, then embedded. The truncated portion silently does not influence semantic retrieval. No warn log. The FTS5 path uses the FULL query string (`store.ts:1299` — sanitised but not word-truncated), so the two rankers actually search slightly different things.

### #10 — `MEMORY.md` UTF-8 truncation can split a multi-byte codepoint
**File:line:** `src/manager/session-config.ts:388-396`. Comment acknowledges this: "Mid-multibyte-codepoint truncation is a theoretical concern but acceptable: MEMORY.md is markdown prose (mostly ASCII)". Not a fin-acquisition driver but a latent corruption point if MEMORY.md gains non-ASCII content (emoji, non-Latin scripts).

### #11 — `getMemoryForRetrieval` skips access bump deliberately
**File:line:** `src/memory/store.ts:1346-1391` ("intentional, to keep pre-turn auto-retrieval out of the recency signal").

But `searchMemoriesVec` (`store.ts:1324-1344`) is the ONLY surface that searches owned memories in the auto-retrieval path. So: a memory the agent reads literally every turn via `<memory-context>` will NEVER bump `access_count` (the auto path) AND therefore NEVER qualify for hot-tier access-based promotion. Only the centrality path (Phase 100-fu) saves it — assuming it accumulates ≥5 backlinks.

### #12 — `memory_save` hard-codes `source='conversation'`
**File:line:** `src/manager/daemon.ts:7545`. The MCP tool's Zod schema (`server.ts:707-735`) doesn't expose source. Agents cannot save with `source='manual'` or `'system'` even though those values are valid in the schema CHECK. This means every LLM-initiated save inherits the same archival half-life as session summaries.

### #13 — Compaction summaries duplicate session summaries
**File:line:** `src/memory/compaction.ts:117` writes `source='consolidation'`; `consolidation.ts:322, 377` writes `source='consolidation'` too. Plus the daily/weekly digest markdown files get re-indexed by the scanner into `memory_chunks` (path 2.6). The same compressed history can exist in:
- `memories` row (consolidation)
- `memory_chunks` rows (the markdown digest file's chunks)
- `vec_memories` (the consolidation row's embedding)
- `vec_memory_chunks` (each chunk's embedding)

All four can hit on the same query — RRF will rank them as four distinct documents.

### #14 — Hot-tier render is `slice(0, 3)` — most agents have far more
**File:line:** `src/manager/session-config.ts:414` and `src/memory/tier-manager.ts:313-317`.

`hotBudget = 20` (`tiers.ts:42`) means tier-maintenance allows up to 20 hot rows. But session-config slices to 3. Items 4-20 sit in the hot tier earning their access bumps and never get rendered. `getHotMemories()` returns sorted by importance desc, so low-importance "frequently accessed" hot rows are invisible to the agent.

### #15 — Conversation-brief raw-turn fallback dumps full transcripts
**File:line:** `session-summarizer.ts:115-125` (`buildRawTurnFallback`) writes the entire turn list verbatim into a `MemoryEntry`. Tag `raw-fallback` flags it. `conversation-brief.ts:117-121` substitutes a 1-line placeholder for these in the brief — BUT the raw-fallback memory IS still searchable via `vec_memories` and CAN land in the pre-turn `<memory-context>` as a giant blob. `retrieveMemoryChunks` has no `raw-fallback` filter.

### #16 — Memory-retrieval tokenBudget allows oversize first chunk
**File:line:** `src/memory/memory-retrieval.ts:228-231`:
```typescript
for (const h of limited) {
  const len = h.body.length;
  if (out.length > 0 && acc + len > tokenBudget * 4) break;
  out.push(...);
  acc += len;
}
```
"Always emit at least the first chunk" — a single 30 KB chunk passes the gate. With `topK=5` and most chunks at 200-800 tokens this rarely fires, but a session-summary that hit the 30 KB Haiku-prompt cap (`session-summarizer.ts:26`) becomes a single 30 KB-ish memory row that would singlehandedly blow the budget when first-ranked.

### #17 — `recent_history=8000` budget is measurement-only
**File:line:** `src/manager/context-assembler.ts:284, 348, 736` — `recent_history` budget defaults to 8000 tokens but the strategy is `passthrough` ("SDK owns delivery"). The assembler measures and emits a span metric but never truncates. The SDK's own history compaction is the only gate; if the SDK's internal compaction lags, `recent_history` runs unbounded.

### #18 — `auto-linker` runs on every memory insert (eager)
**File:line:** `src/memory/store.ts:251` (in `insert`) calls `autoLinkMemory` with `k=6` KNN over `vec_memories`. For a memory store with 10K rows, this is fine; for 100K it's noticeable on every insert. The cosine ≥ 0.6 threshold spawns 0-12 link rows per insert, growing `memory_links`.

### #19 — `session-summary` memories merged via dedup → wrong owner
**File:line:** `src/memory/store.ts:132-174`. New inserts run through `checkForDuplicate` at cosine ≥ 0.85 BEFORE source-aware logic. If two distinct session-summary contents are textually similar (e.g. two terse "Discussed deployment" summaries on consecutive days), they merge into a single row — losing the distinct `session:<id>` tag. Mitigated for session-summarizer by `skipDedup: true` (`session-summarizer.ts:324`) but `memory_save` MCP path doesn't set `skipDedup`.

### #20 — `is_trusted_channel` filter is FTS-only
**File:line:** `src/memory/conversation-store.ts:686-713`. The trusted-channel hygiene gate exists ONLY for `searchTurns` (FTS path). Memory rows derived from untrusted-channel turns (e.g. via `memory_save` from a turn that originated in an untrusted DM, or session-summaries built from sessions with mixed-trust turns) carry no trust marker. Once it's in `memories`, it's fully retrievable.

### #21 — fin-acquisition prompt-budget arithmetic
Per-turn allocation (current defaults) showing how 33K is structurally reachable BEFORE `recent_history`:

| Slot | Budget (tokens) | Source |
|---|---|---|
| identity | warn-only (no truncate); typical 1000+ | `context-assembler.ts:343` |
| soul | warn-only; typical 2000+ | `:344` |
| MEMORY.md auto-load | up to ~12,500 (50 KB byte cap) | `session-config.ts:388` |
| skills_header (lazy/full) | 1500 | `:346` |
| toolDefinitions (MCP block) | 2000 | `:348` |
| hot_tier (top-3) | 3000 | `:347` |
| conversation_context (resume brief) | 2000 | `schema.ts:87` |
| resume_summary (context-summary.md) | 1500 | `schema.ts:18` |
| `<memory-context>` (pre-turn auto) | 2000 | `memory-retrieval.ts:128` |
| recent_history | 8000 (measure-only) | `context-assembler.ts:348` |

Sum of the bounded slots alone: `1000 + 2000 + 12500 + 1500 + 2000 + 3000 + 2000 + 1500 + 2000 = 27,500 tokens`. With `recent_history` at typical session length plus identity/soul drift past their warn budgets, 33K (≈132K chars) is the trivial upper bound — and any oversize MEMORY.md, hot-tier overflow, or unbounded `<memory-context>` first-chunk blows past it. **No global ceiling exists** — `assembleContext` returns `{ stablePrefix, mutableSuffix, hotStableToken }` and never does a top-of-prompt sum.

`exceedsCeiling` at `context-assembler.ts:425-430` exists as a utility but is not called anywhere in the assembly path.

---

## 7. Per-Agent File Layout on Disk

```
<config.memoryPath>/
├── memories.db              # MemoryStore + ConversationStore + DocumentStore + api_key_sessions
├── memories.db-wal
├── memories.db-shm
├── usage.db                 # UsageTracker (separate)
├── traces.db                # TraceStore (separate)
└── memory/
    ├── MEMORY.md            # auto-loaded into stable prefix (50KB cap), excluded from scanner (memory-scanner.ts:49)
    ├── HEARTBEAT.md         # operational, excluded from scanner (:53)
    ├── context-summary.md   # written by compaction; loaded as resume_summary (mutable suffix)
    ├── YYYY-MM-DD.md        # daily session log (consolidation source)
    ├── YYYY-MM-DD-HHMM.md   # mid-session flush (writer 2.3)
    ├── YYYY-MM-DD-remember-XXXX.md   # cue (writer 2.4)
    ├── YYYY-MM-DD-subagent-<slug>.md # subagent capture (writer 2.5) — but path "subagent-*" is EXCLUDED from scanner (:47)
    ├── vault/**/*.md        # standing rules — score_weight +0.2, time-window-bypass
    ├── procedures/**/*.md   # runbooks — score_weight +0.1, time-window-bypass
    ├── archive/cold/<id>-<slug>.md   # cold-tier overflow with embedding_base64 frontmatter (tier-manager.ts:97-132)
    ├── digests/weekly-YYYY-WNN.md    # consolidation outputs (writer 2.9)
    └── digests/monthly-YYYY-MM.md
```

**Important asymmetry:** `memory-scanner.ts:47` excludes `memory/subagent-*` files from indexing — the subagent-capture writer (2.5) lands files matching `YYYY-MM-DD-subagent-<slug>.md`, NOT `subagent-*`. The exclusion regex `/\/memory\/subagent-/` does NOT match the dated filenames, so subagent capture files DO get indexed. Confirm by inspection:
- Excluded: `memory/subagent-2026-04-23-...md` (path starts with `subagent-`)
- Indexed: `memory/2026-04-23-subagent-research-task.md` (path starts with date)

This is presumably intentional (Phase 90-03's "subagent files" naming) but worth flagging — the exclusion and the writer disagree on naming.

---

## Reading list for the redesign team

In order of "most likely to load-bear":
1. `src/memory/memory-retrieval.ts` (the per-turn auto-injection — biggest unbounded surface).
2. `src/manager/memory-lookup-handler.ts` (the LLM-initiated tool — second-biggest).
3. `src/manager/context-assembler.ts` (where everything lands).
4. `src/manager/session-config.ts:355-757` (sources for stable prefix + mutable suffix).
5. `src/memory/store.ts` (every CRUD primitive + every migration).
6. `src/memory/tier-manager.ts` + `src/memory/tiers.ts` (cold-archive policy is the only place memories die).
7. `src/memory/session-summarizer.ts` (highest-volume writer to `memories`).
8. `src/memory/memory-scanner.ts` + `src/memory/memory-chunks.ts` (chunk-side ingestion — second highest write volume).

---

*End of map.*
