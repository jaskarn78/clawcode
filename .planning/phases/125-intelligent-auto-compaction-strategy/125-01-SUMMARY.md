---
phase: 125
plan: 01
title: Active-state YAML builder + heartbeat probe injection
status: complete
deployed: false
sentinel: "[125-01-active-state]"
commits:
  - 1d0464b  # T-01: pure builder + types
  - bbcc624  # T-02: atomic YAML writer + tolerant reader
  - 94dbc2d  # T-03: runner setter + daemon wiring + sentinel-once
requirements:
  - SC-1
---

# Phase 125 Plan 01 — Summary

## What Shipped

Tier-1 "active state" header end-to-end on the read+write half:
- **Pure builder** `src/manager/active-state/builder.ts` — extracts primary client, in-flight tasks, today's standing rules, drive folders, last 3 operator messages, last agent commitments. Pure function, injected clock, 50-line cap.
- **Atomic YAML I/O** `src/manager/active-state/yaml-writer.ts` — `writeActiveStateYaml` writes to `<base>/<agent>/<state>/active-state.yaml.<ts>.<pid>.tmp` then renames; `readActiveStateYaml` fails closed (null) on missing/parse errors so Plan 02/03 consumers fall through gracefully. Sentinel comment `# sentinel: "[125-01-active-state]"` precedes YAML body. `renderActiveStateForPrompt` produces the BACKLOG-SOURCE-shaped human header.
- **Runner DI seam** `HeartbeatRunner.setActiveStateProvider(fn)` mirrors `setCompactSessionTrigger`. Per-tick call wraps the returned string with `--- ACTIVE STATE --- … --- end ---` and caches it in `lastProbeText` (accessor `getLastProbeText`). Provider failures warn-log without blocking the tick.
- **Daemon wiring** `daemon.ts:~3441` builds last-5 operator messages + assistant turns from `getConversationStore`, runs the builder, persists YAML to `~/.clawcode/agents/<agent>/state/`, returns the rendered text. Sentinel `[125-01-active-state]` fires once per agent per process (`Set<string>` guard) for journalctl proof.

Read-by-agent dispatch is deferred per CONTEXT D-02 (no dynamic system-prompt seam in SDK 0.2.x); Plans 02/03 will splice the YAML into the compaction summary turn.

## Tests

| Path | Cases | Result |
|------|-------|--------|
| `src/manager/active-state/__tests__/builder.test.ts` | 7 | pass |
| `src/manager/active-state/__tests__/yaml-writer.test.ts` | 6 | pass |
| `src/heartbeat/__tests__/runner-active-state.test.ts` | 5 | pass |

Scoped run output (last 5 lines):

```
 Test Files  3 passed (3)
      Tests  18 passed (18)
   Start at  15:13:11
   Duration  1.58s (transform 444ms, setup 0ms, import 1.59s, tests 73ms, environment 0ms)
```

`npx tsc --noEmit` clean across whole workspace.

## Grep Gates (anti-bifurcation)

- `grep -n "setActiveStateProvider" src/heartbeat/runner.ts src/manager/daemon.ts` → 2 matches (both sides wired).
- `grep -n "\[125-01-active-state\]" src/manager/daemon.ts` → 3 matches (sentinel comment + first-fire log + warn-path log).

## Deviations

- **None on substance.** T-03's "probe text injection" is plumbing (provider closure + `lastProbeText` cache) rather than literal agent-facing dispatch, per CONTEXT D-02's acknowledgment that no dynamic system-prompt seam exists in SDK 0.2.x. The YAML write is the durable side (verifiable locally); the read-by-agent side is observable only against a live deployed agent. Advisor consulted before T-03 to confirm.
- **Pre-existing failure** in `src/heartbeat/__tests__/runner.test.ts` (`checkCount: 12` vs actual `13`) is unchanged and out-of-scope per Plan 01 T-03 acceptance criteria + `124-04-SUMMARY` note. The other 14 cases pass.

## Open Items

- **Deploy held** (Ramy-active, per `feedback_ramy_active_no_deploy.md`). Code lands local only. Production sentinel proof deferred to deploy window:
  ```bash
  ssh clawdy "journalctl -u clawcode --since '1h ago' -g '125-01-active-state'"
  ```
- **Phase 125 Plans 02–04 still pending.** Plan 01 ships first per D-08 wave structure. Plan 02 (single extractor seam + Tier 1 verbatim + Tier 4 drop) is next; Plan 03 (Tier 2 Haiku) and Plan 04 (Tier 3 prose + A/B fixture) follow strictly sequentially.

## Self-Check: PASSED

- builder.ts, yaml-writer.ts, runner-active-state.test.ts present (verified via vitest run + git status).
- Commits 1d0464b, bbcc624, 94dbc2d in `git log` on master.
- Acceptance grep gates returned ≥1 match each.
