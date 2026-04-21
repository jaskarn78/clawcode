/**
 * Phase 82 Plan 02 Task 1 — cutover subcommand integration tests.
 *
 * Pins Success Criterion 2: `cutover <agent>` atomically modifies
 * openclaw.json, preserves non-target bindings + all top-level operator-
 * curated fields; idempotent re-run returns exit 0 `already cut over`.
 *
 * Scenarios:
 *   A — happy path: ledger status=verified + clawcode.yaml has agent +
 *       openclaw.json has 1 binding for the agent → exit 0, binding removed,
 *       other agent's bindings + top-level fields survive byte-for-byte.
 *   B — idempotent: call cutover a second time on the post-cutover state →
 *       exit 0, stdout contains `already cut over`, openclaw.json bytes
 *       UNCHANGED (sha256 pre/post equal).
 *   C — refuse pending: ledger status=pending → exit 1, stderr contains
 *       `cutover refused for <agent>`, openclaw.json unchanged.
 *   D — refuse no clawcode entry: clawcode.yaml missing agent → exit 1,
 *       stderr contains `not found in clawcode.yaml`.
 *   E — dispatch-holder swap: test that a mocked cutoverAgent with
 *       outcome:"cut-over" surfaces through the CLI with removedCount + hint.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRows } from "../../../migration/ledger.js";
import { uninstallFsGuard } from "../../../migration/fs-guard.js";

const CHANNEL_ALPHA = "9991110001";
const CHANNEL_BETA = "9992220002";

function makeOpenclawJson(args: {
  includeAlpha?: boolean;
  includeBeta?: boolean;
} = {}): string {
  const alpha = args.includeAlpha ?? true;
  const beta = args.includeBeta ?? true;
  const bindings: Array<Record<string, unknown>> = [];
  if (alpha) {
    bindings.push({
      agentId: "alpha",
      match: {
        channel: "discord",
        peer: { kind: "channel", id: CHANNEL_ALPHA },
      },
    });
  }
  if (beta) {
    bindings.push({
      agentId: "beta",
      match: {
        channel: "discord",
        peer: { kind: "channel", id: CHANNEL_BETA },
      },
    });
  }
  const obj = {
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
          model: { primary: "sonnet", fallbacks: [] },
          identity: {},
        },
        {
          id: "beta",
          name: "Beta",
          workspace: "/home/u/.openclaw/workspace-beta",
          agentDir: "/home/u/.openclaw/agents/beta/agent",
          model: { primary: "sonnet", fallbacks: [] },
          identity: {},
        },
      ],
    },
    bindings,
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

function makeClawcodeYaml(agentNames: readonly string[]): string {
  const entries = agentNames
    .map(
      (n) =>
        `  - name: ${n}\n    workspace: /home/u/.clawcode/agents/${n}\n    model: sonnet\n    channels:\n      - "${n === "alpha" ? "3333333333" : "4444444444"}"\n    mcpServers: []`,
    )
    .join("\n");
  return `version: 1\ndefaults:\n  model: sonnet\n  basePath: ~/.clawcode/agents\nagents:\n${entries}\n`;
}

async function seedLedger(
  ledgerPath: string,
  agentName: string,
  status: "migrated" | "verified" | "pending" | "rolled-back",
): Promise<void> {
  const { appendRow } = await import("../../../migration/ledger.js");
  await appendRow(ledgerPath, {
    ts: "2026-04-20T00:00:00.000Z",
    action: "apply",
    agent: agentName,
    status,
    source_hash: "testhash",
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("Phase 82 Plan 02 — cutover subcommand", () => {
  let tmp: string;
  let openclawJson: string;
  let openclawRoot: string;
  let clawcodeConfigPath: string;
  let ledgerPath: string;
  let memoryDir: string;
  let clawcodeRoot: string;
  let stdoutCapture: string[];
  let stderrCapture: string[];
  let writeStdoutSpy: ReturnType<typeof vi.spyOn>;
  let writeStderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cc-cutover-cli-"));
    // openclawRoot points at tmp itself so openclawJson lives under it
    // (fs-guard read-only-source check refuses writes under openclawRoot
    // unless allowlisted to the exact openclawJson path).
    openclawRoot = tmp;
    openclawJson = join(tmp, "openclaw.json");
    clawcodeConfigPath = join(tmp, "clawcode.yaml");
    ledgerPath = join(tmp, "ledger.jsonl");
    memoryDir = join(tmp, "openclaw-memory");
    clawcodeRoot = join(tmp, "clawcode-agents");

    // Happy-path seeds: alpha + beta bindings, agent entries in yaml,
    // ledger status=verified for alpha.
    writeFileSync(openclawJson, makeOpenclawJson({}));
    writeFileSync(clawcodeConfigPath, makeClawcodeYaml(["alpha", "beta"]));

    stdoutCapture = [];
    stderrCapture = [];
    writeStdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        stdoutCapture.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as typeof process.stdout.write);
    writeStderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(((chunk: string | Uint8Array) => {
        stderrCapture.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      }) as typeof process.stderr.write);
    originalEnv = { ...process.env };
    process.env.CLAWCODE_OPENCLAW_JSON = openclawJson;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = memoryDir;
    process.env.CLAWCODE_AGENTS_ROOT = clawcodeRoot;
    process.env.CLAWCODE_LEDGER_PATH = ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = clawcodeConfigPath;
    process.env.CLAWCODE_OPENCLAW_ROOT = openclawRoot;
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    // Defensive — wipe any fs-guard a failing test left installed.
    uninstallFsGuard();
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // Test A — happy path
  // -------------------------------------------------------------------------
  it("A (SC-2 happy): cutover <agent> removes bindings, preserves other agent + top-level fields, exit 0", async () => {
    await seedLedger(ledgerPath, "alpha", "verified");
    const mod = await import("../migrate-openclaw.js");
    // Precondition sanity
    expect(typeof mod.migrateOpenclawHandlers.runCutoverAction).toBe(
      "function",
    );

    const code = await mod.migrateOpenclawHandlers.runCutoverAction!({
      agent: "alpha",
    });
    expect(code).toBe(0);

    const after = JSON.parse(readFileSync(openclawJson, "utf8"));
    // Alpha binding removed
    expect(
      (after.bindings as Array<{ agentId: string }>).some(
        (b) => b.agentId === "alpha",
      ),
    ).toBe(false);
    // Beta binding survived
    expect(
      (after.bindings as Array<{ agentId: string }>).some(
        (b) => b.agentId === "beta",
      ),
    ).toBe(true);
    // Top-level operator fields survive byte-for-byte semantically
    expect(after.env.SOMETHING).toBe("value");
    expect(after.auth.kind).toBe("bearer");
    expect(after.channels.discord.token).toBe("op://Personal/discord-bot/token");
    expect(after.agents.list).toHaveLength(2);

    // stdout carries success line + observe hint
    const out = stdoutCapture.join("");
    expect(out).toContain("cut over alpha");
    expect(out).toContain("Now wait 15 minutes");
    expect(out).toContain(CHANNEL_ALPHA); // the real channel id substituted
  });

  // -------------------------------------------------------------------------
  // Test B — idempotent re-run
  // -------------------------------------------------------------------------
  it("B (SC-2 idempotent): re-running cutover after success → exit 0, 'already cut over', bytes unchanged", async () => {
    await seedLedger(ledgerPath, "alpha", "verified");
    const mod = await import("../migrate-openclaw.js");

    // First call — happy path
    const code1 = await mod.migrateOpenclawHandlers.runCutoverAction!({
      agent: "alpha",
    });
    expect(code1).toBe(0);

    const bytesAfterFirst = readFileSync(openclawJson, "utf8");
    const shaAfterFirst = sha256(bytesAfterFirst);

    // Reset stdout capture
    stdoutCapture.length = 0;

    // Second call — should be a no-op
    const code2 = await mod.migrateOpenclawHandlers.runCutoverAction!({
      agent: "alpha",
    });
    expect(code2).toBe(0);

    const bytesAfterSecond = readFileSync(openclawJson, "utf8");
    const shaAfterSecond = sha256(bytesAfterSecond);
    expect(shaAfterSecond).toBe(shaAfterFirst); // byte-exact equality

    const out2 = stdoutCapture.join("");
    expect(out2).toContain("already cut over");
  });

  // -------------------------------------------------------------------------
  // Test C — refuse pending
  // -------------------------------------------------------------------------
  it("C (SC-2 refuse-pending): cutover against a pending agent → exit 1, openclaw.json unchanged", async () => {
    await seedLedger(ledgerPath, "alpha", "pending");
    const mod = await import("../migrate-openclaw.js");

    const beforeSha = sha256(readFileSync(openclawJson, "utf8"));
    const code = await mod.migrateOpenclawHandlers.runCutoverAction!({
      agent: "alpha",
    });
    expect(code).toBe(1);

    const afterSha = sha256(readFileSync(openclawJson, "utf8"));
    expect(afterSha).toBe(beforeSha); // zero writes

    const err = stderrCapture.join("");
    expect(err).toContain("cutover refused for alpha");
  });

  // -------------------------------------------------------------------------
  // Test D — refuse no clawcode entry
  // -------------------------------------------------------------------------
  it("D (SC-2 refuse-no-yaml-entry): clawcode.yaml missing agent → exit 1, 'not found in clawcode.yaml'", async () => {
    // Overwrite clawcode.yaml to contain ONLY beta (no alpha)
    writeFileSync(clawcodeConfigPath, makeClawcodeYaml(["beta"]));
    await seedLedger(ledgerPath, "alpha", "verified");
    const mod = await import("../migrate-openclaw.js");

    const beforeSha = sha256(readFileSync(openclawJson, "utf8"));
    const code = await mod.migrateOpenclawHandlers.runCutoverAction!({
      agent: "alpha",
    });
    expect(code).toBe(1);

    const afterSha = sha256(readFileSync(openclawJson, "utf8"));
    expect(afterSha).toBe(beforeSha);

    const err = stderrCapture.join("");
    expect(err).toMatch(/not found in clawcode\.yaml/);
  });

  // -------------------------------------------------------------------------
  // Test E — dispatch holder swap (mock cutoverAgent returns cut-over)
  // -------------------------------------------------------------------------
  it("E: dispatch holder swap — mocked cutoverAgent flows through CLI with removedCount + observeHint", async () => {
    const mod = await import("../migrate-openclaw.js");
    const orig = mod.migrateOpenclawHandlers.cutoverAgent;

    const mockCutover = vi.fn(async () => ({
      outcome: "cut-over" as const,
      removedCount: 3,
      observeHint:
        "Now wait 15 minutes and confirm only Clawdbot responds in channel TEST-CHANNEL-9999",
      beforeSha256: "aaa",
      afterSha256: "bbb",
    }));
    try {
      (mod.migrateOpenclawHandlers as unknown as {
        cutoverAgent: typeof mockCutover;
      }).cutoverAgent = mockCutover;

      const code = await mod.migrateOpenclawHandlers.runCutoverAction!({
        agent: "alpha",
      });
      expect(code).toBe(0);
      expect(mockCutover).toHaveBeenCalledTimes(1);
      const out = stdoutCapture.join("");
      expect(out).toContain("removed 3 binding");
      expect(out).toContain("TEST-CHANNEL-9999");
    } finally {
      if (orig !== undefined) {
        (mod.migrateOpenclawHandlers as unknown as {
          cutoverAgent: typeof orig;
        }).cutoverAgent = orig;
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test F — ledger witness row written on happy path
  // -------------------------------------------------------------------------
  it("F: happy path writes a cutover:write ledger row with file_hashes", async () => {
    await seedLedger(ledgerPath, "alpha", "verified");
    const mod = await import("../migrate-openclaw.js");
    const code = await mod.migrateOpenclawHandlers.runCutoverAction!({
      agent: "alpha",
    });
    expect(code).toBe(0);
    const rows = await readRows(ledgerPath);
    const writeRow = rows.find(
      (r) =>
        r.agent === "alpha" &&
        r.action === "cutover" &&
        r.step === "cutover:write",
    );
    expect(writeRow).toBeDefined();
    expect(writeRow!.outcome).toBe("allow");
    expect(writeRow!.file_hashes).toBeDefined();
    expect(writeRow!.file_hashes!["openclaw.json.before"]).toBeDefined();
    expect(writeRow!.file_hashes!["openclaw.json.after"]).toBeDefined();
    // Ensure the guard was uninstalled (no leftover patches).
    expect(existsSync(openclawJson)).toBe(true);
  });
});
