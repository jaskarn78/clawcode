import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import {
  scanQuiescentBindings,
  tickSubagentCompletionSweep,
  type RunningSessionInfo,
} from "../subagent-completion-sweep.js";
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

const NOW = 1_700_000_000_000;
const MIN_MS = 60_000;
const SUB_NAME = "fin-acquisition-via-fin-research-AbC123";
const SUB_NAME_2 = "Admin Clawdy-sub-XyZ987";
const OPERATOR_NAME = "fin-acquisition";

function session(
  overrides: Partial<RunningSessionInfo> = {},
): RunningSessionInfo {
  return { name: SUB_NAME, status: "running", ...overrides };
}

function binding(overrides: Partial<ThreadBinding> = {}): ThreadBinding {
  return {
    threadId: "thread-1",
    parentChannelId: "ch-1",
    agentName: SUB_NAME,
    sessionName: SUB_NAME,
    createdAt: NOW - 30 * MIN_MS,
    lastActivity: NOW - 10 * MIN_MS, // 10 min idle by default — past 5min threshold
    ...overrides,
  };
}

const DEFAULT_SCAN = {
  quiescenceMinutes: 5,
  now: NOW,
};

describe("scanQuiescentBindings", () => {
  it("returns a candidate when subagent binding is past the quiescence window", () => {
    const out = scanQuiescentBindings({
      sessions: [session()],
      bindings: [binding()],
      ...DEFAULT_SCAN,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.sessionName).toBe(SUB_NAME);
    expect(out[0]!.threadId).toBe("thread-1");
    expect(out[0]!.idleSec).toBe(10 * 60);
  });

  it("skips bindings where completedAt is already set (idempotence)", () => {
    const out = scanQuiescentBindings({
      sessions: [session()],
      bindings: [binding({ completedAt: NOW - 60_000 })],
      ...DEFAULT_SCAN,
    });
    expect(out).toEqual([]);
  });

  it("skips operator-defined session names (not subagent-shaped)", () => {
    const out = scanQuiescentBindings({
      sessions: [{ name: OPERATOR_NAME, status: "running" }],
      bindings: [
        binding({
          sessionName: OPERATOR_NAME,
          agentName: OPERATOR_NAME,
        }),
      ],
      ...DEFAULT_SCAN,
    });
    expect(out).toEqual([]);
  });

  it("skips bindings whose session is not `running` (skip starting/stopped/etc.)", () => {
    const startingOut = scanQuiescentBindings({
      sessions: [session({ status: "starting" })],
      bindings: [binding()],
      ...DEFAULT_SCAN,
    });
    expect(startingOut).toEqual([]);

    const stoppedOut = scanQuiescentBindings({
      sessions: [session({ status: "stopped" })],
      bindings: [binding()],
      ...DEFAULT_SCAN,
    });
    expect(stoppedOut).toEqual([]);
  });

  it("skips bindings whose session is missing from the registry entirely", () => {
    const out = scanQuiescentBindings({
      sessions: [], // no matching session
      bindings: [binding()],
      ...DEFAULT_SCAN,
    });
    expect(out).toEqual([]);
  });

  it("skips bindings still inside the quiescence window", () => {
    const out = scanQuiescentBindings({
      sessions: [session()],
      bindings: [binding({ lastActivity: NOW - 2 * MIN_MS })], // 2 min idle
      ...DEFAULT_SCAN, // quiescenceMinutes: 5
    });
    expect(out).toEqual([]);
  });

  it("treats completedAt === null as not-completed (back-compat)", () => {
    const out = scanQuiescentBindings({
      sessions: [session()],
      bindings: [binding({ completedAt: null })],
      ...DEFAULT_SCAN,
    });
    expect(out).toHaveLength(1);
  });

  it("returns multiple candidates with stable input order", () => {
    const out = scanQuiescentBindings({
      sessions: [session(), session({ name: SUB_NAME_2 })],
      bindings: [
        binding(),
        binding({
          threadId: "thread-2",
          sessionName: SUB_NAME_2,
          agentName: SUB_NAME_2,
        }),
      ],
      ...DEFAULT_SCAN,
    });
    expect(out.map((c) => c.sessionName)).toEqual([SUB_NAME, SUB_NAME_2]);
  });
});

describe("tickSubagentCompletionSweep", () => {
  let cap: ReturnType<typeof captureLogger>;

  beforeEach(() => {
    cap = captureLogger();
    delete process.env.CLAWCODE_SUBAGENT_COMPLETION_DISABLE;
  });
  afterEach(() => {
    delete process.env.CLAWCODE_SUBAGENT_COMPLETION_DISABLE;
  });

  it("noops when enabled=false", async () => {
    const relayAndMarkCompleted = vi.fn();
    await tickSubagentCompletionSweep({
      sessions: [session()],
      bindings: [binding()],
      ...DEFAULT_SCAN,
      enabled: false,
      log: cap.log,
      relayAndMarkCompleted,
    });
    expect(relayAndMarkCompleted).not.toHaveBeenCalled();
    expect(cap.lines()).toEqual([]);
  });

  it("noops when CLAWCODE_SUBAGENT_COMPLETION_DISABLE=1", async () => {
    process.env.CLAWCODE_SUBAGENT_COMPLETION_DISABLE = "1";
    const relayAndMarkCompleted = vi.fn();
    await tickSubagentCompletionSweep({
      sessions: [session()],
      bindings: [binding()],
      ...DEFAULT_SCAN,
      enabled: true,
      log: cap.log,
      relayAndMarkCompleted,
    });
    expect(relayAndMarkCompleted).not.toHaveBeenCalled();
  });

  it("invokes relayAndMarkCompleted per candidate (happy path)", async () => {
    const relayAndMarkCompleted = vi
      .fn()
      .mockResolvedValue({ ok: true });
    await tickSubagentCompletionSweep({
      sessions: [session(), session({ name: SUB_NAME_2 })],
      bindings: [
        binding(),
        binding({
          threadId: "thread-2",
          sessionName: SUB_NAME_2,
          agentName: SUB_NAME_2,
        }),
      ],
      ...DEFAULT_SCAN,
      enabled: true,
      log: cap.log,
      relayAndMarkCompleted,
    });
    expect(relayAndMarkCompleted).toHaveBeenCalledTimes(2);
    expect(relayAndMarkCompleted).toHaveBeenCalledWith("thread-1");
    expect(relayAndMarkCompleted).toHaveBeenCalledWith("thread-2");

    const lines = cap.lines();
    const relayLogs = lines.filter(
      (l) =>
        l.component === "subagent-completion-sweep" && l.action === "relayed",
    );
    expect(relayLogs).toHaveLength(2);
  });

  it("logs info when relay reports ok=false (race tolerated)", async () => {
    const relayAndMarkCompleted = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "binding-gone" });
    await tickSubagentCompletionSweep({
      sessions: [session()],
      bindings: [binding()],
      ...DEFAULT_SCAN,
      enabled: true,
      log: cap.log,
      relayAndMarkCompleted,
    });
    expect(relayAndMarkCompleted).toHaveBeenCalledTimes(1);
    const lines = cap.lines();
    expect(lines.find((l) => l.action === "skip")).toBeDefined();
    expect(lines.find((l) => l.level === 50)).toBeUndefined(); // no error
  });

  it("logs error level for unexpected throws but does not propagate", async () => {
    const relayAndMarkCompleted = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(
      tickSubagentCompletionSweep({
        sessions: [session()],
        bindings: [binding()],
        ...DEFAULT_SCAN,
        enabled: true,
        log: cap.log,
        relayAndMarkCompleted,
      }),
    ).resolves.toBeUndefined();
    const errors = cap.lines().filter((l) => l.level === 50);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.err).toBe("disk full");
  });

  it("continues to the next candidate after a failure on the first", async () => {
    const relayAndMarkCompleted = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true });
    await tickSubagentCompletionSweep({
      sessions: [session(), session({ name: SUB_NAME_2 })],
      bindings: [
        binding(),
        binding({
          threadId: "thread-2",
          sessionName: SUB_NAME_2,
          agentName: SUB_NAME_2,
        }),
      ],
      ...DEFAULT_SCAN,
      enabled: true,
      log: cap.log,
      relayAndMarkCompleted,
    });
    expect(relayAndMarkCompleted).toHaveBeenCalledTimes(2);
  });
});
