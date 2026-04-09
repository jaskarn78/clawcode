/**
 * Configuration for spawning a subagent in a Discord thread.
 */
export type SubagentThreadConfig = {
  readonly parentAgentName: string;
  readonly threadName: string;
  readonly systemPrompt?: string;
  readonly model?: "sonnet" | "opus" | "haiku";
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
