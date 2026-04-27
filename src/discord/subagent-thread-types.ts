/**
 * Configuration for spawning a subagent in a Discord thread.
 */
export type SubagentThreadConfig = {
  readonly parentAgentName: string;
  readonly threadName: string;
  readonly systemPrompt?: string;
  readonly model?: "sonnet" | "opus" | "haiku";
  /**
   * Initial task for the subagent. When provided, the spawner sends this as
   * the first user message after the session starts and streams the response
   * into the Discord thread. When absent, the spawner falls back to an intro
   * prompt so the thread isn't silent.
   */
  readonly task?: string;
  /**
   * Phase 100 follow-up — fire-and-forget pattern. When true, after the
   * subagent posts its initial-task reply to the thread:
   *   1. relayCompletionToParent dispatches a summary turn to the parent
   *      agent (parent posts the one-line summary in main channel).
   *   2. archiveThread closes the Discord thread + prunes the registry
   *      binding (frees up maxThreadSessions slot for next spawn).
   *   3. The subagent session is stopped.
   *
   * Best paired with `task` set — short-lived "do one thing then go away"
   * subagents. For interactive subagents (operator follow-ups expected),
   * leave autoArchive false (default) and call archive_thread manually
   * when done.
   */
  readonly autoArchive?: boolean;
};

/**
 * Result of spawning a subagent in a Discord thread.
 */
export type SubagentSpawnResult = {
  readonly threadId: string;
  readonly sessionName: string;
  readonly parentAgent: string;
  readonly channelId: string;
};
