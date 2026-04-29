/**
 * Phase 93 Plan 01 + Phase 103 Plan 01 — status-render module unit tests.
 *
 * R-01..R-08 (Phase 93): pin the 9-line OpenClaw-parity skeleton.
 * Phase 103 OBS-01/02/03 (this file): pin live-wired fields, OpenClaw-only
 * field drops (Fast/Elevated/Harness), and the in-memory compaction counter.
 *
 * Locked decisions (Phase 93):
 *   D-93-01-1 — output ALL lines unconditionally; mark gaps as unknown/n/a.
 *   D-93-01-2 — abbreviated session id (last 12 chars of handle.sessionId).
 *   D-93-01-3 — relative updated-time via date-fns/formatDistanceToNow.
 *   D-93-01-4 — no token-counter plumbing in Phase 93.
 *
 * Phase 103 changes:
 *   - Tokens, Context %, Compactions, Activation, Queue, Reasoning all wired
 *     to live SessionManager / UsageTracker accessors.
 *   - "Fast: n/a", "Elevated: n/a", "Harness: n/a" substrings DROPPED — the
 *     OpenClaw-only fields have no ClawCode analog.
 *   - "Fallbacks: n/a" REMAINS — no current source.
 *
 * Pitfall 6 closure: every accessor in `buildStatusData` is try/catch'd so a
 * thrown SessionError on `getEffortForAgent` collapses to `unknown` instead
 * of dropping the entire render to "Failed to read status".
 */
import { describe, it, expect } from "vitest";
import { renderStatus, buildStatusData, type StatusData, type BuildStatusDataInput } from "../status-render.js";
import type { SessionManager } from "../../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { UsageAggregate } from "../../usage/types.js";

const SAMPLE_SESSION_ID = "01234567-89ab-cdef-0123-4567890abcdef";
const NOW = new Date("2026-04-24T12:00:00Z").getTime();
const TWENTY_FOUR_MIN_AGO = NOW - 24 * 60 * 1000;

function makeData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    agentName: "fin",
    agentVersion: "0.2.0",
    commitSha: "abc1234",
    liveModel: "sonnet",
    configModel: "sonnet",
    effort: "medium",
    permissionMode: "default",
    sessionId: SAMPLE_SESSION_ID,
    lastActivityAt: TWENTY_FOUR_MIN_AGO,
    hasActiveTurn: false,
    contextFillPercentage: undefined,
    compactionCount: 0,
    tokensIn: undefined,
    tokensOut: undefined,
    activationAt: undefined,
    now: NOW,
    ...overrides,
  };
}

/**
 * Build a stub BuildStatusDataInput with safe defaults for all 8 Pick'd
 * SessionManager accessors. Tests pass a partial override to vary behavior.
 */
type StubInputOverrides = {
  effort?: string;
  liveModel?: string;
  permissionMode?: string;
  sessionId?: string;
  hasActiveTurn?: boolean;
  compactionCount?: number;
  contextFillPercentage?: number | undefined;
  activationAt?: number | undefined;
  sessionUsage?: UsageAggregate | undefined;
  /** When provided AND sessionUsage is set, used as the latest event timestamp. */
  lastEventTs?: string;
  configModel?: string;
};

function makeInput(overrides: StubInputOverrides = {}): BuildStatusDataInput {
  const effort = overrides.effort ?? "medium";
  const liveModel = overrides.liveModel ?? "claude-sonnet-4";
  const permissionMode = overrides.permissionMode ?? "bypass";
  const sessionId = overrides.sessionId ?? SAMPLE_SESSION_ID;
  const hasActiveTurn = overrides.hasActiveTurn ?? false;
  const compactionCount = overrides.compactionCount ?? 0;
  const contextFillPercentage = overrides.contextFillPercentage;
  const activationAt = overrides.activationAt;
  const sessionUsage = overrides.sessionUsage;
  const configModel = overrides.configModel ?? "sonnet";

  // Stub UsageTracker — only present when sessionUsage is provided. The stub
  // exposes getSessionUsage and a minimal getDatabase whose prepare(...).get(...)
  // returns a row with a `ts` field (when lastEventTs is given) so the
  // buildStatusData lastActivityAt path is exercised.
  const usageTracker = sessionUsage !== undefined
    ? {
        getSessionUsage: (_sid: string) => sessionUsage,
        getDatabase: () => ({
          prepare: (_sql: string) => ({
            get: (_param: string) => ({
              ts: overrides.lastEventTs ?? new Date(NOW - 60_000).toISOString(),
            }),
          }),
        }),
      }
    : undefined;

  const sessionManager = {
    getEffortForAgent: (_n: string) => effort,
    getModelForAgent: (_n: string) => liveModel,
    getPermissionModeForAgent: (_n: string) => permissionMode,
    getSessionHandle: (_n: string) =>
      ({
        sessionId,
        hasActiveTurn: () => hasActiveTurn,
      }) as unknown,
    getCompactionCountForAgent: (_n: string) => compactionCount,
    getContextFillPercentageForAgent: (_n: string) => contextFillPercentage,
    getActivationAtForAgent: (_n: string) => activationAt,
    getUsageTracker: (_n: string) => usageTracker,
  } as unknown as Pick<
    SessionManager,
    | "getEffortForAgent"
    | "getModelForAgent"
    | "getPermissionModeForAgent"
    | "getSessionHandle"
    | "getCompactionCountForAgent"
    | "getContextFillPercentageForAgent"
    | "getActivationAtForAgent"
    | "getUsageTracker"
  >;

  const resolvedAgents: readonly ResolvedAgentConfig[] = [
    { name: "fin", model: configModel } as unknown as ResolvedAgentConfig,
  ];

  return {
    sessionManager,
    resolvedAgents,
    agentName: "fin",
    agentVersion: "0.2.0",
    commitSha: "abc1234",
    now: NOW,
  };
}

describe("renderStatus — R-01..R-07 line shape (Phase 93 + 103 reshape)", () => {
  it("R-01 happy path renders ALL 9 lines with concrete values", () => {
    const out = renderStatus(makeData()).split("\n");
    expect(out).toHaveLength(9);
    expect(out[0]).toBe("🦞 ClawCode v0.2.0 (abc1234)");
    expect(out[1]).toBe("🧠 Model: sonnet · 🔑 sdk");
    expect(out[2]).toBe("🔄 Fallbacks: n/a");
    // Phase 103 — Context defaults to "unknown" when fillPercentage undefined,
    // Compactions emits the live count (0 in default fixture).
    expect(out[3]).toBe("📚 Context: unknown · 🧹 Compactions: 0");
    // Phase 103 — Tokens emits "n/a" when tokensIn/Out undefined.
    expect(out[4]).toBe("🧮 Tokens: n/a");
    // Last 12 chars of SAMPLE_SESSION_ID via slice(-12) — assert via computed
    // expected so test stays robust to id-shape drift.
    const expectedSession = `…${SAMPLE_SESSION_ID.slice(-12)}`;
    expect(out[5]).toContain(expectedSession);
    expect(out[5]).toContain(" • updated ");
    expect(out[6]).toBe("📋 Task: idle");
    // Phase 103 — Fast/Harness/Elevated DROPPED; Reasoning is now a label.
    expect(out[7]).toBe(
      "⚙️ Runtime: SDK session · Think: medium · Reasoning: medium effort · Permissions: default",
    );
    // Phase 103 — Activation from registry (undefined → "unknown"); Queue from
    // hasActiveTurn (false → "idle").
    expect(out[8]).toBe("👥 Activation: unknown · 🪢 Queue: idle");
  });

  it("R-02 hasActiveTurn=true → Task: busy AND Queue: 1 in-flight", () => {
    const out = renderStatus(makeData({ hasActiveTurn: true })).split("\n");
    expect(out[6]).toBe("📋 Task: busy");
    expect(out[8]).toContain("🪢 Queue: 1 in-flight");
  });

  it("R-03 liveModel undefined falls back to configModel", () => {
    const out = renderStatus(
      makeData({ liveModel: undefined, configModel: "haiku" }),
    ).split("\n");
    expect(out[1]).toBe("🧠 Model: haiku · 🔑 sdk");
  });

  it("R-04 both models missing → Model: unknown", () => {
    const out = renderStatus(
      makeData({ liveModel: undefined, configModel: undefined }),
    ).split("\n");
    expect(out[1]).toBe("🧠 Model: unknown · 🔑 sdk");
  });

  it("R-05 missing commit sha → (unknown)", () => {
    const out = renderStatus(makeData({ commitSha: undefined })).split("\n");
    expect(out[0]).toBe("🦞 ClawCode v0.2.0 (unknown)");
  });

  it("R-06 missing session id → Session: unknown • updated unknown", () => {
    const out = renderStatus(
      makeData({ sessionId: undefined, lastActivityAt: undefined }),
    ).split("\n");
    expect(out[5]).toBe("🧵 Session: unknown • updated unknown");
  });

  it("R-07 lastActivityAt undefined but sessionId set → updated unknown", () => {
    const out = renderStatus(makeData({ lastActivityAt: undefined })).split("\n");
    expect(out[5]).toBe(
      `🧵 Session: …${SAMPLE_SESSION_ID.slice(-12)} • updated unknown`,
    );
  });
});

describe("buildStatusData — R-08 defensive read", () => {
  it("R-08 throwing accessors collapse to unknown placeholders, NEVER 'Failed to read status'", () => {
    const throwingSm = {
      getEffortForAgent: () => {
        throw new Error("not running");
      },
      getModelForAgent: () => {
        throw new Error("not running");
      },
      getPermissionModeForAgent: () => {
        throw new Error("not running");
      },
      getSessionHandle: () => undefined,
      // Phase 103 — new accessors also throw to validate defensive reads.
      getCompactionCountForAgent: () => {
        throw new Error("not running");
      },
      getContextFillPercentageForAgent: () => {
        throw new Error("not running");
      },
      getActivationAtForAgent: () => {
        throw new Error("not running");
      },
      getUsageTracker: () => {
        throw new Error("not running");
      },
    } as unknown as SessionManager;
    const resolvedAgents: readonly ResolvedAgentConfig[] = [];
    const data = buildStatusData({
      sessionManager: throwingSm,
      resolvedAgents,
      agentName: "ghost",
      agentVersion: "0.2.0",
      commitSha: undefined,
      now: NOW,
    });
    expect(data.liveModel).toBeUndefined();
    expect(data.effort).toBe("unknown");
    expect(data.permissionMode).toBe("unknown");
    expect(data.sessionId).toBeUndefined();
    expect(data.hasActiveTurn).toBe(false);
    // Phase 103 — defensive defaults for new fields.
    expect(data.compactionCount).toBe(0);
    expect(data.contextFillPercentage).toBeUndefined();
    expect(data.activationAt).toBeUndefined();
    expect(data.tokensIn).toBeUndefined();
    expect(data.tokensOut).toBeUndefined();

    const out = renderStatus(data);
    expect(out).not.toContain("Failed to read status");
    expect(out.split("\n")).toHaveLength(9);
  });
});

describe("/clawcode-status — Phase 103 OBS-01/02/03 wiring", () => {
  it("emits Compactions count from getCompactionCountForAgent", () => {
    const out = renderStatus(buildStatusData(makeInput({ compactionCount: 3 })));
    expect(out).toContain("🧹 Compactions: 3");
    expect(out).not.toContain("🧹 Compactions: n/a");
  });

  it("emits Context % from getContextFillPercentageForAgent", () => {
    const out = renderStatus(
      buildStatusData(makeInput({ contextFillPercentage: 0.42 })),
    );
    expect(out).toContain("📚 Context: 42%");
  });

  it("emits Tokens from UsageTracker.getSessionUsage", () => {
    const out = renderStatus(
      buildStatusData(
        makeInput({
          sessionId: "sess-abc-123",
          sessionUsage: {
            tokens_in: 1234,
            tokens_out: 567,
            cost_usd: 0,
            turns: 1,
            duration_ms: 10,
            event_count: 1,
          },
        }),
      ),
    );
    expect(out).toContain("🧮 Tokens: 1234 in / 567 out");
  });

  it("emits Activation relative time from getActivationAtForAgent", () => {
    const oneHourAgo = Date.now() - 3_600_000;
    const out = renderStatus(buildStatusData(makeInput({ activationAt: oneHourAgo })));
    expect(out).toMatch(/👥 Activation: about 1 hour ago/);
  });

  it("emits Queue '1 in-flight' when hasActiveTurn", () => {
    const out = renderStatus(buildStatusData(makeInput({ hasActiveTurn: true })));
    expect(out).toContain("🪢 Queue: 1 in-flight");
  });

  it("emits Queue 'idle' when not hasActiveTurn", () => {
    const out = renderStatus(buildStatusData(makeInput({ hasActiveTurn: false })));
    expect(out).toContain("🪢 Queue: idle");
  });

  it("DOES NOT emit Fast: (OBS-03 OpenClaw drop)", () => {
    const out = renderStatus(buildStatusData(makeInput({})));
    expect(out).not.toContain("Fast:");
  });

  it("DOES NOT emit Elevated: (OBS-03 OpenClaw drop)", () => {
    const out = renderStatus(buildStatusData(makeInput({})));
    expect(out).not.toContain("Elevated:");
  });

  it("DOES NOT emit Harness: (OBS-03 OpenClaw drop)", () => {
    const out = renderStatus(buildStatusData(makeInput({})));
    expect(out).not.toContain("Harness:");
  });

  it("STILL emits Fallbacks: n/a (Research §Summary — no current source)", () => {
    const out = renderStatus(buildStatusData(makeInput({})));
    expect(out).toContain("🔄 Fallbacks: n/a");
  });

  it("renders Reasoning as a label (not n/a)", () => {
    const out = renderStatus(buildStatusData(makeInput({ effort: "medium" })));
    expect(out).toContain("Reasoning: medium effort");
    expect(out).not.toContain("Reasoning: n/a");
  });

  it("renders Compactions: 0 (NOT n/a) when no compactions yet", () => {
    const out = renderStatus(buildStatusData(makeInput({ compactionCount: 0 })));
    expect(out).toContain("🧹 Compactions: 0");
    expect(out).not.toContain("🧹 Compactions: n/a");
  });
});

// Phase 103 OBS-08 — optional 5h+7d bar suffix appended to /clawcode-status
// when rate-limit snapshots are present. Pure helper, lives alongside
// renderStatus so the bar vocabulary stays consistent across surfaces.
import { renderUsageBars } from "../status-render.js";
import type { RateLimitSnapshot } from "../../usage/rate-limit-tracker.js";

function snapshot(overrides: Partial<RateLimitSnapshot>): RateLimitSnapshot {
  return Object.freeze({
    rateLimitType: "five_hour",
    status: "allowed" as const,
    utilization: undefined,
    resetsAt: undefined,
    surpassedThreshold: undefined,
    overageStatus: undefined,
    overageResetsAt: undefined,
    overageDisabledReason: undefined,
    isUsingOverage: undefined,
    recordedAt: Date.now(),
    ...overrides,
  });
}

describe("renderUsageBars (OBS-08)", () => {
  it("returns empty string when no five_hour or seven_day snapshot", () => {
    expect(renderUsageBars([])).toBe("");
    expect(
      renderUsageBars([
        snapshot({ rateLimitType: "seven_day_opus", utilization: 0.5 }),
      ]),
    ).toBe("");
  });

  it("renders 5h session line when five_hour snapshot present", () => {
    const out = renderUsageBars([
      snapshot({
        rateLimitType: "five_hour",
        utilization: 0.5,
        resetsAt: Date.now() + 3_600_000,
      }),
    ]);
    expect(out).toContain("5h session:");
    expect(out).toContain("▓▓▓▓▓░░░░░ 50%");
  });

  it("renders 7-day weekly line when seven_day snapshot present", () => {
    const out = renderUsageBars([
      snapshot({
        rateLimitType: "seven_day",
        utilization: 0.71,
        resetsAt: Date.now() + 86_400_000 * 4,
      }),
    ]);
    expect(out).toContain("7-day weekly:");
    expect(out).toContain("71%");
  });

  it("renders BOTH lines when both snapshots present", () => {
    const out = renderUsageBars([
      snapshot({ rateLimitType: "five_hour", utilization: 0.5 }),
      snapshot({ rateLimitType: "seven_day", utilization: 0.7 }),
    ]);
    expect(out.split("\n").filter((l) => l.length > 0)).toHaveLength(2);
  });

  it("output begins with newline so it appends cleanly to renderStatus", () => {
    const out = renderUsageBars([
      snapshot({ rateLimitType: "five_hour", utilization: 0.5 }),
    ]);
    expect(out.startsWith("\n")).toBe(true);
  });
});
