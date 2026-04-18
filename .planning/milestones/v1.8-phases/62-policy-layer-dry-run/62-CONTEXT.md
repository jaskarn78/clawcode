# Phase 62: Policy Layer + Dry-Run - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Operators get a declarative YAML policy file that routes triggers to agents with templates, throttles, priorities, and kill switches. Hot-reload picks up changes without daemon restart. Dry-run CLI replays recent events against the current policy to validate before going live. Invalid policies are rejected atomically — daemon never runs with a broken policy.

</domain>

<decisions>
## Implementation Decisions

### Policy DSL Shape (POL-01, POL-02)
- policies.yaml lives at `.clawcode/policies.yaml` — alongside agent configs. Loaded at daemon boot, hot-reloaded via chokidar.
- Handlebars (`handlebars` npm package) for payload templates — logic-less, compiled at policy load time. `{{event.sourceId}}`, `{{event.payload.clientName}}` syntax.
- Source-match predicates use glob-style patterns on sourceId + sourceKind — e.g. `source: { kind: "mysql", id: "pipeline_*" }`. Simple, declarative, familiar.
- Per-rule throttle via token bucket — `throttle: { maxPerMinute: 10 }`. Simple counter + sliding window. In-memory only, resets on daemon restart.
- Each rule has a required `id` field, `enabled` flag (default true), and integer `priority` (higher = first evaluated).

### Hot-Reload + Audit Trail (POL-03)
- chokidar watcher on policies.yaml — on change, re-parse + Zod validate. Valid → swap atomically (replace reference). Invalid → log error + keep old policy. Matches Phase 23 config hot-reload pattern.
- JSONL audit trail at `.clawcode/policy-audit.jsonl` — each reload writes `{ timestamp, action, diff, status, error? }`. Matches Phase 23 config audit trail pattern.
- Diff computed via rule ID comparison — set difference on IDs (added/removed) + deep-equal on matching IDs (modified). Simple, deterministic.
- Boot with invalid policies.yaml REJECTS ENTIRELY — daemon refuses to start. Log Zod error with line numbers. Matches POL-01 success criterion.

### Dry-Run CLI (POL-04)
- Read trigger_events from tasks.db — persisted by Phase 60 dedup layer. `SELECT * FROM trigger_events WHERE created_at > ?` gives replay window.
- CLI: `clawcode policy dry-run --since 1h` — replays events against current on-disk policy. `--since` accepts duration strings.
- Output: formatted table with columns `Timestamp | Source | Event | Rule | Agent | Action`. `--json` flag for machine-readable. Color-coded: green=allow, red=deny.
- Dry-run needs NO running daemon — reads policies.yaml + tasks.db directly via read-only SQLite handle.

### Claude's Discretion
- Policy rule Zod schema field names and nesting (within the locked decisions above).
- PolicyEvaluator replacement implementation details — must maintain the TriggerEvent→PolicyResult contract from Phase 60.
- Glob matching library or hand-rolled (minimatch vs simple startsWith/endsWith).
- Token bucket implementation details (sliding window approach).
- JSONL file rotation strategy (if any).
- Test fixture organization for policy rules.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/triggers/policy-evaluator.ts` — Current Phase 60 evaluatePolicy (pure function, TriggerEvent→PolicyResult contract). Phase 62 replaces the implementation.
- `src/triggers/engine.ts` — TriggerEngine calls evaluatePolicy in ingest pipeline.
- `src/config/watcher.ts` — Existing chokidar-based config hot-reload pattern.
- `src/config/audit-trail.ts` — Existing JSONL audit trail implementation from Phase 23.
- `src/tasks/store.ts` — TaskStore with trigger_events table (read by dry-run CLI).
- `src/cli/index.ts` — CLI command registration point.

### Established Patterns
- Phase 23 config hot-reload: chokidar watch → parse → validate → atomic swap → audit log.
- Phase 60 policy evaluator: pure function with frozen return values.
- CLI commands: registered in src/cli/index.ts, implemented in src/cli/commands/*.ts.
- Zod for all persistent/config shapes.

### Integration Points
- src/triggers/policy-evaluator.ts — replace implementation, keep contract.
- src/triggers/engine.ts — TriggerEngine.evaluate() calls evaluatePolicy.
- daemon.ts — load policies.yaml at boot, start chokidar watcher, inject evaluator.
- src/cli/index.ts — register `policy` command with `dry-run` subcommand.

</code_context>

<specifics>
## Specific Ideas

- Policy rules should support a `description` field for operator documentation.
- Dry-run output should include "no match" rows for events that would be dropped, so operators can see what ISN'T firing.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
