/**
 * Diff engine for Phase 76 `clawcode migrate openclaw plan`.
 *
 * Pure function — zero I/O, zero side effects, zero env reads. Takes an
 * OpenClaw source inventory (Plan 01) + per-agent chunk counts + the target
 * clawcode agents root, produces a deterministic PlanReport that the CLI
 * (Plan 03) renders. Deterministic means: two successive `buildPlan()`
 * invocations with identical inputs produce identical `planHash` strings —
 * including across process restarts, since the hash is computed via a
 * canonical JSON serialization (sorted keys at every nesting level).
 *
 * Three load-bearing invariants (tests in diff-builder.test.ts enforce):
 *   1. planHash is stable across repeated invocations — generatedAt is
 *      EXCLUDED from the hash so wall-clock skew never taints semantic
 *      content.
 *   2. Finmentum family (5 hardcoded ids) collapse to one shared
 *      targetBasePath under `<root>/finmentum` but get 5 distinct
 *      targetMemoryPath values `<root>/finmentum/memory/<id>` — this is the
 *      load-bearing use case for Phase 75's shared-workspace runtime support.
 *   3. Unmappable conditions emit warnings, NEVER throws. Missing Discord
 *      binding, empty source sqlite, absent chunks table, and unknown
 *      --agent filter all surface as structured PlanWarning entries so the
 *      Wave 3 CLI can colorize and optionally exit non-zero — but this layer
 *      stays a pure data-transform.
 *
 * DO NOT:
 *   - Read process.env or os.homedir() here — `clawcodeAgentsRoot` is always
 *     injected by the caller. Keeps the function trivially testable.
 *   - Perform I/O (readFile, writeFile, Database) — violates the zero-write
 *     contract asserted by the 76-03 integration test.
 *   - Use Date.now() directly — the `now` DI lets tests pin generatedAt.
 *   - Include generatedAt in computePlanHash — breaks the determinism
 *     invariant (two reports with identical semantic content MUST hash equal
 *     regardless of when they were computed).
 *   - Use raw JSON.stringify(obj) for hashing — V8 key order is
 *     insertion-order and NOT stable across refactors. Use `canonicalize`
 *     which sorts keys at every level.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  FINMENTUM_FAMILY_IDS,
  isFinmentumFamily,
  type OpenclawSourceInventory,
} from "./openclaw-config-reader.js";
import type { ChunkCountResult } from "./source-memory-reader.js";

// Re-export family membership helpers so Wave 3 CLI only imports from
// diff-builder (single point of contact for plan-output shape).
export { FINMENTUM_FAMILY_IDS, isFinmentumFamily };

/**
 * The 4 warning kinds Plan 02 can emit. Frozen const tuple so callers can
 * `satisfies` against it and catch typos at compile time. The Wave 3 CLI
 * colorizes on these; Phase 77 pre-flight guards will extend with new kinds.
 */
export const WARNING_KINDS = [
  "missing-discord-binding",
  "empty-source-memory",
  "source-db-no-chunks-table",
  "unknown-agent-filter",
  // Phase 78 CONF-02 — per-agent MCP server name has no match in the
  // top-level `mcpServers:` map of the existing clawcode.yaml. Soft
  // warning (not error) per 78-CONTEXT — operator curates the map.
  "unknown-mcp-server",
  // Phase 78 CONF-03 — OpenClaw model id is not in DEFAULT_MODEL_MAP and
  // not covered by --model-map overrides. Soft warning in `plan`; `apply`
  // refuses unless the override lands the mapping (Plan 03 enforces).
  "unmappable-model",
] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

/**
 * A single non-fatal warning from buildPlan. `detail` is optional free-text
 * context (e.g., "sqlite file not found" vs. "chunks table present but empty"
 * both share kind `empty-source-memory`); the CLI surfaces `detail` in the
 * warnings-block below the main table.
 */
export type PlanWarning = {
  readonly kind: WarningKind;
  readonly agent: string;
  readonly detail?: string;
};

/**
 * Per-agent plan entry. Every field is load-bearing for Phase 77–82:
 *   - `sourceId` is the slug used everywhere (ledger agent column,
 *     clawcode.yaml `name`, Discord channel-binding lookup).
 *   - `memoryStatus` is the discriminator for Phase 80's memory-translation
 *     gate: skip `missing` / `empty` / `table-absent`, translate `present`.
 *   - `targetBasePath` vs `targetMemoryPath` encodes the finmentum-family
 *     SHARED-01 contract from Phase 75 — dedicated agents have these equal,
 *     finmentum agents have distinct memoryPath under the shared basePath.
 */
export type AgentPlan = {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceWorkspace: string;
  readonly sourceAgentDir: string;
  readonly sourceModel: string;
  readonly memoryChunkCount: number;
  readonly memoryStatus: "present" | "empty" | "missing" | "table-absent";
  readonly discordChannelId: string | undefined;
  readonly isFinmentumFamily: boolean;
  readonly targetBasePath: string;
  readonly targetMemoryPath: string;
  readonly targetAgentName: string;
};

/**
 * Deterministic plan report. `agents` sorted by sourceId ASC, `warnings`
 * sorted by (kind+agent) ASC. `generatedAt` is EXCLUDED from `planHash` —
 * the hash represents the plan's semantic content, not when it was computed.
 */
export type PlanReport = {
  readonly agents: readonly AgentPlan[];
  readonly warnings: readonly PlanWarning[];
  readonly sourcePath: string;
  readonly targetRoot: string;
  readonly generatedAt: string;
  readonly planHash: string;
};

/**
 * Resolve an agent's target basePath under `clawcodeAgentsRoot`. Finmentum
 * family (5 hardcoded ids) collapses to `<root>/finmentum`; all other ids
 * get `<root>/<id>`. Pure function — path.join only, no fs access.
 */
export function getTargetBasePath(
  sourceId: string,
  clawcodeAgentsRoot: string,
): string {
  if (isFinmentumFamily(sourceId)) {
    return join(clawcodeAgentsRoot, "finmentum");
  }
  return join(clawcodeAgentsRoot, sourceId);
}

/**
 * Resolve an agent's target memoryPath. Finmentum family: distinct path per
 * agent under the shared basePath's `memory/` subdir. Dedicated workspace:
 * memoryPath === basePath (matches Phase 75 runtime fallback where an
 * unspecified memoryPath inherits workspace).
 */
export function getTargetMemoryPath(
  sourceId: string,
  clawcodeAgentsRoot: string,
): string {
  const basePath = getTargetBasePath(sourceId, clawcodeAgentsRoot);
  if (isFinmentumFamily(sourceId)) {
    return join(basePath, "memory", sourceId);
  }
  return basePath;
}

/**
 * Compute SHA256 hex digest of a PlanReport's semantic content (everything
 * except `generatedAt` and `planHash` itself). Key order is stabilized via
 * `canonicalize` — V8's insertion-order JSON.stringify is NOT safe here:
 * a harmless refactor that reorders object literal keys would otherwise
 * silently change the hash across runs and break the determinism invariant.
 *
 * Accepts `Omit<PlanReport, "planHash" | "generatedAt">` so callers cannot
 * accidentally pass a report with generatedAt included and taint the hash.
 */
export function computePlanHash(
  report: Omit<PlanReport, "planHash" | "generatedAt">,
): string {
  const canonical = canonicalize(report);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Recursive canonical JSON: sorted keys at every object nesting level,
 * arrays preserved in insertion order (array order IS semantically
 * significant — buildPlan already pre-sorts agents/warnings for us).
 * `undefined` inside objects would normally be dropped by JSON.stringify
 * and we match that behavior here by only emitting defined keys.
 */
function canonicalize(v: unknown): string {
  if (v === undefined) return "null"; // shouldn't happen at top level
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * Input bundle for `buildPlan`. `now` is DI for test determinism — in
 * production the caller omits it and we default to `() => new Date()`.
 */
export type BuildPlanArgs = {
  readonly inventory: OpenclawSourceInventory;
  readonly chunkCounts: ReadonlyMap<string, ChunkCountResult>;
  readonly clawcodeAgentsRoot: string;
  readonly targetFilter?: string;
  readonly now?: () => Date;
};

/**
 * Pure-function diff assembly. Given an OpenClaw inventory + chunk counts +
 * target root, produces a deterministic PlanReport. See file header for
 * invariants and rationale.
 */
export function buildPlan(args: BuildPlanArgs): PlanReport {
  const { inventory, chunkCounts, clawcodeAgentsRoot, targetFilter } = args;
  const now = args.now ?? (() => new Date());
  const warnings: PlanWarning[] = [];

  // --agent <name> filter. Unknown name → empty agents array + an
  // `unknown-agent-filter` warning. Plan 03 CLI translates that warning into
  // `process.exit(1)` — buildPlan itself never throws or exits.
  let source = inventory.agents;
  if (targetFilter !== undefined) {
    const matched = source.filter((a) => a.id === targetFilter);
    if (matched.length === 0) {
      warnings.push({ kind: "unknown-agent-filter", agent: targetFilter });
      source = [];
    } else {
      source = matched;
    }
  }

  // Per-agent plan assembly. Default chunk result is `missing: true` — safer
  // than throwing when chunkCounts doesn't cover every agent (a real case in
  // Phase 76 because the caller only probes sqlite files that exist).
  const agents: AgentPlan[] = source.map((entry): AgentPlan => {
    const chunkResult =
      chunkCounts.get(entry.id) ??
      ({ count: 0, missing: true, tableAbsent: false } as ChunkCountResult);
    const memoryStatus: AgentPlan["memoryStatus"] = chunkResult.missing
      ? "missing"
      : chunkResult.tableAbsent
        ? "table-absent"
        : chunkResult.count === 0
          ? "empty"
          : "present";
    return {
      sourceId: entry.id,
      sourceName: entry.name,
      sourceWorkspace: entry.workspace,
      sourceAgentDir: entry.agentDir,
      sourceModel: entry.model.primary,
      memoryChunkCount: chunkResult.count,
      memoryStatus,
      discordChannelId: entry.discordChannelId,
      isFinmentumFamily: entry.isFinmentumFamily,
      targetBasePath: getTargetBasePath(entry.id, clawcodeAgentsRoot),
      targetMemoryPath: getTargetMemoryPath(entry.id, clawcodeAgentsRoot),
      targetAgentName: entry.id,
    };
  });

  // Emit warnings per-agent, then sort for determinism. Keeping this after
  // the agents map (not inline) means warning order is decoupled from agent
  // traversal order — crucial because we later sort agents defensively too.
  for (const a of agents) {
    if (a.discordChannelId === undefined) {
      warnings.push({ kind: "missing-discord-binding", agent: a.sourceId });
    }
    if (a.memoryStatus === "missing") {
      warnings.push({
        kind: "empty-source-memory",
        agent: a.sourceId,
        detail: "sqlite file not found",
      });
    } else if (a.memoryStatus === "table-absent") {
      warnings.push({
        kind: "source-db-no-chunks-table",
        agent: a.sourceId,
      });
    } else if (a.memoryStatus === "empty") {
      warnings.push({
        kind: "empty-source-memory",
        agent: a.sourceId,
        detail: "chunks table present but empty",
      });
    }
  }
  warnings.sort((a, b) =>
    (a.kind + "/" + a.agent).localeCompare(b.kind + "/" + b.agent),
  );

  // Re-sort agents defensively. Plan 01's readOpenclawInventory already
  // sorts by id, but pinning it here protects the determinism invariant
  // against a future refactor of the reader that forgets to sort.
  const sortedAgents = [...agents].sort((a, b) =>
    a.sourceId.localeCompare(b.sourceId),
  );

  const base = {
    agents: sortedAgents,
    warnings,
    sourcePath: inventory.sourcePath,
    targetRoot: clawcodeAgentsRoot,
  };
  const planHash = computePlanHash(base);
  return {
    ...base,
    generatedAt: now().toISOString(),
    planHash,
  };
}
