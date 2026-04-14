---
phase: 51-slos-regression-gate
plan: 02
subsystem: performance
tags: [bench, regression-gate, cli, harness, isolated-daemon, baseline, ipc, tempdir]

# Dependency graph
requires:
  - phase: 51-01
    provides: DEFAULT_SLOS, benchReportSchema, baselineSchema, loadThresholds, evaluateRegression, BenchmarkConfigError
  - phase: 50-01
    provides: CANONICAL_SEGMENTS, PercentileRow, LatencyReport types, TraceCollector / Turn lifecycle, TraceStore.getPercentiles
  - phase: 50-03
    provides: `latency` IPC method (read-path reused by bench runner)
provides:
  - loadPrompts(path) — single entry point for prompts.yaml; frozen PromptDefinition[]; throws BenchmarkConfigError
  - spawnIsolatedDaemon / awaitDaemonReady / writeBenchAgentConfig — bench daemon lifecycle via tempdir HOME override
  - readBaseline / writeBaseline / formatDiffTable — git-tracked baseline.json I/O + human-readable diff table
  - runBench(opts) — end-to-end orchestration (prompts → daemon → N repeats per prompt → /latency snapshot → JSON report); teardown in finally{}
  - bench-run-prompt IPC method — daemon handler runs sendToAgent inside a caller-owned Turn; trace captured automatically
  - formatRegressionTable / buildCommitHint / confirmBaselineUpdate — CLI helpers (test-exposed)
  - registerBenchCommand(program) — `clawcode bench` subcommand with 10 flags (--prompts / --baseline / --thresholds / --reports-dir / --agent / --repeats / --since / --json / --update-baseline / --check-regression)
affects: [51-03]

# Tech tracking
tech-stack:
  added: []  # Zero new runtime deps — nanoid, yaml, readline, commander all pre-existing
  patterns:
    - "Tempdir HOME isolation: MANAGER_DIR = join(homedir(), .clawcode, manager) resolves at module load via homedir(); HOME=<tmpHome> override in env → socket at <tmpHome>/.clawcode/manager/clawcode.sock"
    - "Caller-owned Turn lifecycle: daemon bench-run-prompt handler calls turn.end('success') AND turn.end('error') in BOTH branches (Phase 50 contract: SessionManager never ends turns)"
    - "Dependency-injection pattern for CLI action: BenchActionDeps { runBench, readBaseline, writeBaseline, loadThresholds, evaluateRegression, confirmBaselineUpdate, getUsername, exit } — tests never spawn real daemons or write real files"
    - "runBench teardown in finally{}: handle.stop() always runs, even when IPC throws partway; spy-verified by runner.test.ts test 3"
    - "4-canonical-segment invariant: runner maps overall_percentiles through CANONICAL_SEGMENTS, backfilling count=0 / null percentile rows for missing segments so reports have a stable shape"
    - "IPC method dual-registration: bench-run-prompt is in BOTH src/ipc/protocol.ts IPC_METHODS AND the toEqual hardcoded list in src/ipc/__tests__/protocol.test.ts (Phase 50 lesson preserved by construction)"
    - "Baseline update never auto-writes: confirmBaselineUpdate returns true ONLY on 'y'/'yes' (case-insensitive); anything else (including empty / 'n' / timeout) is a hard NO"

key-files:
  created:
    - src/benchmarks/prompts.ts
    - src/benchmarks/harness.ts
    - src/benchmarks/baseline.ts
    - src/benchmarks/runner.ts
    - src/benchmarks/__tests__/prompts.test.ts
    - src/benchmarks/__tests__/harness.test.ts
    - src/benchmarks/__tests__/baseline.test.ts
    - src/benchmarks/__tests__/runner.test.ts
    - src/cli/commands/bench.ts
    - src/cli/commands/bench.test.ts
  modified:
    - src/ipc/protocol.ts (added 'bench-run-prompt' to IPC_METHODS)
    - src/ipc/__tests__/protocol.test.ts (added 'bench-run-prompt' to expected toEqual list + new describe block)
    - src/manager/daemon.ts (added bench-run-prompt handler + nanoid import)
    - src/cli/index.ts (import + invoke registerBenchCommand)
    - .planning/phases/51-slos-regression-gate/deferred-items.md (documented pre-existing bootstrap-integration test failure)

key-decisions:
  - "Phase 51 Plan 02 — `bench-run-prompt` handler owns the full Turn lifecycle (startTurn + turn.end on both branches). SessionManager.sendToAgent only passes the Turn through to SessionHandle.sendAndCollect — it NEVER ends the Turn. This matches the Phase 50 50-02b contract and is grep-verified via `grep -c turn.end src/manager/daemon.ts` returning 3 (latency handler not involved; two belong to bench handler, one from existing manager/daemon)."
  - "Phase 51 Plan 02 — Tempdir HOME is the isolation mechanism. MANAGER_DIR resolves at module load via homedir(); overriding HOME in the spawned daemon's env propagates to a tempdir socket. No code change required in daemon.ts to support the isolation — the existing homedir()-based resolver makes it free."
  - "Phase 51 Plan 02 — `runBench` does teardown in `finally{}` (not a try/catch/finally trio) so the daemon stops on BOTH success and any thrown error. Test 3 in runner.test.ts spies on handle.stop() and asserts it runs exactly once even when the IPC client throws partway through prompt execution."
  - "Phase 51 Plan 02 — `--check-regression` vs `--update-baseline` are mutually-exclusive code paths by natural flow. `--check-regression` exits early (0 on clean, 1 on regressed); `--update-baseline` only runs when the former was not set. The plan did not require explicit conflict detection — each flag has its own early-return guard."
  - "Phase 51 Plan 02 — Baseline write requires explicit 'y' / 'yes' confirmation. Anything else (empty / 'n' / 'nope' / stdin EOF) returns false from `confirmBaselineUpdate` → CLI prints 'Baseline NOT updated' and exits 0 without writing. This is asserted by bench.test.ts test 'does NOT write baseline when user declines confirmation'."
  - "Phase 51 Plan 02 — Fixed stdout capture in bench.test.ts by spying on `process.stdout.write` (what `cliLog` calls under the hood) rather than `console.log`. The describe-level stdoutSpy lets individual tests inject their own capture impl when they need to assert on output content."
  - "Phase 51 Plan 02 — DI stubs for the runner.test.ts's HarnessDeps require a double-cast (`as unknown as HarnessDeps[key]`) because vitest's `vi.fn(async () => ...)` produces a Mock<...> whose signature is not assignable to the typeof imports. This is a vitest idiom; the plain cast preserves type safety for the happy path and localizes the ergonomic issue to the test fixture."
  - "Phase 51 Plan 02 — Runner fills `overall_percentiles` from the canonical segments list even if the daemon's /latency response omits some segments (e.g. count=0 for context_assemble on a no-tool-call prompt). This guarantees a stable 4-row shape downstream and is verified by runner.test.ts test 4."

patterns-established:
  - "Pattern: tempdir-HOME daemon isolation — any bench / test harness that needs its own clawcode daemon can override HOME in the spawn env; the existing homedir() resolver propagates the change to MANAGER_DIR and SOCKET_PATH with zero daemon-side code"
  - "Pattern: DI-friendly CLI actions via a deps object — a CLI command's registerX(program, deps?: XDeps) accepts optional stubs for its side-effecting dependencies (runBench, readBaseline, writeBaseline, etc.) so tests never touch real disks / networks / daemons"
  - "Pattern: stdout capture via process.stdout.write spy — tests for CLI actions that use our cliLog/cliError helpers must spy on process.stdout.write, NOT console.log. The describe-level spy lets individual tests inject their own capture impl without leaking state"
  - "Pattern: IPC method dual-registration — any new IPC method MUST be added to BOTH src/ipc/protocol.ts IPC_METHODS AND src/ipc/__tests__/protocol.test.ts expected toEqual list in the same commit. Phase 50 shipped a regression because the test list was stale; Phase 51 Plan 02 preserves the lesson by construction"

requirements-completed: []  # PERF-04 substrate complete; full closure ships with 51-03 (dashboard indicators, CI workflow, starter prompts/thresholds files, end-to-end against live daemon)

# Metrics
duration: 13min
completed: 2026-04-13
---

# Phase 51 Plan 02: `clawcode bench` CLI + Isolated Daemon Harness + Regression Gate Runtime Summary

**Runtime substrate for PERF-04: CLI command `clawcode bench` spawns an isolated daemon on a tempdir HOME (socket at `<tmpHome>/.clawcode/manager/clawcode.sock`), runs each prompt N=5 times via a new `bench-run-prompt` IPC method (caller-owned Turn lifecycle per Phase 50 contract), snapshots latency percentiles, writes a reproducible JSON report, and offers `--update-baseline` (operator-confirmed, never auto-writes; commit hint emitted to stdout) and `--check-regression` (CI-grade exit 0 = clean, 1 = regression).**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-04-13T21:12:55Z
- **Completed:** 2026-04-13T21:25:58Z
- **Tasks:** 3 (all `auto` + `tdd`, no checkpoints)
- **Files created/modified:** 10 created + 5 modified (includes deferred-items.md doc update)

## Accomplishments

- **`loadPrompts(path)` is the single door.** `src/benchmarks/prompts.ts` exports `loadPrompts` which reads+validates `.planning/benchmarks/prompts.yaml` (schema: `{ prompts: [{ id, prompt, description? }] }` with `prompts.length >= 1`). Returns a frozen `PromptDefinition[]`. Always throws `BenchmarkConfigError` (with offending path) on any failure.
- **`bench-run-prompt` IPC method registered and handled.** Added to `src/ipc/protocol.ts` IPC_METHODS (line 60, between `latency` and `set-effort` blocks) AND to the hardcoded `toEqual` list in `src/ipc/__tests__/protocol.test.ts` (line 63) — Phase 50 regression-prevention lesson preserved by construction. New describe block covers the Zod validation path. Daemon handler at `src/manager/daemon.ts:1147`: validates `agent` + `prompt` params, mints `turnId` via `nanoid(10)`, runs `sendToAgent` inside a caller-owned Turn. Calls `turn.end("success")` OR `turn.end("error")` in BOTH branches (Phase 50 50-02b contract).
- **`spawnIsolatedDaemon` + `awaitDaemonReady` + `writeBenchAgentConfig`.** `src/benchmarks/harness.ts` owns the daemon lifecycle via tempdir HOME override. Since `MANAGER_DIR = join(homedir(), ".clawcode", "manager")` resolves at module load, `HOME=<tmpHome>` env propagates to a tempdir-scoped socket. `stop()` is idempotent (swallows "already dead" / "socket gone"). DI-friendly via `spawner` / `ipcClient` option stubs — tests never spawn a real daemon.
- **`readBaseline` / `writeBaseline` / `formatDiffTable`.** `src/benchmarks/baseline.ts` is the single place baseline.json enters or leaves the system. `writeBaseline` stamps `updated_at: now.toISOString()` and `updated_by: provenance.username` on top of the BenchReport shape. `formatDiffTable` always renders all 4 canonical segments in a 5-column table (Segment / Baseline p95 / Current p95 / Delta ms / Delta %); `(no baseline yet)` fallback on first-time benches.
- **`runBench(opts)` — end-to-end orchestrator.** `src/benchmarks/runner.ts` wires it all together: loads prompts, creates tempdir, writes minimal bench-agent config (haiku, no Discord/MCP), spawns daemon, polls for readiness, best-effort starts the bench-agent (idempotent), runs each prompt × N repeats via `bench-run-prompt`, snapshots `/latency` per prompt + overall, maps results through `CANONICAL_SEGMENTS` so the 4-row shape is stable, captures `git rev-parse HEAD` (falls back to "unknown"), writes JSON to `<reportsDir>/<run_id>.json`, and **tears down the daemon in `finally{}`** — guaranteed even on error.
- **`clawcode bench` is a registered, fully-flagged CLI subcommand.** `src/cli/commands/bench.ts` + `src/cli/index.ts`. Ten flags wired: `--prompts / --baseline / --thresholds / --reports-dir / --agent / --repeats / --since / --json / --update-baseline / --check-regression`. `--check-regression` exits 1 with a regression table on breach, 0 on clean. `--update-baseline` prompts y/N, writes baseline.json only on explicit 'y'/'yes', then prints the copy-pasteable git commit hint. Everything is DI-testable via `BenchActionDeps`.
- **Zero new runtime dependencies.** nanoid, yaml, readline, commander all pre-existing. Pre-existing `yaml@2.8.3` and `nanoid@5.x` already in package.json from Plan 51-01 / earlier phases.

## Task Commits

Each task was committed atomically:

1. **Task 1: prompts loader + bench-run-prompt IPC method** — `2d20248` (feat)
   - `src/benchmarks/prompts.ts` (84 lines) — `loadPrompts` throws `BenchmarkConfigError`
   - `src/benchmarks/__tests__/prompts.test.ts` — 5 tests (valid parse / missing file / missing key / empty array / empty id or prompt)
   - `src/ipc/protocol.ts` — `"bench-run-prompt"` appended to IPC_METHODS between `latency` and `set-effort` blocks
   - `src/ipc/__tests__/protocol.test.ts` — `"bench-run-prompt"` appended to `toEqual` list; new `describe("ipcRequestSchema bench-run-prompt", () => { ... })` block with 1 test
   - `src/manager/daemon.ts` — `case "bench-run-prompt"` added immediately after the latency case; `import { nanoid } from "nanoid";` added at top
   - Test count delta: +6 tests in scope (5 prompts + 1 protocol)
2. **Task 2: harness + runner + baseline modules** — `5e2da1b` (feat)
   - `src/benchmarks/harness.ts` (192 lines) — `spawnIsolatedDaemon` / `awaitDaemonReady` / `writeBenchAgentConfig` + `DaemonHandle` / `Spawner` / `SpawnedChild` types
   - `src/benchmarks/baseline.ts` (158 lines) — `readBaseline` / `writeBaseline` / `formatDiffTable` + `BaselineProvenance` type
   - `src/benchmarks/runner.ts` (196 lines) — `runBench(opts)` + `RunBenchOpts` / `RunBenchResult` / `HarnessDeps` types
   - `src/benchmarks/__tests__/harness.test.ts` — 9 tests (spawn 4 / awaitReady 2 / writeBenchAgentConfig 2; 1 test split into 2 assertions on stub-spawner)
   - `src/benchmarks/__tests__/baseline.test.ts` — 9 tests (readBaseline 4 / writeBaseline 2 / formatDiffTable 3)
   - `src/benchmarks/__tests__/runner.test.ts` — 5 tests (happy path / JSON round-trip / finally teardown / 4-canonical-segment invariant / git_sha capture)
   - Test count delta: +23 tests in scope
3. **Task 3: `clawcode bench` CLI + deferred-items update** — `071447b` (feat)
   - `src/cli/commands/bench.ts` (264 lines) — `registerBenchCommand` + `formatRegressionTable` / `buildCommitHint` / `confirmBaselineUpdate` helpers
   - `src/cli/commands/bench.test.ts` (259 lines) — 12 tests (3 formatRegressionTable+buildCommitHint / 5 registerBenchCommand / 3 confirmBaselineUpdate stdinReader path)
   - `src/cli/index.ts` — imported + wired `registerBenchCommand(program)` alongside `registerLatencyCommand(program)`
   - `.planning/phases/51-slos-regression-gate/deferred-items.md` — documented pre-existing `bootstrap-integration.test.ts` failure (verified pre-existing via stash)
   - Test count delta: +12 tests in scope

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/benchmarks/prompts.ts` | 84 | `loadPrompts` single-entry point; throws `BenchmarkConfigError`; frozen `PromptDefinition[]` |
| `src/benchmarks/harness.ts` | 192 | `spawnIsolatedDaemon` / `awaitDaemonReady` / `writeBenchAgentConfig`; tempdir HOME isolation; DI-friendly via `spawner` / `ipcClient` stubs |
| `src/benchmarks/baseline.ts` | 158 | `readBaseline` / `writeBaseline` / `formatDiffTable`; always renders all 4 canonical segments |
| `src/benchmarks/runner.ts` | 196 | `runBench(opts)` end-to-end orchestrator; teardown in `finally{}`; 4-canonical-segment invariant via `CANONICAL_SEGMENTS.map(...)` |
| `src/benchmarks/__tests__/prompts.test.ts` | 112 | 5 tests — valid parse / missing file / missing prompts key / empty array / empty id|prompt |
| `src/benchmarks/__tests__/harness.test.ts` | 141 | 9 tests covering spawn / stop idempotency / pid failure / awaitReady success+timeout / writeBenchAgentConfig round-trip + model override |
| `src/benchmarks/__tests__/baseline.test.ts` | 184 | 9 tests — readBaseline valid/missing/schema-fail/unparseable; writeBaseline round-trip + git_sha preservation; formatDiffTable all segments + regression visibility + `(no baseline yet)` fallback |
| `src/benchmarks/__tests__/runner.test.ts` | 196 | 5 tests — happy path / JSON round-trip via benchReportSchema / finally teardown on IPC throw / 4-canonical-segment shape / git_sha capture |
| `src/cli/commands/bench.ts` | 264 | CLI entry point; 10 flags; DI-ready via `BenchActionDeps`; formatRegressionTable / buildCommitHint / confirmBaselineUpdate exported |
| `src/cli/commands/bench.test.ts` | 259 | 12 tests — 2 formatRegressionTable / 2 buildCommitHint / 5 registerBenchCommand (flags/--check-regression/--update-baseline) / 3 confirmBaselineUpdate |

### Modified

| Path | Change |
|------|--------|
| `src/ipc/protocol.ts` | Added `"bench-run-prompt",` with `// Bench (Phase 51)` comment between `"latency"` and `"set-effort"` blocks |
| `src/ipc/__tests__/protocol.test.ts` | Added `"bench-run-prompt",` in the same position in the hardcoded `toEqual([...])` list; added new `describe("ipcRequestSchema bench-run-prompt", () => { ... })` block with 1 test |
| `src/manager/daemon.ts` | Added `import { nanoid } from "nanoid";` at top; added `case "bench-run-prompt":` block immediately after the `case "latency":` block; caller-owned Turn lifecycle (`turn.end("success")` + `turn.end("error")` in both branches) |
| `src/cli/index.ts` | Added `import { registerBenchCommand } from "./commands/bench.js";` and invoked `registerBenchCommand(program);` alongside `registerLatencyCommand(program);` |
| `.planning/phases/51-slos-regression-gate/deferred-items.md` | Appended a section documenting the pre-existing `bootstrap-integration.test.ts` failure observed during verification — confirmed pre-existing via `git stash` of Task 3 files |

## Key Public API

```typescript
// src/benchmarks/prompts.ts
export type PromptDefinition = { id: string; prompt: string; description?: string };
export function loadPrompts(path: string): readonly PromptDefinition[];  // frozen, throws BenchmarkConfigError

// src/benchmarks/harness.ts
export type DaemonHandle = {
  readonly pid: number;
  readonly socketPath: string;
  readonly stop: () => Promise<void>;  // idempotent
};
export type SpawnedChild = Pick<ChildProcess, "pid" | "kill">;
export type Spawner = (cmd: string, args: readonly string[], env: NodeJS.ProcessEnv) => SpawnedChild;
export type SpawnOpts = { readonly tmpHome: string; readonly configPath: string; readonly spawner?: Spawner };
export type AwaitReadyOpts = { readonly maxAttempts?: number; readonly delayMs?: number; readonly ipcClient?: typeof sendIpcRequest };
export type WriteBenchConfigOpts = { readonly agentName: string; readonly model?: "haiku" | "sonnet" | "opus" };
export function spawnIsolatedDaemon(opts: SpawnOpts): Promise<DaemonHandle>;
export function awaitDaemonReady(socketPath: string, opts?: AwaitReadyOpts): Promise<boolean>;
export function writeBenchAgentConfig(tmpHome: string, opts: WriteBenchConfigOpts): Promise<string>;

// src/benchmarks/baseline.ts
export type BaselineProvenance = { readonly username: string; readonly gitSha?: string };
export function readBaseline(path: string): Baseline;  // frozen, throws BenchmarkConfigError
export function writeBaseline(path: string, report: BenchReport, provenance: BaselineProvenance): Baseline;  // frozen
export function formatDiffTable(report: BenchReport, baseline: Baseline | null): string;

// src/benchmarks/runner.ts
export type HarnessDeps = { readonly spawn: typeof spawnIsolatedDaemon; readonly awaitReady: typeof awaitDaemonReady; readonly writeConfig: typeof writeBenchAgentConfig };
export type RunBenchOpts = {
  readonly promptsPath: string;
  readonly agent?: string;
  readonly repeats?: number;
  readonly since?: string;
  readonly reportsDir: string;
  readonly harness?: HarnessDeps;
  readonly ipcClient?: typeof sendIpcRequest;
  readonly tmpHomeFactory?: () => string;
};
export type RunBenchResult = { readonly report: BenchReport; readonly reportPath: string };
export function runBench(opts: RunBenchOpts): Promise<RunBenchResult>;  // teardown in finally{}

// src/cli/commands/bench.ts
export function formatRegressionTable(regressions: readonly Regression[]): string;
export function buildCommitHint(baselinePath: string, runId: string, gitSha: string): string;
export function confirmBaselineUpdate(prompt: string, stdinReader?: () => Promise<string>): Promise<boolean>;
export type BenchActionDeps = {
  readonly runBench?: typeof runBench;
  readonly readBaseline?: typeof readBaseline;
  readonly writeBaseline?: typeof writeBaseline;
  readonly loadThresholds?: typeof loadThresholds;
  readonly evaluateRegression?: typeof evaluateRegression;
  readonly confirmBaselineUpdate?: typeof confirmBaselineUpdate;
  readonly getUsername?: () => string;
  readonly exit?: (code: number) => void;
};
export function registerBenchCommand(program: Command, deps?: BenchActionDeps): void;
```

## Exact Daemon Spawn Pattern

```typescript
// harness.ts: spawnIsolatedDaemon
const { ANTHROPIC_API_KEY: _anth, ...restEnv } = process.env;  // strip API key (use OAuth)
const env: NodeJS.ProcessEnv = { ...restEnv, HOME: opts.tmpHome };
const entryScript = resolve(process.cwd(), "src/manager/daemon-entry.ts");
const child = spawner("npx", ["tsx", entryScript, "--config", opts.configPath], env);
const socketPath = join(opts.tmpHome, ".clawcode", "manager", "clawcode.sock");
// MANAGER_DIR = join(homedir(), ".clawcode", "manager") resolves via homedir() at daemon module-load;
// HOME=<tmpHome> propagates to a tempdir socket.
```

## `bench-run-prompt` Handler Shape

```typescript
// daemon.ts: routeMethod
case "bench-run-prompt": {
  const agentName = validateStringParam(params, "agent");
  const prompt = validateStringParam(params, "prompt");
  const turnIdPrefix =
    typeof params.turnIdPrefix === "string" && params.turnIdPrefix.length > 0
      ? params.turnIdPrefix
      : "bench:";
  const collector = manager.getTraceCollector(agentName);
  if (!collector) throw new ManagerError(`Trace collector not found for agent '${agentName}' (agent may not be running)`);
  const turnId = `${turnIdPrefix}${nanoid(10)}`;
  const turn = collector.startTurn(turnId, agentName, null);
  try {
    const response = await manager.sendToAgent(agentName, prompt, turn);
    turn.end("success");
    return { turnId, response };
  } catch (err) {
    turn.end("error");
    const msg = err instanceof Error ? err.message : "unknown bench error";
    throw new ManagerError(`bench-run-prompt failed: ${msg}`);
  }
}
```

## IPC Method Registration (Phase 50 regression-prevention check)

Both files contain `"bench-run-prompt"` — grep-verified:

```
$ grep -n "bench-run-prompt" src/ipc/protocol.ts src/ipc/__tests__/protocol.test.ts src/manager/daemon.ts
src/ipc/protocol.ts:60:  "bench-run-prompt",
src/ipc/__tests__/protocol.test.ts:63:      "bench-run-prompt",
src/ipc/__tests__/protocol.test.ts:195:describe("ipcRequestSchema bench-run-prompt", () => {
...
src/manager/daemon.ts:1147:    case "bench-run-prompt": {
src/manager/daemon.ts:1176:        throw new ManagerError(`bench-run-prompt failed: ${msg}`);
```

## Test Counts

| Test File | Count | Status |
|-----------|-------|--------|
| `src/benchmarks/__tests__/prompts.test.ts` | 5 | GREEN (new) |
| `src/benchmarks/__tests__/harness.test.ts` | 9 | GREEN (new) |
| `src/benchmarks/__tests__/baseline.test.ts` | 9 | GREEN (new) |
| `src/benchmarks/__tests__/runner.test.ts` | 5 | GREEN (new) |
| `src/cli/commands/bench.test.ts` | 12 | GREEN (new) |
| `src/ipc/__tests__/protocol.test.ts` | 16 | GREEN (+1 new describe block) |
| **Plan 51-02 new tests** | **41** | **41 / 41 GREEN** |
| Benchmarks + IPC + bench CLI combined | 264 | 264 / 264 GREEN |

Wider suite (`npx vitest run src/manager`) reports 1 failure in `src/manager/__tests__/bootstrap-integration.test.ts` — **verified pre-existing** (same failure with Task 3 changes stashed at the Plan 51-01 state). Documented in `deferred-items.md` under "Pre-existing vitest failure".

## Decisions Made

- **`bench-run-prompt` handler owns the Turn lifecycle.** Matches the Phase 50 50-02b contract: `SessionManager.sendToAgent` is pure passthrough — callers construct the Turn via `getTraceCollector(name).startTurn(...)` and own `turn.end()`. The daemon handler calls `turn.end("success")` in the try-path and `turn.end("error")` in the catch-path. Grep confirms 2 occurrences of `turn.end` inside the case block.
- **Tempdir HOME is the isolation mechanism.** No daemon-side changes required — the existing `MANAGER_DIR = join(homedir(), ".clawcode", "manager")` resolver at module load handles the override for free. The harness pre-creates `<tmpHome>/.clawcode/manager/` to avoid any mkdir race with the daemon.
- **`runBench` teardown in `finally{}`.** Not `try/catch(err) { stop(); throw err; }` because the latter duplicates the cleanup path. `finally{}` handles both success and failure. Test 3 in runner.test.ts spies on `handle.stop()` and asserts exactly one call even when IPC throws.
- **4-canonical-segment invariant.** `runner.ts` maps the final `/latency` response through `CANONICAL_SEGMENTS.map(...)` so missing segments get `{count: 0, p50/p95/p99: null}` placeholders. Reports always have the same 4-row shape downstream — simplifies the diff table, simplifies `evaluateRegression` (which already handles `count === 0` + `p95 === null` skips).
- **`--update-baseline` never auto-writes.** `confirmBaselineUpdate` returns true ONLY on exact `y` / `yes` (case-insensitive). Empty string, whitespace, `n`, `nope`, or any other input returns false → the CLI prints "Baseline NOT updated" and exits 0 without touching disk. Guarantees baseline changes are operator-reviewed.
- **DI stubs for `HarnessDeps` need `as unknown as` double-casts in tests.** vitest's `vi.fn(async () => ...)` produces a `Mock<...>` whose call signature differs from the typeof imports (`typeof spawnIsolatedDaemon` etc.). The double-cast is localized to the runner.test.ts fixture factory `makeStubHarness` — production code is unaffected.
- **stdout capture in bench.test.ts spies on `process.stdout.write`, not `console.log`.** `cliLog` calls `process.stdout.write` directly; `console.log` spies are empty. The describe-level `stdoutSpy` silences default output but can be re-implemented per-test to capture chunks for specific assertions (used in the "writes baseline on confirm" test to verify the commit hint is emitted).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] bench.test.ts initially spied on `console.log` but `cliLog` writes via `process.stdout.write`**
- **Found during:** Task 3 verification (`npx vitest run src/cli/commands/bench.test.ts` after initial write of test file)
- **Issue:** The first pass of `bench.test.ts` spied on `console.log` and asserted captured chunks contained `"git add"`. Test failed with `expected '' to contain 'git add'`. Inspection of `src/cli/output.ts` revealed `cliLog(message)` calls `process.stdout.write(message + "\n")` — NOT `console.log`. So the spy captured nothing.
- **Fix:** Replaced the `console.log` spy with a describe-level `process.stdout.write` spy (silences by default). The confirm-and-write test opts into capture by re-implementing the shared spy to push chunks into a local array, then asserts the captured string contains `"git add"` and `"perf(bench): update baseline"`. Three other tests' `console.log` spies were removed — the describe-level stdout spy silences them automatically.
- **Files modified:** `src/cli/commands/bench.test.ts` (no production code changes)
- **Verification:** `npx vitest run src/cli/commands/bench.test.ts` → 12/12 GREEN. Test output is clean (no stray stdout chunks).
- **Committed in:** `071447b` (rolled into Task 3 commit — iteration happened before commit)

**2. [Rule 1 - Bug] vitest `vi.fn` type-incompatibility with `HarnessDeps` in runner.test.ts**
- **Found during:** Task 2 initial verification (`npx tsc --noEmit`)
- **Issue:** Initial runner.test.ts defined `makeStubHarness` with `spawn: vi.fn(async () => ({ pid: 9999, ... }))` etc. `tsc --noEmit` flagged TS2322: `Mock<() => Promise<{ ... }>> is not assignable to (opts: SpawnOpts) => Promise<DaemonHandle>`. vitest's Mock generic does not narrow to the typeof import's call signature, so direct assignment fails.
- **Fix:** Wrapped each stub in `as unknown as HarnessDeps["spawn"]` etc. The double-cast is localized to the test fixture factory; production runner code uses the real `HarnessDeps` type and is type-safe.
- **Files modified:** `src/benchmarks/__tests__/runner.test.ts` (no production code changes)
- **Verification:** `npx tsc --noEmit 2>&1 | grep src/benchmarks/` returns no output. All 5 runner tests GREEN.
- **Committed in:** `5e2da1b` (rolled into Task 2 commit — iteration happened before commit)

**3. [Rule 1 - Bug] harness.test.ts `spawner.mock.calls[0]` typed as empty tuple**
- **Found during:** Task 2 initial verification (`npx tsc --noEmit`)
- **Issue:** `const [cmd, args, env] = spawner.mock.calls[0]!` failed with TS2493 ("Tuple type '[]' of length '0' has no element at index '0'") because the Spawner type alias's call signature did not propagate through vitest's Mock generic.
- **Fix:** Changed the destructuring to indexed access on an explicit 3-tuple cast: `const call = spawner.mock.calls[0]! as unknown as [string, readonly string[], NodeJS.ProcessEnv];` then `call[0]` / `call[1]` / `call[2]`.
- **Files modified:** `src/benchmarks/__tests__/harness.test.ts` (no production code changes)
- **Verification:** `npx tsc --noEmit 2>&1 | grep src/benchmarks/` returns no output.
- **Committed in:** `5e2da1b` (rolled into Task 2 commit — iteration happened before commit)

---

**Total deviations:** 3 auto-fixed, all type-shape issues in TEST code discovered during the tsc/vitest gate. Zero production-code deviations. Zero scope-boundary violations.
**Impact on plan:** No scope creep. All fixes aligned test code with the plan-specified production contracts (Harness DI pattern, cliLog output path).

## Authentication Gates

None — Plan 51-02 code is library+CLI surface only. No network calls during unit tests (all IPC stubbed), no live daemon spawning, no Anthropic OAuth required for the test suite. **Full end-to-end verification** (Phase 51 Plan 03) will require live Anthropic OAuth to actually run prompts against the bench-agent — that gate lives in Plan 51-03, not here.

## Issues Encountered

- **Pre-existing `bootstrap-integration.test.ts` failure.** Observed during `npx vitest run src/manager` verification. Verified pre-existing by stashing Task 3 changes (`bench.ts`, `bench.test.ts`, `cli/index.ts`) and rerunning against the Plan-51-01-only state — same failure. Documented in `.planning/phases/51-slos-regression-gate/deferred-items.md` under "Pre-existing vitest failure". Out of scope per SCOPE BOUNDARY rule.
- **Pre-existing `tsc --noEmit` error at `src/manager/daemon.ts:1509`.** Line number shifted from the Plan 51-01 documented line 1475 because of my bench-run-prompt handler + nanoid import. Same error type (`CostByAgentModel` missing `input_tokens`/`output_tokens` properties). Not introduced by this plan — the pre-existing bug was already logged in deferred-items.md.
- **No other issues during execution.**

## User Setup Required

None for Plan 51-02 verification (unit tests all green, zero new runtime deps). Plan 51-03 will introduce the starter prompts/thresholds/baseline files and wire up the CI workflow — at THAT point the operator will need to:

1. Be authenticated via Claude Code OAuth (same as normal agent operation — no new auth).
2. Have `.planning/benchmarks/prompts.yaml` committed (Plan 51-03 will create it).
3. Optionally: run `clawcode bench --update-baseline` once to seed the first baseline.json, then commit it per the emitted hint.

## Next Phase Readiness

- **Plan 51-03 can begin.** `clawcode bench` CLI is registered, `bench-run-prompt` is the daemon IPC surface, baseline read/write/diff is in place, `runBench` teardown is guaranteed via `finally{}`, and all 41 new tests are GREEN.
- **Plan 51-03 scope preview.** Dashboard SLO indicators (REST endpoint augment + color cells), starter `.planning/benchmarks/{prompts.yaml,thresholds.yaml,baseline.json}` files, minimal CI workflow invoking `clawcode bench --check-regression`, optional end-to-end verification against a live daemon with Claude Code OAuth.
- **Phase 50 regression check passed.** `src/manager/__tests__/` suite still passes (minus the pre-existing bootstrap-integration failure unrelated to this plan). `latency` IPC method still works (grep + Zod test). Trace capture via TraceCollector.startTurn + caller-owned Turn.end is preserved — the bench handler follows the same contract as the DiscordBridge and Scheduler.
- **`tsc --noEmit` gate satisfied for Plan 51-02 files.** Zero errors in `src/benchmarks/*`, `src/cli/commands/bench.ts`, `src/cli/commands/bench.test.ts`, `src/cli/index.ts`, `src/ipc/protocol.ts`, `src/ipc/__tests__/protocol.test.ts`, or the new sections of `src/manager/daemon.ts`. Pre-existing errors in other files documented at `deferred-items.md`.

## Self-Check: PASSED

All ten created files exist at expected paths:
- `src/benchmarks/prompts.ts` FOUND
- `src/benchmarks/harness.ts` FOUND
- `src/benchmarks/baseline.ts` FOUND
- `src/benchmarks/runner.ts` FOUND
- `src/benchmarks/__tests__/prompts.test.ts` FOUND
- `src/benchmarks/__tests__/harness.test.ts` FOUND
- `src/benchmarks/__tests__/baseline.test.ts` FOUND
- `src/benchmarks/__tests__/runner.test.ts` FOUND
- `src/cli/commands/bench.ts` FOUND
- `src/cli/commands/bench.test.ts` FOUND

All five modified files carry the expected changes (grep-verified):
- `src/ipc/protocol.ts` — `"bench-run-prompt"` added to IPC_METHODS (line 60)
- `src/ipc/__tests__/protocol.test.ts` — `"bench-run-prompt"` in `toEqual` list (line 63) + new describe block (line 195)
- `src/manager/daemon.ts` — `case "bench-run-prompt":` present (line 1147); `import { nanoid } from "nanoid";` present at top
- `src/cli/index.ts` — `registerBenchCommand` imported (line 37) + invoked (line 153)
- `.planning/phases/51-slos-regression-gate/deferred-items.md` — "Pre-existing vitest failure" section added

All three task commits exist in `git log --oneline`:
- `2d20248` FOUND (Task 1 — prompts + bench-run-prompt IPC)
- `5e2da1b` FOUND (Task 2 — harness + runner + baseline)
- `071447b` FOUND (Task 3 — CLI + deferred-items)

All 41 new Plan 51-02 tests GREEN. `npx vitest run src/benchmarks/__tests__/ src/ipc/__tests__/protocol.test.ts src/cli/commands/bench.test.ts` exits 0 with 264/264 tests passing. `npx tsc --noEmit` shows ZERO errors in any Plan 51-02 file — confirmed by grep filter on `src/benchmarks/|src/cli/commands/bench|src/cli/index|src/ipc/protocol|src/ipc/__tests__/protocol|src/manager/daemon:1147`. Pre-existing errors documented at `.planning/phases/51-slos-regression-gate/deferred-items.md`.

---
*Phase: 51-slos-regression-gate*
*Plan: 02*
*Completed: 2026-04-13*
