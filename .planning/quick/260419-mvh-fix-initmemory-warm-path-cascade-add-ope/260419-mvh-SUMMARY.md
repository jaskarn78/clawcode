---
phase: 260419-mvh
plan: 01
type: quick
subsystem: openai-endpoint + session-manager
tags: [observability, resilience, fail-fast, jsonl, cli, tdd]
requires: []
provides:
  - QUICK-MVH-01  # initMemory→warm-path cascade closed
  - QUICK-MVH-02  # OpenAI JSONL request logging + CLI tail
tech-stack:
  added: []
  patterns:
    - "Fail-fast + silent-swallow two-guard pattern (try/catch around initMemory + !memoryStores.has post-check)"
    - "Synchronous fs.appendFileSync for low-throughput observability feeds — fails silent, rate-limits warns to 1/min"
    - "Mutable record built in route(), emitted once via res.on('close') with logged-bool guard"
    - "Test-injected appender seam for ESM (vitest cannot spyOn fs.appendFileSync exports)"
    - "Commander subcommand deps bag (log/error/exit/now/dir/reader) mirrors openai-key.ts"
key-files:
  created:
    - src/manager/__tests__/session-manager-memory-failure.test.ts
    - src/openai/request-logger.ts
    - src/openai/__tests__/request-logger.test.ts
    - src/cli/commands/openai-log.ts
    - src/cli/commands/__tests__/openai-log.test.ts
  modified:
    - src/manager/session-manager.ts
    - src/openai/server.ts
    - src/openai/__tests__/server.test.ts
    - src/openai/endpoint-bootstrap.ts
    - src/cli/index.ts
    - README.md
decisions:
  - "Bearer prefix is 12 chars, chosen at server runtime — never the SHA-256 hash (already stored in api-keys.db; don't duplicate)"
  - "Two-guard pattern (try/catch + !memoryStores.has) kept separate rather than combined — one is forward-compat, the other handles today's swallow-and-continue reality"
  - "Sync appendFileSync over async queue — at ≤ dozens of req/min the complexity isn't worth the ~500µs per-write savings"
  - "Message bodies stripped by default; opt-in via CLAWCODE_OPENAI_LOG_BODIES env var. Prompts carry PII; secrets-dir-equivalent when enabled"
  - "UTC date in filename, not local — single consistent rollover boundary for operators across timezones"
  - "Commands routed via two atomic commits not one, because the bug fix belongs in history as its own reasoning-trail for future readers"
metrics:
  duration: ~55 min
  tasks: 2
  files_created: 5
  files_modified: 6
  tests_added: 29  # 7 memory-failure + 8 request-logger + 7 openai-log + 7 server (SI-1..SI-7)
  commits: 2
  completed: 2026-04-19
---

# Quick Task 260419-mvh: Fix initMemory→warm-path cascade + OpenAI request logging

Two small, related observability/resilience fixes for the OpenAI endpoint — landed as two atomic commits because they share test infrastructure (vitest + pino harness) and both harden the same daemon lifecycle.

## Summary

**Task 1 — fix(manager):** Per-agent memory-init failure now fails fast with a clean single-line cause, instead of cascading through warm-path and surfacing as a misleading `warmSqliteStores[memories]: no MemoryStore...` wrapper. Registry goes `starting → failed` with the true root cause. Daemon keeps serving other agents. Commit `4d27a45`.

**Task 2 — feat(openai):** Structured JSONL request logging on every `/v1/chat/completions` and `/v1/models` hit, with 12-char bearer-key redaction and opt-in message-body capture. New `clawcode openai-log tail --agent X --since 1h` subcommand for operators. Commit `34dfb83`.

## Commits

| # | SHA | Type | Message |
|---|-----|------|---------|
| 1 | `4d27a45` | `fix(manager)` | fail-fast startAgent on memory init failure (no warm-path cascade) |
| 2 | `34dfb83` | `feat(openai)` | JSONL request logging + clawcode openai-log tail subcommand |

## What Changed

### Task 1 — `startAgent` fail-fast on memory init (session-manager.ts)

Two new guards wrap the initMemory call:

1. **try/catch** — forward-compat: if `AgentMemoryManager.initMemory` ever starts propagating errors (better hygiene), capture the real message in one place.
2. **`!memoryStores.has(name)`** — today's silent-swallow path. `initMemory` logs ERROR but does NOT throw (session-memory.ts:125), leaving no MemoryStore behind. Before this guard the cascade continued into warm-path which THEN threw `warmSqliteStores: no MemoryStore for agent 'X'` — hiding the real root cause.

On either failure: registry flips to `failed` with a single-line `lastError`, the warm-path check + createSession + downstream maps are ALL skipped, and `startAgent` resolves cleanly so the daemon keeps the other agents up (same contract as warm-path failure).

### Task 2 — OpenAI request-logger module + server/CLI wiring

**New `src/openai/request-logger.ts` (~130 LOC):**
- `RequestLogRecord`: `request_id`, `timestamp_iso`, `method`, `path`, `agent`, `model`, `stream`, `status_code`, `ttfb_ms`, `total_ms`, `bearer_key_prefix`, `messages_count`, `response_bytes`, `error_type`, `error_code`, `finish_reason`.
- Sync `appendFileSync` writes — fail silent on fs errors, rate-limit warns to 1/min.
- Bearer prefix = first 12 chars of raw key. Full key NEVER reaches disk.
- Message bodies stripped by default; opt-in via `CLAWCODE_OPENAI_LOG_BODIES=true`.
- UTC date filename: `openai-requests-YYYY-MM-DD.jsonl`.
- Injected `appender` param for tests (ESM-safe — vitest can't spyOn fs exports).

**Server wiring (`src/openai/server.ts`):**
- New `OpenAiServerConfig.requestLogger?` field (optional — hermetic tests stay hermetic).
- `route()` builds a mutable record at entry; handlers stamp fields as they make progress.
- `res.on('close')` emits exactly ONE record per request, guarded by a `logged` bool.
- `runStreaming` records `ttfb_ms` on first chunk, accumulates `response_bytes`.
- `runNonStreaming` records `finish_reason` (`tool_calls` vs `stop`) and `response_bytes`.

**Endpoint bootstrap (`src/openai/endpoint-bootstrap.ts`):**
- Builds default logger at `CLAWCODE_OPENAI_LOG_DIR ?? managerDir`.
- Honors `CLAWCODE_OPENAI_LOG_BODIES`.
- Closes logger in graceful-shutdown path after `apiKeysStore.close()`.

**CLI (`src/cli/commands/openai-log.ts`):**
- `clawcode openai-log tail --agent <name> --since <duration> [--json]`
- Duration parser accepts `30m` / `1h` / `24h` / `7d`.
- Reads multi-day window (`--since 48h` reads today + yesterday's file).
- Table output mirrors `openai-key list`: padded columns + `-` divider between header and data.
- `--json` emits raw JSON lines (jq-friendly).
- Invalid `--since` → error + exit 1.

**README:** New "Request logging" section under OpenAI-Compatible Endpoint. Documents env vars, PII warning on `CLAWCODE_OPENAI_LOG_BODIES`, 12-char bearer prefix contract.

## Verification (matches acceptance criteria)

| Check | Result |
|-------|--------|
| Task 1 verify: `npx vitest run session-manager-memory-failure.test.ts session-manager.test.ts` | PASS (7 + 27 = 34 tests green) |
| Task 2 verify: `npx vitest run request-logger.test.ts server.test.ts openai-log.test.ts` | PASS (8 + 44 + 7 = 59 tests green) |
| `npx tsx src/cli/index.ts openai-log tail --help` | PASS — usage printed |
| `npx tsc --noEmit` | 29 errors — baseline unchanged |
| `npm run build` | PASS — `dist/cli/index.js` 1001.88 KB |
| Zero new npm deps | PASS (package.json not modified) |

## Deviations from Plan

**None materially.** Two small adjustments during implementation:

### Adjustment 1: Injected `appender` seam in request-logger

**Why:** The plan specified `vi.spyOn(fs, 'appendFileSync').mockImplementation(...)` for RL-5. Vitest cannot spy on ESM-module exports (`Cannot spy on export "appendFileSync". Module namespace is not configurable in ESM.`). Rather than work around with `vi.mock` at module scope (overkill for one test), I added an `appender?: (path, data) => void` field to `CreateRequestLoggerOpts`. Production uses `appendFileSync` via closure; tests inject a throwing stub. Documented inline as the ESM-safe alternative.

### Adjustment 2: Added Test 7 to memory-failure suite

**Why:** The plan's Tests 1-6 all stub initMemory to THROW. But `AgentMemoryManager.initMemory` today DOES NOT THROW — it catches-and-logs (session-memory.ts:125-130), leaving no MemoryStore behind. Without a test for that silent-swallow path, the second guard (`!memoryStores.has`) would be unexercised. Added Test 7 to pin that today's reality is also caught by the fix.

## Known Stubs

None. All new code is wired end-to-end:
- `src/openai/server.ts` honors `requestLogger` when provided.
- `src/openai/endpoint-bootstrap.ts` constructs the default logger at daemon boot.
- `src/cli/commands/openai-log.ts` is registered in `src/cli/index.ts:177`.

## Security Posture

Audited against `~/.claude/rules/security.md`:

- **No hardcoded secrets.** Bearer prefix is sliced from the live incoming key at request time (server.ts), NOT embedded anywhere.
- **Inputs validated.** `--since` parses via `parseDurationMs`; unparseable → error + exit 1. Invalid dates in JSONL are silently skipped (partial-write resilience).
- **Error messages don't leak sensitive data.** The pino warn on fs failure includes the dir (a project path, not secret) and the fs error message. No record contents (which carry bearer_key_prefix) land in warn logs.
- **PII capture is OPT-IN.** `CLAWCODE_OPENAI_LOG_BODIES=true` captures full message bodies. README and env docs warn operators explicitly that the logs dir is then a secrets directory and should be locked down.
- **Redaction is enforced by the writer, not the caller.** `redact()` runs inside `createRequestLogger.log()` before every `appendFileSync` — callers can't accidentally bypass it.

## Coding-Style Adherence

- **Immutability:** `redact()` returns a NEW object via destructure+spread. No in-place mutation of `RequestLogRecord`. `MutableLogRecord` in server.ts is explicitly typed distinct from the public immutable `RequestLogRecord` and only lives inside the route closure.
- **Small files:** request-logger.ts ~130 LOC, openai-log.ts ~230 LOC, both well under the 400-line guideline.
- **Error handling:** Every fs call is try/wrapped. `logger.log()` never re-throws — tests assert this.
- **No deep nesting:** `log()` is 3 levels max.

## Self-Check: PASSED

- [x] src/manager/__tests__/session-manager-memory-failure.test.ts — FOUND
- [x] src/manager/session-manager.ts (modified) — FOUND
- [x] src/openai/request-logger.ts — FOUND
- [x] src/openai/__tests__/request-logger.test.ts — FOUND
- [x] src/openai/server.ts (modified) — FOUND
- [x] src/openai/__tests__/server.test.ts (modified) — FOUND
- [x] src/openai/endpoint-bootstrap.ts (modified) — FOUND
- [x] src/cli/commands/openai-log.ts — FOUND
- [x] src/cli/commands/__tests__/openai-log.test.ts — FOUND
- [x] src/cli/index.ts (modified) — FOUND
- [x] README.md (modified) — FOUND
- [x] Commit `4d27a45` (Task 1) — FOUND on master
- [x] Commit `34dfb83` (Task 2) — FOUND on master

## Follow-ups (non-blocking)

- **fin-test on clawdy** will pick up both commits on next deploy. The warm-path fix eliminates the misleading `warmSqliteStores[memories]` wrapper; operators will see the actual SQLite/perms error from now on. The request-log feed writes to `~/.clawcode/manager/openai-requests-YYYY-MM-DD.jsonl` by default — smoke with `clawcode openai-log tail --agent <name> --since 10m` after redeploy.
- **Log rotation is operator's responsibility** — the module only writes JSONL. Standard `logrotate` rules against `~/.clawcode/manager/openai-requests-*.jsonl` work unchanged (no open FD held; sync writes close after each append).
- **Alternative backend (async queue / compression) can be added later** — the `RequestLogger` interface is stable and `close()` is already async-ready.
