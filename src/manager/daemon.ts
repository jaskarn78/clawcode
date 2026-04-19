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
import { loadConfig, resolveAllAgents } from "../config/loader.js";
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
import { provisionWebhooks } from "../discord/webhook-provisioner.js";
import { buildAgentMessageEmbed } from "../discord/agent-message.js";
import { SemanticSearch } from "../memory/search.js";
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
import type { ResolvedAgentConfig } from "../shared/types.js";
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

  // 5. Resolve all agents
  const resolvedAgents = resolveAllAgents(config);

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

  // 5b. Build routing table and rate limiter
  const routingTable = buildRoutingTable(resolvedAgents);
  const rateLimiter = createRateLimiter(DEFAULT_RATE_LIMITER_CONFIG);
  log.info({ routes: routingTable.channelToAgent.size }, "routing table built");

  // 5d. Reconcile registry — prune ghost entries left by renamed/removed agents.
  // Runs BEFORE SessionManager so startAll never sees stale names.
  const knownAgentNames = new Set(resolvedAgents.map((a) => a.name));
  const existingRegistry = await readRegistry(REGISTRY_PATH);
  const reconciled = reconcileRegistry(existingRegistry, knownAgentNames);
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
      const memoryDir = join(agentConfig.workspace, "memory");

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
    const inboxDir = join(agentConfig.workspace, "inbox");
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

  // 10. Create IPC handler
  const handler: IpcHandler = async (method, params) => {
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
  const slashHandler = new SlashCommandHandler({
    routingTable,
    sessionManager: manager,
    resolvedAgents,
    botToken,
    client: discordBridge?.discordClient,
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
    // Phase 69 — close OpenAI endpoint FIRST: activeStreams drained + server
    // closed + apiKeysStore handle released, before the dashboard (which
    // owns the IPC socket for CLI fallback queries) shuts down. The
    // endpoint-bootstrap helper encapsulates the Pitfall 10 ordering
    // (activeStreams → server.close → store.close).
    await openAiEndpoint.close();
    if (dashboard) {
      await dashboard.close();
    }
    await configWatcher.stop();
    await policyWatcher.stop();
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
      const inboxDir = join(targetConfig.workspace, "inbox");
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
      const inboxDir = join(targetConfig.workspace, "inbox");
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
      const validLevels = ["low", "medium", "high", "max"];
      if (!validLevels.includes(level)) {
        throw new ManagerError(`Invalid effort level '${level}'. Valid: ${validLevels.join(", ")}`);
      }
      manager.setEffortForAgent(name, level as "low" | "medium" | "high" | "max");
      return { ok: true, agent: name, effort: level };
    }

    case "get-effort": {
      const name = validateStringParam(params, "name");
      const level = manager.getEffortForAgent(name);
      return { ok: true, agent: name, effort: level };
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
      const agentName = validateStringParam(params, "agent");
      const modelParam = validateStringParam(params, "model");

      // Validate model name
      const parsed = modelSchema.safeParse(modelParam);
      if (!parsed.success) {
        throw new ManagerError(
          `Invalid model '${modelParam}'. Must be one of: haiku, sonnet, opus`,
        );
      }
      const newModel = parsed.data;

      // Find agent config
      const idx = configs.findIndex((c) => c.name === agentName);
      if (idx === -1) {
        throw new ManagerError(`Agent '${agentName}' not found in config`);
      }

      const existingConfig = configs[idx];
      const oldModel = existingConfig.model;

      // Create new frozen config with updated model (immutability per CLAUDE.md)
      const updatedConfig = Object.freeze({ ...existingConfig, model: newModel });

      // Replace in configs array (mutable array, readonly elements)
      (configs as ResolvedAgentConfig[])[idx] = updatedConfig;

      // Update SessionManager's reference so next session uses new model
      manager.setAllAgentConfigs(configs);

      return {
        agent: agentName,
        old_model: oldModel,
        new_model: newModel,
        note: "Takes effect on next session",
      };
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

      const memoryDir = join(config.workspace, "memory");
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
