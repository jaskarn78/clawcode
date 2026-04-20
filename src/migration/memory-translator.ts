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
import { createHash } from "node:crypto";

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
