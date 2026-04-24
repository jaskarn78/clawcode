---
phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
plan: 04
subsystem: marketplace
tags: [clawhub, marketplace, http-client, ttl-cache, discriminated-union, tdd, node-fetch, execfile, tar]

requires:
  - phase: 88-skills-marketplace
    provides: loadMarketplaceCatalog, installSingleSkill, updateAgentSkills, 8-variant SkillInstallOutcome, exhaustive-switch renderer
  - phase: 85-mcp-tool-awareness-reliability
    provides: pure-function DI blueprint (performMcpReadinessHandshake) — mirrored for clawhub-client.ts
  - phase: 84-skills-library-migration
    provides: scanSkillSecrets + copySkillDirectory + normalizeSkillFrontmatter + scopeForAgent + computeSkillContentHash + skills-ledger — reused verbatim for ClawHub-staged skills

provides:
  - ClawHub HTTP client (fetchClawhubSkills + downloadClawhubSkill) with pure-function DI
  - In-memory TTL cache keyed by {endpoint, query, cursor} with rate-limited negative entries
  - marketplaceSources schema extended to a discriminated union (legacy + clawhub)
  - MarketplaceEntry.source 3-way union (local | legacy | clawhub)
  - loadMarketplaceCatalog fetches ClawHub first-page items alongside local + legacy
  - installSingleSkill dispatches on source.kind; ClawHub entries run the full Phase 84 pipeline against a staged tarball
  - SkillInstallOutcome extended 8 → 11 variants (adds auth-required, rate-limited, manifest-invalid)
  - ResolvedMarketplaceSource union in shared/types.ts + resolveMarketplaceSources discriminator in loader.ts

affects: [90-05-plugins-browse, 90-06-oauth-clawhub-auth, 90-07-fin-acquisition-wiring]

tech-stack:
  added: []  # Zero new npm deps. Uses Node 22 native fetch + execFile (node:child_process) for tar + existing nanoid.
  patterns:
    - "ClawHub HTTP client: pure-function DI via deps.fetch; typed error classes (ClawhubRateLimitedError + ClawhubAuthRequiredError + ClawhubManifestInvalidError) map 1:1 to SkillInstallOutcome variants"
    - "TTL cache with negative entries: createClawhubCache<T>(ttlMs, now?) returns frozen {get, set, setNegative}; injectable clock for hermetic tests"
    - "Staging dir try/finally cleanup: ~/.clawcode/manager/clawhub-staging/<nanoid>/ rm'd regardless of outcome (D-07)"
    - "Exhaustive-switch enforcement: SkillInstallOutcome now carries 11 variants — any renderer missing a case trips a TS2366/never compile error"

key-files:
  created:
    - src/marketplace/clawhub-client.ts — fetchClawhubSkills + downloadClawhubSkill + 3 typed error classes
    - src/marketplace/clawhub-cache.ts — createClawhubCache<T>(ttlMs, now?) TTL + negative cache
    - src/marketplace/__tests__/clawhub-client.test.ts — 10 tests for HTTP client + tar extraction
    - src/marketplace/__tests__/clawhub-cache.test.ts — 3 tests for cache TTL + negative entries
    - src/marketplace/__tests__/clawhub-schema.test.ts — 5 tests for schema defaults + union parsing
    - src/marketplace/__tests__/catalog-clawhub.test.ts — 4 tests for catalog union behavior
    - src/marketplace/__tests__/install-clawhub-skill.test.ts — 7 tests for install pipeline + exhaustive switch
  modified:
    - src/marketplace/catalog.ts — fetches ClawHub items; MarketplaceEntry.source 3-way union
    - src/marketplace/install-single-skill.ts — SkillInstallOutcome 8→11 variants; installClawhubSkill helper
    - src/config/schema.ts — defaultsSchema.clawhubBaseUrl + clawhubCacheTtlMs + marketplaceSources union
    - src/config/loader.ts — resolveMarketplaceSources discriminates legacy vs clawhub kinds
    - src/shared/types.ts — ResolvedMarketplaceSource discriminated union
    - src/manager/daemon.ts — MarketplaceIpcDeps.marketplaceSources typed as ResolvedMarketplaceSources
    - src/marketplace/__tests__/catalog.test.ts — type guards for 3-way source union
    - src/config/__tests__/loader.test.ts — fixture updates (clawhubBaseUrl + clawhubCacheTtlMs defaults)
    - src/config/__tests__/differ.test.ts — fixture update (same)

key-decisions:
  - "ClawHub API shape confirmed via live probe 2026-04-24: GET https://clawhub.ai/api/v1/skills?limit=3 returns {\"items\":[],\"nextCursor\":null} — exact field names preserved in client + cache types"
  - "Zero new npm deps: node:fetch (Node 22 native) for HTTP + node:child_process execFile for tar extraction. Plan referenced execa but the project doesn't have it; pivoted to the built-in equivalent (Rule 3 blocking fix)"
  - "SkillInstallOutcome extended 8 → 11 variants: +auth-required (401/403), +rate-limited (429 with retryAfterMs), +manifest-invalid (malformed tarball or missing SKILL.md). Each variant carries the exact payload the Discord UI needs — no second round-trip"
  - "Staging dir: ~/.clawcode/manager/clawhub-staging/<nanoid>/ — per D-07, cleaned in try/finally regardless of outcome. Installer's return value is authoritative even if cleanup fails (best-effort rm)"
  - "ClawhubRateLimitedError.retryAfterMs propagated end-to-end: parsed from Retry-After header (seconds→ms), surfaced via outcome.retryAfterMs so the Discord renderer can display a live countdown without a second fetch"
  - "Legacy vs ClawHub marketplaceSources discriminator: the legacy zod variant OMITS kind (v2.2 backward-compat); the ClawHub variant REQUIRES kind: 'clawhub'. Loader narrows via presence of kind, with a type cast fallback for the legacy branch"
  - "URL construction uses string concat (`${baseUrl}/api/v1/skills`) NOT new URL(path, base) because the latter REPLACES the baseUrl path (breaks http://localhost/mock/api/... in tests). Production baseUrl 'https://clawhub.ai' works either way"
  - "Task 1 files initially conflicted with concurrent Wave 1 sibling (90-01) modifying src/config/schema.ts + loader.ts + shared/types.ts. Resolution: additive edits + co-commit via ed517b9 (both plans' changes landed together, cleanly)"

patterns-established:
  - "ClawHub HTTP client: pure DI'd fetch; User-Agent 'ClawCode/<version> (clawcode-marketplace)' read from package.json once at import; 3 discriminated error classes pre-wired to outcome variants"
  - "ClawHub install pipeline: download → manifest-check (SKILL.md) → secret-scan → scope → normalize → idempotency → copy+hash → YAML persist → ledger; identical pipeline to Phase 84 migration AFTER the stage step — zero code duplication"
  - "In-memory negative cache: setNegative(key, retryAfterMs) writes a sentinel that .get() returns as {kind:'rate-limited', retryAfterMs: <remaining>}; counts down as the clock advances (not a fixed window)"
  - "Exhaustive-switch type check via `const _exhaustive: never = o` in a live test (not just a type file) — compiles AND runs, so CI catches both type drift and runtime renderer drift in one shot"

requirements-completed: [HUB-01, HUB-03, HUB-06, HUB-08]

duration: 33min 1s
completed: 2026-04-24
---

# Phase 90 Plan 04: ClawHub HTTP Client + Install Pipeline Summary

**ClawHub HTTP client + TTL cache + 11-variant SkillInstallOutcome — marketplace catalog now unions local + legacy + ClawHub skills, and installSingleSkill dispatches ClawHub entries through the full Phase 84 staging pipeline.**

## Performance

- **Duration:** 33min 1s
- **Started:** 2026-04-24T01:03:03Z
- **Completed:** 2026-04-24T01:36:04Z
- **Tasks:** 2 completed (both TDD)
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- **HUB-01 catalog union + HUB-03 install end-to-end**: `loadMarketplaceCatalog` now fetches from `https://clawhub.ai/api/v1/skills`, unions first-page items alongside local + legacy, preserves local-wins dedup. `installSingleSkill` dispatches on `source.kind === "clawhub"` and routes to `installClawhubSkill` which runs the full Phase 84 pipeline (scan → normalize → scope → copy → persist → ledger) against a staged tarball.
- **HUB-06 exhaustive outcome union**: `SkillInstallOutcome` extended from 8 → 11 variants. New variants carry the exact UI payload (`auth-required.reason`, `rate-limited.retryAfterMs`, `manifest-invalid.reason`). Compile-time exhaustiveness enforced by the `never` sample renderer.
- **HUB-08 TTL cache**: In-memory `createClawhubCache<T>(ttlMs, now?)` with positive entries expiring after `ttlMs` and negative entries expiring after their individual `retryAfterMs` window. Injectable clock for hermetic tests. Zero-disk — daemon-scoped, resets on boot (D-05).
- **Zero new npm deps**: pivoted from the planned `execa` to Node 22 built-in `node:child_process` `execFile` + `node:util.promisify` for tar extraction. Same semantics, zero package-lock churn.

## Task Commits

1. **Task 1 RED**: `3356cb3` test(90-04): failing tests for ClawHub HTTP client + cache + schema
2. **Task 1 GREEN**: `f6f189f` feat(90-04): ClawHub HTTP client + TTL cache + marketplaceSources union
3. **Task 1 schema co-commit**: `ed517b9` (co-committed with 90-01's memoryAutoLoad schema edits — see note below)
4. **Task 2 RED**: `143d434` test(90-04): failing tests for ClawHub catalog union + install pipeline + 3 new outcome variants
5. **Task 2 GREEN**: `ab20bb3` feat(90-04): ClawHub catalog union + installClawhubSkill + 3 new SkillInstallOutcome variants

**Wave 1 coexistence note**: Plan 90-01 ran concurrently and modified `src/config/schema.ts`, `src/config/loader.ts`, and `src/shared/types.ts` in parallel. The schema union + loader discriminator + ResolvedMarketplaceSource union for Plan 90-04 landed in commit `ed517b9` alongside 90-01's `memoryAutoLoad` edits (both plans' changes merged cleanly).

## Files Created/Modified

### Created
- `src/marketplace/clawhub-client.ts` — pure-function DI'd HTTP client + 3 typed error classes. Node 22 native fetch; execFile for tar.
- `src/marketplace/clawhub-cache.ts` — `createClawhubCache<T>(ttlMs, now?)` with positive + negative entries.
- `src/marketplace/__tests__/clawhub-client.test.ts` — 10 tests (HUB-CLI-1..7 + rate-limit + auth + manifest).
- `src/marketplace/__tests__/clawhub-cache.test.ts` — 3 tests (HUB-CACHE-1..3).
- `src/marketplace/__tests__/clawhub-schema.test.ts` — 5 tests (HUB-SCH-1 + HUB-SCH-2a..d).
- `src/marketplace/__tests__/catalog-clawhub.test.ts` — 4 tests (HUB-CAT-1, HUB-CAT-2, HUB-CAT-4, HUB-CAT-5).
- `src/marketplace/__tests__/install-clawhub-skill.test.ts` — 7 tests (HUB-INS-1..6 + HUB-OUT-1 exhaustive).

### Modified
- `src/marketplace/catalog.ts` — ClawHub fetch branch + `clawhubItemToEntry` helper + 3-way source union on `MarketplaceEntry`.
- `src/marketplace/install-single-skill.ts` — source.kind dispatch + `installClawhubSkill` + 3 new outcome variants.
- `src/config/schema.ts` — `marketplaceSources` zod union + `clawhubBaseUrl` + `clawhubCacheTtlMs` defaults.
- `src/config/loader.ts` — `resolveMarketplaceSources` discriminates legacy vs clawhub kinds.
- `src/shared/types.ts` — `ResolvedMarketplaceSource` discriminated union.
- `src/manager/daemon.ts` — `MarketplaceIpcDeps.marketplaceSources` typed as `ResolvedMarketplaceSources`.
- `src/marketplace/__tests__/catalog.test.ts` — type-guard narrowing for 3-way source union.
- `src/config/__tests__/loader.test.ts` + `differ.test.ts` — fixture updates for the new clawhubBaseUrl + clawhubCacheTtlMs defaults.

## Verification

**Test suite** (`src/marketplace/__tests__/` + `src/config/__tests__/`):
- 323 tests, 15 files, all green.
- 29 new tests across 5 new test files (10 + 3 + 5 + 4 + 7).
- All Phase 88 regression pins preserved (49 marketplace tests total green).

**Live probe** (2026-04-24 01:03):
```
$ curl https://clawhub.ai/api/v1/skills?limit=3
HTTP 200
{"items":[],"nextCursor":null}
```
Confirms the `{items, nextCursor}` response shape used by `ClawhubSkillsResponse`.

**Grep assertions (from plan acceptance_criteria)**:
- `src/marketplace/clawhub-client.ts` exports `fetchClawhubSkills` + `downloadClawhubSkill` + `ClawhubRateLimitedError` + `ClawhubAuthRequiredError` + `ClawhubManifestInvalidError` ✓
- `ClawCode/<version> (clawcode-marketplace)` User-Agent ✓
- `src/marketplace/clawhub-cache.ts` exports `createClawhubCache` ✓
- `kind: z.literal("clawhub")` in `src/config/schema.ts` ✓
- `clawhubBaseUrl` + `clawhubCacheTtlMs` defaults ✓
- `auth-required` + `rate-limited` + `manifest-invalid` in `src/marketplace/install-single-skill.ts` ✓
- `fetchClawhubSkills` in `src/marketplace/catalog.ts` ✓
- `downloadClawhubSkill` in `src/marketplace/install-single-skill.ts` ✓

**TypeScript**: no new errors vs baseline (pre-existing `loader.ts:255` push-on-readonly + `loader.ts:294` effort-schema narrowing errors unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `execa` npm package absent from project**
- **Found during:** Task 1 GREEN (clawhub-client.ts import)
- **Issue:** Plan referenced `execa` per CLAUDE.md tech stack but the package isn't in `package.json` and isn't in `node_modules/`. Test file failed to import.
- **Fix:** Pivoted to Node 22 built-in `node:child_process.execFile` + `node:util.promisify` — same semantics (promise-based child process with graceful error handling), zero npm deps. Updated both `clawhub-client.ts` and `clawhub-client.test.ts` to use the built-in.
- **Files modified:** `src/marketplace/clawhub-client.ts`, `src/marketplace/__tests__/clawhub-client.test.ts`
- **Commit:** `f6f189f`

**2. [Rule 3 - Blocking] URL construction semantics: `new URL(path, base)` replaces base path**
- **Found during:** Task 1 GREEN (HUB-CLI-1 test failure)
- **Issue:** Plan snippet used `new URL("/api/v1/skills", args.baseUrl)` which follows WHATWG URL semantics — an absolute pathname REPLACES the base's pathname. This broke the test fixture `baseUrl: "http://localhost/mock"` (yielded `http://localhost/api/v1/skills` instead of `http://localhost/mock/api/v1/skills`). Production `baseUrl: "https://clawhub.ai"` worked either way, but tests failed.
- **Fix:** Rewrote URL construction as string concat with a trimmed trailing slash: `${trimmedBase}/api/v1/skills${qs}`. Works uniformly for any baseUrl pathname.
- **Files modified:** `src/marketplace/clawhub-client.ts`
- **Commit:** `f6f189f`

**3. [Rule 3 - Blocking cascade] Schema-driven fixture cascade**
- **Found during:** Task 1 GREEN (tsc)
- **Issue:** Adding `clawhubBaseUrl` + `clawhubCacheTtlMs` to `defaultsSchema` cascaded into 6 test fixture locations (`loader.test.ts` × 5, `differ.test.ts` × 1) that construct a `Config` object literal missing the new fields. Same pattern as Phase 86 `allowedModels` rollout + Phase 89 `greetOnRestart` rollout.
- **Fix:** Added both fields to every base `Config` fixture following the exact Phase 86/89 precedent.
- **Files modified:** `src/config/__tests__/loader.test.ts`, `src/config/__tests__/differ.test.ts`
- **Commit:** `f6f189f`

**4. [Rule 3 - Blocking] Wave 1 sibling (90-01) concurrent edits to shared files**
- **Found during:** Task 1 GREEN (working tree collision)
- **Issue:** Plan 90-01 ran in parallel and had uncommitted edits to `src/config/schema.ts`, `src/config/loader.ts`, and `src/shared/types.ts`. My additive edits to the same files needed to land without overwriting theirs.
- **Fix:** Worked additively — added `clawhubBaseUrl`/`clawhubCacheTtlMs` defaults below 90-01's `memoryAutoLoad` line; added `marketplaceSources` zod union extension; added `ResolvedMarketplaceSource` union in `shared/types.ts`. My schema/loader/types changes co-committed with 90-01's in commit `ed517b9` (both plans' changes merged cleanly).
- **Files modified:** `src/config/schema.ts`, `src/config/loader.ts`, `src/shared/types.ts`
- **Commit:** `ed517b9` (combined)

## Known Stubs

None. Each variant of `SkillInstallOutcome` carries non-empty payload; `installClawhubSkill` runs the full pipeline; the catalog loader returns real items; the cache TTL semantics are fully wired.

## Notes for Downstream

**Plan 90-05 (plugins)**: `SkillInstallOutcome` is the template for `PluginInstallOutcome`. The new `auth-required` + `rate-limited` + `manifest-invalid` variants transfer directly. `downloadClawhubSkill` can be generalized to `downloadClawhubPackage` (skill OR plugin) with minimal changes — the tar extraction path is content-agnostic.

**Plan 90-06 (OAuth)**: When GitHub OAuth ships, the `ClawhubAuthRequiredError` branch in `installClawhubSkill` should trigger the device-code flow automatically (currently returns `auth-required` outcome for operator action). The `authToken` field on the `{kind: "clawhub"}` marketplaceSource entry is already wired end-to-end — populate it after OAuth lands.

**Cache integration** (NOT in this plan — deferred to 90-05): the current `loadMarketplaceCatalog` fetches ClawHub on every call. The cache primitive is ready; Plan 90-05's `/clawcode-skills-browse` handler should instantiate a module-scoped `createClawhubCache` and wire `get()`/`set()`/`setNegative()` around the fetch. Pattern: check cache → fetch on miss → `set()` on success → `setNegative()` on rate limit.

## Self-Check: PASSED

- [x] `src/marketplace/clawhub-client.ts` exists with all 3 error classes + 2 functions
- [x] `src/marketplace/clawhub-cache.ts` exists with `createClawhubCache` export
- [x] `src/marketplace/catalog.ts` modified to fetch ClawHub
- [x] `src/marketplace/install-single-skill.ts` modified with 3 new outcome variants + `installClawhubSkill`
- [x] `src/config/schema.ts` + `src/config/loader.ts` + `src/shared/types.ts` extended (via co-commit with 90-01)
- [x] Commits `3356cb3`, `f6f189f`, `143d434`, `ab20bb3` present in `git log`
- [x] `npx vitest run src/marketplace/__tests__/` exits 0 (49/49)
- [x] `npx vitest run src/config/__tests__/` exits 0 (274/274 including Phase 90-01 tests)
- [x] `npx tsc --noEmit` — no new errors vs baseline
- [x] All 4 requirements closed: HUB-01, HUB-03, HUB-06, HUB-08
