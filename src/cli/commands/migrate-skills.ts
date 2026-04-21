/**
 * Phase 84 Plan 01 Task 2 — `clawcode migrate openclaw skills` CLI.
 *
 * Nested under the existing `migrate openclaw` subcommand tree (Phase 76)
 * as a sibling to `list` / `plan` / `apply` / `verify` / `rollback` /
 * `cutover` / `complete`. Does NOT create a top-level `clawcode
 * skills-migrate` — keeps the migrate namespace coherent.
 *
 * Usage:
 *   clawcode migrate openclaw skills              (alias for --dry-run)
 *   clawcode migrate openclaw skills --dry-run    (default; safe)
 *   clawcode migrate openclaw skills apply        (writes ledger; Plan 02 adds copy)
 *
 * Pipeline per skill (ALPHABETICAL order, deterministic output):
 *   discovery → classification (P1/P2/DEPRECATE/unknown)
 *     P1  → ledger-idempotency check (matching source_hash)
 *             yes → skipped (idempotent)
 *             no  → secret-scan
 *                     refuse → skipped (secret-scan)
 *                     allow  → migrated / would-migrate
 *     P2  → skipped (p2-out-of-scope)
 *     DEP → skipped (deprecated)
 *     UNK → skipped (p2-out-of-scope) unless --include-unknown
 *
 * Exit codes:
 *   0 — dry-run (informational) OR apply with no secret-scan refusals
 *   1 — apply with one or more secret-scan refusals
 *
 * Zero-write contract (inherited from Phase 76):
 *   - NO writes to ~/.openclaw/ EVER (enforced by fs-guard runtime patch)
 *   - NO writes to the ledger during --dry-run
 *   - Ledger at opts.ledgerPath is the ONLY permitted write
 *
 * DO NOT:
 *   - Log through console.* — always cliLog/cliError
 *   - Add chalk/picocolors/cli-table3 (zero new deps constraint)
 *   - Write anywhere except the ledger in the apply branch
 *   - Perform the actual copy — Plan 02 lands that on top of this scaffold
 */
import type { Command } from "commander";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  installFsGuard,
  uninstallFsGuard,
} from "../../migration/fs-guard.js";
import { cliLog, cliError, green, yellow, red, dim } from "../output.js";
import {
  discoverOpenclawSkills,
  SKILL_DEPRECATION_REASONS,
  type DiscoveredSkill,
} from "../../migration/skills-discovery.js";
import { scanSkillSecrets } from "../../migration/skills-secret-scan.js";
import {
  DEFAULT_SKILLS_LEDGER_PATH,
  appendSkillRow,
  readSkillRows,
  type SkillsLedgerRow,
  type SkillsLedgerStatus,
} from "../../migration/skills-ledger.js";

/**
 * Options for `runMigrateSkillsAction`. Exported for unit-test invocation
 * without going through Commander.
 */
export type MigrateSkillsOptions = {
  readonly sourceDir: string;
  readonly ledgerPath: string;
  readonly dryRun: boolean;
  readonly includeUnknown?: boolean;
};

type Bucket =
  | "migrated"
  | "skipped (secret-scan)"
  | "skipped (deprecated)"
  | "skipped (idempotent)"
  | "skipped (p2-out-of-scope)";

type BucketedEntry = {
  readonly skill: DiscoveredSkill;
  readonly bucket: Bucket;
  readonly line: string;
};

/**
 * Expand a `~/...` or `~` path to the user's home directory. Plain
 * implementation — no glob / alias support; skill discovery is not a
 * shell command line.
 */
function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Locked section order + header literal. Used by both the emitter and the
 * self-test. Tests grep for these exact strings.
 */
const SECTION_ORDER: readonly Bucket[] = [
  "migrated",
  "skipped (secret-scan)",
  "skipped (deprecated)",
  "skipped (idempotent)",
  "skipped (p2-out-of-scope)",
];

function headerFor(bucket: Bucket): string {
  return `=== ${bucket} ===`;
}

/**
 * Map a bucket to the `status` field on a ledger row. Mirrors the behavior
 * spec — secret-scan failures write "refused", deprecated/p2/idempotent
 * write "skipped", would-migrate writes "pending" (plan mode; apply is
 * Plan 02's territory and will upgrade to "migrated").
 */
function bucketToStatus(bucket: Bucket): SkillsLedgerStatus {
  switch (bucket) {
    case "migrated":
      return "pending";
    case "skipped (secret-scan)":
      return "refused";
    case "skipped (deprecated)":
    case "skipped (idempotent)":
    case "skipped (p2-out-of-scope)":
      return "skipped";
  }
}

/**
 * Map a bucket to the narrow `outcome` field (allow/refuse). Only
 * secret-scan refusals are `refuse`; everything else is `allow` (including
 * skips — they are a valid flow, not a rejection).
 */
function bucketToOutcome(bucket: Bucket): "allow" | "refuse" {
  return bucket === "skipped (secret-scan)" ? "refuse" : "allow";
}

/**
 * End-to-end action for `clawcode migrate openclaw skills`.
 *
 * Pure w.r.t. opts — no env-var reads. CLI Commander wiring is in
 * registerMigrateSkillsCommand below; it translates commander opts +
 * env vars into a MigrateSkillsOptions.
 */
export async function runMigrateSkillsAction(
  opts: MigrateSkillsOptions,
): Promise<number> {
  const sourceDir = expandHome(opts.sourceDir);

  // Wrap the entire action body in the fs-guard so any write attempt under
  // ~/.openclaw/ throws ReadOnlySourceError. uninstall in finally so a
  // subsequent CLI subcommand can legitimately write elsewhere.
  installFsGuard();
  try {
    const skills = await discoverOpenclawSkills(sourceDir);

    // Build the ledger index ONCE before the loop — capture the latest
    // "migrated" row per skill with its source_hash so idempotency is
    // snapshotted and the per-skill classify loop never re-reads the file.
    const ledgerRows = opts.dryRun
      ? await readSkillRows(opts.ledgerPath).catch(() => [])
      : await readSkillRows(opts.ledgerPath).catch(() => []);
    const migratedHashBySkill = new Map<string, string>();
    for (const row of ledgerRows) {
      if (row.status === "migrated") {
        // Last-write-wins — later rows override earlier ones (append-only
        // ordering is the truth source).
        migratedHashBySkill.set(row.skill, row.source_hash);
      }
    }

    const entries: BucketedEntry[] = [];

    for (const skill of skills) {
      let bucket: Bucket;
      let lineDetail = "";

      switch (skill.classification) {
        case "deprecate": {
          bucket = "skipped (deprecated)";
          const reason =
            SKILL_DEPRECATION_REASONS.get(skill.name) ??
            "deprecated per v2.2 verdict list";
          lineDetail = reason;
          break;
        }
        case "p2": {
          bucket = "skipped (p2-out-of-scope)";
          lineDetail = "P2 — out of v2.2 scope";
          break;
        }
        case "unknown": {
          if (opts.includeUnknown === true) {
            // Treat as P1 and run the normal flow.
            const result = await classifyP1(
              skill,
              migratedHashBySkill,
              opts.dryRun,
            );
            bucket = result.bucket;
            lineDetail = result.detail;
          } else {
            bucket = "skipped (p2-out-of-scope)";
            lineDetail = "unknown classification";
          }
          break;
        }
        case "p1": {
          const result = await classifyP1(
            skill,
            migratedHashBySkill,
            opts.dryRun,
          );
          bucket = result.bucket;
          lineDetail = result.detail;
          break;
        }
      }

      entries.push({
        skill,
        bucket,
        line: formatEntryLine(skill, bucket, lineDetail, opts.dryRun),
      });

      // Apply-mode ledger row. Dry-run writes nothing.
      if (!opts.dryRun) {
        const row: SkillsLedgerRow = {
          ts: new Date().toISOString(),
          action: "plan",
          skill: skill.name,
          status: bucketToStatus(bucket),
          source_hash: skill.sourceHash,
          step: "classify",
          outcome: bucketToOutcome(bucket),
          notes: lineDetail || undefined,
        };
        await appendSkillRow(opts.ledgerPath, row);
      }
    }

    // Group by bucket, preserve alphabetical order within each.
    const byBucket = new Map<Bucket, BucketedEntry[]>();
    for (const b of SECTION_ORDER) byBucket.set(b, []);
    for (const e of entries) byBucket.get(e.bucket)!.push(e);

    // Emit sections in locked order.
    for (const bucket of SECTION_ORDER) {
      cliLog(headerFor(bucket));
      const inBucket = byBucket.get(bucket)!;
      if (inBucket.length === 0) {
        cliLog(dim("(none)"));
      } else {
        for (const e of inBucket) cliLog(e.line);
      }
    }

    // Exit code logic: dry-run always 0 (informational).
    // Apply mode: 1 if any secret-scan refusal, 0 otherwise.
    if (opts.dryRun) return 0;
    const refusals = byBucket.get("skipped (secret-scan)")!;
    return refusals.length > 0 ? 1 : 0;
  } finally {
    uninstallFsGuard();
  }
}

/**
 * P1 classification flow — idempotency check first, then secret scan.
 * Returns the bucket + detail string for display.
 */
async function classifyP1(
  skill: DiscoveredSkill,
  migratedHashBySkill: ReadonlyMap<string, string>,
  _dryRun: boolean,
): Promise<{ bucket: Bucket; detail: string }> {
  void _dryRun;
  // Idempotency: prior 'migrated' row + matching source_hash.
  const priorHash = migratedHashBySkill.get(skill.name);
  if (priorHash !== undefined && priorHash === skill.sourceHash) {
    return {
      bucket: "skipped (idempotent)",
      detail: `source_hash matches prior 'migrated' row (${priorHash.slice(0, 12)}…)`,
    };
  }

  const scan = await scanSkillSecrets(skill.path);
  if (!scan.pass) {
    const off = scan.offender!;
    // Format the file as repo-relative if we can — strip the skill path
    // prefix so the output is `SKILL.md:20` rather than
    // `/home/.../skills/finmentum-crm/SKILL.md:20`.
    const relFile = off.file.startsWith(skill.path + "/")
      ? off.file.slice(skill.path.length + 1)
      : off.file;
    return {
      bucket: "skipped (secret-scan)",
      detail: `${relFile}:${off.line} (${off.reason})`,
    };
  }

  return {
    bucket: "migrated",
    detail: priorHash === undefined ? "ready to migrate" : "source_hash changed — re-planned",
  };
}

/**
 * Format a single entry line. Color hints use the existing output.ts
 * helpers so NO_COLOR=1 gives plain text (load-bearing for deterministic
 * test output).
 */
function formatEntryLine(
  skill: DiscoveredSkill,
  bucket: Bucket,
  detail: string,
  _dryRun: boolean,
): string {
  void _dryRun;
  const name = skill.name;
  switch (bucket) {
    case "migrated":
      return `  ${green(name)} — ${detail}`;
    case "skipped (secret-scan)":
      return `  ${red(name)} — ${detail}`;
    case "skipped (deprecated)":
      return `  ${dim(name)} — ${detail}`;
    case "skipped (idempotent)":
      return `  ${dim(name)} — ${detail}`;
    case "skipped (p2-out-of-scope)":
      return `  ${yellow(name)} — ${detail}`;
  }
}

/**
 * Commander wiring — attaches a `skills` subcommand to the existing
 * `migrate openclaw` parent tree. The parent is passed in by
 * migrate-openclaw.ts's registerMigrateOpenclawCommand.
 */
export function registerMigrateSkillsCommand(
  parentOpenclawCmd: Command,
): void {
  parentOpenclawCmd
    .command("skills")
    .description(
      "Migrate OpenClaw skills to ClawCode (dry-run default; use --no-dry-run to apply)",
    )
    .option(
      "--source-dir <path>",
      "OpenClaw skills source dir",
      "~/.openclaw/skills",
    )
    .option(
      "--ledger-path <path>",
      "Skills ledger JSONL path",
      DEFAULT_SKILLS_LEDGER_PATH,
    )
    .option("--dry-run", "Classify without writing the ledger (default)", true)
    .option(
      "--no-dry-run",
      "Apply — write ledger rows; refuse on secret-scan",
    )
    .option(
      "--include-unknown",
      "Treat unknown skills as P1 candidates (default: skip)",
    )
    .action(
      async (opts: {
        sourceDir: string;
        ledgerPath: string;
        dryRun: boolean;
        includeUnknown?: boolean;
      }) => {
        try {
          const ledgerPath =
            process.env.CLAWCODE_SKILLS_LEDGER_PATH ?? opts.ledgerPath;
          const code = await runMigrateSkillsAction({
            sourceDir: opts.sourceDir,
            ledgerPath,
            dryRun: opts.dryRun,
            includeUnknown: opts.includeUnknown,
          });
          if (code !== 0) process.exit(code);
        } catch (err) {
          cliError(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      },
    );
}
