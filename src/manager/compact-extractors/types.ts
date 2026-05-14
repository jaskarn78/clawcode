import type { Logger } from "pino";
import type { ConversationTurn } from "../../memory/compaction.js";

export type ExtractMemoriesFn = (text: string) => Promise<readonly string[]>;

/**
 * Phase 125 Plan 03 — Tier 2 structured-extraction output.
 *
 * Mirrors the schema enforced by `tier2-prompt.ts` and validated by
 * `tier2-parser.ts`. Always frozen; absent categories are empty arrays.
 */
export type Tier2Decision = {
  readonly decision: string;
  readonly context: string;
};

export type Tier2StandingRule = {
  readonly rule: string;
  readonly changedAt: string;
};

export type Tier2InFlightTask = {
  readonly task: string;
  readonly state: string;
};

export type Tier2CriticalNumber = {
  readonly context: string;
  readonly value: string;
};

export type Tier2Facts = {
  readonly activeClients: readonly string[];
  readonly decisions: readonly Tier2Decision[];
  readonly standingRulesChanged: readonly Tier2StandingRule[];
  readonly inFlightTasks: readonly Tier2InFlightTask[];
  readonly drivePathsTouched: readonly string[];
  readonly criticalNumbers: readonly Tier2CriticalNumber[];
};

/**
 * DI'd Haiku invocation callback — matches `FlushSummarizeFn` from
 * `src/memory/memory-flush.ts` and `summarizeWithHaiku` in production.
 * Returning empty string is the well-known "skip" signal.
 */
export type Tier2SummarizeFn = (
  prompt: string,
  opts: { readonly signal?: AbortSignal },
) => Promise<string>;

export type ExtractorDeps = Readonly<{
  preserveLastTurns: number;
  preserveVerbatimPatterns: readonly RegExp[];
  clock: () => Date;
  log: Logger;
  agentName: string;
}>;

export type PartitionResult = Readonly<{
  preserved: readonly ConversationTurn[];
  toCompact: readonly ConversationTurn[];
}>;

export type VerbatimGate = (
  turns: readonly ConversationTurn[],
  deps: ExtractorDeps,
) => PartitionResult;

export type DropFilter = (
  turns: readonly ConversationTurn[],
  deps: ExtractorDeps,
) => readonly ConversationTurn[];

export type BuildExtractorDeps = Readonly<{
  preserveLastTurns: number;
  preserveVerbatimPatterns: readonly RegExp[];
  preservedTurns: readonly ConversationTurn[];
  clock: () => Date;
  log: Logger;
  agentName: string;
  maxChunks?: number;
}>;
