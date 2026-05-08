# Sub-scope 6-B Gate Decision

**Read date:** 2026-05-08
**Source:** [`wave-2-checkpoint.md`](./wave-2-checkpoint.md) (Plan 115-08 output)
**Threshold (D-12):** `tool_use_rate_per_turn < 30%` across non-fin-acq agents → SHIP 6-B; else DEFER. (`0.30` = `0.3`.)
**Provenance of 30%:** Claude pick per CONTEXT D-12; not research-backed; refinable. Ratifies `SUB_SCOPE_6B_THRESHOLD = 0.3` in `src/cli/commands/tool-latency-audit.ts`.

---

## Decision

**Status:** `PENDING-OPERATOR` → de-facto **`DEFER`** for plan 115-09 closeout.

The `wave-2-checkpoint.md` skeleton landed by plan 115-08 documents the
gate-decision logic + headers + threshold but has no real production
numbers in its tables yet. The per-agent rows are all blank
(`(per-agent table from CLI)`), the fleet non-fin-acq average is
`(post-deploy)`, and the decision cell reads
`SHIP if rate < 30%, else DEFER`. The skeleton is acceptable per the
plan 115-08 T03 acceptance criterion (structure + SHIP/DEFER tokens
present), but it is not a measurement.

A real measurement requires:
1. A legitimate operator-confirmed deploy of plans 115-00 through 115-08
   (touches `traces.db` writers added in 115-04 / 115-05 / 115-07 / 115-08).
2. A 24h soak window during which the fleet generates the per-turn rows
   that `clawcode tool-latency-audit --json --window-hours 24` reads.
3. The operator running the audit CLI and pasting the output into
   `wave-2-checkpoint.md`.

Per CLAUDE.md `feedback_no_auto_deploy` and `feedback_ramy_active_no_deploy`:
this closeout plan ships code only — it does not deploy. Therefore the
gate cannot fire today.

**Consequence for plan 115-09 task 3 (sub-scope 6-B implementation):**
**SKIP.** No `src/manager/haiku-direct-fastpath.ts` is created in this
plan. No routing edit to `src/manager/turn-dispatcher.ts`. No
`directSdkFastPath` config flag in `src/config/schema.ts`. The
`files_modified` list in 115-09-PLAN.md frontmatter is intentionally
NOT carried out for the SHIP-only files; only the DEFER-path artifacts
land (this file + the closeout report).

---

## Measured rates (from Plan 115-08)

| Agent                      | turns | turnsWithTools | tool_use_rate | sub-scope 6-B gate                  |
| :------------------------- | ----: | -------------: | ------------: | :---------------------------------- |
| (per-agent table from CLI) |       |                |               | (computed)                          |
| admin-clawdy               |  TBD  |     TBD        |      TBD      | (computed)                          |
| fin-acquisition            |  TBD  |     TBD        |      TBD      | fin-acq-excluded-from-gate (D-12)   |
| fin-research               |  TBD  |     TBD        |      TBD      | (computed)                          |
| finmentum-content-creator  |  TBD  |     TBD        |      TBD      | (computed)                          |
| personal                   |  TBD  |     TBD        |      TBD      | (computed)                          |
| projects                   |  TBD  |     TBD        |      TBD      | (computed)                          |
| research                   |  TBD  |     TBD        |      TBD      | (computed)                          |
| test-agent                 |  TBD  |     TBD        |      TBD      | (computed)                          |
| fin-playground             |  TBD  |     TBD        |      TBD      | (computed)                          |
| fin-tax                    |  TBD  |     TBD        |      TBD      | (computed)                          |
| general                    |  TBD  |     TBD        |      TBD      | (computed)                          |

**Excluding fin-acquisition** from the fleet average per CONTEXT D-12 — the
Ramy-paced #fin-acquisition channel is tool-heavy by nature (mysql_query +
web_search probes during live client research) and is a different
population than the idle-Discord-ack workload that sub-scope 6-B's
1h-TTL fast-path optimizes for. Including fin-acquisition in the gate
would systematically push the fleet average up and would defer 6-B
inappropriately for the median agent.

**Fleet non-fin-acq average:** `(pending operator audit)`

**Decision for plan 115-09 sub-scope 6-B:** `SHIP` if rate < 30% else `DEFER`. Today: **PENDING-OPERATOR → de-facto DEFER**.

---

## Rationale

The closeout plan executor has direct primary-source evidence that the
gate's input data does not exist in production yet:

1. `wave-2-checkpoint.md` per-agent table has only the header row +
   placeholder `(per-agent table from CLI)`, `admin-clawdy` row blank,
   `fin-acquisition` row blank, `...` row.
2. The fleet non-fin-acq average reads `(post-deploy)`.
3. The skeleton itself (top of file) explicitly states
   *"Numbers populate post-deploy"* and *"No deploy was triggered to
   populate this report."*

Given indeterminate input, the executor cannot honestly stamp
`SHIP` — that would mean creating production code (a new direct-SDK
auth path, a routing decision in `turn-dispatcher.ts`, a config flag
exposed to operators) on an unmeasured assumption. The cost of a
wrong-direction SHIP is non-trivial: the fast-path mirrors `callHaikuDirect`
(OAuth bearer plumbing, raw Anthropic SDK call), introduces a second
auth code path that has to be kept in sync, and would route real Discord
turns through it. A wrong-direction DEFER is a no-op (CLI's existing
5m-TTL path keeps working as today).

The asymmetric cost of being wrong + the fact that plan 116 can SHIP
6-B at any time once the audit numbers exist + the fact that the
1h-TTL benefit only accrues on idle agents (the bimodal cache-hit
pattern documented in `baseline-pre-115.md` line 22) all point to
DEFER as the safe default until measurement.

---

## Punt path (DEFERRED to follow-on phase)

Sub-scope 6-B (direct-SDK 1h-TTL fast-path) is **DEFERRED** to a
follow-on phase. Tentatively named **Phase 116** — name finalized when
operator opens the discuss-phase for it.

### Phase 116 inputs

When the operator opens the discuss-phase for the follow-on, the
planner has these primary-source artifacts to read:

- **This file** — gate-decision rationale, threshold provenance, fin-acq exclusion logic.
- **`wave-2-checkpoint.md`** — measurement skeleton + headers + the
  CLI invocation that populates it.
- **`baseline-pre-115.md`** — pre-115 anchor numbers (the 92.8% Ramy /
  <30% idle bimodal cache-hit pattern is the structural reason 6-B
  exists at all).
- **`post-115-comparison.md`** — what the rest of phase 115 actually
  shipped + which of the 6 perf targets need 6-B to close them out.
- **`.planning/research/115-memory-redesign/perf-caching-retrieval.md`
  § "Three options for ClawCode"** — Option B (1h-TTL via direct SDK)
  vs Option C (CLI default 5m TTL) decision matrix; Phase 116 should
  re-read this with the new measurement in hand.

### Phase 116 trigger condition

Phase 116 opens when:
1. Operator runs `scripts/deploy-clawdy.sh` for the post-115 build
   (during a Ramy-quiet window with explicit "deploy" / "ship it" in
   the same turn — per CLAUDE.md gate).
2. Soak window of ≥24h elapses (per `wave-2-checkpoint.md` instructions).
3. Operator runs `clawcode tool-latency-audit --window-hours 24 --json`
   and inspects the fleet non-fin-acq average.
4. If avg `< 25%` (clear SHIP signal) → open Phase 116 to ship 6-B.
5. If avg `≥ 35%` (clear DEFER signal) → close 6-B as permanently
   not-needed; fleet is tool-heavy enough that the cache-write tax of
   1h-TTL outweighs the read benefit.
6. If `25% ≤ avg < 35%` (ambiguous band) → operator's call. The 30%
   number is a knob (CONTEXT D-12), so Phase 116 may refine the
   threshold based on the per-agent distribution shape (e.g., if
   most agents cluster at ~10% with one outlier at ~50%, ship 6-B;
   the median benefit dominates).

### Why this is not a regression

Plan 115-09's other deliverables (sub-scope 12 cross-agent coordinator,
sub-scope 16(c) dashboard surface, post-115 comparison report) are
fully independent of 6-B. The closeout report is published with 6-B
status = DEFERRED, which is a complete and honest record of the phase.

The four perf-comparisons files together form the complete phase-115
evidentiary record:
- `baseline-pre-115.md` (broken state)
- `wave-2-checkpoint.md` (mid-phase progress + gate skeleton)
- `sub-scope-6b-decision.md` (this file — gate read + DEFER decision)
- `post-115-comparison.md` (final results)

---

## CLI surface

The operator inspects this gate via the existing
`clawcode tool-latency-audit` CLI (Plan 115-08 T03 — already shipped):

```bash
clawcode tool-latency-audit --json --window-hours 24
clawcode tool-latency-audit --window-hours 24
```

Plan 115-09 T01 also adds `clawcode perf-comparison` — a
single-command receipt that prints the gate decision + the 6 perf-target
deltas for the closeout report. See
`src/cli/commands/perf-comparison.ts`.

---

*Authored by closeout plan 115-09 executor. Updates to this file (e.g.,
filling in the per-agent table after a real audit run) should preserve
the SHIP/DEFER token in the Decision section so plan 116 can re-read it
unambiguously.*
