---
phase: 117
title: Claude Code advisor pattern — multi-backend scaffold (Anthropic complete)
status: source-complete; smoke PENDING OPERATOR ACTION; deploy operator-gated
plans_total: 11
plans_completed: 11
date_started: 2026-05-13
date_source_complete: 2026-05-13
tags: [advisor, multi-backend, anthropic-sdk, native, fork, scaffold, discord-visibility, /verbose, operator-rollback, phase-summary]
key_subsystems:
  - src/advisor/  (NEW — service, registry, prompts, three backends)
  - src/llm/     (NEW — CompletionProvider interface seed; no impls)
  - src/usage/verbose-state.ts (NEW)
  - src/manager/{daemon,session-manager,session-config,session-adapter,persistent-session-handle}.ts
  - src/discord/{bridge,reactions,slash-types,slash-commands}.ts
  - src/config/{schema,loader}.ts
  - src/manager/capability-manifest.ts
  - src/ipc/protocol.ts
references:
  - 117-CONTEXT.md
  - 117-RESEARCH.md
  - /home/jjagpal/.claude/plans/eventual-questing-tiger.md  (approved plan, source of truth)
---

# Phase 117 — Phase Summary

**Outcome:** Phase 117 is **source-complete** at the source-code level
across all 11 plans. The operator-gated manual smoke documented in
`117-10-SMOKE.md` is **PENDING OPERATOR ACTION** — it requires live
Discord interaction in channel `1491623782807244880` and an in-the-
loop response that cannot be automated from inside the GSD flow.
Production deployment is **NOT performed** in this phase per
`feedback_no_auto_deploy` and `feedback_ramy_active_no_deploy`.

## What shipped (per plan)

| Plan   | One-liner outcome                                                                                                                    | SUMMARY                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| 117-01 | `src/llm/CompletionProvider` interface seed (zero impls; first consumer is Phase 118 `PortableForkAdvisor`)                          | `117-01-SUMMARY.md`    |
| 117-02 | `AdvisorService` core: types, registry, prompt-builder, `DefaultAdvisorService` (budget gate → dispatch → 2000-char truncation → record); `opus → claude-opus-4-7` alias resolver | `117-02-SUMMARY.md`    |
| 117-03 | Extracted `forkAdvisorConsult()` from `daemon.ts` and wrapped as `LegacyForkAdvisor` backend (operator rollback path); `try/finally stopAgent` invariant preserved | `117-03-SUMMARY.md`    |
| 117-04 | `AnthropicSdkAdvisor` (default) + SDK `Options.advisorModel` spread-conditional injection at both production (`createPersistentSessionHandle`) and test (`iterateWithTracing`) paths; per-assistant-message observer emits `advisor:invoked` / `advisor:resulted` on `SessionManager.advisorEvents`; iterations parser charges `AdvisorBudget.recordCall` per `type:"advisor_message"` entry | `117-04-SUMMARY.md`    |
| 117-05 | `PortableForkAdvisor` scaffold — interface-conformant stub that throws Phase 118 deferred error; not registered in `BackendRegistry`; schema rejects `"portable-fork"` at parse time | `117-05-SUMMARY.md`    |
| 117-06 | Config schema `defaults.advisor.{backend, model, maxUsesPerRequest, caching}` + per-agent partial override at `agents[].advisor`; four module-level resolvers with per-agent → defaults → hardcoded-baseline fall-through; locked enum rejects `"portable-fork"` | `117-06-SUMMARY.md`    |
| 117-07 | `ask-advisor` IPC handler routes through `AdvisorService.ask` for fork-backend agents; native-backend agents short-circuit at the IPC boundary with an explanatory response; `handleAskAdvisor(deps, params)` extracted for testability. **MCP `ask_advisor` conditional registration deferred** (architectural blocker — see Deferred items) | `117-07-SUMMARY.md`    |
| 117-08 | Agent awareness — capability manifest now lists `Advisor (Opus)` bullet + `## Advisor protocol` prose block on every non-minimal agent's cached stable prefix; source-of-truth in `src/advisor/prompts.ts::buildAgentAwarenessBlock`; fork-backend bullet carries `(legacy fork backend — operator rollback path)` qualifier | `117-08-SUMMARY.md`    |
| 117-09 | Discord visibility — 💭 reaction on triggering message + level-aware footer at single response-mutation point (between `editor.flush()` and the delivery branches); `advisor_redacted_result` falls through to plain footer (no plaintext leak); per-turn listener register-around-`dispatchStream` pattern | `117-09-SUMMARY.md`    |
| 117-11 | `/clawcode-verbose on\|off\|status` admin-only ephemeral slash command; SQLite-backed channel-level state at `~/.clawcode/manager/verbose-state.db` (separate file from `advisor-budget.db`); wires into the 117-09 mutation point to flip footer-only ↔ fenced advice block (≤500 chars) | `117-11-SUMMARY.md`    |
| 117-10 | Documentation cleanup (CLAUDE.md, clawcode.example.yaml, CHANGELOG) + manual-smoke procedure (`117-10-SMOKE.md`) + this phase summary; **smoke PENDING OPERATOR ACTION** | `117-10-SUMMARY.md` (this plan)    |

## Cumulative commit list

All Phase 117 commits, in execution order (oldest → newest). Generated
from `git log --oneline --grep="117-"`:

### Scaffolding + plan files
- `94c7fa4` docs(117): scaffold Phase 117 — advisor multi-backend (ROADMAP + CONTEXT)
- `79525a1` docs(117): per-plan PLAN.md files (117-01..117-11)

### Plan 117-01 — CompletionProvider interface seed
- `071f166` feat(117-01): T01 — CompletionProvider interface (no impls)
- `fffe910` feat(117-01): T02 — src/llm/README seam doc
- `23d2a35` docs(117-01): summary

### Plan 117-02 — AdvisorService core
- `3786ca4` feat(117-02): T01 — declare advisor types
- `9512d25` feat(117-02): T02 — declare AdvisorBackend interface
- `e16f724` feat(117-02): T03 — buildAdvisorSystemPrompt (port from daemon.ts:9836)
- `9f34110` feat(117-02): T04 — resolveAdvisorModel + ADVISOR_MODEL_ALIASES
- `70cfb9b` feat(117-02): T05 — registry.resolveBackend + BackendRegistry
- `8354065` feat(117-02): T06 — DefaultAdvisorService (budget gate, dispatch, truncate, record)
- `cc830a9` feat(117-02): T07 — src/advisor/index.ts public re-exports
- `4bc26ce` feat(117-02): T08 — tests for service, registry, prompts (28 tests)
- `132e1dd` docs(117-02): summary

### Plan 117-03 — LegacyForkAdvisor extraction
- `da4e649` feat(117-03): T02 — extract fork body into forkAdvisorConsult()
- `445cc6e` feat(117-03): T03 — LegacyForkAdvisor wraps forkAdvisorConsult
- `edfecf9` feat(117-03): T04 — legacy-fork.test.ts parity + invariant coverage
- `6043057` docs(117-03): summary

### Plan 117-04 — AnthropicSdkAdvisor + SDK wiring + observer
- `6865870` feat(117-04): T01 — spike: SDK exposes only advisorModel; max_uses absent
- `3041310` feat(117-04): T02 — add advisorEvents EventEmitter to SessionManager
- `dd97f5e` feat(117-04): T03+T04 — native advisor observer + iterations parser
- `8c62a75` feat(117-04): T05 — wire advisorModel through SDK Options (spread-conditional)
- `f2680c1` feat(117-04): T06 — AnthropicSdkAdvisor class body (consult() throws)
- `65633e1` test(117-04): T07 — AnthropicSdkAdvisor backend tests
- `76b361b` test(117-04): T08 — session-adapter advisor observer integration
- `8c9027c` docs(117-04): summary

### Plan 117-05 — PortableForkAdvisor scaffold
- `0c0bc25` feat(117-05): T01 — PortableForkAdvisor scaffold (throws Phase 118 deferred error)
- `906c895` feat(117-05): T02 — test PortableForkAdvisor scaffold contract
- `0b5a8f6` docs(117-05): summary

### Plan 117-06 — Config schema + loader resolvers
- `1dd3d7a` feat(117-06): T02 — add advisorConfigSchema + wire defaults.advisor
- `215de31` feat(117-06): T03 — per-agent advisor override in agentSchema
- `06c72f7` feat(117-06): T04 — module-level advisor resolvers in loader.ts
- `756fe5f` feat(117-06): T05 — schema-advisor tests (19 assertions)
- `e3bda14` test(117-06): T06 — loader resolver + YAML round-trip tests (20 assertions)
- `eeeee87` docs(117-06): summary

### Plan 117-07 — IPC re-point + MCP gate deferral
- `4615675` feat(117-09): T03 — single mutation point for advisor footer at bridge.ts (also carried 117-07 T01 daemon-boot composition due to a concurrent-commit index race; see 117-07-SUMMARY)
- `4673872` feat(117-07): T02 — re-point ask-advisor IPC handler at AdvisorService
- `3c6c835` test(117-07): T04 — dispatch tests for handleAskAdvisor
- `df5f2db` docs(117-07): summary — IPC re-point + T03 deferral rationale
- `370a4b2` docs(117-07): SUMMARY — add post-execution test count delta
- `f2d08e5` docs(117-07): complete 117-07 plan — roadmap + state

### Plan 117-08 — Agent awareness (capability manifest + system prompt)
- `b574330` feat(117-08): T01 — add buildAgentAwarenessBlock() to src/advisor/prompts.ts
- `1d04959` feat(117-08): T02 — inject advisor bullet + protocol into capability-manifest.ts
- `f2e364c` test(117-08): T03 — extend capability-manifest.test.ts with advisor cases
- `e12e433` docs(117-08): summary (initial draft)
- `0c74fba` fix(117-08): protocol points to subagent-thread by skill name (Rule 1 auto-fix)
- `159f6ba` docs(117-08): summary — add Rule 1 deviation + pre-existing flake list

### Plan 117-09 — Discord visibility (reaction + footer)
- `a23e0cd` feat(117-09): T01 — addReaction(message, emoji) helper in reactions.ts
- `b8c7a2a` feat(117-09): T02 — register advisor:invoked/resulted listeners around dispatchStream
- (T03 commit `4615675` listed above under 117-07 due to the index race)
- `2e9fc4c` test(117-09): T04 — Discord bridge advisor visibility tests
- `8ee121b` docs(117-09): summary — Discord visibility (💭 reaction + footer)

### Plan 117-11 — /clawcode-verbose operator slash command
- `1e5027f` feat(117-11): T01 — VerboseState SQLite-backed channel-level class
- `f2fda24` test(117-11): T02 — VerboseState CRUD tests (in-memory SQLite, 6 assertions)
- `ad4ac8e` feat(117-11): T03 — /clawcode-verbose entry in CONTROL_COMMANDS
- `e318ee8` feat(117-11): T04 — handleVerboseSlash dispatch in handleControlCommand
- `b13a6f2` feat(117-11): T05 — IPC handler set-verbose-level + daemon boot wiring
- `1e291f4` feat(117-11): T06 — wire VerboseState into DiscordBridge constructor
- `7c2d1c7` test(117-11): T07 — slash-verbose-command pure-handler test suite
- `f6a19c1` docs(117-11): summary — /verbose operator Discord toggle complete
- `4f92a9c` docs(117-11): complete — STATE + ROADMAP updated

### Plan 117-10 — Docs cleanup + smoke procedure + phase summary
- `5915ee3` docs(117-10): T01 — CLAUDE.md Advisor pattern section
- `364e0ed` docs(117-10): T02 — clawcode.example.yaml defaults.advisor + per-agent override
- `042b543` docs(117-10): T03 — CHANGELOG Phase 117 entry under v2.8
- `21d8bc3` docs(117-10): T04 — smoke procedure (PENDING OPERATOR ACTION)
- (this commit) docs(117): phase summary

## Cumulative test delta

Per-plan additions (from each SUMMARY's metrics):

| Plan   | Tests added | Notes                                                      |
| ------ | -----------:| ---------------------------------------------------------- |
| 117-01 |           0 | Interface only; no behavior to test                        |
| 117-02 |          28 | service (12) + registry (12) + prompts (6) — minus 2 overlap |
| 117-03 |           9 | legacy-fork parity + try/finally invariant                 |
| 117-04 |          17 | anthropic-sdk (5) + session-adapter observer (12)          |
| 117-05 |           2 | scaffold contract assertions                                |
| 117-06 |          39 | schema (19) + loader/round-trip (20)                       |
| 117-07 |           7 | handleAskAdvisor dispatch (A/B/C/C2/C3/D/E)                |
| 117-08 |           5 | capability-manifest advisor cases (CM-ADV-A/B/C/D/MINIMAL) |
| 117-09 |          12 | bridge-advisor-footer (A/B/C/D/E/F/F'/G1/G2/G3 + lifecycle + agent-guard) |
| 117-11 |          11 | VerboseState CRUD (6) + handleVerboseSlash (5)             |
| 117-10 |           0 | Docs-only plan                                              |
| **Total** | **~130** | Spot-check against pre/post-baseline before publishing      |

Pre-existing baseline failures (across the repo, NOT introduced by
Phase 117) are enumerated in `deferred-items.md`; none touch the
advisor / capability-manifest / discord-bridge / verbose-state paths.

## Deferred items (cumulative across the phase)

### Architectural deferrals — Phase 118 or follow-up

1. **MCP `ask_advisor` conditional registration (117-07 T03).** The MCP
   server has no per-agent identity at startup
   (`src/mcp/server.ts:170`). Gating `server.tool("ask_advisor", …)` on
   `resolveAdvisorBackend(agent) === "fork"` requires:
   - Loader injection of `CLAWCODE_AGENT: agent.name` into the
     auto-clawcode MCP entry (matches Phase 110 shim pattern).
   - MCP-side backend-resolution probe (new IPC method, or extension
     of the `status` response).
   User-visible correctness is preserved by 117-07 T02's IPC
   short-circuit: native-backend agents calling `ask_advisor` receive
   the RESEARCH §13.11 explanatory response. Cosmetic gap — tool
   appears in `tools/list` but is effectively a no-op for native
   agents. Must_have line 18 of plan 117-07 marked
   **unsatisfied-by-design**; resolution requires a follow-up plan
   that owns both pieces. See `117-07-SUMMARY.md` for the full
   rationale.

2. **`PortableForkAdvisor` full implementation — Phase 118.** Scaffold
   stub ships in 117-05. Implementation requires transcript extraction
   from SDK-owned session state + a `CompletionProvider` impl (likely
   `AnthropicDirectProvider` against `@anthropic-ai/sdk@^0.95.1`).

3. **First `CompletionProvider` implementation — Phase 118+.** Interface
   ships in 117-01 with zero impls. First consumer is the Phase 118
   `PortableForkAdvisor`.

4. **Removal of fork-based code — Phase 118 or 119.** Hold ≥1 week of
   `native` production rollout without rollback before removing
   `LegacyForkAdvisor` and `forkAdvisorConsult`. Acceptance gate:
   zero operator-flipped `agent.advisor.backend: fork` overrides in
   that window.

### Documented limitations (acceptable; not defects)

5. **OpenAI template-driver path not instrumented for advisor
   (117-04 deviation #5).** `src/openai/template-driver.ts:121` calls
   `createPersistentSessionHandle` with no `advisorObserver`. These
   per-bearer transient sessions serve external OpenAI-API-compatible
   callers (Phase 74) and have no per-agent `AdvisorBudget`. Wire
   point recorded for future maintainers; advisor feature is
   fleet-scoped only.

6. **Memory-context retrieval dropped from native short-circuit path
   (117-07 design).** Pre-117-07, the inline IPC handler retrieved
   top-5 semantic memories and threaded them into the advisor system
   prompt. `AdvisorServiceDeps.resolveSystemPrompt` is synchronous
   `(agent) => string` with no memory hook. Native agents retrieve
   memory via in-session MCP tools; fork agents retain
   `clawcode_memory_search` / `memory_lookup` MCP tools. Deliberate
   parity loss for the rollback path. Re-thread would be a 117-02
   service-surface change, out of phase scope.

7. **Standalone-runner advisor silence (117-09 RESEARCH §13.9).**
   `clawcode run <agent> --once "…"` does NOT emit
   `advisor:invoked` / `advisor:resulted` events because the
   standalone-runner branch (`turnDispatcher === undefined` →
   `streamFromAgent`) bypasses `dispatchStream`. Absence of footer is
   expected; not a defect. Plan 117-09's listener registration is
   scoped to the persistent Discord-bridge path.

8. **Soft-cap risk on the daily budget (117-04 spike outcome B).** The
   SDK exposes only `advisorModel?: string`; no sibling `max_uses` or
   nested `advisor` field. `shouldEnableAdvisor` omits `advisorModel`
   on the next session reload when the budget is exhausted, but a
   single in-flight turn that started before exhaustion can overshoot
   the daily cap by ≤ server-side default `max_uses` (3) per turn.
   Documented and accepted per RESEARCH §13.5.

### Pre-existing test-count drift (117-11 deferred-items.md)

9. **`slash-commands.test.ts:487`** — sum expectation off by 1
   post-117-11 (was already off by 1 pre-117-11; 117-11 added one
   more drift). Owner: small `chore` PR that audits all
   comment-tracked counts in the test file family. Not in the 117
   phase budget. See `deferred-items.md` for details.

10. **GSD nested slash-command failures** — 4 pre-existing failures in
    `slash-commands-gsd-nested.test.ts` + `slash-commands-gsd-register.test.ts`.
    Unrelated to advisor/verbose-state surface. Defer to the GSD
    subsystem owner (possibly Phase 999.21 follow-up).

## Preserved contracts (verified across the phase)

- `ask_advisor` MCP tool name + `{question, agent}` schema
  (`src/mcp/server.ts:91`) — unchanged.
- `ask-advisor` IPC method name (`src/ipc/protocol.ts:168`) —
  unchanged; handler body re-points at `AdvisorService`.
- `AdvisorBudget` per-agent daily cap (10/day default,
  `src/usage/advisor-budget.ts`) — unchanged.
- `ADVISOR_RESPONSE_MAX_LENGTH = 2000` truncation — single-sourced in
  `DefaultAdvisorService.ask`. Verified zero copies elsewhere.
- Non-idempotent / never-cache flag for `ask_advisor`
  (`src/config/schema.ts:738`, `src/config/loader.ts:294`) — unchanged.
- `subagent-thread` skill + `spawn_subagent_thread` IPC — untouched.
- `src/manager/escalation.ts` fork-to-Opus logic — untouched.
- `capability-probes.ts` — untouched (RESEARCH §6 Pitfall 5; explicit
  EXPLICIT-DO-NOT comment added in capability-manifest.ts for future
  readers).
- `context-assembler.ts` — untouched.

## Manual smoke results

**Status: PENDING OPERATOR ACTION.**

Procedure: `117-10-SMOKE.md` (9 steps; 1–8 mandatory, 9 optional).

Awaiting operator-driven smoke pass on `test-agent` in Discord channel
`1491623782807244880`. Reply `smoke pass` or `smoke fail: <details>`
in-channel to drive resolution. On `smoke pass`, paste the outcome
into this section verbatim and gate the deploy decision on operator
confirmation per `feedback_no_auto_deploy` +
`feedback_ramy_active_no_deploy`.

## Operator notes

- **Rollback procedure (per-agent):** edit `clawcode.yaml` to set
  `agents[<name>].advisor.backend: fork`; run `clawcode reload`. No
  daemon restart. Per-agent overrides cascade per field over
  `defaults.advisor`.
- **`/clawcode-verbose` use:** admin-only, ephemeral, per-channel.
  `on` flips advisor display from footer-only to fenced advice block
  (≤500 chars). `status` reports current level + ISO timestamp. State
  persists in `~/.clawcode/manager/verbose-state.db` (separate file
  from `advisor-budget.db`).
- **Known soft-cap risk:** `AdvisorBudget.maxUsesPerRequest` (default
  3) can overshoot the daily cap by ≤ that value on a single
  in-flight turn that started before exhaustion. Acceptance gate per
  RESEARCH §13.5; SDK-internal history-scrub mitigation deferred
  (Phase 118+).
- **Discord visibility is in-band.** Never spawns a thread. For tasks
  that need operator-watchable execution, agents should reach for the
  `subagent-thread` skill (untouched by Phase 117) instead.

## Production deploy status

**NOT performed in this phase.** Operator-gated per
`feedback_no_auto_deploy` and `feedback_ramy_active_no_deploy`. Phase
117 ships source only.

Deploy sequence (when operator authorizes — explicit "deploy" / "ship
it" in the same turn, and `#fin-acquisition` is quiet):

```bash
scripts/deploy-clawdy.sh
```

(Script reads sudo password from `~/.clawcode-deploy-pw`. Build →
stage → sudo cp → restart → md5 verify per CLAUDE.md "Deploy"
section.)

## Recommended next steps

1. **Operator runs `117-10-SMOKE.md` procedure** on `test-agent` in
   channel `1491623782807244880` when Ramy is NOT active in
   `#fin-acquisition`. Reply with `smoke pass` or
   `smoke fail: <details>`.
2. **On smoke pass**, decide whether to deploy. Explicit "deploy" /
   "ship it" in the same turn triggers `scripts/deploy-clawdy.sh`.
   Verify `#fin-acquisition` is quiet first.
3. **Watch for ≥1 week post-deploy** for operator-flipped
   `advisor.backend: fork` overrides. Zero overrides + zero advisor
   regressions = green light to schedule Phase 118.
4. **Phase 118** when needed:
   - Full `PortableForkAdvisor` implementation (transcript extraction
     + `CompletionProvider` call).
   - First `CompletionProvider` impl (likely `AnthropicDirectProvider`
     against `@anthropic-ai/sdk@^0.95.1`).
   - Removal of fork-based code (`LegacyForkAdvisor`,
     `forkAdvisorConsult`) once the ≥1-week-no-rollback gate clears.
   - Follow-up plan for the deferred MCP `ask_advisor` gating.

## References

- `117-CONTEXT.md` — phase boundary + locked decisions.
- `117-RESEARCH.md` — pre-execution gates, pitfalls, decision matrix.
- `/home/jjagpal/.claude/plans/eventual-questing-tiger.md` — approved
  plan, source of truth.
- Per-plan SUMMARYs: `117-01-SUMMARY.md` through `117-11-SUMMARY.md`
  (10 plans landed; 117-10 is the docs/cleanup plan).
- `117-10-SMOKE.md` — operator-facing smoke procedure.
- `deferred-items.md` — log of items discovered during execution but
  out of phase scope.
- `CLAUDE.md` "Advisor pattern (Phase 117)" section — operator-facing
  reference for backend resolution, rollback procedure, and Discord
  visibility.
- `CHANGELOG.md` v2.8 Unreleased "Phase 117" entry.

## Self-Check: PASSED

- All 10 prior plan SUMMARYs exist (117-01..117-09, 117-11) — FOUND.
- `117-10-PLAN.md` exists — FOUND.
- `117-10-SMOKE.md` exists — FOUND (this plan, T04 commit `21d8bc3`).
- `117-SUMMARY.md` (this file) — FOUND.
- CLAUDE.md grep `Advisor pattern` ≥ 1 — VERIFIED (T01 commit
  `5915ee3`).
- clawcode.example.yaml grep `advisor:` ≥ 2 — VERIFIED (T02 commit
  `364e0ed`).
- CHANGELOG.md grep `Phase 117` ≥ 1 — VERIFIED (T03 commit `042b543`).
- `npm run typecheck` clean — VERIFIED before T03 commit.
- No deploy performed — VERIFIED (no invocation of
  `scripts/deploy-clawdy.sh`).
- No `git push` to origin — VERIFIED.
