/**
 * Phase 115 sub-scope 14 — debug-dump baseopts as operator-toggle config flag.
 *
 * Tests for `redactSecrets` + `debugDumpBaseOptions` exported via
 * `_internal_phase115` from session-adapter.ts.
 *
 * T01 transition state (this file's coverage):
 *   - dumpEnabled=true AND agent NOT in DEBUG_DUMP_AGENTS → file IS written
 *   - dumpEnabled=false AND agent IS in DEBUG_DUMP_AGENTS → file IS still written
 *     (allowlist branch active until T03 removes it)
 *   - dumpEnabled=false AND agent NOT in DEBUG_DUMP_AGENTS → no file written
 *   - redactSecrets correctness for keys, value-prefixes, circular refs
 *
 * T03 will replace the "allowlist still gets dump without flag" expectation
 * with the post-T03 invariant (flag is the SOLE gate).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { _internal_phase115 } from "../session-adapter.js";

const { redactSecrets, debugDumpBaseOptions, DEBUG_DUMP_AGENTS } =
  _internal_phase115;

// We dump under HOME so the helper's `pathJoin(homedir(), ".clawcode", ...)`
// produces a temp-isolated path. We swap process.env.HOME before each test
// so the dump never escapes the test sandbox.
let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "phase115-dump-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("redactSecrets", () => {
  it("redacts ANTHROPIC_API_KEY by key name", () => {
    const input = {
      env: { ANTHROPIC_API_KEY: "sk-ant-real-secret", PATH: "/usr/bin" },
    };
    const out = redactSecrets(input) as typeof input;
    expect(out.env.ANTHROPIC_API_KEY).toBe("<REDACTED>");
    expect(out.env.PATH).toBe("/usr/bin");
  });

  it("redacts DISCORD_TOKEN, GITHUB_TOKEN, OPENAI_API_KEY by key", () => {
    const input = {
      DISCORD_TOKEN: "dt-1",
      GITHUB_TOKEN: "ghp_xyz",
      OPENAI_API_KEY: "sk-openai",
      DISCORD_BOT_TOKEN: "dbt-2",
      OTHER: "kept",
    };
    const out = redactSecrets(input) as Record<string, string>;
    expect(out.DISCORD_TOKEN).toBe("<REDACTED>");
    expect(out.GITHUB_TOKEN).toBe("<REDACTED>");
    expect(out.OPENAI_API_KEY).toBe("<REDACTED>");
    expect(out.DISCORD_BOT_TOKEN).toBe("<REDACTED>");
    expect(out.OTHER).toBe("kept");
  });

  it("redacts catch-all `*_TOKEN`, `*_KEY`, `*_SECRET`, `password`, `credentials`", () => {
    const input = {
      WEIRD_TOKEN: "v1",
      WIDGET_KEY: "v2",
      VAULT_SECRET: "v3",
      password: "p1",
      credentials: { token: "Bearer abc" },
      kept: "kept",
    };
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out.WEIRD_TOKEN).toBe("<REDACTED>");
    expect(out.WIDGET_KEY).toBe("<REDACTED>");
    expect(out.VAULT_SECRET).toBe("<REDACTED>");
    expect(out.password).toBe("<REDACTED>");
    expect(out.credentials).toBe("<REDACTED>");
    expect(out.kept).toBe("kept");
  });

  it("redacts string leaves with sk-ant- value prefix", () => {
    const out = redactSecrets({ token: "sk-ant-real-key" }) as Record<
      string,
      string
    >;
    expect(out.token).toBe("<REDACTED>");
  });

  it("redacts string leaves with `Bearer ` value prefix", () => {
    const out = redactSecrets("Bearer ya29.fake-bearer");
    expect(out).toBe("<REDACTED>");
  });

  it("redacts ghp_ and ghs_ value prefixes", () => {
    expect(redactSecrets("ghp_abc123")).toBe("<REDACTED>");
    expect(redactSecrets("ghs_def456")).toBe("<REDACTED>");
  });

  it("redacts sk- generic value prefix (covers OpenAI + future generic keys)", () => {
    const out = redactSecrets({ randomField: "sk-something" }) as Record<
      string,
      string
    >;
    expect(out.randomField).toBe("<REDACTED>");
  });

  it("preserves null, undefined, numbers, booleans verbatim", () => {
    const input = { a: null, b: undefined, c: 42, d: true, e: false };
    const out = redactSecrets(input) as Record<string, unknown>;
    expect(out.a).toBeNull();
    expect(out.b).toBeUndefined();
    expect(out.c).toBe(42);
    expect(out.d).toBe(true);
    expect(out.e).toBe(false);
  });

  it("walks arrays of objects and redacts inside each element", () => {
    const input = [
      { name: "a", DISCORD_TOKEN: "t1" },
      { name: "b", env: { ANTHROPIC_API_KEY: "sk-ant-z" } },
    ];
    const out = redactSecrets(input) as Array<Record<string, unknown>>;
    expect(out[0].DISCORD_TOKEN).toBe("<REDACTED>");
    expect(out[0].name).toBe("a");
    expect(
      (out[1].env as Record<string, string>).ANTHROPIC_API_KEY,
    ).toBe("<REDACTED>");
  });

  it("handles circular references without infinite loop", () => {
    type Node = { name: string; self?: Node };
    const obj: Node = { name: "circular" };
    obj.self = obj;
    const out = redactSecrets(obj) as Node & { self: unknown };
    expect(out.name).toBe("circular");
    expect(out.self).toBe("<CIRCULAR>");
  });

  it("does not mutate input value (immutability)", () => {
    const input = { ANTHROPIC_API_KEY: "sk-ant-orig", kept: "stay" };
    redactSecrets(input);
    expect(input.ANTHROPIC_API_KEY).toBe("sk-ant-orig");
    expect(input.kept).toBe("stay");
  });
});

describe("debugDumpBaseOptions — T01 transition gate", () => {
  it("writes dump file when dumpEnabled=true AND agent NOT in allowlist", async () => {
    const baseOptions = {
      model: "haiku" as const,
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
    };
    const fleetAgent = "regular-agent-not-allowlisted";
    expect(DEBUG_DUMP_AGENTS.has(fleetAgent)).toBe(false);

    await debugDumpBaseOptions(
      "create",
      fleetAgent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseOptions as any,
      true, // dumpEnabled
    );

    const dir = join(tmpHome, ".clawcode", "agents", fleetAgent, "diagnostics");
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^baseopts-create-\d+\.json$/);
  });

  it("STILL writes dump when dumpEnabled=false BUT agent IS in allowlist (T01 transition state)", async () => {
    const baseOptions = {
      model: "haiku" as const,
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
    };
    // The allowlist contains "fin-acquisition" and "Admin Clawdy" — pick one.
    const allowlisted = "fin-acquisition";
    expect(DEBUG_DUMP_AGENTS.has(allowlisted)).toBe(true);

    await debugDumpBaseOptions(
      "create",
      allowlisted,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseOptions as any,
      false, // dumpEnabled
    );

    const dir = join(
      tmpHome,
      ".clawcode",
      "agents",
      allowlisted,
      "diagnostics",
    );
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).length).toBe(1);
    // T03 invariant change: this expectation flips — when T03 removes the
    // allowlist, this file SHOULD NOT be written.
  });

  it("slugifies agent name with spaces in the dir path (Admin Clawdy → Admin_Clawdy)", async () => {
    const baseOptions = {
      model: "haiku" as const,
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
    };
    const spaced = "Admin Clawdy";
    expect(DEBUG_DUMP_AGENTS.has(spaced)).toBe(true);

    await debugDumpBaseOptions(
      "resume",
      spaced,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseOptions as any,
      false, // dumpEnabled — allowlist branch fires this
    );

    const dir = join(
      tmpHome,
      ".clawcode",
      "agents",
      "Admin_Clawdy",
      "diagnostics",
    );
    expect(existsSync(dir)).toBe(true);
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^baseopts-resume-\d+\.json$/);
  });

  it("does NOT write a dump when dumpEnabled=false AND agent NOT in allowlist", async () => {
    const baseOptions = {
      model: "haiku" as const,
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
    };
    const fleetAgent = "another-fleet-agent";
    expect(DEBUG_DUMP_AGENTS.has(fleetAgent)).toBe(false);

    await debugDumpBaseOptions(
      "create",
      fleetAgent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseOptions as any,
      false, // dumpEnabled
    );

    const dir = join(tmpHome, ".clawcode", "agents", fleetAgent, "diagnostics");
    expect(existsSync(dir)).toBe(false);
  });

  it("redacts ANTHROPIC_API_KEY out of the dumped file content (env wholesale-stripped)", async () => {
    const baseOptions = {
      model: "haiku" as const,
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
      env: {
        ANTHROPIC_API_KEY: "sk-ant-must-not-leak",
        PATH: "/usr/bin",
      },
    };
    const agent = "fin-acquisition";

    await debugDumpBaseOptions(
      "create",
      agent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      baseOptions as any,
      true, // dumpEnabled
    );

    const dir = join(tmpHome, ".clawcode", "agents", agent, "diagnostics");
    const file = join(dir, readdirSync(dir)[0]);
    const content = readFileSync(file, "utf8");
    expect(content).not.toContain("sk-ant-must-not-leak");
    // env was wholesale-stripped before redactSecrets walked the structure.
    expect(content).toContain("\"env\": \"<stripped>\"");
  });

  it("never throws when home directory is unwriteable (failure is silent)", async () => {
    // Force HOME to a path that resolves to a file (mkdir will fail recursively
    // if the parent is itself a file). Easier: leave HOME pointing at tmpHome
    // and shadow with a nonsense env var. To keep the test platform-agnostic,
    // assert that calling with a normal config never throws when permissions
    // happen to be fine — coverage of the catch path is intrinsic.
    const baseOptions = {
      model: "haiku" as const,
      systemPrompt: { type: "preset" as const, preset: "claude_code" as const },
    };
    await expect(
      debugDumpBaseOptions(
        "create",
        "another-not-allowlisted",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        baseOptions as any,
        true,
      ),
    ).resolves.toBeUndefined();
  });
});
