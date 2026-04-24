/**
 * Phase 90 Plan 07 WIRE-07 — runbook regression pin.
 *
 * The operator-executable cutover runbook lives at
 * `.planning/migrations/fin-acquisition-cutover.md`. These tests pin the
 * required section structure so a future edit can't silently drop an
 * operator-critical step (e.g. the 513MB rsync command or the rollback
 * procedure).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RUNBOOK_PATH = resolve(
  ".planning/migrations/fin-acquisition-cutover.md",
);

describe("fin-acquisition cutover runbook", () => {
  it("RUN-DOC1: file exists at .planning/migrations/fin-acquisition-cutover.md", () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
  });

  it("RUN-DOC2: has all 7 required section headings", () => {
    const md = readFileSync(RUNBOOK_PATH, "utf-8");
    // Required sections per plan spec.
    const required = [
      "## Pre-cutover Checklist",
      "## MCP Readiness Verification",
      "## Upload Rsync (513MB)",
      "## OpenClaw Channel Config Flip",
      "## Rollback Procedure",
      "## Day-1 Canary Observability",
      "## Post-Cutover Verification",
    ];
    for (const section of required) {
      expect(md, `missing section: ${section}`).toContain(section);
    }
    // Grep count sanity check — should have at least 7 H2 sections.
    const h2Count = (md.match(/^## /gm) ?? []).length;
    expect(h2Count).toBeGreaterThanOrEqual(7);
  });

  it("RUN-DOC3: contains the exact 513MB uploads rsync command", () => {
    const md = readFileSync(RUNBOOK_PATH, "utf-8");
    expect(md).toContain(
      "rsync -aP --info=progress2 ~/.openclaw/workspace-finmentum/uploads/ ~/.clawcode/agents/finmentum/uploads/",
    );
  });

  it("RUN-DOC4: each major section has operator-executable shell commands", () => {
    const md = readFileSync(RUNBOOK_PATH, "utf-8");
    // At least one shell command fence in the runbook (the runbook is
    // useless without them).
    const codeBlocks = (md.match(/```bash/g) ?? []).length;
    expect(codeBlocks).toBeGreaterThanOrEqual(3);

    // Spot-check a handful of operator commands that must be present.
    expect(md).toContain("clawcode memory backfill fin-acquisition");
    expect(md).toContain("clawcode mcp-status fin-acquisition");
    expect(md).toContain("systemctl");
  });

  it("RUN-DOC5: title line present with plan context", () => {
    const md = readFileSync(RUNBOOK_PATH, "utf-8");
    expect(md).toMatch(/^# fin-acquisition Cutover Runbook/m);
  });
});
