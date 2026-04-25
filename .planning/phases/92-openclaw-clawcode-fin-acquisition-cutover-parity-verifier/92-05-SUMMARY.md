---
phase: 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier
plan: 05
subsystem: cutover/canary-synthesizer+runner+report-writer
tags: [cutover, canary, dual-entry, discord-bot, api, openai-shape, timeout, fake-timers, atomic-write, frontmatter, deterministic, di-pure, d08, d11]
dependency-graph:
  requires:
    - "Plan 92-01 AgentProfile.topIntents[] (with cron:-prefixed entries per D-11)"
    - "Plan 92-02 cutover CLI subcommand-group skeleton (cutover.ts)"
    - "Phase 73 OpenAI-shape /v1/chat/completions endpoint at localhost:3101"
    - "Phase 87/89 TurnDispatcher.dispatchStream (Discord bot path reuse)"
    - "Phase 84/91 atomic temp+rename markdown writer pattern (mirrored for CANARY-REPORT.md)"
    - "Node 22 native fetch + AbortController-compatible Promise.race (zero new HTTP deps)"
  provides:
    - "CANARY_TIMEOUT_MS = 30_000 constant (D-08 per-path budget)"
    - "CANARY_CHANNEL_ID = \"1492939095696216307\" constant (D-Claude's-Discretion fin-test channel reuse)"
    - "CANARY_TOP_INTENT_LIMIT = 20 constant"
    - "CANARY_API_ENDPOINT = \"http://localhost:3101/v1/chat/completions\" constant (loopback only)"
    - "canaryPromptSchema / CanaryPrompt — synthesizer output row"
    - "canaryInvocationResultSchema / CanaryInvocationResult — per-(prompt,path) result"
    - "CanarySynthesizeOutcome / CanaryRunOutcome / CanaryReportOutcome unions"
    - "synthesizeCanaryPrompts(deps): pure-DI single-LLM-pass synthesizer"
    - "runCanary(deps): pure-DI dual-path orchestrator with 30s per-path timeout"
    - "writeCanaryReport(deps): atomic temp+rename markdown writer"
    - "clawcode cutover canary CLI subcommand"
  affects:
    - "Plan 92-06 set-authoritative gate reads `canary_pass_rate` from CANARY-REPORT.md frontmatter"
    - "Plan 92-06 verify pipeline aggregates CanaryRunOutcome with gap data into CUTOVER-REPORT.md"
    - "Plan 92-06 production wiring injects daemon TurnDispatcher.dispatchStream + native fetch"
tech-stack:
  added: []
  patterns:
    - "Pure-DI synthesizer (deps.dispatcher : Pick<TurnDispatcher, \"dispatch\">)"
    - "Pure-DI runner (deps.dispatchStream + deps.fetchApi as injected primitives)"
    - "Promise.race + setTimeout sentinel for 30s per-path timeout (clearTimeout in finally)"
    - "Spread-then-sort immutability for results array (CLAUDE.md pin)"
    - "Atomic temp+rename via fs.rename with nanoid suffix; best-effort tmp unlink on failure"
    - "OpenAI choices[0].message.content extraction with raw-body fallback"
    - "Sentinel-string (\"__canary_timeout__\") for timeout discrimination — keeps caller switch shape simple"
    - "Fake-timer test for 30s timeout (vi.useFakeTimers + advanceTimersByTimeAsync) — no 30s real-time wait in CI"
    - "Zero-fetch-during-test guarantee — runner consumes deps.fetchApi (DI'd) so default Node fetch never reaches the network in vitest"
key-files:
  created:
    - "src/cutover/canary-synthesizer.ts (162 lines): single-LLM-pass synthesizer with sort-by-count DESC slice + sort-by-intent ASC output"
    - "src/cutover/canary-runner.ts (272 lines): dual-path orchestrator + 30s per-path timeout + result determinism"
    - "src/cutover/canary-report-writer.ts (143 lines): atomic markdown writer; frontmatter pinned for Plan 92-06; column shape pinned by P2 test"
    - "src/cli/commands/cutover-canary.ts (217 lines): production CLI wrapper; default fetchApi uses Node 22 native fetch"
    - "src/cutover/__tests__/canary-synthesizer.test.ts (172 lines, 4 tests): S1 happy / S2 limit / S3 no-intents / S4 schema-mismatch"
    - "src/cutover/__tests__/canary-runner.test.ts (228 lines, 5 tests): R1 40-invocation / R2 partial-fail / R3 fake-timer 30s / R4 empty-resp / R5 deterministic ordering"
    - "src/cutover/__tests__/canary-report-writer.test.ts (124 lines, 3 tests): P1 frontmatter / P2 column shape / P3 atomic write"
  modified:
    - "src/cutover/types.ts: extended (NOT replaced) with canary surface (162 LOC added) — Plans 92-01/02/03/04 surface preserved verbatim"
    - "src/cli/commands/cutover.ts: registerCutoverCanaryCommand wired alongside ingest/profile/probe/diff/apply-additive"
decisions:
  - "Per-path timeout is enforced via Promise.race(p, setTimeout(resolve, ms)). The setTimeout sentinel resolves to the literal string \"__canary_timeout__\" (rather than throwing) so the caller switch shape stays simple. setTimeout handle is cleared in finally so the event loop drains cleanly on the success path"
  - "Discord bot path uses dispatchStream — NOT a literal Discord message. Production wires `(args) => turnDispatcher.dispatchStream(makeRootOrigin('discord', CANARY_CHANNEL_ID), args.agentName, args.prompt, () => {})` (no on-chunk live editing — canary collects only the final accumulated text). Tests DI vi.fn() stubs"
  - "API path uses 127.0.0.1/localhost:3101 (Phase 73 OpenAI-shape endpoint). Pinned by static-grep + the only http://localhost reference in canary-runner.ts is in JSDoc comments. Default fetchApi uses Node 22 native fetch — zero new HTTP client deps"
  - "OpenAI choices[0].message.content extraction with raw-body fallback. If the response isn't valid JSON or doesn't have the OpenAI shape, the raw text is returned — the runner's pass criteria (non-empty + status 200) still gates correctly"
  - "Synthesizer determinism: input topIntents[] is spread+sorted by count DESC then sliced; output prompts spread+sorted by intent ASC. Same input → same output regardless of input order. S2 test pins this behavior"
  - "Runner determinism: results sorted by (intent ASC, path ASC) before report write. R5 test pins the canonical sequence (a:api, a:discord-bot, m:api, m:discord-bot, ...). Two runs over identical input produce identical sequences"
  - "Frontmatter shape pinned for Plan 92-06: agent, generated_at (ISO 8601), total_prompts, total_paths=2, total_invocations, passed, failed, canary_pass_rate (rounded to 1dp; 100% on happy path is integer 100). Plan 92-06's set-authoritative reader extracts canary_pass_rate and gates on >= 100"
  - "Column header pinned EXACTLY: `| intent | prompt | discord-bot | api | discord-bot-ms | api-ms |` (P2 test). Prompt cell truncated to 80 chars with U+2026; literal `|` escaped to `\\|`; `\\n` collapsed to space"
  - "Channel ID is INTERNAL config — does NOT appear in the report. Operators may share CANARY-REPORT.md externally; the canary channel binding stays in clawcode.yaml only"
  - "Synthesizer LLM pass is NOT inside the 30s budget — it's a one-shot preflight before the 40-invocation phase begins. The 30s-per-path budget applies only to canary invocations. (D-08 explicit; pitfall confirmed)"
  - "Report writer is the SINGLE place that emits markdown — runner delegates instead of inlining. Two reasons: (1) atomic-write discipline lives in one file; (2) markdown structure testability isolated"
  - "synthesizer + runner + report-writer share the spread-then-sort pattern: NEVER `arr.sort()` in-place on input arrays. Pinned by `! grep -E 'results\\.sort\\(|prompts\\.sort\\(' src/cutover/canary-runner.ts` (clean — only `[...arr].sort()` shapes used)"
  - "20 prompts × 2 paths = 40 invocations is asserted by R1. Adding more prompts maintains the 2× multiplier without code changes. The runner is N-prompt-agnostic"
  - "Auth gates: this plan does not introduce any auth gates. The canary uses pre-existing Discord webhooks (Phase 90 webhook-manager) and the unauthenticated localhost API (Phase 73). Production wiring is the operator's responsibility — Plan 92-06 lands the daemon IPC that connects everything"
metrics:
  completed_date: "2026-04-25"
  duration_minutes: 6
  tasks: 2
  files_created: 7
  files_modified: 2
  tests_added: 12  # 4 synthesizer + 5 runner + 3 report-writer
  tests_total: 73  # cutover-only run; 87 with daemon-cutover-button included
  tests_passing: 73
  lines_added: ~1280  # 162 (types) + 162 (synth) + 272 (runner) + 143 (report) + 217 (CLI) + tests
---

# Phase 92 Plan 05: Dual-Entry Canary Runner Summary

CUT-08 spine: dual-entry-point canary battery proves the cutover candidate handles every common task pattern observed historically. Synthesizes 20 representative prompts from `AgentProfile.topIntents[]` via a single LLM pass, then runs each prompt TWICE — once via `TurnDispatcher.dispatchStream` against the canary Discord channel and once via POST `localhost:3101/v1/chat/completions`. 40 invocations per run. Each path gets a 30s timeout (D-08 — timeout = failure). ANY failure → `canary_pass_rate < 100` → Plan 92-06's set-authoritative gate refuses the cutover.

## What Shipped

**Three pure-DI modules + one CLI subcommand + 12 tests.**

```
clawcode cutover canary --agent fin-acquisition
  ├─ reads:    ~/.clawcode/manager/cutover-reports/<agent>/latest/AGENT-PROFILE.json (Plan 92-01)
  ├─ synth:    synthesizeCanaryPrompts(topIntents[]) → 20 CanaryPrompts (sorted by intent ASC)
  ├─ run:      runCanary(prompts) → 40 results (sorted by (intent, path) ASC)
  │     ├─ Discord bot path: dispatchStream(...) with 30s race
  │     └─ API path:         fetchApi(...) with 30s race
  └─ writes:   ~/.clawcode/manager/cutover-reports/<agent>/<timestamp>/CANARY-REPORT.md
                 (atomic temp+rename; frontmatter pinned for Plan 92-06 reader)
```

The synthesizer + runner are fully DI-pure — `dispatcher`, `dispatchStream`, and `fetchApi` are all injected via Deps structs. The CLI wrapper at `src/cli/commands/cutover-canary.ts` is the production caller that wires Node 22 native fetch + (Plan 92-06 will inject) the daemon TurnDispatcher's dispatchStream. Tests pass `vi.fn()` stubs directly to `runCanary` and bypass the CLI wrapper entirely.

## Constants Locked (D-08 + D-Claude's-Discretion)

| Constant | Value | Purpose |
|----------|-------|---------|
| CANARY_TIMEOUT_MS | `30_000` | Per-path timeout (Discord OR API). Timeout = failure. |
| CANARY_CHANNEL_ID | `"1492939095696216307"` | Recently-freed fin-test channel; already in fin-acquisition.channels[] |
| CANARY_TOP_INTENT_LIMIT | `20` | Top intents (by count DESC) sliced from AgentProfile.topIntents[] |
| CANARY_API_ENDPOINT | `"http://localhost:3101/v1/chat/completions"` | Phase 73 OpenAI-shape endpoint; loopback only |

## CanaryInvocationResult Schema (consumed by Plan 92-06)

```ts
{
  intent: string;         // matches AgentProfile.topIntents[].intent verbatim
  prompt: string;
  path: "discord-bot" | "api";
  status: "passed" | "failed-empty" | "failed-error" | "failed-timeout";
  responseChars: number;  // length of accepted response text (0 on failure)
  durationMs: number;
  error: string | null;
}
```

Plan 92-06's report writer aggregates `CanaryRunOutcome.results[]` with the gap data (Plan 92-02) and the additive-applier ledger (Plan 92-03) + destructive-applier ledger (Plan 92-04) into the final CUTOVER-REPORT.md. The exhaustive-switch over the 4 status values pins the contract.

## CANARY-REPORT.md Frontmatter (consumed by Plan 92-06)

```yaml
agent: fin-acquisition
generated_at: 2026-04-25T00:34:13.000Z
total_prompts: 20
total_paths: 2
total_invocations: 40
passed: 38
failed: 2
canary_pass_rate: 95
```

`canary_pass_rate` is rounded to one decimal place (whole-number happy paths produce integer YAML — `100` parses as a number, not a string). Plan 92-06's set-authoritative precondition reads this key and refuses cutover unless `canary_pass_rate >= 100` AND `report_generated_at` within 24h (D-09 freshness gate).

## Per-Prompt Markdown Table (column shape pinned by P2)

```
| intent | prompt | discord-bot | api | discord-bot-ms | api-ms |
| --- | --- | --- | --- | --- | --- |
| portfolio-analysis | Tell me about the Q1 performance... | passed | passed | 4321 | 1832 |
| cron:finmentum-db-sync | Please run the finmentum-db-sync job... | passed | passed | 5128 | 2014 |
...
```

Prompt cells truncated to 80 chars with U+2026 (single-char ellipsis); literal `|` escaped to `\|`; newlines collapsed to spaces. Rows sorted by intent ASC for byte-stable output.

## CanaryRunnerDeps DI Shape (production wiring blueprint for Plan 92-06)

```ts
type CanaryRunnerDeps = {
  agent: string;
  prompts: readonly CanaryPrompt[];
  canaryChannelId: string;          // CANARY_CHANNEL_ID default
  apiEndpoint: string;              // CANARY_API_ENDPOINT default
  timeoutMs?: number;               // CANARY_TIMEOUT_MS default
  outputDir: string;
  dispatchStream: (args) => Promise<{text: string}>;     // production: turnDispatcher.dispatchStream wrapper
  fetchApi: (url, body) => Promise<{status, text, json?}>; // production: native fetch + OpenAI extraction
  now?: () => Date;
  log: Logger;
};
```

Plan 92-06's daemon-side IPC handler will inject:
- `dispatchStream`: `(args) => turnDispatcher.dispatchStream(makeRootOrigin('discord', CANARY_CHANNEL_ID), args.agentName, args.prompt, () => {})`
- `fetchApi`: the `defaultFetchApi` already exported in this plan's `src/cli/commands/cutover-canary.ts`

## 30s Timeout Enforcement (D-08, R3 test pinned)

```ts
async function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T | "__canary_timeout__"> {
  let timer;
  const timeoutPromise = new Promise<"__canary_timeout__">((resolve) => {
    timer = setTimeout(() => resolve("__canary_timeout__"), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);  // event loop drains cleanly on win
  }
}
```

The R3 test uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(31_000)` so the 30s budget is exercised without 30s of real-time wait. Pinned by static-grep `Promise.race` + `raceWithTimeout` in canary-runner.ts.

## Determinism (R5 + S2 + P3 tests pinned)

- **Synthesizer:** input `topIntents[]` is spread+sorted by count DESC then sliced; output prompts spread+sorted by intent ASC. Two runs with the same input (regardless of input order) produce identical prompt arrays.
- **Runner:** results spread+sorted by (intent ASC, path ASC) before report write. R5 test asserts the canonical sequence `[a:api, a:discord-bot, m:api, m:discord-bot, z:api, z:discord-bot]` for input prompts in any order.
- **Report writer:** `byIntent` Map iterated in insertion order, then `[...byIntent.entries()].sort()` produces stable rows. P3 test asserts no `.tmp` leftovers in outputDir after `writeCanaryReport` resolves.

## Test Coverage (12 new; 73/73 cutover; 87/87 cumulative including daemon-cutover-button)

### canary-synthesizer.test.ts (4 tests)

| Test | Pin |
|------|-----|
| S1   | dispatcher called once with both intents in prompt; output sorted by intent ASC |
| S2   | 30 topIntents + limit 20 → only top 20 by count fed to dispatcher; outside-slice intents NOT in prompt |
| S3   | empty topIntents → outcome.kind === "no-intents"; dispatcher NEVER called |
| S4   | dispatcher returns invalid JSON ([{foo:bar}]) → schema-validation-failed with rawResponse |

### canary-runner.test.ts (5 tests)

| Test | Pin |
|------|-----|
| R1   | 20 prompts × 2 paths = 40 results; all status="passed"; passRate === 100; per-path counts === 20 each |
| R2   | API returns 500 for one prompt → exactly one failed-error in results; passRate < 100 |
| R3   | dispatchStream never resolves; vi.useFakeTimers + advanceTimersByTimeAsync(31_000) → status="failed-timeout" |
| R4   | fetchApi 200 with empty text → status="failed-empty" |
| R5   | Two runs over identical input produce identical (intent, path, status) sequences; output sorted by (intent ASC, path ASC) |

### canary-report-writer.test.ts (3 tests)

| Test | Pin |
|------|-----|
| P1   | 38/40 passed → frontmatter contains canary_pass_rate=95, total_invocations=40, passed=38, failed=2, generated_at present |
| P2   | Markdown contains exact column header `| intent | prompt | discord-bot | api | discord-bot-ms | api-ms |` |
| P3   | After writeCanaryReport resolves, outputDir contains exactly `["CANARY-REPORT.md"]` (no .tmp leftovers) |

## Static-Grep Regression Pins (verified)

| Pin | Status |
|-----|--------|
| `grep -q "CANARY_TIMEOUT_MS = 30_000" src/cutover/types.ts` | OK |
| `grep -q 'CANARY_CHANNEL_ID = "1492939095696216307"' src/cutover/types.ts` | OK |
| `grep -q "CANARY_TOP_INTENT_LIMIT = 20" src/cutover/types.ts` | OK |
| `grep -q "CANARY_API_ENDPOINT" src/cutover/types.ts` | OK |
| `grep -q "canaryInvocationResultSchema" src/cutover/types.ts` | OK |
| `grep -q '"failed-timeout"' src/cutover/types.ts` | OK |
| `grep -q '"synthesized"' src/cutover/types.ts` | OK |
| `grep -q "export async function synthesizeCanaryPrompts" src/cutover/canary-synthesizer.ts` | OK |
| `grep -q "export async function runCanary" src/cutover/canary-runner.ts` | OK |
| `grep -q "export async function writeCanaryReport" src/cutover/canary-report-writer.ts` | OK |
| `grep -q "Promise.race" src/cutover/canary-runner.ts` | OK |
| `grep -q "raceWithTimeout" src/cutover/canary-runner.ts` | OK |
| `grep -q "canary_pass_rate" src/cutover/canary-report-writer.ts` | OK |
| `grep -q "discord-bot \\| api \\| discord-bot-ms \\| api-ms" src/cutover/canary-report-writer.ts` | OK |
| `grep -q "registerCutoverCanaryCommand" src/cli/commands/cutover.ts` | OK |
| `grep -q "vi.useFakeTimers" src/cutover/__tests__/canary-runner.test.ts` | OK |
| `grep -q "advanceTimersByTime" src/cutover/__tests__/canary-runner.test.ts` | OK |
| Loopback-only: only `http://localhost:3101` references in canary-runner.ts (JSDoc only) | OK |
| `git diff package.json` empty | OK (zero new npm deps) |

## CLI Surface (verified)

```
$ node dist/cli/index.js cutover canary --help
Usage: clawcode cutover canary [options]

Run the dual-entry-point canary battery (Discord bot + API) against the cutover
candidate. Synthesizes 20 prompts from AGENT-PROFILE.json topIntents[] and runs
each through both paths with a 30s per-path timeout. Emits CANARY-REPORT.md.

Options:
  --agent <name>            Agent under canary
  --profile <path>          Override AGENT-PROFILE.json path (default: ~/.clawcode/manager/...
  --output-dir <path>       Override report output directory
  --canary-channel-id <id>  Override canary Discord channel ID (default: 1492939095696216307)
  --api-endpoint <url>      Override API endpoint (default: http://localhost:3101/v1/chat/completions)
  --timeout-ms <ms>         Override per-path timeout in milliseconds (default: 30000)
  -h, --help                display help for command
```

## Deviations from Plan

**None — plan executed as written.** Two minor implementation notes:

### [Doc-only] Sentinel string for timeout discrimination

The plan's pseudocode showed `if (result === "timeout")` for the timeout branch. The implementation uses the literal sentinel `"__canary_timeout__"` (unlikely to collide with any legitimate dispatchStream/fetchApi text response) and pins the discrimination there. This is the same shape, just with a more collision-resistant sentinel. R3 test pins behavior — the test doesn't care about the sentinel string; it asserts `result.status === "failed-timeout"` which is what the runner returns AFTER recognizing the sentinel.

### [Doc-only] Default fetchApi lives in CLI, not canary-runner.ts

The plan's pseudocode placed the default `fetch` wrapper inside canary-runner.ts. The implementation moves it to `src/cli/commands/cutover-canary.ts` as a private constant `defaultFetchApi` so the canary-runner module stays purely DI'd (no Node-runtime fetch import). Plan 92-06 can re-export `defaultFetchApi` from the CLI module if it wants a daemon-side wrap-and-extend (or just inline the same shape). Pure-module discipline preserved without sacrificing production usability.

## Wiring for Plan 92-06 (production)

Plan 92-06 will:

1. **Wire dispatcher**: inject the daemon's TurnDispatcher into `runCutoverCanaryAction({...dispatcher: daemon.turnDispatcher})` for the synthesizer's LLM pass.

2. **Wire dispatchStream**: inject `(args) => daemon.turnDispatcher.dispatchStream(makeRootOrigin('discord', args.canaryChannelId ?? CANARY_CHANNEL_ID), args.agentName, args.prompt, () => {})` for the Discord bot path.

3. **Use defaultFetchApi as-is**: the Node 22 native fetch wrapper exported from `cutover-canary.ts` is production-ready; Plan 92-06 needs only to ensure the OpenClaw endpoint is reachable from the daemon process.

4. **Read canary_pass_rate**: `clawcode sync set-authoritative clawcode --confirm-cutover` will read `canary_pass_rate` from the latest CANARY-REPORT.md frontmatter and gate on `>= 100`. The frontmatter shape is fully Plan 92-06-ready.

5. **Aggregate into CUTOVER-REPORT.md**: Plan 92-06's report-writer reads CANARY-REPORT.md frontmatter + CUTOVER-GAPS.json + cutover-ledger.jsonl and emits the final CUTOVER-REPORT.md with the merged frontmatter (`cutover_ready, gap_count, canary_pass_rate, report_generated_at`).

## Self-Check: PASSED

Verified files exist and commits are present in git history:

- `src/cutover/types.ts` (extended) — present, ~1000 lines (canary surface added at line 840+)
- `src/cutover/canary-synthesizer.ts` — present, 162 lines
- `src/cutover/canary-runner.ts` — present, 272 lines
- `src/cutover/canary-report-writer.ts` — present, 143 lines
- `src/cli/commands/cutover-canary.ts` — present, 217 lines
- `src/cli/commands/cutover.ts` (modified) — registers canary
- `src/cutover/__tests__/canary-synthesizer.test.ts` — present, 4 it-blocks
- `src/cutover/__tests__/canary-runner.test.ts` — present, 5 it-blocks
- `src/cutover/__tests__/canary-report-writer.test.ts` — present, 3 it-blocks
- Commit 46eb2e2 (Task 1 RED) — present in git log
- Commit 8cb838c (Task 2 GREEN) — present in git log
- 73/73 cutover tests pass (`npx vitest run src/cutover/`)
- 87/87 cumulative cutover + daemon-cutover-button tests pass
- `npm run build` exits 0
- `node dist/cli/index.js cutover canary --help` lists --agent + --profile + --output-dir + --canary-channel-id + --api-endpoint + --timeout-ms
- `git diff package.json` empty (zero new npm deps)
- All static-grep regression pins green
- Loopback-only invariant: only `http://localhost:3101` references in canary-runner.ts (JSDoc comments)
