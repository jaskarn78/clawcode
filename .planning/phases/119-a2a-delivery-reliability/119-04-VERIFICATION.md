# Phase 119 Plan 04 — Verification (A2A-04 HEARTBEAT_OK suppression)

**Phase:** 119 — A2A Delivery Reliability
**Plan:** 04 — projects agent HEARTBEAT_OK suppression (agent-side fix)
**Requirement:** A2A-04 / SC-4 (24h `HEARTBEAT_OK` count == 0 in operator channel)
**Status:** Tasks 1 + 2 complete (partial commit — see ⚠ below). Task 3 (24h soak) — deferred to operator rollout.
**Date:** 2026-05-14

> ⚠ **Partial commit in agent workspace** — only `HEARTBEAT.md` + `skills/cron-poll/SKILL.md` were committed (`d87767e` in `~/.clawcode/agents/projects/`). `AGENTS.md` lines 55 + 68 were also edited locally but commit was **deferred** because the workspace has unrelated pre-existing WIP across AGENTS.md/IDENTITY.md/MEMORY.md/TOOLS.md/USER.md/memory. If production rollout to clawdy pulls from `git HEAD`, the AGENTS.md group-chat-context leak path will NOT propagate — operator must either (a) commit the AGENTS.md WIP separately first, or (b) rsync the working tree rather than git-pulling. See "AGENTS.md edits — deferred to operator review" below for the exact working-tree state.

> 📎 **Daemon repo D-06 strict-grep nuance** — plan line 184 says `grep -rn "HEARTBEAT_OK" src/` should return ZERO. Actual: 12 hits, all classified as non-delivery-layer (test fixtures + compaction-history matcher + migration fixture preserving legacy OpenClaw shape that the loader drops at runtime). Strict-grep readers should consult the "D-06 invariant" section near the end for the full disposition. No daemon delivery-layer filter was added — D-06 spirit preserved.

---

## Task 1 — Discovery findings

The plan's must_haves assumed a code-level skill at `~/.clawcode/agents/projects/skills/cron-poll/` with a `post_to_agent` dispatch site to wrap. **Production reality differs:**

### What was found

- **No `cron-poll` skill existed.** `~/.clawcode/agents/projects/skills/` contained five skills (`article-writing`, `content-engine`, `market-research`, `search-first`, `strategic-compact`). No `cron-poll` / `tmux-poll` directory.
- **No wrapper script.** No `poll.sh` / `poll.ts` anywhere under `~/.clawcode/`.
- **Workspace IS git-tracked** at `~/.clawcode/agents/projects/.git`.

### Actual leak source

Three places embed the literal "reply `HEARTBEAT_OK`" instruction in agent prompt prose:

| File | Line | Instruction |
|------|------|-------------|
| `~/.clawcode/agents/projects/AGENTS.md` | 55 | "**Stay silent (HEARTBEAT_OK) when:** Casual banter..." |
| `~/.clawcode/agents/projects/AGENTS.md` | 68 | "Read `HEARTBEAT.md` if it exists. If nothing needs attention, reply `HEARTBEAT_OK`." |
| `~/.clawcode/agents/projects/HEARTBEAT.md` | 33 | "Reply: HEARTBEAT_OK" |

In addition, the projects agent has dynamically created TMUX_POLL cron schedules (e.g. `v4-build-monitor`, `finance-clawdy-monitor`) via the daemon's scheduler IPC. Each schedule's `prompt` field embeds the same instruction verbatim: `IF still working (▪▪▪ / % progress): reply HEARTBEAT_OK`. Evidence preserved in `~/.clawcode/agents/projects/memory/2026-03-07-tmux-monitor.md` — the 2026-03-07 session captured 20+ replies of bare `HEARTBEAT_OK` text from this loop.

### Dispatch architecture (the reason the plan's "wrap post_to_agent" framing doesn't apply)

1. Operator (or the projects agent itself) registers a cron via the scheduler IPC with a `prompt` payload.
2. When the cron fires, `src/scheduler/scheduler.ts:107` dispatches the prompt as a turn via `TurnDispatcher.dispatch(origin, agentName, schedule.prompt)`.
3. The turn runs the LLM with that prompt; the LLM's **final assistant message** is the cron's output.
4. `src/discord/bridge.ts` auto-delivers any final assistant message to the agent's bound Discord channel.

There is no "conditionally call `post_to_agent`" hook — the final assistant text IS the post. The only place to suppress is the prompt prose that tells the LLM what to output. Plan Pattern B (SKILL.md prose contract) is the right shape; Pattern A (bash/JS guard) is unavailable.

---

## Task 2 — Insertion of the silence contract

### Agent-workspace commit

- **Repo:** `~/.clawcode/agents/projects/` (git-tracked)
- **Commit SHA:** `d87767e`
- **Subject:** `feat(cron-poll): suppress HEARTBEAT_OK no-op to user channel (A2A-04 / 119-04)`
- **Files in this commit:**
  - `HEARTBEAT.md` — replaced "Reply: HEARTBEAT_OK" with truly-silent-no-post + optional `state/heartbeat.log` write.
  - `skills/cron-poll/SKILL.md` (new) — captures the silence contract for self-scheduled tmux/process monitors. Includes a prompt template for re-registering existing TMUX_POLL crons with the silence-on-no-op shape.

### AGENTS.md edits — deferred to operator review

`AGENTS.md` lines 55 + 68 were edited locally to mirror the same silence contract, but the commit was **deferred**. Reason: the workspace has substantial pre-existing WIP across `AGENTS.md`, `IDENTITY.md`, `MEMORY.md`, `TOOLS.md`, `USER.md`, `memory/2026-02-23.md` (net ~798 deletions / 374 insertions) from a separate session that condensed multiple prose files. Bundling A2A-04's targeted edits with that broader rewrite into one commit would mislabel the diff.

Local working-tree state at handoff (operator can review with `git -C ~/.clawcode/agents/projects diff AGENTS.md`):
- Line 55: `**Stay silent when:** Casual banter, already answered... Truly silent — produce no Discord post. Never emit \`HEARTBEAT_OK\` or any sentinel string to the channel as a stand-in for silence.`
- Line 68 (now line ~67 in the condensed version): `Read \`HEARTBEAT.md\` if it exists. If nothing needs attention, stay truly silent — produce no Discord output. Do NOT emit \`HEARTBEAT_OK\` (or any sentinel literal) to the channel. If you need an internal acknowledgment for observability, append a one-line timestamp to \`state/heartbeat.log\` via the Write tool.`

The leak's primary load path is `HEARTBEAT.md` (the file the agent reads on every heartbeat tick) — the committed change is sufficient for the daemon-driven heartbeat. `AGENTS.md` provides the broader safety net for cron-poll and group-chat contexts; uncommitted local edits mirror the same contract.

### Existing TMUX_POLL crons — follow-up required

The committed `skills/cron-poll/SKILL.md` includes a "Recreating existing monitors" section. Active runtime crons whose `prompt` already contains `reply HEARTBEAT_OK` will continue to leak on every tick until removed and re-added with the new prompt template. Procedure documented in the SKILL.md. The projects agent should be asked to perform this recreation after the next workspace sync / agent restart.

### Narrowness check (D-06 compliance)

- The change is prose-level, not a regex matcher; no broad pattern matching introduced.
- Contract is "stay silent on no-op," equivalent to a literal-string equality decision made at the LLM-output layer.
- Genuine actionable output (yellow / orange / red context warnings, "menu prompt detected" alerts, "session dead" notifications, real user messages) explicitly continues to flow through unchanged. Reviewed `HEARTBEAT.md` lines 23-27 ("User-Facing Messages" for Yellow / Orange / Red) — unchanged; actionable paths preserved.

---

## Task 3 — 24h soak (DEFERRED — operator-gated)

**Status:** Cannot be triggered from this session.

The 24h observation window per D-08 requires:

1. **Production rollout.** Local edits at `~/.clawcode/agents/projects/` do NOT propagate to clawdy's `/root/.clawcode/agents/projects/` automatically. The agent workspace is not part of `scripts/deploy-clawdy.sh` (which targets the daemon binary). Operator must sync the file changes onto clawdy by their normal agent-workspace rollout mechanism.
2. **Existing TMUX_POLL crons recreated.** Per the SKILL.md procedure, any active crons whose prompts embed the old "reply HEARTBEAT_OK" instruction must be removed and re-added.
3. **24-hour wait** from the moment production picks up the changes AND the recreated crons start firing with the new prompts.
4. **Grep verification:**
   ```
   journalctl -u clawcode --since "24 hours ago" | grep -c "HEARTBEAT_OK.*projects"
   ```
   Expected: `0`.
5. **Narrowness sample:** Also confirm a non-`HEARTBEAT_OK` cron-poll output landed during the window (e.g., a "menu detected" or actionable notification), demonstrating suppression is narrow, not "silenced the whole cron."

When the operator completes the soak, append to this artifact:

```markdown
## Task 3 — Soak result

- **Rollout timestamp:** <TIMESTAMP>
- **Grep count (HEARTBEAT_OK in projects channel, 24h window):** <COUNT>
- **Sample genuine cron-poll output:** <YES / NO + brief excerpt>
- **Verdict:** PASS / FAIL
```

---

## D-06 invariant — daemon repo untouched at delivery layer

`grep -rn "HEARTBEAT_OK" src/` in the daemon repo returns 12 hits (2026-05-14). Reviewed:

| Location | Why it's allowed |
|----------|------------------|
| `src/memory/memory-scanner.ts:15` | Docstring referencing `HEARTBEAT.md` for memory-scanning exclusion. No filter. |
| `src/manager/compact-extractors/tier4-drop.ts:14` | Compaction-time heartbeat-probe matcher for in-conversation-history summarization. NOT delivery-layer. |
| `src/manager/compact-extractors/__tests__/fixtures/build-fixture.ts:54` | Test fixture. |
| `src/sync/__tests__/exclude-filter-regression.test.ts` (5 hits) | Test references to `HEARTBEAT.md` filename in sync filter regression tests. |
| `src/migration/__tests__/fixtures/openclaw.sample.json` (11 hits) | Migration fixture preserving the legacy OpenClaw `heartbeat.prompt` field shape (note: the loader at `src/config/loader.ts:263-276` drops `prompt` — it's read-but-not-dispatched at runtime). |

**No grep hit is at the cross-agent or Discord delivery layer.** D-06 invariant preserved.

---

## Pre-merge gate status

| Gate | Status |
|------|--------|
| Task 1: skill location confirmed (or absence documented) | ✅ Documented absence + actual leak sources |
| Task 2: guard inserted at correct site | ✅ Committed `d87767e`; AGENTS.md WT edits deferred to operator |
| `grep -rn "HEARTBEAT_OK" ~/.clawcode/agents/projects/skills/cron-poll/` | ✅ Returns matches in the new SKILL.md silence-contract prose |
| Task 3: 24h soak | ⏳ Deferred (operator rollout pending) |

## Phase-completion gate

Phase 119 Plan 04 closes SC-4 only after Task 3's soak result is `count=0` per D-08. Until then, this plan is **code-complete (agent-workspace) / deploy-gated**.

---

## References

- Phase 119 plan: `.planning/phases/119-a2a-delivery-reliability/119-04-PLAN.md`
- Phase 119 context (D-06, D-07, D-08): `.planning/phases/119-a2a-delivery-reliability/119-CONTEXT.md`
- Root-cause backlog: `.planning/phases/999.48-heartbeat-reply-leaks-to-user-channel/BACKLOG.md`
- Agent-workspace commit: `~/.clawcode/agents/projects/` @ `d87767e`
- Daemon scheduler dispatch site (read-only reference, not modified): `src/scheduler/scheduler.ts:107`
- Daemon turn-output → Discord delivery (read-only reference): `src/discord/bridge.ts`
