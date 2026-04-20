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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as pathResolve } from "node:path";
import {
  runListAction,
  runPlanAction,
} from "../migrate-openclaw.js";
import { readRows } from "../../../migration/ledger.js";
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
