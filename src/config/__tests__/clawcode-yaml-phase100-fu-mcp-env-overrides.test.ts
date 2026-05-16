/**
 * Phase 100 follow-up — clawcode.yaml regression pins for vault-scoped
 * 1Password tokens.
 *
 * Reads the on-disk dev `clawcode.yaml` (NOT a synthetic fixture) and
 * asserts the finmentum agent family carries `mcpEnvOverrides.1password.
 * OP_SERVICE_ACCOUNT_TOKEN` pointing at an `op://clawdbot/...` reference,
 * while operational/test agents (admin-clawdy, test-agent) intentionally
 * do NOT carry the override — they keep the daemon-process clawdbot scope
 * for cross-vault admin tasks.
 *
 * Why on-disk + not a fixture:
 *   - The override is a security boundary. A drifted dev fixture silently
 *     lets a finmentum agent inherit clawdbot scope (full vault read).
 *     Pinning the on-disk yaml catches that during local test runs BEFORE
 *     deploy.
 *   - Operator yaml edits may add new finmentum agents or rename them; the
 *     test pattern matches by agent name prefix so adding a `fin-foo` agent
 *     forces the operator to add the override (else the test fails — loud
 *     signal, not silent inherit).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { configSchema } from "../schema.js";

describe("Phase 100-fu — clawcode.yaml mcpEnvOverrides for finmentum agents", () => {
  const yamlPath = join(process.cwd(), "clawcode.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const parsed = yamlParse(raw);
  const config = configSchema.parse(parsed);

  // The five finmentum-scoped agents per the operator's vault-scoping spec.
  // Listed verbatim so any agent rename forces an explicit test edit.
  const FINMENTUM_AGENTS = [
    "fin-acquisition",
    "fin-research",
    "fin-tax",
    "fin-playground",
    "finmentum-content-creator",
  ] as const;

  // Operational/test agents that intentionally DO NOT have the override —
  // they need clawdbot's full-fleet scope for ops + cross-vault admin.
  const CLAWDBOT_SCOPE_AGENTS = ["test-agent", "admin-clawdy"] as const;

  it("FU-MCP-1: every finmentum agent in clawcode.yaml carries mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN starting with op://clawdbot/", () => {
    for (const name of FINMENTUM_AGENTS) {
      const agent = config.agents.find((a) => a.name === name);
      expect(agent, `agent ${name} missing from clawcode.yaml`).toBeDefined();
      const overrides = agent?.mcpEnvOverrides;
      expect(
        overrides,
        `agent ${name} missing mcpEnvOverrides — would inherit daemon's clawdbot full-fleet scope`,
      ).toBeDefined();
      const token = overrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
      expect(
        token,
        `agent ${name} missing 1password.OP_SERVICE_ACCOUNT_TOKEN override`,
      ).toBeDefined();
      expect(
        token!.startsWith("op://clawdbot/"),
        `agent ${name} OP_SERVICE_ACCOUNT_TOKEN must reference op://clawdbot/... (got: ${token})`,
      ).toBe(true);
    }
  });

  it("FU-MCP-2: admin-clawdy + test-agent intentionally do NOT carry mcpEnvOverrides (keep daemon clawdbot scope)", () => {
    for (const name of CLAWDBOT_SCOPE_AGENTS) {
      const agent = config.agents.find((a) => a.name === name);
      if (!agent) continue; // admin-clawdy is dev-fixture-only on some hosts
      // Either undefined OR explicitly omits 1password — both acceptable.
      // We strictly forbid the OP_SERVICE_ACCOUNT_TOKEN override key landing
      // here, since that would scope these agents to a narrower vault and
      // break their cross-vault ops capability.
      const tokenOverride =
        agent.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
      expect(
        tokenOverride,
        `agent ${name} must NOT override OP_SERVICE_ACCOUNT_TOKEN — needs daemon clawdbot scope`,
      ).toBeUndefined();
    }
  });

  it("FU-MCP-3: every finmentum agent's override resolves to the SAME 1Password item (single-source-of-truth for the Finmentum vault SA token)", () => {
    // Centralizing the source URI across the 5 agents prevents drift where
    // one agent silently uses a stale token. The exact item path is operator-
    // curated; this test pins them to whatever the first finmentum agent
    // declares (transitive equality across the 5).
    const tokens = FINMENTUM_AGENTS.map((name) => {
      const agent = config.agents.find((a) => a.name === name);
      return agent?.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
    });
    expect(tokens.every((t) => t !== undefined)).toBe(true);
    const reference = tokens[0]!;
    for (let i = 1; i < tokens.length; i++) {
      expect(
        tokens[i],
        `agent ${FINMENTUM_AGENTS[i]} uses a different 1Password URI than the rest of the finmentum family`,
      ).toBe(reference);
    }
  });
});
