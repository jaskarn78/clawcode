import { join } from "node:path";
import { homedir } from "node:os";
import {
  mkdir,
  writeFile,
  unlink,
  access,
  stat,
  readFile,
} from "node:fs/promises";
import { connect, type Server } from "node:net";
import { logger } from "../shared/logger.js";
import { ManagerError } from "../shared/errors.js";
import { createIpcServer } from "../ipc/server.js";
import type { IpcHandler } from "../ipc/server.js";
import { SessionManager } from "./session-manager.js";
import type { SessionAdapter } from "./session-adapter.js";
import { SdkSessionAdapter } from "./session-adapter.js";
import { TurnDispatcher } from "./turn-dispatcher.js";
// Phase 999.6 SNAP-01..05 — pre-deploy running-fleet snapshot. Writer fires
// at top of shutdown() (before drain); reader fires at boot path (before
// autoStartAgents filter) to restore the running fleet across restarts.
import {
  writePreDeploySnapshot,
  readAndConsumePreDeploySnapshot,
} from "./snapshot-manager.js";
import { TaskStore } from "../tasks/store.js";
import { TaskManager } from "../tasks/task-manager.js";
import { SchemaRegistry } from "../tasks/schema-registry.js";
import { PayloadStore } from "../tasks/payload-store.js";
import {
  runStartupReconciliation,
  ORPHAN_THRESHOLD_MS,
} from "../tasks/reconciler.js";
import { loadConfig, resolveAllAgents, defaultOpRefResolver, resolveShimCommand } from "../config/loader.js";
import type { OpRefResolver, ShimRuntime } from "../config/loader.js";
// Phase 104 — single SecretsResolver instance threads through every
// op:// resolution site (Discord botToken, loader sync wrapper, per-agent
// opEnvResolver). See SUMMARY.md for the three call-site rewrites.
import { SecretsResolver } from "./secrets-resolver.js";
// Phase 999.14 — MCP child process lifecycle hardening (boot scan + reaper
// + shutdown cleanup). Singleton mirrors the SecretsResolver DI pattern.
import { McpProcessTracker } from "../mcp/process-tracker.js";
import { buildMcpTrackerSnapshot } from "./mcp-tracker-snapshot.js";
// Phase 109-D — fleet-wide observability (cgroup memory + claude proc drift
// + per-MCP-pattern aggregate). Pure helper; safe to invoke from the IPC
// handler.
import { buildFleetStats, type McpRuntime } from "./fleet-stats.js";
import { reapOrphans, startOrphanReaper } from "../mcp/orphan-reaper.js";
// Phase 115 Plan 07 sub-scope 15 — daemon-side MCP tool-response cache.
// Folds Phase 999.40 (now SUPERSEDED-BY-115). The store is a singleton
// owned by the daemon process; dispatchTool wraps tool calls at the IPC
// boundary so search/image/search-documents land in the cache.
import { ToolCacheStore } from "../mcp/tool-cache-store.js";
import { dispatchTool } from "../mcp/tool-dispatch.js";
import {
  buildMcpCommandRegexes,
  readBootTimeUnix,
  readClockTicksPerSec,
} from "../mcp/proc-scan.js";
// Phase 999.15 — tracker reconciliation engine. Wired into the existing
// onTickAfter callback (alongside sweepStaleBindings) AND into the
// McpProcessTracker construction via the late-bound reconcileAgent closure
// for TRACK-06 reconcile-before-kill.
import { reconcileAllAgents, reconcileAgent } from "../mcp/reconciler.js";
// Phase 109-B — orphan-claude reaper. Detects `claude` procs whose ppid is
// the daemon but which are not in tracker.getRegisteredAgents() (the
// today-fire pattern from 2026-05-03). Wired into onTickAfter AFTER the
// reconciler so a freshly-discovered SDK respawn is registered before the
// reaper sees it.
import {
  tickOrphanClaudeReaper,
  type OrphanClaudeReaperMode,
} from "../mcp/orphan-claude-reaper.js";
// Phase 999.X — subagent-thread session reaper. Catches the today-fire
// pattern (admin-clawdy 2026-05-04): auto-spawned subagent sessions
// (`*-via-*-<nanoid6>` / `*-sub-<nanoid6>`) sitting at status `running`
// for hours after their work completed. Hosted in the same onTickAfter
// alongside orphan-claude-reaper + stale-binding-sweep. Default mode
// "reap" — see config/schema.ts subagentReaper for rationale.
import {
  tickSubagentSessionReaper,
  type SubagentReaperMode,
  type RunningSessionInfo,
} from "./subagent-session-reaper.js";
// Phase 999.25 — subagent completion relay. `relayAndMarkCompleted`
// helpers used by the IPC handler (`subagent-complete` tool) and the
// quiescence sweep, both wired below. Single source of truth for the
// idempotent relay-and-stamp flow.
import {
  relayAndMarkCompletedByAgentName,
  relayAndMarkCompletedByThreadId,
} from "./relay-and-mark-completed.js";
import { tickSubagentCompletionSweep } from "./subagent-completion-sweep.js";
// Phase 108 — daemon-managed broker pooling 1password-mcp children across
// agents. The broker owns ONE @takescake/1password-mcp child per unique
// resolved OP_SERVICE_ACCOUNT_TOKEN; agents connect via per-process shim
// CLI subprocesses (loader.ts auto-injects `clawcode mcp-broker-shim
// --pool 1password`). ShimServer accepts socket connections from those
// shims and bridges them to the broker.
import { OnePasswordMcpBroker } from "../mcp/broker/broker.js";
import { ShimServer } from "../mcp/broker/shim-server.js";
import { spawn as childSpawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createHash } from "node:crypto";
import { cleanupThreadWithClassifier } from "../discord/thread-cleanup.js";
import {
  parseIdleDuration,
  sweepStaleBindings,
} from "../discord/stale-binding-sweep.js";
import {
  readThreadRegistry,
  writeThreadRegistry,
  removeBinding,
  getBindingForThread,
  getBindingsForAgent,
} from "../discord/thread-registry.js";
import { collectAllOpRefs } from "./secrets-collector.js";
import { applySecretsDiff } from "./secrets-watcher-bridge.js";
import { defaultOpReadShellOut } from "./op-env-resolver.js";
// Phase 104 Plan 04 — IPC handlers for secrets-status / secrets-invalidate.
// Pure handler module so the case branches in the IPC dispatch closure stay
// one-liners and the logic is unit-testable without booting the IPC server.
import {
  handleSecretsStatus,
  handleSecretsInvalidate,
} from "./secrets-ipc-handler.js";
import { readRegistry, reconcileRegistry, updateEntry, writeRegistry } from "./registry.js";
import { buildRoutingTable } from "../discord/router.js";
import { createRateLimiter } from "../discord/rate-limiter.js";
import { DEFAULT_RATE_LIMITER_CONFIG } from "../discord/types.js";
import type { RoutingTable, RateLimiter } from "../discord/types.js";
import { HeartbeatRunner } from "../heartbeat/runner.js";
import type { CheckStatus, HeartbeatConfig } from "../heartbeat/types.js";
import type { ContextZone, ZoneTransition } from "../heartbeat/context-zones.js";
import { TaskScheduler } from "../scheduler/scheduler.js";
import { TriggerEngine } from "../triggers/engine.js";
import { SchedulerSource } from "../triggers/scheduler-source.js";
import { MysqlSource } from "../triggers/sources/mysql-source.js";
import { WebhookSource } from "../triggers/sources/webhook-source.js";
import { InboxSource } from "../triggers/sources/inbox-source.js";
import { CalendarSource } from "../triggers/sources/calendar-source.js";
import { createWebhookHandler } from "../dashboard/webhook-handler.js";
import { DEFAULT_REPLAY_MAX_AGE_MS, DEFAULT_DEBOUNCE_MS, DEFAULT_DEDUP_LRU_SIZE, type TriggerDeliveryFn } from "../triggers/types.js";
import { loadPolicies, PolicyValidationError } from "../triggers/policy-loader.js";
import { PolicyEvaluator } from "../triggers/policy-evaluator.js";
import { PolicyWatcher } from "../triggers/policy-watcher.js";
import { scanSkillsDirectory } from "../skills/scanner.js";
import { linkAgentSkills } from "../skills/linker.js";
import type { SkillsCatalog } from "../skills/types.js";
import { writeMessage, createMessage } from "../collaboration/inbox.js";
import { SlashCommandHandler, resolveAgentCommands } from "../discord/slash-commands.js";
import { DiscordBridge } from "../discord/bridge.js";
import { ChannelType, type CategoryChannel, type GuildTextBasedChannel, type TextChannel } from "discord.js";
import { provisionAgent } from "./agent-provisioner.js";
import { ThreadManager } from "../discord/thread-manager.js";
import { THREAD_REGISTRY_PATH } from "../discord/thread-types.js";
import { WebhookManager, buildWebhookIdentities } from "../discord/webhook-manager.js";
import {
  provisionWebhooks,
  verifyAgentWebhookIdentity,
} from "../discord/webhook-provisioner.js";
import { buildAgentMessageEmbed } from "../discord/agent-message.js";
import { SemanticSearch } from "../memory/search.js";
import { MemoryScanner, type MemoryScannerDeps } from "../memory/memory-scanner.js";
import { chunkText, chunkPdf } from "../documents/chunker.js";
import { GraphSearch } from "../memory/graph-search.js";
import { invokeMemoryLookup } from "./memory-lookup-handler.js";
// Phase 115 sub-scope 7 — lazy-load memory tools (T01).
import {
  clawcodeMemorySearch,
  clawcodeMemoryRecall,
  clawcodeMemoryEdit,
  clawcodeMemoryArchive,
} from "../memory/tools/index.js";
// Phase 999.8 Plan 01 — pure handler for memory-graph IPC with configurable LIMIT.
import { handleMemoryGraphIpc } from "./memory-graph-handler.js";
import { startOfWeek } from "date-fns";
import { ConfigWatcher } from "../config/watcher.js";
import { ConfigReloader } from "./config-reloader.js";
import type { ConfigDiff } from "../config/types.js";
import Database from "better-sqlite3";
import { DeliveryQueue } from "../discord/delivery-queue.js";
import { SubagentThreadSpawner } from "../discord/subagent-thread-spawner.js";
import { AllowlistMatcher } from "../security/allowlist-matcher.js";
import { ApprovalLog } from "../security/approval-log.js";
import { parseSecurityMd } from "../security/acl-parser.js";
import type { SecurityPolicy } from "../security/types.js";
import { startDashboardServer } from "../dashboard/server.js";
import { startOpenAiEndpoint, type OpenAiEndpointHandle } from "../openai/endpoint-bootstrap.js";
import { installWorkspaceSkills } from "../skills/installer.js";
import { EscalationMonitor } from "./escalation.js";
import type { EscalationConfig } from "./escalation.js";
import { AdvisorBudget, ADVISOR_RESPONSE_MAX_LENGTH } from "../usage/advisor-budget.js";
import { EscalationBudget } from "../usage/budget.js";
import { modelSchema } from "../config/schema.js";
import type { EffortLevel } from "../config/schema.js";
import type { ResolvedAgentConfig, ResolvedMarketplaceSources } from "../shared/types.js";
// Phase 86 Plan 02 MODEL-04 — atomic YAML persistence for `agents[*].model`.
import { updateAgentModel, updateAgentSkills } from "../migration/yaml-writer.js";
import { ModelNotAllowedError } from "./model-errors.js";
// Phase 88 Plan 02 MKT-01..07 — marketplace catalog + single-skill installer.
import {
  loadMarketplaceCatalog,
  type MarketplaceEntry,
} from "../marketplace/catalog.js";
import {
  installSingleSkill,
  type SkillInstallOutcome,
} from "../marketplace/install-single-skill.js";
import { DEFAULT_SKILLS_LEDGER_PATH } from "../migration/skills-ledger.js";
// Phase 90 Plan 05 HUB-02 / HUB-04 — ClawHub plugin list + install + manifest fetch.
import {
  fetchClawhubPlugins,
  downloadClawhubPluginManifest,
  type ClawhubPluginsResponse,
  type ClawhubPluginListItem,
} from "../marketplace/clawhub-client.js";
import {
  installClawhubPlugin,
  mapFetchErrorToOutcome,
  type PluginInstallOutcome,
} from "../marketplace/install-plugin.js";
// Phase 90 Plan 06 HUB-05 / HUB-07 — GitHub OAuth device-code flow +
// 1Password op:// rewrite probe for install-time config collection.
// Imported via module namespace so tests can vi.spyOn() the exports.
import * as githubOauthMod from "../marketplace/github-oauth.js";
import * as opRewriteMod from "../marketplace/op-rewrite.js";
import type { OpRewriteProposal } from "../marketplace/op-rewrite.js";
// Phase 90 Plan 04 HUB-08 — ClawHub cache primitive. Plan 05 instantiates
// a daemon-scoped cache<ClawhubPluginsResponse> for plugin list calls.
import { createClawhubCache } from "../marketplace/clawhub-cache.js";
import type { ClawhubCache } from "../marketplace/clawhub-cache.js";
import { resolveMarketplaceSources } from "../config/loader.js";
import type { Logger } from "pino";
import { runConsolidation } from "../memory/consolidation.js";
import { summarizeWithHaiku } from "./summarize-with-haiku.js";
import { callHaikuDirect } from "./haiku-direct.js";
import type { ScheduleEntry } from "../scheduler/types.js";
import type {
  CacheHitRateStatus,
  CacheTelemetryReport,
  LatencyReport,
  PercentileRow,
  SloMetric,
  SloStatus,
  ToolPercentileRow,
} from "../performance/types.js";
import { sinceToIso } from "../performance/percentiles.js";
import {
  DEFAULT_SLOS,
  evaluateCacheHitRateStatus,
  evaluateSloStatus,
  getPerToolSlo,
  mergeSloOverrides,
  type SloEntry,
} from "../performance/slos.js";
import type { TraceStore } from "../performance/trace-store.js";
import type { TraceCollector } from "../performance/trace-collector.js";
import { scheduleDailySummaryCron, type DailySummaryCronHandle } from "./daily-summary-cron.js";
import { isDiscordRateLimitError } from "../discord/streaming.js";
import { nanoid } from "nanoid";
import { createPool, type Pool } from "mysql2/promise";
// Phase 70 — browser automation MCP.
import { BrowserManager } from "../browser/manager.js";
import { handleBrowserToolCall } from "../browser/daemon-handler.js";
import type { IpcBrowserToolCallParams } from "../ipc/types.js";
// Phase 71 — web search MCP.
import { handleSearchToolCall } from "../search/daemon-handler.js";
import { createBraveClient } from "../search/providers/brave.js";
import { createExaClient } from "../search/providers/exa.js";
import { fetchUrl } from "../search/fetcher.js";
import type { IpcSearchToolCallParams } from "../ipc/types.js";
// Phase 72 — image generation MCP.
import { handleImageToolCall } from "../image/daemon-handler.js";
import { createOpenAiImageClient } from "../image/providers/openai.js";
import { createMiniMaxImageClient } from "../image/providers/minimax.js";
import { createFalImageClient } from "../image/providers/fal.js";
import type { IpcImageToolCallParams } from "../ipc/types.js";
import type { ImageBackend, ImageProvider } from "../image/types.js";

/**
 * Augment a LatencyReport's segments with `slo_status`, `slo_threshold_ms`,
 * and `slo_metric` per row, using `DEFAULT_SLOS` merged with per-agent
 * `perf.slos?` overrides.
 *
 * The threshold + metric are emitted ALONGSIDE the status so the dashboard
 * can render the "SLO target" subtitle directly from the response — single
 * source of truth stays server-side (no client mirror of DEFAULT_SLOS). An
 * agent overriding `end_to_end` to 4000ms will see both the cell tint AND
 * the subtitle reflect that value, never the default.
 *
 * A segment with no configured SLO passes through with `slo_threshold_ms:
 * null` and `slo_metric: null`; the dashboard falls back to the no-data
 * cell class and omits the subtitle. `slo_status` is intentionally left
 * unset on that branch — there's nothing to evaluate against.
 *
 * Pure; safe to call with `undefined` override array. Exported for unit
 * testing in `src/manager/__tests__/daemon-latency-slo.test.ts`.
 *
 * @param segments - Percentile rows from TraceStore.getPercentiles.
 * @param agentSlos - Per-agent `perf.slos?` overrides (may be undefined).
 * @returns Frozen array of rows with SLO fields populated.
 */
export function augmentWithSloStatus(
  segments: readonly PercentileRow[],
  agentSlos: readonly SloEntry[] | undefined,
): readonly PercentileRow[] {
  const effectiveSlos =
    agentSlos && agentSlos.length > 0
      ? mergeSloOverrides(DEFAULT_SLOS, agentSlos)
      : DEFAULT_SLOS;

  // First match wins per segment — matches the semantics of the dashboard's
  // "tint the cell for the server-reported metric" rendering path. If a
  // future revision adds multiple metrics per segment (e.g. p50 AND p95
  // first_token), this helper picks the first; the dashboard can be taught
  // to render both at that point.
  const slosBySeg = new Map<string, SloEntry>();
  for (const s of effectiveSlos) {
    if (!slosBySeg.has(s.segment)) slosBySeg.set(s.segment, s);
  }

  return Object.freeze(
    segments.map((segRow) => {
      const slo = slosBySeg.get(segRow.segment);
      if (!slo) {
        // No SLO configured for this segment — emit nulls so the response
        // shape is consistent across rows. Dashboard falls back to no-data
        // cell styling and omits the subtitle.
        return Object.freeze({
          ...segRow,
          slo_threshold_ms: null,
          slo_metric: null,
        });
      }
      return Object.freeze({
        ...segRow,
        slo_status: evaluateSloStatus(segRow, slo.thresholdMs, slo.metric),
        slo_threshold_ms: slo.thresholdMs,
        slo_metric: slo.metric,
      });
    }),
  );
}

/**
 * Phase 55 Plan 03 — augmented per-tool percentile row with server-evaluated
 * SLO fields attached. Mirrors the AugmentedToolRow shape consumed by the
 * CLI (src/cli/commands/tools.ts) and dashboard (src/dashboard/static/app.js)
 * so both renderers read the server truth directly without mirroring any
 * threshold constants client-side.
 */
export type AugmentedToolRow = ToolPercentileRow & {
  readonly slo_status: SloStatus;
  readonly slo_threshold_ms: number;
  readonly slo_metric: SloMetric;
};

/**
 * Phase 55 Plan 03 — augment per-tool percentile rows with SLO status /
 * threshold / metric using `getPerToolSlo` (per-tool override wins, global
 * tool_call SLO as fallback — always yields non-null threshold + metric).
 *
 * The SQL query (`TraceStore.getToolPercentiles`) already sorts rows by
 * p95 DESC (nulls last); this helper preserves that ordering so consumers
 * render slowest-first without a client-side resort.
 *
 * Pure; safe to call with `undefined` perfTools. Exported for unit testing
 * in `src/manager/__tests__/daemon-tools.test.ts`.
 *
 * @param rows      - Frozen per-tool percentile rows from TraceStore.
 * @param perfTools - Optional `perf.tools` config block (only `.slos` read).
 * @returns Frozen array of augmented rows with SLO fields populated.
 */
export function augmentToolsWithSlo(
  rows: readonly ToolPercentileRow[],
  perfTools:
    | {
        readonly slos?: Readonly<
          Record<
            string,
            { readonly thresholdMs: number; readonly metric?: SloMetric }
          >
        >;
      }
    | undefined,
): readonly AugmentedToolRow[] {
  return Object.freeze(
    rows.map((row) => {
      const slo = getPerToolSlo(row.tool_name, perfTools);
      return Object.freeze({
        ...row,
        slo_status: evaluateSloStatus(row, slo.thresholdMs, slo.metric),
        slo_threshold_ms: slo.thresholdMs,
        slo_metric: slo.metric,
      });
    }),
  );
}

/**
 * Phase 54 Plan 04 — minimum first_token sample count before the headline
 * card transitions out of "warming up" (no_data / gray). Protects operators
 * from seeing red on a newly-started agent where a single outlier skews p50.
 */
export const COLD_START_MIN_TURNS = 5;

/**
 * Phase 54 Plan 04 — shape emitted as the top-level `first_token_headline`
 * object on the `latency` IPC response.
 *
 * Mirrors the three SLO fields on PercentileRow so the dashboard + CLI render
 * the headline card verbatim from the server response (no client-side SLO
 * mirror — Phase 51 Plan 03 invariant preserved).
 */
export type FirstTokenHeadline = {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number;
  readonly slo_status: SloStatus;
  readonly slo_threshold_ms: number | null;
  readonly slo_metric: SloMetric | null;
};

/**
 * Phase 54 Plan 04 — evaluate the First Token headline object that appears
 * at the top of each agent tile on the dashboard and as a block above the
 * segments table in the CLI.
 *
 * Cold-start guard: when `row.count < COLD_START_MIN_TURNS`, slo_status is
 * forced to "no_data" regardless of the measured percentile. Operators see
 * a neutral gray "warming up" card until the 5th sample arrives.
 *
 * Per-agent perf.slos overrides for first_token flow through via
 * `mergeSloOverrides`, so an agent that sets a custom threshold sees the
 * card coloring reflect that (single source of truth stays server-side).
 *
 * @param row        - PercentileRow for first_token (typically from
 *                     TraceStore.getFirstTokenPercentiles).
 * @param agentSlos  - Per-agent overrides from `perf.slos?` (may be undefined).
 * @returns Frozen FirstTokenHeadline.
 */
export function evaluateFirstTokenHeadline(
  row: PercentileRow,
  agentSlos: readonly SloEntry[] | undefined,
): FirstTokenHeadline {
  const effectiveSlos =
    agentSlos && agentSlos.length > 0
      ? mergeSloOverrides(DEFAULT_SLOS, agentSlos)
      : DEFAULT_SLOS;
  const slo = effectiveSlos.find((s) => s.segment === "first_token");

  // Cold-start guard — preempts healthy/breach coloring.
  if (row.count < COLD_START_MIN_TURNS) {
    return Object.freeze({
      p50: row.p50,
      p95: row.p95,
      p99: row.p99,
      count: row.count,
      slo_status: "no_data" as SloStatus,
      slo_threshold_ms: slo?.thresholdMs ?? null,
      slo_metric: slo?.metric ?? null,
    });
  }

  if (!slo) {
    return Object.freeze({
      p50: row.p50,
      p95: row.p95,
      p99: row.p99,
      count: row.count,
      slo_status: "no_data" as SloStatus,
      slo_threshold_ms: null,
      slo_metric: null,
    });
  }

  return Object.freeze({
    p50: row.p50,
    p95: row.p95,
    p99: row.p99,
    count: row.count,
    slo_status: evaluateSloStatus(row, slo.thresholdMs, slo.metric),
    slo_threshold_ms: slo.thresholdMs,
    slo_metric: slo.metric,
  });
}

// ---------------------------------------------------------------------------
// Phase 86 Plan 02 MODEL-04 — set-model IPC handler (pure, testable).
//
// Extracted from the daemon's `case "set-model":` so `src/manager/__tests__/
// daemon-set-model.test.ts` can drive the full behaviour (live SDK swap BEFORE
// YAML persist, typed ModelNotAllowedError → ManagerError w/ code -32602 +
// data.allowed, atomic YAML round-trip, non-rollback on persistence failure)
// without spinning up the full daemon surface.
//
// Contract:
//   - setModelForAgent fires FIRST (Plan 01 SDK swap). If it throws:
//       * ModelNotAllowedError → ManagerError w/ code=-32602 + data.allowed
//       * any other error → rethrown as-is
//   - On successful swap, updateAgentModel is called. Persistence failure
//     does NOT undo the live swap (rationale: SDK swap is irreversible —
//     see Plan 02 non-rollback decision). `persisted: false` + `persist_error`
//     are surfaced in the response.
//   - In-memory configs[] is updated AFTER the persist attempt so a fresh
//     restart reads the same value the operator just set (ref matches disk).
// ---------------------------------------------------------------------------

/**
 * Minimal manager surface the set-model IPC handler needs — defined as a
 * structural type so tests can inject a stub without constructing a full
 * SessionManager. Matches the real SessionManager method signatures byte for
 * byte (setModelForAgent throws ModelNotAllowedError on allowlist violation).
 */
export type SetModelIpcManager = {
  setModelForAgent: (
    name: string,
    alias: "haiku" | "sonnet" | "opus",
  ) => void;
  setAllAgentConfigs: (configs: readonly ResolvedAgentConfig[]) => void;
};

/**
 * Dependencies for the pure set-model handler. `configs` is mutable by design
 * — the handler splices the updated frozen entry in place to mirror the
 * pre-existing daemon invariant that `configs[idx].model` reflects the most
 * recent runtime value (read by subsequent IPC methods + /clawcode-status
 * fallback when the handle isn't yet swapped).
 */
export type SetModelIpcDeps = {
  readonly manager: SetModelIpcManager;
  readonly configs: ResolvedAgentConfig[];
  readonly configPath: string;
  readonly params: Record<string, unknown>;
};

/**
 * Response payload for the set-model IPC method.
 * `persisted: true` — YAML write succeeded (or was a no-op because the bytes
 * already matched); `persisted: false` — live swap succeeded but the YAML
 * write threw (operator must reconcile by hand or re-invoke).
 */
export type SetModelIpcResult = Readonly<{
  agent: string;
  old_model: "haiku" | "sonnet" | "opus";
  new_model: "haiku" | "sonnet" | "opus";
  persisted: boolean;
  persist_error: string | null;
  note: string;
}>;

export async function handleSetModelIpc(
  deps: SetModelIpcDeps,
): Promise<SetModelIpcResult> {
  const { manager, configs, configPath, params } = deps;

  const agentName = validateStringParam(params, "agent");
  const modelParam = validateStringParam(params, "model");

  // --- Defense-in-depth: validate alias before any side effect ------
  // SessionManager.setModelForAgent validates too, but failing fast here
  // produces a clean ManagerError message instead of a runtime type
  // error from inside the SDK wiring.
  const parsed = modelSchema.safeParse(modelParam);
  if (!parsed.success) {
    throw new ManagerError(
      `Invalid model '${modelParam}'. Must be one of: haiku, sonnet, opus`,
    );
  }
  const newModel = parsed.data;

  // --- Agent lookup --------------------------------------------------
  const idx = configs.findIndex((c) => c.name === agentName);
  if (idx === -1) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }
  const oldModel = configs[idx]!.model;

  // --- Live SDK swap FIRST (Plan 01) --------------------------------
  // Throws ModelNotAllowedError when alias is not in the resolved
  // allowedModels. Mapped to a typed IPC error so Plan 03's Discord
  // slash-command renderer reads `data.allowed` ephemerally.
  try {
    manager.setModelForAgent(agentName, newModel);
  } catch (err) {
    if (err instanceof ModelNotAllowedError) {
      throw new ManagerError(err.message, {
        code: -32602, // JSON-RPC "Invalid params" per Phase 86 Plan 02 contract
        data: {
          kind: "model-not-allowed",
          agent: err.agent,
          attempted: err.attempted,
          allowed: err.allowed,
        },
      });
    }
    throw err;
  }

  // --- Atomic YAML persist (Plan 02 MODEL-04) -----------------------
  // Runs AFTER the live swap so the Discord UX is instant; persistence
  // is a durable side-effect, not a gate. Failure here does NOT roll
  // back the swap (SDK swap is irreversible). Operator sees the error
  // in the response + can reconcile by hand.
  let persisted = false;
  let persistError: string | null = null;
  try {
    const result = await updateAgentModel({
      existingConfigPath: configPath,
      agentName,
      newModel,
    });
    if (result.outcome === "updated" || result.outcome === "no-op") {
      persisted = true;
    } else {
      persistError = result.reason;
    }
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
    // Do NOT re-throw: the live swap already succeeded and is visible to
    // the next turn via getModelForAgent. Operator receives a
    // persisted:false response and can re-invoke /clawcode-model to
    // retry YAML write.
  }

  // --- Mirror in-memory config (matches pre-Plan-02 invariant) ------
  // Updated AFTER the persist attempt so a fresh restart reads the
  // same alias the operator just set. The frozen-copy pattern matches
  // CLAUDE.md immutability rules (never mutate ResolvedAgentConfig in
  // place; replace the ref).
  const existingConfig = configs[idx]!;
  const updatedConfig = Object.freeze({ ...existingConfig, model: newModel });
  configs[idx] = updatedConfig;
  manager.setAllAgentConfigs(configs);

  return Object.freeze({
    agent: agentName,
    old_model: oldModel,
    new_model: newModel,
    persisted,
    persist_error: persistError,
    note: persisted
      ? "Live swap + clawcode.yaml updated"
      : `Live swap OK; persistence failed: ${persistError ?? "unknown"}`,
  });
}

// ---------------------------------------------------------------------------
// Phase 87 Plan 02 CMD-02 — set-permission-mode IPC handler (pure, testable).
//
// Thin wrapper around SessionManager.setPermissionModeForAgent. Unlike
// set-model, permission mode is intentionally ephemeral — NO YAML
// persistence. Runtime swap only; state resets on agent restart. Mirrors
// the set-effort shape (validate params → dispatch → ok-envelope).
// ---------------------------------------------------------------------------

/**
 * Minimal manager surface the set-permission-mode IPC handler needs.
 * Structural type so tests can inject a stub without a full SessionManager.
 */
export type SetPermissionModeIpcManager = {
  setPermissionModeForAgent: (name: string, mode: string) => void;
};

export type SetPermissionModeIpcDeps = {
  readonly manager: SetPermissionModeIpcManager;
  readonly params: Record<string, unknown>;
};

export type SetPermissionModeIpcResult = Readonly<{
  ok: true;
  agent: string;
  permission_mode: string;
}>;

/**
 * Dispatch `set-permission-mode` via SessionManager.setPermissionModeForAgent.
 *
 * Rethrows invalid-mode / unknown-agent errors from the SessionManager as
 * ManagerError so the IPC envelope carries a clean JSON-RPC message instead
 * of a bare Error / SessionError instance the transport cannot serialize
 * with its type information.
 */
export async function handleSetPermissionModeIpc(
  deps: SetPermissionModeIpcDeps,
): Promise<SetPermissionModeIpcResult> {
  const { manager, params } = deps;
  const name = validateStringParam(params, "name");
  const mode = validateStringParam(params, "mode");
  try {
    manager.setPermissionModeForAgent(name, mode);
  } catch (err) {
    // Normalize into ManagerError so the IPC JSON-RPC envelope carries the
    // message consistently (SessionError / Error subclasses are stripped to
    // a plain string at the transport boundary).
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManagerError(msg);
  }
  return { ok: true, agent: name, permission_mode: mode };
}

// ---------------------------------------------------------------------------
// Phase 110 Stage 0b 0B-RT-13 — list-mcp-tools IPC handler (pure, testable).
//
// Wave 1 daemon-side prerequisite for Waves 2-4. Future Go shims call this
// method at boot to fetch the canonical MCP tool list for their shim type,
// JSON-Schema-converted from the single-source-of-truth Zod definitions in
// `src/{search,image,browser}/tools.ts`. Schemas stay single-sourced — the
// Go shim does NOT duplicate Zod (Pitfall 4 in 110-RESEARCH.md — schema
// drift between TS and Go).
//
// JSON Schema conversion uses zod/v4's NATIVE `z.toJSONSchema()` — no new
// npm dep. (CONTEXT.md hedged "verify zod-to-json-schema in deps before
// adding"; native availability is the answer to that verification, and
// CLAUDE.md's "no new deps" rule prefers native.)
//
// Sequencing constraint (locked in 110-CONTEXT.md): this handler ships in
// its own commit BEFORE any Go shim builds against it.
//
// Pure-DI shape mirrors handleSetModelIpc / handleRunDreamPassIpc. Tests
// inject TOOL_DEFINITIONS arrays directly so the unit suite doesn't depend
// on the search/image/browser modules' transitive imports (providers,
// readability, playwright). Production wiring at the daemon edge passes
// the real TOOL_DEFINITIONS imports.
// ---------------------------------------------------------------------------

import {
  listMcpToolsRequestSchema,
  type ListMcpToolsRequest,
  type ListMcpToolsResponse,
  type McpToolSchema,
} from "../ipc/protocol.js";
import { z as zV4 } from "zod/v4";
// Phase 110 Stage 0b 0B-RT-13 — production wiring imports for the
// list-mcp-tools handler. Aliased so the unit-test deps surface (which
// passes synthetic fixtures) and the production wiring (which imports
// the real frozen TOOL_DEFINITIONS arrays) stay distinct in greps.
import { TOOL_DEFINITIONS as SEARCH_TOOL_DEFINITIONS } from "../search/tools.js";
import { TOOL_DEFINITIONS as IMAGE_TOOL_DEFINITIONS } from "../image/tools.js";
import { TOOL_DEFINITIONS as BROWSER_TOOL_DEFINITIONS } from "../browser/tools.js";

/**
 * Shape of one tool definition the handler converts. Matches the
 * `ToolDefinition` interface exported by every shim's tools.ts (search,
 * image, browser) — narrow structural type so tests can pass synthetic
 * arrays without importing the full provider stack.
 */
export interface ListMcpToolsHandlerToolDef {
  readonly name: string;
  readonly description: string;
  readonly schemaBuilder: (z_: typeof zV4) => Record<string, unknown>;
}

/**
 * DI surface for the list-mcp-tools IPC handler. Production wiring at the
 * daemon edge passes the real imported TOOL_DEFINITIONS arrays; unit tests
 * pass synthetic fixtures.
 */
export interface ListMcpToolsIpcDeps {
  readonly searchTools: ReadonlyArray<ListMcpToolsHandlerToolDef>;
  readonly imageTools: ReadonlyArray<ListMcpToolsHandlerToolDef>;
  readonly browserTools: ReadonlyArray<ListMcpToolsHandlerToolDef>;
  /**
   * Optional override for the JSON Schema converter. Defaults to zod/v4's
   * native `z.toJSONSchema`. Tests can substitute a deterministic stub if
   * native output drifts across zod minor versions.
   */
  readonly toJsonSchema?: (shape: unknown) => Record<string, unknown>;
}

/**
 * Build the JSON-Schema-converted tool list for the requested shim type.
 *
 * Returns a NEW array (CLAUDE.md immutability — never mutates the input
 * TOOL_DEFINITIONS arrays which are `Object.freeze`d ReadonlyArrays anyway).
 *
 * Throws ManagerError(-32602) on invalid params — the listMcpToolsRequestSchema
 * Zod parser handles enum + missing-field validation in a single pass.
 */
export function handleListMcpToolsIpc(
  deps: ListMcpToolsIpcDeps,
  rawParams: unknown,
): ListMcpToolsResponse {
  const parsed = listMcpToolsRequestSchema.safeParse(rawParams);
  if (!parsed.success) {
    // -32602 invalid params per JSON-RPC 2.0 spec (mirrors Phase 86 Plan 02
    // ModelNotAllowedError mapping at line 575).
    throw new ManagerError(
      `list-mcp-tools: invalid params: ${parsed.error.message}`,
      { code: -32602 },
    );
  }
  const req: ListMcpToolsRequest = parsed.data;

  const defs =
    req.shimType === "search"
      ? deps.searchTools
      : req.shimType === "image"
        ? deps.imageTools
        : deps.browserTools;

  // Native zod/v4 converter; tests can override.
  const convert =
    deps.toJsonSchema ??
    ((shape: unknown): Record<string, unknown> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      zV4.toJSONSchema(shape as any) as Record<string, unknown>);

  const tools: McpToolSchema[] = defs.map((def) => {
    // schemaBuilder returns a raw shape (Record); wrap with z.object() so
    // toJSONSchema sees the full object schema (with required[] fields).
    const rawShape = def.schemaBuilder(zV4) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const objectSchema = zV4.object(rawShape as any);
    return {
      name: def.name,
      description: def.description,
      inputSchema: convert(objectSchema),
    };
  });

  return { tools };
}

// ---------------------------------------------------------------------------
// Phase 95 Plan 03 DREAM-07 — run-dream-pass IPC handler (pure, testable).
//
// Operator-driven manual dream-pass trigger backing both `clawcode dream
// <agent>` (CLI) and `/clawcode-dream` (Discord slash, admin-only). Reuses
// Plan 95-01's runDreamPass + Plan 95-02's applyDreamResult primitives
// verbatim — neither path duplicates dream-pass logic.
//
// Pure-DI shape mirrors handleSetModelIpc + Phase 94-01 mcp-probe handler.
// Tests stub all four primitives (runDreamPass, applyDreamResult,
// isAgentIdle, getResolvedDreamConfig) so the handler's own decision tree
// is exercised without spinning up the SessionManager / TurnDispatcher /
// MemoryStore stack.
//
// Decision tree:
//   1. agent not in registry → throw ManagerError(-32602)
//   2. dream config disabled AND !force → skipped(disabled), no run
//   3. !idleBypass AND !isAgentIdle → skipped(agent-active), no run
//   4. else → runDreamPass(agent, model) → applyDreamResult(agent, outcome)
//      → return {outcome, applied, agent, startedAt}
//
// Token-cost gate: skipped paths NEVER call runDreamPass — the LLM dispatch
// is the only expensive step.
// ---------------------------------------------------------------------------

/**
 * Phase 95 Plan 03 — IPC request shape for run-dream-pass.
 */
export interface RunDreamPassRequest {
  readonly agent: string;
  readonly modelOverride?: "haiku" | "sonnet" | "opus";
  readonly idleBypass?: boolean;
  readonly force?: boolean;
}

/**
 * Phase 95 Plan 03 — IPC response shape for run-dream-pass.
 */
export interface RunDreamPassResponse {
  readonly outcome: import("./dream-pass.js").DreamPassOutcome;
  readonly applied: import("./dream-auto-apply.js").DreamApplyOutcome;
  readonly agent: string;
  readonly startedAt: string;
}

/**
 * Phase 95 Plan 03 — DI surface. Production wiring at the daemon edge maps
 * each function to the real primitive; tests inject vi.fn() stubs.
 */
export interface RunDreamPassIpcDeps {
  readonly runDreamPass: (
    agent: string,
    model: string,
  ) => Promise<import("./dream-pass.js").DreamPassOutcome>;
  readonly applyDreamResult: (
    agent: string,
    outcome: import("./dream-pass.js").DreamPassOutcome,
  ) => Promise<import("./dream-auto-apply.js").DreamApplyOutcome>;
  readonly isAgentIdle: (
    agent: string,
  ) => { readonly idle: boolean; readonly reason: string };
  readonly getResolvedDreamConfig: (
    agent: string,
  ) =>
    | { readonly enabled: boolean; readonly idleMinutes: number; readonly model: string }
    | null;
  readonly knownAgents: () => readonly string[];
  readonly now: () => Date;
  readonly log: {
    info: (m: string) => void;
    warn: (m: string) => void;
    error: (m: string) => void;
  };
}

/**
 * Pure exported handler — orchestrates the runDreamPass + applyDreamResult
 * chain with idle-gate + force-override + model-override semantics.
 */
export async function handleRunDreamPassIpc(
  req: RunDreamPassRequest,
  deps: RunDreamPassIpcDeps,
): Promise<RunDreamPassResponse> {
  if (!deps.knownAgents().includes(req.agent)) {
    throw new ManagerError(`agent not found: ${req.agent}`, {
      code: -32602,
    });
  }
  const startedAt = deps.now().toISOString();
  const baseConfig = deps.getResolvedDreamConfig(req.agent);

  // Disabled-config short-circuit (force overrides operator-side).
  const enabled = baseConfig?.enabled ?? false;
  if (!enabled && !req.force) {
    deps.log.info(
      `[run-dream-pass] ${req.agent}: skipped — dream.enabled=false (use --force to override)`,
    );
    return {
      outcome: { kind: "skipped", reason: "disabled" },
      applied: { kind: "skipped", reason: "no-completed-result" },
      agent: req.agent,
      startedAt,
    };
  }

  // Idle-gate short-circuit (idleBypass overrides operator-side).
  if (!req.idleBypass) {
    const idle = deps.isAgentIdle(req.agent);
    if (!idle.idle) {
      deps.log.info(
        `[run-dream-pass] ${req.agent}: skipped — agent active (${idle.reason}); use --idle-bypass to override`,
      );
      return {
        outcome: { kind: "skipped", reason: "agent-active" },
        applied: { kind: "skipped", reason: "no-completed-result" },
        agent: req.agent,
        startedAt,
      };
    }
  }

  // Resolve model: explicit override > config default > "haiku" fallback.
  const model = req.modelOverride ?? baseConfig?.model ?? "haiku";

  // deps.runDreamPass + deps.applyDreamResult — Plan 95-01 + 95-02 primitives.
  const outcome = await deps.runDreamPass(req.agent, model);
  const applied = await deps.applyDreamResult(req.agent, outcome);
  deps.log.info(
    `[run-dream-pass] ${req.agent}: outcome=${outcome.kind} applied=${applied.kind}`,
  );
  return { outcome, applied, agent: req.agent, startedAt };
}

// ---------------------------------------------------------------------------
// Phase 92 GAP CLOSURE — yaml-writer outcome→YamlWriteOutcome adapter.
// Mirrors the helper in src/cli/commands/cutover-apply-additive.ts so the
// daemon's IPC handlers can reuse the same Phase 86 atomic-writer call shape.
function mapYamlOutcome(
  outcome: string,
  reason: string | undefined,
): { kind: "updated" | "no-op" | "not-found" | "file-not-found" | "refused"; reason?: string } {
  if (outcome === "updated") return { kind: "updated" };
  if (outcome === "no-op") return { kind: "no-op" };
  if (outcome === "not-found")
    return { kind: "not-found", reason: reason ?? "agent or file not found" };
  if (outcome === "file-not-found")
    return { kind: "file-not-found", reason: reason ?? "yaml not found" };
  if (outcome === "refused")
    return { kind: "refused", reason: reason ?? "schema/secret-scan refusal" };
  return { kind: "refused", reason: `unknown outcome: ${outcome}` };
}

// ---------------------------------------------------------------------------
// Phase 110 follow-up — daemon-side search-key resolution helper.
//
// Reads `defaults.search.brave.apiKey` and `defaults.search.exa.apiKey` from
// the parsed config, resolves op:// references via the boot-warm
// SecretsResolver cache, and returns a synthetic env that injects the
// resolved value at the matching apiKeyEnv key — overlaying process.env
// at exactly those two slots while preserving everything else.
//
// Returns process.env unchanged when neither yaml field is set, so the
// existing /etc/clawcode/env path keeps working as a fallback.
//
// Pure: no I/O (cache reads only), no logging — testable in isolation.
//
// Exported solely for unit tests at src/manager/__tests__/build-search-env.test.ts.
// The production call site is the daemon's createBraveClient/createExaClient
// construction in 9d below.
export function buildSearchEnv(
  searchCfg: { brave: { apiKeyEnv: string; apiKey?: string }; exa: { apiKeyEnv: string; apiKey?: string } },
  resolver: { getCached(uri: string): string | undefined },
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const inject = (rawValue: string | undefined, envKey: string): void => {
    if (!rawValue) return;
    let resolved: string | undefined;
    if (rawValue.startsWith("op://")) {
      // SecretsResolver.preResolveAll already warmed the cache at boot.
      // getCached() returns the resolved string or undefined on cache miss
      // (which here means pre-resolve failed; legacy env-var fallback
      // takes over because we leave env[envKey] untouched).
      resolved = resolver.getCached(rawValue);
    } else {
      resolved = rawValue;
    }
    if (resolved && resolved.length > 0) {
      env[envKey] = resolved;
    }
  };
  inject(searchCfg.brave.apiKey, searchCfg.brave.apiKeyEnv);
  inject(searchCfg.exa.apiKey, searchCfg.exa.apiKeyEnv);
  return env;
}

// Phase 92 Plan 04 CUT-06 / CUT-07 — cutover-button-action IPC handler.
//
// MIRROR Phase 86 Plan 02 handleSetModelIpc blueprint: pure exported helper
// with DI surface, called from the daemon's closure-based intercept BEFORE
// routeMethod (per the marketplace handler pattern). Tests inject vi.fn()
// stubs for gapById + the applierDeps surface.
//
// Routes:
//   IPC params {customId} → parseCutoverButtonCustomId → gapById → dispatch
//                         → DestructiveButtonOutcome
//
// The IPC wrapper does NOT touch Discord — that's the slash-commands.ts
// inline handler's job. This handler is daemon-side because Plan 92-06's
// CLI-driven verify pipeline needs to invoke the same destructive-fix path
// without going through Discord.
// ---------------------------------------------------------------------------

import {
  handleCutoverButtonInteraction,
  type ButtonHandlerDeps,
} from "../cutover/button-handler.js";
import type { DestructiveButtonOutcome } from "../cutover/types.js";
// Phase 92 GAP CLOSURE — operator-facing CLI ↔ daemon IPC handlers.
import {
  handleCutoverVerifyIpc,
  handleCutoverRollbackIpc,
} from "./cutover-ipc-handlers.js";

/**
 * DI surface for handleCutoverButtonActionIpc. Mirrors ButtonHandlerDeps
 * verbatim because the IPC wrapper is a thin pass-through; it parses the
 * customId from IPC params and dispatches to the pure handler.
 */
export type CutoverButtonActionIpcDeps = ButtonHandlerDeps;

/**
 * Daemon-side IPC handler for `cutover-button-action`. Validates the
 * `customId` param, dispatches to the pure button-handler, and returns
 * the typed DestructiveButtonOutcome.
 *
 * Throws ManagerError when params.customId is missing or non-string so the
 * IPC envelope carries a clean JSON-RPC error message.
 */
export async function handleCutoverButtonActionIpc(
  params: { customId?: unknown },
  deps: CutoverButtonActionIpcDeps,
): Promise<DestructiveButtonOutcome> {
  const customId = params.customId;
  if (typeof customId !== "string" || customId.length === 0) {
    throw new ManagerError(
      "cutover-button-action: missing or invalid 'customId' param",
    );
  }
  // user.id is not used by the pure handler today (no per-user gating in
  // Plan 92-04), but the field is required by ButtonInteractionLike for
  // future extension. Pass a daemon-side sentinel.
  return handleCutoverButtonInteraction(
    { customId, user: { id: "daemon-ipc" } },
    deps,
  );
}

// ---------------------------------------------------------------------------
// Phase 88 Plan 02 MKT-01..07 — marketplace IPC handlers (pure, testable).
//
// MIRROR Phase 86 Plan 02 handleSetModelIpc blueprint:
//   - Exported pure helpers with DI surface
//   - ManagerError for typed domain errors
//   - case delegation in <10 lines at the bottom switch
//
// Post-install rewire:
//   After installSingleSkill succeeds with outcome in
//   {installed, installed-persist-failed, already-installed}, the handler
//   rescans skillsTargetDir (scanSkillsDirectory) and calls linkAgentSkills
//   against the target agent. This closes MKT-04's "hot-reload" requirement
//   — the new skill becomes linker-visible without a daemon restart.
// ---------------------------------------------------------------------------

/**
 * Shared dependency bundle for the three marketplace IPC handlers. `configs`
 * is mutable by design — the install/remove handlers splice updated frozen
 * entries in place so subsequent IPC methods (e.g. the `skills` observability
 * call) see the new `skills:` list without a daemon restart.
 *
 * The DI hooks (`loadCatalog`, `installSkill`, `updateSkills`, `scanCatalog`,
 * `linkSkills`) default to the real production implementations. Tests inject
 * stubs without needing `vi.mock`.
 */
export type MarketplaceIpcDeps = Readonly<{
  configs: ResolvedAgentConfig[];
  configPath: string;
  // Phase 90 Plan 04 HUB-01 — union of legacy {path,label?} and clawhub
  // {kind:"clawhub",baseUrl,...} shapes. Consumers (loadMarketplaceCatalog
  // + Plan 90-04 Task 2) discriminate on .kind.
  marketplaceSources: ResolvedMarketplaceSources;
  localSkillsPath: string;
  skillsTargetDir: string;
  ledgerPath: string;
  log: Logger;
  // DI hooks — default to real impls when omitted.
  loadCatalog?: typeof loadMarketplaceCatalog;
  installSkill?: typeof installSingleSkill;
  updateSkills?: typeof updateAgentSkills;
  scanCatalog?: typeof scanSkillsDirectory;
  linkSkills?: typeof linkAgentSkills;
  /**
   * Phase 93 Plan 02 D-93-02-2 — config.defaults.clawhubBaseUrl forwarded
   * here so handleMarketplaceListIpc can pass it to loadMarketplaceCatalog
   * for auto-injection. Optional → back-compat preserved when caller omits
   * (Pitfall 4 — keep the field optional to avoid the Rule 3 fixture cascade).
   */
  defaultClawhubBaseUrl?: string;
}>;

export type MarketplaceListIpcResult = Readonly<{
  agent: string;
  installed: readonly string[];
  available: readonly MarketplaceEntry[];
}>;

export type MarketplaceInstallIpcResult = Readonly<{
  outcome: SkillInstallOutcome;
  /** True iff post-install linkAgentSkills was invoked. */
  rewired: boolean;
}>;

export type MarketplaceRemoveIpcResult = Readonly<{
  agent: string;
  skill: string;
  removed: boolean;
  persisted: boolean;
  persist_error: string | null;
  reason?: string;
}>;

/**
 * `marketplace-list` — returns the installed-skills list AND the available
 * catalog (catalog minus already-installed) for the given agent.
 *
 * Plan 02's /clawcode-skills-browse handler consumes `available` directly
 * into a StringSelectMenuBuilder; /clawcode-skills consumes `installed`
 * directly into the remove-picker.
 */
export async function handleMarketplaceListIpc(
  deps: MarketplaceIpcDeps & { params: Record<string, unknown> },
): Promise<MarketplaceListIpcResult> {
  const agentName = validateStringParam(deps.params, "agent");
  const idx = deps.configs.findIndex((c) => c.name === agentName);
  if (idx === -1) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }
  const agent = deps.configs[idx]!;

  const loadCatalog = deps.loadCatalog ?? loadMarketplaceCatalog;
  const catalog = await loadCatalog({
    localSkillsPath: deps.localSkillsPath,
    sources: deps.marketplaceSources,
    log: deps.log,
    // Phase 93 Plan 02 D-93-02-2 — auto-inject default ClawHub source when
    // the operator hasn't configured an explicit clawhub source. Conditional
    // spread keeps the call argument clean when the field is undefined.
    ...(deps.defaultClawhubBaseUrl !== undefined
      ? { defaultClawhubBaseUrl: deps.defaultClawhubBaseUrl }
      : {}),
  });

  const installed = [...agent.skills];
  const installedSet = new Set(installed);
  const available = Object.freeze(
    catalog.filter((e) => !installedSet.has(e.name)),
  );

  return Object.freeze({
    agent: agentName,
    installed,
    available,
  });
}

/**
 * `marketplace-install` — installs ONE skill on the given agent and (on
 * successful copy) rewires the agent's workspace/skills/ symlink tree so
 * the new skill is linker-visible without a daemon restart.
 *
 * Rewire runs on `installed`, `installed-persist-failed`, and
 * `already-installed` outcomes (any outcome where the filesystem state
 * might be behind the intended symlinks). Refusal outcomes skip the
 * rewire.
 */
export async function handleMarketplaceInstallIpc(
  deps: MarketplaceIpcDeps & { params: Record<string, unknown> },
): Promise<MarketplaceInstallIpcResult> {
  const agentName = validateStringParam(deps.params, "agent");
  const skillName = validateStringParam(deps.params, "skill");
  const force = deps.params.force === true;

  // Fast-fail: agent lookup runs BEFORE catalog load so an unknown agent
  // doesn't pay the catalog-scan cost.
  const idx = deps.configs.findIndex((c) => c.name === agentName);
  if (idx === -1) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }

  const loadCatalog = deps.loadCatalog ?? loadMarketplaceCatalog;
  const catalog = await loadCatalog({
    localSkillsPath: deps.localSkillsPath,
    sources: deps.marketplaceSources,
    log: deps.log,
  });

  const installSkill = deps.installSkill ?? installSingleSkill;
  const outcome = await installSkill({
    skillName,
    agentName,
    catalog,
    skillsTargetDir: deps.skillsTargetDir,
    clawcodeYamlPath: deps.configPath,
    ledgerPath: deps.ledgerPath,
    force,
  });

  // Rewire on any outcome that left the filesystem in a state the
  // symlink tree should reflect.
  const shouldRewire =
    outcome.kind === "installed" ||
    outcome.kind === "installed-persist-failed" ||
    outcome.kind === "already-installed";

  let rewired = false;
  if (shouldRewire) {
    // In-memory mirror of the new skills list (installSingleSkill persisted
    // to YAML on `installed`, but the in-memory ResolvedAgentConfig needs
    // manual update). `already-installed` is a no-op; `installed-persist-
    // failed` still adds in-memory so the next invocation sees the skill
    // and the symlink matches.
    const existing = deps.configs[idx]!;
    const alreadyInList = existing.skills.includes(skillName);
    let updatedSkills = existing.skills as readonly string[];
    if (
      (outcome.kind === "installed" ||
        outcome.kind === "installed-persist-failed") &&
      !alreadyInList
    ) {
      updatedSkills = [...existing.skills, skillName];
      deps.configs[idx] = Object.freeze({
        ...existing,
        skills: updatedSkills,
      });
    }

    // Rescan the target dir so the fresh copy is in the catalog map.
    const scanCatalog = deps.scanCatalog ?? scanSkillsDirectory;
    const linkSkills = deps.linkSkills ?? linkAgentSkills;
    const freshCatalog = await scanCatalog(deps.skillsTargetDir, deps.log);
    await linkSkills(
      join(deps.configs[idx]!.workspace, "skills"),
      deps.configs[idx]!.skills,
      freshCatalog,
      deps.log,
    );
    rewired = true;
  }

  return Object.freeze({ outcome, rewired });
}

/**
 * `marketplace-remove` — removes ONE skill from the given agent's
 * `skills:` list in clawcode.yaml. Does NOT rewire symlinks (stale
 * symlink is harmless; scanner re-reads the YAML at next daemon boot).
 */
export async function handleMarketplaceRemoveIpc(
  deps: MarketplaceIpcDeps & { params: Record<string, unknown> },
): Promise<MarketplaceRemoveIpcResult> {
  const agentName = validateStringParam(deps.params, "agent");
  const skillName = validateStringParam(deps.params, "skill");

  const idx = deps.configs.findIndex((c) => c.name === agentName);
  if (idx === -1) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }

  const updateSkills = deps.updateSkills ?? updateAgentSkills;
  let removed = false;
  let persisted = false;
  let persistError: string | null = null;
  let reason: string | undefined;

  try {
    const result = await updateSkills({
      existingConfigPath: deps.configPath,
      agentName,
      skillName,
      op: "remove",
    });
    switch (result.outcome) {
      case "updated":
        removed = true;
        persisted = true;
        break;
      case "no-op":
        removed = false;
        persisted = true;
        reason = result.reason;
        break;
      case "not-found":
      case "file-not-found":
        removed = false;
        persisted = false;
        persistError = result.reason;
        break;
    }
  } catch (err) {
    // Non-rollback: even though persistence failed, the operator intent
    // was to remove — surface removed:true so the UI reports the
    // requested change and persisted:false so the operator sees the
    // reconciliation hint.
    removed = true;
    persisted = false;
    persistError = err instanceof Error ? err.message : String(err);
  }

  // Mirror in-memory config so subsequent IPC calls (e.g. marketplace-list)
  // reflect the removal, regardless of persistence outcome.
  if (removed) {
    const existing = deps.configs[idx]!;
    const nextSkills = existing.skills.filter((s) => s !== skillName);
    deps.configs[idx] = Object.freeze({ ...existing, skills: nextSkills });
  }

  return Object.freeze({
    agent: agentName,
    skill: skillName,
    removed,
    persisted,
    persist_error: persistError,
    ...(reason !== undefined ? { reason } : {}),
  });
}

// ---------------------------------------------------------------------------
// Phase 90 Plan 05 HUB-02 / HUB-04 — Plugin marketplace IPC handlers.
//
// Parallel to handleMarketplaceList/Install/RemoveIpc but routes through
// the ClawHub plugins endpoint (not skills) and writes to
// `agents[*].mcpServers` via installClawhubPlugin (which calls
// updateAgentMcpServers).
//
// Wired into the daemon IPC closure BEFORE routeMethod (same closure
// pattern as the skill marketplace handlers).
// ---------------------------------------------------------------------------

export type MarketplacePluginsIpcDeps = Readonly<{
  configs: ResolvedAgentConfig[];
  configPath: string;
  clawhubBaseUrl: string;
  clawhubAuthToken?: string;
  cache: ClawhubCache<ClawhubPluginsResponse>;
  log: Logger;
  // DI hooks for hermetic tests — default to real impls when omitted.
  fetchPlugins?: typeof fetchClawhubPlugins;
  downloadManifest?: typeof downloadClawhubPluginManifest;
  installPlugin?: typeof installClawhubPlugin;
}>;

export type MarketplaceListPluginsIpcResult = Readonly<{
  agent: string;
  installed: readonly string[];
  available: readonly ClawhubPluginListItem[];
}>;

/**
 * `marketplace-list-plugins` — returns the installed-mcpServer-names list
 * AND the available catalog (catalog minus already-installed) for the
 * given agent.
 *
 * Plan 05 Task 2's /clawcode-plugins-browse handler consumes `available`
 * directly into a StringSelectMenuBuilder. Rate-limited responses fail
 * open (empty `available`) so the UI can render "no plugins" instead of
 * an error state — the operator retries later.
 */
export async function handleMarketplaceListPluginsIpc(
  deps: MarketplacePluginsIpcDeps & { params: Record<string, unknown> },
): Promise<MarketplaceListPluginsIpcResult> {
  const agentName = validateStringParam(deps.params, "agent");
  const cfg = deps.configs.find((c) => c.name === agentName);
  if (!cfg) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }

  const cacheKey = {
    endpoint: "plugins",
    query: "",
    cursor: "",
  } as const;
  const fetchFn = deps.fetchPlugins ?? fetchClawhubPlugins;

  let response: ClawhubPluginsResponse;
  const hit = deps.cache.get(cacheKey);
  if (hit.kind === "hit") {
    response = hit.value;
  } else if (hit.kind === "rate-limited") {
    // Cache says still rate-limited — fail open with empty result so the
    // UI can surface "no plugins available right now".
    return Object.freeze({
      agent: agentName,
      installed: Object.freeze([]),
      available: Object.freeze([]),
    });
  } else {
    try {
      response = await fetchFn({
        baseUrl: deps.clawhubBaseUrl,
        ...(deps.clawhubAuthToken !== undefined
          ? { authToken: deps.clawhubAuthToken }
          : {}),
      });
      deps.cache.set(cacheKey, response);
    } catch (err) {
      // Rate-limit → cache negative entry + fail open
      if (
        err !== null &&
        typeof err === "object" &&
        "retryAfterMs" in err &&
        typeof (err as { retryAfterMs?: unknown }).retryAfterMs === "number"
      ) {
        deps.cache.setNegative(
          cacheKey,
          (err as { retryAfterMs: number }).retryAfterMs,
        );
        return Object.freeze({
          agent: agentName,
          installed: Object.freeze([]),
          available: Object.freeze([]),
        });
      }
      throw err;
    }
  }

  // Extract installed mcpServer names from the agent's resolved config.
  // The config shape is a union of string-refs (→ top-level map) and
  // inline objects; we normalize to names only (what the installer needs).
  const mcpList = (cfg as ResolvedAgentConfig & {
    mcpServers?: readonly (
      | string
      | Readonly<{ name: string; command?: string; args?: readonly string[]; env?: Readonly<Record<string, string>> }>
    )[];
  }).mcpServers ?? [];
  const installed: string[] = [];
  for (const m of mcpList) {
    if (typeof m === "string") installed.push(m);
    else if (typeof m === "object" && m !== null && typeof m.name === "string") {
      installed.push(m.name);
    }
  }

  const installedSet = new Set(installed);
  const available = Object.freeze(
    response.items.filter((p) => !installedSet.has(p.name)),
  );

  return Object.freeze({
    agent: agentName,
    installed: Object.freeze(installed),
    available,
  });
}

/**
 * `marketplace-install-plugin` — install ONE plugin on the given agent.
 *
 * Flow: list catalog → find matching item → download manifest →
 * installClawhubPlugin (with operator-supplied configInputs) → return
 * the typed PluginInstallOutcome.
 *
 * Error passthrough: ClawhubRateLimitedError / AuthRequiredError /
 * ManifestInvalidError are caught + mapped to outcome variants via
 * mapFetchErrorToOutcome. Any other exception bubbles up.
 *
 * NOTE: Plugin hot-reload is deferred per Phase 90 CONTEXT D-5 — the
 * installer writes the YAML but the agent's MCP subprocess doesn't
 * hot-add the new server. Operator must restart the agent manually.
 */
export async function handleMarketplaceInstallPluginIpc(
  deps: MarketplacePluginsIpcDeps & { params: Record<string, unknown> },
): Promise<PluginInstallOutcome> {
  const agentName = validateStringParam(deps.params, "agent");
  const pluginName = validateStringParam(deps.params, "plugin");
  const rawInputs = deps.params.configInputs;
  const configInputs: Record<string, string> = {};
  if (rawInputs !== null && typeof rawInputs === "object") {
    for (const [k, v] of Object.entries(rawInputs as Record<string, unknown>)) {
      if (typeof v === "string") configInputs[k] = v;
    }
  }

  const cfg = deps.configs.find((c) => c.name === agentName);
  if (!cfg) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }

  const fetchFn = deps.fetchPlugins ?? fetchClawhubPlugins;
  const dlFn = deps.downloadManifest ?? downloadClawhubPluginManifest;
  const install = deps.installPlugin ?? installClawhubPlugin;

  try {
    // List call to resolve manifestUrl for the chosen plugin name.
    const listResp = await fetchFn({
      baseUrl: deps.clawhubBaseUrl,
      ...(deps.clawhubAuthToken !== undefined
        ? { authToken: deps.clawhubAuthToken }
        : {}),
    });
    const item = listResp.items.find((p) => p.name === pluginName);
    if (!item) {
      return Object.freeze({
        kind: "not-in-catalog" as const,
        plugin: pluginName,
      });
    }
    // manifestUrl is optional on the list response — fall back to a
    // canonical URL derived from the plugin name. If neither resolves to
    // a real manifest, downloadClawhubPluginManifest surfaces a
    // manifest-invalid error.
    const manifestUrl =
      item.manifestUrl ??
      `${deps.clawhubBaseUrl.replace(/\/+$/, "")}/api/v1/plugins/${encodeURIComponent(item.name)}/manifest`;

    const manifest = await dlFn({
      manifestUrl,
      ...(deps.clawhubAuthToken !== undefined
        ? { authToken: deps.clawhubAuthToken }
        : {}),
    });

    return await install({
      manifest,
      agentName,
      configPath: deps.configPath,
      configInputs,
    });
  } catch (err) {
    return mapFetchErrorToOutcome(err, pluginName);
  }
}

// ---------------------------------------------------------------------------
// Phase 90 Plan 06 HUB-05 / HUB-07 — install-time config UX IPC handlers.
//
// Three pure-function handlers exported here so the slash-command inline
// handler (slash-commands.ts) can trigger them via sendIpcRequest:
//   - clawhub-oauth-start:       kick off GitHub device-code flow
//   - clawhub-oauth-poll:        long-lived RPC (up to 15min) that polls the
//                                 token endpoint and writes the received token
//                                 to 1Password on success
//   - marketplace-probe-op-items: single-field 1P rewrite probe; used by
//                                 the caller to decide whether to show the
//                                 "Use op://..." confirmation button row
//
// All three are closed-over in the IPC handler closure below and route
// BEFORE routeMethod so the existing routeMethod signature stays stable.
// ---------------------------------------------------------------------------

/**
 * IPC handler for `clawhub-oauth-start`.
 *
 * Initiates the GitHub device-code flow and returns the payload the Discord
 * UI needs to render the "visit {URL} and enter {code}" embed. The device_code
 * + poll_interval_s + expires_at are passed back to `clawhub-oauth-poll` to
 * complete the flow.
 */
export async function handleClawhubOauthStartIpc(
  deps: { log: Logger },
  _params: Record<string, unknown>,
): Promise<
  Readonly<{
    user_code: string;
    verification_uri: string;
    device_code: string;
    poll_interval_s: number;
    expires_at: number;
  }>
> {
  const init = await githubOauthMod.initiateDeviceCodeFlow();
  return Object.freeze({
    user_code: init.user_code,
    verification_uri: init.verification_uri,
    device_code: init.device_code,
    poll_interval_s: init.interval,
    expires_at: init.expires_at,
  });
}

/**
 * IPC handler for `clawhub-oauth-poll`. Long-lived RPC — may block for up
 * to 15 minutes (device-code expiry). The caller (slash-commands.ts)
 * extends the IPC request timeout for this method specifically.
 *
 * Success → stores token at op://clawdbot/ClawHub Token/credential via
 * `op item create` and returns {stored:true, message}. Any error (expired,
 * access_denied, network) → returns {stored:false, message:<description>}
 * so the Discord UI can show a friendly message.
 */
export async function handleClawhubOauthPollIpc(
  deps: { log: Logger },
  params: Record<string, unknown>,
): Promise<Readonly<{ stored: boolean; message: string }>> {
  const deviceCode = validateStringParam(params, "device_code");
  const pollIntervalS =
    typeof params.poll_interval_s === "number"
      ? params.poll_interval_s
      : 5;
  const expiresAt =
    typeof params.expires_at === "number"
      ? params.expires_at
      : Date.now() + 900_000;

  try {
    const token = await githubOauthMod.pollForAccessToken({
      user_code: "",
      verification_uri: "",
      device_code: deviceCode,
      interval: pollIntervalS,
      expires_at: expiresAt,
    });
    await githubOauthMod.storeTokenTo1Password(token, "ClawHub Token");
    return Object.freeze({
      stored: true,
      message:
        "Token stored at op://clawdbot/ClawHub Token/credential — restart the daemon to pick up authenticated ClawHub fetches.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log.warn({ err: msg }, "clawhub OAuth poll failed");
    return Object.freeze({
      stored: false,
      message: msg,
    });
  }
}

/**
 * IPC handler for `marketplace-probe-op-items`.
 *
 * Returns {proposal} where proposal is an op:// URI + confidence + item
 * title if a fuzzy match exists against the operator's 1Password vault,
 * else null. Called once per sensitive field before the Discord UI decides
 * whether to show the "Use op://..." confirmation button row.
 *
 * Graceful degradation: if `op item list` fails (binary missing, not
 * signed in), listOpItems returns [] → proposal is null → UI skips the
 * confirmation step and falls through to literal paste (still gated by
 * Plan 05's secret-scan on install).
 */
export async function handleMarketplaceProbeOpItemsIpc(
  deps: { log: Logger },
  params: Record<string, unknown>,
): Promise<Readonly<{ proposal: OpRewriteProposal | null }>> {
  const fieldName = validateStringParam(params, "fieldName");
  const fieldLabel = validateStringParam(params, "fieldLabel");
  const items = await opRewriteMod.listOpItems({ log: deps.log });
  const proposal = opRewriteMod.proposeOpUri(fieldName, fieldLabel, items);
  return Object.freeze({ proposal });
}

/**
 * Base directory for manager runtime files.
 *
 * Phase 110 Stage 0b — `CLAWCODE_MANAGER_DIR` env override allows a
 * parallel dev daemon (running as the same user, separate config) to
 * bind sockets, write registry, and snapshot to a fully isolated path
 * without colliding with another daemon's manager files. Same defense-
 * in-depth pattern as `CLAWCODE_MANAGER_SOCK` (Go shim side) and
 * `CLAWCODE_STATIC_SHIM_PATH` (loader side). Default is canonical.
 */
export const MANAGER_DIR =
  process.env.CLAWCODE_MANAGER_DIR ?? join(homedir(), ".clawcode", "manager");

/**
 * Path to the Unix domain socket.
 */
export const SOCKET_PATH = join(MANAGER_DIR, "clawcode.sock");

/**
 * Path to the PID file.
 */
export const PID_PATH = join(MANAGER_DIR, "clawcode.pid");

/**
 * Path to the registry file.
 */
export const REGISTRY_PATH = join(MANAGER_DIR, "registry.json");

/**
 * Phase 999.6 SNAP-01..02 — Path to the pre-deploy running-fleet snapshot.
 * Written at shutdown (before drain), read+deleted at boot (before the
 * autoStartAgents filter). See `src/manager/snapshot-manager.ts` for the
 * write/read contract and invariants.
 */
export const PRE_DEPLOY_SNAPSHOT_PATH = join(MANAGER_DIR, "pre-deploy-snapshot.json");
// Phase 108 — daemon-side socket the per-agent `clawcode mcp-broker-shim`
// subprocesses connect to. Owner-only permissions (chmod 0700 dir).
export const MCP_BROKER_SOCKET_PATH = join(MANAGER_DIR, "mcp-broker.sock");

/**
 * Ensure no stale socket file exists.
 * If another daemon is running (socket accepts connections), throws ManagerError.
 * If socket file exists but no daemon is running (stale), deletes it.
 *
 * Per RESEARCH Pitfall 2: stale socket cleanup.
 *
 * @param socketPath - Path to the Unix domain socket
 */
export async function ensureCleanSocket(socketPath: string): Promise<void> {
  // Check if file exists
  try {
    await access(socketPath);
  } catch {
    // File doesn't exist, nothing to clean
    return;
  }

  // Check if it's a real socket with an active listener
  const isActive = await checkSocketActive(socketPath);

  if (isActive) {
    throw new ManagerError("Another manager is already running");
  }

  // Stale socket file -- remove it
  await unlink(socketPath);
}

/**
 * Check if a socket file has an active listener by trying to connect.
 */
function checkSocketActive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);

    socket.on("connect", () => {
      // Another daemon is running
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      // Connection failed -- stale socket
      resolve(false);
    });
  });
}

/**
 * Start the daemon process.
 * Loads config, creates SessionManager, reconciles registry, starts IPC server.
 *
 * @param configPath - Path to the clawcode.yaml config file
 * @param adapter - Optional SessionAdapter (defaults to SdkSessionAdapter)
 * @returns Cleanup function for tests
 */
export async function startDaemon(
  configPath: string,
  adapter?: SessionAdapter,
): Promise<{ server: Server; manager: SessionManager; taskStore: TaskStore; taskManager: TaskManager; payloadStore: PayloadStore; triggerEngine: TriggerEngine; routingTable: RoutingTable; rateLimiter: RateLimiter; heartbeatRunner: HeartbeatRunner; taskScheduler: TaskScheduler; skillsCatalog: SkillsCatalog; slashHandler: SlashCommandHandler; threadManager: ThreadManager; webhookManager: WebhookManager; discordBridge: DiscordBridge | null; subagentThreadSpawner: SubagentThreadSpawner | null; configWatcher: ConfigWatcher; configReloader: ConfigReloader; policyWatcher: PolicyWatcher; routingTableRef: { current: RoutingTable }; secretsResolver: SecretsResolver; dashboard: { readonly server: import("node:http").Server; readonly sseManager: import("../dashboard/sse.js").SseManager; readonly close: () => Promise<void> }; shutdown: () => Promise<void> }> {
  const log = logger.child({ component: "daemon" });

  // 1. Ensure manager directory exists
  await mkdir(MANAGER_DIR, { recursive: true });

  // 2. Clean stale socket
  await ensureCleanSocket(SOCKET_PATH);

  // 3. Write PID file
  await writeFile(PID_PATH, String(process.pid), "utf-8");

  // 4. Load config
  // Phase 999.X — `let` (not `const`) so the configWatcher's onChange
  // handler can reassign on yaml edit. Long-lived closures (orphan-claude
  // reaper, subagent-session reaper, both inside onTickAfter) read
  // `config.defaults.<dial>` lazily on each tick — `let` mutability +
  // closure-by-reference means yaml hot-reload of those dials takes
  // effect on the next 60s tick without a daemon restart. Pre-fix this
  // was `const` and the closures captured a boot-time snapshot,
  // silently ignoring yaml edits.
  let config = await loadConfig(configPath);

  // 4a. Phase 104 SEC-01/SEC-04 — single SecretsResolver instance for the
  // whole daemon lifetime. Pre-resolves every op:// URI in the config in
  // parallel BEFORE the loader's sync resolver runs, so subsequent boot
  // steps (loader sync wrapper below, per-agent opEnvResolver, Discord
  // botToken) hit a warm cache and never re-shell `op read` for the same
  // URI. Mirrors the existing graceful-degradation pattern at line ~1545
  // (resolveAllAgents onMcpError) — partial failures are logged loudly but
  // do NOT block boot. Critical secrets (Discord botToken) keep their own
  // fail-closed behavior at the resolution call site.
  const secretsResolver = new SecretsResolver({
    opRead: defaultOpReadShellOut,
    log: log.child({ subsystem: "secrets" }),
  });
  const allOpRefs = collectAllOpRefs(config);
  log.info({ count: allOpRefs.length }, "secrets: pre-resolving op:// references");
  const preResolveResults = await secretsResolver.preResolveAll(allOpRefs);
  const failedRefs = preResolveResults.filter((r) => !r.ok);
  for (const f of failedRefs) {
    // Fail-open: log loudly and continue. Affected MCPs degrade via the
    // existing onMcpResolutionError path (loader.ts) when their env value
    // hits getCached() === undefined and the sync wrapper throws.
    log.error({ uri: f.uri, reason: f.reason }, "secrets: pre-resolve failed");
  }
  log.info(
    {
      resolved: preResolveResults.length - failedRefs.length,
      failed: failedRefs.length,
    },
    "secrets: pre-resolve complete",
  );

  // 4-bis. Phase 999.14 — MCP child process lifecycle hardening. Construct
  // the per-daemon McpProcessTracker singleton AFTER secretsResolver is
  // warmed up but BEFORE manager.startAll spawns any new MCP children.
  // Run a one-shot boot orphan scan (MCP-05) BEFORE startAll so leftover
  // PPID=1 MCP procs from a prior daemon crash get killed before fresh
  // children of the same names spawn (otherwise port/connection collisions).
  //
  // Skipped entirely when no MCP servers are configured — tracker stays null
  // and downstream code paths guard with `if (mcpTracker)`. Boot-scan failure
  // is non-fatal (logged + continue) per RESEARCH.md: a crashed reaper must
  // never prevent agents from starting; the next 60s tick catches stragglers.
  const mcpServersConfig = config.mcpServers ?? {};
  const mcpLog = log.child({ subsystem: "mcp-lifecycle" });
  let mcpTracker: McpProcessTracker | null = null;
  let reaperInterval: NodeJS.Timeout | null = null;
  // Phase 999.15 — hoisted out of the inner try so SessionManager construction
  // (line ~1816) and the onTickAfter reconcile closure (line ~4070+) can both
  // pass them to discoverClaudeSubprocessPid({ minAge, bootTimeUnix,
  // clockTicksPerSec }) without re-reading /proc/stat per call.
  let mcpBootTimeUnix: number | undefined;
  let mcpClockTicksPerSec: number | undefined;
  if (Object.keys(mcpServersConfig).length > 0) {
    try {
      mcpBootTimeUnix = await readBootTimeUnix();
      mcpClockTicksPerSec = readClockTicksPerSec();
      const mcpPatterns = buildMcpCommandRegexes(mcpServersConfig);
      const mcpUid = process.getuid?.() ?? -1;
      // Phase 999.15 TRACK-06 — late-bound reconcileAgent closure for
      // tracker.killAgentGroup. Pattern from Phase 100 follow-up
      // triggerDeliveryFn — closure captures the LIVE `mcpTracker` ref so
      // the reconciler always sees the post-construction singleton (avoids
      // bootstrap circular dep where reconciler imports the tracker type).
      const reconcileAgentClosure = async (name: string): Promise<void> => {
        if (!mcpTracker) return;
        await reconcileAgent(name, {
          tracker: mcpTracker,
          daemonPid: process.pid,
          log: mcpLog,
          bootTimeUnix: mcpBootTimeUnix,
          clockTicksPerSec: mcpClockTicksPerSec,
        });
      };
      mcpTracker = new McpProcessTracker({
        uid: mcpUid,
        patterns: mcpPatterns,
        log: mcpLog,
        clockTicksPerSec: mcpClockTicksPerSec,
        bootTimeUnix: mcpBootTimeUnix,
        reconcileAgent: reconcileAgentClosure,
      });
      try {
        await reapOrphans({
          uid: mcpUid,
          patterns: mcpPatterns,
          clockTicksPerSec: mcpClockTicksPerSec,
          bootTimeUnix: mcpBootTimeUnix,
          reason: "boot-scan",
          log: mcpLog,
        });
      } catch (err) {
        // Boot-scan failure is non-fatal — daemon continues to startAll.
        // The next 60s reaper tick will catch any stragglers.
        mcpLog.error(
          { err: String(err) },
          "mcp boot-scan failed; continuing daemon boot",
        );
      }
    } catch (err) {
      // Tracker construction failed (e.g. /proc unavailable on non-Linux).
      // Leave tracker null; downstream guards skip MCP lifecycle work.
      mcpLog.warn(
        { err: String(err) },
        "mcp tracker init skipped (likely non-Linux or /proc unavailable)",
      );
      mcpTracker = null;
    }
  } else {
    mcpLog.info("no mcp servers configured; skipping lifecycle tracker");
  }

  // 4-ter. Phase 108 — OnePasswordMcpBroker + ShimServer.
  //
  // Owns ONE pooled `@takescake/1password-mcp` child per unique resolved
  // OP_SERVICE_ACCOUNT_TOKEN. Constructed AFTER SecretsResolver (so the
  // tokenHash → rawToken map is built from warmed cache values) AND AFTER
  // McpProcessTracker (so onPoolSpawn can register the pool PID under a
  // synthetic `__broker:1password:<tokenHash>` owner). The reconciler
  // (src/mcp/reconciler.ts via the per-agent skip-list added in this
  // phase) treats those entries as broker-owned and never SIGTERMs them
  // during per-agent cleanup.
  //
  // ORDERING DECISION (108-04): the planner offered tracker-before-broker
  // OR broker-before-tracker. We pick **tracker-before-broker** so the
  // broker's onPoolSpawn callback closes over the already-constructed
  // tracker singleton (no forward-reference / null-checks needed). Per
  // RESEARCH.md §5 the only hard constraint is "broker is up before
  // agents start" — both orderings satisfy that since manager.startAll
  // happens far below.
  //
  // Token literal flow (Phase 104 SEC-07): shim hashes
  // OP_SERVICE_ACCOUNT_TOKEN client-side → handshake sends only
  // {agent, tokenHash}. Broker resolves tokenHash → rawToken via the
  // daemon-built tokenHashToRawToken map below, then spawns the pool
  // child with the literal in its env. Logs only ever see tokenHash.
  const tokenHashToRawToken = new Map<string, string>();
  const collectTokenLiteral = (literal: string): string => {
    // 8-char slice MUST match the shim's hashing (mcp-broker-shim.ts).
    // A drift here makes shim handshakes resolve to rawToken="" → child
    // spawn with empty token → auth fail → crash loop → shim exit 75.
    const tokenHash = createHash("sha256").update(literal).digest("hex").slice(0, 8);
    if (!tokenHashToRawToken.has(tokenHash)) {
      tokenHashToRawToken.set(tokenHash, literal);
    }
    return tokenHash;
  };
  // Process-env fallback (loader's auto-inject path uses this token).
  if (process.env.OP_SERVICE_ACCOUNT_TOKEN) {
    collectTokenLiteral(process.env.OP_SERVICE_ACCOUNT_TOKEN);
  }
  // Per-agent overrides (mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN)
  // resolved through SecretsResolver get harvested below once
  // resolvedAgents is built (line ~1706+). Defer the populate-from-config
  // step until after the resolveAllAgents call.

  const brokerLog = log.child({ subsystem: "mcp-broker" });
  const broker = new OnePasswordMcpBroker({
    log: brokerLog,
    spawnFn: ({ tokenHash, rawToken }) => {
      // Fail loud if rawToken is empty — that means tokenHash failed to
      // resolve in the daemon's tokenHashToRawToken map, which is the
      // canonical hash-length-mismatch failure mode. Better to surface
      // a daemon error than silently crash-loop pool children with bad
      // auth. SEC-07: include only tokenHash in the error.
      if (!rawToken) {
        throw new Error(
          `mcp-broker: empty rawToken for tokenHash=${tokenHash} — ` +
            "shim/daemon hash-slice drift? Check that " +
            "mcp-broker-shim.ts and daemon.ts both slice(0, 8).",
        );
      }
      // Spawn the upstream MCP child the broker pools. This is the same
      // command the pre-Phase-108 loader injected per-agent — now once
      // per token. SEC-07: never log rawToken.
      const child = childSpawn(
        "npx",
        ["-y", "@takescake/1password-mcp@latest"],
        {
          env: {
            ...process.env,
            OP_SERVICE_ACCOUNT_TOKEN: rawToken,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      // Phase 999.15 reconciler integration — register pool PID under
      // synthetic owner so reconciler skip-list (added in this phase)
      // keeps it safe from per-agent SIGTERM during agent cleanup.
      if (mcpTracker !== null && child.pid !== undefined) {
        const syntheticOwner = `__broker:1password:${tokenHash}`;
        void mcpTracker.register(syntheticOwner, process.pid, [child.pid]);
        // Tear down tracker entry when the child exits (broker's own
        // exit handler is the source of truth for respawn — when the
        // broker calls spawnFn again on respawn we re-register fresh).
        child.once("exit", () => {
          if (mcpTracker !== null) {
            mcpTracker.unregister(syntheticOwner);
          }
        });
      }
      brokerLog.info(
        {
          component: "mcp-broker",
          pool: `1password-mcp:${tokenHash}`,
          childPid: child.pid ?? null,
        },
        "spawned pool child",
      );
      return child;
    },
  });

  const shimServer = new ShimServer({
    log: brokerLog.child({ component: "mcp-broker-shim-server" }),
    broker,
    socketPath: MCP_BROKER_SOCKET_PATH,
    resolveRawToken: (tokenHash) => tokenHashToRawToken.get(tokenHash),
  });

  // Listen on the unix-domain socket. Bind failures are non-fatal: log
  // loudly and continue — agents that try to use 1password will see MCP
  // child spawn errors via the SDK's existing onMcpResolutionError path.
  const brokerNetServer = createNetServer((socket) => {
    shimServer.handleConnection(socket);
  });
  try {
    // Best-effort cleanup of stale socket file from a prior crashed daemon.
    try {
      await unlink(MCP_BROKER_SOCKET_PATH);
    } catch {
      // ENOENT is the happy path; other errors will surface on listen().
    }
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (err: Error): void => {
        brokerNetServer.removeListener("listening", onListening);
        rejectListen(err);
      };
      const onListening = (): void => {
        brokerNetServer.removeListener("error", onError);
        resolveListen();
      };
      brokerNetServer.once("error", onError);
      brokerNetServer.once("listening", onListening);
      brokerNetServer.listen(MCP_BROKER_SOCKET_PATH);
    });
    brokerLog.info(
      { socketPath: MCP_BROKER_SOCKET_PATH },
      "mcp-broker listening",
    );
  } catch (err) {
    brokerLog.error(
      { socketPath: MCP_BROKER_SOCKET_PATH, err: String(err) },
      "mcp-broker socket bind failed; pool routing will fail until restart",
    );
  }

  // 4b. Phase 104 — sync wrapper around the warmed cache. The loader
  // requires a SYNC resolver (loader.ts is sync by design); the warming was
  // done above by preResolveAll. If a URI was missed (config edited between
  // yaml-parse and now, or a hot-reload added a new ref), throw — the
  // loader's onMcpResolutionError path will degrade the affected MCP
  // gracefully (matches existing line ~1545 behavior).
  const cachedOpRefResolver: OpRefResolver = (uri: string): string => {
    const cached = secretsResolver.getCached(uri);
    if (cached === undefined) {
      throw new Error(
        `SecretsResolver: ${uri} not pre-resolved (likely added by hot-reload — re-run preResolveAll). `
          + `If this is a fresh op:// URI, save the config to trigger ConfigWatcher.onChange which auto-resolves new refs.`,
      );
    }
    return cached;
  };

  // 5. Resolve all agents — pass the cached sync resolver so any
  // `op://vault/item/field` references under mcpServers[].env get
  // substituted with concrete secret values BEFORE the SDK spawns the
  // MCP children. Without this, literal `op://...` strings reach the
  // child process and crash it at first use (e.g. MySQL driver does
  // `dns.lookup("op://...")` → ENOTFOUND).
  //
  // Graceful degradation: a bad op:// ref (missing item, wrong field)
  // logs a loud error and disables just that one MCP for the affected
  // agent. The daemon continues booting; other agents that don't
  // reference the broken MCP are unaffected. Operators see exactly
  // which agent + MCP + env var failed in the daemon log.
  const resolvedAgents = resolveAllAgents(config, cachedOpRefResolver, (info) => {
    log.error(
      { agent: info.agent, server: info.server, reason: info.message },
      "MCP server disabled — env resolution failed",
    );
  });

  // Phase 108 — harvest every per-agent OP_SERVICE_ACCOUNT_TOKEN literal
  // (post-op:// resolution) into the daemon-side tokenHash → rawToken map
  // built above. Per-agent overrides (yaml mcpEnvOverrides.1password) live
  // in `agent.mcpEnvOverrides` as op:// URIs; they were NOT resolved by
  // resolveAllAgents (loader keeps them verbatim — see MCP-LOAD-1 test).
  // Resolve each via the warm cache here so the broker's spawnFn has the
  // literal when an agent on a non-default token connects.
  for (const agent of resolvedAgents) {
    // 1) The auto-injected `1password` MCP entry's env carries either the
    //    process-env token (no override) OR the resolved override literal.
    //    Loader's resolveMcpEnvValue runs op:// substitution at that path,
    //    so `mcpServers[i].env.OP_SERVICE_ACCOUNT_TOKEN` is already a
    //    literal here.
    const opServer = agent.mcpServers.find((s) => s.name === "1password");
    const opServerToken = opServer?.env?.OP_SERVICE_ACCOUNT_TOKEN;
    if (typeof opServerToken === "string" && opServerToken.length > 0) {
      collectTokenLiteral(opServerToken);
    }
    // 2) Per-agent mcpEnvOverrides.1password.OP_SERVICE_ACCOUNT_TOKEN. Two
    //    legal yaml shapes:
    //      a) op:// URI — resolve via the warm secrets cache, then collect.
    //      b) Literal `ops_...` token (current production yaml) — collect
    //         directly. The shim hashes whatever literal flows through its
    //         env, so the daemon must collect the same literal here so the
    //         hashes match at handshake time.
    const overrideValue = agent.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
    if (typeof overrideValue === "string" && overrideValue.length > 0) {
      if (overrideValue.startsWith("op://")) {
        const resolved = secretsResolver.getCached(overrideValue);
        if (typeof resolved === "string" && resolved.length > 0) {
          collectTokenLiteral(resolved);
        } else {
          brokerLog.warn(
            { agent: agent.name, uri: overrideValue },
            "mcp-broker: per-agent OP_SERVICE_ACCOUNT_TOKEN op:// override unresolved; pool spawn for this agent will fail",
          );
        }
      } else {
        // Literal token — collect directly. SEC-07: never log the literal.
        collectTokenLiteral(overrideValue);
      }
    }
  }
  brokerLog.info(
    { uniqueTokens: tokenHashToRawToken.size },
    "mcp-broker: tokenHash → rawToken map built",
  );

  // Phase 100 follow-up — merge runtime gsd.projectDir overrides into the
  // resolved configs BEFORE SessionManager spins up. The override file lives
  // at ~/.clawcode/manager/gsd-project-overrides.json and is written by the
  // /gsd-set-project Discord slash + set-gsd-project IPC. Overrides survive
  // daemon restart by being applied here at boot. Missing file / parse error
  // → readAllGsdProjectOverrides returns an empty Map (silent — fresh boot).
  // Override only applies to agents that already have gsd.projectDir set in
  // yaml — never grants GSD capability to a non-GSD agent (operator must
  // edit yaml first).
  {
    const { readAllGsdProjectOverrides, DEFAULT_GSD_PROJECT_OVERRIDES_PATH } =
      await import("./gsd-project-store.js");
    const overrides = await readAllGsdProjectOverrides(
      DEFAULT_GSD_PROJECT_OVERRIDES_PATH,
      log,
    );
    if (overrides.size > 0) {
      const list = resolvedAgents as ResolvedAgentConfig[];
      for (let i = 0; i < list.length; i++) {
        const agent = list[i]!;
        const overridden = overrides.get(agent.name);
        if (overridden && agent.gsd?.projectDir) {
          list[i] = { ...agent, gsd: { projectDir: overridden } };
          log.info(
            { agent: agent.name, projectDir: overridden },
            "applied runtime gsd.projectDir override",
          );
        }
      }
    }
  }

  // 5c. Validate only one admin agent (per D-14)
  const adminAgents = resolvedAgents.filter(a => a.admin);
  if (adminAgents.length > 1) {
    throw new ManagerError(
      `Only one admin agent allowed, found ${adminAgents.length}: ${adminAgents.map(a => a.name).join(", ")}`
    );
  }
  if (adminAgents.length === 1) {
    log.info({ admin: adminAgents[0].name }, "admin agent configured");
  }

  // 5a. Scan skills directory and link agent skills
  const skillsPath = resolvedAgents.length > 0 ? resolvedAgents[0].skillsPath : "";

  // Install workspace skills to global and agent skills directories (once)
  await installWorkspaceSkills(join(process.cwd(), "skills"), skillsPath, log);

  const skillsCatalog = await scanSkillsDirectory(skillsPath, log);
  log.info({ skills: skillsCatalog.size }, "skills catalog loaded");

  for (const agent of resolvedAgents) {
    await linkAgentSkills(join(agent.workspace, "skills"), agent.skills, skillsCatalog, log);
  }

  // Phase 88 Plan 02 MKT-01 — resolve marketplace legacy sources once at
  // boot. Empty `[]` when `defaults.marketplaceSources` is omitted (v2.1/v2.2
  // configs are unchanged). Closed over by the marketplace-* IPC intercepts
  // below so /clawcode-skills-browse / -install / -remove have the full
  // catalog surface without a per-call re-resolve.
  const resolvedMarketplaceSources = resolveMarketplaceSources(config);
  const ledgerPath = DEFAULT_SKILLS_LEDGER_PATH;

  // Phase 90 Plan 05 HUB-02 — daemon-scoped cache for ClawHub /api/v1/plugins
  // responses. TTL mirrors Plan 04 HUB-08 skills cache (configurable via
  // defaults.clawhubCacheTtlMs, default 10 min). Negative entries carry
  // their own retryAfterMs from Retry-After header.
  const clawhubPluginsCache = createClawhubCache<ClawhubPluginsResponse>(
    config.defaults.clawhubCacheTtlMs,
  );

  // 5b. Build routing table and rate limiter
  const routingTable = buildRoutingTable(resolvedAgents);
  // Mutable ref — config hot-reload swaps `current` so bridge + IPC observe
  // updated channel→agent bindings without needing daemon restart.
  const routingTableRef = { current: routingTable };
  const rateLimiter = createRateLimiter(DEFAULT_RATE_LIMITER_CONFIG);
  log.info({ routes: routingTable.channelToAgent.size }, "routing table built");

  // 5d. Reconcile registry — prune ghost entries left by renamed/removed agents.
  // Runs BEFORE SessionManager so startAll never sees stale names.
  //
  // clawdy-v2-stability follow-up (2026-04-19): `pruneNonStoppedSubagents: true`
  // reaps sub/thread entries whose `status !== "stopped"` but whose child
  // process cannot be alive — by definition, no subagent process survives a
  // daemon restart, so any entry marked running/starting/etc. at boot time is
  // a phantom left over from an uncleanly-exited prior daemon. Without this,
  // those entries survive the TTL reap (targets stopped) AND the
  // pollMemoryStats filter (allows running), triggering
  // "Memory store not found" log spam every SSE tick.
  const knownAgentNames = new Set(resolvedAgents.map((a) => a.name));
  const existingRegistry = await readRegistry(REGISTRY_PATH);
  const reconciled = reconcileRegistry(existingRegistry, knownAgentNames, {
    pruneNonStoppedSubagents: true,
  });
  if (reconciled.pruned.length > 0) {
    for (const entry of reconciled.pruned) {
      log.info(
        { name: entry.name, reason: entry.reason },
        "pruned ghost registry entry",
      );
    }
    await writeRegistry(REGISTRY_PATH, reconciled.registry);
    log.info(
      { prunedCount: reconciled.pruned.length },
      "registry reconciliation complete",
    );
  }

  // 6. Create SessionManager
  const sessionAdapter = adapter ?? new SdkSessionAdapter();
  // Phase 100 follow-up — wire the vault-scoped MCP env override resolver.
  // Daemon shells out via `op read <uri>` using the daemon's process-level
  // OP_SERVICE_ACCOUNT_TOKEN (clawdbot full-fleet scope). Resolved values
  // (e.g. a Finmentum-only SA token) replace per-server env entries before
  // the SDK spawns the MCP subprocess. The clawdbot token NEVER appears in
  // any agent MCP subprocess env, error message, or log line — see
  // src/manager/op-env-resolver.ts for the security invariants.
  const { resolveMcpEnvOverrides } = await import("./op-env-resolver.js");
  // Phase 104 — per-agent op:// resolution routes through the shared
  // SecretsResolver so cache + retry + telemetry apply uniformly across
  // boot pre-resolve, loader sync wrapper, Discord botToken, and per-agent
  // override paths. Replaces the prior direct-shell-out via
  // defaultOpReadShellOut at this site (which is now the resolver's
  // injected opRead, not the per-agent injection point).
  const opEnvResolver = async (
    overrides: Record<string, Record<string, string>>,
    agentName: string,
  ): Promise<Record<string, Record<string, string>>> => {
    return resolveMcpEnvOverrides(overrides, {
      opRead: (uri: string) => secretsResolver.resolve(uri),
      log: {
        warn: (...args: unknown[]) =>
          (log.warn as (...a: unknown[]) => void)({ agent: agentName }, ...args),
        info: (...args: unknown[]) =>
          (log.info as (...a: unknown[]) => void)({ agent: agentName }, ...args),
      },
    });
  };

  const manager = new SessionManager({
    adapter: sessionAdapter,
    registryPath: REGISTRY_PATH,
    log,
    opEnvResolver,
    // Phase 999.14 MCP-01 — daemon-wide tracker for per-agent MCP child
    // PID discovery + cleanup. Null when no MCP servers configured (no-op).
    mcpTracker,
    // Phase 999.15 TRACK-02 — proc-age math constants piped through so the
    // polled-discovery loop can pass minAge=5 + bootTimeUnix +
    // clockTicksPerSec to discoverClaudeSubprocessPid without per-call
    // /proc/stat reads. Undefined when mcpTracker is null (non-Linux / no
    // MCP servers configured).
    mcpBootTimeUnix,
    mcpClockTicksPerSec,
  });

  // 6-bis. Create TurnDispatcher singleton (Phase 57 Plan 03).
  // Single chokepoint for every agent-turn initiation — Discord bridge and
  // task scheduler route through it so every persisted trace row carries a
  // TurnOrigin JSON blob. Future Phase 59 handoffs + Phase 60 triggers plug
  // in by calling the same dispatch/dispatchStream methods (no per-source
  // Turn lifecycle reinvention).
  const turnDispatcher = new TurnDispatcher({
    sessionManager: manager,
    log,
    // Phase 90 MEM-03 — pre-turn hybrid-RRF retrieval hook. The closure
    // defers to SessionManager.getMemoryRetrieverForAgent which produces
    // a per-call retriever (reads topK from current agent config, uses
    // the shared MiniLM embedder). Returns empty array when the agent
    // has no MemoryStore (opt-out or not-yet-initialized) — zero side
    // effects on the hot path.
    memoryRetriever: async (agentName, query) => {
      const retriever = manager.getMemoryRetrieverForAgent(agentName);
      if (!retriever) return [];
      return retriever(query);
    },
    // Phase 90 MEM-05 — cue-memory writer DI. Wrapped into a closure so
    // memory-cue.ts stays pure (no Logger import from the daemon layer);
    // the dispatcher's own log.child is threaded in.
    memoryCueWriter: async (args) => {
      const { writeCueMemory } = await import("../memory/memory-cue.js");
      return writeCueMemory({ ...args, log });
    },
    // Phase 90 MEM-06 — subagent-return capture DI. Mirror shape of
    // memoryCueWriter — pure module imported lazily.
    subagentCapture: async (args) => {
      const { captureSubagentReturn } = await import(
        "../memory/subagent-capture.js"
      );
      return captureSubagentReturn({ ...args, log });
    },
    // Phase 90 MEM-05 / MEM-06 — per-agent workspace resolver. Looks up
    // the resolved agent config from the manager's in-memory map. Returns
    // undefined when the agent isn't registered (e.g., daemon boot race).
    workspaceForAgent: (agentName) => {
      const cfg = resolvedAgents.find((a) => a.name === agentName);
      return cfg?.workspace;
    },
    // Phase 90 MEM-05 D-32 — Discord reaction adder. DiscordBridge isn't
    // constructed until later in boot; we close over discordBridgeRef so
    // the resolved reference is read at CALL TIME (when a cue actually
    // fires), not construction time. When discord isn't available (no
    // token / no bindings), the reaction is a no-op. All discord.js calls
    // are try/catch-wrapped — a stale snowflake or permission error MUST
    // NOT poison the cue-write path.
    discordReact: async (target, emoji) => {
      const bridge = discordBridgeRef.current;
      if (!bridge) return;
      try {
        const channel = await bridge.discordClient.channels.fetch(
          target.channelId,
        );
        if (!channel || !("messages" in channel)) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const message = await (channel as any).messages.fetch(target.messageId);
        if (!message) return;
        await message.react(emoji);
      } catch (err) {
        log.warn(
          { err: (err as Error).message, target, emoji },
          "discord reaction failed (non-fatal)",
        );
      }
    },
  });
  log.info("TurnDispatcher initialized");

  // 6-ter. Create TaskStore singleton (Phase 58 Plan 03).
  // Daemon-scoped SQLite — shared across all agents, single-writer owned by
  // the daemon. Consumers (Phase 59 TaskManager, Phase 60 TriggerEngine,
  // Phase 63 CLIs via READ-ONLY handle) import the instance from startDaemon's
  // return value. Agents NEVER write directly — the single-writer invariant
  // (STATE.md Phase 58 blockers) must be preserved.
  const taskStore = new TaskStore({
    dbPath: join(MANAGER_DIR, "tasks.db"),
  });
  log.info({ path: join(MANAGER_DIR, "tasks.db") }, "TaskStore initialized");

  // Reconcile stale in-flight tasks from the previous daemon run BEFORE
  // SessionManager.startAll fires — so any Phase 59 delegate_task on the
  // first tick does not race against a stale row carrying a duplicate
  // task_id (LIFE-04).
  const reconciliation = runStartupReconciliation(
    taskStore,
    ORPHAN_THRESHOLD_MS,
    log,
  );
  if (reconciliation.reconciledCount > 0) {
    log.warn(
      {
        count: reconciliation.reconciledCount,
        taskIds: reconciliation.reconciledTaskIds,
      },
      "startup reconciliation marked stale tasks orphaned",
    );
  }

  // Mutable ref so closures created before discordBridge initialization can still access it
  const discordBridgeRef: { current: DiscordBridge | null } = { current: null };

  // Phase 100 follow-up — late-binding refs for the TriggerEngine deliveryFn.
  // TriggerEngine is constructed at boot step 6-quinquies-b (~line 1935),
  // long before WebhookManager (~line 3530) and the bot-direct sender
  // (~line 3499) exist. Using mutable refs is the same pattern already
  // applied for discordBridgeRef — the closure reads `.current` at fire time
  // (cron triggers don't fire until after the agents start at the bottom of
  // boot), so the slot is populated by then. If a trigger somehow fires
  // before either is ready, the deliveryFn warn-logs + skips delivery
  // (the dispatch itself still ran, watermark still advances).
  const webhookManagerRef: { current: WebhookManager | null } = { current: null };
  const botDirectSenderRef: {
    current: import("./restart-greeting.js").BotDirectSender | null;
  } = { current: null };

  // 6a. Create escalation budget tracker (shared SQLite DB in manager dir)
  const escalationBudgetDb = new Database(join(MANAGER_DIR, "escalation-budget.db"));
  const escalationBudget = new EscalationBudget(escalationBudgetDb);

  // Build per-agent budget configs from resolved configs
  const budgetConfigs = new Map<string, import("../usage/budget.js").AgentBudgetConfig>();
  for (const agentConfig of resolvedAgents) {
    if (agentConfig.escalationBudget) {
      budgetConfigs.set(agentConfig.name, agentConfig.escalationBudget);
    }
  }

  // Create EscalationMonitor with budget enforcement and Discord alerts
  const escalationMonitor = new EscalationMonitor(manager, {
    errorThreshold: 3,
    escalationModel: "sonnet",
    keywordTriggers: ["this needs opus"],
  }, {
    budget: escalationBudget,
    budgetConfigs,
    alertCallback: (agent, model, threshold) => {
      const bridge = discordBridgeRef.current;
      if (!bridge) return;
      const agentConfig = resolvedAgents.find(a => a.name === agent);
      const channelId = agentConfig?.channels[0];
      if (!channelId) return;
      const config = budgetConfigs.get(agent);
      const dailyLimit = config?.daily?.[model as keyof typeof config.daily] ?? 0;
      const tokensUsed = escalationBudget.getUsageForPeriod(agent, model, "daily");
      bridge.sendBudgetAlert(channelId, {
        agent,
        model,
        tokensUsed,
        tokenLimit: dailyLimit as number,
        threshold,
        period: "daily",
      }).catch(err => log.warn({ err, agent }, "failed to send budget alert"));
    },
  });
  log.info("escalation monitor initialized with budget enforcement");

  // 6a2. Create advisor budget tracker (shared SQLite DB in manager dir)
  const advisorBudgetDb = new Database(join(MANAGER_DIR, "advisor-budget.db"));
  const advisorBudget = new AdvisorBudget(advisorBudgetDb);
  log.info("advisor budget initialized");

  // 6-quater. Create TaskManager singleton (Phase 59 Plan 03).
  // Depends on: taskStore (6-ter), turnDispatcher (6-bis), escalationBudget (6a),
  // resolvedAgents (5a), and a SchemaRegistry loaded from ~/.clawcode/task-schemas/.
  //
  // Exposed on the daemon return value so Phase 63 observability CLIs can
  // read task state without re-entering through IPC.
  const payloadStore = new PayloadStore(taskStore.rawDb);
  const schemaRegistry = await SchemaRegistry.load();
  log.info(
    { schemas: schemaRegistry.size(), schemaNames: schemaRegistry.names() },
    "SchemaRegistry loaded",
  );

  const taskManager = new TaskManager({
    store: taskStore,
    turnDispatcher,
    schemaRegistry,
    escalationBudget,
    getAgentConfig: (name) =>
      resolvedAgents.find((c) => c.name === name) ?? null,
    storePayload: (id, p) => payloadStore.storePayload(id, p),
    getStoredPayload: (id) => payloadStore.getPayload(id),
    storeResult: (id, r) => payloadStore.storeResult(id, r),
    getStoredResult: (id) => payloadStore.getResult(id),
    log,
  });
  log.info({ schemaCount: taskManager.schemaCount }, "TaskManager initialized");

  // 6-quinquies-a. Create TaskScheduler (moved from step 8b — Phase 60).
  // TaskScheduler only needs sessionManager + turnDispatcher + log,
  // all available since step 6-bis. Moved earlier so SchedulerSource
  // can wrap it before HeartbeatRunner starts.
  // IMPORTANT: Only handler-based schedules go through TaskScheduler directly.
  // Prompt-based schedules are routed through SchedulerSource -> TriggerEngine.
  const taskScheduler = new TaskScheduler({
    sessionManager: manager,
    turnDispatcher,
    log,
  });
  for (const agentConfig of resolvedAgents) {
    const handlerSchedules: ScheduleEntry[] = [];

    // Inject consolidation schedule if enabled (Phase 46) — handler-based
    const consolidationConfig = agentConfig.memory?.consolidation ?? {
      enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *",
    };
    if (consolidationConfig.enabled) {
      const memoryStore = manager.getMemoryStore(agentConfig.name);
      const embedder = manager.getEmbedder();
      // Phase 75 SHARED-01 — memoryPath (not workspace) so consolidation
      // writes weekly/monthly digests into the per-agent memory dir.
      const memoryDir = join(agentConfig.memoryPath, "memory");

      handlerSchedules.push({
        name: "memory-consolidation",
        cron: consolidationConfig.schedule ?? "0 3 * * *",
        enabled: true,
        handler: async () => {
          if (!memoryStore) return;
          const deps = {
            memoryDir,
            memoryStore,
            embedder,
            summarize: (prompt: string) => summarizeWithHaiku(prompt, {}),
            // Phase 115 sub-scope 13(b) — agent label threaded into the
            // consolidation run-log so operators can correlate JSONL rows
            // back to the specific agent's consolidation cycle.
            runLabel: agentConfig.name,
          };
          await runConsolidation(deps, consolidationConfig);
        },
      });
    }

    // Only add handler-based schedules to TaskScheduler (those with a handler).
    // User-defined yaml schedules are prompt-based (ScheduleEntryConfig has no
    // `handler` field). The cast covers a future case where dynamically-injected
    // schedules carry a handler at runtime — today this filter is a no-op for
    // config-sourced entries, by design.
    for (const schedule of agentConfig.schedules as readonly ScheduleEntry[]) {
      if (schedule.enabled && schedule.handler) {
        handlerSchedules.push(schedule);
      }
    }

    if (handlerSchedules.length > 0) {
      taskScheduler.addAgent(agentConfig.name, handlerSchedules);
    }
  }
  log.info({ agents: resolvedAgents.filter(a => a.schedules.length > 0 || a.memory?.consolidation?.enabled !== false).length }, "task scheduler initialized (handler-based schedules)");

  // 6-quinquies-a2. Create mysql2 pool for MysqlSource (Phase 61 TRIG-02).
  // Pool is daemon-level — shared across all MysqlSource instances.
  // Created only if mysql trigger sources are configured. Pool size 2 per CONTEXT.md.
  let mysqlPool: Pool | null = null;
  const mysqlConfigs = config.triggers?.sources?.mysql ?? [];
  if (mysqlConfigs.length > 0) {
    const mysqlHost = process.env.MYSQL_HOST;
    const mysqlUser = process.env.MYSQL_USER;
    const mysqlPassword = process.env.MYSQL_PASSWORD;
    const mysqlDatabase = process.env.MYSQL_DATABASE;

    if (mysqlHost && mysqlUser && mysqlDatabase) {
      mysqlPool = createPool({
        host: mysqlHost,
        user: mysqlUser,
        password: mysqlPassword,
        database: mysqlDatabase,
        connectionLimit: 2,
        waitForConnections: true,
        enableKeepAlive: true,
      });
      log.info({ host: mysqlHost, database: mysqlDatabase }, "mysql2 pool created for trigger sources");
    } else {
      log.warn("MySQL trigger sources configured but MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE env vars missing — skipping");
    }
  }

  // 6-quinquies-b. Create TriggerEngine singleton (Phase 60).
  // Depends on: turnDispatcher (6-bis), taskStore (6-ter), taskScheduler (6-quinquies-a).
  // The engine owns all non-Discord turn initiation. SchedulerSource is
  // the first registered source — replaces the direct TurnDispatcher path
  // that TaskScheduler previously used for prompt-based schedules.
  const configuredAgentNames = new Set(resolvedAgents.map(a => a.name));

  // 6-quinquies-b-pre. Boot-time policy load (Phase 62 POL-01).
  // Read .clawcode/policies.yaml BEFORE TriggerEngine construction.
  // Invalid policy = daemon refuses to start. Missing file = empty rules.
  const policyPath = join(homedir(), ".clawcode", "policies.yaml");
  const policyAuditPath = join(MANAGER_DIR, "policy-audit.jsonl");
  let bootEvaluator: PolicyEvaluator | undefined;
  try {
    const policyContent = await readFile(policyPath, "utf-8");
    const compiledRules = loadPolicies(policyContent);
    bootEvaluator = new PolicyEvaluator(compiledRules, configuredAgentNames);
    log.info({ path: policyPath, ruleCount: compiledRules.length }, "policies.yaml loaded at boot");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No policy file — fall through to TriggerEngine's existing default-allow
      // function-form (evaluatePolicy) by leaving bootEvaluator undefined.
      // The engine ternary at engine.ts:130-132 selects evaluatePolicy() when
      // this.evaluator is undefined, which allows any event whose targetAgent
      // is in configuredAgents (Phase 105 POLICY-01..03).
      // PolicyWatcher.onReload still wires reloadEvaluator(real) once the
      // operator drops a policies.yaml at policyPath — back-compat preserved.
      bootEvaluator = undefined;
      log.info(
        { policyPath },
        "no policies.yaml found — using default-allow evaluator: any configured agent can receive events. Drop a policies.yaml at this path to enable rule-based filtering.",
      );
    } else if (err instanceof PolicyValidationError) {
      // Invalid policy — daemon must refuse to start (POL-01)
      throw new ManagerError(
        `FATAL: policies.yaml invalid -- daemon cannot start: ${err.message}`,
      );
    } else {
      throw err;
    }
  }

  // Phase 100 follow-up — deliveryFn for trigger-fired output.
  //
  // The bug: pre-fix, TriggerEngine.ingest() awaited dispatch() and threw
  // away the response string. Scheduled cron output (e.g. fin-acquisition's
  // 15-min status check) was generated by the agent but never reached
  // Discord — it stayed in the conversation history and got dragged into
  // the next user-msg-driven reply, producing wrong-slot attribution.
  //
  // The closure routes the response to the agent's bound Discord channel,
  // preferring the per-agent webhook (so the message wears the agent's
  // identity) and falling back to bot-direct text. References WebhookManager
  // and BotDirectSender via mutable refs because both are constructed AFTER
  // TriggerEngine — by the time any cron tick fires, both refs are populated.
  const triggerDeliveryFn: TriggerDeliveryFn = async (
    targetAgent: string,
    response: string,
  ) => {
    const cfg = manager.getAgentConfig(targetAgent);
    if (!cfg) {
      log.warn(
        { targetAgent },
        "trigger-delivery: unknown agent — skipping",
      );
      return;
    }
    const channelId = cfg.channels?.[0];
    if (!channelId) {
      log.warn(
        { targetAgent },
        "trigger-delivery: agent has no bound channel — skipping",
      );
      return;
    }
    // Discord hard limit is 2000 chars per message. Truncate + ellipsis
    // rather than splitting — scheduled output should be terse anyway, and
    // truncation makes the cap visible to the operator instead of silently
    // posting a multi-message reply that confuses the conversation thread.
    const MAX = 2000;
    const ELLIPSIS = "...";
    const truncated =
      response.length > MAX
        ? response.slice(0, MAX - ELLIPSIS.length) + ELLIPSIS
        : response;

    const wm = webhookManagerRef.current;
    if (wm && wm.hasWebhook(targetAgent)) {
      // Webhook send wears the agent's identity (display name + avatar).
      // WebhookManager.send already handles >2000-char splitting if needed,
      // but we pre-truncate above to keep the post compact and predictable.
      await wm.send(targetAgent, truncated);
      return;
    }
    const bot = botDirectSenderRef.current;
    if (bot) {
      await bot.sendText(channelId, truncated);
      return;
    }
    log.warn(
      { targetAgent, channelId },
      "trigger-delivery: no sender available (no webhook + no bot-direct) — skipping",
    );
  };

  const triggerEngine = new TriggerEngine(
    {
      turnDispatcher,
      taskStore,
      log,
      config: {
        replayMaxAgeMs: config.triggers?.replayMaxAgeMs ?? DEFAULT_REPLAY_MAX_AGE_MS,
        dedupLruSize: DEFAULT_DEDUP_LRU_SIZE,
        defaultDebounceMs: config.triggers?.defaultDebounceMs ?? DEFAULT_DEBOUNCE_MS,
      },
      deliveryFn: triggerDeliveryFn,
    },
    configuredAgentNames,
    bootEvaluator,
  );

  // Register SchedulerSource adapter for prompt-based cron schedules.
  const schedulerSource = new SchedulerSource({
    resolvedAgents,
    sessionManager: manager,
    turnDispatcher,
    ingest: (event) => triggerEngine.ingest(event),
    log,
  });
  triggerEngine.registerSource(schedulerSource);

  // --- Phase 61: Register additional trigger sources (6-quinquies-c) ---

  // TRIG-02: MySQL DB-change sources
  if (mysqlPool) {
    for (const cfg of mysqlConfigs) {
      const mysqlSource = new MysqlSource({
        pool: mysqlPool,
        table: cfg.table,
        idColumn: cfg.idColumn,
        pollIntervalMs: cfg.pollIntervalMs,
        targetAgent: cfg.targetAgent,
        batchSize: cfg.batchSize,
        filter: cfg.filter,
        ingest: (event) => triggerEngine.ingest(event),
        log,
      });
      triggerEngine.registerSource(mysqlSource);
    }
  }

  // TRIG-03: Webhook source (single source, multiple trigger configs)
  const webhookConfigs = config.triggers?.sources?.webhook ?? [];
  let webhookSource: WebhookSource | null = null;
  if (webhookConfigs.length > 0) {
    webhookSource = new WebhookSource({
      configs: webhookConfigs,
      ingest: (event) => triggerEngine.ingest(event),
      log,
    });
    triggerEngine.registerSource(webhookSource);
  }

  // TRIG-04: Inbox sources (one per agent with inbox trigger config)
  const inboxConfigs = config.triggers?.sources?.inbox ?? [];
  for (const cfg of inboxConfigs) {
    const agentConfig = resolvedAgents.find(a => a.name === cfg.targetAgent);
    if (!agentConfig) {
      log.warn({ targetAgent: cfg.targetAgent }, "inbox trigger configured for unknown agent — skipping");
      continue;
    }
    // Phase 75 SHARED-01 — memoryPath (not workspace) so InboxSource
    // watches only this agent's inbox in the shared-workspace case.
    const inboxDir = join(agentConfig.memoryPath, "inbox");
    const inboxSource = new InboxSource({
      agentName: cfg.targetAgent,
      inboxDir,
      stabilityThresholdMs: cfg.stabilityThresholdMs,
      targetAgent: cfg.targetAgent,
      ingest: (event) => triggerEngine.ingest(event),
      log,
    });
    triggerEngine.registerSource(inboxSource);
  }

  // Demote heartbeat inbox check to reconciler mode when InboxSource is primary
  if (inboxConfigs.length > 0) {
    const { setInboxSourceActive } = await import("../heartbeat/checks/inbox.js");
    setInboxSourceActive(true);
    log.info("heartbeat inbox check demoted to reconciler mode (InboxSource is primary)");
  }

  // TRIG-05: Calendar sources
  const calendarConfigs = config.triggers?.sources?.calendar ?? [];
  for (const cfg of calendarConfigs) {
    const mcpServerConfig = config.mcpServers?.[cfg.mcpServer];
    if (!mcpServerConfig) {
      log.warn({ mcpServer: cfg.mcpServer }, "calendar trigger references unknown MCP server — skipping");
      continue;
    }
    const calendarSource = new CalendarSource({
      user: cfg.user,
      targetAgent: cfg.targetAgent,
      calendarId: cfg.calendarId,
      pollIntervalMs: cfg.pollIntervalMs,
      offsetMs: cfg.offsetMs,
      maxResults: cfg.maxResults,
      eventRetentionDays: cfg.eventRetentionDays,
      mcpServer: {
        command: mcpServerConfig.command,
        args: mcpServerConfig.args,
        env: mcpServerConfig.env as Record<string, string> | undefined,
      },
      taskStore,
      ingest: (event) => triggerEngine.ingest(event),
      log,
    });
    triggerEngine.registerSource(calendarSource);
  }

  // Replay missed events from last watermarks (TRIG-06).
  // Runs SYNCHRONOUSLY before agent startAll so missed triggers
  // fire before new cron ticks begin.
  await triggerEngine.replayMissed();

  // Start all trigger sources (fires cron jobs).
  triggerEngine.startAll();

  log.info(
    { sources: triggerEngine.registry.size },
    "TriggerEngine initialized with sources",
  );

  // 6-quinquies-d. Start PolicyWatcher for hot-reload (Phase 62 POL-03).
  // The watcher uses the same policyPath from boot. On valid reload, it
  // swaps the TriggerEngine's evaluator atomically. Invalid reloads are
  // logged and keep the old policy.
  const policyWatcher = new PolicyWatcher({
    policyPath,
    auditPath: policyAuditPath,
    onReload: (newEvaluator, diff) => {
      triggerEngine.reloadEvaluator(newEvaluator);
      log.info(
        { added: diff.added.length, removed: diff.removed.length, modified: diff.modified.length },
        "policy hot-reloaded — TriggerEngine evaluator swapped",
      );
    },
    onError: (error) => {
      log.warn({ error: error.message }, "policy reload failed — keeping previous policy");
    },
    log,
    configuredAgents: configuredAgentNames,
  });
  // start() is safe here — we already validated at boot, so this will NOT
  // throw for invalid content. It re-reads the file and starts chokidar.
  await policyWatcher.start();
  log.info({ policyPath, auditPath: policyAuditPath }, "policy watcher started");

  // 6b. Wire skills catalog into session manager for prompt injection
  manager.setSkillsCatalog(skillsCatalog);

  // Phase 90 MEM-02 — build a lazy MemoryStore proxy. Scanners are
  // constructed at boot but the per-agent MemoryStore doesn't exist until
  // startAgent runs initMemory. The proxy returned here defers every
  // method lookup to the provider function so a scanner event that fires
  // before the store initializes simply no-ops (returns null / {} /
  // empty-string as appropriate).
  const makeLazyMemoryStoreProxy = (
    provider: () => unknown,
  ): MemoryScannerDeps["store"] => {
    return new Proxy({} as never, {
      get(_t, prop: string) {
        const s = provider() as Record<string, unknown> | undefined;
        if (!s) {
          if (prop === "getMemoryFileSha256") return () => null;
          if (prop === "deleteMemoryChunksByPath") return () => 0;
          return () => "";
        }
        return typeof s[prop] === "function" ? (s[prop] as (...a: unknown[]) => unknown).bind(s) : s[prop];
      },
    }) as unknown as MemoryScannerDeps["store"];
  };

  // 6b-bis. Phase 90 MEM-02 — per-agent MemoryScanner DI. Constructs a
  // chokidar watcher on {workspace}/memory/**/*.md for each agent whose
  // resolved config has memoryScannerEnabled=true (the default). The
  // scanner maintains memory_chunks + vec_memory_chunks + memory_chunks_fts
  // + memory_files tables live — both on boot (via backfill) and on
  // subsequent file events.
  //
  // Wire-order: BETWEEN setSkillsCatalog and setAllAgentConfigs so the
  // scanners are ready before reconcileRegistry spins up sessions (which
  // immediately drive warm-path and may invoke memory retrieval). Per-
  // agent MemoryStore instances are initialized inside SessionManager
  // startAgent so the backfill runs lazily on first turn — boot stays
  // fast even when there are thousands of indexed memory files.
  for (const agent of resolvedAgents) {
    if (agent.memoryScannerEnabled === false) continue;
    const workspacePath = agent.workspace;
    if (!workspacePath) continue;
    // Resolve the per-agent MemoryStore lazily — SessionManager.startAgent
    // initializes memory.memoryStores AFTER this loop runs, so a fresh
    // scanner call at boot returns a wrapper that defers the lookup until
    // each chokidar event fires. When the store doesn't exist yet (agent
    // not started), the wrapper no-ops cleanly so early file events don't
    // crash.
    const storeProvider = () =>
      (manager as unknown as {
        memory: { memoryStores: Map<string, unknown> };
      }).memory.memoryStores.get(agent.name);
    const scanner = new MemoryScanner(
      {
        store: makeLazyMemoryStoreProxy(storeProvider),
        embed: (text: string) =>
          (manager as unknown as {
            memory: { embedder: { embed: (t: string) => Promise<Float32Array> } };
          }).memory.embedder.embed(text),
        log: log.child({ scanner: agent.name }),
      },
      workspacePath,
    );
    manager.setMemoryScanner(agent.name, scanner);
    // Fire-and-forget: chokidar watches the directory even if it doesn't
    // exist yet (creates on first event). Scanner start failures are
    // non-fatal — MEM-01 stable-prefix auto-load still carries standing rules.
    void scanner.start().catch((err) => {
      log.warn(
        { agent: agent.name, error: (err as Error).message },
        "memory-scanner start failed (non-fatal)",
      );
    });
  }

  // 6c. Wire agent configs into session manager for admin prompt injection
  manager.setAllAgentConfigs(resolvedAgents);

  // 7. Reconcile registry per D-10
  await manager.reconcileRegistry(resolvedAgents);

  // 8. Initialize heartbeat runner
  // Phase 999.12 HB-01 — thread defaults.heartbeatInboxTimeoutMs into the
  // HeartbeatConfig so the inbox check gets its 60s default instead of the
  // fleet-wide 10s checkTimeoutSeconds (which false-positive-criticals
  // during normal cross-agent turns).
  const heartbeatConfig: HeartbeatConfig = {
    ...config.defaults.heartbeat,
    ...(config.defaults.heartbeatInboxTimeoutMs !== undefined
      ? { inboxTimeoutMs: config.defaults.heartbeatInboxTimeoutMs }
      : {}),
  };
  const heartbeatRunner = new HeartbeatRunner({
    sessionManager: manager,
    registryPath: REGISTRY_PATH,
    config: heartbeatConfig,
    checksDir: join(import.meta.dirname, "../heartbeat/checks"),
    log,
    snapshotCallback: async (agentName: string, zone: ContextZone, fillPercentage: number) => {
      const pct = Math.round(fillPercentage * 100);
      const summaryMessage = `Auto-snapshot at ${pct}% context fill [${zone} zone]`;
      try {
        await manager.saveContextSummary(agentName, summaryMessage);
        log.info({ agent: agentName, zone, fillPercentage }, "zone snapshot saved");
      } catch (err) {
        log.warn({ agent: agentName, error: (err as Error).message }, "zone snapshot save failed");
      }
    },
    notificationCallback: async (agentName: string, transition: ZoneTransition) => {
      const pct = Math.round(transition.fillPercentage * 100);
      log.info(
        { agent: agentName, from: transition.from, to: transition.to, fillPercentage: pct },
        `[Context Health] Agent '${agentName}' zone: ${transition.from} -> ${transition.to} (${pct}%)`,
      );
      // Deliver zone transition alerts to the agent's Discord channel
      const agentConfig = resolvedAgents.find(a => a.name === agentName);
      const channelId = agentConfig?.channels[0];
      if (channelId) {
        const emoji = transition.to === "red" ? "🔴" : transition.to === "yellow" ? "🟡" : "🟢";
        deliveryQueue.enqueue(
          agentName,
          channelId,
          `${emoji} **Context Health** — zone changed: ${transition.from} → ${transition.to} (${pct}% filled)`,
        );
      }
    },
  });
  await heartbeatRunner.initialize();
  heartbeatRunner.setAgentConfigs(resolvedAgents);
  heartbeatRunner.start();
  log.info({ checks: "discovered", interval: heartbeatConfig.intervalSeconds }, "heartbeat started");

  // 8b. (Moved to step 6-quinquies-a — Phase 60)

  // 8c. Create ThreadManager for Discord thread session lifecycle
  const threadManager = new ThreadManager({
    sessionManager: manager,
    routingTable,
    registryPath: THREAD_REGISTRY_PATH,
    log,
  });
  heartbeatRunner.setThreadManager(threadManager);
  heartbeatRunner.setTaskStore(taskStore);
  // Phase 104 plan 03 (SEC-05) — give the heartbeat checks (specifically
  // mcp-reconnect's RecoveryDeps factory) access to the secrets cache so
  // the op-refresh recovery handler can call deps.invalidate(ref) before
  // re-reading via op CLI. Without this hook, opRead — which is wired
  // through SecretsResolver in production — would serve the same stale
  // value that triggered the original auth-error.
  heartbeatRunner.setSecretsResolver(secretsResolver);
  // Phase 108 (POOL-07) — broker-status provider for the mcp-broker
  // heartbeat check. Adapter is intentionally narrow — only
  // getPoolStatus() — to enforce the rate-limit-budget invariant
  // (no synthetic password_read against 1Password).
  heartbeatRunner.setBrokerStatusProvider({
    getPoolStatus: () => broker.getPoolStatus(),
  });
  // Phase 103 OBS-01 — wire HeartbeatRunner into SessionManager so
  // /clawcode-status can read context-zone fillPercentage synchronously.
  manager.setHeartbeatRunner(heartbeatRunner);
  log.info("thread manager initialized");

  // 8d. Build manual webhook identities (from config webhookUrl fields)
  const manualWebhookIdentities = buildWebhookIdentities(resolvedAgents);
  let webhookManager: WebhookManager;
  log.info({ manualWebhooks: manualWebhookIdentities.size }, "manual webhook identities loaded");

  // 8e. Initialize security: approval log, allowlist matchers, security policies
  const approvalLog = new ApprovalLog({
    filePath: join(MANAGER_DIR, "approval-audit.jsonl"),
    log,
  });

  const allowlistMatchers = new Map<string, AllowlistMatcher>();
  for (const agent of resolvedAgents) {
    if (agent.security?.allowlist && agent.security.allowlist.length > 0) {
      const staticPatterns = agent.security.allowlist.map(e => e.pattern);
      const matcher = new AllowlistMatcher(staticPatterns);
      // Load persisted allow-always patterns
      const alwaysPatterns = approvalLog.loadAllowAlways(agent.name);
      for (const p of alwaysPatterns) {
        matcher.addAllowAlways(p);
      }
      allowlistMatchers.set(agent.name, matcher);
    }
  }
  log.info({ agents: allowlistMatchers.size }, "allowlist matchers initialized");

  const securityPolicies = new Map<string, SecurityPolicy>();
  for (const agent of resolvedAgents) {
    try {
      const acls = await parseSecurityMd(join(agent.workspace, "SECURITY.md"));
      if (acls.length > 0) {
        securityPolicies.set(agent.name, {
          allowlist: agent.security?.allowlist ?? [],
          channelAcls: acls,
        });
      }
    } catch {
      // No SECURITY.md or parse error — skip
    }
  }
  log.info({ agents: securityPolicies.size }, "security policies loaded");

  // 9. Await embedding warmup before accepting IPC requests
  await manager.warmupEmbeddings();

  // 9b. Phase 56 Plan 01 — embedder warmup probe. HARD FAIL on error:
  //     memory_lookup without a working embedding pipeline is a broken
  //     surface, not a degraded one (see 56-CONTEXT — Embedding Model
  //     Residency). Refusing to start the IPC server here prevents the
  //     daemon from accepting queries it cannot fulfil.
  try {
    await manager.getEmbedder().embed("warmup probe");
    log.info("embedder probe succeeded");
  } catch (err) {
    const msg = (err as Error).message;
    log.error(
      { error: msg },
      "embedder probe failed — daemon startup HARD FAIL",
    );
    throw new ManagerError(
      `embedder probe failed: ${msg} — daemon cannot start without a working embedding pipeline`,
    );
  }

  // 9c. Phase 70 — browser automation MCP.
  //
  // Instantiate the shared BrowserManager singleton and (when warmOnBoot
  // is true) launch the resident Chromium process + run its built-in
  // health probe. HARD FAIL on probe failure, mirroring the embedder
  // probe above — a broken browser pipeline surfaces immediately rather
  // than degrading the first tool call on a running agent. The install
  // hint is carried through from BrowserManager.warm() so the operator
  // sees the exact npx command to run.
  const browserCfg = config.defaults.browser;
  const browserManager = new BrowserManager({
    headless: browserCfg.headless,
    viewport: browserCfg.viewport,
    userAgent: browserCfg.userAgent,
    log: log.child({ component: "browser" }),
  });
  if (browserCfg.enabled && browserCfg.warmOnBoot) {
    const browserT0 = Date.now();
    try {
      await browserManager.warm();
      log.info(
        { durationMs: Date.now() - browserT0 },
        "browser warm+probe succeeded",
      );
    } catch (err) {
      const browserMsg = (err as Error).message;
      log.error(
        { error: browserMsg },
        "browser warm probe failed — daemon startup HARD FAIL",
      );
      throw new ManagerError(`browser warm probe failed: ${browserMsg}`);
    }
  } else if (!browserCfg.enabled) {
    log.info(
      "browser MCP disabled (defaults.browser.enabled=false); skipping warm",
    );
  } else {
    log.info(
      "browser warmOnBoot=false; Chromium will launch lazily on first tool call",
    );
  }

  // 9d. Phase 71 — Web search MCP clients.
  //
  // Lazy API-key reads inside `.search()` keep daemon boot cheap even when
  // BRAVE_API_KEY / EXA_API_KEY are absent. No warm-path probe needed —
  // HTTP clients are ephemeral; missing keys surface as `invalid_argument`
  // on first tool call, not as daemon-boot crashes.
  //
  // Phase 110 follow-up — yaml-level `defaults.search.brave.apiKey` (and
  // .exa.apiKey) take precedence over process.env[apiKeyEnv] when set.
  // Plain strings pass through verbatim; op:// references are resolved
  // via the boot-time SecretsResolver cache (collectAllOpRefs zone 4).
  // Why: systemd EnvironmentFile=/etc/clawcode/env on prod historically
  // never carried BRAVE_API_KEY, so daemon process.env lookup failed
  // silently and every web_search call returned `invalid_argument:
  // missing Brave API key`. Routing through 1Password matches every
  // other secret in the same yaml.
  const searchCfg = config.defaults.search;
  const searchEnv = buildSearchEnv(searchCfg, secretsResolver);
  const braveClient = createBraveClient(searchCfg, searchEnv);
  const exaClient = createExaClient(searchCfg, searchEnv);
  if (searchCfg.enabled) {
    log.info(
      { backend: searchCfg.backend, maxResults: searchCfg.maxResults },
      "search MCP clients ready (lazy — no boot-time network)",
    );
  } else {
    log.info(
      "search MCP disabled (defaults.search.enabled=false); skipping",
    );
  }

  // 9e. Phase 72 — Image generation MCP clients.
  //
  // Lazy API-key reads inside each provider method keep daemon boot cheap
  // even when OPENAI_API_KEY / MINIMAX_API_KEY / FAL_API_KEY are absent.
  // No warm-path probe needed — HTTP clients are ephemeral; missing keys
  // surface as `invalid_input` on first tool call.
  const imageCfg = config.defaults.image;
  const imageProviders: Record<ImageBackend, ImageProvider> = {
    openai: createOpenAiImageClient(imageCfg),
    minimax: createMiniMaxImageClient(imageCfg),
    fal: createFalImageClient(imageCfg),
  };
  if (imageCfg.enabled) {
    log.info(
      { backend: imageCfg.backend, workspaceSubdir: imageCfg.workspaceSubdir },
      "image MCP clients ready (lazy — no boot-time network)",
    );
  } else {
    log.info(
      "image MCP disabled (defaults.image.enabled=false); skipping",
    );
  }

  // 9f. Phase 115 Plan 07 sub-scope 15 — daemon-side MCP tool-response
  // cache. Folds Phase 999.40 (now SUPERSEDED-BY-115). Singleton store
  // at ~/.clawcode/manager/tool-cache.db; intercepts search/image/
  // search-documents calls below via dispatchTool.
  //
  // When config.defaults.toolCache.enabled === false, we still allocate
  // the store but the wrapper bypasses (saves operators having to wipe
  // the DB to disable caching). Default = enabled, 100MB cap.
  const toolCacheCfg = config.defaults.toolCache;
  const toolCacheEnabled = toolCacheCfg?.enabled ?? true;
  const toolCacheMaxSizeMb = toolCacheCfg?.maxSizeMb ?? 100;
  const toolCachePolicy = toolCacheCfg?.policy ?? {};
  const toolCacheStore = new ToolCacheStore();
  if (toolCacheEnabled) {
    log.info(
      {
        path: toolCacheStore.getPath(),
        maxSizeMb: toolCacheMaxSizeMb,
        policyOverrides: Object.keys(toolCachePolicy).length,
      },
      "tool-cache ready (Phase 115 sub-scope 15)",
    );
  } else {
    log.info(
      "tool-cache disabled (defaults.toolCache.enabled=false); dispatchTool will bypass",
    );
  }

  // Periodic size-metric sampler — logs cache size every 60s to journalctl
  // so operators can grep `tool-cache-size-mb` for trend visibility. The
  // dashboard does NOT read this — it queries `toolCacheStore.sizeMb()`
  // directly via the `case "cache"` IPC intercept (see ~line 3360 below)
  // so the surfaced size is fresh without a heartbeat dependency.
  const toolCacheSizeReporter = setInterval(() => {
    if (!toolCacheEnabled) return;
    try {
      const sizeMb = toolCacheStore.sizeMb();
      log.debug(
        {
          sizeMb: Math.round(sizeMb * 100) / 100,
          action: "tool-cache-size-mb",
        },
        "[diag] tool-cache size metric",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      log.warn(
        { err: msg, action: "tool-cache-size-report-failed" },
        "[diag] tool-cache size sampling failed (non-fatal)",
      );
    }
  }, 60_000);

  // 10. Create IPC handler. Phase 69 intercepts `openai-key-*` methods
  // BEFORE routeMethod so we can delegate to the already-opened ApiKeysStore
  // owned by the OpenAiEndpointHandle below (no double-open, no extra
  // positional arg on routeMethod). openAiEndpointRef is a closure over the
  // `let` declared later in this function so the CLI can reach the store
  // immediately after startOpenAiEndpoint returns.
  //
  // Phase 70 piggybacks on the same closure pattern: `browser-tool-call`
  // is handled BEFORE routeMethod so the new path stays off the existing
  // 24-arg routeMethod signature. handleBrowserToolCall is a pure-ish
  // dispatcher extracted to src/browser/daemon-handler.ts for testability.
  let openAiEndpointRef: OpenAiEndpointHandle | null = null;
  const handler: IpcHandler = async (method, params) => {
    if (
      method === "openai-key-create" ||
      method === "openai-key-list" ||
      method === "openai-key-revoke"
    ) {
      const ep = openAiEndpointRef;
      if (!ep || !ep.enabled || !ep.apiKeysStore) {
        throw new ManagerError(
          "OpenAI endpoint is not active — start the daemon with config.defaults.openai.enabled=true or set CLAWCODE_OPENAI_PORT to a free port",
        );
      }
      const { routeOpenAiKeyIpc } = await import("../openai/ipc-handlers.js");
      return routeOpenAiKeyIpc(
        {
          apiKeysStore: ep.apiKeysStore,
          sessionManager: manager,
          agentNames: () => resolvedAgents.filter((a) => !a.name.includes("-sub-") && !a.name.includes("-thread-")).map((a) => a.name),
        },
        method,
        params,
      );
    }
    if (method === "browser-tool-call") {
      return handleBrowserToolCall(
        { browserManager, resolvedAgents, browserConfig: browserCfg },
        params as unknown as IpcBrowserToolCallParams,
      );
    }
    // Phase 71 — search-tool-call is intercepted BEFORE routeMethod
    // for the same reason as browser-tool-call: the existing 24-arg
    // routeMethod signature stays stable. The daemon-owned BraveClient
    // + ExaClient + fetcher are closed over here.
    //
    // Phase 115 Plan 07 sub-scope 15 — wrap with dispatchTool so repeat
    // queries hit the daemon-side cache. web_search / web_fetch_url use
    // CROSS-AGENT keying (public data shared) per
    // tool-cache-policy.ts:DEFAULT_TOOL_CACHE_POLICY.
    if (method === "search-tool-call") {
      const p = params as unknown as IpcSearchToolCallParams;
      const upstream = () =>
        handleSearchToolCall(
          {
            searchConfig: searchCfg,
            resolvedAgents,
            braveClient,
            exaClient,
            fetcher: fetchUrl,
          },
          p,
        );
      if (!toolCacheEnabled) return upstream();
      return dispatchTool({
        tool: p.toolName,
        args: p.args,
        agentName: p.agent,
        cacheStore: toolCacheStore,
        maxSizeMb: toolCacheMaxSizeMb,
        userPolicy: toolCachePolicy,
        upstream,
        log,
        traceCollector: manager.getTraceCollector(p.agent) ?? undefined,
      });
    }
    // Phase 72 — image-tool-call is intercepted BEFORE routeMethod
    // (same closure pattern as browser-tool-call + search-tool-call).
    // The daemon-owned image provider clients + per-agent UsageTracker
    // lookup are closed over here.
    //
    // Phase 115 Plan 07 sub-scope 15 — image_generate / image_edit /
    // image_variations are NEVER cached (TTL 0 / no-cache strategy in
    // DEFAULT_TOOL_CACHE_POLICY — each call is unique work). dispatchTool
    // bypasses on the no-cache strategy, so wiring the wrapper here is a
    // safety net for any future image tool an operator might add to the
    // policy table.
    if (method === "image-tool-call") {
      const p = params as unknown as IpcImageToolCallParams;
      const upstream = () =>
        handleImageToolCall(
          {
            imageConfig: imageCfg,
            resolvedAgents,
            providers: imageProviders,
            usageTrackerLookup: (agent) => manager.getUsageTracker(agent),
          },
          p,
        );
      if (!toolCacheEnabled) return upstream();
      return dispatchTool({
        tool: p.toolName,
        args: p.args,
        agentName: p.agent,
        cacheStore: toolCacheStore,
        maxSizeMb: toolCacheMaxSizeMb,
        userPolicy: toolCachePolicy,
        upstream,
        log,
        traceCollector: manager.getTraceCollector(p.agent) ?? undefined,
      });
    }
    // Phase 115 Plan 07 sub-scope 15 — search-documents IPC method
    // intercept BEFORE routeMethod so the daemon-side cache wraps the
    // call with PER-AGENT keying (Phase 90 isolation lock — each agent's
    // document corpus is private and stays private when cached).
    //
    // On miss, upstream() dispatches to routeMethod with the full 24-arg
    // signature so the existing case "search-documents" handler body
    // executes unchanged. On hit, the cached response is wrapped in a
    // CacheStamped envelope ({ cached: { age_ms, source }, data }).
    if (method === "search-documents" && toolCacheEnabled) {
      const agentName =
        typeof params.agent === "string" ? params.agent : "";
      // Strip the agent field from the cache-key args — it's the
      // per-agent strategy component (handled by buildCacheKey), not a
      // content discriminator.
      const argsForCache: Record<string, unknown> = { ...params };
      delete argsForCache.agent;
      return dispatchTool({
        tool: "search_documents",
        args: argsForCache,
        agentName,
        cacheStore: toolCacheStore,
        maxSizeMb: toolCacheMaxSizeMb,
        userPolicy: toolCachePolicy,
        upstream: () =>
          routeMethod(
            manager,
            resolvedAgents,
            method,
            params,
            routingTableRef,
            rateLimiter,
            heartbeatRunner,
            taskScheduler,
            skillsCatalog,
            threadManager,
            webhookManager,
            deliveryQueue,
            subagentThreadSpawner,
            allowlistMatchers,
            approvalLog,
            securityPolicies,
            escalationMonitor,
            advisorBudget,
            discordBridgeRef,
            configPath,
            config.defaults.basePath,
            taskManager,
            taskStore,
            schedulerSource,
            botDirectSenderRef,
          ),
        log,
        traceCollector: manager.getTraceCollector(agentName) ?? undefined,
      });
    }
    // Phase 115 Plan 07 sub-scope 15 — tool-cache management IPC handlers
    // (status / clear / inspect). Routed BEFORE routeMethod to keep the
    // signature stable. Returned as plain JSON envelopes.
    if (method === "tool-cache-status") {
      return {
        sizeMb: toolCacheStore.sizeMb(),
        rows: toolCacheStore.rowCount(),
        topTools: toolCacheStore.topToolsByRows(10),
        path: toolCacheStore.getPath(),
        enabled: toolCacheEnabled,
        maxSizeMb: toolCacheMaxSizeMb,
      };
    }
    // Phase 115 Plan 07 T04 — augment the existing `cache` IPC method
    // with live tool_cache_size_mb so the dashboard panel can surface
    // it next to prompt_cache_hit_rate (sub-scope 16(c)). The base
    // method runs in routeMethod; we patch the response post-hoc with
    // the live size signal sourced from ToolCacheStore.sizeMb().
    if (method === "cache") {
      const baseResult = await routeMethod(
        manager,
        resolvedAgents,
        method,
        params,
        routingTableRef,
        rateLimiter,
        heartbeatRunner,
        taskScheduler,
        skillsCatalog,
        threadManager,
        webhookManager,
        deliveryQueue,
        subagentThreadSpawner,
        allowlistMatchers,
        approvalLog,
        securityPolicies,
        escalationMonitor,
        advisorBudget,
        discordBridgeRef,
        configPath,
        config.defaults.basePath,
        taskManager,
        taskStore,
        schedulerSource,
        botDirectSenderRef,
      );
      const liveSizeMb = toolCacheEnabled ? toolCacheStore.sizeMb() : 0;
      // baseResult is either a single augmented report (case "cache" non-all)
      // or an array of reports (case "cache" --all). Either way, fold in the
      // fleet-wide live size signal so the dashboard reads a fresh number
      // even on the very first turn (when per-agent telemetry is still
      // accumulating).
      if (Array.isArray(baseResult)) {
        return baseResult.map((r) =>
          Object.freeze({
            ...(r as Record<string, unknown>),
            tool_cache_size_mb_live: liveSizeMb,
          }),
        );
      }
      return Object.freeze({
        ...(baseResult as Record<string, unknown>),
        tool_cache_size_mb_live: liveSizeMb,
      });
    }
    if (method === "tool-cache-clear") {
      const tool =
        typeof (params as { tool?: unknown }).tool === "string"
          ? ((params as { tool?: string }).tool as string)
          : undefined;
      const cleared = toolCacheStore.clear(tool);
      return { cleared, tool: tool ?? null };
    }
    if (method === "tool-cache-inspect") {
      const tool =
        typeof (params as { tool?: unknown }).tool === "string"
          ? ((params as { tool?: string }).tool as string)
          : undefined;
      const agent =
        typeof (params as { agent?: unknown }).agent === "string"
          ? ((params as { agent?: string }).agent as string)
          : undefined;
      const limit =
        typeof (params as { limit?: unknown }).limit === "number"
          ? Math.min(
              Math.max((params as { limit?: number }).limit ?? 100, 1),
              500,
            )
          : 100;
      const rows = toolCacheStore.inspect({ tool, agent, limit });
      return { rows, count: rows.length };
    }
    // Phase 88 Plan 02 MKT-01..07 — marketplace IPC is intercepted BEFORE
    // routeMethod (same closure pattern as browser/search/image-tool-call)
    // so the existing routeMethod signature stays stable. The three
    // handlers close over the daemon-local marketplace deps
    // (skillsPath + resolvedMarketplaceSources + ledgerPath + log).
    if (
      method === "marketplace-list" ||
      method === "marketplace-install" ||
      method === "marketplace-remove"
    ) {
      const deps = {
        configs: resolvedAgents as ResolvedAgentConfig[],
        configPath,
        marketplaceSources: resolvedMarketplaceSources,
        localSkillsPath: skillsPath,
        skillsTargetDir: skillsPath,
        ledgerPath,
        log,
        // Phase 93 Plan 02 D-93-02-2 — auto-inject the public ClawHub default
        // when the operator hasn't configured an explicit clawhub source.
        defaultClawhubBaseUrl: config.defaults.clawhubBaseUrl,
        params,
      };
      if (method === "marketplace-list") {
        return handleMarketplaceListIpc(deps);
      }
      if (method === "marketplace-install") {
        return handleMarketplaceInstallIpc(deps);
      }
      return handleMarketplaceRemoveIpc(deps);
    }
    // skill-create — agent-initiated skill authoring via daemon IPC.
    // Writes SKILL.md to skillsPath, rescans catalog, re-links agent workspace,
    // and persists the skill name to the agent's YAML config. Exists because
    // agent processes cannot write to skillsPath directly (tool ACL restriction).
    if (method === "skill-create") {
      const agentName = validateStringParam(params, "agent");
      const skillName = validateStringParam(params, "name");
      const content = validateStringParam(params, "content");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) {
        throw new ManagerError(
          `Invalid skill name '${skillName}' — must match [a-z0-9][a-z0-9-]*`,
        );
      }
      const agentIdx = (resolvedAgents as ResolvedAgentConfig[]).findIndex(
        (a) => a.name === agentName,
      );
      if (agentIdx === -1) {
        throw new ManagerError(`Agent '${agentName}' not found in config`);
      }
      const skillDir = join(skillsPath, skillName);
      const skillFile = join(skillDir, "SKILL.md");
      await mkdir(skillDir, { recursive: true });
      await writeFile(skillFile, content, "utf-8");
      const freshCatalog = await scanSkillsDirectory(skillsPath, log);
      const agentCfg = (resolvedAgents as ResolvedAgentConfig[])[agentIdx]!;
      const alreadyAssigned = agentCfg.skills.includes(skillName);
      const updatedSkills = alreadyAssigned
        ? agentCfg.skills
        : [...agentCfg.skills, skillName];
      if (!alreadyAssigned) {
        (resolvedAgents as ResolvedAgentConfig[])[agentIdx] = Object.freeze({
          ...agentCfg,
          skills: updatedSkills,
        });
        try {
          await updateAgentSkills({
            existingConfigPath: configPath,
            agentName,
            skillName,
            op: "add",
          });
        } catch (err) {
          log.warn(
            { agent: agentName, skill: skillName, error: (err as Error).message },
            "skill-create: YAML persist failed — skill linked in-memory only",
          );
        }
      }
      await linkAgentSkills(
        join((resolvedAgents as ResolvedAgentConfig[])[agentIdx]!.workspace, "skills"),
        updatedSkills,
        freshCatalog,
        log,
      );
      log.info({ agent: agentName, skill: skillName, path: skillFile }, "skill created");
      return Object.freeze({ created: true, skill: skillName, path: skillFile });
    }
    // Phase 90 Plan 05 HUB-02 / HUB-04 — ClawHub plugin list + install IPC.
    // Closure-based intercept parallel to the skill marketplace handlers
    // above. Writes to agents[*].mcpServers via updateAgentMcpServers.
    if (
      method === "marketplace-list-plugins" ||
      method === "marketplace-install-plugin"
    ) {
      const pluginDeps = {
        configs: resolvedAgents as ResolvedAgentConfig[],
        configPath,
        clawhubBaseUrl: config.defaults.clawhubBaseUrl,
        // Phase 90 Plan 06 wires GitHub OAuth token here; until then the
        // daemon relies on ClawHub's public/unauthenticated surface.
        clawhubAuthToken: undefined,
        cache: clawhubPluginsCache,
        log,
        params,
      };
      if (method === "marketplace-list-plugins") {
        return handleMarketplaceListPluginsIpc(pluginDeps);
      }
      return handleMarketplaceInstallPluginIpc(pluginDeps);
    }
    // Phase 90 Plan 06 HUB-05 / HUB-07 — install-time config UX.
    // Three pure handlers: OAuth start/poll (long-lived — the poll request
    // may block for up to 15min) + 1Password rewrite probe per sensitive
    // field. Routed BEFORE routeMethod per the closure-intercept pattern.
    if (method === "clawhub-oauth-start") {
      return handleClawhubOauthStartIpc({ log }, params);
    }
    if (method === "clawhub-oauth-poll") {
      return handleClawhubOauthPollIpc({ log }, params);
    }
    if (method === "marketplace-probe-op-items") {
      return handleMarketplaceProbeOpItemsIpc({ log }, params);
    }
    // Phase 95 Plan 03 DREAM-07 — run-dream-pass IPC.
    // Operator-driven manual dream-pass trigger backing both
    // `clawcode dream <agent>` (CLI) and `/clawcode-dream` (Discord slash,
    // admin-only). Closure-based intercept BEFORE routeMethod so the IPC
    // handler signature stays stable. The daemon edge wires the four
    // primitives (runDreamPass / applyDreamResult / isAgentIdle /
    // getResolvedDreamConfig) to real production sources here; Plans
    // 95-01 + 95-02 own the pure-DI logic.
    // Phase 96 Plan 05 PFS- — probe-fs + list-fs-status IPC handlers.
    // Operator-driven on-demand filesystem-capability re-probe + cached
    // snapshot read. Backs both `clawcode probe-fs <agent>` (CLI) and
    // `/clawcode-probe-fs` (Discord slash, admin-only) — Discord/CLI parity
    // invariant per RESEARCH.md Validation Architecture Dim 6. Closure-based
    // intercept BEFORE routeMethod so the IPC handler signature stays stable.
    // The daemon edge wires production deps (node:fs/promises.access /
    // realpath / writeFile / rename / mkdir + os.homedir for the
    // fs-capability.json path); Plan 96-01 owns the pure-DI runFsProbe +
    // writeFsSnapshot primitives (NEVER re-implemented here — pinned by
    // static-grep `grep -q "runFsProbe" src/manager/daemon.ts`).
    if (method === "probe-fs") {
      const { handleProbeFsIpc } = await import("./daemon-fs-ipc.js");
      const {
        access: fsAccessFn,
        realpath: fsRealpathFn,
        writeFile: fsWriteFileFn,
        rename: fsRenameFn,
        mkdir: fsMkdirFn,
        readFile: fsReadFileFn,
        constants: fsConstants,
      } = await import("node:fs/promises").then((m) => ({
        access: m.access,
        realpath: m.realpath,
        writeFile: m.writeFile,
        rename: m.rename,
        mkdir: m.mkdir,
        readFile: m.readFile,
        constants: m.constants,
      }));
      const { resolve: pathResolveFn } = await import("node:path");
      const { writeFsSnapshot } = await import("./fs-snapshot-store.js");
      const { resolveFileAccess } = await import("../config/loader.js");
      return handleProbeFsIpc(
        { agent: validateStringParam(params, "agent") },
        {
          resolveFileAccessForAgent: (agent) => {
            const cfg = manager.getAgentConfig(agent) ?? resolvedAgents.find((a) => a.name === agent);
            return resolveFileAccess(
              agent,
              cfg as unknown as { readonly fileAccess?: readonly string[] },
              config.defaults as unknown as { readonly fileAccess?: readonly string[] },
            );
          },
          getHandleAccessors: (agent) => {
            const handle = manager.getSessionHandle(agent);
            if (!handle) return null;
            return {
              getFsCapabilitySnapshot: () => handle.getFsCapabilitySnapshot(),
              setFsCapabilitySnapshot: (next) => handle.setFsCapabilitySnapshot(next),
            };
          },
          fsAccess: fsAccessFn,
          fsConstants,
          realpath: fsRealpathFn,
          resolve: pathResolveFn,
          writeFsSnapshot: (agent, snapshot, filePath) =>
            writeFsSnapshot(agent, snapshot, filePath, {
              writeFile: (p, data, enc) => fsWriteFileFn(p, data, enc),
              rename: fsRenameFn,
              // node:fs/promises.mkdir returns Promise<string | undefined>;
              // wrap to match our deps Promise<void> signature.
              mkdir: async (p, options) => {
                await fsMkdirFn(p, options);
              },
              readFile: (p, enc) => fsReadFileFn(p, enc),
              log,
            }),
          getFsCapabilityPath: (agent) =>
            join(homedir(), ".clawcode", "agents", agent, "fs-capability.json"),
          now: () => new Date(),
          log,
        },
      );
    }
    if (method === "list-fs-status") {
      const { handleListFsStatusIpc } = await import("./daemon-fs-ipc.js");
      return handleListFsStatusIpc(
        { agent: validateStringParam(params, "agent") },
        {
          getHandleAccessors: (agent) => {
            const handle = manager.getSessionHandle(agent);
            if (!handle) return null;
            return {
              getFsCapabilitySnapshot: () => handle.getFsCapabilitySnapshot(),
              setFsCapabilitySnapshot: (next) => handle.setFsCapabilitySnapshot(next),
            };
          },
        },
      );
    }
    if (method === "run-dream-pass") {
      const { runDreamPass: runDreamPassPrim } = await import(
        "./dream-pass.js"
      );
      const { applyDreamResult: applyDreamResultPrim } = await import(
        "./dream-auto-apply.js"
      );
      const { writeDreamLog } = await import("./dream-log-writer.js");
      const { isAgentIdle } = await import("./idle-window-detector.js");

      const req: RunDreamPassRequest = {
        agent: validateStringParam(params, "agent"),
        modelOverride:
          typeof params.modelOverride === "string"
            ? (params.modelOverride as "haiku" | "sonnet" | "opus")
            : undefined,
        idleBypass:
          typeof params.idleBypass === "boolean"
            ? (params.idleBypass as boolean)
            : false,
        force:
          typeof params.force === "boolean"
            ? (params.force as boolean)
            : false,
      };

      const dreamIpcDeps: RunDreamPassIpcDeps = {
        knownAgents: () => resolvedAgents.map((a) => a.name),
        now: () => new Date(),
        log,
        // Plan 95-01 — resolve dream config from agent's config block,
        // falling back to defaults.dream resolved at config load time.
        // Defaults: enabled=false (opt-in), idleMinutes=30, model='haiku'.
        getResolvedDreamConfig: (agent: string) => {
          const cfg = resolvedAgents.find((a) => a.name === agent);
          if (!cfg) return null;
          // Phase 95 dream config lives at agentSchema.dream (optional)
          // with defaults applied at the loader's defaults.dream resolver.
          // ResolvedAgentConfig may not surface it directly; treat absence
          // as fleet-default (enabled=false, 30min, haiku). Force flag at
          // the IPC handler overrides enabled=false at the operator's risk.
          // Phase 100 follow-up — ResolvedAgentConfig now carries `dream`
          // directly (resolver merges agent.dream ?? defaults.dream).
          // The `as unknown as ...` cast is gone; clean property access.
          const dreamCfg = cfg.dream;
          return {
            enabled: dreamCfg?.enabled ?? false,
            idleMinutes: dreamCfg?.idleMinutes ?? 30,
            model: dreamCfg?.model ?? "haiku",
          };
        },
        // Plan 95-01 — isAgentIdle gate. Without a production lastTurnAt
        // tracker (deferred to a future plan), default to "no-prior-turn"
        // which the detector classifies as idle=false. Operators typically
        // pass --idle-bypass for manual triggers (CLI default false; the
        // Discord slash sets it true). The handler's idleBypass branch
        // honours the operator intent without requiring a lastTurnAt feed.
        isAgentIdle: (agent: string) => {
          // Best-effort: if SessionManager exposes a lastTurnAt accessor,
          // use it. Otherwise null → 'no-prior-turn' (idle=false).
          const sessLastTurnAt = (
            manager as unknown as {
              getLastTurnAt?: (a: string) => Date | null;
            }
          ).getLastTurnAt?.(agent) ?? null;
          const cfg = resolvedAgents.find((a) => a.name === agent);
          // Phase 100 follow-up — direct property access (see above).
          const idleMinutes = cfg?.dream?.idleMinutes ?? 30;
          return isAgentIdle({
            lastTurnAt: sessLastTurnAt,
            idleMinutes,
            now: () => new Date(),
          });
        },
        // Plan 95-01 — runDreamPass adapter. Production wiring uses the
        // agent's MemoryStore + ConversationStore via SessionManager. The
        // dispatch closure wraps TurnDispatcher.dispatch; if the agent has
        // no live session, we fall back to a synthetic 'failed' outcome
        // surfaced cleanly to the operator (no daemon crash).
        runDreamPass: async (agent: string, model: string) => {
          const memoryStore = manager.getMemoryStore(agent);
          const conversationStore = manager.getConversationStore(agent);
          const cfg = resolvedAgents.find((a) => a.name === agent);
          const memoryRoot = cfg?.memoryPath ?? cfg?.workspace ?? "";

          // Adapter shapes for the dream-pass primitive — narrow surface
          // so the primitive stays decoupled from production store APIs.
          // Empty-getter fallback when stores aren't open yet (agent not
          // running) — surfaces as a low-signal dream pass rather than an
          // exception that crashes the operator's manual trigger.
          const dreamMemoryStore = {
            getRecentChunks: async (_agent: string, limit: number) => {
              if (!memoryStore) return [];
              try {
                return memoryStore.listRecentMemoryChunks(limit);
              } catch (err) {
                log.warn(
                  {
                    component: "dream-pass",
                    action: "list-chunks-failed",
                    agent,
                    err: err instanceof Error ? err.message : String(err),
                  },
                  "dream-pass: listRecentMemoryChunks failed; treating as empty",
                );
                return [];
              }
            },
          };
          const dreamConvStore = {
            getRecentSummaries: async (_agent: string, limit: number) => {
              if (!conversationStore || !memoryStore) return [];
              try {
                const sessions =
                  conversationStore.listRecentTerminatedSessions(agent, limit);
                return sessions
                  .map((s) => {
                    if (!s.summaryMemoryId) return null;
                    const mem = memoryStore.getById(s.summaryMemoryId);
                    if (!mem || mem.content.trim().length === 0) return null;
                    const endedIso = s.endedAt ?? s.startedAt;
                    return {
                      sessionId: s.id,
                      summary: mem.content,
                      endedAt: new Date(endedIso),
                    };
                  })
                  .filter((x): x is NonNullable<typeof x> => x !== null);
              } catch (err) {
                log.warn(
                  {
                    component: "dream-pass",
                    action: "list-summaries-failed",
                    agent,
                    err: err instanceof Error ? err.message : String(err),
                  },
                  "dream-pass: listRecentTerminatedSessions failed; treating as empty",
                );
                return [];
              }
            },
          };
          const dreamDispatch = async (dispatchReq: {
            model: string;
            systemPrompt: string;
            userPrompt: string;
            maxOutputTokens: number;
          }) => {
            // Phase 999.39 — direct OAuth path via callHaikuDirect.
            // dream-pass is a one-shot LLM call (no session context, no tools).
            // Previously routed through turnDispatcher.dispatch → sdk.query() →
            // ANTHROPIC_API_KEY (wrong auth on subscription-only deployments).
            // dispatchReq.model is "haiku" by default (dream config default);
            // model override is a future follow-up.
            try {
              const text = await callHaikuDirect(
                dispatchReq.systemPrompt,
                dispatchReq.userPrompt,
                {},
              );
              // Token counts unavailable from direct call; approximate via
              // chars/4 heuristic (consistent with dream-prompt-builder's budget).
              const inApprox = Math.ceil(
                (dispatchReq.systemPrompt.length +
                  dispatchReq.userPrompt.length) /
                  4,
              );
              const outApprox = Math.ceil(text.length / 4);
              return {
                rawText: text,
                tokensIn: inApprox,
                tokensOut: outApprox,
              };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              throw new Error(`dream-dispatch-failed: ${msg}`);
            }
          };

          return runDreamPassPrim(agent, {
            memoryStore: dreamMemoryStore,
            conversationStore: dreamConvStore,
            readFile: async (p: string) => {
              try {
                return await readFile(p, "utf8");
              } catch {
                return "";
              }
            },
            dispatch: dreamDispatch,
            resolvedDreamConfig: {
              enabled: true, // gate already passed at handler layer
              idleMinutes: 30,
              model,
            },
            memoryRoot,
            now: () => new Date(),
            log,
          });
        },
        // applyDreamResult adapter. applyAutoLinks persists the LLM-proposed
        // path→path edges into <memoryRoot>/graph-edges.json (read back on
        // the next dream pass for "existing wikilinks" context). Dream-log
        // emission via writeDreamLog IS wired (D-05 atomic markdown).
        applyDreamResult: async (agent, outcome) => {
          const cfg = resolvedAgents.find((a) => a.name === agent);
          const memoryRoot = cfg?.memoryPath ?? cfg?.workspace ?? "";
          const { appendDreamWikilinks } = await import(
            "./dream-graph-edges.js"
          );
          return applyDreamResultPrim(agent, outcome, {
            applyAutoLinks: async (_agent, links) => {
              if (!memoryRoot) return { added: 0 };
              return appendDreamWikilinks({
                memoryRoot,
                links,
                now: () => new Date(),
              });
            },
            // Phase 99 dream hotfix (2026-04-26): pass writeDreamLog directly.
            // dream-auto-apply calls deps.writeDreamLog({agentName, memoryRoot, entry}),
            // not just entry — the previous wrapper signature `(entry) => …` caused
            // the entry-shape to be the OUTER object so entry.timestamp was undefined.
            writeDreamLog,
            memoryRoot,
            now: () => new Date(),
            log,
          });
        },
      };

      try {
        return await handleRunDreamPassIpc(req, dreamIpcDeps);
      } catch (err) {
        if (err instanceof ManagerError) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new ManagerError(`run-dream-pass: ${msg}`);
      }
    }
    // Phase 92 Plan 04 CUT-06 / CUT-07 — cutover-button-action IPC.
    // Closure-based intercept BEFORE routeMethod (mirrors marketplace +
    // browser-tool-call patterns above) so the existing routeMethod
    // signature stays stable. Plan 92-06 will wire cutover-verify-summary;
    // for Plan 92-04 the button-action handler is the only IPC method.
    if (method === "cutover-button-action") {
      // Lazy import of the cutover ledger module's default path so we
      // don't pay the import cost on every IPC tick. The ledger path
      // is overridable via params for tests + per-agent customization.
      const { DEFAULT_CUTOVER_LEDGER_PATH } = await import(
        "../cutover/ledger.js"
      );
      const targetAgent =
        typeof params.agent === "string"
          ? (params.agent as string)
          : "fin-acquisition";
      const targetAgentConfig = resolvedAgents.find(
        (a) => a.name === targetAgent,
      );
      const memoryRoot =
        targetAgentConfig?.memoryPath ?? targetAgentConfig?.workspace ?? "";
      const cutoverDeps = {
        applierDeps: {
          agent: targetAgent,
          clawcodeYamlPath: configPath,
          memoryRoot,
          openClawHost:
            typeof params.openClawHost === "string"
              ? (params.openClawHost as string)
              : "",
          openClawWorkspace:
            typeof params.openClawWorkspace === "string"
              ? (params.openClawWorkspace as string)
              : "",
          ledgerPath:
            typeof params.ledgerPath === "string"
              ? (params.ledgerPath as string)
              : DEFAULT_CUTOVER_LEDGER_PATH,
          // Production wires Phase 91 rsync runner here; first-pass returns
          // a non-zero exit so a stray Accept on outdated-memory-file fails
          // safely in audit-log mode rather than performing an unconfigured
          // rsync. Plan 92-06 will inject the real runner.
          runRsync: async () => ({
            stdout: "",
            stderr: "rsync runner not wired in Plan 92-04 first pass",
            exitCode: 1,
          }),
          log,
        },
        // First-pass gap resolver: returns null until Plan 92-06 wires the
        // CUTOVER-GAPS.json reader. The handler treats null as
        // "invalid-customId" — safe default that surfaces an audit hint.
        gapById: async () => null,
        log,
      };
      return handleCutoverButtonActionIpc(params, cutoverDeps);
    }
    // Phase 92 GAP CLOSURE — `cutover-verify` IPC.
    //
    // Builds VerifyPipelineDeps lazily so the per-call agent / output-dir
    // / staging-dir overrides flow through to the pipeline without
    // mutating daemon-scoped singletons. The handler dispatches into
    // runVerifyPipeline + writeCutoverReport — same flow that runs from
    // the operator CLI; same DI surface that's covered by 6 verify-pipeline
    // tests.
    //
    // Production primitives wired:
    //   - profiler dispatcher: turnDispatcher.dispatch (clawdy LLM pass)
    //   - canary dispatchStream: turnDispatcher.dispatchStream
    //   - canary fetchApi: native fetch against http://localhost:3101
    //   - probe loadConfig: loadConfig() + resolveAllAgents
    //   - probe listMcpStatus: manager.getMcpStateForAgent
    //   - probe readWorkspaceInventory: filesystem walk over memoryRoot
    //   - additive applier: scanSkillSecrets + updateAgentSkills/Config +
    //                       runRsync via execFile
    //   - report writer: writeCutoverReport (atomic temp+rename)
    //
    // Discord fetchMessages: stubbed to return empty pages — the SDK MCP
    // tool wiring is daemon-internal only via per-agent Claude Code child
    // processes and is out of scope for this gap closure. The MC ingestor
    // is the PRIMARY corpus per D-11; verify can run end-to-end without
    // Discord.
    if (method === "cutover-verify") {
      const { writeCutoverReport } = await import(
        "../cutover/report-writer.js"
      );
      const { ingestDiscordHistory } = await import(
        "../cutover/discord-ingestor.js"
      );
      const { runSourceProfiler } = await import(
        "../cutover/source-profiler.js"
      );
      const { probeTargetCapability } = await import(
        "../cutover/target-probe.js"
      );
      const { diffAgentVsTarget } = await import("../cutover/diff-engine.js");
      const { applyAdditiveFixes } = await import(
        "../cutover/additive-applier.js"
      );
      const { synthesizeCanaryPrompts } = await import(
        "../cutover/canary-synthesizer.js"
      );
      const { runCanary } = await import("../cutover/canary-runner.js");
      const {
        CANARY_API_ENDPOINT,
        CANARY_CHANNEL_ID,
        CANARY_TIMEOUT_MS,
      } = await import("../cutover/types.js");
      const yamlWriter = await import("../migration/yaml-writer.js");
      const { scanSkillSecrets } = await import(
        "../migration/skills-secret-scan.js"
      );
      const skillsTransformer = await import(
        "../migration/skills-transformer.js"
      );
      const { execFile } = await import("node:child_process");
      const { join: joinPath } = await import("node:path");
      const { homedir: homedirFn } = await import("node:os");

      const verifyHandlerDeps = {
        log,
        buildPipelineDeps: async (resolved: {
          agent: string;
          applyAdditive: boolean;
          outputDir: string | undefined;
          stagingDir: string | undefined;
          depthMsgs: number | undefined;
          depthDays: number | undefined;
        }) => {
          const home = homedirFn();
          const stagingDir =
            resolved.stagingDir ??
            joinPath(home, ".clawcode", "manager", "cutover-staging", resolved.agent);
          const outputDir =
            resolved.outputDir ??
            joinPath(home, ".clawcode", "manager", "cutover-reports", resolved.agent);
          const targetAgentConfig = resolvedAgents.find(
            (a) => a.name === resolved.agent,
          );
          const memoryRoot =
            targetAgentConfig?.memoryPath ??
            targetAgentConfig?.workspace ??
            joinPath(home, ".clawcode", "agents", resolved.agent);

          // Discord fetchMessages — stubbed (see comment above).
          const fetchMessagesStub = async () =>
            ({ messages: [], hasMore: false }) as const;

          // Profiler dispatcher — wraps turnDispatcher.dispatch as
          // ProfilerDispatchFn. Signature: (origin, agentName, message, opts?)
          // → Promise<string>. The profiler agent is "clawdy" by default.
          const profilerDispatch = async (
            origin: unknown,
            agentName: string,
            message: string,
          ): Promise<string> => {
            return await turnDispatcher.dispatch(
              origin as never,
              agentName,
              message,
            );
          };

          // Canary dispatchStream — wraps turnDispatcher.dispatchStream so
          // CanaryDispatchStreamFn ({agentName, prompt, origin}) →
          // Promise<{text}> resolves with the final accumulated text.
          const canaryDispatchStream = async (args: {
            agentName: string;
            prompt: string;
            origin: unknown;
          }): Promise<{ text: string }> => {
            const text = await turnDispatcher.dispatchStream(
              args.origin as never,
              args.agentName,
              args.prompt,
              () => {
                /* accumulator chunks not needed by canary — final text is the return value */
              },
            );
            return { text };
          };

          // Canary fetchApi — native fetch against the OpenAI-compat endpoint.
          const canaryFetchApi = async (
            url: string,
            body: unknown,
          ): Promise<{ status: number; text: string; json: unknown }> => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            const rawText = await res.text();
            let json: unknown;
            try {
              json = JSON.parse(rawText);
            } catch {
              /* keep rawText only */
            }
            const responseText =
              (
                json as {
                  choices?: { message?: { content?: string } }[];
                } | undefined
              )?.choices?.[0]?.message?.content ?? rawText;
            return { status: res.status, text: responseText, json };
          };

          // Yaml writer adapters (mirror cutover-apply-additive.ts).
          const updateAgentSkillsAdapter = async (
            agent: string,
            nextSkills: readonly string[],
            opts: { clawcodeYamlPath: string },
          ) => {
            let lastResult: { outcome: string; reason?: string } = {
              outcome: "no-op",
            };
            for (const skill of nextSkills) {
              const r = await yamlWriter.updateAgentSkills({
                existingConfigPath: opts.clawcodeYamlPath,
                agentName: agent,
                skillName: skill,
                op: "add",
              });
              lastResult = r;
              if (r.outcome === "not-found" || r.outcome === "file-not-found") {
                break;
              }
            }
            return mapYamlOutcome(lastResult.outcome, lastResult.reason);
          };
          const updateAgentConfigAdapter = async (
            agent: string,
            patch: Readonly<Record<string, unknown>>,
            opts: { clawcodeYamlPath: string },
          ) => {
            const r = await yamlWriter.updateAgentConfig({
              existingConfigPath: opts.clawcodeYamlPath,
              agentName: agent,
              patch,
            });
            return mapYamlOutcome(
              r.outcome,
              "reason" in r ? r.reason : undefined,
            );
          };
          const scanSkillForSecretsAdapter = async (skillDir: string) => {
            const result = await scanSkillSecrets(skillDir);
            if (result.pass) return { refused: false };
            return {
              refused: true,
              reason: result.offender?.reason ?? "secret detected",
            };
          };
          const normalizeSkillFrontmatterAdapter = async (
            skillDir: string,
          ): Promise<void> => {
            const skillMdPath = joinPath(skillDir, "SKILL.md");
            const { existsSync } = await import("node:fs");
            if (!existsSync(skillMdPath)) return;
            const { readFile: rf, writeFile: wf } = await import(
              "node:fs/promises"
            );
            const content = await rf(skillMdPath, "utf8");
            const skillName = skillDir.split("/").filter(Boolean).pop() ?? "skill";
            const next = skillsTransformer.normalizeSkillFrontmatter(
              content,
              skillName,
            );
            if (next !== content) await wf(skillMdPath, next, "utf8");
          };

          const runRsyncAdapter = async (rsyncArgs: readonly string[]) => {
            return await new Promise<{
              stdout: string;
              stderr: string;
              exitCode: number;
            }>((resolve) => {
              const child = execFile(
                "rsync",
                rsyncArgs as string[],
                { maxBuffer: 16 * 1024 * 1024 },
                (err, stdout, stderr) => {
                  const exitCode =
                    err && typeof (err as NodeJS.ErrnoException).code === "number"
                      ? ((err as NodeJS.ErrnoException).code as unknown as number)
                      : err
                        ? 1
                        : 0;
                  resolve({
                    stdout: stdout?.toString() ?? "",
                    stderr: stderr?.toString() ?? "",
                    exitCode,
                  });
                },
              );
              child.on("error", () => {
                /* callback handles the error path */
              });
            });
          };

          // Probe loadConfig — re-reads the daemon's clawcode.yaml.
          const probeLoadConfig = async () => {
            const cfg = await loadConfig(configPath);
            return cfg;
          };

          const probeListMcpStatus = async (agentName: string) => {
            const state = manager.getMcpStateForAgent(agentName);
            return [...state.values()].map((s) => ({
              name: s.name,
              status: s.status,
              lastSuccessAt: s.lastSuccessAt,
              lastFailureAt: s.lastFailureAt,
              failureCount: s.failureCount,
              optional: s.optional,
              lastError: s.lastError?.message ?? null,
            }));
          };

          const probeReadWorkspaceInventory = async (
            _agentName: string,
            mr: string,
          ) => {
            // Minimal first-pass: empty inventory. The full filesystem walk
            // (Phase 92 Plan 02 defaultReadWorkspaceInventory) is wired by
            // the CLI scaffold; for daemon-IPC verify we accept an empty
            // inventory which means everything looks like a "missing" gap.
            // This is the SAFE default — operators see ALL gaps and decide.
            const { existsSync: _exists, readdirSync: _readdir } = await import(
              "node:fs"
            );
            void _exists;
            void _readdir;
            void mr;
            return {
              memoryFiles: [],
              memoryMdSha256: null,
              uploads: [],
              skillsInstalled: [],
            };
          };

          return {
            agent: resolved.agent,
            applyAdditive: resolved.applyAdditive,
            // First pass: skip canary unless operator explicitly opts in
            // (canary requires a live agent + working Discord channel).
            // Operators will re-run with --apply-additive to address gaps;
            // a real cutover_ready=true requires canary, gated by Plan 92-05.
            runCanaryOnReady: false,
            outputDir,
            stagingDir,
            ingestDiscordHistory,
            runSourceProfiler,
            probeTargetCapability,
            diffAgentVsTarget,
            applyAdditiveFixes,
            synthesizeCanaryPrompts,
            runCanary,
            writeCutoverReport,
            ingestDeps: {
              channels: targetAgentConfig?.channels ?? [],
              stagingDir,
              fetchMessages: fetchMessagesStub,
              log,
            },
            profileDeps: {
              historyJsonlPaths: [
                joinPath(stagingDir, "mc-history.jsonl"),
                joinPath(stagingDir, "discord-history.jsonl"),
              ],
              outputDir: joinPath(outputDir, "latest"),
              dispatcher: { dispatch: profilerDispatch },
              log,
            },
            probeDeps: {
              outputDir: joinPath(outputDir, "latest"),
              loadConfig: probeLoadConfig,
              listMcpStatus: probeListMcpStatus,
              readWorkspaceInventory: probeReadWorkspaceInventory,
              log,
            },
            applierDeps: {
              clawcodeYamlPath: configPath,
              skillsTargetDir: joinPath(home, ".clawcode", "skills"),
              memoryRoot,
              uploadsTargetDir: joinPath(memoryRoot, "uploads", "discord"),
              openClawHost: "jjagpal@100.71.14.96",
              openClawWorkspace: "/home/jjagpal/.openclaw/workspace-finmentum",
              openClawSkillsRoot: "/home/jjagpal/.openclaw/skills",
              ledgerPath: joinPath(
                home,
                ".clawcode",
                "manager",
                "cutover-ledger.jsonl",
              ),
              updateAgentSkills: updateAgentSkillsAdapter,
              updateAgentConfig: updateAgentConfigAdapter,
              scanSkillForSecrets: scanSkillForSecretsAdapter,
              normalizeSkillFrontmatter: normalizeSkillFrontmatterAdapter,
              runRsync: runRsyncAdapter,
              log,
            },
            canaryDeps: {
              canaryChannelId: CANARY_CHANNEL_ID,
              apiEndpoint: CANARY_API_ENDPOINT,
              timeoutMs: CANARY_TIMEOUT_MS,
              outputDir: joinPath(outputDir, "latest"),
              dispatchStream: canaryDispatchStream as never,
              fetchApi: canaryFetchApi,
              log,
            },
            synthesizerDeps: {
              dispatcher: { dispatch: profilerDispatch },
              log,
            },
            log,
          };
        },
      };
      // Cast through `unknown` to decouple from the structural-equivalence
      // mismatch TS reports between the daemon's locally-inferred
      // VerifyPipelineDeps shape and the one imported by handleCutoverVerifyIpc.
      // The shapes ARE identical at runtime (same types.ts → same primitives);
      // the duplicate-type complaint is a TS module-graph artifact only.
      return handleCutoverVerifyIpc(
        params,
        verifyHandlerDeps as unknown as Parameters<typeof handleCutoverVerifyIpc>[1],
      );
    }
    // Phase 92 GAP CLOSURE — `cutover-rollback` IPC. LIFO ledger rewind via
    // runRollbackEngine with Phase 86 atomic YAML writers wired in.
    if (method === "cutover-rollback") {
      const { join: joinPath } = await import("node:path");
      const { homedir: homedirFn } = await import("node:os");
      const yamlWriter = await import("../migration/yaml-writer.js");

      return handleCutoverRollbackIpc(params, {
        log,
        buildEngineDeps: async (resolved) => {
          const home = homedirFn();
          const ledgerPath =
            resolved.ledgerPath ??
            joinPath(home, ".clawcode", "manager", "cutover-ledger.jsonl");
          const targetAgentConfig = resolvedAgents.find(
            (a) => a.name === resolved.agent,
          );
          const memoryRoot =
            targetAgentConfig?.memoryPath ??
            targetAgentConfig?.workspace ??
            joinPath(home, ".clawcode", "agents", resolved.agent);

          const removeAgentSkillAdapter = async (
            agent: string,
            skillName: string,
            opts: { clawcodeYamlPath: string },
          ) => {
            const r = await yamlWriter.updateAgentSkills({
              existingConfigPath: opts.clawcodeYamlPath,
              agentName: agent,
              skillName,
              op: "remove",
            });
            return mapYamlOutcome(
              r.outcome,
              "reason" in r ? r.reason : undefined,
            );
          };

          // Remove ONE entry from agents[*].allowedModels: read current
          // array, filter out target, write filtered array back via
          // updateAgentConfig (which deep-merges patches).
          const removeAgentAllowedModelAdapter = async (
            agent: string,
            model: string,
            opts: { clawcodeYamlPath: string },
          ) => {
            try {
              const { readFile: rf } = await import("node:fs/promises");
              const { parseDocument } = await import("yaml");
              const text = await rf(opts.clawcodeYamlPath, "utf8");
              const doc = parseDocument(text);
              const js = doc.toJS() as { agents?: Array<{ name?: string; allowedModels?: string[] }> };
              const entry = js.agents?.find((a) => a.name === agent);
              if (!entry) return { kind: "not-found" as const, reason: `agent ${agent} not found` };
              const current = Array.isArray(entry.allowedModels)
                ? entry.allowedModels
                : [];
              if (!current.includes(model)) {
                return { kind: "no-op" as const };
              }
              const filtered = current.filter((m) => m !== model);
              const r = await yamlWriter.updateAgentConfig({
                existingConfigPath: opts.clawcodeYamlPath,
                agentName: agent,
                patch: { allowedModels: filtered },
              });
              return mapYamlOutcome(
                r.outcome,
                "reason" in r ? r.reason : undefined,
              );
            } catch (err) {
              return {
                kind: "refused" as const,
                reason: `removeAgentAllowedModel failed: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              };
            }
          };

          return {
            agent: resolved.agent,
            ledgerTo: resolved.ledgerTo,
            ledgerPath,
            clawcodeYamlPath: configPath,
            memoryRoot,
            uploadsTargetDir: joinPath(memoryRoot, "uploads", "discord"),
            skillsTargetDir: joinPath(home, ".clawcode", "skills"),
            dryRun: resolved.dryRun,
            removeAgentSkill: removeAgentSkillAdapter,
            removeAgentAllowedModel: removeAgentAllowedModelAdapter,
            log,
          };
        },
      });
    }
    // Phase 100 follow-up — set-gsd-project intercept (BEFORE routeMethod
    // so the closure can mutate the daemon-scoped resolvedAgents array +
    // re-publish to manager.setAllAgentConfigs without changing routeMethod's
    // signature). Persists to gsd-project-overrides.json (atomic temp+rename),
    // splices a new ResolvedAgentConfig with the new gsd.projectDir into the
    // resolvedAgents array, calls manager.setAllAgentConfigs to publish the
    // change, and triggers manager.restartAgent so the new SDK session picks
    // up the new cwd (gsd.projectDir is non-reloadable per Phase 100 GSD-07).
    if (method === "set-gsd-project") {
      const agentName = validateStringParam(params, "agent");
      const projectDirRaw = validateStringParam(params, "projectDir");
      const idx = resolvedAgents.findIndex((a) => a.name === agentName);
      if (idx === -1) {
        throw new ManagerError(`Agent '${agentName}' not found in config`);
      }
      const current = resolvedAgents[idx]!;
      if (!current.gsd?.projectDir) {
        throw new ManagerError(
          `Agent '${agentName}' is not GSD-enabled (no gsd.projectDir in config). ` +
            `Add a \`gsd:\` block to clawcode.yaml first.`,
        );
      }
      const { writeGsdProjectOverride, DEFAULT_GSD_PROJECT_OVERRIDES_PATH } =
        await import("./gsd-project-store.js");
      const { expandHome } = await import("../config/defaults.js");
      const expandedPath = expandHome(projectDirRaw);
      // Persist the override BEFORE mutating in-memory state. If the write
      // fails, the daemon stays in a consistent state (yaml + in-memory unchanged).
      await writeGsdProjectOverride(
        DEFAULT_GSD_PROJECT_OVERRIDES_PATH,
        agentName,
        expandedPath,
        log,
      );
      // Build a new immutable ResolvedAgentConfig with the swapped gsd block.
      const next: ResolvedAgentConfig = {
        ...current,
        gsd: { projectDir: expandedPath },
      };
      // Splice in place — both manager.setAllAgentConfigs and the slash
      // handler hold the SAME array reference, so after this mutation both
      // see the new entry on subsequent reads.
      (resolvedAgents as ResolvedAgentConfig[])[idx] = next;
      manager.setAllAgentConfigs(resolvedAgents);
      // Restart so the new SDK session boots with the new gsd.projectDir as
      // cwd. Mirrors the "restart" case fallback for stopped agents.
      try {
        await manager.restartAgent(agentName, next);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not running|no such session|requireSession/i.test(msg)) {
          await manager.startAgent(agentName, next);
        } else {
          throw err;
        }
      }
      return { ok: true, agent: agentName, projectDir: expandedPath };
    }

    // Phase 104 Plan 04 — secrets-status / secrets-invalidate intercepts
    // BEFORE routeMethod (closure-intercept pattern, mirrors set-gsd-project
    // above + marketplace + browser-tool-call). The handler module consults
    // the daemon-scoped `secretsResolver` singleton via closure so
    // routeMethod's signature stays stable and the handlers remain unit-
    // testable in isolation. SEC-06 telemetry surface for /clawcode-status;
    // closes Pitfall 3 manual-rotation gap.
    switch (method) {
      case "secrets-status": {
        return handleSecretsStatus(secretsResolver);
      }
      case "secrets-invalidate": {
        return handleSecretsInvalidate(secretsResolver, params);
      }
      // Phase 109-A — broker-status IPC. Returns the live PoolStatus[] from
      // the daemon-singleton broker (rps + throttle + lastRetryAfterSec
      // counters live here). Empty array when broker has no pools active
      // (no agents have spawned a 1Password shim yet — normal at boot).
      case "broker-status": {
        const pools = broker.getPoolStatus();
        const totalRps = pools.reduce(
          (sum, p) => sum + (p.rpsLastMin ?? 0),
          0,
        );
        const totalThrottles24h = pools.reduce(
          (sum, p) => sum + (p.throttleEvents24h ?? 0),
          0,
        );
        return { pools, totalRps, totalThrottles24h };
      }
      // Phase 110 Stage 0b 0B-RT-13 — list-mcp-tools IPC. Closure-intercept
      // pattern (mirrors secrets-status / broker-status / mcp-tracker-
      // snapshot above). Pure handler `handleListMcpToolsIpc` does the
      // Zod-shape → JSON-Schema conversion via zod/v4's NATIVE
      // `z.toJSONSchema()` (no new npm dep). Production wiring passes the
      // real frozen TOOL_DEFINITIONS arrays for search/image/browser; the
      // handler returns { tools: ToolSchema[] }. Sequencing constraint
      // (CONTEXT.md): this method ships BEFORE any Go shim builds against
      // it (Wave 1 prerequisite for Waves 2-4).
      case "list-mcp-tools": {
        return handleListMcpToolsIpc(
          {
            searchTools: SEARCH_TOOL_DEFINITIONS,
            imageTools: IMAGE_TOOL_DEFINITIONS,
            browserTools: BROWSER_TOOL_DEFINITIONS,
          },
          params,
        );
      }
      // Phase 999.15 TRACK-05 — mcp-tracker-snapshot intercept BEFORE
      // routeMethod (closure-intercept pattern, mirrors secrets-status
      // above). Pure handler in mcp-tracker-snapshot.ts builds the
      // response from the daemon-scoped mcpTracker singleton via closure.
      // Returns { agents: [] } when tracker is unset (Linux-only feature
      // not available on this platform). Optional `agent` param filters
      // to one entry — consumed by `clawcode mcp-tracker -a <name>`.
      case "mcp-tracker-snapshot": {
        if (!mcpTracker) {
          return { agents: [] };
        }
        const filter =
          params && typeof (params as { agent?: unknown }).agent === "string"
            ? ((params as { agent: string }).agent)
            : undefined;
        return buildMcpTrackerSnapshot(mcpTracker, filter);
      }
      // Phase 109-D — fleet-wide observability snapshot. Walks /proc once to
      // count claude procs vs tracker.getRegisteredAgents() (drift detector),
      // aggregates per-MCP-cmdline-pattern child counts + summed VmRSS, and
      // reads cgroup memory.{current,max} for memory pressure. Linux-only
      // signals degrade to null on non-Linux hosts. Read-only; never mutates
      // tracker or registry state.
      case "fleet-stats": {
        const trackedClaudeCount = mcpTracker
          ? Array.from(mcpTracker.getRegisteredAgents().keys()).filter(
              (n) => !n.startsWith("__broker:"),
            ).length
          : 0;
        // Phase 110 Stage 0a — every aggregate carries a runtime
        // classification so /api/fleet-stats consumers can split shim-
        // runtime cohorts (Stage 0/1 targets) from yaml-defined externals.
        // Yaml-defined entries default to "external"; the loader-auto-
        // injected shims (browser/search/image — see src/config/loader.ts:
        // 249-294) and the broker shim (1password — same file:215-238)
        // are added below with their runtime read from
        // config.defaults.shimRuntime (Stage 0a defaults all to "node").
        const labeledPatterns: Array<{
          label: string;
          regex: RegExp;
          runtime: McpRuntime;
        }> = [];
        for (const [name, cfg] of Object.entries(mcpServersConfig)) {
          try {
            const single = buildMcpCommandRegexes({ [name]: cfg });
            labeledPatterns.push({
              label: name,
              regex: single,
              runtime: "external",
            });
          } catch {
            // Skip empty/invalid entries — buildMcpCommandRegexes throws on empty.
          }
        }
        // Loader-auto-injected shim patterns. These are NOT in
        // mcpServersConfig (they're injected per-agent inside
        // resolveAgentConfig) but they show up in /proc with the cmdline
        // shape that `resolveShimCommand(<type>, <runtime>)` produces.
        // Phase 110 Stage 0b: command/args MUST be derived from the same
        // `defaults.shimRuntime.<type>` selector that the loader reads,
        // otherwise an operator who flips a flag → static would see the
        // running Go binary become invisible to /api/fleet-stats (the
        // Stage 0a regex `clawcode <type>-mcp` would never match
        // `/opt/clawcode/bin/clawcode-mcp-shim --type <type>`). Both call-
        // sites import resolveShimCommand to keep the spawn shape and
        // the proc-scan regex shape in lockstep — single source of
        // truth in src/config/loader.ts.
        const shimRuntimeCfg = config.defaults.shimRuntime;
        const browserRuntime: ShimRuntime = shimRuntimeCfg?.browser ?? "node";
        const searchRuntime: ShimRuntime = shimRuntimeCfg?.search ?? "node";
        const imageRuntime: ShimRuntime = shimRuntimeCfg?.image ?? "node";
        const browserCmd = resolveShimCommand("browser", browserRuntime);
        const searchCmd = resolveShimCommand("search", searchRuntime);
        const imageCmd = resolveShimCommand("image", imageRuntime);
        const autoInjected: ReadonlyArray<{
          label: string;
          command: string;
          args: readonly string[];
          runtime: McpRuntime;
        }> = [
          {
            label: "browser",
            command: browserCmd.command,
            args: browserCmd.args,
            runtime: browserRuntime,
          },
          {
            label: "search",
            command: searchCmd.command,
            args: searchCmd.args,
            runtime: searchRuntime,
          },
          {
            label: "image",
            command: imageCmd.command,
            args: imageCmd.args,
            runtime: imageRuntime,
          },
          {
            // Phase 108 broker shim. Both `--pool 1password` (legacy
            // form, current loader auto-inject) and `--type 1password`
            // (Phase 110 alias) match because the regex includes the
            // bare-package-name alternation `\bmcp-broker-shim\b`.
            // Broker is NOT in scope for Stage 0b (operator-locked —
            // see CONTEXT.md "mcp-broker-shim inclusion: NO — defer to
            // Stage 0c"). Hardcoded "node" is correct.
            label: "1password",
            command: "clawcode",
            args: ["mcp-broker-shim", "--pool", "1password"],
            runtime: "node",
          },
        ];
        for (const { label, command, args, runtime } of autoInjected) {
          // Skip if the operator yaml-defined a server with the same
          // name (mcpServersConfig wins — the operator's entry already
          // got pushed above with runtime: "external").
          if (mcpServersConfig[label] !== undefined) continue;
          try {
            const regex = buildMcpCommandRegexes({
              [label]: { command, args: [...args] },
            });
            labeledPatterns.push({ label, regex, runtime });
          } catch {
            // unreachable — args is non-empty for every auto-inject
          }
        }
        return await buildFleetStats({
          daemonPid: process.pid,
          trackedClaudeCount,
          mcpPatterns: labeledPatterns,
        });
      }
      // Phase 107 VEC-CLEAN-03 — memory-cleanup-orphans intercept BEFORE
      // routeMethod (closure-intercept pattern, mirrors secrets-status +
      // mcp-tracker-snapshot above). Per-agent: resolve MemoryStore via
      // manager.getMemoryStore(agent) and call store.cleanupOrphans().
      // Optional `agent` param scopes to one agent; otherwise iterates all
      // resolvedAgents. Per-agent error logged + sentinel { totalAfter: -1 }
      // pushed into results so partial failures don't kill the whole
      // operator command. Returns { results: [{ agent, removed, totalAfter }] }.
      case "memory-cleanup-orphans": {
        const agentParam =
          params && typeof (params as { agent?: unknown }).agent === "string"
            ? ((params as { agent: string }).agent)
            : null;
        const targets = agentParam
          ? [agentParam]
          : resolvedAgents.map((a) => a.name);
        const results: Array<{
          agent: string;
          removed: number;
          totalAfter: number;
        }> = [];
        for (const agent of targets) {
          const store = manager.getMemoryStore(agent);
          if (!store) {
            results.push({ agent, removed: 0, totalAfter: 0 });
            continue;
          }
          try {
            const r = store.cleanupOrphans();
            results.push({
              agent,
              removed: r.removed,
              totalAfter: r.totalAfter,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`[memory-cleanup-orphans] ${agent} failed: ${msg}`);
            results.push({ agent, removed: 0, totalAfter: -1 });
          }
        }
        return { results };
      }
      // Phase 115 D-08 — embedding-v2 migration IPC handlers. Closure-
      // intercept pattern (mirrors memory-cleanup-orphans above). Per-
      // agent migrator constructed on each call; no shared singleton.
      // Phase 90 per-agent isolation preserved.
      case "embedding-migration-status": {
        const { EmbeddingV2Migrator } = await import(
          "../memory/migrations/embedding-v2.js"
        );
        const agentParam =
          params && typeof (params as { agent?: unknown }).agent === "string"
            ? (params as { agent: string }).agent
            : null;
        const targets = agentParam
          ? [agentParam]
          : resolvedAgents.map((a) => a.name);
        const results: Array<{
          agent: string;
          phase: string;
          progressProcessed: number;
          progressTotal: number;
          lastCursor: string | null;
          startedAt: string | null;
          completedAt: string | null;
          paused: boolean;
          error?: string;
        }> = [];
        const pausedSet = new Set(
          (config.defaults as { embeddingMigration?: { pausedAgents?: readonly string[] } })
            .embeddingMigration?.pausedAgents ?? [],
        );
        for (const agent of targets) {
          const store = manager.getMemoryStore(agent);
          if (!store) {
            results.push({
              agent,
              phase: "no-store",
              progressProcessed: 0,
              progressTotal: 0,
              lastCursor: null,
              startedAt: null,
              completedAt: null,
              paused: pausedSet.has(agent),
              error: "memory store not available",
            });
            continue;
          }
          try {
            const m = new EmbeddingV2Migrator(store.getDatabase(), agent);
            const s = m.getState();
            results.push({
              agent,
              phase: s.phase,
              progressProcessed: s.progressProcessed,
              progressTotal: s.progressTotal,
              lastCursor: s.lastCursor,
              startedAt: s.startedAt,
              completedAt: s.completedAt,
              paused: pausedSet.has(agent),
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(`[embedding-migration-status] ${agent} failed: ${msg}`);
            results.push({
              agent,
              phase: "error",
              progressProcessed: 0,
              progressTotal: 0,
              lastCursor: null,
              startedAt: null,
              completedAt: null,
              paused: pausedSet.has(agent),
              error: msg,
            });
          }
        }
        return { results };
      }
      case "embedding-migration-transition": {
        const { EmbeddingV2Migrator } = await import(
          "../memory/migrations/embedding-v2.js"
        );
        const p = params as { agent?: string; toPhase?: string } | undefined;
        const agent = p?.agent;
        const toPhase = p?.toPhase;
        if (!agent || typeof agent !== "string") {
          return { ok: false, error: "agent param required" };
        }
        if (!toPhase || typeof toPhase !== "string") {
          return { ok: false, error: "toPhase param required" };
        }
        const store = manager.getMemoryStore(agent);
        if (!store) {
          return { ok: false, error: "memory store not available" };
        }
        try {
          const m = new EmbeddingV2Migrator(store.getDatabase(), agent);
          // For re-embedding entry, seed progress_total with the
          // current count of memories missing v2 vectors.
          if (toPhase === "re-embedding") {
            const total = store.countMemoriesMissingV2Embedding();
            m.transition(
              "re-embedding",
              total + m.getState().progressProcessed,
            );
          } else {
            m.transition(
              toPhase as Parameters<typeof m.transition>[0],
            );
          }
          const s = m.getState();
          log.info(
            {
              agent,
              action: "embedding-migration-transition",
              fromPhase: "(see new state)",
              toPhase: s.phase,
            },
            "[diag] embedding-v2 migration transitioned",
          );
          return { ok: true, phase: s.phase };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, error: msg };
        }
      }
      case "embedding-migration-pause": {
        // Pause = add to defaults.embeddingMigration.pausedAgents.
        // Persisted state lives in the runtime config; the heartbeat
        // runner consults this list before processing. NOTE: this plan
        // ships the IPC + state-machine machinery; the heartbeat runner
        // wiring (which actually skips paused agents) lands in wave 4.
        const p = params as { agent?: string } | undefined;
        const agent = p?.agent;
        if (!agent || typeof agent !== "string") {
          return { ok: false, error: "agent param required" };
        }
        const cfgEm = (config.defaults as {
          embeddingMigration?: {
            cpuBudgetPct?: number;
            batchSize?: number;
            pausedAgents?: string[];
          };
        }).embeddingMigration;
        const paused = new Set<string>(cfgEm?.pausedAgents ?? []);
        paused.add(agent);
        if (!cfgEm) {
          (config.defaults as {
            embeddingMigration?: {
              cpuBudgetPct?: number;
              batchSize?: number;
              pausedAgents?: string[];
            };
          }).embeddingMigration = {
            cpuBudgetPct: 5,
            batchSize: 50,
            pausedAgents: [...paused],
          };
        } else {
          cfgEm.pausedAgents = [...paused];
        }
        log.info(
          { agent, action: "embedding-migration-pause" },
          "[diag] embedding-v2 migration paused for agent",
        );
        return { ok: true, paused: [...paused] };
      }
      case "embedding-migration-resume": {
        const p = params as { agent?: string } | undefined;
        const agent = p?.agent;
        if (!agent || typeof agent !== "string") {
          return { ok: false, error: "agent param required" };
        }
        const cfgEm = (config.defaults as {
          embeddingMigration?: {
            cpuBudgetPct?: number;
            batchSize?: number;
            pausedAgents?: string[];
          };
        }).embeddingMigration;
        const paused = new Set<string>(cfgEm?.pausedAgents ?? []);
        paused.delete(agent);
        if (cfgEm) cfgEm.pausedAgents = [...paused];
        log.info(
          { agent, action: "embedding-migration-resume" },
          "[diag] embedding-v2 migration resumed for agent",
        );
        return { ok: true, paused: [...paused] };
      }
      // Phase 999.25 — subagent-complete intercept BEFORE routeMethod
      // (closure-intercept pattern, mirrors secrets-status +
      // mcp-tracker-snapshot above). The handler closes over `config`
      // (live ref post-PR-#8 closure-capture fix), `log`, and
      // `subagentThreadSpawner`, none of which are on routeMethod's
      // signature. Pure helper in `relay-and-mark-completed.ts` does
      // the lookup → idempotent-relay → stamp-completedAt; this case
      // is a thin shell that wires deps + handles the env kill-switch
      // + reads the live `config.defaults.subagentCompletion.enabled`
      // toggle.
      case "subagent-complete": {
        const agentName = validateStringParam(params, "agentName");
        if (process.env.CLAWCODE_SUBAGENT_COMPLETION_DISABLE === "1") {
          return { ok: false, reason: "disabled" };
        }
        const sc = (config.defaults as {
          subagentCompletion?: { enabled?: boolean };
        }).subagentCompletion;
        const enabled = sc?.enabled !== false;
        return relayAndMarkCompletedByAgentName(
          {
            readThreadRegistry: () =>
              readThreadRegistry(THREAD_REGISTRY_PATH),
            writeThreadRegistry: (next) =>
              writeThreadRegistry(THREAD_REGISTRY_PATH, next),
            relayCompletionToParent: subagentThreadSpawner
              ? (threadId) =>
                  subagentThreadSpawner.relayCompletionToParent(threadId)
              : null,
            now: () => Date.now(),
            log: log.child({ subsystem: "subagent-completion" }),
            enabled,
          },
          agentName,
        );
      }
    }

    return routeMethod(manager, resolvedAgents, method, params, routingTableRef, rateLimiter, heartbeatRunner, taskScheduler, skillsCatalog, threadManager, webhookManager, deliveryQueue, subagentThreadSpawner, allowlistMatchers, approvalLog, securityPolicies, escalationMonitor, advisorBudget, discordBridgeRef, configPath, config.defaults.basePath, taskManager, taskStore, schedulerSource, botDirectSenderRef);
  };

  // 11. Create IPC server
  const server = createIpcServer(SOCKET_PATH, handler);

  // 11. Resolve Discord bot token from config (COEX-01: no fallback to shared plugin token).
  //
  // Phase 104 — route through warmed cache + retry shim instead of an
  // inline execSync. preResolveAll above already populated the cache for
  // this URI on the happy path; resolve() here is either a free cache hit
  // OR a one-shot retry if pre-resolve failed for botToken specifically.
  // Critical-secret fail-closed contract preserved: any resolution failure
  // throws and refuses to start the Discord bridge.
  let botToken: string;
  if (config.discord?.botToken) {
    const raw = config.discord.botToken;
    if (raw.startsWith("op://")) {
      try {
        botToken = await secretsResolver.resolve(raw);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to resolve Discord bot token from 1Password — refusing to start Discord bridge. `
            + `Reason: ${reason}. Fix: ensure 1Password CLI is authenticated (op signin) or set a literal token in clawcode.yaml discord.botToken`,
        );
      }
    } else {
      botToken = raw;
    }
  } else {
    botToken = "";
    log.warn("No discord.botToken configured — Discord bridge disabled");
  }

  // 11a. Create delivery queue for reliable outbound message delivery.
  // The deliverFn closure captures webhookManager and the Discord client ref
  // so the queue can send via webhook or channel.send with splitting.
  const deliveryDbPath = join(MANAGER_DIR, "delivery-queue.db");
  const deliveryDb = new Database(deliveryDbPath);
  const deliveryQueue = new DeliveryQueue({
    db: deliveryDb,
    deliverFn: async (agentName: string, channelId: string, content: string) => {
      // Try webhook delivery first -- but skip for thread channels since
      // webhooks deliver to the parent channel, not the thread (SATH-03).
      const isThreadChannel = !routingTableRef.current.channelToAgent.has(channelId);
      if (!isThreadChannel && webhookManager.hasWebhook(agentName)) {
        await webhookManager.send(agentName, content);
        return;
      }
      // Fallback: send via Discord client channel
      if (discordBridge) {
        const client = discordBridge.discordClient;
        const channel = await client.channels.fetch(channelId);
        if (channel && "send" in channel && typeof channel.send === "function") {
          const MAX_LENGTH = 2000;
          if (content.length <= MAX_LENGTH) {
            await (channel as { send: (c: string) => Promise<unknown> }).send(content);
          } else {
            // Split long messages at newlines or spaces
            let remaining = content;
            while (remaining.length > 0) {
              if (remaining.length <= MAX_LENGTH) {
                await (channel as { send: (c: string) => Promise<unknown> }).send(remaining);
                break;
              }
              let splitIdx = remaining.lastIndexOf("\n", MAX_LENGTH);
              if (splitIdx <= 0 || splitIdx < MAX_LENGTH / 2) {
                splitIdx = remaining.lastIndexOf(" ", MAX_LENGTH);
              }
              if (splitIdx <= 0 || splitIdx < MAX_LENGTH / 2) {
                splitIdx = MAX_LENGTH;
              }
              await (channel as { send: (c: string) => Promise<unknown> }).send(remaining.slice(0, splitIdx));
              remaining = remaining.slice(splitIdx).trimStart();
            }
          }
        }
      }
    },
    log,
  });
  log.info({ dbPath: deliveryDbPath }, "delivery queue initialized");

  // 11b. Start Discord bridge to receive messages and route them to agent sessions.
  // The bridge connects to Discord via discord.js, listens for messages in bound
  // channels, and forwards them to agent sessions via sessionManager.forwardToAgent().
  // Agents respond via their inherited Discord MCP plugin (reply tool).
  let discordBridge: DiscordBridge | null = null;
  if (botToken && routingTable.channelToAgent.size > 0) {
    discordBridge = new DiscordBridge({
      routingTableRef,
      sessionManager: manager,
      turnDispatcher,
      threadManager,
      deliveryQueue,
      securityPolicies,
      botToken,
      log,
    });
    try {
      await discordBridge.start();
      discordBridgeRef.current = discordBridge;
      log.info({ boundChannels: routingTable.channelToAgent.size }, "Discord bridge started");

      // Phase 90.1 hotfix — wire bot-direct fallback into SessionManager so
      // Phase 89 restart greetings can fall back to plain bot-identity send
      // when per-agent webhooks are missing (MANAGE_WEBHOOKS missing / auto-
      // provisioner no-oped). Captures the bridge via closure.
      {
        const bridgeForGreeting = discordBridge;
        const botDirectImpl: import("./restart-greeting.js").BotDirectSender = {
          async sendEmbed(channelId, embed) {
            const channel = await bridgeForGreeting.discordClient.channels.fetch(channelId);
            if (!channel || !channel.isTextBased() || !("send" in channel)) {
              throw new Error(`channel ${channelId} is not a sendable text channel`);
            }
            const msg = await (channel as import("discord.js").TextBasedChannel & { send: (opts: { embeds: import("discord.js").EmbedBuilder[] }) => Promise<{ id: string }> }).send({ embeds: [embed] });
            return msg.id;
          },
          // Phase 100 follow-up — plain-text bot-direct send. Mirrors the
          // sendEmbed shape but accepts a content string. Used as the
          // bot-identity fallback for TriggerEngine's deliveryFn when the
          // agent has no per-agent webhook provisioned.
          async sendText(channelId, content) {
            const channel = await bridgeForGreeting.discordClient.channels.fetch(channelId);
            if (!channel || !channel.isTextBased() || !("send" in channel)) {
              throw new Error(`channel ${channelId} is not a sendable text channel`);
            }
            const msg = await (channel as import("discord.js").TextBasedChannel & { send: (opts: { content: string }) => Promise<{ id: string }> }).send({ content });
            return msg.id;
          },
        };
        manager.setBotDirectSender(botDirectImpl);
        // Phase 100 follow-up — also expose to the TriggerEngine deliveryFn.
        botDirectSenderRef.current = botDirectImpl;
      }

      // Auto-provision webhooks for agents without manual webhookUrl
      const allWebhookIdentities = await provisionWebhooks({
        client: discordBridge.discordClient,
        agents: resolvedAgents,
        manualIdentities: manualWebhookIdentities,
        log,
      });
      webhookManager = new WebhookManager({ identities: allWebhookIdentities, log });
      discordBridge.setWebhookManager(webhookManager);
      log.info(
        { total: allWebhookIdentities.size, manual: manualWebhookIdentities.size, autoProvisioned: allWebhookIdentities.size - manualWebhookIdentities.size },
        "webhook manager initialized with auto-provisioned identities",
      );

      // Phase 90 Plan 07 WIRE-05 — per-agent webhook identity probe.
      // provisionWebhooks above does the heavy lifting; this loop surfaces
      // per-agent {verified|provisioned|missing} status in the log so
      // operators can spot-check at boot. Fire-and-forget — probe failures
      // are logged but never block daemon startup.
      for (const agent of resolvedAgents) {
        if (!agent.webhook?.displayName) continue;
        const channelId = agent.channels[0];
        void verifyAgentWebhookIdentity({
          client: discordBridge.discordClient,
          agentName: agent.name,
          channelId,
          displayName: agent.webhook.displayName,
          avatarUrl: agent.webhook.avatarUrl,
          log,
        })
          .then((status) =>
            log.info(
              { agent: agent.name, status },
              "webhook identity probe",
            ),
          )
          .catch((err) =>
            log.warn(
              { agent: agent.name, error: (err as Error).message },
              "webhook identity probe failed (non-fatal)",
            ),
          );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, "Discord bridge failed to start");
      discordBridge = null;
      // Fallback: create webhook manager with manual-only identities
      webhookManager = new WebhookManager({ identities: manualWebhookIdentities, log });
      log.info({ webhooks: manualWebhookIdentities.size }, "webhook manager initialized (manual only, bridge failed)");
    }
  } else {
    log.warn("Discord bridge not started (no bot token or no channel bindings)");
    webhookManager = new WebhookManager({ identities: manualWebhookIdentities, log });
    log.info({ webhooks: manualWebhookIdentities.size }, "webhook manager initialized (manual only, no bridge)");
  }

  // Phase 89 GREET-01 — wire webhook DI into SessionManager now that both
  // are constructed (SessionManager at line ~1014, WebhookManager above in
  // all three branches: Discord-up success path, Discord-start failure
  // fallback, no-bot-token/no-bindings path). Before this call, restartAgent
  // greetings are no-ops. Exactly one call, post-convergence.
  manager.setWebhookManager(webhookManager);
  // Phase 100 follow-up — also expose to the TriggerEngine deliveryFn
  // closure constructed earlier at boot (~line 1935). The closure reads
  // `.current` lazily at trigger-fire time, so this single post-convergence
  // assignment covers all three webhook-construction branches above.
  webhookManagerRef.current = webhookManager;

  // 11b2. Create SubagentThreadSpawner for IPC-driven subagent thread creation
  const subagentThreadSpawner = discordBridge
    ? new SubagentThreadSpawner({
        sessionManager: manager,
        registryPath: THREAD_REGISTRY_PATH,
        discordClient: discordBridge.discordClient,
        log,
        // Phase 99 sub-scope M (2026-04-26) — auto-relay subagent completion
        // to parent agent. When wired, the spawner fetches the subagent's
        // last reply on session-end and dispatches a synthetic turn to the
        // parent ("your subagent finished, summarize for the user"). The
        // parent's response posts in the main channel via the normal Discord
        // pipeline, closing the loop without operator intervention.
        turnDispatcher,
      })
    : null;
  if (subagentThreadSpawner) {
    log.info("subagent thread spawner initialized");
  }

  // 11c. Initialize slash command handler (requires Discord bridge client — no fallback)
  // Quick task 260419-nic — pass turnDispatcher so /clawcode-steer can
  // dispatch [USER STEER] follow-up turns after interrupting in-flight ones.
  const slashHandler = new SlashCommandHandler({
    routingTable,
    sessionManager: manager,
    resolvedAgents,
    botToken,
    client: discordBridge?.discordClient,
    turnDispatcher,
    // Phase 83 EFFORT-05 — inject the catalog so slash-command dispatch can
    // resolve per-skill `effort:` frontmatter overrides and apply them for
    // the duration of the turn.
    skillsCatalog,
    log,
  });
  if (botToken) {
    try {
      await slashHandler.start();
      log.info("slash command handler started");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.warn({ error: msg }, "slash command handler failed to start (non-fatal)");
    }
  }

  // 11d. Initialize config hot-reload
  const auditTrailPath = join(MANAGER_DIR, "config-audit.jsonl");

  const configReloader = new ConfigReloader({
    sessionManager: manager,
    taskScheduler,
    heartbeatRunner,
    webhookManager,
    skillsCatalog,
    routingTableRef,
    log,
  });

  const configWatcher = new ConfigWatcher({
    configPath,
    auditTrailPath,
    onChange: async (diff, newResolvedAgents, newConfig) => {
      // Phase 999.X — replace the daemon's `config` reference so closures
      // reading `config.defaults.<dial>` (orphan-claude reaper,
      // subagent-session reaper, both inside onTickAfter) see the live
      // yaml on the next tick. Done FIRST so any failure in the rest of
      // this handler still leaves config in sync with what the watcher
      // believes is current.
      config = newConfig;
      // Phase 104 plan 03 (SEC-05) — reconcile the secrets cache against
      // the diff BEFORE applyChanges so the reload's downstream agent
      // restarts/spawns hit a hot, fresh cache. Walks the diff for op:// URI
      // changes: invalidates old URIs, warm-resolves new ones. Failures are
      // logged inside applySecretsDiff and never propagate (configReloader
      // must still run for the non-secret parts of the diff).
      await applySecretsDiff(diff, secretsResolver, log);
      // Phase 108 — Pitfall 2: hot-reload of OP_SERVICE_ACCOUNT_TOKEN is
      // explicitly NOT supported (CONTEXT.md §"Out of scope"). The broker
      // pins each agent → tokenHash on first connect; a yaml edit that
      // changes a token literal mid-flight is caught at the broker's
      // sticky-pin check and rejected per-connection. Surface an
      // operator-visible warning here so the rejection isn't a silent
      // surprise. Walk the diff for any 1password-token change.
      try {
        for (const newAgent of newResolvedAgents) {
          const newOverride =
            newAgent.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
          const oldAgent = resolvedAgents.find((a) => a.name === newAgent.name);
          const oldOverride =
            oldAgent?.mcpEnvOverrides?.["1password"]?.OP_SERVICE_ACCOUNT_TOKEN;
          if (newOverride !== oldOverride) {
            brokerLog.error(
              {
                agent: newAgent.name,
                hadOverride: oldOverride !== undefined,
                hasOverride: newOverride !== undefined,
              },
              "mcp-broker: hot-reload of OP_SERVICE_ACCOUNT_TOKEN is NOT supported — restart daemon to apply (broker token pin is sticky per-agent)",
            );
          }
        }
      } catch (err) {
        brokerLog.warn(
          { err: String(err) },
          "mcp-broker: hot-reload token-diff probe threw (non-fatal)",
        );
      }
      const summary = await configReloader.applyChanges(diff, newResolvedAgents);
      log.info({ subsystems: summary.subsystemsReloaded, agents: summary.agentsAffected }, "config hot-reloaded");
    },
    log,
    // Hot-reload must resolve op:// refs too — otherwise adding a new
    // mcpServers entry with `op://...` env on a running daemon would still
    // crash the child. Matches the boot-time resolver above.
    //
    // Phase 104 — uses the shared cached sync wrapper so hot-reload
    // hits the warmed cache. The applySecretsDiff call above (SEC-05) pre-
    // resolves new op:// refs so this sync wrapper finds them in the cache.
    opRefResolver: cachedOpRefResolver,
  });
  await configWatcher.start();
  log.info({ configPath, auditTrail: auditTrailPath }, "config watcher started");

  // 11d. Start dashboard server (non-fatal — daemon continues if port is taken)
  const dashboardPort = Number(process.env.CLAWCODE_DASHBOARD_PORT) || 3100;
  const dashboardHost = process.env.CLAWCODE_DASHBOARD_HOST ?? "127.0.0.1";
  let dashboard: Awaited<ReturnType<typeof startDashboardServer>> | null = null;
  try {
    // Phase 61 TRIG-03: Inject webhook handler routed through WebhookSource.handleHttp.
    // WebhookSource.handleHttp owns TriggerEvent construction + stable idempotency keys.
    const webhookHandler = webhookSource
      ? createWebhookHandler(
          webhookSource.configMap,
          (triggerId, payload, rawBodyBytes) =>
            webhookSource!.handleHttp(triggerId, payload, rawBodyBytes),
          log,
        )
      : undefined;
    dashboard = await startDashboardServer({ port: dashboardPort, host: dashboardHost, socketPath: SOCKET_PATH, webhookHandler });
    log.info({ port: dashboardPort, host: dashboardHost }, "dashboard server started");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ port: dashboardPort, host: dashboardHost, error: msg }, "dashboard server failed to start — continuing without dashboard");
  }

  // 11d-bis. Phase 69 — OpenAI-compatible endpoint. Starts AFTER dashboard
  // (so dashboard port conflicts surface first) and AFTER SessionManager +
  // ConversationStore are fully initialized (which happens above inside the
  // SessionManager constructor path). Non-fatal: an EADDRINUSE on the openai
  // port is logged at warn and the daemon continues without the endpoint.
  //
  // Env overrides: CLAWCODE_OPENAI_PORT, CLAWCODE_OPENAI_HOST (mirrors
  // CLAWCODE_DASHBOARD_PORT / _HOST). Disabled entirely via
  // config.defaults.openai.enabled = false.
  //
  // Under the hood, startOpenAiEndpoint calls startOpenAiServer from
  // src/openai/server.ts with a production OpenAiSessionDriver built via
  // createOpenAiSessionDriver (src/openai/driver.ts). Shutdown honors
  // Pitfall 10: drain activeStreams → server.close() → apiKeysStore.close().
  const openAiEndpoint: OpenAiEndpointHandle = await startOpenAiEndpoint(
    {
      managerDir: MANAGER_DIR,
      sessionManager: manager,
      turnDispatcher,
      agentNames: () => resolvedAgents.filter((a) => !a.name.includes("-sub-") && !a.name.includes("-thread-")).map((a) => a.name),
      log,
    },
    config.defaults.openai,
  );
  openAiEndpointRef = openAiEndpoint;

  // 11e. Phase 52 Plan 03 (CACHE-03): daily cost + cache hit-rate summary
  // cron. Fires at 09:00 UTC and posts one Discord embed per running agent
  // carrying the previous 24h cost totals AND `💾 Cache: {hitRate}% over
  // {turns} turns` when turns > 0 (suppressed on idle days per BLOCKER-1).
  // Shutdown handler below calls `.stop()` to clean up the timer.
  const dailySummaryCron: DailySummaryCronHandle = scheduleDailySummaryCron({
    manager,
    webhookManager,
    log,
  });
  log.info({ pattern: "0 9 * * *" }, "daily summary cron scheduled (09:00 UTC)");

  // 11g. Phase 999.14 — start the periodic MCP orphan reaper. Runs every 60s
  // AFTER manager.startAll has had time to spawn fresh MCP children (the
  // first tick fires at t=60s, by which time the npm-wrapper exec handoff
  // is complete and the 5s-young filter excludes any in-progress spawn).
  //
  // The onTickAfter callback runs the MCP-09 stale-binding sweep AFTER the
  // orphan reap completes — locked decision per CONTEXT.md (sweep observes
  // post-reap registry state). Disabled when defaults.threadIdleArchiveAfter
  // === "0" or subagentThreadSpawner is null (Discord disabled).
  if (mcpTracker) {
    const idleAfter =
      (config.defaults as { threadIdleArchiveAfter?: string }).threadIdleArchiveAfter ?? "24h";
    let idleMs = 0;
    try {
      idleMs = parseIdleDuration(idleAfter);
    } catch (err) {
      mcpLog.error(
        { err: String(err), idleAfter },
        "invalid threadIdleArchiveAfter; sweep disabled",
      );
    }
    // Phase 999.15 TRACK-01 — reconciler ALWAYS runs (independent of the
    // 999.14 stale-binding sweep). Both calls are wrapped in their own
    // try/catch so a failure in one does NOT block the other or propagate
    // to startOrphanReaper (which would crash the 60s tick loop).
    const sweepEnabled = idleMs > 0 && subagentThreadSpawner != null;
    const onTickAfter = async () => {
      if (sweepEnabled) {
        try {
          await sweepStaleBindings({
            spawner: subagentThreadSpawner,
            registryPath: THREAD_REGISTRY_PATH,
            now: Date.now(),
            idleMs,
            log: mcpLog,
            // Phase 999.X — when a stale binding belongs to an auto-
            // spawned subagent thread (name regex match), also stop
            // the underlying session. Operator-defined agent bindings
            // are filtered inside sweepStaleBindings via
            // isSubagentThreadName, so this callback is safe to pass
            // unconditionally.
            stopSubagentSession: (name) => manager.stopAgent(name),
          });
        } catch (err) {
          mcpLog.error(
            { err: String(err) },
            "stale-binding sweep failed (non-fatal)",
          );
        }
      }
      // Phase 999.15 TRACK-01 — tracker reconciliation (independent of sweep).
      if (mcpTracker) {
        try {
          await reconcileAllAgents({
            tracker: mcpTracker,
            daemonPid: process.pid,
            log: mcpLog,
            bootTimeUnix: mcpBootTimeUnix,
            clockTicksPerSec: mcpClockTicksPerSec,
          });
        } catch (err) {
          mcpLog.error(
            { err: String(err) },
            "reconcileAllAgents failed (non-fatal)",
          );
        }
      }
      // Phase 109-B — orphan-claude reaper. Runs AFTER the reconciler so a
      // freshly-discovered SDK respawn (TRACK-02 polled discovery) gets
      // registered before this scan can mark it as orphaned. Reads the
      // current mode from the live config defaults so a yaml hot-reload
      // (defaults.orphanClaudeReaper.mode) takes effect on the next tick
      // without a daemon restart.
      if (
        mcpTracker &&
        mcpBootTimeUnix !== undefined &&
        mcpClockTicksPerSec !== undefined
      ) {
        const oc = (config.defaults as {
          orphanClaudeReaper?: {
            mode?: OrphanClaudeReaperMode;
            minAgeSeconds?: number;
          };
        }).orphanClaudeReaper;
        const mode: OrphanClaudeReaperMode = oc?.mode ?? "alert";
        const minAgeSeconds = oc?.minAgeSeconds ?? 30;
        const mcpUidForReaper = process.getuid?.() ?? -1;
        try {
          await tickOrphanClaudeReaper({
            daemonPid: process.pid,
            tracker: mcpTracker,
            uid: mcpUidForReaper,
            minAgeSeconds,
            bootTimeUnix: mcpBootTimeUnix,
            clockTicksPerSec: mcpClockTicksPerSec,
            mode,
            log: mcpLog.child({ subsystem: "orphan-claude-reaper" }),
          });
        } catch (err) {
          mcpLog.error(
            { err: String(err) },
            "orphan-claude reaper tick failed (non-fatal)",
          );
        }
      }
      // Phase 999.X — subagent-thread session reaper. Walks the
      // session registry + thread bindings to find auto-spawned
      // subagent sessions (`*-via-*-<nanoid6>` / `*-sub-<nanoid6>`)
      // that are: (a) orphaned (binding gone but session still
      // running) or (b) idle (binding lastActivity > idleTimeout).
      // Reads config.defaults.subagentReaper each tick so a yaml
      // hot-reload takes effect on the next 60s sweep. Wrapped in
      // its own try/catch so a failure here does NOT crash the
      // tick loop or block other reapers.
      try {
        const sr = (config.defaults as {
          subagentReaper?: {
            mode?: SubagentReaperMode;
            idleTimeoutMinutes?: number;
            minAgeSeconds?: number;
          };
        }).subagentReaper;
        const subMode: SubagentReaperMode = sr?.mode ?? "reap";
        const subIdleTimeoutMinutes = sr?.idleTimeoutMinutes ?? 1440;
        const subMinAgeSeconds = sr?.minAgeSeconds ?? 300;
        // Snapshot both registries at tick start (matches the
        // orphan-claude-reaper invariant: the decision uses one
        // consistent snapshot, no mid-walk mutation).
        const sessionRegistry = await readRegistry(REGISTRY_PATH);
        const sessions: readonly RunningSessionInfo[] = sessionRegistry.entries.map(
          (e) => ({
            name: e.name,
            status: e.status,
            startedAt: e.startedAt,
          }),
        );
        const threadRegistry = await readThreadRegistry(THREAD_REGISTRY_PATH);
        await tickSubagentSessionReaper({
          sessions,
          bindings: threadRegistry.bindings,
          idleTimeoutMinutes: subIdleTimeoutMinutes,
          minAgeSeconds: subMinAgeSeconds,
          mode: subMode,
          log: mcpLog.child({ subsystem: "subagent-session-reaper" }),
          stopAgent: (name) => manager.stopAgent(name),
        });
      } catch (err) {
        mcpLog.error(
          { err: String(err) },
          "subagent-session reaper tick failed (non-fatal)",
        );
      }
      // Phase 999.25 — subagent completion quiescence sweep. Walks
      // running subagent sessions whose binding has been idle past
      // `quiescenceMinutes` (default 5) AND haven't relayed yet
      // (`completedAt === null/undefined`); fires
      // relayCompletionToParent + stamps completedAt. Reads
      // `config.defaults.subagentCompletion` lazily on each tick, so
      // yaml hot-reload of `quiescenceMinutes` / `enabled` takes effect
      // on the next sweep without daemon restart (closure-capture fix
      // from PR #8 makes the live `config` reference current).
      try {
        const scCfg = (config.defaults as {
          subagentCompletion?: {
            enabled?: boolean;
            quiescenceMinutes?: number;
          };
        }).subagentCompletion;
        const completionEnabled = scCfg?.enabled !== false;
        const quiescenceMinutes = scCfg?.quiescenceMinutes ?? 5;
        // Snapshot both registries (consistent-snapshot invariant
        // matches subagent-session-reaper above).
        const sessionRegistryForCompletion = await readRegistry(REGISTRY_PATH);
        const sessionsForCompletion = sessionRegistryForCompletion.entries.map(
          (e) => ({ name: e.name, status: e.status }),
        );
        const threadRegistryForCompletion = await readThreadRegistry(
          THREAD_REGISTRY_PATH,
        );
        await tickSubagentCompletionSweep({
          sessions: sessionsForCompletion,
          bindings: threadRegistryForCompletion.bindings,
          quiescenceMinutes,
          enabled: completionEnabled,
          log: mcpLog.child({ subsystem: "subagent-completion-sweep" }),
          relayAndMarkCompleted: async (threadId: string) => {
            return relayAndMarkCompletedByThreadId(
              {
                readThreadRegistry: () =>
                  readThreadRegistry(THREAD_REGISTRY_PATH),
                writeThreadRegistry: (next) =>
                  writeThreadRegistry(THREAD_REGISTRY_PATH, next),
                relayCompletionToParent: subagentThreadSpawner
                  ? (tid) =>
                      subagentThreadSpawner.relayCompletionToParent(tid)
                  : null,
                now: () => Date.now(),
                log: mcpLog.child({ subsystem: "subagent-completion" }),
                enabled: completionEnabled,
              },
              threadId,
            );
          },
        });
      } catch (err) {
        mcpLog.error(
          { err: String(err) },
          "subagent-completion sweep tick failed (non-fatal)",
        );
      }
    };
    const mcpUid = process.getuid?.() ?? -1;
    const bootTimeUnixForReaper = await readBootTimeUnix();
    const mcpPatternsForReaper = buildMcpCommandRegexes(mcpServersConfig);
    reaperInterval = startOrphanReaper({
      uid: mcpUid,
      patterns: mcpPatternsForReaper,
      clockTicksPerSec: readClockTicksPerSec(),
      bootTimeUnix: bootTimeUnixForReaper,
      intervalMs: 60_000,
      log: mcpLog,
      onTickAfter,
    });
    mcpLog.info(
      {
        intervalMs: 60_000,
        sweepEnabled,
        reconcilerEnabled: true, // Phase 999.15 TRACK-01 — always-on
        idleMs,
      },
      "mcp orphan reaper + stale-binding sweep + reconciler started",
    );
  }

  // 12. Register signal handlers per D-15
  const shutdown = async (): Promise<void> => {
    log.info("shutdown signal received");
    // Phase 999.6 SNAP-01 — write running-fleet snapshot FIRST so a hang
    // anywhere downstream still leaves boot with a valid restore record.
    // getRunningAgents() reflects the live SDK-attached sessions; this is
    // the moment of truth before drain/stopAll begin tearing down.
    try {
      await writePreDeploySnapshot(
        PRE_DEPLOY_SNAPSHOT_PATH,
        manager.getRunningAgents().map((name) => ({
          name,
          sessionId: manager.getSessionHandle?.(name)?.sessionId ?? null,
        })),
        log,
      );
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "pre-deploy snapshot write failed (non-fatal — boot falls back to static autoStart)",
      );
    }
    // Phase 108 — broker preDrainNotify BEFORE manager.drain. Stops new
    // shim connections immediately while existing ones continue serving
    // any in-flight tool calls until manager.drain finishes the agents'
    // last turns. RESEARCH.md §5 ordering invariant.
    try {
      shimServer.preDrainNotify();
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "mcp-broker preDrainNotify threw (non-fatal)",
      );
    }
    // 260419-q2z Fix B — drain in-flight session summaries BEFORE closing any
    // downstream resource. The 15s ceiling matches summarizeSession's internal
    // 10s timeout + 5s slack for embed + insert + markSummarized. After drain
    // returns, new turn dispatches via streamFromAgent/dispatchTurn reject
    // with SessionError('shutting down ...'), so stopAll() below is safe from
    // races with an in-progress turn.
    try {
      const drainResult = await manager.drain(15_000);
      log.info(
        { settled: drainResult.settled, timedOut: drainResult.timedOut },
        "session manager drain complete",
      );
    } catch (err) {
      // drain() is designed not to throw, but log defensively so an
      // unexpected exception doesn't block the rest of shutdown.
      log.warn(
        { err: (err as Error).message },
        "session manager drain threw unexpectedly (non-fatal)",
      );
    }
    // Phase 108 — drain the broker AFTER manager.drain so any shim-routed
    // tool calls in-flight during the agents' final turns can complete.
    // The 2000ms ceiling matches Pitfall 3 (last-ref drain timeout). We
    // wrap in try/catch so a hung broker shutdown doesn't block the rest
    // of daemon shutdown — log + continue.
    try {
      await shimServer.shutdown(2000);
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "mcp-broker shutdown threw (non-fatal)",
      );
    }
    try {
      brokerNetServer.close();
      // Best-effort cleanup of the socket file so the next daemon boot
      // doesn't trip on EADDRINUSE.
      try {
        await unlink(MCP_BROKER_SOCKET_PATH);
      } catch {
        // socket may not exist — fine.
      }
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "mcp-broker socket close threw (non-fatal)",
      );
    }
    // Phase 69 — close OpenAI endpoint FIRST: activeStreams drained + server
    // closed + apiKeysStore handle released, before the dashboard (which
    // owns the IPC socket for CLI fallback queries) shuts down. The
    // endpoint-bootstrap helper encapsulates the Pitfall 10 ordering
    // (activeStreams → server.close → store.close).
    //
    // Phase 74 Plan 02 invariant: the ordering is manager.drain() (above)
    // → openAiEndpoint.close() (which internally drains the OpenClaw
    // TransientSessionCache before server.close()) → browserManager.close()
    // → server.close(). In-flight openclaw-template transient turns either
    // finish cleanly or abort with AbortError — no leaked SDK subprocesses.
    await openAiEndpoint.close();
    if (dashboard) {
      await dashboard.close();
    }
    await configWatcher.stop();
    await policyWatcher.stop();
    // Phase 70 — close the browser BEFORE the IPC server so any in-flight
    // browser-tool-call requests fail cleanly. BrowserManager.close() runs
    // Pitfall-10 ordered save-state → ctx.close → browser.close per agent,
    // so cookies / localStorage / IndexedDB are flushed to disk here.
    try {
      await browserManager.close();
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "browser manager close failed on shutdown",
      );
    }
    server.close();
    if (discordBridge) {
      await discordBridge.stop();
    }
    await slashHandler.stop();
    triggerEngine.stopAll(); // Stop trigger sources (clears debounce timers)
    taskScheduler.stop();    // Stop handler-based cron jobs
    heartbeatRunner.stop();
    dailySummaryCron.stop();
    // Clean up all subagent thread bindings before stopping agents
    if (subagentThreadSpawner) {
      const subBindings = await subagentThreadSpawner.getSubagentBindings();
      for (const binding of subBindings) {
        try { await subagentThreadSpawner.cleanupSubagentThread(binding.threadId); } catch { /* best-effort */ }
      }
    }
    // Clean up all thread sessions before stopping agents.
    // Phase 999.14 MCP-08 — also route every binding through
    // cleanupThreadWithClassifier so the registry is pruned on Discord
    // 50001/10003/404 even during shutdown (operator pain regression:
    // today's incident left 3 stale fin-acquisition bindings because
    // shutdown's catch swallowed the error path).
    const allBindings = await threadManager.getActiveBindings();
    for (const binding of allBindings) {
      try { await threadManager.removeThreadSession(binding.threadId); } catch (err) {
        log.debug({ err: String(err), threadId: binding.threadId }, "removeThreadSession failed during shutdown (non-fatal)");
      }
      if (subagentThreadSpawner) {
        try {
          await cleanupThreadWithClassifier({
            spawner: subagentThreadSpawner,
            registryPath: THREAD_REGISTRY_PATH,
            threadId: binding.threadId,
            agentName: binding.agentName ?? "(unknown)",
            log,
          });
        } catch (err) {
          log.warn({ err: String(err), threadId: binding.threadId }, "cleanupThreadWithClassifier failed during shutdown (non-fatal)");
        }
      }
    }
    deliveryQueue.stop();
    deliveryDb.close();
    advisorBudgetDb.close();
    webhookManager.destroy();
    await manager.stopAll();
    // Phase 999.14 MCP-04 — clear the reaper interval and SIGTERM/SIGKILL
    // any tracked MCP child PIDs that survived stopAll. Runs AFTER stopAll
    // (so per-agent killAgentGroup hooks have already fired) and BEFORE
    // pid-file/socket cleanup. Idempotent on dead PIDs (ESRCH treated as
    // success). 5s grace before SIGKILL — matches systemd's TimeoutStopSec.
    if (reaperInterval) {
      clearInterval(reaperInterval);
      reaperInterval = null;
    }
    if (mcpTracker) {
      try {
        await mcpTracker.killAll(5_000);
      } catch (err) {
        mcpLog.error(
          { err: String(err) },
          "mcp tracker killAll failed during shutdown (non-fatal)",
        );
      }
    }
    // Close TaskStore AFTER manager.stopAll() so any in-flight agent
    // transition that writes to the store completes first (Phase 58 Plan 03).
    try {
      taskStore.close();
    } catch (err) {
      log.warn({ err: (err as Error).message }, "taskStore close failed");
    }
    // Phase 61: Clean up mysql2 pool (sources already stopped by triggerEngine.stopAll)
    if (mysqlPool) {
      try {
        await mysqlPool.end();
        log.info("mysql2 pool closed");
      } catch (err) {
        log.error({ error: (err as Error).message }, "mysql2 pool close failed");
      }
    }
    // Phase 115 Plan 07 sub-scope 15 — close the tool-cache singleton
    // and stop the size-metric sampler. Best-effort; an unclean close
    // doesn't block shutdown.
    try {
      clearInterval(toolCacheSizeReporter);
      toolCacheStore.close();
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        "tool-cache close failed (non-fatal)",
      );
    }
    await unlink(SOCKET_PATH).catch((err) => { log.debug({ path: SOCKET_PATH, error: (err as Error).message }, "socket file cleanup failed (may not exist)"); });
    await unlink(PID_PATH).catch((err) => { log.debug({ path: PID_PATH, error: (err as Error).message }, "pid file cleanup failed (may not exist)"); });
  };

  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  // Phase 999.23 — SIGHUP handler. Without this, an agent inside the daemon
  // that runs `kill -HUP <pid>` (or systemctl reload, which sends SIGHUP by
  // default) terminates the daemon silently because Node's default SIGHUP
  // disposition is to exit. Combined with `Restart=on-failure`, systemd
  // does NOT restart on a SIGHUP-induced exit (treated as clean). Outage
  // 2026-05-01 06:07: Admin Clawdy fell back to `kill -HUP` after sudo
  // refused systemctl reload; daemon died silently and stayed down.
  //
  // Behavior: graceful shutdown then exit with code 129 (128 + signal 1).
  // The systemd unit declares RestartForceExitStatus=129 so that exit code
  // is treated as a failure trigger, restoring the restart loop.
  process.on("SIGHUP", () => {
    log.info("received SIGHUP — initiating clean shutdown (will systemd-restart)");
    void shutdown().then(() => process.exit(129));
  });

  log.info({ socket: SOCKET_PATH }, "manager daemon started");

  // Auto-start all configured agents on daemon boot.
  //
  // Phase 100 follow-up — operator-curated active fleet. The full
  // `resolvedAgents` array is preserved for routeMethod (so the `start
  // <name>` IPC handler at line ~3990 can find dormant configs via
  // `configs.find((c) => c.name === name)` and the operator can manually
  // boot them later). Only the boot auto-start path filters out
  // `autoStart=false` agents — they don't get an SDK session on daemon
  // start, cutting cold-start time from O(N agents × 2-3s) to
  // O(active agents × 2-3s). Skipped agents are logged at info level so
  // operators can verify the skip happened (not a silent failure).
  // Phase 999.6 SNAP-02 — read pre-deploy snapshot and union into autoStart set.
  // Awaited synchronously (sub-10ms). Reader deletes the file before returning
  // to prevent infinite auto-revive loops on partial-startAll failures.
  const snapshotKnownAgentNames = new Set(resolvedAgents.map((c) => c.name));
  const restoredFromSnapshot = await readAndConsumePreDeploySnapshot(
    PRE_DEPLOY_SNAPSHOT_PATH,
    snapshotKnownAgentNames,
    config.defaults.preDeploySnapshotMaxAgeHours ?? 24,
    log,
  );

  const autoStartAgents = resolvedAgents.filter((cfg) => {
    if (cfg.autoStart !== false) return true;
    if (restoredFromSnapshot.has(cfg.name)) {
      log.info(
        { agent: cfg.name },
        "boot auto-start via pre-deploy snapshot (yaml autoStart=false overridden for one boot)",
      );
      return true;
    }
    log.info(
      { agent: cfg.name },
      "skipping boot auto-start — autoStart=false (manually startable via `clawcode start <name>`)",
    );
    return false;
  });

  // Clean up stale "starting" or "running" statuses for skipped agents.
  // reconcileRegistry ignores "starting" entries entirely, so an agent that
  // stalled during warmup (e.g. MCP timeout on a previous boot) keeps that
  // status forever — the fleet shows it as "starting" indefinitely. "running"
  // is also stale: if the session never resumed or was not attempted
  // (autoStart=false), the registry should reflect that the agent is stopped.
  {
    const skippedNames = new Set(
      resolvedAgents
        .filter((cfg) => !autoStartAgents.includes(cfg))
        .map((cfg) => cfg.name),
    );
    if (skippedNames.size > 0) {
      try {
        let reg = await readRegistry(REGISTRY_PATH);
        let changed = false;
        for (const entry of reg.entries) {
          if (skippedNames.has(entry.name) && (entry.status === "starting" || entry.status === "running")) {
            reg = updateEntry(reg, entry.name, { status: "stopped" });
            changed = true;
            log.info({ agent: entry.name, was: entry.status }, "cleared stale active status for autoStart=false agent");
          }
        }
        if (changed) await writeRegistry(REGISTRY_PATH, reg);
      } catch (err) {
        log.warn({ error: (err as Error).message }, "failed to clear stale registry statuses for skipped agents (non-fatal)");
      }
    }
  }

  // Phase 999.25 — sort by wakeOrder (lower = earlier). `undefined` becomes
  // Infinity so unordered agents boot LAST. Stable sort: ties + same-priority
  // groups preserve YAML order. Boot remains sequential (startAll uses
  // `for...await`); this only changes the order, not the total time.
  const sortedAutoStartAgents = [...autoStartAgents].sort(
    (a, b) => (a.wakeOrder ?? Infinity) - (b.wakeOrder ?? Infinity),
  );
  if (sortedAutoStartAgents.some((c) => c.wakeOrder !== undefined)) {
    log.info(
      {
        order: sortedAutoStartAgents.map((c) => ({
          name: c.name,
          wakeOrder: c.wakeOrder ?? null,
        })),
      },
      "wake-order applied to auto-start sequence",
    );
  }
  void (async () => {
    try {
      await manager.startAll(sortedAutoStartAgents);
      log.info(
        {
          agents: sortedAutoStartAgents.length,
          skipped: resolvedAgents.length - sortedAutoStartAgents.length,
        },
        "all agents auto-started",
      );
    } catch (err) {
      log.error({ error: (err as Error).message }, "failed to auto-start agents");
    }
  })();

  // TaskManager owns no external resources (inflight timers .unref()'d,
  // db handle owned by TaskStore via PayloadStore). No explicit shutdown needed.
  return { server, manager, taskStore, taskManager, payloadStore, triggerEngine, routingTable, rateLimiter, heartbeatRunner, taskScheduler, skillsCatalog, slashHandler, threadManager, webhookManager, discordBridge, subagentThreadSpawner, configWatcher, configReloader, policyWatcher, routingTableRef, secretsResolver, dashboard: dashboard ?? { server: null as unknown as ReturnType<typeof import("node:http").createServer>, sseManager: null as unknown as import("../dashboard/sse.js").SseManager, close: async () => {} }, shutdown };
}

/**
 * Route an IPC method to the appropriate SessionManager action.
 */
async function routeMethod(
  manager: SessionManager,
  configs: readonly import("../shared/types.js").ResolvedAgentConfig[],
  method: string,
  params: Record<string, unknown>,
  routingTableRef: { current: RoutingTable },
  rateLimiter: RateLimiter,
  heartbeatRunner: HeartbeatRunner,
  taskScheduler: TaskScheduler,
  skillsCatalog: SkillsCatalog,
  threadManager: ThreadManager,
  webhookManager: WebhookManager,
  deliveryQueue: DeliveryQueue,
  subagentThreadSpawner: SubagentThreadSpawner | null,
  allowlistMatchers: Map<string, AllowlistMatcher>,
  approvalLog: ApprovalLog,
  securityPolicies: Map<string, SecurityPolicy>,
  escalationMonitor: EscalationMonitor,
  advisorBudget: AdvisorBudget,
  discordBridgeRef: { current: DiscordBridge | null },
  configPath: string,
  agentsBasePath: string,
  taskManager: TaskManager,
  taskStore: TaskStore,
  schedulerSource: SchedulerSource,
  // Phase 999.12 IPC-02 — bot-direct sender ref for ask-agent's no-webhook
  // fallback path. Mutable ref so the closure reads `.current` at call time
  // (Pitfall 7: pre-bridge boot leaves .current null).
  botDirectSenderRef: { current: import("./restart-greeting.js").BotDirectSender | null },
): Promise<unknown> {
  switch (method) {
    case "start": {
      const name = validateStringParam(params, "name");
      const config = configs.find((c) => c.name === name);
      if (!config) {
        throw new ManagerError(`Agent '${name}' not found in config`);
      }
      await manager.startAgent(name, config);
      return { ok: true };
    }

    case "stop": {
      const name = validateStringParam(params, "name");
      await manager.stopAgent(name);
      return { ok: true };
    }

    case "restart": {
      const name = validateStringParam(params, "name");
      const config = configs.find((c) => c.name === name);
      if (!config) {
        throw new ManagerError(`Agent '${name}' not found in config`);
      }
      // If the agent is already stopped, restartAgent() throws from its
      // internal stopAgent() call. Fall back to a plain start so
      // "restart" works uniformly regardless of current state.
      try {
        await manager.restartAgent(name, config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not running|no such session|requireSession/i.test(msg)) {
          await manager.startAgent(name, config);
        } else {
          throw err;
        }
      }
      return { ok: true };
    }

    case "start-all": {
      await manager.startAll(configs);
      return { ok: true };
    }

    case "stop-all": {
      await manager.stopAll();
      return { ok: true };
    }

    case "status": {
      const registry = await readRegistry(REGISTRY_PATH);
      return { entries: registry.entries };
    }

    case "routes": {
      return {
        channels: Object.fromEntries(routingTableRef.current.channelToAgent),
        agents: Object.fromEntries(routingTableRef.current.agentToChannels),
      };
    }

    case "rate-limit-status": {
      const stats = rateLimiter.getStats();
      return {
        globalTokens: stats.globalTokens,
        channelTokens: Object.fromEntries(stats.channelTokens),
        queueDepths: Object.fromEntries(stats.queueDepths),
      };
    }

    case "list-rate-limit-snapshots": {
      // Phase 103 OBS-06 — per-agent OAuth Max usage snapshots. Resolves the
      // RateLimitTracker via SessionManager (returns undefined when agent is
      // not running OR when the agent has no UsageTracker DB to share — see
      // Plan 02 startAgent flow). Empty `snapshots: []` when no data so the
      // /clawcode-usage embed can render the "No usage data yet" graceful
      // path (Pitfall 7).
      //
      // NOT the same as the existing `rate-limit-status` case above —
      // that's the Discord outbound rate-limiter token bucket (Pitfall 5).
      const { handleListRateLimitSnapshotsIpc } = await import(
        "./daemon-rate-limit-ipc.js"
      );
      const agent = validateStringParam(params, "agent");
      return handleListRateLimitSnapshotsIpc(
        { agent },
        {
          getRateLimitTrackerForAgent: (name) =>
            manager.getRateLimitTrackerForAgent(name),
        },
      );
    }

    case "heartbeat-status": {
      const results = heartbeatRunner.getLatestResults();
      const zoneStatuses = heartbeatRunner.getZoneStatuses();
      const agents: Record<string, unknown> = {};
      for (const [agentName, checks] of results) {
        const checksObj: Record<string, unknown> = {};
        let worstStatus: CheckStatus = "healthy";
        for (const [checkName, { result, lastChecked }] of checks) {
          checksObj[checkName] = {
            status: result.status,
            message: result.message,
            lastChecked,
            ...(result.metadata ? { metadata: result.metadata } : {}),
          };
          if (result.status === "critical" || (result.status === "warning" && worstStatus !== "critical")) {
            worstStatus = result.status;
          }
        }
        const zoneData = zoneStatuses.get(agentName);
        agents[agentName] = {
          checks: checksObj,
          overall: worstStatus,
          ...(zoneData ? { zone: zoneData.zone, fillPercentage: zoneData.fillPercentage } : {}),
        };
      }
      return { agents };
    }

    case "context-zone-status": {
      const zoneStatuses = heartbeatRunner.getZoneStatuses();
      const agentsResult: Record<string, { zone: string; fillPercentage: number }> = {};
      for (const [name, data] of zoneStatuses) {
        agentsResult[name] = { zone: data.zone, fillPercentage: data.fillPercentage };
      }
      return { agents: agentsResult };
    }

    case "schedules": {
      const statuses = taskScheduler.getStatuses();
      return { schedules: statuses };
    }

    case "skills": {
      const catalog = Array.from(skillsCatalog.entries()).map(([, entry]) => ({ ...entry }));
      const allAssignments = Object.fromEntries(configs.map((c) => [c.name, c.skills]));

      const agentFilter = typeof params.agent === "string" ? params.agent : undefined;
      const assignments = agentFilter
        ? Object.fromEntries(
            Object.entries(allAssignments).filter(([name]) => name === agentFilter),
          )
        : allAssignments;

      return { catalog, assignments };
    }

    // Phase 999.2 Plan 02 D-RNI-IPC-01 — canonical name `ask-agent` and the
    // deprecated alias `send-message` share a single body via stacked-case.
    // The deprecated branch logs a one-line metric so operators can grep the
    // daemon journal for `deprecated.*alias.*used` to verify the 30-day
    // removal trigger (D-RNX-03 / Open Question 2 in RESEARCH.md).
    case "ask-agent":
    case "send-message": {
      if (method === "send-message") {
        // Operator metric for D-RNX-03's 30-day removal trigger. Operator
        // greps the daemon journal for `deprecated.*alias.*used` after the
        // horizon; zero hits → safe to remove the alias. Matches the
        // console-based logging style used elsewhere in routeMethod (the
        // daemon-scoped pino `log` is not threaded into this function).
        console.info(
          `[deprecated IPC alias used] alias=send-message canonical=ask-agent`,
        );
      }
      const from = validateStringParam(params, "from");
      const to = validateStringParam(params, "to");
      const content = validateStringParam(params, "content");
      const priority = typeof params.priority === "string" ? params.priority : "normal";
      const mirror = params.mirror_to_target_channel === true;

      // Find target agent config to get workspace path
      const targetConfig = configs.find((c) => c.name === to);
      if (!targetConfig) {
        throw new ManagerError(`Target agent '${to}' not found in config`);
      }

      // Phase 75 SHARED-01 — memoryPath (not workspace) so cross-agent
      // sends deliver to the target's private inbox, never a shared one.
      const inboxDir = join(targetConfig.memoryPath, "inbox");

      // Phase 999.2 Plan 03 — delegate inbox-write + dispatch + mirror to the
      // pure-DI handler (mirrors the Phase 103 daemon-rate-limit-ipc.ts /
      // Phase 96 daemon-fs-ipc.ts blueprint). Errors from dispatchTurn now
      // PROPAGATE to the IPC client (D-SYN-05) — the silent `try {} catch {}`
      // that lived here pre-Plan-03 (and was masking ALL dispatch errors as
      // false-success) is GONE.
      const { handleAskAgentIpc } = await import("./daemon-ask-agent-ipc.js");
      const askResult = await handleAskAgentIpc(
        { from, to, content, priority, mirror_to_target_channel: mirror },
        {
          runningAgents: manager.getRunningAgents(),
          dispatchTurn: (toName, msg) => manager.dispatchTurn(toName, msg),
          writeInbox: async (p) => {
            const message = createMessage(
              p.from,
              p.to,
              p.content,
              p.priority as "normal" | "high" | "urgent",
            );
            await writeMessage(inboxDir, message);
            return { messageId: message.id };
          },
          webhookManager,
          configs,
          // routeMethod has no pino-childed log in scope; console is the
          // existing tracing surface (matches webhook-failure logging in
          // post-to-agent at this same case-block).
          log: {
            info: (...args: unknown[]) => console.info(...args),
            warn: (...args: unknown[]) => console.warn(...args),
            error: (...args: unknown[]) => console.error(...args),
          },
          // Phase 999.12 IPC-02 — bot-direct fallback for response mirror
          // when target lacks a webhook. Late-bound ref read so pre-bridge
          // boot windows (Pitfall 7) silently skip the mirror without throwing.
          botDirectSender: {
            sendText: async (channelId: string, text: string) => {
              const sender = botDirectSenderRef.current;
              if (!sender) return;
              await sender.sendText(channelId, text);
            },
          },
          agentChannels: routingTableRef.current.agentToChannels,
        },
      );

      // Phase 999.2 D-SYN-06 — escalation path UNCHANGED. The handler
      // returns {ok, messageId, response} without inspecting indicators;
      // escalation runs HERE at the daemon edge, on the response text the
      // handler returned, and may overwrite the response by re-dispatching
      // through escalationMonitor.escalate (which talks to the SessionManager
      // — a dependency we deliberately don't push into the pure module).
      if (askResult.response !== undefined) {
        const ERROR_INDICATORS = [
          "i can't", "i'm unable", "i don't have the capability",
          "tool_use_error", "error executing",
        ];
        const lowerResponse = askResult.response.toLowerCase();
        const isError = ERROR_INDICATORS.some((indicator) => lowerResponse.includes(indicator));
        if (escalationMonitor.shouldEscalate(to, askResult.response, isError)) {
          const escalatedResponse = await escalationMonitor.escalate(to, content);
          return {
            ok: true,
            messageId: askResult.messageId,
            response: escalatedResponse,
            escalated: true,
          };
        }
        return {
          ok: true,
          messageId: askResult.messageId,
          response: askResult.response,
          escalated: false,
        };
      }

      return { ok: true, messageId: askResult.messageId };
    }

    // Phase 999.2 Plan 02 D-RNI-IPC-02 — canonical name `post-to-agent` and
    // the deprecated alias `send-to-agent` share a single body via stacked-
    // case. Deprecated branch logs a metric mirroring the ask-agent path.
    case "post-to-agent":
    case "send-to-agent": {
      if (method === "send-to-agent") {
        // Operator metric — see the matching block in case "send-message"
        // above for rationale (D-RNX-03 / RESEARCH.md Open Question 2).
        console.info(
          `[deprecated IPC alias used] alias=send-to-agent canonical=post-to-agent`,
        );
      }
      const from = validateStringParam(params, "from");
      const to = validateStringParam(params, "to");
      const message = validateStringParam(params, "message");

      // Validate target agent exists
      const targetConfig = configs.find((c) => c.name === to);
      if (!targetConfig) {
        throw new ManagerError(`Target agent '${to}' not found`);
      }

      // 1. Always write to filesystem inbox (fallback/record)
      // Phase 75 SHARED-01 — memoryPath (not workspace) so send-to-agent
      // writes to the target's private inbox in shared-workspace cases.
      const inboxDir = join(targetConfig.memoryPath, "inbox");
      const inboxMsg = createMessage(from, to, message, "normal");
      await writeMessage(inboxDir, inboxMsg);

      // 2. Post webhook embed to target's Discord channel
      let delivered = false;
      const targetChannels = routingTableRef.current.agentToChannels.get(to);
      if (
        targetChannels &&
        targetChannels.length > 0 &&
        webhookManager.hasWebhook(to)
      ) {
        try {
          const senderConfig = configs.find((c) => c.name === from);
          const senderDisplayName =
            senderConfig?.webhook?.displayName ?? from;
          const senderAvatarUrl = senderConfig?.webhook?.avatarUrl;
          const embed = buildAgentMessageEmbed(
            from,
            senderDisplayName,
            message,
          );
          await webhookManager.sendAsAgent(
            to,
            senderDisplayName,
            senderAvatarUrl,
            embed,
          );
          delivered = true;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[send-to-agent] webhook delivery failed from=${from} to=${to} error=${errMsg} — inbox fallback used`,
          );
        }
      }

      return { delivered, messageId: inboxMsg.id };
    }

    case "set-effort": {
      const name = validateStringParam(params, "name");
      const level = validateStringParam(params, "level");
      // Phase 83 EFFORT-04 — accepts the full v2.2 level set.
      const validLevels = ["low", "medium", "high", "xhigh", "max", "auto", "off"];
      if (!validLevels.includes(level)) {
        throw new ManagerError(`Invalid effort level '${level}'. Valid: ${validLevels.join(", ")}`);
      }
      manager.setEffortForAgent(name, level as EffortLevel);
      return { ok: true, agent: name, effort: level };
    }

    case "get-effort": {
      const name = validateStringParam(params, "name");
      const level = manager.getEffortForAgent(name);
      return { ok: true, agent: name, effort: level };
    }

    case "set-permission-mode": {
      // Phase 87 CMD-02 — live SDK permission-mode swap. Delegates to the
      // pure testable handler (mirror of handleSetModelIpc). No YAML
      // persistence — permission mode is runtime-only by design (see Plan 02
      // non-rollback / ephemeral decision).
      return await handleSetPermissionModeIpc({ manager, params });
    }

    case "send-attachment": {
      const agentName = validateStringParam(params, "agent");
      const filePath = validateStringParam(params, "file_path");
      const message = typeof params.message === "string" ? params.message : undefined;

      // Verify file exists
      try {
        await access(filePath);
      } catch {
        throw new ManagerError(`File not found: ${filePath}`);
      }

      // Verify file size (Discord limit: 25MB for standard, 8MB without boost)
      const fileStat = await stat(filePath);
      if (fileStat.size > 25 * 1024 * 1024) {
        throw new ManagerError(`File too large (${fileStat.size} bytes). Discord limit is 25MB.`);
      }

      // Find the agent's channel(s)
      const agentConfig = configs.find((c) => c.name === agentName);
      if (!agentConfig) {
        throw new ManagerError(`Agent '${agentName}' not found in config`);
      }
      const channels = agentConfig.channels;
      if (channels.length === 0) {
        throw new ManagerError(`Agent '${agentName}' has no Discord channels configured`);
      }

      // Send via Discord client
      const bridge = discordBridgeRef.current;
      if (!bridge) {
        throw new ManagerError("Discord bridge not available");
      }

      const client = bridge.discordClient;
      const targetChannelId = typeof params.channel_id === "string" ? params.channel_id : channels[0];
      const channel = await client.channels.fetch(targetChannelId);
      if (!channel || !("send" in channel) || typeof channel.send !== "function") {
        throw new ManagerError(`Cannot send to channel ${targetChannelId}`);
      }

      await (channel as { send: (opts: { content?: string; files: string[] }) => Promise<unknown> }).send({
        ...(message ? { content: message } : {}),
        files: [filePath],
      });

      return { ok: true, agent: agentName, channel: targetChannelId, file: filePath };
    }

    // ----------------------------------------------------------------
    // Phase 94 Plan 05 TOOL-08 / D-08 — fetch-discord-messages (Gap 3
    // closure). Built-in helper auto-injected through the clawcode MCP
    // server (src/mcp/server.ts). Wires production deps (discord.js
    // client.channels.fetch + messages.fetch) onto the DI-pure handler
    // (src/manager/tools/clawcode-fetch-discord-messages.ts).
    // ----------------------------------------------------------------
    case "fetch-discord-messages": {
      const channelId = validateStringParam(params, "channel_id");
      const limit = typeof params.limit === "number"
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 50;
      const before = typeof params.before === "string" ? params.before : undefined;

      const bridge = discordBridgeRef.current;
      if (!bridge) {
        throw new ManagerError("Discord bridge not available");
      }
      const { clawcodeFetchDiscordMessages } = await import(
        "./tools/clawcode-fetch-discord-messages.js"
      );
      const pinoMod = (await import("pino")).default;
      const log = pinoMod({ level: "silent" });

      const result = await clawcodeFetchDiscordMessages(
        {
          channel_id: channelId,
          limit,
          ...(before !== undefined ? { before } : {}),
        },
        {
          fetchMessages: async (cid, opts) => {
            const ch = await bridge.discordClient.channels.fetch(cid);
            if (!ch || typeof (ch as { messages?: unknown }).messages !== "object") {
              throw new Error(`Channel '${cid}' is not a text channel/thread`);
            }
            const fetchOpts: { limit?: number; before?: string } = {};
            if (opts.limit !== undefined) fetchOpts.limit = opts.limit;
            if (opts.before !== undefined) fetchOpts.before = opts.before;
            const collection = await (
              ch as {
                messages: {
                  fetch: (
                    o: { limit?: number; before?: string },
                  ) => Promise<Map<string, unknown>>;
                };
              }
            ).messages.fetch(fetchOpts);
            type DiscordMsg = {
              id: string;
              author: { username: string };
              content: string;
              createdAt: Date;
              attachments: Map<string, { name?: string | null; url: string }>;
            };
            return [...(collection as Map<string, DiscordMsg>).values()].map((m) => ({
              id: m.id,
              author: m.author.username,
              content: m.content ?? "",
              ts: m.createdAt.toISOString(),
              attachments: [...m.attachments.values()].map((a) => ({
                filename: a.name ?? "attachment",
                url: a.url,
              })),
            }));
          },
          log,
        },
      );

      // The DI-pure handler returns either FetchDiscordMessagesOutput or
      // ToolCallError. Surface ToolCallError as a ManagerError so the
      // MCP wrapper in src/mcp/server.ts renders it as isError:true.
      if ("kind" in result && result.kind === "ToolCallError") {
        throw new ManagerError(result.message);
      }
      return result;
    }

    // ----------------------------------------------------------------
    // Phase 94 Plan 05 TOOL-09 / D-09 — share-file (Gap 3 closure).
    // Built-in helper auto-injected through the clawcode MCP server.
    // Wires production deps (fs.promises.stat + discord.js channel.send
    // bot-direct upload) onto the DI-pure handler. The webhook→bot-direct
    // fallback specified in 94-05 is reduced here to bot-direct only;
    // webhook-manager.sendFile is deferred until a future phase adds a
    // file-upload primitive to WebhookManager (acknowledged in 94-05
    // SUMMARY "Next Phase Readiness").
    // ----------------------------------------------------------------
    case "share-file": {
      const agentName = validateStringParam(params, "agent");
      const filePath = validateStringParam(params, "path");
      const caption = typeof params.caption === "string" ? params.caption : undefined;
      const channelIdParam =
        typeof params.channel_id === "string" ? params.channel_id : undefined;

      const agentConfig = configs.find((c) => c.name === agentName);
      if (!agentConfig) {
        throw new ManagerError(`Agent '${agentName}' not found in config`);
      }

      const bridge = discordBridgeRef.current;
      if (!bridge) {
        throw new ManagerError("Discord bridge not available");
      }

      // Resolve allowedRoots to the agent's workspace + memoryPath + Phase 96
      // D-05/D-06 fileAccess paths (operator-shared via ACL). Without
      // fileAccess inclusion, share-file refused operator-shared paths even
      // though the Phase 96 capability probe + clawcode_list_files honored
      // them — surfaced as deploy bug 2026-04-25 when fin-acquisition tried
      // to share /home/jjagpal/.openclaw/workspace-finmentum/research/*.pdf
      // and got "outside the agent workspace; refused" despite the path
      // being in the resolved fileAccess set.
      const allowedRoots: string[] = [];
      if (agentConfig.workspace) allowedRoots.push(agentConfig.workspace);
      if (agentConfig.memoryPath) allowedRoots.push(agentConfig.memoryPath);
      // Phase 96.1 hotfix — extend allowedRoots with resolved fileAccess.
      // resolveFileAccess merges defaults.fileAccess + agent.fileAccess and
      // expands the {agent} token. Defaults are always populated by zod
      // default ([/home/clawcode/.clawcode/agents/{agent}/]).
      const { resolveFileAccess: resolveFileAccessForShare } = await import(
        "../config/loader.js"
      );
      // routeMethod doesn't receive the top-level `config` object — only
      // the resolved per-agent `configs[]`. Pass undefined for defaults;
      // resolveFileAccess will skip the defaults merge. The defaults
      // template `{agent}` expands to the agent's workspace dir which is
      // already in allowedRoots from line 4172 (agentConfig.workspace),
      // so no functional loss. Per-agent fileAccess override (which IS
      // populated for cross-workspace cases like fin-acquisition reading
      // /home/jjagpal/.openclaw/workspace-finmentum/) still applies.
      // Bug fix 2026-04-25 evening: original Phase 96.1 hotfix referenced
      // `config.defaults` but `config` is not in routeMethod scope —
      // ReferenceError at runtime broke clawcode_share_file entirely.
      const fileAccessPaths = resolveFileAccessForShare(
        agentName,
        agentConfig as unknown as { readonly fileAccess?: readonly string[] },
        undefined,
      );
      for (const p of fileAccessPaths) {
        if (!allowedRoots.includes(p)) allowedRoots.push(p);
      }
      if (allowedRoots.length === 0) {
        throw new ManagerError(
          `Agent '${agentName}' has no workspace, memoryPath, or fileAccess configured`,
        );
      }

      // Default channel: explicit param, otherwise first configured channel.
      const channelId = channelIdParam ?? agentConfig.channels[0];
      if (!channelId) {
        throw new ManagerError(
          `Agent '${agentName}' has no Discord channels configured and no channel_id provided`,
        );
      }

      const { clawcodeShareFile } = await import("./tools/clawcode-share-file.js");
      const pinoMod = (await import("pino")).default;
      const log = pinoMod({ level: "silent" });

      // Bot-direct upload primitive — captures the message's first
      // attachment URL after Discord uploads the file. Used both as the
      // primary path and the fallback (single-channel UX consistency
      // pending webhook-manager.sendFile in a future phase).
      const botUpload = async (
        cid: string,
        file: { path: string; filename: string; caption?: string },
      ): Promise<{ url: string }> => {
        const channel = await bridge.discordClient.channels.fetch(cid);
        if (!channel || !("send" in channel) || typeof channel.send !== "function") {
          throw new Error(`Cannot send to channel ${cid}`);
        }
        const sendOpts: { content?: string; files: string[] } = {
          files: [file.path],
        };
        if (file.caption !== undefined) sendOpts.content = file.caption;
        const message = (await (
          channel as {
            send: (
              opts: { content?: string; files: string[] },
            ) => Promise<{ attachments: Map<string, { url: string }> }>;
          }
        ).send(sendOpts)) as { attachments: Map<string, { url: string }> };
        const attachment = [...message.attachments.values()][0];
        if (!attachment) {
          throw new Error("Discord upload returned no attachment URL");
        }
        return { url: attachment.url };
      };

      const result = await clawcodeShareFile(
        {
          path: filePath,
          ...(caption !== undefined ? { caption } : {}),
        },
        {
          allowedRoots,
          // Webhook path deferred — both DI surfaces forward to bot-direct.
          // The 94-05 handler tries webhook first, then bot. Until
          // webhook-manager.sendFile lands, both calls resolve to the
          // same primitive (idempotent — Discord deduplication is
          // not a concern because webhook will never reject when both
          // paths are identical).
          sendViaWebhook: botUpload,
          sendViaBot: botUpload,
          currentChannelId: () => channelId,
          stat: async (p: string) => {
            await access(p);
            const s = await stat(p);
            return { size: s.size, isFile: s.isFile() };
          },
          log,
        },
      );

      if ("kind" in result && result.kind === "ToolCallError") {
        throw new ManagerError(result.message);
      }
      return result;
    }

    case "slash-commands": {
      const commands = configs.map((a) => ({
        agent: a.name,
        commands: resolveAgentCommands(a.slashCommands).map((c) => ({
          name: c.name,
          description: c.description,
          claudeCommand: c.claudeCommand,
        })),
      }));
      return { agents: commands };
    }

    case "threads": {
      const bindings = await threadManager.getActiveBindings();
      const agentFilter = typeof params.agent === "string" ? params.agent : undefined;
      const filtered = agentFilter
        ? bindings.filter(b => b.agentName === agentFilter)
        : bindings;
      return { bindings: filtered };
    }

    case "fork-session": {
      const name = validateStringParam(params, "name");
      const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined;
      const model = typeof params.model === "string" ? params.model as "sonnet" | "opus" | "haiku" : undefined;
      const result = await manager.forkSession(name, { systemPromptOverride: systemPrompt, modelOverride: model });
      return { ok: true, forkName: result.forkName, parentAgent: result.parentAgent, sessionId: result.sessionId };
    }

    case "webhooks": {
      const webhooks: Array<{ agent: string; displayName: string; avatarUrl?: string; hasWebhookUrl: boolean }> = [];
      for (const config of configs) {
        if (config.webhook?.displayName) {
          webhooks.push({
            agent: config.name,
            displayName: config.webhook.displayName,
            avatarUrl: config.webhook.avatarUrl,
            hasWebhookUrl: !!config.webhook.webhookUrl,
          });
        }
      }
      return { webhooks };
    }

    case "memory-search": {
      const agentName = validateStringParam(params, "agent");
      const query = validateStringParam(params, "query");
      const topK = typeof params.topK === "number" ? params.topK : 10;

      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(`Memory store not found for agent '${agentName}' (agent may not be running)`);
      }

      const embedder = manager.getEmbedder();
      const queryEmbedding = await embedder.embed(query);
      const search = new SemanticSearch(store.getDatabase());
      const results = search.search(queryEmbedding, topK);

      return {
        results: results.map((r) => ({
          id: r.id,
          content: r.content,
          source: r.source,
          importance: r.importance,
          accessCount: r.accessCount,
          tier: r.tier,
          createdAt: r.createdAt,
          score: r.combinedScore,
          distance: r.distance,
        })),
      };
    }

    case "memory-lookup": {
      // Phase 68-02 — scope-aware conversation search with pagination.
      // Delegates to `invokeMemoryLookup` (memory-lookup-handler.ts) so the
      // same handler body runs in production and integration tests without
      // duplication. Branching: scope='memories' && page=0 → legacy
      // GraphSearch (pre-v1.9 byte-compat); otherwise → searchByScope with
      // paginated envelope (hasMore/nextOffset/origin/session_id).
      const agentName = validateStringParam(params, "agent");
      const query = validateStringParam(params, "query");
      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(
          `Memory store not found for agent '${agentName}' (agent may not be running)`,
        );
      }

      // Coerce raw IPC params to the handler's typed shape. All the
      // defense-in-depth clamping (limit, page) happens inside the handler.
      const scope =
        params.scope === "conversations" || params.scope === "all"
          ? params.scope
          : "memories";
      const page = typeof params.page === "number" ? params.page : 0;
      const limit = typeof params.limit === "number" ? params.limit : 5;

      // Phase 68 — RETR-03 gap closure. Resolve the per-agent
      // retrieval half-life from the conversation config block. Zod has
      // already enforced min(1) at config-load time, so no clamping
      // here. Leave undefined when the conversation block is absent so
      // the handler/searchByScope fallback to DEFAULT_RETRIEVAL_HALF_LIFE_DAYS
      // remains the single source of truth.
      const agentConfig = manager.getAgentConfig(agentName);
      const retrievalHalfLifeDays =
        agentConfig?.memory.conversation?.retrievalHalfLifeDays;

      return invokeMemoryLookup(
        { agent: agentName, query, limit, scope, page, retrievalHalfLifeDays },
        {
          memoryStore: store,
          conversationStore: manager.getConversationStore(agentName),
          embedder: manager.getEmbedder(),
        },
      );
    }

    case "usage": {
      const agentName = validateStringParam(params, "agent");
      const period = typeof params.period === "string" ? params.period : "session";
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
      const date = typeof params.date === "string" ? params.date : undefined;

      const usageTracker = manager.getUsageTracker(agentName);
      if (!usageTracker) {
        throw new ManagerError(`Usage tracker not found for agent '${agentName}' (agent may not be running)`);
      }

      let aggregate;
      switch (period) {
        case "session": {
          const sid = sessionId ?? "";
          aggregate = usageTracker.getSessionUsage(sid);
          break;
        }
        case "daily": {
          const day = date ?? new Date().toISOString().slice(0, 10);
          aggregate = usageTracker.getDailyUsage(day);
          break;
        }
        case "weekly": {
          const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
          const weekStartStr = weekStart.toISOString().slice(0, 10);
          aggregate = usageTracker.getWeeklyUsage(weekStartStr);
          break;
        }
        case "total": {
          aggregate = usageTracker.getTotalUsage(agentName);
          break;
        }
        default:
          throw new ManagerError(`Invalid usage period: ${period}`);
      }

      return { agent: agentName, period, ...aggregate };
    }

    case "latency": {
      const since = typeof params.since === "string" && params.since.length > 0 ? params.since : "24h";
      let sinceIso: string;
      try {
        sinceIso = sinceToIso(since);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "invalid since duration";
        throw new ManagerError(`Invalid since duration: ${msg}`);
      }

      const isAll = params.all === true;
      if (isAll) {
        const agents = manager.getRunningAgents();
        const reports: LatencyReport[] = [];
        for (const agentName of agents) {
          const store = manager.getTraceStore(agentName);
          if (!store) continue; // skip agents without a store (race at startup)
          const rawSegments = store.getPercentiles(agentName, sinceIso);
          const agentConfig = configs.find((c) => c.name === agentName);
          const segments = augmentWithSloStatus(rawSegments, agentConfig?.perf?.slos);
          // Phase 54 Plan 04: server-emit first_token_headline so the CLI +
          // dashboard render color/subtitle from the response (no client
          // mirror). Cold-start guard in evaluateFirstTokenHeadline keeps
          // newly-started agents gray until 5 samples exist.
          const firstTokenRow = store.getFirstTokenPercentiles(agentName, sinceIso);
          const first_token_headline = evaluateFirstTokenHeadline(
            firstTokenRow,
            agentConfig?.perf?.slos,
          );
          reports.push(
            Object.freeze({
              agent: agentName,
              since: sinceIso,
              segments,
              first_token_headline,
            }),
          );
        }
        return reports;
      }

      const agentName = validateStringParam(params, "agent");
      const store = manager.getTraceStore(agentName);
      if (!store) {
        throw new ManagerError(
          `Trace store not found for agent '${agentName}' (agent may not be running)`,
        );
      }
      const rawSegments = store.getPercentiles(agentName, sinceIso);
      const agentConfig = configs.find((c) => c.name === agentName);
      const segments = augmentWithSloStatus(rawSegments, agentConfig?.perf?.slos);
      // Phase 54 Plan 04: server-emit first_token_headline (same pattern as
      // --all branch above — single source of truth for SLO evaluation stays
      // here, dashboard + CLI are dumb renderers).
      const firstTokenRow = store.getFirstTokenPercentiles(agentName, sinceIso);
      const first_token_headline = evaluateFirstTokenHeadline(
        firstTokenRow,
        agentConfig?.perf?.slos,
      );
      return Object.freeze({
        agent: agentName,
        since: sinceIso,
        segments,
        first_token_headline,
      }) satisfies LatencyReport;
    }

    case "cache": {
      // Phase 52 Plan 03: CACHE_HIT_RATE_SLO-augmented cache telemetry report
      // with optional `cache_effect_ms` first-token delta. Mirrors the shape
      // of `case "latency"` above so the CLI + dashboard formatters stay
      // symmetric with `clawcode latency`.
      const since =
        typeof params.since === "string" && params.since.length > 0
          ? params.since
          : "24h";
      let sinceIso: string;
      try {
        sinceIso = sinceToIso(since);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "invalid since duration";
        throw new ManagerError(`Invalid since duration: ${msg}`);
      }

      /**
       * Build a single-agent augmented CacheTelemetryReport. Shared helper
       * for both the single-agent and `--all` branches below.
       *
       * Throws `ManagerError` when the trace store is missing (agent not
       * running) — the `--all` branch catches + filters these so a single
       * missing store doesn't kill the fleet response.
       */
      const buildReport = (
        agentName: string,
      ): CacheTelemetryReport & {
        readonly status: CacheHitRateStatus;
        readonly cache_effect_ms: number | null;
        readonly tool_cache_hit_rate: number | null;
        readonly tool_cache_size_mb: number | null;
        readonly tool_cache_turns: number;
      } => {
        const store = manager.getTraceStore(agentName);
        if (!store) {
          throw new ManagerError(
            `Trace store not found for agent '${agentName}' (agent may not be running)`,
          );
        }
        const report = store.getCacheTelemetry(agentName, sinceIso);
        const status = evaluateCacheHitRateStatus(
          report.avgHitRate,
          report.totalTurns,
        );
        const effect = computeCacheEffectMs(store, agentName, sinceIso);
        // Advisory WARN: if we have ≥ 20 eligible turns AND the delta is
        // non-negative, the cache is NOT delivering first-token benefit.
        // Per CONTEXT D-05 this is an operator-facing signal, not a hard
        // failure — the metric still surfaces in the response.
        if (effect !== null && effect >= 0 && report.totalTurns >= 20) {
          logger.warn(
            {
              agent: agentName,
              cacheEffectMs: effect,
              totalTurns: report.totalTurns,
            },
            "cache delivering no first-token benefit (expected delta < 0)",
          );
        }
        // Phase 115 Plan 07 T04 — aggregate tool-cache telemetry over the
        // same window. Surfaced next to prompt_cache_hit_rate on the
        // dashboard (sub-scope 16(c) per roadmap line 875).
        // tool_cache_hit_rate is the per-turn average from traces.db;
        // tool_cache_size_mb is fleet-wide and may be NULL on per-turn
        // rollups — the live value is folded into the response by the
        // closure intercept of `cache` IPC (see tool_cache_size_mb_live).
        const toolCache = store.getToolCacheTelemetry(agentName, sinceIso);
        return Object.freeze({
          ...report,
          status,
          cache_effect_ms: effect,
          tool_cache_hit_rate: toolCache.avgToolCacheHitRate,
          tool_cache_size_mb: toolCache.avgToolCacheSizeMb,
          tool_cache_turns: toolCache.turnsWithCacheEvents,
        });
      };

      const isAll = params.all === true;
      if (isAll) {
        const agents = manager.getRunningAgents();
        const reports = agents
          .map((a) => {
            try {
              return buildReport(a);
            } catch {
              return null;
            }
          })
          .filter(
            (r): r is NonNullable<typeof r> => r !== null,
          );
        return reports;
      }

      const agentName = validateStringParam(params, "agent");
      return buildReport(agentName);
    }

    case "tools": {
      // Phase 55 Plan 03: per-tool round-trip timing surface. Returns one
      // frozen ToolsReport (or ToolsReport[] for --all) with augmented
      // ToolPercentileRow[] carrying slo_status/slo_threshold_ms/slo_metric
      // per tool. Rows sorted by p95 DESC at the SQL layer so CLI + dashboard
      // render slowest-first without a client-side resort. Mirrors the
      // shape of `case "latency"` / `case "cache"` above.
      const since =
        typeof params.since === "string" && params.since.length > 0
          ? params.since
          : "24h";
      let sinceIso: string;
      try {
        sinceIso = sinceToIso(since);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "invalid since duration";
        throw new ManagerError(`Invalid since duration: ${msg}`);
      }

      const buildToolsReport = (
        agentName: string,
      ): {
        readonly agent: string;
        readonly since: string;
        readonly tools: readonly AugmentedToolRow[];
      } => {
        const store = manager.getTraceStore(agentName);
        if (!store) {
          throw new ManagerError(
            `Trace store not found for agent '${agentName}' (agent may not be running)`,
          );
        }
        const rawRows = store.getToolPercentiles(agentName, sinceIso);
        const agentConfig = configs.find((c) => c.name === agentName);
        const tools = augmentToolsWithSlo(rawRows, agentConfig?.perf?.tools);
        return Object.freeze({ agent: agentName, since: sinceIso, tools });
      };

      const isAll = params.all === true;
      if (isAll) {
        const agents = manager.getRunningAgents();
        const reports = agents
          .map((a) => {
            try {
              return buildToolsReport(a);
            } catch {
              return null;
            }
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        return reports;
      }

      const agentName = validateStringParam(params, "agent");
      return buildToolsReport(agentName);
    }

    case "bench-run-prompt": {
      // Phase 51: invoked by `clawcode bench` to run a single prompt against a
      // running agent and capture a trace. Not exposed via Discord; CLI /
      // harness only. Caller-owned Turn lifecycle matches the Phase 50
      // contract: SessionManager.dispatchTurn NEVER calls turn.end(); this
      // handler does, in both success and error paths.
      //
      // Phase 54 Plan 03 — response shape extended with rate_limit_errors:
      // number. The bench harness currently runs without a Discord bridge
      // binding (bench-agent has no channels), so rate-limit errors cannot
      // happen on this code path today. The counter exists as a
      // forward-compat hook — when/if a future bench variant exercises the
      // Discord edit pipeline end-to-end, the isDiscordRateLimitError
      // helper (imported from src/discord/streaming.js for reuse) becomes
      // the producer. `bench --check-regression` hard-fails on any total
      // > 0, so the shape MUST be present even at zero to wire the gate.
      const agentName = validateStringParam(params, "agent");
      const prompt = validateStringParam(params, "prompt");
      const turnIdPrefix =
        typeof params.turnIdPrefix === "string" && params.turnIdPrefix.length > 0
          ? params.turnIdPrefix
          : "bench:";

      const collector = manager.getTraceCollector(agentName);
      if (!collector) {
        throw new ManagerError(
          `Trace collector not found for agent '${agentName}' (agent may not be running)`,
        );
      }

      const turnId = `${turnIdPrefix}${nanoid(10)}`;
      const turn = collector.startTurn(turnId, agentName, null);
      let rateLimitErrors = 0;
      try {
        const response = await manager.dispatchTurn(agentName, prompt, turn);
        turn.end("success");
        return { turnId, response, rate_limit_errors: rateLimitErrors };
      } catch (err) {
        turn.end("error");
        // If the underlying send failure IS a rate-limit signal (unlikely
        // on the non-Discord bench path but captured here for symmetry),
        // classify it before throwing so the runner can still tally.
        if (isDiscordRateLimitError(err)) {
          rateLimitErrors += 1;
        }
        const msg = err instanceof Error ? err.message : "unknown bench error";
        throw new ManagerError(`bench-run-prompt failed: ${msg}`);
      }
    }

    case "memory-list": {
      const agentName = validateStringParam(params, "agent");
      const limit = typeof params.limit === "number" ? params.limit : 20;

      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(`Memory store not found for agent '${agentName}' (agent may not be running)`);
      }

      const entries = store.listRecent(limit);
      return {
        entries: entries.map((e) => ({
          id: e.id,
          content: e.content,
          source: e.source,
          importance: e.importance,
          accessCount: e.accessCount,
          tier: e.tier,
          createdAt: e.createdAt,
          accessedAt: e.accessedAt,
        })),
      };
    }

    case "episode-list": {
      const agentName = validateStringParam(params, "agent");
      const limit = typeof params.limit === "number" ? params.limit : 20;
      const countOnly = params.count === true;

      const episodeStore = manager.getEpisodeStore(agentName);
      if (!episodeStore) {
        throw new ManagerError(`Episode store not found for agent '${agentName}' (agent may not be running)`);
      }

      if (countOnly) {
        return { count: episodeStore.getEpisodeCount() };
      }

      const episodes = episodeStore.listEpisodes(limit);
      return {
        episodes: episodes.map((e) => ({
          id: e.id,
          content: e.content,
          source: e.source,
          importance: e.importance,
          tags: e.tags,
          tier: e.tier,
          createdAt: e.createdAt,
        })),
      };
    }

    case "delivery-queue-status": {
      return {
        stats: deliveryQueue.getStats(),
        failed: deliveryQueue.getFailedEntries(20),
      };
    }

    case "spawn-subagent-thread": {
      if (!subagentThreadSpawner) {
        throw new ManagerError("Subagent thread spawning requires Discord bridge");
      }
      const parentAgent = validateStringParam(params, "parentAgent");
      const threadName = validateStringParam(params, "threadName");
      const systemPrompt = typeof params.systemPrompt === "string" ? params.systemPrompt : undefined;
      const task = typeof params.task === "string" ? params.task : undefined;
      const model = typeof params.model === "string" ? params.model as "sonnet" | "opus" | "haiku" : undefined;
      // Phase 999.3 — D-EDG-04: empty string treated as not-set; D-ARC-02:
      // validate delegate exists at IPC boundary so the verbatim error
      // surfaces to the MCP caller (per Phase 85 TOOL-04 verbatim-error pattern).
      const delegateToRaw = typeof params.delegateTo === "string" ? params.delegateTo : undefined;
      const delegateTo = delegateToRaw && delegateToRaw.length > 0 ? delegateToRaw : undefined;
      if (delegateTo) {
        const delegateConfig = manager.getAgentConfig(delegateTo);
        if (!delegateConfig) {
          throw new ManagerError(`Delegate agent '${delegateTo}' not found in config`);
        }
      }
      // Phase 100 follow-up — post-reply chain.
      //   autoRelay (default true): parent gets a synthetic turn in main channel
      //   autoArchive (default false): also archive thread + stop session
      //   autoArchive implies autoRelay
      const autoArchive = params.autoArchive === true;
      const autoRelay = params.autoRelay === undefined
        ? true
        : params.autoRelay !== false;
      const result = await subagentThreadSpawner.spawnInThread({
        parentAgentName: parentAgent,
        threadName,
        systemPrompt,
        model,
        task,
        autoRelay,
        autoArchive,
        delegateTo,
      });
      // Register session end callback for automatic cleanup (SATH-04).
      // Phase 99 sub-scope M (2026-04-26) — also auto-relay completion to
      // parent agent BEFORE cleanup so the binding (parent agent + channel)
      // is still readable. Relay is fire-and-forget (errors logged, never
      // thrown) so cleanup always runs.
      //
      // Phase 999.25 — dedupe with the explicit `subagent_complete` tool
      // and the quiescence sweep. If `binding.completedAt` is already
      // set, both prior paths fired; skip the relay here to avoid a
      // duplicate post in the parent channel. Cleanup still runs.
      manager.registerSessionEndCallback(result.sessionName, async () => {
        try {
          const reg = await readThreadRegistry(THREAD_REGISTRY_PATH);
          const binding = getBindingForThread(reg, result.threadId);
          if (binding?.completedAt !== undefined && binding?.completedAt !== null) {
            logger.info(
              {
                component: "subagent-thread-spawner",
                action: "skip-session-end-relay",
                reason: "already-completed",
                threadId: result.threadId,
                sessionName: result.sessionName,
                completedAt: binding.completedAt,
              },
              "session-end relay skipped — completion already relayed",
            );
          } else {
            await subagentThreadSpawner.relayCompletionToParent(result.threadId);
          }
        } catch (err) {
          // Best-effort: relay failure must not block cleanup. Matches
          // the pre-Phase-999.25 fire-and-forget posture.
          logger.warn(
            {
              component: "subagent-thread-spawner",
              err: String(err),
              threadId: result.threadId,
              sessionName: result.sessionName,
            },
            "session-end relay errored (non-fatal); cleanup continues",
          );
        }
        await subagentThreadSpawner.cleanupSubagentThread(result.threadId);
      });
      return { ok: true, ...result };
    }

    case "cleanup-subagent-thread": {
      if (!subagentThreadSpawner) {
        throw new ManagerError("Subagent thread spawning requires Discord bridge");
      }
      const threadId = validateStringParam(params, "threadId");
      await subagentThreadSpawner.cleanupSubagentThread(threadId);
      return { ok: true };
    }

    case "archive-discord-thread": {
      // Phase 100 follow-up — operator/agent-driven Discord thread archive +
      // auto-prune the thread-bindings.json registry entry.
      //
      // Phase 999.14 MCP-08 — now routed through cleanupThreadWithClassifier
      // so Discord 50001 (Missing Access) and 10003 (Unknown Channel) — both
      // indicating the thread is gone server-side — prune the registry entry
      // instead of throwing. Returns success-with-classification on every
      // path (CLI uses classification to print the right message).
      if (!subagentThreadSpawner) {
        throw new ManagerError("Discord thread archive requires Discord bridge");
      }
      const threadId = validateStringParam(params, "threadId");
      const lock = params.lock === true;
      // Resolve agentName for log triage (operator regression — fin-acq vs fin-test).
      let agentName = "(unknown)";
      try {
        const reg = await readThreadRegistry(THREAD_REGISTRY_PATH);
        agentName = getBindingForThread(reg, threadId)?.agentName ?? "(unknown)";
      } catch {
        /* best-effort — non-fatal if registry read fails */
      }
      const result = await cleanupThreadWithClassifier({
        spawner: subagentThreadSpawner,
        registryPath: THREAD_REGISTRY_PATH,
        threadId,
        agentName,
        log: logger,
        lock,
      });
      return { ok: true, ...result };
    }

    case "threads-prune-stale": {
      // Phase 999.14 MCP-10 — operator escape hatch: run the stale-binding
      // sweep on demand with an operator-supplied threshold (overrides the
      // daemon-wide defaults.threadIdleArchiveAfter).
      if (!subagentThreadSpawner) {
        throw new ManagerError("Stale-binding prune requires Discord bridge");
      }
      const staleAfter = validateStringParam(params, "staleAfter");
      const idleMs = parseIdleDuration(staleAfter);
      const result = await sweepStaleBindings({
        spawner: subagentThreadSpawner,
        registryPath: THREAD_REGISTRY_PATH,
        now: Date.now(),
        idleMs,
        log: logger,
      });
      return { ok: true, ...result };
    }

    case "threads-prune-agent": {
      // Phase 999.14 MCP-10 — last-resort operator escape hatch. Force-prunes
      // ALL bindings for the named agent without calling Discord. Used when
      // the registry has bindings whose Discord state is unknown / unreachable
      // (today's incident: 3 fin-acquisition bindings, all Discord-50001).
      const agentName = validateStringParam(params, "agent");
      const reg = await readThreadRegistry(THREAD_REGISTRY_PATH);
      const bindings = getBindingsForAgent(reg, agentName);
      let next = reg;
      for (const b of bindings) {
        next = removeBinding(next, b.threadId);
      }
      if (next !== reg) {
        await writeThreadRegistry(THREAD_REGISTRY_PATH, next);
      }
      logger.info(
        {
          component: "thread-cleanup",
          action: "force-prune-agent",
          agent: agentName,
          prunedCount: bindings.length,
        },
        "force-pruned all bindings for agent (no Discord call)",
      );
      return { ok: true, prunedCount: bindings.length };
    }

    case "schedule-reminder": {
      // Phase 100 follow-up (operator-surfaced 2026-04-27) — backs the
      // `schedule_reminder` MCP tool. Agents promise "ping me at 7:58 PM"
      // but had no scheduling primitive — the reminder leaked into context
      // and bled into the next inbound turn instead of firing as its own
      // standalone message. This routes through SchedulerSource +
      // TriggerEngine + the f984008 delivery callback, so the agent's reply
      // posts to its bound Discord channel.
      //
      // Accepts `at` as either ISO 8601 (`2026-04-27T19:58:00-07:00`) or a
      // relative expression ("in 15 min", "in 2 hours", "in 30s", "in 3
      // days"). In-memory only — daemon restart loses pending reminders.
      const agentName = validateStringParam(params, "agent");
      const prompt = validateStringParam(params, "prompt");
      const atRaw = validateStringParam(params, "at");

      let fireAt: Date;
      const relMatch = atRaw.match(
        /^in\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)$/i,
      );
      if (relMatch) {
        const n = parseInt(relMatch[1]!, 10);
        const unit = relMatch[2]!.toLowerCase();
        let ms: number;
        if (unit.startsWith("s")) ms = n * 1000;
        else if (unit.startsWith("m")) ms = n * 60 * 1000;
        else if (unit.startsWith("h")) ms = n * 60 * 60 * 1000;
        else if (unit.startsWith("d")) ms = n * 24 * 60 * 60 * 1000;
        else throw new ManagerError(`Unsupported time unit: ${unit}`);
        fireAt = new Date(Date.now() + ms);
      } else {
        fireAt = new Date(atRaw);
        if (isNaN(fireAt.getTime())) {
          throw new ManagerError(
            `Invalid 'at' format. Use ISO 8601 (e.g. 2026-04-27T19:58:00-07:00) or relative ("in 15 min").`,
          );
        }
      }

      const result = await schedulerSource.addOneShotReminder({
        fireAt,
        agentName,
        prompt,
      });
      return {
        ok: true,
        reminderId: result.reminderId,
        fireAt: fireAt.toISOString(),
      };
    }

    case "approve-command": {
      const agentName = validateStringParam(params, "agent");
      const command = validateStringParam(params, "command");
      const approvedBy = typeof params.approvedBy === "string" ? params.approvedBy : "ipc";
      await approvalLog.record({ timestamp: new Date().toISOString(), agentName, command, decision: "approved", approvedBy });
      return { ok: true };
    }

    case "deny-command": {
      const agentName = validateStringParam(params, "agent");
      const command = validateStringParam(params, "command");
      const approvedBy = typeof params.approvedBy === "string" ? params.approvedBy : "ipc";
      await approvalLog.record({ timestamp: new Date().toISOString(), agentName, command, decision: "denied", approvedBy });
      return { ok: true };
    }

    case "allow-always": {
      const agentName = validateStringParam(params, "agent");
      const pattern = validateStringParam(params, "pattern");
      const approvedBy = typeof params.approvedBy === "string" ? params.approvedBy : "ipc";
      await approvalLog.recordAllowAlways(agentName, pattern, approvedBy);
      const matcher = allowlistMatchers.get(agentName);
      if (matcher) matcher.addAllowAlways(pattern);
      return { ok: true };
    }

    case "check-command": {
      const agentName = validateStringParam(params, "agent");
      const command = validateStringParam(params, "command");
      const matcher = allowlistMatchers.get(agentName);
      if (!matcher) return { allowed: true, reason: "no-allowlist-configured" };
      const result = matcher.check(command);
      return { allowed: result.allowed, matchedPattern: result.matchedPattern };
    }

    case "update-security": {
      const targetAgent = validateStringParam(params, "agent");
      const content = validateStringParam(params, "content");
      const config = configs.find(c => c.name === targetAgent);
      if (!config) throw new ManagerError(`Agent '${targetAgent}' not found`);
      const securityPath = join(config.workspace, "SECURITY.md");
      await writeFile(securityPath, content, "utf-8");
      // Re-parse and update in-memory policies
      const newAcls = await parseSecurityMd(securityPath);
      const existingPolicy = securityPolicies.get(targetAgent);
      securityPolicies.set(targetAgent, { allowlist: existingPolicy?.allowlist ?? [], channelAcls: newAcls });
      return { ok: true };
    }

    case "security-status": {
      const agentFilter = typeof params.agent === "string" ? params.agent : undefined;
      const statuses: Record<string, unknown> = {};
      for (const config of configs) {
        if (agentFilter && config.name !== agentFilter) continue;
        const matcher = allowlistMatchers.get(config.name);
        const policy = securityPolicies.get(config.name);
        statuses[config.name] = {
          allowlistPatterns: config.security?.allowlist?.map(e => e.pattern) ?? [],
          allowAlwaysPatterns: matcher?.getAllowAlwaysPatterns() ?? [],
          channelAcls: policy?.channelAcls ?? [],
        };
      }
      return { agents: statuses };
    }

    case "mcp-servers": {
      const agentFilter = typeof params.agent === "string" ? params.agent : undefined;
      const check = params.check === true;

      type McpServerEntry = {
        readonly agent: string;
        readonly name: string;
        readonly command: string;
        readonly args: readonly string[];
        readonly healthy: boolean | null;
        readonly latencyMs?: number;
        readonly error?: string;
      };

      const entries: McpServerEntry[] = [];

      for (const config of configs) {
        if (agentFilter && config.name !== agentFilter) continue;
        const mcpServers = config.mcpServers ?? [];
        for (const server of mcpServers) {
          if (check) {
            const { checkMcpServerHealth } = await import("../mcp/health.js");
            const result = await checkMcpServerHealth(server);
            entries.push({
              agent: config.name,
              name: server.name,
              command: server.command,
              args: server.args,
              healthy: result.healthy,
              latencyMs: result.latencyMs,
              ...(result.error !== undefined ? { error: result.error } : {}),
            });
          } else {
            entries.push({
              agent: config.name,
              name: server.name,
              command: server.command,
              args: server.args,
              healthy: null,
            });
          }
        }
      }

      return { servers: entries };
    }

    case "list-mcp-status": {
      // Phase 85 Plan 01 TOOL-01 — per-agent MCP state snapshot.
      // Returns the live state map maintained by the warm-path gate +
      // `mcp-reconnect` heartbeat check. No probe spawn; this is a pure
      // read of the in-memory map.
      //
      // Phase 94 Plan 01 — payload extension: each entry now carries
      // an additional `capabilityProbe` field (additive-optional) sourced
      // from the per-server CapabilityProbeSnapshot written by the
      // mcp-reconnect heartbeat. Phase 85 readers that don't consult
      // capabilityProbe continue to work unchanged.
      //
      // Phase 94 Plan 07 D-07 / TOOL-12 — payload extension: each entry
      // also carries an `alternatives` array listing other agents whose
      // snapshot has the SAME server in capabilityProbe.status==="ready".
      // Computed daemon-side via findAlternativeAgents (94-04 helper) so
      // both /clawcode-tools and `clawcode mcp-status` render from the
      // same single-source-of-truth IPC payload (D-11 invariant).
      const agentName = validateStringParam(params, "agent");
      const state = manager.getMcpStateForAgent(agentName);
      const { findAlternativeAgents } = await import(
        "./find-alternative-agents.js"
      );
      // Build a one-shot McpStateProvider over all known agents (excluding
      // the querying agent itself — operators don't need "this agent" in
      // its own alternatives list). The toolToServer override returns the
      // server name verbatim because we already pass the server name as
      // the lookup key (skips the SDK-prefix heuristic which would mis-
      // tokenize server names containing underscores or hyphens).
      const allAgentNames = configs
        .filter((c) => !c.name.includes("-sub-") && !c.name.includes("-thread-"))
        .map((c) => c.name);
      const otherAgents = allAgentNames.filter((n) => n !== agentName);
      const altsProvider = {
        listAgents: () => otherAgents,
        getStateFor: (name: string) => manager.getMcpStateForAgent(name),
        toolToServer: (s: string) => s,
      };
      const servers = [...state.values()].map((s) => {
        const alternatives = findAlternativeAgents(s.name, altsProvider);
        return {
          name: s.name,
          status: s.status,
          lastSuccessAt: s.lastSuccessAt,
          lastFailureAt: s.lastFailureAt,
          failureCount: s.failureCount,
          optional: s.optional,
          lastError: s.lastError?.message ?? null,
          // Phase 94 Plan 01 — capability probe block (undefined until first
          // probe runs; serializes through JSON-RPC as null).
          ...(s.capabilityProbe !== undefined
            ? { capabilityProbe: s.capabilityProbe }
            : {}),
          // Phase 94 Plan 07 D-07 — alternatives is always present (frozen
          // empty array when no other agent has the server ready). Renderer
          // suppresses the line for ready servers itself; the wire payload
          // carries the data unconditionally for symmetry.
          alternatives: [...alternatives],
        };
      });
      return { agent: agentName, servers };
    }

    case "mcp-probe": {
      // Phase 94 Plan 01 TOOL-01 — on-demand capability probe trigger.
      // Operator runs `clawcode mcp-probe -a <agent>` to force an immediate
      // probe of all configured MCP servers. The boot + 60s heartbeat
      // schedule continues unaffected; this just runs an extra cycle now.
      //
      // Phase 94 Plan 01 Gap-Closure 2 — real callTool / listTools wired
      // at the daemon edge via JSON-RPC stdio (src/mcp/json-rpc-call.ts).
      // Connect-test runs first; for ready/degraded servers the capability
      // probe issues a real tools/list against each MCP subprocess.
      // capability-probe.ts itself stays DI-pure — this is the production
      // injection site.
      const agentName = validateStringParam(params, "agent");
      const cfg = manager.getAgentConfig(agentName);
      if (!cfg) {
        throw new ManagerError(`agent '${agentName}' not configured`);
      }
      const mcpServers = cfg.mcpServers ?? [];
      const priorState = manager.getMcpStateForAgent(agentName);

      // Re-run the connect-test first (same primitive as the warm-path
      // gate + heartbeat) so we have an authoritative status to mirror
      // into capabilityProbe for failed servers.
      const { performMcpReadinessHandshake } = await import(
        "../mcp/readiness.js"
      );
      const { probeAllMcpCapabilities } = await import(
        "./capability-probe.js"
      );
      const { makeRealCallTool, makeRealListTools } = await import(
        "../mcp/json-rpc-call.js"
      );
      // Phase 999.27 — skip broker-pooled servers from on-demand probes.
      // The 1password broker shim probe would spawn with daemon-default
      // env (clawdbot token), causing broker rebind cycles. Broker has
      // its own heartbeat at `heartbeat/checks/mcp-broker.ts`.
      const probableServers = (
        await import("../mcp/broker-shim-detect.js")
      ).filterOutBrokerPooled(mcpServers);
      const rep = await performMcpReadinessHandshake(probableServers);

      // Carry prior capabilityProbe blocks for lastSuccessAt preservation.
      const prevProbeByName = new Map<
        string,
        import("../mcp/readiness.js").CapabilityProbeSnapshot
      >();
      for (const [name, prior] of priorState) {
        if (prior.capabilityProbe) {
          prevProbeByName.set(name, prior.capabilityProbe);
        }
      }

      const probeLog = (await import("pino")).default({ level: "silent" });
      const serversByName = new Map(
        probableServers.map((s) => [
          s.name,
          {
            name: s.name,
            command: s.command,
            args: s.args,
            env: s.env,
          },
        ]),
      );
      const realListTools = makeRealListTools(serversByName);
      const realCallTool = makeRealCallTool(serversByName);
      const probeDeps = {
        callTool: realCallTool,
        listTools: realListTools,
        // Default-fallback override per heartbeat: verify capability via
        // tools/list response. Plan 94-03 will lift this per-server as
        // registry probes are vetted to be safe to call in production.
        getProbeFor: () => async (innerDeps: {
          listTools: (s: string) => Promise<readonly { readonly name: string }[]>;
        }) => {
          try {
            const tools = await innerDeps.listTools("__on_demand_probe__");
            if (tools.length === 0) {
              return { kind: "failure" as const, error: "no tools exposed" };
            }
            return { kind: "ok" as const };
          } catch (err) {
            return {
              kind: "failure" as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
        now: () => new Date(),
        log: probeLog,
      };

      const readyOrDegradedNames: string[] = [];
      for (const [name, fresh] of rep.stateByName) {
        if (fresh.status !== "failed") readyOrDegradedNames.push(name);
      }

      const probeResults = readyOrDegradedNames.length > 0
        ? await probeAllMcpCapabilities(
            readyOrDegradedNames,
            // The orchestrator's getProbeFor signature returns a ProbeFn
            // so the inline closure above is the right shape; cast the
            // deps object to the ProbeOrchestratorDeps shape.
            probeDeps as unknown as Parameters<typeof probeAllMcpCapabilities>[1],
            prevProbeByName,
          )
        : new Map<string, import("../mcp/readiness.js").CapabilityProbeSnapshot>();

      // Build merged state: connect-fail mirrors into capabilityProbe;
      // connect-ok takes the probe result.
      type McpState = import("../mcp/readiness.js").McpServerState;
      type ProbeSnap = import("../mcp/readiness.js").CapabilityProbeSnapshot;
      const merged = new Map<string, McpState>();
      const nowIso = new Date().toISOString();
      for (const [name, fresh] of rep.stateByName) {
        let probe: ProbeSnap;
        if (fresh.status === "failed") {
          const priorProbe = prevProbeByName.get(name);
          probe = {
            lastRunAt: nowIso,
            status: "failed",
            ...(fresh.lastError?.message
              ? { error: fresh.lastError.message }
              : {}),
            ...(priorProbe?.lastSuccessAt !== undefined
              ? { lastSuccessAt: priorProbe.lastSuccessAt }
              : {}),
          };
        } else {
          probe = probeResults.get(name) ?? {
            lastRunAt: nowIso,
            status: "unknown",
          };
        }
        merged.set(name, Object.freeze({ ...fresh, capabilityProbe: probe }));
      }

      manager.setMcpStateForAgent(agentName, merged);

      // Return the capabilityProbe snapshots verbatim so the CLI can
      // render them directly.
      const servers = [...merged.values()].map((s) => ({
        name: s.name,
        status: s.status,
        capabilityProbe: s.capabilityProbe,
        lastError: s.lastError?.message ?? null,
        optional: s.optional,
      }));
      return { agent: agentName, servers };
    }

    case "list-sync-status": {
      // Phase 91 Plan 05 SYNC-08 — OpenClaw ↔ ClawCode sync snapshot.
      //
      // Reads two on-disk artifacts produced by Plan 91-01/02:
      //   - ~/.clawcode/manager/sync-state.json → authoritativeSide,
      //     conflicts[], lastSyncedAt (SyncStateFile from src/sync/types.ts)
      //   - ~/.clawcode/manager/sync.jsonl (last line) → last cycle outcome
      //     (filesAdded/Updated/Removed/Bytes/Duration/status/cycleId)
      //
      // Consumed by the /clawcode-sync-status inline handler in
      // slash-commands.ts (Phase 85 /clawcode-tools blueprint mirrored
      // verbatim). Zero LLM turn cost — pure file reads, no network.
      //
      // Missing/unparseable files fall back to DEFAULT_SYNC_STATE +
      // lastCycle:null respectively (never throws to the IPC caller).
      const { readSyncState, DEFAULT_SYNC_STATE_PATH, DEFAULT_SYNC_JSONL_PATH } =
        await import("../sync/sync-state-store.js");

      const state = await readSyncState(DEFAULT_SYNC_STATE_PATH, logger);
      const openConflicts = state.conflicts.filter((c) => c.resolvedAt === null);

      let lastCycle: Record<string, unknown> | null = null;
      try {
        const raw = await readFile(DEFAULT_SYNC_JSONL_PATH, "utf8");
        const lines = raw.trim().split("\n").filter((l) => l.length > 0);
        if (lines.length > 0) {
          const parsed = JSON.parse(lines[lines.length - 1]!) as unknown;
          if (parsed && typeof parsed === "object") {
            lastCycle = parsed as Record<string, unknown>;
          }
        }
      } catch (err) {
        // Missing jsonl is the first-boot path — silent. Other failures
        // (corrupt JSON, permission) warn but still return a snapshot so
        // the embed can render "never-run".
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          logger.warn(
            {
              path: DEFAULT_SYNC_JSONL_PATH,
              error: err instanceof Error ? err.message : String(err),
            },
            "list-sync-status: failed to read sync.jsonl, returning lastCycle=null",
          );
        }
      }

      return {
        authoritativeSide: state.authoritativeSide,
        lastSyncedAt: state.lastSyncedAt,
        conflictCount: openConflicts.length,
        conflicts: openConflicts.map((c) => ({
          path: c.path,
          sourceHash: c.sourceHash,
          destHash: c.destHash,
          detectedAt: c.detectedAt,
        })),
        lastCycle,
      };
    }

    case "ask-advisor": {
      const agentName = validateStringParam(params, "agent");
      const question = validateStringParam(params, "question");

      // Check budget before doing any expensive work
      if (!advisorBudget.canCall(agentName)) {
        throw new ManagerError(
          `Advisor budget exhausted for agent '${agentName}' (0 calls remaining today)`,
        );
      }

      // Retrieve top 5 relevant memories for context
      let memoryContext = "";
      const store = manager.getMemoryStore(agentName);
      if (store) {
        try {
          const embedder = manager.getEmbedder();
          const queryEmbedding = await embedder.embed(question);
          const search = new SemanticSearch(store.getDatabase());
          const results = search.search(queryEmbedding, 5);
          if (results.length > 0) {
            memoryContext = results
              .map((r, i) => `[${i + 1}] ${r.content}`)
              .join("\n");
          }
        } catch {
          // Memory search failure is non-fatal for advisor
        }
      }

      // Fork a session with opus model for one-shot advice
      const systemPrompt = [
        `You are an advisor to agent "${agentName}". Provide concise, actionable guidance.`,
        ...(memoryContext
          ? ["\nRelevant context from agent's memory:", memoryContext]
          : []),
      ].join("\n");

      const fork = await manager.forkSession(agentName, {
        modelOverride: "opus" as const,
        systemPromptOverride: systemPrompt,
      });

      let answer: string;
      try {
        answer = await manager.dispatchTurn(fork.forkName, question);
      } finally {
        // Always clean up the fork
        await manager.stopAgent(fork.forkName).catch(() => {});
      }

      // Truncate response to 2000 chars
      if (answer.length > ADVISOR_RESPONSE_MAX_LENGTH) {
        answer = answer.slice(0, ADVISOR_RESPONSE_MAX_LENGTH);
      }

      // Record the call after success
      advisorBudget.recordCall(agentName);
      const budgetRemaining = advisorBudget.getRemaining(agentName);

      return { answer, budget_remaining: budgetRemaining };
    }

    case "set-model": {
      // Phase 86 Plan 02 MODEL-04 — delegate to the pure testable handler.
      // Live SDK swap fires FIRST (Plan 01 SessionHandle.setModel); atomic
      // clawcode.yaml persist follows via the v2.1 writer pipeline. The old
      // next-session deferral note is retired — the live handle now swaps
      // in-turn, and next-boot persistence is handled by updateAgentModel.
      return await handleSetModelIpc({
        manager,
        configs: configs as ResolvedAgentConfig[],
        configPath,
        params,
      });
    }

    case "costs": {
      const period = typeof params.period === "string" ? params.period : "today";
      const now = new Date();
      let since: Date;
      switch (period) {
        case "today":
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case "week": {
          const dayOfWeek = now.getDay();
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          break;
        }
        case "month":
          since = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }
      const results: Array<{ agent: string; model: string; input_tokens: number; output_tokens: number; cost_usd: number }> = [];
      for (const agentName of manager.getRunningAgents()) {
        const tracker = manager.getUsageTracker(agentName);
        if (tracker) {
          const agentCosts = tracker.getCostsByAgentModel(since.toISOString(), now.toISOString());
          // CostByAgentModel uses `tokens_in/tokens_out`; the IPC wire shape
          // here uses `input_tokens/output_tokens`. Map field names rather
          // than push() the row directly.
          for (const row of agentCosts) {
            results.push({
              agent: row.agent,
              model: row.model,
              input_tokens: row.tokens_in,
              output_tokens: row.tokens_out,
              cost_usd: row.cost_usd,
            });
          }
        }
      }
      return { period, costs: results };
    }

    case "ingest-document": {
      const agentName = validateStringParam(params, "agent");
      const filePath = validateStringParam(params, "file_path");
      const source = typeof params.source === "string" && params.source.length > 0 ? params.source : filePath;

      const docStore = manager.getDocumentStore(agentName);
      if (!docStore) {
        throw new ManagerError(`Document store not found for agent '${agentName}' (agent may not be running)`);
      }

      const fileBuffer = await readFile(filePath);
      const chunks = filePath.endsWith(".pdf")
        ? await chunkPdf(fileBuffer)
        : chunkText(fileBuffer.toString("utf-8"));

      if (chunks.length === 0) {
        return { ok: true, source, chunks_created: 0, total_chars: 0 };
      }

      const embedder = manager.getEmbedder();
      const embeddings: Float32Array[] = [];
      for (const chunk of chunks) {
        embeddings.push(await embedder.embed(chunk.content));
      }

      const result = docStore.ingest(source, chunks, embeddings);
      return { ok: true, source, chunks_created: result.chunksCreated, total_chars: result.totalChars };
    }

    case "search-documents": {
      const agentName = validateStringParam(params, "agent");
      const query = validateStringParam(params, "query");
      const limit = typeof params.limit === "number" ? Math.min(Math.max(params.limit, 1), 20) : 5;
      const source = typeof params.source === "string" && params.source.length > 0 ? params.source : undefined;

      const docStore = manager.getDocumentStore(agentName);
      if (!docStore) {
        throw new ManagerError(`Document store not found for agent '${agentName}' (agent may not be running)`);
      }

      const embedder = manager.getEmbedder();
      const queryEmbedding = await embedder.embed(query);
      const results = docStore.search(queryEmbedding, limit, source);

      return {
        results: results.map((r) => ({
          chunk_id: r.chunkId,
          source: r.source,
          chunk_index: r.chunkIndex,
          content: r.content,
          similarity: r.similarity,
          context_before: r.contextBefore,
          context_after: r.contextAfter,
        })),
      };
    }

    case "delete-document": {
      const agentName = validateStringParam(params, "agent");
      const source = validateStringParam(params, "source");

      const docStore = manager.getDocumentStore(agentName);
      if (!docStore) {
        throw new ManagerError(`Document store not found for agent '${agentName}' (agent may not be running)`);
      }

      const count = docStore.deleteDocument(source);
      return { ok: true, source, chunks_deleted: count };
    }

    case "list-documents": {
      const agentName = validateStringParam(params, "agent");

      const docStore = manager.getDocumentStore(agentName);
      if (!docStore) {
        throw new ManagerError(`Document store not found for agent '${agentName}' (agent may not be running)`);
      }

      const sources = docStore.listSources();
      const totalChunks = docStore.getChunkCount();
      return { sources: [...sources], total_chunks: totalChunks };
    }

    case "message-history": {
      const agentName = validateStringParam(params, "agent");
      const limit = typeof params.limit === "number" ? params.limit : 50;
      const date = typeof params.date === "string" ? params.date : undefined;

      const config = configs.find(c => c.name === agentName);
      if (!config) {
        return { messages: [], dates: [] };
      }

      // Phase 75 SHARED-01 — memoryPath (not workspace) so the health-log
      // CLI reader loads each agent's private heartbeat.log / digests.
      const memoryDir = join(config.memoryPath, "memory");
      const { readdir, readFile } = await import("node:fs/promises");

      let logFiles: string[] = [];
      try {
        const files = await readdir(memoryDir);
        logFiles = files
          .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
          .sort()
          .reverse();
      } catch { /* no logs yet */ }

      const dates = logFiles.map(f => f.replace(".md", ""));
      const targetDate = date ?? dates[0];
      if (!targetDate) {
        return { messages: [], dates };
      }

      const filePath = join(memoryDir, `${targetDate}.md`);
      let content = "";
      try {
        content = await readFile(filePath, "utf-8");
      } catch {
        return { messages: [], dates };
      }

      const messages: Array<{ time: string; role: string; content: string }> = [];
      const sections = content.split(/^## /m).filter(Boolean);
      for (const section of sections) {
        const match = section.match(/^(\d{2}:\d{2}:\d{2})\s+\[(user|assistant)\]\n([\s\S]*)/);
        if (match) {
          messages.push({
            time: match[1],
            role: match[2],
            content: match[3].trim(),
          });
        }
      }

      const trimmed = messages.slice(-limit);
      return { messages: trimmed, dates, currentDate: targetDate };
    }

    case "read-thread": {
      const threadId = validateStringParam(params, "threadId");
      const limit = typeof params.limit === "number"
        ? Math.max(1, Math.min(100, Math.floor(params.limit)))
        : 20;

      const bridge = discordBridgeRef.current;
      if (!bridge) {
        throw new ManagerError("Discord bridge not available");
      }
      const channel = await bridge.discordClient.channels.fetch(threadId);
      if (!channel || !channel.isThread()) {
        throw new ManagerError(`Channel '${threadId}' is not a Discord thread`);
      }

      const collection = await channel.messages.fetch({ limit });
      const messages = [...collection.values()]
        .map((m) => {
          const embedContent = m.embeds?.[0]?.description;
          const embedFooter = m.embeds?.[0]?.footer?.text;
          return {
            id: m.id,
            author: m.author.username,
            authorId: m.author.id,
            bot: m.author.bot,
            webhookId: m.webhookId ?? null,
            content: m.content || embedContent || "",
            embedFooter: embedFooter ?? null,
            createdAt: m.createdAt.toISOString(),
            attachmentCount: m.attachments.size,
          };
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      return {
        threadId,
        threadName: "name" in channel ? channel.name : null,
        messageCount: messages.length,
        messages,
      };
    }

    case "memory-save": {
      const agentName = validateStringParam(params, "agent");
      const content = validateStringParam(params, "content");
      const tags = Array.isArray(params.tags) ? params.tags as string[] : [];
      const importance = typeof params.importance === "number" ? params.importance : 0.7;

      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(`Memory store not found for agent '${agentName}' (agent may not be running)`);
      }

      const embedder = manager.getEmbedder();
      const embedding = await embedder.embed(content);
      const entry = store.insert({ content, source: "conversation", importance, tags }, embedding);
      return { id: entry.id };
    }

    // ── Phase 115 sub-scope 7 — lazy-load memory tools ─────────────────
    //
    // The four MCP tool handlers. Each resolves the agent context via
    // `validateStringParam(params, "agent")` (mirrors memory-save / memory-
    // lookup), then dispatches to the pure tool function with the per-
    // agent MemoryStore. Cross-agent isolation is enforced at this
    // resolution layer.
    case "clawcode-memory-search": {
      const agentName = validateStringParam(params, "agent");
      // Phase 115 Plan 05 T04 — lazy_recall_call_count writer. Increment
      // FIRST so observability is recorded even if the handler throws on
      // an unknown agent or empty store. Best-effort — TraceCollector
      // method is missing on legacy daemons, hence the typeof guard
      // (mirrors session-config.ts recordTier1TruncationEvent pattern).
      const tcSearch = manager.getTraceCollector(agentName) as
        | (TraceCollector & {
            recordLazyRecallCall?: (agent: string, tool: string) => void;
          })
        | undefined;
      if (tcSearch && typeof tcSearch.recordLazyRecallCall === "function") {
        tcSearch.recordLazyRecallCall(agentName, "clawcode_memory_search");
      }

      const query = validateStringParam(params, "query");
      const k = typeof params.k === "number" ? params.k : 10;
      const includeTags = Array.isArray(params.includeTags)
        ? (params.includeTags as string[])
        : undefined;
      const excludeTags = Array.isArray(params.excludeTags)
        ? (params.excludeTags as string[])
        : undefined;

      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(
          `Memory store not found for agent '${agentName}' (agent may not be running)`,
        );
      }
      const embedder = manager.getEmbedder();
      const lazyLoadLog = logger.child({ component: "clawcode-memory-search" });

      const result = await clawcodeMemorySearch(
        { query, k, includeTags, excludeTags },
        { store, embedder, agentName, log: lazyLoadLog },
      );
      return result;
    }

    case "clawcode-memory-recall": {
      const agentName = validateStringParam(params, "agent");
      // Phase 115 Plan 05 T04 — lazy_recall_call_count writer.
      const tcRecall = manager.getTraceCollector(agentName) as
        | (TraceCollector & {
            recordLazyRecallCall?: (agent: string, tool: string) => void;
          })
        | undefined;
      if (tcRecall && typeof tcRecall.recordLazyRecallCall === "function") {
        tcRecall.recordLazyRecallCall(agentName, "clawcode_memory_recall");
      }

      const memoryId = validateStringParam(params, "memoryId");

      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(
          `Memory store not found for agent '${agentName}' (agent may not be running)`,
        );
      }

      const result = await clawcodeMemoryRecall(
        { memoryId },
        { store, agentName },
      );
      return result;
    }

    case "clawcode-memory-edit": {
      const agentName = validateStringParam(params, "agent");
      // Phase 115 Plan 05 T04 — lazy_recall_call_count writer.
      const tcEdit = manager.getTraceCollector(agentName) as
        | (TraceCollector & {
            recordLazyRecallCall?: (agent: string, tool: string) => void;
          })
        | undefined;
      if (tcEdit && typeof tcEdit.recordLazyRecallCall === "function") {
        tcEdit.recordLazyRecallCall(agentName, "clawcode_memory_edit");
      }

      const path = validateStringParam(params, "path") as "MEMORY.md" | "USER.md";
      const mode = validateStringParam(params, "mode") as
        | "view"
        | "create"
        | "str_replace"
        | "append";
      const oldStr = typeof params.oldStr === "string" ? params.oldStr : undefined;
      const newStr = typeof params.newStr === "string" ? params.newStr : undefined;
      const content = typeof params.content === "string" ? params.content : undefined;

      const cfg = manager.getAgentConfig(agentName) ?? configs.find((a) => a.name === agentName);
      const memoryRoot = cfg?.memoryPath ?? cfg?.workspace ?? "";
      if (memoryRoot.length === 0) {
        throw new ManagerError(
          `Memory root not found for agent '${agentName}' (agent may not be configured)`,
        );
      }

      const editLog = logger.child({ component: "clawcode-memory-edit" });
      const result = await clawcodeMemoryEdit(
        { path, mode, oldStr, newStr, content },
        {
          memoryRoot,
          agentName,
          log: {
            warn: (obj, msg) => editLog.warn(obj, msg),
            error: (obj, msg) => editLog.error(obj, msg),
          },
        },
      );
      return result;
    }

    case "clawcode-memory-archive": {
      const agentName = validateStringParam(params, "agent");
      // Phase 115 Plan 05 T04 — lazy_recall_call_count writer.
      const tcArchive = manager.getTraceCollector(agentName) as
        | (TraceCollector & {
            recordLazyRecallCall?: (agent: string, tool: string) => void;
          })
        | undefined;
      if (tcArchive && typeof tcArchive.recordLazyRecallCall === "function") {
        tcArchive.recordLazyRecallCall(agentName, "clawcode_memory_archive");
      }

      const chunkId = validateStringParam(params, "chunkId");
      const targetPath = validateStringParam(params, "targetPath") as
        | "MEMORY.md"
        | "USER.md";
      const wrappingPrefix =
        typeof params.wrappingPrefix === "string" ? params.wrappingPrefix : undefined;
      const wrappingSuffix =
        typeof params.wrappingSuffix === "string" ? params.wrappingSuffix : undefined;

      const store = manager.getMemoryStore(agentName);
      if (!store) {
        throw new ManagerError(
          `Memory store not found for agent '${agentName}' (agent may not be running)`,
        );
      }
      const cfg = manager.getAgentConfig(agentName) ?? configs.find((a) => a.name === agentName);
      const memoryRoot = cfg?.memoryPath ?? cfg?.workspace ?? "";
      if (memoryRoot.length === 0) {
        throw new ManagerError(
          `Memory root not found for agent '${agentName}' (agent may not be configured)`,
        );
      }

      const archiveLog = logger.child({ component: "clawcode-memory-archive" });
      const result = await clawcodeMemoryArchive(
        { chunkId, targetPath, wrappingPrefix, wrappingSuffix },
        {
          store,
          memoryRoot,
          agentName,
          log: {
            info: (obj, msg) => archiveLog.info(obj, msg),
            warn: (obj, msg) => archiveLog.warn(obj, msg),
            error: (obj, msg) => archiveLog.error(obj, msg),
          },
        },
      );
      return result;
    }

    case "memory-graph": {
      // Phase 999.8 Plan 01 — body extracted into a pure helper so the
      // optional `limit` param contract (default 5000, range [1, 50000])
      // is unit-testable without standing up a full MemoryStore. Mirrors
      // the handleSetModelIpc / invokeMemoryLookup extraction pattern.
      const agentName = validateStringParam(params, "agent");
      const store = manager.getMemoryStore(agentName);
      if (!store) {
        return { nodes: [], links: [] };
      }
      return handleMemoryGraphIpc(params, store.getDatabase());
    }

    case "tier-maintenance-tick": {
      // Phase 999.8 follow-up (2026-04-30) — operator-triggered tier
      // backfill. When `agent` is set, runs maintenance for that one agent.
      // When omitted, runs maintenance for every agent that has a
      // TierManager (the natural set: agents with memory). Returns the
      // per-agent {promoted, demoted, archived} counts so the CLI can
      // print a one-line summary. Heartbeat-driven tier-maintenance
      // (every 6h) still runs unaffected — this is purely an on-demand
      // shortcut so a fresh deploy doesn't have to wait for the first tick.
      const agentParam = typeof params.agent === "string" ? params.agent : undefined;
      const targetNames: readonly string[] = agentParam
        ? [agentParam]
        : Array.from(manager.tierManagerNames());
      const results: Record<string, { promoted: number; demoted: number; archived: number }> = {};
      const skipped: string[] = [];
      for (const name of targetNames) {
        const tm = manager.getTierManager(name);
        if (!tm) {
          skipped.push(name);
          continue;
        }
        const r = tm.runMaintenance();
        results[name] = { promoted: r.promoted, demoted: r.demoted, archived: r.archived };
      }
      return { results, skipped };
    }

    case "agent-create": {
      const name = validateStringParam(params, "name");
      const soul = validateStringParam(params, "soul");
      const parentChannelId = validateStringParam(params, "parentChannelId");
      const invokerUserId = validateStringParam(params, "invokerUserId");
      const model = typeof params.model === "string" ? params.model : undefined;

      const adminIds = (process.env.CLAWCODE_ADMIN_DISCORD_USER_IDS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (adminIds.length === 0 || !adminIds.includes(invokerUserId)) {
        throw new ManagerError("Not authorized to create agents");
      }

      const bridge = discordBridgeRef.current;
      if (!bridge) {
        throw new ManagerError("Discord bridge not available");
      }
      const client = bridge.discordClient;

      const parent = await client.channels.fetch(parentChannelId);
      if (!parent || parent.type !== ChannelType.GuildText) {
        throw new ManagerError("Invocation channel is not a guild text channel");
      }
      const guild = (parent as TextChannel).guild;
      const categoryId = (parent as TextChannel).parentId ?? undefined;
      const category = categoryId
        ? ((await client.channels.fetch(categoryId).catch(() => null)) as CategoryChannel | null)
        : null;

      const newChannel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category?.id ?? null,
        topic: `ClawCode agent: ${name}`,
      });

      try {
        const result = await provisionAgent(
          { name, soul, model, channelId: newChannel.id },
          { configPath, agentsBasePath },
        );
        return {
          ok: true,
          name: result.name,
          model: result.model,
          channelId: newChannel.id,
          channelUrl: `https://discord.com/channels/${guild.id}/${newChannel.id}`,
          workspace: result.workspace,
        };
      } catch (err) {
        await (newChannel as GuildTextBasedChannel).delete(`agent-create failed: ${(err as Error).message}`).catch(() => {});
        throw err;
      }
    }

    // Phase 59 — cross-agent RPC / handoff IPC cases
    case "delegate-task": {
      const caller = validateStringParam(params, "caller");
      const target = validateStringParam(params, "target");
      const schema = validateStringParam(params, "schema");
      const payload = params.payload;
      const deadline_ms = typeof params.deadline_ms === "number" ? params.deadline_ms : undefined;
      const budgetOwner = typeof params.budgetOwner === "string" ? params.budgetOwner : undefined;
      const parentTaskId = typeof params.parent_task_id === "string" ? params.parent_task_id : undefined;
      return await taskManager.delegate({ caller, target, schema, payload, deadline_ms, budgetOwner, parentTaskId });
    }
    case "task-status": {
      const task_id = validateStringParam(params, "task_id");
      return taskManager.getStatus(task_id);
    }
    case "cancel-task": {
      const task_id = validateStringParam(params, "task_id");
      const caller = validateStringParam(params, "caller");
      await taskManager.cancel(task_id, caller);
      return { ok: true };
    }
    case "task-complete": {
      const task_id = validateStringParam(params, "task_id");
      const result = params.result;
      const chain_token_cost = typeof params.chain_token_cost === "number" ? params.chain_token_cost : 0;
      await taskManager.completeTask(task_id, result, chain_token_cost);
      return { ok: true };
    }
    case "task-retry": {
      const task_id = validateStringParam(params, "task_id");
      const response = await taskManager.retry(task_id);
      return response;
    }

    case "list-tasks": {
      const now = Date.now();
      const recentWindowMs = 30_000; // Show completed tasks for 30s
      const rows = taskStore.rawDb.prepare(
        `SELECT task_id, caller_agent, target_agent, status, started_at, ended_at, chain_token_cost
         FROM tasks
         WHERE status IN ('pending','running','awaiting_input')
            OR (ended_at > ? AND status IN ('complete','failed','cancelled','timed_out','orphaned'))
         ORDER BY started_at DESC`
      ).all(now - recentWindowMs);
      return { tasks: rows };
    }

    default:
      throw new ManagerError(`Unknown method: ${method}`);
  }
}

/**
 * Validate and extract a required string parameter.
 */
function validateStringParam(
  params: Record<string, unknown>,
  key: string,
): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ManagerError(`Missing required parameter: ${key}`);
  }
  return value;
}

/**
 * Phase 52 Plan 03: compute the `cache_effect_ms` delta for the Prompt Cache
 * panel / CLI / IPC `cache` response.
 *
 * Returns:
 *   - `null` when the window has < 20 eligible turns (noise floor — CONTEXT
 *     D-05). Model latency variance is too high below this sample size to
 *     trust the delta.
 *   - `null` when either the hit-average or miss-average is NULL (only one
 *     branch of the cache-hit/miss split has data).
 *   - `hitAvgMs - missAvgMs` otherwise. Negative values are the expected
 *     signal (cached turns are faster). A positive value after 20+ turns
 *     triggers a WARN log at the call site.
 */
export function computeCacheEffectMs(
  store: TraceStore,
  agentName: string,
  sinceIso: string,
): number | null {
  const stats = store.getCacheEffectStats(agentName, sinceIso);
  if (stats.eligibleTurns < 20) return null;
  if (stats.hitAvgMs === null || stats.missAvgMs === null) return null;
  return stats.hitAvgMs - stats.missAvgMs;
}
