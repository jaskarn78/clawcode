/**
 * Phase 81 MIGR-05 — per-agent atomic rollback with source-invariant
 * hash-witness.
 *
 * Pipeline:
 *   1. loadConfig(clawcodeConfigPath) + resolveAllAgents → find agent.
 *      If not found → outcome:"not-found" (zero side effects — no YAML
 *      mutation, no fs.rm, no ledger row).
 *   2. hashSourceTree(openclawRoot, openclawMemoryDir, agentName) → Record
 *      of {relpath: sha256}. This is the SOURCE invariant baseline. Empty
 *      map if the source never existed — hashSourceTree tolerates missing
 *      paths silently (existsSync guard).
 *   3. removeAgentFromConfig(clawcodeConfigPath, agentName) — atomic YAML
 *      mutation via the Phase 78 writerFs dispatch (temp+rename pattern).
 *   4. Target removal:
 *        Dedicated:  memoryPath === workspace (Phase 75 loader fallback)
 *                    → fs.rm(config.workspace, {recursive:true, force:true})
 *        Finmentum:  memoryPath !== workspace (per-agent shared-basePath)
 *                    → fs.rm(memoryPath), fs.rm(soulFile), fs.rm(identityFile),
 *                      fs.rm(<basePath>/inbox/<agent>). Shared basePath root
 *                      NEVER touched.
 *   5. hashSourceTree(...) again → post-rollback map.
 *   6. Compare pre vs post: if any key diffs → append refuse ledger row then
 *      throw SourceCorruptionError with the mismatched paths.
 *   7. Append ledger row {action:'rollback', status:'rolled-back',
 *      step:'rollback:complete', agent, outcome:'allow', file_hashes:
 *      sourceHashBefore}.
 *
 * This module is the ONE non-pure module in Phase 81 Plan 01 — it writes
 * ledger rows on both success AND source-corruption-refuse paths. Plan 02's
 * CLI wraps the throw into a stderr + exit 1.
 *
 * DO NOT:
 *   - Touch ~/.openclaw/ in any way — source is read-only. hashSourceTree
 *     uses readFile + readdir via rollbackerFs dispatch (never writes).
 *   - Remove the shared basePath root — finmentum family preservation
 *     (Test 2 verifies the root + sibling files survive).
 *   - Remove shared SOUL/IDENTITY if the agent had no per-agent soulFile/
 *     identityFile — the deferred-idea list in CONTEXT explicitly defers
 *     that; rollback only touches what the resolved config names.
 *   - Hardcode a FINMENTUM_FAMILY_IDS list — finmentum detection is
 *     signaled by memoryPath !== workspace (Phase 75 loader semantics),
 *     keeping rollbacker agent-agnostic.
 *   - Use execa / child_process — native fs.rm + yaml Document AST
 *     suffice; zero new npm deps.
 *   - Add truncate/delete helpers to the ledger — ledger is append-only
 *     (ledger.ts invariants).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadConfig, resolveAllAgents } from "../config/loader.js";
import { removeAgentFromConfig } from "./yaml-writer.js";
import { appendRow } from "./ledger.js";
import type { ResolvedAgentConfig } from "../shared/types.js";

/**
 * Mutable fs-dispatch holder — the ESM-safe pattern used across Phase 78/79
 * writer / copier. Tests monkey-patch these to intercept rm / readFile /
 * readdir / stat without vi.spyOn against frozen node:fs/promises exports.
 * Exported for test visibility only; production code must never mutate this.
 */
export const rollbackerFs: {
  rm: typeof rm;
  readFile: typeof readFile;
  readdir: typeof readdir;
  stat: typeof stat;
} = { rm, readFile, readdir, stat };

/**
 * Thrown when the source tree's sha256 map differs between the pre-rollback
 * snapshot and the post-rollback snapshot. Indicates a concurrent writer, a
 * misbehaving rm() dispatch, or disk-level corruption touched ~/.openclaw/
 * during the atomic rollback window. Non-recoverable at this layer — the
 * caller (Plan 02 CLI) should halt the migration and alert the operator.
 *
 * The .mismatches array holds relative paths (prefixed "workspace/" or
 * "memory/<agent>.sqlite") whose hashes differed. First 10 are echoed in
 * .message for logging; the full set remains in .mismatches.
 */
export class SourceCorruptionError extends Error {
  readonly mismatches: readonly string[];
  constructor(mismatches: readonly string[]) {
    super(
      `Source tree mismatch after rollback (${mismatches.length} file(s)): ` +
        mismatches.slice(0, 10).join(", ") +
        (mismatches.length > 10 ? ` (+${mismatches.length - 10} more)` : ""),
    );
    this.name = "SourceCorruptionError";
    this.mismatches = Object.freeze([...mismatches]);
  }
}

export type RollbackAgentArgs = Readonly<{
  agentName: string;
  clawcodeConfigPath: string;
  openclawRoot: string;
  openclawMemoryDir: string;
  ledgerPath: string;
  /** DI for test determinism — defaults to ISO 'now'. */
  ts?: () => string;
}>;

export type RollbackOutcome = "rolled-back" | "not-found" | "source-corrupted";

export type RollbackResult = Readonly<{
  outcome: RollbackOutcome;
  removedPaths: readonly string[];
  sourceHashBefore: Readonly<Record<string, string>>;
  sourceHashAfter: Readonly<Record<string, string>>;
}>;

// ---------------------------------------------------------------------------
// hashSourceTree — read-only sha256 witness of a source agent's on-disk bytes.
// ---------------------------------------------------------------------------

/**
 * Recursively hash every regular file under the agent's source workspace
 * (~/.openclaw/workspace-<agent>/) + the per-agent memories sqlite
 * (~/.openclaw/memory/<agent>.sqlite). Returns a frozen Record<relpath,
 * sha256hex>. Missing paths contribute zero keys — equivalent to an empty
 * tree. Never writes; never dereferences symlinks (symlinks are skipped
 * for now — the source workspace contract is regular files + sqlite).
 *
 * Keys are prefixed so consumers can tell workspace bytes from memory bytes:
 *   - "workspace/<rel-from-workspace-root>" for files under workspace-<agent>/
 *   - "memory/<agent>.sqlite" for the per-agent sqlite
 */
export async function hashSourceTree(
  openclawRoot: string,
  openclawMemoryDir: string,
  agentName: string,
): Promise<Readonly<Record<string, string>>> {
  const out: Record<string, string> = {};
  const srcWorkspace = join(openclawRoot, `workspace-${agentName}`);
  if (existsSync(srcWorkspace)) {
    await walkAndHash(srcWorkspace, srcWorkspace, out, "workspace");
  }
  const memDb = join(openclawMemoryDir, `${agentName}.sqlite`);
  if (existsSync(memDb)) {
    const buf = await rollbackerFs.readFile(memDb);
    out[`memory/${agentName}.sqlite`] = createHash("sha256")
      .update(buf)
      .digest("hex");
  }
  return Object.freeze(out);
}

async function walkAndHash(
  root: string,
  current: string,
  out: Record<string, string>,
  prefix: string,
): Promise<void> {
  const entries = await rollbackerFs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = join(current, entry.name);
    if (entry.isDirectory()) {
      await walkAndHash(root, absPath, out, prefix);
      continue;
    }
    if (entry.isFile()) {
      const buf = await rollbackerFs.readFile(absPath);
      const rel = `${prefix}/${relative(root, absPath)}`;
      out[rel] = createHash("sha256").update(buf).digest("hex");
      continue;
    }
    // Symlinks / special files: skipped. Source-tree contract here is
    // regular files + the sqlite. If source grows symlinks in future, extend
    // with readlink-based comparison (mirrors Phase 79 copier pattern).
  }
}

// ---------------------------------------------------------------------------
// rollbackAgent — the main entry point.
// ---------------------------------------------------------------------------

export async function rollbackAgent(
  args: RollbackAgentArgs,
): Promise<RollbackResult> {
  const ts = args.ts ?? (() => new Date().toISOString());

  // --- Step 1: resolve agent config. ------------------------------------
  // If loadConfig throws (malformed YAML / missing file) OR the agent is
  // not in the resolved array, treat as not-found and return with ZERO
  // side effects. Operator fixes the YAML manually before re-running.
  let resolved: ResolvedAgentConfig | undefined;
  try {
    const cfg = await loadConfig(args.clawcodeConfigPath);
    const list = resolveAllAgents(cfg);
    resolved = list.find((a) => a.name === args.agentName);
  } catch {
    resolved = undefined;
  }
  if (!resolved) {
    return Object.freeze({
      outcome: "not-found" as const,
      removedPaths: Object.freeze([]),
      sourceHashBefore: Object.freeze({}),
      sourceHashAfter: Object.freeze({}),
    });
  }

  // --- Step 2: pre-rollback source hash map. ---------------------------
  const before = await hashSourceTree(
    args.openclawRoot,
    args.openclawMemoryDir,
    args.agentName,
  );

  // --- Step 3: YAML mutation first. ------------------------------------
  // If a mid-rollback crash happens between YAML mutation and fs.rm, the
  // next apply re-run will re-insert the agent (target fs.rm is idempotent
  // on missing dirs anyway). Doing YAML first gives the config-level
  // "this agent is gone" signal in the most durable medium.
  const yamlResult = await removeAgentFromConfig({
    existingConfigPath: args.clawcodeConfigPath,
    agentName: args.agentName,
  });
  const removedPaths: string[] = [];
  if (yamlResult.outcome === "removed") {
    removedPaths.push(`${args.clawcodeConfigPath}:agents[]`);
  }

  // --- Step 4: target removal per agent shape. -------------------------
  // Dedicated detection: Phase 75 loader populates memoryPath === workspace
  // when the raw YAML omits memoryPath. Finmentum-shared agents explicitly
  // set memoryPath to a sibling directory under a shared basePath.
  const isFinmentumShared = resolved.memoryPath !== resolved.workspace;
  if (isFinmentumShared) {
    // Finmentum-shared: remove ONLY per-agent paths. Shared basePath +
    // sibling per-agent paths are preserved (Test 2 pins this).
    const basePath = resolved.workspace; // Phase 75 — workspace IS the shared basePath
    const perAgentMem = resolved.memoryPath;
    if (existsSync(perAgentMem)) {
      await rollbackerFs.rm(perAgentMem, { recursive: true, force: true });
      removedPaths.push(perAgentMem);
    }
    if (resolved.soulFile && existsSync(resolved.soulFile)) {
      await rollbackerFs.rm(resolved.soulFile, { force: true });
      removedPaths.push(resolved.soulFile);
    }
    if (resolved.identityFile && existsSync(resolved.identityFile)) {
      await rollbackerFs.rm(resolved.identityFile, { force: true });
      removedPaths.push(resolved.identityFile);
    }
    const perAgentInbox = join(basePath, "inbox", args.agentName);
    if (existsSync(perAgentInbox)) {
      await rollbackerFs.rm(perAgentInbox, {
        recursive: true,
        force: true,
      });
      removedPaths.push(perAgentInbox);
    }
    // Shared basePath root intentionally preserved (Test 2 pins this).
  } else {
    // Dedicated agent: remove the entire target workspace tree (includes
    // the per-workspace memories.db inside it).
    if (existsSync(resolved.workspace)) {
      await rollbackerFs.rm(resolved.workspace, {
        recursive: true,
        force: true,
      });
      removedPaths.push(resolved.workspace);
    }
  }

  // --- Step 5: post-rollback source hash map. --------------------------
  const after = await hashSourceTree(
    args.openclawRoot,
    args.openclawMemoryDir,
    args.agentName,
  );

  // --- Step 6: source-invariant diff. ----------------------------------
  const mismatches: string[] = [];
  const allKeys = new Set<string>([
    ...Object.keys(before),
    ...Object.keys(after),
  ]);
  for (const k of allKeys) {
    if (before[k] !== after[k]) mismatches.push(k);
  }
  if (mismatches.length > 0) {
    // Append refuse row BEFORE throwing so forensic replay of the ledger
    // shows the refusal as the final state-transition attempt for this
    // agent. Plan 02 CLI converts the throw to stderr + exit 1.
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "rollback",
      agent: args.agentName,
      status: "pending",
      source_hash: "n/a",
      step: "rollback:source-corruption",
      outcome: "refuse",
      notes: `source mismatches: ${mismatches.slice(0, 10).join(", ")}`,
    });
    throw new SourceCorruptionError(mismatches);
  }

  // --- Step 7: success ledger row. -------------------------------------
  // file_hashes holds the pre-rollback source snapshot — forensic evidence
  // that the SOURCE was byte-exact when rollback ran. `source_hash` is a
  // placeholder ("n/a") because this action is scoped to the TARGET side;
  // the source_hash field is load-bearing for plan/apply rows, not rollback.
  await appendRow(args.ledgerPath, {
    ts: ts(),
    action: "rollback",
    agent: args.agentName,
    status: "rolled-back",
    source_hash: "n/a",
    step: "rollback:complete",
    outcome: "allow",
    file_hashes: { ...before },
    notes: `removed ${removedPaths.length} path(s)`,
  });

  return Object.freeze({
    outcome: "rolled-back" as const,
    removedPaths: Object.freeze([...removedPaths]),
    sourceHashBefore: before,
    sourceHashAfter: after,
  });
}
