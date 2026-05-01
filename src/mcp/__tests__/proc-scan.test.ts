/**
 * Phase 999.14 Plan 00 — proc-scan.ts unit + Linux integration tests.
 *
 * Covers MCP-06 foundation:
 *   - Pitfall 4 (comm field with parens / spaces) regression on parseStatPpid
 *   - buildMcpCommandRegexes derives union regex from configured commands
 *   - readProcInfo Linux integration: real /proc reads against a spawned child
 *   - SECURITY: explicit assertion that /proc/{pid}/environ is NEVER read
 *
 * Linux-gated tests use it.skipIf(process.platform !== "linux"). CI deploy
 * target is Linux, so prod parity is guaranteed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { spawn } from "node:child_process";

// Hoisted spy: vi.mock replaces node:fs/promises module-wide so we can assert
// the security invariant that /proc/{pid}/environ is NEVER read by readProcInfo.
const { readFileSpy, readdirSpy } = vi.hoisted(() => ({
  readFileSpy: vi.fn(),
  readdirSpy: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      readFileSpy(...args);
      return actual.readFile(...args);
    },
    readdir: (...args: Parameters<typeof actual.readdir>) => {
      readdirSpy(...args);
      return actual.readdir(...args);
    },
  };
});

import {
  parseStatPpid,
  buildMcpCommandRegexes,
  matchesAnyMcpCommand,
  readProcInfo,
  procAgeSeconds,
  listAllPids,
} from "../proc-scan.js";

const isLinux = process.platform === "linux";

describe("parseStatPpid", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: handles simple comm field — `123 (sh) S 1 123 ...` → ppid=1", () => {
    const stat = "123 (sh) S 1 123 123 0 -1 4194304 100 0 0 0 0 0 0 0 20 0 1 0 999 0 0 0";
    expect(parseStatPpid(stat)).toBe(1);
  });

  it("Test 2: handles comm with space — `123 (sh -c foo) S 1 123 ...` → ppid=1", () => {
    const stat = "123 (sh -c foo) S 1 123 123 0 -1 4194304 100 0 0 0 0 0 0 0 20 0 1 0 999 0 0 0";
    expect(parseStatPpid(stat)).toBe(1);
  });

  it("Test 3: handles comm with parens — `123 (claude (test-agent)) S 1 123 ...` → ppid=1", () => {
    const stat =
      "123 (claude (test-agent)) S 1 123 123 0 -1 4194304 100 0 0 0 0 0 0 0 20 0 1 0 999 0 0 0";
    expect(parseStatPpid(stat)).toBe(1);
  });

  it("Test 4: throws on missing closing paren", () => {
    const stat = "123 (broken S 1 123 ...";
    expect(() => parseStatPpid(stat)).toThrow();
  });
});

describe("buildMcpCommandRegexes", () => {
  it("Test 5: union regex matches configured commands but rejects unrelated cmdlines", () => {
    const re = buildMcpCommandRegexes({
      mysql: { command: "npm", args: ["exec", "mcp-server-mysql@latest"] },
      mcporter: { command: "mcporter", args: ["serve", "mysql"] },
    });
    expect(matchesAnyMcpCommand("npm exec mcp-server-mysql@latest", re)).toBe(true);
    expect(matchesAnyMcpCommand("mcporter serve mysql", re)).toBe(true);
    // Non-match: npm install does not start with the configured command+args combo
    expect(matchesAnyMcpCommand("npm install", re)).toBe(false);
  });

  it("Test 6: throws on empty input (boundary validation)", () => {
    expect(() => buildMcpCommandRegexes({})).toThrow();
  });

  it("escapes regex metacharacters in commands", () => {
    // Command with regex special chars like `.` should match literally
    const re = buildMcpCommandRegexes({
      svc: { command: "node", args: ["/path/to/foo.js"] },
    });
    expect(matchesAnyMcpCommand("node /path/to/foo.js", re)).toBe(true);
    // The dot must be escaped — `fooXjs` MUST NOT match
    expect(matchesAnyMcpCommand("node /path/to/fooXjs", re)).toBe(false);
  });

  describe("Phase 999.14 hot-fix — bare-name fallback for orphan grandchildren", () => {
    it("matches orphan `sh -c <name>` form for npx-style configs", () => {
      // Production config: clawcode.yaml finmentum-db = npx -y mcp-server-mysql@latest
      const re = buildMcpCommandRegexes({
        "finmentum-db": { command: "npx", args: ["-y", "mcp-server-mysql@latest"] },
      });
      // Live full-form (the original bug-free case)
      expect(matchesAnyMcpCommand("npx -y mcp-server-mysql@latest", re)).toBe(true);
      // Orphan grandchildren — what actually pegged MariaDB on 2026-04-30
      expect(matchesAnyMcpCommand("sh -c mcp-server-mysql", re)).toBe(true);
      expect(matchesAnyMcpCommand(
        "node /home/clawcode/.npm/_npx/ffa4ba40a56a3486/node_modules/.bin/mcp-server-mysql",
        re,
      )).toBe(true);
    });

    it("strips @scope/ from package names — extracts last segment", () => {
      // 1password-mcp config: npx -y @takescake/1password-mcp@latest
      const re = buildMcpCommandRegexes({
        "1password": { command: "npx", args: ["-y", "@takescake/1password-mcp@latest"] },
      });
      expect(matchesAnyMcpCommand("npx -y @takescake/1password-mcp@latest", re)).toBe(true);
      expect(matchesAnyMcpCommand(
        "node /home/clawcode/.npm/_npx/50dbf3d343a0d5b4/node_modules/.bin/1password-mcp",
        re,
      )).toBe(true);
    });

    it("does NOT match unrelated procs that share a common word", () => {
      const re = buildMcpCommandRegexes({
        mysql: { command: "npx", args: ["-y", "mcp-server-mysql@latest"] },
      });
      // Word boundary keeps it tight
      expect(matchesAnyMcpCommand("node my-mcp-server-mysqld-helper", re)).toBe(false);
      // Substring without word boundary continues to match the full form
      expect(matchesAnyMcpCommand("xnpx -y mcp-server-mysql@latest", re)).toBe(true);
    });

    it("ignores file paths in args (not npm specs)", () => {
      const re = buildMcpCommandRegexes({
        brave: { command: "/opt/clawcode-mcp-servers/python-venv/bin/python", args: ["/opt/clawcode-mcp-servers/python/brave_search.py"] },
      });
      // Full path-based form still matches as before
      expect(matchesAnyMcpCommand(
        "/opt/clawcode-mcp-servers/python-venv/bin/python /opt/clawcode-mcp-servers/python/brave_search.py",
        re,
      )).toBe(true);
      // Path arg is NOT extracted as a bare-name pattern (the path-leading-slash check skips it)
      // → A bare `brave_search` cmdline does NOT match (since extraction was correctly skipped).
      expect(matchesAnyMcpCommand("sh -c brave_search", re)).toBe(false);
    });

    it("strips @latest only at the end, not @scope at the start", () => {
      const re = buildMcpCommandRegexes({
        playwright: { command: "npm", args: ["exec", "@playwright/mcp@latest"] },
      });
      expect(matchesAnyMcpCommand("npm exec @playwright/mcp@latest", re)).toBe(true);
      // The bare-name extraction yields `mcp` (last segment after @scope). That's
      // a common word — we accept the false-positive risk because: (a) reaper
      // also requires PPID=1 + clawcode uid + age>=5s + path patterns specific
      // to the npm cache directory, so even a `node mcp` arbitrary proc is
      // already constrained.
      expect(matchesAnyMcpCommand("sh -c mcp", re)).toBe(true);
    });
  });
});

describe("readProcInfo (Linux integration)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(!isLinux)(
    "Test 7: returns ppid=process.pid + uid=getuid + cmdline starts with node for spawned child",
    async () => {
      const child = spawn(
        "node",
        ["-e", "setInterval(()=>{},1000)"],
        { stdio: "ignore" },
      );
      try {
        // Tiny settle window so /proc has the entry
        await new Promise((r) => setTimeout(r, 100));
        const info = await readProcInfo(child.pid!);
        expect(info).not.toBeNull();
        expect(info!.ppid).toBe(process.pid);
        expect(info!.uid).toBe((process.getuid as () => number)());
        expect(info!.cmdline.length).toBeGreaterThan(0);
        expect(info!.cmdline[0]).toMatch(/node/);
        expect(Number.isFinite(info!.startTimeJiffies)).toBe(true);
      } finally {
        child.kill("SIGKILL");
      }
    },
  );

  it.skipIf(!isLinux)(
    "Test 8: returns null for non-existent pid (no throw)",
    async () => {
      const info = await readProcInfo(99_999_999);
      expect(info).toBeNull();
    },
  );

  it("Test 9: NEVER reads /proc/{pid}/environ (security)", async () => {
    readFileSpy.mockClear();
    // Use a likely-nonexistent pid so the actual reads short-circuit on ENOENT.
    // The mock wrapper still records any attempted path BEFORE the ENOENT.
    await readProcInfo(99_999_998);
    for (const call of readFileSpy.mock.calls) {
      const path = String(call[0]);
      expect(path).not.toMatch(/environ/);
    }
    // Also assert proper paths (stat, cmdline, status) WERE attempted.
    const paths = readFileSpy.mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.endsWith("/stat"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/cmdline"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/status"))).toBe(true);
  });
});

describe("listAllPids (Linux integration)", () => {
  it.skipIf(!isLinux)("returns numeric pids from /proc", async () => {
    const pids = await listAllPids();
    expect(pids.length).toBeGreaterThan(0);
    // Our own pid should be present
    expect(pids).toContain(process.pid);
    // Every entry is finite numeric
    for (const pid of pids) {
      expect(Number.isFinite(pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);
    }
  });
});

describe("procAgeSeconds", () => {
  it("computes age via boot time + clock ticks (no syscalls)", () => {
    // bootTimeUnix = now - 1000s; starttime = 100 jiffies = 1s
    // expected age ≈ 999s
    const nowSec = Math.floor(Date.now() / 1000);
    const age = procAgeSeconds({
      startTimeJiffies: 100,
      bootTimeUnix: nowSec - 1000,
      clockTicksPerSec: 100,
    });
    expect(age).toBeGreaterThanOrEqual(998);
    expect(age).toBeLessThanOrEqual(1001);
  });
});
