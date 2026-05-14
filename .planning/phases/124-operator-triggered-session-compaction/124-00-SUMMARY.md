---
phase: 124-operator-triggered-session-compaction
plan: 00
subsystem: session-compaction
tags: [sdk-probe, validation, blocked-sdk-feature, wave-0]
dependency-graph:
  requires: []
  provides:
    - 124-01-PLAN.md  # consumes the named primitive in T-03 action body
  affects:
    - 124-01-PLAN.md
    - 124-03-PLAN.md
    - 124-04-PLAN.md
tech-stack:
  added: []
  patterns:
    - "Static type-definition probe before IPC handler design (D-11 enforcement)"
key-files:
  created:
    - .planning/phases/124-operator-triggered-session-compaction/124-00-SDK-PROBE.md
  modified: []
decisions:
  - "Use forkSession(sessionId, { upToMessageId? }) per CONTEXT D-11 as the daemon→worker control verb — SDK 0.2.140 exposes no callable compact() verb on Query and no SDKControlCompactRequest in the internal control-request union."
  - "Plan 124-01 MUST embed the verbatim BLOCKED-sdk-feature annotation drafted in 124-00-SDK-PROBE.md so the SDK gap is operator-visible in the worker call site."
  - "compact_summary / SDKCompactBoundaryMessage are result-only types — useful for telemetry (Phase 124-04) but not callable for triggering compaction."
metrics:
  duration_minutes: 5
  completed_date: 2026-05-14
  task_count: 1
  file_count: 1
---

# Phase 124 Plan 00: SDK Control-Call Validation Probe Summary

One-liner: Confirmed via exhaustive sdk.d.ts scan that @anthropic-ai/claude-agent-sdk@0.2.140 exposes no callable compact verb — Plan 124-01 will use `forkSession()` per CONTEXT D-11 with a verbatim BLOCKED-sdk-feature annotation.

## What was done

Probed `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (SDK 0.2.140) for daemon→worker compaction primitives that bypass the turn loop. Documented every `compact|forkSession|sessionControl|interrupt` hit, identified the three plausible callables (`forkSession`, `Query.interrupt`, `Query.applyFlagSettings`), ruled out the latter two as non-equivalents, and confirmed `forkSession` is the correct D-11 fallback. Wrote 124-00-SDK-PROBE.md with the BLOCKED-sdk-feature annotation Plan 01 will embed verbatim.

## Findings

- **Public `Query` interface (sdk.d.ts:2023-2250):** complete enumeration of on-session control methods. No `compact()` method.
- **Internal `SDKControlRequestInner` union (sdk.d.ts:2893):** exhaustive list of every dispatchable control verb. No `SDKControlCompactRequest`.
- **Compaction surface present:** `autoCompactEnabled`, `autoCompactThreshold`, `autoCompactWindow` (options, not verbs); `PreCompactHookInput` / `PostCompactHookInput` (hook payloads); `SDKCompactBoundaryMessage` with `compact_metadata { messagesToKeep, anchor_uuid }` (stream event); `SDKStatus = 'compacting'`; `compact_result` / `compact_error` (result fields); `SessionStart.source = 'compact'` (post-compact resume marker). All read-only/observe-only — none is a trigger.
- **Conclusion:** SDK reserves the compaction trigger; operator-on-demand compaction must go through `forkSession`.

## Recommendation handed to Plan 01

**Primitive:** `forkSession(sessionId, { upToMessageId?, title? })` — free function at sdk.d.ts:622 returning `Promise<{ sessionId }>`.

**Worker-side call shape Plan 01 T-03 should implement:**
1. Daemon receives `handleCompactSession(agent)` IPC.
2. Daemon enqueues behind in-flight turn per Phase 105 dispatch hot path (D-03 safety budget: `ERR_TURN_TOO_LONG` after 10 min).
3. On turn settle: daemon calls `Query.close()` on the live worker `Query`, calls `forkSession(currentSessionId)`, then re-spawns the worker process with `--resume <forkSessionId>`.
4. Telemetry surface (Plan 04) records `last_compaction_at` + tokens_before/tokens_after.

## BLOCKED-sdk-feature: yes

Plan 01 must embed the verbatim annotation drafted in `124-00-SDK-PROBE.md` (Recommendation section). Tracks: future SDK 0.3.x landing a public compact verb — re-grep `SDKControlRequestInner` union and `Query` interface on each SDK upgrade.

## Deviations from Plan

None — plan executed exactly as written. The branch where SDK exposes a `compact()` verb (planned-for-but-not-found) triggered the documented fallback per the plan's own "Rules" block.

## Self-Check: PASSED

- File exists: FOUND: `.planning/phases/124-operator-triggered-session-compaction/124-00-SDK-PROBE.md`
- Commit exists: FOUND: `e3a46ed` — `docs(124-00): SDK control-call validation probe`
- Verification gate passed: 1 `**Primitive:**` line + 1 `**Fallback` line in probe file
- Output spec satisfied: SDK version recorded (0.2.140); primitive named (`forkSession`); fallback status explicit (`forkSession` is itself the D-11 fallback, no further fallback); BLOCKED-sdk-feature decision unambiguous (yes, with verbatim annotation text)
