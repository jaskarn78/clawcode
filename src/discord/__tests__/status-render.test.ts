/**
 * Phase 93 Plan 01 — status-render module unit tests (R-01..R-08).
 *
 * Pins the OpenClaw-parity 9-line `/clawcode-status` field set, with
 * `unknown` / `n/a` placeholders for ClawCode-only gaps (Runner / Fast Mode /
 * Harness / Reasoning / Elevated / Activation / Queue / Context-fill /
 * Compactions / Tokens). Locked decisions:
 *   D-93-01-1 — output ALL lines unconditionally; mark gaps as unknown/n/a.
 *   D-93-01-2 — abbreviated session id (last 12 chars of handle.sessionId).
 *   D-93-01-3 — relative updated-time via date-fns/formatDistanceToNow.
 *   D-93-01-4 — no token-counter plumbing in this phase.
 *
 * Pitfall 6 closure: every accessor in `buildStatusData` is try/catch'd so a
 * thrown SessionError on `getEffortForAgent` collapses to `unknown` instead
 * of dropping the entire render to "Failed to read status".
 *
 * Pitfall 7 closure: emoji literals are canonical-Unicode (no FE0F variation
 * selector); a grep check in the plan's acceptance criteria pins this for
 * status-render.ts itself.
 */
import { describe, it, expect } from "vitest";
import { renderStatus, buildStatusData, type StatusData } from "../status-render.js";
import type { SessionManager } from "../../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";

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
    now: NOW,
    ...overrides,
  };
}

describe("renderStatus — R-01..R-07 line shape", () => {
  it("R-01 happy path renders ALL 9 lines with concrete values", () => {
    const out = renderStatus(makeData()).split("\n");
    expect(out).toHaveLength(9);
    expect(out[0]).toBe("🦞 ClawCode v0.2.0 (abc1234)");
    expect(out[1]).toBe("🧠 Model: sonnet · 🔑 sdk");
    expect(out[2]).toBe("🔄 Fallbacks: n/a");
    expect(out[3]).toBe("📚 Context: unknown · 🧹 Compactions: n/a");
    expect(out[4]).toBe("🧮 Tokens: n/a");
    // Last 12 chars of SAMPLE_SESSION_ID via slice(-12) — assert via computed
    // expected so test stays robust to id-shape drift.
    const expectedSession = `…${SAMPLE_SESSION_ID.slice(-12)}`;
    expect(out[5]).toContain(expectedSession);
    expect(out[5]).toContain(" • updated ");
    expect(out[6]).toBe("📋 Task: idle");
    expect(out[7]).toBe(
      "⚙️ Runtime: SDK session · Runner: n/a · Think: medium · Fast: n/a · Harness: n/a · Reasoning: n/a · Permissions: default · Elevated: n/a",
    );
    expect(out[8]).toBe("👥 Activation: bound-channel · 🪢 Queue: n/a");
  });

  it("R-02 hasActiveTurn=true → Task: busy", () => {
    const out = renderStatus(makeData({ hasActiveTurn: true })).split("\n");
    expect(out[6]).toBe("📋 Task: busy");
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

    const out = renderStatus(data);
    expect(out).not.toContain("Failed to read status");
    expect(out.split("\n")).toHaveLength(9);
  });
});
