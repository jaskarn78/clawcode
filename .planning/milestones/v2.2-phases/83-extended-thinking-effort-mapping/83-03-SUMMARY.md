---
phase: 83-extended-thinking-effort-mapping
plan: 03
subsystem: discord-ui + skills-frontmatter + dispatcher-middleware
tags: [discord-native-choices, ui-01, effort-07, effort-05, skill-md-frontmatter, turn-dispatcher-middleware, try-finally-revert, zero-npm-deps]

# Dependency graph
requires:
  - phase: 83-01
    provides: "effortSchema 7-level set + EffortLevel type + mapEffortToTokens + q.setMaxThinkingTokens wire (handle.setEffort no longer a silent no-op)"
provides:
  - "/clawcode-effort renders a 7-item Discord native dropdown (StringChoices) — no free-text typing possible (UI-01)"
  - "/clawcode-status daemon-side short-circuit returns authoritative effort level pulled from sessionManager.getEffortForAgent (EFFORT-07)"
  - "SKILL.md `effort:` YAML frontmatter parsed by scanner → SkillEntry.effort (EFFORT-05 native-format parity)"
  - "TurnDispatcher.dispatch / dispatchStream gain optional skillEffort override with try/finally revert at turn boundary"
  - "SlashCommandHandler accepts optional skillsCatalog; slash-command path applies + reverts per-skill effort around streamFromAgent"
  - "slashCommandOptionSchema extended with optional choices array (capped at 25 entries per Discord API, 1..100 char bounds)"
  - "EFFORT_CHOICES tuple exported from src/discord/slash-types.ts — canonical display/value pairs reusable in schema validation + REST registration"
affects: [phase-86-model-picker, phase-87-native-cc-slash-commands, phase-84-skills-migration]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — all v2.2 parity work on existing stack
  patterns:
    - "Conditional-spread forward: `...(opt.choices && opt.choices.length > 0 ? { choices: [...] } : {})` in REST body build — keeps non-choice options byte-identical to pre-Phase-83 payloads"
    - "Optional readonly field on SkillEntry extended via module-import of EffortLevel — no circular dep (schema doesn't import skills types)"
    - "Snapshot-at-dispatch-time for prior-effort revert — captures LIVE state not constructor-time state, so /clawcode-effort between turns propagates correctly"
    - "Try/finally revert in both dispatcher AND slash-command path — every turn-boundary path guarantees revert regardless of success/error"
    - "Log-and-swallow on setEffort apply/revert failure — a transient SDK failure never propagates past the turn boundary as a hidden exception"

key-files:
  created:
    - src/discord/__tests__/slash-types-effort-choices.test.ts
    - src/discord/__tests__/slash-commands-status-effort.test.ts
    - src/skills/__tests__/scanner-effort-frontmatter.test.ts
    - src/manager/__tests__/turn-dispatcher-skill-effort.test.ts
  modified:
    - src/discord/slash-types.ts
    - src/config/schema.ts
    - src/discord/slash-commands.ts
    - src/skills/types.ts
    - src/skills/scanner.ts
    - src/manager/turn-dispatcher.ts
    - src/manager/daemon.ts

key-decisions:
  - "Path A for EFFORT-07: daemon-side short-circuit for /clawcode-status (not agent-self-reported). Authoritative, cheap, always available — even when the agent is hung mid-turn. Trade-off: the concise server-side block (agent, model, effort) replaces the rich agent-authored status block; a future `/clawcode-status-detail` can restore that if needed."
  - "Invalid `effort:` YAML values in SKILL.md are silently dropped (extractEffortFrontmatter returns null). A broken frontmatter field must NOT crash daemon boot — the skill simply gets no override treatment."
  - "Snapshot-at-dispatch-time for prior-effort. Live /clawcode-effort between turns means the revert target must be read at the moment of each dispatch, not cached earlier. Pinned by a dedicated test (`captures the prior effort AT the moment of dispatch (not at dispatcher construction)`)."
  - "Both TurnDispatcher AND the direct slash-command path honor the try/finally revert contract. Dispatcher owns its pre/post wrap via applySkillEffort/restoreEffort private helpers; slash-commands.ts wraps streamFromAgent inline because that path doesn't go through TurnDispatcher (only /clawcode-steer uses TurnDispatcher from the slash-commands surface)."
  - "EFFORT_CHOICES tuple positioned at tail of slash-types.ts export surface rather than co-located in slash-commands.ts — keeps the canonical list near the SlashCommandOption type that consumes it, and lets test files import it without pulling in the full SlashCommandHandler."

patterns-established:
  - "Daemon-side /clawcode-status short-circuit pattern: mirror the /clawcode-effort direct-handler at slash-commands.ts, pull authoritative runtime values from sessionManager + resolvedAgents, reply without consuming an LLM turn. Blueprint for Phase 86 (/clawcode-status extension with model) and Phase 87 (native CC command routing)."
  - "Skills-catalog-driven per-turn overrides: catalog entry field → optional Dispatch option → pre/post SDK mutation in finally. The same shape will apply to Phase 86's per-skill model override (setModel) and Phase 87's per-skill permission mode (setPermissionMode)."

requirements-completed: [EFFORT-05, EFFORT-07, UI-01]

# Metrics
duration: 17min 22s
completed: 2026-04-21
---

# Phase 83 Plan 03: UI-01 Choices + /clawcode-status Effort Line + Per-Skill Frontmatter Override Summary

**`/clawcode-effort` now renders a 7-item native Discord dropdown, `/clawcode-status` surfaces the live effort level, and SKILL.md `effort:` frontmatter transparently overrides an agent's effort for the duration of the turn — with bulletproof try/finally revert even when the SDK explodes.**

## Performance

- **Duration:** 17 min 22s
- **Started:** 2026-04-21T17:36:35Z
- **Completed:** 2026-04-21T17:53:57Z
- **Tasks:** 2 (TDD: RED→GREEN per task)
- **Files created:** 4 (all tests)
- **Files modified:** 7 (3 types/schema + 3 logic + 1 daemon wire)

## Accomplishments

### UI-01 — native Discord StringChoices on `/clawcode-effort` (no more free-text)

`/clawcode-effort` now carries a 7-entry `choices` tuple on its `level` option. Discord renders a dropdown; users CANNOT type `turbo-mode` or `aggressive` or any non-schema level. Registration body forwards the field conditionally so every other option (memory/model/agent name) stays byte-identical to the pre-Phase-83 payload.

### EFFORT-07 — `/clawcode-status` exposes current effort authoritatively

`/clawcode-status` is now a daemon-side short-circuit: no LLM turn consumed, no prompt routed. The reply is:

```
📋 <agent>
🤖 Model: <model>
🎚️ Effort: <level>
```

Pulled directly from `sessionManager.getEffortForAgent(name)` (which reads the live handle's `getEffort()`) and `resolvedAgents[].model`. Authoritative even when the agent is stuck mid-turn.

### EFFORT-05 — SKILL.md `effort:` frontmatter parity

A skill can now ship with:

```yaml
---
name: deep-research
version: 1.0.0
effort: max
---
# Deep Research Skill
```

When the skill is invoked via its slash command, the dispatcher:
1. Snapshots the current effort via `getEffortForAgent`.
2. Calls `setEffortForAgent(agent, "max")` — which fires `q.setMaxThinkingTokens(32768)` via the Plan-01-wired SDK path.
3. Runs the turn.
4. In a **finally** block, calls `setEffortForAgent(agent, <priorLevel>)` — runs on success AND error, so one runaway turn can't strand the agent at max effort.

Zero side effects on non-skill paths (no catalog entry = no setEffort calls).

## Task Commits

Each task committed atomically using `--no-verify` per parallel-execution protocol:

1. **Task 1 RED:** `d0912b8` — `test(83-03): add failing tests for UI-01 choices + EFFORT-07 status line`
2. **Task 1 GREEN:** `f18e901` — `feat(83-03): UI-01 StringChoices for /clawcode-effort + EFFORT-07 status line`
3. **Task 2 RED:** `ab8bc1f` — `test(83-03): add failing tests for SKILL.md effort frontmatter + dispatcher pre/post wrap`
4. **Task 2 GREEN:** `e4cccbb` — `feat(83-03): SKILL.md effort frontmatter + turn-dispatcher per-skill override`

## The Fix — Verbatim Blocks

### `EFFORT_CHOICES` tuple (src/discord/slash-types.ts)

```typescript
/** Phase 83 UI-01 — canonical EffortLevel picker for `/clawcode-effort`. */
export const EFFORT_CHOICES = [
  { name: "low (fastest)",        value: "low"    },
  { name: "medium",               value: "medium" },
  { name: "high",                 value: "high"   },
  { name: "xhigh",                value: "xhigh"  },
  { name: "max (deepest)",        value: "max"    },
  { name: "auto (model default)", value: "auto"   },
  { name: "off (disabled)",       value: "off"    },
] as const;
```

### `slashCommandOptionSchema` diff (src/config/schema.ts)

```typescript
export const slashCommandOptionSchema = z.object({
  name: z.string().min(1),
  type: z.number().int().min(1).max(11),
  description: z.string().min(1),
  required: z.boolean().default(false),
  // Phase 83 UI-01 — optional structured choices for STRING options (type 3).
  // When present, Discord renders a dropdown instead of a free-text input.
  // Capped at 25 entries per Discord API; each name/value must be 1..100 chars.
  // Optional + backward-compatible: pre-existing YAML configs parse unchanged.
  choices: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        value: z.string().min(1).max(100),
      }),
    )
    .max(25)
    .optional(),
});
```

### `/clawcode-status` short-circuit (src/discord/slash-commands.ts)

```typescript
if (commandName === "clawcode-status") {
  try {
    const effort = this.sessionManager.getEffortForAgent(agentName);
    const model =
      this.resolvedAgents.find((a) => a.name === agentName)?.model ??
      "(unknown)";
    await interaction.editReply(
      `📋 ${agentName}\n🤖 Model: ${model}\n🎚️ Effort: ${effort}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    try {
      await interaction.editReply(`Failed to read status: ${msg}`);
    } catch {
      /* expired */
    }
  }
  return;
}
```

### `extractEffortFrontmatter` (src/skills/scanner.ts)

```typescript
export function extractEffortFrontmatter(content: string): EffortLevel | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;
  const effortMatch = frontmatterMatch[1].match(/^effort:\s*(.+)$/m);
  if (!effortMatch) return null;
  const raw = effortMatch[1].trim();
  if (raw.length === 0) return null;
  const parsed = effortSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
```

### Turn-dispatcher pre/post wrap (src/manager/turn-dispatcher.ts)

```typescript
private applySkillEffort(agentName: string, skillEffort: EffortLevel | undefined): EffortLevel | null {
  if (!skillEffort) return null;
  try {
    const prior = this.sessionManager.getEffortForAgent(agentName);
    this.sessionManager.setEffortForAgent(agentName, skillEffort);
    return prior;
  } catch (err) {
    this.log.warn(
      { agent: agentName, skillEffort, error: (err as Error).message },
      "turn-dispatcher: skill-effort apply failed — continuing without override",
    );
    return null;
  }
}

private restoreEffort(agentName: string, priorEffort: EffortLevel | null): void {
  if (priorEffort === null) return;
  try {
    this.sessionManager.setEffortForAgent(agentName, priorEffort);
  } catch (err) {
    this.log.warn(
      { agent: agentName, priorEffort, error: (err as Error).message },
      "turn-dispatcher: skill-effort revert failed — agent may be at wrong level",
    );
  }
}
```

Both `dispatch()` and `dispatchStream()` call `applySkillEffort()` BEFORE the send and `restoreEffort()` in a **finally** block — runs on success AND error paths.

## Test Results — 32 new tests, all GREEN

### `slash-types-effort-choices.test.ts` (8 tests)
| Test | Asserts | Status |
|------|---------|--------|
| EFFORT_CHOICES 7-entry tuple | exact values low→off | PASS |
| EFFORT_CHOICES display names | verbatim match to spec | PASS |
| clawcode-effort.options[0].choices | identical to EFFORT_CHOICES | PASS |
| no OTHER default command has choices | scoped change | PASS |
| schema accepts choices array | `.parse()` succeeds | PASS |
| schema back-compat (no choices) | `.parse()` still succeeds | PASS |
| schema rejects empty name/value | `.parse()` throws | PASS |
| schema rejects >25 entries | Discord cap enforced | PASS |

### `slash-commands-status-effort.test.ts` (5 tests)
| Test | Asserts | Status |
|------|---------|--------|
| REST body forwards choices | `payload.body` carries 7 choices | PASS |
| REST body stays clean for non-choice options | no `choices` field on /clawcode-memory | PASS |
| /clawcode-status replies with 🎚️ Effort: max | editReply content asserted | PASS |
| /clawcode-status includes agent name + model | multi-field check | PASS |
| /clawcode-status error path | graceful "Failed to read status" | PASS |

### `scanner-effort-frontmatter.test.ts` (12 tests)
| Test | Asserts | Status |
|------|---------|--------|
| valid effort field | returns "max" | PASS |
| no effort field | returns null | PASS |
| no frontmatter | returns null | PASS |
| invalid level (Zod guard) | returns null | PASS |
| empty value | returns null | PASS |
| all 7 valid levels | each round-trips | PASS |
| whitespace trimming | handles `"   max   "` | PASS |
| scanSkillsDirectory populates .effort | integration with fs | PASS |
| back-compat: no effort field → undefined | readable as truthy guard | PASS |
| invalid level ignored (not crash) | catalog still populated | PASS |
| mixed fleet | only valid entries get .effort | PASS |

### `turn-dispatcher-skill-effort.test.ts` (7 tests)
| Test | Asserts | Status |
|------|---------|--------|
| happy path pre/post ordering | invocationCallOrder proof | PASS |
| try/finally on send throw | revert still fires | PASS |
| no setEffort when skillEffort omitted | zero side effects | PASS |
| no setEffort when skillEffort is undefined | explicit-undefined parity | PASS |
| dispatchStream honors same contract | stream-path parity | PASS |
| dispatchStream revert on stream throw | error-path parity | PASS |
| snapshot-at-dispatch-time | revert target = LIVE effort | PASS |
| getEffort-before-setEffort ordering | snapshot captured first | PASS |

**32/32 green.** Plus 46 additional tests in the broader touched-file suite (existing slash-types, slash-commands, scanner, turn-dispatcher) all stay GREEN — no regressions.

## Files Created/Modified

### Created (4 tests)
- `src/discord/__tests__/slash-types-effort-choices.test.ts` (147 lines) — 8 tests locking EFFORT_CHOICES + schema
- `src/discord/__tests__/slash-commands-status-effort.test.ts` (283 lines) — 5 tests for REST registration + /clawcode-status
- `src/skills/__tests__/scanner-effort-frontmatter.test.ts` (155 lines) — 12 tests for extractEffortFrontmatter + integration
- `src/manager/__tests__/turn-dispatcher-skill-effort.test.ts` (169 lines) — 8 tests for pre/post wrap contract

### Modified (7 sources)
- `src/discord/slash-types.ts` — EFFORT_CHOICES tuple export, SlashCommandOption.choices field, clawcode-effort option now carries choices
- `src/config/schema.ts` — slashCommandOptionSchema gains optional choices array
- `src/discord/slash-commands.ts` — registration body forwards choices, /clawcode-status short-circuit, skillsCatalog injected, skill-effort apply+revert around streamFromAgent
- `src/skills/types.ts` — SkillEntry gains readonly effort?: EffortLevel
- `src/skills/scanner.ts` — extractEffortFrontmatter helper, scanSkillsDirectory populates entry.effort
- `src/manager/turn-dispatcher.ts` — DispatchOptions.skillEffort, applySkillEffort/restoreEffort private helpers, try/finally wrap in dispatch + dispatchStream
- `src/manager/daemon.ts` — skillsCatalog injected into SlashCommandHandler constructor

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Daemon-side `/clawcode-status` short-circuit (Path A) over prompt-routing (Path B).** The plan explicitly flagged this as a choice; Path A was preferred because EFFORT-07 is a VISIBILITY requirement for a config-derived field, and asking the agent to self-report the value it was just told about is strictly worse than reading the authoritative daemon-side handle state. Cost: the rich agent-authored status block (tokens/context-fill/compactions) is displaced; a future `/clawcode-status-detail` can restore it.
2. **Silent drop on invalid SKILL.md effort.** A broken `effort: turbo-mode` field returns `null` from `extractEffortFrontmatter`. No thrown error, no warning logged, no catalog entry skipped — just no override applied. This trades operator-visibility for boot-safety: one bad SKILL.md must never crash daemon startup across 14 agents.
3. **Snapshot-at-dispatch-time for prior-effort revert.** A dedicated test pins this: after `setEffortForAgent(agent, "medium")` between turns, a skill override followed by revert must target `"medium"` (live), not the constructor-time `"low"`. This is load-bearing for cases where an operator bumps an agent's effort via `/clawcode-effort` while a skill-override turn is queued.
4. **Try/finally in BOTH the dispatcher AND the slash-command direct-dispatch path.** The slash-command handler calls `sessionManager.streamFromAgent` directly (not via TurnDispatcher) for the normal dispatch path — so the revert must be duplicated there. Keeping the wrap close to the actual SDK call site means a future refactor of one path doesn't silently strand the other.
5. **SlashCommandHandler's skillsCatalog is optional.** Existing tests + legacy wiring don't inject one → zero side effects. Production daemon.ts DOES inject it. This mirrors the pattern for `turnDispatcher` (quick task 260419-nic) — optional injection = composable surface.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] RoutingTable type mismatch in test fixtures**
- **Found during:** Task 1 GREEN verification
- **Issue:** My test built the `RoutingTable` as `new Map([["chan-1", "clawdy"]])`, but the actual type is `{ channelToAgent: Map, agentToChannels: Map }`. The SlashCommandHandler's `getAgentForChannel` reached into `.channelToAgent.get(channelId)` and crashed with `Cannot read properties of undefined (reading 'get')`.
- **Fix:** Changed fixture to `{ channelToAgent: new Map([["chan-1", "clawdy"]]), agentToChannels: new Map([["clawdy", ["chan-1"]]]) }`.
- **Committed in:** Task 1 GREEN commit (`f18e901`).

**2. [Rule 3 - Blocking] vi.fn() + mock.calls[0] type narrowing**
- **Found during:** Task 1 GREEN verification (TS typecheck pass)
- **Issue:** `putSpy.mock.calls[0]` returned tuple `[]` because the initial spy was typed as `vi.fn(async () => undefined)` (0-arg). TypeScript refused `callArgs[1]` indexing.
- **Fix:** Typed the spy explicitly: `vi.fn(async (_route: unknown, _opts: { body: unknown }): Promise<unknown> => undefined)`. Also replaced `as { body: ... }` with `as unknown as [unknown, { body: ... }]` on the tuple unpacking for cleaner narrowing.
- **Committed in:** Task 1 GREEN commit (`f18e901`).

---

**Total deviations:** 2 auto-fixed (both Rule 3 blocking — test-only type mismatches, zero production impact). Plan scope unchanged.

## Issues Encountered

- **Plan 83-02 running in parallel (Wave 2).** Detected during GREEN verification when `git status` showed modifications to `src/manager/effort-state-store.ts`, `src/manager/session-manager.ts`, and `src/manager/__tests__/fork-effort-quarantine.test.ts` — all files owned by Plan 02. Per the parallel execution ownership split, I excluded those files from every commit and stuck to my own surface. No file-level collision occurred.
- **Pre-existing TypeScript errors (30 total).** All inherited from pre-Plan-83 state: `src/config/loader.ts:171` (effort-type widening leftover from Plan 01), `src/manager/daemon.ts` (3 errors: ImageProvider import, scheduler handler shape, CostByAgentModel conversion), `src/tasks/task-manager.ts` (4 errors: causationId missing), `src/usage/*` (5 errors: tuple indexing + comparison), etc. Verified NONE are caused by Plan 83-03 changes — `git stash` + `npx tsc --noEmit` against pre-plan tree reproduces every error.
- **`shared-workspace.integration.test.ts` has 2-3 flaky failures.** Pre-existing (verified via `git stash`). Unrelated to effort code. Not in scope.

## Known Stubs

None. Every code path is wired:

- `EFFORT_CHOICES` has a real value for every level (not a TODO).
- `/clawcode-status` short-circuit returns a fully-populated message body.
- `extractEffortFrontmatter` returns a real `EffortLevel` or `null`; no "not implemented" path.
- `applySkillEffort` + `restoreEffort` call `setEffortForAgent` which — thanks to Plan 01 — wires through to `q.setMaxThinkingTokens`.
- The slash-command side wires skillsCatalog via daemon.ts injection.

## Next Phase Readiness

- **Phase 86 (setModel + /clawcode-model) is unblocked.** The `/clawcode-status` daemon-side short-circuit pattern is the blueprint for rendering `🤖 Model:` with the live SDK-reported model. Same goes for the choices pattern — Phase 86's model picker will use `MODEL_CHOICES` with {sonnet, opus, haiku} and the same REST forwarding. The per-skill override pattern (`skillEntry.effort`) transplants directly to `skillEntry.model` once SkillEntry gains a model field.
- **Phase 87 (native CC slash commands) has a routing template.** The daemon-side short-circuit (clawcode-status) + prompt-route (everything else) split is the shape Phase 87 will use for `/clawcode-model`, `/clawcode-permissions`, etc. — daemon handles whatever it can answer authoritatively, falls through to agent prompt routing otherwise.
- **Zero new npm deps.** All work ran on existing stack (SDK 0.2.97, Zod 4.3.6, discord.js 14.26.2, vitest 4.1.3). Consistent with the v2.2 milestone invariant.

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/discord/__tests__/slash-types-effort-choices.test.ts`
- FOUND: `src/discord/__tests__/slash-commands-status-effort.test.ts`
- FOUND: `src/skills/__tests__/scanner-effort-frontmatter.test.ts`
- FOUND: `src/manager/__tests__/turn-dispatcher-skill-effort.test.ts`
- FOUND: commit `d0912b8` (Task 1 RED)
- FOUND: commit `f18e901` (Task 1 GREEN)
- FOUND: commit `ab8bc1f` (Task 2 RED)
- FOUND: commit `e4cccbb` (Task 2 GREEN)
- FOUND: `EFFORT_CHOICES` (2 refs) in `src/discord/slash-types.ts`
- FOUND: `choices` (4 refs) in `src/discord/slash-types.ts`
- FOUND: `choices` (2 refs) in `src/config/schema.ts`
- FOUND: `choices` (4 refs) in `src/discord/slash-commands.ts`
- FOUND: `🎚️ Effort` (1 ref) in `src/discord/slash-commands.ts`
- FOUND: `getEffortForAgent` (1 ref) in `src/discord/slash-commands.ts`
- FOUND: `extractEffortFrontmatter` (2 refs) in `src/skills/scanner.ts`
- FOUND: `effort` (4 refs) in `src/skills/types.ts`
- FOUND: `skillEffort|setEffort` (13 refs) in `src/manager/turn-dispatcher.ts`
- All 32 Plan-83-03 tests GREEN (8 + 5 + 12 + 7); 78 broader-suite tests unchanged GREEN

---
*Phase: 83-extended-thinking-effort-mapping*
*Completed: 2026-04-21*
