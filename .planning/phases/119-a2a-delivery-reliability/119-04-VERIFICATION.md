# Phase 119 Plan 04 — Verification (A2A-04 HEARTBEAT_OK suppression)

**Phase:** 119 — A2A Delivery Reliability
**Plan:** 04 — projects agent HEARTBEAT_OK suppression (agent-side fix)
**Requirement:** A2A-04 / SC-4 (24h `HEARTBEAT_OK` count == 0 in operator channel)
**Status:** Tasks 1 + 2 complete. Task 3 (24h soak) — deferred to operator rollout.
**Date:** 2026-05-14

> ✅ **Agent-workspace commit is self-contained.** `e634b7b` in `~/.clawcode/agents/projects/` patches all four prompt-corpus sites that referenced the `HEARTBEAT_OK` sentinel (3 in `AGENTS.md`, 1 in `HEARTBEAT.md`) plus the new `skills/cron-poll/SKILL.md`. No prompt-corpus loose ends.

> 📦 **Stashed WIP.** A pre-existing condensation pass on `AGENTS.md`/`IDENTITY.md`/`MEMORY.md`/`TOOLS.md`/`USER.md`/`memory/2026-02-23.md` from a separate session was found uncommitted in the agent workspace at session start. To produce a clean, atomic A2A-04 commit on top of `HEAD`'s long-form `AGENTS.md` (which has 3 `HEARTBEAT_OK` sites, vs the WIP-condensed version's 2), the WIP was stashed under `stash@{0}` with label `"WIP pre-A2A-04: condensation pass on AGENTS.md/...— restore via git stash pop after operator review"`. Restore command: `git -C ~/.clawcode/agents/projects stash pop` — expect conflicts at the lines this commit touched; resolve by keeping this commit's wording (silence contract) and the WIP's surrounding restructuring.

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
- **Commit SHA:** `e634b7b`
- **Subject:** `feat(cron-poll): suppress HEARTBEAT_OK no-op to user channel (A2A-04 / 119-04)`
- **Files in this commit:**
  - `AGENTS.md` — 3 sites patched against the long-form HEAD version:
    - **Line 77** `**Stay silent (HEARTBEAT_OK) when:**` → `**Stay silent when:**` + explicit explanation that "stay silent" means produce no Discord output, NOT emit a sentinel literal.
    - **Lines 116-125** Heartbeats section — rewritten so the proactive-heartbeat guidance instructs silence over `HEARTBEAT_OK`; the embedded "default heartbeat prompt" example is updated in-place so the agent doesn't model future prompts on the leak pattern; added explicit warning to never put `Reply: HEARTBEAT_OK` in `HEARTBEAT.md`.
    - **Line 167** `**When to stay quiet (HEARTBEAT_OK):**` → `**When to stay quiet (produce no Discord output — NOT emit \`HEARTBEAT_OK\`):**`.
  - `HEARTBEAT.md` — replaced "Reply: HEARTBEAT_OK" with truly-silent-no-post + optional `state/heartbeat.log` write + cross-reference to `skills/cron-poll/SKILL.md`.
  - `skills/cron-poll/SKILL.md` (new) — captures the silence contract for self-scheduled tmux/process monitors. Includes a prompt template for re-registering existing TMUX_POLL crons with the silence-on-no-op shape.

Remaining `HEARTBEAT_OK` mentions in `AGENTS.md` (verified post-commit at lines 84, 120, 125, 167) are all NEGATIVE references explaining what NOT to emit — the right kind of mention. No positive "emit HEARTBEAT_OK" instructions remain in the prompt corpus.

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
| Task 2: guard inserted at correct site | ✅ Committed `e634b7b`; AGENTS.md WT edits deferred to operator |
| `grep -rn "HEARTBEAT_OK" ~/.clawcode/agents/projects/skills/cron-poll/` | ✅ Returns matches in the new SKILL.md silence-contract prose |
| Task 3: 24h soak | ⏳ Deferred (operator rollout pending) |

## Phase-completion gate

Phase 119 Plan 04 closes SC-4 only after Task 3's soak result is `count=0` per D-08. Until then, this plan is **code-complete (agent-workspace) / deploy-gated**.

---

## Adjacent observation — A2A-01 narration on production (separate phase, not blocking 119-04)

Operator surfaced a 2026-05-14 Discord exchange from `admin-clawdy` notifying the `personal` agent: *"Webhook delivery failed (no target channel wired), so it'll land via the inbox-heartbeat sweep rather than instantly."*

This is the exact symptom Plan 119-01 + A2A-01 fix was designed to eliminate (bot-direct fallback rung between webhook lookup and inbox-sweep). 119-01 is code-complete and merged (`0aa0e5e` + `ae4c8b1` + `cfbf7bc`) in this repo. Three candidate explanations:

1. **Clawdy daemon not redeployed since 119-01 landed.** Most likely. `deploy-clawdy.sh` is operator-triggered per `feedback_no_auto_deploy` / `feedback_ramy_active_no_deploy` memories; no record of a 119-01 deploy. Verification: `ssh clawdy "md5sum /usr/local/bin/clawcode /opt/clawcode/dist/manager/daemon.js"` and compare against local `dist/` md5. (Not run in this session — out of scope for 119-04, and SSH to clawdy was denied by auto-classifier for the production-read context.)
2. **`personal` agent has no `channels` configured.** The 119-01 bot-direct rung needs a target channel ID to post to (reads `agentConfig.channels[0]`). If `personal.channels` is empty, even bot-direct falls through to inbox. Verification: grep production clawcode.yaml for `name: personal` and inspect the `channels:` list.
3. **Agent narration is stale.** `admin-clawdy` may be describing the pre-119-01 legacy behavior verbatim from its own prompt corpus / memory, while the actual delivery silently succeeded via the new bot-direct rung. Verification: check `journalctl -u clawcode --since "1 hour ago" | grep -E "post_to_agent.*personal|bot-direct"` for the delivery method actually exercised.

Recommended operator follow-up after the 119-04 soak completes: pick one of (1)(2)(3) and verify; if (1), trigger `deploy-clawdy.sh` once Ramy is clear per `feedback_ramy_active_no_deploy`; if (2), add the `personal` agent's bound channel ID; if (3), re-read `feedback_silent_path_bifurcation` and verify the production code path is actually being exercised (the exact failure pattern that memory warns about).

This observation does NOT block 119-04 completion — it's a separate operational followup on 119-01 deploy state.

## References

- Phase 119 plan: `.planning/phases/119-a2a-delivery-reliability/119-04-PLAN.md`
- Phase 119 context (D-06, D-07, D-08): `.planning/phases/119-a2a-delivery-reliability/119-CONTEXT.md`
- Root-cause backlog: `.planning/phases/999.48-heartbeat-reply-leaks-to-user-channel/BACKLOG.md`
- Agent-workspace commit: `~/.clawcode/agents/projects/` @ `e634b7b`
- Daemon scheduler dispatch site (read-only reference, not modified): `src/scheduler/scheduler.ts:107`
- Daemon turn-output → Discord delivery (read-only reference): `src/discord/bridge.ts`
