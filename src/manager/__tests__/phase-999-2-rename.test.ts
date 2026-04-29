/**
 * Phase 999.2 Plan 01 — static-grep regression tests pinning the
 * SessionManager.sendToAgent → dispatchTurn rename (D-RNI-01).
 *
 * Pattern: src/ipc/__tests__/protocol.test.ts literal-array pin tests.
 *
 * These tests are the GREEN gate for Plan 01:
 *   - No production .ts file may contain the string "sendToAgent".
 *   - No test .ts file may contain the string "sendToAgent" (catches stale
 *     mocks per RESEARCH.md Pitfall 1 — false-positive mocks if test files
 *     keep the old method name on a mocked SessionManager).
 *   - All 4 production call-site files must contain the new name `dispatchTurn`.
 *   - SessionManager declares `async dispatchTurn`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "glob";

describe("Phase 999.2 Plan 01 — sendToAgent rename complete", () => {
  it("no production file contains the string 'sendToAgent'", async () => {
    const files = await glob("src/**/*.ts", {
      ignore: ["**/__tests__/**", "**/*.test.ts"],
    });
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (text.includes("sendToAgent")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("no test file contains the string 'sendToAgent' (mocks use the new name)", async () => {
    const tests = await glob("src/**/*.test.ts");
    const offenders: string[] = [];
    for (const f of tests) {
      const text = readFileSync(f, "utf8");
      if (text.includes("sendToAgent")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("dispatchTurn appears at all required production call-site files", () => {
    const required = [
      "src/manager/turn-dispatcher.ts",
      "src/manager/daemon.ts",
      "src/manager/escalation.ts",
      "src/heartbeat/checks/inbox.ts",
    ];
    for (const f of required) {
      const text = readFileSync(f, "utf8");
      expect(text, `expected ${f} to contain dispatchTurn`).toMatch(
        /\bdispatchTurn\b/,
      );
    }
  });

  it("SessionManager declares async dispatchTurn", () => {
    const text = readFileSync("src/manager/session-manager.ts", "utf8");
    expect(text).toMatch(/\basync dispatchTurn\b/);
  });
});
