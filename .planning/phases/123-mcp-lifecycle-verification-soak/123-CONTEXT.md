# Phase 123: MCP Lifecycle Verification Soak — Context

**Gathered:** 2026-05-14
**Status:** Plans promoted, awaiting operator-cleared production access
**Mode:** Plan promotion + pending-evidence framing — pure-execution wave, NO new code. Per ROADMAP 2026-05-13 update, the soak window's spirit is met (MCP subsystems have soaked in production ≥1 week without drift). Phase still ships formal verification artifacts and CLI exit-code coverage.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP entry | 5 success criteria + sequencing note (soak window satisfied) | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 123 |
| 123-01 plan (promoted) | Phase 999.6-02 production smoke gate (SC-2) | `.planning/phases/123-mcp-lifecycle-verification-soak/123-01-PLAN.md` |
| 123-02 plan (promoted) | Phase 999.14-02 Wave 2 verification MCP-06..MCP-10 (SC-3) | `.planning/phases/123-mcp-lifecycle-verification-soak/123-02-PLAN.md` |
| 123-03 plan (promoted) | Phase 999.15-04 three-variant soak (SC-4 + SC-5) | `.planning/phases/123-mcp-lifecycle-verification-soak/123-03-PLAN.md` |
| Phase 106 hotfix `fa72303` | `clawcode mcp-tracker` CLI fix — verified end-to-end by SC-5 | git: `git show fa72303 -- src/cli/commands/mcp-tracker.ts` |
| Discord MCP plugin `fetch_messages` | SC-1 Ramy-quiet verification mechanism (NOT journalctl) | `mcp__plugin_discord_discord__fetch_messages` |
| `feedback_ramy_active_no_deploy.md` | Deploy hold continues — this phase is deploy-gated entirely | memory |
| `feedback_silent_path_bifurcation.md` | Anti-pattern — Phase 123 verifies the absence of drift, not the presence of fixes | memory |
</canonical_refs>

<domain>
## Phase Boundary

Phase 123 is **verification-only**, not implementation. Three pre-written plans from Phase 999.6 / 999.14 / 999.15 are promoted here to formally close MCP-01..MCP-03 requirements:

- **MCP-01** (snapshot/restore): Phase 999.6-01 shipped the code. Phase 123 Plan 01 verifies it.
- **MCP-02** (MCP child-process lifecycle): Phase 999.14-01 shipped the code. Phase 123 Plan 02 verifies it.
- **MCP-03** (PID tracking + self-healing): Phase 999.15-03 shipped the code + `clawcode mcp-tracker` CLI. Phase 123 Plan 03 verifies it across three restart variants.

**All 5 success criteria require operator-cleared production access on clawdy.** This phase cannot complete in a local sandbox; the verification artifacts capture evidence from real clawdy runs.

**2026-05-13 update (per ROADMAP):** the soak window's spirit is satisfied — production has run continuously ≥1 week without drift. Phase 123 ships the formal evidence capture, NOT the waiting period.
</domain>

<decisions>
## Implementation Decisions

### D-01 — Verification-only — NO new code (per ROADMAP)
Plans 01, 02, 03 are pure-execution. No `feat()` commits expected. Output is `*-VERIFICATION.md` artifacts with captured evidence.

### D-02 — SC-1 mechanism: Discord MCP plugin, NOT journalctl
ROADMAP success-criterion 1 is explicit: Ramy-quiet state verified via `mcp__plugin_discord_discord__fetch_messages` on `#fin-acquisition`. The verification artifact records the timestamp + channel-state snapshot used to authorize the window. journalctl is NOT acceptable per the explicit ROADMAP language.

### D-03 — Three-variant soak (SC-4) is non-negotiable
Plan 03's three variants — cold restart (5× `systemctl restart clawcode`), per-agent restart (one stop/start, others untouched), forced respawn (SIGKILL one MCP child) — ALL must pass. Each variant has the same two checks:
- `pgrep -cf mcp-server-mysql` count == live agent count
- `ps -ef | awk '$3==1 && /mcp-server-mysql/'` count == 0 (no orphan reparenting)

### D-04 — Tracker drift assertion (SC-4)
Beyond the orphan check, the `clawcode mcp-tracker` view must match `/proc` reality. Tracker drift = a known regression class; the soak captures evidence of zero drift across all three variants.

### D-05 — CLI exit-code coverage (SC-5)
`clawcode mcp-tracker` exits 0/1/2/3 deterministically against live state. Phase 106 hotfix `fa72303` is the implementation; SC-5 captures the end-to-end verification.

### D-06 — Phase 123 is the LAST wave of v2.9 milestone
Per ROADMAP sequencing note, Phase 123 closes the milestone. No phase after it in v2.9. After Phase 123 verification artifacts capture, run `/gsd-audit-milestone` → `/gsd-complete-milestone`.

### D-07 — Operator-pause for SC-2 / SC-3 / SC-4 / SC-5
Every success criterion past SC-1 requires operator action on clawdy. Phase 123 commit set today is structural (plan promotion + this CONTEXT). The verification artifacts land WHEN the operator runs the soak. Status until then: `BLOCKED-deploy-pending`.

### D-08 — Latent-issue budget (PITFALLS Pattern C)
Per ROADMAP: "budget for a second latent MCP issue to surface during the restart window; do not pre-commit to a single-issue resolution." If a soak variant fails, capture the failure in the verification artifact, file a follow-up phase, do NOT block milestone close on the new finding (unless severity is critical).
</decisions>

<code_context>
## Existing Code Insights

- **Phase 999.6 (commit history)** — `src/manager/snapshot-manager.ts` ships pre-deploy snapshot + post-restart restore.
- **Phase 999.14 (commit history)** — MCP child-process lifecycle hardening landed under `src/mcp/server.ts` + child-process spawn wrappers.
- **Phase 999.15 (commit history)** — `src/manager/mcp-tracker.ts` + `clawcode mcp-tracker` CLI under `src/cli/commands/mcp-tracker.ts`.
- **Phase 106 hotfix `fa72303`** — `clawcode mcp-tracker` CLI Invalid Request fix.

## Reusable Patterns

- No new code. All implementation already shipped.
- Verification artifact pattern: capture timestamp + command output + assertion result into a `*-VERIFICATION.md` per success criterion.
</code_context>

<specifics>
## Specific Requirements

- SC-1 verification artifact MUST contain the `mcp__plugin_discord_discord__fetch_messages` output (sanitized for PII if needed) + the timestamp of the authorization window opening.
- SC-4 captures THREE separate evidence blocks — one per variant (cold / per-agent / forced respawn).
- SC-5 captures the `clawcode mcp-tracker` exit code + output for each soak variant, demonstrating 0/1/2/3 path coverage.
- Per D-08, if a NEW MCP issue surfaces during the soak, file a follow-up phase (Phase 124+ or 999.X), document the issue in `123-DEFERRED-ITEMS.md`, do NOT block this phase's close.
</specifics>

<deferred>
## Deferred Ideas

- **MCP soak automation** (running the three variants via a script) — operator currently runs each manually; automation would speed milestone close but is out of scope.
- **Tracker drift telemetry** — surface tracker-vs-/proc divergence as a dashboard tile. Defer to a future observability phase.
- **MCP child-process restart history retention** — log the last N respawn events per server. Operator pain signal not yet established.
</deferred>

<pending_evidence>
## Pending Evidence Checklist (for operator)

When the deploy window opens, capture into `123-VERIFICATION.md`:

- [ ] **SC-1 (Ramy-quiet auth):** Discord MCP `fetch_messages` on `#fin-acquisition` showing N minutes of inactivity. Timestamp + channel-state snapshot.
- [ ] **SC-2 (Plan 999.6-02 smoke):** Run pre-deploy snapshot. Restart daemon. Confirm ≥3 agents restored cleanly. Capture snapshot-manager round-trip log.
- [ ] **SC-3 (Plan 999.14-02 verification):** `npm test` against deployed binary on clawdy. `tsc --noEmit` clean. MCP-06..MCP-10 specific test names green.
- [ ] **SC-4 (Plan 999.15-04 three variants):**
  - Variant A — Cold restart × 5: `for i in $(seq 1 5); do systemctl restart clawcode; sleep 30; done`. After each, `pgrep -cf mcp-server-mysql` == agent_count AND `ps -ef | awk '$3==1 && /mcp-server-mysql/'` == 0.
  - Variant B — Per-agent restart: stop one agent (`clawcode stop <agent>`), confirm other agents untouched, start it again, confirm MCP child count restored.
  - Variant C — Forced respawn: `kill -9 <mcp-child-pid>`, watch reaper + tracker reconcile within ≤60s.
- [ ] **SC-5 (CLI exit codes):** `clawcode mcp-tracker` invoked against live state across all three variants, exit codes 0/1/2/3 each captured.
- [ ] **D-08 surveillance:** If ANY new MCP behavior surfaces, file in `123-DEFERRED-ITEMS.md` and continue.

When all SC checked, commit `123-VERIFICATION.md` and proceed to `/gsd-audit-milestone v2.9`.
</pending_evidence>
