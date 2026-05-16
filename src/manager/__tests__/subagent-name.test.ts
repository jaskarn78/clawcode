import { describe, expect, it } from "vitest";
import { isSubagentThreadName, parentAgentName } from "../subagent-name.js";

describe("isSubagentThreadName", () => {
  describe("positive matches (auto-spawned)", () => {
    it("matches delegated pattern: <parent>-via-<delegate>-<nanoid6>", () => {
      expect(
        isSubagentThreadName("fin-acquisition-via-fin-research-57r__G"),
      ).toBe(true);
    });

    it("matches delegated pattern with multi-segment delegate", () => {
      expect(
        isSubagentThreadName(
          "fin-acquisition-via-finmentum-content-creator-4XZKL0",
        ),
      ).toBe(true);
    });

    it("matches direct sub pattern: <parent>-sub-<nanoid6>", () => {
      expect(isSubagentThreadName("fin-acquisition-sub-AbC123")).toBe(true);
    });

    it("matches when nanoid suffix uses underscores and dashes", () => {
      expect(isSubagentThreadName("research-via-general-_-aBc1")).toBe(true);
      expect(isSubagentThreadName("research-via-general-A_b-Cd")).toBe(true);
    });

    it("matches the literal screenshot examples", () => {
      // The two threads from admin-clawdy that motivated this phase.
      expect(
        isSubagentThreadName("fin-acquisition-via-fin-research-57r__G"),
      ).toBe(true);
      expect(
        isSubagentThreadName("fin-acquisition-via-fin-research-4XZKL0"),
      ).toBe(true);
    });
  });

  describe("negative matches (operator-defined names)", () => {
    it("does NOT match a plain operator agent name", () => {
      expect(isSubagentThreadName("fin-acquisition")).toBe(false);
      expect(isSubagentThreadName("personal")).toBe(false);
      expect(isSubagentThreadName("research")).toBe(false);
    });

    it("does NOT match an operator name even if it contains -via-", () => {
      // Operator could legally name an agent "general-via-billing"; only the
      // 6-char nanoid suffix triggers the match.
      expect(isSubagentThreadName("general-via-billing")).toBe(false);
    });

    it("does NOT match when suffix is shorter than 6 chars", () => {
      expect(isSubagentThreadName("foo-via-bar-abc")).toBe(false);
      expect(isSubagentThreadName("foo-sub-abcde")).toBe(false);
    });

    it("does NOT match when suffix is longer than 6 chars (length-pinned)", () => {
      expect(isSubagentThreadName("foo-via-bar-abcdefg")).toBe(false);
      expect(isSubagentThreadName("foo-sub-abcdefg")).toBe(false);
    });

    it("does NOT match an empty or trivial string", () => {
      expect(isSubagentThreadName("")).toBe(false);
      expect(isSubagentThreadName("a")).toBe(false);
      expect(isSubagentThreadName("via-bar-abcdef")).toBe(false); // no parent
    });

    it("does NOT match Admin Clawdy or other names with spaces", () => {
      expect(isSubagentThreadName("Admin Clawdy")).toBe(false);
    });

    it("does NOT match -via- suffix without a delegate segment", () => {
      // "foo-via-abcdef" — the regex requires `via-<delegate>-<6chars>`
      // (delegate is non-empty), so `via-` directly followed by the suffix
      // fails.
      expect(isSubagentThreadName("foo-via-abcdef")).toBe(false);
    });

    it("does NOT match suffix with disallowed characters", () => {
      // nanoid uses [A-Za-z0-9_-] only; a "." or "@" must not match.
      expect(isSubagentThreadName("foo-via-bar-ab.def")).toBe(false);
      expect(isSubagentThreadName("foo-sub-ab@def")).toBe(false);
    });
  });
});

describe("parentAgentName", () => {
  it("strips -sub-<nanoid6> to recover the parent", () => {
    expect(parentAgentName("fin-acquisition-sub-AbC123")).toBe(
      "fin-acquisition",
    );
    expect(parentAgentName("personal-sub-Wo2nHX")).toBe("personal");
  });

  it("strips -via-<delegate>-<nanoid6> to recover the parent", () => {
    expect(parentAgentName("fin-acquisition-via-fin-research-57r__G")).toBe(
      "fin-acquisition",
    );
  });

  it("strips multi-segment delegate suffix back to the root parent", () => {
    // The greedy `.+` in the delegate portion + non-greedy parent capture
    // must still land at the first valid -via- boundary.
    expect(
      parentAgentName("fin-acquisition-via-finmentum-content-creator-4XZKL0"),
    ).toBe("fin-acquisition");
  });

  it("preserves parent names containing spaces", () => {
    expect(parentAgentName("Admin Clawdy-sub-Wo2nHX")).toBe("Admin Clawdy");
    expect(parentAgentName("Admin Clawdy-via-research-2K7cf3")).toBe(
      "Admin Clawdy",
    );
  });

  it("returns operator-defined names unchanged", () => {
    expect(parentAgentName("fin-acquisition")).toBe("fin-acquisition");
    expect(parentAgentName("Admin Clawdy")).toBe("Admin Clawdy");
    expect(parentAgentName("personal")).toBe("personal");
  });

  it("returns operator names containing -via- unchanged (suffix not nanoid)", () => {
    // An operator could legally name an agent "general-via-billing"; the
    // trailing nanoid6 is what makes it a subagent.
    expect(parentAgentName("general-via-billing")).toBe("general-via-billing");
  });

  it("returns unchanged when suffix is wrong length", () => {
    expect(parentAgentName("foo-sub-abcde")).toBe("foo-sub-abcde");
    expect(parentAgentName("foo-sub-abcdefg")).toBe("foo-sub-abcdefg");
  });

  it("handles edge inputs gracefully", () => {
    expect(parentAgentName("")).toBe("");
    expect(parentAgentName("a")).toBe("a");
  });
});
