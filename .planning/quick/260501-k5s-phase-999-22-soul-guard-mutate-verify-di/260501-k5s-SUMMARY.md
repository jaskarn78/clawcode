---
phase: 999.22-soul-guard-mutate-verify-directive
plan: 01
subsystem: config-schema / system-prompt-directives
tags: [tdd, locked-additive, soul-guard, hallucinated-success, fleet-wide, no-deploy]
requires:
  - DEFAULT_SYSTEM_PROMPT_DIRECTIVES (Phase 94 D-09/D-07/D-10 — existing 11-key record)
  - systemPromptDirectiveSchema (Phase 94 TOOL-10 — unchanged)
  - resolveSystemPromptDirectives (Phase 94 D-10 per-key merge — unchanged)
  - context-assembler stable-prefix injection (Phase 94 — unchanged wiring)
provides:
  - DEFAULT_SYSTEM_PROMPT_DIRECTIVES["mutate-verify"] (12th directive entry)
  - MUTATE-DIR-{1,2,3} static-grep regression pins
  - 12-key REG-DEFAULTS-PRESENT + REG-V25-BACKCOMPAT membership assertions
affects:
  - src/config/schema.ts (1 entry added inside Object.freeze record; existing 11 entries byte-identical)
  - src/config/__tests__/schema-system-prompt-directives.test.ts (1 new describe block + 2 membership-array updates)
tech-stack:
  added: []
  patterns:
    - additive-only Object.freeze entry inside DEFAULT_SYSTEM_PROMPT_DIRECTIVES (mirrors Phase 999.1 / 100-fu / 99 pattern verbatim)
    - canonical-phrase static-grep pin (1 phrase per directive — D-ARC-03 from Phase 999.1)
    - locked-additive guarantee verified via `git diff` showing zero removed content lines in schema.ts
key-files:
  created: []
  modified:
    - src/config/schema.ts (+28 lines, 1858 → 1886 LOC)
    - src/config/__tests__/schema-system-prompt-directives.test.ts (+28/-3 lines, 401 → 426 LOC)
decisions:
  - Directive lands fleet-wide via existing Phase 94 stable-prefix injection rail — no per-agent SOUL.md edits, no new wiring, no new schema (locked-additive D-ARC-01)
  - Canonical phrase "Quote the post-mutation evidence" pinned by static-grep — does not appear in any prior directive text, so MUTATE-DIR-3 cannot false-positive on a neighbor
  - Companion phrases ("After any mutation in the current turn", `Do not say "Set."`, "report failure or uncertainty") ride alongside the canonical pin but are not separately statically-pinned (D-ARC-03 — 1 phrase per directive)
  - Two atomic commits (RED → GREEN) per Phase 999.1 D-PLN-01 TDD pattern — RED proves test pins fail before implementation lands; GREEN proves single Object.freeze entry flips all 5 RED tests to GREEN
  - Operational note: directive is read at agent session boot (DEFAULT_SYSTEM_PROMPT_DIRECTIVES is imported at session-prompt assembly time). New agent sessions pick it up automatically; existing sessions get it on next session start. NO daemon restart needed for the directive itself — it's session-scoped
metrics:
  duration: ~7min
  tasks_completed: 2
  files_modified: 2
  commits: 2
  completed_date: 2026-05-01
---

# Phase 999.22 Plan 01: Soul-Guard Mutate-Verify Directive Summary

Add the `mutate-verify` agent-output directive (12th entry — was 11) into the existing Phase 94 `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` record to counter Claude's hallucinated-success failure mode that triggered the 2026-05-01 outage (Admin Clawdy framed a 7-hour-stale yaml value as a just-completed mutation; operator-triggered daemon reload caused the outage).

## What Shipped

### Files Modified

| File | Change | LOC delta |
|------|--------|-----------|
| `src/config/schema.ts` | +1 `Object.freeze` entry (`mutate-verify`) inside `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` | +28 (1858 → 1886) |
| `src/config/__tests__/schema-system-prompt-directives.test.ts` | +1 new describe block (3 tests) + 2 membership-array updates (11 → 12 keys) | +28/-3 (401 → 426) |

### Commits Landed (atomic RED → GREEN)

| Order | Hash | Message |
|-------|------|---------|
| 1 (RED) | `fd3aa10` | `test(999.22): RED — pin mutate-verify directive + extend 12-key membership` |
| 2 (GREEN) | `9486ad5` | `feat(999.22): GREEN — land mutate-verify directive (soul-guard against hallucinated success)` |

### Directive Entry (verbatim from src/config/schema.ts:359-371)

```typescript
"mutate-verify": Object.freeze({
  enabled: true,
  text:
    "After any mutation in the current turn (Edit/Write to files, config writes, sudo or shell commands that change system state, systemctl actions, IPC mutations, MCP tools that change state on the other side), you MUST read the resulting state back and Quote the post-mutation evidence inline BEFORE claiming the mutation is done. Format: \"After <action> on <target>, I <read-back action>; the resulting <field/line/state> is `<paste verbatim>`.\" Not just \"Done.\"\n\n" +
    "Do not say \"Set.\", \"Done.\", \"Live.\", \"Saved.\", or \"Updated.\" when you didn't actually perform the write in the current turn — even if the desired state is already present from a prior session. Passive-success framing implies you just did it; if you didn't, the operator may take a downstream action (reload, deploy, retry) that breaks production. Instead say \"<state> is already present (<source>: mtime=<ts>, value=`<paste>`)\" or \"I have not changed <target> in this turn.\"\n\n" +
    "If verification fails OR cannot be performed (read tool unavailable, target inaccessible, mutation went through a layer you can't observe), report failure or uncertainty — never success. Better: \"I attempted <action> on <target> but cannot verify the result (<reason>); please confirm before relying on this.\"",
}),
```

## Verification Results

### Test Counts

| Stage | Tests | Pass | Fail |
|-------|-------|------|------|
| Pre-Task-1 (baseline) | 33 | 33 | 0 |
| Post-Task-1 (RED) | 38 | 33 | **5** (MUTATE-DIR-1, MUTATE-DIR-2, MUTATE-DIR-3, REG-DEFAULTS-PRESENT, REG-V25-BACKCOMPAT) |
| Post-Task-2 (GREEN) | 38 | **38** | 0 |

### Test Pass Output (post-Task-2)

```
 Test Files  1 passed (1)
      Tests  38 passed (38)
```

### Directive Membership: 11 → 12 Keys

Both `REG-DEFAULTS-PRESENT` (line 48-60) and `REG-V25-BACKCOMPAT` (line 296-308) now assert the 12-key sorted array. The new key inserts alphabetically between `memory-recall-before-uncertainty` and `propose-alternatives`:

```
[
  "cross-agent-routing",
  "derivative-work",
  "discord-format",
  "file-sharing",
  "freshness",
  "long-output-to-file",
  "memory-recall-before-uncertainty",
  "mutate-verify",       ← NEW (Phase 999.22)
  "propose-alternatives",
  "subagent-routing",
  "trusted-operator",
  "verify-file-writes",
]
```

### Locked-Additive Verification (zero removed lines in schema.ts)

```
$ git diff HEAD~2 -- src/config/schema.ts | grep -cE "^-[^-]"
0
```

The schema.ts diff is purely additive — all 11 prior `Object.freeze` entries (lines 118-341) are byte-identical post-edit. The new entry inserts between the closing `}),` of `discord-format` (line 341) and the closing `});` of the record.

### TypeScript Baseline Preserved

| Stage | `error TS` count |
|-------|------------------|
| Pre-edit baseline | 121 |
| Post-Task-2 | 121 |

Zero NEW TS errors. The pre-existing 121 errors are unrelated (other workstreams — out-of-scope per `<deviation_rules>` SCOPE BOUNDARY).

### Canonical-Phrase Pin

```
$ grep -c "Quote the post-mutation evidence" src/config/schema.ts
2
```

The phrase appears twice — once in the comment block at line 362 (the static-grep pin descriptor) and once in the directive text at line 366. This mirrors every other directive's pattern (`Skip all CYA language`, `Do not anchor on training-cutoff knowledge`, `are all in-scope work product` all also appear twice for the same reason: comment pin + text). The MUTATE-DIR-3 test only asserts `.toContain` on the `text` field, which passes.

### Companion-Phrase Presence

| Phrase | Count |
|--------|-------|
| `After any mutation in the current turn` | 1 |
| `Do not say` | 1 |
| `report failure or uncertainty` | 1 |

### Assembler Integration (Phase 94 wiring — unchanged)

```
$ npx vitest run src/manager/__tests__/context-assembler-directives.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

The directive reaches the stable-prefix via the existing Phase 94 wiring (`stableParts.push(sources.systemPromptDirectives)`) without any code change in context-assembler.

### Phase Collision Check (Phase 108 + 999.21)

This plan's commits modified ONLY the 2 in-scope files:

```
$ git show --stat HEAD~1 HEAD | grep "|"
 .../schema-system-prompt-directives.test.ts        | 31 +++++++++++++++++++---
 src/config/schema.ts                                | 28 ++++++++++++++++++++++++++++
```

No incidental changes to `src/manager/` (Phase 108 broker work), `src/mcp/broker/` (Phase 108), or `src/discord/` (Phase 999.21). Collision-free.

## Operational Note

This directive is **fleet-wide** and applies on the **next agent session start**. The `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` record is imported at session-prompt assembly time, so:

- New agent sessions (cold-start or warm-restart) pick it up automatically.
- Existing live sessions inherit it on their next session boot.
- **No daemon restart needed** for the directive itself — it's session-scoped, read at agent boot.

The change ships in the local repo only. Per the Ramy-active deploy hold + `feedback_no_auto_deploy.md` + the explicit operator constraint in this plan ("Wait for me to give deploy order"), production deploy waits for an operator-approved window.

## Deviations from Plan

None — plan executed exactly as written. Two atomic commits (RED then GREEN), zero auto-fixes, zero architectural changes, zero out-of-scope edits. Locked-additive constraint verified.

## Deferred / Out-of-Scope

- **Production deploy** — explicit operator-confirmation gate; not in this plan's scope.
- **Per-agent SOUL.md edits** — fleet-wide directive replaces per-agent injection per brief.
- **Bash/Edit/IPC runtime hooks** — directive is prompt-side only; runtime enforcement is out-of-scope per brief.
- **Additional directive entries** — single focused addition (`mutate-verify`) per brief.
- **clawcode.example.yaml edit** — defaults baked in code; YAML overrides remain optional.

## Self-Check: PASSED

- FOUND: `src/config/schema.ts` (line 360 entry `"mutate-verify": Object.freeze({`)
- FOUND: `src/config/__tests__/schema-system-prompt-directives.test.ts` (line 263 describe `mutate-verify directive (Phase 999.22)`)
- FOUND: commit `fd3aa10` (RED — `git log --oneline | grep -q fd3aa10`)
- FOUND: commit `9486ad5` (GREEN — `git log --oneline | grep -q 9486ad5`)
- FOUND: 38/38 vitest passing on schema-system-prompt-directives.test.ts
- FOUND: 4/4 vitest passing on context-assembler-directives.test.ts
- FOUND: zero removed content lines in `git diff HEAD~2 -- src/config/schema.ts`
- FOUND: TS error count 121 (matches pre-edit baseline; zero new errors)
