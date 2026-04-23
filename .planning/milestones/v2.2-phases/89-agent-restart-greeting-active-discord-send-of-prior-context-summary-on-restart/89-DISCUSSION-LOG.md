# Phase 89: Agent Restart Greeting — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart
**Areas discussed:** Trigger conditions, Greeting content, Fleet scope & opt-in, Delivery format & dedup

---

## Trigger conditions

### Which lifecycle events fire a greeting?

| Option | Description | Selected |
|--------|-------------|----------|
| Only restartAgent() | Greeting fires only on explicit restart (/clawcode-restart) + startAll-after-crash-reconcile. First-ever startAgent stays silent. | ✓ |
| All startAgent() calls | Every session boot (first-ever, restart, crash, fork, subagent) emits a greeting. | |
| startAgent when prior session exists | Greet whenever ConversationStore has a terminated session. | |

**User's choice:** Only restartAgent() (recommended)

---

### On fresh daemon boot, should startAll() fire greetings for all resumed agents?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, each resumed agent greets | Full daemon restart = each channel gets its greeting. | |
| No, only individual /clawcode-restart greets | Daemon startAll() silently resumes; only per-agent restarts greet. | |
| Only for agents with recent activity | startAll() greets only agents whose last turn was within N hours. | |

**User's choice (free text):** "each agent should be loaded up with its memory on fresh daemon boot, but dont need a greeting. Greetings only when restarting individual agents"
**Notes:** Aligns with the "No, only individual /clawcode-restart greets" option — daemon boot is silent by explicit decision.

---

### How should forks and subagent threads behave?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip forks + subagent threads | Forks are ephemeral escalation; subagent threads are bot-to-bot. No human-facing greeting needed. | ✓ |
| Greet forks too | Every spawned session greets its channel. | |
| Skip forks only; greet subagent threads | Forks skip; subagent threads greet. | |

**User's choice:** Skip forks + subagent threads (recommended)

---

### Should the greeting distinguish clean restart vs crash recovery?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, different message for crash | Clean: "I'm back — last session: X." Crash: "Recovered after unexpected shutdown — last stable state: X." | ✓ |
| No, same greeting either way | One greeting template covers all paths. | |
| Crash-only greeting | Skip clean restart; greet only involuntary restarts. | |

**User's choice:** Yes, different message for crash (recommended)

---

## Greeting content

### Where does the summary text come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse assembleConversationBrief | v1.9 helper output, formatted for Discord. Zero new summarization cost. | |
| Fresh Haiku summarization | Per-restart Haiku call against last N turns for Discord-tuned ~200-word summary. | ✓ |
| Minimal status line (no summary) | "I'm back online. Last active 2h ago." | |
| Agent drafts its own greeting | First prompt post-restart is a system instruction; agent's reply is the greeting. | |

**User's choice:** Fresh Haiku summarization
**Notes:** Researcher should evaluate reusing the v1.9 SessionSummarizer pipeline (summarize-with-haiku.ts) with a Discord-tuned prompt vs a new sibling summarizer.

---

### Target length / Discord budget?

| Option | Description | Selected |
|--------|-------------|----------|
| Tight — under ~500 chars | Fits in a single embed description; reads as a quick glance. | ✓ |
| Medium — up to ~1500 chars | One embed with multiple fields (last-active, summary, open items). | |
| Full brief — paginate if >2000 | Render assembleConversationBrief verbatim. | |

**User's choice:** Tight — under ~500 chars (recommended)

---

### Which fields should the greeting surface? (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Last-active timestamp | Human-readable relative time. | |
| Prior-session summary | Core text of what was happening. | ✓ |
| Model + effort active | Runtime-configurable state operators toggle. | |
| Open loops / pending items | Unfinished TODOs flagged in session summary. | |

**User's choice:** Prior-session summary only
**Notes:** Minimal field set — just the prior-session summary, no timestamp/model/effort/loops.

---

### Whose voice speaks the greeting?

| Option | Description | Selected |
|--------|-------------|----------|
| Agent's first-person voice | "💠 I'm back online — last we were..." via the agent's webhook (avatar + name). | ✓ |
| System/bot third-person | "Clawdy restarted at 14:32. Prior context: ..." via bot channel.send. | |
| Hybrid — system header + agent body | Embed header operational, body first-person. | |

**User's choice:** Agent's first-person voice (recommended)

---

## Fleet scope & opt-in

### Should operators be able to opt an agent out of greetings?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent config flag | agents.*.greetOnRestart: boolean (default true) + defaults.greetOnRestart fallback. Reloadable. | ✓ |
| No opt-out — always greet on restart | Every restart emits. | |
| Global toggle only | Single defaults.greetOnRestart; no per-agent override. | |

**User's choice:** Per-agent config flag (recommended)

---

### Stale agents — what if an agent hasn't been used in days/weeks?

| Option | Description | Selected |
|--------|-------------|----------|
| Still greet | Dormant agents still greet; staleness is useful context. | |
| Skip if last activity > N days | Configurable recency threshold; dormant agents silent. | ✓ |
| Greet but mark dormant | Different tone/visual for dormant. | |

**User's choice:** Skip if last activity > N days

#### Follow-up: What's N?

| Option | Description | Selected |
|--------|-------------|----------|
| 7 days | One week | ✓ |
| 14 days | Two weeks (recommended) | |
| 30 days | One month | |
| Configurable per agent/global | defaults.greetStaleDays + per-agent override | |

**User's choice:** 7 days

---

### What if the agent has no prior-session summary?

| Option | Description | Selected |
|--------|-------------|----------|
| Fallback minimal greeting | "💠 Clawdy online." — no summary section. | |
| Skip greeting entirely | No prior context → no greeting. | ✓ |
| Greet with workspace identity | Use IDENTITY.md vibe-line instead of session summary. | |

**User's choice:** Skip greeting entirely

---

### Shared workspaces (finmentum family): each greet its own channel?

| Option | Description | Selected |
|--------|-------------|----------|
| Each greets own channel independently | Standard semantics. | |
| One greeting per workspace, broadcast to all channels | Fan-out across the family. | |
| Skip greetings for shared-workspace agents | Carve-out. | |

**User's choice (initial, free text):** "Only greet the last worked on channel for shared workspace agents"

#### Clarification follow-up

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — restart greets the restarted agent's own channel | Obvious standard semantics. | ✓ |
| No — fleet-wide dedup across sibling restarts | Only the most-recently-active sibling greets when multiple are restarted together. | |
| No — skip greetings entirely for shared-workspace agents | Carve-out. | |

**User's choice:** Yes — restart greets the restarted agent's own channel (recommended)

---

## Delivery format & dedup

### Delivery vehicle

| Option | Description | Selected |
|--------|-------------|----------|
| Webhook + EmbedBuilder | Agent webhook identity + UI-01 embed. | ✓ |
| Webhook + plain text | Webhook identity, plain string. | |
| Bot channel.send + EmbedBuilder | Daemon-attributed bot identity, embed format. | |

**User's choice:** Webhook + EmbedBuilder (recommended)

---

### Crash-loop suppression

| Option | Description | Selected |
|--------|-------------|----------|
| Cool-down — max 1 greeting per N minutes | Per-agent timestamp; default N=5min, configurable. | ✓ |
| Max 1 greeting per daemon-boot | In-memory already-greeted set. | |
| No dedup | Every restartAgent() fires. | |

**User's choice:** Cool-down — max 1 greeting per N minutes (recommended)

---

### Message identity

| Option | Description | Selected |
|--------|-------------|----------|
| New message every restart | Fresh Discord message each time; scroll history preserved. | ✓ |
| Edit last greeting in place | Track messageId per agent; edit instead of post. | |

**User's choice:** New message every restart (recommended)

---

### Delivery failure behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Log + continue session start | Best-effort; fire-and-forget pattern. | ✓ |
| Retry via DiscordDeliveryQueue | Route through v1.2 queue; same non-blocking semantics. | |
| Fail the restart | Couple session health to Discord availability. | |

**User's choice:** Log + continue session start (recommended)

---

## Claude's Discretion

- Haiku prompt wording for <500-char Discord-tuned summary
- Reuse SessionSummarizer with new prompt mode vs dedicated greetingSummarizer
- Crash-recovery classifier implementation (registry.restartCount delta + session-recovery signals)
- Embed visual shape (title, color, thumbnail reuse of webhook avatar, footer)
- Cool-down Map daemon-boot-reset semantics (acceptable — startAll silent)
- Schema field naming style (greetOnRestart vs greetingsEnabled)

## Deferred Ideas

- Slash-command toggle /clawcode-greet on|off
- Observability metrics (counters for sent/skipped/failed)
- Per-channel greet policy (multi-channel-bound agents)
- Edit-in-place greeting mode
- Fork-session greetings
- Model + effort surface in greeting (D-07 exclusion revisitable)
