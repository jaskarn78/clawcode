/**
 * Phase 83 Plan 03 Task 1 (RED→GREEN) — /clawcode-status daemon-side short-circuit.
 *
 * EFFORT-07: the /clawcode-status reply must include a "🎚️ Effort: <level>"
 * line pulled from sessionManager.getEffortForAgent(agentName). The daemon
 * answers this command directly (no agent turn consumed), mirroring the
 * existing clawcode-effort shortcut at slash-commands.ts:266.
 *
 * Also validates (Test 2): the REST registration body forwards `choices` when
 * present on the option — Discord won't render a dropdown unless the registered
 * command carries the choices field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "pino";
import { SlashCommandHandler } from "../slash-commands.js";
import type { SessionManager } from "../../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { RoutingTable } from "../types.js";

// -- REST mock plumbing ------------------------------------------------------
// We intercept the `new REST().setToken().put(...)` chain used by
// SlashCommandHandler.register() and capture the body sent to Discord.
const putSpy = vi.fn(async () => undefined);

vi.mock("discord.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("discord.js");
  class MockREST {
    setToken(_t: string): this { return this; }
    async put(_route: unknown, opts: { body: unknown }): Promise<unknown> {
      return putSpy(_route, opts);
    }
  }
  return {
    ...actual,
    REST: MockREST,
    Routes: {
      applicationGuildCommands: (appId: string, guildId: string) =>
        `/applications/${appId}/guilds/${guildId}/commands`,
    },
  };
});

// ----------------------------------------------------------------------------

function makeStubLogger(): Logger {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  stub.child.mockReturnValue(stub);
  return stub as unknown as Logger;
}

function makeAgent(name: string): ResolvedAgentConfig {
  return {
    name,
    workspace: `/tmp/${name}`,
    memoryPath: `/tmp/${name}`,
    channels: ["chan-1"],
    model: "haiku",
    effort: "low",
    skills: [],
    soul: undefined,
    identity: undefined,
    slashCommands: [],
    // Fill the rest via `as unknown as` for test ergonomics — the handler only
    // reads `name`, `model`, and `slashCommands` for the status path.
  } as unknown as ResolvedAgentConfig;
}

describe("Phase 83 UI-01 — registration body forwards choices", () => {
  beforeEach(() => {
    putSpy.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes a `choices` field on clawcode-effort.options[0] in the REST body", async () => {
    const agent = makeAgent("clawdy");
    const routingTable: RoutingTable = new Map([["chan-1", "clawdy"]]);
    // Fake Client surface — just enough for register().
    const fakeClient = {
      user: { id: "app-id-1" },
      guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) },
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handler = new SlashCommandHandler({
      routingTable,
      sessionManager: {} as unknown as SessionManager,
      resolvedAgents: [agent],
      botToken: "fake-token",
      client: fakeClient as unknown as Parameters<typeof SlashCommandHandler>[0] extends infer _ ? never : never,
      log: makeStubLogger(),
    } as never);

    await handler.register();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const putArgs = putSpy.mock.calls[0];
    const payload = putArgs[1] as { body: Array<{ name: string; options: Array<{ name: string; choices?: unknown }> }> };
    const effortCmd = payload.body.find((c) => c.name === "clawcode-effort");
    expect(effortCmd).toBeDefined();
    expect(effortCmd!.options).toHaveLength(1);
    const levelOpt = effortCmd!.options[0];
    expect(levelOpt.name).toBe("level");
    expect(levelOpt.choices).toBeDefined();
    // 7 choices, matching EFFORT_CHOICES.
    const choices = levelOpt.choices as Array<{ name: string; value: string }>;
    expect(choices).toHaveLength(7);
    expect(choices.map((c) => c.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "auto",
      "off",
    ]);
  });

  it("does NOT add a `choices` field to options that don't have one (back-compat)", async () => {
    const agent = makeAgent("clawdy");
    const routingTable: RoutingTable = new Map([["chan-1", "clawdy"]]);
    const fakeClient = {
      user: { id: "app-id-1" },
      guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) },
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handler = new SlashCommandHandler({
      routingTable,
      sessionManager: {} as unknown as SessionManager,
      resolvedAgents: [agent],
      botToken: "fake-token",
      client: fakeClient as never,
      log: makeStubLogger(),
    } as never);

    await handler.register();
    const payload = putSpy.mock.calls[0][1] as {
      body: Array<{ name: string; options: Array<{ name: string; choices?: unknown }> }>;
    };
    // clawcode-memory has a `query` option with no choices — it must stay clean.
    const memoryCmd = payload.body.find((c) => c.name === "clawcode-memory");
    expect(memoryCmd).toBeDefined();
    const queryOpt = memoryCmd!.options.find((o) => o.name === "query");
    expect(queryOpt).toBeDefined();
    expect("choices" in queryOpt!).toBe(false);
  });
});

describe("Phase 83 EFFORT-07 — /clawcode-status daemon-side short-circuit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replies with `🎚️ Effort: <level>` pulled from sessionManager.getEffortForAgent", async () => {
    const agent = makeAgent("clawdy");
    const routingTable: RoutingTable = new Map([["chan-1", "clawdy"]]);
    const getEffortForAgent = vi.fn().mockReturnValue("max");
    const sessionManager = {
      getEffortForAgent,
    } as unknown as SessionManager;

    const fakeClient = {
      user: { id: "app-id-1" },
      guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) },
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handler = new SlashCommandHandler({
      routingTable,
      sessionManager,
      resolvedAgents: [agent],
      botToken: "fake-token",
      client: fakeClient as never,
      log: makeStubLogger(),
    } as never);

    // Minimal ChatInputCommandInteraction mock — just the surface our handler uses.
    const editReply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      commandName: "clawcode-status",
      channelId: "chan-1",
      isChatInputCommand: () => true,
      deferReply,
      editReply,
      options: {
        get: () => null,
        getString: () => null,
      },
      user: { id: "user-1" },
      id: "interaction-1",
    };

    // Invoke the private handler via the internal dispatch path used by start().
    // The class exposes the interaction handler via the public interactionCreate
    // callback — to drive it directly in tests we call the private method by
    // name (TypeScript won't stop us here).
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(interaction);

    expect(getEffortForAgent).toHaveBeenCalledWith("clawdy");
    expect(editReply).toHaveBeenCalled();
    // Find the editReply call containing the effort line (may be preceded by
    // an initial "Thinking..." edit on other paths — here short-circuit means
    // one call only, but we assert presence not exclusivity).
    const allContents = editReply.mock.calls.map((c) => String(c[0]));
    const effortLineCall = allContents.find((s) => s.includes("🎚️ Effort: max"));
    expect(effortLineCall).toBeDefined();
  });

  it("includes the agent name and model in the status reply", async () => {
    const agent = makeAgent("clawdy");
    const routingTable: RoutingTable = new Map([["chan-1", "clawdy"]]);
    const getEffortForAgent = vi.fn().mockReturnValue("xhigh");
    const sessionManager = {
      getEffortForAgent,
    } as unknown as SessionManager;

    const fakeClient = {
      user: { id: "app-id-1" },
      guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) },
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handler = new SlashCommandHandler({
      routingTable,
      sessionManager,
      resolvedAgents: [agent],
      botToken: "fake-token",
      client: fakeClient as never,
      log: makeStubLogger(),
    } as never);

    const editReply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      commandName: "clawcode-status",
      channelId: "chan-1",
      isChatInputCommand: () => true,
      deferReply,
      editReply,
      options: {
        get: () => null,
        getString: () => null,
      },
      user: { id: "user-1" },
      id: "interaction-1",
    };

    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(interaction);

    const contents = editReply.mock.calls.map((c) => String(c[0])).join("\n");
    expect(contents).toContain("clawdy");
    // Either "haiku" (model) or "🤖 Model:" prefix should appear.
    expect(contents).toMatch(/(haiku|🤖 Model:)/);
    expect(contents).toContain("🎚️ Effort: xhigh");
  });

  it("gracefully reports failure if getEffortForAgent throws", async () => {
    const agent = makeAgent("clawdy");
    const routingTable: RoutingTable = new Map([["chan-1", "clawdy"]]);
    const getEffortForAgent = vi.fn().mockImplementation(() => {
      throw new Error("agent not running");
    });
    const sessionManager = {
      getEffortForAgent,
    } as unknown as SessionManager;

    const fakeClient = {
      user: { id: "app-id-1" },
      guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) },
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handler = new SlashCommandHandler({
      routingTable,
      sessionManager,
      resolvedAgents: [agent],
      botToken: "fake-token",
      client: fakeClient as never,
      log: makeStubLogger(),
    } as never);

    const editReply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      commandName: "clawcode-status",
      channelId: "chan-1",
      isChatInputCommand: () => true,
      deferReply,
      editReply,
      options: {
        get: () => null,
        getString: () => null,
      },
      user: { id: "user-1" },
      id: "interaction-1",
    };

    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(interaction);

    const contents = editReply.mock.calls.map((c) => String(c[0])).join("\n");
    expect(contents).toMatch(/Failed to read status|agent not running/);
  });
});
