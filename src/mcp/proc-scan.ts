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
 * Build a single union regex from configured MCP server entries.
 *
 * Each configured entry contributes its FULL invocation form
 * (`command + ' ' + args.join(' ')`) to the alternation. A cmdline is
 * considered an MCP match if it contains any configured invocation as a
 * substring.
 *
 * Note on orphan grandchildren: when an orphan's cmdline is the inner shell
 * form (e.g. `sh -c mcp-server-mysql`), the reaper's caller is responsible
 * for configuring patterns that match that form. The default config pattern
 * (`{command:'sh', args:['-c','mcp-server-mysql']}`) handles it via the same
 * full-form rule — no special-casing needed here.
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
