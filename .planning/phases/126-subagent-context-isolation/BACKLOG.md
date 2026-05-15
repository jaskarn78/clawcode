# Backlog: subagent context isolation — stale context bleeds into subagent task

## 999.57 — Subagents inherit heartbeat + memory retrieval from source agent; unrelated context surfaces as "final answer"

Subagents spawned via `mcp__clawcode__spawn_subagent_thread` deliver answers about the wrong topic when the source agent has pending reminders or memory-similar content from prior unrelated work.

### Two observed failure modes — same parent/delegate, different surface symptoms

#### Run 1 — 2026-05-15 18:04 PT, admin-clawdy → research

Sequence (from Discord screenshot, admin-clawdy channel):

1. **Jas → admin-clawdy:** "Spawn a subagent to look up cool features openclaw has that we don't. Ignore the WhatsApp, slack, integration and the custom models selection stuff."
2. **admin-clawdy → spawn_subagent_thread** with `delegateTo: research`, thread `openclaw-vs-clawcode-capabilities`. Created `admin-clawdy-via-research-XXX` subagent (opus).
3. **Subagent → thread:** Did NOT deliver the OpenClaw capability gap table. Its final assistant message in the thread was about a **HeyGen reminder** (unrelated finmentum-domain content).
4. **`relayCompletionToParent` walks newest→oldest in the thread**, picks up the HeyGen-reminder message as "final response", and feeds it to admin-clawdy as the `[SUBAGENT_COMPLETION]` prompt.
5. **admin-clawdy** correctly diagnosed the failure itself: *"Subagent in thread openclaw-vs-clawcode-capabilities closed out without delivering the capability gap table — its final message was about a HeyGen reminder, not the OpenClaw research. Looks like the task got crossed with stale context. Want me to re-spawn cleanly?"*

The relay code did its job — the bug is upstream: the subagent literally produced HeyGen output instead of OpenClaw research.

#### Run 2 — 2026-05-15 18:09 PT, retry with tighter framing

Same parent/delegate (admin-clawdy → research, opus). New thread `openclaw-agent-capability-gaps`. admin-clawdy explicitly scoped the task: "agent runtime/skill/intelligence features only — explicitly excluded WhatsApp/Slack/integrations and model picker."

Subagent's posted output in the thread was: *"Acknowledged — no todos needed; this turn was a single-question lookup..."* — a meta-acknowledgment, not the ranked capability gap list it was asked to produce.

admin-clawdy's diagnosis: *"Subagent in openclaw-agent-capability-gaps wrapped without posting the ranked capability list — final message was a standing-by ack, not the deliverable. Want me to re-spawn with a tighter 'produce the list now, don't ask questions' framing?"*

**This failure is different from Run 1.** No stale content leaked in — the subagent simply didn't do the work. It interpreted the task as conversational and ack'd-and-waited instead of producing the deliverable. Same outcome (no deliverable), different mechanism.

**Common factor across both runs:** subagent does not deliver the requested research. The task framing at the `postInitialMessage` site (`src/discord/subagent-thread-spawner.ts:722-726`) sends the raw `task` string verbatim — no directive frame like *"produce the deliverable in this turn, do not acknowledge and wait."*

### Suspected root causes

Two inheritance leaks in `src/discord/subagent-thread-spawner.ts:637-648`:

```typescript
const subagentConfig: ResolvedAgentConfig = {
  ...subagentSourceConfig,        // ← spreads source agent's full config
  name: sessionName,
  model,
  channels: [],
  soul: (config.systemPrompt ?? sourceConfig.soul ?? "") + threadContext,
  schedules: [],                  // ← schedules explicitly cleared
  slashCommands: [],              // ← slashCommands explicitly cleared
  webhook,
  threads: parentConfig.threads,
  disallowedTools: ["mcp__clawcode__spawn_subagent_thread"],
};
```

**Not cleared (but probably should be for subagents):**

1. **Heartbeat config** — `subagentSourceConfig.heartbeat` flows through verbatim. If the source agent has a heartbeat that surfaces pending tasks (inbox check, scheduled-reminder check, memory-recall reminder), it fires inside the subagent's short-lived session and injects unrelated content as if it were operator input.

2. **Memory retrieval** (`memoryAutoLoad`, `memoryRetrievalTopK`, `memoryRetrievalTokenBudget`, `memoryRetrievalExcludeTags`) — subagent inherits the source agent's memories.db + retrieval config. Hybrid RRF retrieval on the subagent's task description ("look up cool features openclaw has") can surface semantically-adjacent memories from the source agent — including unrelated HeyGen / Finmentum content if those have high recency or relevance signals.

3. **Inbox watcher** — if the source agent's `inbox/` directory contains pending JSON messages, the chokidar-driven InboxSource may fire in the subagent's session.

### Reproduction (proposed)

1. Seed `research` agent's memories.db with a "HeyGen reminder" memory tagged with high recency.
2. Spawn a subagent via `spawn_subagent_thread` with task "explain X" where X is semantically unrelated.
3. Observe the subagent's output: if it surfaces HeyGen-themed content, retrieval-leak is confirmed.

Alternative repro: temporarily set `heartbeatEnabled: true` with a "list pending reminders" check on `research`, spawn a subagent, observe if reminders surface in the subagent thread.

### Acceptance criteria

- A subagent's session config does NOT inherit configurations that surface unrelated content from the source agent's lifecycle:
  - `heartbeat: { enabled: false }` (or explicit subagent-aware gate in `HeartbeatRunner` that skips sessions matching `*-via-*-*` / `*-sub-*` naming pattern).
  - `memoryAutoLoad: false` for subagents (force task description + thread context to be the only input).
  - `inboxEnabled: false` for subagents (chokidar watcher skipped).
- Add a test: spawn a subagent with the source agent carrying a memory tagged unrelated to the task — assert the subagent's first assistant turn does NOT reference the unrelated content.
- Add a test: spawn a subagent with the source agent having a heartbeat config — assert the heartbeat does not fire in the subagent's session.
- Add a regression test in `subagent-thread-spawner.test.ts` pinning the subagentConfig override list (whatever fields end up in scope after this phase).
- Document the inheritance contract in the spawn site's comment block.

### Open questions

- **Should the subagent inherit memories.db at all?** Subagents are short-lived per-task contexts; persistent cross-task memory may be undesirable. Counter: some delegated tasks (e.g., "follow up on yesterday's research") legitimately need parent context. Probably gate via a per-spawn flag.
- **Should the recursion-guard pattern extend to inbox / heartbeat / schedule?** All three are "things that fire in the agent's session without operator initiation." The current code only clears `schedules` + `slashCommands`. The full set probably belongs in a `subagentConfigOverrides` factory function so the list is single-sourced.
- **Memory `excludeTags` for subagents?** A safer default than disabling retrieval entirely: subagent retrieval excludes tags like `session-summary`, `heartbeat-trigger`, `scheduled-reminder` by default.

### Related

- `src/discord/subagent-thread-spawner.ts:637-648` — current subagentConfig construction.
- Phase 999.36 sub-bug C — `clawcode_share_file` agent identity drift between sibling subagents (similar inheritance-leak pattern; partially addressed there).
- Phase 999.3 D-INH-01..03 — delegation inheritance rules (model/soul/skills/mcpServers); precedent for adding more overrides.
- Phase 90 MEM-01 / MEM-03 — `memoryAutoLoad` + `memoryRetrievalTopK` knobs that need subagent-aware defaults.

### Reporter

Jas via screenshot, 2026-05-15 18:06 PT. Triaged by Clawdy (this session) with diagnosis pinned to inheritance leaks at `subagent-thread-spawner.ts:637`.
