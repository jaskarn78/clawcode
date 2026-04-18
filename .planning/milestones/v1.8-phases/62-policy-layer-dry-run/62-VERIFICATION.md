---
phase: 62-policy-layer-dry-run
verified: 2026-04-17T18:50:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 62: Policy Layer + Dry-Run Verification Report

**Phase Goal:** Operators edit one declarative YAML file to route triggers to agents with payload templates, throttles, priorities, and enable/disable flags; hot-reload takes effect on the next evaluation; dry-run proves a policy change does what they think BEFORE any agent is woken.
**Verified:** 2026-04-17T18:50:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                          | Status     | Evidence                                                                                 |
|----|-----------------------------------------------------------------------------------------------|------------|------------------------------------------------------------------------------------------|
| 1  | Valid policies.yaml parsed, Zod-validated, Handlebars-compiled into CompiledRule[]            | VERIFIED   | `loadPolicies()` in policy-loader.ts: YAML parse → PolicyFileSchema.safeParse → map compileRule → sort priority desc |
| 2  | Invalid policies.yaml throws PolicyValidationError with Zod error details                     | VERIFIED   | `loadPolicies()` throws `PolicyValidationError` on `safeParse` failure with `result.error.issues` |
| 3  | Source-match predicates support glob patterns on sourceKind and sourceId                      | VERIFIED   | `globMatch()` + `matchesSource()` in policy-evaluator.ts: handles `*`, trailing `*`, exact match |
| 4  | Per-rule throttle limits event rate via sliding-window token bucket                           | VERIFIED   | `TokenBucket` in policy-throttle.ts: timestamp array with 60s window eviction, `tryConsume()` called in evaluate() |
| 5  | Priority ordering: higher-priority rules evaluated first                                      | VERIFIED   | `loadPolicies()` sorts by priority desc; `PolicyEvaluator` constructor re-sorts as safety net |
| 6  | Enabled flag filters disabled rules before evaluation                                         | VERIFIED   | `evaluate()` in policy-evaluator.ts line 111: `if (!rule.enabled) continue;`            |
| 7  | PolicyEvaluator.evaluate() returns PolicyResult with ruleId and rendered payload              | VERIFIED   | `PolicyResult` type includes `ruleId: string` and `payload: string`; Handlebars rendered at line 136 |
| 8  | Editing policies.yaml on a running daemon causes next evaluation to use new rules without restart | VERIFIED | `PolicyWatcher` uses chokidar with debounced reload; `onReload` calls `triggerEngine.reloadEvaluator(newEvaluator)` atomically |
| 9  | Invalid policies.yaml edit keeps old policy live and logs an error                            | VERIFIED   | `reload()` in policy-watcher.ts: catch block logs warn "reload failed -- keeping previous policy", keeps `currentEvaluator` unchanged |
| 10 | Boot with invalid policies.yaml rejects — daemon refuses to start                             | VERIFIED   | `daemon.ts` wraps `PolicyValidationError` as `ManagerError` with FATAL prefix before TriggerEngine construction; `policyWatcher.start()` re-throws on invalid file |
| 11 | Each reload writes a JSONL audit entry with timestamp, action, diff, status                   | VERIFIED   | `writeAuditEntry()` in policy-watcher.ts appends JSONL to `auditPath`; both success and error paths write entries |
| 12 | Operator runs `clawcode policy dry-run --since 1h` without daemon and sees matching rules     | VERIFIED   | `runDryRun()` in policy.ts: read-only SQLite on tasks.db, evaluates each trigger_events row, returns DryRunRow[] with rule/agent/action columns |

**Score:** 12/12 truths verified

---

### Required Artifacts

| Artifact                                        | Expected                                              | Status      | Details                                                                 |
|-------------------------------------------------|-------------------------------------------------------|-------------|-------------------------------------------------------------------------|
| `src/triggers/policy-schema.ts`                 | Zod schemas for PolicyFile, PolicyRule, etc.          | VERIFIED    | Exports `PolicyFileSchema`, `PolicyRuleSchema`, `PolicySourceSchema`, `PolicyThrottleSchema` and inferred types |
| `src/triggers/policy-loader.ts`                 | YAML + Zod + Handlebars compile pipeline              | VERIFIED    | Exports `loadPolicies`, `compileRule`, `CompiledRule`, `PolicyValidationError`; `Handlebars.compile(..., { noEscape: true })` |
| `src/triggers/policy-evaluator.ts`              | DSL-aware PolicyEvaluator class                       | VERIFIED    | Exports `PolicyEvaluator` class with `evaluate()`, `updateConfiguredAgents()`; backward-compat `evaluatePolicy` wrapper preserved |
| `src/triggers/policy-throttle.ts`               | Sliding-window token bucket                           | VERIFIED    | Exports `TokenBucket` with `tryConsume()` (~40 LOC, mutable by design) |
| `src/triggers/policy-differ.ts`                 | Rule-ID-based diff (added/removed/modified)           | VERIFIED    | Exports `diffPolicies()` and `PolicyDiff` type; excludes Handlebars template from comparison via `toSerializable()` |
| `src/triggers/policy-watcher.ts`                | chokidar watcher + JSONL audit trail                  | VERIFIED    | Exports `PolicyWatcher`, `PolicyWatcherOptions`; start/stop/getCurrentEvaluator lifecycle; JSONL appendFile audit |
| `src/triggers/engine.ts`                        | TriggerEngine wired to PolicyEvaluator class          | VERIFIED    | `PolicyEvaluator` injected as optional 3rd ctor arg; `this.evaluator.evaluate(debounced)` called in ingest; `reloadEvaluator()` method present |
| `src/manager/daemon.ts`                         | Boot-time policy load + PolicyWatcher start + wiring  | VERIFIED    | `loadPolicies()` called before `TriggerEngine` construction; `bootEvaluator` passed as 3rd arg; `PolicyWatcher` created, started, stopped in shutdown |
| `src/cli/commands/policy.ts`                    | `clawcode policy dry-run` CLI command                 | VERIFIED    | Exports `registerPolicyCommand`, `parseDuration`, `runDryRun`, `formatDryRunTable`, `formatDryRunJson`; read-only SQLite with `fileMustExist: true` |
| `src/cli/index.ts`                              | Policy command registered in CLI                      | VERIFIED    | `registerPolicyCommand` imported and called at line 164; 2 occurrences confirmed |

---

### Key Link Verification

| From                              | To                               | Via                                      | Status  | Details                                                              |
|-----------------------------------|----------------------------------|------------------------------------------|---------|----------------------------------------------------------------------|
| `policy-loader.ts`                | `policy-schema.ts`               | `PolicyFileSchema.safeParse()`           | WIRED   | Import on line 16; `safeParse` call on line 88                       |
| `policy-evaluator.ts`             | `policy-throttle.ts`             | `TokenBucket.tryConsume()`               | WIRED   | Import on line 17; `bucket.tryConsume()` at line 119                 |
| `policy-loader.ts`                | `handlebars`                     | `Handlebars.compile(..., { noEscape: true })` | WIRED | Line 56: `Handlebars.compile(raw.payload, { noEscape: true })`       |
| `policy-watcher.ts`               | `policy-loader.ts`               | `loadPolicies()` on file change          | WIRED   | Import line 24; called in `start()` line 115 and `reload()` line 229 |
| `policy-watcher.ts`               | `policy-differ.ts`               | `diffPolicies()` for audit trail         | WIRED   | Import line 27; called in `reload()` line 248                        |
| `engine.ts`                       | `policy-evaluator.ts`            | `this.evaluator.evaluate()`              | WIRED   | Import line 21; `this.evaluator.evaluate(debounced)` at line 119     |
| `daemon.ts`                       | `policy-watcher.ts`              | `policyWatcher.start()` in boot          | WIRED   | Import line 49; `await policyWatcher.start()` at line 834            |
| `policy.ts` (CLI)                 | `policy-loader.ts`               | `loadPolicies()` to parse policies.yaml  | WIRED   | Import line 15; called in `runDryRun()` line 92                      |
| `policy.ts` (CLI)                 | `policy-evaluator.ts`            | `PolicyEvaluator.evaluate()` per event   | WIRED   | Import line 16; `evaluator.evaluate(event)` at line 142              |
| `policy.ts` (CLI)                 | `better-sqlite3`                 | Read-only SQLite on tasks.db             | WIRED   | `{ readonly: true, fileMustExist: true }` at line 101                |
| `cli/index.ts`                    | `cli/commands/policy.ts`         | `registerPolicyCommand(program)`         | WIRED   | Import line 43; call line 164                                        |

---

### Data-Flow Trace (Level 4)

| Artifact          | Data Variable  | Source                                       | Produces Real Data | Status     |
|-------------------|----------------|----------------------------------------------|--------------------|------------|
| `engine.ts`       | `decision`     | `this.evaluator.evaluate(debounced)` → `PolicyEvaluator` with compiled rules | Yes — evaluator injected from `bootEvaluator` which came from `loadPolicies(policyContent)` in daemon.ts | FLOWING    |
| `engine.ts`       | `payloadStr`   | `decision.payload` — Handlebars template rendered against event | Yes — Handlebars `rule.template({ event })` at evaluator.ts line 136 | FLOWING    |
| `policy.ts` CLI   | `rows`         | `db.prepare(...).all(sinceEpoch)` on read-only SQLite | Yes — live SQL query on trigger_events table | FLOWING    |
| `policy-watcher.ts` | `currentEvaluator` | New `PolicyEvaluator(newRules, ...)` on reload | Yes — rebuilt from freshly parsed policies.yaml on each file change | FLOWING    |

---

### Behavioral Spot-Checks

| Behavior                                              | Command                                                                  | Result      | Status |
|-------------------------------------------------------|--------------------------------------------------------------------------|-------------|--------|
| 174 tests across 11 test files pass                   | `npx vitest run src/triggers/__tests__/ src/cli/commands/__tests__/policy.test.ts` | 174 passed, 0 failed | PASS   |
| No type errors in phase 62 source files               | `npx tsc --noEmit` filtered to phase 62 files                            | 0 errors    | PASS   |
| `handlebars` dependency installed in package.json     | `grep "handlebars" package.json`                                         | `"handlebars": "^4.7.9"` | PASS   |
| `registerPolicyCommand` registered in CLI index       | `grep -c "registerPolicyCommand" src/cli/index.ts`                       | 2 (import + call) | PASS   |
| `policyWatcher.stop` called in daemon shutdown        | `grep "policyWatcher.stop" src/manager/daemon.ts`                        | Line 1190   | PASS   |

Note: Pre-existing type errors exist in unrelated files (`src/manager/daemon.ts` lines 616, 2310; `src/tasks/task-manager.ts`; `src/triggers/__tests__/engine.test.ts`; etc.). None are in phase 62 code.

---

### Requirements Coverage

| Requirement | Source Plan | Description                                                                    | Status    | Evidence                                                                                  |
|-------------|-------------|--------------------------------------------------------------------------------|-----------|-------------------------------------------------------------------------------------------|
| POL-01      | 62-01, 62-02 | Trigger-to-agent rules in declarative YAML, Zod-validated at daemon start, errors reject atomically | SATISFIED | `PolicyFileSchema` validates YAML; daemon.ts throws `ManagerError` on invalid policy before engine boot; `PolicyWatcher.start()` throws on invalid file |
| POL-02      | 62-01       | Policy DSL: source match, agent target, payload template (Handlebars), throttle/debounce, priority, enabled flag | SATISFIED | `PolicyEvaluator.evaluate()`: glob source match, configuredAgents check, TokenBucket throttle, priority sort, enabled filter, Handlebars rendering |
| POL-03      | 62-02       | Hot-reload — editing policy file takes effect on next trigger evaluation without daemon restart | SATISFIED | `PolicyWatcher` uses chokidar with debounce; `onReload` → `triggerEngine.reloadEvaluator(newEvaluator)`; JSONL audit trail |
| POL-04      | 62-03       | Dry-run mode — replay recent trigger events against pending policy change, see which agents would fire | SATISFIED | `clawcode policy dry-run --since 1h`; reads trigger_events from read-only SQLite; evaluates each event; table + JSON output; no daemon needed |

No orphaned requirements. All 4 POL requirements are covered by the plans.

---

### Anti-Patterns Found

No anti-patterns found. Scanned all 8 phase-62 source files for TODO/FIXME/placeholder/stub patterns, empty return values, and hardcoded-empty data that would flow to rendering. None detected.

---

### Human Verification Required

None. All observable behaviors are verifiable programmatically given the test coverage (174 tests) and key-link verification.

The following items would benefit from human spot-check if desired, though they are not blockers:

1. **ANSI color rendering in terminal** — `formatDryRunTable()` includes ANSI escape codes for green/red. Tests verify the codes are present but actual terminal rendering requires visual inspection.
   - Expected: "allow" rows appear green, "deny"/"no match" rows appear red in a terminal.

2. **Hot-reload timing under rapid saves** — debounce at 500ms. Tests cover the logic but real chokidar file-system event behavior varies by OS.

---

### Gaps Summary

No gaps. All 12 must-have truths verified. All 10 artifacts exist and are substantive. All 11 key links are wired. Data flows through all 4 level-4 traced paths. 174 tests pass with zero failures. POL-01 through POL-04 all satisfied.

---

_Verified: 2026-04-17T18:50:00Z_
_Verifier: Claude (gsd-verifier)_
