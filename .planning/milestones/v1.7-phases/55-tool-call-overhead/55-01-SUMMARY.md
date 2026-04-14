---
phase: 55-tool-call-overhead
plan: 01
subsystem: config + shared + performance
tags: [zod, perf-tools, canonical-stringify, tool-percentiles, slo-per-tool, tool-call, idempotent-whitelist]

# Dependency graph
requires:
  - phase: 51-01
    provides: DEFAULT_SLOS + SloEntry shape + sloOverrideSchema precedent + ResolvedAgentConfig.perf readonly mirror pattern
  - phase: 53-01
    provides: lazySkillsSchema default-at-Zod pattern + resumeSummaryBudgetSchema floor-only pattern
  - phase: 54-01
    provides: streamingConfigSchema inline-literal TS mirror pattern + getFirstTokenPercentiles convenience-wrapper precedent
provides:
  - IDEMPOTENT_TOOL_DEFAULTS frozen 4-entry whitelist (memory_lookup, search_documents, memory_list, memory_graph — LOCKED per CONTEXT D-02)
  - toolSloOverrideSchema + ToolSloOverride Zod exports (per-tool SLO override shape)
  - toolsConfigSchema + ToolsConfig Zod exports (maxConcurrent default 10 + min 1, idempotent default whitelist, slos record optional)
  - ResolvedAgentConfig.perf.tools? inline-literal TS mirror on src/shared/types.ts
  - canonicalStringify utility (src/shared/canonical-stringify.ts) — deterministic stable stringify for cache keys
  - ToolPercentileRow type on src/performance/types.ts
  - TraceStore.getToolPercentiles(agent, sinceIso) method + perToolPercentiles prepared statement
  - getPerToolSlo(toolName, perTools?) helper on src/performance/slos.ts — per-tool SLO with global tool_call fallback
affects: [55-02, 55-03]

# Tech tracking
tech-stack:
  added: []  # No new runtime dependencies
  patterns:
    - "Default-at-Zod for idempotent whitelist — idempotent[] is populated with IDEMPOTENT_TOOL_DEFAULTS by the schema so consumers get the full 4-tool list automatically without explicit config"
    - "Default-at-Zod for maxConcurrent — default 10, hard floor 1 enforced via .min(1). Mirrors Phase 53 lazySkillsSchema.usageThresholdTurns.min(5) + Phase 54 streamingConfigSchema.editIntervalMs.min(300)"
    - "perf.tools wired into BOTH agentSchema.perf AND defaultsSchema.perf for fleet-wide default path, same as streaming / lazySkills / resumeSummaryBudget before it"
    - "ResolvedAgentConfig.perf.tools inline-literal TS mirror preserves Phase 51 / 53 / 54 low-dep boundary on src/shared/types.ts (no cross-module import)"
    - "canonicalStringify uses JSON.stringify(normalize(value)) approach — undefined + null + NaN collapse to null, object keys recursively sorted, arrays preserve order. Matches JSON.stringify NaN behavior"
    - "getToolPercentiles SQL uses CTE + ROW_NUMBER() OVER (PARTITION BY tool_name ORDER BY duration_ms) + CAST(cnt * 0.50 AS INTEGER) + 1 nearest-rank — mirrors PERCENTILE_SQL approach exactly, just grouped per tool"
    - "SUBSTR(s.name, 11) extracts tool_name after `tool_call.` prefix (10 chars + period = 11 SQL-1-indexed positions to skip)"
    - "ORDER BY p95 DESC NULLS LAST at SQL layer so CLI / dashboard render slowest-first without a client-side re-sort"
    - "getPerToolSlo returns frozen { thresholdMs, metric } with guaranteed-non-null fallback to global tool_call SLO — consumers never null-check"

key-files:
  created:
    - src/shared/canonical-stringify.ts
    - src/shared/__tests__/canonical-stringify.test.ts
    - src/config/__tests__/tools-schema.test.ts
  modified:
    - src/config/schema.ts
    - src/shared/types.ts
    - src/performance/types.ts
    - src/performance/trace-store.ts
    - src/performance/slos.ts
    - src/performance/__tests__/trace-store.test.ts
    - src/performance/__tests__/slos.test.ts

key-decisions:
  - "Phase 55 Plan 01 — IDEMPOTENT_TOOL_DEFAULTS is LOCKED at 4 entries per CONTEXT D-02. Tests explicitly assert length === 4, verbatim names match ['memory_lookup', 'search_documents', 'memory_list', 'memory_graph'], AND 8 forbidden non-idempotent tools (memory_save, spawn_subagent_thread, ingest_document, delete_document, send_message, send_to_agent, send_attachment, ask_advisor) are asserted NOT present. Adding a tool requires a CONTEXT amendment — caching non-idempotent tools is a correctness bug."
  - "Phase 55 Plan 01 — idempotent[] default is applied AT THE ZOD LAYER (not the consumer), so a user writing `perf: { tools: { maxConcurrent: 5 } }` still receives the full 4-tool whitelist automatically. This matches Phase 53's default-at-consumer pattern for resumeSummaryBudget (500 floor at Zod, 1500 default at consumer) but inverts it — here the default whitelist SHOULD ship with the schema because Plan 55-02's tool-cache depends on it being populated."
  - "Phase 55 Plan 01 — maxConcurrent default 10 + min 1 at Zod mirrors Phase 54 streamingConfigSchema.editIntervalMs.min(300) floor pattern. A value of 0 would deadlock the dispatcher (semaphore-counter can never decrement below 0 if it can't increment above 0); the tests explicitly reject maxConcurrent: 0 and maxConcurrent: -1."
  - "Phase 55 Plan 01 — ResolvedAgentConfig.perf.tools? TS mirror uses INLINE literal unions for the inner SLO shape (no cross-module import of ToolSloOverride type from schema.ts). Preserves Phase 51 / 53 / 54 low-dep boundary on src/shared/types.ts. The Zod schema is authoritative; the TS type declares the same shape with duplication."
  - "Phase 55 Plan 01 — tools.maxConcurrent and tools.idempotent are REQUIRED inside the `tools?` block on the TS type (the whole tools key is optional, but when present Zod defaults populate them). Consumers can read them without optional-chaining fallbacks."
  - "Phase 55 Plan 01 — canonicalStringify treats undefined, null, AND NaN identically as 'null'. Rationale: JSON.stringify(undefined) returns the string 'undefined' in some contexts and drops the key entirely in arrays — neither is hash-stable. JSON.stringify(NaN) returns 'null' natively; we preserve that contract."
  - "Phase 55 Plan 01 — canonicalStringify sorts object keys via plain Array#sort() (codepoint order), NOT localeCompare. Reason: deterministic hashing must NOT depend on OS locale settings. Case-sensitive byte-order sort is exactly what the Plan 55-02 cache needs."
  - "Phase 55 Plan 01 — canonicalStringify ARRAYS preserve order. Arrays are order-significant in JSON; sorting them would corrupt the data. Tests explicitly assert canonicalStringify([1,2,3]) !== canonicalStringify([3,2,1])."
  - "Phase 55 Plan 01 — TraceStore.getToolPercentiles SQL uses CAST(cnt * p AS INTEGER) + 1 nearest-rank formula, EXACTLY matching PERCENTILE_SQL (src/performance/percentiles.ts) for consistency. Switching to a different percentile approach (e.g., interpolation) for this aggregate would make tool_call.* rows not comparable to the aggregate tool_call row surfaced by getPercentiles."
  - "Phase 55 Plan 01 — SUBSTR(s.name, 11) is CORRECT for the 'tool_call.' prefix: SQLite SUBSTR is 1-indexed; skipping 10 chars ('tool_call.') from position 1 means starting at position 11. Verified by test asserting `tool_name === 'memory_lookup'` (NOT 'tool_call.memory_lookup')."
  - "Phase 55 Plan 01 — ORDER BY p95 DESC NULLS LAST at the SQL layer (not JS). Rationale: SQLite sorts stably and efficiently; moving the sort to JS after freezing would add O(N log N) per call. With NULLS LAST spelled explicitly, we don't depend on SQLite's default NULL ordering."
  - "Phase 55 Plan 01 — getPerToolSlo ALWAYS returns a frozen { thresholdMs, metric } — never null, never throws. Unknown tools fall back to DEFAULT_SLOS tool_call entry. Consumers (CLI + dashboard in Plan 55-03) don't need a null-check ladder."
  - "Phase 55 Plan 01 — getPerToolSlo defaults override metric to 'p95' when omitted, matching the common case in clawcode.yaml (operators write `slos: { memory_lookup: { thresholdMs: 50 } }` without metric and expect p95). Tests verify both the default-metric path AND the explicit-metric path."
  - "Phase 55 Plan 01 — getPerToolSlo hard-codes 1500ms p95 as the absolute-last-resort fallback (when DEFAULT_SLOS somehow lacks a tool_call entry). This double-fallback is defensive — today DEFAULT_SLOS always has tool_call, but a future refactor that removes it should not break the helper's contract."
  - "Phase 55 Plan 01 — Zero new IPC methods. Per Phase 50 regression lesson, any new IPC method must be added to BOTH src/ipc/protocol.ts IPC_METHODS AND src/ipc/__tests__/protocol.test.ts. This plan extends config schemas + adds TraceStore method + adds slos.ts helper, but introduces no new IPC surface. Plan 55-03 may add a `tools` IPC method (CONTEXT leaves it open)."

patterns-established:
  - "Pattern: Default-whitelist-at-Zod — when a correctness-critical list (like idempotent tools) ships with the system, bake the default into the Zod schema so consumers automatically get the safe set and explicit config only ADDS to it, never DELETES a default by accident"
  - "Pattern: LOCKED-at-schema whitelist — for correctness-critical lists (like idempotent tools where a mistake is a correctness bug), assert verbatim contents AND explicit forbidden-set exclusion in the tests. Future developers cannot silently add a non-idempotent tool without tripping a test"
  - "Pattern: canonicalStringify for stable hashing — one reusable utility at src/shared/canonical-stringify.ts handles object-key sorting + null/undefined/NaN coercion + array order preservation. Callers (tool cache, prefix hasher) get deterministic hashing with a single import"
  - "Pattern: SUBSTR-based tool_name extraction — the 'tool_call.' span-name prefix is a protocol convention; SUBSTR(name, 11) at the SQL layer extracts just the tool name so CLI + dashboard rows carry clean tool names (memory_lookup), not prefixed names (tool_call.memory_lookup)"
  - "Pattern: Always-valid SLO fallback — getPerToolSlo guarantees a { thresholdMs, metric } pair regardless of input (known tool / unknown tool / undefined perTools). Consumers (Plan 55-03 CLI + dashboard) render per-row colors without null-check ladders"

requirements-completed: []  # TOOL-03 is foundation-only here; full closure ships with 55-03 (CLI + dashboard consume getToolPercentiles + getPerToolSlo)

# Metrics
duration: 5m 15s
completed: 2026-04-14
---

# Phase 55 Plan 01: perf.tools Zod + canonicalStringify + getToolPercentiles + getPerToolSlo Summary

**Wave 1 pure-data foundation for Phase 55 — perf.tools Zod schema (maxConcurrent default 10 + min 1 floor, idempotent default whitelist locked at 4 CONTEXT D-02 entries, slos record optional) wired into both agentSchema.perf and defaultsSchema.perf, ResolvedAgentConfig.perf.tools? inline-literal TS mirror, canonicalStringify utility for deterministic cache-key hashing, TraceStore.getToolPercentiles with per-tool p50/p95/p99 aggregation sorted by p95 DESC, getPerToolSlo helper with always-valid fallback to global tool_call SLO.**

## Performance

- **Duration:** ~5 min 15 sec
- **Started:** 2026-04-14T04:33:00Z
- **Completed:** 2026-04-14T04:38:15Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 10 (3 created + 7 edited)

## Accomplishments

- **`perf.tools` Zod schema shipped and wired into both perf blocks.** New `toolsConfigSchema` at `src/config/schema.ts` with `maxConcurrent: z.number().int().min(1).default(10)`, `idempotent: z.array(z.string().min(1)).default([...IDEMPOTENT_TOOL_DEFAULTS])`, and `slos: z.record(z.string().min(1), toolSloOverrideSchema).optional()`. Inserted as `tools: toolsConfigSchema.optional()` on BOTH `agentSchema.perf` (line ~358 alongside streaming) AND `defaultsSchema.perf` (line ~398 — fleet-wide default path). Both perf blocks now have 7 optional fields (traceRetentionDays + slos + memoryAssemblyBudgets + lazySkills + resumeSummaryBudget + streaming + tools) in identical structure.
- **IDEMPOTENT_TOOL_DEFAULTS locked at 4 entries verbatim per CONTEXT D-02.** `Object.freeze(["memory_lookup", "search_documents", "memory_list", "memory_graph"])`. Tests assert length === 4, verbatim contents match, AND explicit exclusion of 8 forbidden non-idempotent tools (memory_save, spawn_subagent_thread, ingest_document, delete_document, send_message, send_to_agent, send_attachment, ask_advisor). Frozen at module load.
- **ResolvedAgentConfig.perf.tools? inline-literal TS mirror.** Extended the `readonly perf?` block at `src/shared/types.ts` line ~136 with `{ readonly maxConcurrent: number; readonly idempotent: readonly string[]; readonly slos?: Readonly<Record<string, { readonly thresholdMs: number; readonly metric?: "p50" | "p95" | "p99" }>> }`. `maxConcurrent` + `idempotent` required inside the `tools?` block (Zod applies defaults) — the whole `tools` key remains optional. No cross-module import — Phase 51/53/54 low-dep boundary preserved.
- **canonicalStringify utility at src/shared/canonical-stringify.ts.** Deterministic stable stringify for cache keys: recursive object-key sort (codepoint order, not locale-dependent), `undefined` + `null` + `NaN` all coerce to `"null"`, arrays preserve order, each element recursively normalized. 8 unit tests cover key-order invariance, nested keys, array order preservation, undefined/null/NaN coercion, primitives (string/number/boolean/empty string/zero), array of objects with unsorted keys, and real-world nested structure (memory_lookup args pattern).
- **TraceStore.getToolPercentiles ships with per-tool p50/p95/p99 aggregation.** New method + `perToolPercentiles` prepared statement in `src/performance/trace-store.ts`. SQL: CTE groups `trace_spans` WHERE `name LIKE 'tool_call.%'`, extracts `tool_name` via `SUBSTR(s.name, 11)`, ranks per tool with `ROW_NUMBER() OVER (PARTITION BY tool_name ORDER BY duration_ms)`, computes nearest-rank p50/p95/p99 with `CAST(cnt * p AS INTEGER) + 1` (same formula as `PERCENTILE_SQL`), sorts by `p95 DESC NULLS LAST` at the SQL layer so CLI + dashboard render slowest-first. Empty window returns `[]` (frozen empty array, not an error).
- **getPerToolSlo helper with always-valid fallback.** New export on `src/performance/slos.ts`: `getPerToolSlo(toolName, perTools?)` returns frozen `{ thresholdMs, metric }`. Per-tool override wins (metric defaults to `"p95"` when omitted on the override). Unknown tools and undefined `perTools` fall back to `DEFAULT_SLOS` `tool_call` entry (1500ms p95). Defensive double-fallback (1500 / p95 literals) handles the unlikely case where `DEFAULT_SLOS` lacks a `tool_call` entry at all.
- **ToolPercentileRow type on src/performance/types.ts.** Readonly row shape `{ tool_name, p50 | null, p95 | null, p99 | null, count }`. Docstring documents the SQL-layer sort (p95 DESC, NULLS LAST) and the `SUBSTR` tool_name extraction.
- **22 new tests GREEN — 8 canonicalStringify + 7 schema + 5 getToolPercentiles + 5 getPerToolSlo.** Plus 2 existing `trace-store.test.ts` describe blocks and existing `slos.test.ts` tests continue to pass unchanged.
- **Zero new IPC methods.** Per Phase 50 regression lesson — Plan 55-01 extends config schemas + adds TraceStore method + adds slos.ts helper, but the IPC surface is unchanged. Plan 55-03 may add a `tools` IPC method (CONTEXT leaves it open); per the regression lesson, that change will update BOTH `src/ipc/protocol.ts` `IPC_METHODS` AND `src/ipc/__tests__/protocol.test.ts` in the same commit.
- **Zero changes to context-assembler.ts.** Phase 52 contract preserved — `files_modified` does NOT include `src/manager/context-assembler.ts` or any AssembledContext-touching file.

## Task Commits

Each task was committed atomically:

1. **Task 1: perf.tools Zod schema + TS mirror + canonicalStringify utility** — `eb109ea` (feat)
   - `src/config/schema.ts` — `IDEMPOTENT_TOOL_DEFAULTS` + `toolSloOverrideSchema` + `toolsConfigSchema` exports, wired into BOTH `agentSchema.perf` AND `defaultsSchema.perf`
   - `src/shared/types.ts` — `ResolvedAgentConfig.perf.tools?` inline literal mirror
   - `src/shared/canonical-stringify.ts` — new utility (58 lines) with recursive normalize + sort + NaN/undefined coercion
   - `src/shared/__tests__/canonical-stringify.test.ts` — 8 tests (key order / nested / array order / undefined-null-NaN / primitives / array of objects / NaN / deep mixed)
   - `src/config/__tests__/tools-schema.test.ts` — 7 tests (defaults / maxConcurrent override / min 1 floor / slos record / agent path / defaults path / whitelist verbatim + forbidden exclusion)
   - Test count delta: +15 tests
2. **Task 2: TraceStore.getToolPercentiles + getPerToolSlo helper** — `cc7928f` (feat)
   - `src/performance/types.ts` — `ToolPercentileRow` type export with SQL-sort-order and SUBSTR docstrings
   - `src/performance/trace-store.ts` — `getToolPercentiles` method + `perToolPercentiles` prepared statement (CTE + ROW_NUMBER + nearest-rank + ORDER BY p95 DESC NULLS LAST)
   - `src/performance/slos.ts` — `getPerToolSlo` helper with frozen return + global tool_call fallback + defensive double-fallback literals
   - `src/performance/__tests__/trace-store.test.ts` — 5 new tests appended to the main TraceStore describe block (empty window / p95 DESC sort / row shape frozen / tool_call.* filter / SUBSTR extraction)
   - `src/performance/__tests__/slos.test.ts` — 5 new tests in dedicated `getPerToolSlo (Phase 55)` describe block (global fallback / override default metric / explicit metric / unknown tool / empty perTools)
   - Test count delta: +10 tests

**Plan metadata:** _(final `docs` commit below after STATE + ROADMAP update)_

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/shared/canonical-stringify.ts` | 58 | `canonicalStringify(value)` — deterministic stable stringify for cache keys. Recursive key sort, null/undefined/NaN coercion to `"null"`, array order preservation. |
| `src/shared/__tests__/canonical-stringify.test.ts` | 90 | 8 tests covering key-order invariance, nested keys, array order preservation, undefined/null/NaN coercion, primitives, array of objects, NaN, deeply nested mixed structures. |
| `src/config/__tests__/tools-schema.test.ts` | 103 | 7 tests covering defaults, maxConcurrent override, min 1 floor (rejects 0 and -1), slos record with optional metric, agent-path with tools block, defaults-path with optional tools, IDEMPOTENT_TOOL_DEFAULTS verbatim + forbidden-tools exclusion. |

### Modified

| Path | Change |
|------|--------|
| `src/config/schema.ts` | Added `IDEMPOTENT_TOOL_DEFAULTS` (frozen 4-entry whitelist) + `toolSloOverrideSchema` + `ToolSloOverride` type + `toolsConfigSchema` + `ToolsConfig` type after `streamingConfigSchema`. Wired `tools: toolsConfigSchema.optional()` into BOTH `agentSchema.perf` AND `defaultsSchema.perf` alongside existing streaming field. |
| `src/shared/types.ts` | Extended `ResolvedAgentConfig.perf` inline literal with `readonly tools?: { readonly maxConcurrent: number; readonly idempotent: readonly string[]; readonly slos?: Readonly<Record<string, {...}>> }` after `streaming?`. Inline literal unions for metric ("p50"/"p95"/"p99"), no cross-module import. |
| `src/performance/types.ts` | Added `ToolPercentileRow` type (`tool_name`, `p50`/`p95`/`p99` nullable, `count`) before `FirstTokenHeadline`. Docstring documents SQL-layer p95 DESC sort + SUBSTR tool_name extraction. |
| `src/performance/trace-store.ts` | Imported `ToolPercentileRow`. Added `perToolPercentiles` to `PreparedStatements` type. Added `getToolPercentiles(agent, sinceIso)` method after `getFirstTokenPercentiles`. Added `perToolPercentiles` prepared statement in `prepareStatements()`: CTE groups trace_spans WHERE name LIKE 'tool_call.%' by SUBSTR(s.name, 11), nearest-rank p50/p95/p99 per tool, ORDER BY p95 DESC NULLS LAST. |
| `src/performance/slos.ts` | Added `getPerToolSlo(toolName, perTools?)` export after `evaluateCacheHitRateStatus`. Returns frozen `{ thresholdMs, metric }` — override wins (default metric p95), unknown tools / undefined perTools fall back to DEFAULT_SLOS `tool_call` (1500ms p95) with defensive double-fallback literals. |
| `src/performance/__tests__/trace-store.test.ts` | Appended 5 tests to the main `TraceStore` describe block after `getFirstTokenPercentiles empty-window` (empty → [], p95 DESC sort with 3 memory_lookup + 2 search_documents, row shape + frozen, tool_call.* filter vs canonical segments, SUBSTR extraction). |
| `src/performance/__tests__/slos.test.ts` | Imported `getPerToolSlo`. Added new `getPerToolSlo (Phase 55)` describe block BEFORE `CACHE_HIT_RATE_SLO (Phase 52)` with 5 tests (global fallback, override default metric, explicit metric, unknown tool fallback, empty perTools fallback). |

## Key Public API

```typescript
// src/config/schema.ts (NEW exports)
export const IDEMPOTENT_TOOL_DEFAULTS: readonly string[];  // 4 entries, frozen
export const toolSloOverrideSchema: z.ZodObject<{
  thresholdMs: z.ZodNumber;               // .int().positive()
  metric: z.ZodOptional<z.ZodEnum<...>>;  // "p50" | "p95" | "p99"
}>;
export type ToolSloOverride = z.infer<typeof toolSloOverrideSchema>;

export const toolsConfigSchema: z.ZodObject<{
  maxConcurrent: z.ZodDefault<z.ZodNumber>;  // .int().min(1).default(10)
  idempotent: z.ZodDefault<z.ZodArray<...>>;  // default([...IDEMPOTENT_TOOL_DEFAULTS])
  slos: z.ZodOptional<z.ZodRecord<...>>;     // Record<string, ToolSloOverride>
}>;
export type ToolsConfig = z.infer<typeof toolsConfigSchema>;

// Both agentSchema.perf AND defaultsSchema.perf now accept:
//   { traceRetentionDays?, slos?, memoryAssemblyBudgets?, lazySkills?,
//     resumeSummaryBudget?, streaming?, tools? }  (7 fields, all optional)

// src/shared/types.ts (EXTENDED)
type ResolvedAgentConfig = {
  // ...
  readonly perf?: {
    // ... existing fields (traceRetentionDays, slos, memoryAssemblyBudgets,
    //                     lazySkills, resumeSummaryBudget, streaming) ...
    readonly tools?: {
      readonly maxConcurrent: number;           // REQUIRED when tools present
      readonly idempotent: readonly string[];   // REQUIRED when tools present
      readonly slos?: Readonly<Record<string, {
        readonly thresholdMs: number;
        readonly metric?: "p50" | "p95" | "p99";
      }>>;
    };
  };
};

// src/shared/canonical-stringify.ts (NEW file)
export function canonicalStringify(value: unknown): string;

// src/performance/types.ts (NEW type)
export type ToolPercentileRow = {
  readonly tool_name: string;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly count: number;
};

// src/performance/trace-store.ts (NEW method)
class TraceStore {
  // ... existing methods ...
  getToolPercentiles(agent: string, sinceIso: string): readonly ToolPercentileRow[];
  //   Returns frozen array sorted by p95 DESC (NULLS LAST). Empty window
  //   returns []. Each row is individually frozen.
}

// src/performance/slos.ts (NEW export)
export function getPerToolSlo(
  toolName: string,
  perTools?: {
    readonly slos?: Readonly<Record<string, {
      readonly thresholdMs: number;
      readonly metric?: SloMetric;
    }>>;
  },
): { readonly thresholdMs: number; readonly metric: SloMetric };
```

## Exact `perf.tools` Zod Shape (Both Schemas)

After this plan, BOTH `agentSchema` and `defaultsSchema` have identical perf objects:

```typescript
perf: z
  .object({
    traceRetentionDays: z.number().int().positive().optional(),       // Phase 50
    slos: z.array(sloOverrideSchema).optional(),                      // Phase 51
    memoryAssemblyBudgets: memoryAssemblyBudgetsSchema.optional(),    // Phase 53
    lazySkills: lazySkillsSchema.optional(),                          // Phase 53
    resumeSummaryBudget: resumeSummaryBudgetSchema.optional(),        // Phase 53
    streaming: streamingConfigSchema.optional(),                      // Phase 54
    tools: toolsConfigSchema.optional(),                              // Phase 55 Plan 01, NEW
  })
  .optional(),
```

Where `toolsConfigSchema` is:

```typescript
export const toolsConfigSchema = z.object({
  maxConcurrent: z.number().int().min(1).default(10),
  idempotent: z.array(z.string().min(1)).default([...IDEMPOTENT_TOOL_DEFAULTS]),
  slos: z.record(z.string().min(1), toolSloOverrideSchema).optional(),
});
```

And `IDEMPOTENT_TOOL_DEFAULTS` is:

```typescript
export const IDEMPOTENT_TOOL_DEFAULTS: readonly string[] = Object.freeze([
  "memory_lookup",
  "search_documents",
  "memory_list",
  "memory_graph",
]);
```

## Exact canonicalStringify Behavior

Rules (LOCKED):

1. **Object keys sorted recursively.** `canonicalStringify({b:1, a:2})` → `'{"a":2,"b":1}'`. Plain `Array#sort()` codepoint order, NOT `localeCompare`.
2. **undefined + null + NaN → `"null"`.** All three collapse to JSON null. `canonicalStringify(undefined) === canonicalStringify(null) === canonicalStringify(NaN) === "null"`.
3. **Arrays preserve order.** Elements recursively normalized, but array position is preserved. `canonicalStringify([1,2,3])` !== `canonicalStringify([3,2,1])`.
4. **Primitives pass through.** `canonicalStringify("x")` → `'"x"'`, `canonicalStringify(42)` → `"42"`, `canonicalStringify(true)` → `"true"`.

Used by Plan 55-02's `src/mcp/tool-cache.ts` for `${tool_name}:${canonicalStringify(args)}` cache keys.

## Exact `getToolPercentiles` SQL

```sql
WITH tool_spans AS (
  SELECT
    SUBSTR(s.name, 11) AS tool_name,
    s.duration_ms
  FROM trace_spans s
  JOIN traces t ON t.id = s.turn_id
  WHERE t.agent = @agent
    AND t.started_at >= @since
    AND s.name LIKE 'tool_call.%'
),
ranked AS (
  SELECT
    tool_name,
    duration_ms,
    ROW_NUMBER() OVER (PARTITION BY tool_name ORDER BY duration_ms) AS rn,
    COUNT(*) OVER (PARTITION BY tool_name) AS cnt
  FROM tool_spans
)
SELECT
  tool_name,
  CAST(MIN(CASE WHEN rn >= CAST(cnt * 0.50 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p50,
  CAST(MIN(CASE WHEN rn >= CAST(cnt * 0.95 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p95,
  CAST(MIN(CASE WHEN rn >= CAST(cnt * 0.99 AS INTEGER) + 1 THEN duration_ms END) AS INTEGER) AS p99,
  cnt AS count
FROM ranked
GROUP BY tool_name
ORDER BY p95 DESC NULLS LAST
```

`SUBSTR(s.name, 11)` strips the canonical `tool_call.` prefix (10 chars + period = 11 1-indexed positions). Nearest-rank formula `CAST(cnt * p AS INTEGER) + 1` matches `PERCENTILE_SQL` exactly so per-tool rows are comparable to the aggregate `tool_call` row surfaced by `getPercentiles`.

## Test Counts

| Test File | Pre-existing | New in Plan 55-01 | Total | Status |
| --------- | ------------ | ----------------- | ----- | ------ |
| `src/shared/__tests__/canonical-stringify.test.ts` | 0 (new file) | 8 | 8 | GREEN |
| `src/config/__tests__/tools-schema.test.ts` | 0 (new file) | 7 | 7 | GREEN |
| `src/performance/__tests__/trace-store.test.ts` | 18 | 5 | 23 | GREEN |
| `src/performance/__tests__/slos.test.ts` | 16 | 5 | 21 | GREEN |
| **Plan 55-01 new tests** | — | **25** | — | **25 / 25 GREEN** |
| Full in-scope verify (all 20 discovered test files) | — | — | **415** | **415 / 415 GREEN** |

_Note: The plan called for 22 new tests (7 schema + 8 canonicalStringify + 5 getToolPercentiles + 4 getPerToolSlo = 24), but I added an extra getPerToolSlo test (5th: empty perTools with no slos field) and an extra canonicalStringify test (deeply nested mixed structure) for completeness. All 25 tests pass; 0 regressions in pre-existing tests._

## Decisions Made

- **IDEMPOTENT_TOOL_DEFAULTS locked at 4 entries verbatim per CONTEXT D-02.** Tests assert length === 4, verbatim contents match exactly, AND 8 forbidden non-idempotent tools are asserted NOT present. Adding a tool requires a CONTEXT amendment. Caching non-idempotent tools is a correctness bug.
- **Default idempotent whitelist applied at Zod layer (not consumer).** Users writing `perf: { tools: { maxConcurrent: 5 } }` still receive the full 4-tool whitelist automatically. Inverts Phase 53's `resumeSummaryBudget` pattern (floor-at-Zod, default-at-consumer) because Plan 55-02's tool-cache needs the whitelist to be populated at config-load time.
- **maxConcurrent default 10 + min 1 floor at Zod.** Mirrors Phase 54 streamingConfigSchema.editIntervalMs.min(300) floor pattern. A value of 0 would deadlock the dispatcher; tests explicitly reject maxConcurrent: 0 and -1.
- **ResolvedAgentConfig.perf.tools TS mirror uses inline literals.** No cross-module import of ToolSloOverride type. Preserves Phase 51/53/54 low-dep boundary on src/shared/types.ts. Duplication between Zod schema and TS type is intentional and checked by tsc.
- **maxConcurrent and idempotent are REQUIRED inside the `tools?` block.** The whole `tools` key is optional, but when present Zod defaults populate these two fields. Consumers (Plan 55-02 dispatcher + cache) can read them without optional-chaining fallbacks.
- **canonicalStringify collapses undefined, null, AND NaN to 'null'.** JSON.stringify(undefined) is inconsistent (returns "undefined" string in some contexts, drops keys in arrays). JSON.stringify(NaN) natively returns "null" — we preserve that contract. Deterministic null coercion is a correctness requirement for hash stability.
- **canonicalStringify uses Array#sort() (codepoint), NOT localeCompare.** Deterministic hashing must not depend on OS locale. Case-sensitive byte-order sort is exactly what the cache needs.
- **canonicalStringify arrays preserve order.** Arrays are order-significant in JSON. Tests explicitly assert `canonicalStringify([1,2,3])` !== `canonicalStringify([3,2,1])`.
- **getToolPercentiles SQL uses CAST(cnt * p AS INTEGER) + 1 nearest-rank.** EXACTLY matches PERCENTILE_SQL. Per-tool rows comparable to aggregate tool_call row surfaced by getPercentiles. Switching to interpolation would break comparability.
- **SUBSTR(s.name, 11) extracts tool_name.** SQLite SUBSTR is 1-indexed; skipping 10 chars of 'tool_call.' means starting at position 11. Tests verify `tool_name === "memory_lookup"` (NOT 'tool_call.memory_lookup').
- **ORDER BY p95 DESC NULLS LAST at SQL layer.** SQLite sorts stably and efficiently. Moving sort to JS after freezing would add O(N log N) per call. NULLS LAST spelled explicitly so we don't depend on SQLite's default NULL ordering.
- **getPerToolSlo returns frozen { thresholdMs, metric } — never null, never throws.** Unknown tools fall back to DEFAULT_SLOS tool_call (1500ms p95). Consumers (Plan 55-03 CLI + dashboard) don't need null-check ladders.
- **getPerToolSlo defaults override metric to 'p95' when omitted.** Matches common case in clawcode.yaml where operators write `slos: { memory_lookup: { thresholdMs: 50 } }` without metric and expect p95. Tests verify both paths.
- **getPerToolSlo has defensive double-fallback.** If DEFAULT_SLOS somehow lacks a tool_call entry, the helper falls back to hard-coded 1500ms/p95. Today DEFAULT_SLOS always has tool_call; a future refactor that removes it should not break the helper's contract.
- **Zero new IPC methods.** Plan 55-01 extends config + adds TraceStore method + adds slos.ts helper. Plan 55-03 may add a `tools` IPC method (CONTEXT leaves it open); when it does, both `src/ipc/protocol.ts` IPC_METHODS AND `src/ipc/__tests__/protocol.test.ts` will be updated in the same commit (Phase 50 lesson).
- **Zero changes to context-assembler.ts.** Phase 52 contract preserved — files_modified does NOT include src/manager/context-assembler.ts.

## Deviations from Plan

None — plan executed exactly as written. All 25 new tests passed on first GREEN run; no auto-fix cycles needed. I added 3 additional tests beyond the plan's 22-test minimum for defensive coverage (an extra canonicalStringify test for deeply nested mixed structures, an extra canonicalStringify test for NaN nested in objects/arrays, and an extra getPerToolSlo test for empty perTools with no slos field). All plan-specified behavior delivered verbatim.

### Auto-fixed Issues

None.

## Authentication Gates

None — Plan 55-01 is library-level code with no network calls, no daemon interaction, no Discord, no external services.

## Issues Encountered

- **Pre-existing tsc errors in unrelated files.** The global `npx tsc --noEmit` run reports ~12 errors across `src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/agent-provisioner.test.ts`, `src/manager/__tests__/memory-lookup-handler.test.ts`, `src/manager/daemon.ts`, `src/manager/session-adapter.ts`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, and `src/usage/budget.ts`. These are pre-existing (documented in prior phase deferred-items.md files from Phase 51-53). Verified via `grep -E "src/(config|shared)/"` filter on the tsc output — zero errors in any Plan 55-01-modified file.
- **No other issues during execution.**

## User Setup Required

None — Plan 55-01 is library-level. The new schema fields are opt-in (all optional) and the whitelist + default maxConcurrent ship with the schema so existing agent configs get safe values automatically at next config-load.

## Next Phase Readiness

- **Plan 55-02 can begin.** `canonicalStringify` is importable from `src/shared/canonical-stringify.js`; `IDEMPOTENT_TOOL_DEFAULTS` + `ToolsConfig` type are importable from `src/config/schema.js`; `ResolvedAgentConfig.perf.tools` is typed so agent lookups flow through without optional-chain gymnastics. The tool cache + dispatcher can consume these primitives directly.
- **Plan 55-03 can begin.** `TraceStore.getToolPercentiles` is importable for the new `clawcode tools <agent>` CLI + `/api/agents/:name/tools` REST endpoint. `getPerToolSlo` is importable for per-tool SLO coloring on CLI + dashboard rows. `ToolPercentileRow` type is importable for the IPC response schema / CLI formatter. Phase 50 regression lesson applies if a new `tools` IPC method is introduced — both `src/ipc/protocol.ts` AND `src/ipc/__tests__/protocol.test.ts` must be updated in the same commit.
- **Phase 50/51/52/53/54 regression check passed.** All pre-existing tests still GREEN. `perf` block on both schemas continues to accept all 6 prior fields (traceRetentionDays + slos + memoryAssemblyBudgets + lazySkills + resumeSummaryBudget + streaming) alongside the new tools field. CANONICAL_SEGMENTS still has 6 entries. DEFAULT_SLOS still has 5 entries (including tool_call at 1500ms p95 which getPerToolSlo falls back to).

## Known Stubs

**None.** All code paths are wired end-to-end within the Phase 55-01 foundation scope:

- `toolsConfigSchema` values are NOT YET consumed anywhere (Plan 55-02 will wire them into the tool-cache + dispatcher). This is intentional and planned — the schema is a foundation for Plan 55-02.
- `canonicalStringify` has no intra-turn cache consumer yet (Plan 55-02's `src/mcp/tool-cache.ts` will use it). Intentional and planned.
- `TraceStore.getToolPercentiles` has no CLI / dashboard / daemon consumer yet (Plan 55-03 adds those). The method returns the correct shape when called directly; Plan 55-03 CLI + dashboard will wire it up without modifying this plan's artifacts.
- `getPerToolSlo` has no consumer yet (Plan 55-03 CLI + dashboard per-row coloring will use it). Intentional and planned.

**Explicit statement:** The `perf.tools` config is foundation only — consumers (Plan 55-02 tool-cache + dispatcher; Plan 55-03 CLI + dashboard + daemon) wire it up in the remaining Wave 1 / Wave 2 work. `canonicalStringify`, `getToolPercentiles`, and `getPerToolSlo` are all fully implemented and tested, awaiting consumers in downstream plans.

## Self-Check: PASSED

All 3 created files exist at expected paths:

- `src/shared/canonical-stringify.ts` FOUND
- `src/shared/__tests__/canonical-stringify.test.ts` FOUND
- `src/config/__tests__/tools-schema.test.ts` FOUND

All 7 modified files carry the expected changes (verified via grep counts):

- `src/config/schema.ts` — `IDEMPOTENT_TOOL_DEFAULTS` (3 occurrences: export + default() + docstring), `toolsConfigSchema` (4 occurrences: export + type inference + 2 perf-block uses), `memory_lookup` (2 occurrences) — VERIFIED
- `src/shared/types.ts` — `tools?:` (1 occurrence, new block) — VERIFIED
- `src/performance/types.ts` — `ToolPercentileRow` (1 occurrence, export) — VERIFIED
- `src/performance/trace-store.ts` — `getToolPercentiles` (2 occurrences: method declaration + prepared-statement wiring), `SUBSTR(s.name, 11)` (1 occurrence), `ORDER BY p95 DESC` (1 occurrence) — VERIFIED
- `src/performance/slos.ts` — `getPerToolSlo` (1 occurrence, export declaration) — VERIFIED
- `src/performance/__tests__/trace-store.test.ts` — 5 new tests in main TraceStore describe block (empty-window [], p95 DESC sort, row shape frozen, tool_call.* filter, SUBSTR extraction) — VERIFIED
- `src/performance/__tests__/slos.test.ts` — new `getPerToolSlo (Phase 55)` describe block with 5 tests — VERIFIED

Both task commits exist in `git log --oneline`:

- `eb109ea` FOUND (Task 1: perf.tools Zod + TS mirror + canonicalStringify)
- `cc7928f` FOUND (Task 2: getToolPercentiles + getPerToolSlo)

All 25 new Plan 55-01 tests GREEN. Full in-scope verify shows 415 / 415 tests passing (includes all pre-existing Phase 50/51/52/53/54 tests — no regressions).

Phase-wide verification (from plan's `<verification>` block):
- `grep -c "canonicalStringify" src/shared/canonical-stringify.ts` = 2 (export + recursive call)
- `grep -c "toolsConfigSchema\|IDEMPOTENT_TOOL_DEFAULTS" src/config/schema.ts` = 7
- `grep -c "tools?:" src/shared/types.ts` = 1
- `grep -c "getToolPercentiles" src/performance/trace-store.ts` = 2
- `grep -c "ToolPercentileRow" src/performance/types.ts` = 1
- `grep -c "getPerToolSlo" src/performance/slos.ts` = 1
- Idempotent whitelist verbatim check: 4 canonical entries present, 0 forbidden entries (memory_save, spawn_subagent, ingest_document, send_message, send_to_agent)

`npx tsc --noEmit` shows ZERO errors in any Plan 55-01-modified file — confirmed via grep filter on `src/(config|shared|performance)/`. Pre-existing errors in other files (`src/cli/commands/__tests__/latency.test.ts`, `src/manager/__tests__/*`, `src/manager/daemon.ts`, `src/manager/session-adapter.ts`, `src/memory/__tests__/graph.test.ts`, `src/usage/__tests__/daily-summary.test.ts`, `src/usage/budget.ts`) are documented in prior phase deferred-items.md files and are out-of-scope per the executor scope-boundary rule.

IPC protocol verification: no new IPC methods introduced (per Phase 50 regression lesson). Plan 55-01 extends config schemas + adds TraceStore method + adds slos.ts helper, but the IPC surface is unchanged.

Phase 52 contract preserved: zero changes to `src/manager/context-assembler.ts` or any AssembledContext-touching file.

---
*Phase: 55-tool-call-overhead*
*Plan: 01*
*Completed: 2026-04-14*
