/**
 * Phase 100 Plan 07 — clawcode.yaml admin-clawdy fixture parse-regression tests.
 *
 * Reads the actual on-disk dev `clawcode.yaml` (NOT a synthetic fixture) and
 * parses it through `configSchema`, then asserts the admin-clawdy agent block
 * carries the exact GSD configuration Plan 04 (dispatcher) + Plan 06 (sandbox
 * install) expect.
 *
 * Why on-disk and not a fixture string:
 * - Plan 04 dispatcher tests resolve `agentConfig?.slashCommands.find(...)`
 *   against `this.resolvedAgents` populated from the same yaml the daemon
 *   loads at boot. A drifted dev fixture silently routes long-runners
 *   through the short-runner fall-through path with no spawn occurring.
 * - Plan 06 install helper writes `/opt/clawcode-projects/sandbox/`. The
 *   admin-clawdy `gsd.projectDir` MUST byte-match that target path or
 *   the SDK launches with the wrong cwd.
 * - Plan 02 session-adapter reads `agent.settingSources` verbatim into
 *   `baseOptions.settingSources` for the SDK. `[project, user]` on
 *   admin-clawdy is the trigger that loads `~/.claude/commands/gsd/*.md`
 *   (the symlink target Plan 06 creates).
 *
 * The 8 YML tests pin each one of those contracts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { configSchema, slashCommandEntrySchema } from "../schema.js";

describe("Phase 100 — clawcode.yaml admin-clawdy fixture", () => {
  // Resolve the on-disk yaml from the project root. `process.cwd()` matches
  // vitest's invocation directory which is the project root by convention.
  const yamlPath = join(process.cwd(), "clawcode.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const parsed = yamlParse(raw);
  const config = configSchema.parse(parsed);
  const adminClawdy = config.agents.find((a) => a.name === "admin-clawdy");

  it("YML1 — admin-clawdy entry exists in clawcode.yaml", () => {
    // The dev fixture entry is the parse-test target. The production
    // admin-clawdy lives on the clawdy host's /etc/clawcode/clawcode.yaml
    // and is operator-managed via Plan 08's runbook (NOT this test file).
    expect(adminClawdy).toBeDefined();
    expect(adminClawdy?.name).toBe("admin-clawdy");
  });

  it("YML2 — admin-clawdy.settingSources deep-equals [project, user]", () => {
    // Per CONTEXT.md decision lock-in: only admin-clawdy receives this
    // setting. `[project, user]` triggers the SDK to load
    // ~/.claude/commands/gsd/*.md (symlinked by Plan 06). Drift to
    // `[project]` silently disables every GSD slash command at the SDK
    // boundary even though the dispatcher (Plan 04) thinks it's wired.
    expect(adminClawdy?.settingSources).toEqual(["project", "user"]);
  });

  it("YML3 — admin-clawdy.gsd.projectDir === /opt/clawcode-projects/sandbox", () => {
    // Plan 06's install helper writes the sandbox at this exact absolute
    // path; drift breaks the cwd handoff to the SDK on the first GSD turn.
    expect(adminClawdy?.gsd?.projectDir).toBe("/opt/clawcode-projects/sandbox");
  });

  it("YML4 — admin-clawdy.slashCommands has exactly 5 entries with expected names", () => {
    // The 5-entry roster is locked: 3 long-runners (Plan 04 GSD_LONG_RUNNERS
    // Set membership) + 2 short-runners (fall-through to formatCommandMessage).
    // Drift here cascades into Plan 04's dispatcher tests + Plan 08's smoke-
    // test runbook expectations.
    const names = adminClawdy?.slashCommands.map((c) => c.name) ?? [];
    expect(names).toContain("gsd-autonomous");
    expect(names).toContain("gsd-plan-phase");
    expect(names).toContain("gsd-execute-phase");
    expect(names).toContain("gsd-debug");
    expect(names).toContain("gsd-quick");
    expect(adminClawdy?.slashCommands).toHaveLength(5);
  });

  it("YML5 — claudeCommand templates exactly match Plan 04 dispatcher contract", () => {
    // Plan 04's `formatCommandMessage` substitutes `{phase}`/`{args}`/etc.
    // with the user-supplied STRING option. Any drift in the template body
    // (e.g. forgetting the `:` after `gsd:`) routes the canonical slash to
    // a non-existent skill and the SDK reports "Unknown command".
    const byName = (n: string) => adminClawdy?.slashCommands.find((c) => c.name === n);
    expect(byName("gsd-autonomous")?.claudeCommand).toBe("/gsd:autonomous {args}");
    expect(byName("gsd-plan-phase")?.claudeCommand).toBe("/gsd:plan-phase {phase}");
    expect(byName("gsd-execute-phase")?.claudeCommand).toBe("/gsd:execute-phase {phase}");
    expect(byName("gsd-debug")?.claudeCommand).toBe("/gsd:debug {issue}");
    expect(byName("gsd-quick")?.claudeCommand).toBe("/gsd:quick {task}");
  });

  it("YML6 — only admin-clawdy carries settingSources; other agents stay implicit-default", () => {
    // CONTEXT.md decision lock-in: settingSources `[project, user]` is
    // ONLY on admin-clawdy. Production agents (fin-acquisition,
    // finmentum-content-creator, personal, etc.) keep their schema-default
    // (undefined → loader resolver substitutes ["project"] in Plan 01).
    // Accidental cascade onto fin-* agents would load ~/.claude/commands/
    // for the wrong agents and break the lock-in.
    const others = config.agents.filter((a) => a.name !== "admin-clawdy");
    expect(others.length).toBeGreaterThan(0);
    for (const a of others) {
      // Either undefined (most common — schema-default behavior) OR
      // explicitly ["project"]. Per CONTEXT.md none of the dev fleet
      // sets it explicitly today; this assertion stays permissive in
      // case a future agent adds an explicit `["project"]` for clarity.
      const ok =
        a.settingSources === undefined ||
        (Array.isArray(a.settingSources) &&
          a.settingSources.length > 0 &&
          a.settingSources.every((s) => s === "project"));
      expect(ok, `agent ${a.name} has unexpected settingSources: ${JSON.stringify(a.settingSources)}`).toBe(true);
    }
  });

  it("YML7 — fleet-wide slashCommand count stays under Discord's 90-cmd-per-guild cap", () => {
    // RESEARCH.md Pitfall 5 — Discord caps registered slash commands at 90
    // per guild. Phase 96 deploy was at ~16/90; Phase 100 adds 5 entries
    // landing the dev fixture at ~21/90 worst case. Tracking this limit
    // here surfaces drift before a registration-time runtime failure.
    const total = config.agents.reduce((acc, a) => acc + a.slashCommands.length, 0);
    expect(total).toBeLessThanOrEqual(90);
    // Also confirm we have at least the 5 Phase 100 entries — guards
    // against the inverse drift where the admin-clawdy block is lost.
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it("YML8 — every admin-clawdy slash entry passes slashCommandEntrySchema regex + length cap", () => {
    // slashCommandEntrySchema (src/config/schema.ts:318-323) enforces
    // name max 32 chars + regex /^[\w-]+$/. The longest Phase 100 name
    // is `gsd-execute-phase` (17 chars). Discord-side validation will
    // also reject names violating these rules — we mirror them here so
    // a YAML edit fails the parse-regression before deploy attempts.
    const entries = adminClawdy?.slashCommands ?? [];
    expect(entries.length).toBe(5);
    for (const entry of entries) {
      expect(() => slashCommandEntrySchema.parse(entry)).not.toThrow();
      expect(entry.name).toMatch(/^[\w-]+$/);
      expect(entry.name.length).toBeLessThanOrEqual(32);
      // Description cap (slashCommandEntrySchema.description.max(100)).
      expect(entry.description.length).toBeLessThanOrEqual(100);
      // claudeCommand carries the canonical `/gsd:` template — sanity-check
      // the leading prefix to catch typos that would otherwise only
      // surface at SDK runtime.
      expect(entry.claudeCommand.startsWith("/gsd:")).toBe(true);
    }
  });
});
