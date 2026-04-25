---
phase: 93-status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience
plan: 02
subsystem: marketplace + discord
tags: [marketplace, clawhub, discord, picker, default-injection]
requires:
  - .planning/phases/93-.../93-CONTEXT.md (D-93-02-1..4)
  - src/marketplace/catalog.ts loadMarketplaceCatalog (Phase 88 + Phase 90 Plan 04)
  - src/manager/daemon.ts MarketplaceIpcDeps + closure-intercept (Phase 88 Plan 02)
  - src/discord/slash-commands.ts handleSkillsBrowseCommand (Phase 88 Plan 02)
provides:
  - LoadMarketplaceCatalogOpts.defaultClawhubBaseUrl optional field
  - MarketplaceIpcDeps.defaultClawhubBaseUrl optional field
  - Auto-inject branch in loadMarketplaceCatalog when no explicit clawhub source
  - CLAWHUB_DIVIDER_VALUE / LABEL / DESC sentinel constants in slash-commands.ts
  - StringSelectMenu partition + interleave + cap pipeline for /clawcode-skills-browse
  - Sentinel-value filter on selection (skip marketplace-install for divider)
affects:
  - /clawcode-skills-browse Discord slash (now surfaces ClawHub public skills by default)
  - daemon IPC marketplace-list (forwards defaultClawhubBaseUrl)
  - test fixture: zero (Pitfall 4 closure — additive optional field, no Rule 3 cascade)
tech-stack:
  added: []
  patterns:
    - "Eighth application of the Phase 83/86/89 additive-optional opt-in blueprint (defaultClawhubBaseUrl)"
    - "First non-mutating sources auto-injection — synthesizes a frozen source onto a fresh sourcesArr without touching opts.sources"
    - "Sentinel-value pattern for non-installable Discord StringSelectMenu options (no setDisabled API in discord.js 14.x)"
key-files:
  created:
    - src/marketplace/__tests__/catalog-clawhub-default.test.ts (5 tests, ~140 lines)
  modified:
    - src/marketplace/catalog.ts (+43 lines — type extension + auto-inject branch)
    - src/manager/daemon.ts (+16 lines — type extension + handler forward + closure literal)
    - src/manager/__tests__/daemon-marketplace.test.ts (+20 lines — M12 plumbing test)
    - src/discord/slash-commands.ts (+~80 lines — sentinel constants + partition pipeline + filter)
    - src/discord/__tests__/slash-commands-skills-browse.test.ts (+~190 lines — SB-93-1..3 tests)
decisions:
  - D-93-02-1 honored verbatim — synthetic source carries NO authToken (public-only access)
  - D-93-02-2 honored — MarketplaceIpcDeps.defaultClawhubBaseUrl kept optional (Pitfall 4 closure)
  - D-93-02-3 honored — sentinel value "__separator_clawhub__" / label "── ClawHub public ──" / desc "(category divider)"
  - D-93-02-4 honored — back-compat preserved when defaultClawhubBaseUrl undefined OR explicit kind:"clawhub" source present (HUB-CAT regression suite green, no test fixture cascade)
  - Picker partitions on isClawhubEntry; legacy {path,label?} sources are treated as "local-side" (Pitfall 2 spec said operator-curated filesystem mounts visually read like locals)
  - Divider gating: requires clawhubSide.length > 0 AND remainingSlots >= 2 (Pitfall 3 closure — divider is never the last visible option)
  - opts.sources is NEVER mutated; auto-inject pushes onto a fresh sourcesArr clone
metrics:
  start: "2026-04-25T00:31:09Z"
  end: "2026-04-25T00:52:05Z"
  duration_minutes: 21
  tasks: 2
  commits: 2
  files_changed: 6
  tests_added: 9 (5 catalog auto-inject + 1 daemon plumbing + 3 picker divider/sentinel)
---

# Phase 93 Plan 02: ClawHub public-catalog auto-injection + skills-browse divider Summary

Auto-injects `defaults.clawhubBaseUrl` as a synthetic public ClawHub source in `loadMarketplaceCatalog` when no explicit `kind:"clawhub"` entry exists, then renders a non-installable "── ClawHub public ──" divider between local and ClawHub skills in `/clawcode-skills-browse` with a sentinel-value filter that skips `marketplace-install` for divider clicks.

## Files Added/Modified

### Created
- `src/marketplace/__tests__/catalog-clawhub-default.test.ts` — 5 tests pinning C-01..C-05 (auto-inject contract: inject-when-no-clawhub, no-inject-with-explicit-clawhub, no-inject-without-default-url, no-authToken on synthetic source, local-wins on collision).

### Modified
- `src/marketplace/catalog.ts` — extended `LoadMarketplaceCatalogOpts` with optional `defaultClawhubBaseUrl?: string`; inserted auto-inject branch (with info log) between local-skills loading and source iteration; iteration now uses fresh `sourcesArr` clone (never mutates `opts.sources`).
- `src/manager/daemon.ts` — extended `MarketplaceIpcDeps` with optional `defaultClawhubBaseUrl`; `handleMarketplaceListIpc` conditionally spreads it into `loadCatalog({...})`; closure-intercept literal carries `config.defaults.clawhubBaseUrl`.
- `src/manager/__tests__/daemon-marketplace.test.ts` — added M12 plumbing test asserting `loadCatalog` called with `expect.objectContaining({ defaultClawhubBaseUrl: "https://example.test" })`.
- `src/discord/slash-commands.ts` — added module-level `CLAWHUB_DIVIDER_VALUE/LABEL/DESC` constants; extended local `MarketplaceEntryWire` type with the `kind:"clawhub"` source variant; replaced single-slice picker construction with partition + interleave + cap pipeline; added sentinel-value filter immediately after `chosen = followUp.values[0]` that returns "Pick a skill, not the divider." ephemerally without firing `marketplace-install`.
- `src/discord/__tests__/slash-commands-skills-browse.test.ts` — added SB-93-1 (5-option ordering: local → divider → clawhub), SB-93-2 (sentinel selection skips install IPC), SB-93-3 (no divider when zero ClawHub items).

## Test Counts

| File                                        | Suite        | Count                       |
| ------------------------------------------- | ------------ | --------------------------- |
| catalog-clawhub-default.test.ts (NEW)       | C-01..C-05   | 5                           |
| catalog-clawhub.test.ts                     | HUB-CAT-1..5 | 4 (regression — unchanged)  |
| daemon-marketplace.test.ts                  | M1-M12       | 12 (M12 added; M1-M11 pass) |
| slash-commands-skills-browse.test.ts        | B1-B10 + SB-93-1..3 | 13 (3 added; B1-B10 pass) |

All affected suites green: `npx vitest run src/marketplace/__tests__/ src/manager/__tests__/daemon-marketplace.test.ts src/discord/__tests__/slash-commands-skills-browse.test.ts` → 126/126 passing.

## Pitfall Closures

| Pitfall | Closure |
| ------- | ------- |
| Pitfall 1 — StringSelectMenu separator option fires install handler | Sentinel-value filter at `chosen === CLAWHUB_DIVIDER_VALUE` BEFORE `await followUp.update("Installing...")`. SB-93-2 pin: install IPC never fires. |
| Pitfall 2 — Picker with 0 ClawHub skills still shows divider | `clawhubSide.length > 0` gate on divider injection. SB-93-3 pin: 2 local + 0 clawhub → 2 options total, no `__separator_clawhub__`. |
| Pitfall 3 — 25-option Discord cap orphans skills below divider | `remainingSlots >= 2` gate (need at least divider + 1 clawhub) plus per-iteration cap check on clawhub-side. Divider can't be the terminal option. |
| Pitfall 4 — `MarketplaceIpcDeps` field add propagates to test fixtures | Field marked optional (`defaultClawhubBaseUrl?: string`) on both `MarketplaceIpcDeps` and `LoadMarketplaceCatalogOpts`. Existing 11 daemon-marketplace fixtures + 4 catalog-clawhub fixtures unchanged — zero Rule 3 cascade. |

## No new dependencies

`git diff package.json` clean — verified pre-commit. Phase 93 Plan 02 ran entirely on existing stack:
- pino (existing)
- discord.js StringSelectMenuBuilder + StringSelectMenuOptionBuilder (existing)
- vitest (existing)

## Schema Note

`config.defaults.clawhubBaseUrl` was already zod-defaulted to `"https://clawhub.ai"` at `src/config/schema.ts:907` (Phase 90 Plan 04). No schema change in this plan — the value was already populated, just unused. This plan wires it through the IPC plumbing.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `src/marketplace/__tests__/catalog-clawhub-default.test.ts` exists
- [x] Commit `99352aa` (Task 1) present
- [x] Commit `ca398b1` (Task 2) present
- [x] All 9 new tests green
- [x] All affected regression tests green (126/126 in affected suites)
- [x] Acceptance grep witness all positive (sentinel constant, filter line, clawhubSide gate, no `opts.sources.push`, no orphan `listResp.available.slice(0, DISCORD_SELECT_CAP)` in handler)
- [x] No new npm deps
- [x] No fixture cascade (Pitfall 4 closure)

## Self-Check: PASSED
