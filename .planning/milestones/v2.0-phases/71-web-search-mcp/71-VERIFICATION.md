---
phase: 71-web-search-mcp
verified: 2026-04-19T03:05:00Z
status: human_needed
score: 5/5 must-haves verified (programmatic); 2 items deferred to live-daemon human verification
human_verification:
  - test: "Live `web_search` against Brave with real API key"
    expected: "Running `node scripts/search-smoke.mjs clawdy \"anthropic claude api\"` against a started daemon with BRAVE_API_KEY set returns exit 0 with `web_search → web_fetch_url → web_search (repeat)` output, first hit shows title+url, fetched text >100 chars + wordCount >10"
    why_human: "Requires live network + valid Brave API key + running daemon (start-all). Per Plan 02 verification check #9, deferred to deploy gate."
  - test: "Cross-Turn cache scoping (SEARCH-03 second clause)"
    expected: "Two identical web_search calls in the same agent Turn produce ONE outbound HTTP request to Brave (intra-turn cache hit on second call); a third call in a NEW Turn produces a fresh outbound request (no cross-turn leak)"
    why_human: "Verification requires observing the trace span `cached: true` flag across two real Turns with a live Brave endpoint and an active agent session. The unit-level invokeWithCache logic + IDEMPOTENT_TOOL_DEFAULTS membership are programmatically verified, but end-to-end Turn-boundary behavior under live load is not unit-testable without a daemon + agent."
---

# Phase 71: Web Search MCP Verification Report

**Phase Goal:** Every agent can search the live web and fetch clean article text for grounding and citations, with intra-turn deduplication preventing accidental re-charging on repeat queries.
**Verified:** 2026-04-19T03:05:00Z
**Status:** human_needed (all programmatic checks pass; 2 deploy-gate human verifications remain)
**Re-verification:** No — initial verification

Must-haves source: ROADMAP Success Criteria (Option B). PLAN frontmatter does not declare `must_haves` block.

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Agent calls `web_search("...")` and gets ranked Brave results (title/URL/snippet/publishedDate); same call returns Exa results when `searchBackend: "exa"` configured | VERIFIED | `src/search/providers/brave.ts:87-182` (createBraveClient — GET api.search.brave.com, X-Subscription-Token, normalizeResult includes publishedDate), `src/search/providers/exa.ts` (createExaClient), `src/search/tools.ts:115-116` backend switch on `config.backend === "exa"` |
| 2 | Agent calls `web_fetch_url(<url>)` and gets clean readable text + extractable metadata (title, author, publishedDate) usable as citation | VERIFIED | `src/search/tools.ts:137-250` (webFetchUrl), `src/search/readability.ts:1-30` (extractArticle adapter reusing Phase 70 Mozilla Readability + jsdom), returns `{title, byline, publishedDate, text, html, wordCount}` from `article.title/byline/publishedTime/text/html` |
| 3 | Duplicate `web_search` calls in one turn return cached results (single outbound request); cross-turn calls hit Brave fresh | VERIFIED (programmatic) — needs live cross-turn human verification | `src/config/schema.ts:270-283` IDEMPOTENT_TOOL_DEFAULTS contains both tools (frozen, length 6); `src/mcp/server.ts:160-188` invokeWithCache reads whitelist, hit returns cached value without raw call. SEARCH-03 second clause (cross-turn miss) requires live Turn-boundary observation. |
| 4 | Search MCP auto-injects per agent (clawcode/1password pattern) and tools appear on v1.7 idempotent whitelist with `cached: true` trace metadata | VERIFIED | `src/config/loader.ts:113-122` (search auto-inject after browser, gated by `defaults.search?.enabled !== false`, env CLAWCODE_AGENT injected); IDEMPOTENT_TOOL_DEFAULTS extended with both tools (Phase 55 length assertion updated 4→6 in tools-schema.test.ts). `cached: true` flag set by session-adapter via Turn.toolCache hitCount delta — invokeWithCache wraps every IPC tool call when active Turn exists. |
| 5 | v1.7 prompt-cache hit rate + first-token p95 SLO show no regression when search idle (Brave client lazy, not eager at boot) | VERIFIED (programmatic) — needs live SLO measurement at deploy gate | `src/search/providers/brave.ts:91-101` (lazy env-var read inside `.search()`, no network at construction); `src/manager/daemon.ts:1045-1046` clients constructed unconditionally but factories are zero-cost (zero-cost claim verified in `src/search/__tests__/brave.test.ts` — construction triggers no env read, no fetch); `git diff --stat HEAD~4 HEAD -- src/performance/ src/mcp/server.ts src/mcp/tool-cache.ts` reported empty per Plan 02 check #6. |

**Score:** 5/5 truths verified programmatically. 2 truths (#3 cross-turn, #5 live SLO) have a human-verification follow-up at the deploy gate.

### Required Artifacts

Derived from ROADMAP Success Criteria (no must_haves in PLAN frontmatter).

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/search/providers/brave.ts` | Brave Search HTTP client | VERIFIED | 5781 bytes, createBraveClient factory + lazy API-key reads, AbortSignal.timeout, 429 → rate_limit with retry-after extraction |
| `src/search/providers/exa.ts` | Exa Search HTTP client (optional backend) | VERIFIED | 4630 bytes, createExaClient factory, POST api.exa.ai/search with x-api-key |
| `src/search/fetcher.ts` | URL fetcher with timeout + size cap | VERIFIED | 6565 bytes, AbortSignal.timeout, Content-Length pre-flight + streaming maxBytes guard, User-Agent ClawCode/<pkgVersion> |
| `src/search/readability.ts` | Readability extractor adapter | VERIFIED | 1096 bytes, thin re-export of Phase 70's `parseArticle` (no hoist, no duplication) |
| `src/search/tools.ts` | Pure DI tool handlers (webSearch, webFetchUrl) + TOOL_DEFINITIONS | VERIFIED | 9923 bytes, never-throw contract, frozen envelopes, backend dispatch, content-type guard, mode=readability/raw, schemaBuilder fns |
| `src/search/types.ts` | Shared type contracts (frozen, discriminated unions) | VERIFIED | 2638 bytes, SearchResultItem, SearchResponse, FetchUrlResult, SearchError, SearchToolOutcome |
| `src/search/errors.ts` | Error factory + AbortError/TypeError mapper | VERIFIED | 2323 bytes, makeError + toSearchToolError (7-discriminant taxonomy) |
| `src/search/daemon-handler.ts` | Pure dispatcher for search-tool-call IPC | VERIFIED | 4782 bytes, handleSearchToolCall, disabled guard → internal, agent resolution → invalid_argument, dispatch via switch, never-throw boundary |
| `src/search/mcp-server.ts` | Stdio MCP subprocess registering both tools | VERIFIED | 6969 bytes, createSearchMcpServer + startSearchMcpServer, IPC forward to daemon, agent name resolution arg>env>error, __testOnly_buildHandler/buildMcpResponse exports |
| `src/cli/commands/search-mcp.ts` | `clawcode search-mcp` CLI subcommand | VERIFIED | 1138 bytes, registerSearchMcpCommand, dynamic import of mcp-server, registered in src/cli/index.ts:153 |
| `scripts/search-smoke.mjs` | E2E smoke (web_search → web_fetch_url → repeat) | VERIFIED (script) — live run deferred to human | 7735 bytes, executable, `node --check` passes, daemon-down branch exits 2 (verified live just now: "daemon not running — start with `clawcode start-all` first" / EXIT=2) |
| IDEMPOTENT_TOOL_DEFAULTS extension | web_search + web_fetch_url appended to v1.7 whitelist | VERIFIED | `src/config/schema.ts:270-283`, length=6, frozen, comment block at 275-280 documents Phase 71 rationale. Test pin at `src/config/__tests__/schema.test.ts:966-974` and `src/config/__tests__/tools-schema.test.ts:76-106` |
| auto-inject in src/config/loader.ts | search MCP server appears in resolved config when `defaults.search.enabled` is true | VERIFIED | `src/config/loader.ts:113-122`, command=clawcode, args=[search-mcp], env.CLAWCODE_AGENT=<agent.name>, ordered after browser; gated by `defaults.search?.enabled !== false` |
| daemon.ts wiring | search-tool-call intercepted BEFORE routeMethod with daemon-owned clients | VERIFIED | imports at lines 117-119 (handleSearchToolCall, createBraveClient, createExaClient); clients constructed at line 1045-1046; IPC handler at line 1099-1114 (intercepted before routeMethod call at 1115) |
| README Phase-71 section | Web Search section + MCP Servers row | VERIFIED | line 230 (MCP Servers table row for `search`), line 517 ("## Web Search (Phase 71)" section), tool reference table at line 536+ |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| Loader auto-inject | search MCP subprocess spawn | `command: "clawcode", args: ["search-mcp"]` in resolvedMcpMap | WIRED | src/config/loader.ts:117-122 sets the entry; CLI command registered at src/cli/index.ts:153 |
| MCP subprocess `search` server | daemon `search-tool-call` IPC | `sendIpcRequest(SOCKET_PATH, "search-tool-call", {agent, toolName, args})` | WIRED | src/search/mcp-server.ts:111-115 forwards every tool call; SOCKET_PATH imported from manager/daemon.js |
| daemon `search-tool-call` handler | pure tool handlers | `handleSearchToolCall({searchConfig, resolvedAgents, braveClient, exaClient, fetcher: fetchUrl}, params)` | WIRED | src/manager/daemon.ts:1099-1114 closes over daemon-owned clients + fetchUrl; handler dispatches via switch on toolName to webSearch/webFetchUrl |
| webSearch | backend dispatch | `deps.config.backend === "exa" ? deps.exaClient : deps.braveClient` | WIRED | src/search/tools.ts:115-116 (D6 unit test pins this in src/ipc/__tests__/search-tool-call.test.ts) |
| webFetchUrl | extractArticle (Readability) | `deps.extractArticle ?? extractArticle` (default = Phase 70 reuse) | WIRED | src/search/tools.ts:226 ; src/search/readability.ts re-exports parseArticle from `../browser/readability.js` |
| IDEMPOTENT_TOOL_DEFAULTS | invokeWithCache lookup | `idempotent.includes(toolName)` → cache hit short-circuits raw call | WIRED | src/mcp/server.ts:172-181 reads `perfTools.idempotent ?? IDEMPOTENT_TOOL_DEFAULTS`, returns frozen cached value on Turn.toolCache hit |
| `cached: true` trace flag | Turn.toolCache hitCount delta | session-adapter detects hit count delta after MCP handler returns | WIRED (per existing v1.7 design) | invokeWithCache writes to cache on success; src/mcp/server.ts:155 doc comment confirms session-adapter enriches spans via hitCount delta |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `webSearch` outcome | `provider.search()` return | Brave HTTP (`https://api.search.brave.com/res/v1/web/search`) or Exa HTTP (`https://api.exa.ai/search`) — real network requests via native fetch | YES (when API key present) | FLOWING — providers issue real HTTP, normalize results from `web.results[]`, return frozen SearchResponse. Missing key returns invalid_argument (not empty data). |
| `webFetchUrl` outcome | fetched body → article extraction | `fetchUrl(url, opts)` real HTTP GET → Mozilla Readability extractArticle (Phase 70) | YES | FLOWING — fetcher.ts streams body up to maxBytes, errors.ts maps AbortError/TypeError to taxonomy; extractArticle returns `{title, byline, publishedTime, text, html}` or null (extraction_failed) |
| MCP subprocess response | `outcome.data` from daemon IPC | `sendIpcRequest` round-trip to daemon-owned clients | YES | FLOWING — buildMcpResponse wraps outcome in `{content:[{type:"text", text: JSON.stringify(data)}], isError: !ok}` |
| Auto-inject `search` entry | `resolvedMcpMap.get("search")` consumed by Claude SDK spawn | Set unconditionally when `defaults.search?.enabled !== false` and not already present | YES | FLOWING — defaults.search has full default factory in searchConfigSchema (enabled=true default), so the entry is set on every agent unless explicitly overridden |
| Intra-turn cache | `Turn.toolCache` hit | First call writes via invokeWithCache; subsequent identical-args call reads | YES (v1.7 machinery already operational) | FLOWING — IDEMPOTENT_TOOL_DEFAULTS extension is data-only; existing v1.7 cache reads the whitelist on every invocation |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| All phase-71 unit tests pass | `npx vitest run src/search src/ipc/__tests__/search-tool-call.test.ts src/config/__tests__/schema.test.ts src/config/__tests__/tools-schema.test.ts` | 8 files, 152 tests passed in 5.0s | PASS |
| Wiring tests pass (loader auto-inject, daemon source-grep, IPC protocol tuple) | `npx vitest run src/config/__tests__/loader.test.ts src/manager/__tests__/daemon-warmup-probe.test.ts src/ipc/__tests__/protocol.test.ts` | 3 files, 77 tests passed in 0.6s | PASS |
| Smoke script syntax valid | `node --check scripts/search-smoke.mjs` | exit 0 | PASS |
| Smoke script daemon-down branch exits 2 (distinguishes infra-skip from assertion-fail) | `CLAWCODE_SOCKET_PATH=/tmp/nonexistent-71-verify.sock node scripts/search-smoke.mjs` | "daemon not running — start with `clawcode start-all` first" + EXIT=2 | PASS |
| All 10 phase-71 commits present in git log | `gsd-tools verify commits 768ea34 b0d730d fd28219 d153101 269b9e0 8227c11 eb65e13 304a9f2 bbc6eda 6ead661` | all_valid: true (10/10) | PASS |
| Live web_search end-to-end (real Brave call) | `node scripts/search-smoke.mjs clawdy "anthropic claude api"` (requires daemon + BRAVE_API_KEY) | not run — requires running daemon + API key | SKIP (routed to human verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| SEARCH-01 | 71-01-PLAN, 71-02-PLAN | User (via agent) can call `web_search` with a query and receive a ranked list of results (title, URL, snippet, published date when available) from Brave Search, with an optional Exa backend selectable per-agent config | SATISFIED | `src/search/providers/brave.ts` createBraveClient with normalizeResult including publishedDate from `raw.age`; `src/search/providers/exa.ts` createExaClient; backend switch in `src/search/tools.ts:115-116` (D6 IPC test pins routing); auto-inject + IPC wiring complete |
| SEARCH-02 | 71-01-PLAN, 71-02-PLAN | User (via agent) can call `web_fetch_url` on a result URL and receive clean, readable page text along with metadata (title, author, publish date when extractable) | SATISFIED | `src/search/tools.ts:137-250` webFetchUrl with mode=readability default; `src/search/readability.ts` adapter reusing Phase 70 Mozilla Readability+jsdom; FetchUrlResult includes title, byline, publishedDate, text, html, wordCount |
| SEARCH-03 | 71-01-PLAN, 71-02-PLAN | User (as operator) can trust that duplicate `web_search` / `web_fetch_url` calls within a single turn return cached results (no double-charging), joining the v1.7 idempotent tool-cache whitelist, with the cache scoped to a single Turn | SATISFIED (programmatic) — cross-turn live observation routed to human | `src/config/schema.ts:270-283` IDEMPOTENT_TOOL_DEFAULTS extended (frozen, 6 entries, both tools present); `src/mcp/server.ts:160-188` invokeWithCache reads whitelist, hits short-circuit raw call. Per-Turn scoping is the existing v1.7 behavior (Turn.toolCache lifetime = single Turn); Phase 71 ships data-only changes here. |

**No orphaned requirements.** REQUIREMENTS.md maps all three SEARCH-* IDs exclusively to Phase 71, and all three appear in `requirements-completed` of both plan summaries.

### Anti-Patterns Found

Scanned `src/search/`, `src/cli/commands/search-mcp.ts`, `src/search/daemon-handler.ts`, `src/search/mcp-server.ts`, smoke script, and modified daemon/loader/protocol/types files.

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER | — | Clean |
| (none) | — | No `return null` / `return [] ` / `return {}` stub patterns in src/search | — | Clean |
| (none) | — | No `=> {}` empty handlers | — | Clean |
| (none) | — | No `placeholder`/`coming soon`/`not yet implemented` strings | — | Clean |

### Human Verification Required

#### 1. Live Brave API smoke test

**Test:** With daemon started and `BRAVE_API_KEY` set in env, run `node scripts/search-smoke.mjs clawdy "anthropic claude api"`
**Expected:** Exit 0 with three steps logged: `[1/3] web_search — N results, provider=brave (Xms)`, `[2/3] web_fetch_url — N chars, N words (Xms)`, `[3/3] web_search (repeat) — N results (Xms)`. First hit shows `title` + `url`; fetched text >100 chars + wordCount >10. `SMOKE PASS` at the end.
**Why human:** Requires real Brave API key + running daemon. Per Plan 02 verification check #9, deferred to deploy gate. The smoke script is syntactically valid and the daemon-down branch is verified (EXIT=2 reproduced just now).

#### 2. Cross-turn cache scoping (SEARCH-03 second clause)

**Test:** In one Turn (single agent message), have an agent call `web_search` twice with identical query. Then in a second Turn, have the agent call `web_search` again with the same query. Inspect trace.
**Expected:** Turn 1 produces ONE outbound HTTP request to Brave (second call short-circuits via cache, span shows `cached: true`). Turn 2 produces a NEW outbound HTTP request (cache scope ended at Turn boundary).
**Why human:** Verifying Turn-boundary cache eviction requires observing the trace span `cached: true` flag across two real Turns with a live Brave endpoint and an active agent session. The unit-level invokeWithCache + IDEMPOTENT_TOOL_DEFAULTS membership pieces are programmatically verified, but the Turn lifecycle interaction is integration-level and not unit-testable without a daemon + agent.

#### 3. v1.7 SLO non-regression at deploy gate (must_haves truth #5)

**Test:** Capture baseline `clawcode latency <agent> --since 1h` + `clawcode cache <agent> --since 1h` (first-token p95, prompt-cache hit rate). After switching to v2.0 build with Phase 71 active, rerun both.
**Expected:** First-token p95 within ~5% of baseline. Prompt-cache hit rate not degraded.
**Why human:** SLO measurement requires real agent traffic over a multi-hour window. Programmatic verification has confirmed: (a) zero diff to `src/performance/`, `src/mcp/server.ts`, `src/mcp/tool-cache.ts` (Plan 02 check #6), (b) Brave/Exa client construction is zero-cost (no env read, no network at boot), (c) no warm-path probe added — but only live measurement can confirm SLO non-regression.

### Gaps Summary

**No gaps blocking goal achievement.** All five Success Criteria from ROADMAP are programmatically verified at the artifact + wiring + data-flow level:

- SEARCH-01: Brave + Exa HTTP clients are real, lazy-keyed, frozen-envelope, dispatched by config.backend. Auto-inject + IPC + MCP subprocess wired end-to-end.
- SEARCH-02: webFetchUrl uses Phase 70 Mozilla Readability adapter; returns title/byline/publishedDate/text/html/wordCount. Mode=raw fallback uses jsdom.
- SEARCH-03: IDEMPOTENT_TOOL_DEFAULTS extended with both tools (frozen, length 6); invokeWithCache machinery reads the whitelist and short-circuits raw calls on Turn.toolCache hits.
- Auto-inject mirrors clawcode/1password/browser pattern; ordering is `clawcode → 1password → browser → search`.
- v1.7 SLO surface is untouched (zero diff to src/performance/, src/mcp/server.ts, src/mcp/tool-cache.ts) and clients are constructed but not eagerly initialized (no network, no env read at boot).

The remaining items requiring human attention are deploy-gate operational verifications: live Brave API smoke (script ready), cross-Turn cache observation, and SLO baseline-vs-post-switch comparison. None of these block the phase from being considered code-complete; they validate the deployed system rather than the codebase.

**Code quality is high:** zero TODO/FIXME/PLACEHOLDER/stub patterns in any phase-71 file. 152 phase-71-scoped tests + 77 wiring tests all pass (229 total). All 10 task commits verified. README updated. Smoke script syntax-valid + daemon-down branch verified to exit 2 just now.

---

_Verified: 2026-04-19T03:05:00Z_
_Verifier: Claude (gsd-verifier)_
