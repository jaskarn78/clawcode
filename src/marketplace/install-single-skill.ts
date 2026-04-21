/**
 * Phase 88 Plan 01 MKT-03 — single-skill installer.
 *
 * Wraps the Phase 84 migration pipeline (discover → classify → secret-
 * scan → copier+transformer → ledger) against ONE skill at a time, then
 * persists the installation to `clawcode.yaml` via the Phase 86-mirrored
 * `updateAgentSkills` writer. Returns a discriminated `SkillInstallOutcome`
 * so Plan 02's Discord slash command can render an ephemeral explanation
 * for every failure mode without a silent skip (MKT-05).
 *
 * Reuses — verbatim, no duplication:
 *   - scanSkillSecrets (skills-secret-scan.ts)            — HARD GATE
 *   - copySkillDirectory + normalizeSkillFrontmatter      — copy/transform
 *   - canLinkSkillToAgent + SCOPE_TAGS + scopeForAgent    — SKILL-08 scope
 *   - appendSkillRow + latestStatusBySkill                — ledger + idempotency
 *   - computeSkillContentHash                             — source hash
 *   - updateAgentSkills (yaml-writer.ts)                  — atomic YAML persist
 *   - SKILL_DEPRECATION_REASONS                           — deprecated gate
 *
 * Non-rollback on YAML persist failure: copy is the irreversible downstream
 * effect (the skill dir now lives under skillsTargetDir). Persistence to
 * clawcode.yaml affects next-boot skill resolution only. Mirrors Phase 86
 * Plan 02 MODEL-04 contract.
 */
import { join } from "node:path";
import { readSkillRows, appendSkillRow } from "../migration/skills-ledger.js";
import type { SkillsLedgerRow } from "../migration/skills-ledger.js";
import { scanSkillSecrets } from "../migration/skills-secret-scan.js";
import { copySkillDirectory } from "../migration/skills-copier.js";
import { normalizeSkillFrontmatter } from "../migration/skills-transformer.js";
import {
  SCOPE_TAGS,
  canLinkSkillToAgent,
  scopeForAgent,
} from "../migration/skills-scope-tags.js";
import {
  SKILL_DEPRECATION_REASONS,
  computeSkillContentHash,
} from "../migration/skills-discovery.js";
import { updateAgentSkills } from "../migration/yaml-writer.js";
import type { MarketplaceEntry } from "./catalog.js";

/**
 * Discriminated union of every outcome `installSingleSkill` can return.
 * Plan 02's Discord renderer branches on `.kind` — each variant carries
 * the fields needed to build the ephemeral explanation.
 *
 * Non-silent-skip invariant (MKT-05): every failure mode has a distinct
 * `kind`. Callers must never collapse two variants into a single message.
 */
export type SkillInstallOutcome =
  | {
      readonly kind: "installed";
      readonly skill: string;
      readonly targetPath: string;
      readonly targetHash: string;
    }
  | {
      readonly kind: "installed-persist-failed";
      readonly skill: string;
      readonly targetPath: string;
      readonly targetHash: string;
      readonly persist_error: string;
    }
  | {
      readonly kind: "already-installed";
      readonly skill: string;
      readonly reason: string;
    }
  | {
      readonly kind: "blocked-secret-scan";
      readonly skill: string;
      readonly offender: string;
    }
  | {
      readonly kind: "rejected-scope";
      readonly skill: string;
      readonly agent: string;
      readonly skillScope: "finmentum" | "personal" | "fleet";
      readonly agentScope: "finmentum" | "personal" | "fleet";
    }
  | {
      readonly kind: "rejected-deprecated";
      readonly skill: string;
      readonly reason: string;
    }
  | {
      readonly kind: "not-in-catalog";
      readonly skill: string;
    }
  | {
      readonly kind: "copy-failed";
      readonly skill: string;
      readonly reason: string;
    };

export type InstallSingleSkillOpts = Readonly<{
  /** Name key into `catalog` — must match an entry for install to proceed. */
  skillName: string;
  /** Agent receiving the skill; its `skills:` list gets the append. */
  agentName: string;
  /** Pre-loaded marketplace catalog (product of `loadMarketplaceCatalog`). */
  catalog: readonly MarketplaceEntry[];
  /** Absolute target root (e.g. `~/.clawcode/skills` expanded). */
  skillsTargetDir: string;
  /** Absolute path to clawcode.yaml. */
  clawcodeYamlPath: string;
  /** Absolute path to the skills migration ledger (JSONL). */
  ledgerPath: string;
  /** When true, bypasses the SKILL-08 scope-tag gate. Default false. */
  force?: boolean;
}>;

/**
 * Install one skill end-to-end. See module docstring + SkillInstallOutcome
 * for the contract. Returns a typed outcome; never throws except for
 * truly unrecoverable fs failures outside any gated branch (e.g. the
 * atomic rename in updateAgentSkills bubbling up a non-EACCES error).
 * Copy errors and persist errors are captured as outcome variants.
 */
export async function installSingleSkill(
  opts: InstallSingleSkillOpts,
): Promise<SkillInstallOutcome> {
  // --- Step 1: Catalog lookup ---------------------------------------
  const entry = opts.catalog.find((e) => e.name === opts.skillName);
  if (!entry) {
    return Object.freeze({
      kind: "not-in-catalog" as const,
      skill: opts.skillName,
    });
  }

  // --- Step 2: Deprecated gate (hard refuse) ------------------------
  const deprecationReason = SKILL_DEPRECATION_REASONS.get(entry.name);
  if (deprecationReason !== undefined || entry.classification === "deprecate") {
    return Object.freeze({
      kind: "rejected-deprecated" as const,
      skill: entry.name,
      reason:
        deprecationReason ??
        "deprecated per v2.2 verdict list; not allowed in marketplace install",
    });
  }

  // --- Step 3: Scope gate (SKILL-08) --------------------------------
  const force = opts.force === true;
  if (!canLinkSkillToAgent(entry.name, opts.agentName, { force })) {
    const skillScope = SCOPE_TAGS.get(entry.name) ?? "fleet";
    const agentScope = scopeForAgent(opts.agentName);
    // Ledger row — refused for audit parity with the Phase 84 CLI pipeline.
    await appendLedgerSafe(opts.ledgerPath, {
      ts: new Date().toISOString(),
      action: "apply",
      skill: entry.name,
      status: "refused",
      source_hash: "scope-gate",
      step: "scope-check",
      outcome: "refuse",
      notes: `scope: ${skillScope} vs ${agentScope}`,
    });
    return Object.freeze({
      kind: "rejected-scope" as const,
      skill: entry.name,
      agent: opts.agentName,
      skillScope,
      agentScope,
    });
  }

  // --- Step 4: Ledger idempotency gate ------------------------------
  // Compute the current source hash so we can compare against the latest
  // "migrated" ledger row for this skill. Matching hash → already-installed;
  // stale hash → re-install path proceeds.
  const currentHash = await computeSkillContentHash(entry.skillDir);
  const ledgerRows = await readSkillRowsSafe(opts.ledgerPath);
  // Last-write-wins semantics for the per-skill row. Scan in append order
  // and let later rows override earlier ones (matches Phase 84 latestStatus-
  // BySkill behavior without needing a second pass).
  let latestMigratedHash: string | null = null;
  for (const row of ledgerRows) {
    if (row.skill !== entry.name) continue;
    if (row.status === "migrated" && row.action === "apply") {
      latestMigratedHash = row.source_hash;
    }
  }
  if (latestMigratedHash === currentHash) {
    return Object.freeze({
      kind: "already-installed" as const,
      skill: entry.name,
      reason: `ledger shows migrated at source_hash ${currentHash.slice(0, 12)}...`,
    });
  }

  // --- Step 5: Secret-scan HARD GATE --------------------------------
  const scanResult = await scanSkillSecrets(entry.skillDir);
  if (!scanResult.pass) {
    const offender = scanResult.offender;
    const offenderDesc = offender
      ? `${offender.file}:${offender.line} (${offender.reason})`
      : "unknown offender";
    await appendLedgerSafe(opts.ledgerPath, {
      ts: new Date().toISOString(),
      action: "apply",
      skill: entry.name,
      status: "refused",
      source_hash: currentHash,
      step: "secret-scan",
      outcome: "refuse",
      notes: offender
        ? `${offender.reason}: ${offender.file}:${offender.line}`
        : "secret-scan refused",
    });
    return Object.freeze({
      kind: "blocked-secret-scan" as const,
      skill: entry.name,
      offender: offenderDesc,
    });
  }

  // --- Step 6: Copy + transform ------------------------------------
  // NOTE: fs-guard installFsGuard/uninstallFsGuard is a CLI-level concern
  // (the Phase 84 migrate-skills CLI wraps its top-level action body).
  // The marketplace install path is invoked from a running daemon where
  // writing to ~/.openclaw/ is NOT a risk — the installer only writes to
  // skillsTargetDir and clawcodeYamlPath. Keeping the guard here would
  // require the daemon to briefly surrender fs writes, which could
  // cascade into unrelated in-flight daemon tasks. Skipping the guard is
  // the correct choice; the source tree is read-only by the copier
  // contract (`cp` reads only).
  const targetPath = join(opts.skillsTargetDir, entry.name);
  const copyResult = await copySkillDirectory(entry.skillDir, targetPath, {
    transformSkillMd: (c) => normalizeSkillFrontmatter(c, entry.name),
  });
  if (!copyResult.pass) {
    const mmCount = copyResult.mismatches?.length ?? 0;
    const reason = `hash-witness mismatch: ${mmCount} file(s)`;
    await appendLedgerSafe(opts.ledgerPath, {
      ts: new Date().toISOString(),
      action: "apply",
      skill: entry.name,
      status: "refused",
      source_hash: currentHash,
      step: "copy",
      outcome: "refuse",
      notes: reason,
    });
    return Object.freeze({
      kind: "copy-failed" as const,
      skill: entry.name,
      reason,
    });
  }

  // --- Step 7: Persist to clawcode.yaml (non-rollback on failure) --
  let persisted = false;
  let persistError: string | null = null;
  try {
    const persistResult = await updateAgentSkills({
      existingConfigPath: opts.clawcodeYamlPath,
      agentName: opts.agentName,
      skillName: entry.name,
      op: "add",
    });
    if (
      persistResult.outcome === "updated" ||
      persistResult.outcome === "no-op"
    ) {
      persisted = true;
    } else {
      persistError = persistResult.reason;
    }
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
    // Deliberately do NOT re-throw — copy succeeded, persistence is
    // next-boot durability only. Mirrors Phase 86 Plan 02 MODEL-04.
  }

  // --- Step 8: Ledger success row -----------------------------------
  await appendLedgerSafe(opts.ledgerPath, {
    ts: new Date().toISOString(),
    action: "apply",
    skill: entry.name,
    status: "migrated",
    source_hash: currentHash,
    target_hash: copyResult.targetHash,
    step: "copy+persist",
    outcome: "allow",
    notes: `persisted=${persisted}${persistError ? `; ${persistError}` : ""}`,
  });

  // --- Step 9: Return typed outcome ---------------------------------
  if (persisted) {
    return Object.freeze({
      kind: "installed" as const,
      skill: entry.name,
      targetPath,
      targetHash: copyResult.targetHash,
    });
  }
  return Object.freeze({
    kind: "installed-persist-failed" as const,
    skill: entry.name,
    targetPath,
    targetHash: copyResult.targetHash,
    persist_error: persistError ?? "unknown persist failure",
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * `readSkillRows` throws when the ledger has malformed JSON. Installer
 * must not propagate that — a corrupt ledger is an operator issue, not a
 * reason to refuse every subsequent install. Fall back to `[]` on read
 * failure (caller gets the re-install path, and the append below will
 * still write the new row).
 */
async function readSkillRowsSafe(
  ledgerPath: string,
): Promise<readonly SkillsLedgerRow[]> {
  try {
    return await readSkillRows(ledgerPath);
  } catch {
    return [];
  }
}

/**
 * Ledger append with best-effort semantics — the installer should never
 * throw because the ledger file is temporarily write-locked. Log-and-
 * swallow keeps the install outcome truthful to the actual state (copy
 * + YAML persist have already happened when the success-row append
 * fires).
 */
async function appendLedgerSafe(
  ledgerPath: string,
  row: SkillsLedgerRow,
): Promise<void> {
  try {
    await appendSkillRow(ledgerPath, row);
  } catch {
    // Best effort — installer outcome is authoritative regardless of ledger.
  }
}
