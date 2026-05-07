/**
 * summarizeWithHaiku — production SummarizeFn for SessionSummarizer.
 *
 * Delegates to callHaikuDirect (haiku-direct.ts) which uses @anthropic-ai/sdk
 * directly with the OAuth Bearer token from ~/.claude/.credentials.json.
 * This avoids the sdk.query() subprocess path that inherits ANTHROPIC_API_KEY
 * from /etc/clawcode/env and would bill the API key account instead of the
 * OAuth subscription.
 *
 * Signature matches `SummarizeFn` from src/memory/session-summarizer.types.ts
 * so it can be passed directly as deps.summarize to summarizeSession.
 */

import { callHaikuDirect } from "./haiku-direct.js";

const SUMMARIZE_SYSTEM_PROMPT =
  "You are a concise summarizer. Respond with only the requested markdown sections. Do not add commentary outside the requested structure.";

/**
 * Runs a one-shot Haiku call for session summarization via direct OAuth auth.
 *
 * @param prompt   The fully-built summarization prompt.
 * @param opts     Caller-supplied abort signal.
 * @returns        The result text, or empty string on failure.
 */
export async function summarizeWithHaiku(
  prompt: string,
  opts: { readonly signal?: AbortSignal },
): Promise<string> {
  return callHaikuDirect(SUMMARIZE_SYSTEM_PROMPT, prompt, opts);
}

/** Test-only: kept for backward compat — no SDK cache to reset in this module. */
export function _resetSdkCacheForTests(): void {
  // no-op
}
