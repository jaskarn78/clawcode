---
phase: 93-status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience
plan: 03
subsystem: marketplace + discord
tags: [marketplace, clawhub, discord, error-class, plugin-install, ux-resilience]
requires:
  - .planning/phases/93-.../93-CONTEXT.md (D-93-03 — locked: new error class + new outcome variant)
  - .planning/phases/93-.../93-RESEARCH.md (Pitfall 5 — fallback URL must stay; 13-URL probe table)
  - src/marketplace/clawhub-client.ts existing error class hierarchy (Phase 90 Plan 04)
  - src/marketplace/install-plugin.ts mapFetchErrorToOutcome (Phase 90 Plan 05)
  - src/discord/slash-commands.ts renderPluginInstallOutcome (Phase 90 Plan 05)
provides:
  - ClawhubManifestNotFoundError class (sibling-not-subclass of ClawhubManifestInvalidError)
  - 404 branch in downloadClawhubPluginManifest (lands BEFORE generic !res.ok)
  - manifest-unavailable variant in PluginInstallOutcome union
  - mapFetchErrorToOutcome branch routing 404 → manifest-unavailable (BEFORE the manifest-invalid branch)
  - PluginInstallOutcomeWire mirror variant
  - renderPluginInstallOutcome case "manifest-unavailable" with actionable Discord copy
  - DPM-93-1 regression pin verifying daemon.ts:1116-1118 fallback URL behavior unchanged
affects:
  - /clawcode-plugins-browse Discord slash (404s now show "manifest unavailable (404) — registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin." instead of misleading "manifest is invalid")
  - hivemind plugin install path (was: misleading manifest-invalid wording; now: clear manifest-unavailable outcome)
  - test fixture: zero (additive variant + additive error class — no Rule 3 cascade)
tech-stack:
  added: []
  patterns:
    - "Sibling-not-subclass error class (ClawhubManifestNotFoundError next to ClawhubManifestInvalidError) so install pipeline can route 404 to a distinct outcome variant"
    - "Discriminated-union outcome growth (10 → 11 variants); exhaustive-switch invariant enforced by TypeScript never branch (matches Phase 88 MKT-05 / Phase 90 11-variant pattern)"
    - "Error-mapping branch ordering matters: more-specific (NotFoundError) BEFORE more-general (InvalidError) so the 404 routing fires first"
    - "Regression pin (DPM-93-1) verifying intentionally-unchanged code (daemon.ts:1116-1118 fallback URL) — Pitfall 5 closure"
key-files:
  created:
    - src/marketplace/__tests__/clawhub-client-manifest-404.test.ts (3 tests, ~125 lines)
    - src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts (4 tests, ~95 lines)
  modified:
    - src/marketplace/clawhub-client.ts (+30 lines — class + 404 branch)
    - src/marketplace/install-plugin.ts (+28 lines — variant + mapper branch + import)
    - src/discord/slash-commands.ts (+18 lines — wire variant + renderer case)
    - src/discord/__tests__/slash-commands-plugins-browse.test.ts (+54 lines — PB-93-1 test)
    - src/manager/__tests__/daemon-plugin-marketplace.test.ts (+103 lines — DPM-93-1 regression pin)
decisions:
  - "ClawhubManifestNotFoundError is a sibling, NOT subclass, of ClawhubManifestInvalidError — `err instanceof ClawhubManifestInvalidError` returns false. The whole point of the new class is to distinguish 404 from malformed body in error mapping; subclassing would defeat the differentiation."
  - "Mapper branch ordering: ClawhubManifestNotFoundError check lands BEFORE ClawhubManifestInvalidError check in mapFetchErrorToOutcome. Since the classes are siblings (not parent/child), the ordering is purely defensive — but it makes the more-specific routing visually obvious."
  - "404 branch in downloadClawhubPluginManifest lands BEFORE the generic `if (!res.ok)` fallthrough so the new error class wins the dispatch. 429 / 401|403 branches preserved unchanged."
  - "daemon.ts:1116-1118 fallback URL construction (`item.manifestUrl ?? \"${baseUrl}/api/v1/plugins/${name}/manifest\"`) intentionally NOT modified. Live probes against 13 URL shapes confirmed every shape returns 404 for unpublished plugins like hivemind — the registry is the source of truth, not the URL shape. Pinned by DPM-93-1 regression test."
  - "Discord copy: `**${plugin}** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin.` Technical-but-accurate; doesn't blame the plugin file (the file doesn't exist). Avoids the previous misleading 'manifest is invalid' wording."
  - "Renderer case lands BEFORE `case \"manifest-invalid\":` in the switch so visual ordering matches conceptual proximity (404 and malformed-body are both manifest-fetch failures)."
  - "PluginInstallOutcomeWire (Discord-side mirror union) extended in lockstep with PluginInstallOutcome — keeps the byte-for-byte parity that Phase 90 Plan 05 established."
metrics:
  duration: ~25 min
  tasks_completed: 2
  tests_added: 8 (3 NF + 4 MU + 1 PB-93-1) — DPM-93-1 inline regression block added 1 test (so total = 9 new tests across 4 files; one of those files is new + one extended)
  total_lines_added: ~330
  completed: 2026-04-25
---

# Phase 93 Plan 03: Plugin manifest-URL resilience + clearer 404 Summary

**One-liner:** New `ClawhubManifestNotFoundError` class + `manifest-unavailable` outcome variant route HTTP 404s out of the misleading "manifest is invalid" path; daemon fallback URL deliberately untouched per Pitfall 5 (live probes confirmed registry is the source of truth, not URL shape).

## What Changed

### Task 1 — `ClawhubManifestNotFoundError` + 404 branch (commit `c5ac9d4`)

Added a new error class (`src/marketplace/clawhub-client.ts`) as a **sibling** (not subclass) of `ClawhubManifestInvalidError`, carrying `manifestUrl: string` and `status: number` instance fields. Wired a new 404 branch in `downloadClawhubPluginManifest` that lands BEFORE the generic `if (!res.ok)` fallthrough so 404s no longer surface as "manifest is invalid".

**Tests (3):** NF-01 throws-with-payload, NF-02 sibling-not-subclass invariant, NF-03 regression pin for the existing 429/401/500 dispatch order.

### Task 2 — `manifest-unavailable` outcome + Discord copy + regression pin (commit `fb267df`)

Extended `PluginInstallOutcome` union (`src/marketplace/install-plugin.ts`) with the new variant. `mapFetchErrorToOutcome` got a new branch routing `ClawhubManifestNotFoundError` → `manifest-unavailable` — the branch lands BEFORE the `ClawhubManifestInvalidError` check so the more-specific 404 routing fires first.

`PluginInstallOutcomeWire` (the Discord-side mirror union in `src/discord/slash-commands.ts`) extended in lockstep. `renderPluginInstallOutcome` got a new case BEFORE `manifest-invalid`:

> `**${plugin}** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin.`

**Tests (5 new across 3 files):**
- MU-01..MU-04 (new file `install-plugin-manifest-unavailable.test.ts`) — mapper branch + frozen-output + exhaustive-switch + regression pin for existing branches
- PB-93-1 (extended `slash-commands-plugins-browse.test.ts`) — Discord renderer emits new copy, does NOT contain the misleading "manifest is invalid" substring
- DPM-93-1 (extended `daemon-plugin-marketplace.test.ts`) — fallback URL regression: when `item.manifestUrl` is set, that exact URL is used; when undefined, the canonical `${baseUrl}/api/v1/plugins/${name}/manifest` fallback is used

## What Did NOT Change

**`src/manager/daemon.ts:1116-1118` is byte-identical to its pre-plan state** (`git diff src/manager/daemon.ts | wc -l` = 0). Per RESEARCH §Pitfall 5, the fallback URL construction is correct — every probed URL shape (13 variants) returns 404 for unpublished plugins. The registry is the source of truth, not the URL shape. Changing the fallback would just relocate the 404 to a different URL.

DPM-93-1 pins this behavior so any future regression to daemon.ts:1116-1118 fails the test suite immediately.

## Deviations from Plan

None — plan executed exactly as written. Branch ordering, error class shape, mapper branch placement, Discord copy, regression pin scope all match the plan verbatim.

## Test Results

**Plan-scoped suites (all green):**

| Suite | Tests | Status |
|-------|-------|--------|
| `src/marketplace/__tests__/clawhub-client-manifest-404.test.ts` (NEW) | 3 | green |
| `src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts` (NEW) | 4 | green |
| `src/marketplace/__tests__/clawhub-client.test.ts` (regression) | 16 | green |
| `src/marketplace/__tests__/install-plugin.test.ts` (regression) | 11 | green |
| `src/discord/__tests__/slash-commands-plugins-browse.test.ts` (extended +PB-93-1) | 10 | green |
| `src/manager/__tests__/daemon-plugin-marketplace.test.ts` (extended +DPM-93-1) | 10 | green |
| **Total** | **54** | **all green** |

**Full suite:** 4780 / 4808 tests pass. The 28 failures across 14 files are pre-existing Phase 92-04 work (cutover-verify-summary, slash-types CONTROL_COMMANDS count, slash-commands clawcode-interrupt/steer T7, migration verifier, migrate-openclaw-complete) — confirmed by stash-and-rerun on the baseline before Task 2 changes. Zero regressions caused by this plan.

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `test -f src/marketplace/__tests__/clawhub-client-manifest-404.test.ts` | passed |
| `grep "^export class ClawhubManifestNotFoundError" src/marketplace/clawhub-client.ts` returns 1 | passed (1 match) |
| `manifestUrl: string` field on the new class | passed |
| 404 branch present (`grep "res.status === 404" src/marketplace/clawhub-client.ts`) | passed (1 match) |
| `throw new ClawhubManifestNotFoundError` present | passed (1 match) |
| Sibling-not-subclass: `instanceof ClawhubManifestInvalidError` is false | passed (NF-02) |
| `test -f src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts` | passed |
| PluginInstallOutcome union extended (`grep '"manifest-unavailable"' src/marketplace/install-plugin.ts`) | passed (2 matches: variant + mapper kind) |
| Wire union extended (`grep '"manifest-unavailable"' src/discord/slash-commands.ts`) | passed (2 matches) |
| Renderer copy `manifest unavailable (404)` | passed (1 match) |
| Renderer copy `Retry later or choose a different plugin` | passed (1 match) |
| Renderer does NOT confuse 404 with invalid in the new case | passed (PB-93-1 asserts `not.toMatch(/manifest is invalid/)`) |
| `git diff src/manager/daemon.ts \| wc -l` returns 0 | **passed (0)** |
| All 4 new/extended test files green | passed (54/54) |
| Existing `clawhub-client.test.ts` + `install-plugin.test.ts` still green (regression) | passed |

## Pattern Library Updates

- **Sibling error class for nuanced error mapping.** `ClawhubManifestNotFoundError` joins `ClawhubManifestInvalidError` / `ClawhubRateLimitedError` / `ClawhubAuthRequiredError` as the fourth distinct error class in the ClawHub client. The pattern: when an HTTP status code maps to a distinct operator-facing outcome, give it its own error class (NOT a status-field-on-existing-class) so `instanceof` checks in the mapper stay clean and exhaustive switches catch new cases at compile time.
- **Eleven-variant outcome union.** `PluginInstallOutcome` grows from 10 to 11 variants. The exhaustive-switch invariant (matches Phase 88 MKT-05 / Phase 90 Plan 05) — every callsite must add a case or the `default: const _: never = ...` branch fails to compile. MU-03 pins this at the test level.
- **Regression pin for intentionally-unchanged code.** DPM-93-1 verifies daemon.ts:1116-1118 behavior without touching daemon.ts itself. Useful pattern when research determines a code path is correct as-is and the bug is elsewhere — the test prevents future contributors from "fixing" the wrong target (Pitfall 5 closure).

## Self-Check: PASSED

- File `src/marketplace/__tests__/clawhub-client-manifest-404.test.ts`: FOUND
- File `src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts`: FOUND
- Commit `c5ac9d4` (Task 1): FOUND
- Commit `fb267df` (Task 2): FOUND
- daemon.ts diff: 0 lines (Pitfall 5 honored)
- All 54 plan-scoped tests green
