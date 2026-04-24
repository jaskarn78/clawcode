/**
 * Phase 91 Plan 06 — runbook structure regression pin (sync sections).
 *
 * The Phase 90-07 runbook at `.planning/migrations/fin-acquisition-cutover.md`
 * is extended by Phase 91 Plan 06 with 5 new sections covering the
 * continuous-sync runner (SSH key provisioning, systemd timer install,
 * cutover flip, 7-day rollback window, operator-observable logs).
 *
 * These tests pin the required structure so a future edit can't silently
 * drop an operator-critical step. Mirrors the RUN-DOC1..DOC5 pattern from
 * Phase 90-07 `src/__tests__/runbook-fin-acquisition.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RUNBOOK_PATH = resolve(
  ".planning/migrations/fin-acquisition-cutover.md",
);

describe("Phase 91 runbook structure regression (RUN-SYNC-*)", () => {
  it("RUN-SYNC-01: contains Phase 91 top-level section", () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    expect(content).toContain("## Phase 91: Continuous Workspace Sync");
  });

  it("RUN-SYNC-02: has all 5 required subsections (A..E)", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    expect(content).toMatch(/^### A\. SSH Key Provisioning/m);
    expect(content).toMatch(/^### B\. Systemd Timer Installation/m);
    expect(content).toMatch(/^### C\. Sync Cutover Flip Procedure/m);
    expect(content).toMatch(/^### D\. 7-Day Rollback Window Checklist/m);
    expect(content).toMatch(/^### E\. Operator-Observable Logs/m);
  });

  it("RUN-SYNC-03: SSH provisioning has ssh-keygen + authorized_keys + Tailscale verification", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // ssh-keygen command present verbatim (ed25519 per SSH best practice).
    expect(content).toContain("ssh-keygen -t ed25519");
    // authorized_keys manipulation present.
    expect(content).toContain("authorized_keys");
    // OpenClaw Tailscale IP referenced.
    expect(content).toContain("100.71.14.96");
    // BatchMode verification present — this is how the operator confirms
    // password-less auth is working without an interactive prompt.
    expect(content).toContain("BatchMode=yes");
    // Tailscale verification present (`100.x` IP in the remote response).
    expect(content).toMatch(/100\\?\.x|inet 100/);
  });

  it("RUN-SYNC-04: systemd section installs both timers + enables lingering + daemon-reload", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // Both timer unit files.
    expect(content).toContain("clawcode-sync.timer");
    expect(content).toContain("clawcode-translator.timer");
    // Both service unit files.
    expect(content).toContain("clawcode-sync.service");
    expect(content).toContain("clawcode-translator.service");
    // Lingering enablement — required for user-systemd without active login.
    expect(content).toContain("loginctl enable-linger clawcode");
    // Enable + start sequence.
    expect(content).toContain("systemctl --user enable --now clawcode-sync.timer");
    expect(content).toContain("systemctl --user enable --now clawcode-translator.timer");
    // daemon-reload after install.
    expect(content).toMatch(/systemctl --user daemon-reload/);
    // list-timers verification step.
    expect(content).toContain("list-timers");
  });

  it("RUN-SYNC-05: cutover procedure includes --confirm-cutover + flag verification", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // Exact CLI command operator must run.
    expect(content).toContain(
      "sync set-authoritative clawcode --confirm-cutover",
    );
    // Flag verification via jq on sync-state.json.
    expect(content).toContain("authoritativeSide");
    expect(content).toContain("sync-state.json");
    // Drain-then-flip semantics documented.
    expect(content).toMatch(/drain|Drain/);
    // Reverse-sync opt-in reference.
    expect(content).toContain("sync start --reverse");
  });

  it("RUN-SYNC-06: 7-day window has --revert-cutover + --force-rollback + finalize", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // Revert command within window.
    expect(content).toContain("--revert-cutover");
    // Force escape hatch after window.
    expect(content).toContain("--force-rollback");
    // Finalize command.
    expect(content).toContain("sync finalize");
    // The 7-day window is called out explicitly.
    expect(content).toMatch(/7[- ]day|7 days/);
  });

  it("RUN-SYNC-07: observability section references sync.jsonl + journalctl + /clawcode-sync-status", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // JSONL log path.
    expect(content).toContain(
      "/home/clawcode/.clawcode/manager/sync.jsonl",
    );
    // journalctl for service logs.
    expect(content).toContain("journalctl");
    // Discord slash command surface.
    expect(content).toContain("/clawcode-sync-status");
    // admin-clawdy channel ID for conflict alerts.
    expect(content).toContain("1494117043367186474");
    // Filter-file reference (regression-test citation).
    expect(content).toContain("clawcode-sync-filter.txt");
  });

  it("RUN-SYNC-08: phase 90 runbook sections preserved (regression — do NOT overwrite)", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // Phase 90-07 runbook shipped 306 lines; Phase 91 appends ~400 more.
    // Combined must be substantially larger than either alone.
    expect(content.length).toBeGreaterThan(10_000);
    // Phase 90 sections must survive.
    expect(content).toContain("## Pre-cutover Checklist");
    expect(content).toContain("## MCP Readiness Verification");
    expect(content).toContain("## Upload Rsync (513MB)");
    expect(content).toContain("## Rollback Procedure");
    // The original rsync command is pinned.
    expect(content).toContain(
      "rsync -aP --info=progress2 ~/.openclaw/workspace-finmentum/uploads/ ~/.clawcode/agents/finmentum/uploads/",
    );
    // And the original title is intact.
    expect(content).toMatch(/^# fin-acquisition Cutover Runbook/m);
  });

  it("RUN-SYNC-09: has enough shell commands to be operator-executable", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // Count bash fences. Phase 90 had ~3+; Phase 91 sections add at least
    // 10 more (A: 6, B: 6, C: 5, D: 5, E: 5). Combined >= 15.
    const codeBlocks = (content.match(/```bash/g) ?? []).length;
    expect(codeBlocks).toBeGreaterThanOrEqual(15);
  });

  it("RUN-SYNC-10: references the rsync filter file (regression-pin citation)", () => {
    const content = readFileSync(RUNBOOK_PATH, "utf8");
    // The runbook E. observability table cites the filter spec path so
    // operators who edit it are pointed at the regression test.
    expect(content).toContain(
      "scripts/sync/clawcode-sync-filter.txt",
    );
    expect(content).toContain(
      "src/sync/__tests__/exclude-filter-regression.test.ts",
    );
  });
});
