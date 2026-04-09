/**
 * Field-level config diffing with reloadable/non-reloadable classification.
 *
 * Compares two Config objects and produces a list of field-level changes,
 * each classified as reloadable (can be applied without restart) or
 * non-reloadable (requires daemon restart).
 */

import type { Config } from "./schema.js";
import {
  RELOADABLE_FIELDS,
  NON_RELOADABLE_FIELDS,
  type ConfigChange,
  type ConfigDiff,
} from "./types.js";

/**
 * Diff two config objects and classify each change.
 *
 * Agents are matched by name (not array index) so reordering
 * does not produce spurious diffs.
 */
export function diffConfigs(oldConfig: Config, newConfig: Config): ConfigDiff {
  const changes: ConfigChange[] = [];

  // Diff defaults (non-agent top-level fields)
  diffObject(oldConfig.defaults, newConfig.defaults, "defaults", changes);

  // Diff agents by name
  diffAgents(oldConfig.agents, newConfig.agents, changes);

  return {
    changes,
    hasReloadableChanges: changes.some((c) => c.reloadable),
    hasNonReloadableChanges: changes.some((c) => !c.reloadable),
  };
}

/**
 * Build a map of agents keyed by name for O(1) lookup.
 */
function agentsByName(
  agents: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const agent of agents) {
    const name = agent["name"] as string;
    map.set(name, agent);
  }
  return map;
}

/**
 * Diff agent arrays, matching by name.
 */
function diffAgents(
  oldAgents: readonly Record<string, unknown>[],
  newAgents: readonly Record<string, unknown>[],
  changes: ConfigChange[],
): void {
  const oldMap = agentsByName(oldAgents as Record<string, unknown>[]);
  const newMap = agentsByName(newAgents as Record<string, unknown>[]);

  // Check for removed agents
  for (const [name, oldAgent] of oldMap) {
    if (!newMap.has(name)) {
      changes.push({
        fieldPath: `agents.${name}`,
        oldValue: oldAgent,
        newValue: undefined,
        reloadable: false,
      });
    }
  }

  // Check for added agents
  for (const [name, newAgent] of newMap) {
    if (!oldMap.has(name)) {
      changes.push({
        fieldPath: `agents.${name}`,
        oldValue: undefined,
        newValue: newAgent,
        reloadable: false,
      });
    }
  }

  // Diff existing agents field by field
  for (const [name, oldAgent] of oldMap) {
    const newAgent = newMap.get(name);
    if (newAgent !== undefined) {
      diffObject(oldAgent, newAgent, `agents.${name}`, changes);
    }
  }
}

/**
 * Recursively diff two objects, recording leaf-level changes.
 */
function diffObject(
  oldObj: unknown,
  newObj: unknown,
  prefix: string,
  changes: ConfigChange[],
): void {
  // If values are identical (or structurally equal primitives), no diff
  if (oldObj === newObj) return;
  if (isDeepEqual(oldObj, newObj)) return;

  // If both are plain objects, recurse into keys
  if (isPlainObject(oldObj) && isPlainObject(newObj)) {
    const allKeys = new Set([
      ...Object.keys(oldObj),
      ...Object.keys(newObj),
    ]);
    for (const key of allKeys) {
      diffObject(
        (oldObj as Record<string, unknown>)[key],
        (newObj as Record<string, unknown>)[key],
        `${prefix}.${key}`,
        changes,
      );
    }
    return;
  }

  // Leaf-level change (or type mismatch like array vs object)
  changes.push({
    fieldPath: prefix,
    oldValue: oldObj,
    newValue: newObj,
    reloadable: classifyField(prefix),
  });
}

/**
 * Classify whether a field path is reloadable.
 *
 * A field is reloadable if its path matches any RELOADABLE_FIELDS pattern.
 * A field is non-reloadable if it matches NON_RELOADABLE_FIELDS or is unclassified.
 *
 * Pattern matching: "agents.*" in the pattern matches any agent name in the path.
 */
function classifyField(fieldPath: string): boolean {
  for (const pattern of RELOADABLE_FIELDS) {
    if (matchesPattern(fieldPath, pattern)) return true;
  }
  return false;
}

/**
 * Match a concrete field path against a pattern with wildcards.
 * Pattern "agents.*.channels" matches "agents.researcher.channels".
 */
function matchesPattern(fieldPath: string, pattern: string): boolean {
  const pathParts = fieldPath.split(".");
  const patternParts = pattern.split(".");

  if (pathParts.length < patternParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === "*") continue;
    if (patternParts[i] !== pathParts[i]) return false;
  }

  // Match if path is exactly the pattern length or a sub-path of the pattern
  return true;
}

/**
 * Deep equality check for JSON-compatible values.
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => isDeepEqual(val, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => isDeepEqual(aObj[key], bObj[key]));
  }

  return false;
}

/**
 * Check if a value is a plain object (not array, null, etc.).
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
