# Phase 124: Operator-Triggered Session Compaction — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** Auto-discuss — BACKLOG-SOURCE.md (operator-written 2026-05-13) is the authoritative spec input. Decisions follow it.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP entry | 6 success criteria + sequencing note (mirror Phase 117 IPC pattern) | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 124 |
| BACKLOG-SOURCE (authoritative spec) | Operator-written 2026-05-13 16:30 PT; symptoms + root cause + acceptance | `.planning/phases/124-operator-triggered-session-compaction/124-BACKLOG-SOURCE.md` |
| Phase 117 advisor IPC pattern | Closest precedent for daemon→worker control messages | `src/manager/daemon-ask-agent-ipc.ts` (`handleAskAdvisor`); CLAUDE.md §"Advisor pattern (Phase 117)" |
| Phase 105 dispatch hot path | Compaction queues behind in-flight turns same way | `.planning/phases/105-trigger-policy-default-allow-and-queue_full-coalescer-storm-fix/` |
| Phase 103 telemetry surface | Extension target for `session_tokens` / `last_compaction_at` | `.planning/phases/103-clawcode-status-rich-telemetry-and-usage-panel-operator-observability/` |
| Claude Agent SDK | `/compact` session-control API (vs. literal "/compact" message) | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` |
| `clawcode` CLI | Add `session compact` subcommand | `src/cli/index.ts` (or wherever subcommand dispatch lives) |
| Admin Clawdy slash commands | `/compact <agent>` admin path | `src/manager/slash-commands*.ts` |
| Heartbeat prompt template | Policy-decoupling target (SC-5) | `clawcode.yaml` (heartbeat blocks per agent) |
| `feedback_silent_path_bifurcation.md` | Anti-pattern — static-grep regression for SC-5 | memory |
</canonical_refs>

<domain>
## Phase Boundary

Operator-pain item from 2026-05-13: fin-acquisition session JSONL at 8.5 MB after 6 hours of work, zero `"type":"summary"` entries → compaction had never fired. Ramy stacked 3 messages in 2 min; agent took ~4 min to respond.

Today there is no clean way to compact a long-running agent's session. CLI doesn't have `compact`. `/compact` as a literal message is untested. `restart` is destructive (blows away the session). Phase 124 ships:
1. First-class CLI primitive (`clawcode session compact <agent>`)
2. Admin Discord command (`/compact <agent>`)
3. Mid-turn safety queueing (per Phase 105 dispatch model)
4. Policy decoupling — heartbeat prompt distinguishes "reset" (still disabled for Finmentum) from "compaction" (newly allowed)
5. Memory preservation (compaction touches conversation window only, NOT `memory.db`)
6. Telemetry surface (`session_tokens` + `last_compaction_at` per agent)

**This phase is the PRIMITIVE.** Phase 125 builds the tiered-retention algorithm on top.
</domain>

<decisions>
## Implementation Decisions

### D-01 — Daemon→worker control via SDK session-control API, NOT literal "/compact" message
Per ROADMAP sequencing note. Sending `/compact` as a normal agent message has unknown semantics and would route through the turn loop. The Claude Agent SDK exposes session-control primitives that bypass the turn loop. Use those. If the SDK lacks a public `/compact` method, file a deferred item and use the closest control primitive (likely `forkSession` or a session-control IPC pending SDK 0.3.x).

### D-02 — Mirror Phase 117's advisor IPC pattern shape
Register `handleCompactSession` in the daemon IPC dispatcher. The CLI / Discord command call into the dispatcher via the same IPC contract as `ask_advisor`. Daemon then signals the worker process via the existing manager-to-worker channel. **Don't invent a new IPC mechanism.**

### D-03 — Mid-turn queue per Phase 105 dispatch hot path
Compaction request received while agent is mid-tool-chain → enqueue behind the current turn (same way Phase 105's trigger-policy queues messages). When the turn completes, the daemon flushes the queue and runs compaction. Safety budget: if a single turn exceeds N minutes (configurable, default 10), the compaction call exits non-zero with `ERR_TURN_TOO_LONG` and the operator sees a recognizable error code.

### D-04 — `memory.db` is OFF LIMITS
Compaction is conversation-window-only. Acceptance test: capture `stat -c '%s' agent-memory.db` before compaction, run compaction, assert byte count is unchanged. Probe turn after compaction recalls a memory chunk created before compaction (SC-3).

### D-05 — Heartbeat prompt decoupling — static-grep regression test
Today the Finmentum heartbeat block conflates auto-reset + auto-compaction under a single `## ⚠️ AUTO-RESET: DISABLED` directive. Phase 124 splits this into:
```yaml
## ⚠️ AUTO-RESET: DISABLED
Do NOT send `/clear`, do NOT recommend `/clear`, do NOT auto-reset at any threshold.

## ✅ AUTO-COMPACT: ALLOWED
Auto-compaction at `<threshold>` is permitted; suggest compaction at 🟠/🔴 context-fill zones (operator visibility — does not consume the no-reset rule).
```
Static-grep regression test asserts: no heartbeat block contains both `AUTO-RESET: DISABLED` AND `auto-compact` under a single header. Pattern: Phase 119's anti-pattern enforcement reused.

### D-06 — New per-agent setting: `auto-compact-at: <ratio>` (default 0.7)
Per-agent YAML knob. Independent of `auto-reset`. Phase 125 uses this; Phase 124 just ships the schema + config-reload integration. Default 0.7 = 70% of context window.

### D-07 — Telemetry: extend Phase 103 `/clawcode-status` surface
Add `session_tokens` (current token count) and `last_compaction_at` (timestamp or null) per agent. Dashboard sparkline tile shows tokens-used trend (reuse Phase 116 chart primitives).

### D-08 — Discord `/compact` is ADMIN-ONLY with ephemeral response
Refusal embed (ephemeral) for non-admin posters. Admin-allowed posters get a tokens_before/tokens_after/summary_written ephemeral embed. Pattern matches existing `/clawcode-verbose` admin-only command in Phase 117.

### D-09 — Plan structure: 4 plans across 3 waves
- **Wave 1:** `124-01-PLAN.md` — CLI subcommand + IPC handler + SDK control-call (T-01..T-03). Foundation. SC-1, SC-4 closed.
- **Wave 1 parallel:** `124-02-PLAN.md` — Heartbeat prompt template decoupling + static-grep regression + new YAML schema (`auto-compact-at`). SC-5 closed.
- **Wave 2 after 01:** `124-03-PLAN.md` — Discord `/compact` admin command (depends on the IPC handler from 01). SC-2 closed.
- **Wave 2 after 01:** `124-04-PLAN.md` — Telemetry surface (`session_tokens` + `last_compaction_at`) + dashboard sparkline tile (depends on 01 emitting the compaction event). SC-6 closed. SC-3 (memory preservation) verified via integration test in 01.

### D-10 — Deploy hold continues
Code lands locally + tests run. Verification on clawdy (SC-2 admin Discord round-trip, SC-3 memory probe, SC-4 mid-turn integration) waits for operator deploy clearance.

### D-11 — SDK control-call validation FIRST
Before writing the IPC handler, dispatch a quick local probe: `grep -n "compact\|forkSession\|session-control" node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` to confirm the SDK exposes a `/compact`-equivalent primitive. If yes, plan as-is. If no, file a `BLOCKED-sdk-feature` annotation in `124-01-PLAN.md` and use `forkSession` (mentioned in stack docs) as fallback.

### D-12 — Resolution of D-11 (2026-05-14, operator-chosen): forkSession + summary-prepend
**Probe outcome (committed at `e3a46ed`):** `@anthropic-ai/claude-agent-sdk@0.2.140` exposes NO callable `/compact` verb. Auto-compaction is option-driven (`autoCompactEnabled`, `autoCompactThreshold`) and result-readable (`PostCompactHookInput.compact_summary`, `SDKCompactBoundaryMessage`) — the SDK reserves the trigger.

**Operator decision (2026-05-14 session):** Path (a) — **forkSession + summary-prepend.** Compaction works as:

1. Daemon receives `clawcode session compact <agent>` IPC call.
2. Daemon reads the current session JSONL for that agent. Identifies the cut point N (e.g., the last K turns to preserve verbatim; everything before N is "to compact").
3. Daemon spawns a Haiku worker against the messages before N, generating a structured summary turn.
4. Daemon calls `forkSession(currentSessionId, { upToMessageId: N })` → gets a new session ID branched at message N.
5. Daemon prepends the summary as a synthetic first turn in the new fork.
6. Daemon swaps the live worker to the new session ID. Old session ID is archived (kept on disk for operator audit; not deleted).
7. `memory.db` untouched throughout — D-04 invariance holds.

**Semantics differ from `/compact`:** the operator gets a NEW session ID, not a compacted same-session. The session JSONL on disk shrinks (new fork starts smaller); the old fork is preserved for audit.

**Stdout payload (SC-1):** `tokens_before` (full session), `tokens_after` (new fork including summary turn), `summary_written: true`, plus new field `forked_to: <new_session_id>` (transparent about the fork mechanism — operators see what changed).

**Wave structure unchanged** (124-00 → 124-01 → 124-02 parallel → 124-03 + 124-04 in Wave 2), but Plan 01 task T-03 specifically targets the forkSession+summary-prepend flow per this decision.

**Phase 125 unblocked.** The tiered retention algorithm builds on this primitive: Tier 2 structured extraction produces the summary content; Tier 1 verbatim preservation maps to the "last K turns" the fork preserves; Tier 4 drop rules are applied inside the Haiku summarizer's input filtering.
</decisions>

<code_context>
## Existing Code Insights

- **Phase 117 `handleAskAdvisor`** in `src/manager/daemon-ask-agent-ipc.ts` (per CLAUDE.md) — IPC handler shape to mirror.
- **`src/cli/index.ts` (or `src/cli/commands/`)** — CLI subcommand dispatch. `session compact <agent>` lands here.
- **`clawcode.yaml`** — heartbeat blocks per agent. Phase 124 edits the Finmentum heartbeat (and any other agent that conflates reset+compaction) per D-05.
- **Phase 103 telemetry IPC** — `/clawcode-status` extension target. Phase 124 adds two fields.
- **Admin slash commands** — `/clawcode-verbose` precedent for admin-only ephemeral commands (Phase 117).

## Reusable Patterns

- Phase 117 IPC-handler dispatch pattern (D-02).
- Phase 119 / 122 static-grep regression test pattern (D-05).
- Phase 999.36 atomic-commit-per-task convention.
</code_context>

<specifics>
## Specific Requirements

- SC-4's integration test (mid-turn compact queueing) is non-negotiable — fires `compact` mid-tool-chain against a synthetic agent and asserts the tool sequence completes intact. Don't ship without this test.
- D-11's SDK validation MUST happen before the executor writes the IPC handler. If the SDK lacks the primitive, the IPC handler's worker-side call is wrong.
- The Finmentum agents' heartbeat is the canonical example for D-05; ALSO check Ramy / fin-acquisition / projects / admin agents for the same conflation pattern. The regression test enforces it across all heartbeat blocks.
</specifics>

<deferred>
## Deferred Ideas

- **Tiered retention algorithm** — Phase 125 owns this. Phase 124 ships only the primitive.
- **`/compact all-agents` bulk operation** — not in scope.
- **Compaction history retention** — keep the last N compactions per agent in a sidecar log for operator audit. Defer until operator pain signal exists.
- **Auto-compact policy enforcement at the daemon side** (vs. agent self-policing) — Phase 125 territory.
</deferred>
