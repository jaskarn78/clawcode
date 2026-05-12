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
  // Phase 103 OBS-06 — per-agent OAuth Max rate-limit snapshots (NOT the
  // Discord outbound rate-limiter — that's the existing "rate-limit-status"
  // IPC at line 17, which is a SEPARATE domain). Reads the per-agent
  // RateLimitTracker constructed by SessionManager.startAgent. Consumed by
  // the /clawcode-usage Discord slash command + /clawcode-status session/
  // weekly bar suffix (Plan 03).
  "list-rate-limit-snapshots",
  // Phase 116-postdeploy 2026-05-11 — fleet aggregate over per-agent
  // RateLimitTracker. Loops manager.getRunningAgents() and calls the
  // single-agent handler internally. Backs GET /api/usage on the SPA's
  // Usage page (subscription utilization surface).
  "list-rate-limit-snapshots-fleet",
  // Phase 115 Plan 05 — lazy-load memory tools backing the agent-facing
  // clawcode_memory_* MCP tools (search / recall / edit / archive). Each
  // resolves into the per-agent MemoryStore with cross-agent isolation
  // enforced at this resolution layer. The MCP tool surface called these
  // IPC methods via `sendIpcRequest` but the allowlist had not picked
  // them up — caught 2026-05-12 by the protocol-daemon-parity sentinel.
  "clawcode-memory-search",
  "clawcode-memory-recall",
  "clawcode-memory-edit",
  "clawcode-memory-archive",
  // Phase 999.14 MCP-10 — operator escape hatches for the stale-binding
  // sweep. `threads-prune-stale` runs the sweep on demand with an
  // operator-supplied threshold; `threads-prune-agent` force-prunes ALL
  // bindings for one agent without calling Discord. Same parity-drift
  // class as the clawcode-memory-* methods above.
  "threads-prune-stale",
  "threads-prune-agent",
  // Quick 260511-pw3 — schema-registry introspection for cross-agent
  // typed delegations. Returns the target's accepted schemas with
  // `callerAllowed` + `registered` flags so the sender's LLM can choose
  // a valid schema before calling `delegate_task`. Same parity-drift
  // class — backed the new `list_agent_schemas` MCP tool but the wire
  // allowlist had not picked it up.
  "list-agent-schemas",
  // Messaging
  // Phase 999.2 Plan 02 D-RNI-IPC-01 / D-RNI-IPC-02 — canonical IPC names
  // (ask-agent, post-to-agent) registered FIRST; old names retained as
  // back-compat aliases so existing CLI tools and external IPC consumers
  // continue to work. Daemon switch handles both via stacked-case form
  // (RESEARCH.md §Pattern 2). Soft removal slated ~30 days post-deploy
  // (D-RNX-03) once operator confirms no agent SOUL/SKILL still references
  // them — operators grep daemon logs for `deprecated.*alias.*used` to
  // confirm the trigger.
  "ask-agent",
  "send-message", // DEPRECATED — use ask-agent (Phase 999.2 D-RNI-IPC-01); kept for back-compat
  "post-to-agent",
  "send-to-agent", // DEPRECATED — use post-to-agent (Phase 999.2 D-RNI-IPC-02); kept for back-compat
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
  // Phase 107 VEC-CLEAN-03 — operator-driven orphan cleanup. Removes
  // vec_memories rows whose memory_id no longer exists in `memories`
  // (orphans accumulated from historical CHECK-constraint table-recreation
  // migrations or any future delete path that bypasses MemoryStore.delete).
  // Backs `clawcode memory cleanup-orphans [-a <agent>]`. Daemon-side
  // dispatch is a closure intercept BEFORE routeMethod that resolves
  // MemoryStore via manager.getMemoryStore(agent) and calls
  // store.cleanupOrphans() per agent. Returns { results: [...] }.
  "memory-cleanup-orphans",
  // Phase 115 D-08 — embedding-v2 migration IPC surface. Operator-driven
  // via `clawcode memory migrate-embeddings <subcommand>` CLI. Each one
  // takes `agent` (single agent) or omits it (all agents). State machine
  // lives in src/memory/migrations/embedding-v2.ts; daemon-side handlers
  // construct EmbeddingV2Migrator per-agent on each call (no shared
  // singleton — Phase 90 per-agent isolation lock).
  "embedding-migration-status",
  "embedding-migration-transition",
  "embedding-migration-pause",
  "embedding-migration-resume",
  // Phase 999.8 follow-up — operator-triggered tier-maintenance backfill.
  // Runs the same `TierManager.runMaintenance()` the heartbeat runs every
  // 6h, but on-demand for one agent or all agents at once. Used to seed
  // hot/cold tier distribution after the Phase 107 heartbeat-discovery
  // fix without waiting for the next scheduled tick.
  "tier-maintenance-tick",
  // Subagent threads
  "spawn-subagent-thread",
  "cleanup-subagent-thread",
  // Phase 999.25 — explicit work-completion signal from the subagent.
  // Decouples relayCompletionToParent from session-end so operators see
  // results in their channel within seconds of work-done, not hours
  // later when the session is finally stopped. Handler looks up the
  // calling agent's binding by sessionName, skips if no binding (silent
  // no-op for operator agents that mistakenly call this), skips if
  // already completed (idempotent), else fires relay + sets
  // binding.completedAt.
  "subagent-complete",
  "read-thread",
  "message-history",
  // Phase 100 follow-up — operator/agent-driven Discord thread archive.
  // Closes the "no archive tool" capability gap raised 2026-04-26 + auto-prunes
  // the registry binding so maxThreadSessions accounting stays correct.
  "archive-discord-thread",
  // Phase 100 follow-up — operator-surfaced 2026-04-27. Backs the
  // `schedule_reminder` MCP tool that lets agents set ad-hoc one-off
  // reminders firing as standalone turns (delivered via the f984008
  // trigger-delivery callback). Daemon-side handler invokes
  // schedulerSource.addOneShotReminder. In-memory only — does not survive
  // daemon restart.
  "schedule-reminder",
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
  // Phase 100 follow-up — runtime gsd.projectDir override. Backs the
  // /gsd-set-project Discord slash command. Persists to
  // ~/.clawcode/manager/gsd-project-overrides.json (atomic temp+rename) +
  // splices a new ResolvedAgentConfig into the daemon's resolvedAgents
  // array + calls manager.restartAgent so the new SDK session boots with
  // the new gsd.projectDir as cwd. Returns {ok, agent, projectDir}.
  "set-gsd-project",
  // Phase 104 — secret cache observability + manual invalidation.
  // `secrets-status` returns the SecretsResolver counter snapshot
  // (cacheSize, hits, misses, retries, rateLimitHits, last*) so operators
  // can render cache health in /clawcode-status. `secrets-invalidate`
  // flushes one URI (when params.uri provided) or the entire cache,
  // closing the manual-rotation gap from Phase 104 Pitfall 3.
  "secrets-status",
  "secrets-invalidate",
  // Phase 106 TRACK-CLI-01 — restore mcp-tracker IPC. Plan 999.15-03
  // wired the daemon dispatch (daemon.ts case branch), the CLI client
  // (src/cli/commands/mcp-tracker.ts), and the handler
  // (src/manager/mcp-tracker-snapshot.ts) — but missed THIS enum entry,
  // so `ipcRequestSchema.safeParse` rejected the method with -32600
  // "Invalid Request" before dispatch ever ran. Direct mirror of
  // commit a9c39c7 (Phase 96-05 same regression for probe-fs +
  // list-fs-status).
  "mcp-tracker-snapshot",
  // Phase 109-D — fleet-wide observability snapshot. Returns FleetStatsData
  // (cgroup memory pressure + claude proc drift + per-MCP-type RSS aggregate).
  // Read-only; safe to poll. Linux-only signals degrade to null on hosts
  // without /proc or cgroup v2 — never throws.
  "fleet-stats",
  // Phase 109-A — per-pool 1Password broker status snapshot (rps + throttle
  // counters + last Retry-After). Decoupled from the heartbeat narrow
  // surface; consumed by `clawcode broker-status` CLI for live operator
  // visibility into 1P quota pressure across the fleet.
  "broker-status",
  // Phase 110 Stage 0b 0B-RT-13 — daemon-side IPC method that returns the
  // current TOOL_DEFINITIONS for a given shim type, JSON-Schema-converted
  // from the existing TypeScript Zod definitions in
  // src/{search,image,browser}/tools.ts. Future Wave 2-4 Go shims call
  // this at boot to fetch tool schemas, keeping Zod single-sourced (no
  // schema duplication into Go). Sequencing constraint (CONTEXT.md):
  // ships in its own commit BEFORE any Go shim builds against it.
  "list-mcp-tools",
  // Phase 115 Plan 07 sub-scope 15 — tool-cache management IPC (folds
  // Phase 999.40). Operator-facing introspection + maintenance. Wired
  // from `clawcode tool-cache {status|clear|inspect}` CLI subcommands
  // in T04. Daemon-side handlers live in src/manager/daemon.ts ~line
  // 3260 (early intercepts before routeMethod).
  "tool-cache-status",
  "tool-cache-clear",
  "tool-cache-inspect",
  // Phase 116-03 — Tier 1.5 operator workflow IPC methods (F26/F27/F28).
  // Handlers live in src/manager/daemon.ts in the closure-intercept block
  // labeled "Phase 116-03". REST proxies in src/dashboard/server.ts in the
  // "=== Phase 116-03 routes ===" block.
  "get-agent-config",
  "update-agent-config",
  "hot-reload-now",
  "search-conversations",
  "list-recent-conversations",
  "list-tasks-kanban",
  "create-task",
  "transition-task",
  // Phase 116-04 — Tier 2 deep-dive IPC methods (F11-F15).
  // Handlers live in src/manager/daemon.ts in the closure-intercept block
  // labeled "Phase 116-04". REST proxies in src/dashboard/server.ts in the
  // "=== Phase 116-04 routes ===" block.
  //
  //   list-recent-turns   -> F11 drawer transcript (last N conversation_turns)
  //   get-turn-trace      -> F12 trace waterfall (trace_spans for one turn_id)
  //   list-ipc-inboxes    -> F13 cross-agent IPC inbox + delivery snapshot
  //   get-memory-snapshot -> F14 memory tier counts + tier-1 file previews
  //                          (READ-ONLY per 116-DEFERRED — no in-UI editor)
  //   get-dream-queue     -> F15 dream-pass events + D-10 pending vetos
  //   veto-dream-run      -> F15 operator-fired veto on a pending window
  "list-recent-turns",
  "get-turn-trace",
  "list-ipc-inboxes",
  "get-memory-snapshot",
  "get-dream-queue",
  "veto-dream-run",
  // Phase 116-05 — Fleet-scale + cost (F16/F17).
  // Handlers live in src/manager/daemon.ts in the closure-intercept block
  // labeled "Phase 116-05". REST proxies in src/dashboard/server.ts in
  // the "=== Phase 116-05 routes ===" block.
  //
  //   costs-daily   -> F17 per-day cost trend rows for the cost dashboard
  //                    (extends the existing `costs` aggregate handler).
  //   budget-status -> F17 EscalationBudget gauges — token usage per
  //                    period (daily/weekly) per agent per model, alongside
  //                    the configured limit. Tokens-not-USD by schema; the
  //                    cost dashboard renders these on a separate row from
  //                    the USD spend cards. See 116-05-SUMMARY decisions.
  "costs-daily",
  "budget-status",
  // Phase 116-06 — Tier 3 polish IPC methods (F18/F20/F22/F23 + telemetry).
  // Handlers live in src/manager/daemon.ts in the closure-intercept block
  // labeled "Phase 116-06". REST proxies in src/dashboard/server.ts in the
  // "=== Phase 116-06 routes ===" block.
  //
  //   activity-by-day        -> F18 + F22 activity heatmap (turn count per
  //                             (date, agent) bucket within the window;
  //                             fleet aggregate sums client-side).
  //   list-dashboard-audit   -> F23 + T07 audit log viewer (read the JSONL
  //                             tail; filtered by action / agent / since).
  //   dashboard-telemetry-summary -> T07 cutover instrumentation badge:
  //                             counts of dashboard_v2_page_view +
  //                             dashboard_v2_error in the last 24h.
  "activity-by-day",
  "list-dashboard-audit",
  "dashboard-telemetry-summary",
  // Phase 116-postdeploy 2026-05-12 — F03 tile 24h activity sparkline.
  // Handler in src/manager/daemon.ts (`case "agent-activity":` adjacent
  // to `case "latency":`). REST proxy at /api/agents/:name/activity
  // in src/dashboard/server.ts. Replaces the Skeleton placeholder the
  // tile has rendered since Phase 116-01.
  "agent-activity",
  // Phase 116-postdeploy 2026-05-12 — Basic-mode "Restart Discord bot"
  // quick action wired to a real IPC. Handler calls discordBridge.stop()
  // then start() on the existing DiscordBridge singleton (accessed via
  // discordBridgeRef.current). REST proxy at POST /api/discord/restart.
  // Returns { ok: true } on success; throws if no bridge is configured
  // (botToken missing or routing table has no channel bindings).
  "restart-discord-bot",
  // Phase 116-postdeploy 2026-05-12 — GSD planning artefacts surfaced on
  // the Tasks Kanban (Backlog + Running columns). Scans the repo's
  // .planning/ tree at request time and returns a stable virtual-task
  // shape (PlanningTasksResponse from src/manager/planning-tasks.ts).
  // Working directory is process.cwd(); production installs running
  // from /opt/clawcode (no .planning/) get an empty response — graceful
  // no-op, not an error. REST proxy at GET /api/planning/tasks.
  "list-planning-tasks",
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

/**
 * Phase 104 — `secrets-status` IPC response shape.
 *
 * Validates the counter snapshot returned by SecretsResolver.snapshot()
 * (cacheSize + hit/miss/retry/rateLimitHits counters + optional ISO 8601
 * lastFailureAt/lastRefreshedAt timestamps + optional lastFailureReason
 * string). All count fields are non-negative integers.
 *
 * SEC-07 invariant: this response shape contains COUNTERS, timestamps, and
 * a failure-reason string (e.g., "rate-limited", "auth-error", or the
 * underlying error message — operator-controlled CLI noise). It MUST NOT
 * contain any resolved secret value. cacheSize is the count of cached
 * entries, never a list of values.
 */
export const SecretsStatusResponseSchema = z.object({
  ok: z.literal(true),
  cacheSize: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  rateLimitHits: z.number().int().nonnegative(),
  lastFailureAt: z.string().datetime().optional(),
  lastFailureReason: z.string().optional(),
  lastRefreshedAt: z.string().datetime().optional(),
});
export type SecretsStatusResponse = z.infer<typeof SecretsStatusResponseSchema>;

/**
 * Phase 104 — `secrets-invalidate` IPC request shape.
 *
 * Optional `uri` flushes one cache entry; omit (or pass empty params) to
 * flush the entire cache. The `op://` prefix guard provides defense-in-
 * depth against accidental cache poisoning — operators can only target
 * URIs they could have configured in clawcode.yaml in the first place.
 */
export const SecretsInvalidateRequestSchema = z.object({
  uri: z.string().startsWith("op://").optional(),
});
export type SecretsInvalidateRequest = z.infer<typeof SecretsInvalidateRequestSchema>;

/**
 * Phase 104 — `secrets-invalidate` IPC response shape.
 *
 * `invalidated` is the literal string `"all"` when the entire cache was
 * flushed, or the specific URI that was removed.
 */
export const SecretsInvalidateResponseSchema = z.object({
  ok: z.literal(true),
  invalidated: z.union([z.literal("all"), z.string()]),
});
export type SecretsInvalidateResponse = z.infer<typeof SecretsInvalidateResponseSchema>;

/**
 * Phase 110 Stage 0b 0B-RT-13 — `list-mcp-tools` IPC contract.
 *
 * Future Wave 2-4 Go shims call this method at boot to fetch the canonical
 * MCP tool list for their shim type, JSON-Schema-converted from the
 * single-source-of-truth TypeScript Zod definitions in
 * `src/{search,image,browser}/tools.ts`. Keeps schemas single-sourced —
 * the Go shim does NOT duplicate Zod definitions (Pitfall 4 in 110-RESEARCH.md).
 *
 * Method shape (locked in 110-CONTEXT.md):
 *   - Request:  { shimType: "search" | "image" | "browser" }
 *   - Response: { tools: ToolSchema[] }
 *     where each ToolSchema mirrors the MCP `tools/list` response item:
 *       { name: string, description: string, inputSchema: object (JSON Schema) }
 *
 * Adds ~1 ms IPC round-trip on shim boot — negligible.
 *
 * Sequencing constraint: this contract + its handler ship BEFORE any Go
 * shim builds against it (Wave 1 prerequisite for Waves 2-4).
 */
export const listMcpToolsRequestSchema = z.object({
  shimType: z.enum(["search", "image", "browser"]),
});
export type ListMcpToolsRequest = z.infer<typeof listMcpToolsRequestSchema>;

/**
 * One tool entry in the response, mirroring the MCP `tools/list` shape.
 *
 * `inputSchema` is opaque to the daemon — it's the JSON-Schema-converted
 * Zod schema. The daemon serializes; the Go shim passes it through to
 * `mcp.AddTool` verbatim. Validating the inner schema would require
 * pinning a JSON-Schema dialect here; instead we accept any object so
 * the converter (zod/v4 native `z.toJSONSchema`) can evolve without a
 * second migration here.
 */
export const mcpToolSchemaSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type McpToolSchema = z.infer<typeof mcpToolSchemaSchema>;

export const listMcpToolsResponseSchema = z.object({
  tools: z.array(mcpToolSchemaSchema),
});
export type ListMcpToolsResponse = z.infer<typeof listMcpToolsResponseSchema>;
