---
phase: 71-web-search-mcp
plan: 02
subsystem: search
tags: [mcp, ipc, auto-inject, daemon, brave, exa, smoke-test, readme]

# Dependency graph
requires:
  - phase: 71-web-search-mcp
    provides: "searchConfigSchema + SearchConfig type, BraveClient/ExaClient factories, fetchUrl, webSearch + webFetchUrl pure handlers, TOOL_DEFINITIONS frozen array, IDEMPOTENT_TOOL_DEFAULTS extension (Plan 01)"
  - phase: 70-browser-automation-mcp
    provides: "IPC handler closure pattern (intercept method BEFORE routeMethod), src/browser/mcp-server.ts template for MCP stdio subprocess, src/cli/commands/browser-mcp.ts template for CLI subcommand, src/browser/daemon-handler.ts pattern for pure daemon-side dispatcher, scripts/browser-smoke.mjs shape (zero-dep JSON-RPC-over-Unix-socket client)"
  - phase: 69-openai-compatible-endpoint
    provides: "openai-key-* handler-arrow-fn intercept pattern — extended here for search-tool-call alongside browser-tool-call"
provides:
  - "Every agent's resolved config auto-includes a `search` MCP entry (command=clawcode, args=[search-mcp], env.CLAWCODE_AGENT=<agent>) when defaults.search.enabled is true"
  - "clawcode search-mcp CLI subcommand — spawns a StdioServerTransport MCP server registering web_search + web_fetch_url"
  - "src/search/daemon-handler.ts — handleSearchToolCall pure dispatcher + SearchDaemonHandlerDeps type"
  - "src/search/mcp-server.ts — createSearchMcpServer + startSearchMcpServer + __testOnly_buildHandler / __testOnly_buildMcpResponse"
  - "search-tool-call IPC method wired in daemon.ts, intercepted BEFORE routeMethod (same closure pattern as browser-tool-call)"
  - "Daemon-owned BraveClient + ExaClient singletons (lazy API-key reads, zero boot-time network)"
  - "scripts/search-smoke.mjs — zero-dep Node ESM E2E smoke over the IPC transport"
  - "README Web Search (Phase 71) section with tool reference table + MCP Servers table row"
affects: [72-image-generation-mcp]

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — reuses Plan 01's native fetch, createRequire, and the MCP SDK already pulled in by Phase 70
  patterns:
    - "Pure daemon-side handler pattern reused from Phase 70: src/search/daemon-handler.ts owns dispatch, daemon.ts does closure-capture + single-line forward. Future phases adding IPC methods follow the same split."
    - "Lazy HTTP-client construction at daemon boot (no warm-path probe) — BraveClient/ExaClient are constructed unconditionally but never touch network until first .search() call. Missing keys surface as invalid_argument, not daemon crashes."
    - "MCP subprocess response shape for search is single text item (no screenshot branch) — simpler than Phase 70's browser envelope. Drop the specific-tool branch; same __testOnly_* test contract."
    - "Smoke script daemon-down guard: ECONNREFUSED/ENOENT → exit 2 with 'daemon not running' message. Exit 1 reserved for assertion failures. Keeps CI distinguishable (skip vs fail)."

key-files:
  created:
    - "src/search/daemon-handler.ts (130 lines) — handleSearchToolCall pure dispatcher + SearchDaemonHandlerDeps type"
    - "src/search/mcp-server.ts (180 lines) — createSearchMcpServer + startSearchMcpServer + __testOnly_* exports"
    - "src/cli/commands/search-mcp.ts (30 lines) — registerSearchMcpCommand Commander subcommand"
    - "src/ipc/__tests__/search-tool-call.test.ts (226 lines, 7 cases D1–D7)"
    - "src/search/__tests__/mcp-server.test.ts (160 lines, 8 cases — 6 handler + 2 response-builder)"
    - "scripts/search-smoke.mjs (225 lines) — executable zero-dep Node ESM E2E smoke"
  modified:
    - "src/ipc/types.ts — IpcSearchToolCallParams + IpcSearchToolCallResult appended (Phase 71 block)"
    - "src/ipc/protocol.ts — 'search-tool-call' appended to IPC_METHODS tuple"
    - "src/ipc/__tests__/protocol.test.ts — toEqual tuple extended with 'search-tool-call'"
    - "src/config/loader.ts — search auto-inject block added after browser (line ~110)"
    - "src/config/__tests__/loader.test.ts — 4 new Phase 71 cases (L1-L4), existing L5 filter extended to exclude 'search'"
    - "src/manager/daemon.ts — imports (handleSearchToolCall, createBraveClient, createExaClient, fetchUrl, IpcSearchToolCallParams), step 9d client construction after browser warm, IPC handler search-tool-call case intercepted BEFORE routeMethod"
    - "src/manager/__tests__/daemon-warmup-probe.test.ts — 5 Phase 71 source-grep cases (G1-G5)"
    - "src/cli/index.ts — registerSearchMcpCommand registered alongside registerBrowserMcpCommand"
    - "README.md — MCP Servers table extended with 'search' row; new 'Web Search (Phase 71)' section"

key-decisions:
  - "IPC handler intercepted BEFORE routeMethod (same closure pattern as browser-tool-call + openai-key-*) — keeps the 24-arg routeMethod signature stable. Every new phase that adds an IPC method can follow the same split without growing routeMethod."
  - "handleSearchToolCall extracted into src/search/daemon-handler.ts rather than inlined in daemon.ts. Rationale: daemon.ts is already 2800+ lines; extracting the handler keeps file-size manageable AND provides a clean DI seam (deps: {searchConfig, resolvedAgents, braveClient, exaClient, fetcher}) for 7-case unit tests that never touch an IPC socket or real HTTP."
  - "Daemon-owned BraveClient + ExaClient singletons (constructed unconditionally at boot) — NOT per-request construction, NOT lazy-at-first-call. Rationale: factories are zero-cost (no env read, no network), client instances cache nothing. Per-request factory calls would re-allocate a closure per tool call; daemon-owned is one-time + cheap. Matches Plan's must_haves.truths[7]."
  - "No warm-path probe for search — the resident-Chromium pattern from Phase 70 does NOT apply because HTTP clients hold no state between calls. This was locked in 71-CONTEXT ('HTTP clients are lazy; no persistent resources like Chromium'). Keeps daemon boot below v1.7 SLO ceiling without any new measurement surface."
  - "Lazy API-key reads inside the .search() method (Plan 01 design, preserved here) — missing BRAVE_API_KEY / EXA_API_KEY at daemon boot does NOT crash the process. The first tool call returns invalid_argument with a message naming the missing env var. Makes the daemon bootable on a dev box without real keys."
  - "MCP response shape is plain text only (single {type:'text'} content item) — no screenshot/image branch. Saves ~40 lines vs Phase 70's browser mcp-server.ts. Search outcomes are always JSON payloads the agent reads; no vision hand-off needed."
  - "Smoke script is zero-dep Node ESM that inlines a JSON-RPC-over-Unix-socket client (same as browser-smoke.mjs) — works on a fresh clone with no build step, no dist/ dependency, no npm install required. Exit 2 on daemon-down distinguishes infra-skip from assertion-fail."
  - "README Phase-71 section lists ONLY the 2 tools we ship (web_search + web_fetch_url). Explicitly does NOT advertise image/news/video search, Google CSE, SerpAPI, or semantic search — those are v2.x deferred per 71-CONTEXT deferred section."

patterns-established:
  - "Phase-71 wiring mirrors Phase-70 exactly: src/<feature>/daemon-handler.ts (pure dispatch) + src/<feature>/mcp-server.ts (stdio subprocess) + src/cli/commands/<feature>-mcp.ts (Commander subcommand) + auto-inject in src/config/loader.ts (gated by defaults.<feature>.enabled) + IPC intercept in daemon.ts (BEFORE routeMethod). Phase 72 (image generation MCP) can copy the 5-file recipe verbatim."
  - "Source-grep tests for daemon wiring invariants (daemon-warmup-probe.test.ts) — cheaper than booting startDaemon with 30+ mocked deps. Five tokens per phase (method registered, handler imported, clients constructed, dispatch before routeMethod, no warm at boot) pin the wiring at ~50 LOC."

requirements-completed: [SEARCH-01, SEARCH-02, SEARCH-03]

# Metrics
duration: 10 min
completed: 2026-04-19
---

# Phase 71 Plan 02: Wire + Transport + Smoke Summary

**Closes SEARCH-01..03 end-to-end: every agent auto-gets a `search` MCP entry, the daemon owns lazily-constructed Brave + Exa clients, the `search-tool-call` IPC dispatches to `webSearch`/`webFetchUrl` via a pure handler, and `scripts/search-smoke.mjs` validates the whole chain against a live daemon. Zero new npm deps. Zero Phase 70 diff. Zero Discord diff.**

## Plan 01 → Plan 02 bridge (full phase closure)

Plan 01 built the pure daemon-agnostic search core: `searchConfigSchema`, Brave + Exa provider clients, URL fetcher with streaming size guards, Readability adapter reusing Phase 70, pure DI tool handlers (`webSearch` + `webFetchUrl`), `TOOL_DEFINITIONS`, and — critically for SEARCH-03 — `web_search` + `web_fetch_url` appended to `IDEMPOTENT_TOOL_DEFAULTS` in `src/config/schema.ts`.

Plan 02 wires the transport: IPC contract + method, daemon-side pure dispatcher, stdio MCP subprocess, CLI subcommand, auto-inject in the config loader, daemon client-construction + IPC-intercept, live smoke, and README.

**SEARCH-03 intra-turn cache behavior is end-to-end operational after Plan 02** because:

1. Plan 01 extended the whitelist (data in `IDEMPOTENT_TOOL_DEFAULTS`).
2. The existing v1.7 `invokeWithCache` machinery in `src/mcp/server.ts` reads that whitelist and caches all listed tools per-Turn.
3. Plan 02 registers the tools with the MCP server (via `createSearchMcpServer` + auto-inject), so they flow through `invokeWithCache` automatically.

**Zero net-new code in `src/mcp/` or `src/performance/`** — the whitelist extension is purely data. This is what the must_haves truth "v1.7 SLO non-regression" is pinned against.

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-19T02:47:41Z
- **Completed:** 2026-04-19T02:58:34Z
- **Tasks:** 2 (both TDD: RED → GREEN per task)
- **New tests:** 20 (1 IPC protocol tuple extension + 7 daemon-handler cases + 8 mcp-server cases + 4 loader auto-inject cases + 5 daemon-warmup-probe source-grep cases)
- **Full suite:** 2795 passed (208 files). Net +34 vs Plan 01 baseline (2761), +75 vs Phase-70-end baseline (2720).

## Task Commits

| # | Task | Commit | Kind |
|---|------|--------|------|
| 1 | Task 1 RED — failing tests for IPC contract + daemon-handler + mcp-server | `eb65e13` | test |
| 2 | Task 1 GREEN — IPC contract + daemon-handler + MCP subprocess + CLI subcommand | `304a9f2` | feat |
| 3 | Task 2 RED — failing tests for auto-inject + daemon wiring | `bbc6eda` | test |
| 4 | Task 2 GREEN — auto-inject + daemon wiring + smoke script + README section | `6ead661` | feat |

## Auto-Injected `search` MCP Entry (`src/config/loader.ts`)

```typescript
// Phase 71 — auto-inject the search MCP server so every agent gets
// web_search + web_fetch_url. The daemon owns the BraveClient/ExaClient
// singletons; this subprocess is a thin IPC translator. Gated by
// defaults.search.enabled (default true). CLAWCODE_AGENT env is consumed
// by the subprocess as the default agent identity for tool calls
// (src/search/mcp-server.ts).
const searchEnabled = defaults.search?.enabled !== false;
if (searchEnabled && !resolvedMcpMap.has("search")) {
  resolvedMcpMap.set("search", {
    name: "search",
    command: "clawcode",
    args: ["search-mcp"],
    env: { CLAWCODE_AGENT: agent.name },
  });
}
```

Placed immediately after the `browser` auto-inject block. Final auto-inject order: `clawcode` → `1password` → `browser` → `search`.

## Daemon Boot Sequence (`src/manager/daemon.ts`)

| Step | Action | Rough line |
|------|--------|-----------|
| Imports | `handleSearchToolCall`, `createBraveClient`, `createExaClient`, `fetchUrl`, `IpcSearchToolCallParams` | 117-121 |
| 9d | Construct `braveClient` + `exaClient` after browser warm block; log backend + maxResults on enabled path | ~1040 |
| 10 | IPC handler — `search-tool-call` case intercepted BEFORE `routeMethod` (same closure pattern as `browser-tool-call` / `openai-key-*`) | ~1090 |

**No shutdown change** — HTTP clients own no persistent resources, nothing to close. `browserManager.close()` path (Phase 70) is untouched.

## `search-tool-call` IPC Handler (`src/search/daemon-handler.ts`)

Pure async function over `{searchConfig, resolvedAgents, braveClient, exaClient, fetcher}`:

1. **Disabled guard** → `{ok:false, error:{type:"internal", message:/disabled/}}`
2. **Agent resolution** → unknown agent → `invalid_argument`
3. **Dispatch** via `try/switch` on `toolName`:
   - `web_search` → `webSearch(args, {config, braveClient, exaClient, fetcher})`
   - `web_fetch_url` → `webFetchUrl(args, same deps)`
   - default → `invalid_argument` (unknown search tool)
4. **Defence-in-depth catch** — maps any thrown rejection to `internal` so the IPC boundary is never torn by a client/fetcher bug.

Seven tests (`src/ipc/__tests__/search-tool-call.test.ts`) pin the contract:
- D1: disabled-guard → internal
- D2: unknown agent → invalid_argument
- D3: routes `web_search` to pure handler, returns outcome verbatim
- D4: routes `web_fetch_url` to pure handler
- D5: unknown toolName → invalid_argument
- D6: backend switch — `exa` routes to exaClient, `brave` to braveClient
- D7: never throws — mock client rejection → internal envelope

## MCP Subprocess (`src/search/mcp-server.ts`)

Mirrors `src/browser/mcp-server.ts` 1:1 with 3 differences:

- `TOOL_DEFINITIONS` imported from `./tools.js` (Plan 01; exactly 2 entries)
- MCP server `name: "search"`, `version: "0.1.0"`
- `buildMcpResponse` drops the screenshot branch — search responses are always `{type:"text", text:JSON.stringify(data)}` single-item envelopes. `isError: outcome.ok ? undefined : true`.

Agent-name resolution: `args.agent > env.CLAWCODE_AGENT > error`. Eight tests (`src/search/__tests__/mcp-server.test.ts`):
- M1-M6: handler forward-to-daemon contract (mocked `sendIpc`)
- Plus 2 response-builder cases (`__testOnly_buildMcpResponse`)

## Smoke Script (`scripts/search-smoke.mjs`)

- **Invocation:** `node scripts/search-smoke.mjs [agent=clawdy] [query="anthropic claude api"]`
- **Three steps:** `web_search → web_fetch_url(first.url) → web_search(repeat)`
- **Assertions:** results non-empty; first hit carries `title`+`url`; fetched `text.length > 100`; `wordCount > 10`
- **Exit codes:** 0=pass, 1=assertion failure, 2=daemon-not-running (ECONNREFUSED/ENOENT)
- **Timeouts:** 30s per step
- **Runtime deps:** none — inlines the minimal JSON-RPC-over-Unix-socket client (no `dist/` dependency)

Syntax-check + daemon-down branch verified:

```bash
$ node --check scripts/search-smoke.mjs
SYNTAX OK

$ CLAWCODE_SOCKET_PATH=/tmp/nonexistent.sock timeout 5 node scripts/search-smoke.mjs
Phase 71 search smoke — agent=clawdy query="anthropic claude api" socket=/tmp/nonexistent.sock
daemon not running — start with `clawcode start-all` first
EXIT=2
```

### Expected output (successful run, live daemon + BRAVE_API_KEY)

```
Phase 71 search smoke — agent=clawdy query="anthropic claude api" socket=/home/user/.clawcode/manager/clawcode.sock
[1/3] web_search — 3 results, provider=brave (412ms)
       first: "Claude API | Anthropic" — https://www.anthropic.com/api
[2/3] web_fetch_url — 8342 chars, 1247 words (983ms)
       preview: "Anthropic's Claude is a family of frontier AI models..."
[3/3] web_search (repeat) — 3 results (378ms)
SMOKE PASS — search: 412ms, fetch: 983ms (8342 chars, 1247 words), search2: 378ms.
```

## Non-Regression Evidence

All 9 verification checks from the plan:

| # | Check | Result |
|---|-------|--------|
| 1 | `npx vitest run` (full suite) | **2795 passed / 208 files** — net +34 vs Plan 01's 2761 baseline |
| 2 | `git diff --name-only HEAD~4 HEAD -- src/browser/` | **empty** (Phase 70 artifacts untouched) |
| 3 | `git diff --name-only HEAD~4 HEAD -- src/discord/` | **empty** (Discord bridge untouched) |
| 4 | `git diff --name-only HEAD~4 HEAD -- package.json package-lock.json` | **empty** (zero new npm deps) |
| 5 | `grep "web_search\|web_fetch_url" src/search/ src/ipc/ src/config/` | **found** in tools.ts, tests, schema.ts |
| 6 | `git diff --stat HEAD~4 HEAD -- src/performance/ src/mcp/server.ts src/mcp/tool-cache.ts` | **empty** (v1.7 SLO non-regression) |
| 7 | `grep '"browser-tool-call"\|"search-tool-call"' src/ipc/protocol.ts` | **both present** (lines 90 + 95) |
| 8 | Auto-inject order in `src/config/loader.ts` | **clawcode → 1password → browser → search** (4 `resolvedMcpMap.set` calls in that order) |
| 9 | Live smoke (requires running daemon + BRAVE_API_KEY) | **deferred to deploy gate** — script syntactically valid + daemon-down branch exits 2 as documented |

## Decisions Made

See frontmatter `key-decisions` for the full list. Highlights:

1. **IPC handler intercepted BEFORE `routeMethod`** — same closure pattern as Phase 70's `browser-tool-call` and Phase 69's `openai-key-*`. Keeps the 24-arg `routeMethod` signature from growing. Phase 72 will continue the same pattern.
2. **Daemon-owned clients (not per-request)** — BraveClient + ExaClient are constructed once at daemon boot. Factories are zero-cost; clients hold no state; per-request construction would be waste. Clients ARE lazy in the sense that no network call happens until the first `.search()` — but their instances live for the daemon's lifetime.
3. **No warm-path probe for search** — HTTP clients don't need one. Keeps `src/manager/warm-path-check.ts` untouched and daemon boot below the v1.7 SLO ceiling with zero new measurement surface. Must_haves truth 8 pinned.
4. **MCP response shape is plain text** — no screenshot/image branch. Simpler than Phase 70's browser envelope by ~40 lines.
5. **Zero-dep smoke script** — inlined JSON-RPC client works on a fresh clone with no build step. Distinguishes daemon-down (exit 2) from assertion failure (exit 1) per the Phase 70 convention.

## Deviations from Plan

**None — plan executed exactly as written.**

No auto-fixes required (Rule 1/2/3), no architectural questions hit (Rule 4), no authentication gates encountered. The plan's `<interfaces>` block accurately described what Plan 01 shipped, so no context-exploration detours. The 4 `DefaultsConfig` fixtures in `loader.test.ts` + `differ.test.ts` already had the `search` field (Plan 01 added them; see Plan 01 deviation notes), so no fixture maintenance was needed.

## Issues Encountered

- **TypeScript strict-tuple typing on `vi.fn().mock.calls[0]`** in `src/search/__tests__/mcp-server.test.ts` — initial tests triggered TS2493 ("Tuple type '[]' of length '0' has no element at index '1'") because `vi.fn()` typed as `ReturnType<typeof vi.fn>` defaults to empty-tuple calls. Fixed inline by casting to a local `IpcMock` alias typing `mock.calls` as `Array<[string, string, Record<string, unknown>]>`. This is test-file mechanical typing only — no runtime behaviour change. (Caught before commit; not a production-code deviation.)

## User Setup Required

Agents calling `web_search` need a valid API key in the environment:

- **Brave (default):** set `BRAVE_API_KEY` (already present in the repo's `clawcode.yaml` per 71-CONTEXT).
- **Exa (optional):** set `EXA_API_KEY` when `defaults.search.backend: "exa"`.

Missing key → first tool call returns `{error: {type: "invalid_argument", message: "missing Brave API key (env var BRAVE_API_KEY is unset)"}}`. No daemon crash.

## Phase Readiness

**Phase 71 is complete end-to-end.** All 3 SEARCH-* requirements are covered across Plans 01/02:

- **SEARCH-01** (Brave primary backend) — Plan 01 `src/search/providers/brave.ts` + Plan 02 daemon-handler + mcp-server + CLI wiring
- **SEARCH-02** (Exa optional backend) — Plan 01 `src/search/providers/exa.ts` + Plan 02 backend-switch (D6 test pins `config.backend === "exa"` routing)
- **SEARCH-03** (intra-turn cache) — Plan 01 `IDEMPOTENT_TOOL_DEFAULTS` extension + existing v1.7 `invokeWithCache` machinery (zero new code in `src/mcp/` or `src/performance/`)

**Phase 72 (Image Generation MCP) can proceed next.** The 5-file recipe (daemon-handler / mcp-server / CLI subcommand / loader auto-inject / daemon IPC intercept) is now established + documented in `patterns-established`.

## Deploy-Gate Follow-Up

Before switching prod to the v2.0 build:

1. Capture baseline: `clawcode latency <agent> --since 1h` + `clawcode cache <agent> --since 1h` — record first-token p95 and cache-hit rate.
2. After switch: warm path check + rerun `clawcode latency` — expect first-token p95 within 5% of baseline (v1.7 SLO non-regression).
3. Set `BRAVE_API_KEY` in the systemd `EnvironmentFile` (or 1Password `op://...` reference).
4. Run `node scripts/search-smoke.mjs clawdy "anthropic claude api"` — expect exit 0 with the 3-step output above.
5. Monitor Brave API spend for the first 48h — the intra-turn cache should dedupe within-turn but cross-turn calls always hit network.

## Self-Check: PASSED

- [x] `src/search/daemon-handler.ts` exists
- [x] `src/search/mcp-server.ts` exists
- [x] `src/cli/commands/search-mcp.ts` exists
- [x] `src/ipc/__tests__/search-tool-call.test.ts` exists
- [x] `src/search/__tests__/mcp-server.test.ts` exists
- [x] `scripts/search-smoke.mjs` exists + `node --check` passes + daemon-down exits 2
- [x] `src/config/loader.ts` contains `search-mcp` + `CLAWCODE_AGENT` + `defaults.search?.enabled`
- [x] `src/manager/daemon.ts` contains `handleSearchToolCall`, `createBraveClient`, `createExaClient`, `fetchUrl`, `search-tool-call`
- [x] `src/ipc/protocol.ts` contains `search-tool-call` in IPC_METHODS
- [x] `src/cli/index.ts` contains `registerSearchMcpCommand`
- [x] README.md contains `Web Search (Phase 71)` section + MCP Servers table row for `search`
- [x] Commit `eb65e13` in `git log --oneline`
- [x] Commit `304a9f2` in `git log --oneline`
- [x] Commit `bbc6eda` in `git log --oneline`
- [x] Commit `6ead661` in `git log --oneline`
- [x] Full suite: **2795 tests passed (2795)**
- [x] Phase 70 (browser/), Discord bridge (discord/), v1.7 SLO surface (performance/, mcp/server.ts, mcp/tool-cache.ts) UNTOUCHED
- [x] Zero new npm deps

---
*Phase: 71-web-search-mcp*
*Completed: 2026-04-19*
