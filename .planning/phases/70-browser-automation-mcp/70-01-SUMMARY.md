---
phase: 70-browser-automation-mcp
plan: 01
subsystem: browser-automation
tags: [playwright, chromium, readability, jsdom, zod, storage-state, singleton]

# Dependency graph
requires:
  - phase: 56-warm-path-optimizations
    provides: embedder warm() singleton pattern (src/memory/embedder.ts) — BrowserManager.warm() mirrors this shape exactly
  - phase: 52-prompt-caching
    provides: zod/v4 + defaults schema composition — browserConfigSchema slots under defaults.browser the same way heartbeat/threads do
provides:
  - Playwright + Readability + jsdom runtime deps pinned in package.json
  - defaults.browser config schema with 8 validated fields + sensible defaults
  - src/browser/{types,errors,storage-state,manager}.ts — frozen contracts for Plan 02 tool handlers and Plan 03 daemon wire-up
  - BrowserManager singleton (warm/getContext/saveAgentState/saveAgentStateNow/close) with Option 2 architecture (shared Browser + per-agent storageState newContext)
  - Atomic storageState persistence (.tmp + rename, indexedDB:true, debounced 5s saver)
  - Pitfall 1 + Pitfall 2 guards enforced by grep — locked architecture
affects: [70-02-mcp-tool-handlers, 70-03-daemon-warm-path-cli, 71-web-search-mcp, 72-image-generation-mcp]

# Tech tracking
tech-stack:
  added: [playwright-core@^1.59.1, "@playwright/browser-chromium@^1.59.1", "@mozilla/readability@^0.6.0", jsdom@^29.0.2, "@types/jsdom@^28.0.1"]
  patterns:
    - "Resident-singleton warm pattern parallels src/memory/embedder.ts warmPromise idempotence"
    - "DI driver seam (BrowserDriver interface) so manager tests run without real Chromium"
    - "Atomic .tmp → rename persistence with Pitfall 10 zero-byte guard"
    - "Debounced best-effort save + explicit shutdown-path saveAgentStateNow"
    - "Option 2 architecture (launch() + newContext({ storageState })) — NOT persistent-profile launch (Pitfall 1 locked by grep guard)"

key-files:
  created:
    - src/browser/types.ts — BrowserToolResult/Error/Outcome envelopes, AgentContextHandle, BrowserLogger, BrowserContext re-export
    - src/browser/errors.ts — BROWSER_ERROR_TYPES taxonomy, BrowserError class, toBrowserToolError normalizer
    - src/browser/storage-state.ts — loadState, saveState, makeDebouncedSaver
    - src/browser/manager.ts — BrowserManager singleton (333 lines)
    - src/browser/__tests__/storage-state.test.ts — 12 test cases
    - src/browser/__tests__/manager.test.ts — 17 test cases with mock driver
  modified:
    - package.json — 4 new runtime deps + @types/jsdom devDep
    - package-lock.json — resolved versions
    - README.md — one-time `npx playwright install chromium --only-shell` note
    - src/config/schema.ts — browserConfigSchema exported, wired under defaults.browser
    - src/config/__tests__/schema.test.ts — 16 new test cases for browserConfigSchema

key-decisions:
  - "Option 2 architecture locked via grep guards: shared chromium.launch() + per-agent browser.newContext({ storageState }) — NOT persistent-profile launch (Pitfall 1 from 70-RESEARCH.md). grep guard in src/browser/ returns nothing."
  - "Pitfall 2 guard locked: empty launch args — Chromium user-namespace sandbox stays enabled because the daemon runs as non-root clawcode. grep -- '--no-sandbox' in src/browser/ returns nothing."
  - "headless config field is boolean (not Playwright's deprecated 'new' string) — 70-RESEARCH confirmed 1.59 accepts true/false."
  - "maxScreenshotInlineBytes hard-ceilings at 5 MiB (Claude vision inline cap per Pitfall 7); 0 is a valid 'never inline' sentinel."
  - "Debounce window defaults to 5000 ms (70-RESEARCH Q4 recommendation). Tests use a short 50 ms window to stay fast with real timers — fake timers don't cooperate with the fs microtask chain inside saveState."
  - "BrowserDriver / BrowserLike / NewContextOptions exported from manager.ts so Plan 02 tool tests can reuse the same DI seam."
  - "null userAgent → leave undefined at the Playwright boundary so its default UA applies. Only set the field when a caller explicitly overrides."
  - "sessionStorage is NOT persisted by design — per web spec, sessionStorage is ephemeral. Cookies + localStorage + IndexedDB persist via storageState({ indexedDB: true })."

patterns-established:
  - "src/browser/ module layout — types.ts, errors.ts, storage-state.ts, manager.ts, __tests__/ — every file stays under the CLAUDE.md 400-line target (max is manager.ts at 333 lines)"
  - "Mock driver pattern for Playwright-adjacent tests: tests inject BrowserDriver/BrowserLike via DI rather than mocking the playwright-core module — keeps manager.test.ts hermetic"
  - "Frozen tool-result envelopes (Object.freeze on both outer ok/error object and inner .error sub-object) — immutability guarantee for agent-facing data"
  - "Atomic persistence: write to <path>.tmp → rename. Caller best-effort unlinks stale .tmp on entry (crash-from-prior-run guard)"

requirements-completed: [BROWSER-06]

# Metrics
duration: 15min
completed: 2026-04-19
---

# Phase 70 Plan 01: Browser Manager Foundation Summary

**Playwright-backed resident-singleton BrowserManager with per-agent storageState persistence, locked Option 2 architecture (shared Chromium + per-agent BrowserContext), and frozen type/error contracts consumed by Plan 02/03.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-19T00:49:38Z
- **Completed:** 2026-04-19T01:05:12Z
- **Tasks:** 3/3
- **Files modified:** 9 (5 new source, 2 new tests, 2 modified config/docs)

## Accomplishments

- Pinned 4 runtime deps (playwright-core, @playwright/browser-chromium, @mozilla/readability, jsdom) + @types/jsdom devDep. `npx playwright install chromium --only-shell` ran successfully on the workstation — chromium_headless_shell-1217 now present alongside the prior 1208 cache.
- `browserConfigSchema` lives under `defaults.browser` with 8 fields (enabled, headless, warmOnBoot, navigationTimeoutMs, actionTimeoutMs, viewport, userAgent, maxScreenshotInlineBytes) — every value bounded, defaulted, and round-trips through `configSchema.safeParse`.
- `BrowserManager` singleton with warm() / getContext() / saveAgentState() / saveAgentStateNow() / close() and the exact Pitfall 10 ordering (save-before-close) test-pinned.
- 29 new passing tests (12 storage-state + 17 manager). Full suite: **2629 tests green** (2600 before + 29 new).
- Zero new TS errors in `src/browser/` or `src/config/`.
- Grep-enforced locked architecture: `launchPersistentContext` returns nothing; `--no-sandbox` returns nothing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Playwright deps + browserConfigSchema** — `c630aa2` (feat)
2. **Task 2: types + errors + storage-state helpers** — `e6c4522` (feat)
3. **Task 3: BrowserManager singleton + mock-driver tests** — `6283897` (feat)

## Files Created/Modified

### Created
- `src/browser/types.ts` (84 lines) — `BrowserToolResult<T>`, `BrowserToolError`, `BrowserToolOutcome<T>`, `AgentContextHandle`, `BrowserLogger` interface, `BrowserContext` re-export.
- `src/browser/errors.ts` (91 lines) — `BROWSER_ERROR_TYPES` const array (timeout, element_not_found, navigation_failed, launch_failed, invalid_argument, internal), `BrowserError` class, `toBrowserToolError` normalizer.
- `src/browser/storage-state.ts` (126 lines) — `loadState`, `saveState`, `makeDebouncedSaver`.
- `src/browser/manager.ts` (333 lines) — `BrowserManager` class + exported DI types `BrowserDriver`, `BrowserLike`, `NewContextOptions`, `BrowserManagerOpts`.
- `src/browser/__tests__/storage-state.test.ts` (12 tests) — loadState/saveState/debounce behavior including Pitfall 10 zero-byte guard.
- `src/browser/__tests__/manager.test.ts` (17 tests) — warm idempotence, parallel warm, probe hard-fail, launch hint, cache/purge, debounce collapse, save-before-close ordering, per-agent failure isolation, idempotent close.

### Modified
- `package.json` — added `@mozilla/readability@^0.6.0`, `@playwright/browser-chromium@^1.59.1`, `jsdom@^29.0.2`, `playwright-core@^1.59.1` (deps); `@types/jsdom@^28.0.1` (devDeps).
- `package-lock.json` — 40 new packages installed.
- `src/config/schema.ts` — `browserConfigSchema` export + wired under `defaultsSchema` Zod object and the literal defaults inside `configSchema`.
- `src/config/__tests__/schema.test.ts` — 16 new test cases.
- `README.md` — one-paragraph first-install note in the Install section.

## `browserConfigSchema` Field List

| Field | Type | Default | Bounds |
|---|---|---|---|
| `enabled` | boolean | `true` | — |
| `headless` | boolean | `true` | — (boolean form only; Playwright 1.59 maps `true` to new-headless) |
| `warmOnBoot` | boolean | `true` | — |
| `navigationTimeoutMs` | int | `30000` | 1000..600000 |
| `actionTimeoutMs` | int | `10000` | 100..300000 |
| `viewport.width` | int | `1280` | 320..7680 |
| `viewport.height` | int | `720` | 240..4320 |
| `userAgent` | string \| null | `null` | — |
| `maxScreenshotInlineBytes` | int | `524288` (512 KiB) | 0..5242880 (5 MiB) |

## `BrowserManager` Public API (frozen contract for Plan 02/03)

```typescript
export class BrowserManager {
  constructor(opts?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    userAgent?: string | null;
    log?: BrowserLogger;
    driver?: BrowserDriver;        // DI seam for tests
    debounceMs?: number;            // default 5000
  });

  warm(): Promise<void>;                // idempotent via warmPromise; resets on failure
  isReady(): boolean;                   // this.browser !== null
  getContext(agent: string, workspace: string): Promise<BrowserContext>;
  saveAgentState(agent: string): void;                  // debounced 5s, no-op on unknown agent
  saveAgentStateNow(agent: string): Promise<void>;      // shutdown-path, throws on failure
  close(): Promise<void>;               // Pitfall 10 order: save every agent → close every ctx → close browser
}

// DI types also exported so Plan 02 tool tests can reuse the seam.
export interface BrowserDriver { launch(opts): Promise<BrowserLike>; }
export interface BrowserLike { newContext(opts): Promise<BrowserContext>; close(): Promise<void>; }
export interface NewContextOptions { storageState?: string; viewport?: ...; userAgent?: string; }
```

## Runtime Dependency Versions (pinned)

Resolved via `npm install`:

| Package | Requested | Resolved (lockfile) |
|---|---|---|
| `playwright-core` | `^1.59.1` | 1.59.1 |
| `@playwright/browser-chromium` | `^1.59.1` | 1.59.1 |
| `@mozilla/readability` | `^0.6.0` | 0.6.0 |
| `jsdom` | `^29.0.2` | 29.0.2 |
| `@types/jsdom` (devDep) | `^28.0.1` | auto-resolved by npm |

Chromium browser binary: `chromium_headless_shell-1217` at `~/.cache/ms-playwright/` (installed via `npx playwright install chromium --only-shell`; no sudo needed — system libs already present on the dev box).

## Architecture Enforcement (Pitfalls 1 + 2 + 10)

- **Pitfall 1 (persistent-profile trap):** `grep -rn "launchPersistentContext" src/browser/` returns **nothing**. Option 2 (`chromium.launch()` + `newContext({ storageState })`) is the only pattern that can share a Browser across N agents. Verified post-commit.
- **Pitfall 2 (sandbox-disable trap):** `grep -rn -- "--no-sandbox" src/browser/` returns **nothing**. Launch args = `[]`; the daemon runs as non-root `clawcode` so the user-namespace sandbox works.
- **Pitfall 10 (write-during-close race):** `close()` ordering is test-pinned: for every cached agent, `saveAgentStateNow(agent)` fires BEFORE `ctx.close()`. Per-agent save failures are logged at `warn` and swallowed so shutdown always reaches `browser.close`. The Pitfall 10 test records event ordering via a shared `order` array and asserts `storageState:ctxN` appears before `close:ctxN` for every agent context.

## `sessionStorage` Note

Option 2 persists cookies + localStorage + IndexedDB via `context.storageState({ path, indexedDB: true })`. `sessionStorage` is **NOT** persisted — per web spec, `sessionStorage` is ephemeral by definition (tab/session-bounded, cleared on context close). This is the intended tradeoff of the shared-Browser architecture; no real loss because sessionStorage-backed auth is rare and always-re-created-on-page-load.

## CLAUDE.md Conventions Observed

- **Zod v4:** imported as `zod/v4` to match existing project convention.
- **Many small files:** 4 source files (84 / 91 / 126 / 333 lines) — all well under the 400-line target.
- **Immutable data:** `toBrowserToolError` returns `Object.freeze`d envelopes with nested frozen `error` sub-objects.
- **ESM .js imports:** every internal import uses the `.js` extension (`./errors.js`, `./types.js`, `./storage-state.js`).
- **Error handling:** no silent swallowing at the tool-handler boundary — save-path errors wrap in `BrowserError("internal", ..., { cause })` preserving stack traces. Debounced-save errors ARE swallowed at the saver level (intentional: best-effort contract per 70-RESEARCH Q4) but logged with structured context.
- **Input validation:** config fields validated at the Zod boundary; no free-floating numeric literals — every bound comes from 70-CONTEXT.md / 70-RESEARCH.md.

## Non-Regression Confirmation

- `git diff --name-only HEAD~3 HEAD -- src/discord/` → empty (v1.7 Discord bridge untouched).
- `git diff --name-only HEAD~3 HEAD -- src/manager/` → empty (daemon untouched; Plan 03 work, not this plan).
- `git diff --name-only HEAD~3 HEAD -- src/mcp/` → empty (MCP server untouched; Plan 02 work, not this plan).
- `npm test` → **2629 tests green** (2600 before this plan + 29 new).
- `npx tsc --noEmit` → zero new errors in `src/browser/` or `src/config/` (pre-existing TS errors in unrelated files: `src/memory/__tests__/graph.test.ts`, `src/tasks/task-manager.ts`, `src/triggers/__tests__/engine.test.ts`, `src/usage/` — all out of scope per SCOPE BOUNDARY rule).

## Decisions Made

See frontmatter `key-decisions`. Highlights:

- **Option 2 locked by grep.** CONTEXT.md's "one Chromium, N persistent contexts" phrasing was architecturally impossible (Pitfall 1 from 70-RESEARCH.md). Shipped Option 2 per the research recommendation; shared Browser + per-agent `newContext({ storageState })` with `indexedDB: true` covers the cookies + localStorage + IndexedDB survival that BROWSER-06 cares about. sessionStorage is NOT persisted (ephemeral per web spec).
- **DI driver seam for tests.** `BrowserDriver` / `BrowserLike` / `NewContextOptions` types are exported from `src/browser/manager.ts` so manager tests run hermetically against a mock driver — no real Chromium needed at test time. Matches the embedder.ts pattern: dynamic `await import("playwright-core")` inside `warm()` so module load stays cheap.
- **Debounce test uses real timers with a 50 ms window.** Fake timers (`vi.useFakeTimers`) don't cooperate with the real-fs microtask chain inside `saveState` (mkdir → unlink → storageState → rename are all real async). The 50 ms window + `setTimeout(120)` wait keeps the test fast and deterministic.
- **DO NOT change `headless` to a string.** CONTEXT.md's draft mentioned `"new"` but Playwright 1.59 only accepts the boolean form — this is commented explicitly in `browserConfigSchema`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest 4 reporter flag migration**
- **Found during:** Task 1 verification (`npx vitest run --reporter=basic`)
- **Issue:** Vitest 4.1 removed the `basic` reporter. The plan's verification commands worked on Vitest 3.x only.
- **Fix:** Switched to `--reporter=default` for all vitest runs in this execution. The plan's literal `--reporter=verbose` command still works; the acceptance commands in the plan body are unchanged. Documented here for future plan writers.
- **Files modified:** none (test commands only)
- **Verification:** tests ran with `default` reporter producing clear pass/fail output.
- **Committed in:** no separate commit — process-level change only.

**2. [Rule 3 - Blocking] `launchPersistentContext` / `--no-sandbox` appeared in comments**
- **Found during:** Task 3 acceptance grep
- **Issue:** The grep acceptance criteria demand `grep "launchPersistentContext" src/browser/` return NOTHING, but my first drafts referenced these strings in explanatory comments (explaining why we DON'T use them).
- **Fix:** Reworded comments in `src/browser/manager.ts` and `src/browser/storage-state.ts` to describe the forbidden pattern without using the literal string — "persistent-profile launch" and "disable the Chromium sandbox via launch flags" convey the meaning without triggering the grep guards.
- **Files modified:** src/browser/manager.ts, src/browser/storage-state.ts (comments only; no behavior change).
- **Verification:** `grep -rn "launchPersistentContext" src/browser/` and `grep -rn -- "--no-sandbox" src/browser/` both return nothing (exit code 1).
- **Committed in:** included in Task 2 + Task 3 commits (normal commits).

**3. [Rule 3 - Blocking] TypeScript narrowing on test closure variable**
- **Found during:** Task 2 typecheck
- **Issue:** `let resolveSave: (() => void) | null = null` + `resolveSave?.();` later in the test triggered TS2349 because the TS control-flow analyzer couldn't verify the closure assignment.
- **Fix:** Replaced the single-resolver closure with an `Array<() => void>` and iterated it — no narrowing ambiguity.
- **Files modified:** src/browser/__tests__/storage-state.test.ts
- **Verification:** `npx tsc --noEmit` shows zero errors in `src/browser/`.
- **Committed in:** Task 2 commit (`e6c4522`).

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All three were mechanical fixes — no scope change, no architectural drift. Option 2 architecture shipped exactly as locked in 70-CONTEXT.md + 70-RESEARCH.md.

## Issues Encountered

- **Vitest 4 reporter flag change** — minor; see deviation 1.
- **One test file's fake-timers approach didn't play well with the fs microtask chain** — resolved by switching to real timers with a short 50 ms debounce window. Documented in the debounce test.

## User Setup Required

None — all setup is documented in the README first-install paragraph (`npx playwright install chromium --only-shell` + optional `sudo npx playwright install-deps chromium` on fresh Linux).

## Next Phase Readiness

- **Plan 02 (MCP tool handlers)** can start immediately. It consumes:
  - `BrowserManager` (via DI from Plan 03's daemon integration)
  - `BrowserContext` (via Plan 02's re-export from `src/browser/types.ts`)
  - `BrowserError` + `toBrowserToolError` (for structured-error returns from the 6 tool handlers)
  - `@mozilla/readability` + `jsdom` (for `browser_extract` readability mode)
- **Plan 03 (daemon warm-path + CLI subcommand)** can start in parallel with Plan 02 — it wires `BrowserManager` into `startDaemon()` and registers the `clawcode browser-mcp` CLI subcommand. `warm()` is idempotent and its failure message names the exact install command, so the daemon boot flow can surface a clean hard-fail message.
- **No blockers** for downstream plans. Option 2 architecture is non-negotiable at this point (locked by grep guards and test pinning).

## Self-Check: PASSED

- [x] `src/browser/types.ts` exists (verified via Read)
- [x] `src/browser/errors.ts` exists
- [x] `src/browser/storage-state.ts` exists
- [x] `src/browser/manager.ts` exists
- [x] `src/browser/__tests__/storage-state.test.ts` exists
- [x] `src/browser/__tests__/manager.test.ts` exists
- [x] Commit `c630aa2` present in `git log --oneline`
- [x] Commit `e6c4522` present in `git log --oneline`
- [x] Commit `6283897` present in `git log --oneline`
- [x] All 29 browser tests + 16 new schema tests pass
- [x] Full suite: 2629 tests green
- [x] Pitfall 1 + Pitfall 2 grep guards return nothing
- [x] Discord / manager / mcp untouched

---
*Phase: 70-browser-automation-mcp*
*Completed: 2026-04-19*
