/**
 * Phase 113 — Haiku 4.5 vision pre-pass for Discord image attachments.
 *
 * Fires a one-shot Haiku call with the image as a base64 content block and
 * returns a structured text extraction. The caller injects this as a
 * `<screenshot-analysis>` block so the main agent (Sonnet/Opus) can process
 * only text, skipping the vision round-trip.
 *
 * Fallback contract: returns "" on any failure — caller preserves the
 * existing "(Image downloaded -- read the file at ...)" hint unchanged.
 *
 * Follows the summarize-with-haiku.ts pattern: dynamic SDK load, isolated
 * settingSources: [], allowDangerouslySkipPermissions: true.
 */

import { readFile } from "node:fs/promises";
import { resolveModelId } from "./model-resolver.js";
import { resizeForVision } from "../discord/image-resize.js";
import { isErrorSummary } from "../memory/error-guard.js";
import type { SdkModule, SdkQueryOptions, SdkUserMessage } from "./sdk-types.js";

const VISION_SYSTEM_PROMPT =
  "You are a precise visual content extractor. Output only the requested structured text — no commentary, no markdown fences.";

const VISION_EXTRACTION_PROMPT =
  "Extract from this image:\n" +
  "1. All visible text verbatim (preserve formatting, line breaks, code blocks)\n" +
  "2. UI element descriptions (buttons, inputs, menus, status indicators)\n" +
  "3. Any error messages, warnings, or highlighted items\n" +
  "4. Overall layout description (one sentence)\n\n" +
  "Format:\n" +
  "TEXT: <all visible text>\n" +
  "UI: <ui elements>\n" +
  "ALERTS: <errors/warnings/highlights or 'none'>\n" +
  "LAYOUT: <one sentence>";

let cachedSdk: SdkModule | null = null;
async function loadSdk(): Promise<SdkModule> {
  if (cachedSdk) return cachedSdk;
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  cachedSdk = sdk as unknown as SdkModule;
  return cachedSdk;
}

/** Test-only: reset cached SDK so tests can inject mocks. */
export function _resetSdkCacheForTests(): void {
  cachedSdk = null;
}

/**
 * Run a Haiku vision pre-pass on a pre-resized image buffer.
 *
 * @param imageBuffer  Resized image bytes (JPEG recommended).
 * @param mimeType     MIME type string, e.g. "image/jpeg".
 * @param opts         Optional abort signal (piped from the calling turn).
 * @returns            Structured text extraction, or "" on any failure.
 */
export async function runVisionPrepass(
  imageBuffer: Buffer,
  mimeType: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const sdk = await loadSdk();

  const controller = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort();
    } else {
      opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  // Use global settings so the subprocess loads OAuth credentials from
  // ~/.claude/ — same auth path as the main agents. Strip ANTHROPIC_API_KEY
  // so the API key account is never charged (OAuth subscription covers vision).
  // tools:[] prevents any tool loading since this is a one-shot vision call.
  const { ANTHROPIC_API_KEY: _stripped, ...cleanEnv } = process.env;

  const options: SdkQueryOptions = {
    model: resolveModelId("haiku"),
    systemPrompt: VISION_SYSTEM_PROMPT,
    allowDangerouslySkipPermissions: true,
    settingSources: ["global"],
    tools: [],
    abortController: controller,
    env: cleanEnv as Record<string, string | undefined>,
  };

  const base64Data = imageBuffer.toString("base64");

  // Build content block message using the richer SDK shape (cast pattern from
  // persistent-session-handle.ts:291-299 — the SDK accepts extra fields).
  const userMessage = {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } },
        { type: "text", text: VISION_EXTRACTION_PROMPT },
      ],
    },
    parent_tool_use_id: null,
    content: VISION_EXTRACTION_PROMPT,
  } as unknown as SdkUserMessage;

  async function* makeIterable(): AsyncGenerator<SdkUserMessage> {
    yield userMessage;
  }

  try {
    const q = sdk.query({ prompt: makeIterable(), options });
    let result = "";
    for await (const msg of q) {
      if (
        msg.type === "result" &&
        msg.subtype === "success" &&
        typeof msg.result === "string" &&
        msg.result.length > 0
      ) {
        // Guard: SDK returns API error text as a successful result — same
        // class of bug fixed in consolidation worker (999.39). Treat as failure.
        if (!isErrorSummary(msg.result)) {
          result = msg.result;
        }
        break;
      }
    }
    return result;
  } catch {
    return "";
  }
}

/**
 * Read an image from disk, resize it, and run the vision pre-pass.
 * Convenience wrapper used by bridge.ts.
 *
 * @returns Structured analysis string, or "" on any failure.
 */
export async function runVisionPrepassForFile(
  filePath: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  try {
    const raw = await readFile(filePath);
    const { buffer, mimeType } = await resizeForVision(raw);
    return await runVisionPrepass(buffer, mimeType, opts);
  } catch {
    return "";
  }
}
