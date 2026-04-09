import { nanoid } from "nanoid";
import type { Client, TextChannel } from "discord.js";
import type { Logger } from "pino";
import type { SessionManager } from "../manager/session-manager.js";
import type { ResolvedAgentConfig } from "../shared/types.js";
import type { ThreadBinding, ThreadBindingRegistry } from "./thread-types.js";
import { DEFAULT_THREAD_CONFIG } from "./thread-types.js";
import type { SubagentThreadConfig, SubagentSpawnResult } from "./subagent-thread-types.js";
import {
  readThreadRegistry,
  writeThreadRegistry,
  addBinding,
  removeBinding,
  getBindingForThread,
  getBindingsForAgent,
} from "./thread-registry.js";
import { logger } from "../shared/logger.js";
import { ManagerError } from "../shared/errors.js";

/**
 * Configuration for creating a SubagentThreadSpawner.
 */
export type SubagentThreadSpawnerConfig = {
  readonly sessionManager: SessionManager;
  readonly registryPath: string;
  readonly discordClient: Client;
  readonly log?: Logger;
};

/**
 * Spawns subagent sessions in Discord threads with webhook identity.
 * Handles thread creation, session startup, binding persistence, and cleanup.
 */
export class SubagentThreadSpawner {
  private readonly sessionManager: SessionManager;
  private readonly registryPath: string;
  private readonly discordClient: Client;
  private readonly log: Logger;

  constructor(config: SubagentThreadSpawnerConfig) {
    this.sessionManager = config.sessionManager;
    this.registryPath = config.registryPath;
    this.discordClient = config.discordClient;
    this.log = config.log ?? logger;
  }

  /**
   * Spawn a subagent in a new Discord thread.
   *
   * 1. Validates parent agent config and channel
   * 2. Checks maxThreadSessions limit
   * 3. Creates Discord thread
   * 4. Starts subagent session with inherited config
   * 5. Persists thread binding
   *
   * @throws ManagerError if parent agent not found, no channels, or limit exceeded
   */
  async spawnInThread(config: SubagentThreadConfig): Promise<SubagentSpawnResult> {
    // 1. Get parent config
    const parentConfig = this.sessionManager.getAgentConfig(config.parentAgentName);
    if (!parentConfig) {
      throw new ManagerError(
        `Parent agent '${config.parentAgentName}' not found`,
      );
    }

    // 2. Get parent's first channel
    const channelId = parentConfig.channels[0];
    if (!channelId) {
      throw new ManagerError(
        `Parent agent '${config.parentAgentName}' has no bound channels`,
      );
    }

    // 3. Check maxThreadSessions limit
    const maxSessions =
      parentConfig.threads?.maxThreadSessions ??
      DEFAULT_THREAD_CONFIG.maxThreadSessions;

    const registry = await readThreadRegistry(this.registryPath);
    const agentBindings = getBindingsForAgent(registry, config.parentAgentName);

    if (agentBindings.length >= maxSessions) {
      throw new ManagerError(
        `Max thread sessions (${maxSessions}) reached for agent '${config.parentAgentName}'`,
      );
    }

    // 4. Fetch Discord channel and create thread
    const channel = await this.discordClient.channels.fetch(channelId) as TextChannel;
    const thread = await channel.threads.create({
      name: config.threadName,
      autoArchiveDuration: 1440,
    });

    // 5. Build session name
    const shortId = nanoid(6);
    const sessionName = `${config.parentAgentName}-sub-${shortId}`;

    // 6. Build thread context for soul
    const threadContext = [
      "\n\n## Subagent Thread Context",
      `You are a subagent operating in a Discord thread.`,
      `Thread: "${config.threadName}" (ID: ${thread.id})`,
      `Parent channel: ${channelId}`,
      `Parent agent: ${config.parentAgentName}`,
      "Respond to messages in this thread only.",
    ].join("\n");

    // 7. Determine model
    const model = config.model ?? parentConfig.subagentModel ?? parentConfig.model;

    // 8. Build webhook identity if parent has webhookUrl
    const webhook = parentConfig.webhook?.webhookUrl
      ? {
          displayName: sessionName,
          avatarUrl: parentConfig.webhook.avatarUrl,
          webhookUrl: parentConfig.webhook.webhookUrl,
        }
      : undefined;

    // 9. Build subagent config
    const subagentConfig: ResolvedAgentConfig = {
      ...parentConfig,
      name: sessionName,
      model,
      channels: [],
      soul: (config.systemPrompt ?? parentConfig.soul ?? "") + threadContext,
      schedules: [],
      slashCommands: [],
      webhook,
    };

    // 10. Start agent session
    await this.sessionManager.startAgent(sessionName, subagentConfig);

    // 11. Persist thread binding
    const now = Date.now();
    const binding: ThreadBinding = {
      threadId: thread.id,
      parentChannelId: channelId,
      agentName: config.parentAgentName,
      sessionName,
      createdAt: now,
      lastActivity: now,
    };

    const currentRegistry = await readThreadRegistry(this.registryPath);
    const updatedRegistry = addBinding(currentRegistry, binding);
    await writeThreadRegistry(this.registryPath, updatedRegistry);

    this.log.info(
      { threadId: thread.id, threadName: config.threadName, parentAgent: config.parentAgentName, sessionName },
      "subagent thread spawned",
    );

    return {
      threadId: thread.id,
      sessionName,
      parentAgent: config.parentAgentName,
      channelId,
    };
  }

  /**
   * Clean up a subagent thread session.
   * Stops the session and removes the binding.
   * Does NOT delete the Discord thread (preserves history per SATH-04).
   * No-op if threadId has no binding.
   */
  async cleanupSubagentThread(threadId: string): Promise<void> {
    const registry = await readThreadRegistry(this.registryPath);
    const binding = getBindingForThread(registry, threadId);

    if (!binding) {
      return;
    }

    // Stop subagent session
    await this.sessionManager.stopAgent(binding.sessionName);

    // Remove binding from registry
    const updatedRegistry = removeBinding(registry, threadId);
    await writeThreadRegistry(this.registryPath, updatedRegistry);

    this.log.info(
      { threadId, sessionName: binding.sessionName },
      "subagent thread cleaned up",
    );
  }

  /**
   * Get all subagent thread bindings from the registry.
   */
  async getSubagentBindings(): Promise<readonly ThreadBinding[]> {
    const registry = await readThreadRegistry(this.registryPath);
    return registry.bindings;
  }
}
