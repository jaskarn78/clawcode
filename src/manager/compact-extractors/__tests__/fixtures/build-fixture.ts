/**
 * Synthetic 6-hour fin-acquisition replay fixture builder.
 *
 * Pure code (no Node side effects) — tests call `buildSyntheticReplay()`
 * to get a frozen ConversationTurn[]. The shape mirrors what a real
 * production heartbeat-heavy session looks like for fin-acquisition over
 * a typical operator workday: ~60% heartbeat probe noise, ~20% repeated
 * tool calls (the kind of bookkeeping the agent does without operator
 * input), ~15% real work turns (operator messages + assistant deliverables),
 * ~5% failed-then-retried tool calls. Total ≥ 400 turns.
 *
 * Asserted properties (used by seam-integration.test.ts):
 *   - At least 400 turns.
 *   - Includes the `[125-01-active-state]` sentinel marker (Plan 01 wire).
 *   - Includes turns mentioning "AUM" and "$45M" (SC-8 verbatim patterns).
 *   - Includes turns mentioning SOUL.md / IDENTITY.md / daily-notes paths.
 */
import type { ConversationTurn } from "../../../../memory/compaction.js";

const OPERATOR_MSGS: readonly string[] = Object.freeze([
  "What's the status on the Ramy term-sheet?",
  "Push the AUM update to the deck.",
  "Need the $45M close note by EOD.",
  "Loop me in when the lawyer responds.",
  "Confirm SOUL.md identity loaded.",
]);

const ASSISTANT_WORK: readonly string[] = Object.freeze([
  "Reviewed daily-notes/2026-05-14/ramy-sync.md and updated the term-sheet column.",
  "Posted the AUM update; lawyer copied on thread.",
  "Drafted the $45M close note; pending Ramy approval.",
  "Lawyer responded: needs revised closing date.",
  "Reloaded SOUL.md + IDENTITY.md; persona intact.",
]);

export function buildSyntheticReplay(): readonly ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const start = new Date("2026-05-14T08:00:00Z").getTime();
  let i = 0;
  const ts = (): string => new Date(start + i++ * 45_000).toISOString();

  const PROBE_COUNT = 252;
  const REPEAT_GROUPS = 28;
  const REPEAT_REPS = 3;
  const WORK_COUNT = 63;
  const FAIL_TRIPLETS = 7;

  for (let p = 0; p < PROBE_COUNT; p++) {
    const role: "user" | "assistant" = p % 2 === 0 ? "user" : "assistant";
    const content =
      p % 3 === 0
        ? `[125-01-active-state] header tick ${p}`
        : p % 3 === 1
        ? `HEARTBEAT_OK probe id=${p}`
        : `--- ACTIVE STATE ---\nfield: value-${p}`;
    turns.push(Object.freeze({ timestamp: ts(), role, content }));
  }

  for (let r = 0; r < REPEAT_GROUPS; r++) {
    const argHash = `{"path":"file-${r}.ts"}`;
    for (let k = 0; k < REPEAT_REPS; k++) {
      turns.push(
        Object.freeze({
          timestamp: ts(),
          role: "assistant" as const,
          content: `tool_use: read_file args: ${argHash}`,
        }),
      );
    }
  }

  for (let w = 0; w < WORK_COUNT; w++) {
    const role: "user" | "assistant" = w % 2 === 0 ? "user" : "assistant";
    const content =
      role === "user"
        ? OPERATOR_MSGS[w % OPERATOR_MSGS.length]
        : ASSISTANT_WORK[w % ASSISTANT_WORK.length];
    turns.push(Object.freeze({ timestamp: ts(), role, content }));
  }

  for (let f = 0; f < FAIL_TRIPLETS; f++) {
    turns.push(
      Object.freeze({
        timestamp: ts(),
        role: "assistant" as const,
        content: "tool_result: fetch_url failed",
      }),
    );
    turns.push(
      Object.freeze({
        timestamp: ts(),
        role: "assistant" as const,
        content: `tool_use: fetch_url args: retry-${f}`,
      }),
    );
    turns.push(
      Object.freeze({
        timestamp: ts(),
        role: "assistant" as const,
        content: "tool_result: fetch_url ok",
      }),
    );
  }

  return Object.freeze(turns);
}
