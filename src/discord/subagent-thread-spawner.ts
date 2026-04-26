import { nanoid } from "nanoid";
import type { Client, TextChannel } from "discord.js";
import type { Logger } from "pino";
import { readdir as fsReaddir, stat as fsStat } from "node:fs/promises";
import { join } from "node:path";
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
 * Phase 100 GSD-06 — pure helper: extract the parent agent's GSD project
 * root from a ResolvedAgentConfig.
 *
 * Returns the `gsd.projectDir` when set; undefined otherwise (which signals
 * `relayCompletionToParent` to skip artifact discovery entirely — the relay
 * still runs with the base Phase 99-M prompt, no behavior change for the
 * 14+ non-GSD agents in the fleet).
 *
 * Plan 100-01 added the `gsd?: { projectDir: string }` field to
 * ResolvedAgentConfig. This helper centralizes the optional-chain so
 * downstream consumers don't repeat the lookup.
 */
export function resolveArtifactRoot(
  parentConfig: ResolvedAgentConfig | undefined,
): string | undefined {
  return parentConfig?.gsd?.projectDir;
}

/**
 * Phase 100 GSD-06 — pure async helper: enumerate phase directories under
 * `<root>/.planning/phases/` filtered by mtime (last 24h) and prioritized by
 * phase-number prefix matching the task hint. Returns up to 5 RELATIVE paths
 * (from `<root>`) to keep Discord embeds compact (RESEARCH.md Pitfall 8 —
 * long phase slugs truncate Discord embeds).
 *
 * **Failures-swallow contract** (per Phase 99-M's existing relay
 * try/catch + log-and-swallow pattern at line 126-130):
 *   - root `.planning/phases/` doesn't exist → []
 *   - readdir errors (EACCES, ENOENT) → []
 *   - per-entry stat errors → entry skipped
 *
 * NEVER throws — caller's `relayCompletionToParent` is already in a
 * try/catch but this function returns the empty fallback proactively so the
 * relay extension is a true no-op when artifacts can't be discovered.
 *
 * **Filtering & sorting logic:**
 * 1. List `<root>/.planning/phases/` entries.
 * 2. Keep only directories (skip files like README.md).
 * 3. Stat each — keep entries with `mtimeMs` within the last 24h.
 * 4. If `taskHint` carries a phase number (regex `\b\d+\b`), sort
 *    matching-prefix dirs first; tiebreak by mtime DESC. Otherwise pure
 *    mtime DESC.
 * 5. Return up to 5 entries as relative paths
 *    (`.planning/phases/<name>/`).
 *
 * **DI:** filesystem operations are injected via the `deps` parameter so
 * tests can mock `readdir`/`stat` without touching the real filesystem.
 */
export async function discoverArtifactPaths(
  deps: {
    readdir: typeof fsReaddir;
    stat: typeof fsStat;
  },
  root: string,
  taskHint?: string,
): Promise<readonly string[]> {
  const phasesDir = join(root, ".planning", "phases");
  // Step 1 — root dir must exist
  try {
    await deps.stat(phasesDir);
  } catch {
    return [];
  }
  // Step 2 — list entries; surface readdir failures as []
  let directoryNames: string[];
  try {
    const dirents = (await deps.readdir(phasesDir, {
      withFileTypes: true,
    })) as unknown as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;
    directoryNames = dirents
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  // Step 3 — mtime filter (24h window)
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const candidates: { name: string; mtimeMs: number }[] = [];
  for (const name of directoryNames) {
    try {
      const st = await deps.stat(join(phasesDir, name));
      if (now - st.mtimeMs <= windowMs) {
        candidates.push({ name, mtimeMs: st.mtimeMs });
      }
    } catch {
      // per-entry stat failure — skip silently
    }
  }
  // Step 4 — phase-prefix priority (if taskHint carries a phase number)
  const phaseMatch = taskHint?.match(/\b(\d+)\b/);
  const phaseNum = phaseMatch?.[1];
  candidates.sort((a, b) => {
    if (phaseNum) {
      const aMatches =
        a.name.startsWith(`${phaseNum}-`) || a.name === phaseNum;
      const bMatches =
        b.name.startsWith(`${phaseNum}-`) || b.name === phaseNum;
      if (aMatches && !bMatches) return -1;
      if (!aMatches && bMatches) return 1;
    }
    return b.mtimeMs - a.mtimeMs; // most recent first
  });
  // Step 5 — cap at 5, format as relative paths
  return candidates
    .slice(0, 5)
    .map((c) => `.planning/phases/${c.name}/`);
}

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
      // Phase 100 GSD-06 — discover artifact paths from the parent's GSD
      // project root. No-op when the parent has no `gsd.projectDir` set
      // (the case for 14+ existing agents — Phase 99-M base behavior is
      // preserved). Failures inside discoverArtifactPaths return [] so
      // the relay continues with the unchanged Phase 99-M prompt.
      const parentConfig = this.sessionManager.getAgentConfig(
        binding.agentName,
      );
      const artifactRoot = resolveArtifactRoot(parentConfig);
      const artifacts = artifactRoot
        ? await discoverArtifactPaths(
            { readdir: fsReaddir, stat: fsStat },
            artifactRoot,
            // Use the thread name as taskHint — names like 'gsd:plan:100'
            // carry the phase number, which discoverArtifactPaths uses for
            // prefix priority.
            threadName,
          )
        : [];
      const artifactsLine =
        artifacts.length > 0
          ? `\n\n**Artifacts written:** ${artifacts.join(", ")}`
          : "";
      const includeArtifactsHint = artifacts.length > 0;
      const relayPrompt =
        `[SUBAGENT_COMPLETION] Your subagent in thread "${threadName}" just finished its work.\n\n` +
        `**Their final response (last assistant message):**\n${trimmed}` +
        artifactsLine +
        `\n\n` +
        `Briefly summarize the outcome for the user in this main channel (1-3 sentences max). ` +
        `Acknowledge completion and link to the thread if helpful (thread ID: ${threadId}). ` +
        (includeArtifactsHint
          ? `If artifacts are listed, include them verbatim in your summary so the operator can find them. `
          : ``) +
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
          artifactCount: artifacts.length,
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
    //
    // Phase 99 sub-scope N (2026-04-26) — recursion guard: subagents inherit
    // the parent's soul which often instructs delegation ("when given a task,
    // spawn a subagent"). Without a hard block at the SDK level, the
    // subagent will ALSO call spawn_subagent_thread, recursing N levels
    // deep before the operator notices (real incident: 5-deep nested Admin
    // Clawdy chain). Strip the spawn tool at SDK level via disallowedTools
    // so subagents physically cannot spawn further subagents. Operator can
    // still spawn subagents from a real agent session (which does not carry
    // this disallow). Tool name is `mcp__<server-name>__<tool-name>` per
    // the SDK convention; server name is "clawcode" (src/mcp/server.ts:232)
    // and tool name is "spawn_subagent_thread" (src/mcp/server.ts:334).
    const subagentConfig: ResolvedAgentConfig = {
      ...parentConfig,
      name: sessionName,
      model,
      channels: [],
      soul: (config.systemPrompt ?? parentConfig.soul ?? "") + threadContext,
      schedules: [],
      slashCommands: [],
      webhook,
      disallowedTools: ["mcp__clawcode__spawn_subagent_thread"],
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

  /**
   * Phase 100 follow-up — archive (and optionally lock) a Discord thread.
   * Closes operator-facing thread management gap raised 2026-04-26
   * ("the bot doesn't expose archive through any of my MCP tools").
   *
   * Behavior:
   *   - Validates the thread is a real Discord thread channel the bot
   *     can fetch (membership/permission check by Discord).
   *   - Calls thread.setArchived(true). When `lock` is true, ALSO calls
   *     thread.setLocked(true) — a locked thread cannot have new messages.
   *   - Does NOT touch the bindings registry — the binding (if any)
   *     persists so the operator can audit "this thread was driven by
   *     subagent X". cleanupSubagentThread is the path that removes
   *     bindings, and it runs independently on session-end.
   *
   * Errors:
   *   - throws ManagerError when the channel can't be fetched or isn't
   *     a thread (passing a regular channel ID would be a programming
   *     error worth surfacing loudly).
   *   - propagates discord.js permission errors verbatim (operator may
   *     need to grant MANAGE_THREADS to the bot role).
   */
  async archiveThread(threadId: string, opts?: { readonly lock?: boolean }): Promise<{ readonly bindingPruned: boolean }> {
    const channel = await this.discordClient.channels.fetch(threadId);
    if (!channel) {
      throw new ManagerError(`Thread '${threadId}' not found`);
    }
    if (!("setArchived" in channel) || typeof (channel as { setArchived?: unknown }).setArchived !== "function") {
      throw new ManagerError(`Channel '${threadId}' is not a thread (no setArchived method)`);
    }
    const thread = channel as unknown as {
      setArchived(archived: boolean, reason?: string): Promise<unknown>;
      setLocked(locked: boolean, reason?: string): Promise<unknown>;
      name?: string;
    };
    if (opts?.lock === true) {
      await thread.setLocked(true, "archived via clawcode archive_thread");
    }
    await thread.setArchived(true, "archived via clawcode archive_thread");
    // Phase 100 follow-up — auto-prune the registry binding (if any) so the
    // maxThreadSessions accounting reflects reality. Without this, fin-acquisition
    // hit the cap-3 limit even after archiving threads (operator surfaced
    // 2026-04-26). Mirror cleanupSubagentThread's pattern but DON'T stop the
    // session — that's a separate concern (the session may already be gone).
    let bindingPruned = false;
    const registry = await readThreadRegistry(this.registryPath);
    const binding = getBindingForThread(registry, threadId);
    if (binding) {
      const updatedRegistry = removeBinding(registry, threadId);
      await writeThreadRegistry(this.registryPath, updatedRegistry);
      bindingPruned = true;
    }
    this.log.info(
      { threadId, threadName: thread.name, locked: opts?.lock === true, bindingPruned },
      "discord thread archived",
    );
    return { bindingPruned };
  }
}
