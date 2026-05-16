# Admin Clawdy memory drop — 2026-04-27

**Operator report:** "Admin Clawdy dropped memory of what we were working on entirely without restarting or anything. just mid conversation."

**Investigation status:** Complete (read-only audit, 2026-04-27).

## Top finding (1-line)

Session summarizer hit its 10-second timeout while flushing a 96-turn session at 13:34:56 UTC. It fell back to a raw-turn dump (96 unstructured turns, ~19.6K tokens). When the next session resumed at 13:38:14, the conversation-brief assembly tried to inject this raw dump but immediately hit the 2K token budget — `requestedCount: 3, actualCount: 1, tokens: 19696`. The brief was effectively empty, and Admin Clawdy's working memory of the prior 96 turns silently vanished.

## Timeline (2026-04-27 UTC)

| Time | Event |
|------|-------|
| 13:34:46.635 | Session manager drain complete (graceful daemon shutdown — likely operator-initiated `systemctl restart`) |
| 13:34:46.757 | Browser context close error for Admin Clawdy (non-fatal) |
| 13:34:46.873 | Final subagent cleanup for fin-acquisition threads |
| **13:34:56.899** | **`summarize timeout after 10000ms` — raw-turn fallback used** |
| 13:34:56.956 | 96 raw turns pruned after summarization fallback |
| 13:34:56.956 | Session marked `summarized` with `fallback=raw-turn` (NOT an LLM summary) |
| 13:34:57.020 | Admin Clawdy agent stopped |
| 13:35:03 | systemd reports memory peak — process exiting |
| 13:36:05 | New daemon PID 2214510 starts |
| 13:38:13 | Admin Clawdy memory initialized in new daemon |
| **13:38:14** | **`conversation-brief budget reached` — `requestedCount: 3, actualCount: 1, tokens: 19696, budgetTokens: 2000`** |
| 13:38:22 | New session starts with effectively empty resume-brief |

## Session structure (`conversation_sessions`)

| id | status | started_at | ended_at | turns | summary_memory_id |
|----|--------|------------|----------|-------|-------------------|
| `Uc4gUuhGiEaK0UWXXx09N` | active | 19:01:41 | NULL | 24 | NULL |
| `ai55YpTVNYXtkym68w3B8` | summarized | 13:38:13 | 19:01:39 | 138 | `tWOxIF2gsrYvuDIctrovL` |
| `wOlLICYDw75Gk_m9LWm-G` | summarized | 01:58:08 | 13:34:46 | **96** | `9RVzznTfECNbw6ZNBCzlP` ← **raw-turn fallback** |
| `uF6x72y2_WNjMnSivtmTl` | summarized | 00:47:41 | 01:54:48 | 2 | `HrddHoxA5POZJF7AAGj4_` |
| `Ozoypvtfon1EjadwPEeTL` | summarized | 00:39:38 | 00:44:23 | 2 | `MLqAs22IA6yhUbFcxjmiT` |

The 96-turn session's summary memory `9RVzznTfECNbw6ZNBCzlP` is the bloated raw-turn dump. Sessions before/after had small turn counts and didn't trigger the timeout.

## Smoking guns (journalctl)

```
13:34:56.899  level=40  "summarize timeout after 10000ms"
              session=wOlLICYDw75Gk_m9LWm-G
              "summarize failed — using raw-turn fallback"

13:34:56.956  level=30  "session summarized"
              session=wOlLICYDw75Gk_m9LWm-G
              memoryId=9RVzznTfECNbw6ZNBCzlP
              fallback=raw-turn
              turnCount=96

13:38:14.xxx  level=40  "conversation-brief budget reached"
              agent="Admin Clawdy"
              requestedCount=3
              actualCount=1
              tokens=19696
              budgetTokens=2000
              section=conversation_context
```

## Root cause hypotheses (ranked)

**1. Summarization timeout + raw-turn memory not handled by resume-brief — 99% confidence**
- Direct evidence: 10s timeout fires at exactly the failure moment
- Code: `src/memory/session-summarizer.ts:29` — `DEFAULT_TIMEOUT_MS = 10_000`
- Mechanism: Timeout → `buildRawTurnFallback()` (line 105) stores 96 raw turns as unstructured markdown → next session's `assembleConversationBrief()` retrieves it → 19,696 tokens vs 2,000 budget → truncation drops it → agent has no working memory

**2. summary_memory_id linkage gap — 15% confidence**
- New session 13:38:13 references `tWOxIF2gsrYvuDIctrovL` not the prior session's `9RVzznTfECNbw6ZNBCzlP`
- Less likely because `actualCount: 1` means brief assembly DID retrieve something — just truncated

**3. Daemon restart with silent restart-greeting — 5% confidence**
- The daemon DID restart (clean systemd cycle visible in journalctl)
- Phase 89 restart-greeting should have fired but operator says they didn't see one
- Possibly the greeting itself failed silently (separate Phase 89 bug)

## Reproducibility

**Triggers:**
1. Long-running session (50+ turns)
2. Summarizer LLM call >10s (Haiku latency spike, API throttle, network jitter)
3. Daemon shutdown coinciding with session boundary

**Repro recipe:**
1. Run any agent for 50+ turns
2. Mock `deps.summarize` to delay >10s
3. Trigger daemon shutdown mid-session
4. Observe new session has no working memory of prior

## Recommended fixes

**Fix 1 (highest leverage):** `src/memory/session-summarizer.ts:29` — bump `DEFAULT_TIMEOUT_MS` from `10_000` to `30_000`. A 96-turn Haiku summary call shouldn't take 10s under normal load, but spikes happen and the consequence (full memory loss) is far worse than the latency cost.

**Fix 2 (correctness):** When the summarizer falls back to raw-turn, tag the memory entry with `fallback: "raw-turn"` metadata. `conversation-brief` then knows to either (a) skip raw-turn summaries entirely + emit warning, or (b) generate a fresh LLM summary from the raw turns at brief-assembly time (slower but accurate).

**Fix 3 (telemetry):** When `actualCount < requestedCount` in conversation-brief, escalate log level to ERROR and emit a structured event the operator can monitor. Right now it's a level-40 warn buried in the daemon log; the operator only noticed because the agent acted weird.

**Fix 4 (defense):** Phase 89 restart-greeting should detect when the prior session ended with raw-turn fallback and surface it in the greeting embed: "⚠ Prior session summary used raw-turn fallback — context may be lossy."

## Files for code changes

- `src/memory/session-summarizer.ts` — DEFAULT_TIMEOUT_MS bump + fallback metadata tag
- `src/memory/conversation-brief.ts` — raw-turn-aware brief assembly
- `src/manager/restart-greeting.ts` — surface raw-turn fallback warning
- New tests covering: timeout extension, raw-turn detection, oversized-budget handling

## Notes

- 1,182 memories total in fin-acquisition's DB (separate agent — different bug)
- Admin Clawdy's memories.db wasn't directly inspected for tier counts during this audit (focus was on conversation_sessions / turns)
- The same bug class likely affects ALL agents with long sessions, not just Admin Clawdy
