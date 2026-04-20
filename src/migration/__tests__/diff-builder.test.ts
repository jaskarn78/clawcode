/**
 * Unit tests for diff-builder.ts (Phase 76 Plan 02).
 *
 * Proves the three load-bearing invariants:
 *   1. Deterministic output — same input produces a byte-identical PlanReport
 *      (same SHA256 planHash) across two successive buildPlan() calls.
 *   2. Finmentum-family basePath collapse — all 5 hardcoded family ids share
 *      ONE targetBasePath while keeping 5 distinct targetMemoryPath values.
 *   3. Warnings surface non-fatal conditions — missing Discord binding, empty
 *      source memory, absent chunks table, unknown --agent filter — each emits
 *      a structured PlanWarning without throwing.
 *
 * Fixture: the 15-agent `openclaw.sample.json` committed in Plan 01. Chunk
 * counts are fabricated from STACK.md "Reality Check: Embeddings" table for
 * semantic realism (878 general, 597 fin-acquisition, 47 personal, etc.) —
 * real on-box numbers keep the pinned expected-diff.json fixture meaningful.
 *
 * Expected-diff fixture (expected-diff.json) is pinned: any intentional change
 * in PlanReport shape requires an explicit fixture update. Parity test asserts
 * the current buildPlan output matches the pin — catches accidental drift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readOpenclawInventory } from "../openclaw-config-reader.js";
import type { ChunkCountResult } from "../source-memory-reader.js";
import {
  buildPlan,
  computePlanHash,
  getTargetBasePath,
  getTargetMemoryPath,
  WARNING_KINDS,
  type PlanReport,
} from "../diff-builder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE = join(__dirname, "fixtures", "openclaw.sample.json");
const EXPECTED_DIFF_FIXTURE = join(__dirname, "fixtures", "expected-diff.json");

// Stable "now" for deterministic generatedAt across runs — DI'd into buildPlan.
// Intentionally a fixed Date so expected-diff.json doesn't drift per-run.
const FIXED_NOW = () => new Date("2026-04-20T00:00:00.000Z");

// Real on-box chunk counts from .planning/research/STACK.md "Reality Check:
// Embeddings". 7 agents populated, 8 empty. Kept as a const so multiple tests
// can mutate a copy without polluting each other.
function realisticChunkCounts(): Map<string, ChunkCountResult> {
  return new Map<string, ChunkCountResult>([
    ["general", { count: 878, missing: false, tableAbsent: false }],
    ["personal", { count: 47, missing: false, tableAbsent: false }],
    ["projects", { count: 519, missing: false, tableAbsent: false }],
    ["research", { count: 287, missing: false, tableAbsent: false }],
    ["fin-acquisition", { count: 597, missing: false, tableAbsent: false }],
    [
      "finmentum-content-creator",
      { count: 224, missing: false, tableAbsent: false },
    ],
    // 8 empty — mix of `missing` (file absent) and `tableAbsent` (file present,
    // no chunks table). `empty` (count 0, file present, table present) is
    // covered by an explicit test case below.
    ["work", { count: 0, missing: true, tableAbsent: false }],
    ["shopping", { count: 0, missing: true, tableAbsent: false }],
    ["kimi", { count: 0, missing: true, tableAbsent: false }],
    ["local-clawdy", { count: 0, missing: true, tableAbsent: false }],
    ["fin-research", { count: 0, missing: true, tableAbsent: false }],
    ["fin-playground", { count: 0, missing: true, tableAbsent: false }],
    ["fin-tax", { count: 0, missing: true, tableAbsent: false }],
    ["projects", { count: 519, missing: false, tableAbsent: false }],
    // `card-planner` and `card-generator` left out of the map on purpose —
    // buildPlan must default to {count:0, missing:true, tableAbsent:false}
    // when a key is absent, which is a realistic production case.
  ]);
}

const TEST_ROOT = "/tmp/clawcode-agents";

describe("getTargetBasePath", () => {
  it("collapses all 5 finmentum-family ids to a single shared basePath", () => {
    const finIds = [
      "fin-acquisition",
      "fin-research",
      "fin-playground",
      "fin-tax",
      "finmentum-content-creator",
    ];
    const paths = finIds.map((id) => getTargetBasePath(id, TEST_ROOT));
    const unique = new Set(paths);
    expect(unique.size).toBe(1);
    expect([...unique][0]).toBe(join(TEST_ROOT, "finmentum"));
  });

  it("gives dedicated agents an id-scoped basePath", () => {
    expect(getTargetBasePath("general", TEST_ROOT)).toBe(
      join(TEST_ROOT, "general"),
    );
    expect(getTargetBasePath("research", TEST_ROOT)).toBe(
      join(TEST_ROOT, "research"),
    );
  });
});

describe("getTargetMemoryPath", () => {
  it("finmentum agents get distinct memory paths under the shared basePath", () => {
    const finIds = [
      "fin-acquisition",
      "fin-research",
      "fin-playground",
      "fin-tax",
      "finmentum-content-creator",
    ];
    const memoryPaths = finIds.map((id) => getTargetMemoryPath(id, TEST_ROOT));
    const unique = new Set(memoryPaths);
    expect(unique.size).toBe(5);
    for (const id of finIds) {
      expect(getTargetMemoryPath(id, TEST_ROOT)).toBe(
        join(TEST_ROOT, "finmentum", "memory", id),
      );
    }
  });

  it("dedicated agents have memoryPath equal to basePath (workspace fallback)", () => {
    expect(getTargetMemoryPath("general", TEST_ROOT)).toBe(
      getTargetBasePath("general", TEST_ROOT),
    );
  });
});

describe("buildPlan — basic shape + sort", () => {
  it("returns 15 AgentPlan entries sorted alphabetically by sourceId", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });

    expect(report.agents).toHaveLength(15);
    const ids = report.agents.map((a) => a.sourceId);
    const sorted = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sorted);
  });

  it("echoes inventory.sourcePath and the injected clawcodeAgentsRoot on PlanReport", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    expect(report.sourcePath).toBe(FIXTURE);
    expect(report.targetRoot).toBe(TEST_ROOT);
    expect(typeof report.planHash).toBe("string");
    expect(report.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.generatedAt).toBe("2026-04-20T00:00:00.000Z");
  });
});

describe("buildPlan — finmentum-family collapse (load-bearing)", () => {
  it("all 5 finmentum agents share one targetBasePath, have 5 distinct targetMemoryPath", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });

    const finAgents = report.agents.filter((a) => a.isFinmentumFamily);
    expect(finAgents).toHaveLength(5);

    const basePaths = new Set(finAgents.map((a) => a.targetBasePath));
    expect(basePaths.size).toBe(1);
    expect([...basePaths][0]).toBe(join(TEST_ROOT, "finmentum"));

    const memoryPaths = new Set(finAgents.map((a) => a.targetMemoryPath));
    expect(memoryPaths.size).toBe(5);
    const expectedMemorySuffixes = [
      "memory/fin-acquisition",
      "memory/fin-research",
      "memory/fin-playground",
      "memory/fin-tax",
      "memory/finmentum-content-creator",
    ];
    for (const suffix of expectedMemorySuffixes) {
      const hit = finAgents.find((a) =>
        a.targetMemoryPath.endsWith(join("", suffix)),
      );
      expect(hit, `no finmentum agent memoryPath ends with ${suffix}`).toBeDefined();
    }
  });

  it("non-finmentum agents get basePath === memoryPath (dedicated workspace parity)", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const general = report.agents.find((a) => a.sourceId === "general");
    expect(general).toBeDefined();
    expect(general?.targetBasePath).toBe(join(TEST_ROOT, "general"));
    expect(general?.targetMemoryPath).toBe(join(TEST_ROOT, "general"));
  });
});

describe("buildPlan — planHash determinism (core invariant)", () => {
  it("two successive calls with identical inputs produce identical planHash", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const counts = realisticChunkCounts();

    const reportA = buildPlan({
      inventory,
      chunkCounts: counts,
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const reportB = buildPlan({
      inventory,
      chunkCounts: counts,
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });

    // Same hash.
    expect(reportA.planHash).toBe(reportB.planHash);
    // Verify the hash excludes generatedAt — we injected the same FIXED_NOW,
    // but the invariant is semantic: two reports with the same *content* MUST
    // hash identically regardless of when they were computed.
    const reportC = buildPlan({
      inventory,
      chunkCounts: counts,
      clawcodeAgentsRoot: TEST_ROOT,
      now: () => new Date("2099-01-01T00:00:00.000Z"),
    });
    expect(reportC.planHash).toBe(reportA.planHash);
    expect(reportC.generatedAt).not.toBe(reportA.generatedAt);
  });

  it("a single chunkCount delta (878 → 879) changes the planHash", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const counts = realisticChunkCounts();
    const reportA = buildPlan({
      inventory,
      chunkCounts: counts,
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const mutated = new Map(counts);
    mutated.set("general", { count: 879, missing: false, tableAbsent: false });
    const reportB = buildPlan({
      inventory,
      chunkCounts: mutated,
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    expect(reportA.planHash).not.toBe(reportB.planHash);
  });

  it("round-trip: serialize → parse → recompute hash yields the same value", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });

    // Strip generatedAt + planHash, then recompute — MUST match.
    const { generatedAt: _ga, planHash: _ph, ...base } = report;
    void _ga;
    void _ph;
    const serialized = JSON.stringify(base);
    const parsed = JSON.parse(serialized) as Omit<
      PlanReport,
      "generatedAt" | "planHash"
    >;
    const recomputed = computePlanHash(parsed);
    expect(recomputed).toBe(report.planHash);
  });
});

describe("buildPlan — warnings (non-fatal surfacing)", () => {
  it("emits missing-discord-binding for agents without a channel id", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });

    // 'general' has no Discord binding in the fixture (verified by Plan 01 test).
    const generalDiscord = report.warnings.filter(
      (w) => w.kind === "missing-discord-binding" && w.agent === "general",
    );
    expect(generalDiscord).toHaveLength(1);
  });

  it("emits empty-source-memory when chunkCounts reports missing: true", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const workWarning = report.warnings.find(
      (w) => w.kind === "empty-source-memory" && w.agent === "work",
    );
    expect(workWarning).toBeDefined();
  });

  it("emits source-db-no-chunks-table when tableAbsent: true", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const counts = realisticChunkCounts();
    counts.set("card-planner", {
      count: 0,
      missing: false,
      tableAbsent: true,
    });
    const report = buildPlan({
      inventory,
      chunkCounts: counts,
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const hit = report.warnings.find(
      (w) =>
        w.kind === "source-db-no-chunks-table" && w.agent === "card-planner",
    );
    expect(hit).toBeDefined();
  });

  it("emits empty-source-memory (not missing) when file present but 0 rows", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const counts = realisticChunkCounts();
    // Present + zero rows: different from `missing: true`.
    counts.set("card-generator", {
      count: 0,
      missing: false,
      tableAbsent: false,
    });
    const report = buildPlan({
      inventory,
      chunkCounts: counts,
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const hit = report.warnings.find(
      (w) => w.kind === "empty-source-memory" && w.agent === "card-generator",
    );
    expect(hit).toBeDefined();
  });

  it("warnings are sorted deterministically by (kind, agent)", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const key = (w: (typeof report.warnings)[number]) => w.kind + "/" + w.agent;
    const keys = report.warnings.map(key);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });

  it("does NOT throw when a populated agent is missing from chunkCounts (defaults to missing)", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    // Empty map — every agent should get default {count:0, missing:true}
    const report = buildPlan({
      inventory,
      chunkCounts: new Map(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    expect(report.agents).toHaveLength(15);
    // Every agent becomes `missing` → 15 empty-source-memory warnings.
    const emptyWarnings = report.warnings.filter(
      (w) => w.kind === "empty-source-memory",
    );
    expect(emptyWarnings).toHaveLength(15);
  });
});

describe("buildPlan — --agent filter", () => {
  it("limits agents array to a single entry when targetFilter matches", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      targetFilter: "general",
      now: FIXED_NOW,
    });
    expect(report.agents).toHaveLength(1);
    expect(report.agents[0]?.sourceId).toBe("general");
  });

  it("returns empty agents + unknown-agent-filter warning on unknown name; hash still stable", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const reportA = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      targetFilter: "does-not-exist",
      now: FIXED_NOW,
    });
    expect(reportA.agents).toHaveLength(0);
    const warn = reportA.warnings.find(
      (w) =>
        w.kind === "unknown-agent-filter" && w.agent === "does-not-exist",
    );
    expect(warn).toBeDefined();

    // Hash stability: two successive empty-filter calls produce the same hash.
    const reportB = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      targetFilter: "does-not-exist",
      now: FIXED_NOW,
    });
    expect(reportA.planHash).toBe(reportB.planHash);
  });
});

describe("buildPlan — per-agent field population", () => {
  it("populates sourceModel from agent.model.primary", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const general = report.agents.find((a) => a.sourceId === "general");
    expect(general?.sourceModel).toBe("anthropic-api/claude-sonnet-4-6");
  });

  it("populates memoryChunkCount + memoryStatus from chunkCounts", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const general = report.agents.find((a) => a.sourceId === "general");
    expect(general?.memoryChunkCount).toBe(878);
    expect(general?.memoryStatus).toBe("present");

    const work = report.agents.find((a) => a.sourceId === "work");
    expect(work?.memoryChunkCount).toBe(0);
    expect(work?.memoryStatus).toBe("missing");
  });

  it("targetAgentName equals sourceId (slug stable across rename attempts)", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    for (const a of report.agents) {
      expect(a.targetAgentName).toBe(a.sourceId);
    }
  });
});

describe("WARNING_KINDS const export", () => {
  it("exposes the 6 warning kinds plus nothing else (Phase 76 x4 + Phase 78 x2)", () => {
    expect([...WARNING_KINDS]).toEqual([
      "missing-discord-binding",
      "empty-source-memory",
      "source-db-no-chunks-table",
      "unknown-agent-filter",
      // Phase 78 CONF-02 / CONF-03 additions:
      "unknown-mcp-server",
      "unmappable-model",
    ]);
  });
});

describe("expected-diff.json pinned fixture", () => {
  it("matches the current PlanReport byte-for-byte (sans generatedAt, which is stable via FIXED_NOW)", async () => {
    const inventory = await readOpenclawInventory(FIXTURE);
    const report = buildPlan({
      inventory,
      chunkCounts: realisticChunkCounts(),
      clawcodeAgentsRoot: TEST_ROOT,
      now: FIXED_NOW,
    });
    const pinned = JSON.parse(
      readFileSync(EXPECTED_DIFF_FIXTURE, "utf8"),
    ) as PlanReport;

    // agents array: shape parity.
    expect(report.agents).toEqual(pinned.agents);
    // warnings: shape parity.
    expect(report.warnings).toEqual(pinned.warnings);
    expect(report.targetRoot).toBe(pinned.targetRoot);
    // planHash must match — this is THE invariant the whole phase is built on.
    expect(report.planHash).toBe(pinned.planHash);
  });
});
