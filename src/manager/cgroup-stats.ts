/**
 * Phase 109-D — cgroup memory sampler.
 *
 * Reads the daemon's cgroup memory.current / memory.max from /sys/fs/cgroup
 * so observability can surface memory pressure BEFORE the cgroup OOM-kills
 * the daemon. systemd places the clawcode service under
 * /sys/fs/cgroup/system.slice/clawcode.service/ in cgroup v2; the daemon
 * runs inside that scope so the read is straightforward file I/O.
 *
 * Linux-only: returns null on any I/O error (including non-Linux dev
 * machines + container environments without cgroup v2). Non-fatal —
 * observability degrades to "unknown" rather than failing the heartbeat.
 *
 * No npm deps; built-in fs only.
 */

import { readFile } from "node:fs/promises";

export type CgroupMemoryStats = {
  /** Bytes of resident memory currently charged to the cgroup. */
  readonly memoryCurrent: number;
  /** Bytes of the cgroup MemoryMax (or `null` when set to "max"). */
  readonly memoryMax: number | null;
  /** memoryCurrent / memoryMax × 100, or null when memoryMax is unbounded. */
  readonly memoryPercent: number | null;
  /** Absolute path read from. */
  readonly path: string;
};

const DEFAULT_CGROUP_PATH = "/sys/fs/cgroup/system.slice/clawcode.service";

/**
 * Read the cgroup's memory.current + memory.max in parallel.
 *
 * memory.max may be the literal string "max" (cgroup v2 sentinel for
 * unbounded). When that's the case we surface memoryMax=null and
 * memoryPercent=null so callers can render "unbounded" without doing
 * sentinel detection themselves.
 *
 * Returns null when either file is unreadable — host isn't Linux, the
 * service isn't running under systemd, or cgroup v2 isn't mounted.
 */
export async function readCgroupMemoryStats(
  cgroupPath: string = DEFAULT_CGROUP_PATH,
): Promise<CgroupMemoryStats | null> {
  try {
    const [currentRaw, maxRaw] = await Promise.all([
      readFile(`${cgroupPath}/memory.current`, "utf8"),
      readFile(`${cgroupPath}/memory.max`, "utf8"),
    ]);
    const memoryCurrent = Number(currentRaw.trim());
    const maxTrim = maxRaw.trim();
    const memoryMax = maxTrim === "max" ? null : Number(maxTrim);
    if (!Number.isFinite(memoryCurrent)) return null;
    if (memoryMax !== null && !Number.isFinite(memoryMax)) return null;
    const memoryPercent =
      memoryMax === null || memoryMax === 0
        ? null
        : (memoryCurrent / memoryMax) * 100;
    return { memoryCurrent, memoryMax, memoryPercent, path: cgroupPath };
  } catch {
    return null;
  }
}
