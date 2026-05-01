---
phase: 107
plan: 01
subsystem: dream-pass / memory-pipeline-integrity
tags: [dream-pass, json-output, parse-recovery, structured-logging, fault-tolerance]
requires: []
provides:
  - DREAM-OUT-01-fallback-envelope
  - DREAM-OUT-03-warn-level-parse-recovery
  - DREAM-OUT-04-recovery-test-coverage
affects:
  - src/manager/dream-prompt-builder.ts
  - src/manager/dream-pass.ts
  - src/manager/__tests__/dream-prompt-builder.test.ts
  - src/manager/__tests__/dream-pass-json-recovery.test.ts (new)
deferred:
  - DREAM-OUT-02 (SDK structured-output mode — see <deferred> in 107-01-PLAN.md)
tech-stack:
  added: []
  patterns:
    - "pino structured logging via (obj, msg) form for operator-greppable journalctl fields"
    - "Single union signature (objOrMsg | string) instead of TS overloads — avoids forcing every implementation to handle every shape"
    - "Unicode-safe string truncation via Array.from + slice + join (codepoint boundaries respected)"
key-files:
  created:
    - src/manager/__tests__/dream-pass-json-recovery.test.ts
    - .planning/phases/107-memory-pipeline-integrity-dream-json-vec-memories-orphan-cleanup/deferred-items.md
  modified:
    - src/manager/dream-prompt-builder.ts
    - src/manager/dream-pass.ts
    - src/manager/__tests__/dream-prompt-builder.test.ts
decisions:
  - "Use schema-correct fallback envelope shape (newWikilinks/promotionCandidates/themedReflection/suggestedConsolidations) NOT CONTEXT.md's incorrect summary/errors keys — RESEARCH.md Open Question 2"
  - "Keep DreamPassLog.warn as a single union signature, not TS overloads — overloads forced existing test stubs to handle both shapes (broke noopLog in dream-pass.test.ts)"
  - "Schema-validation failure stays at log.error (not warn) — distinct from parse failure: validation failure means model emitted JSON the daemon can't safely use, which is a stronger 'broken' signal than non-JSON prose"
  - "DREAM-OUT-02 (SDK json_schema output mode) deferred — per-turn injection requires 5-file refactor through TurnDispatcher / SessionManager / sendAndCollect / turnOptions, out of budget for this small phase"
metrics:
  duration: "~10 min"
  completed: 2026-05-01
  tasks: 4
  commits: 3
  tests-added: 11
  tests-passing: 53
---

# Phase 107 Plan 01: Pillar A — Dream JSON Enforcement Summary

Fault-tolerance hardening for the dream-pass LLM round-trip: a schema-correct fallback envelope so the model has a deterministic escape hatch when uncertain, plus warn-level structured recovery so parse failures grep cleanly across the fleet without polluting error-rate alerts.

## What was built

**DREAM-OUT-01 — Fallback envelope rule.** Appended a 6th `CRITICAL OUTPUT RULE` to `dream-prompt-builder.ts`. When the model cannot produce valid JSON for any reason, it must output this exact 4-key empty envelope:

```json
{"newWikilinks":[],"promotionCandidates":[],"themedReflection":"","suggestedConsolidations":[]}
```

The keys match `dreamResultSchema` (dream-pass.ts:48-72) verbatim — zod accepts the envelope as a legitimate no-op. Rule 6 also explicitly forbids the prose patterns Haiku slipped into despite Phase 95's tightened rules: `"Noted —"`, `"I'll do my best"`, `"Picking up where we left off"`. Rules 1–5 preserved verbatim (append-only edit, Phase 95 static-grep regression rules respected).

**DREAM-OUT-03 — Warn-level structured parse recovery.** The parse-failure block (dream-pass.ts:271-280, now ~30 lines) was switched from `deps.log.error(\`dream-pass: \${agentName} ...\`)` to:

```ts
deps.log.warn(
  { component: "dream-pass", action: "parse-failed", responsePrefix, agent: agentName, err: msg },
  "dream pass returned non-JSON; treating as no-op",
);
return { kind: "failed", error: `parse-failed: ${msg}` };
```

`responsePrefix` is capped at 80 chars via Unicode-safe `Array.from(rawText).slice(0, 80).join("")` — emoji and multibyte chars don't get split mid-codepoint.

`DreamPassLog.warn` was relaxed to a single union signature `(objOrMsg: Record<string, unknown> | string, msg?: string) => void` rather than TS overloads — overloads force every implementation to handle every shape, which broke the existing `noopLog` stubs in `dream-pass.test.ts`. The single union form preserves backward compatibility and matches pino's polymorphic warn shape.

The 3-variant `DreamPassOutcome` union is preserved unchanged. `failed → skipped` mapping in `dream-auto-apply.ts:82-87` keeps the daemon-non-crash invariant intact.

**DREAM-OUT-04 — Recovery test coverage.** New test file `src/manager/__tests__/dream-pass-json-recovery.test.ts` covers 6 input branches:

| Test | Input | Outcome | Warn called | Error called |
|------|-------|---------|-------------|--------------|
| prose-input | `"Noted — couldn't analyze that"` | `failed` | yes (structured) | no |
| valid-json | full dream result | `completed` | no | no |
| fallback-envelope | empty 4-key envelope | `completed` (legitimate no-op) | no | no |
| malformed-json | `'{"newWikilinks":[],}'` | `failed` (parse path) | yes | no |
| non-fatal | all of the above | resolves (never throws) | n/a | n/a |
| responsePrefix-cap | 3000-char prose | `failed` | yes (prefix.length === 80) | no |

**DREAM-OUT-02 — DEFERRED.** SDK structured-output mode (`outputFormat: { type: "json_schema", schema }`) is supported by the SDK (`sdk.d.ts:694, 1244`) but production dream-pass dispatches through the agent's persistent shared `sdk.query` handle (`session-adapter.ts:653, 1286-1311`) where `outputFormat` is session-scoped — set once at session creation. Per-turn injection requires plumbing a new `DispatchOptions` flag through `TurnDispatcher.dispatch` → `SessionManager.dispatchTurn` → `sendAndCollect` → `turnOptions` (`session-adapter.ts:908-925`). 5-file refactor; out of budget for this small phase. Full anchors recorded in `<deferred>` section of `107-01-PLAN.md` for future-phase pickup. DREAM-OUT-01 + DREAM-OUT-03 deliver the fault-tolerance value without it.

## Files modified

- `src/manager/dream-prompt-builder.ts` — appended rule 6 with fallback envelope (3 lines)
- `src/manager/dream-pass.ts` — extended `DreamPassLog.warn` signature; rewrote parse-failure block as structured warn (15 lines net)
- `src/manager/__tests__/dream-prompt-builder.test.ts` — added `Phase 107 DREAM-OUT-01 fallback envelope rule` describe block (5 assertions)
- `src/manager/__tests__/dream-pass-json-recovery.test.ts` — NEW (249 lines, 6 tests)
- `.planning/phases/107-...integrity.../deferred-items.md` — NEW (logs pre-existing P1/P3 failures in dream-prompt-builder.test.ts that are out of scope)

## Production wiring (daemon.ts)

No changes needed at `daemon.ts:~3112`. The daemon passes its pino `log = logger.child({ component: "daemon" })` handle into `runDreamPassPrim`. Pino's `warn` is natively polymorphic — supports both `(obj, msg)` and `(msg)` shapes — so it satisfies the new `DreamPassLog.warn` union signature without any wrapper. The structured fields land in journalctl with `component=dream-pass action=parse-failed agent=<name>` exactly as required by the operator-greppability goal.

## Test results

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| dream-pass-json-recovery (new) | 1 | 6 | ✓ all pass |
| dream-pass | 1 | 13 | ✓ all pass |
| dream-cron | 1 | (passing) | ✓ |
| dream-auto-apply | 1 | (passing) | ✓ |
| dream-ipc | 1 | (passing) | ✓ |
| dream-log-writer | 1 | (passing) | ✓ |
| **Total dream suite** | **6** | **53** | **53 passing** |

`npm run typecheck`: 118 pre-existing errors in unrelated files (118 vs 125 baseline — actually 7 dream-related TS errors fixed). All errors I touched compile clean.

## Commits

| SHA | Subject |
|-----|---------|
| `3e9342b` | test(107-01-01): add dream-pass JSON recovery RED tests |
| `853842b` | feat(107-01-02): DREAM-OUT-01 — append rule 6 with schema-correct fallback envelope |
| `e63b605` | feat(107-01-03): DREAM-OUT-03 — warn-level structured parse-failure recovery |

Task 4 (DREAM-OUT-02 deferral documentation) required no commit — the `<deferred>` section was already authored in `107-01-PLAN.md` lines 427-460 with the full reason, 8 file anchors, fault-tolerance argument, and pitfall warning.

## Deviations from Plan

**None.** All four tasks executed as specified. The fallback envelope shape, log signature, structured field set, and responsePrefix cap algorithm match the plan verbatim. The only minor adaptation was switching `DreamPassLog.warn` from two TS overloads to a single union signature (the plan's "Step 1" example sketch suggested overloads; in practice overloads broke existing test stubs that only accept `(msg: string)` — single union form is behaviorally equivalent and easier to satisfy structurally).

## Deferred Issues (out of scope for this plan)

Documented in `.planning/phases/107-memory-pipeline-integrity-dream-json-vec-memories-orphan-cleanup/deferred-items.md`:

1. `dream-prompt-builder.test.ts` P1 test references stale `"Output JSON ONLY"` string — fails on master before my edit. Pre-existing.
2. `dream-prompt-builder.test.ts` P3 test times out (~50s) due to O(n²) truncation loop in `buildDreamPrompt`. Pre-existing.

Both should be addressed in a future Phase 95 follow-up. They are unrelated to the dream JSON enforcement contract.

## Self-Check: PASSED

- src/manager/dream-prompt-builder.ts contains rule 6 with schema-correct fallback envelope: FOUND (1 grep match)
- src/manager/dream-pass.ts:271-289 calls deps.log.warn (not error) with structured fields: FOUND
- src/manager/__tests__/dream-pass-json-recovery.test.ts exists with 6 it-blocks: FOUND
- Commit 3e9342b: FOUND
- Commit 853842b: FOUND
- Commit e63b605: FOUND
- DREAM-OUT-02 deferral in 107-01-PLAN.md (≥2 occurrences): FOUND (14 occurrences)
- Static grep V3 (envelope shape match): 1 (expected 1)
- Static grep V4 (parse-failure no log.error in 260-290): 0 (expected 0)
- Static grep V5 (DREAM-OUT-02 deferral count): 14 (expected ≥2)
