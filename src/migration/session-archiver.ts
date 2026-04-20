/**
 * Phase 79 WORK-04 — per-agent OpenClaw session archiver.
 *
 * Copies `~/.openclaw/agents/<name>/sessions/` verbatim to
 * `<targetBasePath>/archive/openclaw-sessions/`. Archives are READ-ONLY
 * reference material: the migrated agent can `cat` them via filesystem
 * tools, but the migrator NEVER calls any session-replay API.
 *
 * Why a dedicated module (not a workspace-copier arg):
 *   1. Source path differs — `agents/<name>/sessions/`, not
 *      `workspace-<name>/`. Keeping them separate matches OpenClaw's
 *      on-disk layout.
 *   2. No filter needed — raw verbatim copy. The workspace-copier's
 *      venv/node_modules/pycache filter is irrelevant here.
 *   3. Archive-only isolation is guarded by static grep — a file that
 *      does not import any session-replay store can't accidentally
 *      write to it. This module has zero such references; Plan 02
 *      test 8 asserts this via readFileSync + toMatch.
 *   4. Missing-source tolerance — not every OpenClaw agent has recorded
 *      sessions yet; skip gracefully rather than fail the whole apply.
 *
 * Finmentum family note: each of the 5 finmentum agents calls this
 * archiver with its OWN sourceAgentDir but the SAME targetBasePath.
 * Sessions land in the shared archive subdir; OpenClaw's file basenames
 * are distinct per agent (session IDs), so no dedup is needed at this
 * layer. Plan 03 orchestrates sequential invocation.
 *
 * DO NOT:
 *   - Import any session-replay / conversation-history store from
 *     anywhere — the WORK-04 contract is "archive only, no replay";
 *     static grep asserts this.
 *   - Add a filter predicate — workspaces have venv traps, session
 *     directories don't (they're ClawCode/OpenClaw-generated JSONL +
 *     metadata).
 *   - Add new npm deps — node:fs/promises + node:crypto + node:path only.
 *   - Create the archive subdir with errorOnExist:true — Phase 81 rollback
 *     + re-run cases need idempotency.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { appendRow } from "./ledger.js";

/** Fixed archive destination subdir under each agent's targetBasePath. */
export const ARCHIVE_SESSIONS_SUBDIR = "archive/openclaw-sessions";

export type ArchiveSessionsArgs = {
  readonly agentId: string;
  readonly sourceAgentDir: string;
  readonly targetBasePath: string;
  readonly ledgerPath: string;
  readonly sourceHash: string;
  readonly ts?: () => string;
};

export type ArchiveSessionsResult = {
  readonly pass: boolean;
  readonly copied: number;
  readonly skipped: boolean;
  readonly archiveDestPath: string;
};

export async function archiveOpenclawSessions(
  args: ArchiveSessionsArgs,
): Promise<ArchiveSessionsResult> {
  const ts = args.ts ?? (() => new Date().toISOString());
  const archiveDestPath = join(args.targetBasePath, ARCHIVE_SESSIONS_SUBDIR);
  const sourceSessionsDir = join(args.sourceAgentDir, "sessions");

  // Missing source handling — normal case for agents with no recorded
  // sessions yet (e.g. finmentum sub-agents per 79-CONTEXT). Emit a skip
  // row and return pass:true. Never throws.
  if (!existsSync(args.sourceAgentDir) || !existsSync(sourceSessionsDir)) {
    await appendRow(args.ledgerPath, {
      ts: ts(),
      action: "apply",
      agent: args.agentId,
      status: "pending",
      source_hash: args.sourceHash,
      step: "session-archive:skip",
      outcome: "allow",
      notes: `source sessions not found at ${sourceSessionsDir}`,
    });
    return {
      pass: true,
      copied: 0,
      skipped: true,
      archiveDestPath,
    };
  }

  // Ensure destination parent exists. fs.cp creates the leaf dir itself.
  await fs.mkdir(args.targetBasePath, { recursive: true });

  // Raw verbatim copy — recursive, preserves timestamps, no filter.
  // force:true + errorOnExist:false makes re-runs idempotent (Phase 81
  // rollback-then-retry case).
  await fs.cp(sourceSessionsDir, archiveDestPath, {
    recursive: true,
    preserveTimestamps: true,
    force: true,
    errorOnExist: false,
  });

  // Count copied files + compute a manifest sha (sha256 over sorted
  // "<relpath>:<size>" lines). This is cheaper than hashing every byte —
  // workspace-copier (Plan 01) is the full-byte witness; archives are
  // reference material, a manifest witness is sufficient forensic record.
  const { copied, manifestSha } = await computeManifestWitness(archiveDestPath);

  await appendRow(args.ledgerPath, {
    ts: ts(),
    action: "apply",
    agent: args.agentId,
    status: "pending",
    source_hash: args.sourceHash,
    step: "session-archive:copy",
    outcome: "allow",
    file_hashes: { [ARCHIVE_SESSIONS_SUBDIR]: manifestSha },
    notes: `archived ${copied} session file(s) to ${archiveDestPath}`,
  });

  return {
    pass: true,
    copied,
    skipped: false,
    archiveDestPath,
  };
}

/**
 * Walk the archive tree, collect (relPath, size) entries, sort, and
 * hash the canonical "<relPath>:<size>\n" manifest. Deterministic, fast,
 * and enough forensic evidence for the ledger witness. Sorting is
 * load-bearing for determinism — readdir order is filesystem-dependent.
 */
async function computeManifestWitness(
  archiveDestPath: string,
): Promise<{ copied: number; manifestSha: string }> {
  const lines: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = join(current, entry.name);
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(childPath, rel);
        continue;
      }
      if (entry.isFile()) {
        const st = await fs.stat(childPath);
        lines.push(`${rel}:${st.size}`);
      }
    }
  }
  if (existsSync(archiveDestPath)) {
    await walk(archiveDestPath, "");
  }
  lines.sort();
  const manifest = lines.join("\n");
  const manifestSha = createHash("sha256")
    .update(manifest, "utf8")
    .digest("hex");
  return { copied: lines.length, manifestSha };
}
