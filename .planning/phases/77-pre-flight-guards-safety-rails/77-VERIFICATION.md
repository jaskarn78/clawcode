---
phase: 77-pre-flight-guards-safety-rails
verified: 2026-04-20T18:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 77: Pre-flight Guards + Safety Rails — Verification Report

**Phase Goal:** User (as operator) can trust that `clawcode migrate openclaw apply` will refuse to run — with a clear actionable error — if any of four safety invariants is violated: (a) OpenClaw daemon is running, (b) a secret-shaped value would be written to `clawcode.yaml`, (c) a Discord channel ID is already bound on an existing ClawCode agent, or (d) the migrator is about to modify any file under `~/.openclaw/`. The ledger JSONL is created and every pre-flight outcome lands in it.
**Verified:** 2026-04-20T18:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `clawcode migrate openclaw apply` subcommand exists and is registered with `--only <name>` flag | VERIFIED | `src/cli/commands/migrate-openclaw.ts` line 369: `.command("apply")`, line 374: `.option("--only <name>")`. CLI smoke test confirms subcommand listed in `--help`. |
| 2 | Daemon guard refuses with exact literal message when `openclaw-gateway.service` is active | VERIFIED | `DAEMON_REFUSE_MESSAGE` at guards.ts:36-37. Exact string: `"OpenClaw daemon is running. Run 'systemctl --user stop openclaw-gateway' first, then re-run the migration."`. Test A in migrate-openclaw.test.ts asserts `toContain(DAEMON_REFUSE_MESSAGE)`. guards.test.ts line 124 asserts `toBe(DAEMON_REFUSE_MESSAGE)`. |
| 3 | Secret guard refuses with exact literal message when a secret-shaped value is present in proposed YAML | VERIFIED | `SECRET_REFUSE_MESSAGE` at guards.ts:38-39. Exact string: `"refused to write raw secret-shaped value to clawcode.yaml — use op:// reference or whitelist the value"`. Test B and guards.test.ts lines 260/273/293 assert exact literal. |
| 4 | Channel collision guard refuses with aligned-column report when a Discord channel is already bound | VERIFIED | `detectChannelCollisions` in guards.ts:377-504. Report format: header `Source agent (OpenClaw) | Target agent (ClawCode) | Channel ID` + footer `Resolution: unbind the OpenClaw side — ClawCode is the migration target.`. Test C in migrate-openclaw.test.ts asserts both header and footer presence. |
| 5 | `assertReadOnlySource` + runtime fs-guard refuse writes under `~/.openclaw/` | VERIFIED | `assertReadOnlySource` in guards.ts:202-208. `installFsGuard/uninstallFsGuard` in fs-guard.ts:141/168. Guards installed in try/finally around `runApplyPreflight` at migrate-openclaw.ts:308/330. 13 fs-guard unit tests all pass. |
| 6 | Guard execution order: daemon → readonly → secret → channel (fail-fast) | VERIFIED | apply-preflight.ts guards run in documented order lines 65-147. `ranGuards` array populated in order. apply-preflight.test.ts line 230 pins canonical order; fail-fast tests at lines 106/131/167 prove short-circuit. |
| 7 | Ledger schema extended additively with optional `step`, `outcome`, `file_hashes` fields; LEDGER_OUTCOMES closed enum | VERIFIED | ledger.ts:55-92. `LEDGER_OUTCOMES = ["allow", "refuse"]` at line 55. `step: z.string().min(1).optional()` line 86, `outcome: z.enum(LEDGER_OUTCOMES).optional()` line 88, `file_hashes: z.record(z.string().min(1), z.string().min(1)).optional()` line 92. 17 ledger tests pass including backward-compat pin. |
| 8 | Every pre-flight guard invocation writes exactly one ledger row; outcome lands in ledger | VERIFIED | apply-preflight.ts has 4 `appendRow` calls (lines 72, 94, 113, 135). Test D asserts 4 rows all `outcome="allow"` on all-pass. apply-preflight.test.ts fail-fast tests assert exact row counts per path. |
| 9 | Source system `~/.openclaw/` mtime is unchanged across all scenarios (static grep + mtime invariant) | VERIFIED | Test G (migrate-openclaw.test.ts:588) snapshots mtime before and after each of 4 scenarios; asserts no change. Test H (line 650) statically greps `src/migration/` excluding `fs-guard.ts` and `guards.ts` and asserts zero literal `~/.openclaw/` in write-context lines. Both tests pass. |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/migration/ledger.ts` | Extended schema with `step`, `outcome`, `file_hashes`, `LEDGER_OUTCOMES` | VERIFIED | 183 lines. All 4 new fields confirmed at lines 55-56, 86-92. |
| `src/migration/guards.ts` | 4 guards + `ReadOnlySourceError` + 3 literal constants + `computeShannonEntropy` | VERIFIED | 505 lines. All exports confirmed: `checkDaemonRunning`, `assertReadOnlySource`, `scanSecrets`, `detectChannelCollisions`, `ReadOnlySourceError`, `computeShannonEntropy`, `DAEMON_REFUSE_MESSAGE`, `SECRET_REFUSE_MESSAGE`, `SYSTEMD_FALLBACK_MESSAGE`. |
| `src/migration/apply-preflight.ts` | `runApplyPreflight` orchestrator with fail-fast 4-guard sequence | VERIFIED | 151 lines. Exports `runApplyPreflight`, `ApplyPreflightArgs`, `ApplyPreflightResult`. 4 `appendRow` calls. Correct guard order. |
| `src/migration/fs-guard.ts` | `installFsGuard` / `uninstallFsGuard` CJS-module patching | VERIFIED | 179 lines. Both exports at lines 141/168. Patches 6 fs entry points (3 async + 3 sync). Idempotent flag at line 99. ESM-scope caveat documented in file header. |
| `src/cli/commands/migrate-openclaw.ts` | `apply` subcommand + `--only` flag + `runApplyAction` + `APPLY_NOT_IMPLEMENTED_MESSAGE` | VERIFIED | 387 lines. `runApplyAction` at line 269 (exported). `APPLY_NOT_IMPLEMENTED_MESSAGE` at line 65 (exported). `apply` commander subcommand at line 369. `--only <name>` at line 374. `installFsGuard/uninstallFsGuard` symmetric in try/finally at 308/330. `CLAWCODE_CONFIG_PATH` env override at line 175. |
| `src/migration/__tests__/guards.test.ts` | 21 unit tests for 4 guards with literal-message assertions | VERIFIED | 21 `it()` blocks confirmed. `toBe(DAEMON_REFUSE_MESSAGE)` at line 124. `toBe(SECRET_REFUSE_MESSAGE)` at lines 260, 273, 293. |
| `src/migration/__tests__/apply-preflight.test.ts` | 7 orchestrator tests: fail-fast ordering, row counts, filter threading | VERIFIED | 7 `it()` blocks confirmed. Fail-fast at lines 106/131/167. Canonical order at line 230. |
| `src/migration/__tests__/fs-guard.test.ts` | 13 unit tests for interceptor install/uninstall + write-rejection | VERIFIED | 13 `it()` blocks confirmed. All 13 tests pass. |
| `src/cli/commands/__tests__/migrate-openclaw.test.ts` | 8 integration tests A-H covering all 5 success criteria | VERIFIED | 8 integration tests A-H present and passing. Test G covers MIGR-07 mtime invariant across 4 scenarios. Test H covers static-grep regression. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cli/commands/migrate-openclaw.ts` | `src/migration/apply-preflight.ts` | `runApplyPreflight` call in apply action | WIRED | Import at line 54; call at line 310. |
| `src/cli/commands/migrate-openclaw.ts` | `src/migration/fs-guard.ts` | `installFsGuard`/`uninstallFsGuard` in try/finally | WIRED | Import at lines 56-58; install at line 308; uninstall at line 330 (finally). |
| `src/migration/apply-preflight.ts` | `src/migration/guards.ts` | 3 guard functions imported + called | WIRED | `checkDaemonRunning`, `scanSecrets`, `detectChannelCollisions` imported at lines 27-30; called at lines 66, 108, 128. |
| `src/migration/apply-preflight.ts` | `src/migration/ledger.ts` | `appendRow` per guard outcome | WIRED | `appendRow` imported at line 25; called 4 times (lines 72, 94, 113, 135). |
| `src/migration/guards.ts` | `node:child_process.execFile` | default `execaRunner` shim for daemon check | WIRED | `execFile` imported at line 24; used in `defaultRunner` at line 95-120; called with `["--user", "is-active", "openclaw-gateway.service"]` at lines 131-135. |
| `src/migration/guards.ts` | `src/migration/ledger.ts` | `LedgerRow` type import | WIRED | `import type { LedgerRow }` at line 28. All guard results carry populated `ledgerRow`. |
| `src/migration/guards.ts` | `src/config/loader.ts` | `loadConfig` for channel collision guard | WIRED | `loadConfig` imported at line 26; called at line 386 inside `detectChannelCollisions`. |
| `src/migration/fs-guard.ts` | `src/migration/guards.ts` | `assertReadOnlySource` invoked from wrapped fs calls | WIRED | `assertReadOnlySource` imported at line 55; called in `wrapAsync` (line 114) and `wrapSync` (line 125). |

---

### Data-Flow Trace (Level 4)

All key artifacts in this phase are pure functions, command handlers, or interceptors — none render dynamic data to a UI/template. The data flows through ledger writes (verified by test row-count assertions) and stderr CLI output (verified by integration test stderr captures). No hollow-prop or disconnected-data concerns apply.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `apply` subcommand listed in `migrate openclaw --help` | `node --import tsx src/cli/index.ts migrate openclaw --help` | Shows `apply [options]  Run pre-flight guards...` | PASS |
| `--only <name>` flag listed in `apply --help` | `node --import tsx src/cli/index.ts migrate openclaw apply --help` | Shows `--only <name>  Filter pre-flight checks to a single OpenClaw agent` | PASS |
| All 78 Phase 77 tests pass | `npx vitest run src/migration/__tests__/ledger.test.ts src/migration/__tests__/guards.test.ts src/migration/__tests__/apply-preflight.test.ts src/migration/__tests__/fs-guard.test.ts src/cli/commands/__tests__/migrate-openclaw.test.ts` | 5 test files, 78 passed / 0 failed | PASS |
| Zero new npm dependencies | `git diff package.json package-lock.json` | Empty diff (0 lines) | PASS |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| MIGR-02 | 77-02, 77-03 | `apply [--only <agent>]` refuses if daemon running, secret in proposed YAML, or channel ID collision | SATISFIED | All 3 refuse paths implemented with literal messages; integration tests A/B/C pin them. `--only` flag wired and narrows collision scope (Test F). |
| MIGR-06 | 77-01, 77-03 | Every migration action writes structured JSONL with `timestamp`, `agent`, `step`, `outcome`, `file_hashes` | SATISFIED | `ledgerRowSchema` extended with optional `step`, `outcome`, `file_hashes`. `LEDGER_OUTCOMES` closed enum. Every guard outcome recorded by orchestrator. Test D asserts 4 ledger rows with `outcome="allow"`. |
| MIGR-07 | 77-02, 77-03 | Migrator never modifies any file under `~/.openclaw/` | SATISFIED | `assertReadOnlySource` guards the path at the helper level; `installFsGuard`/`uninstallFsGuard` guard it at the runtime fs level; Test G asserts mtime invariant across 4 run scenarios; Test H statically greps `src/migration/` for literal write-context violations. |
| OPS-03 | 77-02, 77-03 | Refuses if same channel ID bound to both OpenClaw and ClawCode agents — hard fail with collision report | SATISFIED | `detectChannelCollisions` in guards.ts produces aligned-column table with `Source agent (OpenClaw) | Target agent (ClawCode) | Channel ID` header and resolution footer. Test C asserts report structure. apply-preflight.test.ts:167 asserts refusal path with `reportBody`. |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `src/migration/apply-preflight.ts` | `pre-flight:readonly` witness row is NOT a real guard call — it is a documented stub that records a witness row while the actual fs interceptor is installed by the CLI layer | INFO | By design. The plan explicitly specifies this as a "witness row" pattern (apply-preflight.ts lines 86-104). The fs-guard interceptor is correctly installed in migrate-openclaw.ts before `runApplyPreflight` is called. No gap — this is architecture documentation. |
| `src/cli/commands/migrate-openclaw.ts` line 327 | `APPLY_NOT_IMPLEMENTED_MESSAGE` — all-guards-pass path returns exit 1 with "not implemented" message | INFO | Documented stub per Phase 77 scope boundary. Phase 78 replaces this with the actual YAML write body. Tests pin this literal explicitly (Test D). |

No blockers found. The two noted items are documented design decisions, not gaps.

---

### Human Verification Required

None. All success criteria can be and were verified programmatically via the 78-test suite and CLI smoke checks.

---

### Gaps Summary

No gaps found. All 9 observable truths verified, all artifacts exist and are substantive, all key links wired, data flows through to ledger as asserted by test row-count assertions, zero new dependencies introduced, and all 4 requirements (MIGR-02, MIGR-06, MIGR-07, OPS-03) satisfied with evidence.

One nuance worth noting for downstream phases: the runtime fs-guard (MIGR-07 belt-and-suspenders) uses CJS-module patching, which only intercepts fs calls made through default-import or `require` callers — named ESM import bindings (`import { writeFile } from "node:fs/promises"`) capture the original function at import time and bypass the patch. This is a documented limitation in `fs-guard.ts`'s file header, and the static-grep regression test (Test H) is the primary MIGR-07 enforcement line for such callers. This limitation is known and acceptable per the phase's own design.

---

_Verified: 2026-04-20T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
