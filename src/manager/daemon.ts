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
): Promise<{ server: Server; manager: SessionManager; routingTable: RoutingTable; rateLimiter: RateLimiter; shutdown: () => Promise<void> }> {
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

  // 7. Reconcile registry per D-10
  await manager.reconcileRegistry(resolvedAgents);

  // 8. Create IPC handler
  const handler: IpcHandler = async (method, params) => {
    return routeMethod(manager, resolvedAgents, method, params, routingTable, rateLimiter);
  };

  // 9. Create IPC server
  const server = createIpcServer(SOCKET_PATH, handler);

  // 10. Register signal handlers per D-15
  const shutdown = async (): Promise<void> => {
    log.info("shutdown signal received");
    server.close();
    await manager.stopAll();
    await unlink(SOCKET_PATH).catch(() => {});
    await unlink(PID_PATH).catch(() => {});
  };

  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  log.info({ socket: SOCKET_PATH }, "manager daemon started");

  return { server, manager, routingTable, rateLimiter, shutdown };
}

/**
 * Route an IPC method to the appropriate SessionManager action.
 */
async function routeMethod(
  manager: SessionManager,
  configs: readonly import("../shared/types.js").ResolvedAgentConfig[],
  method: string,
  params: Record<string, unknown>,
  routingTable: RoutingTable,
  rateLimiter: RateLimiter,
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
        channels: Object.fromEntries(routingTable.channelToAgent),
        agents: Object.fromEntries(routingTable.agentToChannels),
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
