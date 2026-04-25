import { z } from "zod/v4";

/**
 * Supported IPC methods for CLI-to-daemon communication.
 * Maps to D-05: start, stop, restart, start-all, status.
 */
export const IPC_METHODS = [
  // Lifecycle
  "start",
  "stop",
  "restart",
  "start-all",
  "stop-all",
  "status",
  // Observability
  "routes",
  "rate-limit-status",
  "heartbeat-status",
  "schedules",
  "skills",
  "threads",
  "usage",
  "context-zone-status",
  "episode-list",
  "delivery-queue-status",
  "mcp-servers",
  // Phase 85 Plan 01 TOOL-01 — per-agent MCP state snapshot from the
  // SessionManager state map (fed by the warm-path readiness probe +
  // the `mcp-reconnect` heartbeat). Read by Plan 03's `/clawcode-tools`
  // slash command and by operators verifying live tool health.
  "list-mcp-status",
  // Phase 94 Plan 01 TOOL-01 — on-demand capability probe trigger.
  // Operators run `clawcode mcp-probe -a <agent>` to force an immediate
  // probe of all configured MCP servers (boot + heartbeat schedule
  // continues unaffected). Writes results back via setMcpStateForAgent
  // and returns the resulting capabilityProbe entries to the caller.
  "mcp-probe",
  // Phase 94 Plan 05 TOOL-08 / TOOL-09 — built-in Discord helpers wired
  // through the clawcode MCP server. The MCP tool handlers in
  // src/mcp/server.ts forward to these IPC methods so the daemon owns
  // the discord.js client + WebhookManager singletons (same pattern as
  // send-attachment / read-thread).
  "fetch-discord-messages",
  "share-file",
  // Phase 91 Plan 05 SYNC-08 — OpenClaw↔ClawCode sync snapshot. Reads
  // ~/.clawcode/manager/sync-state.json (authoritativeSide, open conflicts,
  // perFileHashes) and the last line of ~/.clawcode/manager/sync.jsonl
  // (last cycle outcome). Consumed by the /clawcode-sync-status inline
  // slash handler in slash-commands.ts — zero LLM turn cost, daemon-routed.
  "list-sync-status",
  // Messaging
  "send-message",
  "send-to-agent",
  "send-attachment",
  "slash-commands",
  "webhooks",
  "fork-session",
  // Memory
  "memory-search",
  "memory-lookup",
  "memory-list",
  "memory-graph",
  "memory-save",
  // Subagent threads
  "spawn-subagent-thread",
  "cleanup-subagent-thread",
  "read-thread",
  "message-history",
  // Security (Phase 27)
  "approve-command",
  "deny-command",
  "allow-always",
  "check-command",
  "update-security",
  "security-status",
  // Model tiering (Phase 39)
  "ask-advisor",
  "set-model",
  // Phase 87 CMD-02 — live SDK permission-mode swap via Query.setPermissionMode.
  "set-permission-mode",
  // Phase 88 MKT-01..07 — marketplace list / install / remove routed through
  // the pure-exported-handler blueprint (Phase 86 Plan 02). Returns typed
  // outcomes consumed by the Discord /clawcode-skills-browse + /clawcode-skills
  // inline handlers.
  "marketplace-list",
  "marketplace-install",
  "marketplace-remove",
  // Phase 90 Plan 05 HUB-02 / HUB-04 — ClawHub plugin listing + install.
  // Parallel to marketplace-list/install but routes through the ClawHub
  // plugin registry (not the skill flow) and writes to agents[*].mcpServers
  // via updateAgentMcpServers (yaml-writer.ts).
  "marketplace-list-plugins",
  "marketplace-install-plugin",
  // Phase 90 Plan 06 HUB-05 / HUB-07 — install-time config UX primitives.
  //   clawhub-oauth-start:  kick off GitHub device-code flow + return user_code
  //   clawhub-oauth-poll:   long-lived poll (up to 15min) that stores token in 1P
  //   marketplace-probe-op-items: 1Password op:// rewrite proposal for one field
  "clawhub-oauth-start",
  "clawhub-oauth-poll",
  "marketplace-probe-op-items",
  // Cost tracking (Phase 40)
  "costs",
  // Latency (Phase 50)
  "latency",
  // Bench (Phase 51)
  "bench-run-prompt",
  // Cache (Phase 52)
  "cache",
  // Tools (Phase 55)
  "tools",
  // Effort (reasoning level)
  "set-effort",
  "get-effort",
  // Document RAG (Phase 49)
  "ingest-document",
  "search-documents",
  "delete-document",
  "list-documents",
  // Agent provisioning
  "agent-create",
  // Cross-agent RPC / handoffs (Phase 59)
  "delegate-task",
  "task-status",
  "cancel-task",
  "task-complete",
  "task-retry",
  // Observability (Phase 63)
  "list-tasks",
  // OpenAI-compatible endpoint key management (Phase 69)
  "openai-key-create",
  "openai-key-list",
  "openai-key-revoke",
  // Browser automation MCP (Phase 70) — routes per-agent tool calls from
  // the out-of-process `clawcode browser-mcp` subprocess to the daemon's
  // shared BrowserManager + the pure handlers in src/browser/tools.ts.
  "browser-tool-call",
  // Web search MCP (Phase 71) — routes per-agent tool calls from the
  // out-of-process `clawcode search-mcp` subprocess to the daemon's
  // shared BraveClient/ExaClient + URL fetcher + the pure handlers in
  // src/search/tools.ts.
  "search-tool-call",
  // Image generation MCP (Phase 72) — routes per-agent tool calls from
  // the out-of-process `clawcode image-mcp` subprocess to the daemon's
  // shared image provider clients + the pure handlers in
  // src/image/tools.ts.
  "image-tool-call",
  // Phase 92 Plan 04 CUT-06 / CUT-07 — destructive-fix admin-clawdy embed
  // surface. Two IPC methods:
  //   - cutover-verify-summary: returns DestructiveCutoverGap[] for the
  //     /clawcode-cutover-verify slash command's embed batch render
  //   - cutover-button-action: handles Accept/Reject/Defer routed from
  //     the slash-commands.ts button collector with customId prefix
  //     `cutover-`. Closure-based intercept BEFORE routeMethod (mirrors
  //     marketplace handler pattern in daemon.ts ~line 2185).
  "cutover-verify-summary",
  "cutover-button-action",
  // Phase 92 Plan 06 GAP CLOSURE — operator-facing CLI ↔ daemon wiring for
  // CUT-09 + CUT-10. The CLI scaffolds in `src/cli/commands/cutover-verify.ts`
  // and `cutover-rollback.ts` no longer return exit-1 stubs; they connect to
  // the daemon via these IPC methods so the full pipeline (ingest → profile
  // → probe → diff → apply-additive → canary → report) and LIFO ledger
  // rewind are invocable from the operator CLI.
  //
  //   - cutover-verify:   runs runVerifyPipeline with production-wired DI
  //                       (turnDispatcher / dispatchStream / fetchApi /
  //                       listMcpStatus) and writes CUTOVER-REPORT.md.
  //                       Returns {cutoverReady, gapCount, canaryPassRate,
  //                       reportPath}.
  //   - cutover-rollback: reads cutover-ledger.jsonl, filters rows newer
  //                       than ledgerTo, reverses each in LIFO order via
  //                       Phase 86 atomic YAML writers + filesystem unlink
  //                       + destructive snapshot restore. Appends NEW
  //                       rollback rows (append-only invariant preserved).
  //                       Returns {rewoundCount, errors[]}.
  "cutover-verify",
  "cutover-rollback",
  // Phase 95 Plan 03 DREAM-07 — operator-driven dream-pass trigger.
  // Backs both `clawcode dream <agent>` (CLI) and `/clawcode-dream`
  // (Discord slash, admin-only). Daemon-side handler builds DI deps
  // (runDreamPass + applyDreamResult + isAgentIdle) at the edge and
  // returns {outcome: DreamPassOutcome, applied: DreamApplyOutcome,
  // agent, startedAt}. See src/manager/daemon.ts handleRunDreamPassIpc.
  "run-dream-pass",
  // Phase 96 Plan 05 D-03 — operator-driven filesystem capability probe
  // refresh. Backs both `clawcode probe-fs <agent>` (CLI) and
  // `/clawcode-probe-fs` (Discord slash, admin-only). Daemon-side handler
  // resolves fileAccess for the agent, runs runFsProbe (96-01), persists
  // snapshot via writeFsSnapshot, and returns FsProbeOutcome to caller.
  // See src/manager/daemon-fs-ipc.ts handleProbeFsIpc.
  "probe-fs",
  // Phase 96 Plan 05 D-04 — read-only FS capability snapshot for operator
  // inspection. Backs `clawcode fs-status -a <agent>` (CLI) and the
  // /clawcode-status Capability section render. Reads the persisted
  // fs-capability.json without re-probing. Mirrors list-mcp-status.
  "list-fs-status",
] as const;

export type IpcMethod = (typeof IPC_METHODS)[number];

/**
 * JSON-RPC 2.0 request schema for IPC messages.
 * Validates: jsonrpc must be "2.0", id is required string,
 * method must be one of IPC_METHODS, params is a record.
 */
export const ipcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.enum(IPC_METHODS),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type IpcRequest = z.infer<typeof ipcRequestSchema>;

/**
 * JSON-RPC 2.0 error object schema.
 */
const ipcErrorObjectSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

/**
 * JSON-RPC 2.0 response schema for IPC messages.
 * Must have either result or error (or both), but not neither.
 */
export const ipcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.string(),
    result: z.unknown().optional(),
    error: ipcErrorObjectSchema.optional(),
  })
  .check(
    z.refine((data) => data.result !== undefined || data.error !== undefined, {
      message: "Response must have either result or error",
    }),
  );

export type IpcResponse = z.infer<typeof ipcResponseSchema>;
