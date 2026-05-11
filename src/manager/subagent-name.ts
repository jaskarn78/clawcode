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

/**
 * Anchored capture used to extract the parent (root) agent name from a
 * subagent thread name. The non-greedy `(.+?)` captures the smallest
 * prefix terminated by the first `-via-…-nanoid6` or `-sub-nanoid6`
 * suffix anchored to end-of-string. We anchor end-of-string explicitly
 * so an operator-defined name that legitimately contains `-sub-` doesn't
 * get spuriously truncated.
 *
 * Examples (each → "fin-acquisition"):
 *   - `fin-acquisition-sub-4XZKL0`
 *   - `fin-acquisition-via-fin-research-57r__G`
 *
 * 116-postdeploy Bug 1: returned from `parentAgentName(name)` so the
 * costs chart can bucket subagent series back to their parent root.
 */
const SUBAGENT_PARENT_RE = /^(.+?)-(?:via-.+-|sub-)[A-Za-z0-9_-]{6}$/;

/**
 * Strip a subagent-thread suffix to recover the parent (root) agent name.
 * Returns the input unchanged if it doesn't match the spawner-generated
 * naming convention — operator-defined agents pass through verbatim.
 *
 * Used by the Phase 116 cost dashboard (and any other surface that needs
 * to roll subagent activity up to the root agent) so the chart legend
 * doesn't explode into hundreds of one-shot series.
 */
export function parentAgentName(name: string): string {
  const match = SUBAGENT_PARENT_RE.exec(name);
  return match ? match[1]! : name;
}
