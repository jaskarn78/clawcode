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
// Phase 99 sub-scope M (2026-04-26) — auto-relay subagent completion to parent.
import type { TurnDispatcher } from "../manager/turn-dispatcher.js";
import { makeRootOrigin } from "../manager/turn-origin.js";

/**
 * Configuration for creating a SubagentThreadSpawner.
 */
export type SubagentThreadSpawnerConfig = {
  readonly sessionManager: SessionManager;
  readonly registryPath: string;
  readonly discordClient: Client;
  readonly log?: Logger;
  /**
   * Phase 99 sub-scope M (2026-04-26) — when set, on subagent session end the
   * spawner fetches the subagent's last assistant message from the thread
   * and dispatches a synthetic turn to the parent agent: "your subagent in
   * <thread> finished, last reply was <text>, summarize for the user". Parent
   * processes the turn, posts a brief summary to its main channel via the
   * normal Discord webhook pipeline. Optional — when omitted, no auto-relay.
   */
  readonly turnDispatcher?: TurnDispatcher;
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
  private readonly turnDispatcher?: TurnDispatcher;

  constructor(config: SubagentThreadSpawnerConfig) {
    this.sessionManager = config.sessionManager;
    this.registryPath = config.registryPath;
    this.discordClient = config.discordClient;
    this.log = config.log ?? logger;
    this.turnDispatcher = config.turnDispatcher;
  }

  /**
   * Phase 99 sub-scope M (2026-04-26) — auto-relay a subagent's completion
   * to its parent agent. Called from the session-end callback BEFORE the
   * thread cleanup runs (so the binding is still readable).
   *
   * Flow:
   *   1. Read binding for threadId (parent agent + parent channel).
   *   2. Fetch the last 1-3 messages from the Discord thread.
   *   3. Filter to messages from the subagent identity (webhook posts).
   *   4. Build a relay prompt: "Your subagent in <thread> just finished.
   *      Last reply: <text>. Briefly summarize for the user in main channel."
   *   5. Dispatch a turn to the parent agent via TurnDispatcher with origin
   *      kind="task" sourceId="subagent-completion:<threadId>".
   *   6. The parent's turn runs through the normal Discord pipeline → reply
   *      posts to the parent's bound channel via webhook.
   *
   * Failures are logged + swallowed (the cleanup must still run regardless).
   * No-op when turnDispatcher is not wired or when the thread has no
   * subagent messages worth relaying.
   */
  async relayCompletionToParent(threadId: string): Promise<void> {
    if (!this.turnDispatcher) return;
    try {
      const registry = await readThreadRegistry(this.registryPath);
      const binding = getBindingForThread(registry, threadId);
      if (!binding) return;
      const channel = await this.discordClient.channels.fetch(threadId);
      if (!channel || !("messages" in channel)) return;
      // Fetch last 10 messages (enough to find the subagent's most recent
      // assistant reply, skipping the operator's follow-ups). Discord's
      // `fetch` returns newest-first.
      const fetched = await (channel as TextChannel).messages.fetch({
        limit: 10,
      });
      // Subagent posts via webhook — its identity differs from the operator's.
      // We pick the most recent message NOT from the operator. The first
      // initial-prompt post + any subsequent subagent posts are eligible.
      const messages = Array.from(fetched.values()); // newest first
      const subagentMessage = messages.find(
        (m) => m.author.bot && (m.webhookId !== null || m.author.bot),
      );
      if (!subagentMessage || !subagentMessage.content.trim()) return;
      const lastReply = subagentMessage.content.trim();
      // Truncate huge replies — the parent's prompt has a budget.
      const trimmed =
        lastReply.length > 1500 ? `${lastReply.slice(0, 1500)}…` : lastReply;
      const threadName = (channel as TextChannel).name ?? threadId;
      const relayPrompt =
        `[SUBAGENT_COMPLETION] Your subagent in thread "${threadName}" just finished its work.\n\n` +
        `**Their final response (last assistant message):**\n${trimmed}\n\n` +
        `Briefly summarize the outcome for the user in this main channel (1-3 sentences max). ` +
        `Acknowledge completion and link to the thread if helpful (thread ID: ${threadId}). ` +
        `If the subagent's reply is too short or unclear to summarize, just acknowledge completion + link. ` +
        `Do NOT call read_thread again — you already have the relevant content above. End your turn after posting the summary.`;
      const origin = makeRootOrigin("task", `subagent-completion:${threadId}`);
      await this.turnDispatcher.dispatch(origin, binding.agentName, relayPrompt);
      this.log.info(
        {
          threadId,
          parentAgent: binding.agentName,
          subagentSession: binding.sessionName,
          relayLen: trimmed.length,
        },
        "subagent completion relayed to parent",
      );
    } catch (err) {
      this.log.warn(
        { threadId, error: (err as Error).message },
        "subagent completion relay failed (non-fatal — cleanup continues)",
      );
    }
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

    // 12. Kick off the initial prompt async -- either the handoff task (if
    // provided) or a generic intro. Deliberately not awaited so the MCP
    // caller gets the thread URL back immediately; the LLM roundtrip runs
    // in the background and posts directly to the thread. Errors are logged.
    void this.postInitialMessage(thread, sessionName, config.threadName, config.task);

    return {
      threadId: thread.id,
      sessionName,
      parentAgent: config.parentAgentName,
      channelId,
    };
  }

  /**
   * Send the first prompt to the subagent and post its response to the thread.
   * If `task` is provided, the subagent starts working on it immediately.
   * If not, a brief intro prompt is sent so the thread isn't silent.
   * Failures are logged, never thrown -- the spawn has already succeeded.
   */
  private async postInitialMessage(
    thread: { send: (content: string) => Promise<unknown> },
    sessionName: string,
    threadName: string,
    task: string | undefined,
  ): Promise<void> {
    try {
      const prompt = task
        ? task
        : `You've just been spawned in a Discord thread titled "${threadName}". ` +
          `Introduce yourself in 1-2 short sentences based on your soul and state what you're ready to do. ` +
          `No filler, no meta-commentary about being an AI.`;
      const reply = await this.sessionManager.streamFromAgent(sessionName, prompt, () => {});
      const text = reply.trim();
      if (text) {
        await thread.send(text.slice(0, 2000));
      }
    } catch (err) {
      this.log.warn(
        { sessionName, error: (err as Error).message, hadTask: Boolean(task) },
        "subagent initial message failed",
      );
    }
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
