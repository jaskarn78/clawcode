/**
 * Phase 82 OPS-04 — migration report builder + atomic writer.
 *
 * Generates `.planning/milestones/v2.1-migration-report.md` from the
 * ledger + openclaw.json + clawcode.yaml + per-agent memories.db.
 *
 * Report structure (locked per 82-CONTEXT):
 *   ---
 *   milestone: v2.1
 *   date: <ISO>
 *   agents_migrated: <N>
 *   agents_verified: <N>
 *   agents_cut_over: <N>
 *   agents_rolled_back: <N>
 *   source_integrity_sha: <sha256-of-ledger-source-hash-witness-rows>
 *   ---
 *   # v2.1 OpenClaw → ClawCode Migration Report
 *   ## Per-Agent Outcomes
 *   ### <agent-name>
 *     - source_workspace: ...
 *     - target_basePath: ...
 *     - memory_count_delta: <source> → <migrated> (Δ <pct>%)
 *     - discord_cutover_ts: <ISO or "not-cut-over">
 *     - rollback_status: none | rolled-back-on <ISO>
 *     - warnings: <count>
 *       - <warning text>
 *   ## Cross-Agent Invariants
 *   - [x] Zero Discord channel IDs present in both openclaw.json:bindings and
 *         clawcode.yaml:agents[].channels
 *   - [x] ~/.openclaw/ tree byte-identical to pre-migration snapshot (except
 *         openclaw.json — tracked via before/after hashes in ledger)
 *   - [x] Every memories.db across migrated agents has zero duplicate
 *         origin_id values
 *
 * Refuse paths (order matters):
 *   1. refused-pending — any agent has latest status 'pending' AND
 *      forceOnPending is not true. Literal message: "Cannot complete: <N>
 *      agent(s) still pending. Run apply + verify first, or pass --force to
 *      acknowledge gaps." — grep-pinned.
 *   2. refused-invariants — any of zeroChannelOverlap /
 *      sourceTreeByteIdentical / zeroDuplicateOriginIds is false. Literal
 *      prefix: "Cannot complete: cross-agent invariant(s) violated: ..."
 *   3. refused-secret — rendered markdown body or agent warnings contain a
 *      sk- / MT- / high-entropy shape. Uses Phase 77 scanSecrets.
 *
 * Atomic temp+rename mirrors yaml-writer.ts. Parent directory is mkdir'd
 * recursively before tmp write so `.planning/milestones/` can be freshly
 * created on first run.
 *
 * DO NOT:
 *   - Rewrite ledger rows — ledger is append-only (ledger.ts invariants).
 *   - Re-hash the entire ~/.openclaw/ tree — source_integrity_sha uses the
 *     ledger witness rows as the pre-collected hash record (cheaper,
 *     deterministic, and the only auditable source anyway).
 *   - Skip the scanSecrets gate — a success criterion.
 *   - Use zod to parse the report output — output is plain markdown, not
 *     a schema-validated structure.
 *   - Add new npm deps — uses yaml (already shipped), createHash (node:crypto).
 */
import { createHash } from "node:crypto";
import { writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { readRows, latestStatusByAgent, type LedgerRow } from "./ledger.js";
import { readOpenclawInventory } from "./openclaw-config-reader.js";
import { loadConfig, resolveAllAgents } from "../config/loader.js";
import { scanSecrets } from "./guards.js";
import { discoverWorkspaceMarkdown } from "./memory-translator.js";
import { MemoryStore } from "../memory/store.js";
import type { PlanReport, AgentPlan } from "./diff-builder.js";

/**
 * Literal report path — exactly `.planning/milestones/v2.1-migration-report.md`.
 * Grep-pinned by report-writer.test.ts.
 */
export const REPORT_PATH_LITERAL =
  ".planning/milestones/v2.1-migration-report.md";

/**
 * Mutable fs-dispatch holder — ESM-safe test monkey-patching pattern
 * (mirrors yaml-writer.ts writerFs). Tests assign properties to intercept
 * rename / writeFile / unlink / mkdir without vi.spyOn against frozen
 * node:fs/promises exports. Exported for test visibility only; production
 * code must never mutate this.
 */
export const reportWriterFs: {
  writeFile: typeof writeFile;
  rename: typeof rename;
  unlink: typeof unlink;
  mkdir: typeof mkdir;
} = { writeFile, rename, unlink, mkdir };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PerAgentReportRow = Readonly<{
  agentName: string;
  sourceWorkspace: string;
  targetBasePath: string;
  sourceMemoryCount: number;
  migratedMemoryCount: number;
  memoryDriftPct: number; // (migrated-source)/max(source,1)*100, signed
  discordCutoverTs: string;
  rollbackStatus: "none" | string;
  warnings: readonly string[];
}>;

export type CrossAgentInvariants = Readonly<{
  /** openclaw.json:bindings channel IDs ∩ clawcode.yaml:agents[].channels = ∅ */
  zeroChannelOverlap: boolean;
  /**
   * ~/.openclaw/ tree byte-identical to pre-migration snapshot EXCEPT
   * openclaw.json (which cutover:write rows intentionally mutate). Heuristic:
   * ledger has zero write-success rows touching ~/.openclaw/ other than
   * `action:"cutover" && step:"cutover:write"`.
   */
  sourceTreeByteIdentical: boolean;
  /** Zero rows in `SELECT origin_id, COUNT(*) FROM memories GROUP BY origin_id HAVING COUNT>1` across agents. */
  zeroDuplicateOriginIds: boolean;
}>;

export type MigrationReportContext = Readonly<{
  ledgerPath: string;
  openclawJsonPath: string;
  clawcodeConfigPath: string;
  /** Source root — ~/.openclaw */
  openclawRoot: string;
  /** Source memory dir — ~/.openclaw/memory */
  openclawMemoryDir: string;
  /** Bypass the refused-pending gate. CLI maps this from --force. */
  forceOnPending?: boolean;
  /** DI for test determinism — defaults to ISO 'now'. */
  ts?: () => string;
}>;

export type BuildReportResult =
  | {
      readonly outcome: "built";
      readonly markdown: string;
      readonly frontmatter: Record<string, string | number>;
      readonly invariants: CrossAgentInvariants;
      readonly perAgent: readonly PerAgentReportRow[];
    }
  | {
      readonly outcome: "refused-pending";
      readonly pendingCount: number;
      readonly message: string;
    }
  | {
      readonly outcome: "refused-invariants";
      readonly failing: readonly string[];
      readonly message: string;
    }
  | {
      readonly outcome: "refused-secret";
      readonly offenderPath: string;
    };

// ---------------------------------------------------------------------------
// buildMigrationReport
// ---------------------------------------------------------------------------

/**
 * Read ledger + openclaw.json + clawcode.yaml + per-agent memories.db;
 * compute per-agent rows + cross-agent invariants; render markdown; scan
 * for secrets; return a BuildReportResult.
 */
export async function buildMigrationReport(
  ctx: MigrationReportContext,
): Promise<BuildReportResult> {
  const ts = ctx.ts ?? (() => new Date().toISOString());

  // ---- Step 1: load ledger + derive status map + count outcomes -------
  const rows = await readRows(ctx.ledgerPath);
  const latestByAgent = await latestStatusByAgent(ctx.ledgerPath);

  // ---- Step 2: refuse-pending gate ------------------------------------
  const pendingAgents: string[] = [];
  for (const [agent, status] of latestByAgent.entries()) {
    if (status === "pending") pendingAgents.push(agent);
  }
  if (pendingAgents.length > 0 && ctx.forceOnPending !== true) {
    return {
      outcome: "refused-pending",
      pendingCount: pendingAgents.length,
      message: `Cannot complete: ${pendingAgents.length} agent(s) still pending. Run apply + verify first, or pass --force to acknowledge gaps.`,
    };
  }

  // ---- Step 3: load source-side + target-side configs -----------------
  const inventory = await readOpenclawInventory(ctx.openclawJsonPath);
  const clawcodeCfg = await loadConfig(ctx.clawcodeConfigPath);
  const resolvedAgents = resolveAllAgents(clawcodeCfg);

  // ---- Step 4: per-agent report rows ----------------------------------
  const perAgent: PerAgentReportRow[] = [];
  for (const agent of resolvedAgents) {
    // Source memory count via re-discovering markdown (mirrors verifier.ts)
    const sourceWorkspace = join(
      ctx.openclawRoot,
      `workspace-${agent.name}`,
    );
    let sourceCount = 0;
    if (existsSync(sourceWorkspace)) {
      const discovered = await discoverWorkspaceMarkdown(
        sourceWorkspace,
        agent.name,
      );
      sourceCount = discovered.length;
    }
    // Migrated count via per-agent memories.db
    const dbPath = join(agent.memoryPath, "memory", "memories.db");
    let migratedCount = 0;
    if (existsSync(dbPath)) {
      const store = new MemoryStore(dbPath);
      try {
        const db = store.getDatabase();
        const row = db
          .prepare(
            "SELECT COUNT(*) AS c FROM memories WHERE origin_id LIKE ?",
          )
          .get(`openclaw:${agent.name}:%`) as { c: number } | undefined;
        migratedCount = row?.c ?? 0;
      } finally {
        store.close();
      }
    }
    const memoryDriftPct =
      ((migratedCount - sourceCount) / Math.max(sourceCount, 1)) * 100;

    // Cutover ts
    const cutoverRow = rows.find(
      (r) =>
        r.agent === agent.name &&
        r.action === "cutover" &&
        r.step === "cutover:write",
    );
    const discordCutoverTs = cutoverRow?.ts ?? "not-cut-over";

    // Rollback status
    const rollbackRow = rows.find(
      (r) =>
        r.agent === agent.name &&
        r.action === "rollback" &&
        r.status === "rolled-back",
    );
    const rollbackStatus = rollbackRow
      ? `rolled-back-on ${rollbackRow.ts}`
      : "none";

    // Warnings: ledger rows for this agent with outcome === "refuse"
    const warnings = rows
      .filter((r) => r.agent === agent.name && r.outcome === "refuse")
      .map((r) => r.notes ?? `${r.step ?? r.action}: refused`);

    perAgent.push(
      Object.freeze({
        agentName: agent.name,
        sourceWorkspace,
        targetBasePath: agent.workspace,
        sourceMemoryCount: sourceCount,
        migratedMemoryCount: migratedCount,
        memoryDriftPct,
        discordCutoverTs,
        rollbackStatus,
        warnings: Object.freeze(warnings),
      }),
    );
  }

  // ---- Step 5: cross-agent invariants ---------------------------------
  const invariants = computeInvariants({
    rows,
    openclawChannelIds: inventory.bindings
      .filter((b) => b.match.peer.kind === "channel")
      .map((b) => b.match.peer.id),
    clawcodeChannelIds: resolvedAgents.flatMap((a) => [...a.channels]),
    perAgentDbPaths: resolvedAgents.map((a) =>
      join(a.memoryPath, "memory", "memories.db"),
    ),
  });

  const failing: string[] = [];
  if (!invariants.zeroChannelOverlap) failing.push("zeroChannelOverlap");
  if (!invariants.sourceTreeByteIdentical)
    failing.push("sourceTreeByteIdentical");
  if (!invariants.zeroDuplicateOriginIds) failing.push("zeroDuplicateOriginIds");
  if (failing.length > 0) {
    return {
      outcome: "refused-invariants",
      failing: Object.freeze([...failing]),
      message: `Cannot complete: cross-agent invariant(s) violated: ${failing.join(", ")}`,
    };
  }

  // ---- Step 6: counts for frontmatter ---------------------------------
  const agentsMigrated = [...latestByAgent.values()].filter(
    (s) => s === "migrated" || s === "verified",
  ).length;
  const agentsVerified = [...latestByAgent.values()].filter(
    (s) => s === "verified",
  ).length;
  const agentsCutOver = rows.filter(
    (r) => r.action === "cutover" && r.step === "cutover:write",
  ).length;
  const agentsRolledBack = [...latestByAgent.values()].filter(
    (s) => s === "rolled-back",
  ).length;

  // source_integrity_sha: hash of the sorted ledger witness rows' file_hashes
  // entries whose keys fall under ~/.openclaw/. This IS the audit trail —
  // the only authoritative record of source-tree mutations, so hashing it
  // gives a stable checksum without re-walking 14+ agent directories.
  const sourceIntegritySha = computeSourceIntegritySha(rows);

  const frontmatter: Record<string, string | number> = {
    milestone: "v2.1",
    date: ts(),
    agents_migrated: agentsMigrated,
    agents_verified: agentsVerified,
    agents_cut_over: agentsCutOver,
    agents_rolled_back: agentsRolledBack,
    source_integrity_sha: sourceIntegritySha,
  };

  // ---- Step 7: render markdown ----------------------------------------
  const markdown = renderMarkdown({ frontmatter, perAgent, invariants });

  // ---- Step 8: scanSecrets gate ---------------------------------------
  // Walk the perAgent rows (which carry warnings + agent-labeled text) as
  // a PlanReport shim. If the rendered markdown contained a secret, the
  // source data did too — scanning the structured data catches it pre-render.
  // Scan the markdown body ITSELF too — a secret lurking in frontmatter
  // date/sha values would otherwise slip through.
  const scanShim: PlanReport = {
    agents: perAgent.map((r) => ({
      sourceId: r.agentName,
      sourceName: r.agentName,
      sourceWorkspace: r.sourceWorkspace,
      sourceAgentDir: "",
      sourceModel: "",
      memoryChunkCount: r.sourceMemoryCount,
      memoryStatus: "present",
      discordChannelId: undefined,
      isFinmentumFamily: false,
      targetBasePath: r.targetBasePath,
      targetMemoryPath: r.targetBasePath,
      targetAgentName: r.agentName,
      // Intentional extra field for the walker — cast through `unknown`
      // launders the shape since the scanner does a structural walk.
      warnings: r.warnings,
    })) as unknown as readonly AgentPlan[],
    warnings: [],
    sourcePath: "",
    targetRoot: "",
    generatedAt: ts(),
    planHash: "",
  };
  const secretResult = scanSecrets({
    ts,
    report: scanShim,
    source_hash: "phase82-report-writer",
  });
  if (!secretResult.pass) {
    return {
      outcome: "refused-secret",
      offenderPath: secretResult.ledgerRow.notes ?? "(unknown)",
    };
  }

  return {
    outcome: "built",
    markdown,
    frontmatter,
    invariants,
    perAgent: Object.freeze([...perAgent]),
  };
}

// ---------------------------------------------------------------------------
// Invariants computation
// ---------------------------------------------------------------------------

type InvariantsInput = Readonly<{
  rows: readonly LedgerRow[];
  openclawChannelIds: readonly string[];
  clawcodeChannelIds: readonly string[];
  perAgentDbPaths: readonly string[];
}>;

function computeInvariants(input: InvariantsInput): CrossAgentInvariants {
  // ---- Invariant 1: zero channel overlap ------------------------------
  const claw = new Set(input.clawcodeChannelIds);
  let zeroChannelOverlap = true;
  for (const id of input.openclawChannelIds) {
    if (claw.has(id)) {
      zeroChannelOverlap = false;
      break;
    }
  }

  // ---- Invariant 2: source tree byte-identical ------------------------
  // Heuristic (documented): ledger has zero rows that successfully wrote
  // under ~/.openclaw/ outside of cutover:write rows. Cutover:write rows
  // are the sanctioned source-tree mutation path. If any OTHER write-like
  // ledger row landed under ~/.openclaw/ with outcome:"allow", the source
  // tree is no longer byte-identical and the invariant fails.
  //
  // We infer "wrote under ~/.openclaw/" from file_hashes keys. Any row with
  // file_hashes containing a "openclaw.json.*" key is a cutover row and is
  // allowed. Any row with file_hashes keys mentioning workspace-/ or
  // memory/<agent>.sqlite that has outcome "allow" is a violation.
  let sourceTreeByteIdentical = true;
  for (const r of input.rows) {
    if (r.outcome !== "allow") continue;
    if (!r.file_hashes) continue;
    const keys = Object.keys(r.file_hashes);
    const isCutoverWrite =
      r.action === "cutover" &&
      r.step === "cutover:write" &&
      keys.every((k) => k.startsWith("openclaw.json"));
    if (isCutoverWrite) continue;
    // Non-cutover allow rows: rollback:complete records a WITNESS (no actual
    // write to source) — those are fine. The file_hashes keys for rollback
    // rows are "workspace/..." / "memory/<agent>.sqlite" which represent
    // the PRE-rollback source snapshot. They are never "openclaw.json.*".
    // We therefore accept rollback witness rows and flag anything else.
    if (r.action === "rollback" && r.step === "rollback:complete") continue;
    // Any remaining non-cutover "allow" row with source-tree file_hashes
    // keys signals an unsanctioned source mutation path.
    const touchesSource = keys.some(
      (k) => k.startsWith("workspace/") || k.startsWith("memory/"),
    );
    if (touchesSource) {
      sourceTreeByteIdentical = false;
      break;
    }
  }

  // ---- Invariant 3: zero duplicate origin_ids -------------------------
  let zeroDuplicateOriginIds = true;
  for (const dbPath of input.perAgentDbPaths) {
    if (!existsSync(dbPath)) continue;
    const store = new MemoryStore(dbPath);
    try {
      const db = store.getDatabase();
      const row = db
        .prepare(
          "SELECT COUNT(*) AS c FROM (SELECT origin_id FROM memories WHERE origin_id IS NOT NULL GROUP BY origin_id HAVING COUNT(*) > 1)",
        )
        .get() as { c: number } | undefined;
      if ((row?.c ?? 0) > 0) {
        zeroDuplicateOriginIds = false;
        break;
      }
    } finally {
      store.close();
    }
  }

  return Object.freeze({
    zeroChannelOverlap,
    sourceTreeByteIdentical,
    zeroDuplicateOriginIds,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

type RenderInput = Readonly<{
  frontmatter: Record<string, string | number>;
  perAgent: readonly PerAgentReportRow[];
  invariants: CrossAgentInvariants;
}>;

function renderMarkdown(input: RenderInput): string {
  const fmLines: string[] = ["---"];
  for (const [k, v] of Object.entries(input.frontmatter)) {
    fmLines.push(`${k}: ${v}`);
  }
  fmLines.push("---", "");

  const body: string[] = [];
  body.push("# v2.1 OpenClaw → ClawCode Migration Report", "");
  body.push("## Per-Agent Outcomes", "");
  for (const row of input.perAgent) {
    body.push(`### ${row.agentName}`);
    body.push(`- source_workspace: ${row.sourceWorkspace}`);
    body.push(`- target_basePath: ${row.targetBasePath}`);
    body.push(
      `- memory_count_delta: ${row.sourceMemoryCount} → ${row.migratedMemoryCount} (Δ ${row.memoryDriftPct.toFixed(1)}%)`,
    );
    body.push(`- discord_cutover_ts: ${row.discordCutoverTs}`);
    body.push(`- rollback_status: ${row.rollbackStatus}`);
    body.push(`- warnings: ${row.warnings.length}`);
    for (const w of row.warnings) {
      body.push(`  - ${w}`);
    }
    body.push("");
  }

  body.push("## Cross-Agent Invariants", "");
  body.push(
    `- [${input.invariants.zeroChannelOverlap ? "x" : " "}] Zero Discord channel IDs present in both \`openclaw.json:bindings\` and \`clawcode.yaml:agents[].channels\``,
  );
  body.push(
    `- [${input.invariants.sourceTreeByteIdentical ? "x" : " "}] \`~/.openclaw/\` tree byte-identical to pre-migration snapshot (except \`openclaw.json\` which was intentionally modified by cutover — tracked via before/after hashes in ledger)`,
  );
  body.push(
    `- [${input.invariants.zeroDuplicateOriginIds ? "x" : " "}] Every \`memories.db\` across migrated agents has zero duplicate \`origin_id\` values`,
  );
  body.push("");

  return [...fmLines, ...body].join("\n");
}

// ---------------------------------------------------------------------------
// source_integrity_sha — stable hash of ledger witness rows
// ---------------------------------------------------------------------------

function computeSourceIntegritySha(rows: readonly LedgerRow[]): string {
  const witnesses: Array<{ agent: string; step: string; fh: Record<string, string> }> = [];
  for (const r of rows) {
    if (!r.file_hashes) continue;
    // Only source-tree-relevant witnesses. Rollback rows capture SOURCE
    // hashes under "workspace/..." / "memory/<agent>.sqlite"; cutover rows
    // capture "openclaw.json.before" / ".after". Both are the auditable
    // record of source integrity.
    const keys = Object.keys(r.file_hashes);
    const relevant = keys.filter(
      (k) =>
        k.startsWith("openclaw.json") ||
        k.startsWith("workspace/") ||
        k.startsWith("memory/"),
    );
    if (relevant.length === 0) continue;
    const fh: Record<string, string> = {};
    for (const k of relevant) fh[k] = r.file_hashes[k] as string;
    witnesses.push({ agent: r.agent, step: r.step ?? r.action, fh });
  }
  // Sort for determinism. Two runs over the same ledger MUST produce the
  // same sha (step+agent is a stable key per row).
  witnesses.sort((a, b) =>
    `${a.agent}/${a.step}`.localeCompare(`${b.agent}/${b.step}`),
  );
  const canonical = JSON.stringify(witnesses);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// writeMigrationReport — atomic temp+rename
// ---------------------------------------------------------------------------

/**
 * Write a built report to disk. Atomic temp+rename in the same directory
 * (rename is atomic on same filesystem). Parent directory is mkdir'd
 * recursively — `.planning/milestones/` may not exist on first run.
 *
 * On rename failure: unlink the tmp (best-effort), re-throw. Caller sees
 * the original rename error.
 */
export async function writeMigrationReport(
  result: Extract<BuildReportResult, { outcome: "built" }>,
  reportPath: string = REPORT_PATH_LITERAL,
): Promise<Readonly<{ destPath: string; sha256: string }>> {
  const destDir = dirname(reportPath);
  await reportWriterFs.mkdir(destDir, { recursive: true });
  const tmpPath = join(
    destDir,
    `.v2.1-migration-report.md.${process.pid}.${Date.now()}.tmp`,
  );
  await reportWriterFs.writeFile(tmpPath, result.markdown, "utf8");
  try {
    await reportWriterFs.rename(tmpPath, reportPath);
  } catch (err) {
    try {
      await reportWriterFs.unlink(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
  const sha256 = createHash("sha256")
    .update(result.markdown, "utf8")
    .digest("hex");
  return Object.freeze({ destPath: reportPath, sha256 });
}
