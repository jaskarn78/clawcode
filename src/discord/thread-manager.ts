import type { RoutingTable } from "./types.js";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { ThreadBinding, ThreadBindingRegistry } from "./thread-types.js";
import { DEFAULT_THREAD_CONFIG } from "./thread-types.js";
import {
  readThreadRegistry,
  writeThreadRegistry,
  addBinding,
  removeBinding,
  updateActivity,
  getBindingForThread,
  getBindingsForAgent,
} from "./thread-registry.js";
import { logger } from "../shared/logger.js";
import type { Logger } from "pino";

/**
 * Configuration for creating a ThreadManager.
 */
export type ThreadManagerConfig = {
  readonly sessionManager: SessionManager;
  readonly routingTable: RoutingTable;
  readonly registryPath: string;
  readonly log?: Logger;
};

/**
 * Manages Discord thread-to-agent session lifecycle:
 * spawn thread sessions, route messages, enforce limits, cleanup.
 */
export class ThreadManager {
  private readonly sessionManager: SessionManager;
  private readonly routingTable: RoutingTable;
  private readonly registryPath: string;
  private readonly log: Logger;

  /** Thread IDs currently being spawned by SubagentThreadSpawner — skip auto-spawn for these. */
  private readonly pendingSpawns: Set<string> = new Set();

  constructor(config: ThreadManagerConfig) {
    this.sessionManager = config.sessionManager;
    this.routingTable = config.routingTable;
    this.registryPath = config.registryPath;
    this.log = config.log ?? logger;
  }

  /**
   * Mark a thread ID as being spawned externally (e.g., by SubagentThreadSpawner).
   * Prevents the threadCreate event from creating a duplicate session.
   */
  markPendingSpawn(threadId: string): void {
    this.pendingSpawns.add(threadId);
  }

  /**
   * Clear a pending spawn marker after the external spawn completes or fails.
   */
  clearPendingSpawn(threadId: string): void {
    this.pendingSpawns.delete(threadId);
  }

  /**
   * Handle a new thread being created in Discord.
   * If the parent channel is bound to an agent, spawn a thread session.
   *
   * @returns true if a thread session was spawned, false otherwise
   */
  async handleThreadCreate(
    threadId: string,
    threadName: string,
    parentChannelId: string,
  ): Promise<boolean> {
    // 0. Skip if this thread is being spawned externally (SubagentThreadSpawner)
    if (this.pendingSpawns.has(threadId)) {
      this.log.debug({ threadId }, "thread is pending external spawn, skipping auto-spawn");
      return false;
    }

    // 1. Check if parent channel is bound to an agent
    const agentName = this.routingTable.channelToAgent.get(parentChannelId);
    if (!agentName) {
      this.log.debug(
        { threadId, parentChannelId },
        "thread created in unbound channel, ignoring",
      );
      return false;
    }

    // 2. Get parent agent config for model/soul/identity inheritance
    const parentConfig = this.sessionManager.getAgentConfig(agentName);
    if (!parentConfig) {
      this.log.warn(
        { threadId, agentName },
        "parent agent config not found, cannot spawn thread session",
      );
      return false;
    }

    // 3. Skip if a binding already exists (e.g., created by SubagentThreadSpawner)
    let registry = await readThreadRegistry(this.registryPath);
    const existingBinding = getBindingForThread(registry, threadId);
    if (existingBinding) {
      this.log.debug(
        { threadId, sessionName: existingBinding.sessionName },
        "thread binding already exists, skipping auto-spawn",
      );
      return false;
    }

    // 4. Check maxThreadSessions limit
    const maxSessions =
      parentConfig.threads?.maxThreadSessions ??
      DEFAULT_THREAD_CONFIG.maxThreadSessions;

    const agentBindings = getBindingsForAgent(registry, agentName);

    if (agentBindings.length >= maxSessions) {
      this.log.warn(
        { threadId, agentName, active: agentBindings.length, max: maxSessions },
        "max thread sessions reached for agent, rejecting thread",
      );
      return false;
    }

    // 4. Build session name
    const sessionName = `${agentName}-thread-${threadId}`;

    // 5. Build thread session config inheriting from parent
    const threadContext = [
      "\n\n## Thread Context",
      "You are operating in a Discord thread.",
      `Thread: "${threadName}" (ID: ${threadId})`,
      `Parent channel: ${parentChannelId}`,
      `Parent agent: ${agentName}`,
      "Respond to messages in this thread only.",
    ].join("\n");

    const threadSessionConfig: ResolvedAgentConfig = {
      ...parentConfig,
      name: sessionName,
      channels: [],
      soul: (parentConfig.soul ?? "") + threadContext,
    };

    // 6. Persist binding first so routeMessage can find it immediately
    const now = Date.now();
    const binding: ThreadBinding = {
      threadId,
      parentChannelId,
      agentName,
      sessionName,
      createdAt: now,
      lastActivity: now,
    };

    registry = await readThreadRegistry(this.registryPath);
    const updatedRegistry = addBinding(registry, binding);
    await writeThreadRegistry(this.registryPath, updatedRegistry);

    // 7. Start the thread session — rollback binding on failure
    try {
      await this.sessionManager.startAgent(sessionName, threadSessionConfig);
    } catch (error) {
      const rollbackRegistry = await readThreadRegistry(this.registryPath);
      const cleaned = removeBinding(rollbackRegistry, threadId);
      await writeThreadRegistry(this.registryPath, cleaned);
      this.log.error(
        { threadId, sessionName, error: (error as Error).message },
        "thread session start failed — binding rolled back",
      );
      return false;
    }

    this.log.info(
      { threadId, threadName, agentName, sessionName },
      "thread session spawned",
    );

    return true;
  }

  /**
   * Route a message to the correct thread session.
   * Updates lastActivity on the binding when found.
   *
   * @returns The session name to route to, or undefined if no binding exists
   */
  async routeMessage(threadId: string): Promise<string | undefined> {
    let registry = await readThreadRegistry(this.registryPath);
    const binding = getBindingForThread(registry, threadId);

    if (!binding) {
      return undefined;
    }

    // Update lastActivity
    const now = Date.now();
    registry = updateActivity(registry, threadId, now);
    await writeThreadRegistry(this.registryPath, registry);

    return binding.sessionName;
  }

  /**
   * Remove a thread session: stop the agent and remove the binding.
   * No-op if the threadId has no binding.
   */
  async removeThreadSession(threadId: string): Promise<void> {
    const registry = await readThreadRegistry(this.registryPath);
    const binding = getBindingForThread(registry, threadId);

    if (!binding) {
      return;
    }

    // Stop the session
    await this.sessionManager.stopAgent(binding.sessionName);

    // Remove from registry
    const updatedRegistry = removeBinding(registry, threadId);
    await writeThreadRegistry(this.registryPath, updatedRegistry);

    this.log.info(
      { threadId, sessionName: binding.sessionName },
      "thread session removed",
    );
  }

  /**
   * Get all active thread bindings from the registry.
   */
  async getActiveBindings(): Promise<readonly ThreadBinding[]> {
    const registry = await readThreadRegistry(this.registryPath);
    return registry.bindings;
  }
}
