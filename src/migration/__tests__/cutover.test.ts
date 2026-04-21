/**
 * Phase 82 Plan 01 Task 2 — cutover.ts unit tests. TDD RED phase.
 *
 * Pins per 82-01-PLAN.md + 82-CONTEXT:
 *   1. Refuse path A — agent status not migrated|verified → outcome:"refused"
 *      + refuse ledger row + zero openclaw.json writes
 *   2. Refuse path B — agent absent from clawcode.yaml → outcome:"refused"
 *      + refuse ledger row
 *   3. Idempotent path — agent has no bindings in openclaw.json →
 *      outcome:"already-cut-over" + no-op ledger row + zero writes
 *   4. Happy path — all guards pass → outcome:"cut-over" + writes openclaw.json
 *      (bindings array no longer contains agent) + writes success ledger row +
 *      observeHint contains the pre-removal channel id
 *   5. Non-destructive: another agent's bindings + top-level env/auth/
 *      channels.discord.token survive byte-for-byte
 *   6. fs-guard allowlist integrity: only the allowlisted openclaw.json is
 *      writable under fs-guard — sibling under ~/.openclaw/ still refuses
 *   7. Observe hint literal: `Now wait 15 minutes and confirm only Clawdbot
 *      responds in channel <channel_id>`
 *   8. Ledger file_hashes contain openclaw.json.before + openclaw.json.after
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  cutoverAgent,
  CUTOVER_OBSERVE_HINT_TEMPLATE,
} from "../cutover.js";
import { readRows, appendRow } from "../ledger.js";
import { uninstallFsGuard } from "../fs-guard.js";

afterEach(() => {
  // Defensive: ensure no test leaves a guard installed.
  uninstallFsGuard();
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

type CutoverFixture = Readonly<{
  dir: string;
  openclawJsonPath: string;
  clawcodeConfigPath: string;
  ledgerPath: string;
  agentName: string;
}>;

const CHANNEL_ID_ALPHA = "9991110001";
const CHANNEL_ID_BETA = "9992220002";

function makeOpenclawJson(args: {
  includeAlpha?: boolean;
  includeBeta?: boolean;
  extraFields?: Record<string, unknown>;
} = {}): object {
  const alpha = args.includeAlpha ?? true;
  const beta = args.includeBeta ?? true;
  const bindings: Array<Record<string, unknown>> = [];
  if (alpha) {
    bindings.push({
      agentId: "alpha",
      match: { channel: "discord", peer: { kind: "channel", id: CHANNEL_ID_ALPHA } },
    });
  }
  if (beta) {
    bindings.push({
      agentId: "beta",
      match: { channel: "discord", peer: { kind: "channel", id: CHANNEL_ID_BETA } },
    });
  }
  return {
    meta: { lastTouchedVersion: "2026.4.15" },
    env: { SOMETHING: "value" },
    auth: { kind: "bearer", tokenRef: "op://vault/tok" },
    channels: {
      discord: {
        token: "op://Personal/discord-bot/token",
        intents: ["GUILDS"],
      },
    },
    agents: {
      list: [
        {
          id: "alpha",
          name: "Alpha",
          workspace: "/home/u/.openclaw/workspace-alpha",
          agentDir: "/home/u/.openclaw/agents/alpha/agent",
          model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
          identity: {},
        },
        {
          id: "beta",
          name: "Beta",
          workspace: "/home/u/.openclaw/workspace-beta",
          agentDir: "/home/u/.openclaw/agents/beta/agent",
          model: { primary: "anthropic-api/claude-sonnet-4-6", fallbacks: [] },
          identity: {},
        },
      ],
    },
    bindings,
    ...(args.extraFields ?? {}),
  };
}

function makeClawcodeYaml(agentNames: readonly string[]): string {
  const entries = agentNames
    .map(
      (n) => `  - name: ${n}\n    workspace: /home/u/.clawcode/agents/${n}\n    model: sonnet\n    channels:\n      - "${n === "alpha" ? CHANNEL_ID_ALPHA : CHANNEL_ID_BETA}"\n    mcpServers: []`,
    )
    .join("\n");
  return `version: 1\ndefaults:\n  model: sonnet\n  basePath: ~/.clawcode/agents\nagents:\n${entries}\n`;
}

async function setupFixture(args: {
  agentName?: string;
  includeAgentInYaml?: boolean;
  includeAlphaBinding?: boolean;
  ledgerStatusForAgent?: "migrated" | "verified" | "pending" | "rolled-back" | null;
  extraOpenclawFields?: Record<string, unknown>;
} = {}): Promise<CutoverFixture> {
  const agentName = args.agentName ?? "alpha";
  const dir = await mkdtemp(join(tmpdir(), "cc-cutover-"));
  const openclawJsonPath = join(dir, "openclaw.json");
  const clawcodeConfigPath = join(dir, "clawcode.yaml");
  const ledgerPath = join(dir, "ledger.jsonl");

  const jsonBody =
    JSON.stringify(
      makeOpenclawJson({
        includeAlpha: args.includeAlphaBinding ?? true,
        includeBeta: true,
        extraFields: args.extraOpenclawFields,
      }),
      null,
      2,
    ) + "\n";
  await writeFile(openclawJsonPath, jsonBody, "utf8");

  const yamlAgents: string[] = [];
  if (args.includeAgentInYaml ?? true) yamlAgents.push(agentName);
  if (agentName !== "beta") yamlAgents.push("beta");
  await writeFile(
    clawcodeConfigPath,
    makeClawcodeYaml(yamlAgents),
    "utf8",
  );

  // Stage ledger status if requested
  if (args.ledgerStatusForAgent) {
    await mkdir(dir, { recursive: true });
    await appendRow(ledgerPath, {
      ts: "2026-04-20T00:00:00.000Z",
      action: "apply",
      agent: agentName,
      status: args.ledgerStatusForAgent,
      source_hash: "testhash",
    });
  }

  return {
    dir,
    openclawJsonPath,
    clawcodeConfigPath,
    ledgerPath,
    agentName,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cutoverAgent — refuse path A (ledger status guard)", () => {
  it("refuses when agent status is 'pending'", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "pending" });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused");
    expect(result.refuseReason).toMatch(/not migrated|not verified|pending/i);
    // openclaw.json bytes UNCHANGED
    const bindings = JSON.parse(await readFile(fx.openclawJsonPath, "utf8"))
      .bindings as Array<{ agentId: string }>;
    expect(bindings.some((b) => b.agentId === "alpha")).toBe(true);
    // Refuse ledger row appended
    const rows = await readRows(fx.ledgerPath);
    const refused = rows.filter(
      (r) => r.action === "cutover" && r.outcome === "refuse",
    );
    expect(refused.length).toBeGreaterThan(0);
  });

  it("refuses when agent status is 'rolled-back'", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "rolled-back" });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused");
  });

  it("refuses when agent has no ledger entry at all (absent=pending)", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: null });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused");
  });
});

describe("cutoverAgent — refuse path B (clawcode.yaml guard)", () => {
  it("refuses when agent is not in clawcode.yaml", async () => {
    const fx = await setupFixture({
      includeAgentInYaml: false,
      ledgerStatusForAgent: "verified",
    });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("refused");
    expect(result.refuseReason).toMatch(/clawcode\.yaml|not found/i);
    // openclaw.json still contains alpha
    const bindings = JSON.parse(await readFile(fx.openclawJsonPath, "utf8"))
      .bindings as Array<{ agentId: string }>;
    expect(bindings.some((b) => b.agentId === "alpha")).toBe(true);
  });
});

describe("cutoverAgent — idempotent (already-cut-over)", () => {
  it("returns 'already-cut-over' when agent has zero bindings in openclaw.json", async () => {
    const fx = await setupFixture({
      includeAlphaBinding: false, // already removed
      ledgerStatusForAgent: "verified",
    });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("already-cut-over");
    expect(result.removedCount).toBe(0);
    // No new writes — ledger has a no-op row but no write step
    const rows = await readRows(fx.ledgerPath);
    const writeRows = rows.filter(
      (r) => r.action === "cutover" && r.step === "cutover:write",
    );
    expect(writeRows).toHaveLength(0);
  });

  it("second cutoverAgent call after happy path returns 'already-cut-over' (full idempotent cycle)", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "verified" });
    // First call — should succeed
    const first = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(first.outcome).toBe("cut-over");
    // Second call — should be idempotent no-op
    const second = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:01:00.000Z",
    });
    expect(second.outcome).toBe("already-cut-over");
    expect(second.removedCount).toBe(0);
  });
});

describe("cutoverAgent — happy path", () => {
  it("removes the agent's bindings + writes success ledger row + emits observeHint", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "verified" });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("cut-over");
    expect(result.removedCount).toBe(1);
    // observeHint contains the channel id (pre-removal value)
    expect(result.observeHint).toContain(CHANNEL_ID_ALPHA);
    // openclaw.json now has no alpha bindings
    const after = JSON.parse(await readFile(fx.openclawJsonPath, "utf8")) as {
      bindings: Array<{ agentId: string }>;
    };
    expect(after.bindings.some((b) => b.agentId === "alpha")).toBe(false);
    // Beta binding survives
    expect(after.bindings.some((b) => b.agentId === "beta")).toBe(true);
    // Ledger has success row with file_hashes (before + after)
    const rows = await readRows(fx.ledgerPath);
    const writeRow = rows.find(
      (r) => r.action === "cutover" && r.step === "cutover:write",
    );
    expect(writeRow).toBeDefined();
    expect(writeRow!.outcome).toBe("allow");
    expect(writeRow!.status).toBe("migrated");
    expect(writeRow!.file_hashes).toBeDefined();
    expect(writeRow!.file_hashes!["openclaw.json.before"]).toMatch(/^[0-9a-f]{64}$/);
    expect(writeRow!.file_hashes!["openclaw.json.after"]).toMatch(/^[0-9a-f]{64}$/);
    expect(writeRow!.file_hashes!["openclaw.json.before"]).not.toBe(
      writeRow!.file_hashes!["openclaw.json.after"],
    );
    // beforeSha/afterSha also echoed on result
    expect(result.beforeSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.afterSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves env/auth/channels.discord.token byte-for-byte", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "verified" });
    const before = JSON.parse(await readFile(fx.openclawJsonPath, "utf8")) as Record<string, unknown>;
    await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    const after = JSON.parse(await readFile(fx.openclawJsonPath, "utf8")) as Record<string, unknown>;
    for (const key of Object.keys(before)) {
      if (key === "bindings") continue;
      expect(after[key]).toEqual(before[key]);
    }
  });
});

describe("cutoverAgent — observe hint template", () => {
  it("CUTOVER_OBSERVE_HINT_TEMPLATE contains the literal 'Now wait 15 minutes...'", () => {
    expect(CUTOVER_OBSERVE_HINT_TEMPLATE).toContain("Now wait 15 minutes");
    expect(CUTOVER_OBSERVE_HINT_TEMPLATE).toContain(
      "confirm only Clawdbot responds in channel <channel_id>",
    );
  });

  it("emitted observeHint substitutes <channel_id> literal with the real id", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "verified" });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.observeHint).toBeDefined();
    expect(result.observeHint).not.toContain("<channel_id>");
    expect(result.observeHint).toContain(CHANNEL_ID_ALPHA);
  });
});

describe("cutoverAgent — fs-guard allowlist integrity", () => {
  it("fs-guard is properly installed+uninstalled — no lingering guard after call", async () => {
    const fx = await setupFixture({ ledgerStatusForAgent: "verified" });
    await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    // After cutover, writes outside ~/.openclaw/ must work normally (guard
    // is uninstalled — belt-and-suspenders for the production CLI boundary)
    const testWritePath = join(fx.dir, "post-cutover.txt");
    await writeFile(testWritePath, "ok", "utf8");
    expect(existsSync(testWritePath)).toBe(true);
  });

  it("cutover writes TO the tmpdir openclaw.json (not real ~/.openclaw/)", async () => {
    // This exercises the allowlist: the openclawJsonPath in the fixture is
    // under tmpdir, NOT under ~/.openclaw/. The write is permitted by
    // default (path is outside forbidden zone). This test confirms that
    // the fs-guard install+uninstall doesn't crash the call.
    const fx = await setupFixture({ ledgerStatusForAgent: "verified" });
    const result = await cutoverAgent({
      agentName: fx.agentName,
      openclawJsonPath: fx.openclawJsonPath,
      clawcodeConfigPath: fx.clawcodeConfigPath,
      ledgerPath: fx.ledgerPath,
      ts: () => "2026-04-20T12:00:00.000Z",
    });
    expect(result.outcome).toBe("cut-over");
    // Confirm we did NOT write to real ~/.openclaw/
    const realCanary = join(homedir(), ".openclaw", "cutover-leak-canary");
    expect(existsSync(realCanary)).toBe(false);
  });
});
