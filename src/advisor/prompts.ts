/**
 * Advisor system-prompt builder.
 *
 * Ported verbatim from `src/manager/daemon.ts:9836–9841` (current
 * fork-based `ask-advisor` IPC handler). The string this function
 * returns is byte-identical to what the inline construction in
 * `daemon.ts` would produce for the same inputs — a parity guarantee
 * verified by `__tests__/prompts.test.ts` BEFORE the extraction in
 * Plan 117-03 rewires `daemon.ts` to call this function.
 *
 * See:
 *   - `src/manager/daemon.ts:9836` (current inline definition — source of truth)
 *   - `.planning/phases/117-claude-code-advisor-pattern-multi-backend-scaffold-anthropic/117-RESEARCH.md`
 *     (§3 file map row for `src/advisor/prompts.ts`)
 */

/**
 * Build the advisor system prompt for one consultation.
 *
 * Matches `daemon.ts:9836` exactly:
 * ```
 * const systemPrompt = [
 *   `You are an advisor to agent "${agentName}". Provide concise, actionable guidance.`,
 *   ...(memoryContext
 *     ? ["\nRelevant context from agent's memory:", memoryContext]
 *     : []),
 * ].join("\n");
 * ```
 *
 * @param agent - Agent name (interpolated into the opening line).
 * @param memoryContext - Optional pre-formatted memory snippet block.
 *   When falsy (null / undefined / empty string), the memory section
 *   is omitted entirely — matching the existing inline behavior where
 *   an empty `memoryContext` string short-circuits the spread.
 * @returns The fully assembled system prompt string.
 */
export function buildAdvisorSystemPrompt(
  agent: string,
  memoryContext?: string | null,
): string {
  return [
    `You are an advisor to agent "${agent}". Provide concise, actionable guidance.`,
    ...(memoryContext
      ? ["\nRelevant context from agent's memory:", memoryContext]
      : []),
  ].join("\n");
}
