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

let cachedClient: Anthropic | null = null;

async function getClient(): Promise<Anthropic> {
  if (cachedClient) return cachedClient;
  const token = await loadOAuthToken();
  cachedClient = new Anthropic({ apiKey: null, authToken: token });
  return cachedClient;
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
  const client = await getClient();
  const response = await client.messages.create(
    {
      model: resolveModelId("haiku"),
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    },
    { signal: opts.signal },
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
  const client = await getClient();
  const response = await client.messages.create(
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
  );
  const block = response.content[0];
  return block?.type === "text" ? block.text : "";
}

/** Test-only: reset the cached client so tests can re-mock credentials. */
export function _resetClientForTests(): void {
  cachedClient = null;
}
