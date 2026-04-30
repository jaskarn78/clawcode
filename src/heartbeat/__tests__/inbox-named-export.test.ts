// src/heartbeat/__tests__/inbox-named-export.test.ts
//
// Phase 999.8 Plan 03 — HB-03 regression guard.
//
// daemon.ts:2120 dynamically imports `setInboxSourceActive` from inbox.ts:
//   const { setInboxSourceActive } = await import("../heartbeat/checks/inbox.js");
//
// The new static check-registry consumes only the DEFAULT export. If a future
// refactor accidentally drops the named export (assuming the registry covers
// everything), the daemon crashes at boot when InboxSource registers.
//
// This test is intentionally "born green" — it pins the contract so any
// removal of either export trips the suite.
import { describe, it, expect } from "vitest";
import inboxCheck, { setInboxSourceActive } from "../checks/inbox.js";

describe("inbox.ts export surface (HB-03 regression guard)", () => {
  it("retains the named export `setInboxSourceActive` for daemon.ts:2120", () => {
    expect(typeof setInboxSourceActive).toBe("function");
  });

  it("retains the default export for the heartbeat registry", () => {
    expect(inboxCheck).toBeDefined();
    expect(typeof inboxCheck.name).toBe("string");
    expect(inboxCheck.name).toBe("inbox");
    expect(typeof inboxCheck.execute).toBe("function");
  });
});
