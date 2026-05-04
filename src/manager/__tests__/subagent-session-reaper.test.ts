import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import {
  scanForSubagentSessions,
  tickSubagentSessionReaper,
  type RunningSessionInfo,
} from "../subagent-session-reaper.js";
import type { ThreadBinding } from "../../discord/thread-types.js";

function captureLogger() {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  const log = pino({ level: "debug" }, sink);
  const lines = () =>
    chunks
      .join("")
      .split("\n")
      .filter((s) => s.length > 0)
      .map((s) => JSON.parse(s) as Record<string, unknown>);
  return { log, lines };
}

const NOW = 1_700_000_000_000; // arbitrary fixed epoch ms
const HOUR_MS = 60 * 60 * 1000;
const SUB_NAME = "fin-acquisition-via-fin-research-57r__G";
const SUB_NAME_2 = "fin-acquisition-via-fin-research-4XZKL0";
const OPERATOR_NAME = "fin-acquisition";

function session(
  overrides: Partial<RunningSessionInfo> = {},
): RunningSessionInfo {
  return {
    name: SUB_NAME,
    status: "running",
    startedAt: NOW - 14 * HOUR_MS, // 14h old by default — past minAge
    ...overrides,
  };
}

function binding(overrides: Partial<ThreadBinding> = {}): ThreadBinding {
  return {
    threadId: "thread-1",
    parentChannelId: "ch-1",
    agentName: SUB_NAME,
    sessionName: SUB_NAME,
    createdAt: NOW - 14 * HOUR_MS,
    lastActivity: NOW - 13 * HOUR_MS, // 13h ago — beyond default 24h? no, not yet
    ...overrides,
  };
}

const DEFAULT_SCAN = {
  idleTimeoutMinutes: 1440, // 24h
  minAgeSeconds: 300, // 5 min
  now: NOW,
};

describe("scanForSubagentSessions", () => {
  it("returns the orphan-binding case (session running, no binding)", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session()],
      bindings: [],
      ...DEFAULT_SCAN,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe(SUB_NAME);
    expect(candidates[0]!.threadId).toBeNull();
    expect(candidates[0]!.lastActivityAgeSec).toBeNull();
    expect(candidates[0]!.ageSec).toBe(14 * 60 * 60);
  });

  it("returns the idle-binding case (lastActivity > idleTimeout)", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session()],
      bindings: [binding({ lastActivity: NOW - 25 * HOUR_MS })], // 25h ago
      ...DEFAULT_SCAN,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.threadId).toBe("thread-1");
    expect(candidates[0]!.lastActivityAgeSec).toBe(25 * 60 * 60);
  });

  it("does NOT return when binding lastActivity is fresh", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session()],
      bindings: [binding({ lastActivity: NOW - 5 * 60 * 1000 })], // 5 min ago
      ...DEFAULT_SCAN,
    });
    expect(candidates).toEqual([]);
  });

  it("does NOT return operator-defined session names (no -nanoid6 suffix)", () => {
    const candidates = scanForSubagentSessions({
      sessions: [
        {
          name: OPERATOR_NAME,
          status: "running",
          startedAt: NOW - 30 * HOUR_MS,
        },
      ],
      bindings: [], // missing binding would otherwise trigger orphan-prune
      ...DEFAULT_SCAN,
    });
    expect(candidates).toEqual([]);
  });

  it("skips sessions in `starting` status (race guard)", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session({ status: "starting" })],
      bindings: [],
      ...DEFAULT_SCAN,
    });
    expect(candidates).toEqual([]);
  });

  it("skips sessions younger than minAgeSeconds", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session({ startedAt: NOW - 60 * 1000 })], // 1 min old
      bindings: [],
      ...DEFAULT_SCAN, // minAgeSeconds=300
    });
    expect(candidates).toEqual([]);
  });

  it("skips sessions whose startedAt is null (defensive)", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session({ startedAt: null })],
      bindings: [],
      ...DEFAULT_SCAN,
    });
    expect(candidates).toEqual([]);
  });

  it("returns multiple candidates with stable ordering by input position", () => {
    const candidates = scanForSubagentSessions({
      sessions: [session(), session({ name: SUB_NAME_2 })],
      bindings: [],
      ...DEFAULT_SCAN,
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.name).toBe(SUB_NAME);
    expect(candidates[1]!.name).toBe(SUB_NAME_2);
  });

  it("handles screenshot-shape: two orphan subagent sessions, both reaped", () => {
    // The literal admin-clawdy 2026-05-04 fleet state:
    //   fin-acquisition-via-fin-research-57r__G — 13h 56m
    //   fin-acquisition-via-fin-research-4XZKL0 —  8h 45m
    const candidates = scanForSubagentSessions({
      sessions: [
        session({ name: SUB_NAME, startedAt: NOW - 13.93 * HOUR_MS }),
        session({ name: SUB_NAME_2, startedAt: NOW - 8.75 * HOUR_MS }),
      ],
      bindings: [], // orphan — the screenshot scenario
      ...DEFAULT_SCAN,
    });
    expect(candidates.map((c) => c.name)).toEqual([SUB_NAME, SUB_NAME_2]);
  });
});

describe("tickSubagentSessionReaper", () => {
  let cap: ReturnType<typeof captureLogger>;

  beforeEach(() => {
    cap = captureLogger();
    delete process.env.CLAWCODE_SUBAGENT_REAPER_DISABLE;
  });
  afterEach(() => {
    delete process.env.CLAWCODE_SUBAGENT_REAPER_DISABLE;
  });

  it("noops when mode is 'off'", async () => {
    const stopAgent = vi.fn();
    await tickSubagentSessionReaper({
      sessions: [session()],
      bindings: [],
      ...DEFAULT_SCAN,
      mode: "off",
      log: cap.log,
      stopAgent,
    });
    expect(stopAgent).not.toHaveBeenCalled();
    expect(cap.lines()).toEqual([]);
  });

  it("noops when CLAWCODE_SUBAGENT_REAPER_DISABLE=1", async () => {
    process.env.CLAWCODE_SUBAGENT_REAPER_DISABLE = "1";
    const stopAgent = vi.fn();
    await tickSubagentSessionReaper({
      sessions: [session()],
      bindings: [],
      ...DEFAULT_SCAN,
      mode: "reap",
      log: cap.log,
      stopAgent,
    });
    expect(stopAgent).not.toHaveBeenCalled();
  });

  it("alert mode emits warn per candidate but does NOT stop", async () => {
    const stopAgent = vi.fn();
    await tickSubagentSessionReaper({
      sessions: [session(), session({ name: SUB_NAME_2 })],
      bindings: [],
      ...DEFAULT_SCAN,
      mode: "alert",
      log: cap.log,
      stopAgent,
    });
    expect(stopAgent).not.toHaveBeenCalled();
    const alerts = cap.lines().filter(
      (l) =>
        l.component === "subagent-session-reaper" && l.action === "alert",
    );
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.mode).toBe("alert");
    expect(alerts[0]!.msg).toBe("subagent session candidate detected");
  });

  it("reap mode emits alert+reap and calls stopAgent for each candidate", async () => {
    const stopAgent = vi.fn().mockResolvedValue(undefined);
    await tickSubagentSessionReaper({
      sessions: [session(), session({ name: SUB_NAME_2 })],
      bindings: [],
      ...DEFAULT_SCAN,
      mode: "reap",
      log: cap.log,
      stopAgent,
    });
    expect(stopAgent).toHaveBeenCalledTimes(2);
    expect(stopAgent).toHaveBeenCalledWith(SUB_NAME);
    expect(stopAgent).toHaveBeenCalledWith(SUB_NAME_2);
    const lines = cap.lines();
    expect(
      lines.filter((l) => l.action === "alert").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      lines.filter((l) => l.action === "reap").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("tolerates `not running` race silently (info log, no error)", async () => {
    const stopAgent = vi.fn().mockRejectedValueOnce(
      new Error("Agent 'fin-acquisition-via-fin-research-57r__G' is not running"),
    );
    await tickSubagentSessionReaper({
      sessions: [session()],
      bindings: [],
      ...DEFAULT_SCAN,
      mode: "reap",
      log: cap.log,
      stopAgent,
    });
    const lines = cap.lines();
    expect(lines.find((l) => l.level === 50)).toBeUndefined(); // no error level
    expect(
      lines.find(
        (l) =>
          l.level === 30 && // info
          l.action === "reap" &&
          typeof l.msg === "string" &&
          l.msg.includes("already stopped"),
      ),
    ).toBeDefined();
  });

  it("logs error level for unexpected stopAgent failures", async () => {
    const stopAgent = vi.fn().mockRejectedValueOnce(new Error("disk full"));
    await tickSubagentSessionReaper({
      sessions: [session()],
      bindings: [],
      ...DEFAULT_SCAN,
      mode: "reap",
      log: cap.log,
      stopAgent,
    });
    const errors = cap.lines().filter((l) => l.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.action).toBe("reap");
    expect(errors[0]!.err).toBe("disk full");
  });

  it("does not throw when stopAgent rejects (callers wire this into setInterval)", async () => {
    const stopAgent = vi.fn().mockRejectedValueOnce(new Error("boom"));
    await expect(
      tickSubagentSessionReaper({
        sessions: [session()],
        bindings: [],
        ...DEFAULT_SCAN,
        mode: "reap",
        log: cap.log,
        stopAgent,
      }),
    ).resolves.toBeUndefined();
  });
});
