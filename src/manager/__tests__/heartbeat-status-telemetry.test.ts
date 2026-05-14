import { describe, it, expect } from "vitest";
import {
  buildHeartbeatStatusPayload,
  estimateSessionTokens,
} from "../heartbeat-status-builder.js";
import { CompactionEventLog } from "../compaction-event-log.js";
import type { CheckResult } from "../../heartbeat/types.js";

function makeCheckResult(status: "healthy" | "warning" | "critical", message: string): { result: CheckResult; lastChecked: string } {
  return {
    result: { status, message },
    lastChecked: "2026-05-14T20:00:00.000Z",
  };
}

function makeProvider(ratio: number) {
  return { getContextFillPercentage: () => ratio };
}

describe("buildHeartbeatStatusPayload — telemetry surface", () => {
  it("includes session_tokens (rounded from ratio) per agent", () => {
    const results = new Map([
      ["alpha", new Map([["context-fill", makeCheckResult("healthy", "ok")]])],
    ]);
    const zones = new Map();
    const log = new CompactionEventLog();
    const providers = new Map([["alpha", makeProvider(0.5)]]);

    const payload = buildHeartbeatStatusPayload({
      results,
      zoneStatuses: zones,
      getLastCompactionAt: (a) => log.getLastCompactionAt(a),
      getContextFillProvider: (a) => providers.get(a),
    });

    // 0.5 ratio × 200_000 chars / 4 chars-per-token = 25_000 tokens
    expect(payload.agents.alpha.session_tokens).toBe(25_000);
  });

  it("session_tokens is null when no fill provider is wired", () => {
    const results = new Map([
      ["alpha", new Map([["context-fill", makeCheckResult("healthy", "ok")]])],
    ]);
    const payload = buildHeartbeatStatusPayload({
      results,
      zoneStatuses: new Map(),
      getLastCompactionAt: () => null,
      getContextFillProvider: () => undefined,
    });
    expect(payload.agents.alpha.session_tokens).toBeNull();
  });

  it("last_compaction_at is null when no event recorded", () => {
    const results = new Map([
      ["alpha", new Map([["context-fill", makeCheckResult("healthy", "ok")]])],
    ]);
    const payload = buildHeartbeatStatusPayload({
      results,
      zoneStatuses: new Map(),
      getLastCompactionAt: () => null,
      getContextFillProvider: () => undefined,
    });
    expect(payload.agents.alpha.last_compaction_at).toBeNull();
  });

  it("last_compaction_at reflects the most recent recorded ISO", () => {
    const log = new CompactionEventLog();
    log.record("alpha", "2026-05-14T19:50:00.000Z");
    log.record("alpha", "2026-05-14T20:05:00.000Z");

    const results = new Map([
      ["alpha", new Map([["context-fill", makeCheckResult("healthy", "ok")]])],
    ]);

    const payload = buildHeartbeatStatusPayload({
      results,
      zoneStatuses: new Map(),
      getLastCompactionAt: (a) => log.getLastCompactionAt(a),
      getContextFillProvider: () => undefined,
    });

    expect(payload.agents.alpha.last_compaction_at).toBe("2026-05-14T20:05:00.000Z");
  });

  it("emits per-agent isolation — other agents have null", () => {
    const log = new CompactionEventLog();
    log.record("alpha", "2026-05-14T20:00:00.000Z");

    const results = new Map([
      ["alpha", new Map([["context-fill", makeCheckResult("healthy", "ok")]])],
      ["beta", new Map([["context-fill", makeCheckResult("healthy", "ok")]])],
    ]);

    const payload = buildHeartbeatStatusPayload({
      results,
      zoneStatuses: new Map(),
      getLastCompactionAt: (a) => log.getLastCompactionAt(a),
      getContextFillProvider: () => undefined,
    });

    expect(payload.agents.alpha.last_compaction_at).toBe("2026-05-14T20:00:00.000Z");
    expect(payload.agents.beta.last_compaction_at).toBeNull();
  });

  it("preserves existing surface (checks, overall, zone, fillPercentage)", () => {
    const results = new Map([
      ["alpha", new Map([
        ["context-fill", makeCheckResult("warning", "Context fill: 55%")],
      ])],
    ]);
    const zones = new Map([
      ["alpha", { zone: "yellow" as const, fillPercentage: 0.55 }],
    ]);

    const payload = buildHeartbeatStatusPayload({
      results,
      zoneStatuses: zones,
      getLastCompactionAt: () => null,
      getContextFillProvider: () => undefined,
    });

    expect(payload.agents.alpha.zone).toBe("yellow");
    expect(payload.agents.alpha.fillPercentage).toBe(0.55);
    expect(payload.agents.alpha.overall).toBe("warning");
    expect(payload.agents.alpha.checks).toHaveProperty("context-fill");
  });

  it("estimateSessionTokens handles edge cases", () => {
    expect(estimateSessionTokens(undefined)).toBeNull();
    expect(estimateSessionTokens(makeProvider(0))).toBe(0);
    expect(estimateSessionTokens(makeProvider(1))).toBe(50_000);
  });
});
