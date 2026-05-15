# Phase 124 — Operator-Triggered Session Compaction — Phase Summary

**Status:** Code-complete across all 6 plans (00 SDK probe + 01-05); merged to master; deploy held per `feedback_ramy_active_no_deploy`. Auto-trigger sentinel + dashboard sparkline + live-handle hot-swap verification gated on next deploy window.
**Phase window:** 2026-05-14 (entire phase landed same day across 6 plan waves).

## Plans

| Plan | Subject | Commits | Status |
|------|---------|---------|--------|
| 124-00 | SDK control-call validation probe (chose `forkSession` + summary-prepend; SDK 0.2.140 has no public `compact()` verb) | `e3a46ed` | Merged; `BLOCKED-sdk-feature: yes` with verbatim annotation pinned in `124-00-SDK-PROBE.md` |
| 124-01 | Compaction primitive — `handleCompactSession` IPC handler + `clawcode session compact <agent>` CLI + MVP extractor + integration tests | `833e274` `6e3915a` `c0b675e` `aa9c082` `946e72d` | Merged; 9 tests green |
| 124-02 | Heartbeat decoupling — split AUTO-RESET vs AUTO-COMPACT blocks + `auto-compact-at` YAML schema + static-grep SC-5 sentinel | `0884060` `926d36a` `d8dda3f` | Merged; 20/20 tests green |
| 124-03 | Discord `/clawcode-session-compact` admin command + ephemeral embed + IPC dispatch + error propagation | `7fa2eca` `8da3768` `ee417e8` `2524724` `1798b73` | Merged; 12/12 slash + 44/44 sibling tests green |
| 124-04 | Auto-trigger wiring at heartbeat hot path + `CompactionEventLog` cooldown gate + sentinel `[124-04-auto-trigger]` + dashboard tokens sparkline | `0095881` `5d15ad5` `f953004` | Merged; `cooldownMs:300000` hardcoded daemon-side |
| 124-05 | Live hot-swap — `SessionHandle.swap()` + `handle.swap` invocation in `handleCompactSession` + `swapped_live:true` surface | `bfae32e` `498a68d` `f753e42` `4e5b195` | Merged; 7 + 3 swap tests green |
| 124-06 | `turnStartedAt` producer/consumer wiring for `ERR_TURN_TOO_LONG` budget gate | `4db083e` `cc03263` | Merged; budget gate now armed in prod |

## Success Criteria — verification status

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | First-class CLI: `clawcode session compact <agent>` reports `tokens_before` / `tokens_after` / `summary_written` | ✅ **Code-complete** | `src/cli/commands/session-compact.ts` + `daemon-compact-session-ipc.ts` + 124-05 live hot-swap |
| SC-2 | Discord `/clawcode-session-compact <agent>` admin command + ephemeral embed | ✅ **Code-complete** | `slash-commands.ts:renderCompactEmbed` + admin gate + ephemeral defer |
| SC-3 | Memory preserved across compaction (with revised D-04: `memory.db` GROWS by design — original chunks preserved, new ones added) | ✅ **Code-complete** | `compact-session-integration.test.ts` pins `memoriesCreated > 0` + all original chunk IDs preserved |
| SC-4 | Mid-turn safety: `handleCompactSession` queues behind in-flight turn + `ERR_TURN_TOO_LONG` budget after N min (10 default) | ✅ **Code-complete** | `compact-session-mid-turn.test.ts` (5 tests) + 124-06 `turnStartedAt` wiring armed |
| SC-5 | Policy decoupling: heartbeat distinguishes `AUTO-RESET` from `AUTO-COMPACT` + static-grep regression test | ✅ **Code-complete** | T-03 static-grep sentinel rejects single-block conflation |
| SC-6 | Telemetry: `session_tokens` + `last_compaction_at` per agent + dashboard tokens sparkline | ✅ **Code-complete** | `CompactionEventLog` + heartbeat-status telemetry surface + AgentTile sparkline |

## Outstanding operator actions

1. **Deploy clearance** — entire phase landed local-only; production verification pending Ramy-quiet window.
2. **Post-deploy auto-trigger smoke (SC-6 production tail):**
   ```bash
   ssh clawdy "journalctl -u clawcode --since '1h ago' -g '124-04-auto-trigger'"
   ```
   Absence of keyword = low fleet-wide context-fill (not a bug); presence = wiring confirmed end-to-end.
3. **Dashboard visual smoke** — tokens sparkline on AgentTile renders after first compaction event in `CompactionEventLog`.

## Deferred / open items

- **`runner.test.ts` `checkCount: 12` vs `13` mismatch** — pre-existing, predates Phase 124; logged for housekeeping plan.
- **Per-agent `cooldownMs` config knob** — currently hardcoded 5 min daemon-side; defer to Phase 125 if operator pain emerges.
- **DEFERRED-124-B** — `compact-session-integration.test.ts:121` `Mock<EmbeddingService>` type narrowing; logged to `deferred-items.md`.
- **Race window between gate-check and `record(agent)`** — acknowledged unguarded; mitigated by heartbeat interval ≥ compaction wall-time + `hasActiveTurn` rejection + 5-min cooldown bound. Revisit if production journalctl shows repeat sentinels < cooldown apart.

## Net

- 6/6 plans (00-05 + 06) code-complete and merged.
- 6/6 SCs closed locally; entire phase production-verification gated on deploy.
- Phase 125 (tiered retention algorithm) builds on top of this primitive — see `125-PHASE-SUMMARY.md`.

Phase 124 closes cleanly when the post-deploy auto-trigger sentinel is observed in production logs AND the dashboard sparkline renders a tokens curve.
