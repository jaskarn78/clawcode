/**
 * Phase 100 follow-up — clawcode.yaml regression pin for the operator's
 * curated active fleet.
 *
 * Reads the on-disk dev `clawcode.yaml` (NOT a synthetic fixture) and asserts
 * the operator-curated active set:
 *   - fin-acquisition + admin-clawdy → autoStart=true OR omit (default true)
 *   - all other agents → autoStart=false (skip on daemon auto-start)
 *
 * Why on-disk + not a fixture:
 *   - Boot time is the value prop here (24-36s → ~5s when only 2 agents warm).
 *     A drifted dev fixture re-introduces the boot stall on the next deploy.
 *   - Operator yaml edits may add new agents; this test catches an omitted
 *     autoStart=false flag (loud signal — every new agent must explicitly
 *     opt in or out).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { configSchema } from "../schema.js";

describe("Phase 100-fu — clawcode.yaml autoStart curated active fleet", () => {
  const yamlPath = join(process.cwd(), "clawcode.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const parsed = yamlParse(raw);
  const config = configSchema.parse(parsed);

  // The operator's currently-active rotation. These MUST autoStart on daemon
  // boot (either autoStart:true or omitted — the schema default is true).
  const ACTIVE_AGENTS = ["fin-acquisition", "admin-clawdy"] as const;

  // The dormant fleet — configured but not in active rotation. autoStart:false
  // explicitly required. Maps to the operator's plan list (recol-demo is
  // intentionally absent from this yaml so it's not asserted here).
  const DORMANT_AGENTS = [
    "test-agent",
    "personal",
    "fin-playground",
    "finmentum-content-creator",
    "general",
    "projects",
    "research",
    "fin-research",
    "fin-tax",
  ] as const;

  it("AS-YAML-1a: every active agent has autoStart:true OR omits the field (default true)", () => {
    for (const name of ACTIVE_AGENTS) {
      const agent = config.agents.find((a) => a.name === name);
      expect(agent, `agent ${name} missing from clawcode.yaml`).toBeDefined();
      // Schema parse coerces missing → true. Either explicit true or default
      // satisfies the contract.
      expect(
        agent?.autoStart,
        `agent ${name} must autoStart on daemon boot — found ${agent?.autoStart}`,
      ).toBe(true);
    }
  });

  it("AS-YAML-1b: every dormant agent has autoStart:false (operator-curated skip on daemon boot)", () => {
    for (const name of DORMANT_AGENTS) {
      const agent = config.agents.find((a) => a.name === name);
      expect(agent, `agent ${name} missing from clawcode.yaml`).toBeDefined();
      expect(
        agent?.autoStart,
        `agent ${name} must have autoStart:false to skip daemon auto-start — found ${agent?.autoStart}. Add 'autoStart: false' under the agent's yaml block.`,
      ).toBe(false);
    }
  });

  it("AS-YAML-1c: the union of ACTIVE + DORMANT covers every agent in clawcode.yaml (no agent is forgotten)", () => {
    // Forces the operator to make an explicit autoStart decision for every
    // agent. Adding a new agent without updating this test is a loud failure.
    const known = new Set([...ACTIVE_AGENTS, ...DORMANT_AGENTS]);
    const yamlNames = config.agents.map((a) => a.name);
    for (const name of yamlNames) {
      expect(
        known.has(name),
        `agent ${name} is in clawcode.yaml but NOT in this test's ACTIVE/DORMANT lists. Add it to one of them and assert its autoStart explicitly.`,
      ).toBe(true);
    }
  });
});
