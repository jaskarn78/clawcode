# Phase 4: Memory System - Research

**Researched:** 2026-04-08
**Domain:** Per-agent persistent memory with SQLite storage, local embeddings, session logs, and auto-compaction
**Confidence:** HIGH

## Summary

Phase 4 adds a per-agent persistent memory subsystem built on better-sqlite3 + sqlite-vec for storage and vector search, @huggingface/transformers for local embeddings (all-MiniLM-L6-v2, 384-dim), daily markdown session logs, and auto-compaction at a configurable context fill threshold. Each agent gets its own isolated SQLite database at `{workspace}/memory/memories.db`. No consolidation, decay, or deduplication -- those are v1.x.

The core challenge is integrating three new dependencies (better-sqlite3, sqlite-vec, @huggingface/transformers) into the existing TypeScript/ESM codebase while maintaining the project's immutable data patterns and Zod validation. The embedding model cold-start (~2-5s first load, ~23MB download) needs careful handling at agent startup. sqlite-vec's vec0 virtual table with `distance_metric=cosine` provides optimized KNN search without manual brute-force scanning.

**Primary recommendation:** Build the memory module as a standalone `src/memory/` directory with clean interfaces, then integrate into SessionManager and Daemon. Use vec0 virtual tables (not manual vec_distance_cosine) for KNN search. Pre-warm the embedding pipeline on daemon boot, not on first memory write.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Each agent gets its own SQLite database file at `{workspace}/memory/memories.db`
- **D-02:** Primary `memories` table: id (TEXT UUID), content (TEXT), source (TEXT: conversation|manual|system), importance (REAL 0-1, default 0.5), access_count (INTEGER, default 0), embedding (BLOB, 384-dim float32 via sqlite-vec), tags (TEXT, JSON array), created_at (TEXT ISO), updated_at (TEXT ISO), accessed_at (TEXT ISO)
- **D-03:** `session_logs` table: id (TEXT UUID), date (TEXT YYYY-MM-DD), file_path (TEXT), entry_count (INTEGER), created_at (TEXT ISO)
- **D-04:** Use better-sqlite3 for synchronous SQLite access
- **D-05:** WAL mode enabled for concurrent read performance
- **D-06:** sqlite-vec extension loaded for vector similarity search
- **D-07:** Local embeddings via `@huggingface/transformers` with `all-MiniLM-L6-v2` model (384 dimensions)
- **D-08:** Embeddings generated on memory write, stored as BLOB in SQLite
- **D-09:** Pre-warm embedding model on agent startup (first call downloads ONNX model)
- **D-10:** Semantic search uses cosine similarity via sqlite-vec `vec_distance_cosine`
- **D-11:** Daily markdown files at `{workspace}/memory/YYYY-MM-DD.md`
- **D-12:** Each log entry has timestamp, role (user/assistant), and content
- **D-13:** Logs flushed on compaction trigger or end-of-day boundary
- **D-14:** Session log table tracks which daily files exist with entry counts
- **D-15:** Context fill monitored via Agent SDK session metadata (token usage)
- **D-16:** Compaction triggers at 75% context fill threshold (configurable in clawcode.yaml)
- **D-17:** On compaction: flush current conversation to daily log, extract key facts as memories, create context summary, start fresh session with summary injected
- **D-18:** Memory extraction uses the agent itself to identify important facts from the conversation before compaction
- **D-19:** Each memory entry has: source, importance (0-1 float), access_count, tags
- **D-20:** access_count incremented on every retrieval (search hit)
- **D-21:** accessed_at updated on every retrieval
- **D-22:** importance defaults to 0.5, can be adjusted by the agent or manually

### Claude's Discretion
- UUID generation library choice
- Exact sqlite-vec extension loading path on this Linux system
- Session log markdown formatting details
- Context summary prompt for compaction
- Number of top-K results for semantic search (recommend 10)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | Each agent has its own SQLite database for persistent memory storage | better-sqlite3 12.8.0 + per-agent DB at `{workspace}/memory/memories.db`. Schema from D-02, D-03. |
| MEM-02 | Agent conversations are flushed to daily markdown session logs | Daily markdown files at `{workspace}/memory/YYYY-MM-DD.md` with timestamp/role/content entries. |
| MEM-03 | Auto-compaction triggers at a configurable context fill threshold | 75% threshold (configurable), monitored via session metadata. Compaction flow: flush -> extract -> summarize -> restart. |
| MEM-04 | Memory flush occurs before compaction to preserve context snapshot | Flush current conversation to daily log BEFORE extracting memories and compacting. |
| MEM-05 | Semantic search across agent memories via sqlite-vec and local embeddings | sqlite-vec 0.1.9 vec0 virtual table with cosine distance + @huggingface/transformers 4.0.1 all-MiniLM-L6-v2 384-dim embeddings. |
| MEM-06 | Memory entries include metadata (timestamp, source, access count, importance) | Schema D-02: source, importance, access_count, tags, created_at, updated_at, accessed_at. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Immutability:** ALWAYS create new objects, NEVER mutate existing ones. All memory types must be `readonly`.
- **File organization:** Many small files (200-400 lines). Memory module should be multiple focused files, not one monolith.
- **Error handling:** Handle errors explicitly at every level. SQLite operations must have proper error handling.
- **Input validation:** Use Zod schema validation for memory entries and config extensions.
- **Security:** No hardcoded secrets. SQLite file permissions should be restrictive (600).
- **Git workflow:** Meaningful commits, review before push.
- **GSD workflow:** All changes through GSD commands.

## Standard Stack

### Core (New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Synchronous SQLite access | Fastest Node.js SQLite driver. Single-threaded, synchronous API perfect for per-agent isolated DBs. Proven sqlite-vec compatibility. |
| @types/better-sqlite3 | 7.6.13 | TypeScript definitions | Required for type safety with better-sqlite3. |
| sqlite-vec | 0.1.9 | Vector search SQLite extension | Pure-C extension, no dependencies. Loads via `sqliteVec.load(db)`. Supports cosine distance via vec0 virtual tables. |
| @huggingface/transformers | 4.0.1 | Local ONNX embeddings | Runs all-MiniLM-L6-v2 locally. Zero API cost. ~23MB model download cached in `~/.cache/huggingface`. |

### Already in Project (Reuse)
| Library | Version | Purpose | How Used |
|---------|---------|---------|----------|
| nanoid | 5.1.7 | UUID generation | Already a dependency. Use for memory entry IDs and session log IDs. |
| zod | 4.3.6 | Schema validation | Already a dependency. Use for memory config schema, entry validation. |
| pino | 9.x | Structured logging | Already a dependency. Use for memory operation logging. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vec0 virtual table (MATCH) | Manual vec_distance_cosine() | vec0 is faster and more compact; manual is more flexible but brute-force. Use vec0 for this use case. |
| nanoid (for UUIDs) | crypto.randomUUID() | nanoid already in project; either works fine. Stick with nanoid for consistency. |
| better-sqlite3 | node:sqlite (built-in) | Node built-in SQLite is still experimental. Not production-ready. |

**Installation:**
```bash
npm install better-sqlite3 sqlite-vec @huggingface/transformers
npm install -D @types/better-sqlite3
```

**Version verification:** All versions confirmed via `npm view` on 2026-04-08.

## Architecture Patterns

### Recommended Module Structure
```
src/memory/
  store.ts            # MemoryStore class: SQLite CRUD, schema init, WAL config
  embedder.ts         # EmbeddingService: @huggingface/transformers pipeline wrapper
  search.ts           # SemanticSearch: vec0 KNN queries, result ranking
  session-log.ts      # SessionLogger: daily markdown file write/append
  compaction.ts       # CompactionManager: threshold check, flush, extract, restart
  types.ts            # MemoryEntry, SessionLogEntry, MemoryConfig types
  schema.ts           # Zod schemas for memory entries and config
  errors.ts           # MemoryError, EmbeddingError classes (or extend shared/errors.ts)
  index.ts            # Public API barrel export
```

### Pattern 1: Standalone MemoryStore with Synchronous SQLite

**What:** A class that wraps better-sqlite3 with prepared statements for all memory operations. Opens DB, enables WAL, loads sqlite-vec, creates tables if not exist.

**When to use:** For all memory CRUD operations.

**Example:**
```typescript
// Source: sqlite-vec official docs + better-sqlite3 docs
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export class MemoryStore {
  private readonly db: Database.Database;
  private readonly stmts: PreparedStatements;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    sqliteVec.load(this.db);
    this.initSchema();
    this.stmts = this.prepareStatements();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('conversation', 'manual', 'system')),
        importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
        access_count INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accessed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_logs (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        file_path TEXT NOT NULL,
        entry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[384] distance_metric=cosine
      );
    `);
  }
  // ...
}
```

### Pattern 2: Singleton Embedding Pipeline

**What:** A shared embedding pipeline instance created once and reused. The @huggingface/transformers `pipeline()` function downloads the model on first call and caches it. Pre-warm at daemon startup.

**When to use:** For all embedding operations.

**Example:**
```typescript
// Source: @huggingface/transformers docs, Xenova/all-MiniLM-L6-v2
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let instance: FeatureExtractionPipeline | null = null;

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!instance) {
    instance = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }
  return instance;
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getEmbedder();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  // output.tolist() returns number[][], we want Float32Array for sqlite-vec
  const data = output.tolist()[0] as number[];
  return new Float32Array(data);
}
```

### Pattern 3: vec0 Virtual Table for KNN Search

**What:** Use sqlite-vec's vec0 virtual table with `distance_metric=cosine` instead of manual `vec_distance_cosine()`. The vec0 table stores vectors separately and uses optimized KNN internally.

**When to use:** For all semantic search queries. Top-K results via `k = N` parameter.

**Example:**
```typescript
// Source: sqlite-vec KNN docs
// Insert: both memories table AND vec_memories table (in a transaction)
const insertMemory = db.transaction((entry: MemoryEntry, embedding: Float32Array) => {
  stmts.insertMemory.run(
    entry.id, entry.content, entry.source, entry.importance,
    JSON.stringify(entry.tags), entry.createdAt, entry.updatedAt, entry.accessedAt,
  );
  stmts.insertVec.run(entry.id, embedding);
});

// Search: query vec_memories, JOIN back to memories for metadata
const searchStmt = db.prepare(`
  SELECT
    m.id, m.content, m.source, m.importance, m.access_count,
    m.tags, m.created_at, m.updated_at, m.accessed_at,
    v.distance
  FROM vec_memories v
  INNER JOIN memories m ON m.id = v.memory_id
  WHERE v.embedding MATCH ?
    AND k = ?
  ORDER BY v.distance
`);

function search(queryEmbedding: Float32Array, topK: number = 10): SearchResult[] {
  const rows = searchStmt.all(queryEmbedding, topK);
  // Update access_count and accessed_at for each returned result
  for (const row of rows) {
    stmts.updateAccess.run(row.id);
  }
  return rows.map(toSearchResult);
}
```

### Pattern 4: Daily Markdown Session Logs

**What:** Append conversation entries to `{workspace}/memory/YYYY-MM-DD.md`. Each entry has timestamp, role, and content. File created on first write per day.

**When to use:** On compaction trigger (D-13) or end-of-day boundary.

**Example markdown format:**
```markdown
# Session Log: 2026-04-08

## 14:32:15 [user]
Can you help me with the API integration?

## 14:32:48 [assistant]
I'll help you set up the API integration. Let me start by...

## 15:01:22 [user]
What about error handling?

## 15:01:55 [assistant]
For error handling, we should...
```

### Pattern 5: Compaction Flow (Flush-Extract-Summarize-Restart)

**What:** When context fill hits threshold: (1) flush conversation to daily log, (2) use the agent to extract key facts as memories, (3) create a context summary, (4) start fresh session with summary injected.

**When to use:** At 75% context fill threshold (D-16).

**Integration point:** This hooks into SessionManager -- the compaction manager needs access to the session to read context fill percentage and to restart the session with a summary.

### Anti-Patterns to Avoid

- **Monolith memory module:** Do NOT put all memory logic in a single file. Split into store, embedder, search, session-log, compaction.
- **Mutable memory entries:** All MemoryEntry types must be `readonly`. Updates produce new objects.
- **Embedding on read:** Never compute embeddings at search time. Embeddings are computed on write (D-08) and stored as BLOBs.
- **Direct vec_distance_cosine brute-force:** Use vec0 virtual tables instead. They are faster and more compact for KNN.
- **Shared SQLite database:** Each agent MUST have its own isolated database (D-01). Never share a DB between agents.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine similarity in JS | sqlite-vec vec0 virtual table | C-level SIMD acceleration, handles edge cases, tested |
| Text embeddings | Custom embedding logic | @huggingface/transformers pipeline | ONNX-optimized, model management, caching |
| SQLite migrations | Manual ALTER TABLE scripts | Versioned schema init with IF NOT EXISTS | Simple schema, no migration framework needed yet |
| UUID generation | crypto.randomUUID() | nanoid (already in project) | Consistency with existing codebase |
| Markdown file I/O | Complex stream handling | Simple fs.appendFile / fs.writeFile | Daily logs are append-only, small files |

**Key insight:** The heavy lifting (vector search, embeddings) is handled by native extensions. The application code is glue that manages lifecycle, schema, and integration.

## Common Pitfalls

### Pitfall 1: Embedding Model Cold Start
**What goes wrong:** First call to `pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")` downloads ~23MB ONNX model from HuggingFace Hub. If this happens on first memory write, user experiences multi-second latency.
**Why it happens:** The model is cached in `~/.cache/huggingface` but not pre-downloaded.
**How to avoid:** Pre-warm the embedding pipeline at daemon startup (D-09). Call `getEmbedder()` during initialization, before any agent starts processing messages.
**Warning signs:** First memory write takes 2-5 seconds; subsequent writes are fast (~50ms).

### Pitfall 2: sqlite-vec Extension Load Failure
**What goes wrong:** `sqliteVec.load(db)` fails because the native extension binary is not found or incompatible with the platform.
**Why it happens:** sqlite-vec npm package downloads a prebuilt binary for the platform. If the platform is unsupported or the download fails, the extension is missing.
**How to avoid:** Verify sqlite-vec loads successfully at database initialization. Fail fast with a clear error message. Test on the target platform (Linux x64).
**Warning signs:** "cannot open shared object file" or "extension loading error" at startup.

### Pitfall 3: vec0 Virtual Table Requires Separate INSERT
**What goes wrong:** Inserting a memory into the `memories` table does NOT automatically insert the embedding into `vec_memories`. They are separate tables that must be kept in sync.
**Why it happens:** vec0 is a virtual table with its own storage. It knows nothing about the `memories` table.
**How to avoid:** Use a better-sqlite3 transaction to insert into both `memories` and `vec_memories` atomically. Delete from both on memory removal.
**Warning signs:** Semantic search returns no results even though memories exist, or returns results for deleted memories.

### Pitfall 4: Float32Array Buffer Passing to sqlite-vec
**What goes wrong:** Passing a regular JavaScript array `[0.1, 0.2, ...]` to sqlite-vec instead of `Float32Array` causes type errors or incorrect results.
**Why it happens:** sqlite-vec expects raw binary vector data. `Float32Array` provides the correct binary representation.
**How to avoid:** Always convert embeddings to `Float32Array` before passing to sqlite-vec. The `@huggingface/transformers` pipeline returns a Tensor; call `.tolist()[0]` then wrap in `new Float32Array()`.
**Warning signs:** "wrong type" errors or garbage similarity scores.

### Pitfall 5: Context Fill Percentage Not Available from SDK
**What goes wrong:** The Agent SDK may not expose token usage or context fill percentage in the session metadata, making it impossible to implement D-15/D-16.
**Why it happens:** The SDK is pre-1.0 and the V2 API surface is unstable. Token counting may not be a public API.
**How to avoid:** Research the SDK's actual API surface for token/context info. If not available, implement a heuristic: count characters or tokens from conversation turns. Phase 5 (Heartbeat) will also need this.
**Warning signs:** No `tokenUsage` or `contextPercentage` property on session objects.

### Pitfall 6: WAL File Growth Without Checkpointing
**What goes wrong:** SQLite WAL file grows unbounded because no checkpoint is triggered, especially with frequent writes.
**Why it happens:** Auto-checkpoint triggers at 1000 WAL pages by default, but if reads keep the WAL open, checkpoint starvation occurs.
**How to avoid:** Set `db.pragma("wal_autocheckpoint = 1000")` (default) and periodically run `db.pragma("wal_checkpoint(TRUNCATE)")` on idle.
**Warning signs:** WAL files growing to hundreds of MB.

## Code Examples

### Complete MemoryStore Initialization
```typescript
// Source: better-sqlite3 + sqlite-vec official examples
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { nanoid } from "nanoid";

export function createMemoryStore(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Performance pragmas
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL"); // Safe with WAL mode
  db.pragma("foreign_keys = ON");

  // Load sqlite-vec extension
  sqliteVec.load(db);

  return db;
}
```

### Embedding Generation
```typescript
// Source: @huggingface/transformers docs
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export class EmbeddingService {
  private pipeline: FeatureExtractionPipeline | null = null;
  private warmPromise: Promise<void> | null = null;

  async warmup(): Promise<void> {
    if (this.warmPromise) return this.warmPromise;
    this.warmPromise = this.doWarmup();
    return this.warmPromise;
  }

  private async doWarmup(): Promise<void> {
    this.pipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.pipeline) {
      await this.warmup();
    }
    const output = await this.pipeline!(text, {
      pooling: "mean",
      normalize: true,
    });
    const data = output.tolist()[0] as number[];
    return new Float32Array(data);
  }
}
```

### KNN Search with JOIN
```typescript
// Source: sqlite-vec KNN docs
const SEARCH_SQL = `
  SELECT
    m.id, m.content, m.source, m.importance, m.access_count,
    m.tags, m.created_at, m.updated_at, m.accessed_at,
    v.distance
  FROM vec_memories v
  INNER JOIN memories m ON m.id = v.memory_id
  WHERE v.embedding MATCH ?
    AND k = ?
  ORDER BY v.distance
`;

const UPDATE_ACCESS_SQL = `
  UPDATE memories
  SET access_count = access_count + 1,
      accessed_at = ?
  WHERE id = ?
`;
```

### Daily Session Log Write
```typescript
import { appendFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export async function appendToSessionLog(
  logPath: string,
  timestamp: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const entry = `\n## ${timestamp} [${role}]\n${content}\n`;
  if (!existsSync(logPath)) {
    const date = logPath.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "unknown";
    const header = `# Session Log: ${date}\n`;
    await writeFile(logPath, header + entry, "utf-8");
  } else {
    await appendFile(logPath, entry, "utf-8");
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| sqlite-vss (Faiss-based) | sqlite-vec (pure C) | 2024 | No Faiss dependency, simpler builds, better portability |
| @xenova/transformers | @huggingface/transformers | 2025 (v3 -> v4) | Same author, new npm scope. Old package deprecated. |
| Manual cosine similarity in JS | vec0 virtual table with distance_metric=cosine | sqlite-vec 0.1.x | C-level SIMD acceleration, much faster for KNN |
| External embedding APIs | Local ONNX models | 2024-2025 | Zero cost, zero latency, offline-capable |

**Deprecated/outdated:**
- `@xenova/transformers`: Old package name. Use `@huggingface/transformers` v4.x.
- `sqlite-vss`: Deprecated by its author. Use `sqlite-vec`.
- Manual `vec_distance_cosine()`: Works but vec0 is preferred for KNN queries.

## D-10 Clarification: vec_distance_cosine vs vec0 MATCH

CONTEXT.md D-10 says "cosine similarity via sqlite-vec `vec_distance_cosine`". Research shows two approaches:

1. **`vec_distance_cosine()`**: Scalar function for brute-force pairwise distance. Flexible but slow on large datasets.
2. **`vec0` virtual table with `distance_metric=cosine`**: Optimized KNN via `MATCH` clause. Faster, more compact.

**Recommendation:** Use vec0 with `distance_metric=cosine` for the KNN search. This achieves the intent of D-10 (cosine similarity) with better performance. The `vec_distance_cosine` function name in D-10 appears to reference the cosine distance metric, not mandating the specific scalar function approach.

## Open Questions

1. **Context fill percentage from SDK**
   - What we know: D-15 says "context fill monitored via Agent SDK session metadata (token usage)". The SDK is pre-1.0 (v0.2.x).
   - What's unclear: Whether the SDK exposes token usage or context fill percentage. The V2 preview may not have this API.
   - Recommendation: Implement the compaction manager with a pluggable threshold checker. If SDK metadata is unavailable, use a character/token count heuristic from conversation turns. Phase 5 (Heartbeat) will also need this, so design the interface to be reusable.

2. **Compaction session restart mechanics**
   - What we know: D-17 says "start fresh session with summary injected". SessionManager has `restartAgent()`.
   - What's unclear: How to inject a context summary into the new session's system prompt. The current `buildSessionConfig` reads SOUL.md and IDENTITY.md but has no mechanism for injecting dynamic context.
   - Recommendation: Extend `buildSessionConfig` to accept an optional `contextSummary` parameter that gets appended to the system prompt. Store the latest summary in the memory store.

3. **all-MiniLM-L6-v2 token limit**
   - What we know: The model handles max 256 tokens (~128 tokens for good results). Memory content longer than this will produce degraded embeddings.
   - What's unclear: How to handle long memory entries.
   - Recommendation: Truncate memory content to ~200 words before embedding. Store full content in SQLite but embed only the truncated version.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run --reporter=verbose src/memory/` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | Agent has isolated SQLite DB with schema | unit | `npx vitest run src/memory/__tests__/store.test.ts -x` | Wave 0 |
| MEM-02 | Conversations flushed to daily markdown logs | unit | `npx vitest run src/memory/__tests__/session-log.test.ts -x` | Wave 0 |
| MEM-03 | Auto-compaction triggers at threshold | unit | `npx vitest run src/memory/__tests__/compaction.test.ts -x` | Wave 0 |
| MEM-04 | Memory flush before compaction | integration | `npx vitest run src/memory/__tests__/compaction.test.ts -x` | Wave 0 |
| MEM-05 | Semantic search via embeddings | unit | `npx vitest run src/memory/__tests__/search.test.ts -x` | Wave 0 |
| MEM-06 | Memory metadata (timestamp, source, access_count, importance) | unit | `npx vitest run src/memory/__tests__/store.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/memory/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/memory/__tests__/store.test.ts` -- covers MEM-01, MEM-06
- [ ] `src/memory/__tests__/session-log.test.ts` -- covers MEM-02
- [ ] `src/memory/__tests__/compaction.test.ts` -- covers MEM-03, MEM-04
- [ ] `src/memory/__tests__/search.test.ts` -- covers MEM-05
- [ ] `src/memory/__tests__/embedder.test.ts` -- embedding service tests
- [ ] Dependencies installed: `npm install better-sqlite3 sqlite-vec @huggingface/transformers && npm install -D @types/better-sqlite3`

### Testing Notes

**Embedding tests:** The embedding model download (~23MB) is too slow for unit tests. Mock the EmbeddingService in search tests. Test the actual embedding pipeline only in a dedicated integration test or with a pre-cached model.

**SQLite tests:** Use in-memory databases (`:memory:`) for unit tests. No filesystem cleanup needed. sqlite-vec loads fine in memory databases.

**Compaction tests:** Mock the session adapter and SDK token metadata. Test the threshold detection and flush flow independently from actual SDK sessions.

## Sources

### Primary (HIGH confidence)
- [sqlite-vec Node.js usage](https://alexgarcia.xyz/sqlite-vec/js.html) -- load pattern, vec0 API, Float32Array usage
- [sqlite-vec KNN queries](https://alexgarcia.xyz/sqlite-vec/features/knn.html) -- vec0 virtual table, MATCH syntax, distance_metric=cosine
- [sqlite-vec GitHub demo](https://github.com/asg017/sqlite-vec/blob/main/examples/simple-node/demo.mjs) -- complete better-sqlite3 integration example
- [sqlite-vec API Reference](https://alexgarcia.xyz/sqlite-vec/api-reference.html) -- vec_distance_cosine, vec_length, vec_f32 functions
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0 API, WAL mode, prepared statements
- [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) -- ONNX model, 384-dim, feature-extraction pipeline
- [@huggingface/transformers v4 announcement](https://huggingface.co/blog/transformersjs-v4) -- v4 npm availability, pipeline API
- npm registry -- all versions verified via `npm view` on 2026-04-08

### Secondary (MEDIUM confidence)
- [How to Create Vector Embeddings in Node.js](https://philna.sh/blog/2024/09/25/how-to-create-vector-embeddings-in-node-js/) -- pipeline usage pattern with @huggingface/transformers
- [How sqlite-vec Works (Medium)](https://medium.com/@stephenc211/how-sqlite-vec-works-for-storing-and-querying-vector-embeddings-165adeeeceea) -- vec0 vs manual approach comparison
- Project PITFALLS.md -- SQLite concurrency, embedding cold start, memory poisoning
- Project ARCHITECTURE.md -- tiered memory design, module boundaries

### Tertiary (LOW confidence)
- Agent SDK context/token metadata API -- not verified; may not exist in v0.2.x

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified via npm, APIs confirmed via official docs
- Architecture: HIGH -- follows established project patterns (immutable types, Zod, pino), module structure consistent with existing code
- Pitfalls: HIGH -- SQLite and embedding pitfalls well-documented in project research and official docs
- Compaction integration: MEDIUM -- depends on SDK API surface for token counting (unverified)

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (stable libraries, 30-day window)
