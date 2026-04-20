/**
 * Phase 80 — Memory Translation + Re-embedding.
 *
 * Reads a migrated agent's target-workspace markdown (post-Phase 79
 * copy) and upserts memories into the per-agent memories.db via the
 * Plan 01 MemoryStore.insert() origin_id path. Disk is truth; the
 * OpenClaw sqlite file-RAG index is NEVER read here (MEM-05).
 *
 * Chunking rules (per 80-CONTEXT):
 *   - MEMORY.md: split by H2; if no H2 → whole-file single memory;
 *     first H2 section gets importance=0.6, rest get 0.5.
 *   - memory/*.md: whole-file, one memory per file, importance=0.5.
 *   - .learnings/*.md: whole-file, one memory per file, importance=0.7,
 *     tags include "learning" (MEM-04).
 *
 * Origin ID rules (per 80-CONTEXT):
 *   - Whole-file:    openclaw:<agent>:<sha256(relpath)>
 *   - H2 section:    openclaw:<agent>:<sha256(relpath)>:section:<slug(heading)>
 *
 * Tag scheme (per 80-CONTEXT, ALL exact strings — grep-verifiable):
 *   - Always: "migrated" + "openclaw-import"
 *   - MEMORY.md section: + "workspace-memory" + slugified H2
 *   - MEMORY.md no-H2:   + "workspace-memory" (single tag, no slug)
 *   - memory/*.md:       + "memory-file" + filename stem (without .md)
 *   - .learnings/*.md:   + "learning" + basename (without .md)
 *
 * DO NOT:
 *   - Construct a new EmbeddingService — singleton invariant pinned by
 *     src/manager/__tests__/daemon-warmup-probe.test.ts:287. Caller
 *     injects the daemon's embedder.
 *   - Read the OpenClaw sqlite index — disk-as-truth (MEM-05).
 *   - Issue raw SQL against vec_memories / memories — use
 *     MemoryStore.insert() only (MEM-03).
 *   - Import execa or child_process — this module does zero subprocess work.
 *   - Add markdown-parser deps (unified/remark/marked) — regex H2 split
 *     is sufficient and preserves verbatim content (MEM-01).
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename, extname } from "node:path";
import type { MemoryStore } from "../memory/store.js";
import type { EmbeddingService } from "../memory/embedder.js";
import type { LedgerRow } from "./ledger.js";

/**
 * Mutable fs-dispatch holder — ESM-safe test monkey-patching pattern
 * (see src/migration/workspace-copier.ts:copierFs). Tests swap these
 * properties to intercept fs I/O without vi.spyOn on frozen
 * node:fs/promises exports. Exported for test visibility only;
 * production code must never mutate this.
 */
export const translatorFs: {
  readFile: typeof readFile;
  readdir: typeof readdir;
  stat: typeof stat;
} = { readFile, readdir, stat };

/** sha256 hex digest of a UTF-8 string. */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * H2 splitter — regex-based, preserves headings in output. No markdown
 * library. Content is byte-preserved (MEM-01 verbatim guarantee).
 *
 * Returns `[{heading: null, content: preamble}, ...{heading, content}]`
 * where the preamble is OMITTED if whitespace-only. Each H2 entry's
 * `content` starts with "## " and ends at the next H2 or EOF. H3 and
 * deeper headings are NOT treated as boundaries.
 */
export function splitMemoryMd(content: string): ReadonlyArray<{
  readonly heading: string | null;
  readonly content: string;
}> {
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  type Boundary = { heading: string | null; startLine: number };
  const boundaries: Boundary[] = [];
  // Preamble boundary always at line 0 (heading=null). Dropped later if
  // the resulting body is whitespace-only OR there are no H2s (in which
  // case we emit a single whole-file entry instead).
  boundaries.push({ heading: null, startLine: 0 });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // H2 = exactly "## " prefix; "### " (H3) must NOT be treated as a
    // section boundary per plan Test 5.
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      boundaries.push({ heading: line.slice(3).trim(), startLine: i });
    }
  }

  if (boundaries.length === 1) {
    // No H2 found — single whole-file memory with heading=null.
    return [{ heading: null, content }];
  }

  const out: Array<{ heading: string | null; content: string }> = [];
  for (let b = 0; b < boundaries.length; b++) {
    const current = boundaries[b]!;
    const next = boundaries[b + 1];
    const endLine = next ? next.startLine : lines.length;
    // Section body includes its own heading line and all subsequent
    // lines up to (but NOT including) the next boundary. Joined with
    // "\n" — matches the original split('\n') inverse, so content is
    // byte-preserved for MEM-01.
    const body = lines.slice(current.startLine, endLine).join("\n");
    if (current.heading === null) {
      // Preamble — drop if whitespace-only. Otherwise preserve
      // verbatim as a heading=null section (no content loss).
      if (body.trim().length === 0) continue;
    }
    out.push({ heading: current.heading, content: body });
  }
  return out;
}

/**
 * Slugify an H2 heading for origin_id section qualifier + tag.
 * Lowercase, collapse non-alphanumeric runs to single hyphens, trim
 * leading/trailing hyphens.
 */
export function slugifyHeading(h2: string): string {
  return h2
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * origin_id per 80-CONTEXT:
 *   - Whole-file: openclaw:<agent>:<sha256(relpath)>
 *   - H2 section: openclaw:<agent>:<sha256(relpath)>:section:<slug>
 *
 * relpath is normalized to forward-slashes BEFORE hashing so
 * origin_ids are stable across OSes (windows backslashes must hash
 * identically to POSIX forward-slashes).
 */
export function computeOriginId(
  agentId: string,
  relpath: string,
  section?: string,
): string {
  const normalized = relpath.split("\\").join("/");
  const pathHash = sha256Hex(normalized);
  const base = `openclaw:${agentId}:${pathHash}`;
  return section ? `${base}:section:${slugifyHeading(section)}` : base;
}

/** Tags common to ALL migrated memories — frozen literal shared by builders. */
const COMMON_TAGS: readonly string[] = Object.freeze([
  "migrated",
  "openclaw-import",
]);

/**
 * Tags for a MEMORY.md section.
 * With slug: [migrated, openclaw-import, workspace-memory, <slug>].
 * With null (no-H2 whole file): [migrated, openclaw-import, workspace-memory].
 */
export function buildTagsForMemoryMd(
  slug: string | null,
): readonly string[] {
  const tags = [...COMMON_TAGS, "workspace-memory"];
  if (slug !== null) tags.push(slug);
  return Object.freeze(tags);
}

/** Tags for a memory/*.md file: [..common, memory-file, <stem>]. */
export function buildTagsForMemoryFile(stem: string): readonly string[] {
  return Object.freeze([...COMMON_TAGS, "memory-file", stem]);
}

/**
 * Tags for a .learnings/*.md file: [..common, learning, <basename>].
 * The literal "learning" tag satisfies MEM-04 — memory_lookup
 * {tag:"learning"} retrieves the imported insight corpus.
 */
export function buildTagsForLearning(
  basename: string,
): readonly string[] {
  return Object.freeze([...COMMON_TAGS, "learning", basename]);
}

/** Importance for MEMORY.md sections: first section 0.6, rest 0.5. */
export function importanceForMemoryMdSection(index: number): number {
  return index === 0 ? 0.6 : 0.5;
}

/** Default importance for memory/*.md whole-file entries. */
export const IMPORTANCE_MEMORY_FILE = 0.5;

/** Importance for .learnings/*.md — explicit insights weight higher. */
export const IMPORTANCE_LEARNING = 0.7;

// ---------------------------------------------------------------------------
// Public types — discovery + entrypoint
// ---------------------------------------------------------------------------

/** A markdown file (or H2 section) that will become one memory. */
export type DiscoveredMemory = {
  readonly kind: "memory-md-section" | "memory-file" | "learning";
  /** Forward-slash normalized, relative to targetWorkspace. */
  readonly relpath: string;
  /** Verbatim file content (or H2 section including heading). */
  readonly content: string;
  /** Final origin_id per 80-CONTEXT (Plan 01 contract). */
  readonly originId: string;
  readonly importance: number;
  readonly tags: readonly string[];
};

/** Arguments to translateAgentMemories. */
export type TranslateAgentMemoriesArgs = {
  readonly agentId: string;
  /** Absolute path to the agent's target workspace (post-Phase 79 copy). */
  readonly targetWorkspace: string;
  /**
   * Absolute path to where memories.db lives (per Phase 75 memoryPath
   * semantics). This module does NOT open the DB — the caller supplies a
   * constructed MemoryStore. memoryPath is retained here for caller
   * auditability / future use but is not consumed by the translator.
   */
  readonly memoryPath: string;
  /** Caller-constructed MemoryStore (Plan 03 opens per-agent). */
  readonly store: MemoryStore;
  /** Caller-supplied singleton (AgentMemoryManager.embedder in prod; mock in tests). */
  readonly embedder: EmbeddingService;
  /** PlanReport.planHash — correlates ledger rows across the apply pipeline. */
  readonly sourceHash: string;
  /** DI for test determinism (defaults to ISO 'now'). */
  readonly ts?: () => string;
};

/** Return value of translateAgentMemories. */
export type TranslateResult = {
  readonly upserted: number;
  readonly skipped: number;
  /**
   * Per-memory ledger rows (one per discovered entry). NOT written to disk
   * here — Plan 03 batches these with the rest of the apply-pipeline rows
   * and appends them via ledger.ts:appendRow in deterministic order.
   */
  readonly ledgerRows: readonly LedgerRow[];
};

// ---------------------------------------------------------------------------
// discoverWorkspaceMarkdown — walk the target workspace, return ordered
// discovered memories. Reads ONLY markdown; disk is truth (MEM-05).
// ---------------------------------------------------------------------------

/**
 * Enumerate a migrated agent's markdown corpus in the fixed order:
 *   1. MEMORY.md H2 sections (in file order; first gets importance=0.6)
 *   2. memory/*.md (alphabetical)
 *   3. .learnings/*.md (alphabetical)
 *
 * Missing subdirectories are not errors — they simply contribute zero
 * entries. This matches the on-disk reality of agents who don't use one
 * or more of the conventions.
 */
export async function discoverWorkspaceMarkdown(
  targetWorkspace: string,
  agentId: string,
): Promise<readonly DiscoveredMemory[]> {
  const out: DiscoveredMemory[] = [];

  // 1. MEMORY.md — H2-split; first section gets importance=0.6.
  const memoryMdAbs = join(targetWorkspace, "MEMORY.md");
  if (existsSync(memoryMdAbs)) {
    const content = await translatorFs.readFile(memoryMdAbs, "utf8");
    const sections = splitMemoryMd(content);
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i]!;
      const slug = sec.heading === null ? null : slugifyHeading(sec.heading);
      const relpath = "MEMORY.md";
      const originId = computeOriginId(
        agentId,
        relpath,
        sec.heading ?? undefined,
      );
      out.push({
        kind: "memory-md-section",
        relpath,
        content: sec.content,
        originId,
        importance: importanceForMemoryMdSection(i),
        tags: buildTagsForMemoryMd(slug),
      });
    }
  }

  // 2. memory/*.md — whole-file, importance=0.5.
  const memoryDirAbs = join(targetWorkspace, "memory");
  if (existsSync(memoryDirAbs)) {
    const entries = await translatorFs.readdir(memoryDirAbs, {
      withFileTypes: true,
    });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort(); // alphabetical for deterministic ordering
    for (const name of mdFiles) {
      const absPath = join(memoryDirAbs, name);
      const content = await translatorFs.readFile(absPath, "utf8");
      const relpath = `memory/${name}`;
      const stem = basename(name, extname(name));
      out.push({
        kind: "memory-file",
        relpath,
        content,
        originId: computeOriginId(agentId, relpath),
        importance: IMPORTANCE_MEMORY_FILE,
        tags: buildTagsForMemoryFile(stem),
      });
    }
  }

  // 3. .learnings/*.md — whole-file, importance=0.7, tag="learning" (MEM-04).
  const learningsDirAbs = join(targetWorkspace, ".learnings");
  if (existsSync(learningsDirAbs)) {
    const entries = await translatorFs.readdir(learningsDirAbs, {
      withFileTypes: true,
    });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
    for (const name of mdFiles) {
      const absPath = join(learningsDirAbs, name);
      const content = await translatorFs.readFile(absPath, "utf8");
      const relpath = `.learnings/${name}`;
      const bn = basename(name, extname(name));
      out.push({
        kind: "learning",
        relpath,
        content,
        originId: computeOriginId(agentId, relpath),
        importance: IMPORTANCE_LEARNING,
        tags: buildTagsForLearning(bn),
      });
    }
  }

  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// translateAgentMemories — the entrypoint. Serial per-agent (embedder
// singleton non-reentrancy). Public-API-only inserts (MEM-03).
// ---------------------------------------------------------------------------

/**
 * Translate a migrated agent's workspace markdown into memories. For each
 * discovered entry:
 *   1. embed content (serial — awaits before next iteration)
 *   2. insert via MemoryStore.insert({... , origin_id}) — Plan 01's
 *      INSERT OR IGNORE path handles idempotency by path-hash
 *   3. classify as upserted (new) or skipped (already-imported) by
 *      comparing the returned entry's createdAt against the run-start
 *      timestamp — if createdAt predates runStart, it's the existing row
 *      returned by getByOriginId; if not, it's a fresh insert
 *   4. emit one ledger row with step="memory-translate:embed-insert"
 *
 * Returns a TranslateResult — the caller (Plan 03) appends the ledger
 * rows via ledger.ts:appendRow after batching with the rest of the
 * apply-pipeline rows.
 *
 * Serial NOT parallel: the embedder is a per-daemon singleton and
 * non-reentrant. Parallelizing with Promise.all would corrupt the ONNX
 * pipeline state. This is asserted at runtime via a mock peak-in-flight
 * counter AND at source level via a static grep test that bans
 * Promise.all/allSettled.
 */
export async function translateAgentMemories(
  args: TranslateAgentMemoriesArgs,
): Promise<TranslateResult> {
  const ts = args.ts ?? (() => new Date().toISOString());

  const discovered = await discoverWorkspaceMarkdown(
    args.targetWorkspace,
    args.agentId,
  );

  let upserted = 0;
  let skipped = 0;
  const ledgerRows: LedgerRow[] = [];

  // SERIAL per-agent — embedder singleton is non-reentrant (80-CONTEXT).
  // Each iteration awaits embed() and insert() before proceeding.
  // Do NOT rewrite as Promise.all / allSettled — pinned by static test.
  for (const mem of discovered) {
    const embedding = await args.embedder.embed(mem.content);
    const entry = args.store.insert(
      {
        content: mem.content,
        source: "manual",
        importance: mem.importance,
        tags: mem.tags,
        origin_id: mem.originId,
      },
      embedding,
    );

    // Classify upserted vs skipped via the returned entry's `embedding`
    // field, which is the definitive signal from MemoryStore:
    //   - FRESH insert path (store.ts:235-251) returns the Object.frozen
    //     in-memory entry with `embedding: <injected Float32Array>`.
    //   - COLLISION path (store.ts:212-226) returns the row via
    //     rowToEntry(existing) which sets `embedding: null`
    //     (store.ts:1011).
    //
    // This replaces a prior timestamp-based heuristic that misclassified
    // the boundary case where two consecutive translate calls land in
    // the same millisecond (ms-resolution ISO-8601 comparison). The
    // embedding-null signal is unambiguous and tied to the store's
    // own insert-path bifurcation, so it's the right contract.
    const isSkip = entry.embedding === null;
    if (isSkip) {
      skipped++;
    } else {
      upserted++;
    }

    ledgerRows.push({
      ts: ts(),
      action: "apply",
      agent: args.agentId,
      status: "pending",
      source_hash: args.sourceHash,
      step: "memory-translate:embed-insert",
      outcome: "allow",
      file_hashes: { [mem.relpath]: sha256Hex(mem.content) },
      notes: isSkip ? "already-imported" : "new",
    });
  }

  return Object.freeze({
    upserted,
    skipped,
    ledgerRows: Object.freeze(ledgerRows),
  });
}
