# Latent bugs surface in pairs during incidents

**Captured:** 2026-05-08
**Trigger:** Discord bridge outage hotfix (commit `85069fc`) — recovery action exposed a second latent bug
**Pattern severity:** structural — applies to plan-checker, execute-phase, code-review
**Related artifacts:**
- `.planning/phases/115-memory-context-prompt-cache-redesign/115-VERIFICATION.md` (Post-Deploy Audit Findings section — 3 producer gaps caught post-deploy)
- Commit `85069fc` (today's hotfix — Discord bridge retry + TDZ)
- `.planning/phases/999.36-subagent-ux-typing-truncation-cross-channel-file-leak/999.36-01-SUMMARY.md` (commits `73417c1` + `3300f47` — root cause of the TDZ bug)

---

## The pattern

When production is degraded and operator does a recovery action, that recovery hits unusual code paths and **exposes other latent bugs that don't surface in normal operation**. Single-trigger events tend to produce 2-3 bugs in close succession — never just one.

Two examples from this session:

### Example 1 — Phase 115 deploy + post-deploy spot check (~14:12 UTC)

| Visible bug | Latent bugs found | Root cause class |
|---|---|---|
| Phase 115 metric producers had no values populated post-deploy | 3 columns (`tier1_inject_chars`, `tier1_budget_pct`, `prompt_bloat_warnings_24h`) had schema + type + reader + dashboard renderer but **no writer code path** | **Schema-without-writer** — declarative side complete, runtime side missing. Plan-checker passed because schema + type + reader matched expected pattern; missed that no producer actually wrote to the column. |

### Example 2 — Discord outage + restart-to-recover (~12:47 → 14:24 UTC)

| Visible bug | Latent bugs found | Root cause class |
|---|---|---|
| Discord returned 503 during deploy → bridge failed to start → daemon stayed degraded permanently with no auto-retry | (1) Bridge had **zero startup retry logic** — `client.login()` once, then null-out on failure. (2) `clawcode status` during the recovery cycle threw `Cannot access 'subagentThreadSpawner' before initialization` — TDZ on a `const` declared at line 5396 but used by route handlers at lines 3381/3431/5175-5188. | **(1) Missing fallback path** in startup — present for runtime drops but not for boot-time failures. **(2) Late-declaration TDZ** — variable declared after first-use site; doesn't fire in normal operation because IPC requests don't usually land during the ~5s startup window. |

Both incidents had the same shape: **one trigger event surfaced one obvious bug, then the recovery action exposed another bug that had been latent for days/weeks because the recovery code path is traversed less often than the steady-state path.**

---

## Two specific code patterns to grep for

These are the two concrete bug classes from the examples above. Both are mechanically detectable.

### Pattern A — Schema-without-writer

**Signature:** A column / type / interface field is declared, READ by analytics code or dashboard, but never WRITTEN by any code path.

**Detection:**
```bash
# For every TypeScript field declared on a Phase 115-style metric type:
grep -E "readonly tier1_inject_chars|readonly prompt_bloat_warnings_24h|..." src/

# Then verify there's a writer:
grep -E "tier1InjectChars\s*:\s*[a-zA-Z]|tier1InjectChars\s*=\s*[a-zA-Z]" src/

# If the second grep returns ONLY type definitions or test patches, the writer is missing.
```

**Plan-checker enhancement:** for every new column/field added by a phase, require a positive grep hit on the writer side, NOT just on the type/schema side. The existing plan-checker dimensions cover schema + reader; add **producer/writer coverage** as Dimension N+1.

**Where in workflow:** runs during `/gsd-plan-phase --check` after the plan is produced and before execution. Catches it BEFORE the executor produces shallow code.

### Pattern B — Late-declaration TDZ (`const X` declared after `X` is used)

**Signature:** A `const` or `let` variable is declared at line N, but referenced by a closure or function created at line M where M < N. If the closure executes before line N runs (e.g., during boot, during async initialization, in early IPC requests), TDZ fires.

**Detection (rough):**
```bash
# Find all const / let declarations in long files:
grep -nE "^\s*(const|let)\s+[a-zA-Z_]+\s*[:=]" src/manager/daemon.ts

# For each declared name, check if it's used at a line < declaration line:
# (requires AST analysis or careful manual scan; simple grep gives candidates)
```

**Plan-checker enhancement:** for any phase that touches large multi-thousand-line orchestration files (daemon.ts, session-manager.ts, etc.), explicitly check that newly-introduced variable declarations are placed BEFORE first-use sites. If a closure or route handler captures a not-yet-declared variable, fail the plan check.

**Codebase-side fix:** the `daemon.ts` pattern — declare ALL late-bound dependencies as `let X: T | null = null` at the top of `startDaemon()`, with assignments at the natural construction site lower down. This eliminates the TDZ class entirely for daemon-scoped variables. Apply consistently going forward.

---

## What the operator did RIGHT during the incident (process learnings)

The operator's instinct to **investigate before restarting** was correct and saved time:

1. **"do we need to restart"** — framed as a question, not a directive. Made me investigate first.
2. **No blind restart** — most operators would have just hit `systemctl restart` on Discord trouble. That would have masked the root cause (bridge-no-retry) for the next incident.
3. **Multi-step verification** — ran `clawcode status`, watched logs, confirmed bridge actually came back. Each step caught a new signal (TDZ error, `Internal Server Error` vs `Service Unavailable` distinction).
4. **Picked the durable-fix path** — when offered "wait + retry" vs "ship hotfix" vs "manual workaround," picked the hotfix that prevents recurrence on every future Discord outage.

This is the right operator instinct for production incidents. Document in operator-memory: **investigate before restarting; ask "is this a state issue or a code issue?" first.**

---

## What I (Claude) did RIGHT and WRONG

### Right

- Investigated daemon health, fleet status, bridge state, and Discord auth separately before recommending action
- Identified the bridge-no-retry as a real bug, not just a recovery action
- Surfaced both bugs to the operator with options (wait / hotfix / manual)
- Wrote retry logic with exponential backoff (5 attempts over ~110s) — not too aggressive, not too gentle
- Forward-declared `subagentThreadSpawner` as `let X: T | null = null` instead of using `!` non-null assertions — type-safe, semantics preserved
- Captured a comprehensive commit message explaining BOTH bugs + their classes
- Validated with tsc + tests + production verification before declaring done

### Wrong / could have been better

- **Didn't see the TDZ bug pattern in the original 999.36-01 plan-check.** The plan-checker passed those plans. The TDZ-from-late-declaration class wasn't in the verification dimensions. Add it.
- **Initial plan-checker missed the schema-without-writer pattern** in Phase 115 too — caught only after deploy by post-deploy spot-check. Add it.
- **Restart-as-first-suggestion** before the investigation. The operator caught this and asked me to investigate first. I should have offered "investigate first" as the explicit option, not jumped to restart.

---

## Actionable items

### High value — implement before next phase ships

1. **Plan-checker dimension: producer/writer coverage** (catches Pattern A — schema-without-writer)
   - For every new column / type field / schema addition in a phase, require a positive grep hit on the writer side
   - Implementation: extend `gsd-plan-checker` agent with a "writer coverage" check that runs after plan production
   - Test: this would have caught all 3 Phase 115 producer gaps before deploy

2. **Plan-checker dimension: late-declaration TDZ scan** (catches Pattern B)
   - For any phase touching `daemon.ts` / `session-manager.ts` / similar large orchestration files
   - Run an AST scan: for every newly-introduced `const X` or `let X`, verify all references to `X` come at line ≥ declaration line
   - If not, flag as BLOCKER with "wrap in early-`let` + late-assign pattern"
   - Test: this would have caught the 999.36-01 TDZ bug before deploy

3. **Codebase rule (apply going forward):** in `startDaemon()` and similar long async-init functions, declare all late-bound dependencies as `let X: T | null = null` at the top of the function. Assign at construction site. Eliminates the TDZ class entirely.

### Medium value — consider for v2.9 milestone

4. **Investigate-before-restart operator pattern** — document in operator memory + project CLAUDE.md as a default instinct: "is this a state issue or a code issue? Investigate first. Restart is a hammer."

5. **Bridge runtime reconnect** — separate from startup retry. Currently the `error` handler at `src/discord/bridge.ts:268` only logs. Add automatic reconnect on `error` / disconnect events with the same exponential-backoff pattern. This handles the runtime-drop scenario as cleanly as the startup-failure scenario.

6. **Capture incident postmortems systematically** — for any production incident lasting >15 min, generate a structured postmortem in `.planning/incidents/<date>-<slug>.md` with: timeline, root cause(s), customer impact (Ramy mid-thread), latent bugs surfaced, code changes shipped, learnings captured here. Pattern from the SRE world; helps build the bug-class taxonomy faster than ad-hoc capture.

---

## Provenance

- **Discord outage:** 2026-05-08 ~12:27 UTC (operator's "Are discord servers down?" message in journal)
- **Phase 115 patch deploy:** 14:12 UTC (md5 `1af007d0...`)
- **Bridge fail-on-restart:** 14:14:42 UTC (`Internal Server Error`)
- **Hotfix committed:** 14:23 UTC (commit `85069fc`)
- **Hotfix deployed:** 14:24:31 UTC (md5 `cb88fd07...`)
- **Bridge connected:** 14:24:44 UTC (first attempt, no retry needed — Discord had recovered)
- **Total downtime:** ~84 min (12:47 → 14:24 UTC)
- **Customer impact:** Ramy mid-thread on fin-acquisition — last message landed pre-restart at 12:47 was processed; no new messages reached agents during the 84-min window

---

## Tags

`incident` `latent-bug-pattern` `plan-checker-enhancement` `tdz` `schema-without-writer` `discord-bridge` `999.36-01-followup` `phase-115-followup` `pattern-recognition` `operator-instinct` `production-debugging`
