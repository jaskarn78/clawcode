import type { ConversationTurn } from "../../memory/conversation-types.js";

export type ActiveStateBlock = {
  readonly primaryClient: string | null;
  readonly inFlightTasks: readonly string[];
  readonly standingRulesAddedToday: readonly string[];
  readonly driveFoldersTouched: readonly string[];
  readonly lastOperatorMessages: readonly string[];
  readonly lastAgentCommitments: readonly string[];
  readonly generatedAt: string;
};

export type BuildActiveStateInput = {
  readonly recentOperatorMessages: readonly string[];
  readonly recentAgentTurns: readonly ConversationTurn[];
  readonly agentName: string;
  readonly clock: () => Date;
};
