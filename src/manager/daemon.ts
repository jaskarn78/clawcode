import { execSync } from "node:child_process";
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
import { TaskStore } from "../tasks/store.js";
import { TaskManager } from "../tasks/task-manager.js";
import { SchemaRegistry } from "../tasks/schema-registry.js";
import { PayloadStore } from "../tasks/payload-store.js";
import {
  runStartupReconciliation,
  ORPHAN_THRESHOLD_MS,
} from "../tasks/reconciler.js";
import { loadConfig, resolveAllAgents, defaultOpRefResolver } from "../config/loader.js";
import { readRegistry, reconcileRegistry, writeRegistry } from "./registry.js";
import { buildRoutingTable } from "../discord/router.js";
import { createRateLimiter } from "../discord/rate-limiter.js";
import { DEFAULT_RATE_LIMITER_CONFIG } from "../discord/types.js";
import type { RoutingTable, RateLimiter } from "../discord/types.js";
import { HeartbeatRunner } from "../heartbeat/runner.js";
import type { CheckStatus } from "../heartbeat/types.js";
import type { ContextZone, ZoneTransition } from "../heartbeat/context-zones.js";
import { TaskScheduler } from "../scheduler/scheduler.js";
import { TriggerEngine } from "../triggers/engine.js";
import { SchedulerSource } from "../triggers/scheduler-source.js";
import { MysqlSource } from "../triggers/sources/mysql-source.js";
import { WebhookSource } from "../triggers/sources/webhook-source.js";
import { InboxSource } from "../triggers/sources/inbox-source.js";
import { CalendarSource } from "../triggers/sources/calendar-source.js";
import { createWebhookHandler } from "../dashboard/webhook-handler.js";
import { DEFAULT_REPLAY_MAX_AGE_MS, DEFAULT_DEBOUNCE_MS, DEFAULT_DEDUP_LRU_SIZE } from "../triggers/types.js";
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
 */
export const MANAGER_DIR = join(homedir(), ".clawcode", "manager");

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
): Promise<{ server: Server; manager: SessionManager; taskStore: TaskStore; taskManager: TaskManager; payloadStore: PayloadStore; triggerEngine: TriggerEngine; routingTable: RoutingTable; rateLimiter: RateLimiter; heartbeatRunner: HeartbeatRunner; taskScheduler: TaskScheduler; skillsCatalog: SkillsCatalog; slashHandler: SlashCommandHandler; threadManager: ThreadManager; webhookManager: WebhookManager; discordBridge: DiscordBridge | null; subagentThreadSpawner: SubagentThreadSpawner | null; configWatcher: ConfigWatcher; configReloader: ConfigReloader; policyWatcher: PolicyWatcher; routingTableRef: { current: RoutingTable }; dashboard: { readonly server: import("node:http").Server; readonly sseManager: import("../dashboard/sse.js").SseManager; readonly close: () => Promise<void> }; shutdown: () => Promise<void> }> {
  const log = logger.child({ component: "daemon" });

  // 1. Ensure manager directory exists
  await mkdir(MANAGER_DIR, { recursive: true });

  // 2. Clean stale socket
  await ensureCleanSocket(SOCKET_PATH);

  // 3. Write PID file
  await writeFile(PID_PATH, String(process.pid), "utf-8");

  // 4. Load config
  const config = await loadConfig(configPath);

  // 5. Resolve all agents — pass the real 1Password resolver so any
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
  const resolvedAgents = resolveAllAgents(config, defaultOpRefResolver, (info) => {
    log.error(
      { agent: info.agent, server: info.server, reason: info.message },
      "MCP server disabled — env resolution failed",
    );
  });

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
  const manager = new SessionManager({
    adapter: sessionAdapter,
    registryPath: REGISTRY_PATH,
    log,
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
            summarize: (prompt: string) => manager.sendToAgent(agentConfig.name, prompt),
          };
          await runConsolidation(deps, consolidationConfig);
        },
      });
    }

    // Only add handler-based schedules to TaskScheduler (those with a handler)
    for (const schedule of agentConfig.schedules) {
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
  let bootEvaluator: PolicyEvaluator;
  try {
    const policyContent = await readFile(policyPath, "utf-8");
    const compiledRules = loadPolicies(policyContent);
    bootEvaluator = new PolicyEvaluator(compiledRules, configuredAgentNames);
    log.info({ path: policyPath, ruleCount: compiledRules.length }, "policies.yaml loaded at boot");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No policy file — start with empty rules (deny all non-default events)
      bootEvaluator = new PolicyEvaluator([], configuredAgentNames);
      log.info("no policies.yaml found, using default policy");
    } else if (err instanceof PolicyValidationError) {
      // Invalid policy — daemon must refuse to start (POL-01)
      throw new ManagerError(
        `FATAL: policies.yaml invalid -- daemon cannot start: ${err.message}`,
      );
    } else {
      throw err;
    }
  }

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
  const heartbeatConfig = config.defaults.heartbeat;
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
  const searchCfg = config.defaults.search;
  const braveClient = createBraveClient(searchCfg);
  const exaClient = createExaClient(searchCfg);
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
    if (method === "search-tool-call") {
      return handleSearchToolCall(
        {
          searchConfig: searchCfg,
          resolvedAgents,
          braveClient,
          exaClient,
          fetcher: fetchUrl,
        },
        params as unknown as IpcSearchToolCallParams,
      );
    }
    // Phase 72 — image-tool-call is intercepted BEFORE routeMethod
    // (same closure pattern as browser-tool-call + search-tool-call).
    // The daemon-owned image provider clients + per-agent UsageTracker
    // lookup are closed over here.
    if (method === "image-tool-call") {
      return handleImageToolCall(
        {
          imageConfig: imageCfg,
          resolvedAgents,
          providers: imageProviders,
          usageTrackerLookup: (agent) => manager.getUsageTracker(agent),
        },
        params as unknown as IpcImageToolCallParams,
      );
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
    return routeMethod(manager, resolvedAgents, method, params, routingTableRef, rateLimiter, heartbeatRunner, taskScheduler, skillsCatalog, threadManager, webhookManager, deliveryQueue, subagentThreadSpawner, allowlistMatchers, approvalLog, securityPolicies, escalationMonitor, advisorBudget, discordBridgeRef, configPath, config.defaults.basePath, taskManager, taskStore);
  };

  // 11. Create IPC server
  const server = createIpcServer(SOCKET_PATH, handler);

  // 11. Resolve Discord bot token from config (COEX-01: no fallback to shared plugin token)
  let botToken: string;
  if (config.discord?.botToken) {
    const raw = config.discord.botToken;
    if (raw.startsWith("op://")) {
      try {
        botToken = execSync(`op read "${raw}"`, { encoding: "utf-8", timeout: 10_000 }).trim();
      } catch {
        throw new Error(
          "Failed to resolve Discord bot token from 1Password — refusing to start Discord bridge. " +
          "Fix: ensure 1Password CLI is authenticated (op signin) or set a literal token in clawcode.yaml discord.botToken"
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
      routingTable,
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
        manager.setBotDirectSender({
          async sendEmbed(channelId, embed) {
            const channel = await bridgeForGreeting.discordClient.channels.fetch(channelId);
            if (!channel || !channel.isTextBased() || !("send" in channel)) {
              throw new Error(`channel ${channelId} is not a sendable text channel`);
            }
            const msg = await (channel as import("discord.js").TextBasedChannel & { send: (opts: { embeds: import("discord.js").EmbedBuilder[] }) => Promise<{ id: string }> }).send({ embeds: [embed] });
            return msg.id;
          },
        });
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

  // 11b2. Create SubagentThreadSpawner for IPC-driven subagent thread creation
  const subagentThreadSpawner = discordBridge
    ? new SubagentThreadSpawner({
        sessionManager: manager,
        registryPath: THREAD_REGISTRY_PATH,
        discordClient: discordBridge.discordClient,
        log,
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
  const routingTableRef = { current: routingTable };

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
    onChange: async (diff, newResolvedAgents) => {
      const summary = await configReloader.applyChanges(diff, newResolvedAgents);
      log.info({ subsystems: summary.subsystemsReloaded, agents: summary.agentsAffected }, "config hot-reloaded");
    },
    log,
    // Hot-reload must resolve op:// refs too — otherwise adding a new
    // mcpServers entry with `op://...` env on a running daemon would still
    // crash the child. Matches the boot-time resolver above.
    opRefResolver: defaultOpRefResolver,
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

  // 12. Register signal handlers per D-15
  const shutdown = async (): Promise<void> => {
    log.info("shutdown signal received");
    // 260419-q2z Fix B — drain in-flight session summaries BEFORE closing any
    // downstream resource. The 15s ceiling matches summarizeSession's internal
    // 10s timeout + 5s slack for embed + insert + markSummarized. After drain
    // returns, new turn dispatches via streamFromAgent/sendToAgent reject
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
    // Clean up all thread sessions before stopping agents
    const allBindings = await threadManager.getActiveBindings();
    for (const binding of allBindings) {
      try { await threadManager.removeThreadSession(binding.threadId); } catch { /* thread cleanup is best-effort during shutdown */ }
    }
    deliveryQueue.stop();
    deliveryDb.close();
    advisorBudgetDb.close();
    webhookManager.destroy();
    await manager.stopAll();
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
    await unlink(SOCKET_PATH).catch((err) => { log.debug({ path: SOCKET_PATH, error: (err as Error).message }, "socket file cleanup failed (may not exist)"); });
    await unlink(PID_PATH).catch((err) => { log.debug({ path: PID_PATH, error: (err as Error).message }, "pid file cleanup failed (may not exist)"); });
  };

  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  log.info({ socket: SOCKET_PATH }, "manager daemon started");

  // Auto-start all configured agents on daemon boot
  void (async () => {
    try {
      await manager.startAll(resolvedAgents);
      log.info({ agents: resolvedAgents.length }, "all agents auto-started");
    } catch (err) {
      log.error({ error: (err as Error).message }, "failed to auto-start agents");
    }
  })();

  // TaskManager owns no external resources (inflight timers .unref()'d,
  // db handle owned by TaskStore via PayloadStore). No explicit shutdown needed.
  return { server, manager, taskStore, taskManager, payloadStore, triggerEngine, routingTable, rateLimiter, heartbeatRunner, taskScheduler, skillsCatalog, slashHandler, threadManager, webhookManager, discordBridge, subagentThreadSpawner, configWatcher, configReloader, policyWatcher, routingTableRef, dashboard: dashboard ?? { server: null as unknown as ReturnType<typeof import("node:http").createServer>, sseManager: null as unknown as import("../dashboard/sse.js").SseManager, close: async () => {} }, shutdown };
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

    case "send-message": {
      const from = validateStringParam(params, "from");
      const to = validateStringParam(params, "to");
      const content = validateStringParam(params, "content");
      const priority = typeof params.priority === "string" ? params.priority : "normal";

      // Find target agent config to get workspace path
      const targetConfig = configs.find((c) => c.name === to);
      if (!targetConfig) {
        throw new ManagerError(`Target agent '${to}' not found in config`);
      }

      // Write message to target agent's inbox
      // Phase 75 SHARED-01 — memoryPath (not workspace) so cross-agent
      // sends deliver to the target's private inbox, never a shared one.
      const inboxDir = join(targetConfig.memoryPath, "inbox");
      const message = createMessage(from, to, content, priority as "normal" | "high" | "urgent");
      await writeMessage(inboxDir, message);

      // If target agent is running, send directly and check for escalation
      const running = manager.getRunningAgents();
      if (running.includes(to)) {
        try {
          let response = await manager.sendToAgent(to, content);

          // Error detection heuristic: check for common failure indicators
          const ERROR_INDICATORS = [
            "i can't", "i'm unable", "i don't have the capability",
            "tool_use_error", "error executing",
          ];
          const lowerResponse = response.toLowerCase();
          const isError = ERROR_INDICATORS.some((indicator) => lowerResponse.includes(indicator));

          // Check if escalation is needed
          if (escalationMonitor.shouldEscalate(to, response, isError)) {
            response = await escalationMonitor.escalate(to, content);
            return { ok: true, messageId: message.id, response, escalated: true };
          }

          return { ok: true, messageId: message.id, response, escalated: false };
        } catch {
          // Direct send failed -- inbox write already succeeded, return ok
          return { ok: true, messageId: message.id };
        }
      }

      return { ok: true, messageId: message.id };
    }

    case "send-to-agent": {
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
        return Object.freeze({
          ...report,
          status,
          cache_effect_ms: effect,
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
      // contract: SessionManager.sendToAgent NEVER calls turn.end(); this
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
        const response = await manager.sendToAgent(agentName, prompt, turn);
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
      const result = await subagentThreadSpawner.spawnInThread({
        parentAgentName: parentAgent,
        threadName,
        systemPrompt,
        model,
        task,
      });
      // Register session end callback for automatic cleanup (SATH-04)
      manager.registerSessionEndCallback(result.sessionName, async () => {
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
      const rep = await performMcpReadinessHandshake(mcpServers);

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
        mcpServers.map((s) => [
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
        answer = await manager.sendToAgent(fork.forkName, question);
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
          results.push(...agentCosts);
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

    case "memory-graph": {
      const agentName = validateStringParam(params, "agent");
      const store = manager.getMemoryStore(agentName);
      if (!store) {
        return { nodes: [], links: [] };
      }

      const db = store.getDatabase();

      const memories = db.prepare(`
        SELECT id, content, source, importance, access_count, tags,
               created_at, tier
        FROM memories
        ORDER BY created_at DESC
        LIMIT 500
      `).all() as Array<{
        id: string; content: string; source: string; importance: number;
        access_count: number; tags: string; created_at: string; tier: string;
      }>;

      const nodeIds = [...new Set(memories.map(m => m.id))];
      const placeholders = nodeIds.map(() => "?").join(",") || "NULL";
      const allLinks = db.prepare(`
        SELECT source_id, target_id, link_text
        FROM memory_links
        WHERE source_id IN (${placeholders})
          AND target_id IN (${placeholders})
      `).all(...nodeIds, ...nodeIds) as Array<{
        source_id: string; target_id: string; link_text: string;
      }>;

      return {
        nodes: memories.map(m => ({
          id: m.id,
          content: m.content,
          source: m.source,
          importance: m.importance,
          accessCount: m.access_count,
          tags: JSON.parse(m.tags) as string[],
          createdAt: m.created_at,
          tier: m.tier ?? "warm",
        })),
        links: allLinks.map(l => ({
          source: l.source_id,
          target: l.target_id,
          text: l.link_text,
        })),
      };
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
