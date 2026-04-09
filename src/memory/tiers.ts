/**
 * Pure tier transition functions for memory storage tiers.
 *
 * Determines when memories should move between hot, warm, and cold tiers
 * based on access patterns and relevance scores. All functions are pure
 * (no side effects, no I/O).
 */

import { differenceInDays } from "date-fns";
import { calculateRelevanceScore } from "./decay.js";

/** Configuration for tier transition thresholds. */
export type TierConfig = {
  readonly hotAccessThreshold: number;
  readonly hotAccessWindowDays: number;
  readonly hotDemotionDays: number;
  readonly coldRelevanceThreshold: number;
  readonly hotBudget: number;
};

/** Default tier configuration matching D-05/D-06/D-07/D-09 design decisions. */
export const DEFAULT_TIER_CONFIG: Readonly<TierConfig> = Object.freeze({
  hotAccessThreshold: 3,
  hotAccessWindowDays: 7,
  hotDemotionDays: 7,
  coldRelevanceThreshold: 0.05,
  hotBudget: 20,
});

/**
 * Determine if a memory should be promoted from warm to hot tier (D-05).
 *
 * Requires both sufficient access count AND recent access within the window.
 *
 * @param accessCount - Number of times the memory has been accessed
 * @param accessedAt - ISO 8601 timestamp of last access
 * @param now - Current reference time
 * @param config - Tier configuration thresholds
 * @returns true if memory qualifies for hot tier promotion
 */
export function shouldPromoteToHot(
  accessCount: number,
  accessedAt: string,
  now: Date,
  config: TierConfig,
): boolean {
  if (accessCount < config.hotAccessThreshold) {
    return false;
  }

  const daysSinceAccess = differenceInDays(now, new Date(accessedAt));
  return daysSinceAccess <= config.hotAccessWindowDays;
}

/**
 * Determine if a memory should be demoted from hot to warm tier (D-06).
 *
 * A hot memory that hasn't been accessed within the demotion window
 * should be moved back to warm.
 *
 * @param accessedAt - ISO 8601 timestamp of last access
 * @param now - Current reference time
 * @param config - Tier configuration thresholds
 * @returns true if memory should be demoted to warm
 */
export function shouldDemoteToWarm(
  accessedAt: string,
  now: Date,
  config: TierConfig,
): boolean {
  const daysSinceAccess = differenceInDays(now, new Date(accessedAt));
  return daysSinceAccess >= config.hotDemotionDays;
}

/**
 * Determine if a memory should be archived to cold tier (D-07).
 *
 * Uses the relevance decay score (importance * half-life decay) to determine
 * if a memory has become irrelevant enough to archive.
 *
 * @param importance - Base importance score (0-1)
 * @param accessedAt - ISO 8601 timestamp of last access
 * @param now - Current reference time
 * @param config - Tier configuration thresholds
 * @returns true if memory should be archived to cold
 */
export function shouldArchiveToCold(
  importance: number,
  accessedAt: string,
  now: Date,
  config: TierConfig,
): boolean {
  const relevanceScore = calculateRelevanceScore(
    importance,
    accessedAt,
    now,
    { halfLifeDays: 30 },
  );
  return relevanceScore < config.coldRelevanceThreshold;
}
