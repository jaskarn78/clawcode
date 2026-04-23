---
phase: 87-native-cc-slash-commands
plan: 01
subsystem: sdk-discovery+discord-registration
tags: [claude-agent-sdk, initializationResult, supportedCommands, native-cc, slash-commands, acl, discord-registration, regression-pin, pitfall-10, pitfall-12]

# Dependency graph
requires:
  - phase: 86-dual-discord-model-picker-core
    provides: "SessionHandle method-extension pattern + fire-and-forget SDK wire + Rule-3 mock cascade precedent (3 openai/__tests__ FakeQuery / SessionHandle mocks updated same commit)"
  - phase: 85-mcp-tool-awareness
    provides: "CONTROL_COMMANDS inline-handler pattern carved-before-dispatch used by Plan 02/03 for native-dispatch paths; per-handle mirror pattern for SessionManager-owned maps"
  - phase: 83-extended-thinking-effort-mapping
    provides: "Spy-based SDK regression pin blueprint; additive schema pattern; per-handle cache pattern (effort-state)"
  - research: CMD-SDK-SPIKE
    provides: "Authoritative SDK 0.2.97 surface — Query.initializationResult (sdk.d.ts:1748), Query.supportedCommands (sdk.d.ts:1754), SlashCommand shape (sdk.d.ts:4239), dispatch classification table"
provides:
  - "SdkQuery type extended with initializationResult() + supportedCommands() mirroring sdk.d.ts:1748/1754"
  - "Local SlashCommand type projection in sdk-types.ts for downstream consumers"
  - "SessionHandle.getSupportedCommands on persistent + legacy + mock handles (cached once via q.initializationResult; SDK-failure leaves cache null so the next call retries)"
  - "native-cc-commands.ts — PURE classifier module (control-plane | prompt-channel | skip) + buildNativeCommandDefs + mergeAndDedupe (no imports from session-manager or daemon; Plan 02/03 ready)"
  - "SlashCommandDef extended with optional nativeBehavior: 'control-plane' | 'prompt-channel' discriminator"
  - "DEFAULT_SLASH_COMMANDS minus clawcode-compact + clawcode-usage (CMD-04 removal regression-pinned)"
  - "SlashCommandHandler.register() dynamically iterates SessionHandle.getSupportedCommands per-agent, ACL-filters, merges via mergeAndDedupe, asserts ≤ 90 per guild (CMD-07)"
  - "SlashCommandHandler.aclDeniedByAgent DI hook for tests; production derives <memoryPath>/SECURITY.md via resolveDeniedCommands"
  - "acl-parser.ts extended with resolveCommandAcl + resolveDeniedCommands for the `## Command ACLs` section (CMD-05)"
  - "SessionManager.getSessionHandle public accessor — per-agent handle exposed for SlashCommandHandler + Plan 02/03 consumers"
  - "Static-grep regression pin — no hardcoded native-command array literal can re-enter src/ without a red CI"
affects: [phase-87-02-native-dispatch-fork, phase-87-03-tests-docs]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — SDK 0.2.97 surface already installed
  patterns:
    - "Per-handle cache for expensive SDK enumeration — populated once, null-on-failure so next call retries (mirror of Phase 83 effort-state and Phase 85 mcp-state)"
    - "Static-grep regression pin via readdirSync + readFileSync walking src/ (exclude __tests__/) — makes architectural invariants (no hardcoded list) enforceable in unit tests without custom lint rules"
    - "ACL DI-then-fallback: aclDeniedByAgent map for tests, <memoryPath>/SECURITY.md + resolveDeniedCommands for production — single interface, zero test fs-writes"
    - "mergeAndDedupe contract (native wins): removed defaults can be re-provided by SDK discovery without losing the nativeBehavior discriminator"

key-files:
  created:
    - src/manager/native-cc-commands.ts
    - src/manager/__tests__/native-cc-commands.test.ts
    - src/manager/__tests__/persistent-session-handle-supported-commands.test.ts
    - src/discord/__tests__/slash-commands-register.test.ts
    - .planning/phases/87-native-cc-slash-commands/deferred-items.md
  modified:
    - src/manager/sdk-types.ts
    - src/manager/persistent-session-handle.ts
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/discord/slash-types.ts
    - src/discord/slash-commands.ts
    - src/discord/__tests__/slash-types.test.ts
    - src/discord/__tests__/slash-commands.test.ts
    - src/security/acl-parser.ts
    - src/security/acl-parser.test.ts
    - src/openai/__tests__/template-driver-cost-attribution.test.ts
    - src/openai/__tests__/template-driver.test.ts
    - src/openai/__tests__/transient-session-cache.test.ts

key-decisions:
  - "Discovery via Query.initializationResult (one round-trip with commands + agents + models + skills) over Query.supportedCommands (commands only) — matches CMD-00 spike recommendation and spares Plan 02/03 a second SDK call for their own enumeration needs."
  - "Classifier safe-default is prompt-channel for unknown commands — CMD-00 spike concluded most non-setter commands are prompt-routable via SDKLocalCommandOutputMessage; future SDK additions land safely without a classifier update."
  - "clear / export / mcp are in the skip-set (never registered): clear not SDK-dispatchable (defer to CMD-F2 session-restart workaround), export CLI-only, mcp covered by Phase 85's /clawcode-tools (Pitfall 12 — /mcp surface would re-leak env/command/args)."
  - "Namespace locked to clawcode-<name> by construction in buildNativeCommandDefs (Pitfall 10). Zero bare-name registrations possible."
  - "ACL is per-agent and read at register-time only (not per-turn). Missing file / missing section / empty section → permissive allow. Leading slash in deny list is stripped (both `/init` and `init` forms match)."
  - "Pre-flight count ≤ 90 is a HARD refuse per guild (throws rest.put never fires). 90 leaves a 10-slot buffer below Discord's 100-per-guild cap; current fleet worst case is ~41 (16 existing + ~25 SDK)."
  - "aclDeniedByAgent is an optional DI hook — tests inject pre-computed Map/Record; production derives from <memoryPath>/SECURITY.md via resolveDeniedCommands. No test fs-writes required."
  - "SessionHandle.getSupportedCommands cache is null-on-failure (not failed-value-cached) so transient SDK unreadiness at warm-path boot resolves on the next invocation — prevents a stuck empty-list for the agent's lifetime."

patterns-established:
  - "Static-grep regression pin for architectural invariants: readdirSync + readFileSync walk of src/ (excluding __tests__), assert forbidden pattern has zero hits. Lightweight, zero new deps, sits next to the integration test that exercises the positive path."
  - "Native-dispatch discriminator via optional SlashCommandDef.nativeBehavior field — Plans 02/03 route entirely on presence-of-field, no name-matching or lookup tables needed."
  - "Rule-3 cascade for SessionHandle surface extensions: every addition to the SessionHandle type requires updating (a) MockSessionHandle, (b) legacy wrapSdkQuery stub, (c) every test file that spreads a literal SessionHandle mock. 3 openai test mocks updated this plan (identical precedent to Phase 86's FakeQuery fix-ahead)."
  - "DI-then-fallback policy loader: constructor accepts an optional Map/Record; when absent, register() derives from <memoryPath>/SECURITY.md at invocation. Production stays file-backed; tests stay pure."

requirements-completed: [CMD-01, CMD-04, CMD-05, CMD-07]
# UI-01: registration surface complete (native SlashCommandBuilder REST body, STRING options from argumentHints). Dispatch UI lives in Plans 02/03.
requirements-partial: [UI-01]

# Metrics
duration: 19min
completed: 2026-04-21
---

# Phase 87 Plan 01: Native CC Slash Commands — Discovery + Registration Summary

**SDK-driven per-agent Discord slash-command registration via Query.initializationResult, `clawcode-<name>` namespace guard enforced by construction, SECURITY.md deny-list gating, 90-per-guild pre-flight cap, and a static-grep regression pin that makes hardcoded native-command lists impossible to re-introduce.**

## Performance

- **Duration:** 19 min 24 s
- **Tasks:** 2 (both TDD RED→GREEN, committed separately)
- **Files changed:** 13 modified, 5 created (4 code/test + 1 deferred-items log)
- **Tests:** 106 GREEN across 6 test files (35 Task 1 + 71 Task 2; net +50 new tests over pre-plan baseline)
- **TSC:** Baseline 38 errors held; zero new errors introduced

## What landed

### Task 1 — SDK surface + SessionHandle command discovery + pure classifier (commit f38b115)

1. `src/manager/sdk-types.ts` — added `initializationResult()` + `supportedCommands()` to `SdkQuery`, plus local `SlashCommand` type projection mirroring `sdk.d.ts:4239-4252`.
2. `src/manager/persistent-session-handle.ts` — added `getSupportedCommands()` with null-on-failure cache populated once via `q.initializationResult()`.
3. `src/manager/session-adapter.ts` — extended `SessionHandle` type with `getSupportedCommands`; wired legacy `wrapSdkQuery` (empty-array stub) and `MockSessionHandle` (in-memory + `__testSetSupportedCommands` hook) for surface parity.
4. `src/manager/native-cc-commands.ts` — NEW pure module:
   - `classifyCommand(name)` → `"control-plane" | "prompt-channel" | "skip"`
   - `buildNativeCommandDefs(sdkCommands, acl)` → `SlashCommandDef[]` (clawcode- prefix + 100-char description clamp + STRING `args` option from argumentHint + `nativeBehavior` discriminator)
   - `mergeAndDedupe(existing, native)` — native wins on name collision
5. `src/discord/slash-types.ts` — added optional `nativeBehavior: "control-plane" | "prompt-channel"` to `SlashCommandDef`.
6. Rule-3 cascade: 3 `src/openai/__tests__` SessionHandle mocks updated to implement `getSupportedCommands` (vi.fn resolving `[]`).

### Task 2 — Register loop rewrite + DEFAULT_SLASH_COMMANDS dedupe removal + ACL helper + static-grep regression pin (commit 0f851b7)

1. `src/discord/slash-types.ts` — REMOVED `clawcode-compact` and `clawcode-usage` entries from `DEFAULT_SLASH_COMMANDS` with an explanatory banner comment.
2. `src/security/acl-parser.ts` — added `resolveCommandAcl(securityMdPath, name)` and `resolveDeniedCommands(securityMdPath)` helpers parsing an optional `## Command ACLs` / `- deny: [...]` section.
3. `src/discord/slash-commands.ts` — rewrote `register()` to:
   - Iterate each resolved agent's `SessionHandle.getSupportedCommands()` via `SessionManager.getSessionHandle`
   - ACL-filter via `resolveDeniedCommands(<memoryPath>/SECURITY.md)` (or DI'd override from `aclDeniedByAgent`)
   - Build native-CC entries with `buildNativeCommandDefs`
   - Merge via `mergeAndDedupe` (native wins — re-provides the removed compact/usage duplicates)
   - Refuse to register when `body.length > 90` (CMD-07 pre-flight)
4. `src/manager/session-manager.ts` — added public `getSessionHandle(name): SessionHandle | undefined` accessor.
5. `src/discord/__tests__/slash-commands-register.test.ts` — NEW static-grep regression test (readdirSync walk of src/ excluding __tests__/) + mocked-REST integration suite covering native discovery, ACL filter, 120-command cap violation, and 15-agent fleet dedupe.
6. Regression pin updates to `src/discord/__tests__/slash-types.test.ts` (pin compact/usage removal) and `src/discord/__tests__/slash-commands.test.ts` (default+control count 14 down from 16).

## Dispatch classifier table

| SDK command         | Classification   | Rationale                                                             |
| ------------------- | ---------------- | --------------------------------------------------------------------- |
| `model`             | `control-plane`  | Dispatch via `Query.setModel` (Phase 86 wire)                         |
| `permissions`       | `control-plane`  | Dispatch via `Query.setPermissionMode` (Plan 02 target)               |
| `effort`            | `control-plane`  | Dispatch via `Query.setMaxThinkingTokens` (Phase 83 wire)             |
| `compact`           | `prompt-channel` | Prompt-route; emits `SDKLocalCommandOutputMessage`                    |
| `context`           | `prompt-channel` | Prompt-route                                                          |
| `cost`              | `prompt-channel` | Prompt-route (Plan 02/03 may later swap to daemon-owned `UsageTracker`) |
| `help`              | `prompt-channel` | Prompt-route                                                          |
| `hooks`             | `prompt-channel` | Prompt-route                                                          |
| `clear`             | `skip`           | Not SDK-dispatchable (deferred to CMD-F2 session-restart workaround)  |
| `export`            | `skip`           | CLI-only REPL feature; no SDK surface                                 |
| `mcp`               | `skip`           | Covered by Phase 85's `/clawcode-tools`; bare `/mcp` surface would re-leak env/command/args (Pitfall 12) |
| any unknown         | `prompt-channel` | Safe default (CMD-00 spike: most non-setter commands are prompt-routable) |

## Static-grep regression pin — output

```text
$ grep -rn "const\s+\(NATIVE_COMMANDS\|SDK_COMMANDS\|INIT_COMMANDS\|CC_COMMANDS\)\s*=\s*\[" src/
CLEAN: zero hits
```

The unit test at `src/discord/__tests__/slash-commands-register.test.ts` runs the same walk on every `npx vitest` invocation and fails if a future change re-introduces any of those four literal names.

## Current slash-command count vs the 90-cap

- Pre-plan: 8 defaults + 8 control = **16** static registrations
- Post-plan: 6 defaults + 8 control = **14** static registrations
- Worst-case per-guild total after Plan 01 ≈ 14 + ~25 SDK-reported commands per agent (name-deduped across the 15-agent fleet) = **~41** — well under the 90 ceiling with 49+ slots of headroom. The pre-flight cap assertion refuses `rest.put` at 91+.

## Plan 02 + 03 hand-off

- **SlashCommandDef.nativeBehavior** discriminator (`"control-plane" | "prompt-channel"`) is the ONLY field Plans 02/03 need to route — no name-matching, no second lookup table. Populated by construction in `buildNativeCommandDefs`; absent on CONTROL_COMMANDS (daemon-routed IPC) and on the remaining DEFAULT_SLASH_COMMANDS (static LLM-prompt commands).
- **SessionManager.getSessionHandle(name)** public accessor lets Plan 02 reach through to `handle.setPermissionMode` / `handle.setModel` / `handle.setEffort` without re-exposing SessionManager's private `sessions` Map.
- **native-cc-commands.ts** is a pure module — Plans 02/03 can import `classifyCommand` for runtime dispatch decisions if the static `nativeBehavior` field turns out insufficient in practice.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Cascade] 3 openai/__tests__ SessionHandle mocks missing getSupportedCommands**
- **Found during:** Task 1 GREEN (tsc after module extension)
- **Issue:** Adding `getSupportedCommands` to `SessionHandle` broke 3 test mocks (`template-driver.test.ts`, `template-driver-cost-attribution.test.ts`, `transient-session-cache.test.ts`) with TS2322 / TS2741 structural-typing errors.
- **Fix:** Added `getSupportedCommands: vi.fn().mockResolvedValue([])` to each mock; matches the identical cascade Phase 86 did for `setModel`.
- **Files modified:** `src/openai/__tests__/template-driver.test.ts`, `src/openai/__tests__/template-driver-cost-attribution.test.ts`, `src/openai/__tests__/transient-session-cache.test.ts`
- **Commit:** f38b115 (Task 1 GREEN)

**2. [Rule 2 - Missing critical functionality] ACL DI hook for tests**
- **Found during:** Task 2 GREEN (integration test design)
- **Issue:** Plan specified register() reads SECURITY.md per agent, but unit tests shouldn't have to fs-write fixture files to exercise the ACL path — a hermetic DI injection is materially better for test authoring + CI speed.
- **Fix:** Added optional `aclDeniedByAgent: Map | Record` to `SlashCommandHandlerConfig`; production path falls through to `resolveDeniedCommands(<memoryPath>/SECURITY.md)` unchanged when the override is absent.
- **Files modified:** `src/discord/slash-commands.ts`
- **Commit:** 0f851b7 (Task 2 GREEN)

**3. [Rule 1 - Bug] Outdated default+control count assertion in slash-commands.test.ts T7**
- **Found during:** Task 2 GREEN (wider test sweep)
- **Issue:** Pre-existing T7 test hardcoded `DEFAULT_SLASH_COMMANDS.length + CONTROL_COMMANDS.length === 16` — the CMD-04 removal of compact + usage reduced defaults from 8 to 6, making the total 14.
- **Fix:** Updated the assertion to 14 with a CMD-04 comment so future readers understand the delta.
- **Files modified:** `src/discord/__tests__/slash-commands.test.ts`
- **Commit:** 0f851b7 (Task 2 GREEN)

## Deferred Issues

Pre-existing test failures detected during broader test sweep but NOT caused by Plan 01. Logged to `.planning/phases/87-native-cc-slash-commands/deferred-items.md` per scope-boundary rule:
- `src/manager/__tests__/bootstrap-integration.test.ts` — 2 failures (pre-existing `TypeError: path argument must be of type string`)
- `src/manager/__tests__/daemon-openai.test.ts` — 7 failures (pre-existing `startOpenAiServer` mock never invoked)
- `src/manager/__tests__/warm-path-mcp-gate.test.ts` — 1 flaky failure in parallel runs (`ENOTEMPTY` tmpdir cleanup race; file passes when run alone)

## Verification

```bash
npx vitest run \
  src/manager/__tests__/native-cc-commands.test.ts \
  src/manager/__tests__/persistent-session-handle-supported-commands.test.ts \
  src/discord/__tests__/slash-types.test.ts \
  src/discord/__tests__/slash-commands.test.ts \
  src/discord/__tests__/slash-commands-register.test.ts \
  src/security/acl-parser.test.ts
# Test Files  6 passed (6)
# Tests       106 passed (106)

grep -rn "const\s\+\(NATIVE_COMMANDS\|SDK_COMMANDS\|INIT_COMMANDS\|CC_COMMANDS\)\s*=\s*\[" src/
# (no output — zero hits)

npx tsc --noEmit 2>&1 | grep -c "error TS"
# 38 (baseline, unchanged)
```

## Self-Check: PASSED

All 6 claimed files exist on disk; all 4 commit hashes (6fef833 RED-1, f38b115 GREEN-1, 10e9e76 RED-2, 0f851b7 GREEN-2) are reachable via `git log`.

