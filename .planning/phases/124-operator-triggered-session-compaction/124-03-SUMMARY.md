---
phase: 124-operator-triggered-session-compaction
plan: 03
subsystem: discord-slash
tags: [discord, slash-command, admin-only, session-compaction, ipc]
requires:
  - 124-01  # handleCompactSession + daemon `compact-session` IPC case
provides:
  - "Discord admin command `/clawcode-session-compact <agent>` (CONTROL_COMMANDS entry + inline short-circuit handler + pure renderCompactEmbed helper)"
affects:
  - src/discord/slash-types.ts
  - src/discord/slash-commands.ts
  - src/discord/__tests__/slash-compact.test.ts
tech-stack:
  added: []
  patterns:
    - "Inline-handler-short-circuit-before-CONTROL_COMMANDS (12th application; Phases 85/86/87/88/90/91/92/95/96/100/117)"
    - "isAdminClawdyInteraction gate BEFORE deferReply (Phase 95/96/117 admin precedent)"
    - "Pure exported renderXxxEmbed helper (Phase 95 renderDreamEmbed precedent)"
key-files:
  created:
    - src/discord/__tests__/slash-compact.test.ts
  modified:
    - src/discord/slash-types.ts        # +33 lines (CONTROL_COMMANDS entry + naming-collision comment)
    - src/discord/slash-commands.ts     # +166 lines (renderCompactEmbed + CompactSessionIpcResponse type + handleCompactCommand + inline branch)
decisions:
  - "Rename /compact → /clawcode-session-compact (both alternatives reserved by native-CC loop)"
  - "Re-declare CompactSessionIpcResponse locally in slash module (keeps import direction clean — Discord layer reads daemon contract via IPC shape only)"
  - "Wrap sendIpcRequest in try/catch and synthesize {ok:false, error:'UNKNOWN'} on throw (uniform render path)"
metrics:
  duration: "~45 min"
  completed: 2026-05-14
---

# Phase 124 Plan 03: Discord `/clawcode-session-compact` admin command Summary

Operator-facing Discord admin command that triggers the Plan 124-01 hybrid compaction primitive without dropping to the CLI. Admin-only, ephemeral, mirrors the Phase 95 `/clawcode-dream` precedent end-to-end. Closes SC-2.

## Commits

| SHA | Task | Description |
|-----|------|-------------|
| `1798b73` | docs   | align 124-03-PLAN.md with actual file layout (paths/codes/fields/naming) |
| `7fa2eca` | T-01   | register `clawcode-session-compact` SlashCommandDef in `CONTROL_COMMANDS` |
| `8da3768` | T-02   | admin gate + ephemeral defer + handler scaffold |
| `ee417e8` | T-03   | wire `compact-session` IPC dispatch + 5-field success embed |
| `2524724` | T-04   | error-code propagation + thrown-IPC handling (UNKNOWN fallback) |

## Tests Added

`src/discord/__tests__/slash-compact.test.ts` — 12 cases, all passing:

- **T01-R1** — registry smoke test: `CONTROL_COMMANDS` contains the entry with `ipcMethod: "compact-session"`, `defaultMemberPermissions: "0"`, required `agent` STRING option (silent-path-bifurcation guard).
- **T02-G1 / G2** — admin gate: non-admin → reply with "Admin-only", zero IPC, zero defer; admin → no refusal reply, deferReply called ephemerally.
- **T03-H1** — IPC dispatch asserted (`sendIpcRequest` called once with `"compact-session"` + `{agent:"fin-acquisition"}`).
- **T03-H2 / H3** — embed shape: title contains agent, color `0x2ecc71` green, all 5 fields populated; `null` tokens render as `n/a`, `summary_written:false` renders as `no`.
- **T04-E1** — four parameterized cases, one per named error code (`AGENT_NOT_RUNNING`, `DAEMON_NOT_READY`, `ERR_TURN_TOO_LONG`, `AGENT_NOT_INITIALIZED`): red `0xe74c3c` embed, code verbatim in description.
- **T04-E2** — IPC throw → red embed with thrown message (synthetic `UNKNOWN` path).
- **T04-E3** — typed `ERR_TURN_TOO_LONG` response with message → both surface in description.

### Test Run (last 5 lines)

```
 Test Files  1 passed (1)
      Tests  12 passed (12)
   Start at  06:42:38
   Duration  4.30s (transform 2.14s, setup 0ms, import 4.15s, tests 15ms, environment 0ms)
```

Sibling slash tests still green: `dream-slash.test.ts` + `slash-verbose-command.test.ts` + `slash-commands.test.ts` = 44/44 pass after these changes.

`tsc --noEmit` clean for the files touched by this plan (one pre-existing `compact-session-integration.test.ts` error logged as DEFERRED-124-B).

## Deviations from Plan

### Rule 3 — Naming collision (`/compact` and `/clawcode-compact` both reserved)

**Found during:** Pre-T-01 orientation.
**Issue:** The operator dispatch said `/compact <agent>`. Bare `compact` is in `native-cc-commands.ts:68 ALLOWED_NATIVES` as a prompt-channel passthrough (sends `/compact` to the SDK). The native-CC registration loop auto-prefixes `clawcode-` (line 177), so `clawcode-compact` is ALSO produced by that loop. `mergeAndDedupe` is native-wins (`slash-commands.ts:1050`), so either name would be silently displaced at register time — the classic silent-path-bifurcation anti-pattern.
**Fix:** Renamed to `clawcode-session-compact`. The native-CC loop only auto-generates `clawcode-${sdkName}`; the SDK reports `compact`, not `session-compact`, so no collision possible. Gives Discord/CLI parity with the operator-facing `clawcode session compact <agent>` CLI primitive shipped in Plan 124-02.
**Surfaced in code:** `slash-types.ts` block comment above the entry (lines 715-732).

### Rule 3 — Plan 124-03 pre-existed but was stale

**Found during:** Pre-execution orientation.
**Issue:** The plan file existed with `src/manager/slash-commands*.ts` paths (don't exist; real files are in `src/discord/`), the wrong error-code vocabulary (`WORKER_UNREACHABLE` is not emitted by the handler), missing `forked_to`/`memories_created` fields, and an "in-process call" wiring claim that contradicted the `handleDreamCommand` IPC precedent.
**Fix:** Rewrote the plan in commit `1798b73` to match reality before executing.

## Threat Flags

None. The plan's existing T-124-08..11 threats are mitigated as planned (admin gate before IPC, ephemeral replies, agent argument validated downstream by `getSessionHandle`, single-admin DoS accepted).

## Open Items

- **Deploy held** — Ramy active in `#fin-acquisition`. Per operator constraint #1, no production deploy in this turn.
- **Discord client cache** — operators may need to restart Discord client once to see the new command surface in the slash menu (Discord caches the per-guild command list).
- **DEFERRED-124-B** — pre-existing tsc error in `compact-session-integration.test.ts:121` (mock type narrower than `EmbeddingService`). Logged to `deferred-items.md`; out of scope for Plan 124-03.

## Self-Check: PASSED

- File `src/discord/__tests__/slash-compact.test.ts` exists.
- File `src/discord/slash-commands.ts` modified (renderCompactEmbed + handleCompactCommand + inline branch present).
- File `src/discord/slash-types.ts` modified (`clawcode-session-compact` entry present in `CONTROL_COMMANDS`).
- Commits `1798b73`, `7fa2eca`, `8da3768`, `ee417e8`, `2524724` all in `git log`.
- 12/12 slash-compact tests pass; 44/44 sibling slash tests still pass.
