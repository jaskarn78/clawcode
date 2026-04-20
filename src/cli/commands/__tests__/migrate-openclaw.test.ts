/**
 * Integration test for `clawcode migrate openclaw list | plan`.
 *
 * Load-bearing test for the Phase 76 zero-write contract: wraps `node:fs`
 * and `node:fs/promises` via vi.mock factories so every writeFile /
 * appendFile / mkdir call (sync + async) is recorded with its path, and
 * asserts zero calls to `~/.clawcode/`, `clawcode.yaml`, or `~/.openclaw/`
 * during list + plan. The ledger append path (a tmp dir) is the ONLY write
 * allowed.
 *
 * Also covers determinism (successive plan runs produce identical planHash),
 * --agent filter (both known + unknown), ledger bootstrap + idempotent
 * re-plan, finmentum family grouping, and warning emission.
 *
 * ESM caveat: `node:fs/promises` namespace exports are non-configurable —
 * vi.spyOn fails ("Cannot redefine property"). vi.mock with a factory is
 * the supported path. We use `vi.hoisted` to share a capture array between
 * the mock factories and the test body.
 */
import { vi } from "vitest";

// Shared capture array — must be declared via vi.hoisted so it's in scope
// when the vi.mock factories run (mocks are hoisted above imports).
const fsCapture = vi.hoisted(() => ({ calls: [] as Array<{ fn: string; path: string }> }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...orig,
    writeFile: (async (...args: Parameters<typeof orig.writeFile>) => {
      fsCapture.calls.push({ fn: "writeFile", path: String(args[0] ?? "") });
      return orig.writeFile(...args);
    }) as typeof orig.writeFile,
    appendFile: (async (...args: Parameters<typeof orig.appendFile>) => {
      fsCapture.calls.push({ fn: "appendFile", path: String(args[0] ?? "") });
      return orig.appendFile(...args);
    }) as typeof orig.appendFile,
    mkdir: (async (...args: Parameters<typeof orig.mkdir>) => {
      fsCapture.calls.push({ fn: "mkdir", path: String(args[0] ?? "") });
      return orig.mkdir(...args);
    }) as typeof orig.mkdir,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    writeFileSync: ((...args: Parameters<typeof orig.writeFileSync>) => {
      fsCapture.calls.push({ fn: "writeFileSync", path: String(args[0] ?? "") });
      return orig.writeFileSync(...args);
    }) as typeof orig.writeFileSync,
    appendFileSync: ((...args: Parameters<typeof orig.appendFileSync>) => {
      fsCapture.calls.push({ fn: "appendFileSync", path: String(args[0] ?? "") });
      return orig.appendFileSync(...args);
    }) as typeof orig.appendFileSync,
    mkdirSync: ((...args: Parameters<typeof orig.mkdirSync>) => {
      fsCapture.calls.push({ fn: "mkdirSync", path: String(args[0] ?? "") });
      return orig.mkdirSync(...args);
    }) as typeof orig.mkdirSync,
  };
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import {
  runListAction,
  runPlanAction,
  runApplyAction,
  APPLY_NOT_IMPLEMENTED_MESSAGE,
} from "../migrate-openclaw.js";
import { readRows } from "../../../migration/ledger.js";
import {
  DAEMON_REFUSE_MESSAGE,
  SECRET_REFUSE_MESSAGE,
} from "../../../migration/guards.js";
import { uninstallFsGuard } from "../../../migration/fs-guard.js";
import { green, colorEnabled } from "../../output.js";

const FIXTURE_PATH = pathResolve("src/migration/__tests__/fixtures/openclaw.sample.json");

describe("migrate-openclaw CLI", () => {
  let tmp: string;
  let ledgerPath: string;
  let memoryDir: string;
  let clawcodeRoot: string;
  let stdoutCapture: string[];
  let stderrCapture: string[];
  let writeStdoutSpy: ReturnType<typeof vi.spyOn>;
  let writeStderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "migrate-openclaw-"));
    ledgerPath = join(tmp, "ledger.jsonl");
    memoryDir = join(tmp, "openclaw-memory"); // empty — chunkCounts all 'missing'
    clawcodeRoot = join(tmp, "clawcode-agents-would-be-here"); // NEVER created in this phase
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
    process.env.CLAWCODE_OPENCLAW_JSON = FIXTURE_PATH;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = memoryDir;
    process.env.CLAWCODE_AGENTS_ROOT = clawcodeRoot;
    process.env.CLAWCODE_LEDGER_PATH = ledgerPath;
    process.env.NO_COLOR = "1"; // deterministic test output
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    process.env = originalEnv;
  });

  describe("color helpers", () => {
    it("respects NO_COLOR", () => {
      process.env.NO_COLOR = "1";
      expect(colorEnabled()).toBe(false);
      expect(green("abc")).toBe("abc");
    });
    it("emits ANSI when FORCE_COLOR set without NO_COLOR", () => {
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = "1";
      expect(colorEnabled()).toBe(true);
      expect(green("abc")).toContain("\x1b[32m");
    });
  });

  it("list renders all 15 agents with required columns", async () => {
    await runListAction();
    const out = stdoutCapture.join("");
    const ids = [
      "general", "work", "projects", "research", "personal", "shopping",
      "local-clawdy", "kimi", "fin-acquisition", "fin-research",
      "fin-playground", "fin-tax", "finmentum-content-creator",
      "card-planner", "card-generator",
    ];
    for (const id of ids) expect(out).toContain(id);
    expect(out).toContain("NAME");
    expect(out).toContain("SOURCE PATH");
    expect(out).toContain("MEMORIES");
    expect(out).toContain("DISCORD CHANNEL");
    expect(out).toContain("STATUS");
  });

  it("plan output is deterministic across runs", async () => {
    await runPlanAction({});
    const hashA = /Plan hash:\s+([0-9a-f]{64})/.exec(stdoutCapture.join(""))?.[1];
    stdoutCapture = [];
    await runPlanAction({});
    const hashB = /Plan hash:\s+([0-9a-f]{64})/.exec(stdoutCapture.join(""))?.[1];
    expect(hashA).toBeDefined();
    expect(hashA).toBe(hashB);
  });

  it("plan --agent <known> scopes to one agent", async () => {
    const code = await runPlanAction({ agent: "general" });
    expect(code).toBe(0);
    const out = stdoutCapture.join("");
    // Only one "source workspace:" block emitted in the filtered plan
    expect((out.match(/source workspace:/g) ?? []).length).toBe(1);
    expect(out).toContain("general");
  });

  it("plan --agent <unknown> exits 1 with actionable error", async () => {
    const code = await runPlanAction({ agent: "nosuch-agent-zzz" });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("Unknown OpenClaw agent: 'nosuch-agent-zzz'");
    // Available list includes at least one known id
    expect(err).toContain("general");
    expect(err).toContain("fin-acquisition");
  });

  it("zero writes to ~/.clawcode/, clawcode.yaml, or ~/.openclaw/", async () => {
    const forbiddenSubstrings = ["/.clawcode/", "/.openclaw/"];
    const forbiddenEndings = ["clawcode.yaml", "clawcode.yml"];

    // Clear any calls captured during prior tests in this file. The
    // fsCapture array is file-scoped because vi.mock factories require it
    // hoisted above the import block.
    fsCapture.calls.length = 0;

    await runListAction();
    await runPlanAction({});

    // Primary assertion: no captured path may match a forbidden substring.
    // Direct literal assertions first (so `grep not.toContain.*\.clawcode/`
    // in the plan's acceptance criteria matches verbatim), then the
    // table-driven loop for every captured path.
    const allPaths = fsCapture.calls.map((c) => c.path).join("\n");
    expect(allPaths).not.toContain("/.clawcode/");
    expect(allPaths).not.toContain("/.openclaw/");

    for (const { fn, path } of fsCapture.calls) {
      for (const s of forbiddenSubstrings) {
        expect(path, `Unexpected ${fn} to ${path}`).not.toContain(s);
      }
      for (const e of forbiddenEndings) {
        expect(path.endsWith(e), `Unexpected ${fn} to ${path}`).toBe(false);
      }
    }

    // Instrumentation backstop: confirm at least one call was captured so
    // we KNOW the fs spies are wired — otherwise a silent no-op could
    // falsely pass. First `plan` appends 15 ledger rows and mkdirs the
    // migration dir → minimum 16 async calls.
    expect(
      fsCapture.calls.length,
      "expected fs.mock factories to capture at least one call",
    ).toBeGreaterThan(0);

    const appendCalls = fsCapture.calls.filter((c) => c.fn === "appendFile");
    expect(
      appendCalls.length,
      `fs.promises.appendFile mock failed to capture ledger writes. ` +
      `Captured: ${JSON.stringify(fsCapture.calls)}`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("first plan bootstraps ledger with 15 pending rows", async () => {
    await runPlanAction({});
    const rows = await readRows(ledgerPath);
    expect(rows.length).toBe(15);
    for (const r of rows) {
      expect(r.action).toBe("plan");
      expect(r.status).toBe("pending");
    }
  });

  it("second plan appends re-planned rows (idempotent)", async () => {
    await runPlanAction({});
    await runPlanAction({});
    const rows = await readRows(ledgerPath);
    expect(rows.length).toBe(30);
    const second15 = rows.slice(15);
    for (const r of second15) {
      expect(r.status).toBe("re-planned");
    }
  });

  it("plan output flags all 5 finmentum family agents with shared basePath", async () => {
    await runPlanAction({});
    const out = stdoutCapture.join("");
    const finmentumMarkerCount = (out.match(/\[finmentum-shared\]/g) ?? []).length;
    expect(finmentumMarkerCount).toBe(5);
    // All 5 should reference the same basePath ending with /finmentum
    const matches = out.match(/target basePath:\s+\S+\/finmentum(?!\/)/g) ?? [];
    expect(matches.length).toBe(5);
  });

  it("list status reflects ledger", async () => {
    await runPlanAction({});
    stdoutCapture = [];
    await runListAction();
    const out = stdoutCapture.join("");
    // After plan, every agent has a 'pending' row in the ledger
    const pendingCount = (out.match(/\bpending\b/g) ?? []).length;
    // 15 status cells + possibly header collisions — assert >= 15
    expect(pendingCount).toBeGreaterThanOrEqual(15);
  });

  it("plan emits warnings for the 8 agents without Discord bindings", async () => {
    await runPlanAction({});
    const out = stdoutCapture.join("");
    const warningLines = (out.match(/missing-discord-binding/g) ?? []).length;
    expect(warningLines).toBe(8);
  });
});

// ---------------------------------------------------------------------
// Phase 77-03: runApplyAction integration tests
// ---------------------------------------------------------------------
//
// These tests exercise the full apply-preflight chain wired through the
// CLI action handler — including runtime fs-guard install/uninstall and
// literal-message propagation to stderr. Each test takes a tmpdir mtime
// snapshot of source fixtures before the run and asserts zero modification
// afterwards (success criterion #5 — MIGR-07 source-tree mtime invariant).
//
// Notes on isolation:
//   - The fs.mock at file top (Phase 76's zero-write contract) stays in
//     place. It passes through to the real fs, only capturing paths.
//   - Each test uninstalls any leftover fs-guard in its own afterEach to
//     defend against a prior test crashing mid-apply.
//   - Daemon state is controlled via the `execaRunner` DI parameter on
//     runApplyAction — tests never spawn real systemctl.

describe("migrate-openclaw CLI — apply subcommand", () => {
  let tmp: string;
  let ledgerPath: string;
  let memoryDir: string;
  let clawcodeRoot: string;
  let configPath: string;
  let sourceFixture: string;
  let stdoutCapture: string[];
  let stderrCapture: string[];
  let writeStdoutSpy: ReturnType<typeof vi.spyOn>;
  let writeStderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  // Copy the real fixture into a tmp location so we can mtime-snapshot the
  // entire tree safely without touching the repo copy. This is the
  // success-criterion-#5 fixture — the "source tree" whose mtimes must be
  // unchanged after any apply invocation.
  //
  // The real fixture's model strings (`anthropic-api/claude-sonnet-4-6`,
  // 31 chars, 4.00+ bits/char, 3+ char classes) register as HIGH-ENTROPY
  // SECRETS under the scanSecrets classifier — matching real-world
  // production model names that ALSO register as secrets. This is a
  // known tension (see 77-CONTEXT secret-shape flagger spec): test
  // fixtures that want to exercise the NON-secret paths of the apply
  // pipeline must strip model strings to non-entropic forms. Tests that
  // specifically want to exercise secret-refuse can re-inject secrets.
  function seedSourceFixture(
    dir: string,
    opts: { stripEntropicModels?: boolean } = {},
  ): string {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    let payload = raw;
    if (opts.stripEntropicModels) {
      const json = JSON.parse(raw);
      for (const a of json.agents.list) {
        // Replace with short whitelist-passing identifier.
        a.model.primary = "sonnet";
        if (Array.isArray(a.model.fallbacks)) {
          a.model.fallbacks = a.model.fallbacks.map(() => "sonnet");
        }
        if (a.heartbeat?.model) a.heartbeat.model = "haiku";
        if (a.subagents?.model) a.subagents.model = "opus";
      }
      payload = JSON.stringify(json);
    }
    const targetJson = join(dir, "openclaw.json");
    writeFileSync(targetJson, payload);
    return targetJson;
  }

  // Recursively stat every file/dir under a path. Returns a map of
  // relative-path → mtimeMs. Used to pin the MIGR-07 mtime invariant.
  function mtimeSnapshot(root: string): Map<string, number> {
    const out = new Map<string, number>();
    function walk(p: string): void {
      const st = statSync(p);
      out.set(p, st.mtimeMs);
      if (st.isDirectory()) {
        for (const child of readdirSync(p)) walk(join(p, child));
      }
    }
    walk(root);
    return out;
  }

  function writeClawcodeYaml(
    path: string,
    agents: Array<{ name: string; channels: string[] }>,
  ): void {
    const yaml = [
      "version: 1",
      "defaults:",
      "  model: sonnet",
      "agents:",
      ...agents.flatMap((a) => [
        `  - name: ${a.name}`,
        `    channels: [${a.channels.map((c) => `"${c}"`).join(", ")}]`,
      ]),
    ].join("\n");
    writeFileSync(path, yaml);
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "apply-subcmd-"));
    ledgerPath = join(tmp, "ledger.jsonl");
    memoryDir = join(tmp, "openclaw-memory");
    // Use a static short path for clawcodeRoot — mkdtempSync's random
    // 6-char suffix (digits + mixed case) would push the absolute
    // targetBasePath string past the high-entropy secret threshold
    // (length >= 30, 3+ char classes, entropy >= 4.0), causing scanSecrets
    // to flag a legitimate path as secret-shaped. A short stable path
    // (./clawcode-agents) stays under the length threshold. Tests that
    // need mtime isolation use a dedicated sub-path under tmp.
    clawcodeRoot = "/tmp/cc-agents";
    configPath = join(tmp, "clawcode.yaml");
    // Seed the source fixture in a dedicated subdir so mtime snapshots are
    // scoped to the fixture tree and not the whole tmp.
    const srcDir = join(tmp, "source");
    mkdtempSync; // noop to appease lint about unused
    rmSync(srcDir, { recursive: true, force: true });
    const { mkdirSync } = require("node:fs");
    mkdirSync(srcDir, { recursive: true });
    // Default to stripped-entropy models — tests that need the secret-shape
    // path re-seed with secret-carrying data explicitly.
    sourceFixture = seedSourceFixture(srcDir, { stripEntropicModels: true });

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
    process.env.CLAWCODE_OPENCLAW_JSON = sourceFixture;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = memoryDir;
    process.env.CLAWCODE_AGENTS_ROOT = clawcodeRoot;
    process.env.CLAWCODE_LEDGER_PATH = ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = configPath;
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    // Defensive — if a mid-test crash left the guard installed, wipe it.
    uninstallFsGuard();
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    process.env = originalEnv;
  });

  // --- Test A: daemon-running refuse, literal message match -----------
  it("A: daemon active → stderr contains DAEMON_REFUSE_MESSAGE + ledger has daemon refuse row", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "active\n", exitCode: 0 });
    const code = await runApplyAction({}, { execaRunner: runner });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain(DAEMON_REFUSE_MESSAGE);
    const rows = await readRows(ledgerPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.step).toBe("pre-flight:daemon");
    expect(rows[0]?.outcome).toBe("refuse");
  });

  // --- Test B: secret-shape refuse, literal message match -------------
  it("B: sk- prefix secret in fixture → stderr contains SECRET_REFUSE_MESSAGE", async () => {
    // Inject a secret-shaped string into the source fixture by mutating the
    // copy in our tmp source dir. The diff-builder's AgentPlan projection
    // exposes `sourceModel` as a scalar string — overwriting a model.primary
    // puts a secret-shaped token into the PlanReport's walked tree.
    const sourceJson = JSON.parse(readFileSync(sourceFixture, "utf8"));
    sourceJson.agents.list[0].model.primary =
      "sk-abcdefghijklmnopqrstuvwxyz12";
    writeFileSync(sourceFixture, JSON.stringify(sourceJson));

    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    const code = await runApplyAction({}, { execaRunner: runner });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain(SECRET_REFUSE_MESSAGE);
    const rows = await readRows(ledgerPath);
    // daemon (allow) + readonly (allow) + secret (refuse)
    expect(rows.map((r) => r.step)).toEqual([
      "pre-flight:daemon",
      "pre-flight:readonly",
      "pre-flight:secret",
    ]);
    expect(rows[0]?.outcome).toBe("allow");
    expect(rows[1]?.outcome).toBe("allow");
    expect(rows[2]?.outcome).toBe("refuse");
  });

  // --- Test C: channel collision report -------------------------------
  it("C: channel collision → stderr contains aligned-column header + resolution footer", async () => {
    // Fixture has a research agent bound to channel 1481659546337411234.
    // Write a clawcode.yaml containing a pre-existing agent with that
    // same channel to trigger a collision.
    writeClawcodeYaml(configPath, [
      { name: "pre-existing-target", channels: ["1481659546337411234"] },
    ]);
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    const code = await runApplyAction({}, { execaRunner: runner });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("Source agent (OpenClaw)");
    expect(err).toContain("Target agent (ClawCode)");
    expect(err).toContain("Channel ID");
    expect(err).toContain(
      "Resolution: unbind the OpenClaw side — ClawCode is the migration target.",
    );
    const rows = await readRows(ledgerPath);
    // daemon + readonly + secret + channel, all produced before refuse.
    expect(rows).toHaveLength(4);
    expect(rows[3]?.step).toBe("pre-flight:channel");
    expect(rows[3]?.outcome).toBe("refuse");
  });

  // --- Test D: all guards pass → Phase 78 Plan 03 yaml-writer runs --
  // Phase 77 shipped with an "apply not implemented" stub after the 4th
  // guard; Phase 78 Plan 03 replaced that stub with writeClawcodeYaml.
  // This test's fixture strips model ids to "sonnet" (non-entropic — so
  // scanSecrets passes), which is NOT in DEFAULT_MODEL_MAP — the writer
  // therefore refuses with the "unmappable-model" step. Pass
  // --model-map "sonnet=sonnet" to resolve and land a successful write.
  it("D: all 4 guards pass → yaml-writer runs (refuses without model-map override when stripped fixture models aren't in DEFAULT_MODEL_MAP)", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    const code = await runApplyAction({}, { execaRunner: runner });
    // Without --model-map, writer refuses (step:"unmappable-model").
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toMatch(/unmappable model/);
    const rows = await readRows(ledgerPath);
    // 4 pre-flight allow rows + 1 write-refuse row.
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const preflightSteps = rows
      .slice(0, 4)
      .map((r) => r.step);
    expect(preflightSteps).toEqual([
      "pre-flight:daemon",
      "pre-flight:readonly",
      "pre-flight:secret",
      "pre-flight:channel",
    ]);
    for (const r of rows.slice(0, 4)) expect(r.outcome).toBe("allow");
    // APPLY_NOT_IMPLEMENTED_MESSAGE is no longer emitted — the writer
    // refuse copy replaces it.
    expect(err).not.toContain(APPLY_NOT_IMPLEMENTED_MESSAGE);
  });

  // --- Test E: --only <unknown> → actionable error, no ledger rows ----
  it("E: --only <unknown> → Unknown OpenClaw agent on stderr, exits 1, ledger empty", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    const code = await runApplyAction(
      { only: "nosuch-agent-xyz" },
      { execaRunner: runner },
    );
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("Unknown OpenClaw agent: 'nosuch-agent-xyz'");
    expect(err).toContain("general");
    expect(err).toContain("fin-acquisition");
    // Ledger must be untouched — we fail before runApplyPreflight.
    const rows = await readRows(ledgerPath);
    expect(rows).toHaveLength(0);
  });

  // --- Test F: --only <known> narrows channel-collision check ---------
  it("F: --only <known> narrows channel collision scope to that agent only", async () => {
    // Fixture bindings: research → 1480605887247814656, fin-research →
    // 1481659546337411234. Put BOTH in clawcode.yaml so without filter,
    // both would collide. Then --only research should only report the
    // research line — fin-research's binding must be filtered out.
    writeClawcodeYaml(configPath, [
      { name: "existing-a", channels: ["1480605887247814656"] },
      { name: "existing-b", channels: ["1481659546337411234"] },
    ]);
    const runner = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    const code = await runApplyAction(
      { only: "research" },
      { execaRunner: runner },
    );
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("research");
    expect(err).toContain("1480605887247814656");
    // fin-research's binding is filtered out — must not appear.
    expect(err).not.toContain("1481659546337411234");
    expect(err).not.toContain("fin-research");
  });

  // --- Test G: source-tree mtime stable across all 4 scenarios (MIGR-07) -
  it("G: MIGR-07 — source fixture tree mtime unchanged across all 4 scenarios", async () => {
    const sourceDir = join(tmp, "source");
    const snap0 = mtimeSnapshot(sourceDir);

    // Scenario 1: daemon-active refuse
    const runnerActive = vi
      .fn()
      .mockResolvedValue({ stdout: "active\n", exitCode: 0 });
    await runApplyAction({}, { execaRunner: runnerActive });
    const snap1 = mtimeSnapshot(sourceDir);
    for (const [p, t] of snap0) {
      expect(snap1.get(p), `mtime changed at ${p}`).toBe(t);
    }

    // Scenario 2: all-pass APPLY_NOT_IMPLEMENTED
    const runnerInactive = vi
      .fn()
      .mockResolvedValue({ stdout: "inactive\n", exitCode: 3 });
    await runApplyAction({}, { execaRunner: runnerInactive });
    const snap2 = mtimeSnapshot(sourceDir);
    for (const [p, t] of snap0) {
      expect(snap2.get(p), `mtime changed at ${p}`).toBe(t);
    }

    // Scenario 3: channel collision (with existing clawcode.yaml)
    writeClawcodeYaml(configPath, [
      { name: "target-x", channels: ["1481659546337411234"] },
    ]);
    await runApplyAction({}, { execaRunner: runnerInactive });
    const snap3 = mtimeSnapshot(sourceDir);
    for (const [p, t] of snap0) {
      expect(snap3.get(p), `mtime changed at ${p}`).toBe(t);
    }

    // Scenario 4: secret-shape refuse (mutate fixture's in-place copy —
    // but we capture the NEW baseline AFTER the mutation so we assert
    // the apply run didn't touch even the mutated tree).
    const sourceJson = JSON.parse(readFileSync(sourceFixture, "utf8"));
    sourceJson.agents.list[0].model.primary =
      "sk-abcdefghijklmnopqrstuvwxyz12";
    writeFileSync(sourceFixture, JSON.stringify(sourceJson));
    const snap4pre = mtimeSnapshot(sourceDir);
    await runApplyAction({}, { execaRunner: runnerInactive });
    const snap4post = mtimeSnapshot(sourceDir);
    for (const [p, t] of snap4pre) {
      expect(snap4post.get(p), `mtime changed at ${p}`).toBe(t);
    }

    // Ledger must NOT contain any file_hashes keys referencing the source
    // fixture path prefix (witness invariant — no source files are hashed
    // as part of apply-preflight).
    const rows = await readRows(ledgerPath);
    for (const r of rows) {
      if (r.file_hashes) {
        for (const k of Object.keys(r.file_hashes)) {
          expect(k).not.toContain(sourceDir);
        }
      }
    }
  });

  // --- Test H: static-grep regression (MIGR-07 literal-string) --------
  it("H: no literal ~/.openclaw/ in write-context calls across src/migration/", () => {
    const dir = "src/migration";
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      // fs-guard.ts documents the path concept in comments — it's the
      // module that CONTAINS the enforcement logic, so its comments
      // mention the path. Exclude it from the offender scan.
      if (f === "fs-guard.ts") continue;
      // guards.ts's assertReadOnlySource MENTIONS the path in comments and
      // uses homedir() + ".openclaw" at runtime — no literal write-context
      // call, but a conservative exclusion matches the plan's intent.
      if (f === "guards.ts") continue;
      const fullPath = join(dir, f);
      const content = readFileSync(fullPath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i] ?? "";
        if (!ln.includes("~/.openclaw/")) continue;
        if (
          /\b(writeFile|appendFile|mkdir|writeFileSync|appendFileSync|mkdirSync)\b/.test(
            ln,
          )
        ) {
          offenders.push(`${fullPath}:${i + 1}: ${ln.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Phase 81 Plan 02 — verify + rollback CLI unit tests
// ---------------------------------------------------------------------

describe("Phase 81 Plan 02 — verify + rollback CLI", () => {
  let tmp: string;
  let ledgerPath: string;
  let memoryDir: string;
  let clawcodeRoot: string;
  let configPath: string;
  let openclawRoot: string;
  let stdoutCapture: string[];
  let stderrCapture: string[];
  let writeStdoutSpy: ReturnType<typeof vi.spyOn>;
  let writeStderrSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  // Save originals for DI swap holder restoration.
  let origVerify: unknown;
  let origRollback: unknown;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "p81p02-unit-"));
    ledgerPath = join(tmp, "ledger.jsonl");
    memoryDir = join(tmp, "openclaw-memory");
    clawcodeRoot = join(tmp, "clawcode-agents");
    configPath = join(tmp, "clawcode.yaml");
    openclawRoot = join(tmp, "openclaw");

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
    process.env.CLAWCODE_OPENCLAW_JSON = FIXTURE_PATH;
    process.env.CLAWCODE_OPENCLAW_MEMORY_DIR = memoryDir;
    process.env.CLAWCODE_AGENTS_ROOT = clawcodeRoot;
    process.env.CLAWCODE_LEDGER_PATH = ledgerPath;
    process.env.CLAWCODE_CONFIG_PATH = configPath;
    process.env.CLAWCODE_OPENCLAW_ROOT = openclawRoot;
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    delete process.env.CLAWCODE_DISCORD_TOKEN;
    delete process.env.CLAWCODE_VERIFY_OFFLINE;

    // Snapshot the handler dispatch holder for per-test restoration.
    const mod = await import("../migrate-openclaw.js");
    origVerify = mod.migrateOpenclawHandlers.verifyAgent;
    origRollback = mod.migrateOpenclawHandlers.rollbackAgent;
  });

  afterEach(async () => {
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });
    process.env = originalEnv;

    // Restore dispatch holder so tests can't leak mocks.
    const mod = await import("../migrate-openclaw.js");
    if (origVerify !== undefined) {
      (mod.migrateOpenclawHandlers as unknown as {
        verifyAgent: unknown;
      }).verifyAgent = origVerify;
    }
    if (origRollback !== undefined) {
      (mod.migrateOpenclawHandlers as unknown as {
        rollbackAgent: unknown;
      }).rollbackAgent = origRollback;
    }
  });

  // --- formatVerifyTable tests (Tests 1-3) ----------------------------

  it("Test 1: formatVerifyTable — single agent happy path", async () => {
    const { formatVerifyTable } = await import("../migrate-openclaw.js");
    const results = [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "all 6 files present" },
      { check: "memory-count" as const, status: "pass" as const, detail: "source=42 migrated=41 drift=2.4%" },
      { check: "discord-reachable" as const, status: "pass" as const, detail: "channel 111 reachable (200)" },
      { check: "daemon-parse" as const, status: "pass" as const, detail: "resolved as personal (model=sonnet)" },
    ];
    const out = formatVerifyTable([{ agent: "personal", results }]);
    expect(out).toContain("Agent: personal");
    expect(out).toContain("Check");
    expect(out).toContain("Status");
    expect(out).toContain("Detail");
    // 4 pass checks → 4 ✅ emojis
    expect((out.match(/✅/g) ?? []).length).toBe(4);
  });

  it("Test 2: formatVerifyTable — mixed status with all 3 emojis", async () => {
    const { formatVerifyTable } = await import("../migrate-openclaw.js");
    const results = [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "all 6 files present" },
      { check: "memory-count" as const, status: "fail" as const, detail: "source=42 migrated=10 drift=76.2%" },
      { check: "discord-reachable" as const, status: "skip" as const, detail: "CLAWCODE_DISCORD_TOKEN absent" },
      { check: "daemon-parse" as const, status: "pass" as const, detail: "resolved as personal" },
    ];
    const out = formatVerifyTable([{ agent: "personal", results }]);
    expect(out).toContain("✅");
    expect(out).toContain("❌");
    expect(out).toContain("⏭");
    // Detail text preserved verbatim
    expect(out).toContain("source=42 migrated=10 drift=76.2%");
    expect(out).toContain("CLAWCODE_DISCORD_TOKEN absent");
  });

  it("Test 3: formatVerifyTable — multi-agent blocks separated by blank line", async () => {
    const { formatVerifyTable } = await import("../migrate-openclaw.js");
    const results = [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "ok" },
    ];
    const out = formatVerifyTable([
      { agent: "alpha", results },
      { agent: "bravo", results },
    ]);
    expect(out).toContain("Agent: alpha");
    expect(out).toContain("Agent: bravo");
    // Blank line separator — two blocks joined by \n\n
    expect(out).toMatch(/Agent: alpha[\s\S]+\n\nAgent: bravo/);
  });

  // --- Subcommand registration tests (Tests 4-5) ----------------------

  it("Test 4: verify subcommand registered with optional [agent] argument", async () => {
    const { registerMigrateOpenclawCommand } = await import("../migrate-openclaw.js");
    const { Command } = await import("commander");
    const program = new Command();
    registerMigrateOpenclawCommand(program);
    const migrate = program.commands.find((c) => c.name() === "migrate");
    expect(migrate).toBeDefined();
    const openclaw = migrate!.commands.find((c) => c.name() === "openclaw");
    expect(openclaw).toBeDefined();
    const verify = openclaw!.commands.find((c) => c.name() === "verify");
    expect(verify).toBeDefined();
    // Optional argument — first registered arg with required=false
    const regArgs = (verify as unknown as {
      registeredArguments?: Array<{ required: boolean }>;
    }).registeredArguments;
    expect(regArgs).toBeDefined();
    expect(regArgs!.length).toBeGreaterThanOrEqual(1);
    expect(regArgs![0]!.required).toBe(false);
  });

  it("Test 5: rollback subcommand registered with REQUIRED <agent> argument", async () => {
    const { registerMigrateOpenclawCommand } = await import("../migrate-openclaw.js");
    const { Command } = await import("commander");
    const program = new Command();
    registerMigrateOpenclawCommand(program);
    const migrate = program.commands.find((c) => c.name() === "migrate")!;
    const openclaw = migrate.commands.find((c) => c.name() === "openclaw")!;
    const rollback = openclaw.commands.find((c) => c.name() === "rollback");
    expect(rollback).toBeDefined();
    const regArgs = (rollback as unknown as {
      registeredArguments?: Array<{ required: boolean }>;
    }).registeredArguments;
    expect(regArgs).toBeDefined();
    expect(regArgs!.length).toBeGreaterThanOrEqual(1);
    expect(regArgs![0]!.required).toBe(true);
  });

  // --- runVerifyAction tests (Tests 6-11) -----------------------------

  it("Test 6: runVerifyAction — all-pass → exit 0 + ledger verify:complete row", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockVerify = vi.fn(async () => [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "ok" },
      { check: "memory-count" as const, status: "pass" as const, detail: "ok" },
      { check: "discord-reachable" as const, status: "pass" as const, detail: "ok" },
      { check: "daemon-parse" as const, status: "pass" as const, detail: "ok" },
    ]);
    (mod.migrateOpenclawHandlers as unknown as {
      verifyAgent: typeof mockVerify;
    }).verifyAgent = mockVerify;

    // Minimal inventory fixture to support opts.agent path
    const code = await mod.runVerifyAction({ agent: "general" });
    expect(code).toBe(0);
    const rows = await readRows(ledgerPath);
    const row = rows.find((r) => r.agent === "general" && r.step === "verify:complete");
    expect(row).toBeDefined();
    expect(row!.action).toBe("verify");
    expect(row!.status).toBe("verified");
    expect(row!.outcome).toBe("allow");
  });

  it("Test 7: runVerifyAction — any-fail → exit 1 + ledger verify:fail row", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockVerify = vi.fn(async () => [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "ok" },
      { check: "memory-count" as const, status: "fail" as const, detail: "drift too high" },
      { check: "discord-reachable" as const, status: "pass" as const, detail: "ok" },
      { check: "daemon-parse" as const, status: "pass" as const, detail: "ok" },
    ]);
    (mod.migrateOpenclawHandlers as unknown as {
      verifyAgent: typeof mockVerify;
    }).verifyAgent = mockVerify;

    const code = await mod.runVerifyAction({ agent: "general" });
    expect(code).toBe(1);
    const rows = await readRows(ledgerPath);
    const row = rows.find((r) => r.agent === "general" && r.step === "verify:fail");
    expect(row).toBeDefined();
    expect(row!.status).toBe("pending");
    expect(row!.outcome).toBe("refuse");
  });

  it("Test 8: runVerifyAction — unknown agent arg → error + no ledger row", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockVerify = vi.fn(async () => []);
    (mod.migrateOpenclawHandlers as unknown as {
      verifyAgent: typeof mockVerify;
    }).verifyAgent = mockVerify;

    const code = await mod.runVerifyAction({ agent: "nosuch-zzz" });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("Unknown agent:");
    expect(mockVerify).not.toHaveBeenCalled();
    // No ledger file created.
    expect(existsSync(ledgerPath)).toBe(false);
  });

  it("Test 9: runVerifyAction — no arg → iterate over migrated+verified+rolled-back, skip pending", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockVerify = vi.fn(async () => [
      { check: "workspace-files-present" as const, status: "pass" as const, detail: "ok" },
    ]);
    (mod.migrateOpenclawHandlers as unknown as {
      verifyAgent: typeof mockVerify;
    }).verifyAgent = mockVerify;

    // Seed ledger: 2 migrated, 1 pending, 1 rolled-back, 1 verified → should iterate 4 (everything except pending)
    const ts = new Date().toISOString();
    const { appendRow } = await import("../../../migration/ledger.js");
    await appendRow(ledgerPath, { ts, action: "apply", agent: "aa", status: "migrated", source_hash: "h1" });
    await appendRow(ledgerPath, { ts, action: "apply", agent: "bb", status: "migrated", source_hash: "h1" });
    await appendRow(ledgerPath, { ts, action: "plan", agent: "cc", status: "pending", source_hash: "h1" });
    await appendRow(ledgerPath, { ts, action: "rollback", agent: "dd", status: "rolled-back", source_hash: "h1" });
    await appendRow(ledgerPath, { ts, action: "verify", agent: "ee", status: "verified", source_hash: "h1" });

    const code = await mod.runVerifyAction({});
    expect(code).toBe(0);
    // Should be called 4 times — everything except the pending agent
    expect(mockVerify).toHaveBeenCalledTimes(4);
    const calls = mockVerify.mock.calls as unknown as Array<[{ agentName: string }]>;
    const agentsVerified = calls.map((c) => c[0].agentName);
    expect(agentsVerified).toContain("aa");
    expect(agentsVerified).toContain("bb");
    expect(agentsVerified).toContain("dd");
    expect(agentsVerified).toContain("ee");
    expect(agentsVerified).not.toContain("cc");
  });

  it("Test 10: runVerifyAction — CLAWCODE_DISCORD_TOKEN forwarded to verifyAgent", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockVerify = vi.fn(async () => [
      { check: "discord-reachable" as const, status: "pass" as const, detail: "ok" },
    ]);
    (mod.migrateOpenclawHandlers as unknown as {
      verifyAgent: typeof mockVerify;
    }).verifyAgent = mockVerify;

    process.env.CLAWCODE_DISCORD_TOKEN = "test-bot-token-123";
    await mod.runVerifyAction({ agent: "general" });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    const calls = mockVerify.mock.calls as unknown as Array<[{ discordToken?: string }]>;
    const passedArgs = calls[0]![0];
    expect(passedArgs.discordToken).toBe("test-bot-token-123");
  });

  it("Test 11: runVerifyAction — CLAWCODE_VERIFY_OFFLINE='true' → offline=true", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockVerify = vi.fn(async () => [
      { check: "discord-reachable" as const, status: "skip" as const, detail: "offline" },
    ]);
    (mod.migrateOpenclawHandlers as unknown as {
      verifyAgent: typeof mockVerify;
    }).verifyAgent = mockVerify;

    const typedCalls = () => mockVerify.mock.calls as unknown as Array<[{ offline?: boolean }]>;

    process.env.CLAWCODE_VERIFY_OFFLINE = "true";
    await mod.runVerifyAction({ agent: "general" });
    expect(typedCalls()[0]![0].offline).toBe(true);

    // Any other value → false
    mockVerify.mockClear();
    process.env.CLAWCODE_VERIFY_OFFLINE = "1";
    await mod.runVerifyAction({ agent: "general" });
    expect(typedCalls()[0]![0].offline).toBe(false);

    mockVerify.mockClear();
    delete process.env.CLAWCODE_VERIFY_OFFLINE;
    await mod.runVerifyAction({ agent: "general" });
    expect(typedCalls()[0]![0].offline).toBe(false);
  });

  // --- runRollbackAction tests (Tests 12-14) --------------------------

  it("Test 12: runRollbackAction — happy path with removedPaths listed", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockRollback = vi.fn(async () => ({
      outcome: "rolled-back" as const,
      removedPaths: ["/tmp/foo", "/tmp/bar"] as readonly string[],
      sourceHashBefore: {},
      sourceHashAfter: {},
    }));
    (mod.migrateOpenclawHandlers as unknown as {
      rollbackAgent: typeof mockRollback;
    }).rollbackAgent = mockRollback;

    const code = await mod.runRollbackAction({ agent: "personal" });
    expect(code).toBe(0);
    const out = stdoutCapture.join("");
    expect(out).toContain("✓ rolled back personal: removed 2 path(s)");
    expect(out).toContain("/tmp/foo");
    expect(out).toContain("/tmp/bar");
  });

  it("Test 13: runRollbackAction — outcome='not-found' → exit 1 + error", async () => {
    const mod = await import("../migrate-openclaw.js");
    const mockRollback = vi.fn(async () => ({
      outcome: "not-found" as const,
      removedPaths: [] as readonly string[],
      sourceHashBefore: {},
      sourceHashAfter: {},
    }));
    (mod.migrateOpenclawHandlers as unknown as {
      rollbackAgent: typeof mockRollback;
    }).rollbackAgent = mockRollback;

    const code = await mod.runRollbackAction({ agent: "ghost-agent" });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("not found");
  });

  it("Test 14: runRollbackAction — SourceCorruptionError → exit 1 + mismatches listed", async () => {
    const mod = await import("../migrate-openclaw.js");
    const { SourceCorruptionError } = await import("../../../migration/rollbacker.js");
    const mockRollback = vi.fn(async () => {
      throw new SourceCorruptionError(["workspace/SOUL.md", "workspace/memory/foo.md"]);
    });
    (mod.migrateOpenclawHandlers as unknown as {
      rollbackAgent: typeof mockRollback;
    }).rollbackAgent = mockRollback;

    const code = await mod.runRollbackAction({ agent: "personal" });
    expect(code).toBe(1);
    const err = stderrCapture.join("");
    expect(err).toContain("source tree was modified during rollback");
    expect(err).toContain("workspace/SOUL.md");
  });

  // --- Dispatch holder extension (Test 15) ----------------------------

  it("Test 15: migrateOpenclawHandlers extended with verifyAgent + rollbackAgent", async () => {
    const mod = await import("../migrate-openclaw.js");
    expect(mod.migrateOpenclawHandlers.verifyAgent).toBeDefined();
    expect(typeof mod.migrateOpenclawHandlers.verifyAgent).toBe("function");
    expect(mod.migrateOpenclawHandlers.rollbackAgent).toBeDefined();
    expect(typeof mod.migrateOpenclawHandlers.rollbackAgent).toBe("function");
  });
});
