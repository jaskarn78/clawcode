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
