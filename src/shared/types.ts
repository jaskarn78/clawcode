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
    readonly consolidation: {
      readonly enabled: boolean;
      readonly weeklyThreshold: number;
      readonly monthlyThreshold: number;
      readonly summaryModel?: "sonnet" | "opus" | "haiku";
    };
    readonly decay: {
      readonly halfLifeDays: number;
      readonly semanticWeight: number;
      readonly decayWeight: number;
    };
    readonly deduplication: {
      readonly enabled: boolean;
      readonly similarityThreshold: number;
    };
    readonly tiers?: {
      readonly hotAccessThreshold: number;
      readonly hotAccessWindowDays: number;
      readonly hotDemotionDays: number;
      readonly coldRelevanceThreshold: number;
      readonly hotBudget: number;
    };
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
  readonly skillsPath: string;
  readonly schedules: readonly {
    readonly name: string;
    readonly cron: string;
    readonly prompt: string;
    readonly enabled: boolean;
  }[];
  readonly admin: boolean;
  readonly subagentModel: "sonnet" | "opus" | "haiku" | undefined;
  readonly threads: {
    readonly idleTimeoutMinutes: number;
    readonly maxThreadSessions: number;
  };
  readonly webhook?: {
    readonly displayName: string;
    readonly avatarUrl?: string;
    readonly webhookUrl?: string;
  };
  readonly slashCommands: readonly {
    readonly name: string;
    readonly description: string;
    readonly claudeCommand: string;
    readonly options: readonly {
      readonly name: string;
      readonly type: number;
      readonly description: string;
      readonly required: boolean;
    }[];
  }[];
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
