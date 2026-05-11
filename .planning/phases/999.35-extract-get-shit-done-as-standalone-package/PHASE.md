---
phase: 999.35
title: Extract `get-shit-done` workflow toolkit as standalone package
status: BACKLOG
priority: P2 (no blocker, value compounds with reuse)
captured_from: operator conversation 2026-05-05 22:06 PT (clawcode size triage)
captured_by: admin-clawdy
target_milestone: TBD (likely v2.8 or later)
---

# Phase 999.35 — extract `get-shit-done` as standalone package

## Why this exists

Operator triage 2026-05-05: clawcode source tree at 163 MB / ~285k LOC vs.
~5 MB across the entire OpenClaw constellation. Question raised: should
the monorepo be broken up?

Conclusion: **mostly no — but `.claude/get-shit-done/` is the cleanest
seam to extract first.** It's:

- **Self-contained.** Workflow templates + skill scripts + slash-command
  prompts. Doesn't import anything from the daemon, the agent runtime,
  the Discord layer, or the dashboard.
- **Already cross-project.** GSD lives in `~/.claude/get-shit-done/` and
  is consumed by clawcode itself, sandbox, finmentum repos, and any
  other repo that bootstraps the workflow. Its lifecycle is decoupled
  from clawcode's daemon release cycle.
- **Mid-evolution.** Phases 999.20 / 999.21 / 999.31 / 999.32 all touched
  GSD slash commands — there's active churn in the workflow surface.
  Standalone repo gives that churn a home with its own version + changelog.
- **Has natural reuse outside the fleet.** If sharing GSD with another
  team or open-sourcing it, you don't want to also ship the entire
  daemon.

## Hypothesis

Extracting GSD does two things:
1. **Removes ~? MB of source from clawcode.** (Need to measure — see Goal 1.)
2. **Frees GSD to ship on its own cadence.** Workflow improvements no
   longer require a clawcode daemon deploy.

Cost: ~1 day of mechanical work + a permanent submodule/npm-link layer
in clawcode. The cost is real but small if done now (before more cross-
references accumulate).

## Goals

1. **Measure baseline.** Document current footprint: GSD source size, file
   count, LOC, list of files outside `.claude/get-shit-done/` that import
   from it (likely zero — verify).
2. **Pick the extraction shape.** Three candidates:
   - **(a) Git submodule.** `.claude/get-shit-done/` becomes a submodule
     pointed at a new `jaskarn78/get-shit-done` repo. Pros: simple, no
     packaging needed. Cons: submodule UX is friction-y; every consumer
     repo needs explicit submodule init.
   - **(b) npm package.** Publish as `@jaskarn78/get-shit-done` (private
     npm or GitHub Packages). Workflow files installed under
     `node_modules/@jaskarn78/get-shit-done/`. Slash commands +
     templates loaded from there. Pros: standard distribution, version
     pinning. Cons: workflow toolkit isn't really a JS package — fits
     awkwardly.
   - **(c) Standalone repo + bootstrap script.** New repo
     `jaskarn78/get-shit-done`. Bootstrap script clones it into
     `~/.claude/get-shit-done/` on a fresh machine. Pros: matches how
     it's already used (lives in `~/.claude/`, not per-project).
     Cons: no package registry, but probably fine for an internal tool.

   Recommend **(c)** as the lowest-friction match for current usage. (a)
   is a fallback if you want lockstep with a specific commit per project.
3. **Define the contract.** What does GSD export to consumers? Likely:
   slash commands, workflow templates, skill scripts. Document that as
   the public API of the extracted repo.
4. **Cut over.** Move files, set up new repo, update consumers (clawcode,
   sandbox at minimum). Keep a deprecation period where the old path
   still works.
5. **Document.** README on the new repo + a one-line note in clawcode's
   `CLAUDE.md` saying "GSD lives at github.com/jaskarn78/get-shit-done".

## Out of scope

- Splitting the marketplace / ClawHub (separate phase if pursued).
- Splitting any of the daemon, Discord, agent runtime, MCP, dream/memory
  subsystems. These are tightly coupled — premature to break.
- Open-sourcing GSD. Standalone repo first; license decision later.

## Risks

1. **Hidden coupling.** GSD slash command prompts may reference clawcode-
   specific paths (`/etc/clawcode/clawcode.yaml`, daemon socket, etc.).
   Extraction needs to either parameterize those references or accept that
   GSD has a "clawcode flavor" baked in. Phase work confirms which.
2. **Skill / template reflowing.** If GSD lives at a different path, every
   `@$HOME/.claude/get-shit-done/...` reference inside templates needs
   to keep working. Bootstrap script must guarantee path stability.
3. **Operator workflow disruption.** Extracting + re-pathing might break
   slash commands mid-day. Mitigation: do the cutover during a quiet
   window + test on sandbox repo first.

## Adjacent phases (don't bundle, but coordinate)

- **999.31 / 999.32 (shipped):** `/ultra-plan`, `/ultra-review`, `/gsd-do`
  consolidation. These are the most recent GSD slash-command shipping —
  the candidates that'd benefit from independent versioning.
- **Phase 999.34 (BACKLOG):** Cross-agent IPC for subagents. Different
  domain (agent runtime), but both phases reduce friction in
  multi-agent workflows. Schedule independently.

## Operator decision needed before kickoff

- **Repo target:** New top-level repo under `jaskarn78` org? Or under
  `clawcode`?
- **Visibility:** Private to start (default), public when stable?
- **Extraction shape:** (a) submodule / (b) npm / (c) standalone +
  bootstrap. Recommend (c) but operator chooses.

## Success criteria

- `~/.claude/get-shit-done/` is sourced from a new repo, not from
  clawcode's tree
- All existing GSD slash commands still work in every repo that uses
  them
- A new GSD slash command can ship without a clawcode daemon deploy
- clawcode source tree drops by GSD's footprint (cosmetic but real)
- Sandbox repo + at least one other consumer pull from the new path
