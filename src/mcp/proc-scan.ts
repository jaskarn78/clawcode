/**
 * Phase 999.14 — /proc walker + parser primitives.
 *
 * Pure-stdlib helpers for the MCP child process lifecycle hardening fix.
 * No npm dependencies; only `node:fs/promises`.
 *
 * Exported surface:
 *   - parseStatPpid(stat)          → number  (Pitfall-4-safe: lastIndexOf(')'))
 *   - readProcInfo(pid)            → ProcInfo | null  (cmdline + ppid + uid + starttime)
 *   - listAllPids()                → readonly number[]
 *   - buildMcpCommandRegexes(cfg)  → RegExp  (union of configured commands)
 *   - matchesAnyMcpCommand(s, re)  → boolean
 *   - procAgeSeconds({...})        → number  (pure math; no syscalls)
 *   - readBootTimeUnix()           → Promise<number>  (parses /proc/stat btime once)
 *
 * Security invariants (per ~/.claude/rules/security.md):
 *   - NEVER reads /proc/{pid}/environ. Resolved op:// secrets land in environ
 *     and would leak into reaper logs. Cmdline is operator-controlled config,
 *     safe to log.
 *
 * Linux-only: /proc is the canonical source. Tests skip on non-Linux.
 */

import { readFile, readdir } from "node:fs/promises";

/** Configured MCP server entry (subset of clawcode.yaml mcpServers entry). */
export type McpServerCommandConfig = {
  readonly command: string;
  readonly args: readonly string[];
};

/** Parsed /proc/{pid} snapshot. Returned by readProcInfo. */
export type ProcInfo = {
  readonly pid: number;
  readonly ppid: number;
  readonly uid: number;
  readonly cmdline: readonly string[];
  /** Field 22 of /proc/{pid}/stat — clock ticks since boot. Used for age filter. */
  readonly startTimeJiffies: number;
};

/**
 * Parse the ppid (field 4) from a /proc/{pid}/stat line.
 *
 * Pitfall 4: the comm field (field 2) is wrapped in parens but its contents
 * may contain spaces, parens, or even newlines (kernel just copies the first
 * 16 bytes of the binary's task name). Naive `split(' ')[3]` is broken on
 * `123 (sh -c foo) S 1 ...` and `123 (claude (test-agent)) S 1 ...`.
 *
 * Stable parser: find the last `)` (end of comm field), then split the tail.
 * Tail layout: `state ppid pgrp session ...`.
 *
 * @throws if no closing paren or ppid is non-numeric.
 */
export function parseStatPpid(stat: string): number {
  const close = stat.lastIndexOf(")");
  if (close === -1) {
    throw new Error("malformed /proc/stat: no closing paren in comm field");
  }
  // Skip the ") " separator between comm end and the state field.
  const tail = stat.slice(close + 2).split(" ");
  // tail[0] = state (R/S/D/...), tail[1] = ppid
  const ppid = Number(tail[1]);
  if (!Number.isFinite(ppid)) {
    throw new Error("malformed /proc/stat: ppid is not numeric");
  }
  return ppid;
}

/**
 * Parse field 22 (starttime, in clock ticks since boot) from /proc/{pid}/stat.
 *
 * After the comm field, the remaining fields are space-delimited. starttime is
 * field 22 overall, which is index 19 in the post-comm tail (state ppid pgrp
 * session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime cutime
 * cstime priority nice num_threads itrealvalue **starttime**).
 */
function parseStatStartTime(stat: string): number {
  const close = stat.lastIndexOf(")");
  if (close === -1) {
    throw new Error("malformed /proc/stat: no closing paren");
  }
  const tail = stat.slice(close + 2).split(" ");
  const starttime = Number(tail[19]);
  if (!Number.isFinite(starttime)) {
    throw new Error("malformed /proc/stat: starttime is not numeric");
  }
  return starttime;
}

/**
 * Read /proc/{pid}/{stat,cmdline,status} concurrently and return a snapshot.
 *
 * Returns null if the proc disappeared mid-read (ENOENT/ESRCH). Other I/O
 * errors bubble. NEVER reads /proc/{pid}/environ.
 *
 * cmdline is NUL-delimited argv; we split on \0 and drop the trailing empty.
 * uid is parsed from the `Uid:` line of /proc/{pid}/status (real UID, the
 * first numeric field).
 */
export async function readProcInfo(pid: number): Promise<ProcInfo | null> {
  try {
    const [stat, cmdRaw, status] = await Promise.all([
      readFile(`/proc/${pid}/stat`, "utf-8"),
      readFile(`/proc/${pid}/cmdline`, "utf-8"),
      readFile(`/proc/${pid}/status`, "utf-8"),
    ]);
    const ppid = parseStatPpid(stat);
    const startTimeJiffies = parseStatStartTime(stat);
    const uidMatch = status.match(/^Uid:\s*(\d+)/m);
    const uid = uidMatch ? Number(uidMatch[1]) : Number.NaN;
    const cmdline = cmdRaw.split("\0").filter((s) => s.length > 0);
    return { pid, ppid, uid, cmdline, startTimeJiffies };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || e.code === "ESRCH") return null;
    throw err;
  }
}

/** Return all numeric entries under /proc as a sorted readonly array of pids. */
export async function listAllPids(): Promise<readonly number[]> {
  const entries = await readdir("/proc");
  const out: number[] = [];
  for (const e of entries) {
    if (/^\d+$/.test(e)) out.push(Number(e));
  }
  return out;
}

/** Escape regex metacharacters so a literal command becomes a safe pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the bare package name from an npm-style package spec, if the arg
 * looks like one. Returns null otherwise (e.g. flags, file paths).
 *
 * Examples:
 *   "mcp-server-mysql@latest"          → "mcp-server-mysql"
 *   "@takescake/1password-mcp@latest"  → "1password-mcp"
 *   "@playwright/mcp@latest"           → "mcp"
 *   "mcp-server-mysql"                 → "mcp-server-mysql"
 *   "/opt/.../brave_search.py"         → null (path, not npm spec)
 *   "-y"                               → null (flag)
 *
 * Phase 999.14 hot-fix: orphan grandchildren end up with cmdlines like
 * `sh -c mcp-server-mysql` or `node /home/.../bin/mcp-server-mysql` after
 * the npm-wrapper exec handoff. The original `npx -y mcp-server-mysql@latest`
 * full-form doesn't substring-match those. By also adding the bare package
 * name as a word-boundary alternative, the reaper catches both the live
 * full-invocation form AND the orphan transformations.
 */
function extractBarePackageName(arg: string): string | null {
  if (arg.startsWith("-")) return null;
  if (arg.includes("/") && (arg.startsWith("/") || arg.startsWith("."))) {
    return null; // path, not an npm spec
  }
  // Strip @version suffix (anything after the LAST @, but not the leading @scope)
  const lastAt = arg.lastIndexOf("@");
  const base = lastAt > 0 ? arg.slice(0, lastAt) : arg;
  // Take last path segment (handles @scope/name)
  const lastSegment = base.split("/").pop() ?? base;
  if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(lastSegment)) {
    return lastSegment;
  }
  return null;
}

/**
 * Build a single union regex from configured MCP server entries.
 *
 * Each configured entry contributes its FULL invocation form
 * (`command + ' ' + args.join(' ')`) to the alternation. Phase 999.14 hot-fix
 * (2026-04-30 deploy reveal): also contributes the bare npm package name
 * extracted from each non-flag arg (`\b<name>\b` substring match) so the
 * orphan reaper catches grandchildren whose cmdline got transformed by the
 * npm/sh wrapper exec chain.
 *
 * For example, `npx -y mcp-server-mysql@latest` produces TWO alternatives:
 *   - `npx -y mcp-server-mysql@latest`          (matches live npm-exec proc)
 *   - `\bmcp-server-mysql\b`                    (matches orphan `sh -c mcp-server-mysql` and `node /.../bin/mcp-server-mysql`)
 *
 * Throws on empty input — boundary validation per coding-style.md.
 */
export function buildMcpCommandRegexes(
  serverConfigs: Readonly<Record<string, McpServerCommandConfig>>,
): RegExp {
  const entries = Object.values(serverConfigs);
  if (entries.length === 0) {
    throw new Error("buildMcpCommandRegexes: empty serverConfigs (boundary violation)");
  }
  const alternatives: string[] = [];
  for (const cfg of entries) {
    const full =
      cfg.args.length > 0
        ? `${cfg.command} ${cfg.args.join(" ")}`
        : cfg.command;
    alternatives.push(escapeRegex(full));

    // Bare npm package names — see extractBarePackageName JSDoc above.
    for (const arg of cfg.args) {
      const bareName = extractBarePackageName(arg);
      if (bareName) {
        alternatives.push(`\\b${escapeRegex(bareName)}\\b`);
      }
    }
  }
  // Deduplicate to keep the regex small.
  const uniq = Array.from(new Set(alternatives));
  return new RegExp(`(?:${uniq.join("|")})`);
}

/** Test a cmdline string (space-joined argv) against the union regex. */
export function matchesAnyMcpCommand(cmdline: string, patterns: RegExp): boolean {
  return patterns.test(cmdline);
}

/** Pure age math; no syscalls. */
export function procAgeSeconds(args: {
  readonly startTimeJiffies: number;
  readonly bootTimeUnix: number;
  readonly clockTicksPerSec: number;
}): number {
  const procStartUnix = args.bootTimeUnix + args.startTimeJiffies / args.clockTicksPerSec;
  return Date.now() / 1000 - procStartUnix;
}

/**
 * Return the Linux clock-ticks-per-second constant.
 *
 * Hardcoded to 100 (the canonical x86_64/aarch64 value of `getconf CLK_TCK`
 * — verified on clawdy 6.14 + dev 6.8). The kernel exports CLK_TCK at
 * compile time; in practice every modern Linux ships at 100 (or 250 on
 * some embedded kernels we don't deploy to). Test override: production
 * callsites pass this value explicitly to scanForOrphanMcps so tests can
 * inject any number without poking sysconf.
 *
 * Linux-only: not meaningful on non-Linux. Daemon already gates the
 * tracker construction on Linux at the callsite via /proc presence.
 */
export function readClockTicksPerSec(): number {
  return 100;
}

/**
 * Phase 999.15 — optional filter knobs for discoverClaudeSubprocessPid.
 *
 * When `minAge` is set, candidates younger than that many seconds are filtered
 * out (defense against the SDK respawn race observed in the 999.14 deploy:
 * the dying first-PID was registered before the surviving second-PID settled).
 * Caller must supply `bootTimeUnix` + `clockTicksPerSec` so the function does
 * NOT re-read /proc/stat on every call (those values are cached at daemon
 * boot via readBootTimeUnix() + readClockTicksPerSec()).
 */
export interface DiscoverClaudeOpts {
  readonly minAge?: number; // seconds
  readonly bootTimeUnix?: number;
  readonly clockTicksPerSec?: number;
}

/**
 * Phase 999.14 MCP-01 — discover the agent's `claude` CLI subprocess PID.
 *
 * The Claude Agent SDK does not expose the spawned subprocess PID via its
 * public API (verified against sdk.d.ts), so we walk /proc and find the
 * most-recently-started process whose ppid === daemonPid AND whose
 * cmdline[0] ends with /claude OR is exactly "claude".
 *
 * Returns the PID with the highest startTimeJiffies (most recent) or null
 * if no match. Linux-only: returns null on non-Linux (where /proc reads
 * throw, the catch-and-return-null path is taken).
 *
 * Implementation note: scans the full /proc list once. For a daemon
 * managing 14+ agents, that's a single ~50ms call per startAgent — cheap.
 * Non-Linux returns null (test-friendly).
 *
 * Phase 999.15 — accepts optional opts. `opts.minAge` requires
 * `opts.bootTimeUnix` + `opts.clockTicksPerSec` to be supplied (caller-bug
 * surface — throws on missing). Default behavior with no opts is byte-
 * identical to 999.14 (regression-pinned by PS-7).
 */
export async function discoverClaudeSubprocessPid(
  daemonPid: number,
  opts?: DiscoverClaudeOpts,
): Promise<number | null> {
  let pids: readonly number[];
  try {
    pids = await listAllPids();
  } catch {
    return null; // /proc unavailable (non-Linux)
  }
  let best: { pid: number; startTimeJiffies: number } | null = null;
  for (const pid of pids) {
    let info: ProcInfo | null;
    try {
      info = await readProcInfo(pid);
    } catch {
      continue;
    }
    if (!info) continue;
    if (info.ppid !== daemonPid) continue;
    const argv0 = info.cmdline[0] ?? "";
    // Match "/path/to/claude" OR exact "claude" (npm-bin shim).
    if (!/(?:^|\/)claude$/.test(argv0)) continue;
    if (opts?.minAge !== undefined) {
      if (
        opts.bootTimeUnix === undefined ||
        opts.clockTicksPerSec === undefined
      ) {
        throw new Error(
          "discoverClaudeSubprocessPid: opts.minAge requires opts.bootTimeUnix + opts.clockTicksPerSec",
        );
      }
      const age = procAgeSeconds({
        startTimeJiffies: info.startTimeJiffies,
        bootTimeUnix: opts.bootTimeUnix,
        clockTicksPerSec: opts.clockTicksPerSec,
      });
      if (age < opts.minAge) continue;
    }
    if (!best || info.startTimeJiffies > best.startTimeJiffies) {
      best = { pid: info.pid, startTimeJiffies: info.startTimeJiffies };
    }
  }
  return best?.pid ?? null;
}

/**
 * Phase 999.14 MCP-01 — enumerate MCP child PIDs spawned by the given
 * `claude` subprocess.
 *
 * Walks /proc, returns PIDs whose ppid === claudePid AND whose cmdline
 * matches the configured MCP command regex. Excludes the youngest 5s
 * window (Pitfall 3 — npm-wrapper exec handoff race) is the orphan
 * reaper's job; here we want EVERY child including freshly-spawned ones
 * since we're registering them at agent-start.
 *
 * Returns readonly array; empty array on non-Linux or zero matches.
 */
export async function discoverAgentMcpPids(
  claudePid: number,
  patterns: RegExp,
): Promise<readonly number[]> {
  let pids: readonly number[];
  try {
    pids = await listAllPids();
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const pid of pids) {
    let info: ProcInfo | null;
    try {
      info = await readProcInfo(pid);
    } catch {
      continue;
    }
    if (!info) continue;
    if (info.ppid !== claudePid) continue;
    const cmdlineStr = info.cmdline.join(" ");
    if (!matchesAnyMcpCommand(cmdlineStr, patterns)) continue;
    out.push(info.pid);
  }
  return out;
}

/**
 * Read system boot time (Unix seconds) from /proc/stat `btime` line.
 *
 * Called once at daemon start; the result is passed into procAgeSeconds for
 * every age check. Avoids repeated /proc/stat reads in hot loops.
 */
export async function readBootTimeUnix(): Promise<number> {
  const text = await readFile("/proc/stat", "utf-8");
  const match = text.match(/^btime\s+(\d+)/m);
  if (!match) {
    throw new Error("malformed /proc/stat: no btime line");
  }
  return Number(match[1]);
}

/**
 * Phase 999.15 — POSIX liveness check for a PID.
 *
 * Uses `process.kill(pid, 0)` — signal 0 only checks existence + permission,
 * does not actually signal the target. Errno semantics:
 *   - ESRCH (no such process)        → returns false
 *   - EPERM (process exists, no perm) → returns true
 *     (sufficient for our purposes — we only care that the proc IS running,
 *      not whether we can kill it.)
 *   - other errors                    → rethrown (surfacing unknowns)
 *
 * Validates: returns false IMMEDIATELY for pid <= 0 (no syscall). NaN /
 * non-finite input also returns false. This guards against bad input rather
 * than throwing — callers may pass stale tracker values.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}
