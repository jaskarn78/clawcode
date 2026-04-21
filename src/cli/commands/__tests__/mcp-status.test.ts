/**
 * Phase 85 Plan 03 — `clawcode mcp-status` CLI subcommand tests.
 *
 * Pure-function tests for the table formatter + a registration test that
 * confirms commander picks up the new subcommand with its --agent option.
 *
 * Note on naming deviation (Rule 3 — blocking):
 *   The plan called for `clawcode tools`, but `src/cli/commands/tools.ts`
 *   already exists (Phase 55 — per-tool call latency with p50/p95/p99 SLO
 *   reporting). Reusing that name would delete the Phase 55 feature.
 *   The subcommand ships as `clawcode mcp-status` — parallels the existing
 *   `mcp-servers` command and keeps a clear namespace.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";

vi.mock("../../../ipc/client.js", () => ({
  sendIpcRequest: vi.fn(),
}));

import {
  formatMcpStatusTable,
  registerMcpStatusCommand,
  type McpStatusResponse,
} from "../mcp-status.js";
import { sendIpcRequest } from "../../../ipc/client.js";

const mockedSendIpcRequest = vi.mocked(sendIpcRequest);

describe("formatMcpStatusTable", () => {
  it("returns 'No MCP servers configured for x' on empty servers", () => {
    const out = formatMcpStatusTable({ agent: "x", servers: [] });
    expect(out).toBe("No MCP servers configured for x");
  });

  it("renders a 6-column table (AGENT / SERVER / STATUS / LAST SUCCESS / FAILURES / LAST ERROR) with one row per server", () => {
    const now = Date.now();
    const resp: McpStatusResponse = {
      agent: "clawdy",
      servers: [
        {
          name: "1password",
          status: "ready",
          lastSuccessAt: now - 12_000,
          lastFailureAt: null,
          failureCount: 0,
          optional: false,
          lastError: null,
        },
        {
          name: "browser",
          status: "degraded",
          lastSuccessAt: now - 60_000,
          lastFailureAt: now - 1_000,
          failureCount: 1,
          optional: false,
          lastError: "rpc timeout",
        },
        {
          name: "search",
          status: "failed",
          lastSuccessAt: null,
          lastFailureAt: now,
          failureCount: 3,
          optional: false,
          lastError: "Failed to start: ENOENT",
        },
      ],
    };
    const out = formatMcpStatusTable(resp, now);
    // Headers present.
    expect(out).toContain("AGENT");
    expect(out).toContain("SERVER");
    expect(out).toContain("STATUS");
    expect(out).toContain("LAST SUCCESS");
    expect(out).toContain("FAILURES");
    expect(out).toContain("LAST ERROR");
    // Verbatim status strings (no rewording).
    expect(out).toContain("ready");
    expect(out).toContain("degraded");
    expect(out).toContain("failed");
    // Exactly 3 data rows (header + separator + 3 data rows = 5 lines).
    const lines = out.split("\n");
    // Header + separator + 3 data rows = 5 non-empty lines.
    expect(lines.filter((l) => l.length > 0)).toHaveLength(5);
  });

  it("TOOL-04 CLI end-to-end — renders verbatim lastError text in the last-error column", () => {
    const out = formatMcpStatusTable({
      agent: "clawdy",
      servers: [
        {
          name: "search",
          status: "failed",
          lastSuccessAt: null,
          lastFailureAt: Date.now(),
          failureCount: 3,
          optional: false,
          lastError: "Failed to start: ENOENT",
        },
      ],
    });
    expect(out).toContain("Failed to start: ENOENT");
  });

  it("renders relative last-success timestamps (1m ago for 65 seconds back)", () => {
    const now = Date.now();
    const out = formatMcpStatusTable(
      {
        agent: "clawdy",
        servers: [
          {
            name: "1password",
            status: "ready",
            lastSuccessAt: now - 65_000,
            lastFailureAt: null,
            failureCount: 0,
            optional: false,
            lastError: null,
          },
        ],
      },
      now,
    );
    expect(out).toContain("1m ago");
  });

  it("renders 'never' when lastSuccessAt is null", () => {
    const out = formatMcpStatusTable({
      agent: "clawdy",
      servers: [
        {
          name: "search",
          status: "failed",
          lastSuccessAt: null,
          lastFailureAt: Date.now(),
          failureCount: 3,
          optional: false,
          lastError: "boom",
        },
      ],
    });
    expect(out).toContain("never");
  });

  it("annotates optional servers with '(opt)' suffix in the SERVER column", () => {
    const out = formatMcpStatusTable({
      agent: "clawdy",
      servers: [
        {
          name: "image",
          status: "failed",
          lastSuccessAt: null,
          lastFailureAt: Date.now(),
          failureCount: 1,
          optional: true,
          lastError: "no api key",
        },
      ],
    });
    expect(out).toContain("image (opt)");
  });
});

describe("registerMcpStatusCommand", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerMcpStatusCommand(program);
  });

  it("registers a 'mcp-status' command with a required --agent / -a option", () => {
    const cmd = program.commands.find((c) => c.name() === "mcp-status");
    expect(cmd).toBeDefined();
    const optionLongs = cmd!.options.map((o) => o.long);
    expect(optionLongs).toContain("--agent");
    const agentOpt = cmd!.options.find((o) => o.long === "--agent");
    expect(agentOpt).toBeDefined();
    expect(agentOpt!.required).toBe(true);
  });
});
