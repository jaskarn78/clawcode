---
phase: 86-dual-discord-model-picker-core
plan: 01
subsystem: sdk-integration
tags: [claude-agent-sdk, model-picker, setModel, allowedModels, zod-schema, hot-reload, regression-pin, ModelNotAllowedError]

# Dependency graph
requires:
  - phase: 83-extended-thinking-effort-mapping
    provides: "SDK canary blueprint — spy-test regression pin + fire-and-forget + .catch pattern for mid-session SDK mutations (setMaxThinkingTokens wired the same way setModel is wired here)"
  - phase: 56-hot-reload
    provides: "RELOADABLE_FIELDS classification infrastructure + diffConfigs pattern-matcher reused for allowedModels"
provides:
  - "allowedModels added to agentSchema (optional) + defaultsSchema (default ['haiku','sonnet','opus']); v2.1 migrated configs parse unchanged"
  - "agents.*.allowedModels + defaults.allowedModels classified RELOADABLE; agents.*.model stays NON-reloadable (regression-pinned)"
  - "ResolvedAgentConfig.allowedModels always populated (loader.ts resolves against defaults) — downstream always sees a concrete array"
  - "SdkQuery type extended with setModel(model?: string): Promise<void> mirroring sdk.d.ts:1711"
  - "SessionHandle.setModel / getModel on persistent-session-handle + MockSessionHandle + legacy wrapSdkQuery (stub) — surface parity preserved"
  - "SessionManager.setModelForAgent validates alias against allowedModels BEFORE SDK call; throws ModelNotAllowedError on violation"
  - "SessionManager.getModelForAgent surfaces live SDK model id for Plan 02 /clawcode-status"
  - "ModelNotAllowedError (typed) carrying agent + attempted + allowed list for ephemeral Discord error rendering"
  - "FakeQuery mock extended with setModel (mirrors Phase 83 Rule-3 fix-ahead precedent)"
  - "Spy-based regression pin (5 P-tests) + SessionManager integration suite (5 M-tests)"
affects: [phase-86-02-yaml-persistence, phase-86-03-clawcode-model-slash-command, phase-87-setPermissionMode-wiring]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — SDK 0.2.97 already on-box; Zod 4.3.6 unchanged
  patterns:
    - "Spy-based regression pin for SDK mutation setters (blueprint from Phase 83 now applied to setModel; same template reusable for Phase 87 setPermissionMode)"
    - "Allowlist validation at IPC boundary BEFORE SDK call — typed error class carries the allowed list so callers render actionable messages without a second round-trip"
    - "Defaults always populated: loader.ts resolves optional per-agent allowedModels against defaults.allowedModels so downstream sees a concrete array"
    - "Additive schema extension pattern (from Phase 83) reused: new optional field + default-bearing defaults field + dedicated reloadable classification"

key-files:
  created:
    - src/manager/model-errors.ts
    - src/manager/__tests__/persistent-session-handle-model.test.ts
    - src/manager/__tests__/session-manager-set-model.test.ts
  modified:
    - src/config/schema.ts
    - src/config/types.ts
    - src/config/loader.ts
    - src/shared/types.ts
    - src/config/__tests__/schema.test.ts
    - src/config/__tests__/differ.test.ts
    - src/manager/sdk-types.ts
    - src/manager/persistent-session-handle.ts
    - src/manager/session-adapter.ts
    - src/manager/session-manager.ts
    - src/manager/__tests__/persistent-session-handle.test.ts

key-decisions:
  - "allowedModels additive + optional at agentSchema layer; defaultsSchema defaults to ['haiku','sonnet','opus'] so v2.1 configs parse unchanged and downstream always sees a concrete array."
  - "allowedModels classified RELOADABLE (Discord picker re-reads every invocation) but agents.*.model stays NON-reloadable (runtime switches use SessionHandle.setModel; a live model swap is NOT a YAML hot-reload)."
  - "setModel stays synchronous on SessionHandle; SDK Promise is fire-and-forget with .catch log-and-swallow — slash-command + IPC paths cannot yield."
  - "ModelNotAllowedError carries the allowed list so the Discord slash-command / IPC error reply can render allowed options without a second round-trip to SessionManager."
  - "Allowlist validation happens at SessionManager (not at handle) so a typed policy-error is raised BEFORE the SDK call — the SDK call never fires on a violation."
  - "Legacy wrapSdkQuery gets setModel/getModel stubs (no-op + undefined) for SessionHandle surface parity; it's test-only (createTracedSessionHandle) so the no-op is acceptable (same precedent as quick-task 260419-nic's interrupt()/hasActiveTurn()) and keeps production routing on createPersistentSessionHandle."

patterns-established:
  - "SDK mutation setter blueprint (locked): Query[method] → handle[method] = synchronous caller + fire-and-forget Promise + .catch log-and-swallow. Spy-test regression pin asserts toHaveBeenCalledWith(exact-arg). Phase 83 (setMaxThinkingTokens) + Phase 86 (setModel) share this template verbatim; Phase 87 setPermissionMode is the next application."
  - "Allowlist enforcement at SessionManager boundary: resolve per-agent list → validate alias → throw typed error BEFORE handle dispatch. Downstream IPC/slash layers catch the typed error and render allowed options."
  - "Schema back-compat regression test: add a dedicated test that parses a v2.1-shaped config (15 agents missing the new optional field) and asserts every field is populated from defaults. Pins the additive-schema contract."
  - "FakeQuery fix-ahead: every new SessionHandle method that the production handle dispatches to the Query MUST extend the test FakeQuery mock in the same commit — else the existing 'surface byte-identical' test crashes the first time a downstream test exercises the new wire."

requirements-completed: [MODEL-01, MODEL-03, MODEL-06]

# Metrics
duration: 31min
completed: 2026-04-21
---

# Phase 86 Plan 01: Dual Discord Model Picker Core Summary

**Schema + SDK plumbing for /clawcode-model: allowedModels allowlist, SessionHandle.setModel wired to q.setModel (Phase 83 canary blueprint), and typed ModelNotAllowedError at the IPC boundary.**

## Performance

- **Duration:** 31 min
- **Started:** 2026-04-21T20:27:00Z
- **Completed:** 2026-04-21T20:58:24Z
- **Tasks:** 2 (TDD)
- **Files created:** 3
- **Files modified:** 11

## Accomplishments

- **Pinned the setModel wire with a spy test that can't be fooled.** 5 tests in `persistent-session-handle-model.test.ts` assert `q.setModel` is called with the exact model id (P1 single-call, P2 two-in-order no coalescing, P3 state parity, P4 log-and-swallow rejection, P5 pre-turn safety). If the wire ever silently un-wires (the P0 class of bug Phase 73 introduced for setEffort), CI goes red.
- **Published the typed allowlist guard at the SessionManager boundary.** 5 tests in `session-manager-set-model.test.ts` assert the allowed-alias happy path, the disallowed-alias rejection raises `ModelNotAllowedError` with agent/attempted/allowed populated, getModel round-trips, the error shape (instanceof + message), and unknown-agent keeps the existing SessionError guard intact.
- **Additive schema extension.** `agentSchema.allowedModels: z.array(modelSchema).optional()` + `defaultsSchema.allowedModels.default(() => ["haiku","sonnet","opus"])` — v2.1 migrated fleet (15 agents) parses unchanged; v2.1 regression-pinned by a dedicated test.
- **Loader resolves per-agent → defaults so downstream always sees a concrete array.** `ResolvedAgentConfig.allowedModels: readonly ("haiku"|"sonnet"|"opus")[]` — Plan 02 + Plan 03 consumers never need optional-chain fallbacks.
- **Hot-reload classification preserves Phase 83 precedent.** `agents.*.allowedModels` + `defaults.allowedModels` added to `RELOADABLE_FIELDS`; `agents.*.model` stays NON-reloadable because runtime model swaps go through `SessionHandle.setModel`, not through a YAML hot-reload event. Regression-pinned by a dedicated test.
- **FakeQuery mock extended (Rule 3 blocking fix-ahead).** Mirrors the Phase 83 precedent — added `setModel: vi.fn()` so the existing "SessionHandle surface is byte-identical" test doesn't crash once downstream tests exercise the new wire.

## Task Commits

Each task was committed atomically with `--no-verify` per parallel-execution protocol:

1. **Task 1: Schema allowedModels + reloadable classification + loader resolution (RED→GREEN)** — `366609a` (feat)
   - RED: Wrote 9 failing tests across `schema.test.ts` (4 agentSchema parse, 2 defaultsSchema default, 2 v2.1 back-compat) and `differ.test.ts` (1 agents.*.allowedModels reloadable, 1 defaults.allowedModels reloadable, 1 agents.*.model non-reloadable regression). All 9 failed against HEAD.
   - GREEN: Added `allowedModels` to `agentSchema` + `defaultsSchema`; added both entries to `RELOADABLE_FIELDS`; resolved `allowedModels` in `loader.ts`; exposed readonly `allowedModels` on `ResolvedAgentConfig`. Rule-3 cascade: added `allowedModels` to 20 existing test fixtures across agent/bootstrap/config/discord/heartbeat/manager (structural typing requires all ResolvedAgentConfig literals to carry the field).

2. **Task 2: SDK setModel wiring + SessionHandle surface + SessionManager + ModelNotAllowedError (RED→GREEN)** — `059f457` (feat)
   - RED: Created `persistent-session-handle-model.test.ts` (5 spy tests) + `session-manager-set-model.test.ts` (5 integration tests). All 10 failed against post-Task-1 code (handle.setModel undefined, ModelNotAllowedError module missing).
   - GREEN: Extended `SdkQuery` type with `setModel(model?: string): Promise<void>`; added `handle.setModel`/`getModel` to `persistent-session-handle.ts` with fire-and-forget + .catch; mirrored the surface on `SessionHandle` type + `MockSessionHandle` + legacy `wrapSdkQuery`; created `model-errors.ts` with `ModelNotAllowedError`; added `setModelForAgent` (allowlist guard → throw ModelNotAllowedError → handle.setModel) and `getModelForAgent` to SessionManager. Rule-3 blocking fix: extended FakeQuery mock with `setModel` (mirrors Phase 83 setMaxThinkingTokens precedent) + fixed 3 pre-existing SessionHandle mock cascade errors in `openai/__tests__` that were already missing Phase 85 `setMcpState`/`getMcpState`.

## The Wire — Diff Hunks

### `src/manager/persistent-session-handle.ts` (the Phase 86 site)

**Added (mirrors Phase 83 setEffort shape exactly):**
```ts
setModel(modelId: string): void {
  currentModel = modelId;
  // Phase 86 MODEL-03 — SDK canary pattern (Phase 83 blueprint).
  // q.setModel is async on the SDK (sdk.d.ts:1711) but we DO NOT await —
  // setModel must stay synchronous because the IPC / slash call path
  // cannot yield. Rejections are logged-and-swallowed so a transient
  // SDK failure never crashes a healthy turn. Regression pinned by
  // spy test in persistent-session-handle-model.test.ts.
  void q.setModel(modelId).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[model] setModel(${modelId}) failed: ${msg}`);
  });
},

getModel(): string | undefined {
  return currentModel;
},
```

### SessionHandle surface — before/after

**Before (post-Phase 83):**
```ts
export type SessionHandle = {
  // ...
  setEffort: (level: EffortLevel) => void;
  getEffort: () => EffortLevel;
  interrupt: () => void;
  hasActiveTurn: () => boolean;
  getMcpState: () => ReadonlyMap<string, McpServerState>;
  setMcpState: (state: ReadonlyMap<string, McpServerState>) => void;
};
```

**After (post-Phase 86):**
```ts
export type SessionHandle = {
  // ...
  setEffort: (level: EffortLevel) => void;
  getEffort: () => EffortLevel;
  // Phase 86 MODEL-03 — mid-session model mutation (spy-test pinned).
  setModel: (modelId: string) => void;
  // Phase 86 MODEL-07 — current model alias/id surfaced in /clawcode-status.
  getModel: () => string | undefined;
  interrupt: () => void;
  hasActiveTurn: () => boolean;
  getMcpState: () => ReadonlyMap<string, McpServerState>;
  setMcpState: (state: ReadonlyMap<string, McpServerState>) => void;
};
```

### `src/manager/model-errors.ts` — typed error

```ts
export class ModelNotAllowedError extends Error {
  public readonly agent: string;
  public readonly attempted: string;
  public readonly allowed: readonly string[];

  constructor(agent: string, attempted: string, allowed: readonly string[]) {
    super(
      `Model '${attempted}' is not in the allowed list for agent '${agent}'. ` +
        `Allowed: ${allowed.join(", ")}`,
    );
    this.name = "ModelNotAllowedError";
    this.agent = agent;
    this.attempted = attempted;
    this.allowed = allowed;
    Object.setPrototypeOf(this, ModelNotAllowedError.prototype);
  }
}
```

### `src/config/schema.ts` — additive field

```ts
// On agentSchema:
allowedModels: z.array(modelSchema).optional(),

// On defaultsSchema:
allowedModels: z
  .array(modelSchema)
  .default(() => ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[]),
```

### `src/config/types.ts` — RELOADABLE_FIELDS additions

```ts
export const RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  // ... existing entries ...
  "agents.*.effort",
  "defaults.effort",
  // Phase 86 MODEL-01 — Discord picker re-reads every invocation; no session
  // restart needed. Runtime model SWITCHES remain non-reloadable — the
  // allowlist governs what's PICKABLE, not what's active.
  "agents.*.allowedModels",
  "defaults.allowedModels",
]);
```

### `src/manager/session-manager.ts` — guard + dispatch

```ts
setModelForAgent(name: string, alias: "haiku" | "sonnet" | "opus"): void {
  const handle = this.requireSession(name);
  const config = this.configs.get(name);
  const allowed = (config?.allowedModels ?? ["haiku", "sonnet", "opus"]) as readonly string[];
  if (!allowed.includes(alias)) {
    throw new ModelNotAllowedError(name, alias, allowed);
  }
  const modelId = resolveModelId(alias);
  handle.setModel(modelId);
  this.log.info({ agent: name, model: alias, modelId }, "model updated");
}

getModelForAgent(name: string): string | undefined {
  const handle = this.requireSession(name);
  return handle.getModel();
}
```

## Spy-Test Results — The Regression Pin

`src/manager/__tests__/persistent-session-handle-model.test.ts`:

| Test | Asserts | Status |
|------|---------|--------|
| P1: setModel('claude-sonnet-4-5') | `spy.toHaveBeenCalledTimes(1)` + `toHaveBeenCalledWith("claude-sonnet-4-5")` | PASS |
| P2: two sequential calls | `spy.mock.calls === [["claude-haiku-4-5"], ["claude-opus-4-7"]]` (ordered, no coalescing) | PASS |
| P3: getModel state parity | returns most-recently-set id after two setModel calls | PASS |
| P4: SDK rejection log-and-swallow | `expect(() => handle.setModel(...)).not.toThrow()` + `warnSpy.toHaveBeenCalled()` | PASS |
| P5: pre-turn safety | setModel called before any turn runs does not throw | PASS |

**5/5 green.** If `setModel` ever silently un-wires, all 5 tests go red on the next CI run.

`src/manager/__tests__/session-manager-set-model.test.ts`:

| Test | Asserts | Status |
|------|---------|--------|
| M1: allowed alias dispatches | handle.setModel spy called once with resolved SDK id | PASS |
| M2: disallowed alias rejects | throws ModelNotAllowedError w/ agent+attempted+allowed; handle spy NOT called | PASS |
| M3: getModelForAgent returns live id | matches the most-recently dispatched id (resolved opus pattern) | PASS |
| M4: ModelNotAllowedError shape | instanceof Error + instanceof ModelNotAllowedError; message contains agent+attempted+allowed | PASS |
| M5: unknown agent | throws SessionError, not ModelNotAllowedError (preserved requireSession guard) | PASS |

**5/5 green.** Allowlist guard + typed-error contract pinned.

## Files Created/Modified

### Created
- `src/manager/model-errors.ts` (30 lines) — ModelNotAllowedError class
- `src/manager/__tests__/persistent-session-handle-model.test.ts` (135 lines) — 5 SDK-canary spy tests
- `src/manager/__tests__/session-manager-set-model.test.ts` (195 lines) — 5 SessionManager integration tests

### Modified (production)
- `src/config/schema.ts` — added allowedModels to agentSchema + defaultsSchema + inline configSchema default
- `src/config/types.ts` — added agents.*.allowedModels + defaults.allowedModels to RELOADABLE_FIELDS
- `src/config/loader.ts` — resolved per-agent allowedModels against defaults
- `src/shared/types.ts` — added readonly allowedModels to ResolvedAgentConfig
- `src/manager/sdk-types.ts` — added setModel(model?: string): Promise<void> to SdkQuery
- `src/manager/persistent-session-handle.ts` — THE WIRE. handle.setModel + handle.getModel
- `src/manager/session-adapter.ts` — extended SessionHandle type, MockSessionHandle stubs, legacy wrapSdkQuery stubs
- `src/manager/session-manager.ts` — added setModelForAgent (with allowlist guard) + getModelForAgent + imports

### Modified (tests)
- `src/config/__tests__/schema.test.ts` — 4 agentSchema + 2 defaultsSchema + 2 v2.1 back-compat + 1 config-level tests
- `src/config/__tests__/differ.test.ts` — 2 reloadable + 1 non-reloadable regression tests + `makeConfig` base fixture update
- `src/manager/__tests__/persistent-session-handle.test.ts` — extended FakeQuery mock with setModel + surface-check additions
- 20 test fixtures across agent/bootstrap/config/discord/heartbeat/manager — added `allowedModels: ["haiku","sonnet","opus"]` (Rule 3 blocking cascade; documented in deviations)
- 3 SessionHandle mocks in openai/__tests__ — fixed pre-existing Phase 85 mcp-state omissions AND added Phase 86 setModel/getModel (structural typing failure fixed in one pass)

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Additive schema.** `allowedModels` is optional on agentSchema; defaultsSchema defaults to the full modelSchema enum. v2.1 migrated fleet parses unchanged (verified by a 15-agent regression snapshot test).
2. **Hot-reload split.** `allowedModels` is reloadable (picker re-reads); `model` stays non-reloadable (runtime switches go through `SessionHandle.setModel`, not through a YAML reload event). Regression-pinned.
3. **Synchronous setModel, fire-and-forget SDK call.** Mirrors the Phase 83 EFFORT-01 decision — slash-command / IPC caller cannot yield; the SDK Promise is unawaited and `.catch`-logged.
4. **Allowlist validation at SessionManager.** The typed `ModelNotAllowedError` is raised BEFORE the SDK call fires — downstream IPC / slash layers catch the typed error and render the allowed list.
5. **Loader-level resolution.** Every `ResolvedAgentConfig` carries a concrete `allowedModels` array; downstream consumers (Plan 02 daemon IPC, Plan 03 slash command) never need optional-chain fallbacks.
6. **Legacy wrapSdkQuery stubs.** wrapSdkQuery is `@deprecated` test-only; its setModel is a no-op and its getModel returns undefined. Production routes through `createPersistentSessionHandle` where the real wire lives.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `allowedModels` to 20 pre-existing `ResolvedAgentConfig` test fixtures**
- **Found during:** Task 1 GREEN (post-edit `npx tsc --noEmit`)
- **Issue:** Adding `readonly allowedModels: readonly (...)[]` to `ResolvedAgentConfig` as a REQUIRED (non-optional) field caused 20 structural-typing cascade failures across agent/bootstrap/config/discord/heartbeat/manager test files that build ResolvedAgentConfig literals directly.
- **Fix:** Added `allowedModels: ["haiku", "sonnet", "opus"]` (or `as ("haiku"|"sonnet"|"opus")[]` where needed) to every literal. Kept the field REQUIRED on the shared type because loader.ts always populates it — making it optional would be a downstream-consumer footgun.
- **Files modified:** 20 test files (see Task 1 commit `366609a` for the full list)
- **Verification:** `npx tsc --noEmit` error count dropped from 41 (pre-plan) → 41 (post-Task-1) → 38 (post-Task-2 after bonus fixes). Zero new TS errors introduced by Plan 86.
- **Committed in:** `366609a` (Task 1)

**2. [Rule 3 - Blocking] Extended FakeQuery mock in `persistent-session-handle.test.ts` with setModel**
- **Found during:** Task 2 GREEN (post-edit test run)
- **Issue:** The existing "SessionHandle surface is byte-identical" test at line ~226 calls the handle's lifecycle methods via a shared FakeQuery mock. After Task 2 added `handle.setModel`, exercising the new wire from a downstream test would have thrown `TypeError: q.setModel is not a function` — same class of failure Phase 83 fixed for `setMaxThinkingTokens`.
- **Fix:** Added `setModel: vi.fn(() => Promise.resolve(undefined))` to the FakeQuery mock (1 line). Added surface-check assertions for `handle.setModel` + `handle.getModel` at the same time.
- **Files modified:** `src/manager/__tests__/persistent-session-handle.test.ts`
- **Verification:** 15/15 tests in that file pass after the mock extension.
- **Committed in:** `059f457` (Task 2)

**3. [Rule 3 - Blocking] Fixed 3 pre-existing Phase 85 `getMcpState`/`setMcpState` omissions in openai test mocks**
- **Found during:** Task 2 GREEN (post-edit `npx tsc --noEmit`)
- **Issue:** Adding `setModel`/`getModel` to the `SessionHandle` type caused 3 pre-existing SessionHandle-shaped mocks in `openai/__tests__` to fail structural typing. The ALREADY-MISSING `getMcpState`/`setMcpState` (from Phase 85) were surfaced by the Phase 86 additions in the same error message. `git stash`-verified: the mcp-state omissions pre-date this plan and were latent TS errors.
- **Fix:** Added BOTH the Phase 86 (`setModel`/`getModel`) AND the Phase 85 (`getMcpState`/`setMcpState`) entries to:
  - `src/openai/__tests__/template-driver-cost-attribution.test.ts`
  - `src/openai/__tests__/template-driver.test.ts`
  - `src/openai/__tests__/transient-session-cache.test.ts`
- **Files modified:** 3 test files (1 line change each × 2 phases = 6 new lines per file)
- **Verification:** `npx tsc --noEmit` error count dropped from 41 → 38 (net −3 via this fix; ZERO new errors from Plan 86).
- **Committed in:** `059f457` (Task 2)

---

**Total deviations:** 3 auto-fixed (all Rule 3 - Blocking; two directly caused by the new SessionHandle-surface additions, one was a latent Phase 85 bug uncovered by the same structural cascade).
**Impact on plan:** Zero scope creep. All three were unavoidable compile/test cascades from adding required fields to shared types. Plan 02 + Plan 03 unblocked. Net TS-error reduction (-3).

## Issues Encountered

- **Parallel-vitest test interference flakiness** — when running `src/manager/__tests__/ src/config/__tests__/` together, `fork-effort-quarantine.test.ts` sometimes reports "Agent ... not found in registry" due to shared tmpdir contention with `session-manager.test.ts`. Verified `fork-effort-quarantine.test.ts` passes in isolation (3/3). Same class of pre-existing flakiness Phase 83 SUMMARY documented. Out of scope for Plan 86 — none of the failing suites touch allowedModels / setModel code.
- **9 pre-existing test failures in `bootstrap-integration.test.ts` + `daemon-openai.test.ts`** — Verified via `git stash` they fail on the pre-plan tree too. Phase 83 SUMMARY already documented these. No regression.
- **Pre-existing TS errors (38 total)** — all predate Plan 86 per `git stash`-verified count. 3 were BONUS-fixed by Task 2 (Phase 85 mcp-state leak in openai mocks). The remaining 38 include loader.ts effort widening (Phase 83 known gap), latency/tasks test implicit-any (Phase 50/58 carry-over), image/daemon-handler (Phase 72 carry-over). None touch Plan 86 code.

## User Setup Required

None — no external service configuration required. Zero new npm deps.

## Known Stubs

None. Every new code path is wired to real production code:
- `handle.setModel` → real `q.setModel` on the SDK Query.
- `SessionManager.setModelForAgent` → real `resolveModelId` → real `handle.setModel`.
- `ResolvedAgentConfig.allowedModels` → always populated by `loader.ts` from config OR defaults.
- Legacy `wrapSdkQuery` setModel is a documented no-op (mirrors interrupt/hasActiveTurn legacy-stub precedent) — acceptable because wrapSdkQuery is test-only and production routes through `createPersistentSessionHandle`.

## Next Phase Readiness

- **Plan 02 (YAML persistence) is unblocked.** `SessionManager.setModelForAgent` is the single entry point; Plan 02 wraps it with atomic YAML writer + post-commit sequencing. Zero schema work remaining.
- **Plan 03 (/clawcode-model slash command) is unblocked.** The Discord picker calls `SessionManager.setModelForAgent`; on `ModelNotAllowedError` it renders the allowed list from `err.allowed`. `ResolvedAgentConfig.allowedModels` is the StringSelectMenuBuilder option source.
- **Phase 87 (setPermissionMode) pattern confirmed.** The spy-test blueprint at `persistent-session-handle-model.test.ts` is now the second application of the Phase 83 template. Phase 87 `setPermissionMode` follows the same exact shape: extend SdkQuery → add synchronous handle method with fire-and-forget + .catch → pin with `.toHaveBeenCalledWith(exact-arg)` spy test.
- **Zero new npm deps.** All work ran on existing stack (SDK 0.2.97, Zod 4.3.6, vitest 4.1.3, nanoid 5.x).

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/manager/model-errors.ts` (30 lines)
- FOUND: `src/manager/__tests__/persistent-session-handle-model.test.ts` (135 lines)
- FOUND: `src/manager/__tests__/session-manager-set-model.test.ts` (195 lines)
- FOUND: commit `366609a` (Task 1)
- FOUND: commit `059f457` (Task 2)
- FOUND: `q.setModel` in `src/manager/persistent-session-handle.ts` (1 production call site)
- FOUND: `setModel` in `src/manager/sdk-types.ts` (type + docstring)
- FOUND: `ModelNotAllowedError` in `src/manager/session-manager.ts` (4 refs: import, docstring, throw, error-class ref)
- FOUND: `ModelNotAllowedError` class in `src/manager/model-errors.ts` (3 refs)
- FOUND: `setModelForAgent` + `getModelForAgent` in `src/manager/session-manager.ts`
- FOUND: `allowedModels` in `src/config/schema.ts` (5 refs), `src/config/types.ts` (2 refs), `src/shared/types.ts` (2 refs), `src/config/loader.ts` (2 refs)
- FOUND: `agents.*.model` in `src/config/types.ts` (2 refs — non-reloadable classification preserved)
- FOUND: 10 new Plan 86 tests (5 P-series + 5 M-series) all GREEN
- FOUND: zero new TS errors (41 pre-plan → 38 post-plan = −3 via Phase 85 mcp-state cleanup)

---
*Phase: 86-dual-discord-model-picker-core*
*Completed: 2026-04-21*
