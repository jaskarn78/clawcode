# Backlog: Operator-Triggered Session Compaction

## 999.51 — First-class `clawcode session compact` ergonomics + decoupling "auto-reset" from "auto-compaction" policy

Today there is no clean way for an operator to compact a long-running agent session. The `clawcode` CLI exposes `init / start / stop / restart / start-all / stop-all / status / send / fork / threads / webhooks / memory / usage / delivery-queue / security / spawn-thread`, but **no `compact`**. Workarounds (send literal `/compact` as a message, or `restart` to nuke the session JSONL) are untested or destructive.

Meanwhile, agent sessions grow unbounded because the Finmentum agents' heartbeat policy explicitly disables auto-reset *and* auto-compaction together. This conflates two distinct concerns:

- **Reset** = blow away the session and start fresh. Should remain operator-controlled — Ramy/Jas want to decide when state is discarded.
- **Compaction** = collapse the conversation history into a summary so the working context window shrinks, *without* losing memory. Should be allowed and cheap.

Today both are gated by the same "do not /clear, do not auto-reset" rule, so compaction never fires, and the session JSONL grows to 8+ MB after a few hours of active work — slow first-token latency, slow tool-chain turns, painful chat UX.

### Symptoms (verified 2026-05-13 ~16:30 PT)

- `fin-acquisition` session JSONL: 8.5 MB after 6 hours of work
- Zero `"type":"summary"` entries in that JSONL → compaction has never fired this session
- Ramy stacked 3 messages in 2 min; fin-acq took **~4 min** to respond — long first-token latency consistent with large context
- Operator (Jas) flagged this as "5+ min to respond is very long" and asked how to compact — no clean answer exists today

### Why this happens (root cause)

1. **Heartbeat prompt** (clawcode.yaml, finmentum-content-creator block):
   ```
   ## ⚠️ AUTO-RESET: DISABLED
   Do NOT send `/clear`, do NOT recommend `/clear`, do NOT auto-reset at any threshold.
   Context management is manual — Jas or Ramy will reset when they choose to.
   ```
   This is correct for **reset**, but it suppresses **compaction** too because the agent treats both as equivalent.

2. **No operator-level compact primitive.** The Claude Code SDK has a `/compact` slash command, but the ClawCode daemon doesn't expose it through any CLI subcommand or Discord operator command. The only paths today:
   - `clawcode send <agent> "/compact"` — would route the literal string through normal message delivery; agent might or might not honor it
   - Manual session-JSONL surgery — risky
   - `clawcode restart <agent>` — destructive; effective reset, not compaction

3. **`memory.compactionThreshold: 0.75` in yaml is for memory consolidation, not session compaction.** Different mechanism. Misleading because of name collision.

### Acceptance criteria

- **First-class CLI:** `clawcode session compact <agent>` exists, triggers Claude Code SDK `/compact` on the live worker, reports tokens-before / tokens-after / summary written to JSONL
- **Operator Discord command:** admin can post (e.g.) `/compact fin-acquisition` and get the same behavior
- **Memory preserved:** the agent's `memory.db` and recent task state survive; only the conversation window collapses to summary
- **Mid-turn safety:** if invoked while the agent is mid-tool-chain, the command queues until the turn completes (does not interrupt or corrupt state)
- **Policy decoupling:** the heartbeat prompt distinguishes between "reset" (still disabled for Finmentum) and "compaction" (allowed). The agent may proactively suggest compaction at high context fill (🟠/🔴 zones) without violating the no-reset rule

### Implementation notes

- Look at how the Claude Code SDK's `/compact` slash command works internally — it inserts a summary turn and prunes the JSONL on the SDK side. The daemon needs an IPC path to ask its worker to run this command, OR it can write a control message to the worker's stdin that the agent then routes to `/compact`
- The `fork` command already manipulates session state — likely the cleanest precedent. `compact` may share plumbing
- Surface tokens-before/tokens-after in `clawcode status` per-agent so operators can see when context is getting heavy without /compact-rouletting
- Update the heartbeat prompt template (in clawcode.yaml) to mention compaction as the recommended action at 🟠/🔴 zones, distinguishing from `/clear`/reset
- Consider an opt-in auto-compact-at-N% setting per agent (separate from reset), so Finmentum agents could enable e.g. `auto-compact-at: 0.7` while keeping `auto-reset: disabled`

### Acceptance test (manual)

```bash
# 1. Note current session size
SIZE_BEFORE=$(stat -c '%s' /home/clawcode/.claude/projects/.../session.jsonl)
# 2. Run new command
clawcode session compact fin-acquisition
# 3. Verify: summary entry present, future turns smaller
grep -c '"type":"summary"' /home/clawcode/.claude/projects/.../session.jsonl  # > 0
# 4. Send a test prompt, verify token usage dropped
clawcode usage fin-acquisition  # tokens-per-turn lower than baseline
# 5. Verify agent still remembers recent state (no memory loss)
```

### Related

- 999.48 — Heartbeat reply leaks to user channel (sibling daemon-output-routing concern)
- Finmentum heartbeat policy in `/opt/clawcode/clawcode.yaml` (the `AUTO-RESET: DISABLED` prompt)
- `compactionThreshold` field in agent memory config — name-collision; clarify or rename
- `feedback_recall_via_discord_history.md` — operator already routes around session-context staleness by re-reading Discord; compaction makes the agent itself usable for longer

### Reporter

Jas, 2026-05-13 16:38 PT — surfaced after observing fin-acquisition's 4-minute turn latency during a live PDF iteration with Ramy
