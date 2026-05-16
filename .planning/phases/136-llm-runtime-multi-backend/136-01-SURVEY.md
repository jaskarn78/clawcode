# Phase 136 Plan 01 — SDK call-site survey (T-01)

**Date:** 2026-05-15
**Plan:** 136-01
**Purpose:** Enumerate every `@anthropic-ai/claude-agent-sdk` reference under `src/` so T-02..T-06 know what to migrate vs leave alone. Drives the migration grouping in T-04 and the static-grep regex in T-06.

## Findings at a glance

- **Total references** under `src/` (incl. tests, comments): **31** matches
- **Non-test, non-comment** references: **8** files, **~13** lines
- **Runtime dynamic-import sites:** **4** (the actual chokepoints)
- **Type-only imports:** **3** (no runtime impact; static-grep must exempt or re-export)
- **Existing in-repo abstraction:** `src/manager/sdk-types.ts` already defines `SdkModule`, `SdkQuery`, `SdkQueryOptions`, etc. Phase 136 wraps these, doesn't recreate them.

## Inventory — runtime call sites (4)

These are the actual `await import("@anthropic-ai/claude-agent-sdk")` sites that must move behind the seam.

| # | File:line | Code | Usage after import | Migration cluster |
|---|-----------|------|--------------------|-------------------|
| 1 | `src/manager/session-adapter.ts:1418` | `const sdk = await import("@anthropic-ai/claude-agent-sdk")` inside `loadSdk()` (lines 1407–1426) | Cached → returned as `SdkModule`. Two interior callers (lines 1103, 1251) invoke `sdk.query(...)` and pass `sdk` into `createPersistentSessionHandle` / `createSessionAdapter`. | **A** — primary executor query path |
| 2 | `src/manager/daemon.ts:3408` | `const sdk = await import("@anthropic-ai/claude-agent-sdk")` inside the heartbeat auto-compaction trigger closure (`setCompactSessionTrigger`) | Used ONLY for `sdk.forkSession(id, opts)` on line 3526. | **B** — compaction forkSession (auto) |
| 3 | `src/manager/daemon.ts:10743` | `const sdk = await import("@anthropic-ai/claude-agent-sdk")` inside the `compact-session` IPC handler case | Used ONLY for `sdk.forkSession(id, opts)` on line 10867. | **B** — compaction forkSession (IPC) — same cluster as #2 |
| 4 | `src/openai/endpoint-bootstrap.ts:239` | `const imported = (await import("@anthropic-ai/claude-agent-sdk")) as unknown as SdkModule` inside `endpoint-bootstrap`'s template-driver wiring | Passed to `createOpenClawTemplateDriver({ sdk: templateSdk, ... })` (template transient sessions). | **C** — openclaw template driver |

**All 4 sites already cast / type the result as `SdkModule`** — the in-repo abstraction. Phase 136 introduces `LlmRuntimeService` that wraps `SdkModule` (or returns one) and routes the 4 sites through a single factory.

## Inventory — type-only imports (3)

These import only TypeScript types (compile-time only). They do NOT invoke the SDK at runtime and are NOT a seam bypass — but the naive static-grep regex catches them.

| # | File:line | Import | Why |
|---|-----------|--------|-----|
| 5 | `src/manager/detached-spawn.ts:45` | `import type { SpawnOptions as SdkSpawnOptions, SpawnedProcess as SdkSpawnedProcess } from "@anthropic-ai/claude-agent-sdk"` | Structural spawn wrapper type-signatures only (FIND-123-A.next). |
| 6 | `src/manager/persistent-session-handle.ts:67` | `import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"` | Phase 999.4 rate-limit telemetry type. |
| 7 | `src/usage/rate-limit-tracker.ts:23` | `import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"` | Same rate-limit type, consumed by the tracker. |

**Decision (per advisor reconciliation):** narrow the T-06 static-grep regex to exclude `import type` and comments. Re-exporting SDK types through `src/llm-runtime/index.ts` is a Phase 137 polish (less churn now, faster ship under hard deadline).

## Inventory — comment-only mentions (5)

Not actual imports. The static-grep regex must ignore lines starting with `*` (JSDoc) and lines containing `//`.

| File:line | Why it shows up |
|-----------|-----------------|
| `src/advisor/backends/anthropic-sdk.ts:28,75` | JSDoc citing `sdk.d.ts` path for the advisor-tool wiring. |
| `src/manager/resolve-output-dir.ts:6` | JSDoc citing the existing static-grep regression: `! grep -E "from \"node:fs|from \"@anthropic-ai/claude-agent-sdk" src/manager/resolve-output-dir.ts`. Phase 96 precedent — same anti-bypass mechanism the new test mirrors. |
| `src/manager/sdk-types.ts:8,49,67,107,117,260,268,276,284,297` | Migration notes pinning to the SDK version mirrored. |
| `src/openai/types.ts:331` | JSDoc note. |
| `src/mcp/json-rpc-call.ts:13` | JSDoc citing sdk.d.ts. |
| `src/manager/persistent-session-handle.ts:179` | JSDoc parameter description (not the import statement). |

## Inventory — test files (excluded from migration; vi.mock the package directly)

| File | Use |
|------|-----|
| `src/manager/__tests__/session-adapter.test.ts` (lines 11, 17) | `vi.mock("@anthropic-ai/claude-agent-sdk", () => ({...}))` — test infrastructure. Allowed by plan. |
| `src/usage/__tests__/rate-limit-tracker.test.ts:13` | type-only test import of `SDKRateLimitInfo`. Allowed. |
| `src/discord/__tests__/subagent-recursion-guard.test.ts:32,287,292` | comment + `vi.mock` — allowed. |

## Migration order (drives T-04)

1. **T-02 first** — create the `src/llm-runtime/` package skeleton (types.ts + service.ts + index.ts) WITHOUT touching consumers. Re-export `SdkModule`/`SdkQuery`/`SdkQueryOptions` through the barrel so consumers can later import from there.
2. **T-03** — extract `AnthropicAgentSdkBackend` (wraps the actual `await import(...)` call). Same cache semantics as `session-adapter.ts:loadSdk` so we don't introduce per-agent re-imports. Add `portable-fork.ts` scaffold.
3. **T-04 cluster A (session-adapter)** — replace `loadSdk()` inside `session-adapter.ts` with a deps-injected `LlmRuntimeService.loadSdk()` call. Single chokepoint at the existing `loadSdk()` site.
4. **T-04 cluster B (daemon compaction)** — replace the two `await import(...)` calls in `daemon.ts:3408` and `10743` with `llmRuntime.loadSdk()` (or threaded through whatever singleton the daemon owns).
5. **T-04 cluster C (openclaw template driver)** — replace `endpoint-bootstrap.ts:239` similarly.
6. **T-05** — add `llmRuntime.backend` Zod field + resolver default + `ResolvedAgentConfig.llmRuntime` + NON_RELOADABLE_FIELDS classification.
7. **T-06** — wire the factory at agent boot in `daemon.ts` + add the static-grep CI test + add backend behavior tests.

**Per-task commit (operator hard rule):** ONE commit per task ID. T-04 produces ONE commit covering all three sub-clusters, not three commits. Plan-internal "commit each call site migration in its OWN atomic commit" guidance overridden by user hard rule. Noted as deviation in SUMMARY.

## Interface shape (load-bearing decision, locked here)

**The seam returns/exposes an `SdkModule`-shaped object, not a flattened service.** Rationale:

- The SDK's `Query` object carries stateful mutators (`setModel`, `setMaxThinkingTokens`, `setPermissionMode`, `interrupt`, `close`, `streamInput`, `mcpServerStatus`, `setMcpServers`, `initializationResult`, `supportedCommands`). These are per-conversation state, not service-level. Flattening them into a service singleton would break the existing call sites in `persistent-session-handle.ts` (setEffort, setModel, setPermissionMode, getSupportedCommands, etc.) which all hold a `Query` reference.
- `sdk-types.ts` already does the abstraction. Phase 136 wraps the dispatch, not the per-Query shape.
- `forkSession` is called on the imported module (`sdk.forkSession`) in daemon.ts but is NOT declared in `SdkModule` (line 308–310 only declares `query`). Phase 136 adds `forkSession` to the seam's exported `SdkModule`-compatible interface (`LlmRuntimeSdkModule`) so the daemon sites stop casting through `any`.

**Naming (provider-neutral):** keep `SdkModule` / `SdkQuery` / `SdkQueryOptions` names available as re-exports for back-compat; the new seam adds `LlmRuntimeService` as the entry point. Phase 141 (Codex) and Phase 142 (OpenRouter) will fan out into their own backends that adapt to or from the `SdkModule`-compatible shape; impedance mismatch is Phase 141's problem, not Phase 136's. Aligned with the plan's "claude's discretion" §.

## Static-grep regex (T-06 pre-decision)

```bash
# Reject only RUNTIME imports outside the backend file.
# Excludes: `import type ...`, JSDoc lines, vi.mock test infrastructure.
OFFENDERS=$(grep -rn '@anthropic-ai/claude-agent-sdk' src/ --include='*.ts' \
  | grep -v '__tests__' \
  | grep -vE ':\s*\*' \
  | grep -vE '^[^:]+:[0-9]+:\s*//' \
  | grep -vE 'import type ' \
  | grep -v 'src/llm-runtime/backends/anthropic-agent-sdk.ts')
```

Allowed in production: zero matches.

## Open questions resolved

- **Q:** Does `SdkModule` flow through `deps` into other files beyond the 4 import sites? **A:** Yes — `session-adapter.ts:1566, 2415`, `persistent-session-handle.ts:191`, `openai/__tests__/template-driver.test.ts` consume an `SdkModule` parameter. These are NOT direct SDK imports (they receive it via DI) and stay as-is. Phase 136 changes the construction, not the consumption.
- **Q:** Does Phase 136 need to widen `SdkModule` to include `forkSession`? **A:** Yes — currently the daemon sites cast through `any`. Plan 01 T-02 adds `forkSession` to the seam's exported type so the daemon stops casting.
- **Q:** Does `loadSdk()` cache survive the seam? **A:** Yes — `AnthropicAgentSdkBackend` keeps a module-level singleton cache identical to `session-adapter.ts:cachedSdk`. The factory at daemon boot creates one backend instance per agent, but they all share the same underlying module reference (Node ESM caches dynamic-import results anyway).
