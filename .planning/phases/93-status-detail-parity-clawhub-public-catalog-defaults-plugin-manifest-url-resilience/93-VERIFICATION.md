---
phase: 93-status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience
verified: 2026-04-25T01:12:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 93 Verification Report

**Phase Goal:** Three bundled fixes — restore rich `/clawcode-status` output (parity with OpenClaw `/status`); auto-inject `defaults.clawhubBaseUrl` so `/clawcode-skills-browse` shows public ClawHub skills by default; distinguish 404 from invalid-manifest in plugin install pipeline with actionable Discord copy.
**Verified:** 2026-04-25T01:12:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Plan 93-01: /clawcode-status OpenClaw Parity

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | /clawcode-status renders the OpenClaw 17-element field set with `unknown`/`n/a` placeholders | VERIFIED | `status-render.ts` exports `renderStatus` emitting all 9 lines; R-01 test pins the full line set: version, model, fallbacks, context, tokens, session, task, options, activation |
| 2 | Status renderer emits a fixed line set regardless of which handle methods throw | VERIFIED | `buildStatusData` wraps every SessionManager accessor in `tryRead<T>(fn, fallback)` (line 80-86); R-08 test passes throwing stubs and confirms 9 lines and no "Failed to read status" |
| 3 | Operator sees abbreviated session id (last 12 chars) plus relative updated timestamp | VERIFIED | `status-render.ts:178-184` — `…${data.sessionId.slice(-12)}` + `formatDistanceToNow` + " ago" suffix; pinned by R-01/R-06/R-07 tests |
| 4 | Daemon short-circuit at slash-commands.ts:889 dispatches via the renderer (no LLM turn consumed) | VERIFIED | `slash-commands.ts:995-1007` — `if (commandName === "clawcode-status")` calls `renderStatus(buildStatusData(...))` then `return`; S3+S4 tests verify 9-line output |

### Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/discord/status-render.ts` | VERIFIED | Exists, 214 lines, exports `buildStatusData` + `renderStatus` + `StatusData` type; imports `formatDistanceToNow` from "date-fns" |
| `src/discord/__tests__/status-render.test.ts` | VERIFIED | Exists; 8 tests covering R-01..R-08 all pass |
| `src/discord/slash-commands.ts` (wiring) | VERIFIED | Imports `buildStatusData, renderStatus` from `./status-render.js`; `renderStatus(buildStatusData(...))` pattern present at line 1005 |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `slash-commands.ts:995-1007` | `status-render.ts` | `renderStatus(buildStatusData({sessionManager, resolvedAgents, agentName, ...}))` | WIRED — grep returns 1 match |
| `status-render.ts` | `date-fns/formatDistanceToNow` | `import { formatDistanceToNow } from "date-fns"` at line 30 | WIRED |

### Behavioral Spot-Checks

| Behavior | Result | Status |
|----------|--------|--------|
| 8 status-render unit tests (R-01..R-08) | 8/8 passed | PASS |
| 4 slash-commands-status-model tests (S1+S2 regression, S3+S4 new) | 4/4 passed | PASS |
| Old `🎚️ Effort:` literal removed from slash-commands.ts | `grep "🎚️ Effort:" ... \| grep -v "//"` returns 0 | PASS |

---

## Plan 93-02: ClawHub Public Catalog Auto-Injection + Skills-Browse Divider

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/clawcode-skills-browse` surfaces ClawHub public skills out-of-the-box | VERIFIED | `loadMarketplaceCatalog` auto-injects a synthetic clawhub source when `defaultClawhubBaseUrl` is set and no explicit `kind:"clawhub"` entry exists; daemon passes `config.defaults.clawhubBaseUrl` at line 2276 |
| 2 | Auto-inject fires ONLY when (a) defaultClawhubBaseUrl provided AND (b) sources has no kind:"clawhub" | VERIFIED | `catalog.ts:261-284` — guards `opts.defaultClawhubBaseUrl !== undefined && !hasExplicitClawhub`; C-01/C-02/C-03 tests pin all three conditions |
| 3 | Synthetic source carries no authToken | VERIFIED | `catalog.ts:273-277` — `Object.freeze({ kind: "clawhub", baseUrl: opts.defaultClawhubBaseUrl })` — no authToken field; C-04 test asserts `callArgs.authToken` is undefined |
| 4 | Skills picker renders local → divider → ClawHub-sourced skills | VERIFIED | `slash-commands.ts:2060-2125` — partition pipeline: `localSide = filter(!isClawhubEntry)`, `clawhubSide = filter(isClawhubEntry)`, divider injected when `clawhubSide.length > 0 && remainingSlots >= 2`; SB-93-1 test pins 5-option ordering |
| 5 | Selecting divider produces ephemeral response, NEVER fires marketplace-install IPC | VERIFIED | `slash-commands.ts:2191` — `if (chosen === CLAWHUB_DIVIDER_VALUE)` returns with `followUp.update("Pick a skill, not the divider.")` before any IPC call; SB-93-2 test confirms |
| 6 | Divider omitted when zero ClawHub items | VERIFIED | `clawhubSide.length > 0` gate at line 2095; SB-93-3 test: 2 local + 0 clawhub → 2 options, no `__separator_clawhub__` |
| 7 | Back-compat: explicit clawhub OR undefined defaultClawhubBaseUrl unchanged | VERIFIED | C-02 (explicit clawhub → only explicit fetch, no injection) and C-03 (undefined → no fetch); regression suite `catalog-clawhub.test.ts` 9/9 passing (HUB-CAT unchanged) |

### Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/marketplace/catalog.ts` | VERIFIED | `defaultClawhubBaseUrl?: string` on `LoadMarketplaceCatalogOpts` (line 116); auto-inject branch at lines 258-284; iteration via `sourcesArr` (line 285, not `opts.sources`) |
| `src/marketplace/__tests__/catalog-clawhub-default.test.ts` | VERIFIED | Exists; 5 tests (C-01..C-05) all pass |
| `src/manager/daemon.ts` | VERIFIED | `MarketplaceIpcDeps.defaultClawhubBaseUrl?: string` (line 702); handler forwards at lines 752-754; closure-intercept passes `config.defaults.clawhubBaseUrl` at line 2276 |
| `src/discord/slash-commands.ts` (divider) | VERIFIED | `CLAWHUB_DIVIDER_VALUE = "__separator_clawhub__"` (line 85); sentinel filter at line 2191; partition pipeline at lines 2060-2125 |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `daemon.ts:2276 (deps literal)` | `catalog.ts loadMarketplaceCatalog opts` | `defaultClawhubBaseUrl: config.defaults.clawhubBaseUrl` | WIRED |
| `catalog.ts auto-inject branch` | ClawHub HTTP API via fetchClawhubSkills | synthetic source pushed to `sourcesArr` | WIRED — `kind: "clawhub"` present in branch |
| `slash-commands.ts handleSkillsBrowseCommand` | marketplace-install IPC handler | sentinel filter `chosen === "__separator_clawhub__"` BEFORE sendIpcRequest | WIRED |

### Behavioral Spot-Checks

| Behavior | Result | Status |
|----------|--------|--------|
| catalog-clawhub-default.test.ts (C-01..C-05) | 5/5 passed | PASS |
| catalog-clawhub.test.ts regression (HUB-CAT) | 4/4 passed | PASS |
| daemon-marketplace.test.ts (M1-M12) | 12/12 passed | PASS |
| slash-commands-skills-browse.test.ts (B1-B10 + SB-93-1..3) | 13/13 passed | PASS |
| `opts.sources` not mutated | `grep -E "opts\.sources\.push"` returns 0 | PASS |

---

## Plan 93-03: Plugin Manifest-URL Resilience (404 vs Invalid Manifest)

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `downloadClawhubPluginManifest` throws `ClawhubManifestNotFoundError` on HTTP 404 | VERIFIED | `clawhub-client.ts:583-588` — `if (res.status === 404) throw new ClawhubManifestNotFoundError(...)` lands BEFORE the generic `if (!res.ok)` fallthrough; NF-01 test confirms |
| 2 | `mapFetchErrorToOutcome` routes `ClawhubManifestNotFoundError` → `manifest-unavailable` | VERIFIED | `install-plugin.ts:381-388` — branch placed BEFORE `ClawhubManifestInvalidError` check; MU-01..MU-04 tests all pass |
| 3 | Discord `renderPluginInstallOutcome` emits actionable copy for manifest-unavailable | VERIFIED | `slash-commands.ts:514-520` — `case "manifest-unavailable":` returns "manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin."; PB-93-1 test confirms copy does NOT contain "manifest is invalid" |
| 4 | Fallback URL construction at daemon.ts:1116-1118 is UNCHANGED | VERIFIED | `git show c5ac9d4 -- src/manager/daemon.ts` and `git show fb267df -- src/manager/daemon.ts` both return 0 lines; line 1117 still reads `item.manifestUrl ??` |
| 5 | Fallback URL is only used when `item.manifestUrl` is undefined | VERIFIED | `daemon.ts:1116-1118` — `item.manifestUrl ?? \`${deps.clawhubBaseUrl}/api/v1/plugins/${name}/manifest\``; DPM-93-1 regression test pins both branches |

### Required Artifacts

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/marketplace/clawhub-client.ts` | VERIFIED | `ClawhubManifestNotFoundError` class at lines 161-170, exported; `manifestUrl: string` and `status: number` instance fields; 404 branch at line 583; sibling (not subclass) of `ClawhubManifestInvalidError` — NF-02 confirmed |
| `src/marketplace/install-plugin.ts` | VERIFIED | `manifest-unavailable` variant in `PluginInstallOutcome` union (lines 123-137); mapper branch routes `ClawhubManifestNotFoundError` to it |
| `src/discord/slash-commands.ts` | VERIFIED | `PluginInstallOutcomeWire` union extended with `manifest-unavailable` (line 485); `renderPluginInstallOutcome` has `case "manifest-unavailable":` (line 514) with actionable copy |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `clawhub-client.ts downloadClawhubPluginManifest` | `ClawhubManifestNotFoundError throw` | `if (res.status === 404) throw new ClawhubManifestNotFoundError(...)` | WIRED |
| `install-plugin.ts mapFetchErrorToOutcome` | `manifest-unavailable PluginInstallOutcome` | `if (err instanceof ClawhubManifestNotFoundError) return Object.freeze({kind: "manifest-unavailable", ...})` | WIRED |
| `slash-commands.ts renderPluginInstallOutcome` | Discord ephemeral message | `case "manifest-unavailable":` returns string with "manifest unavailable (404)" | WIRED |

### Behavioral Spot-Checks

| Behavior | Result | Status |
|----------|--------|--------|
| clawhub-client-manifest-404.test.ts (NF-01..NF-03) | 3/3 passed | PASS |
| clawhub-client.test.ts regression (HUB-CLI) | 16/16 passed | PASS |
| install-plugin-manifest-unavailable.test.ts (MU-01..MU-04) | 4/4 passed | PASS |
| install-plugin.test.ts regression | 11/11 passed | PASS |
| slash-commands-plugins-browse.test.ts (+PB-93-1) | 10/10 passed | PASS |
| daemon-plugin-marketplace.test.ts (+DPM-93-1) | 10/10 passed | PASS |
| daemon.ts NOT modified (Pitfall 5) | git diff shows 0 lines changed | PASS |

---

## Anti-Patterns Found

None. Scanned all key modified files (`status-render.ts`, `catalog.ts`, `clawhub-client.ts`, `install-plugin.ts`) for TODO/FIXME/placeholder/empty-implementation patterns — zero hits.

Note: `n/a` and `unknown` literals in `status-render.ts` are documented intentional placeholders (per D-93-01-1 and the SUMMARY Known Stubs table) — not code stubs. They represent locked decisions to defer token-counter plumbing to a future phase while giving operators a consistent status schema from day one.

## Data-Flow Trace (Level 4)

Not applicable for this phase. The status renderer (`renderStatus`) is a pure function consuming `StatusData` — its "data source" is the `buildStatusData` builder which wraps live `SessionManager` accessors. The render pipeline produces a string for an existing Discord `editReply` call (no database queries involved). The intentional `n/a`/`unknown` placeholders are documented deferred fields, not disconnected props.

The ClawHub catalog flow (93-02) involves a fetch from the ClawHub HTTP API, tested via vitest mocks (C-01..C-05). The actual HTTP fetch is wired from `loadMarketplaceCatalog` → `fetchClawhubSkills` and is covered by the existing `catalog-clawhub.test.ts` suite.

## Human Verification Required

### 1. Visual /clawcode-status output appearance

**Test:** In the fin-acquisition Discord channel, run `/clawcode-status`
**Expected:** 9-line block matching:
```
🦞 ClawCode v0.2.0 (<short-sha>)
🧠 Model: <alias> · 🔑 sdk
🔄 Fallbacks: n/a
📚 Context: unknown · 🧹 Compactions: n/a
🧮 Tokens: n/a
🧵 Session: …<last12> • updated <N> minutes ago
📋 Task: idle
⚙️ Runtime: SDK session · Runner: n/a · Think: <effort> · Fast: n/a · Harness: n/a · Reasoning: n/a · Permissions: <mode> · Elevated: n/a
👥 Activation: bound-channel · 🪢 Queue: n/a
```
**Why human:** Emoji rendering, Discord formatting, and actual session handle data can only be confirmed live.

### 2. /clawcode-skills-browse ClawHub public skills surface

**Test:** Run `/clawcode-skills-browse` in fin-acquisition channel (no explicit `marketplaceSources[{kind:"clawhub"}]` in config)
**Expected:** Dropdown shows local skills, then "── ClawHub public ──" divider, then public ClawHub skills; selecting divider yields ephemeral "Pick a skill, not the divider."
**Why human:** Real ClawHub API fetch; actual Discord select-menu rendering and component interaction cannot be replicated in unit tests.

### 3. /clawcode-plugins-browse hivemind 404 copy

**Test:** Run `/clawcode-plugins-browse`, select `hivemind`
**Expected:** Reply reads "**hivemind** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin." (NOT "manifest is invalid")
**Why human:** Live ClawHub API must return 404 for the manifest endpoint; unit tests mock the response.

---

## Requirements Coverage

No formal REQ-IDs declared for Phase 93. Sub-plans 93-01, 93-02, 93-03 each act as self-contained requirement units. All three sub-plan must_haves are verified (12/12).

---

## Overall Summary

All 12 must-haves across the three sub-plans are verified at all four levels:

- **93-01:** `status-render.ts` exists and is substantive (214 lines, exports `buildStatusData` + `renderStatus` + `StatusData`), is wired into the `slash-commands.ts` daemon short-circuit, and data flows from live `SessionManager` accessors through defensive `tryRead` wrappers into the 9-line render. 8 unit tests + 4 integration tests pass.

- **93-02:** `catalog.ts` auto-inject branch is substantive, wired via `daemon.ts` plumbing (`config.defaults.clawhubBaseUrl` flows at line 2276), and the `slash-commands.ts` skills-browse handler correctly partitions + interleaves with divider + sentinel filter. 5 + 1 + 3 tests pass; back-compat regression tests unchanged.

- **93-03:** `ClawhubManifestNotFoundError` is a real sibling error class (not a subclass), the 404 branch lands before the generic fallthrough, `mapFetchErrorToOutcome` routes it to the new `manifest-unavailable` variant, and the Discord renderer emits actionable copy distinguishing it from `manifest-invalid`. `daemon.ts:1116-1118` is byte-identical to pre-Phase-93 state (0 lines in git diff). 3 + 4 + 1 + 1 tests pass.

No blocker anti-patterns. No regressions (the 28 pre-existing failures in `cutover-verify-summary`/`list-sync-status` are Phase 92-04 work in the tree per the context note; they predate this phase).

---

_Verified: 2026-04-25T01:12:00Z_
_Verifier: Claude (gsd-verifier)_
