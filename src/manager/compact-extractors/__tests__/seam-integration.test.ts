import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import type { ConversationTurn } from "../../../memory/compaction.js";
import {
  buildTieredExtractor,
  partitionForVerbatim,
} from "../index.js";
import { resetTier1SentinelTracking } from "../tier1-verbatim.js";
import { resetTier4SentinelTracking } from "../tier4-drop.js";
import { resetTier2SentinelTracking } from "../tier2-haiku.js";
import type { ExtractorDeps } from "../types.js";
import { buildSyntheticReplay } from "./fixtures/build-fixture.js";

function makeLog(sink: { entries: unknown[] }): ExtractorDeps["log"] {
  return pino(
    { level: "info" },
    { write: (s) => sink.entries.push(JSON.parse(s)) },
  ) as unknown as ExtractorDeps["log"];
}

function turnsToText(turns: readonly ConversationTurn[]): string {
  return turns.map((t) => `[${t.role}]: ${t.content}`).join("\n");
}

describe("compact-extractors seam integration", () => {
  beforeEach(() => {
    resetTier1SentinelTracking();
    resetTier4SentinelTracking();
    resetTier2SentinelTracking();
  });

  it("end-to-end: ≥40% byte reduction on synthetic 6-hour replay (SC-3)", async () => {
    const sink = { entries: [] as unknown[] };
    const log = makeLog(sink);
    const turns = buildSyntheticReplay();
    expect(turns.length).toBeGreaterThanOrEqual(400);

    const deps: ExtractorDeps = {
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [/\bAUM\b/, /\$[0-9]/],
      clock: () => new Date(0),
      log,
      agentName: "fin-acquisition-fixture",
    };

    const { preserved, toCompact } = partitionForVerbatim(turns, deps);
    expect(preserved.length + toCompact.length).toBe(turns.length);

    const toCompactText = turnsToText(toCompact);
    const extract = buildTieredExtractor({
      preserveLastTurns: deps.preserveLastTurns,
      preserveVerbatimPatterns: deps.preserveVerbatimPatterns,
      preservedTurns: preserved,
      clock: deps.clock,
      log: deps.log,
      agentName: deps.agentName,
    });
    const facts = await extract(toCompactText);

    const preCompactBytes = toCompactText.length;
    const postCompactBytes = facts
      .filter((f) => !f.startsWith("[user]") && !f.startsWith("[assistant]"))
      .concat(
        facts.filter(
          (f) => f.startsWith("[user]") || f.startsWith("[assistant]"),
        ),
      )
      .filter((f) => !preserved.some((p) => `[${p.role}]: ${p.content}` === f))
      .join("\n").length;

    const savedRatio = (preCompactBytes - postCompactBytes) / preCompactBytes;
    expect(savedRatio).toBeGreaterThanOrEqual(0.4);
  });

  it("last-N marker survives compaction (Tier 1 regression)", async () => {
    const sink = { entries: [] as unknown[] };
    const log = makeLog(sink);
    const baseTurns = buildSyntheticReplay();
    const MARKER = "MARKER-TOKEN-7H3K9";
    const withMarker: ConversationTurn[] = [...baseTurns];
    const markerIdx = withMarker.length - 3;
    withMarker[markerIdx] = Object.freeze({
      timestamp: withMarker[markerIdx].timestamp,
      role: "assistant",
      content: `${MARKER}: this is the marker turn`,
    });

    const deps: ExtractorDeps = {
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [],
      clock: () => new Date(0),
      log,
      agentName: "marker-agent",
    };
    const { preserved, toCompact } = partitionForVerbatim(withMarker, deps);
    expect(preserved.some((t) => t.content.includes(MARKER))).toBe(true);
    expect(toCompact.some((t) => t.content.includes(MARKER))).toBe(false);

    const extract = buildTieredExtractor({
      preserveLastTurns: deps.preserveLastTurns,
      preserveVerbatimPatterns: deps.preserveVerbatimPatterns,
      preservedTurns: preserved,
      clock: deps.clock,
      log: deps.log,
      agentName: deps.agentName,
    });
    const facts = await extract(turnsToText(toCompact));
    expect(facts.some((f) => f.includes(MARKER))).toBe(true);
  });

  it("SC-8 fixture: AUM and $-prefixed values land in preserved", () => {
    const sink = { entries: [] as unknown[] };
    const log = makeLog(sink);
    const baseTurns = buildSyntheticReplay();
    const injected: ConversationTurn[] = [...baseTurns];
    for (let i = 0; i < 5; i++) {
      injected.splice(
        20 + i * 4,
        0,
        Object.freeze({
          timestamp: "2026-05-14T08:00:00Z",
          role: "user",
          content: `the client AUM stands at ${i} billion`,
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      injected.splice(
        40 + i * 5,
        0,
        Object.freeze({
          timestamp: "2026-05-14T08:00:00Z",
          role: "assistant",
          content: `wire $45M tranche ${i}`,
        }),
      );
    }

    const deps: ExtractorDeps = {
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [/\bAUM\b/, /\$[0-9]/],
      clock: () => new Date(0),
      log,
      agentName: "sc8-agent",
    };
    const { preserved } = partitionForVerbatim(injected, deps);
    const aumCount = preserved.filter((t) => /\bAUM\b/.test(t.content)).length;
    const dollarCount = preserved.filter((t) => /\$[0-9]/.test(t.content)).length;
    expect(aumCount).toBeGreaterThanOrEqual(5);
    expect(dollarCount).toBeGreaterThanOrEqual(3);
  });

  it("tier2 wired: structured facts appear ahead of tier4 chunks (Plan 03)", async () => {
    const sink = { entries: [] as unknown[] };
    const log = makeLog(sink);
    const turns = buildSyntheticReplay().slice(0, 80);
    const { preserved, toCompact } = partitionForVerbatim(turns, {
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [],
      clock: () => new Date(0),
      log,
      agentName: "tier2-wired-agent",
    });

    let onTier2Called = false;
    const cannedYaml = `activeClients: [Finmentum]
decisions:
  - decision: "Move AUM threshold to $45M"
    context: "agreed with Ramy"
standingRulesChanged: []
inFlightTasks: []
drivePathsTouched: ["clients/Finmentum/"]
criticalNumbers:
  - context: "Finmentum AUM"
    value: "$45M"
`;

    const extract = buildTieredExtractor({
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [],
      preservedTurns: preserved,
      clock: () => new Date(0),
      log,
      agentName: "tier2-wired-agent",
      tier2Summarize: async () => cannedYaml,
      onTier2Facts: async () => {
        onTier2Called = true;
      },
    });
    const facts = await extract(turnsToText(toCompact));
    expect(facts.some((f) => f.includes("[tier2] activeClient: Finmentum"))).toBe(
      true,
    );
    expect(facts.some((f) => f.includes("[tier2] criticalNumber: $45M"))).toBe(
      true,
    );
    expect(onTier2Called).toBe(true);

    // Layout: [preservedFacts..., tier2Chunks..., tier4Chunks...].
    // Preserved facts share the `[user]:`/`[assistant]:` prefix; tier4 turns
    // do too — distinguish by Set membership against the preserved list.
    const preservedSet = new Set(
      preserved.map((p) => `[${p.role}]: ${p.content}`),
    );
    const firstTier2 = facts.findIndex((f) => f.startsWith("[tier2]"));
    const firstTier4 = facts.findIndex(
      (f) =>
        (f.startsWith("[user]:") || f.startsWith("[assistant]:")) &&
        !preservedSet.has(f),
    );
    expect(firstTier2).toBeGreaterThanOrEqual(0);
    if (firstTier4 >= 0) {
      const lastTier2 = facts
        .map((f, i) => (f.startsWith("[tier2]") ? i : -1))
        .filter((i) => i >= 0)
        .pop()!;
      expect(lastTier2).toBeLessThan(firstTier4);
    }
  });

  it("tier2 failure (haiku throws): seam still produces Plan 02 output", async () => {
    const sink = { entries: [] as unknown[] };
    const log = makeLog(sink);
    const turns = buildSyntheticReplay().slice(0, 50);
    const { preserved, toCompact } = partitionForVerbatim(turns, {
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [],
      clock: () => new Date(0),
      log,
      agentName: "tier2-fail-agent",
    });

    const extract = buildTieredExtractor({
      preserveLastTurns: 10,
      preserveVerbatimPatterns: [],
      preservedTurns: preserved,
      clock: () => new Date(0),
      log,
      agentName: "tier2-fail-agent",
      tier2Summarize: async () => {
        throw new Error("simulated haiku failure");
      },
    });
    const facts = await extract(turnsToText(toCompact));
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.startsWith("[tier2]"))).toBe(false);
  });

  it("sentinel proof: [125-02-tier1-filter] and [125-02-tier4-drop] each log once", async () => {
    const sink = { entries: [] as unknown[] };
    const log = makeLog(sink);
    const deps: ExtractorDeps = {
      preserveLastTurns: 5,
      preserveVerbatimPatterns: [],
      clock: () => new Date(0),
      log,
      agentName: "sentinel-agent-unique-1",
    };
    const turns = buildSyntheticReplay().slice(0, 50);

    const { preserved, toCompact } = partitionForVerbatim(turns, deps);
    const extract = buildTieredExtractor({
      preserveLastTurns: deps.preserveLastTurns,
      preserveVerbatimPatterns: deps.preserveVerbatimPatterns,
      preservedTurns: preserved,
      clock: deps.clock,
      log: deps.log,
      agentName: deps.agentName,
    });
    await extract(turnsToText(toCompact));
    await extract(turnsToText(toCompact));

    const tier1Hits = sink.entries.filter(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        (e as { sentinel?: string }).sentinel === "125-02-tier1-filter",
    );
    const tier4Hits = sink.entries.filter(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        (e as { sentinel?: string }).sentinel === "125-02-tier4-drop",
    );
    expect(tier1Hits.length).toBe(1);
    expect(tier4Hits.length).toBe(1);
  });
});
