---
phase: 104-daemon-op-secret-cache-and-retry-backoff
verified: 2026-04-30T16:00:00Z
status: passed
score: 7/7 must-haves (SEC-01..SEC-07 all satisfied)
re_verification: false
---

# Phase 104: Daemon op:// Secret Cache + Retry/Backoff — Verification Report

**Phase Goal:** Resolve all `op://` references in clawcode.yaml once at daemon boot into an in-memory map, inject literal values into agent envs at spawn so restarts re-use the cache without re-hitting the 1Password API. Add exponential backoff (1s/2s/4s, 3 attempts) on `op read` failures so transient rate-limits do not crash-fail an agent.

**Verified:** 2026-04-30T16:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All three op:// resolution sites (Discord botToken, shared mcpServers[].env, per-agent mcpEnvOverrides) route through one SecretsResolver singleton | VERIFIED | `grep "new SecretsResolver(" daemon.ts` = 1; `grep "execSync.*op read" daemon.ts` = 0; CALL-01 callsites grep test green |
| 2 | Resolved values are cached in-memory keyed on verbatim op:// URI; cache hit on repeated resolve(uri) | VERIFIED | `secrets-resolver.ts:84` Map<string,string> + inflight Map; RES-01 + RES-02 green (63/63 tests pass) |
| 3 | op read failures retry with exponential backoff (3 attempts, 1s/2s/4s + jitter); rate-limit bails early after attempt 2 | VERIFIED | p-retry@8.0.0 wired with `randomize: true`; RES-03 (retry succeeds), RES-04 (rate-limit bails early ≤2 calls), RES-05 (empty AbortError) all green |
| 4 | Boot-time pre-resolution runs in parallel via Promise.allSettled; partial failures are logged but daemon continues (fail-open) | VERIFIED | `daemon.ts:1533-1552` constructs resolver, calls `preResolveAll`, logs per-URI failures, continues; BOOT-DEGRADED-01 green |
| 5 | Cache invalidation wired into ConfigWatcher so editing clawcode.yaml to change an op:// URI causes old URI to be invalidated and new URI warm-resolved | VERIFIED | `secrets-watcher-bridge.ts` exports `applySecretsDiff`; `daemon.ts:3875` calls it inside `onChange`; WATCH-01..05 (5 tests) all green |
| 6 | IPC method `secrets-status` returns counter snapshot; `secrets-invalidate` flushes one or all cache entries | VERIFIED | `protocol.ts:243-244` registers both methods; `secrets-ipc-handler.ts` exports handler fns; `daemon.ts:3591-3595` dispatch; IPC-SECSTATUS-01..04 green |
| 7 | No resolved secret value appears in any pino log call, error message, or IPC response — only the op:// URI | VERIFIED | All log calls in secrets-resolver.ts use only: `uri`, `attempt`, `retriesLeft`, `reason`, `isRateLimit`, `cacheSize`, `size` fields. RES-08 (no-leak sentinel test) green. IPC response schema carries counters and ISO 8601 timestamps only — no value fields. |

**Score:** 7/7 truths verified

---

## Required Artifacts

| Artifact | Expected | Exists | Lines | Status |
|----------|----------|--------|-------|--------|
| `src/manager/secrets-resolver.ts` | SecretsResolver class with resolve/getCached/preResolveAll/invalidate/invalidateAll/snapshot | YES | 243 | VERIFIED |
| `src/manager/secrets-collector.ts` | collectAllOpRefs(config) — 3-zone walker with Set dedup | YES | 85 | VERIFIED |
| `src/manager/secrets-watcher-bridge.ts` | applySecretsDiff helper — diff-walking cache invalidation | YES | 74 | VERIFIED |
| `src/manager/secrets-ipc-handler.ts` | handleSecretsStatus + handleSecretsInvalidate — pure IPC handler | YES | 84 | VERIFIED |
| `src/manager/daemon.ts` | Single SecretsResolver construction + 3 callsite rewrites + IPC dispatch | YES | — | VERIFIED |
| `src/ipc/protocol.ts` | secrets-status + secrets-invalidate in IPC_METHODS + 3 zod schemas | YES | — | VERIFIED |
| `src/manager/recovery/op-refresh.ts` | deps.invalidate?.(ref) before deps.opRead(ref) | YES | — | VERIFIED |
| `src/manager/recovery/types.ts` | optional invalidate?: (ref: string) => void on RecoveryDeps | YES | — | VERIFIED |
| `src/heartbeat/types.ts` | secretsResolver?: SecretsResolver on CheckContext | YES | — | VERIFIED |
| `src/heartbeat/runner.ts` | setSecretsResolver setter | YES | — | VERIFIED |
| `src/heartbeat/checks/mcp-reconnect.ts` | Wires ctx.secretsResolver.invalidate into RecoveryDeps | YES | — | VERIFIED |
| `src/manager/__tests__/secrets-resolver.test.ts` | 9 real tests RES-01..RES-09 (no it.todo remaining) | YES | 301 | VERIFIED |
| `src/manager/__tests__/secrets-collector.test.ts` | 7 real tests COLL-01..COLL-07 | YES | 152 | VERIFIED |
| `src/manager/__tests__/secrets-resolver-callsites.test.ts` | CALL-01 callsites grep test | YES | 94 | VERIFIED |
| `src/manager/__tests__/secrets-resolver-watcher.test.ts` | WATCH-01..05 (5 real tests) | YES | 184 | VERIFIED |
| `src/manager/__tests__/daemon-boot-secrets-degraded.test.ts` | BOOT-DEGRADED-01 real test | YES | 116 | VERIFIED |
| `src/manager/__tests__/recovery-op-refresh.test.ts` | REC-OP-REFRESH-INV-01 + INV-02 added (existing tests preserved) | YES | 153 | VERIFIED |
| `src/ipc/__tests__/secrets-status.test.ts` | IPC-SECSTATUS-01..04 (4 real tests) | YES | 131 | VERIFIED |
| `package.json` | p-retry@^8.0.0 in dependencies | YES | — | VERIFIED |
| `node_modules/p-retry` | ESM module, version 8.0.0 | YES | — | VERIFIED |

---

## Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `package.json dependencies."p-retry"` | `node_modules/p-retry` (v8.0.0, type: module) | npm install | WIRED |
| `secrets-resolver.ts` | `p-retry` (pRetry + AbortError) | `import pRetry, { AbortError } from "p-retry"` line 34 | WIRED |
| `daemon.ts startDaemon` | `SecretsResolver` singleton | `new SecretsResolver({opRead: defaultOpReadShellOut, log: log.child({subsystem:"secrets"})})` at line 1533 | WIRED |
| `daemon.ts startDaemon` | `collectAllOpRefs(config)` | import at line 34 + call at line 1537 | WIRED |
| `daemon.ts startDaemon` | `secretsResolver.preResolveAll(allOpRefs)` | await call at line 1539 | WIRED |
| `daemon.ts cachedOpRefResolver` | `secretsResolver.getCached(uri)` | sync wrapper at line 1562 | WIRED |
| `daemon.ts per-agent opEnvResolver` | `secretsResolver.resolve(uri)` | closure at line 1722 | WIRED |
| `daemon.ts Discord botToken block` | `await secretsResolver.resolve(raw)` | line 3618 (replaces former inline execSync) | WIRED |
| `daemon.ts ConfigWatcher.onChange` | `applySecretsDiff(diff, secretsResolver, log)` | import at line 35 + call at line 3875 | WIRED |
| `daemon.ts IPC dispatch` | `handleSecretsStatus(secretsResolver)` | case "secrets-status" at line 3591-3592 | WIRED |
| `daemon.ts IPC dispatch` | `handleSecretsInvalidate(secretsResolver, params)` | case "secrets-invalidate" at line 3594-3595 | WIRED |
| `daemon.ts` | `heartbeatRunner.setSecretsResolver(secretsResolver)` | line 2402 | WIRED |
| `recovery/op-refresh.ts recover()` | `deps.invalidate?.(ref)` before `deps.opRead(ref)` | optional-chain at line 74, preceding line 75 | WIRED |
| `heartbeat/checks/mcp-reconnect.ts buildRecoveryDepsForHeartbeat` | `ctx.secretsResolver.invalidate(ref)` | conditional wiring at lines 205-214 | WIRED |

---

## Data-Flow Trace (Level 4)

Not applicable — the new modules are not data-rendering components. `SecretsResolver` is an in-memory cache that produces string values passed directly to child process envs; `secrets-ipc-handler.ts` returns counter objects (integers + timestamps, not dynamic rendered data). No hollow-prop or static-return patterns possible in this domain.

---

## Behavioral Spot-Checks

| Behavior | Command/Check | Result | Status |
|----------|---------------|--------|--------|
| p-retry ESM importable | `node_modules/p-retry/package.json` has `"type": "module"`, version `8.0.0` | PASS | PASS |
| SecretsResolver exports all 6 methods | grep on `resolve\|getCached\|preResolveAll\|invalidate\|invalidateAll\|snapshot` in secrets-resolver.ts | All 6 present | PASS |
| No stray execSync op-read in daemon.ts | `grep "execSync.*op read" daemon.ts` | 0 matches | PASS |
| Cache + inflight Maps present | `grep "private readonly cache = new Map\|private readonly inflight = new Map"` | Both found at lines 84-85 | PASS |
| Randomize: true default (jitter on) | `grep "randomize.*?? true"` | Found at line 150 | PASS |
| invalidate precedes opRead in recovery | `grep -B1 "await deps.opRead(ref)" op-refresh.ts` | `deps.invalidate?.(ref)` immediately preceding | PASS |
| IPC methods registered | `grep '"secrets-status"\|"secrets-invalidate"' protocol.ts` | Lines 243-244 | PASS |
| secretsResolver in daemon return type | `grep "secretsResolver: SecretsResolver" daemon.ts` (return type + return literal) | Present in type at line 1509 and return at line 4096 | PASS |
| Full phase test suite | `npx vitest run` on 8 phase test files | 63/63 tests pass, 0 failed, 0 todo | PASS |

---

## Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| SEC-01 | 00, 02 | All three op:// resolution sites route through one SecretsResolver singleton | SATISFIED | CALL-01 callsites grep test passes; `new SecretsResolver(` appears once in daemon.ts; `execSync.*op read` = 0 in daemon.ts |
| SEC-02 | 00, 01 | Resolved values cached in-memory; restarts re-use cache | SATISFIED | `private readonly cache = new Map<string,string>()` in secrets-resolver.ts; RES-01 (cache hit) + RES-02 (inflight dedup) green |
| SEC-03 | 00, 01 | op read failures retry with exponential backoff; rate-limit bails early | SATISFIED | p-retry@8 wired with 3 retries, 1s/2s/4s + randomize:true; AbortError on rate-limit at attempt>=2; RES-03/04/05 green |
| SEC-04 | 00, 02 | Boot pre-resolution via Promise.allSettled; partial failures logged, daemon continues | SATISFIED | preResolveAll + fail-open loop at daemon.ts:1539-1552; BOOT-DEGRADED-01 green |
| SEC-05 | 03 | Cache invalidation wired into ConfigWatcher (yaml edit) and recovery/op-refresh (auth-error) | SATISFIED | applySecretsDiff in onChange; deps.invalidate?. in op-refresh.ts; WATCH-01..05 + REC-OP-REFRESH-INV-01/02 green |
| SEC-06 | 04 | IPC method `secrets-status` returns counter snapshot; `secrets-invalidate` flushes cache | SATISFIED | Both methods in IPC_METHODS; handler module + daemon dispatch; IPC-SECSTATUS-01..04 green |
| SEC-07 | 00, 01, 04 | No resolved secret value in any log call, error message, or IPC response | SATISFIED | Log fields are only: uri, attempt, retriesLeft, reason, isRateLimit, cacheSize, size. No `value`/`resolved`/`secret`/`token` fields with secret data. RES-08 (pino sink no-leak test) green. IPC schema contains counters + timestamps only. |

---

## Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| None | — | — | No placeholders, TODOs, empty returns, or hardcoded stubs found in the 4 new production modules. All it.todo scaffolds in test files replaced with real tests (1 remaining instance is in a JSDoc comment, not a test stub). |

---

## SEC-07 Deep Scan (Secret Leakage Invariant)

All log calls in secrets-related production files verified:

- `secrets-resolver.ts` log calls: `{uri, cacheSize}` (info: resolved), `{uri, attempt, retriesLeft, reason, isRateLimit}` (warn: failed attempt), `{uri}` (info: invalidated), `{size}` (info: full invalidated) — zero value fields
- `secrets-watcher-bridge.ts` log calls: `{uri, fieldPath, reason}` (warn: warm-resolve failed) — zero value fields
- `recovery/op-refresh.ts`: no new log calls added by this phase
- `secrets-ipc-handler.ts`: no log calls; IPC response contains `cacheSize` (integer count), 4 counter integers, 3 optional ISO 8601 timestamps, 1 optional failure-reason string (operator-controlled CLI error message, not a resolved secret value)

SEC-01 deep scan: `grep -rE "execSync.*op read|spawn\(.*op.*read" src/` excluding `__tests__`, `loader.ts`, `op-env-resolver.ts`, `secrets-resolver.ts` returns zero matches.

---

## Human Verification Required

| Test | What to Do | Expected | Why Human |
|------|-----------|----------|-----------|
| Real 1Password rate-limit recovery | In staging, fire `op read` in a tight loop until rate-limited, observe `secrets-status` IPC counter for `rateLimitHits`, wait for daemon to recover | Daemon continues, rateLimitHits increments, next agent spawn succeeds without error | Requires triggering actual 1P throttle — destructive on prod, impractical to fake locally |
| Boot-storm regression (2026-04-30 incident) | In staging, restart daemon 5 times in 60 seconds with all 14 agents enabled | Only one `op read` per unique URI in pino logs; no agent failed to start; `secrets-status` shows `hits >> misses` after 3rd restart | Reproducing the 14-agent × crash-loop pattern is destructive and cannot be safely faked |

---

## Gaps Summary

No gaps found. All 7 SEC-* requirements are observably satisfied in the codebase:

- All production modules exist and are substantive (243/85/74/84 lines respectively)
- All test scaffolds replaced with real passing tests (63/63 pass across 8 files)
- All key wiring links verified by direct code inspection
- SEC-01 callsites invariant verified by the grep test itself
- SEC-07 leakage invariant verified by RES-08 pino-sink test plus manual field-name scan
- No stray it.todo stubs remain in any test file (one false positive in a JSDoc comment)
- p-retry@8.0.0 installed, ESM-typed, used via import in secrets-resolver.ts

The phase fully achieves its goal: `op://` references are resolved once at boot, cached, injected into agent envs at spawn, and `op read` failures retry with exponential backoff + jitter before surfacing to the operator.

---

_Verified: 2026-04-30T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
