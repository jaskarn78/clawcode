/**
 * Phase 88 Plan 02 Task 2 — /clawcode-skills-browse inline handler tests (B1-B10).
 *
 * Pins the native StringSelectMenuBuilder picker + single-message ephemeral
 * outcome rendering for marketplace install. Mirrors the Phase 86 Plan 03
 * /clawcode-model test harness shape.
 *
 * Groups:
 *   B1       — unbound channel → no IPC
 *   B2       — empty available list
 *   B3       — picker render (menu options, label, value, description)
 *   B4       — 25-cap overflow
 *   B5-B9    — 5 of the 8 outcome kinds rendered distinctly (MKT-05/MKT-06)
 *   B10      — picker timeout
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
    soul: undefined,
    identity: undefined,
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
    commandName: "clawcode-skills-browse",
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

describe("Phase 88 MKT-01 / UI-01 — /clawcode-skills-browse inline handler", () => {
  beforeEach(() => {
    mockedSendIpcRequest.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("B1: unbound channel → ephemeral 'not bound' reply; no IPC call", async () => {
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

  it("B2: empty available list → ephemeral 'already installed' message; no menu", async () => {
    mockedSendIpcRequest.mockResolvedValue({
      agent: "clawdy",
      installed: ["frontend-design"],
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
    expect(combined).toMatch(/already installed/i);
    // Verify no second IPC (no install) fired
    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(1);
    expect(mockedSendIpcRequest.mock.calls[0]![1]).toBe("marketplace-list");
  });

  it("B3: renders StringSelectMenuBuilder with one option per available entry", async () => {
    mockedSendIpcRequest.mockResolvedValue({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "frontend-design",
          description: "design system",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/fd",
        },
        {
          name: "tuya-ac",
          description: "tuya ac control",
          category: "personal",
          source: "local",
          skillDir: "/tmp/tuya",
        },
        {
          name: "new-reel",
          description: "reel-generator",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/nr",
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

    // editReply (not reply) since we deferred first
    expect(harness.editReply).toHaveBeenCalled();
    const callArg = harness.editReply.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        (c[0] as { components?: unknown }).components !== undefined,
    )?.[0] as {
      content?: string;
      components?: ReadonlyArray<{
        components: ReadonlyArray<{
          options: ReadonlyArray<{ data: { value: string; label: string; description?: string } }>;
        }>;
      }>;
    };
    expect(callArg).toBeDefined();
    expect(callArg.components).toHaveLength(1);
    const menu = callArg.components![0]!.components[0]!;
    expect(menu.options).toHaveLength(3);
    const values = menu.options.map((o) => o.data.value);
    expect(values).toEqual(["frontend-design", "tuya-ac", "new-reel"]);
    // Label includes category suffix (B3 behavior)
    const labels = menu.options.map((o) => o.data.label);
    expect(labels[0]).toMatch(/frontend-design/);
    expect(labels[0]).toMatch(/fleet/);
  });

  it("B4: 25-cap overflow — menu capped at 25 with overflow note in content", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `skill-${String(i).padStart(2, "0")}`,
      description: `desc ${i}`,
      category: "fleet" as const,
      source: "local" as const,
      skillDir: `/tmp/s${i}`,
    }));
    mockedSendIpcRequest.mockResolvedValue({
      agent: "clawdy",
      installed: [],
      available: many,
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

    const callArg = harness.editReply.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        (c[0] as { components?: unknown }).components !== undefined,
    )?.[0] as {
      content: string;
      components: ReadonlyArray<{
        components: ReadonlyArray<{ options: ReadonlyArray<unknown> }>;
      }>;
    };
    expect(callArg.components[0]!.components[0]!.options).toHaveLength(25);
    expect(callArg.content).toMatch(/25 of 30|Showing first 25/i);
  });

  it("B5: select → installed outcome renders path + hot-reload note (single message)", async () => {
    // First call: marketplace-list. Second call: marketplace-install.
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "frontend-design",
            description: "fd",
            category: "fleet",
            source: "local",
            skillDir: "/tmp/fd",
          },
        ],
      })
      .mockResolvedValueOnce({
        outcome: {
          kind: "installed",
          skill: "frontend-design",
          targetPath: "/home/x/.clawcode/skills/frontend-design",
          targetHash: "a".repeat(64),
        },
        rewired: true,
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["frontend-design"],
      user: { id: "user-1" },
      customId: "skills-picker:clawdy:abc123",
      update: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    // Two IPC calls: list + install
    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(2);
    expect(mockedSendIpcRequest.mock.calls[1]![1]).toBe("marketplace-install");
    expect(mockedSendIpcRequest.mock.calls[1]![2]).toEqual({
      agent: "clawdy",
      skill: "frontend-design",
    });

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/installed/i);
    expect(combined).toMatch(/frontend-design/);
    expect(combined).toMatch(/clawdy/);
    expect(combined).toMatch(/\/home\/x\/\.clawcode\/skills\/frontend-design/);
    expect(combined).toMatch(/hot-reload|symlinks refreshed/i);
  });

  it("B6: select → blocked-secret-scan outcome surfaces offender verbatim", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "finmentum-crm",
            description: "crm",
            category: "finmentum",
            source: "local",
            skillDir: "/tmp/fc",
          },
        ],
      })
      .mockResolvedValueOnce({
        outcome: {
          kind: "blocked-secret-scan",
          skill: "finmentum-crm",
          offender: "SKILL.md:20 (high-entropy)",
        },
        rewired: false,
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["finmentum-crm"],
      user: { id: "user-1" },
      customId: "skills-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/finmentum-crm/);
    expect(combined).toMatch(/blocked|secret-scan|refused/i);
    expect(combined).toContain("SKILL.md:20 (high-entropy)");
  });

  it("B7: select → rejected-scope outcome surfaces both scopes + guidance", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "fin-research",
        installed: [],
        available: [
          {
            name: "tuya-ac",
            description: "tuya",
            category: "personal",
            source: "local",
            skillDir: "/tmp/tuya",
          },
        ],
      })
      .mockResolvedValueOnce({
        outcome: {
          kind: "rejected-scope",
          skill: "tuya-ac",
          agent: "fin-research",
          skillScope: "personal",
          agentScope: "finmentum",
        },
        rewired: false,
      });

    const finRouting: RoutingTable = {
      channelToAgent: new Map([["chan-1", "fin-research"]]),
      agentToChannels: new Map([["fin-research", ["chan-1"]]]),
    };
    const handler = makeHandler({
      routingTable: finRouting,
      resolvedAgents: [makeAgent("fin-research")],
    });
    const followUp = {
      values: ["tuya-ac"],
      user: { id: "user-1" },
      customId: "skills-picker:fin-research:abc",
      update: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/tuya-ac/);
    expect(combined).toMatch(/personal/);
    expect(combined).toMatch(/finmentum/);
    // Guidance: some hint about force-scope / CLI / reassign
    expect(combined).toMatch(/force-scope|force|scope/i);
  });

  it("B8: select → rejected-deprecated surfaces reason", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "old-skill",
            description: "deprecated",
            category: "fleet",
            source: "local",
            skillDir: "/tmp/old",
          },
        ],
      })
      .mockResolvedValueOnce({
        outcome: {
          kind: "rejected-deprecated",
          skill: "old-skill",
          reason: "superseded by new-skill in v2.2",
        },
        rewired: false,
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["old-skill"],
      user: { id: "user-1" },
      customId: "skills-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/old-skill/);
    expect(combined).toMatch(/deprecated/i);
    expect(combined).toContain("superseded by new-skill in v2.2");
  });

  it("B9: select → installed-persist-failed surfaces 'installed' + persist warning", async () => {
    mockedSendIpcRequest
      .mockResolvedValueOnce({
        agent: "clawdy",
        installed: [],
        available: [
          {
            name: "frontend-design",
            description: "fd",
            category: "fleet",
            source: "local",
            skillDir: "/tmp/fd",
          },
        ],
      })
      .mockResolvedValueOnce({
        outcome: {
          kind: "installed-persist-failed",
          skill: "frontend-design",
          targetPath: "/home/x/.clawcode/skills/frontend-design",
          targetHash: "a".repeat(64),
          persist_error: "EACCES: permission denied",
        },
        rewired: true,
      });

    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["frontend-design"],
      user: { id: "user-1" },
      customId: "skills-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/installed/i);
    expect(combined).toMatch(/persist|yaml|EACCES/i);
  });

  // ---------------------------------------------------------------------------
  // Phase 93 Plan 02 — ClawHub-aware divider + sentinel filter (SB-93-1..3)
  // ---------------------------------------------------------------------------

  it("SB-93-1 picker interleaves local → divider → clawhub options", async () => {
    mockedSendIpcRequest.mockResolvedValueOnce({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "local-a",
          description: "a",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/a",
        },
        {
          name: "local-b",
          description: "b",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/b",
        },
        {
          name: "remote-x",
          description: "x",
          category: "fleet",
          source: {
            kind: "clawhub",
            baseUrl: "https://clawhub.ai",
            downloadUrl: "https://clawhub.ai/dl/remote-x.tar.gz",
            version: "1.0.0",
          },
          skillDir: "",
        },
        {
          name: "remote-y",
          description: "y",
          category: "fleet",
          source: {
            kind: "clawhub",
            baseUrl: "https://clawhub.ai",
            downloadUrl: "https://clawhub.ai/dl/remote-y.tar.gz",
            version: "1.0.0",
          },
          skillDir: "",
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

    const callArg = harness.editReply.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        (c[0] as { components?: unknown }).components !== undefined,
    )?.[0] as {
      components?: ReadonlyArray<{
        components: ReadonlyArray<{
          options: ReadonlyArray<{
            data: { value: string; label: string; description?: string };
          }>;
        }>;
      }>;
    };
    expect(callArg).toBeDefined();
    const options = callArg.components![0]!.components[0]!.options;
    expect(options).toHaveLength(5);
    expect(options[0]!.data.value).toBe("local-a");
    expect(options[1]!.data.value).toBe("local-b");
    expect(options[2]!.data.value).toBe("__separator_clawhub__");
    expect(options[2]!.data.label).toBe("── ClawHub public ──");
    expect(options[2]!.data.description).toBe("(category divider)");
    expect(options[3]!.data.value).toBe("remote-x");
    expect(options[4]!.data.value).toBe("remote-y");
  });

  it("SB-93-2 selecting the divider does NOT fire marketplace-install", async () => {
    mockedSendIpcRequest.mockResolvedValueOnce({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "local-a",
          description: "a",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/a",
        },
        {
          name: "remote-x",
          description: "x",
          category: "fleet",
          source: {
            kind: "clawhub",
            baseUrl: "https://clawhub.ai",
            downloadUrl: "https://clawhub.ai/dl/remote-x.tar.gz",
            version: "1.0.0",
          },
          skillDir: "",
        },
      ],
    });
    const handler = makeHandler({
      routingTable: boundRouting,
      resolvedAgents: [makeAgent("clawdy")],
    });
    const followUp = {
      values: ["__separator_clawhub__"],
      user: { id: "user-1" },
      customId: "skills-picker:clawdy:abc",
      update: vi.fn().mockResolvedValue(undefined),
    };
    const harness = makeInteraction({
      channelId: "chan-1",
      awaitMessageComponent: async () => followUp,
    });
    await (handler as unknown as {
      handleInteraction: (i: unknown) => Promise<void>;
    }).handleInteraction(harness.interaction);

    // Only marketplace-list was called — NEVER marketplace-install
    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(1);
    expect(mockedSendIpcRequest.mock.calls[0]![1]).toBe("marketplace-list");
    // followUp.update was called with the divider hint
    expect(followUp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/pick a skill, not the divider/i),
        components: [],
      }),
    );
  });

  it("SB-93-3 picker omits divider when zero ClawHub items would render", async () => {
    mockedSendIpcRequest.mockResolvedValueOnce({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "local-a",
          description: "a",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/a",
        },
        {
          name: "local-b",
          description: "b",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/b",
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

    const callArg = harness.editReply.mock.calls.find(
      (c) =>
        typeof c[0] === "object" &&
        (c[0] as { components?: unknown }).components !== undefined,
    )?.[0] as {
      components?: ReadonlyArray<{
        components: ReadonlyArray<{
          options: ReadonlyArray<{ data: { value: string } }>;
        }>;
      }>;
    };
    expect(callArg).toBeDefined();
    const options = callArg.components![0]!.components[0]!.options;
    expect(options).toHaveLength(2);
    const values = options.map((o) => o.data.value);
    expect(values).not.toContain("__separator_clawhub__");
  });

  it("B10: picker timeout → 'timed out'; no install IPC call", async () => {
    mockedSendIpcRequest.mockResolvedValueOnce({
      agent: "clawdy",
      installed: [],
      available: [
        {
          name: "frontend-design",
          description: "fd",
          category: "fleet",
          source: "local",
          skillDir: "/tmp/fd",
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

    // Only marketplace-list was called — no install
    expect(mockedSendIpcRequest).toHaveBeenCalledTimes(1);
    expect(mockedSendIpcRequest.mock.calls[0]![1]).toBe("marketplace-list");

    const combined = extractReplyContent(harness.editReply.mock.calls);
    expect(combined).toMatch(/timed out/i);
  });
});
