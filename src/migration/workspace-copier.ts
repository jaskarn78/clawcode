/**
 * Phase 79 WORK-01 / WORK-03 / WORK-05 — per-agent workspace copier.
 *
 * Copies `~/.openclaw/workspace-<name>/` to the target ClawCode workspace
 * path using Node 22 fs.promises.cp with symlink/mtime preservation, a
 * filter predicate that skips venv traps + build artifacts, and a post-copy
 * hash-witness sweep that refuses + rolls back on any sha256 mismatch.
 *
 * Copy pipeline:
 *   1. defaultWorkspaceFilter prunes node_modules/.venv/venv/env/
 *      __pycache__/*.pyc/*.pyo/.DS_Store and self-referential symlinks.
 *      Keeps .git/, markdown, memory/, .learnings/, archive/, blobs.
 *   2. fs.promises.cp with {recursive:true, verbatimSymlinks:true,
 *      preserveTimestamps:true, filter, errorOnExist:false, force:true}.
 *      verbatimSymlinks is LOAD-BEARING — without it, the copier follows
 *      instagram-env/lib64 -> lib self-symlinks and recurses infinitely.
 *   3. Post-copy sweep: walk the TARGET tree, for each regular file compute
 *      sha256(source) vs sha256(target). Append one ledger row per file
 *      with step="workspace-copy:hash-witness", outcome="allow"|"refuse",
 *      file_hashes={<relpath>: <sha256hex>}.
 *   4. On any mismatch: fs.rm(target, {recursive:true, force:true}) —
 *      per-agent rollback. Append status:"rolled-back" row. Return
 *      {pass:false, hashMismatches:[...]}.
 *
 * Contract:
 *   - Never writes under ~/.openclaw/ (source tree is read-only — Phase 77
 *     fs-guard enforces this at runtime if Plan 03 installs the guard).
 *   - Sequential (NOT parallel) — each file is stat'd + hashed in order.
 *     Matches 79-CONTEXT sequential-agent decision.
 *   - Synchronous filter — fs.cp accepts boolean return, keeps throughput
 *     high. Self-symlink detection uses lstatSync + realpathSync.
 *
 * DO NOT:
 *   - Use execa or any subprocess — Node fs is sufficient and respects
 *     the zero-new-deps constraint.
 *   - Add `errorOnExist: true` — Phase 81 rollback+re-run cases will
 *     write into a fresh target dir anyway; rejecting pre-existing target
 *     is a Phase 81 concern, not Plan 01's.
 *   - Parallelize hash sweep across files — predictable JSONL ordering is
 *     forensic evidence; parallel writes would interleave rows.
 *   - Follow symlinks for hash comparison — a symlink's target content is
 *     not part of THIS agent's copy commitment (may live outside the
 *     workspace). Compare symlink targets via readlink instead.
 */
import {
  cp,
  readFile,
  readdir,
  readlink,
  rm,
} from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { appendRow } from "./ledger.js";

/**
 * Mutable fs-dispatch holder — the ESM-safe pattern used by yaml-writer.ts
 * (Phase 78). Tests monkey-patch properties to intercept readFile / rm
 * without vi.spyOn against frozen node:fs/promises exports. Exported for
 * test visibility only; production code must never mutate this.
 */
export const copierFs: {
  cp: typeof cp;
  readFile: typeof readFile;
  readdir: typeof readdir;
  readlink: typeof readlink;
  rm: typeof rm;
} = { cp, readFile, readdir, readlink, rm };

// -------------------------------------------------------------------------
// Filter primitives
// -------------------------------------------------------------------------

export const WORKSPACE_FILTER_SKIP_DIRS: readonly string[] = Object.freeze([
  "node_modules",
  ".venv",
  "venv",
  "env",
  "__pycache__",
]);

export const WORKSPACE_FILTER_SKIP_FILES: readonly string[] = Object.freeze([
  ".DS_Store",
]);

const SKIP_EXTENSIONS: readonly string[] = Object.freeze([".pyc", ".pyo"]);

/**
 * Synchronous filter for fs.cp. Returns `false` to SKIP, `true` to COPY.
 *
 * Self-symlink detection: if the path is a symlink whose realpath is an
 * ancestor of (or equal to) the link itself, skip — otherwise fs.cp would
 * recurse infinitely on venv `lib64 -> lib` patterns.
 */
export function defaultWorkspaceFilter(src: string): boolean {
  const segments = src.split(sep);
  for (const seg of segments) {
    if (WORKSPACE_FILTER_SKIP_DIRS.includes(seg)) return false;
    if (WORKSPACE_FILTER_SKIP_FILES.includes(seg)) return false;
  }
  for (const ext of SKIP_EXTENSIONS) {
    if (src.endsWith(ext)) return false;
  }
  // Self-symlink detection — only for paths that actually exist as symlinks
  // on disk. Missing paths / non-symlinks fall through.
  //
  // Heuristic: SKIP any symlink whose resolved realpath is an ancestor of
  // the link itself OR a sibling/descendant within the same parent directory
  // that is itself a directory. This covers:
  //   - venv `lib64 -> lib` lateral self-reference (same parent, target is
  //     a dir — recursive tools would double-copy the lib tree)
  //   - `a/b/self -> ../b` style ancestor references
  //   - `a/b/loop -> ../../a` chains that recurse
  // But keeps ordinary file-to-file symlinks like `link.md -> real.md`
  // (target is a regular file, no recursion risk).
  try {
    const lst = lstatSync(src);
    if (lst.isSymbolicLink()) {
      const real = realpathSync(src);
      // Case 1: realpath is an ancestor of (or equal to) the link.
      if (src === real || src.startsWith(real + sep)) return false;
      // Case 2: realpath resolves to a DIRECTORY within the link's parent
      // directory tree — lateral self-reference like venv lib64->lib.
      // Skipping prevents fs.cp from double-copying the sibling dir.
      try {
        const realStat = lstatSync(real);
        if (realStat.isDirectory()) {
          // Find the parent of the symlink.
          const parent = src.substring(0, src.lastIndexOf(sep));
          // If realpath lives under the same parent directory (i.e. a
          // lateral sibling), skip — this is the venv lib64->lib trap.
          if (
            parent !== "" &&
            (real === parent || real.startsWith(parent + sep))
          ) {
            return false;
          }
        }
      } catch {
        // Can't stat realpath — treat as broken symlink, let fs.cp decide.
      }
    }
  } catch {
    // Broken symlinks / stat errors: let fs.cp handle or skip gracefully.
    // Default: allow (fs.cp surfaces the error if it's a real problem).
  }
  return true;
}

// -------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------

export type CopyWorkspaceArgs = {
  readonly agentId: string;
  readonly source: string; // ~/.openclaw/workspace-<name>/ (absolute)
  readonly target: string; // <basePath>/ (absolute)
  readonly ledgerPath: string;
  readonly sourceHash: string; // PlanReport.planHash — correlates witness rows
  /** DI for test determinism — defaults to ISO 'now'. */
  readonly ts?: () => string;
};

export type CopyWorkspaceResult = {
  readonly pass: boolean;
  readonly filesCopied: number;
  readonly hashMismatches: readonly string[];
  readonly rolledBack: boolean;
};

// -------------------------------------------------------------------------
// Main entry
// -------------------------------------------------------------------------

/**
 * Copy a single agent's source workspace to the target path with
 * hash-witness verification and per-agent rollback on any mismatch.
 */
export async function copyAgentWorkspace(
  args: CopyWorkspaceArgs,
): Promise<CopyWorkspaceResult> {
  const ts = args.ts ?? (() => new Date().toISOString());

  // Phase 1: fs.cp with filter. Surfaces fs errors directly.
  await copierFs.cp(args.source, args.target, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: defaultWorkspaceFilter,
    errorOnExist: false,
    force: true,
  });

  // Phase 2: hash-witness sweep. Walk target tree, compare sha256 per
  // regular file. Symlinks are compared via readlink (see below).
  const mismatches: string[] = [];
  let filesCopied = 0;

  await sweepDir(args, args.source, args.target, ts, mismatches, () => {
    filesCopied++;
  });

  if (mismatches.length > 0) {
    // Per-agent rollback: wipe target tree entirely.
    await copierFs.rm(args.target, { recursive: true, force: true });
    const firstTen = mismatches.slice(0, 10).join(", ");
    const suffix =
      mismatches.length > 10 ? ` (+${mismatches.length - 10} more)` : "";
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "apply",
      agent: args.agentId,
      status: "rolled-back",
      source_hash: args.sourceHash,
      step: "workspace-copy:rollback",
      outcome: "refuse",
      notes: `hash mismatches: ${firstTen}${suffix}`,
    });
    return {
      pass: false,
      filesCopied,
      hashMismatches: mismatches,
      rolledBack: true,
    };
  }

  return {
    pass: true,
    filesCopied,
    hashMismatches: [],
    rolledBack: false,
  };
}

// -------------------------------------------------------------------------
// Internal: sweep target tree and hash-witness per file.
// Kept outside copyAgentWorkspace for clarity; recursion-friendly signature.
// -------------------------------------------------------------------------

async function sweepDir(
  args: CopyWorkspaceArgs,
  currentSrc: string,
  currentDst: string,
  ts: () => string,
  mismatches: string[],
  onFile: () => void,
): Promise<void> {
  const entries = await copierFs.readdir(currentDst, { withFileTypes: true });
  for (const entry of entries) {
    const dstPath = join(currentDst, entry.name);
    const srcPath = join(currentSrc, entry.name);
    if (entry.isSymbolicLink()) {
      // Compare readlink targets — not dereferenced content. A symlink's
      // target may live outside the workspace; that content is not part of
      // this agent's copy commitment.
      const srcLink = await copierFs.readlink(srcPath);
      const dstLink = await copierFs.readlink(dstPath);
      const relPath = relative(args.target, dstPath);
      if (srcLink !== dstLink) {
        mismatches.push(relPath);
        await appendRow(args.ledgerPath, {
          ts: ts(),
          action: "apply",
          agent: args.agentId,
          status: "pending",
          source_hash: args.sourceHash,
          step: "workspace-copy:hash-witness",
          outcome: "refuse",
          file_hashes: {
            [relPath]: `symlink:src=${srcLink};dst=${dstLink}`,
          },
          notes: "symlink target mismatch",
        });
      } else {
        await appendRow(args.ledgerPath, {
          ts: ts(),
          action: "apply",
          agent: args.agentId,
          status: "pending",
          source_hash: args.sourceHash,
          step: "workspace-copy:hash-witness",
          outcome: "allow",
          file_hashes: { [relPath]: `symlink:${srcLink}` },
        });
      }
      onFile();
      continue;
    }
    if (entry.isDirectory()) {
      await sweepDir(args, srcPath, dstPath, ts, mismatches, onFile);
      continue;
    }
    if (entry.isFile()) {
      const relPath = relative(args.target, dstPath);
      const srcBuf = await copierFs.readFile(srcPath);
      const dstBuf = await copierFs.readFile(dstPath);
      const srcSha = createHash("sha256").update(srcBuf).digest("hex");
      const dstSha = createHash("sha256").update(dstBuf).digest("hex");
      if (srcSha !== dstSha) {
        mismatches.push(relPath);
        await appendRow(args.ledgerPath, {
          ts: ts(),
          action: "apply",
          agent: args.agentId,
          status: "pending",
          source_hash: args.sourceHash,
          step: "workspace-copy:hash-witness",
          outcome: "refuse",
          file_hashes: { [relPath]: `src=${srcSha};dst=${dstSha}` },
          notes: "sha256 mismatch",
        });
      } else {
        await appendRow(args.ledgerPath, {
          ts: ts(),
          action: "apply",
          agent: args.agentId,
          status: "pending",
          source_hash: args.sourceHash,
          step: "workspace-copy:hash-witness",
          outcome: "allow",
          file_hashes: { [relPath]: srcSha },
        });
      }
      onFile();
      continue;
    }
    // Skip special files (sockets, devices, fifos — not expected in a
    // workspace, but don't crash if present).
  }
}
