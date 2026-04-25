import { describe, it, expect, vi } from "vitest";
import type { Logger } from "pino";

/**
 * Phase 94 Plan 03 Task 1 — op-refresh handler tests (RED).
 *
 * Pin matches/recover behavior for D-05 pattern 2:
 *   op:// auth error → re-resolve via `op read` → swap env on the MCP
 *   subprocess (or signals SIGHUP if subprocess supports it) → "recovered".
 */

import type { RecoveryDeps } from "../recovery/types.js";
import { opRefreshHandler } from "../recovery/op-refresh.js";

const noopLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => noopLog,
} as unknown as Logger;

function makeDeps(overrides: Partial<RecoveryDeps> = {}): RecoveryDeps {
  return {
    execFile: overrides.execFile ?? vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    killSubprocess: overrides.killSubprocess ?? vi.fn().mockResolvedValue(undefined),
    adminAlert: overrides.adminAlert ?? vi.fn().mockResolvedValue(undefined),
    opRead: overrides.opRead ?? vi.fn().mockResolvedValue("fresh-secret-value"),
    readEnvForServer: overrides.readEnvForServer ?? vi.fn().mockReturnValue({}),
    writeEnvForServer: overrides.writeEnvForServer ?? vi.fn().mockResolvedValue(undefined),
    now: overrides.now ?? (() => new Date("2026-04-25T12:00:00.000Z")),
    log: overrides.log ?? noopLog,
  };
}

describe("opRefreshHandler", () => {
  it("REC-OP-MATCH: matches op:// auth-error variants", () => {
    expect(
      opRefreshHandler.matches("op://prod/secret/value not authorized", {} as never),
    ).toBe(true);
    expect(
      opRefreshHandler.matches("op://test service account expired", {} as never),
    ).toBe(true);
    expect(
      opRefreshHandler.matches("op://vault/secret token expired", {} as never),
    ).toBe(true);
  });

  it("REC-OP-NO-MATCH: does NOT match unrelated errors", () => {
    expect(opRefreshHandler.matches("socket hang up", {} as never)).toBe(false);
    expect(opRefreshHandler.matches("Executable doesn't exist at /ms-playwright", {} as never)).toBe(false);
    expect(opRefreshHandler.matches("500 internal server error", {} as never)).toBe(false);
  });

  it("REC-OP-RECOVER-OK: opRead resolves + writeEnvForServer succeeds → outcome.kind='recovered'", async () => {
    const opRead = vi.fn().mockImplementation(async (ref: string) => {
      if (ref === "op://prod/api/key") return "fresh-api-key-12345";
      if (ref === "op://prod/db/password") return "fresh-db-pw";
      return "fresh-default";
    });
    const readEnvForServer = vi.fn().mockReturnValue({
      API_KEY: "op://prod/api/key",
      DB_PASSWORD: "op://prod/db/password",
      OTHER: "literal-value",
    });
    const writeEnvForServer = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ opRead, readEnvForServer, writeEnvForServer });

    const outcome = await opRefreshHandler.recover("1password-mcp", deps);
    expect(outcome.kind).toBe("recovered");
    if (outcome.kind === "recovered") {
      expect(outcome.serverName).toBe("1password-mcp");
      expect(outcome.handlerName).toBe("op-refresh");
    }
    // op:// references should each be resolved
    expect(opRead).toHaveBeenCalledWith("op://prod/api/key");
    expect(opRead).toHaveBeenCalledWith("op://prod/db/password");
    // writeEnvForServer should receive the resolved env
    const writeCall = writeEnvForServer.mock.calls[0];
    expect(writeCall?.[0]).toBe("1password-mcp");
    expect(writeCall?.[1].API_KEY).toBe("fresh-api-key-12345");
    expect(writeCall?.[1].DB_PASSWORD).toBe("fresh-db-pw");
    // Literal values pass through unchanged
    expect(writeCall?.[1].OTHER).toBe("literal-value");
  });
});
