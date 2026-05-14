import type { Logger } from "pino";
import type { ConversationTurn } from "../../memory/compaction.js";

export type ExtractMemoriesFn = (text: string) => Promise<readonly string[]>;

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
