// src/heartbeat/__tests__/discovery.test.ts
//
// Phase 999.8 Plan 03 — discoverChecks is now a back-compat shim around the
// static CHECK_REGISTRY. The pre-Plan-03 tmpdir + readdir tests were testing
// the (broken-in-prod) dynamic-import behaviour; they no longer apply.
import { describe, it, expect } from "vitest";
import { discoverChecks } from "../discovery.js";
import { CHECK_REGISTRY } from "../check-registry.js";

describe("discoverChecks (Phase 999.8 — static registry)", () => {
  it("returns the static CHECK_REGISTRY regardless of checksDir argument", async () => {
    const result = await discoverChecks("/nonexistent/path");
    expect(result).toBe(CHECK_REGISTRY);
  });

  it("returns 11 modules", async () => {
    const result = await discoverChecks("/any/path");
    expect(result).toHaveLength(11);
  });

  it("ignores the checksDir parameter (back-compat shim)", async () => {
    const a = await discoverChecks("/a");
    const b = await discoverChecks("/b");
    expect(a).toBe(b);
  });
});
