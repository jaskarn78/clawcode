/**
 * Phase 100 GSD-10 — SMOKE-TEST.md structural validation.
 *
 * The runbook itself is the deliverable; this test pins its structure so
 * accidental drift (missing section, leftover TODO, etc.) is caught at
 * vitest run time before the operator attempts the deploy procedure on
 * clawdy.
 *
 * 10 tests covering:
 *   SMK1  — file exists
 *   SMK2  — 9 numbered sections (h2 headings)
 *   SMK3  — references `clawcode gsd install` (Plan 06 hand-off)
 *   SMK4  — references each of the 5 GSD slash command names (Plan 04 hand-off)
 *   SMK5  — no TODO / TBD / placeholder markers
 *   SMK6  — mentions Phase 99-M relay or Plan 100-05 artifact paths
 *   SMK7  — has a rollback section
 *   SMK8  — UAT-100-A / UAT-100-B / UAT-100-C acceptance markers present
 *   SMK9  — references the production clawdy host / systemd unit / install path
 *   SMK10 — file size between 200 and 600 lines
 *
 * autonomous=false on the plan reflects the UAT sections (6-8) requiring
 * operator interaction in #admin-clawdy on production Discord. The runbook
 * AUTHORING is fully automatable — these tests prove the runbook is
 * well-formed; operator runs it manually per Plan 08 contract.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Phase 100 — SMOKE-TEST.md runbook structure", () => {
  const docPath = join(
    process.cwd(),
    ".planning/phases/100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow/SMOKE-TEST.md",
  );

  it("SMK1 — SMOKE-TEST.md file exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  // Read once (after SMK1 confirms existence) — all subsequent assertions
  // operate on this captured string.
  const content = existsSync(docPath) ? readFileSync(docPath, "utf-8") : "";

  it("SMK2 — has all 9 sections (h2 headings 1-9)", () => {
    // Loose match — accept "## Section 1:", "## 1.", "## Step 1:", or "## 1 —" forms.
    for (let i = 1; i <= 9; i++) {
      expect(content).toMatch(
        new RegExp(
          `^##\\s+(Section\\s+)?${i}\\b|^##\\s+Step\\s+${i}\\b`,
          "m",
        ),
      );
    }
  });

  it("SMK3 — references `clawcode gsd install` CLI command (Plan 06 hand-off)", () => {
    expect(content).toMatch(/clawcode gsd install/);
  });

  it("SMK4 — references each of the 5 GSD slash command names (Plan 04 hand-off)", () => {
    expect(content).toMatch(/gsd-autonomous/);
    expect(content).toMatch(/gsd-plan-phase/);
    expect(content).toMatch(/gsd-execute-phase/);
    expect(content).toMatch(/gsd-debug/);
    expect(content).toMatch(/gsd-quick/);
  });

  it("SMK5 — no TODO / TBD / PLACEHOLDER markers in active content", () => {
    // Operator-runnable runbooks cannot have unresolved placeholders.
    expect(content).not.toMatch(/\bTODO\b/);
    expect(content).not.toMatch(/\bTBD\b/);
    expect(content).not.toMatch(/<PLACEHOLDER>/);
    // Mustache-style unresolved templates ({{FOO_BAR}}) — exempt YAML
    // template tokens like {phase} / {args} which are valid Plan 04
    // claudeCommand substitution syntax.
    expect(content).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("SMK6 — mentions Phase 99-M relay or Plan 100-05 artifact paths", () => {
    expect(content).toMatch(/Phase 99-?M|Plan 100-05|Artifacts written|Artifacts:/);
  });

  it("SMK7 — includes a rollback section", () => {
    expect(content.toLowerCase()).toMatch(/rollback/);
  });

  it("SMK8 — includes UAT acceptance markers (UAT-100-A, UAT-100-B, UAT-100-C)", () => {
    expect(content).toMatch(/UAT-100-A/);
    expect(content).toMatch(/UAT-100-B/);
    expect(content).toMatch(/UAT-100-C/);
  });

  it("SMK9 — references the production clawdy host / systemd unit / install path", () => {
    // Accept any concrete clawdy identifier per memory note
    // `reference_clawcode_server.md`. The runbook should pick at least one.
    expect(content).toMatch(/clawdy|clawcode\.service|\/opt\/clawcode/);
  });

  it("SMK10 — runbook size is reasonable (200-600 lines)", () => {
    const lines = content.split("\n").length;
    expect(lines).toBeGreaterThanOrEqual(200);
    expect(lines).toBeLessThanOrEqual(600);
  });
});
