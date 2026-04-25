import { describe, it, expect, vi } from "vitest";
import {
  formatCommandMessage,
  resolveAgentCommands,
  buildFleetEmbed,
  formatUptime,
  handleInterruptSlash,
  handleSteerSlash,
} from "../slash-commands.js";
import { DEFAULT_SLASH_COMMANDS, CONTROL_COMMANDS } from "../slash-types.js";
import type { SlashCommandDef } from "../slash-types.js";
import type { RegistryEntry } from "../../manager/types.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { Logger } from "pino";
import { makeRootOrigin } from "../../manager/turn-origin.js";

describe("formatCommandMessage", () => {
  it("returns claudeCommand as-is when no options are provided", () => {
    const def: SlashCommandDef = {
      name: "status",
      description: "Get status",
      claudeCommand: "Report your current status",
      options: [],
    };
    const result = formatCommandMessage(def, new Map());
    expect(result).toBe("Report your current status");
  });

  it("substitutes {optionName} placeholders with option values", () => {
    const def: SlashCommandDef = {
      name: "memory",
      description: "Search memory",
      claudeCommand: "Search your memory for: {query}",
      options: [
        { name: "query", type: 3, description: "What to search for", required: true },
      ],
    };
    const options = new Map<string, string | number | boolean>([
      ["query", "project deadlines"],
    ]);
    const result = formatCommandMessage(def, options);
    expect(result).toBe("Search your memory for: project deadlines");
  });

  it("appends unmatched options as key: value after the command", () => {
    const def: SlashCommandDef = {
      name: "custom",
      description: "Custom command",
      claudeCommand: "Do something",
      options: [
        { name: "extra", type: 3, description: "Extra info", required: false },
      ],
    };
    const options = new Map<string, string | number | boolean>([
      ["extra", "some value"],
    ]);
    const result = formatCommandMessage(def, options);
    expect(result).toBe("Do something\nextra: some value");
  });
});

describe("resolveAgentCommands", () => {
  it("returns DEFAULT_SLASH_COMMANDS when agent has no custom commands", () => {
    const result = resolveAgentCommands([]);
    expect(result).toEqual(DEFAULT_SLASH_COMMANDS);
  });

  it("overrides default command when agent defines one with the same name", () => {
    const customStatus: SlashCommandDef = {
      name: "clawcode-status",
      description: "Custom status",
      claudeCommand: "Custom status report",
      options: [],
    };
    const result = resolveAgentCommands([customStatus]);
    const statusCmd = result.find((c) => c.name === "clawcode-status");
    expect(statusCmd).toBeDefined();
    expect(statusCmd!.description).toBe("Custom status");
    expect(statusCmd!.claudeCommand).toBe("Custom status report");
    // Other defaults should still be present
    expect(result.length).toBe(DEFAULT_SLASH_COMMANDS.length);
  });
});

function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: "test-agent",
    status: "running",
    sessionId: "sess-1",
    startedAt: Date.now() - 3_600_000, // 1 hour ago
    restartCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastStableAt: Date.now() - 60_000,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ResolvedAgentConfig> = {}): ResolvedAgentConfig {
  return {
    name: "test-agent",
    model: "haiku",
    effort: "high",
    workspace: "/tmp/test",
    channels: ["ch1"],
    systemPrompt: "",
    slashCommands: [],
    ...overrides,
  } as ResolvedAgentConfig;
}

describe("formatUptime", () => {
  it("renders days, hours, minutes", () => {
    // 1 day, 2 hours, 3 minutes
    const ms = (1 * 24 * 60 + 2 * 60 + 3) * 60_000;
    expect(formatUptime(ms)).toBe("1d 2h 3m");
  });

  it("renders only hours and minutes when under 1 day", () => {
    const ms = (5 * 60 + 30) * 60_000;
    expect(formatUptime(ms)).toBe("5h 30m");
  });

  it("renders only minutes when under 1 hour", () => {
    const ms = 15 * 60_000;
    expect(formatUptime(ms)).toBe("15m");
  });

  it("renders 0m for zero milliseconds", () => {
    expect(formatUptime(0)).toBe("0m");
  });
});

describe("buildFleetEmbed", () => {
  it("returns correct structure with title, color, fields, timestamp", () => {
    const entries = [makeEntry()];
    const configs = [makeConfig()];
    const result = buildFleetEmbed(entries, configs);
    expect(result.title).toBe("Fleet Status");
    expect(result.fields).toHaveLength(1);
    expect(result.timestamp).toBeTruthy();
    expect(typeof result.color).toBe("number");
  });

  it("uses green (0x00ff00) when all agents running", () => {
    const entries = [
      makeEntry({ name: "a1", status: "running" }),
      makeEntry({ name: "a2", status: "running" }),
    ];
    const configs = [makeConfig({ name: "a1" }), makeConfig({ name: "a2" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.color).toBe(0x00ff00);
  });

  it("uses red (0xff0000) when any agent is stopped", () => {
    const entries = [
      makeEntry({ name: "a1", status: "running" }),
      makeEntry({ name: "a2", status: "stopped" }),
    ];
    const configs = [makeConfig({ name: "a1" }), makeConfig({ name: "a2" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.color).toBe(0xff0000);
  });

  it("uses yellow (0xffff00) when mixed (running + restarting)", () => {
    const entries = [
      makeEntry({ name: "a1", status: "running" }),
      makeEntry({ name: "a2", status: "restarting" }),
    ];
    const configs = [makeConfig({ name: "a1" }), makeConfig({ name: "a2" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.color).toBe(0xffff00);
  });

  it("uses gray (0x808080) for empty entries", () => {
    const result = buildFleetEmbed([], []);
    expect(result.color).toBe(0x808080);
    expect(result.fields).toHaveLength(0);
  });

  it("includes model from config in field value", () => {
    const entries = [makeEntry({ name: "bot1", status: "running" })];
    const configs = [makeConfig({ name: "bot1", model: "opus" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.fields[0].value).toContain("opus");
  });

  it("shows unknown model when config not found", () => {
    const entries = [makeEntry({ name: "orphan", status: "running" })];
    const result = buildFleetEmbed(entries, []);
    expect(result.fields[0].value).toContain("unknown");
  });

  // -------------------------------------------------------------------------
  // Phase 56 Plan 02 — warm-path suffix
  // -------------------------------------------------------------------------

  it("appends ' \u00B7 warm {ms}ms' for a ready agent with warm_path_readiness_ms", () => {
    const entries = [
      makeEntry({
        name: "warm",
        status: "running",
        warm_path_ready: true,
        warm_path_readiness_ms: 127,
      }),
    ];
    const configs = [makeConfig({ name: "warm" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.fields[0].value).toContain("\u00B7 warm 127ms");
  });

  it("appends ' \u00B7 warming' when readiness_ms is set but ready=false and no warm-path error", () => {
    const entries = [
      makeEntry({
        name: "warming",
        status: "starting",
        warm_path_ready: false,
        warm_path_readiness_ms: 0,
      }),
    ];
    const configs = [makeConfig({ name: "warming" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.fields[0].value).toContain("\u00B7 warming");
  });

  it("appends ' \u00B7 warm-path error' when lastError starts with warm-path:", () => {
    const entries = [
      makeEntry({
        name: "broken",
        status: "failed",
        warm_path_ready: false,
        warm_path_readiness_ms: 10_000,
        lastError: "warm-path: timeout after 10000ms",
      }),
    ];
    const configs = [makeConfig({ name: "broken" })];
    const result = buildFleetEmbed(entries, configs);
    expect(result.fields[0].value).toContain("\u00B7 warm-path error");
  });

  it("adds NO warm-path suffix for legacy entries (backward compat)", () => {
    const entries = [makeEntry({ name: "legacy", status: "running" })];
    const configs = [makeConfig({ name: "legacy" })];
    const result = buildFleetEmbed(entries, configs);
    // Suffix markers must not appear when fields are absent.
    expect(result.fields[0].value).not.toContain("\u00B7 warm ");
    expect(result.fields[0].value).not.toContain("\u00B7 warming");
    expect(result.fields[0].value).not.toContain("warm-path error");
  });
});

// ---------------------------------------------------------------------------
// Quick task 260419-nic — /clawcode-interrupt + /clawcode-steer handlers
// ---------------------------------------------------------------------------

/** Minimal Logger stub — pino has a rich interface we don't need for pure handlers. */
function makeStubLogger(): {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
} {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  stub.child.mockReturnValue(stub);
  return stub;
}

describe("slash /clawcode-interrupt + /clawcode-steer", () => {
  // -------------------------------------------------------------------------
  // T1-T3 — handleInterruptSlash
  // -------------------------------------------------------------------------

  it("T1: handleInterruptSlash hadActiveTurn=true, interrupted=true → '🛑 Stopped {agent} mid-turn.'", async () => {
    const interruptAgent = vi
      .fn()
      .mockResolvedValue({ interrupted: true, hadActiveTurn: true });
    const log = makeStubLogger();

    const reply = await handleInterruptSlash({
      agentName: "clawdy",
      interruptAgent,
      log: log as unknown as Logger,
    });
    expect(reply).toBe("🛑 Stopped clawdy mid-turn.");
    expect(interruptAgent).toHaveBeenCalledWith("clawdy");
    expect(interruptAgent).toHaveBeenCalledTimes(1);
    // Info log fires on success path.
    const infoCall = log.info.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "slash_interrupt_ok",
    );
    expect(infoCall).toBeDefined();
  });

  it("T2: handleInterruptSlash hadActiveTurn=false → 'No active turn for {agent}.'", async () => {
    const interruptAgent = vi
      .fn()
      .mockResolvedValue({ interrupted: false, hadActiveTurn: false });
    const log = makeStubLogger();

    const reply = await handleInterruptSlash({
      agentName: "idle-bot",
      interruptAgent,
      log: log as unknown as Logger,
    });
    expect(reply).toBe("No active turn for idle-bot.");
  });

  it("T3: handleInterruptSlash interruptAgent throws → returns 'Error: could not interrupt {agent}: {message}'", async () => {
    const interruptAgent = vi
      .fn()
      .mockRejectedValue(new Error("kaboom"));
    const log = makeStubLogger();

    const reply = await handleInterruptSlash({
      agentName: "broken-bot",
      interruptAgent,
      log: log as unknown as Logger,
    });
    expect(reply).toBe("Error: could not interrupt broken-bot: kaboom");
    expect(log.warn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T4-T6 — handleSteerSlash
  // -------------------------------------------------------------------------

  it("T4: handleSteerSlash happy path — interrupts, waits for clear, dispatches [USER STEER] {guidance}", async () => {
    const interruptAgent = vi
      .fn()
      .mockResolvedValue({ interrupted: true, hadActiveTurn: true });
    // hasActiveTurn flips from true → false after the first poll.
    let pollCount = 0;
    const hasActiveTurn = vi.fn(() => {
      pollCount += 1;
      return pollCount <= 1;
    });
    const dispatch = vi.fn().mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = makeStubLogger();

    const reply = await handleSteerSlash({
      agentName: "clawdy",
      guidance: "actually just say hi",
      channelId: "chan-42",
      interactionId: "int-1",
      interruptAgent,
      hasActiveTurn,
      dispatch,
      log: log as unknown as Logger,
      sleep,
    });

    expect(interruptAgent).toHaveBeenCalledWith("clawdy");
    expect(interruptAgent).toHaveBeenCalledTimes(1);
    // Dispatch must fire with a discord-origin + [USER STEER] prefix.
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [origin, name, msg] = dispatch.mock.calls[0]!;
    expect((origin as { source: { kind: string } }).source.kind).toBe("discord");
    expect(name).toBe("clawdy");
    expect(msg).toMatch(/^\[USER STEER\] /);
    expect(msg).toContain("actually just say hi");

    expect(reply).toBe("↩ Steered clawdy. New response coming in this channel.");
  });

  it("T5: handleSteerSlash — hasActiveTurn still true after 2000ms → log.warn, still dispatches", async () => {
    const interruptAgent = vi
      .fn()
      .mockResolvedValue({ interrupted: true, hadActiveTurn: true });
    const hasActiveTurn = vi.fn(() => true); // never flips
    const dispatch = vi.fn().mockResolvedValue("ok");
    // Fake sleep advances Date.now so the poll loop terminates at the deadline.
    const startAt = Date.now();
    let virtualNow = startAt;
    const sleep = vi.fn(async (ms: number) => {
      virtualNow += ms;
    });
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => virtualNow);
    const log = makeStubLogger();

    try {
      const reply = await handleSteerSlash({
        agentName: "stuck-bot",
        guidance: "unstick yourself",
        channelId: "chan-stuck",
        interactionId: "int-stuck",
        interruptAgent,
        hasActiveTurn,
        dispatch,
        log: log as unknown as Logger,
        sleep,
      });

      // Still dispatched (proceed-anyway).
      expect(dispatch).toHaveBeenCalledTimes(1);
      // Warn log captured.
      const warnCall = log.warn.mock.calls.find((c) =>
        String(c[1] ?? "").includes("did not clear"),
      );
      expect(warnCall).toBeDefined();
      expect(reply).toBe(
        "↩ Steered stuck-bot. New response coming in this channel.",
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("T6: handleSteerSlash — dispatch throws → 'Error: could not steer {agent}: {message}'", async () => {
    const interruptAgent = vi
      .fn()
      .mockResolvedValue({ interrupted: false, hadActiveTurn: false });
    const hasActiveTurn = vi.fn(() => false);
    const dispatch = vi.fn().mockRejectedValue(new Error("dispatch-fail"));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = makeStubLogger();

    const reply = await handleSteerSlash({
      agentName: "clawdy",
      guidance: "go left",
      channelId: "chan-err",
      interactionId: "int-err",
      interruptAgent,
      hasActiveTurn,
      dispatch,
      log: log as unknown as Logger,
      sleep,
    });

    expect(reply).toBe("Error: could not steer clawdy: dispatch-fail");
    expect(log.warn).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T7 — CONTROL_COMMANDS shape + count invariants
  // -------------------------------------------------------------------------

  it("T7: CONTROL_COMMANDS includes clawcode-interrupt + clawcode-steer; total default+control = 18 (Phase 90 Plan 06 added clawhub-auth)", () => {
    const interrupt = CONTROL_COMMANDS.find((c) => c.name === "clawcode-interrupt");
    const steer = CONTROL_COMMANDS.find((c) => c.name === "clawcode-steer");
    expect(interrupt).toBeDefined();
    expect(steer).toBeDefined();

    // Descriptions must be < 100 chars (Discord limit).
    for (const cmd of CONTROL_COMMANDS) {
      expect(cmd.description.length).toBeLessThan(100);
    }

    // clawcode-interrupt: optional agent only.
    expect(interrupt!.ipcMethod).toBe("interrupt-agent");
    expect(interrupt!.control).toBe(true);
    expect(interrupt!.options).toHaveLength(1);
    expect(interrupt!.options[0]!.name).toBe("agent");
    expect(interrupt!.options[0]!.required).toBe(false);

    // clawcode-steer: required guidance + optional agent.
    expect(steer!.ipcMethod).toBe("steer-agent");
    expect(steer!.control).toBe(true);
    expect(steer!.options).toHaveLength(2);
    const guidanceOpt = steer!.options.find((o) => o.name === "guidance");
    expect(guidanceOpt).toBeDefined();
    expect(guidanceOpt!.required).toBe(true);
    const agentOpt = steer!.options.find((o) => o.name === "agent");
    expect(agentOpt).toBeDefined();
    expect(agentOpt!.required).toBe(false);

    // Combined count = 22 (10 default + 12 control).
    // Phase 87 CMD-04 removed clawcode-compact + clawcode-usage from defaults.
    // Phase 88 added skills-browse + skills. Phase 90 Plan 05 added
    // plugins-browse. Phase 90 Plan 06 added clawhub-auth.
    // Phase 91 Plan 05 SYNC-08 added clawcode-sync-status → 9 controls.
    // Phase 92 Plan 04 CUT-06 added clawcode-cutover-verify → 10 controls.
    // Phase 95 Plan 03 DREAM-07 added clawcode-dream → 11 controls.
    // Phase 96 Plan 05 D-03 added clawcode-probe-fs → 12 controls.
    expect(DEFAULT_SLASH_COMMANDS.length + CONTROL_COMMANDS.length).toBe(22);

    // Sanity — makeRootOrigin still accepts 'discord' (used by handleSteerSlash).
    const origin = makeRootOrigin("discord", "chan-xyz");
    expect(origin.source.kind).toBe("discord");
  });
});
