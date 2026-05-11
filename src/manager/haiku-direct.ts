/**
 * Direct Anthropic SDK helper for one-shot Haiku calls.
 *
 * Auth root cause fix: sdk.query() spawns a claude subprocess that inherits
 * ANTHROPIC_API_KEY from /etc/clawcode/env and bills the API key account.
 * This module bypasses sdk.query() entirely — uses @anthropic-ai/sdk directly
 * with the OAuth Bearer token from ~/.claude/.credentials.json so all calls
 * bill the OAuth subscription instead.
 *
 * No subprocess. No settingSources. No hooks. No ANTHROPIC_API_KEY issue.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveModelId } from "./model-resolver.js";

export type HaikuCallOpts = { readonly signal?: AbortSignal };

export type VisionMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

async function loadOAuthToken(): Promise<string> {
  const path = join(homedir(), ".claude", ".credentials.json");
  const raw = await readFile(path, "utf-8");
  const creds = JSON.parse(raw) as Record<string, unknown>;
  // claudeAiOauth is an object with accessToken, refreshToken, expiresAt, etc.
  const oauth = creds["claudeAiOauth"] as Record<string, unknown> | undefined;
  const token = oauth?.["accessToken"];
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(
      "claudeAiOauth.accessToken missing from ~/.claude/.credentials.json",
    );
  }
  return token;
}

/**
 * Token-identity cache: rebuild the SDK client whenever the access token in
 * `.credentials.json` changes (auto-refresh by spawned `claude` subprocess,
 * manual `claude login`, out-of-band Anthropic-side rotation). The file is
 * tiny (~471B) and page-cached, so re-reading per call is cheaper than the
 * watcher bookkeeping a chokidar/fs.watch path would require.
 *
 * Without this — confirmed via Discord 401 incident 2026-05-11 — the daemon
 * caches a singleton Anthropic client with the *old* token baked into its
 * constructor and replays it forever. Refresh rotates the token in the file
 * but the in-process client never sees the new value; every call after the
 * rotation window hits HTTP 401 "Invalid authentication credentials".
 */
let cachedClient: Anthropic | null = null;
let cachedToken: string | null = null;

async function getClient(): Promise<Anthropic> {
  const token = await loadOAuthToken();
  if (cachedClient && cachedToken === token) return cachedClient;
  cachedClient = new Anthropic({ apiKey: null, authToken: token });
  cachedToken = token;
  return cachedClient;
}

/**
 * Defense-in-depth wrapper: if a request returns 401, invalidate the cached
 * client (in case the token rotated between `loadOAuthToken()` and the SDK's
 * HTTP send), reload, and retry exactly once. Covers the race at rotation
 * boundaries (~every 8h) where the file-read and the API call straddle the
 * refresh event. Non-401 errors propagate unchanged.
 */
async function createWithAuthRetry<T>(
  attempt: (client: Anthropic) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  try {
    return await attempt(client);
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status !== 401) throw err;
    cachedClient = null;
    cachedToken = null;
    const retryClient = await getClient();
    return await attempt(retryClient);
  }
}

/**
 * One-shot text-only Haiku call. Returns the first text block content,
 * or empty string if the response has no text content.
 */
export async function callHaikuDirect(
  systemPrompt: string,
  userPrompt: string,
  opts: HaikuCallOpts,
): Promise<string> {
  const response = await createWithAuthRetry((client) =>
    client.messages.create(
      {
        model: resolveModelId("haiku"),
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      { signal: opts.signal },
    ),
  );
  const block = response.content[0];
  return block?.type === "text" ? block.text : "";
}

/**
 * One-shot Haiku vision call. Encodes imageBuffer as base64, sends alongside
 * userPrompt, returns the first text block content.
 */
export async function callHaikuVision(
  systemPrompt: string,
  userPrompt: string,
  imageBuffer: Buffer,
  mediaType: VisionMediaType,
  opts: HaikuCallOpts,
): Promise<string> {
  const response = await createWithAuthRetry((client) =>
    client.messages.create(
      {
        model: resolveModelId("haiku"),
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBuffer.toString("base64"),
                },
              },
              { type: "text", text: userPrompt },
            ],
          },
        ],
      },
      { signal: opts.signal },
    ),
  );
  const block = response.content[0];
  return block?.type === "text" ? block.text : "";
}

/** Test-only: reset the cached client + token so tests can re-mock credentials. */
export function _resetClientForTests(): void {
  cachedClient = null;
  cachedToken = null;
}
