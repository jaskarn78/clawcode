# Phase 121: Subagent UX Completion + Chunk-Boundary — Context

**Gathered:** 2026-05-14
**Status:** Ready for execute (plans pre-exist, promoted from Phase 999.36)
**Mode:** Plan promotion — no new design work. The original Phase 999.36 (subagent UX trio + sub-bug D) shipped Plans 00 + 01 (typing indicator + share-file routing) and pre-wrote Plans 02 + 03 (sub-bug D premature completion + sub-bug B chunk-boundary). v2.9 Phase 121 picks up the unshipped pair.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP entry | Phase boundary, 4 success criteria, sequencing | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 121 |
| Original Phase 999.36 CONTEXT.md | Operator-written design context (D-01..D-16) for ALL four sub-bugs | `.planning/phases/999.36-subagent-ux-typing-truncation-cross-channel-file-leak/999.36-CONTEXT.md` |
| 121-01-PLAN.md | Sub-bug D — premature completion gate (promoted from 999.36-02) | `.planning/phases/121-subagent-ux-completion-and-chunk-boundary/121-01-PLAN.md` |
| 121-02-PLAN.md | Sub-bug B — chunk-boundary seam (promoted from 999.36-03) | `.planning/phases/121-subagent-ux-completion-and-chunk-boundary/121-02-PLAN.md` |
| `subagent-thread-spawner.ts` | Primary target — both plans edit this file | `src/discord/subagent-thread-spawner.ts` |
| `webhook-manager.ts` | Sibling audit target (SC-4) | `src/discord/webhook-manager.ts` |
| Phase 999.36 SUMMARY (Plan 00) | `seamGapBytes` diagnostic field that SC-3 reads | git log — Phase 999.36 commits |
</canonical_refs>

<domain>
## Phase Boundary

Two unshipped plans from the Phase 999.36 backlog promoted into v2.9 Phase 121:

- **Sub-bug D** — `subagent_complete` event fires before stream is drained AND delivery is confirmed. Causes parent's autoRelay to announce work done while last chunks silently disappear.
- **Sub-bug B** — Off-by-3 byte seam at the 2000-char Discord message boundary. Editor truncate vs overflow chunk handoff drops content. 2003-char fixture reproduces it.

Plans 00 + 01 (typing indicator + cross-channel file routing) already shipped under 999.36. This phase closes the remaining two.
</domain>

<decisions>
## Implementation Decisions (locked — from Phase 999.36 CONTEXT.md D-01..D-16)

### D-01 (carry-over) — Sequence 02 before 03 per ROADMAP sequencing note
Both plans edit `src/discord/subagent-thread-spawner.ts`. Ship 121-01 (completion gate) first, then 121-02 (byte-seam). Avoids merge churn within the same file.

### D-02 (carry-over) — Sub-bug D fix gates completion on `streamFullyDrained && deliveryConfirmed`
The completion event MUST fire ONLY when:
- The subagent's stream has emitted `end` (not just inactive)
- The Discord post pipeline has confirmed delivery of the LAST chunk
- (NOT on tool-result-with-no-followup or heartbeat-quiescence)
Quiescence detection fires a SEPARATE `subagent_idle_warning` (visibility only, no autoArchive impact).

### D-03 (carry-over) — Sub-bug B fix: explicit chunk boundary tracking
Track `lastChunkTail` and `nextChunkHead` per stream. When posting/editing the next message, verify the head doesn't overlap the previous tail (double-write) AND doesn't skip content (drop). On detected drop, log structured warning with byte offset + content sample, patch the previous edit to include the dropped bytes.

### D-04 — `splitMessage` sibling audit (SC-4 of ROADMAP)
Audit `webhook-manager.ts`'s `splitMessage` for the same off-by-3 seam. Use the 2003-char fixture from 121-02 Task 1 as the proof. Outcome recorded in verification artifact: either CONFIRMED no-seam OR same-fix-applied.

### D-05 — `seamGapBytes` diagnostic logs ZERO on production relays (SC-3 of ROADMAP)
Phase 999.36 Plan 00 added the `seamGapBytes` field. SC-3 verifies it logs `0` across a 24h production soak. This is a verification check, not new code.

### D-06 — Deploy hold continues
Code lands + tests run locally. Deploy waits for operator clearance (Ramy hold).
</decisions>

<code_context>
## Existing Code Insights

- **`src/discord/subagent-thread-spawner.ts`** — primary target. Both plans edit it. Plan 01 changes completion-event firing; Plan 02 changes chunk-boundary handling.
- **`src/discord/progressive-message-editor.ts`** (or similar) — Plan 02's chunk-tracking lives here. Confirm exact path via grep.
- **`src/discord/webhook-manager.ts`** — sibling audit target (D-04).
- **Phase 999.36 fixture** — 2003-character regression fixture from Plan 03 Task 1. Promoted with the plan.

## Reusable Patterns

- Phase 999.36 Plan 00's `seamGapBytes` diagnostic field — already shipped, used as SC-3 verification.
- Phase 119 Plan 01's atomic-commit-per-task pattern — apply here.
</code_context>

<specifics>
## Specific Requirements

- 121-02 Task 1's 2003-character fixture is the ground truth. The fixture is in the plan file (promoted from 999.36-03). Do not invent a new fixture.
- SC-3 (24h soak with `seamGapBytes == 0`) is verification-only post-deploy. Capture journalctl grep result in verification artifact when deploy window opens.
- SC-4 audit MUST produce a written conclusion (no-seam-confirmed OR same-fix-applied). Don't skip it.
</specifics>

<deferred>
## Deferred Ideas

- **Sub-bug A** (typing indicator) and **Sub-bug C** (cross-channel file leak) — already shipped under Phase 999.36, not in scope.
- **Heartbeat-quiescence rename to `subagent_idle_warning`** — covered by D-02. If the rename surfaces other callers, scope creep — separate phase.
- **`progressive-message-editor.ts` general refactor** — D-03 fixes the specific off-by-3 seam, not the editor's architecture.
</deferred>
