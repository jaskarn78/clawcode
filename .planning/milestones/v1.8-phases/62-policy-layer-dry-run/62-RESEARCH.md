# Phase 62: Policy Layer + Dry-Run - Research

**Researched:** 2026-04-17
**Domain:** Declarative YAML policy DSL, hot-reload, Handlebars templating, CLI dry-run
**Confidence:** HIGH

## Summary

Phase 62 replaces the Phase 60 pass-through `evaluatePolicy` pure function with a full declarative policy system. Operators write rules in `.clawcode/policies.yaml` matching trigger sources to agent targets with Handlebars payload templates, token-bucket throttles, priority ordering, and enable/disable flags. Hot-reload via chokidar (matching the Phase 23 config watcher pattern) swaps the active policy atomically on the next evaluation. Invalid policies are rejected -- daemon keeps the old policy, boot with invalid policies refuses to start.

The dry-run CLI reads the `trigger_events` table from `tasks.db` (read-only SQLite handle) and replays those events against the on-disk `policies.yaml` without requiring a running daemon. This is the first CLI command that opens SQLite directly rather than going through IPC.

**Primary recommendation:** Structure as three layers -- (1) policy schema + loader + rule-matching engine as pure functions, (2) hot-reload watcher + audit trail as daemon integration, (3) dry-run CLI as standalone read-only tool. All three share the same `evaluatePolicy` replacement function.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- policies.yaml lives at `.clawcode/policies.yaml` -- alongside agent configs. Loaded at daemon boot, hot-reloaded via chokidar.
- Handlebars (`handlebars` npm package) for payload templates -- logic-less, compiled at policy load time. `{{event.sourceId}}`, `{{event.payload.clientName}}` syntax.
- Source-match predicates use glob-style patterns on sourceId + sourceKind -- e.g. `source: { kind: "mysql", id: "pipeline_*" }`. Simple, declarative, familiar.
- Per-rule throttle via token bucket -- `throttle: { maxPerMinute: 10 }`. Simple counter + sliding window. In-memory only, resets on daemon restart.
- Each rule has a required `id` field, `enabled` flag (default true), and integer `priority` (higher = first evaluated).
- chokidar watcher on policies.yaml -- on change, re-parse + Zod validate. Valid -> swap atomically (replace reference). Invalid -> log error + keep old policy. Matches Phase 23 config hot-reload pattern.
- JSONL audit trail at `.clawcode/policy-audit.jsonl` -- each reload writes `{ timestamp, action, diff, status, error? }`. Matches Phase 23 config audit trail pattern.
- Diff computed via rule ID comparison -- set difference on IDs (added/removed) + deep-equal on matching IDs (modified). Simple, deterministic.
- Boot with invalid policies.yaml REJECTS ENTIRELY -- daemon refuses to start. Log Zod error with line numbers.
- Read trigger_events from tasks.db -- persisted by Phase 60 dedup layer. `SELECT * FROM trigger_events WHERE created_at > ?` gives replay window.
- CLI: `clawcode policy dry-run --since 1h` -- replays events against current on-disk policy. `--since` accepts duration strings.
- Output: formatted table with columns `Timestamp | Source | Event | Rule | Agent | Action`. `--json` flag for machine-readable. Color-coded: green=allow, red=deny.
- Dry-run needs NO running daemon -- reads policies.yaml + tasks.db directly via read-only SQLite handle.

### Claude's Discretion
- Policy rule Zod schema field names and nesting (within the locked decisions above).
- PolicyEvaluator replacement implementation details -- must maintain the TriggerEvent->PolicyResult contract from Phase 60.
- Glob matching library or hand-rolled (minimatch vs simple startsWith/endsWith).
- Token bucket implementation details (sliding window approach).
- JSONL file rotation strategy (if any).
- Test fixture organization for policy rules.

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POL-01 | Zod-validated policy YAML | Policy Zod schema, YAML parsing via `yaml` package (existing pattern from SchemaRegistry), boot-time validation with atomic rejection |
| POL-02 | Policy DSL (source/agent/template/throttle/priority) | Handlebars compile at load time, glob-style source matching, token bucket throttle, priority sort, enabled flag |
| POL-03 | Policy hot-reload without daemon restart | chokidar watcher pattern from `src/config/watcher.ts`, JSONL audit trail from `src/config/audit-trail.ts`, rule-ID-based diff |
| POL-04 | Dry-run replay against pending policy changes | Read-only SQLite on `tasks.db`, trigger_events table query, CLI `clawcode policy dry-run --since` with formatted table + `--json` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| handlebars | 4.7.9 | Payload templates | Logic-less, pre-compilable, ships own TypeScript types. Locked decision. |
| zod | 4.3.6 | Policy schema validation | Already in project deps. Standard for all config/data validation. |
| yaml | 2.8.3 | Parse policies.yaml | Already in project deps. `parse as parseYaml` is the established import pattern. |
| chokidar | 5.0.0 | File watching for hot-reload | Already in project deps. ConfigWatcher pattern from Phase 23 is the template. |
| better-sqlite3 | 12.8.0 | Read-only SQLite for dry-run CLI | Already in project deps. Dry-run opens tasks.db with `{ readonly: true }`. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 9.x | Structured logging | Already in project deps. Used for reload errors, audit events. |
| date-fns | 4.x | Duration parsing | Already in project deps. `--since 1h` duration string parsing. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Handlebars | Mustache / template literals | Handlebars is locked decision. Mustache lacks precompile. Template literals are code injection risk. |
| Hand-rolled glob matching | minimatch / picomatch | Both are transitive deps (via `glob`). But source patterns are simple (`pipeline_*`). Hand-rolled is ~15 LOC and zero-dep risk. Recommend hand-rolled. |
| Token bucket (hand-rolled) | rate-limiter-flexible / bottleneck | Overkill. Per-rule in-memory counter with sliding window is ~30 LOC. Resets on daemon restart per decision. |

**Installation:**
```bash
npm install handlebars
```

No `@types/handlebars` needed -- Handlebars ships its own TypeScript definitions since v4.1+.

**Version verification:** `npm view handlebars version` -> 4.7.9 (verified 2026-04-17).

## Architecture Patterns

### Recommended Project Structure
```
src/triggers/
  policy-evaluator.ts       # REPLACE: Phase 60 pure function -> Phase 62 PolicyEvaluator class
  policy-schema.ts          # NEW: Zod schemas for policy YAML shape
  policy-loader.ts          # NEW: Parse YAML, validate, compile Handlebars templates
  policy-differ.ts          # NEW: Rule-ID-based diff (added/removed/modified)
  policy-watcher.ts         # NEW: chokidar watcher + audit trail for policies.yaml
  policy-throttle.ts        # NEW: In-memory token bucket per rule
  types.ts                  # EXTEND: Add sourceKind to TriggerEvent (if not present)
  engine.ts                 # MODIFY: Wire new evaluatePolicy signature
src/cli/commands/
  policy.ts                 # NEW: `clawcode policy dry-run` command
```

### Pattern 1: Policy Evaluator as Stateful Class (replacing pure function)
**What:** The Phase 60 `evaluatePolicy` is a pure function taking `(TriggerEvent, ReadonlySet<string>)`. Phase 62 replaces this with a `PolicyEvaluator` class that holds compiled rules, Handlebars templates, and throttle state.
**When to use:** The evaluator needs mutable state (throttle counters) and precompiled templates.
**Example:**
```typescript
// The new PolicyEvaluator wraps the same contract
export class PolicyEvaluator {
  private rules: readonly CompiledRule[];
  private throttles: Map<string, TokenBucket>;

  constructor(rules: readonly CompiledRule[]) {
    this.rules = [...rules].sort((a, b) => b.priority - a.priority);
    this.throttles = new Map();
    for (const rule of this.rules) {
      if (rule.throttle) {
        this.throttles.set(rule.id, new TokenBucket(rule.throttle.maxPerMinute));
      }
    }
  }

  evaluate(event: TriggerEvent): PolicyResult {
    // 1. Find first matching enabled rule (sorted by priority desc)
    // 2. Check throttle
    // 3. Compile payload via Handlebars template
    // 4. Return frozen PolicyResult
  }
}
```

### Pattern 2: Atomic Swap via Reference Replacement
**What:** Hot-reload replaces the evaluator reference, not mutating its internals.
**When to use:** The chokidar watcher on policies.yaml detects changes, validates, and swaps.
**Example:**
```typescript
// In TriggerEngine or daemon wiring
private evaluator: PolicyEvaluator;

reloadPolicy(newEvaluator: PolicyEvaluator): void {
  // Atomic swap -- old evaluator is GC'd once in-flight evaluations complete
  this.evaluator = newEvaluator;
}
```

### Pattern 3: Read-Only SQLite for CLI Commands
**What:** Dry-run CLI opens tasks.db with `{ readonly: true }` -- no WAL contention with running daemon.
**When to use:** First time in this codebase. better-sqlite3 supports `{ readonly: true }` natively.
**Example:**
```typescript
// Source: better-sqlite3 docs
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare(
  "SELECT source_id, idempotency_key, created_at FROM trigger_events WHERE created_at > ?"
).all(sinceEpoch);
db.close();
```

### Pattern 4: Compiled Rule Shape
**What:** At policy load time, YAML rules are parsed, Zod-validated, and compiled into an internal `CompiledRule` shape with pre-compiled Handlebars templates.
**When to use:** Every policy load (boot + hot-reload).
**Example:**
```typescript
import Handlebars from "handlebars";

type CompiledRule = Readonly<{
  id: string;
  description?: string;
  enabled: boolean;
  priority: number;
  source: { kind?: string; id?: string }; // glob patterns
  targetAgent: string;
  payloadTemplate: Handlebars.TemplateDelegate; // pre-compiled
  throttle?: { maxPerMinute: number };
}>;
```

### Anti-Patterns to Avoid
- **Compiling Handlebars on every evaluation:** Templates must be compiled ONCE at policy load time, not on every `evaluate()` call. `Handlebars.compile()` returns a reusable `TemplateDelegate`.
- **Mutating the active rule set during reload:** Never mutate in place. Create a new `PolicyEvaluator` instance and swap the reference.
- **Using `{ readonly: true }` without `{ fileMustExist: true }` for dry-run:** If tasks.db doesn't exist, the CLI should error with a clear message, not create an empty database.
- **Storing throttle state across reloads:** Throttle counters reset on each policy reload (new `PolicyEvaluator` instance). This is acceptable -- the alternative (migrating counters) adds complexity for no clear benefit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template rendering | Custom string interpolation | `handlebars` npm package | Edge cases around escaping, nested properties, missing fields. Locked decision. |
| YAML parsing | Custom parser | `yaml` package (already in deps) | Established project pattern. Used in config loader, schema registry. |
| Zod validation | Manual field checks | `zod` v4 schemas | Project convention for all config/data shapes. |
| File watching | fs.watch / polling | `chokidar` (already in deps) | Cross-platform, debounced. ConfigWatcher pattern exists. |
| JSONL audit trail | Custom file writer | Adapt `AuditTrail` from `src/config/audit-trail.ts` | Existing pattern handles directory creation, append-only writes. |
| Deep equality for diff | Manual recursion | Adapt `isDeepEqual` from `src/config/differ.ts` | Existing utility already tested in the codebase. |

**Key insight:** The existing Phase 23 config hot-reload infrastructure (`ConfigWatcher`, `AuditTrail`, `diffConfigs`) provides the pattern. The policy watcher is structurally identical but watches a different file and uses rule-ID-based diffing instead of field-path-based diffing.

## Common Pitfalls

### Pitfall 1: trigger_events Table Does Not Store Full Event Data
**What goes wrong:** The `trigger_events` table only has `(source_id, idempotency_key, created_at)`. It does NOT store `targetAgent` or `payload`. The dry-run cannot fully replay events with real payloads.
**Why it happens:** The table was designed for dedup (Phase 60), not replay.
**How to avoid:** Two options:
  1. **Extend the table** -- add `target_agent TEXT`, `source_kind TEXT`, `payload TEXT` columns to `trigger_events`. This is the correct solution since the CONTEXT.md explicitly says "Read trigger_events from tasks.db" for dry-run. Phase 62 should add an idempotent migration (ALTER TABLE or CREATE-IF-NOT-EXISTS with new columns).
  2. **Dry-run with partial data** -- show which RULES match based on `source_id` alone, without template evaluation. Less useful but simpler.
**Recommendation:** Extend the table. The dry-run is much more valuable when it shows the actual rendered payload. Add columns with idempotent `ALTER TABLE` migration (Phase 52 trace-store pattern).
**Warning signs:** If dry-run output shows "N/A" for payload columns, the table wasn't extended.

### Pitfall 2: sourceKind Not Present on TriggerEvent
**What goes wrong:** The current `TriggerEventSchema` has `sourceId` but NOT `sourceKind`. The policy DSL needs `source: { kind: "mysql", id: "pipeline_*" }` matching. Without `sourceKind` on the event, rules can only match on `sourceId` patterns.
**Why it happens:** Phase 60 designed TriggerEvent for dedup, not policy routing.
**How to avoid:** Either (a) extend `TriggerEventSchema` with an optional `sourceKind` field, or (b) derive `sourceKind` from `sourceId` prefix convention (e.g., `scheduler`, `webhook:stripe`, `mysql:pipeline_clients`). Option (b) is simpler -- the sourceId already implicitly encodes the kind. Policy matching should support glob on sourceId alone.
**Recommendation:** Add `sourceKind` as an optional field to `TriggerEventSchema` for explicit matching, while keeping sourceId glob matching as the primary mechanism. Existing sources set it (e.g., MysqlSource sets `sourceKind: "mysql"`). Rules can match on either or both.
**Warning signs:** Policy rules with `source.kind` never match because events don't carry the field.

### Pitfall 3: Handlebars noEscape Required for Non-HTML Payloads
**What goes wrong:** Handlebars escapes HTML entities by default (`<` becomes `&lt;`). Policy payloads are not HTML -- they're agent prompts.
**Why it happens:** Handlebars was designed for HTML templates.
**How to avoid:** Compile with `{ noEscape: true }` to disable HTML entity escaping. The payloads are data flowing to agent turns, not rendered in browsers.
**Warning signs:** Agent receives payloads with `&amp;`, `&lt;`, `&gt;` instead of raw characters.

### Pitfall 4: Policy Accidentally Matches Everything
**What goes wrong:** A rule with `source: { id: "*" }` or no source filter matches all events, routing everything to one agent.
**Why it happens:** Operators write overly broad glob patterns.
**How to avoid:** Dry-run (POL-04) exists specifically for this. Also: warn in audit trail when a rule matches >90% of recent events. The dry-run table showing "no match" rows (from CONTEXT.md specifics) helps operators see what falls through.
**Warning signs:** All dry-run rows show the same rule ID.

### Pitfall 5: Boot Rejection vs Hot-Reload Rejection Asymmetry
**What goes wrong:** Operators expect the same behavior at boot and hot-reload, but boot REJECTS (daemon won't start) while hot-reload RECOVERS (keeps old policy).
**Why it happens:** This asymmetry is by design (from CONTEXT.md). At boot, there's no "old policy" to fall back to.
**How to avoid:** Make the error messages clearly differentiate: "FATAL: policies.yaml invalid -- daemon cannot start" vs "WARN: policies.yaml reload failed -- keeping previous policy."
**Warning signs:** Operators confused about why the daemon sometimes starts and sometimes doesn't with the same invalid file.

### Pitfall 6: Token Bucket Sliding Window Edge Cases
**What goes wrong:** Simple counter-based throttles don't account for burst patterns correctly. A counter that resets every 60s allows 10 events at second 59 and 10 more at second 61.
**Why it happens:** Fixed-window counters have boundary effects.
**How to avoid:** Use a proper sliding window: store timestamps of recent events, count those within the last 60 seconds. Simple and correct.
**Warning signs:** More events fire than `maxPerMinute` allows during window transitions.

## Code Examples

### Policy YAML Shape (Recommended Schema)
```yaml
# .clawcode/policies.yaml
version: 1
rules:
  - id: new-client-research
    description: "Route new pipeline clients to research agent"
    enabled: true
    priority: 100
    source:
      kind: mysql
      id: "pipeline_*"
    target: research
    payload: |
      New client detected: {{event.payload.clientName}}
      Company: {{event.payload.companyName}}
      Source: {{event.sourceId}}
    throttle:
      maxPerMinute: 10

  - id: daily-briefing
    description: "Morning briefing from scheduler"
    enabled: true
    priority: 50
    source:
      kind: scheduler
      id: "daily-briefing"
    target: studio
    payload: "Run the daily briefing workflow."

  - id: catch-all-inbox
    description: "Route all inbox events to clawdy"
    enabled: false
    priority: 1
    source:
      kind: inbox
    target: clawdy
    payload: "New inbox message: {{event.payload}}"
```

### Zod Schema for Policy File
```typescript
// Source: project conventions (zod v4)
import { z } from "zod/v4";

const PolicySourceSchema = z.object({
  kind: z.string().optional(),
  id: z.string().optional(),
});

const PolicyThrottleSchema = z.object({
  maxPerMinute: z.number().int().positive(),
});

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  source: PolicySourceSchema.optional(),
  target: z.string().min(1),
  payload: z.string().min(1),
  throttle: PolicyThrottleSchema.optional(),
});

const PolicyFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(PolicyRuleSchema).min(0),
});
```

### Handlebars Template Compilation at Load Time
```typescript
import Handlebars from "handlebars";

type CompiledRule = Readonly<{
  id: string;
  enabled: boolean;
  priority: number;
  source: { kind?: string; id?: string };
  target: string;
  template: Handlebars.TemplateDelegate;
  throttle?: { maxPerMinute: number };
}>;

function compileRule(raw: PolicyRule): CompiledRule {
  return Object.freeze({
    id: raw.id,
    enabled: raw.enabled,
    priority: raw.priority,
    source: raw.source ?? {},
    target: raw.target,
    template: Handlebars.compile(raw.payload, { noEscape: true }),
    throttle: raw.throttle,
  });
}
```

### Glob-Style Source Matching (Hand-Rolled)
```typescript
/**
 * Match a value against a glob pattern supporting only trailing `*`.
 * Examples: "pipeline_*" matches "pipeline_clients", "*" matches anything.
 */
function globMatch(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return pattern === value;
}

function matchesSource(
  rule: { kind?: string; id?: string },
  event: { sourceKind?: string; sourceId: string },
): boolean {
  if (rule.kind && event.sourceKind && !globMatch(rule.kind, event.sourceKind)) {
    return false;
  }
  if (rule.id && !globMatch(rule.id, event.sourceId)) {
    return false;
  }
  return true;
}
```

### Token Bucket Sliding Window
```typescript
class TokenBucket {
  private readonly maxPerMinute: number;
  private readonly timestamps: number[] = [];

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  tryConsume(): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    // Remove expired entries
    while (this.timestamps.length > 0 && this.timestamps[0]! < windowStart) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maxPerMinute) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}
```

### Read-Only SQLite for Dry-Run
```typescript
import Database from "better-sqlite3";

function readTriggerEvents(dbPath: string, sinceEpoch: number) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      "SELECT source_id, idempotency_key, created_at FROM trigger_events WHERE created_at > ? ORDER BY created_at ASC"
    ).all(sinceEpoch);
    return rows;
  } finally {
    db.close();
  }
}
```

### Duration String Parsing
```typescript
/**
 * Parse a duration string like "1h", "30m", "2d" into milliseconds.
 */
function parseDuration(input: string): number {
  const match = input.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration: ${input}`);
  const [, value, unit] = match;
  const n = parseInt(value!, 10);
  switch (unit) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 60 pass-through evaluatePolicy | Phase 62 DSL-aware PolicyEvaluator | Phase 62 | evaluatePolicy becomes a class with rules, templates, throttles |
| TriggerEvent has no sourceKind | TriggerEvent extended with optional sourceKind | Phase 62 | Enables kind-based policy matching |
| trigger_events stores only dedup fields | trigger_events extended with target_agent, source_kind, payload | Phase 62 | Enables dry-run replay with full context |
| No policy file | `.clawcode/policies.yaml` | Phase 62 | Operators control trigger routing declaratively |

**Deprecated/outdated:**
- Phase 60's `evaluatePolicy` pure function is replaced. The contract shape (TriggerEvent in, PolicyResult out) is preserved but the implementation becomes a class method.

## Open Questions

1. **trigger_events Table Extension Approach**
   - What we know: Table currently has 3 columns (source_id, idempotency_key, created_at). Dry-run needs source_kind, target_agent, and payload for meaningful replay.
   - What's unclear: Whether to use ALTER TABLE ADD COLUMN (better-sqlite3 supports this) or recreate the table. ALTER TABLE is simpler and idempotent.
   - Recommendation: Use idempotent ALTER TABLE ADD COLUMN with try/catch (column already exists is a no-op). This is the pattern used elsewhere in the codebase for schema evolution. Add `source_kind TEXT`, `payload TEXT` (nullable -- old rows have NULL, new rows get populated).

2. **PolicyResult Extension for Template Output**
   - What we know: Current PolicyResult is `{ allow: true, targetAgent }` or `{ allow: false, reason }`. Phase 62 needs to also return the rendered payload string.
   - What's unclear: Whether to extend PolicyResult or return a richer type.
   - Recommendation: Extend the allow branch: `{ allow: true, targetAgent: string, payload: string, ruleId: string }`. The `ruleId` is needed for audit trail and dry-run output.

3. **How TriggerEngine Passes sourceKind to the Evaluator**
   - What we know: TriggerEvent.sourceKind doesn't exist yet. Each source knows its kind implicitly.
   - What's unclear: Best place to add sourceKind.
   - Recommendation: Add `sourceKind` as optional field to TriggerEventSchema. Each source adapter (MysqlSource, WebhookSource, etc.) sets it. SchedulerSource sets `sourceKind: "scheduler"`. The evaluator reads it for matching.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run src/triggers/__tests__/` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POL-01 | Zod validates policy YAML, rejects invalid at boot | unit | `npx vitest run src/triggers/__tests__/policy-schema.test.ts -x` | Wave 0 |
| POL-01 | Boot with invalid policies.yaml refuses to start | integration | `npx vitest run src/triggers/__tests__/policy-loader.test.ts -x` | Wave 0 |
| POL-02 | Source glob matching, priority ordering, Handlebars templates | unit | `npx vitest run src/triggers/__tests__/policy-evaluator.test.ts -x` | Exists (needs rewrite) |
| POL-02 | Token bucket throttle per rule | unit | `npx vitest run src/triggers/__tests__/policy-throttle.test.ts -x` | Wave 0 |
| POL-03 | Hot-reload swaps policy atomically, invalid keeps old | integration | `npx vitest run src/triggers/__tests__/policy-watcher.test.ts -x` | Wave 0 |
| POL-03 | JSONL audit trail records reload events | unit | `npx vitest run src/triggers/__tests__/policy-watcher.test.ts -x` | Wave 0 |
| POL-03 | Rule-ID-based diff detects added/removed/modified | unit | `npx vitest run src/triggers/__tests__/policy-differ.test.ts -x` | Wave 0 |
| POL-04 | Dry-run reads trigger_events via read-only SQLite | unit | `npx vitest run src/cli/commands/__tests__/policy.test.ts -x` | Wave 0 |
| POL-04 | Dry-run output formatted table + JSON | unit | `npx vitest run src/cli/commands/__tests__/policy.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/triggers/__tests__/ src/cli/commands/__tests__/policy.test.ts -x`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/triggers/__tests__/policy-schema.test.ts` -- covers POL-01 schema validation
- [ ] `src/triggers/__tests__/policy-loader.test.ts` -- covers POL-01 boot rejection + POL-02 compile
- [ ] `src/triggers/__tests__/policy-throttle.test.ts` -- covers POL-02 token bucket
- [ ] `src/triggers/__tests__/policy-watcher.test.ts` -- covers POL-03 hot-reload + audit
- [ ] `src/triggers/__tests__/policy-differ.test.ts` -- covers POL-03 rule diff
- [ ] `src/cli/commands/__tests__/policy.test.ts` -- covers POL-04 dry-run CLI
- [ ] Existing `src/triggers/__tests__/policy-evaluator.test.ts` needs full rewrite (10 tests for Phase 60 pass-through will be replaced)

*(Existing `src/triggers/__tests__/policy-evaluator.test.ts` has 10 tests for the Phase 60 pure function -- all will be replaced with new tests for the DSL-aware evaluator)*

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 22 LTS | -- |
| handlebars (npm) | POL-02 payload templates | No (not yet installed) | 4.7.9 (npm registry) | Must install |
| better-sqlite3 | POL-04 read-only DB | Yes | 12.8.0 | -- |
| vitest | Testing | Yes | 4.1.3 | -- |

**Missing dependencies with no fallback:**
- `handlebars` must be installed: `npm install handlebars`

**Missing dependencies with fallback:**
- None

## Project Constraints (from CLAUDE.md)

- **Immutability:** Create new PolicyEvaluator instances on reload, never mutate existing ones. CompiledRule must be Readonly/Object.freeze.
- **File organization:** Many small files -- policy-schema.ts, policy-loader.ts, policy-evaluator.ts (rewrite), policy-differ.ts, policy-watcher.ts, policy-throttle.ts.
- **Error handling:** Boot rejection throws with Zod error details. Hot-reload catches and logs. Dry-run CLI catches and writes to stderr.
- **Input validation:** Zod schema validates all policy YAML at parse time. Handlebars templates compiled at load time (fail-fast on syntax errors).
- **Security:** Handlebars with `noEscape: true` is safe because payloads are agent prompts, not browser-rendered HTML. No user-facing XSS vector.
- **GSD workflow:** Phase work should go through `/gsd:execute-phase`.

## Sources

### Primary (HIGH confidence)
- `src/triggers/policy-evaluator.ts` -- Phase 60 pure function being replaced (read directly)
- `src/triggers/engine.ts` -- TriggerEngine integration point (read directly)
- `src/triggers/types.ts` -- TriggerEvent schema and defaults (read directly)
- `src/triggers/dedup.ts` -- DedupLayer with trigger_events table DDL (read directly)
- `src/config/watcher.ts` -- ConfigWatcher pattern for hot-reload (read directly)
- `src/config/audit-trail.ts` -- AuditTrail JSONL writer pattern (read directly)
- `src/config/differ.ts` -- Config diffing pattern with isDeepEqual (read directly)
- `src/tasks/store.ts` -- TaskStore with trigger_events DDL and rawDb getter (read directly)
- `src/tasks/schema-registry.ts` -- YAML loading + Zod validation pattern (read directly)
- `src/cli/index.ts` -- CLI command registration pattern (read directly)
- `src/cli/commands/tasks.ts` -- CLI command with IPC pattern (read directly)
- `src/cli/commands/costs.ts` -- CLI table formatting pattern (read directly)
- `package.json` -- Verified current deps (read directly)

### Secondary (MEDIUM confidence)
- [Handlebars compilation API](https://handlebarsjs.com/api-reference/compilation.html) -- compile options including noEscape
- npm registry -- `npm view handlebars version` = 4.7.9, ships own TypeScript types

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libs verified in project deps or npm registry, Handlebars is locked decision
- Architecture: HIGH -- all patterns directly observed in existing codebase (ConfigWatcher, AuditTrail, SchemaRegistry)
- Pitfalls: HIGH -- trigger_events table schema verified by direct code read, sourceKind gap confirmed by TriggerEventSchema inspection
- Dry-run data gap: HIGH -- confirmed trigger_events has only 3 columns by reading both DedupLayer DDL and TaskStore DDL

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable domain, no fast-moving dependencies)
