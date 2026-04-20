/**
 * Phase 78 CONF-03 — model mapping from OpenClaw model ids to ClawCode
 * model ids. Hardcoded table covers the 7 known on-box ids; anything else
 * emits a structured warning with a literal copy that operators can
 * mechanically translate into a --model-map override.
 *
 * The warning template is LOAD-BEARING — phase success criterion #3 pins
 * the exact string. Any drift (em-dash vs hyphen, different quote style,
 * missing phrase) breaks the `rg` grep in 78-03-PLAN.md acceptance.
 *
 * DO NOT:
 *   - Add new dependencies — yaml / zod already cover every need.
 *   - Make the map mutable — callers that want overrides use mergeModelMap.
 *   - Put fs writes / subprocess spawns here — config-mapper.ts is the
 *     only consumer and it is also pure.
 */

/**
 * Hardcoded DEFAULT_MODEL_MAP. LOCKED per 78-CONTEXT. Each entry is one of
 * the 7 model ids seen in the 15 on-box OpenClaw agents as of 2026-04-20.
 * Older model versions (sonnet-4-5, opus-4-6) fold up to the current
 * family alias (sonnet, opus) so operators are not forced to re-pick
 * behind-a-version agents.
 */
export const DEFAULT_MODEL_MAP: Readonly<Record<string, string>> =
  Object.freeze({
    "anthropic-api/claude-sonnet-4-6": "sonnet",
    "anthropic-api/claude-opus-4-7":   "opus",
    "anthropic-api/claude-haiku-4-5":  "haiku",
    "anthropic-api/claude-sonnet-4-5": "sonnet",
    "anthropic-api/claude-opus-4-6":   "opus",
    "minimax/abab6.5":                 "minimax",
    "clawcode/admin-clawdy":           "clawcode/admin-clawdy",
  });

/**
 * Literal warning copy for unmappable model ids. Success criterion #3 of
 * Phase 78 pins the exact string. Use `<id>` and `<clawcode-id>` as
 * placeholders so the template grep stays stable while the per-id warning
 * substitutes the real values.
 *
 * Byte-exact: em-dash is U+2014, warning sigil is U+26A0. Do NOT replace
 * either with ASCII equivalents.
 */
export const UNMAPPABLE_MODEL_WARNING_TEMPLATE =
  '⚠ unmappable model: <id> — pass --model-map "<id>=<clawcode-id>" or edit plan.json';

/**
 * Render the literal unmappable-model warning with the offending id
 * substituted. Both `<id>` occurrences get the same value; `<clawcode-id>`
 * stays literal so the operator sees the expected shape of the override.
 */
export function renderUnmappableModelWarning(id: string): string {
  return UNMAPPABLE_MODEL_WARNING_TEMPLATE.replace(/<id>/g, id);
}

/**
 * Parse --model-map flag values into a Record<string, string>. Each flag
 * value must contain exactly one "=" at the LHS/RHS boundary (the first
 * "="); subsequent "=" characters stay in the value.
 *
 * Throws Error (sync, not async) with a message containing
 * "invalid --model-map syntax" when any entry is malformed. Fail-fast is
 * intentional — a typo in a CLI flag must surface before guards run, not
 * land silently as a missing mapping.
 */
export function parseModelMapFlag(
  flags: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const flag of flags) {
    const eqIdx = flag.indexOf("=");
    if (eqIdx <= 0 || eqIdx === flag.length - 1) {
      throw new Error(
        `invalid --model-map syntax: "${flag}" — expected "oc-id=cc-id"`,
      );
    }
    const lhs = flag.slice(0, eqIdx);
    const rhs = flag.slice(eqIdx + 1);
    out[lhs] = rhs;
  }
  return out;
}

/**
 * Merge user overrides onto defaults. User keys win; defaults fill gaps.
 * Pure — returns a new object, never mutates either input.
 */
export function mergeModelMap(
  defaults: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...defaults, ...overrides };
}

/**
 * Look up a mapping. When missing, return a rendered warning instead.
 * Structured return ({mapped, warning}) lets callers thread the warning
 * into a PlanReport warnings array without needing a second pass.
 */
export function mapModel(
  modelId: string,
  map: Readonly<Record<string, string>>,
): { mapped: string | undefined; warning: string | undefined } {
  const mapped = map[modelId];
  if (mapped !== undefined) return { mapped, warning: undefined };
  return {
    mapped: undefined,
    warning: renderUnmappableModelWarning(modelId),
  };
}
