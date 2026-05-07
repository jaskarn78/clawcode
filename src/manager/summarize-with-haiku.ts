/**
 * summarizeWithHaiku — production SummarizeFn for SessionSummarizer.
 *
 * Wraps a one-shot sdk.query() call with:
 *   - model: haiku (resolves to claude-haiku-4-5 via resolveModelId)
 *   - allowDangerouslySkipPermissions: true (no tool use needed)
 *   - settingSources: [] (do NOT inherit agent settings — Pitfall 3 of
 *     66-RESEARCH: summarizer must run in its own config-free context so
 *     it cannot accidentally load skills or MCP servers)
 *   - abortController from caller-supplied signal
 *
 * Caller (SessionSummarizer) owns the timeout via its own AbortController +
 * setTimeout. This helper simply forwards the caller's signal into a fresh
 * AbortController that the SDK accepts.
 *
 * Signature matches `SummarizeFn` from src/memory/session-summarizer.types.ts
 * so it can be passed directly as deps.summarize to summarizeSession.
 */

import { resolveModelId } from "./model-resolver.js";
import type { SdkModule, SdkQueryOptions } from "./sdk-types.js";

const SUMMARIZE_SYSTEM_PROMPT =
  "You are a concise summarizer. Respond with only the requested markdown sections. Do not add commentary outside the requested structure.";

/**
 * Dynamically import the Claude Agent SDK. Cached on first call.
 * Mirrors session-adapter.ts::loadSdk but kept local to avoid circular deps.
 */
let cachedSdk: SdkModule | null = null;
async function loadSdk(): Promise<SdkModule> {
  if (cachedSdk) return cachedSdk;
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  cachedSdk = sdk as unknown as SdkModule;
  return cachedSdk;
}

/**
 * Runs a one-shot Haiku query for session summarization.
 *
 * @param prompt   The fully-built summarization prompt (from
 *                 buildSessionSummarizationPrompt).
 * @param opts     Caller-supplied abort signal. summarizeSession pipes its
 *                 timeout controller's signal here.
 * @returns        The result text from the first successful result message.
 *                 Empty string if no result — caller treats this as failure
 *                 and falls back to the raw-turn markdown.
 * @throws         If the SDK cannot be loaded or the query stream throws
 *                 before a result message arrives. Callers wrap in try/catch.
 */
export async function summarizeWithHaiku(
  prompt: string,
  opts: { readonly signal?: AbortSignal },
): Promise<string> {
  const sdk = await loadSdk();

  // Create a fresh AbortController and pipe the caller's signal into it.
  // The SDK accepts an AbortController (not a bare signal), so we need a
  // local controller whose signal we can hand over.
  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort();
    } else {
      opts.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  // Use global settings to load OAuth credentials — same auth path as agents.
  // Strip ANTHROPIC_API_KEY so the API key account is never billed.
  const { ANTHROPIC_API_KEY: _stripped, ...cleanEnv } = process.env;

  const options: SdkQueryOptions = {
    model: resolveModelId("haiku"),
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    allowDangerouslySkipPermissions: true,
    settingSources: ["global"],
    tools: [],
    abortController: controller,
    env: cleanEnv as Record<string, string | undefined>,
  };

  const q = sdk.query({ prompt, options });

  let result = "";
  for await (const msg of q) {
    if (
      msg.type === "result" &&
      msg.subtype === "success" &&
      typeof msg.result === "string" &&
      msg.result.length > 0
    ) {
      result = msg.result;
      break;
    }
  }
  return result;
}

/**
 * Test-only hook: reset the cached SDK module so tests can re-mock it.
 * Not exported from any public module index.
 */
export function _resetSdkCacheForTests(): void {
  cachedSdk = null;
}
