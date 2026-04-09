/**
 * Resolved agent configuration after defaults merging.
 * All optional fields from the raw config are resolved to concrete values.
 */
export type ResolvedAgentConfig = {
  readonly name: string;
  readonly workspace: string;
  readonly channels: readonly string[];
  readonly model: "sonnet" | "opus" | "haiku";
  readonly skills: readonly string[];
  readonly soul: string | undefined;
  readonly identity: string | undefined;
  readonly memory: {
    readonly compactionThreshold: number;
    readonly searchTopK: number;
  };
  readonly heartbeat: {
    readonly enabled: boolean;
    readonly intervalSeconds: number;
    readonly checkTimeoutSeconds: number;
    readonly contextFill: {
      readonly warningThreshold: number;
      readonly criticalThreshold: number;
    };
  };
};

/**
 * Result of creating or verifying a workspace directory.
 */
export type WorkspaceResult = {
  readonly agentName: string;
  readonly path: string;
  readonly created: boolean;
  readonly filesWritten: readonly string[];
};
