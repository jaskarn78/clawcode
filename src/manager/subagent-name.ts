/**
 * Phase 999.X — Subagent thread name detection.
 *
 * Auto-spawned subagent threads have generated names that follow one of two
 * patterns produced by `SubagentThreadSpawner.spawnInThread` (see
 * `src/discord/subagent-thread-spawner.ts:516`):
 *
 *   - Delegated: `${parent}-via-${delegate}-${nanoid(6)}`
 *     e.g. `fin-acquisition-via-fin-research-57r__G`
 *   - Direct:    `${parent}-sub-${nanoid(6)}`
 *     e.g. `fin-acquisition-sub-4XZKL0`
 *
 * `nanoid(6)` uses the URL-safe alphabet `[A-Za-z0-9_-]` (6 chars).
 *
 * Operator-defined agent names (`personal`, `fin-acquisition`, `Admin Clawdy`,
 * etc.) live in `clawcode.yaml` and never carry the trailing 6-char nanoid
 * suffix, so this regex is safe to use as the auto-prune-eligible filter
 * across the codebase. The check is intentionally narrow — both the
 * stale-binding-sweep extension and the subagent-session-reaper key off
 * this single helper so there is one source of truth for "is this name
 * auto-spawned?"
 */

const SUBAGENT_NAME_RE = /^.+-(via-.+-|sub-)[A-Za-z0-9_-]{6}$/;

/**
 * Returns true if `name` matches the SubagentThreadSpawner-generated naming
 * convention. False for operator-defined agent names, even if they happen
 * to contain "via" or "sub" — the trailing 6-char nanoid suffix is the
 * load-bearing part.
 */
export function isSubagentThreadName(name: string): boolean {
  return SUBAGENT_NAME_RE.test(name);
}
