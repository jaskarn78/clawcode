/**
 * Phase 69 Plan 02 — OpenAI wire-format schemas + TS types.
 *
 * Exports Zod v4 schemas for INCOMING request shapes (validated at the HTTP
 * boundary) and pure TypeScript types for OUTGOING response shapes (we build
 * these, we don't validate them). Also exports Claude-side intermediate types
 * that `src/openai/translator.ts` produces from OpenAI inputs.
 *
 * Design rules enforced here (cross-referenced to 69-RESEARCH.md Pitfalls):
 *
 *   - Pitfall 2: OpenAI SDK validators are STRICT on required top-level fields
 *     (`id`, `object`, `created`, `model`). Every response/chunk TS type marks
 *     them all required. `created` is epoch SECONDS, never milliseconds.
 *   - Pitfall 2: `usage` on streaming chunks is OMITTED by default — clients
 *     that want it send `stream_options.include_usage: true`. We reflect that
 *     as an optional field on `ChatCompletionChunk` (absent by default).
 *   - Pitfall 2: `passthrough()` on the incoming request so OpenAI's own
 *     extension fields (e.g. `reasoning_effort`, `service_tier`) don't trip
 *     the parser. We never read them; we just don't block them.
 *   - Pitfall 3: role appears once on first streaming chunk — enforced in
 *     translator.ts; the delta type permits optional `role`.
 *   - Pitfall 4: SSE framing is stream.ts's responsibility; types carry the
 *     shape only.
 *   - Pitfall 8: `clientSystemAppend` flows into `systemPrompt.append` — NEVER
 *     overrides the stable prefix (prompt-cache preservation).
 *
 * Also re-exports the SdkStreamEvent shape the translator consumes from the
 * Claude Agent SDK — a minimal copy of the subset of fields we actually touch.
 * The server receives these events from the injected OpenAiSessionDriver (the
 * mock in tests; the real SessionManager-backed driver in Plan 03).
 */

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Incoming request schemas (Zod — validated at boundary)
// ---------------------------------------------------------------------------

/**
 * OpenAI tool-call delta inside an `assistant` message (when the client
 * re-sends prior assistant turns). We accept the shape but do not consume
 * these historical tool_calls — the underlying Claude session already has
 * them via `resume:`. Presence is tolerated for spec conformance.
 */
const assistantToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

/**
 * Chat message discriminated union on `role`:
 *   - `system`, `user`  — `content` required string
 *   - `assistant`       — `content` nullable string, optional `tool_calls`
 *   - `tool`            — `tool_call_id` required, `content` required string
 *
 * Zod v4 uses `z.discriminatedUnion` with each option as an object whose
 * `role` field is a literal. `.passthrough()` is intentionally NOT set on the
 * branches — the outer request schema passes through, per Pitfall 2.
 */
export const chatMessageSchema = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("system"),
    content: z.string(),
  }),
  z.object({
    role: z.literal("user"),
    content: z.string(),
  }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(assistantToolCallSchema).optional(),
  }),
  z.object({
    role: z.literal("tool"),
    tool_call_id: z.string(),
    content: z.string(),
  }),
]);

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * OpenAI tool definition — `{type:"function", function:{name, description?, parameters?}}`.
 * `parameters` is a JSON Schema object; we pass it through as-is.
 */
export const toolDefSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.any()).optional(),
  }),
});

export type ToolDef = z.infer<typeof toolDefSchema>;

/**
 * `tool_choice`: literal "auto"/"none"/"required" OR a named function selector.
 */
export const toolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({
    type: z.literal("function"),
    function: z.object({
      name: z.string().min(1),
    }),
  }),
]);

export type ToolChoice = z.infer<typeof toolChoiceSchema>;

/**
 * `stream_options` — tiny sub-object used only by clients that want the
 * streaming `usage` final chunk (Pitfall 2).
 */
export const streamOptionsSchema = z.object({
  include_usage: z.boolean().optional(),
});

/**
 * Chat Completion request body (`POST /v1/chat/completions`).
 *
 * `.passthrough()` allows OpenAI-spec extension fields (reasoning_effort,
 * service_tier, user, presence_penalty, etc.) to flow through without
 * blocking. Our translator consumes only the fields it understands.
 */
export const chatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    tools: z.array(toolDefSchema).optional(),
    tool_choice: toolChoiceSchema.optional(),
    stream_options: streamOptionsSchema.optional(),
  })
  .passthrough();

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

// ---------------------------------------------------------------------------
// Outgoing response TS types (we build, never validate)
// ---------------------------------------------------------------------------

/** Final-form tool_call object in a non-streaming response `message`. */
export interface ChatCompletionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** Partial tool_call delta in a streaming chunk. */
export interface ChatCompletionToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Token-usage sub-object. */
export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Non-streaming response shape for `POST /v1/chat/completions`.
 *
 * Required top-level fields (Pitfall 2): `id`, `object`, `created`, `model`,
 * `choices`, `usage`. `system_fingerprint` is present and explicitly `null`
 * (OpenAI's own responses do the same when no fingerprint is available).
 */
export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
    logprobs: null;
  }>;
  usage: ChatCompletionUsage;
  system_fingerprint: null;
}

/**
 * Streaming chunk shape for `POST /v1/chat/completions` with `stream:true`.
 *
 * Delta rules (Pitfall 3): `role` appears on the first chunk only. Middle
 * chunks carry `content` or `tool_calls` deltas. Final chunk carries an empty
 * delta `{}` plus `finish_reason`. `usage` is absent unless the client
 * requested `stream_options.include_usage` — in which case it arrives in a
 * separate trailing chunk with `choices: []` (Plan 02 does not implement that
 * trailing chunk yet; the type permits it for Plan 03 extension).
 */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: ChatCompletionToolCallDelta[];
    };
    finish_reason: "stop" | "length" | "tool_calls" | null;
  }>;
  usage?: ChatCompletionUsage;
}

/**
 * OpenAI error envelope. Every 4xx/5xx response body matches this shape.
 * `code` is `null` when no machine code applies.
 */
export interface OpenAiError {
  error: {
    message: string;
    type:
      | "invalid_request_error"
      | "authentication_error"
      | "permission_error"
      | "not_found_error"
      | "server_error"
      | "rate_limit_exceeded";
    code: string | null;
  };
}

/** `GET /v1/models` response. `owned_by` is always `"clawcode"`. */
export interface ModelsListResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: "clawcode";
  }>;
}

// ---------------------------------------------------------------------------
// Claude-side intermediate types (translator output → driver input)
// ---------------------------------------------------------------------------

/**
 * Claude `tool_choice` as consumed by the Claude Agent SDK.
 *
 * Mapping (Pattern 4 in 69-RESEARCH.md):
 *   OpenAI `"auto"`     → `{type:"auto"}`
 *   OpenAI `"none"`     → `{type:"none"}`
 *   OpenAI `"required"` → `{type:"any"}`
 *   OpenAI named        → `{type:"tool", name}`
 */
export type ClaudeToolChoice =
  | { type: "auto" }
  | { type: "none" }
  | { type: "any" }
  | { type: "tool"; name: string };

/** Claude tool definition. `input_schema` is the OpenAI `parameters` JSON Schema. */
export interface ClaudeToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Claude `tool_result` block — produced from a client `role:"tool"` message.
 * `tool_use_id` matches the OpenAI `tool_call_id` on the inbound message.
 */
export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

// ---------------------------------------------------------------------------
// SDK stream event shape (minimal — translator.ts consumes this subset)
// ---------------------------------------------------------------------------

/**
 * Subset of `@anthropic-ai/claude-agent-sdk` stream message types that
 * translator.ts needs. Mirrors the real SDK shape (see
 * `src/manager/session-adapter.ts` for the full usage) — translator.ts
 * treats these as pure values, never introspecting beyond these fields.
 *
 * Recorded as JSON in `__tests__/fixtures/sdk-stream-*.json` for replay tests.
 */
export type SdkStreamEvent =
  | {
      type: "stream_event";
      event:
        | {
            type: "content_block_start";
            index: number;
            content_block:
              | { type: "text" }
              | { type: "tool_use"; id: string; name: string; input?: unknown };
          }
        | {
            type: "content_block_delta";
            index: number;
            delta:
              | { type: "text_delta"; text: string }
              | { type: "input_json_delta"; partial_json: string };
          }
        | {
            type: "content_block_stop";
            index: number;
          };
    }
  | {
      type: "assistant";
      message: {
        content: Array<
          | { type: "text"; text: string }
          | { type: "tool_use"; id: string; name: string; input: unknown }
        >;
      };
      session_id?: string;
      parent_tool_use_id: string | null;
    }
  | {
      type: "result";
      session_id: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
      is_error?: boolean;
      subtype?: string;
    };

/**
 * Claude usage shape as emitted on the `result` message. Translator maps this
 * to OpenAI `usage`:
 *
 *   prompt_tokens     = input_tokens + cache_read_input_tokens
 *   completion_tokens = output_tokens
 *   total_tokens      = prompt_tokens + completion_tokens
 */
export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
}
