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
// Phase 100 follow-up — progressive streaming into subagent threads so
// operators see "🔄 Working..." → live token stream → final message,
// instead of a silent thread until the subagent finishes its turn.
import { ProgressiveMessageEditor } from "./streaming.js";
import { wrapMarkdownTablesInCodeFence } from "./markdown-table-wrap.js";

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
    if (!this.turnDispatcher) {
      this.log.info({ threadId, reason: "no-turn-dispatcher" }, "subagent relay skipped");
      return;
    }
    try {
      const registry = await readThreadRegistry(this.registryPath);
      const binding = getBindingForThread(registry, threadId);
      if (!binding) {
        this.log.info({ threadId, reason: "no-binding" }, "subagent relay skipped");
        return;
      }
      const channel = await this.discordClient.channels.fetch(threadId);
      if (!channel || !("messages" in channel)) {
        this.log.info({ threadId, reason: "no-channel-or-not-text" }, "subagent relay skipped");
        return;
      }
      // Fetch last 10 messages (enough to find the subagent's most recent
      // assistant reply, skipping the operator's follow-ups). Discord's
      // `fetch` returns newest-first.
      const fetched = await (channel as TextChannel).messages.fetch({
        limit: 10,
      });
      // Phase 100-fu (2026-04-28) — multi-chunk concatenation.
      //
      // Pre-fu code picked only the SINGLE most-recent bot message. When a
      // subagent's reply exceeded 2000 chars, postInitialMessage chunked
      // it across N thread.send() calls — but the relay then summarized
      // the parent on JUST the LAST chunk, losing chunks 1..N-1. Real
      // failure 2026-04-28: Opus tax-return analysis silently truncated
      // to one Discord message, parent built its main-channel summary on
      // truncated content.
      //
      // Fix: walk newest→oldest, gather a continuous run of bot messages,
      // stop at the first operator (non-bot) message OR the start of
      // history. Concatenate oldest-first so the parent sees the
      // chronological order. Skip empty/whitespace-only messages
      // (embed-only posts, Discord placeholders).
      //
      // Subagent posts via webhook OR direct bot send. We treat ALL bot
      // messages as eligible — the binding's parentChannelId already
      // scopes to this thread, so cross-bot interleaving is not a concern
      // for subagent-spawned threads.
      const messages = Array.from(fetched.values()); // newest first per discord.js
      const subagentChunks: string[] = [];
      for (const m of messages) {
        if (!m.author.bot) break; // hit operator follow-up — stop walking
        if (!m.content || m.content.trim().length === 0) continue; // skip empty/embed-only
        subagentChunks.push(m.content);
      }
      if (subagentChunks.length === 0) {
        this.log.info({ threadId, reason: "no-bot-messages" }, "subagent relay skipped");
        return;
      }
      // Reverse to oldest-first so the relay reads in chronological order.
      const fullSubagentReply = subagentChunks.reverse().join("\n").trim();
      if (!fullSubagentReply) {
        this.log.info({ threadId, reason: "empty-content-after-concat" }, "subagent relay skipped");
        return;
      }
      // Truncate huge replies — the parent's prompt has a budget.
      const trimmed =
        fullSubagentReply.length > 1500
          ? `${fullSubagentReply.slice(0, 1500)}…`
          : fullSubagentReply;
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

      // Quick task 260501-nfe (2026-05-01) — fetch the parent's main channel
      // so the relay summary actually posts. Defensive: a missing or
      // non-text channel is a hard skip (we have no surface to post to).
      // Pre-fix this code called turnDispatcher.dispatch and discarded the
      // returned response — the dominant cause of "summary never posts" in
      // production (Phase 99-M wiring was never finished).
      const parentChannel = await this.discordClient.channels
        .fetch(binding.parentChannelId)
        .catch(() => null);
      const parentSendable = parentChannel as
        | {
            send: (
              content: string,
            ) => Promise<{ edit: (c: string) => Promise<unknown> }>;
          }
        | null;
      if (!parentSendable || typeof parentSendable.send !== "function") {
        this.log.info(
          {
            threadId,
            reason: "parent-channel-fetch-failed",
            parentChannelId: binding.parentChannelId,
          },
          "subagent relay skipped",
        );
        return;
      }

      // Quick task 260501-nfe — mirror bridge.ts:585-665 user-message path.
      // Stream tokens into a ProgressiveMessageEditor that posts to the
      // parent's main channel via channel.send (first chunk) / .edit
      // (subsequent). Without this, the response string was awaited and
      // discarded — the dominant cause of "summary never posts" in
      // production (diagnosed 2026-05-01).
      let messageRef:
        | { edit: (content: string) => Promise<unknown> }
        | null = null;
      const editor = new ProgressiveMessageEditor({
        editFn: async (content: string) => {
          const wrapped = wrapMarkdownTablesInCodeFence(content);
          const truncated =
            wrapped.length > 2000 ? wrapped.slice(0, 1997) + "..." : wrapped;
          if (!messageRef) {
            messageRef = await parentSendable.send(truncated);
          } else {
            await messageRef.edit(truncated);
          }
        },
        editIntervalMs: 750,
        log: this.log,
        agent: binding.agentName,
      });

      const response = await this.turnDispatcher.dispatchStream(
        origin,
        binding.agentName,
        relayPrompt,
        (accumulated: string) => editor.update(accumulated),
        { channelId: binding.parentChannelId },
      );
      await editor.flush();

      // Defense-in-depth: if dispatch returned empty AND no chunk fired,
      // we have no post. Distinct from the 5 pre-dispatch silent-return
      // reasons because this one is post-dispatch.
      if (!messageRef && (!response || response.trim().length === 0)) {
        this.log.info(
          {
            threadId,
            reason: "empty-response-from-parent",
            parentAgent: binding.agentName,
          },
          "subagent relay skipped",
        );
        return;
      }

      // Overflow handling — when the final response exceeds 2000 chars, the
      // editor truncated the visible message. Send the tail as additional
      // channel.send() chunks so nothing is lost. Mirrors postInitialMessage
      // overflow logic (this file, lines 633-670).
      const finalWrapped = wrapMarkdownTablesInCodeFence(response ?? "");
      if (finalWrapped.length > 2000) {
        let cursor = 2000;
        let chunksSent = 0;
        let lastError: string | null = null;
        while (cursor < finalWrapped.length) {
          const chunk = finalWrapped.slice(cursor, cursor + 2000);
          try {
            await parentSendable.send(chunk);
            chunksSent++;
          } catch (err) {
            lastError = (err as Error).message;
            this.log.warn(
              {
                threadId,
                parentAgent: binding.agentName,
                chunkIndex: chunksSent,
                cursor,
                totalLength: finalWrapped.length,
                error: lastError,
              },
              "subagent relay overflow chunk send failed (non-fatal — continuing if possible)",
            );
            break;
          }
          cursor += 2000;
        }
        this.log.info(
          {
            threadId,
            parentAgent: binding.agentName,
            totalLength: finalWrapped.length,
            chunksSent,
            lastError,
            fullySent: cursor >= finalWrapped.length,
          },
          "subagent relay overflow chunks summary",
        );
      }

      this.log.info(
        {
          threadId,
          parentAgent: binding.agentName,
          subagentSession: binding.sessionName,
          relayLen: trimmed.length,
          artifactCount: artifacts.length,
          postedLength: (response ?? "").length,
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

    // Phase 999.3 — D-INH-01..03: when delegateTo is set, compose subagent
    // config from the delegate's identity (model/soul/skills/mcpServers/
    // subagentModel) but keep caller-owned, channel-scoped fields (channels,
    // threads quota, webhookUrl). D-EDG-04: empty string ≡ undefined.
    // D-EDG-05: defense-in-depth at spawner level (IPC handler is primary).
    const normalizedDelegateTo =
      config.delegateTo && config.delegateTo.length > 0
        ? config.delegateTo
        : undefined;
    const delegateConfig = normalizedDelegateTo
      ? this.sessionManager.getAgentConfig(normalizedDelegateTo)
      : undefined;
    if (normalizedDelegateTo && !delegateConfig) {
      throw new ManagerError(
        `Delegate agent '${normalizedDelegateTo}' not found in config`,
      );
    }
    // sourceConfig provides inherited fields (model/soul/skills/mcpServers/...).
    // parentConfig provides channel-scoped/quota fields (channels, threads, webhookUrl).
    const sourceConfig = delegateConfig ?? parentConfig;

    // 2. Get parent's first channel
    const channelId = parentConfig.channels[0];
    if (!channelId) {
      throw new ManagerError(
        `Parent agent '${config.parentAgentName}' has no bound channels`,
      );
    }

    // 3. Check maxThreadSessions limit (caller's quota — D-INH-02)
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

    // 5. Build session name (D-NAM-01: -via- infix when delegating; D-NAM-02 otherwise)
    const shortId = nanoid(6);
    const sessionName = normalizedDelegateTo
      ? `${config.parentAgentName}-via-${normalizedDelegateTo}-${shortId}`
      : `${config.parentAgentName}-sub-${shortId}`;

    // 6. Build thread context for soul.
    // D-TCX-01: when delegating, append a 4-line "Delegation Context" block
    // including the canonical phrase "acting on behalf of" so the subagent
    // understands it speaks with delegate's identity in caller's channel.
    const baseContext = [
      "\n\n## Subagent Thread Context",
      `You are a subagent operating in a Discord thread.`,
      `Thread: "${config.threadName}" (ID: ${thread.id})`,
      `Parent channel: ${channelId}`,
      `Parent agent: ${config.parentAgentName}`,
      "Respond to messages in this thread only.",
    ];
    const delegationContext = normalizedDelegateTo
      ? [
          "",
          "## Delegation Context",
          `You are acting on behalf of \`${config.parentAgentName}\` who delegated this work to you.`,
          "Use your full identity, skills, and standards. Treat the operator's request",
          "as one fulfilled THROUGH you, not BY you.",
        ]
      : [];
    const threadContext = [...baseContext, ...delegationContext].join("\n");

    // 7. Determine model — read from sourceConfig so delegate's
    // subagentModel/model wins when delegating (D-INH-01).
    const model = config.model ?? sourceConfig.subagentModel ?? sourceConfig.model;

    // 8. Build webhook identity per D-INH-03 — caller's webhookUrl
    // (channel-bound), delegate's per-message displayName + avatar
    // (verified at webhook-manager.ts:71-75 — discord.js client.send accepts
    // username + avatarURL per-call without rebinding the webhook).
    const webhook = parentConfig.webhook?.webhookUrl
      ? {
          displayName: normalizedDelegateTo
            ? (delegateConfig!.webhook?.displayName ?? delegateConfig!.name)
            : sessionName,
          avatarUrl: normalizedDelegateTo
            ? delegateConfig!.webhook?.avatarUrl
            : parentConfig.webhook.avatarUrl,
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
    //
    // Phase 999.3 D-TCX-03 — disallowedTools stays UNCONDITIONAL: the
    // recursion guard applies whether or not delegateTo is set. Test DEL-05
    // pins this; conditional placement would silently bypass the Phase 99-N
    // regression. The line below MUST be the only set-site, outside any
    // delegate/non-delegate branch.
    //
    // Phase 999.3 D-INH-01..02 — sourceConfig (delegate when delegating,
    // caller otherwise) carries inherited fields: model/soul/identity/skills/
    // mcpServers/subagentModel/effortLevel/etc. via spread. parentConfig
    // contributes channel-scoped overrides AFTER the spread:
    //   channels: []           — never inherit channels for subagents
    //   threads: caller's      — D-INH-02, caller's quota wins
    //   webhook: composed      — caller's URL + delegate's identity
    //
    // Phase 106 DSCOPE-02 — strip `delegates` from spread. Subagents never
    // orchestrate further subagents (recursion-guard at disallowedTools below
    // is defense-in-depth; this strip removes the *directive text* from the
    // subagent's system prompt entirely so the LLM doesn't even see it).
    // Doing the strip at the caller keeps `renderDelegatesBlock` pure — the
    // primary-agent code path remains byte-identical (Phase 999.13 invariant).
    // Destructure-only (no mutation) so sourceConfig.delegates stays intact
    // for any other consumer that holds a reference to it.
    const { delegates: _strippedDelegates, ...subagentSourceConfig } =
      sourceConfig;

    const subagentConfig: ResolvedAgentConfig = {
      ...subagentSourceConfig,
      name: sessionName,
      model,
      channels: [],
      soul: (config.systemPrompt ?? sourceConfig.soul ?? "") + threadContext,
      schedules: [],
      slashCommands: [],
      webhook,
      threads: parentConfig.threads,
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
    // Phase 100 follow-up — post-reply chain:
    //   - autoRelay (default true): parent gets a synthetic turn in its
    //     main channel summarizing the subagent's output
    //   - autoArchive (default false): also archive thread + stop session
    //   - autoArchive implies autoRelay
    const autoArchive = config.autoArchive === true;
    const autoRelay = autoArchive || config.autoRelay !== false;
    void this.postInitialMessage(
      thread,
      sessionName,
      config.threadName,
      config.task,
      autoRelay,
      autoArchive,
    );

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
    thread: {
      send: (content: string) => Promise<{ edit: (content: string) => Promise<unknown>; id: string } | unknown>;
      id: string;
    },
    sessionName: string,
    threadName: string,
    task: string | undefined,
    autoRelay: boolean,
    autoArchive: boolean,
  ): Promise<void> {
    try {
      const prompt = task
        ? task
        : `You've just been spawned in a Discord thread titled "${threadName}". ` +
          `Introduce yourself in 1-2 short sentences based on your soul and state what you're ready to do. ` +
          `No filler, no meta-commentary about being an AI.`;

      // Phase 100 follow-up — progressive streaming into the thread.
      // Send a single placeholder, then edit it as the SDK streams tokens
      // back. Final flush captures any tail that didn't trigger an edit
      // (the editor debounces to 750ms by default to stay under Discord's
      // 5-edits-per-5-sec rate limit). When streaming produces >2000
      // chars, the editor truncates the edited message — we follow up
      // with thread.send() chunks for the overflow after the stream
      // completes (mirroring the pattern at slash-commands.ts:1550).
      const placeholder = await thread.send("🔄 Working...");
      const editable = (placeholder ?? {}) as { edit?: (content: string) => Promise<unknown> };
      const canEdit = typeof editable.edit === "function";

      // Phase 100-fu — log streaming startup so the next overflow-related
      // failure has a breadcrumb (canEdit=true means we'll use the
      // edit-based progressive path; false means we fall back to single
      // send at the end).
      this.log.info(
        { sessionName, threadId: thread.id, canEdit, hasPlaceholder: Boolean(placeholder) },
        "subagent thread streaming initialized",
      );

      // If the surface doesn't support edit (test mocks, old discord.js),
      // fall back to the prior behavior — single send at the end.
      let lastSent = "";
      const editor = canEdit
        ? new ProgressiveMessageEditor({
            editFn: async (content: string) => {
              // Phase 100 follow-up — wrap raw markdown tables in ```text```
              // fences so Discord renders monospaced + columns visibly align.
              const wrapped = wrapMarkdownTablesInCodeFence(content);
              const truncated = wrapped.length > 2000 ? wrapped.slice(0, 1997) + "..." : wrapped;
              if (truncated === lastSent) return;
              lastSent = truncated;
              await editable.edit!(truncated);
            },
            editIntervalMs: 750,
            log: this.log,
            agent: sessionName,
          })
        : null;

      const reply = await this.sessionManager.streamFromAgent(
        sessionName,
        prompt,
        editor ? (accumulated: string) => editor.update(accumulated) : () => {},
      );
      if (editor) await editor.flush();

      // Defensive: streamFromAgent may resolve with undefined under test mocks
      // or if the SDK returns nothing. Treat undefined as empty.
      const text = wrapMarkdownTablesInCodeFence((reply ?? "").trim());
      if (!canEdit && text) {
        // Fallback path — send the final reply as a fresh message.
        await thread.send(text.slice(0, 2000));
      }
      // Phase 100 follow-up — handle overflow when reply exceeds 2000 chars.
      // The editor truncated the visible message; send the tail as
      // additional thread.send() chunks so nothing is lost.
      //
      // Phase 100-fu (2026-04-28) — structured diagnostics. Without an
      // aggregate "summary" log line, the next time Discord silently
      // dropped chunks there was no breadcrumb to debug from. Capture
      // totalLength + chunksSent + fullySent + lastError so the failure
      // mode is observable in production logs.
      if (canEdit && text.length > 2000) {
        let cursor = 2000;
        let chunksSent = 0;
        let lastError: string | null = null;
        while (cursor < text.length) {
          const chunk = text.slice(cursor, cursor + 2000);
          try {
            await thread.send(chunk);
            chunksSent++;
          } catch (err) {
            lastError = (err as Error).message;
            this.log.warn(
              {
                sessionName,
                threadId: thread.id,
                chunkIndex: chunksSent,
                cursor,
                totalLength: text.length,
                error: lastError,
              },
              "subagent overflow chunk send failed (non-fatal — continuing if possible)",
            );
            break;
          }
          cursor += 2000;
        }
        this.log.info(
          {
            sessionName,
            threadId: thread.id,
            totalLength: text.length,
            chunksSent,
            lastError,
            fullySent: cursor >= text.length,
          },
          "subagent overflow chunks summary",
        );
      }
    } catch (err) {
      this.log.warn(
        { sessionName, error: (err as Error).message, hadTask: Boolean(task) },
        "subagent initial message failed",
      );
    }
    // Phase 100 follow-up — post-reply chain. Runs even if the initial
    // message failed, because the operator wanted notification and a
    // dangling thread is worse than no summary. Each step has its own
    // try/catch so a failure in one doesn't block the others.
    if (autoRelay) {
      try {
        await this.relayCompletionToParent(thread.id);
      } catch (err) {
        this.log.warn(
          { threadId: thread.id, sessionName, error: (err as Error).message },
          "auto-relay: relayCompletionToParent failed (non-fatal)",
        );
      }
    }
    if (autoArchive) {
      try {
        await this.archiveThread(thread.id);
      } catch (err) {
        this.log.warn(
          { threadId: thread.id, sessionName, error: (err as Error).message },
          "auto-archive: archiveThread failed (non-fatal)",
        );
      }
      try {
        await this.sessionManager.stopAgent(sessionName);
      } catch (err) {
        this.log.warn(
          { threadId: thread.id, sessionName, error: (err as Error).message },
          "auto-archive: stopAgent failed (non-fatal)",
        );
      }
      this.log.info(
        { threadId: thread.id, sessionName, threadName },
        "subagent auto-archived (relay + archive + stop)",
      );
    } else if (autoRelay) {
      this.log.info(
        { threadId: thread.id, sessionName, threadName },
        "subagent auto-relayed to parent (thread + session stay alive)",
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
