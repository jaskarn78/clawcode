import { describe, it, expect } from "vitest";
import type { ResolvedAgentConfig } from "../../shared/types.js";
import {
  buildRoutingTable,
  getAgentForChannel,
  getChannelsForAgent,
} from "../router.js";

/**
 * Helper to build a minimal ResolvedAgentConfig for testing.
 */
function makeAgent(
  name: string,
  channels: string[] = [],
): ResolvedAgentConfig {
  return {
    name,
    workspace: `/tmp/agents/${name}`,
    channels,
    model: "sonnet",
    skills: [],
    soul: undefined,
    identity: undefined,
  };
}

describe("buildRoutingTable", () => {
  it("maps 2 agents with 1 channel each to correct channelToAgent and agentToChannels", () => {
    const configs = [
      makeAgent("alice", ["ch-1"]),
      makeAgent("bob", ["ch-2"]),
    ];
    const table = buildRoutingTable(configs);

    expect(table.channelToAgent.get("ch-1")).toBe("alice");
    expect(table.channelToAgent.get("ch-2")).toBe("bob");
    expect(table.agentToChannels.get("alice")).toEqual(["ch-1"]);
    expect(table.agentToChannels.get("bob")).toEqual(["ch-2"]);
  });

  it("maps 1 agent with 3 channels to all 3 channel IDs (D-08)", () => {
    const configs = [makeAgent("multi", ["ch-a", "ch-b", "ch-c"])];
    const table = buildRoutingTable(configs);

    expect(table.channelToAgent.get("ch-a")).toBe("multi");
    expect(table.channelToAgent.get("ch-b")).toBe("multi");
    expect(table.channelToAgent.get("ch-c")).toBe("multi");
    expect(table.agentToChannels.get("multi")).toEqual(["ch-a", "ch-b", "ch-c"]);
  });

  it("throws when two agents share the same channel ID (Pitfall 1)", () => {
    const configs = [
      makeAgent("alice", ["ch-1"]),
      makeAgent("bob", ["ch-1"]),
    ];

    expect(() => buildRoutingTable(configs)).toThrow(/duplicate/i);
  });

  it("excludes agent with empty channels from agentToChannels without error (Pitfall 4)", () => {
    const configs = [
      makeAgent("active", ["ch-1"]),
      makeAgent("idle", []),
    ];
    const table = buildRoutingTable(configs);

    expect(table.channelToAgent.get("ch-1")).toBe("active");
    expect(table.agentToChannels.has("idle")).toBe(false);
    expect(table.agentToChannels.get("active")).toEqual(["ch-1"]);
  });

  it("returns empty maps for empty configs array", () => {
    const table = buildRoutingTable([]);

    expect(table.channelToAgent.size).toBe(0);
    expect(table.agentToChannels.size).toBe(0);
  });
});

describe("getAgentForChannel", () => {
  it("returns agent name for bound channel, undefined for unbound (D-07)", () => {
    const table = buildRoutingTable([makeAgent("alice", ["ch-1"])]);

    expect(getAgentForChannel(table, "ch-1")).toBe("alice");
    expect(getAgentForChannel(table, "ch-unknown")).toBeUndefined();
  });
});

describe("getChannelsForAgent", () => {
  it("returns channel list for agent, empty array for unknown agent", () => {
    const table = buildRoutingTable([
      makeAgent("alice", ["ch-1", "ch-2"]),
    ]);

    expect(getChannelsForAgent(table, "alice")).toEqual(["ch-1", "ch-2"]);
    expect(getChannelsForAgent(table, "nobody")).toEqual([]);
  });
});
