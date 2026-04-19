import type { BrowserToolOutcome } from "../browser/types.js";

/**
 * Phase 70 — IPC type contracts shared between the daemon and the
 * out-of-process browser MCP server (`clawcode browser-mcp`).
 *
 * This file holds ONLY the type declarations for new IPC methods added
 * as part of Phase 70. Plan 03 wires the daemon-side handler in
 * `src/manager/daemon.ts` and adds `"browser-tool-call"` to the
 * `IPC_METHODS` tuple in `src/ipc/protocol.ts` (the runtime enum).
 *
 * Keeping the type contract separate from the enum avoids forcing Plan 02
 * to touch `protocol.ts` (which is imported broadly) before the daemon
 * handler exists.
 */

/**
 * Parameters for the `browser-tool-call` IPC method.
 *
 * Flow: MCP subprocess (out-of-process) receives a tool call from the
 * Claude SDK over stdio → the handler in `src/browser/mcp-server.ts`
 * packs `{ agent, toolName, args }` into this shape → `sendIpcRequest`
 * hands it to the daemon → the daemon resolves the agent's workspace,
 * fetches the cached BrowserContext from `BrowserManager`, and invokes
 * the matching pure handler from `src/browser/tools.ts`.
 */
export interface IpcBrowserToolCallParams {
  readonly agent: string;
  readonly toolName:
    | "browser_navigate"
    | "browser_screenshot"
    | "browser_click"
    | "browser_fill"
    | "browser_extract"
    | "browser_wait_for";
  readonly args: Record<string, unknown>;
}

/**
 * Result type for the `browser-tool-call` IPC method.
 *
 * The daemon returns the raw `BrowserToolOutcome` from the pure tool
 * handler — the subprocess layer shapes it into an MCP content envelope
 * (text, or text + image for screenshots with inlineBase64).
 */
export type IpcBrowserToolCallResult = BrowserToolOutcome;

/* ------------------------------------------------------------------ */
/*  Phase 71 — Web Search MCP IPC contract                             */
/* ------------------------------------------------------------------ */

/**
 * Parameters for the `search-tool-call` IPC method.
 *
 * Flow (mirrors Phase 70's browser-tool-call):
 *   Claude SDK spawns `clawcode search-mcp` per agent session →
 *   `src/search/mcp-server.ts` receives a tool call over stdio →
 *   packs `{ agent, toolName, args }` into this shape →
 *   `sendIpcRequest(SOCKET_PATH, "search-tool-call", ...)` →
 *   daemon dispatches to `handleSearchToolCall` in
 *   `src/search/daemon-handler.ts`, which calls `webSearch` or
 *   `webFetchUrl` against the daemon-owned BraveClient/ExaClient/fetcher.
 */
export interface IpcSearchToolCallParams {
  readonly agent: string;
  readonly toolName: "web_search" | "web_fetch_url";
  readonly args: Record<string, unknown>;
}

/**
 * Result type for `search-tool-call`. Widened to `unknown` on the success
 * branch to keep the IPC layer shallowly-typed — concrete shapes
 * (`SearchResponse`, `FetchUrlResult`) live in the search module and are
 * re-narrowed by the MCP subprocess when shaping the content envelope.
 */
export type IpcSearchToolCallResult =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly error: {
        readonly type: string;
        readonly message: string;
        readonly [k: string]: unknown;
      };
    };

/* ------------------------------------------------------------------ */
/*  Phase 72 — Image Generation MCP IPC contract                       */
/* ------------------------------------------------------------------ */

/**
 * Parameters for the `image-tool-call` IPC method.
 *
 * Flow (mirrors Phase 70/71):
 *   Claude SDK spawns `clawcode image-mcp` per agent session →
 *   `src/image/mcp-server.ts` receives a tool call over stdio →
 *   packs `{ agent, toolName, args }` into this shape →
 *   `sendIpcRequest(SOCKET_PATH, "image-tool-call", ...)` →
 *   daemon dispatches to `handleImageToolCall` in
 *   `src/image/daemon-handler.ts`, which calls `imageGenerate`,
 *   `imageEdit`, or `imageVariations` against the daemon-owned
 *   OpenAI/MiniMax/fal image provider clients.
 */
export interface IpcImageToolCallParams {
  readonly agent: string;
  readonly toolName: "image_generate" | "image_edit" | "image_variations";
  readonly args: Record<string, unknown>;
}

/**
 * Result type for `image-tool-call`. Widened to `unknown` on the success
 * branch to keep the IPC layer shallowly-typed — concrete shapes
 * (`ImageGenerateResult`, `ImageEditResult`, `ImageVariationsResult`)
 * live in the image module and are re-narrowed by the MCP subprocess
 * when shaping the content envelope.
 */
export type IpcImageToolCallResult =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly error: {
        readonly type: string;
        readonly message: string;
        readonly [k: string]: unknown;
      };
    };
