import { describe, it, expect } from "vitest";
import { TOOL_DEFINITIONS } from "./server.js";

describe("TOOL_DEFINITIONS", () => {
  it("defines agent_status tool", () => {
    expect(TOOL_DEFINITIONS.agent_status).toBeDefined();
    expect(TOOL_DEFINITIONS.agent_status.description).toContain("status");
    expect(TOOL_DEFINITIONS.agent_status.ipcMethod).toBe("status");
  });

  it("defines send_message tool", () => {
    expect(TOOL_DEFINITIONS.send_message).toBeDefined();
    expect(TOOL_DEFINITIONS.send_message.description).toContain("message");
    expect(TOOL_DEFINITIONS.send_message.ipcMethod).toBe("send-message");
  });

  it("defines list_schedules tool", () => {
    expect(TOOL_DEFINITIONS.list_schedules).toBeDefined();
    expect(TOOL_DEFINITIONS.list_schedules.description).toContain("scheduled");
    expect(TOOL_DEFINITIONS.list_schedules.ipcMethod).toBe("schedules");
  });

  it("defines list_webhooks tool", () => {
    expect(TOOL_DEFINITIONS.list_webhooks).toBeDefined();
    expect(TOOL_DEFINITIONS.list_webhooks.description).toContain("webhook");
    expect(TOOL_DEFINITIONS.list_webhooks.ipcMethod).toBe("webhooks");
  });

  it("defines list_agents tool", () => {
    expect(TOOL_DEFINITIONS.list_agents).toBeDefined();
    expect(TOOL_DEFINITIONS.list_agents.ipcMethod).toBe("status");
  });

  it("has exactly 6 tools defined", () => {
    expect(Object.keys(TOOL_DEFINITIONS).length).toBe(6);
  });

  it("defines spawn_subagent_thread tool", () => {
    expect(TOOL_DEFINITIONS.spawn_subagent_thread).toBeDefined();
    expect(TOOL_DEFINITIONS.spawn_subagent_thread.description).toContain("subagent");
    expect(TOOL_DEFINITIONS.spawn_subagent_thread.ipcMethod).toBe("spawn-subagent-thread");
  });
});
