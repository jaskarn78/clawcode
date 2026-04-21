/**
 * `clawcode migrate openclaw <sub>` CLI command module.
 *
 * Subcommands (all read-side + dry-run):
 *   - `list` — table of every active OpenClaw agent + ledger-tracked status.
 *     Writes nothing.
 *   - `plan` — per-agent diff + SHA256 hash + ledger bootstrap. Writes ONLY
 *     to `.planning/migration/ledger.jsonl` (and its parent dir on first run).
 *   - `plan --agent <name>` — scoped plan for a single agent. Unknown name
 *     emits actionable error on stderr + exits 1.
 *
 * Zero-write contract (asserted in `__tests__/migrate-openclaw.test.ts`):
 *   - NO writes to `~/.clawcode/` during list or plan.
 *   - NO writes to `clawcode.yaml` during list or plan.
 *   - NO writes to the source `~/.openclaw/` tree EVER (non-destructive to
 *     source per v2.1 roadmap).
 *
 * Env-var overrides (for test isolation — downstream Phases 77-82 reuse):
 *   - CLAWCODE_OPENCLAW_JSON     → source-of-truth openclaw.json path
 *   - CLAWCODE_OPENCLAW_MEMORY_DIR → per-agent sqlite dir
 *   - CLAWCODE_AGENTS_ROOT       → target clawcode agents root
 *   - CLAWCODE_LEDGER_PATH       → ledger JSONL path
 *
 * DO NOT:
 *   - Use the global `console` namespace — always cliLog / cliError.
 *   - Add chalk / picocolors / cli-table3 — zero new deps constraint.
 *   - Write anywhere except ledgerPath in these action handlers.
 */
import type { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cliLog, cliError, green, yellow, red, dim } from "../output.js";
import { translateAgentMemories } from "../../migration/memory-translator.js";
import { MemoryStore } from "../../memory/store.js";
import { EmbeddingService } from "../../memory/embedder.js";
import {
  readOpenclawInventory,
  type OpenclawSourceInventory,
} from "../../migration/openclaw-config-reader.js";
import {
  readChunkCount,
  getMemorySqlitePath,
  type ChunkCountResult,
} from "../../migration/source-memory-reader.js";
import {
  buildPlan,
  type AgentPlan,
  type PlanReport,
  type PlanWarning,
} from "../../migration/diff-builder.js";
import {
  appendRow,
  latestStatusByAgent,
  DEFAULT_LEDGER_PATH,
  type LedgerRow,
} from "../../migration/ledger.js";
import { runApplyPreflight } from "../../migration/apply-preflight.js";
import {
  installFsGuard,
  uninstallFsGuard,
} from "../../migration/fs-guard.js";
import {
  parseModelMapFlag,
  mergeModelMap,
  DEFAULT_MODEL_MAP,
} from "../../migration/model-map.js";
import {
  mapAgent,
  type MapAgentWarning,
} from "../../migration/config-mapper.js";
import { writeClawcodeYaml } from "../../migration/yaml-writer.js";
import { copyAgentWorkspace } from "../../migration/workspace-copier.js";
import { archiveOpenclawSessions } from "../../migration/session-archiver.js";
import { loadConfig } from "../../config/loader.js";
import type { OpenclawSourceEntry } from "../../migration/openclaw-config-reader.js";
import {
  verifyAgent as verifyAgentModule,
  computeVerifyExitCode,
  type VerifyCheckResult,
} from "../../migration/verifier.js";
import {
  rollbackAgent as rollbackAgentModule,
  SourceCorruptionError,
  type RollbackResult,
} from "../../migration/rollbacker.js";
// Phase 82 Plan 02 — pilot-highlight + cutover + complete wiring.
// pilot-selector exports are PURE (no I/O); cutover + report-writer are
// late-bound through the migrateOpenclawHandlers dispatch holder so tests
// can swap implementations without rebinding ESM frozen bindings.
import {
  pickPilot,
  formatPilotLine,
} from "../../migration/pilot-selector.js";
import { cutoverAgent as cutoverAgentModule } from "../../migration/cutover.js";
import {
  buildMigrationReport as buildMigrationReportModule,
  writeMigrationReport as writeMigrationReportModule,
} from "../../migration/report-writer.js";

/**
 * Phase 77-03 literal: was printed to stderr on the all-guards-pass path of
 * `apply` while Phase 77 had no write body. Phase 78 Plan 03 replaced the
 * stub with the real write pipeline; this constant remains EXPORTED for
 * backward-compat with any external tooling that grepped for the literal.
 *
 * @deprecated Phase 78 Plan 03 lands the real apply body. This message is
 * no longer emitted on the success path.
 */
export const APPLY_NOT_IMPLEMENTED_MESSAGE =
  "apply not implemented — pre-flight guards only in Phase 77";

const DEFAULT_OPENCLAW_JSON = join(homedir(), ".openclaw", "openclaw.json");
const DEFAULT_OPENCLAW_MEMORY_DIR = join(homedir(), ".openclaw", "memory");
const DEFAULT_OPENCLAW_ROOT = join(homedir(), ".openclaw");
const DEFAULT_CLAWCODE_AGENTS_ROOT = join(homedir(), ".clawcode", "agents");

/**
 * Phase 80 Plan 03 — CLI-local embedder singleton for the migrate-openclaw
 * process. The CLI is a DIFFERENT process from the daemon; the daemon has
 * its own `EmbeddingService` in `manager/session-memory.ts`. The
 * singleton-invariant test in `daemon-warmup-probe.test.ts` has been
 * updated to whitelist BOTH construction sites — CLI + daemon are
 * independent entrypoints that each need their own embedder.
 *
 * Lazy init on first use. The embedder's first `embed()` triggers ONNX
 * warmup (~200ms cold-start, ~23MB model download if not cached); all
 * subsequent embeds reuse the warmed pipeline.
 *
 * Tests that inject a mock translator via `migrateOpenclawHandlers.
 * translateAgentMemories` never reach this code path — the mock returns
 * without ever calling `embedder.embed()`. `_resetMigrationEmbedderForTests`
 * is exported so integration tests that DO exercise the real translator
 * can reset the singleton between runs.
 */
let _migrationEmbedder: EmbeddingService | null = null;
export function getMigrationEmbedder(): EmbeddingService {
  if (_migrationEmbedder === null) {
    _migrationEmbedder = new EmbeddingService();
  }
  return _migrationEmbedder;
}
export function _resetMigrationEmbedderForTests(): void {
  _migrationEmbedder = null;
}

// --- Pure formatters (testable in isolation) -------------------------

type ListRow = {
  readonly name: string;              // agent id
  readonly sourcePath: string;        // workspace path
  readonly memories: string;          // "878" or "—" for missing
  readonly mcpCount: string;          // "0" reserved for Phase 78
  readonly channel: string;           // channel id or "—"
  readonly status: string;            // from ledger or "pending" if absent
};

export function formatListTable(rows: readonly ListRow[]): string {
  if (rows.length === 0) return "No active OpenClaw agents found.";
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));
  const pathW = Math.max(11, ...rows.map((r) => r.sourcePath.length));
  const memW = Math.max(8, ...rows.map((r) => r.memories.length));
  const mcpW = Math.max(5, ...rows.map((r) => r.mcpCount.length));
  const chW = Math.max(18, ...rows.map((r) => r.channel.length));
  const stW = Math.max(6, ...rows.map((r) => r.status.length));
  const header = [
    "NAME".padEnd(nameW),
    "SOURCE PATH".padEnd(pathW),
    "MEMORIES".padEnd(memW),
    "MCP".padEnd(mcpW),
    "DISCORD CHANNEL".padEnd(chW),
    "STATUS".padEnd(stW),
  ].join("  ");
  const sep = "-".repeat(nameW + pathW + memW + mcpW + chW + stW + 10);
  const body = rows.map((r) =>
    [
      r.name.padEnd(nameW),
      r.sourcePath.padEnd(pathW),
      r.memories.padEnd(memW),
      r.mcpCount.padEnd(mcpW),
      r.channel.padEnd(chW),
      r.status.padEnd(stW),
    ].join("  "),
  );
  return [header, sep, ...body].join("\n");
}

export function renderWarnings(warnings: readonly PlanWarning[]): string {
  if (warnings.length === 0) return "";
  const lines = warnings.map((w) => {
    const color =
      w.kind === "unknown-agent-filter" ? red :
      w.kind === "missing-discord-binding" ? yellow :
      w.kind === "empty-source-memory" ? yellow :
      w.kind === "source-db-no-chunks-table" ? yellow :
      // Phase 78 CONF-02/CONF-03 soft warnings — yellow per CONTEXT.
      w.kind === "unknown-mcp-server" ? yellow :
      w.kind === "unmappable-model" ? yellow :
      dim;
    const detail = w.detail ? ` (${w.detail})` : "";
    return color(`  ! ${w.kind}: ${w.agent}${detail}`);
  });
  return "Warnings:\n" + lines.join("\n");
}

export function formatPlanOutput(report: PlanReport): string {
  const legend =
    dim("Legend: ") + green("new") + dim(" | ") + yellow("warning") + dim(" | ") + red("conflict");
  const header = dim(`Source:      ${report.sourcePath}`);
  const target = dim(`Target root: ${report.targetRoot}`);
  const agentBlocks = report.agents.map((a) => formatAgentPlan(a));
  const warningsBlock = renderWarnings(report.warnings);
  const hash = dim(`Plan hash: ${report.planHash}`);
  const parts: string[] = [legend, header, target, "", ...agentBlocks];
  if (warningsBlock) parts.push("", warningsBlock);
  parts.push("", hash);
  return parts.join("\n");
}

function formatAgentPlan(a: AgentPlan): string {
  const famMark = a.isFinmentumFamily ? yellow(" [finmentum-shared]") : "";
  const head = green(a.sourceId) + dim(` -> `) + a.targetBasePath + famMark;
  const rows = [
    `  source workspace:  ${a.sourceWorkspace}`,
    `  target basePath:   ${a.targetBasePath}`,
    `  target memoryPath: ${a.targetMemoryPath}${a.isFinmentumFamily ? dim("  (per-agent within shared basePath)") : ""}`,
    `  source model:      ${a.sourceModel}`,
    `  memories:          ${a.memoryChunkCount} (${a.memoryStatus})`,
    `  discord channel:   ${a.discordChannelId ?? yellow("- (no binding)")}`,
  ];
  return [head, ...rows].join("\n");
}

// --- Action handlers ------------------------------------------------

type Paths = {
  readonly openclawJson: string;
  readonly openclawMemoryDir: string;
  readonly clawcodeAgentsRoot: string;
  readonly ledgerPath: string;
  // Phase 77-03 addition — the user's existing clawcode.yaml path for the
  // channel-collision guard. Defaults to the repo-relative cwd resolution.
  readonly clawcodeConfigPath: string;
  // Phase 79 Plan 03 additions:
  // - openclawRoot: source-side root under which per-agent workspace-<id>/
  //   directories live. Defaults to `${homedir}/.openclaw`.
  // - workspaceTargetRoot: where copied workspaces land. Defaults to the
  //   same clawcodeAgentsRoot the YAML writer uses so YAML workspace: paths
  //   and on-disk tree agree. Kept as a separate env-var so future phases
  //   can split config root from workspace root without a schema change.
  readonly openclawRoot: string;
  readonly workspaceTargetRoot: string;
};

function resolvePaths(): Paths {
  const clawcodeAgentsRoot =
    process.env.CLAWCODE_AGENTS_ROOT ?? DEFAULT_CLAWCODE_AGENTS_ROOT;
  return {
    openclawJson: process.env.CLAWCODE_OPENCLAW_JSON ?? DEFAULT_OPENCLAW_JSON,
    openclawMemoryDir: process.env.CLAWCODE_OPENCLAW_MEMORY_DIR ?? DEFAULT_OPENCLAW_MEMORY_DIR,
    clawcodeAgentsRoot,
    ledgerPath: process.env.CLAWCODE_LEDGER_PATH ?? resolve(DEFAULT_LEDGER_PATH),
    clawcodeConfigPath:
      process.env.CLAWCODE_CONFIG_PATH ?? resolve("clawcode.yaml"),
    openclawRoot: process.env.CLAWCODE_OPENCLAW_ROOT ?? DEFAULT_OPENCLAW_ROOT,
    workspaceTargetRoot:
      process.env.CLAWCODE_WORKSPACE_TARGET_ROOT ?? clawcodeAgentsRoot,
  };
}

async function gatherChunkCounts(
  inventory: OpenclawSourceInventory,
  memoryDir: string,
): Promise<Map<string, ChunkCountResult>> {
  const map = new Map<string, ChunkCountResult>();
  for (const agent of inventory.agents) {
    const p = getMemorySqlitePath(agent.id, memoryDir);
    map.set(agent.id, readChunkCount(p));
  }
  return map;
}

export async function runListAction(): Promise<void> {
  const paths = resolvePaths();
  const inventory = await readOpenclawInventory(paths.openclawJson);
  const chunkCounts = await gatherChunkCounts(inventory, paths.openclawMemoryDir);
  const statusMap = await latestStatusByAgent(paths.ledgerPath);
  const rows: ListRow[] = inventory.agents.map((a) => {
    const c = chunkCounts.get(a.id);
    const memories = !c || c.missing ? "—" : String(c.count);
    return {
      name: a.id,
      sourcePath: a.workspace,
      memories,
      mcpCount: "0", // reserved — Phase 78 will populate
      channel: a.discordChannelId ?? "—",
      status: statusMap.get(a.id) ?? "pending",
    };
  });
  cliLog(formatListTable(rows));
}

export async function runPlanAction(opts: {
  agent?: string;
  // Plan 02 plumbs this through; Plan 03's yaml-writer will consume it.
  modelMap?: Record<string, string>;
}): Promise<number> {
  // Plan 03 consumes modelMap. Currently plumbed through for test coverage
  // of the flag wiring; buildPlan does not yet use it (writer is Plan 03).
  const _modelMap = opts.modelMap ?? {};
  void _modelMap;
  const paths = resolvePaths();
  const inventory = await readOpenclawInventory(paths.openclawJson);
  const chunkCounts = await gatherChunkCounts(inventory, paths.openclawMemoryDir);
  const report = buildPlan({
    inventory,
    chunkCounts,
    clawcodeAgentsRoot: paths.clawcodeAgentsRoot,
    targetFilter: opts.agent,
  });
  cliLog(formatPlanOutput(report));

  // --agent <name> with unknown id: emit actionable error on stderr AND exit 1.
  const unknownFilter = report.warnings.find((w) => w.kind === "unknown-agent-filter");
  if (unknownFilter) {
    const available = inventory.agents.map((a) => a.id).join(", ");
    cliError(`Unknown OpenClaw agent: '${unknownFilter.agent}'. Available: ${available}`);
    return 1;
  }

  // Phase 82 OPS-01 — pilot-highlight. Append a single line AFTER the main
  // plan output so the operator reads the recommendation last. Only emit
  // when:
  //   - the operator did NOT filter to a single agent (`--agent` sets
  //     opts.agent to a defined string — skip pilot in that branch because
  //     the operator has already committed to one agent), AND
  //   - the plan has at least one agent (empty inventory → nothing to pick).
  //
  // mcpCounts is derived from the openclaw source entry's tools.mcp shape
  // via the existing extractPerAgentMcpNames helper. Defensive: if the
  // source lookup returns undefined (shouldn't happen given buildPlan
  // derives agents FROM the inventory), treat mcpCount as 0.
  if (opts.agent === undefined && report.agents.length >= 1) {
    const mcpCounts = new Map<string, number>(
      report.agents.map((a) => {
        const src = inventory.agents.find((s) => s.id === a.sourceId);
        const count = src ? extractPerAgentMcpNames(src).length : 0;
        return [a.sourceId, count] as const;
      }),
    );
    const pilot = pickPilot(report.agents, mcpCounts);
    if (pilot) {
      cliLog(formatPilotLine(pilot.winner, pilot.reason));
    }
  }

  // Ledger bootstrap: append one row per planned agent.
  // Idempotency: if a non-"pending" status already exists, emit a "re-planned"
  // row; else "pending". Snapshot existing status BEFORE the loop so the
  // first new "pending" row doesn't flip subsequent agents to "re-planned"
  // within the same plan invocation.
  const ts = new Date().toISOString();
  const existingStatus = await latestStatusByAgent(paths.ledgerPath);
  for (const agent of report.agents) {
    const prior = existingStatus.get(agent.sourceId);
    const row: LedgerRow = {
      ts,
      action: "plan",
      agent: agent.sourceId,
      status: prior === undefined ? "pending" : "re-planned",
      source_hash: report.planHash.slice(0, 16), // short prefix — per-agent digest deferred to Phase 77
      target_hash: report.planHash,
      notes: prior === undefined ? "initial plan" : `re-plan over status=${prior}`,
    };
    await appendRow(paths.ledgerPath, row);
  }
  return 0;
}

/**
 * Phase 79 Plan 03 — resolve the workspace-copy plan for a single agent.
 *
 * Finmentum family source layout (verified on-box 2026-04-20):
 *   - workspace-finmentum/                  — primary, has SOUL/IDENTITY +
 *                                             memory/ + .learnings/ + archive/
 *   - workspace-finmentum-content-creator/  — dedicated, own SOUL/IDENTITY
 *   - workspace-fin-acquisition/            — only uploads/
 *   - workspace-fin-research/               — only uploads/
 *   - workspace-fin-playground/             — only uploads/
 *   - workspace-fin-tax/                    — only uploads/
 *
 * Resolution rules (uniform — no finmentum-only branch needed at this layer;
 * we rely entirely on on-disk shape):
 *   1. Source dir missing entirely → skip with reason (no rollback, not an
 *      error — sub-agents without recorded content inherit shared files).
 *   2. SOUL.md present → full-workspace copy to targetBasePath. This handles
 *      both non-finmentum agents (dedicated workspace) and finmentum
 *      primary/content-creator (shared basePath for the family, per-agent
 *      soulFile/identityFile paths set by Phase 78 config-mapper).
 *   3. No SOUL.md but uploads/ present → uploads-only mode: copy only
 *      `<source>/uploads` to `<targetBasePath>/uploads/<agentId>/`. Covers
 *      finmentum sub-agents whose workspace contains only an uploads dir.
 *   4. Neither SOUL.md nor uploads/ → skip with reason (empty source).
 *
 * Note on finmentum primary-vs-content-creator SOUL collision: both have
 * SOUL.md and target the same shared basePath. Phase 78 config-mapper
 * produces soulFile=<shared>/SOUL.md for BOTH agents by design (they share
 * persona per the roadmap D-Finmentum decision). Iteration order determines
 * last-write-wins; `openclaw-config-reader.readOpenclawInventory` sorts
 * agents by id alphabetically, so `finmentum` (primary) sorts before
 * `finmentum-content-creator` — content-creator's SOUL.md overwrites the
 * primary's. If this collision ever becomes semantically important, Phase
 * 81 can introduce per-agent SOUL.<id>.md naming.
 */
export type WorkspaceCopyPlan =
  | { readonly mode: "full"; readonly source: string; readonly target: string }
  | { readonly mode: "uploads-only"; readonly source: string; readonly target: string }
  | { readonly mode: "skip-empty-source"; readonly reason: string }
  // 82.4: shared-basePath sibling — skip WORKSPACE COPY (already populated
  // by prior sibling) but STILL run memory translation against the shared
  // target. Each sibling gets its own memoryPath with independent memory.
  | { readonly mode: "skip-copy-shared"; readonly target: string; readonly reason: string };

export function resolveWorkspaceCopyPlan(
  sourceWorkspace: string,
  targetBasePath: string,
  agentId: string,
): WorkspaceCopyPlan {
  if (!existsSync(sourceWorkspace)) {
    return {
      mode: "skip-empty-source",
      reason: `source workspace not found: ${sourceWorkspace}`,
    };
  }
  const hasSoul = existsSync(join(sourceWorkspace, "SOUL.md"));
  if (hasSoul) {
    // 82.3 gap closure: if target already has SOUL.md, the shared-basePath
    // was already populated by a prior sibling agent in the finmentum
    // family. Skip the full copy — re-running fs.cp against an already-
    // populated target breaks on absolute-symlinks pointing outside the
    // workspace (e.g. `tmp -> /tmp` in workspace-finmentum).
    if (existsSync(join(targetBasePath, "SOUL.md"))) {
      return {
        mode: "skip-copy-shared",
        target: targetBasePath,
        reason: `target basePath already populated by sibling agent (shared workspace): ${targetBasePath}`,
      };
    }
    return {
      mode: "full",
      source: sourceWorkspace,
      target: targetBasePath,
    };
  }
  const uploadsSrc = join(sourceWorkspace, "uploads");
  if (existsSync(uploadsSrc)) {
    return {
      mode: "uploads-only",
      source: uploadsSrc,
      target: join(targetBasePath, "uploads", agentId),
    };
  }
  return {
    mode: "skip-empty-source",
    reason: `no SOUL.md and no uploads/ at ${sourceWorkspace}`,
  };
}

/**
 * Phase 78 Plan 03 apply action handler — full end-to-end pipeline:
 *   1. Read openclaw.json + build plan (Phase 76 diff-builder).
 *   2. --only <unknown> fail-fast (no ledger side-effects).
 *   3. Load existing clawcode.yaml top-level mcpServers for Plan 02 mapper.
 *   4. Merge DEFAULT_MODEL_MAP + --model-map overrides.
 *   5. Call mapAgent per planned agent → MappedAgentNode[] + warnings.
 *   6. Install fs-guard (Phase 77 MIGR-07 belt-and-suspenders).
 *   7. Run 4 pre-flight guards (Phase 77 orchestrator). Refuse short-circuits.
 *   8. Call writeClawcodeYaml (atomic temp+rename, comment preservation,
 *      pre-write secret scan, unmappable-model gate).
 *   9. Append ledger witness row {step:"write", outcome:"allow"|"refuse",
 *      file_hashes:{"clawcode.yaml": sha256}, status:"migrated"|"pending"}.
 *  10. Uninstall fs-guard in finally.
 *
 * `deps.execaRunner` is the DI hook for tests to control systemctl output
 * without spawning a real subprocess. Commander passes `{}` for deps; tests
 * pass a mocked runner.
 */
export async function runApplyAction(
  opts: {
    only?: string;
    modelMap?: Record<string, string>;
  },
  deps: {
    execaRunner?: (
      cmd: string,
      args: string[],
    ) => Promise<{ stdout: string; exitCode: number | null }>;
  } = {},
): Promise<number> {
  const paths = resolvePaths();
  const inventory = await readOpenclawInventory(paths.openclawJson);
  const chunkCounts = await gatherChunkCounts(inventory, paths.openclawMemoryDir);
  const report = buildPlan({
    inventory,
    chunkCounts,
    clawcodeAgentsRoot: paths.clawcodeAgentsRoot,
    targetFilter: opts.only,
  });

  // --only <unknown>: surfaces as a PlanWarning (diff-builder invariant).
  // Fail-fast with actionable stderr, no ledger side-effects.
  const unknownFilter = report.warnings.find(
    (w) => w.kind === "unknown-agent-filter",
  );
  if (unknownFilter) {
    const available = inventory.agents.map((a) => a.id).join(", ");
    cliError(
      `Unknown OpenClaw agent: '${unknownFilter.agent}'. Available: ${available}`,
    );
    return 1;
  }

  // --- Load existing top-level mcpServers (for config-mapper lookup) ---
  // Tolerates missing or unreadable file — writer itself gates on
  // file-not-found with its own refuse reason.
  const existingConfig = await loadExistingClawcodeYaml(paths.clawcodeConfigPath);
  const existingTopLevelMcp = new Set(
    Object.keys(existingConfig?.mcpServers ?? {}),
  );

  // --- Merge model map (DEFAULT + --model-map overrides) ---
  const finalModelMap = mergeModelMap(DEFAULT_MODEL_MAP, opts.modelMap ?? {});

  // --- Map each planned agent (pure — no I/O) ---
  const mapResults = report.agents.map((agentPlan) => {
    const source = inventory.agents.find((a) => a.id === agentPlan.sourceId);
    if (!source)
      throw new Error(
        `internal error: planned agent ${agentPlan.sourceId} not in inventory`,
      );
    return mapAgent({
      source,
      targetBasePath: agentPlan.targetBasePath,
      targetMemoryPath: agentPlan.targetMemoryPath,
      modelMap: finalModelMap,
      existingTopLevelMcp,
      perAgentMcpNames: extractPerAgentMcpNames(source),
    });
  });
  const agentsToInsert = mapResults.map((r) => r.node);
  const allMapWarnings: MapAgentWarning[] = mapResults.flatMap(
    (r) => r.warnings as MapAgentWarning[],
  );

  // --- fs-guard install (Phase 77 MIGR-07) ---
  installFsGuard();
  try {
    const result = await runApplyPreflight({
      inventory,
      report,
      existingConfigPath: paths.clawcodeConfigPath,
      ledgerPath: paths.ledgerPath,
      sourceHash: report.planHash,
      filter: opts.only,
      execaRunner: deps.execaRunner,
    });
    if (result.exitCode !== 0 && result.firstRefusal) {
      cliError(result.firstRefusal.message);
      if (result.firstRefusal.reportBody) {
        cliError("\n" + result.firstRefusal.reportBody);
      }
      return 1;
    }

    // --- Phase 78 Plan 03: write clawcode.yaml ---
    const writeResult = await writeClawcodeYaml({
      existingConfigPath: paths.clawcodeConfigPath,
      agentsToInsert,
      modelMapWarnings: allMapWarnings,
    });

    if (writeResult.outcome === "refused") {
      await appendRow(paths.ledgerPath, {
        ts: new Date().toISOString(),
        action: "apply",
        agent: opts.only ?? "ALL",
        status: "pending",
        source_hash: report.planHash,
        step: "write",
        outcome: "refuse",
        notes: `${writeResult.step}: ${writeResult.reason}`,
      });
      cliError(writeResult.reason);
      return 1;
    }

    // Success witness row — CONF-04 / MIGR-06. Carries file_hashes for
    // forensic verification (operator can `sha256sum clawcode.yaml` and
    // compare to the recorded witness).
    await appendRow(paths.ledgerPath, {
      ts: new Date().toISOString(),
      action: "apply",
      agent: opts.only ?? "ALL",
      status: "migrated",
      source_hash: report.planHash,
      target_hash: writeResult.targetSha256,
      step: "write",
      outcome: "allow",
      file_hashes: { "clawcode.yaml": writeResult.targetSha256 },
      notes: `wrote ${agentsToInsert.length} agent(s) to ${writeResult.destPath}`,
    });
    cliLog(
      green(
        `✓ wrote ${agentsToInsert.length} agent(s) to ${writeResult.destPath}`,
      ),
    );

    // --- Phase 79 WORK-01..05 — workspace copy + session archive per agent ---
    // Sequential (no Promise.all) per 79-CONTEXT embedder-singleton non-
    // reentrancy constraint (carries forward to Phase 80). Per-agent rollback
    // on hash-witness failure — one agent's rollback does NOT cascade; other
    // agents in the run proceed. Final exit code is 1 if ANY agent rolled
    // back; 0 otherwise. A skip-empty-source branch is NOT a failure — it's
    // the normal path for finmentum sub-agents whose workspace lacks SOUL.md.
    //
    // Ordering rule (load-bearing for finmentum shared basePath): process
    // "full"-mode copies BEFORE "uploads-only" copies. Rationale: multiple
    // agents may target the same basePath (finmentum family); the primary
    // full-workspace copy must land first, then sub-agents' uploads/ trees
    // are added additively. If uploads-only agents ran first, the primary's
    // post-copy sweep would walk over the sub-agents' upload files and
    // attempt to hash-witness them against a non-existent source path
    // (the primary's source has no matching uploads/<id>/ entries).
    // "skip-empty-source" agents have no ordering impact — they don't
    // touch the filesystem beyond a ledger witness row.
    const copyPlansByAgent: Array<{
      readonly agentPlan: AgentPlan;
      readonly copyPlan: WorkspaceCopyPlan;
    }> = report.agents.map((agentPlan) => ({
      agentPlan,
      copyPlan: resolveWorkspaceCopyPlan(
        agentPlan.sourceWorkspace,
        agentPlan.targetBasePath,
        agentPlan.sourceId,
      ),
    }));
    const modeRank = (m: WorkspaceCopyPlan["mode"]): number =>
      m === "full" ? 0 : m === "uploads-only" ? 1 : m === "skip-copy-shared" ? 2 : 3;
    const sortedCopyPlans = [...copyPlansByAgent].sort((a, b) => {
      const rankDiff = modeRank(a.copyPlan.mode) - modeRank(b.copyPlan.mode);
      if (rankDiff !== 0) return rankDiff;
      // Within the same mode, preserve inventory order (alphabetical by id)
      // so the overall processing order is deterministic.
      return a.agentPlan.sourceId.localeCompare(b.agentPlan.sourceId);
    });

    const workspaceFailures: string[] = [];
    for (const { agentPlan, copyPlan } of sortedCopyPlans) {
      if (copyPlan.mode === "skip-empty-source") {
        // Normal path for sub-agents with no on-disk workspace content.
        // Record the skip so the ledger has a witness trail per agent.
        await appendRow(paths.ledgerPath, {
          ts: new Date().toISOString(),
          action: "apply",
          agent: agentPlan.sourceId,
          status: "pending",
          source_hash: report.planHash,
          step: "workspace-copy:skip",
          outcome: "allow",
          notes: copyPlan.reason,
        });
      } else if (copyPlan.mode === "skip-copy-shared") {
        // 82.4: shared-basePath sibling — target already populated by a
        // prior sibling. Skip the workspace copy but continue to memory
        // translation below (each sibling writes its own memories.db into
        // its distinct per-agent memoryPath).
        await appendRow(paths.ledgerPath, {
          ts: new Date().toISOString(),
          action: "apply",
          agent: agentPlan.sourceId,
          status: "pending",
          source_hash: report.planHash,
          step: "workspace-copy:skip-shared",
          outcome: "allow",
          notes: copyPlan.reason,
        });
      } else {
        const copyResult = await copyAgentWorkspace({
          agentId: agentPlan.sourceId,
          source: copyPlan.source,
          target: copyPlan.target,
          ledgerPath: paths.ledgerPath,
          sourceHash: report.planHash,
        });
        if (!copyResult.pass) {
          workspaceFailures.push(agentPlan.sourceId);
          cliError(
            red(
              `✗ workspace-copy failed for ${agentPlan.sourceId}: ${copyResult.hashMismatches.length} hash mismatch(es); rolled back`,
            ),
          );
          // Do NOT invoke archiveOpenclawSessions for a rolled-back agent —
          // the target tree is gone; archive would land in a resurrected dir
          // that wasn't fully populated. Continue to the next agent.
          continue;
        }
      }

      // Archive OpenClaw sessions for this agent. The archiver handles
      // missing source gracefully (skip row + pass:true), so we invoke it
      // uniformly whether the workspace copy was full, uploads-only, or
      // skipped-empty-source (in which case agentDir may also be missing —
      // archiver's own existsSync short-circuit handles that).
      await archiveOpenclawSessions({
        agentId: agentPlan.sourceId,
        sourceAgentDir: agentPlan.sourceAgentDir,
        targetBasePath: agentPlan.targetBasePath,
        ledgerPath: paths.ledgerPath,
        sourceHash: report.planHash,
      });

      // --- Phase 80 Plan 03 — memory translation per agent ---
      //
      // Reads target-workspace markdown (MEMORY.md + memory/*.md +
      // .learnings/*.md) and upserts memories via MemoryStore.insert()
      // with origin_id UNIQUE idempotency (Plan 01). The translator is
      // invoked through `migrateOpenclawHandlers.translateAgentMemories`
      // so unit tests can inject a mock without exercising ONNX.
      //
      // Skipped when:
      //   - copyPlan was skip-empty-source (continue'd earlier; target
      //     tree never existed, no markdown to read)
      //   - workspace-copy rolled back (continue'd earlier; target tree
      //     is gone, nothing to read)
      //
      // Non-fatal: a translator throw records a refuse ledger row and
      // counts toward workspaceFailures (exit 1), but other agents in
      // this run still proceed — matches the workspace-copy failure
      // semantics and preserves forensic completeness.
      if (copyPlan.mode !== "skip-empty-source") {
        const memDir = join(agentPlan.targetMemoryPath, "memory");
        if (!existsSync(memDir)) {
          mkdirSync(memDir, { recursive: true });
        }
        const dbPath = join(memDir, "memories.db");
        const store = new MemoryStore(dbPath);
        try {
          const embedder = getMigrationEmbedder();
          // 82.4: skip-copy-shared uses the shared target (already
          // populated by prior sibling) as the workspace source for
          // translation. Other modes use copyPlan.target (just-copied).
          const translateWorkspace =
            copyPlan.mode === "skip-copy-shared"
              ? copyPlan.target
              : copyPlan.target;
          // 82.5: pass OpenClaw per-agent sqlite path so entity/fact
          // memories stored only in sqlite (not workspace markdown) are
          // also re-embedded. sqlite lives at
          // <dirname(openclawJson)>/memory/<agentId>.sqlite
          // per OpenClaw's layout.
          const openclawMemoryDir = join(
            dirname(paths.openclawJson),
            "memory",
          );
          const openclawSqlitePath = getMemorySqlitePath(
            agentPlan.sourceId,
            openclawMemoryDir,
          );
          const result = await migrateOpenclawHandlers.translateAgentMemories({
            agentId: agentPlan.sourceId,
            targetWorkspace: translateWorkspace,
            memoryPath: agentPlan.targetMemoryPath,
            store,
            embedder,
            sourceHash: report.planHash,
            openclawSqlitePath,
          });
          for (const row of result.ledgerRows) {
            await appendRow(paths.ledgerPath, row);
          }
          // 82.7: terminal "migrated" status row — cutover's ledger guard
          // checks latestStatusByAgent for this state. Without it, cutover
          // refuses even after successful apply.
          await appendRow(paths.ledgerPath, {
            ts: new Date().toISOString(),
            action: "apply",
            agent: agentPlan.sourceId,
            status: "migrated",
            source_hash: report.planHash,
            step: "apply:complete",
            outcome: "allow",
            notes: `markdown+sqlite memories: upserted=${result.upserted} skipped=${result.skipped}`,
          });
          cliLog(
            green(
              `\u2713 ${agentPlan.sourceId}: upserted ${result.upserted}, skipped ${result.skipped}`,
            ),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await appendRow(paths.ledgerPath, {
            ts: new Date().toISOString(),
            action: "apply",
            agent: agentPlan.sourceId,
            status: "pending",
            source_hash: report.planHash,
            step: "memory-translate:error",
            outcome: "refuse",
            notes: `translator threw: ${msg}`,
          });
          workspaceFailures.push(agentPlan.sourceId);
          cliError(
            red(
              `\u2717 memory-translate failed for ${agentPlan.sourceId}: ${msg}`,
            ),
          );
        } finally {
          store.close();
        }
      }
    }

    if (workspaceFailures.length > 0) {
      cliError(
        red(
          `${workspaceFailures.length} agent(s) rolled back: ${workspaceFailures.join(", ")}`,
        ),
      );
      return 1;
    }

    cliLog(
      green(
        `✓ workspace migration complete for ${report.agents.length} agent(s)`,
      ),
    );
    return 0;
  } finally {
    uninstallFsGuard();
  }
}

/**
 * Load existing clawcode.yaml for top-level mcpServers lookup. Tolerates
 * missing or unreadable file (writer's own file-not-found gate will refuse
 * the apply with a clearer reason in that branch).
 */
async function loadExistingClawcodeYaml(
  path: string,
): Promise<Awaited<ReturnType<typeof loadConfig>> | null> {
  try {
    return await loadConfig(path);
  } catch {
    return null;
  }
}

/**
 * Extract per-agent MCP server names from an OpenclawSourceEntry. OpenClaw's
 * tools.mcp shape is `unknown` per schema (deliberate pass-through in
 * Phase 76); read cautiously. Phase 78 scope is minimal key-name extraction;
 * Phase 82 may refine if richer parsing is needed.
 */
function extractPerAgentMcpNames(
  source: OpenclawSourceEntry,
): readonly string[] {
  const tools = source.tools;
  if (tools === null || tools === undefined || typeof tools !== "object") {
    return [];
  }
  const mcp = (tools as { mcp?: unknown }).mcp;
  if (!mcp || typeof mcp !== "object") return [];
  return Object.keys(mcp as Record<string, unknown>);
}

// --- Phase 81 Plan 02 — verify + rollback action handlers -----------

/**
 * Status emoji literals per 81-CONTEXT — load-bearing, grep-verifiable.
 * Do NOT substitute ASCII equivalents; the CONTEXT pins these exact
 * Unicode codepoints (✅ U+2705, ❌ U+274C, ⏭ U+23ED) and downstream
 * tests grep for them verbatim.
 */
export const VERIFY_STATUS_EMOJI = Object.freeze({
  pass: "✅",
  fail: "❌",
  skip: "⏭",
} as const);

/**
 * Pure formatter — renders verify results as an aligned-column table
 * with one "Agent: <name>" block per agent, separated by a blank line.
 * Mirrors the padEnd column-width calculation used by formatListTable
 * (Phase 76) and formatCostsTable (Phase 74) — no cli-table3 dep.
 */
export function formatVerifyTable(
  perAgent: readonly {
    readonly agent: string;
    readonly results: readonly VerifyCheckResult[];
  }[],
): string {
  if (perAgent.length === 0) return "No agents to verify.";
  const blocks: string[] = [];
  for (const { agent, results } of perAgent) {
    const header = `Agent: ${agent}`;
    const colHead = ["Check", "Status", "Detail"];
    const rows: string[][] = results.map((r) => [
      r.check,
      VERIFY_STATUS_EMOJI[r.status],
      r.detail,
    ]);
    const all: string[][] = [colHead, ...rows];
    // Column widths: max of header + any cell in that column. Emoji width
    // is the JS string-length of the single codepoint; pad matches the
    // visual alignment on monospace terminals well enough for forensic
    // scanning (CLI isn't a UI — we optimize for grep-verifiable output,
    // not perfect Unicode monospace rendering).
    const widths = colHead.map((_, c) =>
      Math.max(...all.map((row) => (row[c] ?? "").length)),
    );
    const fmt = (row: readonly string[]): string =>
      row.map((cell, c) => cell.padEnd(widths[c]!)).join(" | ");
    const sep = widths.map((w) => "-".repeat(w)).join("-|-");
    blocks.push([header, fmt(colHead), sep, ...rows.map(fmt)].join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * `clawcode migrate openclaw verify [agent]` action handler.
 *
 * Without agent: iterates every agent whose latest ledger status is one
 * of {migrated, verified, rolled-back}. Agents that are `pending` (never
 * successfully applied) or absent from the ledger entirely are skipped
 * — verify has nothing to witness for those.
 *
 * With agent: validates the name against the OpenClaw inventory (not the
 * ledger — an operator may call verify before the first apply, so the
 * ledger may not yet have a row for the agent). Unknown names fail fast
 * with exit 1 and NO ledger side-effect.
 *
 * Per-agent: calls migrateOpenclawHandlers.verifyAgent (indirected through
 * the dispatch holder so tests can mock), appends ONE ledger row per
 * agent based on the aggregate pass/fail result, and contributes a table
 * block to the final stdout emission. Exit code is 0 iff ALL agents pass
 * (any fail → 1).
 *
 * Env-var plumbing:
 *   CLAWCODE_DISCORD_TOKEN → discordToken (Discord REST bearer)
 *   CLAWCODE_VERIFY_OFFLINE === "true" → offline=true (skip Discord call)
 */
export async function runVerifyAction(opts: {
  agent?: string;
}): Promise<number> {
  const paths = resolvePaths();

  // Which agents to verify?
  let agents: string[];
  if (opts.agent) {
    const inventory = await readOpenclawInventory(paths.openclawJson);
    const known = new Set(inventory.agents.map((a) => a.id));
    if (!known.has(opts.agent)) {
      cliError(
        `Unknown agent: ${opts.agent}. Run \`clawcode migrate openclaw list\` to see migrated agents.`,
      );
      return 1;
    }
    agents = [opts.agent];
  } else {
    const statusMap = await latestStatusByAgent(paths.ledgerPath);
    agents = [];
    for (const [name, status] of statusMap.entries()) {
      if (
        status === "migrated" ||
        status === "verified" ||
        status === "rolled-back"
      ) {
        agents.push(name);
      }
    }
    agents.sort();
  }

  const discordToken = process.env.CLAWCODE_DISCORD_TOKEN;
  const offline = process.env.CLAWCODE_VERIFY_OFFLINE === "true";

  const perAgent: Array<{
    agent: string;
    results: readonly VerifyCheckResult[];
  }> = [];
  let aggregateExit: 0 | 1 = 0;

  for (const agentName of agents) {
    const results = await migrateOpenclawHandlers.verifyAgent({
      agentName,
      clawcodeConfigPath: paths.clawcodeConfigPath,
      openclawRoot: paths.openclawRoot,
      openclawMemoryDir: paths.openclawMemoryDir,
      discordToken,
      offline,
    });
    perAgent.push({ agent: agentName, results });
    const agentExit = computeVerifyExitCode(results);
    if (agentExit !== 0) aggregateExit = 1;

    // Per-agent ledger witness — verify:complete (allow) OR verify:fail (refuse).
    if (agentExit === 0) {
      await appendRow(paths.ledgerPath, {
        ts: new Date().toISOString(),
        action: "verify",
        agent: agentName,
        status: "verified",
        source_hash: "n/a",
        step: "verify:complete",
        outcome: "allow",
        notes: `${results.length} checks — all pass/skip`,
      });
    } else {
      const fails = results
        .filter((r) => r.status === "fail")
        .map((r) => r.check);
      await appendRow(paths.ledgerPath, {
        ts: new Date().toISOString(),
        action: "verify",
        agent: agentName,
        status: "pending",
        source_hash: "n/a",
        step: "verify:fail",
        outcome: "refuse",
        notes: `fail: ${fails.join(", ")}`,
      });
    }
  }

  cliLog(formatVerifyTable(perAgent));
  return aggregateExit;
}

/**
 * `clawcode migrate openclaw rollback <agent>` action handler.
 *
 * Per-agent only — no batch mode (81-CONTEXT: "Per-agent only. No batch
 * mode.") Wraps Plan 01's rollbackAgent module. Three outcomes:
 *   - rolled-back: print success line + removedPaths as dim bullet list;
 *     exit 0. Ledger rows written by rollbackAgent itself.
 *   - not-found: agent absent from resolved config; cliError + exit 1.
 *   - SourceCorruptionError thrown: cliError with mismatches list + the
 *     literal "source tree was modified during rollback" copy; exit 1.
 *     Refuse ledger row already written by rollbackAgent before throw.
 */
export async function runRollbackAction(opts: {
  agent: string;
}): Promise<number> {
  const paths = resolvePaths();
  try {
    const result: RollbackResult = await migrateOpenclawHandlers.rollbackAgent({
      agentName: opts.agent,
      clawcodeConfigPath: paths.clawcodeConfigPath,
      openclawRoot: paths.openclawRoot,
      openclawMemoryDir: paths.openclawMemoryDir,
      ledgerPath: paths.ledgerPath,
    });
    if (result.outcome === "not-found") {
      cliError(
        red(`✗ rollback: agent '${opts.agent}' not found in clawcode.yaml`),
      );
      return 1;
    }
    // outcome === "rolled-back"
    cliLog(
      green(
        `✓ rolled back ${opts.agent}: removed ${result.removedPaths.length} path(s)`,
      ),
    );
    for (const p of result.removedPaths) cliLog(dim(`  ${p}`));
    return 0;
  } catch (err) {
    if (err instanceof SourceCorruptionError) {
      cliError(
        red(
          `✗ rollback ABORTED for ${opts.agent}: source tree was modified during rollback`,
        ),
      );
      cliError(red(`  mismatches: ${err.mismatches.join(", ")}`));
      cliError(
        "Source invariant violated — ~/.openclaw/ must remain byte-identical.",
      );
      return 1;
    }
    throw err;
  }
}

// --- Phase 82 Plan 02 — cutover + complete action handlers ----------

/**
 * `clawcode migrate openclaw cutover <agent>` action handler.
 *
 * The ONLY CLI path that writes to `~/.openclaw/openclaw.json`. Wraps the
 * Phase 82 Plan 01 `cutoverAgent` orchestrator — three-guard safety check
 * (ledger status, clawcode.yaml entry, bindings present) then an fs-guard-
 * allowlisted atomic temp+rename against openclaw.json.
 *
 * Three CutoverOutcome variants map to exit codes:
 *   - "cut-over" → 0, stdout "✓ cut over <agent>: removed N binding(s)" +
 *     observeHint ("Now wait 15 minutes ...")
 *   - "already-cut-over" → 0 (idempotent no-op per D-05), stdout dim
 *     "<agent>: already cut over"
 *   - "refused" → 1, stderr "✗ cutover refused for <agent>: <reason>"
 *
 * The call goes through `migrateOpenclawHandlers.cutoverAgent` so tests
 * can swap a mock into the dispatch holder without rebinding ESM frozen
 * bindings (same pattern as Phase 80/81).
 */
export async function runCutoverAction(opts: {
  agent: string;
}): Promise<number> {
  const paths = resolvePaths();
  const impl = migrateOpenclawHandlers.cutoverAgent ?? cutoverAgentModule;
  const result = await impl({
    agentName: opts.agent,
    openclawJsonPath: paths.openclawJson,
    clawcodeConfigPath: paths.clawcodeConfigPath,
    ledgerPath: paths.ledgerPath,
  });
  switch (result.outcome) {
    case "cut-over":
      cliLog(
        green(
          `✓ cut over ${opts.agent}: removed ${result.removedCount} binding(s)`,
        ),
      );
      if (result.observeHint) cliLog(dim(result.observeHint));
      return 0;
    case "already-cut-over":
      cliLog(
        dim(
          `${opts.agent}: already cut over (0 bindings to remove) — no-op`,
        ),
      );
      return 0;
    case "refused":
      cliError(
        red(
          `✗ cutover refused for ${opts.agent}: ${result.refuseReason ?? "(no reason)"}`,
        ),
      );
      return 1;
  }
}

/**
 * `clawcode migrate openclaw complete` action handler.
 *
 * Terminal subcommand — writes `.planning/milestones/v2.1-migration-report.md`
 * with per-agent H3 sections + cross-agent invariants (zeroChannelOverlap,
 * sourceTreeByteIdentical, zeroDuplicateOriginIds). Wraps Phase 82 Plan 01
 * `buildMigrationReport` + `writeMigrationReport`.
 *
 * BuildReportResult variants map to exit codes:
 *   - "refused-pending" → 1, stderr = buildResult.message (literal per D-07)
 *   - "refused-invariants" → 1, stderr = message + failing invariants list
 *   - "refused-secret" → 1, stderr = offenderPath-aware refusal
 *   - "built" → writeMigrationReport → 0, stdout "Migration complete. Report: <path>"
 *
 * --force flag bypasses the refused-pending gate (forwarded as
 * forceOnPending). No other override — REPORT_PATH_LITERAL is locked per D-06.
 */
export async function runCompleteAction(opts: {
  force?: boolean;
}): Promise<number> {
  const paths = resolvePaths();
  const buildImpl =
    migrateOpenclawHandlers.buildMigrationReport ?? buildMigrationReportModule;
  const writeImpl =
    migrateOpenclawHandlers.writeMigrationReport ?? writeMigrationReportModule;
  const buildResult = await buildImpl({
    ledgerPath: paths.ledgerPath,
    openclawJsonPath: paths.openclawJson,
    clawcodeConfigPath: paths.clawcodeConfigPath,
    openclawRoot: paths.openclawRoot,
    openclawMemoryDir: paths.openclawMemoryDir,
    forceOnPending: opts.force === true,
  });

  switch (buildResult.outcome) {
    case "refused-pending":
      cliError(red(buildResult.message));
      return 1;
    case "refused-invariants":
      cliError(red(buildResult.message));
      cliError(red(`failing invariants: ${buildResult.failing.join(", ")}`));
      return 1;
    case "refused-secret":
      cliError(
        red(
          `✗ complete refused: secret-shaped value detected at ${buildResult.offenderPath} — remove secrets from ledger notes / warnings before re-running`,
        ),
      );
      return 1;
    case "built": {
      const writeResult = await writeImpl(buildResult);
      cliLog(green(`Migration complete. Report: ${writeResult.destPath}`));
      return 0;
    }
  }
}

// --- Commander wiring (nested: `migrate openclaw <sub>`) -------------

/**
 * Mutable handler dispatch object. Commander actions call handlers via this
 * holder instead of binding the named `runPlanAction` / `runApplyAction`
 * imports directly; tests monkey-patch the holder to assert wiring without
 * running the real handlers.
 *
 * Direct named-import references are frozen in ESM (export bindings are
 * read-only after the module initializes), so a simple `vi.spyOn` on the
 * module namespace would not rebind the commander closure. The dispatch
 * holder is a mutable object — its properties can be swapped by tests.
 *
 * Exported for test visibility only; production code should never mutate it.
 */
export const migrateOpenclawHandlers: {
  runPlanAction: typeof runPlanAction;
  runApplyAction: typeof runApplyAction;
  // Phase 80 Plan 03 — tests swap this property to inject a mock translator
  // without exercising the real ONNX embedder. runApplyAction's memory-
  // translate block indirects through the holder so ESM named-import
  // bindings don't block the swap.
  translateAgentMemories: typeof translateAgentMemories;
  // Phase 81 Plan 02 — tests swap these properties to intercept verify/
  // rollback without exercising the real disk+network modules. The holder
  // extension mirrors the Phase 80 translator pattern.
  verifyAgent: typeof verifyAgentModule;
  rollbackAgent: typeof rollbackAgentModule;
  // Phase 81 Plan 02 — Commander wiring dispatches through these fields
  // so tests can mock the action handlers without rebinding module
  // namespace exports (ESM frozen bindings). Assigned post-definition
  // below because the fns are declared later in the file.
  runVerifyAction: (opts: { agent?: string }) => Promise<number>;
  runRollbackAction: (opts: { agent: string }) => Promise<number>;
  // Phase 82 Plan 02 — cutoverAgent + buildMigrationReport + writeMigrationReport
  // are swappable per-test so the CLI integration suites can exercise the
  // full action-handler path without touching real openclaw.json / the
  // milestone report path. The three module-level fns are attached at
  // initialization time; late-bind for the action handlers happens below.
  cutoverAgent: typeof cutoverAgentModule;
  buildMigrationReport: typeof buildMigrationReportModule;
  writeMigrationReport: typeof writeMigrationReportModule;
  runCutoverAction: (opts: { agent: string }) => Promise<number>;
  runCompleteAction: (opts: { force?: boolean }) => Promise<number>;
} = {
  runPlanAction,
  runApplyAction,
  translateAgentMemories,
  verifyAgent: verifyAgentModule,
  rollbackAgent: rollbackAgentModule,
  // Placeholders — late-bound to runVerifyAction / runRollbackAction once
  // those functions are defined. The intermediate `async () => 0` is never
  // invoked in production (late-bind fires at module load).
  runVerifyAction: async () => 0,
  runRollbackAction: async () => 0,
  // Phase 82 Plan 02 — cutover + report-writer module references + action
  // handler placeholders (late-bound below to the real fns).
  cutoverAgent: cutoverAgentModule,
  buildMigrationReport: buildMigrationReportModule,
  writeMigrationReport: writeMigrationReportModule,
  runCutoverAction: async () => 0,
  runCompleteAction: async () => 0,
};

// Late-bind Phase 81 Plan 02 actions into the dispatch holder. The holder
// was initialized above with harmless placeholder values because the
// action fns (runVerifyAction / runRollbackAction) are defined earlier
// in the file but the HOLDER itself sits below them for historical
// reasons (Phase 76 layout). Production code + tests both go through the
// holder, and tests can swap the fields freely without namespace rebind.
migrateOpenclawHandlers.runVerifyAction = runVerifyAction;
migrateOpenclawHandlers.runRollbackAction = runRollbackAction;
// Phase 82 Plan 02 — late-bind the two new action handlers to the holder.
migrateOpenclawHandlers.runCutoverAction = runCutoverAction;
migrateOpenclawHandlers.runCompleteAction = runCompleteAction;

export function registerMigrateOpenclawCommand(program: Command): void {
  const migrate = program.command("migrate").description("Migration commands");
  const openclaw = migrate
    .command("openclaw")
    .description("OpenClaw agent migration subcommands (read-side, dry-run)");

  openclaw
    .command("list")
    .description("Show every active OpenClaw agent and its ledger-tracked migration status (writes nothing)")
    .action(async () => {
      try {
        await runListAction();
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  openclaw
    .command("plan")
    .description("Show the per-agent diff that `apply` would produce (writes ledger JSONL, nothing else)")
    .option("--agent <name>", "Filter to a single OpenClaw agent")
    .option(
      "--model-map <mapping...>",
      "Override model mapping (repeatable, syntax: 'oc-id=cc-id')",
    )
    .action(async (opts: { agent?: string; modelMap?: string[] }) => {
      // Fail-fast on malformed --model-map BEFORE runPlanAction touches
      // anything. A typo in a CLI flag surfaces as exit 1 with stderr copy,
      // not as a silent missing mapping downstream.
      let modelMap: Record<string, string>;
      try {
        modelMap = parseModelMapFlag(opts.modelMap ?? []);
      } catch (err) {
        cliError(err instanceof Error ? err.message : String(err));
        process.exit(1);
        return;
      }
      try {
        // Indirect through the exported dispatch object so tests can
        // monkey-patch the handler in ESM (direct named-import references
        // are frozen; the dispatch holder is a mutable object).
        const code = await migrateOpenclawHandlers.runPlanAction({
          agent: opts.agent,
          modelMap,
        });
        if (code !== 0) process.exit(code);
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  openclaw
    .command("apply")
    .description(
      "Run pre-flight guards then write clawcode.yaml (Phase 78 Plan 03 — atomic + comment-preserving)",
    )
    .option(
      "--only <name>",
      "Filter pre-flight checks to a single OpenClaw agent",
    )
    .option(
      "--model-map <mapping...>",
      "Override model mapping (repeatable, syntax: 'oc-id=cc-id')",
    )
    .action(async (opts: { only?: string; modelMap?: string[] }) => {
      // Fail-fast on malformed --model-map BEFORE runApplyAction installs
      // the fs-guard or touches the ledger.
      let modelMap: Record<string, string>;
      try {
        modelMap = parseModelMapFlag(opts.modelMap ?? []);
      } catch (err) {
        cliError(err instanceof Error ? err.message : String(err));
        process.exit(1);
        return;
      }
      try {
        const code = await migrateOpenclawHandlers.runApplyAction({
          only: opts.only,
          modelMap,
        });
        if (code !== 0) process.exit(code);
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Phase 81 Plan 02 — verify [agent]
  openclaw
    .command("verify")
    .argument("[agent]", "Verify a single migrated agent (omit for all)")
    .description(
      "Run 4 post-migration checks (workspace-files/memory-count/discord-reachable/daemon-parse)",
    )
    .action(async (agent: string | undefined) => {
      try {
        const code = await migrateOpenclawHandlers.runVerifyAction({ agent });
        if (code !== 0) process.exit(code);
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Phase 81 Plan 02 — rollback <agent>
  openclaw
    .command("rollback")
    .argument("<agent>", "Agent to roll back (per-agent only, no batch mode)")
    .description(
      "Remove agent from clawcode.yaml + delete its target workspace/memory; source ~/.openclaw/ untouched",
    )
    .action(async (agent: string) => {
      try {
        const code = await migrateOpenclawHandlers.runRollbackAction({ agent });
        if (code !== 0) process.exit(code);
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Phase 82 Plan 02 — cutover <agent>
  // The ONLY subcommand that writes to ~/.openclaw/ (via fs-guard allowlist
  // carve-out for openclaw.json). Three-guard orchestrator in Wave 1 enforces
  // ledger status + clawcode.yaml entry + bindings-present before any write.
  openclaw
    .command("cutover")
    .argument(
      "<agent>",
      "Agent to cut over (removes its bindings from ~/.openclaw/openclaw.json)",
    )
    .description(
      "Per-agent cutover — removes OpenClaw Discord bindings for <agent> (ONLY phase that writes ~/.openclaw/)",
    )
    .action(async (agent: string) => {
      try {
        const code = await migrateOpenclawHandlers.runCutoverAction({ agent });
        if (code !== 0) process.exit(code);
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  // Phase 82 Plan 02 — complete
  // Terminal subcommand — writes .planning/milestones/v2.1-migration-report.md
  // with per-agent H3 sections + three cross-agent invariants. --force
  // bypasses the refused-pending gate.
  openclaw
    .command("complete")
    .option(
      "--force",
      "Acknowledge that some agents are still pending and proceed anyway",
    )
    .description(
      "Write .planning/milestones/v2.1-migration-report.md — final migration artifact with per-agent outcomes and cross-agent invariants",
    )
    .action(async (opts: { force?: boolean }) => {
      try {
        const code = await migrateOpenclawHandlers.runCompleteAction({
          force: opts.force === true,
        });
        if (code !== 0) process.exit(code);
      } catch (err) {
        cliError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
