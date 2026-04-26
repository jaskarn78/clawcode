/**
 * Phase 100 follow-up — auto-inheritance of GSD slash commands.
 *
 * Pins the registration-time merge: when ANY agent has `gsd?.projectDir` set,
 * the GSD_SLASH_COMMANDS constant gets injected into the per-guild REST body.
 * When NO agent has gsd.projectDir, no /gsd-* entries appear in the body.
 *
 * Pins (3 tests):
 *   GSR-1  At least one GSD-enabled agent → all 19 GSD commands registered
 *   GSR-2  No GSD-enabled agent → no /gsd-* commands registered
 *   GSR-3  Multiple GSD-enabled agents → 19 GSD commands appear ONCE (deduped)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResolvedAgentConfig } from "../../shared/types.js";

// Hoisted REST.put spy (mirrors slash-commands-register.test.ts pattern).
const { restPutSpy } = vi.hoisted(() => ({
  restPutSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("discord.js", async () => {
  const actual = await vi.importActual<typeof import("discord.js")>("discord.js");
  class MockREST {
    setToken(_token: string): this {
      return this;
    }
    put(route: string, opts: { body: unknown }): Promise<void> {
      return restPutSpy(route, opts);
    }
  }
  return {
    ...actual,
    REST: MockREST,
  };
});

import { SlashCommandHandler } from "../slash-commands.js";
import { GSD_SLASH_COMMANDS } from "../slash-types.js";
import type { SessionManager } from "../../manager/session-manager.js";

function makeAgent(opts: {
  name: string;
  gsd?: { projectDir: string };
}): ResolvedAgentConfig {
  return {
    name: opts.name,
    workspace: `/tmp/${opts.name}`,
    memoryPath: `/tmp/${opts.name}`,
    channels: [],
    model: "sonnet",
    effort: "low",
    skills: [],
    soul: undefined,
    identity: undefined,
    slashCommands: [],
    settingSources: ["project"],
    gsd: opts.gsd,
    allowedModels: ["haiku", "sonnet", "opus"],
  } as unknown as ResolvedAgentConfig;
}

function makeSessionManagerStub(): SessionManager {
  return {
    getSessionHandle(_name: string) {
      return undefined;
    },
  } as unknown as SessionManager;
}

describe("Phase 100 follow-up — auto-inheritance of GSD_SLASH_COMMANDS at register time", () => {
  beforeEach(() => {
    restPutSpy.mockClear();
    restPutSpy.mockResolvedValue(undefined);
  });

  it("GSR-1: at least one GSD-enabled agent → all 19 GSD commands appear in REST body", async () => {
    const agent = makeAgent({
      name: "Admin Clawdy",
      gsd: { projectDir: "/opt/clawcode-projects/sandbox" },
    });
    const client = {
      user: { id: "bot-123" },
      guilds: { cache: new Map([["guild-1", {}]]) },
    } as unknown as import("discord.js").Client;

    const handler = new SlashCommandHandler({
      routingTable: { channelToAgent: new Map(), agentToChannels: new Map() },
      sessionManager: makeSessionManagerStub(),
      resolvedAgents: [agent],
      botToken: "test-token",
      client,
    } as never);

    await handler.register();

    expect(restPutSpy).toHaveBeenCalledTimes(1);
    const [_route, opts] = restPutSpy.mock.calls[0]!;
    const body = (opts as { body: Array<{ name: string }> }).body;
    const names = new Set(body.map((b) => b.name));

    // Every GSD_SLASH_COMMANDS entry must appear in the REST body
    for (const gsdCmd of GSD_SLASH_COMMANDS) {
      expect(names.has(gsdCmd.name)).toBe(true);
    }
  });

  it("GSR-2: NO GSD-enabled agent → no /gsd-* commands appear in REST body", async () => {
    const agent = makeAgent({ name: "personal" });
    const client = {
      user: { id: "bot-123" },
      guilds: { cache: new Map([["guild-1", {}]]) },
    } as unknown as import("discord.js").Client;

    const handler = new SlashCommandHandler({
      routingTable: { channelToAgent: new Map(), agentToChannels: new Map() },
      sessionManager: makeSessionManagerStub(),
      resolvedAgents: [agent],
      botToken: "test-token",
      client,
    } as never);

    await handler.register();

    expect(restPutSpy).toHaveBeenCalledTimes(1);
    const [_route, opts] = restPutSpy.mock.calls[0]!;
    const body = (opts as { body: Array<{ name: string }> }).body;
    const names = body.map((b) => b.name);
    const gsdEntries = names.filter((n) => n.startsWith("gsd-"));
    expect(gsdEntries).toEqual([]);
  });

  it("GSR-3: multiple GSD-enabled agents → 19 GSD commands appear exactly ONCE (deduped)", async () => {
    const adminClawdy = makeAgent({
      name: "Admin Clawdy",
      gsd: { projectDir: "/opt/clawcode-projects/sandbox" },
    });
    const finAcq = makeAgent({
      name: "fin-acquisition",
      gsd: { projectDir: "/home/jjagpal/.openclaw/workspace-finmentum" },
    });
    const client = {
      user: { id: "bot-123" },
      guilds: { cache: new Map([["guild-1", {}]]) },
    } as unknown as import("discord.js").Client;

    const handler = new SlashCommandHandler({
      routingTable: { channelToAgent: new Map(), agentToChannels: new Map() },
      sessionManager: makeSessionManagerStub(),
      resolvedAgents: [adminClawdy, finAcq],
      botToken: "test-token",
      client,
    } as never);

    await handler.register();

    expect(restPutSpy).toHaveBeenCalledTimes(1);
    const [_route, opts] = restPutSpy.mock.calls[0]!;
    const body = (opts as { body: Array<{ name: string }> }).body;
    const gsdNames = body.map((b) => b.name).filter((n) => n.startsWith("gsd-"));
    // Each GSD command name must appear exactly once
    for (const gsdCmd of GSD_SLASH_COMMANDS) {
      const count = gsdNames.filter((n) => n === gsdCmd.name).length;
      expect(count).toBe(1);
    }
  });
});
