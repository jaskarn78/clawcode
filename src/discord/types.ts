/**
 * Routing table mapping Discord channels to agents.
 * Immutable after construction -- no mutation after startup.
 */
export type RoutingTable = {
  readonly channelToAgent: ReadonlyMap<string, string>;
  readonly agentToChannels: ReadonlyMap<string, readonly string[]>;
};
