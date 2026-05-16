# Backlog: Intelligent Auto-Compaction Strategy

## 999.52 — Intelligent session compaction that preserves load-bearing context while collapsing noise

Pairs with [999.51 — Operator-Triggered Session Compaction]. That item covers *when* and *how to invoke* compaction (CLI subcommand, operator triggers, policy decoupling). **This item covers *how compaction decides what to keep and what to summarize*.**

The naive baseline (Claude Code SDK `/compact`) writes one long summary turn at a fixed threshold. That works, but it can flatten load-bearing detail (active client state, today's commitments, recently-set standing rules from Ramy) into a generic prose blob. Result: agent loses context that operator needs preserved.

Operator (Jas, 2026-05-13 16:40 PT) asked for **automatic, intelligent** compaction that keeps responses fast + snappy AND retains all relevant information. This item specifies what "intelligent" means for the Finmentum agents specifically.

### Goals

1. **Latency:** first-token latency under 8 s for a typical Ramy iteration (current: ~30–60 s after 6 hours of work, 4 min total turn for stacked messages)
2. **No state loss:** every turn after compaction has access to the same load-bearing context as before — client names, in-flight tasks, today's commitments, latest standing-rule changes, Drive folder paths
3. **No agent drift:** compaction shouldn't erase Ramy's preferences or recently-set feedback rules
4. **No human review required:** compaction happens automatically without operator approval (operator can disable per-agent if desired)

### Tiered retention policy (proposed)

Treat the conversation as four tiers, each with its own retention rule:

```
TIER 1 — VERBATIM (never compacted)
  - The last N turns (suggest N=10)
  - System prompts (SOUL.md, IDENTITY.md, agent config)
  - Today's daily-notes file content (if loaded)
  - The last 3 user-supplied messages from the operator
  - Recent tool_use + tool_result pairs that emitted Discord messages
    (because the operator needs ground truth on what the agent told them)

TIER 2 — STRUCTURED EXTRACTION (compacted but preserved)
  - For each compacted block, agent runs a structured extractor that pulls:
      • Active client names mentioned
      • Decisions made ("we agreed X")
      • Standing rules surfaced or changed
      • In-flight tasks not yet complete
      • Drive/file paths referenced
      • Specific numbers (AUM figures, dates, prices) — recover-or-lose-it stuff
  - Output: a structured summary block, NOT prose
  - Format: YAML-like or JSON inside a single turn, easy for the agent to re-parse

TIER 3 — PROSE SUMMARY (collapsed)
  - Everything else from compacted turns gets a 2-3 sentence prose summary
  - Long tool_use payloads (base64 PDFs, large MCP responses) → "tool X ran,
    returned a Y of Z bytes" (drop the bytes entirely)

TIER 4 — DROPPED
  - Repeated identical tool calls (e.g., 10× Read of the same file with
    different offsets in the same edit session) — collapse to "read file X
    across N calls"
  - Heartbeat probe turns
  - Failed-and-retried tool calls where a later retry succeeded
```

### What gets included in the rolling summary

A persistent **"active state header"** that grows / shrinks but is always at the top of the session after compaction:

```
ACTIVE STATE (auto-maintained)
- Today's primary client: <name>
- In-flight tasks:
  - <task> · <state>
- Standing rules added today:
  - <rule>
- Drive folders touched:
  - clients/<Name>/ · <last action>
- Latest Ramy feedback (last 3 messages, verbatim):
  > <msg1>
  > <msg2>
  > <msg3>
```

This block is rebuilt every compaction and kept at the top. Agent reads it first on every turn → cheap retrieval of "where are we."

### Acceptance criteria

- Auto-compaction fires when session JSONL crosses operator-configured threshold (e.g., 5 MB or 70% context fill — per-agent setting)
- Post-compaction, sample turn latency is under 10 s first-token (measure via `clawcode usage` over 5 consecutive turns)
- A scripted comparison test: send the agent identical prompts pre- and post-compaction, assert response contains the same client name, task state, and most recent feedback (within fuzzy match)
- Operator can inspect the structured-extraction block (Tier 2 output) directly — it's stored in a known location (e.g., `~/.clawcode/agents/<agent>/state/active-state.yaml`)
- Compaction never drops the last 10 verbatim turns or the SOUL/IDENTITY system blocks
- Per-agent override: Finmentum agents can declare additional "preserve verbatim" patterns (e.g., "any line mentioning AUM, any line with a $ amount")

### Implementation notes

- The structured extractor (Tier 2) is a separate small model invocation — could be haiku-driven. Cheaper than running compaction in-band on the main worker
- Compaction runs **out-of-band** — daemon spawns a haiku worker against the session JSONL, computes the new compacted prefix, hands it back to the main worker which restarts with the smaller context. Main worker is briefly paused (seconds), not blocked for minutes
- The active-state header (sticky top block) is the cheapest win — even without tiered retention, just maintaining a 50-line state block at the top of the session reduces operator-pain by 80%
- Ties into agent memory.db — Tier 2 extraction results could ALSO be written to memory.db chunks so they survive a full reset, not just compaction

### Suggested incremental rollout

1. **Phase 1 (cheap):** active-state header only. Daemon maintains a sticky block per agent based on operator's last 5 messages + agent's last 5 commitments. No compaction yet.
2. **Phase 2:** add Tier 1 verbatim + Tier 4 drop rules (heartbeat noise, repeat tool calls). Measurable latency win, low risk.
3. **Phase 3:** add Tier 2 structured extraction. Requires haiku worker plumbing.
4. **Phase 4:** add Tier 3 prose summary. Final tier; this is where most of the size reduction comes from.

### Related

- 999.51 — Operator-triggered compaction (CLI + policy decoupling). This item builds on that one — 999.51 ships the trigger; 999.52 ships the algorithm.
- 999.48 — Heartbeat reply leak (sibling daemon-output concern; heartbeat probes are explicit Tier 4 drop candidates)
- `feedback_recall_via_discord_history.md` — operator currently routes around context loss by re-reading Discord; intelligent compaction reduces dependence on this workaround
- Ramy's burst-async messaging style (memory: `Ramy's non-obvious hard rules`) — preserving last 3 Ramy messages verbatim addresses Ramy-specific context needs

### Reporter

Jas, 2026-05-13 16:40 PT — surfaced after observing the gap between "operator-triggered manual compact" (999.51) and "automatic + intelligent" (what operators actually want for daily workflow)
