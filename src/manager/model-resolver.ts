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
  opus: "claude-opus-4-6",
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
