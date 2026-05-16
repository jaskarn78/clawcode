---
phase: 115-memory-context-prompt-cache-redesign
plan: 07
subsystem: mcp
tags: [tool-cache, mcp, sqlite, lru, per-agent-isolation, phase-999.40-fold]

# Dependency graph
requires:
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    provides: per-agent isolation lock — search_documents cache key MUST include agent_name (Phase 90 D-MEM-02). Verified by tool-cache-isolation.test.ts SQL assertions.
  - phase: 115-memory-context-prompt-cache-redesign
    provides: Plan 115-00 opened the tool_cache_hit_rate + tool_cache_size_mb column slots in traces.db migrateSchema. Plan 115-05 T04 established the recordLazyRecallCall trace-collector pattern that recordToolCacheHit / recordToolCacheMiss mirror exactly.
provides:
  - ToolCacheStore (better-sqlite3 wrapper) at ~/.clawcode/manager/tool-cache.db with LRU eviction + 100MB default cap
  - DEFAULT_TOOL_CACHE_POLICY (frozen) — per-tool TTL + key-strategy table for web_search / brave_search / exa_search / search_documents / mysql_query / google_workspace_*_get / image_generate / spawn_subagent_thread
  - isReadOnlySql write-pattern detector — defence-in-depth for mysql_query (rejects CTE-then-write trap)
  - buildCacheKey + stableStringify (sorted-keys JSON) — per-agent vs cross-agent keying with grep-verifiable strategy lock
  - stampCachedResponse — { cached: { age_ms, source: "tool-cache" }, data } envelope on hits
  - dispatchTool — daemon-side cache-aware dispatch primitive with bypass_cache + content-cacheable gate + failure-isolated trace recording
  - defaults.toolCache config schema (enabled / maxSizeMb / per-tool policy overrides)
  - tool-cache-status / tool-cache-clear / tool-cache-inspect IPC methods
  - clawcode tool-cache {status|clear|inspect} CLI command
  - TraceCollector.recordToolCacheHit + recordToolCacheMiss + drainPendingToolCacheCounters (mirrors 115-05 T04 lazy-recall pattern)
  - TraceStore.getToolCacheTelemetry — aggregate avg hit-rate + size over agent + window
  - Dashboard cache panel extension — `tool cache: <hit_rate> · <size_mb> (<turns> turns)` subtitle line via tool_cache_size_mb_live IPC patch
affects: [115-08, 115-09, 999.40-superseded]

# Tech tracking
tech-stack:
  added:
    - ~/.clawcode/manager/tool-cache.db (new SQLite database, schema-version 1)
  patterns:
    - "Daemon-side persistent cache layered on top of Phase 55's per-Turn idempotent cache (ToolCache class). The two coexist: per-Turn ToolCache deduplicates within a single turn (LLM dispatches same tool twice in one assistant message); ToolCacheStore deduplicates across turns + across agents."
    - "Cache-key strategy as policy enum, NOT bare boolean. CacheKeyStrategy = 'per-agent' | 'cross-agent' | 'no-cache' makes intent grep-verifiable and the agent_or_null SQL column reflects the choice (NULL for cross-agent shared, agentName for per-agent isolated)."
    - "isReadOnlySql defence-in-depth: rejects ANY occurrence of write keywords (update / insert / delete / drop / alter / truncate) anywhere in the query, not just at the leading verb. Catches the `WITH foo AS (SELECT 1) UPDATE bar` CTE-then-write trap."
    - "Stable-stringify keys via sorted-keys JSON + sha256 truncated to 32 hex chars. Arg-order-insensitive across nested objects + arrays so call-site argument order doesn't cause spurious misses."
    - "Closure-intercept pattern for IPC method augmentation — case 'cache' is wrapped BEFORE routeMethod runs to fold tool_cache_size_mb_live onto the response. Mirrors openAiEndpointRef + browser-tool-call closure intercepts elsewhere in daemon.ts; avoids 24-arg routeMethod surgery."

key-files:
  created:
    - src/mcp/tool-cache-store.ts
    - src/mcp/tool-cache-policy.ts
    - src/cli/commands/tool-cache.ts
    - src/mcp/__tests__/tool-cache-store.test.ts
    - src/mcp/__tests__/tool-cache-policy.test.ts
    - src/mcp/__tests__/tool-cache-isolation.test.ts
  modified:
    - src/mcp/tool-dispatch.ts (added dispatchTool function + ToolCacheTraceRecorder interface)
    - src/config/schema.ts (added defaults.toolCache zod schema)
    - src/ipc/protocol.ts (registered tool-cache-status / -clear / -inspect)
    - src/ipc/__tests__/protocol.test.ts (updated IPC_METHODS exact-match)
    - src/manager/daemon.ts (instantiated ToolCacheStore singleton + wired dispatchTool around search-tool-call / image-tool-call / search-documents IPC + closure-intercept of `cache` for tool_cache_size_mb_live + cleanup hook in shutdown)
    - src/performance/trace-collector.ts (recordToolCacheHit + recordToolCacheMiss + drainPendingToolCacheCounters + bumpToolCacheHit/Miss on Turn + per-turn toolCacheHitRate column attachment)
    - src/performance/trace-store.ts (extended insertTrace prepared statement to write tool_cache_hit_rate + tool_cache_size_mb columns; added getToolCacheTelemetry method)
    - src/cli/index.ts (registerToolCacheCommand wiring)
    - src/dashboard/static/app.js (renderCachePanel: 4th subtitle line surfacing tool_cache_hit_rate / tool_cache_size_mb / turns; falls back to tool_cache_size_mb_live)

key-decisions:
  - "Per-agent vs cross-agent isolation locked via DEFAULT_TOOL_CACHE_POLICY frozen object. search_documents → per-agent (Phase 90 lock); web_search / brave_search / exa_search → cross-agent (public data shared). Both strategies are grep-verifiable in tool-cache-policy.ts AND in tool-dispatch.ts at the put-call sites (`agent_or_null: agentName` for per-agent / `agent_or_null: null` for cross-agent). The blocking-critical isolation invariant is also verified at runtime by tool-cache-isolation.test.ts via SQL assertions over the agent_or_null column — not just source greps."
  - "Live coverage scope — three tool families flow through dispatchTool today: search_documents (case `search-documents` IPC), web_search/web_fetch_url (case `search-tool-call`), image_generate/image_edit/image_variations (case `image-tool-call`). Other policy-table entries (mysql_query, brave_search, exa_search, google_workspace_*_get, spawn_subagent_thread) are POLICY-only — they exist in DEFAULT_TOOL_CACHE_POLICY and the policy contract is unit-tested, but those tools dispatch via paths not yet routed through clawcode IPC (e.g., SDK MCP broker for mysql_query / google_workspace_*; native CLI plugin handler for brave_search / exa_search). The 40% hit-rate target therefore applies to the wired subset on day one; rolling additional tools through dispatchTool is straightforward future work (one closure intercept per tool family)."
  - "tool_cache_size_mb is a fleet-wide signal sourced from ToolCacheStore.sizeMb(). Plan body §T03 step 4 proposed periodic 60s writes to traces.db.tool_cache_size_mb; deviated to a closure-intercept of `case cache` IPC that folds tool_cache_size_mb_live onto the response on every dashboard refresh. Rationale: per-turn rollups are agent-scoped but the cache is fleet-scoped — putting the size in agent-scoped percentiles would be misleading. The per-turn column slot remains open for future per-agent variants if we ever shard the cache."
  - "isReadOnlySql is intentionally over-strict. Any query containing the words update / insert / delete / drop / alter / truncate / replace into / grant / revoke / merge into anywhere in the query body is REJECTED. False positives on read queries containing those as data values are accepted (cache miss only — no stale-data risk). False negatives (write queries cached as reads) are unacceptable because they would serve stale state. Ten dedicated unit tests pin this down."
  - "Cache stamping shape matches Anthropic's prompt cache hit detection — `{ cached: { age_ms, source }, data }`. Agents see the `cached` envelope as the staleness indicator and can decide whether to trust or re-call with bypass_cache: true. The envelope is frozen at construction so consumers can't mutate the staleness metadata."
  - "Optional toolCache config field — mirrors Phase 110 shimRuntime / Phase 115-06 embeddingMigration schema-only-default pattern. When operator omits the field, runtime fills in enabled=true / maxSizeMb=100 / empty policy overrides at the consumption site. Prevents 7+ test fixtures from needing updates and keeps the schema additive."

patterns-established:
  - "Daemon-side tool-response cache as a closure-intercept layer in the IPC handler. Each tool family that should cache gets one closure block in daemon.ts that wraps `dispatchTool` around the upstream call. Adding a new cacheable tool is a 5-line change at the IPC boundary plus one entry in DEFAULT_TOOL_CACHE_POLICY."
  - "Trace-recording as best-effort, failure-isolated. recordToolCacheHit / recordToolCacheMiss never throw — wrapped in try/catch with warn-level log. Mirrors the recordLazyRecallCall pattern from Plan 115-05 T04. Observability never blocks the dispatch path."
  - "Augmenting an existing IPC response via closure intercept. The `case cache` intercept calls routeMethod, takes its result, and folds tool_cache_size_mb_live onto each augmented report. Cleaner than threading the cache singleton through routeMethod's 24-arg signature."

requirements-completed: []

# Metrics
duration: 28 min
completed: 2026-05-08
---

# Phase 115 Plan 07: MCP tool-response cache (folds Phase 999.40)

**Daemon-side content-keyed cache for repeated MCP tool calls. Per-tool TTL + key-strategy policy table; storage at ~/.clawcode/manager/tool-cache.db with LRU eviction + 100MB cap; bypass_cache flag + cache-stamping envelope; per-agent vs cross-agent isolation locked at the policy layer and verified at runtime via SQL assertions over the agent_or_null column.**

## Performance

- **Duration:** 28 min
- **Started:** 2026-05-08T06:11:37Z
- **Completed:** 2026-05-08T06:40:23Z
- **Tasks:** 4 (T01–T04) + 1 advisor-driven cleanup + 1 protocol-test fix
- **Files created:** 6
- **Files modified:** 9
- **New tests:** 60 (across 3 plan-15 test files)
- **Total commits:** 6 (4 task commits + 1 test-fix + 1 cleanup)

## Accomplishments

- **ToolCacheStore (T01)** — better-sqlite3 wrapper at `~/.clawcode/manager/tool-cache.db`. Schema: `(key, tool, agent_or_null, response_json, created_at, expires_at, bytes, last_accessed_at)` with indexes on tool / expires_at / last_accessed_at / agent_or_null. Lazy expiration (get on expired row deletes + returns null). LRU eviction (drops expired rows first, then evicts oldest by last_accessed_at) inside the SAME transaction as the insert so partial failures roll back consistently. Inspection / management API (inspect / topToolsByRows / clear / sizeMb / rowCount) consumed by T04 CLI + dashboard.

- **Per-tool policy (T02)** — DEFAULT_TOOL_CACHE_POLICY frozen object with the locked invariants from roadmap line 857:
  - **Cross-agent (public data shared):** `web_search` / `brave_search` / `exa_search` / `web_fetch_url` → 300s
  - **Per-agent (Phase 90 isolation):** `search_documents` → 1800s; `mysql_query` → 60s with isReadOnlySql gate; `google_workspace_drive_get` / `_calendar_get` / `_gmail_get` → 300s
  - **No-cache (each call unique work):** `image_generate` / `image_edit` / `image_variations` / `spawn_subagent_thread` → 0
- **isReadOnlySql** — defence-in-depth write detector. Accepts SELECT / WITH / SHOW / DESCRIBE / EXPLAIN / VALUES / TABLE only. Rejects CTE-then-write patterns by scanning the entire query for write keywords with word boundaries. Ten unit tests pin all verbs + the `WITH foo AS (SELECT 1) UPDATE bar` trap.
- **buildCacheKey** — per-agent components include agentName → distinct keys per agent; cross-agent components OMIT agentName → identical keys across agents. SHA-256 of stable-stringified components, hex-truncated to 32 chars. Arg-order-insensitive across nested objects + arrays.
- **stampCachedResponse** — `{ cached: { age_ms, source: "tool-cache" }, data }` envelope on hits. Frozen; clamps negative age to 0 for clock-skew tolerance.

- **dispatchTool wrapper (T03)** — daemon-side cache-aware tool invocation primitive. Flow:
  1. `args.bypass_cache === true` → upstream call, no cache touch.
  2. Resolve effective policy (defaults + operator overrides).
  3. `keyStrategy === "no-cache"` OR `ttlSeconds <= 0` → upstream, no cache.
  4. `policy.cacheable(args)` returns false → upstream, no cache (mysql_query write-shaped queries).
  5. Build cache key via `buildCacheKey`.
  6. Cache GET. On hit: record trace hit, return stamped response.
  7. Cache MISS: run upstream, store result with TTL, record trace miss, return raw result.
  Failure isolation: cache GET / PUT errors NEVER fail the upstream call. Trace recording errors never block dispatch. Corrupt cached row triggers a clear() + fall-through.

- **IPC wiring (T03)** — closure-intercept pattern around three IPC methods:
  - `search-tool-call` → web_search / web_fetch_url with cross-agent strategy.
  - `image-tool-call` → image_generate / _edit / _variations (no-cache via policy, dispatchTool bypasses).
  - `search-documents` → per-agent strategy (Phase 90 lock).
  Plus three new IPC methods registered for the operator CLI: `tool-cache-status`, `tool-cache-clear`, `tool-cache-inspect`.

- **Trace recording (T03)** — `TraceCollector.recordToolCacheHit` + `recordToolCacheMiss` mirror the `recordLazyRecallCall` pattern from Plan 115-05 T04. Per-agent active-Turn registry routes increments to the active turn's `bumpToolCacheHit` / `bumpToolCacheMiss`. Out-of-turn events accumulate in `pendingToolCacheHits/Misses` and drain into the next ended turn via `drainPendingToolCacheCounters`. `TraceStore.insertTrace` extended to write the `tool_cache_hit_rate` column (NULL when no cache events that turn). `TraceStore.getToolCacheTelemetry` aggregates avg hit-rate + size + turns-with-events over a window.

- **Operator CLI + dashboard (T04)** — `clawcode tool-cache {status|clear|inspect}` operator-facing surface:
  - **status:** size + rows + top tools by row count, with `--json` flag.
  - **clear [tool]:** drop all rows or filter by tool name.
  - **inspect [tool] [agent]:** list rows (1..500 limit), most recently accessed first, with safety note about credential leakage in cached rows.
  Dashboard cache panel extended with a fourth subtitle line: `tool cache: <hit_rate> · <size_mb> (<turns> turn(s))`. Falls back to `tool_cache_size_mb_live` (closure-intercepted onto the `case cache` IPC response) so the size signal is fresh on first deploy.

## Task Commits

Each task was committed atomically:

1. **T01: ToolCacheStore (LRU + 100MB cap)** — `0098f33` (feat)
2. **T02: Per-tool policy + isReadOnlySql + cache stamping** — `2bea7d1` (feat)
3. **T03: Wire dispatchTool into IPC + traces + config** — `90d313e` (feat)
4. **T04: clawcode tool-cache CLI + dashboard surface** — `8cd91a8` (feat)

**Test alignment fix:** `fbe1e6d` — updated IPC_METHODS exact-match test to include the four 115-06 `embedding-migration-*` methods (missed in Plan 115-06's protocol additions) plus the three new 115-07 `tool-cache-*` methods.

**Advisor-driven cleanup:** `24f4330` — dropped two unused vars (`latestToolCacheSizeMb`, `getCurrentToolCacheSizeMb`) left over from a T04 design iteration. The closure-intercept of `case cache` reads `toolCacheStore.sizeMb()` inline, so neither closure was needed.

## Files Created/Modified

### Created

- `src/mcp/tool-cache-store.ts` — better-sqlite3 wrapper (260 lines).
- `src/mcp/tool-cache-policy.ts` — DEFAULT_TOOL_CACHE_POLICY + isReadOnlySql + buildCacheKey + stampCachedResponse + resolveToolCachePolicy (150 lines).
- `src/cli/commands/tool-cache.ts` — `clawcode tool-cache` operator CLI (200 lines, 3 subcommands).
- `src/mcp/__tests__/tool-cache-store.test.ts` — 13 tests covering schema, put/get round-trip, lazy expiration, LRU promotion + eviction, expired-row preferential reclaim, inspect filters, clear all + by tool, topToolsByRows aggregation, rowCount + sizeMb tracking.
- `src/mcp/__tests__/tool-cache-policy.test.ts` — 32 tests covering locked-strategy invariants, isReadOnlySql across all verbs + CTE-then-write trap, key-isolation across two agents (cross- vs per-agent), arg-order independence, deep-nested object stability, staleness wrap shape, operator override resolution.
- `src/mcp/__tests__/tool-cache-isolation.test.ts` — 15 tests with **load-bearing SQL assertions over agent_or_null**: cross-agent web_search produces ONE row with NULL; per-agent search_documents produces TWO rows with distinct agentName values. Plus mysql_query SELECT cached / INSERT-UPDATE-DELETE never cached / CTE-then-write trap rejected, bypass_cache forces fresh, image_generate / spawn_subagent_thread no-cache, cache stamping shape, operator override flips strategy.

### Modified

- `src/mcp/tool-dispatch.ts` — added `dispatchTool` function + `ToolCacheTraceRecorder` interface + `safeStringify` helper (200 lines added). Phase 55 `runWithConcurrencyLimit` + `ConcurrencyGate` exports unchanged.
- `src/config/schema.ts` — added `defaults.toolCache` zod schema (40 lines).
- `src/ipc/protocol.ts` — registered three new IPC methods.
- `src/ipc/__tests__/protocol.test.ts` — updated exact-match test (added 4 missing 115-06 entries + 3 new 115-07 entries).
- `src/manager/daemon.ts` — ToolCacheStore singleton + 60s journalctl size sampler + closure-intercept around `search-tool-call` / `image-tool-call` / `search-documents` / `cache` / `tool-cache-status` / `tool-cache-clear` / `tool-cache-inspect` IPC methods + shutdown cleanup.
- `src/performance/trace-collector.ts` — recordToolCacheHit + recordToolCacheMiss + drainPendingToolCacheCounters + bumpToolCacheHit/Miss + per-turn `toolCacheHitRate` column attachment in Turn.end.
- `src/performance/trace-store.ts` — extended `insertTrace` prepared statement (14-arg → 16-arg, adds tool_cache_hit_rate + tool_cache_size_mb) + new `getToolCacheTelemetry` aggregate method.
- `src/cli/index.ts` — registerToolCacheCommand wiring.
- `src/dashboard/static/app.js` — renderCachePanel 4th subtitle line.

## Decisions Made

1. **Per-agent vs cross-agent isolation locked in DEFAULT_TOOL_CACHE_POLICY (frozen object).** The blocking-critical Phase 90 invariant for `search_documents` is locked at the policy declaration AND at the dispatchTool put-call sites. The two `agent_or_null` literal patterns (`agentName` for per-agent / `null` for cross-agent) are grep-verifiable per the plan acceptance criteria, AND the runtime SQL assertions in tool-cache-isolation.test.ts catch any regression in BEHAVIOR. Both layers — source greps for INTENT, SQL assertions for BEHAVIOR — are required because intent without behavior verification is documentation, not enforcement.

2. **Live coverage is narrower than the policy table — explicitly documented.** Three tool families flow through dispatchTool today (search_documents, web_search/web_fetch_url, image_generate/_edit/_variations). The policy table also covers mysql_query, brave_search, exa_search, google_workspace_*_get, spawn_subagent_thread — but those tools dispatch via different paths (SDK MCP broker for mysql + google workspace; native CLI plugin handlers for brave/exa). The acceptance-criteria 40% hit-rate target therefore applies to the wired subset on day one. Rolling additional tools through dispatchTool is straightforward future work (one closure intercept per tool family + one entry in DEFAULT_TOOL_CACHE_POLICY); no additional architectural plumbing required.

3. **tool_cache_size_mb deviation from plan body §T03 step 4.** Plan body proposed periodic 60s writes to `traces.db.tool_cache_size_mb` per agent. Shipped a different design: a closure intercept of the `case cache` IPC method folds `tool_cache_size_mb_live` onto every augmented response by calling `toolCacheStore.sizeMb()` inline. The 60s sampler still runs but only logs to journalctl for grep visibility. Rationale: the cache is fleet-scoped (one DB at `~/.clawcode/manager/tool-cache.db`) but per-turn rollups are agent-scoped; putting the fleet signal in agent-scoped percentile aggregates would mislead operators (e.g., agent A's "p95 tool_cache_size_mb" would actually be the fleet-wide size). The per-turn column slot stays open in the schema for future per-agent shard variants. Documented in the deviations section below.

4. **isReadOnlySql is intentionally over-strict — false positives accepted, false negatives are not.** Any query containing the words update / insert / delete / drop / alter / truncate / replace into / grant / revoke / merge into anywhere in the query body is REJECTED. False positives on read queries containing those as data values just cause a cache miss (no stale-data risk). False negatives (write queries cached as reads) are unacceptable because they would serve stale state after the write. Ten dedicated unit tests pin all verbs + the CTE-then-write trap.

5. **Cache stamping shape matches Anthropic's prompt cache hit detection.** `{ cached: { age_ms, source: "tool-cache" }, data }` envelope on hits. Agents see the `cached` envelope as the staleness indicator and can decide whether to trust or re-call with bypass_cache: true. The envelope is frozen at construction so consumers can't mutate the staleness metadata. Cache MISSES return raw upstream — no envelope — so the agent has a uniform "envelope present = hit" contract.

6. **Optional `defaults.toolCache` config field.** Mirrors Phase 110 shimRuntime / Phase 115-06 embeddingMigration schema-only-default pattern. When operator omits the field, runtime fills in enabled=true / maxSizeMb=100 / empty policy overrides at the consumption site. Avoids forcing 7+ existing test fixtures to gain a new field they don't care about.

7. **Closure-intercept pattern for IPC method augmentation.** The `case cache` intercept (T04) calls routeMethod, takes its result, and folds `tool_cache_size_mb_live` onto each augmented report. Cleaner than threading the cache singleton through routeMethod's 24-arg signature. Mirrors openAiEndpointRef + browser-tool-call closure intercepts elsewhere in daemon.ts.

## Live Coverage

**Tools wired through dispatchTool today:**

| Tool | IPC method | Strategy | TTL |
|---|---|---|---|
| `search_documents` | `search-documents` | per-agent | 1800s |
| `web_search` | `search-tool-call` | cross-agent | 300s |
| `web_fetch_url` | `search-tool-call` | cross-agent | 300s |
| `image_generate` | `image-tool-call` | no-cache | 0 |
| `image_edit` | `image-tool-call` | no-cache | 0 |
| `image_variations` | `image-tool-call` | no-cache | 0 |

**Tools in DEFAULT_TOOL_CACHE_POLICY but NOT yet wired (policy-only):**

| Tool | Why pending |
|---|---|
| `mysql_query` | Dispatches via SDK MCP broker; clawcode IPC layer is not on the path. Wiring requires adding a closure intercept around the broker dispatch call. |
| `brave_search` | Native CLI plugin handler; not flowing through `case search-tool-call`. The agent's MCP host invokes it directly. |
| `exa_search` | Same as brave_search. |
| `google_workspace_drive_get` / `_calendar_get` / `_gmail_get` | SDK MCP broker; same as mysql_query. |
| `spawn_subagent_thread` | Already in the IPC layer but no cache wrap was added — it's `no-cache` policy so wrap would be a no-op anyway. |

The `tool_cache_hit_rate` ≥ 40% target from roadmap line 885 applies to the wired subset on day one. Rolling additional tools through dispatchTool is straightforward future work — each addition is a 5-line closure intercept around the upstream dispatch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reverted per-Turn `tool_cache_size_mb` write path; deviated to live IPC patch instead**

- **Found during:** T04 implementation review (advisor consult).
- **Issue:** Plan body §T03 step 4 said *"Periodically (every 60s) compute size and write to `traces.db.tool_cache_size_mb`."* I initially implemented this by registering a getter closure on TraceCollector, then having Turn.end() stamp `tool_cache_size_mb` on each turn that had cache events. But this introduced a fleet-scoped signal into per-agent percentile rollups, which would have made agent A's "p95 tool_cache_size_mb" actually be the fleet-wide value — misleading.
- **Fix:** Reverted the per-Turn size column write. Added a closure intercept of `case cache` IPC that folds `tool_cache_size_mb_live` onto every augmented response by calling `toolCacheStore.sizeMb()` inline. Dashboard reads the live signal on every refresh; per-turn column slot stays open in schema for future per-agent shard variants.
- **Files modified:** src/manager/daemon.ts (closure intercept + cleanup), src/performance/trace-collector.ts (removed getter registration + per-Turn size attachment).
- **Verification:** Dashboard test (renderCachePanel) reads `tool_cache_size_mb_live` as fallback. Tool-cache-isolation test still passes.
- **Committed in:** Initially in 8cd91a8 (T04); cleanup of dead vars in 24f4330 (post-advisor).

**2. [Rule 3 - Blocking] Updated IPC_METHODS exact-match test for two missing sets**

- **Found during:** Regression sweep after T03/T04.
- **Issue:** `src/ipc/__tests__/protocol.test.ts` asserts `IPC_METHODS` equals an exact array. The test was missing four `embedding-migration-*` entries from Plan 115-06 (apparently not updated in that plan) plus the three new `tool-cache-*` entries from this plan. Test failed.
- **Fix:** Added all seven entries to the expected array with comments tagging their phase of origin.
- **Files modified:** src/ipc/__tests__/protocol.test.ts.
- **Verification:** 34/34 tests pass.
- **Committed in:** fbe1e6d.

**3. [Rule 1 - Bug] Removed two unused closure variables (advisor catch)**

- **Found during:** Post-T04 advisor consult.
- **Issue:** After deviation #1, `latestToolCacheSizeMb` (let, mutated by 60s sampler, never read) and `getCurrentToolCacheSizeMb` (const closure, never invoked) were left dangling — only kept alive by `void` statements. Dead code that confused intent.
- **Fix:** Deleted both. The closure intercept of `case cache` reads `toolCacheStore.sizeMb()` inline, so neither was needed.
- **Files modified:** src/manager/daemon.ts.
- **Verification:** 115/115 tests pass post-cleanup.
- **Committed in:** 24f4330.

---

**Total deviations:** 3 (1 design call + 1 blocking test fix + 1 cleanup).
**Impact on plan:** None of the deviations affected acceptance criteria. All tests pass; CLI registers; build succeeds. Deviation #1 is a defensible design call — putting fleet-scoped signals in agent-scoped rollups would be misleading. Deviation #2 was strictly housekeeping (Plan 115-06 should have caught it). Deviation #3 was cosmetic.

## Issues Encountered

- **Pre-existing failure: `src/config/__tests__/schema.test.ts > PR11: parse-regression`** — depends on `clawcode.yaml` in repo root which is absent in the workspace tree. Verified pre-existing via `git stash && npx vitest run src/config/__tests__/schema.test.ts`. Documented in `.planning/phases/115-memory-context-prompt-cache-redesign/deferred-items.md` as pre-existing since Plan 115-04. Out of scope.

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| All 4 tasks executed | ✅ | T01-T04 each committed atomically |
| T01: ToolCacheStore schema + LRU + 100MB cap | ✅ | 13 tests pass; `grep "tool-cache.db"` 3 matches; `grep "evictIfNeeded\|LRU"` 11 matches |
| T02: Per-tool TTL config + cacheable-tool allowlist | ✅ | 32 tests pass; DEFAULT_TOOL_CACHE_POLICY frozen object lock |
| T02: search_documents keys include agent_name (grep-verifiable) | ✅ | `grep "search_documents.*per-agent"` 4 matches; runtime SQL test asserts 2 distinct rows per agent |
| T02: web_search/brave/exa keys omit agent_name (grep-verifiable) | ✅ | `grep "web_search.*cross-agent"` etc. 6 matches; runtime SQL test asserts 1 row with agent_or_null=NULL |
| T02: mysql_query rejects INSERT/UPDATE/DELETE | ✅ | 10 isReadOnlySql tests; tool-cache-isolation 3 dedicated write tests + CTE-then-write trap test |
| T03: MCP request path intercepts; cache stamping `{cached:{age_ms,source}}` | ✅ | dispatchTool wired around 3 IPC methods; isolation test asserts envelope shape on hits |
| T04: bypass_cache: true forces fresh call | ✅ | Dedicated test; runtime upstream invocation count assertion |
| T04: tool_cache_hit_rate + tool_cache_size_mb metrics surface | ✅ | Dashboard subtitle line; CLI status output; trace-store getToolCacheTelemetry method |
| Each task committed individually | ✅ | 6 commits total: 4 task + 1 test fix + 1 cleanup |
| SUMMARY.md created | ✅ | This file |
| `npx tsc --noEmit` clean | ✅ | Zero errors |
| All new tests green | ✅ | 60/60 plan tests + 21/21 trace-collector regression + 22/22 Phase 55 regression + 34/34 IPC protocol = 137/137 in scope |

## Notes

### Phase 999.40 SUPERSEDED-BY-115

Phase 999.40 ("Daemon-side response cache for repeated MCP tool calls") was already marked `SUPERSEDED 2026-05-07 — fully absorbed as Phase 115 sub-scope 15` in `.planning/ROADMAP.md` line 1799-1801. No additional roadmap edit needed for that fold.

### Operator deploy guidance

When this plan ships to clawdy:

1. **No migration step required.** The cache DB at `~/.clawcode/manager/tool-cache.db` is created on first daemon start; lazy schema creation handles the cold path.
2. **Pre-existing turns** with NULL `tool_cache_hit_rate` are unaffected — the column is nullable and the dashboard treats NULL as "no cache events yet."
3. **Operator can wipe the cache** at any time via `clawcode tool-cache clear`. Subsequent tool calls re-populate.
4. **Bypass without disabling globally:** any agent can pass `bypass_cache: true` in tool args. To disable globally, set `defaults.toolCache.enabled: false` in clawcode.yaml. To shorten TTL for a specific tool, set `defaults.toolCache.policy.<tool_name>.ttlSeconds: <seconds>`.

### Hit-rate target

Roadmap line 885 sets the goal: `tool_cache_hit_rate ≥ 40%` on agents with repetitive read patterns (fin-acq, fin-research, finmentum-content-creator). Plan 115-09 closeout will measure actual hit rate against this target — if it underperforms, the gap likely sits in the not-yet-wired tools (mysql_query in particular, which is the 120s p50 outlier this plan targets).

### Future work — extending coverage

To wire `mysql_query`, `brave_search`, `exa_search`, or `google_workspace_*_get` through the cache:

1. Find the IPC dispatch boundary (likely SDK MCP broker for mysql + google_workspace; native CLI plugin handler for brave/exa).
2. Add a closure intercept that constructs a `dispatchTool({ tool, args, agentName, cacheStore: toolCacheStore, ... })` call wrapping the existing handler.
3. Verify the policy entry matches the desired strategy (already declared for these tools in DEFAULT_TOOL_CACHE_POLICY).
4. Add a runtime SQL assertion test similar to `tool-cache-isolation.test.ts` for the new tool family.

No new infrastructure required.

## Next Phase Readiness

- **Wave 3 plan 8 (115-07) complete.** Sub-scope 15 (MCP tool-response cache, folds Phase 999.40) shipped.
- **Wave 4 dependencies satisfied.** All trace-store columns now have writers (lazy_recall_call_count from 115-05; tool_cache_hit_rate from this plan; tool_cache_size_mb via the live IPC patch). Plan 115-09 closeout measurement can proceed.
- **Ramy gate respected.** Code commits only; no deploys this plan.

## Self-Check: PASSED

Files created (verified):
- src/mcp/tool-cache-store.ts: FOUND
- src/mcp/tool-cache-policy.ts: FOUND
- src/cli/commands/tool-cache.ts: FOUND
- src/mcp/__tests__/tool-cache-store.test.ts: FOUND
- src/mcp/__tests__/tool-cache-policy.test.ts: FOUND
- src/mcp/__tests__/tool-cache-isolation.test.ts: FOUND

Commits (verified via `git log`):
- 0098f33 (T01): FOUND
- 2bea7d1 (T02): FOUND
- 90d313e (T03): FOUND
- 8cd91a8 (T04): FOUND
- fbe1e6d (test fix): FOUND
- 24f4330 (cleanup): FOUND

Tests (verified via vitest):
- tool-cache-store.test.ts: 13/13 passed
- tool-cache-policy.test.ts: 32/32 passed
- tool-cache-isolation.test.ts: 15/15 passed
- trace-collector.test.ts: 12/12 passed
- trace-collector-lazy-recall.test.ts: 9/9 passed
- protocol.test.ts: 34/34 passed
- tool-cache.test.ts (Phase 55 regression): 13/13 passed
- tool-dispatch.test.ts (Phase 55 regression): 9/9 passed
- **Total: 137/137 in-scope tests pass.**

Build (verified): `npm run build` succeeds, `clawcode tool-cache --help` registers all 3 subcommands.

---
*Phase: 115-memory-context-prompt-cache-redesign*
*Completed: 2026-05-08*
