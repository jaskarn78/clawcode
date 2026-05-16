# Phase 125: Intelligent Auto-Compaction Strategy — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** Auto-discuss — `125-BACKLOG-SOURCE.md` (operator-written 2026-05-13) is authoritative.

<canonical_refs>
## Canonical References

| Ref | Why | Path |
|-----|-----|------|
| ROADMAP — Phase 125 | 8 Success Criteria (SC-1..SC-8) | `.planning/ROADMAP.md` §"Phase Details — v2.9" / Phase 125 |
| BACKLOG-SOURCE (authoritative spec) | Tiered retention spec + suggested rollout | `.planning/phases/125-intelligent-auto-compaction-strategy/125-BACKLOG-SOURCE.md` |
| Phase 124 CONTEXT (D-04 + D-12) | memory.db GROWS by design; forkSession+summary-prepend mechanism | `.planning/phases/124-operator-triggered-session-compaction/124-CONTEXT.md` |
| Phase 124-01 SUMMARY | MVP extractor + deferred live-handle swap (open item) | `.planning/phases/124-operator-triggered-session-compaction/124-01-SUMMARY.md` |
| Phase 124-04 SUMMARY | auto-trigger wiring + sentinel `[124-04-auto-trigger]` + cooldown gate | `.planning/phases/124-operator-triggered-session-compaction/124-04-SUMMARY.md` |
| Manual IPC dispatch (extractor site A) | MVP `extractMemories` to be replaced | `src/manager/daemon.ts:10430-10500` (case `"compact-session"`) |
| Auto-trigger dispatch (extractor site B) | MVP `extractMemories` — DO NOT FORGET (silent-path-bifurcation prevention) | `src/manager/daemon.ts:3327-3401` (heartbeat trigger) |
| IPC handler | `extractMemories: ExtractMemoriesFn` DI seam | `src/manager/daemon-compact-session-ipc.ts:83-97, 231` |
| Compaction primitive | The unchanged anchor — Phase 125 must NOT modify | `src/manager/session-manager.ts:2203` (`compactForAgent`) |
| Compaction core | Calls `extractMemories(fullText)` at line 151 | `src/memory/compaction.ts:127, 151` |
| CompactionEventLog | Telemetry record + cooldown source | `src/manager/compaction-event-log.ts` |
| Phase 95 dreaming Haiku worker | Precedent for Tier 2 Haiku invocation | `.planning/phases/95-memory-dreaming-autonomous-reflection-and-consolidation/95-CONTEXT.md` |
| Existing Haiku summarizer (REUSE) | Proven Haiku call shape + 30s timeout + fallback | `src/memory/session-summarizer.ts:48-180` (`buildSessionSummarizationPrompt`, `summarizeSession`) |
| Memory-flush Haiku call | Secondary precedent — `summarizeWithHaiku` shape | `src/memory/memory-flush.ts:48-79` |
| `feedback_silent_path_bifurcation.md` | Anti-pattern: two dispatch paths, one updated, one regressed | memory |
| `feedback_ramy_active_no_deploy.md` | Deploy hold — code lands locally, no clawdy redeploy without operator clearance | memory |
</canonical_refs>

<domain>
## Phase Boundary

Phase 124 shipped the **compaction primitive** (CLI, IPC handler, fork mechanism, auto-trigger wiring at the heartbeat hot path, telemetry surface). The `extractMemoriesFn` callback is currently a **trivial MVP** (line-split filter, >20 chars, cap 20) wired identically at TWO daemon sites:

1. `src/manager/daemon.ts:10440` — manual IPC `case "compact-session":`
2. `src/manager/daemon.ts:3333` — heartbeat auto-trigger (`setCompactSessionTrigger`)

**Phase 125 replaces ONLY the extractor callback** with a tiered retention pipeline. It does NOT modify:
- `SessionManager.compactForAgent()` (session-manager.ts:2203)
- `CompactionManager.compact()` (compaction.ts:127)
- `handleCompactSession` IPC handler shape (daemon-compact-session-ipc.ts)
- The fork/summary-prepend orchestration
- The cooldown / event-log / sentinel telemetry

Tier rollout from BACKLOG-SOURCE §"Suggested incremental rollout":
- **Phase 1 (Plan 01):** Active-state header (cheap; YAML+inject; no compaction yet)
- **Phase 2 (Plan 02):** Tier 1 verbatim preservation + Tier 4 drop rules
- **Phase 3 (Plan 03):** Tier 2 structured Haiku extraction (reuse session-summarizer.ts pattern)
- **Phase 4 (Plan 04):** Tier 3 prose summary + A/B verification fixture + latency regression sentinel
</domain>

<decisions>
## Implementation Decisions

### D-01 — Single extractor seam: `src/manager/compact-extractors/`
**Hard constraint.** Both daemon.ts dispatch sites (3333 + 10440) currently inline the MVP extractor. Phase 125 introduces ONE module — `src/manager/compact-extractors/index.ts` — that exports `buildTieredExtractor(deps)` returning the `ExtractMemoriesFn` callback. Both daemon sites import it; Plans 02/03/04 evolve the pipeline behind the seam. This is the silent-path-bifurcation prevention seam (per `feedback_silent_path_bifurcation.md` — 3× regressions in 2026 from exactly this anti-pattern). Plan 02 establishes the seam; Plans 03/04 only modify `compact-extractors/`, never the daemon switch case.

### D-02 — Plan 01 mechanism: deterministic YAML write + heartbeat probe injection
The active-state header is **persisted to disk** at `~/.clawcode/agents/<agent>/state/active-state.yaml` (the path BACKLOG-SOURCE pre-specifies for SC-4) and **injected as a heartbeat probe section** (the existing surface that already runs every tick). NOT a system-prompt extension (no dynamic system-prompt seam exists in SDK 0.2.x). NOT a synthetic first user message (would race with operator turns). The YAML write is the durable side; the heartbeat injection is the read-by-agent side. Plans 02/03 later splice this YAML into the compaction summary turn so the header survives across fork swaps.

### D-03 — Tier 2 reuses `src/memory/session-summarizer.ts`, NOT a fresh Haiku worker
The proven seam: `buildSessionSummarizationPrompt(turns)` + `summarizeSession(deps)` with the 30s timeout + raw-turn fallback. Plan 03 builds a sibling function `extractStructuredFacts(text, deps)` in `src/manager/compact-extractors/tier2-haiku.ts` that follows the same call shape (DI'd `summarize: (prompt) => Promise<string>` callback, fallback on timeout/parse failure). The prompt is different (structured-YAML output vs. prose summary), but the wiring pattern is reused. **Do NOT invent a new Haiku worker harness.**

### D-04 — `memory.db` GROWS BY DESIGN (inherited from Phase 124 D-04)
Tier 2's structured-facts output persists to BOTH:
- `~/.clawcode/agents/<agent>/state/active-state.yaml` (operator-inspectable, per SC-4)
- `memory.db` as a `memories` chunk (via the existing `extractMemoriesFn` → `MemoryStore.addMemoryChunks` path inside `compaction.ts`)

The dual write is the durability layer: YAML is the live read for the active-state header; `memory.db` chunks survive a full reset and are recallable via RRF retrieval. This is the operator's "preserve load-bearing context" mechanism.

### D-05 — SC-7 inherited from Phase 124-04, not re-planned
Phase 124-04 closed SC-7 (auto-compact-at threshold) by wiring `autoCompactAt` into the heartbeat `context-fill` check with 5-min cooldown + sentinel `[124-04-auto-trigger]`. Phase 125 inherits this wiring; the tier rollout only changes WHAT gets extracted, not WHEN compaction fires. **No plan in Phase 125 modifies `src/heartbeat/checks/context-fill.ts` or `CompactionEventLog`.**

### D-06 — Sentinel-keyword discipline (per Phase 124-04 precedent)
Each plan logs a sentinel at the new-code entry point so `journalctl -g '<sentinel>'` proves the path executes in production. Sentinels:
- Plan 01: `[125-01-active-state]`
- Plan 02: `[125-02-tier1-filter]` (and `[125-02-tier4-drop]` for the drop branch)
- Plan 03: `[125-03-tier2-haiku]`
- Plan 04: `[125-04-tier3-prose]`

### D-07 — Deploy hold continues (Ramy-active)
Per `feedback_ramy_active_no_deploy.md`. All Phase 125 plans land local commits + tests. No clawdy redeploy until operator clearance in the same turn ("deploy" / "ship it"). Verification against production (SC-5 A/B fuzzy fixture, SC-6 latency, sentinel journalctl proof) deferred to deploy window.

### D-08 — Wave structure
- **Wave 1:** Plan 01 (active-state header — orthogonal to extractor; no daemon-extractor changes)
- **Wave 2:** Plan 02 (single extractor seam + Tier 1 + Tier 4 — establishes the module both later plans build on)
- **Wave 3:** Plan 03 (Tier 2 Haiku) — depends on Plan 02 (uses the seam)
- **Wave 4:** Plan 04 (Tier 3 prose + A/B verification fixture + latency sentinel) — depends on Plan 03 (tier 2 output is upstream input)

Plans 02→03→04 are strictly sequential (each evolves the same pipeline module). Plan 01 is parallel-OK with Plan 02 (different files) but the brief specifies linear rollout — keep linear for operator review simplicity.

### D-09 — Per-agent "preserve verbatim" patterns (SC-8) handled in Plan 02
Finmentum-specific patterns ("any line mentioning AUM, any line with `$`") read from `clawcode.yaml` per-agent block (`preserveVerbatimPatterns: string[]`). Plan 02 adds the schema field and the Tier 1 filter consumes it. Empty array = no extra patterns (back-compat default for non-Finmentum agents).
</decisions>

<code_context>
## Existing Code Insights

- **Two MVP extractor sites** at `daemon.ts:3333` (auto-trigger) + `daemon.ts:10440` (manual IPC). Both must be replaced together via the D-01 seam. Grep proof before commit: `grep -n "split(\"\\\\n\")" src/manager/daemon.ts` should return zero matches after Plan 02 ships.
- **`extractMemoriesFn` type** at `src/manager/daemon-compact-session-ipc.ts:84`: `(text: string) => Promise<readonly string[]>`. The tiered pipeline must conform to this signature — facts returned become `memories` chunks in `memory.db` via `MemoryStore.addMemoryChunks` inside `compaction.ts:151`.
- **`CompactionResult.memoriesCreated`** at `src/memory/compaction.ts` — counted into telemetry. Tier 2 output increases this count; tests assert it.
- **`buildSessionSummarizationPrompt` / `summarizeSession`** at `src/memory/session-summarizer.ts:48-180` — proven 30s-timeout + raw-turn-fallback shape. Reuse pattern in Tier 2 (D-03).
- **Heartbeat probe injection point** — `src/heartbeat/runner.ts` already builds per-agent probe text. Plan 01 splices the active-state YAML at the top of this text. Grep: `grep -n "buildProbe\|buildHeartbeatText" src/heartbeat/`.

## Reusable Patterns

- Single-seam dispatch (D-01) — same anti-bifurcation lesson as Phase 117 `AdvisorService`.
- Haiku-summarizer DI shape (D-03) — same shape as Phase 89/95 `summarizeWithHaiku`.
- Sentinel-keyword telemetry (D-06) — Phase 124-04 `[124-04-auto-trigger]`.
- Atomic-commit-per-task (Phase 999.36) convention.
</code_context>

<specifics>
## Specific Requirements

- The grep gate at end of Plan 02 — `grep -c 'split("\\n")' src/manager/daemon.ts | grep -v '^#'` must equal 0 (silent-path-bifurcation enforcement; both extractor sites collapsed to the seam).
- Plan 03's Haiku call must time out at 30s (matching session-summarizer.ts pattern) and fall back to Tier 4-only output if Haiku fails — Tier 3 prose alone is still a valid compaction.
- Plan 04's A/B fuzzy fixture (SC-5) is non-negotiable — 20-prompt corpus, >90% agreement on client-name + task-state + most-recent-feedback. Without it SC-5 is unprovable.
- All four plans append a `[125-0X-<sentinel>]` log line at first call so `journalctl -u clawcode -g '\[125-' --since '1h ago'` proves end-to-end pipeline execution.
- Tier 2 YAML output goes to `~/.clawcode/agents/<agent>/state/active-state.yaml` (BACKLOG-SOURCE-specified path; SC-4 inspect target).
- Tier 1 N=10 is configurable per-agent (`preserveLastTurns: number`, default 10). Tier 1 must ALWAYS include SOUL.md + IDENTITY.md content + last 3 operator user-messages regardless of N.
</specifics>

<deferred>
## Deferred Ideas

- **Live-handle hot-swap** (Phase 124-01 follow-up `124-01-followup-live-handle-swap`) — Phase 125 inherits the Path B limitation (active session JSONL on disk does NOT shrink; new fork is preserved for audit). Operator-visible "session-shrinkage" pain remains until that follow-up lands. Not in Phase 125 scope.
- **Per-agent `cooldownMs` config knob** (current: hardcoded 5 min) — deferred from Phase 124-04. Operator pain signal not yet present; Phase 125 does NOT add this.
- **Multi-agent A/B fixture** (testing across all 14 agents) — Plan 04 ships a single synthetic 6-hour fin-acquisition replay fixture. Multi-agent fixture-pack deferred.
- **Cross-agent active-state sharing** (e.g., projects agent knowing fin-acquisition's primary client) — out of scope; per-agent YAML only.
- **PostCompactHookInput / SDKCompactBoundaryMessage integration** (SDK-side compact hook) — Phase 124 D-12 explicitly chose `forkSession + summary-prepend`; Phase 125 inherits. Revisit if SDK 0.3.x exposes a callable `/compact` verb.
</deferred>
</content>
</invoke>