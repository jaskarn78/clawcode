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
