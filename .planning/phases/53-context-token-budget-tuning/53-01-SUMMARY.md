---
phase: 53-context-token-budget-tuning
plan: 01
subsystem: performance
tags: [context-audit, token-budget, zod-config, cli, filesystem-direct, tokenizer]

# Dependency graph
requires:
  - phase: 51-01
    provides: perf.slos? override pattern (sloOverrideSchema) — template for the three new perf fields
  - phase: 52-01
    provides: trace_spans metadata_json surface + in-JS nearest-rank percentile convention from getCacheTelemetry
  - phase: 52-02
    provides: context_assemble span wiring — Wave 2 will extend its metadata_json with section_tokens
provides:
  - countTokens(text) — canonical BPE token counter (src/performance/token-count.ts) wrapping @anthropic-ai/tokenizer@0.0.4
  - memoryAssemblyBudgetsSchema — per-section token budget Zod (7 canonical sections)
  - lazySkillsSchema — { enabled, usageThresholdTurns (min 5), reinflateOnMention } Zod
  - resumeSummaryBudgetSchema — integer min(500) Zod
  - perf.memoryAssemblyBudgets? / perf.lazySkills? / perf.resumeSummaryBudget? on BOTH agentSchema AND defaultsSchema
  - ResolvedAgentConfig.perf mirror with inline literal types (no cross-module import)
  - SECTION_NAMES — frozen canonical names (identity, soul, skills_header, hot_tier, recent_history, per_turn_summary, resume_summary)
  - buildContextAuditReport(opts) — filesystem-direct aggregator over trace_spans.metadata_json
  - ContextAuditReport / SectionRow types
  - clawcode context-audit <agent> CLI — --since / --turns / --min-turns / --trace-store / --json / --out
  - formatAuditTable(report) — aligned table with WARN + recommendations blocks
affects: [53-02, 53-03]

# Tech tracking
tech-stack:
  added:
    - "@anthropic-ai/tokenizer@^0.0.4 (wraps tiktoken for Claude BPE)"
  patterns:
    - "Filesystem-direct CLI aggregator — readonly SQLite handle, no IPC method, no daemon dependency"
    - "In-JS nearest-rank percentile over JSON-parsed metadata_json (mirrors Phase 52 getCacheTelemetry)"
    - "Canonical section names declared in exactly one place (SECTION_NAMES frozen array) and re-used by the config schema"
    - "Three-schema Zod extension pattern — declare schemas near existing peers (contextBudgetsSchema), wire into BOTH agentSchema.perf AND defaultsSchema.perf with the same shape"
    - "Inline literal unions on ResolvedAgentConfig.perf (no import from performance/types or config/schema) — preserves low-dep boundary from Phase 51 Plan 01"
    - "Test harness wraps seedTraces in a SQLite transaction with journal_mode=MEMORY + synchronous=OFF to keep 100-row seeds under the default 5s test timeout"
    - "idPrefix namespacing in seedTraces lets multi-call tests (malformed + valid) keep traces.id PK unique without colliding"

key-files:
  created:
    - src/performance/token-count.ts
    - src/performance/__tests__/token-count.test.ts
    - src/performance/context-audit.ts
    - src/performance/__tests__/context-audit.test.ts
    - src/cli/commands/context-audit.ts
    - src/cli/commands/__tests__/context-audit.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/config/schema.ts
    - src/config/__tests__/schema.test.ts
    - src/shared/types.ts
    - src/cli/index.ts

key-decisions:
  - "Phase 53 Plan 01 — @anthropic-ai/tokenizer@0.0.4 is the canonical token counter (exports `countTokens(text: string): number` backed by tiktoken + Claude BPE ranks bundled in claude.json); no fallback to the SDK's internal tokenizer needed"
  - "Phase 53 Plan 01 — countTokens short-circuits on empty string (returns 0) before invoking the library, guaranteeing deterministic zero without a tokenizer round-trip"
  - "Phase 53 Plan 01 — SECTION_NAMES lives at src/performance/context-audit.ts (not src/config/schema.ts) because the aggregator is the primary consumer and the schema merely mirrors the names inline in memoryAssemblyBudgetsSchema keys"
  - "Phase 53 Plan 01 — filesystem-direct aggregator (D-05 from 53-CONTEXT.md) — better-sqlite3 opened { readonly: true } against ~/.clawcode/agents/<agent>/traces.db, no IPC method registered; grep-verified 0 matches of 'context-audit' in src/ipc/protocol.ts"
  - "Phase 53 Plan 01 — percentile math uses in-JS nearest-rank (sort + floor(N*p) index) mirroring TraceStore.getCacheTelemetry convention; N-small at agent scale makes JS pass cheaper than SQL ROW_NUMBER window expressions"
  - "Phase 53 Plan 01 — recommendations.new_defaults = ceil(p95 * 1.2) per section with non-null p95; sections with null p95 are omitted (no over-eager default suggestion on cold sections)"
  - "Phase 53 Plan 01 — resume_summary_over_budget_count compared against a 1500-token default (CONTEXT D-04); operator can override via the --resume-summary-budget opt (exposed internally; not wired to a CLI flag in this plan)"
  - "Phase 53 Plan 01 — malformed metadata_json rows are skipped silently (preserves Phase 50's observational invariant: audits never throw); legacy rows without section_tokens key also skipped"
  - "Phase 53 Plan 01 — resumeSummaryBudgetSchema floor of 500 (D-04) enforces min(500) at Zod parse; negative / fractional / <500 rejected. Default 1500 applied at the consumer (Wave 3 context-summary.ts), NOT at Zod — keeps the schema shape minimal"
  - "Phase 53 Plan 01 — lazySkillsSchema.usageThresholdTurns.min(5) (D-03) — anything smaller defeats the re-inflate cache-warming strategy. Defaults: { enabled: true, usageThresholdTurns: 20, reinflateOnMention: true } applied at Zod via z.default()"
  - "Phase 53 Plan 01 — ResolvedAgentConfig.perf mirror uses inline literal types for the three new fields (no import from performance/context-audit.ts or config/schema.ts) — maintains Phase 51 Plan 01 low-dep boundary invariant on src/shared/types.ts"
  - "Phase 53 Plan 01 — getGitSha() wraps execSync('git rev-parse HEAD') in try/catch with 'unknown' fallback + stdio: ['ignore', 'pipe', 'ignore'] to suppress stderr noise in non-git environments"
  - "Phase 53 Plan 01 — test harness journal_mode=MEMORY + synchronous=OFF + wrapping seeds in db.transaction() to keep 100-row seeds well under the 5s vitest default timeout (initial seedTraces was ~5s per 100 rows with default journal_mode)"
  - "Phase 53 Plan 01 — idPrefix parameter on seedTraces lets 'silently skips malformed' test seed bad + good rows without colliding on traces.id PK (default 'turn-' prefix unchanged for single-call tests)"

patterns-established:
  - "Pattern: Single-source-of-truth frozen canonical enum for aggregator + consumer — SECTION_NAMES lives in the aggregator module, schema mirrors the names inline via object keys"
  - "Pattern: Filesystem-direct CLI aggregator — readonly SQLite handle, no IPC, no daemon dependency; makes the audit deterministic and reproducible across dev/CI environments"
  - "Pattern: Lightweight Zod schema for library-constant-plus-optional-override — resumeSummaryBudgetSchema is a bare z.number().int().min(N), defaults applied at the consumer so schema stays minimal"
  - "Pattern: Skip-and-continue aggregation for observational data paths — malformed / legacy metadata rows are silently skipped (sampledTurns counts only valid rows) to preserve the 'audits never throw' invariant"
  - "Pattern: Test-harness SQLite turbo-mode — journal_mode=MEMORY + synchronous=OFF + transaction-wrapped seeds to keep high-row-count tests fast"

requirements-completed: [CTX-01]

# Metrics
duration: 9m 38s
completed: 2026-04-14
---

# Phase 53 Plan 01: Token Counter + Context-Audit Foundations Summary

**Foundation plan for Phase 53: installs `@anthropic-ai/tokenizer@0.0.4`, ships the `countTokens(text)` helper, extends the `perf` Zod surface with three new optional fields (`memoryAssemblyBudgets`, `lazySkills`, `resumeSummaryBudget`) on BOTH agentSchema AND defaultsSchema, mirrors those on `ResolvedAgentConfig.perf` via inline literal unions, and delivers the `clawcode context-audit <agent>` CLI that reads `traces.db` filesystem-direct and aggregates per-section p50/p95 token counts from `metadata_json.section_tokens` (populated by Wave 2). Addresses CTX-01.**

## Performance

- **Duration:** ~9 min 38 sec
- **Started:** 2026-04-14T00:40:28Z
- **Completed:** 2026-04-14T00:50:06Z
- **Tasks:** 2 (both `auto` + `tdd`, no checkpoints)
- **Files modified:** 12 (6 created + 6 edited)

## Accomplishments

- **`@anthropic-ai/tokenizer@0.0.4` installed** and exported from `src/performance/token-count.ts` as `countTokens(text: string): number`. Zero short-circuits before invoking the library; non-empty strings delegate to the bundled Claude BPE encoder (tiktoken-backed). Deterministic + monotonic on concatenation — asserted by 4 GREEN tests.
- **Three new Zod schemas shipped.** `memoryAssemblyBudgetsSchema` covers all 7 canonical section names (identity/soul/skills_header/hot_tier/recent_history/per_turn_summary/resume_summary) with optional positive integers per section. `lazySkillsSchema` enforces `usageThresholdTurns >= 5` with Zod defaults `{ enabled: true, usageThresholdTurns: 20, reinflateOnMention: true }`. `resumeSummaryBudgetSchema` is a bare `z.number().int().min(500)` — default 1500 applied at the consumer (Wave 3), not at the schema.
- **`perf` extended on BOTH `agentSchema` AND `defaultsSchema`.** The three new optional fields sit alongside Phase 50's `traceRetentionDays` and Phase 51's `slos` with no field collision. Regression test (`perf combined fields`) verifies all five fields parse simultaneously. `traceRetentionDays` + `slos` grep-verified present on both schemas (2 matches each).
- **`ResolvedAgentConfig.perf` mirror shipped with inline literal unions.** Preserves the Phase 51 Plan 01 low-dep boundary — `src/shared/types.ts` does NOT import from `performance/context-audit.ts` or `config/schema.ts`. Section keys mirror `memoryAssemblyBudgetsSchema` verbatim.
- **`SECTION_NAMES` frozen array is single source of truth.** Lives in `src/performance/context-audit.ts` alongside the aggregator that primarily consumes it. All 7 canonical names appear in 20 grep matches across the module (declarations + bucket initialization + filter loop).
- **`buildContextAuditReport` aggregator is filesystem-direct and deterministic.** Reads `trace_spans.metadata_json` joined through `traces` with `readonly: true` SQLite handle. 13 aggregator tests assert: (a) 25-turn happy path with deterministic section_tokens, (b) `minTurns` warning emits without blocking report, (c) empty-db returns null/null/0 for every section, (d) legacy rows without `section_tokens` are skipped, (e) malformed JSON is skipped silently, (f) `recommendations.new_defaults = ceil(p95 * 1.2)` per non-null p95, (g) resume-summary over-budget counter honors 1500 default, (h) nearest-rank percentile math matches `[1..100]` uniform distribution tolerance, (i) readonly handle doesn't prevent subsequent r/w open, (j) `git_sha` + `generated_at` captured, (k) all 7 section names backfill even when absent from rows, (l) `--turns` bounds sample to most recent N, (m) returned report is Object.frozen end-to-end.
- **`clawcode context-audit <agent>` CLI registered and tested.** `formatAuditTable` renders aligned table with header + 7 section rows + summary line (sampled turns + over-budget count) + optional WARN + optional `Recommended new_defaults` block. Empty-data path prints `No context-assemble data for <agent> (since <since>).`. Registration test confirms all 6 options (`--since`, `--turns`, `--min-turns`, `--trace-store`, `--json`, `--out`) are wired.
- **Filesystem-direct decision preserved — no IPC method added.** `grep -c '"context-audit"' src/ipc/protocol.ts` returns `0`. Executor's Phase 50 regression lesson (add to BOTH IPC_METHODS AND protocol.test.ts expected list) is vacuously satisfied by not adding anything.
- **Wider suite (src/performance + src/config + src/cli/commands/__tests__) 1457 / 1457 GREEN.** No Phase 50/51/52 regressions.

## Task Commits

Each task was committed atomically:

1. **Task 1: countTokens helper + perf config surface + ResolvedAgentConfig mirror** — `fe3d686` (feat)
   - `package.json` / `package-lock.json` — `@anthropic-ai/tokenizer@^0.0.4` added
   - `src/performance/token-count.ts` — new `countTokens(text)` helper
   - `src/performance/__tests__/token-count.test.ts` — 4 new tests (empty/0, small positive, monotonic, deterministic)
   - `src/config/schema.ts` — 3 new schemas + wire into BOTH perf objects
   - `src/config/__tests__/schema.test.ts` — 7 new tests in 4 new describe blocks (`memoryAssemblyBudgets override`, `lazySkills override`, `resumeSummaryBudget override`, `perf combined fields`)
   - `src/shared/types.ts` — 3 new optional fields on `ResolvedAgentConfig.perf` with inline literal unions
   - Test count delta: +11 tests (351 total in `src/performance/__tests__/token-count.test.ts` + `src/config/__tests__/schema.test.ts` scope)

2. **Task 2: Context-audit aggregator + CLI (filesystem-direct)** — `d5a546f` (feat)
   - `src/performance/context-audit.ts` — new aggregator with SECTION_NAMES, ContextAuditReport, SectionRow, buildContextAuditReport
   - `src/performance/__tests__/context-audit.test.ts` — 13 new tests covering aggregator behaviors (25-turn happy path, warnings, empty db, legacy/malformed skip, recommendations, over-budget counter, percentile tolerance, readonly handle, git_sha, backfill, --turns, frozen-ness)
   - `src/cli/commands/context-audit.ts` — `formatAuditTable` + `registerContextAuditCommand`
   - `src/cli/commands/__tests__/context-audit.test.ts` — 4 new tests (header + 7 sections, empty fallback, warnings+recommendations block, option registration)
   - `src/cli/index.ts` — import + register alongside other commands
   - Test count delta: +17 tests (1457 total in wider suite verification)

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/performance/token-count.ts` | 30 | `countTokens(text)` wrapper over `@anthropic-ai/tokenizer` |
| `src/performance/__tests__/token-count.test.ts` | 42 | 4 tests: zero-on-empty, small-positive, monotonic, deterministic |
| `src/performance/context-audit.ts` | 215 | `SECTION_NAMES` (frozen), `SectionRow` / `ContextAuditReport` types, `buildContextAuditReport` with in-JS nearest-rank percentiles, `recommendations.new_defaults`, `resume_summary_over_budget_count`, `git_sha` + `generated_at` + `warnings[]` |
| `src/performance/__tests__/context-audit.test.ts` | 345 | 13 tests via tempdir-db `seedTraces` harness (WAL-disabled + txn-wrapped for speed) |
| `src/cli/commands/context-audit.ts` | 161 | `formatAuditTable` + `registerContextAuditCommand` with 6 options |
| `src/cli/commands/__tests__/context-audit.test.ts` | 129 | 4 tests: table formatting, empty fallback, warnings+recommendations, option registration |

### Modified

| Path | Change |
|------|--------|
| `package.json` | Added `"@anthropic-ai/tokenizer": "^0.0.4"` to dependencies |
| `package-lock.json` | Auto-updated by `npm install` |
| `src/config/schema.ts` | Added 3 new exports (`memoryAssemblyBudgetsSchema`, `lazySkillsSchema`, `resumeSummaryBudgetSchema`) + 2 new inferred types (`MemoryAssemblyBudgetsConfig`, `LazySkillsConfig`); wired into BOTH `agentSchema.perf` AND `defaultsSchema.perf` alongside preserved `traceRetentionDays` + `slos` |
| `src/config/__tests__/schema.test.ts` | Appended 4 new `describe` blocks with 7 tests total (`memoryAssemblyBudgets override`, `lazySkills override`, `resumeSummaryBudget override`, `perf combined fields`) |
| `src/shared/types.ts` | Extended `ResolvedAgentConfig.perf` with 3 new optional fields using inline literal unions (`memoryAssemblyBudgets?`, `lazySkills?`, `resumeSummaryBudget?`) |
| `src/cli/index.ts` | Import + `registerContextAuditCommand(program)` registration next to `registerBenchCommand` |

## Key Public API

```typescript
// src/performance/token-count.ts
export function countTokens(text: string): number;
// 0 on empty; positive integer BPE token count otherwise; deterministic.

// src/performance/context-audit.ts
export const SECTION_NAMES: Readonly<[
  "identity", "soul", "skills_header", "hot_tier",
  "recent_history", "per_turn_summary", "resume_summary"
]>;
export type SectionName = (typeof SECTION_NAMES)[number];
export type SectionRow = {
  readonly sectionName: SectionName;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly count: number;
};
export type ContextAuditReport = {
  readonly agent: string;
  readonly since: string;
  readonly sinceIso: string;
  readonly sampledTurns: number;
  readonly sections: readonly SectionRow[];
  readonly recommendations: {
    readonly new_defaults: Readonly<Partial<Record<SectionName, number>>>;
  };
  readonly resume_summary_over_budget_count: number;
  readonly git_sha: string;
  readonly generated_at: string;
  readonly warnings: readonly string[];
};
export function buildContextAuditReport(
  opts: {
    readonly traceStorePath: string;
    readonly agent: string;
    readonly since?: string;            // default "24h"
    readonly turns?: number;             // bound N most recent
    readonly minTurns?: number;          // default 20 (warn below)
    readonly resumeSummaryBudget?: number; // default 1500
  },
): ContextAuditReport; // frozen, deep

// src/cli/commands/context-audit.ts
export function formatAuditTable(report: ContextAuditReport): string;
export function registerContextAuditCommand(program: Command): void;

// src/config/schema.ts (NEW exports)
export const memoryAssemblyBudgetsSchema: ZodObject;
export type MemoryAssemblyBudgetsConfig;
export const lazySkillsSchema: ZodObject;
export type LazySkillsConfig;
export const resumeSummaryBudgetSchema: ZodNumber; // .int().min(500)
```

## Exact `perf` Zod Shape (Both Schemas)

After this plan, BOTH `agentSchema.perf` and `defaultsSchema.perf` accept:

```typescript
perf: z
  .object({
    traceRetentionDays: z.number().int().positive().optional(),      // Phase 50
    slos: z.array(sloOverrideSchema).optional(),                      // Phase 51
    memoryAssemblyBudgets: memoryAssemblyBudgetsSchema.optional(),    // Phase 53 (NEW)
    lazySkills: lazySkillsSchema.optional(),                          // Phase 53 (NEW)
    resumeSummaryBudget: resumeSummaryBudgetSchema.optional(),        // Phase 53 (NEW)
  })
  .optional(),
```

Where:

```typescript
const memoryAssemblyBudgetsSchema = z.object({
  identity: z.number().int().positive().optional(),
  soul: z.number().int().positive().optional(),
  skills_header: z.number().int().positive().optional(),
  hot_tier: z.number().int().positive().optional(),
  recent_history: z.number().int().positive().optional(),
  per_turn_summary: z.number().int().positive().optional(),
  resume_summary: z.number().int().positive().optional(),
});

const lazySkillsSchema = z.object({
  enabled: z.boolean().default(true),
  usageThresholdTurns: z.number().int().min(5).default(20),
  reinflateOnMention: z.boolean().default(true),
});

const resumeSummaryBudgetSchema = z.number().int().min(500);
```

## Exact `ResolvedAgentConfig.perf` TS Shape

```typescript
readonly perf?: {
  readonly traceRetentionDays?: number;
  readonly slos?: readonly {
    readonly segment:
      | "end_to_end" | "first_token" | "context_assemble" | "tool_call";
    readonly metric: "p50" | "p95" | "p99";
    readonly thresholdMs: number;
  }[];
  readonly memoryAssemblyBudgets?: {
    readonly identity?: number;
    readonly soul?: number;
    readonly skills_header?: number;
    readonly hot_tier?: number;
    readonly recent_history?: number;
    readonly per_turn_summary?: number;
    readonly resume_summary?: number;
  };
  readonly lazySkills?: {
    readonly enabled: boolean;
    readonly usageThresholdTurns: number;
    readonly reinflateOnMention: boolean;
  };
  readonly resumeSummaryBudget?: number;
};
```

All section keys use inline literal unions — no cross-module import. Mirrors the Phase 51 Plan 01 approach for `slos?`.

## Test Counts

| Test File | Count | Status |
|-----------|-------|--------|
| `src/performance/__tests__/token-count.test.ts` | 4 | GREEN (new) |
| `src/config/__tests__/schema.test.ts` | 25 prior + 7 new = 32 | GREEN (7 new in 4 new describe blocks) |
| `src/performance/__tests__/context-audit.test.ts` | 13 | GREEN (new) |
| `src/cli/commands/__tests__/context-audit.test.ts` | 4 | GREEN (new) |
| **Plan 53-01 new tests** | **28** | **28 / 28 GREEN** |
| `src/performance + src/config + src/cli/commands/__tests__` (full verify) | 1457 | 1457 / 1457 GREEN |

Note: the 28-test count slightly exceeds the plan's advertised 26 because the aggregator picked up two pragmatic extras not in the original task behavior list: (1) `--turns` bounds sample (test 12), (2) frozen-ness verification (test 13). Both are safety assertions that fell out naturally from the implementation and add negligible execution cost.

## Decisions Made

- **`@anthropic-ai/tokenizer@0.0.4` is canonical.** Tiktoken-backed Claude BPE. Exported `countTokens(text)` matches the exact name/shape the plan expected. No wrapping beyond the empty-string short-circuit needed.
- **Empty-string short-circuit.** `countTokens("")` returns 0 without invoking the library — deterministic contract, saves the tokenizer construct/encode/free cost for an obvious no-op.
- **`SECTION_NAMES` lives in the aggregator module.** The aggregator is the primary consumer; the config schema mirrors the names inline via `z.object` keys. Keeping the canonical list in one place (not split across aggregator + schema) makes drift harder.
- **Filesystem-direct reads, no IPC.** The audit is a developer/CI tool, not an operator dashboard. `readonly: true` SQLite handle against `~/.clawcode/agents/<agent>/traces.db` makes the audit deterministic even when the daemon is offline. `grep -c '"context-audit"' src/ipc/protocol.ts` returns 0.
- **In-JS nearest-rank percentile.** Mirrors `TraceStore.getCacheTelemetry` (Phase 52 Plan 01). JSON-parsed section arrays are small (tens of thousands of rows max over any realistic window), so the JS sort is cheaper and clearer than a SQL ROW_NUMBER over a JSON-extracted column expression.
- **`recommendations.new_defaults = ceil(p95 * 1.2)` per section.** Only sections with non-null p95 produce a recommendation — no over-eager default suggestion for cold sections. The operator reviews, edits `clawcode.yaml`, and Wave 2's assembler reads the new budgets.
- **`resume_summary_over_budget_count` uses a 1500-token default.** Matches CONTEXT D-04. Internal `resumeSummaryBudget` opt exists on `buildContextAuditReportOpts` (not exposed as a CLI flag in this plan) — Wave 3 can wire it if needed.
- **Malformed + legacy rows skipped silently.** Preserves the Phase 50 observational invariant ("audits never throw"). `sampledTurns` counts only rows with a valid `section_tokens` object — counter-intuitive but correct: the audit is about what Wave 2 will actually emit, not what the span might have carried historically.
- **`resumeSummaryBudgetSchema` floor 500 (D-04) enforced at Zod.** Rejects negative, fractional, or sub-500 values with a parse error. Default 1500 applied at the consumer (Wave 3 context-summary.ts), not at the schema — keeps the Zod shape minimal and lets the default live next to the consumer logic where it's relevant.
- **`lazySkillsSchema.usageThresholdTurns.min(5)` (D-03).** Anything smaller defeats the re-inflate cache-warming strategy. Defaults `{ enabled: true, usageThresholdTurns: 20, reinflateOnMention: true }` applied at Zod via `z.default()`.
- **Inline literal unions on `ResolvedAgentConfig.perf`.** `src/shared/types.ts` is a low-dep module (Phase 51 Plan 01 invariant). Pulling in `performance/context-audit.ts` or `config/schema.ts` would create undesirable coupling. The schema is authoritative; the TS type declares the same shape; duplication is checked by `tsc --noEmit`.
- **`getGitSha()` silent-fallback.** Wraps `execSync('git rev-parse HEAD')` in try/catch with `'unknown'` fallback. `stdio: ['ignore', 'pipe', 'ignore']` suppresses stderr noise in non-git environments (CI containers, sandboxes).
- **Test-harness SQLite turbo mode.** The initial `seedTraces` implementation was ~5s per 100 rows with default `journal_mode=WAL` + `synchronous=NORMAL`. Switching to `journal_mode=MEMORY` + `synchronous=OFF` + wrapping seeds in `db.transaction()` cut the 100-turn percentile test from 5s+ to well under 1s. These are tempdir-only DBs — durability doesn't matter.
- **`idPrefix` on `seedTraces`.** The "silently skips malformed" test needs to seed both malformed AND valid rows. Two `seedTraces` calls with default `turn-` prefix collided on `traces.id` PK. `idPrefix: 'bad-'` + `idPrefix: 'good-'` keeps PKs unique.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] UNIQUE constraint collision in multi-seed test**
- **Found during:** Task 2 RED/GREEN cycle, first vitest run after aggregator + tests landed
- **Issue:** Test `silently skips rows with malformed metadata_json` called `seedTraces(dbPath, { turns: 5, metadataJsonOverride: ... })` twice on the same DB. Both calls defaulted to `idPrefix = 'turn-'`, producing duplicate `traces.id` PKs (`turn-0..turn-4` collided between the two calls). SqliteError: `UNIQUE constraint failed: traces.id`.
- **Fix:** Added optional `idPrefix?: string` field to `SeedOpts` with default `"turn-"`. Updated the multi-seed test to pass distinct prefixes (`"bad-"` + `"good-"`). Other tests unchanged (still default to `"turn-"`).
- **Files modified:** `src/performance/__tests__/context-audit.test.ts` (test helper + 1 test body)
- **Verification:** All 13 aggregator tests GREEN.
- **Committed in:** `d5a546f` (rolled into Task 2 commit alongside initial implementation)

**2. [Rule 3 - Blocking] Test timeouts on 20+ row seeds**
- **Found during:** Task 2 GREEN phase, first vitest run
- **Issue:** Four tests (`recommendations new_defaults`, `percentile math (100 rows)`, `over-budget counter`, `--turns bounds sample (30 rows)`) timed out at the 5s default vitest threshold. Root cause: `seedTraces` opened a new SQLite DB per call with default `journal_mode=WAL` + `synchronous=NORMAL` + no explicit transaction wrapping, so 100 individual INSERT statements each flushed to disk.
- **Fix:** Added `db.pragma("journal_mode = MEMORY")` + `db.pragma("synchronous = OFF")` at the top of `seedTraces` (tempdir-only DBs, durability doesn't matter) and wrapped the insert loop in `db.transaction()`. Reduced 100-row seed time from ~5s to <100ms.
- **Files modified:** `src/performance/__tests__/context-audit.test.ts` (seedTraces helper)
- **Verification:** All 13 aggregator tests GREEN, total suite time 7.44s for 13 tests (was timing out at 5s × 4 tests = 20s minimum before fix).
- **Committed in:** `d5a546f` (rolled into Task 2 commit)

---

**Total deviations:** 2 auto-fixed, both test-harness blockers (Rule 3) discovered during GREEN verification. Neither changed production code — only the test helper. No scope creep.

## Authentication Gates

None — Plan 53-01 is library/CLI-level code with no network calls, no daemon interaction, no Discord, no external services. The `@anthropic-ai/tokenizer` package is pure JS/native code (bundled tiktoken BPE ranks in `claude.json`) — no API key, no OAuth.

## Issues Encountered

- **Pre-existing `tsc --noEmit` errors in unrelated files.** `npx tsc --noEmit` still shows Phase 50/51/52 inherited errors in session-adapter, memory tests, etc. (documented at `.planning/phases/51-slos-regression-gate/deferred-items.md` and `.planning/phases/52-prompt-caching/deferred-items.md`). Grep-verified ZERO new errors in any Plan 53-01-modified file. Out-of-scope per the executor scope-boundary rule.
- **`yaml@2.x` parser warning on broken-YAML test fixture** (Phase 51 carry-over) — continues to print "Warning: Keys with collection values will be stringified..." during unrelated tests. Harmless and not introduced by this plan.
- **No other issues during execution.**

## Deferred Issues

None introduced by this plan. The 10 pre-existing tsc errors from `.planning/phases/51-slos-regression-gate/deferred-items.md` still apply and remain out-of-scope.

## User Setup Required

None for the library pieces. For operators wanting to run the new CLI:

```bash
# After `npm install` picks up the new @anthropic-ai/tokenizer dep:
npx tsx src/cli/index.ts context-audit clawdy --since 24h --min-turns 20

# With an explicit traces.db path (CI / tempdir scenarios):
npx tsx src/cli/index.ts context-audit clawdy --trace-store /tmp/traces.db --json

# Sample the most recent 50 turns and skip the warning threshold:
npx tsx src/cli/index.ts context-audit clawdy --turns 50 --min-turns 10
```

Note: the CLI returns `No context-assemble data for <agent>` until Wave 2 (Plan 53-02) wires `section_tokens` into the `context_assemble` span's `metadata_json`. This plan delivers the MACHINERY; data flow begins in Wave 2.

## Next Phase Readiness

- **Plan 53-02 can begin.** `countTokens` helper importable from `src/performance/token-count.js`. `SECTION_NAMES` importable from `src/performance/context-audit.js`. `memoryAssemblyBudgets` readable from `ResolvedAgentConfig.perf.memoryAssemblyBudgets` under `strict: true`. The assembler's Wave 2 changes can emit `metadata_json = { section_tokens: { identity: countTokens(identity), ... } }` on the `context_assemble` span, and `clawcode context-audit <agent>` will start producing real numbers immediately.
- **Plan 53-03 can begin.** `lazySkills?` config surface exists; `ResolvedAgentConfig.perf.lazySkills?` readable. `resumeSummaryBudget?` exists on both schemas and the resolved type. The CLI scaffold is extensible — Plan 53-03 can add `bench --context-audit` as a flag on the existing `bench` command without touching the `context-audit` command itself.
- **Phase 50/51/52 regression check passed.** `traceRetentionDays` + `slos` still parse correctly on both schemas (grep shows 2 lines each). `ResolvedAgentConfig.perf` still carries `traceRetentionDays?` + `slos?` alongside the three new fields. All 1457 tests in the wider suite (src/performance + src/config + src/cli/commands/__tests__) still GREEN.
- **`tsc --noEmit` gate satisfied for Plan 53-01 files.** Zero new errors in `src/performance/token-count.ts`, `src/performance/context-audit.ts`, `src/config/schema.ts`, `src/shared/types.ts`, `src/cli/commands/context-audit.ts`, or `src/cli/index.ts`.

## Known Stubs

**None.** All code paths are wired end-to-end. The CLI will return `No context-assemble data for <agent>` until Plan 53-02 populates `metadata_json.section_tokens` on the `context_assemble` span — this is INTENTIONAL and PLANNED. The aggregator handles empty/legacy rows gracefully; the schema/type surface is fully usable today; the CLI produces correct empty-data output today. Plan 53-02's scope is to wire the span metadata.

**Explicit statement:** `metadata_json.section_tokens` on the `context_assemble` span remains absent until Plan 53-02 extends the assembler. The aggregator + CLI already treat this case correctly (skip legacy rows, return `sampledTurns: 0`, print `No context-assemble data`).

## Self-Check: PASSED

All six created files exist at expected paths:
- `src/performance/token-count.ts` FOUND
- `src/performance/__tests__/token-count.test.ts` FOUND
- `src/performance/context-audit.ts` FOUND
- `src/performance/__tests__/context-audit.test.ts` FOUND
- `src/cli/commands/context-audit.ts` FOUND
- `src/cli/commands/__tests__/context-audit.test.ts` FOUND

All six modified files carry the expected changes:
- `package.json` — `"@anthropic-ai/tokenizer": "^0.0.4"` present (grep returns 1)
- `package-lock.json` — auto-updated
- `src/config/schema.ts` — `memoryAssemblyBudgetsSchema` (4 matches), `lazySkillsSchema` (4), `resumeSummaryBudgetSchema` (3) declared + wired into BOTH schemas; `traceRetentionDays` + `slos` preserved (2 lines each)
- `src/config/__tests__/schema.test.ts` — 4 new describe blocks with 7 tests
- `src/shared/types.ts` — `memoryAssemblyBudgets?:` (1), `lazySkills?:` (1), `resumeSummaryBudget?:` (1), `usageThresholdTurns` (1)
- `src/cli/index.ts` — `registerContextAuditCommand` (2 matches: import + call)

Both task commits exist in `git log --oneline`:
- `fe3d686` FOUND (Task 1: countTokens + perf config + types mirror)
- `d5a546f` FOUND (Task 2: context-audit aggregator + CLI)

`grep -c '"context-audit"' src/ipc/protocol.ts` returns `0` (filesystem-direct preserved).

All 28 new Plan 53-01 tests GREEN. Wider suite `npx vitest run src/performance src/config src/cli/commands/__tests__` exits 0 with 1457 / 1457 tests passing.

`npx tsc --noEmit` shows ZERO errors in any Plan 53-01-modified file — grep-verified via filter on `src/(performance/token-count|performance/context-audit|config/schema|shared/types|cli/commands/context-audit|cli/index)`.

---
*Phase: 53-context-token-budget-tuning*
*Plan: 01*
*Completed: 2026-04-14*
