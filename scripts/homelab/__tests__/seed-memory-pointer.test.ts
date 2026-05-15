/**
 * Phase 999.47 Plan 04 Task 2 — vitest spec for the seeder script.
 *
 * Covers the 7 scenarios called out in the plan:
 *   1. Empty agents dir          -> exit 0, totalAgents=0.
 *   2. Agent w/o MEMORY.md       -> file created with header + pointer.
 *   3. Pointer already present   -> file unchanged byte-for-byte.
 *   4. Pointer missing           -> appended; original preserved.
 *   5. Multi-agent fleet         -> all end seeded; summary correct.
 *   6. Re-run                    -> all "skip"; no duplicate pointer.
 *   7. --dry-run                 -> zero bytes changed.
 *
 * Atomicity invariants:
 *   - No `<file>.tmp.$$` leftovers after a successful run.
 *   - The pointer line is byte-for-byte the verbatim string from
 *     src/config/defaults.ts HOMELAB_POINTER_LINE — both surfaces converge
 *     on the same exact-line check.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOMELAB_POINTER_LINE } from "../../../src/config/defaults.js";

const execFileAsync = promisify(execFile);

// Resolve the script path relative to this test file so the test is
// runnable from any CWD. fileURLToPath handles the ESM file:// scheme.
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPT_PATH = resolve(__dirname, "../seed-memory-pointer.sh");

const POINTER = HOMELAB_POINTER_LINE;
const SUMMARY_TAG = "phase999.47-homelab-seed-pointer";

type RunResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
};

async function runSeeder(args: readonly string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("bash", [SCRIPT_PATH, ...args]);
    return { stdout, stderr, code: 0 };
  } catch (err) {
    // execFile rejects on non-zero exit — capture stdout/stderr/code from
    // the error payload for assertions.
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

// Parse the final `phase999.47-homelab-seed-pointer { ... }` line — the
// script emits a structured-ish JSON object after the tag prefix on the
// last line of stdout (per-agent action lines come before).
function parseSummary(stdout: string): Record<string, number | boolean | string> {
  const lines = stdout.trim().split("\n");
  const summary = [...lines].reverse().find((l) => l.startsWith(SUMMARY_TAG));
  if (!summary) {
    throw new Error(`No summary line found in stdout:\n${stdout}`);
  }
  const json = summary.slice(SUMMARY_TAG.length).trim();
  return JSON.parse(json);
}

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "seed-memory-pointer-test-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe("scripts/homelab/seed-memory-pointer.sh", () => {
  it("Test 1: empty agents dir → exit 0, totalAgents=0", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(agentsDir, { recursive: true });

    const result = await runSeeder(["--agents-dir", agentsDir]);

    expect(result.code).toBe(0);
    const summary = parseSummary(result.stdout);
    expect(summary.totalAgents).toBe(0);
    expect(summary.seeded).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("Test 1b: missing agents dir → exit 0 with agents-dir-missing reason (defensive)", async () => {
    // Catches the defensive branch — the live deploy path may pre-create
    // the dir, but the script must not crash if it doesn't exist yet.
    const agentsDir = join(workDir, "does-not-exist");

    const result = await runSeeder(["--agents-dir", agentsDir]);

    expect(result.code).toBe(0);
    const summary = parseSummary(result.stdout);
    expect(summary.totalAgents).toBe(0);
    expect(summary.reason).toBe("agents-dir-missing");
  });

  it("Test 2: agent without MEMORY.md → file created with header + pointer", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(join(agentsDir, "researcher"), { recursive: true });

    const result = await runSeeder(["--agents-dir", agentsDir]);

    expect(result.code).toBe(0);
    const memoryPath = join(agentsDir, "researcher", "MEMORY.md");
    const content = await readFile(memoryPath, "utf-8");
    expect(content).toBe(`# Memory\n\n${POINTER}\n`);

    const summary = parseSummary(result.stdout);
    expect(summary.totalAgents).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.appended).toBe(0);
  });

  it("Test 3: pointer already present → file byte-identical (action=skip)", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(join(agentsDir, "general"), { recursive: true });
    const memoryPath = join(agentsDir, "general", "MEMORY.md");
    const original = `# Memory\n\nSome operator notes.\n${POINTER}\nMore notes.\n`;
    await writeFile(memoryPath, original);
    const originalBytes = await readFile(memoryPath);

    const result = await runSeeder(["--agents-dir", agentsDir]);

    expect(result.code).toBe(0);
    const afterBytes = await readFile(memoryPath);
    expect(afterBytes.equals(originalBytes)).toBe(true);
    expect(result.stdout).toContain('"action":"skip"');
    expect(result.stdout).toContain('"reason":"already-seeded"');

    const summary = parseSummary(result.stdout);
    expect(summary.alreadyHad).toBe(1);
    expect(summary.seeded).toBe(0);
  });

  it("Test 4: pointer missing → appended, original preserved, trailing newline", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(join(agentsDir, "personal"), { recursive: true });
    const memoryPath = join(agentsDir, "personal", "MEMORY.md");
    const original = "# Memory\n\nLegacy notes from pre-Phase-999.47.\n";
    await writeFile(memoryPath, original);

    const result = await runSeeder(["--agents-dir", agentsDir]);

    expect(result.code).toBe(0);
    const content = await readFile(memoryPath, "utf-8");
    // Original content preserved verbatim
    expect(content.startsWith(original)).toBe(true);
    // Pointer appended (exact-line match)
    expect(content.split("\n")).toContain(POINTER);
    // File ends with newline
    expect(content.endsWith("\n")).toBe(true);
    // Only one pointer line
    const pointerCount = content
      .split("\n")
      .filter((l) => l === POINTER).length;
    expect(pointerCount).toBe(1);

    const summary = parseSummary(result.stdout);
    expect(summary.appended).toBe(1);
  });

  it("Test 5: multi-agent fleet (3 mixed states) → all seeded; summary correct", async () => {
    const agentsDir = join(workDir, "agents");
    // agent-create: no MEMORY.md → expect "created"
    await mkdir(join(agentsDir, "agent-create"), { recursive: true });
    // agent-append: MEMORY.md without pointer → expect "appended"
    await mkdir(join(agentsDir, "agent-append"), { recursive: true });
    await writeFile(
      join(agentsDir, "agent-append", "MEMORY.md"),
      "# Memory\n\nNotes.\n",
    );
    // agent-skip: MEMORY.md with pointer already → expect "skip"
    await mkdir(join(agentsDir, "agent-skip"), { recursive: true });
    await writeFile(
      join(agentsDir, "agent-skip", "MEMORY.md"),
      `# Memory\n\n${POINTER}\n`,
    );

    const result = await runSeeder(["--agents-dir", agentsDir]);

    expect(result.code).toBe(0);
    const summary = parseSummary(result.stdout);
    expect(summary.totalAgents).toBe(3);
    expect(summary.created).toBe(1);
    expect(summary.appended).toBe(1);
    expect(summary.alreadyHad).toBe(1);
    expect(summary.errors).toBe(0);

    // Every agent now contains the pointer exactly once.
    for (const agent of ["agent-create", "agent-append", "agent-skip"]) {
      const content = await readFile(
        join(agentsDir, agent, "MEMORY.md"),
        "utf-8",
      );
      const count = content.split("\n").filter((l) => l === POINTER).length;
      expect(count, `${agent} pointer count`).toBe(1);
    }
  });

  it("Test 6: idempotency — run twice; second run reports all skip, no duplicates", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(join(agentsDir, "alpha"), { recursive: true });
    await mkdir(join(agentsDir, "beta"), { recursive: true });
    await writeFile(
      join(agentsDir, "beta", "MEMORY.md"),
      "# Memory\n\nBeta notes.\n",
    );

    // First run — seeds the fleet.
    const r1 = await runSeeder(["--agents-dir", agentsDir]);
    expect(r1.code).toBe(0);
    const s1 = parseSummary(r1.stdout);
    expect(s1.seeded).toBe(2);

    // Capture state after the first run.
    const alphaAfter1 = await readFile(
      join(agentsDir, "alpha", "MEMORY.md"),
    );
    const betaAfter1 = await readFile(join(agentsDir, "beta", "MEMORY.md"));

    // Second run — every agent must be a no-op.
    const r2 = await runSeeder(["--agents-dir", agentsDir]);
    expect(r2.code).toBe(0);
    const s2 = parseSummary(r2.stdout);
    expect(s2.totalAgents).toBe(2);
    expect(s2.seeded).toBe(0);
    expect(s2.alreadyHad).toBe(2);

    // Bytes must be identical to post-first-run state.
    const alphaAfter2 = await readFile(
      join(agentsDir, "alpha", "MEMORY.md"),
    );
    const betaAfter2 = await readFile(join(agentsDir, "beta", "MEMORY.md"));
    expect(alphaAfter2.equals(alphaAfter1)).toBe(true);
    expect(betaAfter2.equals(betaAfter1)).toBe(true);

    // Pointer count is exactly 1 in each.
    for (const agent of ["alpha", "beta"]) {
      const content = await readFile(
        join(agentsDir, agent, "MEMORY.md"),
        "utf-8",
      );
      const count = content.split("\n").filter((l) => l === POINTER).length;
      expect(count, `${agent} pointer count`).toBe(1);
    }
  });

  it("Test 7: --dry-run produces zero filesystem changes", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(join(agentsDir, "agent-a"), { recursive: true });
    await mkdir(join(agentsDir, "agent-b"), { recursive: true });
    const bContent = "# Memory\n\nB notes without pointer.\n";
    await writeFile(join(agentsDir, "agent-b", "MEMORY.md"), bContent);

    // Snapshot the agents tree before the dry run.
    async function snapshot(): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {};
      const dirs = await readdir(agentsDir);
      for (const d of dirs) {
        const memPath = join(agentsDir, d, "MEMORY.md");
        try {
          await stat(memPath);
          out[d] = (await readFile(memPath)).toString("hex");
        } catch {
          out[d] = null;
        }
      }
      return out;
    }

    const before = await snapshot();
    const result = await runSeeder(["--agents-dir", agentsDir, "--dry-run"]);
    const after = await snapshot();

    expect(result.code).toBe(0);
    expect(after).toEqual(before);
    // Sanity: dry-run output should mention "would-create" and "would-append"
    // so an operator can see what would happen.
    expect(result.stdout).toContain('"action":"would-create"');
    expect(result.stdout).toContain('"action":"would-append"');
    expect(result.stdout).toContain('"dryRun":1');
  });

  it("static-grep gate: script contains no process-management commands (systemctl/service-restart/killall/pkill)", async () => {
    // Re-asserts the plan's <verify><automated> static-grep gate inside
    // the test surface so a future edit that adds a forbidden command
    // fails the test suite, not just the operator-side verify hook.
    const source = await readFile(SCRIPT_PATH, "utf-8");
    expect(source).not.toMatch(/systemctl/);
    expect(source).not.toMatch(/service.*restart/);
    expect(source).not.toMatch(/killall/);
    expect(source).not.toMatch(/pkill/);
  });

  it("uses atomic temp+rename pattern (no sed -i on production files)", async () => {
    const source = await readFile(SCRIPT_PATH, "utf-8");
    // Pin the atomic-write pattern so a future refactor that reintroduces
    // sed -i (which has a truncate-then-write race window) fails the test.
    expect(source).toContain(".tmp.$$");
    expect(source).toContain("mv -f");
    expect(source).not.toMatch(/\bsed\s+-i\b/);
  });

  it("HOMELAB_POINTER_LINE constant byte-matches the script's POINTER_LINE", async () => {
    // The script and src/config/defaults.ts must agree on the verbatim
    // string. This regression guard catches a future divergence between
    // the two surfaces (the whole point of D-03 is that they cannot drift).
    const source = await readFile(SCRIPT_PATH, "utf-8");
    expect(source).toContain(HOMELAB_POINTER_LINE);
  });

  it("no <file>.tmp.$$ leftovers after a successful append", async () => {
    const agentsDir = join(workDir, "agents");
    await mkdir(join(agentsDir, "agent-append"), { recursive: true });
    await writeFile(
      join(agentsDir, "agent-append", "MEMORY.md"),
      "# Memory\n\nNotes.\n",
    );

    const result = await runSeeder(["--agents-dir", agentsDir]);
    expect(result.code).toBe(0);

    const files = await readdir(join(agentsDir, "agent-append"));
    const leftovers = files.filter((f) => f.includes(".tmp."));
    expect(leftovers).toEqual([]);
  });
});
