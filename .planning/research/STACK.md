# Stack Research: OpenClaw → ClawCode Migration Tooling

**Domain:** One-shot data migration tooling inside an existing TypeScript/Node CLI codebase
**Researched:** 2026-04-20
**Confidence:** HIGH
**Milestone:** v2.1 OpenClaw Agent Migration

## TL;DR — Stack Delta

**ZERO new runtime dependencies required.** The migration CLI ships entirely on ClawCode's existing stack. The only candidate library with a real benefit (pretty structured diff output for the dry-run UI) is `jsondiffpatch`, and even that is replaceable with a hand-rolled diff since the objects being compared are small and structured. Default recommendation: ship with current deps.

**One forced-hand finding:** re-embedding is **mandatory, not optional**. See `## Reality Check: Embeddings` below. This is the single biggest cost driver for the milestone and must be surfaced to the roadmapper.

---

## Reality Check: Embeddings (read before anything else)

Direct inspection of the 15 source DBs at `~/.openclaw/memory/*.sqlite`:

| Source agent | Chunks | Embedding model | Dims | Storage format |
|---|---|---|---|---|
| fin-acquisition | 597 | gemini-embedding-001 | **3072** | JSON text (~66KB/row) |
| finmentum-content-creator | 224 | gemini-embedding-001 | 3072 | JSON text |
| finmentum | 65 | gemini-embedding-001 | 3072 | JSON text |
| general | 878 | gemini-embedding-001 | 3072 | JSON text |
| personal | 47 | **embeddinggemma-300m (local GGUF)** | **768** | JSON text |
| projects | 519 | gemini-embedding-001 | 3072 | JSON text |
| research | 287 | gemini-embedding-001 | 3072 | JSON text |
| fin-research, fin-playground, fin-tax, shopping, work, kimi, local-clawdy, 0 | **0** | — | — | empty |

**Totals:** ~2,617 populated chunks across 7 agents. 8 agents have empty memory DBs (nothing to translate).

**ClawCode target:** `vec_memories USING vec0(embedding float[384] distance_metric=cosine)` — locked at 384 dims by every consumer (`session-memory.ts`, `graph-search.ts`, `tier-manager.ts`).

**Implication — there is no "reuse embeddings directly" path:**
- Dimensional mismatch (3072 vs 384, and 768 vs 384) is not solvable by re-slicing or projecting without quality loss.
- Provider mismatch (Gemini cloud vs local MiniLM) means vectors aren't in the same semantic space — cosine similarity between them is meaningless.
- The `personal` agent's embeddinggemma is also not ClawCode's MiniLM, so even same-family local vectors don't carry over.

**Re-embedding cost estimate (HIGH confidence):**
- 2,617 chunks × ~50ms/embedding (observed singleton perf in `src/memory/embedding.ts`) = **~131 seconds total** if serial, ~20–30s with warmup amortized across agents.
- Zero API cost (local ONNX).
- Model is already resident (warm-path optimization in v1.7).

This reframes the memory-translator phase from "blob copy" to "text → re-embed → insert." Still trivial in wall time, but the roadmapper should NOT scope it as "just translate schemas."

---

## Recommended Stack (Delta)

### Additions: NONE

The migration CLI is a greenfield `src/cli/commands/migrate-openclaw.ts` subcommand + supporting module under `src/migration/`. Every dependency it needs is already locked in `package.json`.

### Existing Dependencies — How Each Is Reused

| Existing dep | Version | Role in migration tool | Why no substitute is needed |
|---|---|---|---|
| `better-sqlite3` | ^12.8.0 | Read source `chunks` table, write target `memories` + `vec_memories` | Sync API + `ATTACH DATABASE` verified working end-to-end against real OpenClaw DB (see Verified Spike below). No driver swap can improve this. |
| `sqlite-vec` | ^0.1.9 | `.load(db)` on the destination handle before inserting float32 vectors into `vec_memories` | Already how `MemoryStore` works. The source DB's vectors are plain TEXT columns, not `vec0` virtual tables, so no extension is needed to *read* source — just to *write* target. |
| `@huggingface/transformers` | ^4.0.1 | Re-embed every source chunk's `text` column into 384-dim MiniLM before insert | Mandatory: 3072-dim Gemini vectors can't feed a 384-dim `vec0` table. Singleton embedder is already cached (`src/memory/embedding.ts`), ~50ms/row warm. |
| `commander` | ^14.0.3 | `clawcode migrate openclaw [--dry-run] [--agent <id>] [--apply]` subcommand | CLI is already wired (`src/cli/index.ts`); just register a new command module. |
| `yaml` | ^2.8.3 | Read existing `clawcode.yaml`, merge new agent entries back, preserve comments where possible | Already in use via `src/config/loader.ts`. The `yaml` package (eemeli/yaml) has `Document` AST for comment-preserving edits — `js-yaml` does NOT. Don't swap. |
| `zod` | ^4.3.6 | Validate parsed `openclaw.json` entries before mapping, validate emitted `clawcode.yaml` block round-trips | Already the project's validator of choice. |
| `nanoid` | ^5.1.7 | Generate ClawCode-shaped memory IDs if source IDs collide or aren't in the `memories.id` TEXT format | Already project-wide. Source chunks use SHA256 hash IDs; these are fine to reuse as-is, but nanoid is available if we need fresh IDs for derived summary memories. |
| `pino` | ^9 | Structured migration log → `~/.clawcode/migration/<timestamp>.jsonl` for audit trail | Already the project logger. |
| `date-fns` | ^4.1.0 | Translate OpenClaw `mtime` (unix seconds) → ClawCode `created_at` / `accessed_at` (ISO strings, per `memories` schema) | Already in deps; `formatISO(fromUnixTime(mtime))` is one line. |
| `chokidar` | ^5.0.0 | NOT needed for migration, but confirms no file-watching dep gap | — |
| Node 22 built-in `fs.promises.cp` | — | Workspace directory copy with `{ recursive: true, verbatimSymlinks: true, preserveTimestamps: true, filter }` | Verified via docs: preserves symlinks without dereferencing, preserves mtimes, takes a per-entry filter function (skip `node_modules`, `.git`, virtualenv `lib64` symlinks, etc.). See "Why not fs-extra" below. |

### Supporting Modules (code, not deps)

New files under `src/migration/`, all using only the table above:

| Module | Purpose |
|---|---|
| `openclaw-config-reader.ts` | Parse `~/.openclaw/openclaw.json` via `JSON.parse` + zod schema |
| `source-memory-reader.ts` | Open source `.sqlite` read-only, stream `chunks` rows with prepared statements |
| `config-mapper.ts` | OpenClaw agent entry → ClawCode YAML node (identity/soul pulled from workspace files) |
| `workspace-copier.ts` | `fs.promises.cp` with filter — covered in detail below |
| `memory-translator.ts` | `ATTACH` source → read chunks → re-embed → insert into target `memories` + `vec_memories` |
| `diff-planner.ts` | Build per-agent plan object: `{ configChanges, filesToCopy, chunksToTranslate, collisions, warnings }` |
| `dry-run-renderer.ts` | Structured console output of the plan (table per agent, summary totals) |

---

## Answers to the Specific Questions

### 1. Can we reuse OpenClaw's embeddings directly?

**NO.** Dimensional and provider mismatch (3072-dim Gemini / 768-dim embeddinggemma vs ClawCode's 384-dim MiniLM). Re-embedding is mandatory. Cost is ~131 seconds wall time for the full 2,617-chunk corpus, zero API spend — acceptable. No library addition changes this.

### 2. Any schema-diff / dry-run utility?

**Not needed as a library.** Dry-run output for this scale (15 agents × a handful of config fields × some file paths) is better rendered by hand-rolled table/list printing. Reasons:

- The diff isn't between two free-form JSON blobs; it's between a structured `OpenclawAgentEntry` and the derived `ClawcodeAgentSpec`. The "diff" is really a **plan preview**, not a structural diff.
- Rendering the preview as a markdown-ish table in the terminal gives ops a readable audit — `jsondiffpatch` output (HTML or colored JSON) is less readable for this shape.
- `diff@9.0.0` or `jsondiffpatch@0.7.3` would be optional if we later want unified-diff output for the YAML merge preview. Leave as a v2.1.x follow-up, not a v2.1 blocker.

**Recommendation:** ship without. If reviewers specifically ask for unified YAML diff output, add `diff@^9` (tiny, no deps, MIT) — but prove the need first.

### 3. Better than `fs.cp` for workspace copy?

**NO — Node 22's built-in `fs.promises.cp` is strictly sufficient.** Verified options:

```ts
await fs.cp(src, dest, {
  recursive: true,
  verbatimSymlinks: true,     // preserves symlinks verbatim, no dereference
  preserveTimestamps: true,
  errorOnExist: true,
  force: false,
  filter: (src) => !src.includes("/node_modules/") &&
                   !src.includes("/.git/") &&
                   !src.endsWith("/instagram-env/lib64"), // venv symlink pitfall
});
```

Why not `fs-extra@11.3.4`? It was the standard choice in Node 14–18 when `fs.cp` didn't exist or lacked symlink/timestamp options. In Node 22, `fs.cp` is feature-parity for our needs (`copy`, `copySync`, symlink preservation, filter). Adding it is 500KB + a transitive `graceful-fs` for zero benefit.

Why not `cpy@11.x`? It's glob-first and streams — overkill. We know exactly which directory to copy per agent.

**Scale check:** `.learnings/` dirs are 16–24KB each (verified via `du -sh`). Whole workspaces are a few hundred MB max. `fs.cp` handles this in seconds; streaming isn't needed.

**Symlink pitfall to document:** `workspace-general/finmentum/instagram-env/lib64` is a Python venv self-reference symlink. The `filter` function must skip these or the copy will succeed but ClawCode's chokidar watcher may choke on recursive symlink traversal later. This is a PITFALL.md entry, not a library choice.

### 4. Does better-sqlite3 + sqlite-vec support the source schema?

**YES — verified by live spike.** Source DBs use plain TEXT columns for embeddings (JSON arrays), no `vec0` virtual tables, no extensions required to read them. The destination needs `sqlite-vec` loaded to write `vec_memories`, which is already how `MemoryStore` works.

Live verification run on `fin-acquisition.sqlite` (597 chunks):

```js
const db = new Database(":memory:");
sqliteVec.load(db);                                      // load ext on destination-shaped handle
db.exec("ATTACH DATABASE '…/fin-acquisition.sqlite' AS src");
db.prepare("SELECT COUNT(*) FROM src.chunks").get();     // → { n: 597 } ✅
db.prepare("SELECT id, path, length(embedding), model FROM src.chunks LIMIT 1").get();
// → { id: "fea2ef…", path: "memory/graph/entities/alpha_vantage.md",
//     "length(embedding)": 66268, model: "gemini-embedding-001" } ✅
```

So: read source via ATTACH, ignore source `embedding` TEXT column (can't reuse — see Q1), re-embed `text` with the existing `getEmbedder()` singleton, insert into destination `memories` + `vec_memories` in one transaction per agent.

### 5. Is there an ATTACH DATABASE single-transaction pattern?

**YES — and it's the recommended shape.** Because:

- `better-sqlite3` supports `db.exec("ATTACH DATABASE '…/source.sqlite' AS src")` — verified.
- Since source and target live on the same filesystem, ATTACH is O(open fd) with zero copy.
- Wrapping the per-agent translation in `db.transaction(() => { ... })()` gives atomicity: either the full agent migration commits or nothing does.
- Don't attempt a single mega-transaction across all 15 agents — keep transactions per-agent so one agent's failure doesn't block the rest, and so dry-run vs apply has clean per-agent boundaries.
- `PRAGMA foreign_keys = ON` isn't needed here; destination `vec_memories` is a virtual table and has no FK relationship to `memories` at the schema level — application code must delete from both (already handled in `MemoryStore.delete`).

**Pseudocode shape (for planner):**
```ts
const target = new Database(targetPath);
sqliteVec.load(target);
target.exec(`ATTACH DATABASE '${sourcePath}' AS src`);

const migrate = target.transaction((agentId: string) => {
  const rows = target.prepare(`
    SELECT c.id, c.path, c.text, c.start_line, c.end_line, c.updated_at,
           f.mtime, f.source AS file_source
    FROM src.chunks c JOIN src.files f ON c.path = f.path
  `).all();
  for (const r of rows) {
    const vec = embedder.embedSync(r.text);  // 384-dim Float32Array
    insertMemory.run(mapMemory(r));
    insertVec.run(r.id, Buffer.from(vec.buffer));
  }
});
migrate(agentId);
target.exec("DETACH DATABASE src");
```

---

## Installation

```bash
# NONE. All required packages are already in package.json.
# Migration CLI is additive TypeScript code under src/migration/ + src/cli/commands/migrate-openclaw.ts.
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative | Verdict |
|---|---|---|---|
| `fs.promises.cp` (Node 22 built-in) | `fs-extra@11.3.4` | If targeting Node ≤18 where `fs.cp` lacked symlink options | **Reject** — Node 22 is locked. |
| `fs.promises.cp` | `cpy@11.3.4` | Glob-based, streaming copy for millions of files | **Reject** — our scale is MB, not GB. |
| `yaml@2.x` (eemeli) already in deps | `js-yaml@4.1.1` | If another part of ClawCode required it | **Reject** — `yaml` is already wired and preserves comments; `js-yaml` doesn't. No reason to fork YAML libs. |
| hand-rolled plan renderer | `jsondiffpatch@0.7.3` | If ops asks for colored/HTML structural diff | **Defer** — add only if reviewers demand it. |
| hand-rolled plan renderer | `diff@9.0.0` | If we want unified-diff output of the YAML merge | **Defer** — same reason. |
| per-agent transaction | SQLite online backup API (`sqlite3_backup_init`) | If we wanted bit-exact mirroring of source DB into target | **Reject** — schemas differ, can't use backup API; ATTACH + SELECT is the correct pattern. |
| local re-embedding (existing singleton) | Gemini API re-embedding | If we wanted to preserve the original 3072-dim vectors in a separate sidecar table | **Reject** — ClawCode has no 3072-dim consumer. Pointless fidelity. |
| stream chunks one at a time | load all chunks in memory per agent | — | **Use the loaded approach.** Max agent has 878 chunks at ~1KB text each ≈ 1MB. Fits easily. |
| `commander@14` (existing) | `yargs@18`, `citty`, `clipanion` | If we wanted subcommand autocompletion or nicer help formatting | **Reject** — CLI is already built on `commander`. |
| `pino@9` (existing) | `winston` | If other log consumers expected winston | **Reject** — project standard. |
| Node 22 `fs.cp` `filter` option | `globby@14` / `picomatch@4` to enumerate first | If the filter logic was complex enough to need glob patterns | **Reject** — three substring excludes is enough for our case. If it grows, revisit. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `fs-extra` | Node 22's built-in `fs.cp` has every option we need (symlinks, timestamps, filter). Adding fs-extra re-introduces a redundant `graceful-fs` dependency. | `fs.promises.cp` |
| `sqlite3` (node-sqlite3, async) | Async callback API clashes with ClawCode's sync `better-sqlite3` patterns. Would need a second driver for no reason. | `better-sqlite3` (already loaded) |
| SQLite online backup API | Designed for whole-DB bit-mirror, not schema translation. Source and target schemas differ. | `ATTACH DATABASE` + transaction |
| Re-embedding via Gemini API | Paid, network-dependent, and ClawCode has no 3072-dim consumer. Migration tool would need API keys that 15 agents don't share. | Local MiniLM via `@huggingface/transformers` singleton |
| Preserving OpenClaw chunk IDs as-is into `memories.id` | Source IDs are SHA256 hex (64 chars) — technically fine, but collide across agents if we ever merge memory stores later. | Namespaced ID: `openclaw-migrate:<agent>:<sha>` |
| Trying to replay `~/.openclaw/agents/<name>/sessions/*.jsonl` | Hundreds of files per agent, undocumented format drift, high risk. Explicitly OUT OF SCOPE per milestone. | Skip entirely; rely on workspace MEMORY.md + chunks |
| Writing a new YAML serializer | `yaml@2.8.3` (eemeli) already preserves comments via its Document AST | Use `YAML.parseDocument` / `.toString()` from existing `yaml` dep |
| `libsql` / Turso client | Overkill — they're for distributed SQLite. Not needed for a local one-shot migration. | `better-sqlite3` |
| `prisma-migrate` or any ORM migration tool | ORM migrations target schema evolution, not data translation. Different problem. | Hand-written translator |
| `chokidar` watching during migration | The migrator is one-shot, not a daemon. Adding watching expands the surface area. | Run migrator, then restart daemon |

---

## Integration Risks

### ESM / Node 22 compatibility — NONE NEW
All proposed usage is of already-loaded deps. No ESM/CJS interop concerns beyond what the project already handles.

### `better-sqlite3` sync model — OK
ATTACH + SELECT + INSERT is all synchronous. The only async boundary is the embedder (`@huggingface/transformers` returns a Promise). Pattern: batch-read chunks synchronously, await embeddings, then open a `db.transaction()` to bulk-insert. Don't hold a transaction open across an `await` — well-known footgun.

### Read-only source safety
Open source DBs in read-only mode: `new Database(sourcePath, { readonly: true, fileMustExist: true })` — or open the destination and `ATTACH` source read-only via `?mode=ro`. **Recommended:** always ATTACH read-only so an OpenClaw daemon (if still running) and the migrator can't race. Verified syntax: `ATTACH DATABASE 'file:/.../fin-acquisition.sqlite?mode=ro' AS src` requires opening main DB with URI support (`new Database(target, { fileMustExist: false })` + `PRAGMA journal_mode=WAL`).

### OpenClaw daemon must be stopped during migration
Even read-only ATTACH, if OpenClaw has WAL pending writes, can produce inconsistent reads. **PITFALL:** migration runbook must `systemctl stop openclaw` (or equivalent) before `clawcode migrate openclaw --apply`. Add a pre-flight check that scans for OpenClaw process PIDs and refuses to proceed if found.

### Embedding singleton warmup amortization
First embed call is ~500ms (model load); subsequent calls ~50ms. For 2,617 chunks, amortized cost is dominated by per-chunk time. Do NOT spin up a fresh embedder per agent — load once, reuse across all 7 populated agents. The existing `getEmbedder()` singleton in `src/memory/embedding.ts` already handles this.

### `vec_memories` float32 encoding
ClawCode's `MemoryStore.insert` writes `Buffer.from(new Float32Array(embedding).buffer)` into `vec_memories.embedding`. The migrator MUST use the same byte encoding — there is no JSON-to-vec path. Reusing `MemoryStore.insert(input, embedding)` directly (instead of re-implementing INSERT statements) is strongly preferred — it keeps the serialization contract in one place.

**Recommended:** migrator uses the existing `MemoryStore` public API rather than raw SQL. Not a new dep, just a code-organization note for planner.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| `better-sqlite3@12.8.0` | `sqlite-vec@0.1.9` loaded on ATTACH-capable handle | Verified via live spike against real OpenClaw DB |
| `better-sqlite3@12.8.0` | `ATTACH DATABASE` on readonly URIs | Standard SQLite feature; no version-specific issue |
| `@huggingface/transformers@4.0.1` | Same singleton, cross-agent reuse | Warm: ~50ms/chunk verified in v1.7 latency benchmarks |
| `yaml@2.8.3` (eemeli) | `Document` AST round-trip for YAML edits that preserve comments | Required to avoid nuking existing `clawcode.yaml` comments |
| Node `fs.promises.cp` | `verbatimSymlinks: true` + `preserveTimestamps: true` + `filter` | Node ≥20; confirmed in Node 22 docs |
| `commander@14.0.3` | Nested subcommands (`migrate openclaw`) | Already used in `src/cli/index.ts` |
| `zod@4.3.6` | Schema for OpenClaw agent entry | Already project standard |

---

## Sources

- **Live inspection** — `sqlite3 ~/.openclaw/memory/*.sqlite ".schema"` + `SELECT * FROM meta` across 15 DBs (2026-04-20). Ground truth for embedding model, dims, format. HIGH confidence.
- **Live spike** — Node script loading `sqlite-vec` into `better-sqlite3`, ATTACHing real OpenClaw source DB, reading 597 chunks. Confirms read path end-to-end. HIGH confidence.
- **ClawCode source** — `src/memory/store.ts` (insert pattern, vec0 schema), `src/config/loader.ts` (`yaml` package usage), `src/cli/index.ts` (`commander` wiring), `src/memory/embedding.ts` (embedder singleton). HIGH confidence.
- [Node 22 `fs.promises.cp` docs](https://nodejs.org/docs/latest-v22.x/api/fs.html#fspromisescpsrc-dest-options) — verified `verbatimSymlinks`, `preserveTimestamps`, `filter` options exist and behave as expected. HIGH confidence.
- [sqlite-vec JS docs](https://alexgarcia.xyz/sqlite-vec/js.html) — ATTACH + extension loading pattern. MEDIUM confidence (docs are slim; live spike upgraded to HIGH).
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — sync txn, ATTACH, prepared statements. HIGH confidence.
- `npm view` registry (2026-04-20) — version numbers verified current.
- `package.json` of this workspace — authoritative for what's already locked in.

---

## Roadmap Implications (hand-off to planner)

1. **No dep-add phase is needed.** Migration tool phases (config-mapper, workspace-copier, memory-translator, dry-run UI) all ship as pure TypeScript against the existing stack.

2. **Memory-translator phase must budget re-embedding wall time** (~2–3 minutes for full corpus including warmup). This is CPU/memory time on the daemon host, not API cost. Phase should include a progress bar output (hand-rolled or add `cli-progress@3.12.0` if reviewers want polish — but not a blocker).

3. **Workspace-copier phase needs a symlink-skip filter,** documented in PITFALLS. The `venv/lib64` self-symlink is a real trap.

4. **Dry-run UI phase** should render plan tables in plain text. If anyone asks for colored JSON diff, evaluate `jsondiffpatch` then — not before.

5. **Pre-flight check phase** (or included in config-mapper): detect running OpenClaw daemon, refuse apply if found, print the systemctl command to stop it.

6. **Migration is forward-only:** re-running `migrate --apply` against already-migrated agents should be idempotent (UPSERT on `memories.id`, skip if vec already present) — this is implementation detail, not stack detail, but flag it to planner.

7. **8 of 15 source agents have empty memory DBs** — the migrator should cleanly no-op on these rather than error. Log "no memory to migrate" and proceed to workspace + config.

---

*Stack research for: OpenClaw → ClawCode migration tooling (v2.1)*
*Researched: 2026-04-20*
