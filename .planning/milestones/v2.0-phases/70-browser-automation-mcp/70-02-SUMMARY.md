---
phase: 70-browser-automation-mcp
plan: 02
subsystem: browser-automation
tags: [mcp, playwright, readability, jsdom, stdio, zod, ipc]

# Dependency graph
requires:
  - phase: 70-browser-automation-mcp
    provides: BrowserManager singleton (warm/getContext/close), BrowserToolOutcome envelopes, toBrowserToolError normalizer, frozen contracts in src/browser/types.ts + errors.ts (Plan 01)
  - phase: 52-prompt-caching
    provides: zod/v4 + defaults schema composition consumed by browserConfigSchema
provides:
  - Six pure browser tool handlers (browserNavigate/Screenshot/Click/Fill/Extract/WaitFor) as zero-dep functions over BrowserContext
  - TOOL_DEFINITIONS array with Pitfall 3/4/7 steering text embedded in descriptions
  - parseArticle (Readability + jsdom) and encodeScreenshot (MCP content envelope) helpers
  - createBrowserMcpServer + startBrowserMcpServer — stdio MCP subprocess that delegates every tool call to the daemon via IPC
  - `clawcode browser-mcp` CLI subcommand registered alongside `clawcode mcp`
  - IpcBrowserToolCallParams + IpcBrowserToolCallResult type contracts (Plan 03 wires the daemon-side handler)
  - __testOnly_buildHandler DI seam for testing the forward-to-daemon contract without a real StdioServerTransport
affects: [70-03-daemon-warm-path-cli, 71-web-search-mcp, 72-image-generation-mcp]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure functional tool handlers: (ctx: BrowserContext, args, cfg) => Promise<BrowserToolOutcome> — zero references to MCP SDK, IPC client, or BrowserManager; trivially testable against a mocked BrowserContext"
    - "TOOL_DEFINITIONS as a data-driven registration list consumed by a single loop in createBrowserMcpServer — no per-tool boilerplate"
    - "__testOnly_buildHandler DI seam: exported test helper that returns the exact handler registered with server.tool() so unit tests pin the forward-to-daemon contract without running a real transport"
    - "Out-of-process MCP subprocess architecture: clawcode browser-mcp stdio server delegates to daemon-owned BrowserManager via sendIpcRequest — parallels the existing clawcode mcp pattern"
    - "Agent-name resolution precedence: arg > CLAWCODE_AGENT env > invalid_argument error (with isError:true and no IPC round-trip)"
    - "Lazy imports of @mozilla/readability + jsdom inside parseArticle — mirrors the embedder.ts pattern; keeps module load cheap"
    - "Pitfall steering baked into tool descriptions: 'avoid networkidle' (Pitfall 3), 'prefer getByRole/getByTestId/getByText' (Pitfall 4), 'path-based workflow for repeats' (Pitfall 7)"

key-files:
  created:
    - src/browser/readability.ts — parseArticle via @mozilla/readability + jsdom, returns frozen ArticleResult superset or null
    - src/browser/screenshot.ts — encodeScreenshot (inline-bytes threshold envelope) + resolveScreenshotSavePath
    - src/browser/tools.ts — 6 pure tool handlers + TOOL_DEFINITIONS
    - src/browser/mcp-server.ts — createBrowserMcpServer + startBrowserMcpServer + __testOnly_buildHandler
    - src/cli/commands/browser-mcp.ts — `clawcode browser-mcp` subcommand registration
    - src/ipc/types.ts — IpcBrowserToolCallParams + IpcBrowserToolCallResult type contracts
    - src/browser/__tests__/readability.test.ts — 7 tests
    - src/browser/__tests__/screenshot.test.ts — 9 tests
    - src/browser/__tests__/tools.test.ts — 35 tests across 7 describe blocks
    - src/browser/__tests__/mcp-server.test.ts — 14 tests
    - src/browser/__tests__/fixtures/article.html — semantic article fixture for readability + extract tests
    - src/browser/__tests__/fixtures/form.html — form fixture for click/fill integration smoke (Plan 03)
    - src/browser/__tests__/fixtures/spa.html — delayed-DOM-insert fixture for wait_for integration smoke (Plan 03)
  modified:
    - src/cli/index.ts — added registerBrowserMcpCommand import + call (2 lines)

key-decisions:
  - "tools.ts returns pure data ({path, bytes, inlineBase64?}) and the MCP envelope (text + image) is built by mcp-server.ts — keeps tools.ts decoupled from the MCP SDK and makes it straightforward to unit-test without the SDK in scope"
  - "Agent-name resolution precedence arg > env > error — agents that forget to pass `agent` get a clear invalid_argument response rather than an IPC call to the daemon with an empty agent string"
  - "Readability metadata superset returned (70-RESEARCH Open Q #5) — all available fields (title, byline, siteName, publishedTime, lang, excerpt, text, html, length); agents ignore unused fields and there is no downside to including them"
  - "URL guard at the tool boundary: only http:// and https:// accepted by browserNavigate; file://, javascript:, chrome: and other schemes rejected with invalid_argument"
  - "Action-timeout errors on click/fill/wait_for map to element_not_found (not timeout) — the common root cause of Playwright TimeoutError in these cases is a selector that never becomes actionable; element_not_found is the better signal to agents. browser_wait_for keeps the 'timeout' type so BROWSER-05 structured-failure contract holds."
  - "__testOnly_buildHandler exposed as a DI seam: the MCP SDK's internal tool-registration shape makes introspecting registered tools brittle; returning the same handler function directly lets tests pin the forward-to-daemon contract without leaning on SDK internals"
  - "src/ipc/types.ts created as a new file (no existing shared IPC types module); Plan 03 will add 'browser-tool-call' to the IPC_METHODS enum in src/ipc/protocol.ts along with the daemon-side handler"
  - "Description steering via Zod .describe() for PITFALLS 3/4/7: the tool is a pass-through for user-supplied selectors/URLs, but the description text shapes agent behavior — this is load-bearing for long-term selector robustness"

patterns-established:
  - "Many small files: tools.ts (627), mcp-server.ts (267), readability.ts (88), screenshot.ts (113), browser-mcp.ts (30), ipc/types.ts (46) — all under CLAUDE.md 800-line max; only tools.ts exceeds the aspirational 400-line target, and its length is dominated by TOOL_DEFINITIONS + tool handlers that are clearer kept together"
  - "Frozen return envelopes: every BrowserToolOutcome returned from tools.ts has Object.freeze applied to both the outer envelope AND the inner .data / .error sub-object — immutability extends one level deep"
  - "Lazy import for heavy runtime deps: parseArticle's dynamic imports of jsdom and @mozilla/readability mirror the v1.7 embedder.ts pattern — module load stays cheap for callers that never use readability mode"

requirements-completed: [BROWSER-01, BROWSER-02, BROWSER-03, BROWSER-04, BROWSER-05]

# Metrics
duration: 20min
completed: 2026-04-19
---

# Phase 70 Plan 02: MCP Tool Handlers Summary

**Six pure browser tool handlers over Playwright's BrowserContext, wired into a stdio MCP subprocess (`clawcode browser-mcp`) that delegates every call to the daemon via `browser-tool-call` IPC — Plan 03 completes the daemon-side handler.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-19T01:09:28Z
- **Completed:** 2026-04-19T01:29:04Z
- **Tasks:** 3/3
- **Files created:** 12 (6 source + 3 tests + 3 HTML fixtures)
- **Files modified:** 1 (src/cli/index.ts — 2 lines)
- **Tests added:** 65 new (16 readability/screenshot + 35 tools + 14 mcp-server)
- **Full browser suite:** 94/94 green

## Accomplishments

- Shipped all 6 browser tools as pure functions over BrowserContext with zero references to the MCP SDK, IPC client, or BrowserManager — 35 test cases pin the surface, no real Chromium needed.
- `browser_wait_for` honors the BROWSER-05 structured-failure contract: timeouts return `{ok:false, error:{type:'timeout', timeoutMs, selector?}}` and NEVER throw. Test-pinned.
- Tool descriptions embed Pitfall 3/4/7 steering text: `avoid networkidle` (nav), `prefer getByRole/getByTestId/getByText` (click/fill/wait_for), `path-based workflow for repeats` (screenshot).
- `clawcode browser-mcp` CLI subcommand visible in `--help`; starts a `StdioServerTransport` MCP server registering all 6 tools via a `TOOL_DEFINITIONS` loop.
- Agent-name resolution precedence locked: arg > `CLAWCODE_AGENT` env > `invalid_argument` error with isError:true (no IPC round-trip on the error path).
- `__testOnly_buildHandler` DI seam exposed so Plan 03 integration tests can reuse the exact forward-to-daemon handler against a mocked `sendIpc`.
- `IpcBrowserToolCallParams` + `IpcBrowserToolCallResult` type contracts declared in `src/ipc/types.ts` — Plan 03 wires the daemon-side handler in `src/manager/daemon.ts` and appends `"browser-tool-call"` to `IPC_METHODS` in `src/ipc/protocol.ts` without re-discovering the shape.

## Task Commits

Each task was committed atomically:

1. **Task 1: readability + screenshot helpers + HTML fixtures** — `ce308a8` (feat)
2. **Task 2: 6 pure tool handlers + TOOL_DEFINITIONS** — `ef6b460` (feat)
3. **Task 3: MCP subprocess + CLI subcommand + IPC type** — `5a06dd7` (feat)

## `TOOL_DEFINITIONS` (locked names + Pitfall steering)

```typescript
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "browser_navigate",
    description:
      "Open a URL in your browser and wait for the page to load. " +
      "Use waitUntil='load' (default) for most pages. Use 'domcontentloaded' " +
      "for fast-rendering SPAs. AVOID 'networkidle' — it hangs on pages with " +
      "live polling or analytics.",                                            // Pitfall 3
  },
  {
    name: "browser_screenshot",
    description:
      "Capture a PNG screenshot of the current page. Saves to disk and " +
      "optionally inlines base64 for immediate vision. For repeated captures " +
      "in one task, rely on the returned path — Claude can Read them on " +
      "demand, which avoids filling conversation history with base64 payloads.", // Pitfall 7
  },
  {
    name: "browser_click",
    description:
      "Click an element by selector. Prefer getByRole() / getByTestId() / " +
      "getByText() selectors over raw CSS classes — they are resilient to " +
      "DOM churn and redesigns.",                                              // Pitfall 4
  },
  {
    name: "browser_fill",
    description:
      "Fill a form field by selector. Prefer getByRole() / getByTestId() / " +
      "getByText() selectors over raw CSS classes — they are resilient to " +
      "DOM churn.",                                                            // Pitfall 4
  },
  {
    name: "browser_extract",
    description:
      "Extract content from the page. mode='selector' returns textContent " +
      "and innerHTML for a specific locator. mode='readability' runs the " +
      "Mozilla Readability algorithm over the full page for article-style " +
      "content extraction with title, byline, publishedTime metadata.",
  },
  {
    name: "browser_wait_for",
    description:
      "Wait for a condition: a selector to become visible, a URL regex to " +
      "match, or both (whichever fires first). Returns a structured timeout " +
      "result rather than throwing when the condition is not met. Prefer " +
      "getByRole() / getByTestId() / getByText() selectors over raw CSS.",     // Pitfall 4
  },
];
```

All three Pitfall-steering strings (avoid-networkidle, getByRole-preference, path-based-repeat-screenshot) are confirmed in the `TOOL_DEFINITIONS` array and pinned by dedicated test cases.

## `__testOnly_buildHandler` Seam (for Plan 03)

`src/browser/mcp-server.ts` exports:

```typescript
export const __testOnly_buildHandler: (
  toolName: "browser_navigate" | "browser_screenshot" | "browser_click"
          | "browser_fill" | "browser_extract" | "browser_wait_for",
  deps?: { sendIpc?: typeof sendIpcRequest; env?: NodeJS.ProcessEnv },
) => (args: Record<string, unknown>) => Promise<McpToolResponse>;

export const __testOnly_buildMcpResponse: (
  outcome: BrowserToolOutcome,
  toolName: string,
) => { content: McpContent[]; isError?: boolean };
```

**Why the seam exists:** the MCP SDK's `McpServer` does not expose a clean way to introspect registered tools in a unit test. Returning the exact handler function lets Plan 02 tests (and Plan 03 integration tests if needed) assert on the forward-to-daemon contract against a mocked `sendIpc` without spinning up a real `StdioServerTransport`.

**When to use:** mocking IPC behavior for any per-tool handler logic (agent resolution, arg stripping, response envelope shaping).
**When NOT to use:** application code. The `__` prefix signals this is a test-only export.

## `IpcBrowserToolCallParams` Surface (for Plan 03)

`src/ipc/types.ts`:

```typescript
import type { BrowserToolOutcome } from "../browser/types.js";

export interface IpcBrowserToolCallParams {
  readonly agent: string;
  readonly toolName:
    | "browser_navigate"
    | "browser_screenshot"
    | "browser_click"
    | "browser_fill"
    | "browser_extract"
    | "browser_wait_for";
  readonly args: Record<string, unknown>;
}

export type IpcBrowserToolCallResult = BrowserToolOutcome;
```

**Plan 03 wiring:**
1. Append `"browser-tool-call"` to `IPC_METHODS` in `src/ipc/protocol.ts`.
2. In `src/manager/daemon.ts`, register a handler that:
   - Resolves the agent's workspace via existing agent registry
   - Fetches `BrowserContext` via `browserManager.getContext(agent, workspace)`
   - Loads the resolved `defaults.browser` config into a `BrowserToolConfig`
   - Dispatches on `toolName` to the matching `browserNavigate|Screenshot|Click|Fill|Extract|WaitFor` handler from `src/browser/tools.ts`
   - Returns the `BrowserToolOutcome` verbatim (serializes over the existing JSON-RPC IPC)
3. Wire auto-injection in `src/config/loader.ts` alongside `clawcode` and `1password`:
   ```typescript
   if (!resolvedMcpMap.has("browser") && defaults.browser.enabled) {
     resolvedMcpMap.set("browser", {
       name: "browser",
       command: "clawcode",
       args: ["browser-mcp"],
       env: { CLAWCODE_AGENT: agentName },
     });
   }
   ```

## `tools.ts` is a PURE Module

Grep proof:

```bash
grep -c "sendIpcRequest" src/browser/tools.ts                # 0
grep -c "McpServer\|StdioServerTransport" src/browser/tools.ts  # 0
grep -c "BrowserManager" src/browser/tools.ts                   # 0
```

Every tool handler is a function of `(ctx: BrowserContext, args, cfg)` only. The BrowserContext can be a `vi.fn()`-based mock with no real Chromium, as 35 tests demonstrate.

## Non-Regression Confirmation

- `git diff --name-only HEAD~3 HEAD -- src/discord/` → **empty** (v1.7 Discord bridge untouched)
- `git diff --name-only HEAD~3 HEAD -- src/manager/` → **empty** (daemon untouched; Plan 03 work)
- `git diff --name-only HEAD~3 HEAD -- src/mcp/server.ts` → **empty** (existing clawcode MCP server unchanged — we ADDED a new one)
- `npx tsc --noEmit` on Plan 70-02 files → zero new errors. Pre-existing errors in `src/config/__tests__/differ.test.ts` + `loader.test.ts` (missing `openai`/`browser` keys in test fixtures) are from Plans 69 + 70-01 and logged to `deferred-items.md`.
- Full suite: 2689 pass / 5 pre-existing failures (sqlite-heavy tests in cli/__tests__/openai-key, cli/commands/__tests__/trace, cli/commands/__tests__/triggers — all 5s-timeout flakes, NOT caused by this plan). Logged to deferred-items.md.

## CLAUDE.md Conventions Observed

- **Zod v4:** every `.schemaBuilder(z)` signature consumes `typeof import("zod/v4").z` to match project convention.
- **Many small files:** 6 source files averaging 195 lines (88 / 113 / 267 / 30 / 46) with tools.ts as the outlier at 627 (still under the 800-line max; the extra bulk is TOOL_DEFINITIONS + the narrow PageLike/LocatorLike structural interfaces that keep the module decoupled from playwright-core types).
- **Immutable data:** `Object.freeze` applied to every returned envelope (outer + inner), ArticleResult, and the `content` arrays inside ScreenshotEnvelope.
- **ESM `.js` imports:** every internal import uses the `.js` extension (`./errors.js`, `./types.js`, `./screenshot.js`, etc.).
- **Error handling:** no silent swallowing — every Playwright catch routes through `toBrowserToolError`, which normalizes TimeoutError + BrowserError + unknown into the locked taxonomy.
- **Input validation:** URL guard in `browserNavigate` (http/https only); regex validation in `browserWaitFor` (invalid regex returns invalid_argument instead of crashing); selector requirement enforced in `browserExtract(mode='selector')`.

## Readability Metadata Superset (70-RESEARCH Open Q #5)

**Resolved:** Return the full superset of Readability 0.6's parse result, `null` rather than `undefined` for missing fields so JSON serialization is stable.

```typescript
interface ArticleResult {
  readonly title: string | null;
  readonly byline: string | null;
  readonly siteName: string | null;
  readonly publishedTime: string | null;
  readonly lang: string | null;
  readonly excerpt: string | null;
  readonly text: string;    // whitespace-collapsed
  readonly html: string;    // article.content as-is
  readonly length: number;  // text.length
}
```

## Decisions Made

See frontmatter `key-decisions`. Highlights:

- **tools.ts stays pure.** The MCP content envelope shaping (text + image for inline screenshots, isError for failures) is done in mcp-server.ts, not in tools.ts. tools.ts returns structured data (`{path, bytes, inlineBase64?}`) and the subprocess layer shapes it. This keeps tools.ts free of MCP SDK imports and makes the 35-case test matrix hermetic.
- **Action-timeout → element_not_found (not timeout).** Click/fill/wait_for errors from Playwright's TimeoutError map to `element_not_found` because the common root cause is a selector that never becomes actionable. `browser_wait_for` keeps the `timeout` type to honor the BROWSER-05 structured-failure contract verbatim.
- **Agent resolution: arg > env > error.** The subprocess learns its agent name from one of two places. Plan 03's auto-inject config will set `CLAWCODE_AGENT` in the subprocess env, but an arg override path stays useful for testing and for future per-turn reassignment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Readability 0.6 is permissive on short content**

- **Found during:** Task 1 test run
- **Issue:** Plan's `<behavior>` predicted `parseArticle("<p>hi</p>", "http://x")` would return `null` (assumed Readability requires ~250 chars). Actual behavior: Readability 0.6 returns a result for any `<p>` with text, just with a tiny `length` field.
- **Fix:** Updated the test case to assert the permissive behavior — if a future Readability upgrade tightens the threshold, the test will fail and flag the regression. Original `<behavior>` note about null-on-short-content replaced with `length`-based branching guidance. No source change in `readability.ts`.
- **Files modified:** src/browser/__tests__/readability.test.ts (test only)
- **Verification:** 7 readability tests green (including the updated short-content case asserting `length < 20`).
- **Committed in:** `ce308a8` (Task 1 commit)

**2. [Rule 3 - Blocking] MCP SDK `server.tool` generic overload**

- **Found during:** Task 3 typecheck
- **Issue:** `server.tool(name, desc, schema, cb)` wants `schema: ZodRawShape` generic-typed. Our `TOOL_DEFINITIONS[i].schemaBuilder(z)` returns `Record<string, unknown>` (type-erased so the array can hold all 6 tool entries polymorphically). Direct pass caused `No overload matches this call` on line 238.
- **Fix:** Bound `server.tool` to a local variable with an explicit cast-through-unknown, so the loop-based registration keeps its polymorphism and the MCP SDK registration is still type-checked at the cast boundary. This preserves the data-driven TOOL_DEFINITIONS architecture without surrendering type safety elsewhere.
- **Files modified:** src/browser/mcp-server.ts
- **Verification:** `npx tsc --noEmit` clean for mcp-server.ts + mcp-server.test.ts; tool registration works (all 14 mcp-server tests pass).
- **Committed in:** `5a06dd7` (Task 3 commit)

**3. [Rule 3 - Blocking] Vitest tuple narrowing on `sendIpc.mock.calls[0]`**

- **Found during:** Task 3 typecheck
- **Issue:** `const [, method, params] = sendIpc.mock.calls[0]` failed with `Tuple type '[]' of length '0'` because vitest's default `Mock` type widens calls to `[]` when the mock has never been configured with a signature.
- **Fix:** Switched to `const call = sendIpc.mock.calls[0] as unknown as [string, string, T]` — indexed access with explicit cast. 4 occurrences in mcp-server.test.ts.
- **Files modified:** src/browser/__tests__/mcp-server.test.ts
- **Verification:** `npx tsc --noEmit` clean; 14 mcp-server tests green.
- **Committed in:** `5a06dd7` (Task 3 commit)

**4. [Rule 3 - Blocking] `src/ipc/types.ts` did not exist yet**

- **Found during:** Task 3 planning
- **Issue:** Plan 02 assumes `src/ipc/types.ts` already exists and references it with "new additions"; in reality the file did not exist — the project keeps IPC types in `src/ipc/protocol.ts` (Zod schemas) + `src/ipc/client.ts`. There was no shared types module.
- **Fix:** Created `src/ipc/types.ts` as a new file with ONLY the Phase 70 types declared. Header comment explicitly documents why it is separate from protocol.ts: Plan 03 adds the enum entry + daemon handler; Plan 02 just needs the TS contract. Future phases that want a "shared IPC types" module can append to this file.
- **Files modified:** src/ipc/types.ts (new)
- **Verification:** `grep -q "IpcBrowserToolCallParams" src/ipc/types.ts` passes; `grep -q "browser-tool-call" src/ipc/types.ts` passes; typecheck clean.
- **Committed in:** `5a06dd7` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (4 blocking)
**Impact on plan:** All four were mechanical fixes — no scope change, no architectural drift. The locked decisions (tools.ts purity, stdio subprocess architecture, browser-tool-call IPC method, agent precedence arg > env > error) shipped exactly as planned.

## Issues Encountered

- **tools.ts landed at 627 lines (plan target: 300-400).** Kept as one file because the bulk is `TOOL_DEFINITIONS` + narrow structural interfaces (`PageLike`, `LocatorLike`) that would require cross-file coordination if split. Still well under CLAUDE.md's 800-line max. If a future plan adds a 7th+ tool, splitting per-tool files (navigate.ts, click.ts, …) is a clean refactor — each handler is already isolated.

## User Setup Required

None — all Plan 70-02 wiring is in source. Plan 03 auto-injects the MCP subprocess via the existing `clawcode` + `1password` pattern; users with `mcpServers: []` in their config opt out.

## Next Phase Readiness

- **Plan 03 (daemon warm-path + auto-inject + smoke)** can start immediately. It consumes:
  - `TOOL_DEFINITIONS` + 6 pure handlers from `src/browser/tools.ts` (dispatch on `toolName`)
  - `IpcBrowserToolCallParams` + `IpcBrowserToolCallResult` types from `src/ipc/types.ts`
  - `BrowserManager.warm()` + `getContext(agent, workspace)` from Plan 01
  - The 3 HTML fixtures (`article.html`, `form.html`, `spa.html`) for `scripts/browser-smoke.mjs`
  - `__testOnly_buildHandler` if Plan 03 writes its own integration tests against mocked IPC
- **No blockers.** Discord bridge, session-adapter, turn-dispatcher, trace pipeline — all untouched. v1.7 SLO non-regression preserved (tools.ts is off-hot-path; mcp-server.ts runs in a subprocess).

## Self-Check: PASSED

- [x] `src/browser/readability.ts` exists
- [x] `src/browser/screenshot.ts` exists
- [x] `src/browser/tools.ts` exists
- [x] `src/browser/mcp-server.ts` exists
- [x] `src/cli/commands/browser-mcp.ts` exists
- [x] `src/ipc/types.ts` exists
- [x] `src/browser/__tests__/readability.test.ts` exists
- [x] `src/browser/__tests__/screenshot.test.ts` exists
- [x] `src/browser/__tests__/tools.test.ts` exists
- [x] `src/browser/__tests__/mcp-server.test.ts` exists
- [x] `src/browser/__tests__/fixtures/article.html` exists
- [x] `src/browser/__tests__/fixtures/form.html` exists
- [x] `src/browser/__tests__/fixtures/spa.html` exists
- [x] Commit `ce308a8` present in `git log --oneline`
- [x] Commit `ef6b460` present in `git log --oneline`
- [x] Commit `5a06dd7` present in `git log --oneline`
- [x] All 94 browser tests pass (65 new + 29 from Plan 01)
- [x] Full suite: 2689 pass (5 pre-existing failures logged to deferred-items.md)
- [x] `grep -c sendIpcRequest src/browser/tools.ts` returns 0 (pure)
- [x] `grep -c "McpServer\|StdioServerTransport" src/browser/tools.ts` returns 0 (pure)
- [x] `grep -q "browser-tool-call" src/browser/mcp-server.ts` passes
- [x] `grep -q "browser-tool-call" src/ipc/types.ts` passes
- [x] Discord + manager + existing-mcp-server untouched
- [x] `clawcode browser-mcp` visible in `clawcode --help`

---
*Phase: 70-browser-automation-mcp*
*Completed: 2026-04-19*
