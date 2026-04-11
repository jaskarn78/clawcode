/**
 * Model pricing map and cost estimation for Claude model family.
 * Prices are per million tokens (input/output).
 *
 * Last verified: 2026-04-10
 */

/** Pricing entry for a single model (cost per million tokens). */
export type ModelPricing = {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
};

/**
 * Hardcoded price-per-token map for Claude models.
 * Key is the model name as reported by the SDK.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  haiku: Object.freeze({ inputPerMillion: 0.25, outputPerMillion: 1.25 }),
  sonnet: Object.freeze({ inputPerMillion: 3.0, outputPerMillion: 15.0 }),
  opus: Object.freeze({ inputPerMillion: 15.0, outputPerMillion: 75.0 }),
});

/**
 * Estimate the cost of a model interaction in USD.
 *
 * @param model - Model name (e.g., "haiku", "sonnet", "opus")
 * @param tokensIn - Number of input tokens
 * @param tokensOut - Number of output tokens
 * @returns Estimated cost in USD, or 0 if model is unknown
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const pricing = lookupPricing(model);
  if (!pricing) return 0;

  const inputCost = (tokensIn / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (tokensOut / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/** Look up pricing by exact key first, then by prefix match (e.g. "claude-sonnet-4-5" → sonnet). */
function lookupPricing(model: string): ModelPricing | undefined {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;

  const lower = model.toLowerCase();
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lower.includes(key)) return MODEL_PRICING[key];
  }
  return undefined;
}
