/**
 * Maps the user-facing generic aliases ("sonnet" | "opus" | "haiku") to the
 * explicit Claude model IDs the Agent SDK should use.
 *
 * The SDK/Claude Code CLI accepts either a generic alias or a full model ID.
 * Aliases resolve to whichever version the CLI ships with at the time, which
 * lags new releases. Pinning at the SDK boundary keeps `clawcode.yaml` readable
 * (`model: sonnet`) while guaranteeing which exact version runs.
 */

const MODEL_ALIAS_MAP = Object.freeze({
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
}) satisfies Readonly<Record<"sonnet" | "opus" | "haiku", string>>;

type ModelAlias = keyof typeof MODEL_ALIAS_MAP;

function isModelAlias(value: string): value is ModelAlias {
  return value in MODEL_ALIAS_MAP;
}

/**
 * Resolve a model alias to its pinned ID. Full model IDs pass through unchanged
 * so callers can also hand in explicit IDs without double-translation.
 */
export function resolveModelId(aliasOrId: string): string {
  return isModelAlias(aliasOrId) ? MODEL_ALIAS_MAP[aliasOrId] : aliasOrId;
}

/**
 * Advisor-specific alias map. The advisor model is Opus by convention
 * (per Anthropic's docs valid-pair table — Sonnet executor + Opus advisor
 * is the canonical pairing). Users typically write `"opus"` in their
 * `clawcode.yaml` `defaults.advisor.model` for readability; the Claude
 * Agent SDK's `advisorModel` option, however, expects a fully-qualified
 * model ID. This map handles that translation at the SDK boundary.
 *
 * Phase 117 only documents the Opus mapping (the advisor-pattern beta is
 * Opus-centric). Future advisor models can be added here without changing
 * call sites.
 *
 * See:
 *   - `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-RESEARCH.md` §13.7
 *   - <https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool>
 *     (executor/advisor pairing table)
 */
const ADVISOR_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  opus: "claude-opus-4-7",
  "claude-opus-4-7": "claude-opus-4-7",
});

export { ADVISOR_MODEL_ALIASES };

/**
 * Resolve an advisor model alias to its pinned SDK-compatible ID.
 * Unknown values pass through unchanged so operators can pin a specific
 * version directly in `clawcode.yaml` (e.g. `model: "claude-opus-4-7"`).
 */
export function resolveAdvisorModel(raw: string): string {
  return ADVISOR_MODEL_ALIASES[raw] ?? raw;
}
