import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  mkdir,
  writeFile,
  unlink,
  access,
  stat,
} from "node:fs/promises";
import { connect, type Server } from "node:net";
import { logger } from "../shared/logger.js";
import { ManagerError } from "../shared/errors.js";
import { createIpcServer } from "../ipc/server.js";
import type { IpcHandler } from "../ipc/server.js";
import { SessionManager } from "./session-manager.js";
import type { SessionAdapter } from "./session-adapter.js";
import { SdkSessionAdapter } from "./session-adapter.js";
import { loadConfig, resolveAllAgents } from "../config/loader.js";
import { readRegistry } from "./registry.js";
import { buildRoutingTable } from "../discord/router.js";
import { createRateLimiter } from "../discord/rate-limiter.js";
import { DEFAULT_RATE_LIMITER_CONFIG } from "../discord/types.js";
import type { RoutingTable, RateLimiter } from "../discord/types.js";
import { HeartbeatRunner } from "../heartbeat/runner.js";
import type { CheckStatus } from "../heartbeat/types.js";
import type { ContextZone, ZoneTransition } from "../heartbeat/context-zones.js";
import { TaskScheduler } from "../scheduler/scheduler.js";
import { scanSkillsDirectory } from "../skills/scanner.js";
import { linkAgentSkills } from "../skills/linker.js";
import type { SkillsCatalog } from "../skills/types.js";
import { writeMessage, createMessage } from "../collaboration/inbox.js";
import { SlashCommandHandler, resolveAgentCommands } from "../discord/slash-commands.js";
import { DiscordBridge } from "../discord/bridge.js";
import { ThreadManager } from "../discord/thread-manager.js";
import { THREAD_REGISTRY_PATH } from "../discord/thread-types.js";
import { WebhookManager, buildWebhookIdentities } from "../discord/webhook-manager.js";
import { SemanticSearch } from "../memory/search.js";
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
import { installWorkspaceSkills } from "../skills/installer.js";

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
): Promise<{ server: Server; manager: SessionManager; routingTable: RoutingTable; rateLimiter: RateLimiter; heartbeatRunner: HeartbeatRunner; taskScheduler: TaskScheduler; skillsCatalog: SkillsCatalog; slashHandler: SlashCommandHandler; threadManager: ThreadManager; webhookManager: WebhookManager; discordBridge: DiscordBridge | null; subagentThreadSpawner: SubagentThreadSpawner | null; configWatcher: ConfigWatcher; configReloader: ConfigReloader; routingTableRef: { current: RoutingTable }; dashboard: { readonly server: import("node:http").Server; readonly sseManager: import("../dashboard/sse.js").SseManager; readonly close: () => Promise<void> }; shutdown: () => Promise<void> }> {
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

  // 6. Create SessionManager
  const sessionAdapter = adapter ?? new SdkSessionAdapter();
  const manager = new SessionManager({
    adapter: sessionAdapter,
    registryPath: REGISTRY_PATH,
    log,
  });

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
      // TODO: Wire to Discord delivery queue (Phase 26) when available.
      // For now, log the notification intent at info level.
      log.info(
        { agent: agentName, from: transition.from, to: transition.to, fillPercentage: pct },
        `[Context Health] Agent '${agentName}' zone: ${transition.from} -> ${transition.to} (${pct}%)`,
      );
    },
  });
  await heartbeatRunner.initialize();
  heartbeatRunner.setAgentConfigs(resolvedAgents);
  heartbeatRunner.start();
  log.info({ checks: "discovered", interval: heartbeatConfig.intervalSeconds }, "heartbeat started");

  // 8b. Initialize task scheduler (per D-08, D-10)
  const taskScheduler = new TaskScheduler({
    sessionManager: manager,
    log,
  });
  for (const agentConfig of resolvedAgents) {
    if (agentConfig.schedules.length > 0) {
      taskScheduler.addAgent(agentConfig.name, agentConfig.schedules);
    }
  }
  log.info({ agents: resolvedAgents.filter(a => a.schedules.length > 0).length }, "task scheduler initialized");

  // 8c. Create ThreadManager for Discord thread session lifecycle
  const threadManager = new ThreadManager({
    sessionManager: manager,
    routingTable,
    registryPath: THREAD_REGISTRY_PATH,
    log,
  });
  heartbeatRunner.setThreadManager(threadManager);
  log.info("thread manager initialized");

  // 8d. Create WebhookManager for agent webhook identities
  const webhookIdentities = buildWebhookIdentities(resolvedAgents);
  const webhookManager = new WebhookManager({ identities: webhookIdentities, log });
  log.info({ webhooks: webhookIdentities.size }, "webhook manager initialized");

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

  // 9. Create IPC handler
  const handler: IpcHandler = async (method, params) => {
    return routeMethod(manager, resolvedAgents, method, params, routingTableRef, rateLimiter, heartbeatRunner, taskScheduler, skillsCatalog, threadManager, webhookManager, deliveryQueue, subagentThreadSpawner, allowlistMatchers, approvalLog, securityPolicies);
  };

  // 10. Create IPC server
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
      threadManager,
      webhookManager,
      deliveryQueue,
      securityPolicies,
      botToken,
      log,
    });
    try {
      await discordBridge.start();
      log.info({ boundChannels: routingTable.channelToAgent.size }, "Discord bridge started");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error({ error: msg }, "Discord bridge failed to start");
      discordBridge = null;
    }
  } else {
    log.warn("Discord bridge not started (no bot token or no channel bindings)");
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

  // 11d. Start dashboard server
  const dashboardPort = Number(process.env.CLAWCODE_DASHBOARD_PORT) || 3100;
  const dashboard = await startDashboardServer({ port: dashboardPort, socketPath: SOCKET_PATH });
  log.info({ port: dashboardPort }, "dashboard server started");

  // 12. Register signal handlers per D-15
  const shutdown = async (): Promise<void> => {
    log.info("shutdown signal received");
    await dashboard.close();
    await configWatcher.stop();
    server.close();
    if (discordBridge) {
      await discordBridge.stop();
    }
    await slashHandler.stop();
    taskScheduler.stop();
    heartbeatRunner.stop();
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
    webhookManager.destroy();
    await manager.stopAll();
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

  return { server, manager, routingTable, rateLimiter, heartbeatRunner, taskScheduler, skillsCatalog, slashHandler, threadManager, webhookManager, discordBridge, subagentThreadSpawner, configWatcher, configReloader, routingTableRef, dashboard, shutdown };
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
      await manager.restartAgent(name, config);
      return { ok: true };
    }

    case "start-all": {
      await manager.startAll(configs);
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

      return { ok: true, messageId: message.id };
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
      const model = typeof params.model === "string" ? params.model as "sonnet" | "opus" | "haiku" : undefined;
      const result = await subagentThreadSpawner.spawnInThread({
        parentAgentName: parentAgent,
        threadName,
        systemPrompt,
        model,
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
