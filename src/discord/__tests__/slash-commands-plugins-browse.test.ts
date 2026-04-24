/**
 * Phase 90 Plan 05 HUB-02 / UI-01 — /clawcode-plugins-browse inline handler tests (SL-P1..P10).
 *
 * Mirrors Phase 88's /clawcode-skills-browse harness shape. Pins the
 * native StringSelectMenuBuilder picker + config modal flow + single-
 * message ephemeral outcome rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "pino";

vi.mock("../../ipc/client.js", () => ({
  sendIpcRequest: vi.fn(),
}));

import { SlashCommandHandler } from "../slash-commands.js";
import { sendIpcRequest } from "../../ipc/client.js";
import type { SessionManager } from "../../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import type { RoutingTable } from "../types.js";
import { DEFAULT_SLASH_COMMANDS } from "../slash-types.js";

const mockedSendIpcRequest = vi.mocked(sendIpcRequest);

function stubLogger(): Logger {
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
    slashCommands: [],
    allowedModels: ["haiku", "sonnet", "opus"],
  } as unknown as ResolvedAgentConfig;
}

function stubSessionManager(): SessionManager {
  return {
    getModelForAgent: vi.fn().mockReturnValue(undefined),
    getEffortForAgent: vi.fn().mockReturnValue("medium"),
  } as unknown as SessionManager;
}

type ReplyMock = ReturnType<typeof vi.fn>;

function makeInteraction(opts: {
  channelId: string;
  awaitMessageComponent?: (args: unknown) => Promise<unknown>;
}): {
  reply: ReplyMock;
  editReply: ReplyMock;
  deferReply: ReplyMock;
  awaitMessageComponent: ReturnType<typeof vi.fn>;
  interaction: unknown;
} {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  const awaitMessageComponent = vi.fn(
    opts.awaitMessageComponent ??
      (async () => {
        throw new Error("awaitMessageComponent not mocked");
      }),
  );

  const interaction = {
    commandName: "clawcode-plugins-browse",
    channelId: opts.channelId,
    isChatInputCommand: () => true,
    reply,
    editReply,
    deferReply,
    channel: { awaitMessageComponent },
    options: {
      get: () => null,
      getString: () => null,
    },
    user: { id: "user-1" },
    id: "interaction-1",
  };

  return { reply, editReply, deferReply, awaitMessageComponent, interaction };
}

function makeHandler(opts: {
  routingTable: RoutingTable;
  resolvedAgents: readonly ResolvedAgentConfig[];
}): SlashCommandHandler {
  const fakeClient = {
    user: { id: "app-id-1" },
    guilds: { cache: new Map([["guild-1", { id: "guild-1" }]]) },
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return new SlashCommandHandler({
    routingTable: opts.routingTable,
    sessionManager: stubSessionManager(),
    resolvedAgents: opts.resolvedAgents,
    botToken: "fake-token",
    client: fakeClient as never,
    log: stubLogger(),
  } as never);
}

const boundRouting: RoutingTable = {
  channelToAgent: new Map([["chan-1", "clawdy"]]),
  agentToChannels: new Map([["clawdy", ["chan-1"]]]),
};

function extractReplyContent(mockCalls: unknown[][]): string {
  return mockCalls
    .map((c) => {
      const first = c[0];
      return typeof first === "string"
        ? first
        : (first as { content?: string }).content ?? "";
    })
    .join("\n");
}

describe("Phase 90 Plan 05 — /clawcode-plugins-browse inline handler", () => {
  beforeEach(() => {
    mockedSendIpcRequest.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SL-P1: DEFAULT_SLASH_COMMANDS contains clawcode-plugins-browse entry AFTER clawcode-skills", () => {
    const names = DEFAULT_SLASH_COMMANDS.map((c) => c.name);
    const skillsIdx = names.indexOf("clawcode-skills");
    const pluginsIdx = names.indexOf("clawcode-plugins-browse");
    expect(pluginsIdx).toBeGreaterThan(-1);
    expect(pluginsIdx).toBeGreaterThan(skillsIdx);
    const pluginsEntry = DEFAULT_SLASH_COMMANDS.find(
      (c) => c.name === "clawcode-plugins-browse",
    )!;
    expect(pluginsEntry.claudeCommand).toBe("");
    expect(pluginsEntry.options).toEqual([]);
  });

  it("SL-P2: unbound channel → ephemeral 'not bound' reply; no IPC call", async () => {
    const handler = makeHandler({
      routingTable: { channelToAgent: new Map(), agentToChannels: new Map() },
      resolvedAgents: [makeAgent("clawdy")],
    });
    const harness = makeInteraction({ channelId: "unbound" });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    expect(mockedSendIpcRequest).not.toHaveBeenCalled();
    const combined = extractReplyContent([
      ...harness.reply.mock.calls,
      ...harness.editReply.mock.calls,
    ]);
    expect(combined).toMatch(/not bound/i);
  });

  it("SL-P3: empty available → 'no ClawHub plugins available' message; no picker", async () => {
    mockedSendIpcRequest.mockResolvedValue({
      agent: "clawdy",
      installed: [],
      available: [],
    });
    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const harness = makeInteraction({ channelId: "chan-1" });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/no clawhub plugins available/i);
    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(1);
    expect(mockedSendIpcRequest.mock.calls[0]![1]).toBe(
      "marketplace-list-plugins",
    );
  });

  it("SL-P4: renders StringSelectMenuBuilder with one option per available plugin", async () => {
    mockedSendIpcRequest.mockResolvedValue({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "finmentum-db",
          latestVersion: "1.0.0",
          displayName: "Finmentum DB",
          summary: "MySQL helper",
        },
        {
          name: "matchclaw",
          latestVersion: "1.2.0",
          displayName: "MatchClaw",
          summary: "Dating assistant",
        },
      ],
    });
    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: () => new Promise(() => {}),
    });
    void (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);
    await new Promise((r) => setTimeout(r, 5));

    expect(harness.editReply).toHaveBeenCalled();
    const callArg = harness.editReply.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        (c[0] as { components?: unknown }).components !== undefined,
    )?.[0] as {
      content?: string;
      components?: ReadonlyArray<{
        components: ReadonlyArray<{
          options: ReadonlyArray<{
            data: { value: string; label: string; description?: string };
          }>;
        }>;
      }>;
    };
    expect(callArg).toBeDefined();
    expect(callArg.components).toHaveLength(1);
    const menu = callArg.components![0]!.components[0]!;
    expect(menu.options).toHaveLength(2);
    const values = menu.options.map((o) => o.data.value);
    expect(values).toEqual(["finmentum-db", "matchclaw"]);
    const labels = menu.options.map((o) => o.data.label);
    expect(labels[0]).toMatch(/Finmentum DB/);
    expect(labels[0]).toMatch(/v1\.0\.0/);
  });

  it("SL-P6: select → installed outcome renders with version + restart note", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "test-plugin",
            latestVersion: "1.2.3",
            displayName: "Test Plugin",
            summary: "test",
          },
        ],
      })
      .mockResolvedValueOnce({
        kind: "installed",
        plugin: "test-plugin",
        pluginVersion: "1.2.3",
        entry: {
          name: "test-plugin",
          command: "my-cmd",
          args: [],
          env: {},
        },
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["test-plugin"],
      user: { id: "user-1" },
      customId: "plugins-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(2);
    expect(mockedSendIpcRequest.mock.calls[1]![1]).toBe(
      "marketplace-install-plugin",
    );
    expect(mockedSendIpcRequest.mock.calls[1]![2]).toMatchObject({
      agent: "clawdy",
      plugin: "test-plugin",
      configInputs: {},
    });

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/installed/i);
    expect(combined).toMatch(/test-plugin/);
    expect(combined).toMatch(/v1\.2\.3/);
    expect(combined).toMatch(/restart/i);
  });

  it("SL-P7: install returns blocked-secret-scan → clear message with field + reason", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "secret-plugin",
            latestVersion: "1.0.0",
            displayName: "Secret",
            summary: "x",
          },
        ],
      })
      .mockResolvedValueOnce({
        kind: "blocked-secret-scan",
        plugin: "secret-plugin",
        field: "MYSQL_PASSWORD",
        reason: "high-entropy",
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["secret-plugin"],
      user: { id: "user-1" },
      customId: "plugins-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/secret-plugin/);
    expect(combined).toMatch(/MYSQL_PASSWORD/);
    expect(combined).toMatch(/secret-scan|refused|blocked/i);
  });

  it("SL-P8: install returns rate-limited → surfaces retry window in seconds", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "busy-plugin",
            latestVersion: "1.0.0",
            displayName: "Busy",
            summary: "x",
          },
        ],
      })
      .mockResolvedValueOnce({
        kind: "rate-limited",
        plugin: "busy-plugin",
        retryAfterMs: 45_000,
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["busy-plugin"],
      user: { id: "user-1" },
      customId: "plugins-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/busy-plugin/);
    expect(combined).toMatch(/rate-limited/i);
    expect(combined).toMatch(/45/);
  });

  it("SL-P9: picker timeout → 'timed out'; no install IPC", async () => {
    mockedSendIpcRequest.mockResolvedValueOnce({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "p",
          latestVersion: "1.0.0",
          displayName: "p",
          summary: "x",
        },
      ],
    });
    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => {
        throw Object.assign(new Error("collector timeout"), {
          name: "InteractionCollectorError",
        });
      },
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(1);
    expect(mockedSendIpcRequest.mock.calls[0]![1]).toBe(
      "marketplace-list-plugins",
    );

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/timed out/i);
  });

  it("SL-P10: handleInteraction ladder — clawcode-plugins-browse fires BEFORE CONTROL_COMMANDS", async () => {
    // Smoke: the interaction reaches handlePluginsBrowseCommand (which
    // needs routingTable) and NOT the CONTROL_COMMANDS dispatcher (which
    // would treat it as unknown and throw). Verified implicitly by
    // SL-P2/P3/P4 above — when unbound, the plugins handler replies with
    // "not bound" (its own error), not an IPC-dispatch error.
    mockedSendIpcRequest.mockResolvedValueOnce({
      agent: "clawdy",
      installed: [],
      available: [],
    });
    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const harness = makeInteraction({ channelId: "chan-1" });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    // The plugins-browse handler fired — it dispatched marketplace-list-plugins.
    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(1);
    expect(mockedSendIpcRequest.mock.calls[0]![1]).toBe(
      "marketplace-list-plugins",
    );
  });
});
