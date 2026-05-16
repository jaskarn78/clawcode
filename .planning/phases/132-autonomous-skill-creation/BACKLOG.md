# Backlog: Autonomous Skill Creation After Complex Tasks

## 999.59 — Have the agent propose a reusable skill draft after long successful turns (modeled on Hermes Agent's learning loop)

Hermes Agent (Nous Research) watches its own execution: after the agent solves something hard, it generates a candidate skill — a reusable procedure with name, trigger, steps, and rough acceptance criteria — and stages it for review. The agent's *procedural* memory grows from experience, not just operator-authored skill files.

ClawCode today has operator-authored skills (`/recall-recent`, `/reelforge`, `/new-reel-broll`, etc.) and operator-curated memory (Tier 1 / Tier 2). What it does not have is a feedback loop that converts a successful multi-step problem-solving session into a reusable skill draft. Every novel workflow has to be re-solved from first principles unless Jas notices it and asks me to write a skill.

A v0 implementation could be very simple:
- After every turn that calls `subagent_complete` or successfully closes a non-trivial `delegate_task` (≥N tool calls, ≥M minutes elapsed, no rollback), the daemon emits a "skill candidate" event
- A side process (or the agent itself on idle) summarizes the trajectory into a SKILL.md draft and parks it in `skills-staging/`
- Operator gets a Discord embed: "I solved X by doing Y, want to promote this to a reusable skill? [Approve] [Reject] [Edit]"
- Approved drafts move into the agent's real skill directory; rejected drafts stay archived (still searchable, never auto-used)

### Why / Symptoms
- Same problem-solving sequence gets re-discovered across sessions (e.g., "find the bot with channel access" — solved on 2026-05-14 19:46 PT, would be re-solved next time without explicit skill)
- Operator memory load: Jas has to remember to *ask* me to capture skills; high cognitive cost
- Tier 1 memory is for *facts*, not *procedures* — there's no equivalent autopath for procedural learning
- Operator-observed (2026-05-14, capability comparison vs Hermes): "Memory-as-procedure beats memory-as-fact for repeated workflows"

### Acceptance criteria
- Daemon emits `task.completed` events with tool-call trajectory, duration, and outcome classification (success / partial / failed)
- A `skill-distiller` worker (or post-turn agent hook) consumes events with ≥6 tool calls, ≥3 minute duration, success outcome → produces a candidate SKILL.md draft in `skills-staging/`
- Discord embed prompt to operator with [Approve / Reject / Edit] buttons (or `/approve-skill <id>` slash command if buttons are out-of-scope)
- Approved drafts conform to the [[999.58-manifest-driven-plugin-sdk]] manifest format (when that ships) — until then, conform to existing SKILL.md convention
- Rejected drafts archived to `skills-rejected/` with reason — never auto-promoted, never re-proposed for similar trajectories without operator edit
- Operator-tunable thresholds (min tool calls, min duration) per agent
- Default OFF until at least one agent (probably Admin Clawdy) has trial-run it for two weeks

### Implementation notes / Suggested investigation
- Read Hermes Agent source for the skill-creation loop — likely in their `agentskills.io` reference or the main `hermes-agent` repo under `agent/skills/` or similar
- Decide where the distiller runs: in-band (agent self-distills on idle) vs. out-of-band (separate worker reads event log)
  - In-band: simpler, but eats agent context; agent has to summarize own work
  - Out-of-band: cleaner separation, requires durable event log (which we partially have via session summaries)
- The summarizer model matters — Haiku for cost vs Opus for quality; try Haiku first and let operator escalate
- Anti-pattern to avoid: auto-promoted skills that fire too eagerly and corrupt the skill discovery layer

### Related
- Comparison report: `Admin Clawdy/research/agent-runtime-comparison-2026-05-14.md` (§"Steal from Hermes" #1)
- [[999.58-manifest-driven-plugin-sdk]] — promoted skills should ship with proper manifests
- [[999.51-operator-triggered-session-compaction]] — adjacent: also extracts learnings from session, but op-triggered not auto
- Hermes Agent: `hermes-agent.nousresearch.com/docs` (skill creation section), `agentskills.io` open standard

**Reporter:** Jas, 2026-05-14 19:52 PT
