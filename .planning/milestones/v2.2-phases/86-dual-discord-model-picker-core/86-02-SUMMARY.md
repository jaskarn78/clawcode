---
phase: 86-dual-discord-model-picker-core
plan: 02
subsystem: daemon-ipc
tags: [set-model, updateAgentModel, atomic-yaml, ModelNotAllowedError, json-rpc-code, clawcode-status, live-handle, persistence, regression-pin]

# Dependency graph
requires:
  - phase: 86-dual-discord-model-picker-core
    provides: "SessionManager.setModelForAgent (live SDK swap w/ allowlist guard) + ModelNotAllowedError typed error + SessionHandle.getModelForAgent surface for live-model read"
  - phase: 78-migration-config
    provides: "Atomic temp+rename YAML writer pattern (parseDocument → mutate → tmp+rename; comment preservation; writerFs DI holder) from writeClawcodeYaml"
  - phase: 81-agent-removal
    provides: "removeAgentFromConfig structural template — single-field-mutation variant of the Phase 78 writer pipeline"
provides:
  - "updateAgentModel exported from yaml-writer.ts: atomic single-field rewrite of agents[*].model, comment-preserving, idempotent, with 5 typed outcomes (updated/no-op/not-found/file-not-found/refused)"
  - "handleSetModelIpc exported pure helper from daemon.ts: live SDK swap FIRST → atomic YAML persist SECOND → non-rollback on persistence failure — testable without a full daemon"
  - "ManagerError carries optional {code, data} for JSON-RPC structured error payloads; IPC server.ts handleMessage catch propagates them (defaults preserve pre-86 behaviour)"
  - "case 'set-model' refactored to delegate; 'Takes effect on next session' lie retired"
  - "/clawcode-status 🤖 Model: line sources from sessionManager.getModelForAgent (live handle) with resolved-config fallback — no turn consumed"
  - "5 D-tests (daemon IPC contract) + 2 S-tests (status live-model source) + 8 U-tests (yaml-writer contract) = 15 new regression pins"
affects: [phase-86-03-clawcode-model-slash-command, phase-87-setPermissionMode-ipc-wiring]

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — yaml 2.x already used by writeClawcodeYaml / removeAgentFromConfig
  patterns:
    - "Pure testable IPC handler extraction: export a dependency-injected helper from daemon.ts so tests can drive the full contract (order invariant, typed-error mapping, rollback policy) without spinning up the daemon surface. First application; reusable blueprint for Phase 87 setPermissionMode."
    - "JSON-RPC structured error propagation: opt-in {code, data} on ManagerError → forwarded by IPC server — preserves back-compat (unset = -32603 / no data) while enabling typed error UX for Plan 03's ephemeral Discord renderer."
    - "Non-rollback on persistence failure after irreversible SDK swap: live handle swap is idempotent-in-effect but not reversible from client space; YAML write failure surfaces as persisted:false + persist_error in the response. Operator reconciles by hand or re-invokes /clawcode-model."
    - "Single-scalar YAML mutation via parseDocument AST: reuses Phase 78/81 atomic temp+rename pipeline, mutates ONE node (agentMap.set('model', ...)) — skip secret-scan (not inserting operator-input) and skip unmappable-model gate (pre-validated by daemon)."
    - "Defense-in-depth validation at the writer boundary: modelSchema.safeParse in updateAgentModel even though daemon validates first — self-guard produces clean 'refused' outcome instead of runtime YAML corruption risk if a future caller bypasses the daemon."

key-files:
  created:
    - src/manager/__tests__/daemon-set-model.test.ts
    - src/discord/__tests__/slash-commands-status-model.test.ts
  modified:
    - src/migration/yaml-writer.ts
    - src/migration/__tests__/yaml-writer.test.ts
    - src/manager/daemon.ts
    - src/shared/errors.ts
    - src/ipc/server.ts
    - src/discord/slash-commands.ts
    - src/discord/__tests__/slash-commands-status-effort.test.ts

key-decisions:
  - "updateAgentModel lives in src/migration/yaml-writer.ts alongside writeClawcodeYaml/removeAgentFromConfig — Phase 78 writer is the single owner of clawcode.yaml atomic mutation. No parallel writer pipeline."
  - "Non-rollback on persistence failure: once SessionManager.setModelForAgent returns, the SDK swap is live. Rolling back would require a second setModel with old alias + race window with concurrent turns. We document it explicitly and surface persist_error in the response."
  - "Extracted handleSetModelIpc to a pure exported helper instead of testing via routeMethod. Phase 83 didn't add a daemon-set-effort test (SessionManager tests covered the behaviour); Plan 02 establishes the pure-handler blueprint so Phase 87 setPermissionMode follows the same shape."
  - "ManagerError stays back-compat — {code, data} are optional. Every pre-Phase-86 callsite (70+ throws across daemon.ts) keeps its -32603/no-data mapping. IPC server.ts catch block reads only the first sentinel (error.code as number) — safer than instanceof checks that break across bundlers."
  - "Defense-in-depth modelSchema validation in updateAgentModel — even though daemon validates first, the writer is an exported module-level API. Clean 'refused' outcome with step:'invalid-model' is cheaper than relying on YAML parseDocument to fail later."
  - "Mirror in-memory configs[idx] AFTER the persist attempt, not before. Ensures post-restart consistency without a race window where the in-memory value diverges from disk during a persist failure."

patterns-established:
  - "Pure IPC handler pattern: export a DI'd async function from daemon.ts for every IPC case that has branching logic + external-service interaction. Tests drive the full contract. Phase 87 setPermissionMode is the next application."
  - "JSON-RPC structured error payload: throw ManagerError with {code, data} when callers need to render domain-specific UI (allowed lists, retry hints). code=-32602 for invalid params (allowlist violations); code=-32603 (default) for internal errors. data.kind discriminant keeps payloads self-describing."
  - "Non-rollback on irreversible-downstream-effect: document it in the helper's contract + surface the partial-state outcome in the response. Caller decides whether to retry or reconcile."
  - "Atomic single-field YAML rewrite: parseDocument → find-by-key → YAMLMap.set → doc.toString({lineWidth: 0}) → tmp+rename → sha256 witness. Comment preservation is a property of parseDocument AST — no special-casing needed."

requirements-completed: [MODEL-04, MODEL-07]

# Metrics
duration: 12min 6s
completed: 2026-04-21
---

# Phase 86 Plan 02: Set-Model IPC Persistence + Status Live-Model Summary

**IPC set-model routes through SessionManager.setModelForAgent (live swap) then updateAgentModel (atomic YAML persist); /clawcode-status reads model from the live handle. The 'Takes effect on next session' lie is retired.**

## Performance

- **Duration:** 12 min 6 s
- **Started:** 2026-04-21T21:03:40Z
- **Completed:** 2026-04-21T21:15:46Z
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files created:** 2
- **Files modified:** 7

## Accomplishments

- **Retired PROJECT.md tech-debt lie.** `case "set-model"` no longer emits `"Takes effect on next session"` — the live handle swaps in-turn (Plan 01) AND the YAML persists atomically BEFORE the response goes out.
- **Pure IPC handler blueprint established.** `handleSetModelIpc` is exported from `daemon.ts` with a `SetModelIpcDeps` DI surface. Phase 87 `setPermissionMode` follows the same shape — test the contract, not the daemon boot.
- **Structured JSON-RPC error payloads.** `ModelNotAllowedError` surfaces as `ManagerError` with `code=-32602` + `data.{kind, agent, attempted, allowed}`. Plan 03's `/clawcode-model` Discord handler reads `data.allowed` to render the ephemeral error without a second round-trip.
- **15 new regression pins.** 8 U-tests (`updateAgentModel`), 5 D-tests (`handleSetModelIpc`), 2 S-tests (`/clawcode-status` MODEL-07). All GREEN.
- **Zero new TS errors, zero new npm deps.** 38 pre-plan → 38 post-plan (same pre-existing errors as Plan 01; none from Plan 02 code).
- **PITFALLS §Pitfall 5 closed by design.** `agents.*.model` stays in `NON_RELOADABLE_FIELDS` — the chokidar self-write fires ONCE, the differ classifies it as non-reloadable, daemon's ConfigReloader logs + ignores for running sessions. The live swap already happened via Plan 01's `SessionHandle.setModel`; persistence is for next boot only.

## Task Commits

Each task was committed atomically with `--no-verify` per parallel-execution protocol:

1. **Task 1 RED: failing tests for updateAgentModel (U1-U8)** — `703d852` (test)
   - 8 tests pinning the contract: update / no-op idempotency / comment preservation / not-found / file-not-found / atomic rename failure (tmp unlink) / round-trip re-parse against configSchema / invalid-alias defense-in-depth.
   - All 8 fail with `TypeError: updateAgentModel is not a function`; 19 pre-existing yaml-writer tests still green.

2. **Task 1 GREEN: updateAgentModel implementation** — `d1ec136` (feat)
   - Mirrors `removeAgentFromConfig` structurally: `parseDocument` → find-by-name → `YAMLMap.set("model", ...)` → `doc.toString({lineWidth: 0})` → tmp+rename → sha256 witness.
   - 5 typed outcomes: `updated` / `no-op` / `not-found` / `file-not-found` / `refused + step: "invalid-model"`.
   - All 27 yaml-writer tests green (19 pre-existing + 8 new U-tests).

3. **Task 2 RED: failing tests for set-model IPC + /clawcode-status model** — `2eab504` (test)
   - 5 D-tests via `vi.mock("../../migration/yaml-writer.js")` + `handleSetModelIpc` import: success order invariant / allowlist rejection → typed IPC error / round-trip persistence / non-rollback on persist failure / agent-not-found fast-fail.
   - 2 S-tests via SlashCommandHandler + SessionManager stub: live handle wins / fallback to resolved-config.
   - All 7 fail — D-tests: `handleSetModelIpc is not a function`; S-tests: `🤖 Model:` still reads from static config.

4. **Task 2 GREEN: wire set-model IPC + slash-commands.ts + ManagerError + IPC server** — `bf4eef2` (feat)
   - Extracted `handleSetModelIpc` (pure, DI'd, exported from daemon.ts).
   - Extended `ManagerError` to optionally carry `{code, data}`.
   - Extended `ipc/server.ts` handleMessage catch to propagate code+data (back-compat preserved: `-32603` / no data when absent).
   - `/clawcode-status` sources model from `sessionManager.getModelForAgent(agentName)` with resolved-config fallback.
   - [Rule 3 - Blocking] Extended Phase 83 `slash-commands-status-effort.test.ts` fixtures with `getModelForAgent` stubs (2 of 5 tests broke; now green).
   - All 201 adjacent tests across 19 files still green.

_Plan metadata commit follows via `gsd-tools commit`._

## The Wire — Diff Hunks

### `src/manager/daemon.ts` — `case "set-model":` before/after

**Before (v1.5 tech debt, 37 lines):**
```typescript
case "set-model": {
  const agentName = validateStringParam(params, "agent");
  const modelParam = validateStringParam(params, "model");
  const parsed = modelSchema.safeParse(modelParam);
  if (!parsed.success) {
    throw new ManagerError(
      `Invalid model '${modelParam}'. Must be one of: haiku, sonnet, opus`,
    );
  }
  const newModel = parsed.data;
  const idx = configs.findIndex((c) => c.name === agentName);
  if (idx === -1) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }
  const existingConfig = configs[idx];
  const oldModel = existingConfig.model;
  const updatedConfig = Object.freeze({ ...existingConfig, model: newModel });
  (configs as ResolvedAgentConfig[])[idx] = updatedConfig;
  manager.setAllAgentConfigs(configs);
  return {
    agent: agentName,
    old_model: oldModel,
    new_model: newModel,
    note: "Takes effect on next session",   // <-- THE LIE
  };
}
```

**After (delegates to pure handler, 10 lines):**
```typescript
case "set-model": {
  // Phase 86 Plan 02 MODEL-04 — delegate to the pure testable handler.
  // Live SDK swap fires FIRST (Plan 01 SessionHandle.setModel); atomic
  // clawcode.yaml persist follows via the v2.1 writer pipeline. The old
  // next-session deferral note is retired — the live handle now swaps
  // in-turn, and next-boot persistence is handled by updateAgentModel.
  return await handleSetModelIpc({
    manager,
    configs: configs as ResolvedAgentConfig[],
    configPath,
    params,
  });
}
```

### `src/manager/daemon.ts` — `handleSetModelIpc` (new exported helper)

```typescript
export async function handleSetModelIpc(
  deps: SetModelIpcDeps,
): Promise<SetModelIpcResult> {
  const { manager, configs, configPath, params } = deps;

  const agentName = validateStringParam(params, "agent");
  const modelParam = validateStringParam(params, "model");

  // Defense-in-depth alias validation
  const parsed = modelSchema.safeParse(modelParam);
  if (!parsed.success) {
    throw new ManagerError(
      `Invalid model '${modelParam}'. Must be one of: haiku, sonnet, opus`,
    );
  }
  const newModel = parsed.data;

  const idx = configs.findIndex((c) => c.name === agentName);
  if (idx === -1) {
    throw new ManagerError(`Agent '${agentName}' not found in config`);
  }
  const oldModel = configs[idx]!.model;

  // Live SDK swap FIRST (Plan 01)
  try {
    manager.setModelForAgent(agentName, newModel);
  } catch (err) {
    if (err instanceof ModelNotAllowedError) {
      throw new ManagerError(err.message, {
        code: -32602, // JSON-RPC "Invalid params"
        data: {
          kind: "model-not-allowed",
          agent: err.agent,
          attempted: err.attempted,
          allowed: err.allowed,
        },
      });
    }
    throw err;
  }

  // Atomic YAML persist AFTER — non-rollback on failure
  let persisted = false;
  let persistError: string | null = null;
  try {
    const result = await updateAgentModel({
      existingConfigPath: configPath,
      agentName,
      newModel,
    });
    if (result.outcome === "updated" || result.outcome === "no-op") {
      persisted = true;
    } else {
      persistError = result.reason;
    }
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
    // NO re-throw: live swap already succeeded.
  }

  // Mirror in-memory configs (CLAUDE.md immutability)
  const existingConfig = configs[idx]!;
  const updatedConfig = Object.freeze({ ...existingConfig, model: newModel });
  configs[idx] = updatedConfig;
  manager.setAllAgentConfigs(configs);

  return Object.freeze({
    agent: agentName,
    old_model: oldModel,
    new_model: newModel,
    persisted,
    persist_error: persistError,
    note: persisted
      ? "Live swap + clawcode.yaml updated"
      : `Live swap OK; persistence failed: ${persistError ?? "unknown"}`,
  });
}
```

### `src/migration/yaml-writer.ts` — `updateAgentModel` signature + atomic pattern hunk

```typescript
export type UpdateAgentModelArgs = Readonly<{
  existingConfigPath: string;
  agentName: string;
  newModel: string;    // validated against modelSchema inside
  pid?: number;        // DI for test determinism
}>;

export type UpdateAgentModelResult =
  | { outcome: "updated"; destPath: string; targetSha256: string }
  | { outcome: "no-op"; reason: string }
  | { outcome: "not-found"; reason: string }
  | { outcome: "file-not-found"; reason: string }
  | { outcome: "refused"; reason: string; step: "invalid-model" };

export async function updateAgentModel(
  args: UpdateAgentModelArgs,
): Promise<UpdateAgentModelResult> {
  // ... validation gates (refused | file-not-found | not-found | no-op) ...

  agentMap.set("model", validatedModel);    // <-- THE MUTATION

  const newText = doc.toString({ lineWidth: 0 });
  const destDir = dirname(args.existingConfigPath);
  const tmpPath = join(destDir, `.clawcode.yaml.${pid}.${Date.now()}.tmp`);
  await writerFs.writeFile(tmpPath, newText, "utf8");
  try {
    await writerFs.rename(tmpPath, args.existingConfigPath);   // <-- ATOMIC SAME-FS
  } catch (err) {
    try { await writerFs.unlink(tmpPath); } catch { /* best effort */ }
    throw err;
  }
  const targetSha256 = createHash("sha256").update(newText, "utf8").digest("hex");
  return { outcome: "updated", destPath: args.existingConfigPath, targetSha256 };
}
```

### `src/shared/errors.ts` — ManagerError extension

```typescript
export class ManagerError extends Error {
  public readonly code?: number;
  public readonly data?: unknown;

  constructor(message: string, opts?: { code?: number; data?: unknown }) {
    super(message);
    this.name = "ManagerError";
    if (opts?.code !== undefined) this.code = opts.code;
    if (opts?.data !== undefined) this.data = opts.data;
  }
}
```

### `src/ipc/server.ts` — catch-block code+data propagation

```typescript
} catch (error) {
  const errMessage = error instanceof Error ? error.message : String(error);

  // Phase 86 Plan 02 — propagate optional JSON-RPC code + data from
  // typed domain errors. Falls back to pre-Phase-86 default (-32603 /
  // no data) when the thrown error is a plain Error without these
  // fields, preserving back-compat for every other IPC method.
  const errWithCodeData = error as { code?: unknown; data?: unknown } | null;
  const errCode =
    errWithCodeData !== null && typeof errWithCodeData.code === "number"
      ? errWithCodeData.code
      : -32603;
  const errData =
    errWithCodeData !== null && errWithCodeData.data !== undefined
      ? errWithCodeData.data
      : undefined;

  const errorPayload: { code: number; message: string; data?: unknown } = {
    code: errCode,
    message: errMessage,
  };
  if (errData !== undefined) errorPayload.data = errData;

  const response: IpcResponse = {
    jsonrpc: "2.0",
    id: requestId,
    error: errorPayload,
  };
  socket.write(JSON.stringify(response) + "\n");
}
```

### `src/discord/slash-commands.ts` — /clawcode-status live-model source

```typescript
if (commandName === "clawcode-status") {
  try {
    const effort = this.sessionManager.getEffortForAgent(agentName);
    // Phase 86 MODEL-07 — prefer the live handle's model (may reflect a
    // recent /clawcode-model swap before the YAML write); fall back to
    // the resolved-config alias when the handle reports undefined
    // (fresh boot, no setModel call yet).
    const liveModel = this.sessionManager.getModelForAgent(agentName);
    const configModel =
      this.resolvedAgents.find((a) => a.name === agentName)?.model ??
      "(unknown)";
    const model = liveModel ?? configModel;
    await interaction.editReply(
      `📋 ${agentName}\n🤖 Model: ${model}\n🎚️ Effort: ${effort}`,
    );
  } catch (error) { /* ... */ }
  return;
}
```

## Round-Trip Evidence

Test U1 (`yaml-writer.test.ts`) writes a 3-agent fixture with a top-of-file comment and an inline comment on `name: clawdy`, calls `updateAgentModel({agentName: "clawdy", newModel: "sonnet"})`, then re-parses the bytes:

```yaml
# fleet comment at top
version: 1
defaults:
  model: sonnet
  basePath: ~/.clawcode/agents
agents:
  # clawdy header comment
  - name: clawdy  # personal
    workspace: ~/.clawcode/agents/clawdy
    model: sonnet                      # <-- WAS haiku
    channels:
      - "111"
    mcpServers: []
  - name: alpha
    # ... unchanged ...
```

Test U3 asserts the `# fleet comment at top`, `# clawdy header comment`, and `name: clawdy # personal` inline are all still present. Test U7 re-parses via `configSchema.safeParse(doc.toJS())` and asserts `.success === true`.

## /clawcode-status Reply Snippet

Post-setModel swap (S1 pins this):

```
📋 clawdy
🤖 Model: opus            <-- sourced from getModelForAgent (live handle)
🎚️ Effort: medium
```

Pre-setModel (fresh boot, S2 pins this):

```
📋 clawdy
🤖 Model: sonnet          <-- sourced from resolvedAgents.find().model (fallback)
🎚️ Effort: low
```

## Spy-Test Results — The Regression Pin

`src/manager/__tests__/daemon-set-model.test.ts`:

| Test | Asserts | Status |
|------|---------|--------|
| D1: success — order invariant | setModelForAgent called BEFORE updateAgentModel; persisted:true, note contains 'Live swap + clawcode.yaml updated'; setAllAgentConfigs fires once | PASS |
| D2: allowlist rejection | ModelNotAllowedError → ManagerError.code=-32602 + data.{kind, agent, attempted, allowed}; updateAgentModel NOT called; in-memory config NOT mutated | PASS |
| D3: persistence round-trip | Real updateAgentModel via `vi.importActual`; YAML bytes on disk show `model: sonnet` after call | PASS |
| D4: persist failure, no rollback | updateAgentModel throws EACCES; setModelForAgent still called once; persisted:false, persist_error contains 'EACCES', note contains 'Live swap OK; persistence failed' | PASS |
| D5: agent not found | Throws `Agent 'ghost' not found`; setModelForAgent + updateAgentModel NOT called | PASS |

**5/5 green.**

`src/discord/__tests__/slash-commands-status-model.test.ts`:

| Test | Asserts | Status |
|------|---------|--------|
| S1: live handle wins | getModelForAgent called with 'clawdy'; reply contains '🤖 Model: opus' (live); no '🤖 Model: haiku' (static config) | PASS |
| S2: fallback to resolved-config | getModelForAgent returns undefined; reply contains '🤖 Model: sonnet' (from resolvedAgents.find().model) | PASS |

**2/2 green.**

`src/migration/__tests__/yaml-writer.test.ts` (new tests only):

| Test | Asserts | Status |
|------|---------|--------|
| U1: update happy path | outcome='updated'; targetSha256 is 64-char hex; clawdy.model=sonnet, alpha/beta unchanged | PASS |
| U2: idempotent no-op | outcome='no-op'; bytes byte-identical pre/post | PASS |
| U3: comment preservation | top-of-file + header + inline comments all present post-update | PASS |
| U4: agent not found | outcome='not-found'; bytes unchanged | PASS |
| U5: file not found | outcome='file-not-found'; reason matches /not found/i | PASS |
| U6: rename failure | throws EACCES; tmp path matches `.clawcode.yaml.<pid>.<ts>.tmp` and was unlinked | PASS |
| U7: round-trip schema | configSchema.safeParse(parseYaml(after)).success === true | PASS |
| U8: invalid alias | outcome='refused', step='invalid-model'; bytes unchanged | PASS |

**8/8 green.**

## Non-Rollback Policy

When `updateAgentModel` throws after `setModelForAgent` succeeded:

- **We do NOT** attempt a second `setModelForAgent` call to revert to `oldModel`. That would race with the agent's next turn (the SDK swap has already applied to the live `Query` — rolling back needs a second Promise round-trip that can't be synchronized with the turn iterator).
- **We do NOT** re-throw the persistence error. The live swap succeeded and is visible to the next turn via `getModelForAgent`.
- **We surface `persisted: false` + `persist_error` in the response.** Operator sees the error in the Discord reply / CLI output. Reconciliation is operator-driven: either fix the YAML by hand (e.g., resolve a rename EACCES) or re-invoke `/clawcode-model <alias>`.

Rationale: the live SDK swap is the consequential action the operator requested (the agent's next turn uses the new model). Persistence is a durable side-effect for the NEXT daemon boot — losing it is recoverable, partial-rollback is not.

## Files Created/Modified

### Created
- `src/manager/__tests__/daemon-set-model.test.ts` (~290 lines) — 5 D-tests for handleSetModelIpc via module-level `vi.mock` of `updateAgentModel`.
- `src/discord/__tests__/slash-commands-status-model.test.ts` (~180 lines) — 2 S-tests for `/clawcode-status` MODEL-07 live handle source + fallback.

### Modified (production)
- `src/migration/yaml-writer.ts` — added `updateAgentModel` (~110 lines): 5-outcome result type, modelSchema defense-in-depth, Document AST mutation, atomic temp+rename. Added `import { modelSchema } from "../config/schema.js"`.
- `src/manager/daemon.ts` — added `handleSetModelIpc` exported helper (~130 lines) + `SetModelIpcManager`/`SetModelIpcDeps`/`SetModelIpcResult` types. Refactored `case "set-model":` to 10-line delegation. Added imports: `updateAgentModel`, `ModelNotAllowedError`.
- `src/shared/errors.ts` — extended `ManagerError` with optional `{code, data}` payload.
- `src/ipc/server.ts` — extended handleMessage catch block to propagate `error.code` + `error.data` (defaults preserve pre-86 behaviour for every other method).
- `src/discord/slash-commands.ts` — `/clawcode-status` sources model from `sessionManager.getModelForAgent(agentName)` with resolved-config fallback.

### Modified (tests)
- `src/migration/__tests__/yaml-writer.test.ts` — added `updateAgentModel` import + `describe("updateAgentModel — Phase 86 Plan 02 (Tests U1-U8)", ...)` block with 8 tests.
- `src/discord/__tests__/slash-commands-status-effort.test.ts` — Rule 3 blocking fix: added `getModelForAgent` stub to the two positive-path SessionManager fixtures (new call site in slash-commands.ts broke 2 of 5 pre-existing tests).

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **`updateAgentModel` lives in `yaml-writer.ts`** — Phase 78's writer is the single owner of `clawcode.yaml` atomic mutation. No parallel pipeline.
2. **Non-rollback on persistence failure** — live SDK swap is irreversible from client space; partial-state response + operator reconciliation beats a race-prone double-setModel.
3. **Pure exported `handleSetModelIpc`** — first application of the blueprint. Phase 87 `setPermissionMode` will follow the same shape: export a DI'd async helper from daemon.ts, test the contract, delegate from the switch case.
4. **Back-compat `ManagerError`** — optional `{code, data}` so 70+ existing throws keep their `-32603` / no-data mapping. IPC server.ts reads `error.code` as sentinel (safer than instanceof across bundlers).
5. **Defense-in-depth `modelSchema` in the writer** — daemon validates first but the writer is a module-level API. Clean `refused + step: "invalid-model"` beats runtime YAML corruption if a future caller bypasses the daemon.
6. **Mirror in-memory `configs[idx]` AFTER persist attempt** — ensures post-restart consistency. Frozen-copy pattern matches CLAUDE.md immutability.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended Phase 83 `slash-commands-status-effort.test.ts` fixtures with `getModelForAgent` stubs**
- **Found during:** Task 2 GREEN (post-edit test run)
- **Issue:** Plan 02's change to source `/clawcode-status` model from `sessionManager.getModelForAgent(agentName)` (MODEL-07) broke 2 of 5 pre-existing Phase 83 tests. Those tests constructed a minimal `SessionManager` stub with ONLY `getEffortForAgent`; the new call site threw `this.sessionManager.getModelForAgent is not a function` and fell through to the catch branch.
- **Fix:** Added `const getModelForAgent = vi.fn().mockReturnValue(undefined)` and included it in the `sessionManager` stub object for the two positive-path test cases. The third test (graceful failure when getEffortForAgent throws) was unaffected — getEffortForAgent is called first, so the throw triggers the catch before getModelForAgent is reached.
- **Files modified:** `src/discord/__tests__/slash-commands-status-effort.test.ts` (4 lines added across two fixtures)
- **Verification:** 5/5 Phase 83 EFFORT-07 tests still green; 2/2 new Phase 86 MODEL-07 tests green.
- **Committed in:** `bf4eef2` (Task 2 GREEN)

---

**Total deviations:** 1 auto-fixed (Rule 3 - Blocking — direct cascade from the MODEL-07 call site addition).
**Impact on plan:** Zero scope creep. Unavoidable test cascade from extending the `/clawcode-status` contract. Two 1-line stubs added to the Phase 83 test file; all semantics preserved.

## Issues Encountered

- **Pre-existing `src/ipc/__tests__/protocol.test.ts > IPC_METHODS > includes all required methods`** — failure pre-dates Plan 02. Phase 85 added `list-mcp-status` to `IPC_METHODS` but the exact-match assertion in the protocol test wasn't updated. Verified pre-existing via `git stash` of my `ipc/server.ts` changes — same 17/18 pass rate on pristine state. Out of scope for Plan 02; belongs to a future Phase 85 follow-up or quick task.
- **38 pre-existing TS errors** — identical count pre/post Plan 02. All predate (image/types.ts `ImageProvider` export, session-manager WarmPathResult mismatches, budget.ts type comparison, etc.) per STATE.md Phase 85 and Phase 86 Plan 01 records. None touch Plan 02 code.

## User Setup Required

None — no external service configuration required. Zero new npm deps.

## Known Stubs

None. Every new code path is wired to real production code:
- `updateAgentModel` is called by the live `handleSetModelIpc` delegation from `case "set-model":`.
- `handleSetModelIpc` is called by the real daemon IPC dispatcher (not a mock entry point).
- `/clawcode-status` reads from the real `sessionManager.getModelForAgent` (Plan 01's live handle).
- `ManagerError.{code, data}` fields are read by the real `ipc/server.ts` catch block (not a shim).
- IPC error payloads with `data.kind === "model-not-allowed"` are consumed by Plan 03's `/clawcode-model` handler (next plan in this phase) — the contract is published here, read there.

## Next Phase Readiness

- **Plan 03 (/clawcode-model slash command) is unblocked.** The IPC `set-model` method now:
  - Returns `{agent, old_model, new_model, persisted, persist_error, note}` on success (Plan 03's confirm embed reads these directly).
  - Throws `ManagerError` with `code=-32602` + `data.allowed` on allowlist violation (Plan 03's ephemeral error renderer reads `data.allowed`).
  - Persists survives daemon restart — `/clawcode-status` after a restart still shows the new model.
- **Phase 87 setPermissionMode pattern confirmed.** `handleSetModelIpc` is the second application of the Phase 83 spy-test-first pattern and the FIRST application of the pure-exported-IPC-handler blueprint. Phase 87 `handleSetPermissionModeIpc` follows the same shape: export from daemon.ts, DI the SessionManager surface + configPath, extract the case to a 5-line delegation.
- **Zero npm churn.** v2.2 milestone still runs on existing stack (SDK 0.2.97, yaml 2.x, zod 4.3.6, vitest 4.1.3).

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/manager/__tests__/daemon-set-model.test.ts`
- FOUND: `src/discord/__tests__/slash-commands-status-model.test.ts`
- FOUND: commit `703d852` (Task 1 RED)
- FOUND: commit `d1ec136` (Task 1 GREEN)
- FOUND: commit `2eab504` (Task 2 RED)
- FOUND: commit `bf4eef2` (Task 2 GREEN)
- FOUND: `updateAgentModel` in `src/migration/yaml-writer.ts` (2 refs: function + export type)
- FOUND: `updateAgentModel` in `src/manager/daemon.ts` (4 refs: import + 3 in handleSetModelIpc)
- FOUND: `ModelNotAllowedError` in `src/manager/daemon.ts` (6 refs: import + instanceof branch + typed-error mapping)
- FOUND: `handleSetModelIpc` in `src/manager/daemon.ts` (production + test imports)
- FOUND: `getModelForAgent` in `src/discord/slash-commands.ts` (1 ref — MODEL-07 call site)
- NOT FOUND: `"Takes effect on next session"` in `src/manager/daemon.ts` (0 refs — lie retired)
- FOUND: 15 new Plan 02 tests (8 U + 5 D + 2 S) all GREEN
- FOUND: zero new TS errors (38 pre/post — identical to Phase 86 Plan 01)
- FOUND: 201/201 adjacent tests across 19 files still GREEN

---
*Phase: 86-dual-discord-model-picker-core*
*Completed: 2026-04-21*
