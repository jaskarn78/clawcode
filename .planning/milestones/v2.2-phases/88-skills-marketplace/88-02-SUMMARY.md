---
phase: 88-skills-marketplace
plan: 02
subsystem: marketplace
tags: [skills, marketplace, discord, slash-commands, ipc, StringSelectMenuBuilder, UI-01, hot-relink]

# Dependency graph
requires:
  - phase: 88-skills-marketplace/88-01
    provides: loadMarketplaceCatalog + installSingleSkill + updateAgentSkills + MarketplaceEntry + SkillInstallOutcome (8-kind discriminated union) — the three pure-function handoff contracts that this plan wraps in IPC + Discord UI
  - phase: 86-dual-discord-model-picker-core/86-02
    provides: handleSetModelIpc pure-exported-handler blueprint (DI'd deps, ManagerError for typed errors, case delegation in <10 lines at the bottom switch) — mirrored verbatim for all three marketplace handlers
  - phase: 86-dual-discord-model-picker-core/86-03
    provides: StringSelectMenuBuilder + awaitMessageComponent + ephemeral-error + inline-handler-short-circuit-before-CONTROL_COMMANDS pattern — mirrored verbatim for /clawcode-skills-browse and /clawcode-skills
  - phase: 85-mcp-tool-awareness-reliability/85-03
    provides: /clawcode-tools inline-handler carve-out precedent — Phase 88 is the 3rd application of the same short-circuit pattern
  - phase: 84-skills-library-migration
    provides: scanSkillsDirectory + linkAgentSkills — used for the post-install hot-relink (MKT-04)
provides:
  - "Three IPC methods (marketplace-list, marketplace-install, marketplace-remove) with pure exported handlers (handleMarketplaceListIpc/Install/Remove) — DI'd for unit tests, follow the Phase 86 Plan 02 blueprint byte-for-byte."
  - "Post-install hot-relink: successful install outcomes (installed, installed-persist-failed, already-installed) trigger scanSkillsDirectory + linkAgentSkills against the target agent — new skill becomes symlink-visible in agent's workspace/skills/ without a daemon restart (MKT-04)."
  - "/clawcode-skills-browse — native StringSelectMenuBuilder picker rendering available catalog entries (NOT-already-installed); select → install pipeline → SINGLE ephemeral outcome summary (MKT-06); exhaustive switch over all 8 SkillInstallOutcome kinds (MKT-05)."
  - "/clawcode-skills — installed-list view + native StringSelectMenuBuilder remove picker; select → IPC marketplace-remove → outcome reply handling removed/persisted state (MKT-07)."
  - "renderInstallOutcome — module-level pure helper in slash-commands.ts; exhaustive switch over SkillInstallOutcomeWire; TypeScript enforces a distinct reply branch for every future outcome variant."
  - "UI-01 end-to-end for skills marketplace — both commands have empty claudeCommand + zero options (no free-text args); StringSelectMenuBuilder is the ONLY input surface; ephemeral replies throughout."
affects: []  # Phase 88 closes the v2.2 skills marketplace surface. No downstream phases.

# Tech tracking
tech-stack:
  added: []  # Zero new npm deps — discord.js 14.26.2 + existing Phase 88 Plan 01 primitives
  patterns:
    - "Third application of the inline-slash-handler-short-circuit-before-CONTROL_COMMANDS pattern (after /clawcode-tools Phase 85 and /clawcode-model Phase 86). Two-line carve-out in handleInteraction routes directly to the dedicated method; control-plane fallbacks never see the command."
    - "Pure-exported-IPC-handler blueprint applied THREE more times (handleMarketplaceListIpc + Install + Remove) — Phase 88 makes it 5 applications (set-model, set-permission-mode, marketplace-list, marketplace-install, marketplace-remove). Blueprint: exported helper, DI surface for tests, ManagerError for typed errors, <10-line switch case at bottom that delegates."
    - "Outcome-rendering via module-level pure helper + exhaustive switch — renderInstallOutcome lives next to the slash-commands class (NOT inside it) for test hermeticity; TypeScript narrows .kind to force a branch for every union variant. Missing variant = compile error before ship."
    - "Closure-based IPC intercept BEFORE routeMethod — Phase 88 marketplace handlers close over daemon-local resolvedMarketplaceSources + skillsPath + ledgerPath + log, same pattern as browser-tool-call / search-tool-call / image-tool-call. Keeps routeMethod's 24-arg signature stable (zero churn across v2.0+)."
    - "SkillInstallOutcomeWire as a local type declaration in slash-commands.ts that MIRRORS the Phase 88 Plan 01 SkillInstallOutcome type — keeps the module tree narrow (slash-commands doesn't pull in the installSingleSkill code path), keeps tests hermetic, AND forces both sides to stay shape-compatible via the exhaustive switch."
    - "Non-rollback on remove persist failure — mirrors Phase 86 Plan 02 MODEL-04 + Phase 88 Plan 01 install non-rollback contract. The operator intent to remove IS the event; persistence is next-boot durability. Surface {removed:true, persisted:false, persist_error} so the UI can report both facts."
    - "No rewire on remove — removing a skill leaves a stale symlink under workspace/skills/<skill>, which is harmless (scanner re-reads the agent's skills: list at next daemon boot). Skipping the rewire keeps the remove path cheap and mirrors the ledger-write parsimony from Phase 88 Plan 01."

key-files:
  created:
    - src/manager/__tests__/daemon-marketplace.test.ts
    - src/discord/__tests__/slash-commands-skills-browse.test.ts
    - src/discord/__tests__/slash-commands-skills-list.test.ts
  modified:
    - src/ipc/protocol.ts                            # +3 methods in IPC_METHODS
    - src/ipc/__tests__/protocol.test.ts             # regression update for exact-match assertion
    - src/manager/daemon.ts                          # 3 handlers + bootstrap wiring + closure intercept
    - src/discord/slash-types.ts                    # +2 DEFAULT_SLASH_COMMANDS entries
    - src/discord/slash-commands.ts                 # renderInstallOutcome helper + 2 inline methods + dispatch branches
    - src/discord/__tests__/slash-types.test.ts     # count + inline-handler branch updates
    - src/discord/__tests__/slash-commands.test.ts  # total command-count regression 14→16

key-decisions:
  - "Closure-based marketplace IPC intercept BEFORE routeMethod — avoids the 24-arg routeMethod signature churn. Same pattern as Phase 70/71/72 tool-call handlers. Handlers close over daemon-local deps that routeMethod's positional args would otherwise need to carry."
  - "SkillInstallOutcomeWire declared locally in slash-commands.ts (duplicates Phase 88 Plan 01's SkillInstallOutcome shape) — keeps slash-commands free of src/marketplace/ runtime imports, keeps tests hermetic (no vi.mock() for install-single-skill.ts needed), and lets TS enforce shape compatibility via the exhaustive switch in renderInstallOutcome."
  - "Rewire runs on THREE outcome kinds (installed, installed-persist-failed, already-installed). installed-persist-failed rewires because the filesystem state is correct (copy succeeded); the agent's in-memory skills list is ALSO appended before rewire so the linker sees the new skill. already-installed still rewires because a stale symlink from a previous session may point at the wrong target (linker is idempotent per src/skills/linker.ts:44-48 — skips when already correct)."
  - "Remove does NOT rewire — stale symlink at workspace/skills/<removed> is harmless (nothing reads it). Scanner re-reads the authoritative skills: list at next daemon boot. Skipping rewire keeps the remove path cheap and mirrors Phase 88 Plan 01's parsimony on ledger-writes for pre-gate refusals."
  - "ManagerError for 'agent not found' is a plain throw (not {code, data}) — Plan 88-02's UI doesn't surface allowed-agent lists (there's no schema field for that). Consistent with Phase 86 Plan 02's handling of 'agent not found' in handleSetModelIpc."
  - "In-memory configs[] mutation on successful install/remove — mirrors the Phase 86 Plan 02 MODEL-04 pattern (Object.freeze({...existing, skills:...}) replaces the frozen entry). Ensures subsequent IPC calls (e.g. marketplace-list) reflect the new state without a YAML re-read."
  - "protocol.test.ts regression extended for the 3 new entries in the exact-match order (after set-permission-mode, before costs). Preserves the Phase 85/86/87 pattern of pinning the enum order via a single authoritative test."
  - "slash-commands.test.ts T7 regression updated (14→16 total commands). Count assertions need bumping whenever DEFAULT_SLASH_COMMANDS or CONTROL_COMMANDS grows; future phases should follow this pattern (no vague 'at least N' assertions)."
  - "Remove flow returns removed:true on EACCES catch — operator intent was to remove, persistence failed, but the in-memory skills list IS updated so subsequent IPC calls reflect the removal. Avoids the edge case where the operator removes a skill, sees 'failed', re-tries, and ends up double-removing."

patterns-established:
  - "Third application of inline-slash-handler-short-circuit-before-CONTROL_COMMANDS — now an established template for any future /clawcode-* command that needs StringSelectMenuBuilder + IPC dispatch + outcome-specific rendering. Future milestones should re-apply verbatim."
  - "Exhaustive-switch outcome renderer — any IPC handler returning a discriminated union (3+ kinds) should produce a module-level renderer function with an exhaustive switch. TypeScript enforces the rendering branch for every variant; forgetting a case = compile error. Phase 88 Plan 02 renderInstallOutcome is the reference implementation."
  - "SingleSkillInstallOutcome + renderInstallOutcome collaboration — IPC returns structured outcome; UI layer is a pure pattern-match. No string-contains hunts, no re-derivation of failure reasons. Zero-silent-skip invariant baked into the type system."

requirements-completed: [MKT-01, MKT-05, MKT-06, MKT-07, UI-01]

# Metrics
duration: 26min 47s
completed: 2026-04-21
---

# Phase 88 Plan 02: Discord Skills Marketplace UI Summary

**Wired Plan 01's pure marketplace primitives to Discord end-to-end: three IPC handlers (marketplace-list/install/remove) following the Phase 86 Plan 02 handler blueprint, two new Discord slash commands (/clawcode-skills-browse + /clawcode-skills) with native StringSelectMenuBuilder pickers, post-install hot-relink via linkAgentSkills, and an exhaustive 8-outcome renderer that closes MKT-01/MKT-05/MKT-06/MKT-07 + UI-01 at the Discord surface. Zero new npm deps.**

## Performance

- **Duration:** 26 min 47 s
- **Started:** 2026-04-21T22:59:06Z
- **Completed:** 2026-04-21T23:25:53Z
- **Tasks:** 2 (both TDD RED→GREEN)
- **Files created:** 3 (one IPC test, two Discord handler tests)
- **Files modified:** 7 (3 production, 4 test regression)

## Accomplishments

- **Three new IPC methods** (marketplace-list, marketplace-install, marketplace-remove) — pure exported handlers (`handleMarketplaceListIpc` / `handleMarketplaceInstallIpc` / `handleMarketplaceRemoveIpc`) with DI surface; follow Phase 86 Plan 02 byte-for-byte. Intercepted BEFORE `routeMethod` in the daemon handler closure (same pattern as Phase 70-72 tool-call handlers) so the 24-arg routeMethod signature stays stable.
- **Post-install hot-relink (MKT-04)** — on `installed`, `installed-persist-failed`, and `already-installed` outcomes, the install handler runs `scanSkillsDirectory(skillsTargetDir)` then `linkAgentSkills(workspace/skills, configs[idx].skills, freshCatalog)`. New skill becomes symlink-visible in the agent's workspace without a daemon restart. In-memory `configs[idx].skills` is also mutated (frozen-copy pattern) so the linker sees the freshly-installed skill.
- **`/clawcode-skills-browse` (MKT-01 + UI-01)** — native StringSelectMenuBuilder with one option per available catalog entry (truncated at Discord's 25-option cap; overflow note appended to content). Selection dispatches IPC marketplace-install; outcome renders as a SINGLE ephemeral message (MKT-06). `claudeCommand: ""` + `options: []` — zero free-text args.
- **`/clawcode-skills` (MKT-07 + UI-01)** — installed-list view with bullet summary + native StringSelectMenuBuilder remove picker; selection dispatches IPC marketplace-remove and surfaces the outcome (removed/persist-failed/EACCES catch). Same UI-01 compliance (no free-text args).
- **`renderInstallOutcome` (MKT-05)** — module-level pure helper with EXHAUSTIVE switch over all 8 SkillInstallOutcome kinds (`installed`, `installed-persist-failed`, `already-installed`, `blocked-secret-scan`, `rejected-scope`, `rejected-deprecated`, `not-in-catalog`, `copy-failed`). TypeScript narrows `.kind` to force a distinct reply branch for every variant — forgetting a case = compile error. Zero-silent-skip invariant baked into the type system.
- **`SkillInstallOutcomeWire`** — local type declaration in slash-commands.ts that mirrors Plan 01's `SkillInstallOutcome`. Keeps slash-commands free of `src/marketplace/*` runtime imports; keeps tests hermetic (no `vi.mock` needed); lets TypeScript enforce shape compatibility via the exhaustive switch.
- **Daemon bootstrap wiring** — `resolveMarketplaceSources(config)` resolves `defaults.marketplaceSources` once at boot (empty `[]` when omitted, preserving v2.1/v2.2 config parse). The three IPC handlers close over this plus `skillsPath`, `ledgerPath`, `log` — no per-call re-resolve.
- **Two regression-test updates** — protocol.test.ts exact-match extended for marketplace-* entries (Phase 85/86/87 pattern); slash-commands.test.ts T7 count assertion bumped 14→16 (Phase 88 added 2 defaults).
- **17 new tests across 3 files.** 11 marketplace IPC handler tests (M1-M11) + 10 /clawcode-skills-browse tests (B1-B10) + 6 /clawcode-skills tests (L1-L6) + 1 UI-01 structural test (U1). All 17 green.
- **63/63 Plan 02 scope tests pass** across 5 test files (daemon-marketplace + 2 Discord skills tests + slash-types + protocol).
- **218/218 Discord suite tests pass** post-change (no regressions).
- **Zero new TS errors.** 38 pre / 38 post (identical baseline — all pre-existing).
- **Zero new npm deps.**

## Task Commits

1. **Task 1 RED: failing tests for marketplace IPC handlers** — `eab8832` (test)
   - 11 tests pinning the three-handler contract: M1-M2 (list happy + agent-not-found), M3-M8 (install — order invariant, 4 refusal outcomes with no-rewire, installed-persist-failed with rewire, agent-not-found fast-fail), M9-M10 (remove happy + EACCES), M11 (IPC_METHODS enum).
   - 11/11 fail against HEAD (handlers + enum entries not yet implemented).

2. **Task 1 GREEN: implement marketplace IPC handlers + protocol extension** — `d226b77` (feat)
   - `src/ipc/protocol.ts`: +3 entries in IPC_METHODS (marketplace-list / -install / -remove).
   - `src/manager/daemon.ts`: exported `MarketplaceIpcDeps` + `handleMarketplaceListIpc` + `handleMarketplaceInstallIpc` + `handleMarketplaceRemoveIpc` pure helpers (~230 lines); daemon bootstrap resolves `resolveMarketplaceSources(config)` + `DEFAULT_SKILLS_LEDGER_PATH` once at boot; closure intercept in the IPC handler BEFORE `routeMethod` with the 3 marketplace dispatch branches.
   - `src/ipc/__tests__/protocol.test.ts`: exact-match regression extended for the 3 new entries.
   - 11/11 M-tests pass; 18 pre-existing daemon regression tests still pass.

3. **Task 2 RED: failing tests for /clawcode-skills-browse + /clawcode-skills** — `69cdf29` (test)
   - B1-B10: unbound channel, empty available list, picker render, 25-cap overflow, select→(installed/blocked-secret-scan/rejected-scope/rejected-deprecated/installed-persist-failed/timeout).
   - L1-L6: unbound, empty installed, installed-list + remove picker render, select→remove happy, persist-fail warning, timeout.
   - U1: slash-types.test.ts structural — clawcode-skills-browse + clawcode-skills have empty claudeCommand + zero options.
   - 17/17 fail against HEAD.

4. **Task 2 GREEN: wire /clawcode-skills-browse + /clawcode-skills handlers** — `671d278` (feat)
   - `src/discord/slash-types.ts`: +2 DEFAULT_SLASH_COMMANDS entries (empty claudeCommand, zero options).
   - `src/discord/slash-commands.ts`:
     - `SkillInstallOutcomeWire` local type + `renderInstallOutcome` exhaustive-switch helper at module scope (~100 lines).
     - `handleInteraction` ladder: 2 new carve-out branches BEFORE the CONTROL_COMMANDS ladder.
     - `handleSkillsBrowseCommand` (~150 lines): defer → marketplace-list → empty-check → StringSelectMenuBuilder (25-cap + overflow) → awaitMessageComponent (30s) → marketplace-install → single ephemeral outcome reply.
     - `handleSkillsCommand` (~130 lines): defer → marketplace-list → empty-check → installed-list header + bullet + remove StringSelectMenuBuilder → awaitMessageComponent → marketplace-remove → outcome reply.
   - `src/discord/__tests__/slash-types.test.ts`: count 6→8, inline-handler branch for claudeCommand (3 entries), no-options set grows 3→5, +1 UI-01 compliance test.
   - `src/discord/__tests__/slash-commands.test.ts` T7: total count 14→16.
   - 17/17 Task 2 tests + 218/218 Discord suite pass.

## The Wire — End-to-End Flow

### Happy-path install

```
User types `/clawcode-skills-browse` in bound channel
  ↓
handleInteraction short-circuits to handleSkillsBrowseCommand
  ↓
interaction.deferReply({ ephemeral: true })
  ↓
sendIpcRequest(SOCKET_PATH, "marketplace-list", { agent }) —→ daemon closure intercepts
  ↓
handleMarketplaceListIpc: validateStringParam → findIndex → loadMarketplaceCatalog(..)
  ↓
Returns { agent, installed, available }
  ↓
Discord renders StringSelectMenuBuilder with `available` entries (label = name · category,
value = name, description = truncated 100 chars); overflow note if > 25
  ↓
User picks one → awaitMessageComponent resolves
  ↓
followUp.update("Installing **{skill}** on {agent}...")
  ↓
sendIpcRequest(SOCKET_PATH, "marketplace-install", { agent, skill }) —→ daemon intercept
  ↓
handleMarketplaceInstallIpc:
  1. validateStringParam agent + skill
  2. findIndex (fast-fail if -1)
  3. loadMarketplaceCatalog
  4. installSingleSkill({ ..., clawcodeYamlPath, ledgerPath }) ← Plan 01 pipeline
     → secret-scan → copy+transform → updateAgentSkills ← Plan 01 atomic YAML writer
  5. If outcome.kind in {installed, installed-persist-failed, already-installed}:
     - Mirror in-memory configs[idx].skills (frozen-copy)
     - scanSkillsDirectory(skillsTargetDir) ← Phase 84 scanner
     - linkAgentSkills(workspace/skills, skills, freshCatalog) ← Phase 84 linker
     - rewired = true
  6. Return { outcome, rewired }
  ↓
Discord side calls renderInstallOutcome(outcome, agent, rewired) — exhaustive switch
produces a distinct string for each of 8 outcome kinds
  ↓
interaction.editReply({ content: msg, components: [] }) — SINGLE ephemeral message (MKT-06)
```

### Happy-path remove

```
/clawcode-skills (no args) → handleSkillsCommand
  ↓
marketplace-list IPC → { installed, ... }
  ↓
Discord renders:
  Content:
    "Installed skills for **clawdy**:
    • frontend-design
    • tuya-ac

    Select one to remove:"
  Components: StringSelectMenuBuilder (one option per installed skill)
  ↓
User picks "tuya-ac" → marketplace-remove IPC
  ↓
handleMarketplaceRemoveIpc:
  updateAgentSkills({ op: "remove", ... }) ← Plan 01 atomic YAML
  On "updated" → { removed: true, persisted: true }
  On throw → { removed: true, persisted: false, persist_error }  (non-rollback)
  Mirror in-memory skills list (frozen-copy)
  ↓
Discord renders: "Removed **tuya-ac** from clawdy." (or persist-failed warning)
```

## UI-01 Compliance Checklist

- [x] `/clawcode-skills-browse` reply is a components payload (StringSelectMenuBuilder), not free text. `claudeCommand: ""` + `options: []` — no free-text arg.
- [x] `/clawcode-skills` same — picker-driven, zero free-text args.
- [x] All error rendering is ephemeral string editReply (acceptable for error text).
- [x] Discord 25-option hard cap respected with overflow note.
- [x] No LLM prompt routing for either command (claudeCommand empty; inline handler short-circuits before formatCommandMessage).

## MKT-05 Compliance — 8 Outcome Kinds, 8 Distinct Messages

| outcome.kind                | Discord reply (abbreviated)                                              |
| --------------------------- | ------------------------------------------------------------------------ |
| `installed`                 | "Installed **X** on Y.\nPath: …\nHot-reload: symlinks refreshed"         |
| `installed-persist-failed`  | "Installed **X** on Y (note: clawcode.yaml persist failed: …).\nPath:…" |
| `already-installed`         | "**X** is already installed on Y (reason)."                              |
| `blocked-secret-scan`       | "**X** blocked — secret-scan refused: \`offender\`. (scrub + retry)"     |
| `rejected-scope`            | "**X** is Z-scoped; **Y** is W agent. Use --force-scope or assign to…"   |
| `rejected-deprecated`       | "**X** is deprecated: reason."                                           |
| `not-in-catalog`            | "**X** not found in marketplace catalog."                                |
| `copy-failed`               | "**X** copy failed: reason."                                             |

Exhaustive switch means future Plan 88+ changes adding a 9th outcome variant will trip a TS error at compile time — the renderer cannot silently swallow an outcome.

## Test Coverage

### `daemon-marketplace.test.ts` — Task 1 (M1-M11, 11 tests)

| Test | Asserts                                                                                     | Status |
|------|---------------------------------------------------------------------------------------------|--------|
| M1   | list — catalog minus installed                                                              | PASS   |
| M2   | list — agent not found → ManagerError                                                       | PASS   |
| M3   | install happy — order: loadCatalog → installSkill → scanCatalog → linkSkills; rewired:true | PASS   |
| M4   | install — blocked-secret-scan → no rewire                                                   | PASS   |
| M5   | install — rejected-scope → no rewire                                                        | PASS   |
| M6   | install — installed-persist-failed → rewire STILL runs                                     | PASS   |
| M7   | install — not-in-catalog → no rewire                                                        | PASS   |
| M8   | install — agent not found → ManagerError BEFORE installSingleSkill fires                   | PASS   |
| M9   | remove happy — updateAgentSkills(op:"remove") → {removed:true, persisted:true}             | PASS   |
| M10  | remove — EACCES catch → {removed:true, persisted:false, persist_error}                      | PASS   |
| M11  | IPC_METHODS contains marketplace-list/install/remove                                        | PASS   |

### `slash-commands-skills-browse.test.ts` — Task 2 (B1-B10, 10 tests)

| Test | Asserts                                                              | Status |
|------|----------------------------------------------------------------------|--------|
| B1   | unbound channel → 'not bound'; no IPC                                | PASS   |
| B2   | empty available → 'already installed' message; no menu               | PASS   |
| B3   | picker renders StringSelectMenuBuilder with one option per available | PASS   |
| B4   | 25-cap overflow — menu trimmed + 'Showing first 25 of N' note        | PASS   |
| B5   | select → installed outcome — path + hot-reload note (single message) | PASS   |
| B6   | select → blocked-secret-scan — offender surfaces verbatim            | PASS   |
| B7   | select → rejected-scope — both scopes + guidance                     | PASS   |
| B8   | select → rejected-deprecated — reason surfaces                       | PASS   |
| B9   | select → installed-persist-failed — 'installed' + persist warning    | PASS   |
| B10  | picker timeout → 'timed out'; no install IPC                         | PASS   |

### `slash-commands-skills-list.test.ts` — Task 2 (L1-L6, 6 tests)

| Test | Asserts                                                                 | Status |
|------|-------------------------------------------------------------------------|--------|
| L1   | unbound channel → 'not bound'; no IPC                                   | PASS   |
| L2   | empty installed → helpful 'use /clawcode-skills-browse' message        | PASS   |
| L3   | installed-list + remove StringSelectMenuBuilder render                  | PASS   |
| L4   | select → marketplace-remove → 'Removed **X** from Y.'                   | PASS   |
| L5   | select → persist-failed → 'Removed X (persist failed: …)'              | PASS   |
| L6   | picker timeout → 'timed out'; no remove IPC                             | PASS   |

### `slash-types.test.ts` — regression updates (U1)

- Count 6→8 for DEFAULT_SLASH_COMMANDS (2 new entries added).
- `claudeCommand === ""` branch extended for clawcode-skills-browse + clawcode-skills (joins clawcode-model).
- no-options set grows 3→5 (skills-browse + skills join status/schedule/health).
- New U1 test: both entries have empty claudeCommand + zero options (UI-01 structural pin).

### `slash-commands.test.ts` T7 — count update

- Total DEFAULT_SLASH_COMMANDS + CONTROL_COMMANDS bumped 14→16.

## Files Created/Modified

### Created

- `src/manager/__tests__/daemon-marketplace.test.ts` (~410 lines) — 11 M-tests driving the three pure handlers via DI.
- `src/discord/__tests__/slash-commands-skills-browse.test.ts` (~480 lines) — 10 B-tests covering render + 5 outcome branches + timeout.
- `src/discord/__tests__/slash-commands-skills-list.test.ts` (~290 lines) — 6 L-tests covering remove flow + persist-failed + timeout.

### Modified (production)

- `src/ipc/protocol.ts` — IPC_METHODS extended with marketplace-list / -install / -remove (3 entries, grouped near set-permission-mode).
- `src/manager/daemon.ts`:
  - Imports: `updateAgentSkills`, `loadMarketplaceCatalog` + `MarketplaceEntry`, `installSingleSkill` + `SkillInstallOutcome`, `DEFAULT_SKILLS_LEDGER_PATH`, `resolveMarketplaceSources`, `type Logger`.
  - 3 pure exported handlers (~230 lines): `handleMarketplaceListIpc`, `handleMarketplaceInstallIpc`, `handleMarketplaceRemoveIpc` + shared `MarketplaceIpcDeps` type.
  - Bootstrap: `const resolvedMarketplaceSources = resolveMarketplaceSources(config); const ledgerPath = DEFAULT_SKILLS_LEDGER_PATH;` — resolved once.
  - Handler closure: `if (method === "marketplace-list" || … || "marketplace-remove")` branch BEFORE routeMethod, routes to the 3 helpers.
- `src/discord/slash-types.ts` — +2 DEFAULT_SLASH_COMMANDS entries (clawcode-skills-browse, clawcode-skills).
- `src/discord/slash-commands.ts`:
  - `SkillInstallOutcomeWire` type + `renderInstallOutcome` helper at module scope (~110 lines).
  - `handleInteraction` ladder: 2 new inline-handler branches BEFORE CONTROL_COMMANDS.
  - `handleSkillsBrowseCommand` (~155 lines): full StringSelectMenuBuilder + IPC dispatch + outcome rendering.
  - `handleSkillsCommand` (~135 lines): installed-list + remove StringSelectMenuBuilder + marketplace-remove IPC.

### Modified (tests)

- `src/ipc/__tests__/protocol.test.ts` — exact-match extended for 3 new entries (inserted after set-permission-mode, before costs).
- `src/discord/__tests__/slash-types.test.ts` — 4 regression updates (count, claudeCommand branch, no-options set, +1 UI-01 pin).
- `src/discord/__tests__/slash-commands.test.ts` T7 — total command count 14→16.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

1. **Closure-based IPC intercept BEFORE routeMethod.** Same pattern as browser/search/image-tool-call. Avoids 24-arg routeMethod signature churn.
2. **SkillInstallOutcomeWire local type.** Keeps slash-commands free of src/marketplace/* runtime imports; forces shape compatibility via exhaustive switch.
3. **Rewire on 3 outcomes, not on remove.** installed/installed-persist-failed/already-installed all touch the filesystem state; remove is YAML-only (stale symlink harmless).
4. **EACCES catch in remove → removed:true.** Operator intent is authoritative; avoids double-remove edge case.
5. **Exhaustive switch for outcome rendering.** Forces compile-error on missing variant = MKT-05 guaranteed by type system.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated slash-commands.test.ts T7 regression (count 14→16)**
- **Found during:** Task 2 GREEN regression sweep (post-edit `npx vitest run src/discord/__tests__/`)
- **Issue:** T7 pinned `DEFAULT_SLASH_COMMANDS.length + CONTROL_COMMANDS.length === 14`. Adding 2 entries to DEFAULT_SLASH_COMMANDS breaks that exact-match count.
- **Fix:** Updated assertion to `=== 16` + comment cites Phase 88 as the reason. Same pattern as Phase 87's 12→14 bump.
- **Files modified:** `src/discord/__tests__/slash-commands.test.ts`
- **Verification:** 218/218 discord suite tests green post-fix.

**2. [Rule 3 - Blocking] Extended protocol.test.ts exact-match regression for 3 new IPC methods**
- **Found during:** Task 1 GREEN regression sweep (`npx vitest run src/ipc/__tests__/protocol.test.ts`)
- **Issue:** The `IPC_METHODS > includes all required methods` test was ALREADY pre-existing-failing (noted in Phase 85/86 SUMMARIES — Phase 85 added `list-mcp-status` without updating the assertion, and the Phase 87 CMD-02 `set-permission-mode` addition also missed it). Plan 88-02's M11 test specifically called for the protocol.test.ts count assertion to be updated.
- **Fix:** Inserted 3 marketplace entries after `set-permission-mode` (which also got inserted to bring the test back in sync with production; was missing from pre-existing Phase 87 state).
- **Files modified:** `src/ipc/__tests__/protocol.test.ts` (one block extended).
- **Verification:** 29/29 protocol + daemon-marketplace tests green together.

Both deviations were explicit downstream cascades from the Phase 88 contract change. Neither required architectural decisions.

### Scope-Guard Decisions (NOT defects)

- **`resolvedMarketplaceSources` + `ledgerPath` resolved ONCE at daemon boot, not per-IPC-call.** The closure over them is zero-overhead; per-call `resolveMarketplaceSources(config)` would cost a redundant `~/...` expandHome pass on every /clawcode-skills-browse invocation. The daemon-local constants match the pre-Plan-02 convention (skillsPath is also resolved once at boot).
- **In-memory `configs[idx]` mutation even on `installed-persist-failed`.** The filesystem copy succeeded (skill dir exists under skillsTargetDir). The YAML write failed, but the linker needs to see the in-memory skills list to wire the symlink correctly NOW. Next daemon boot will re-read the disk YAML; if the operator reconciled the YAML in the meantime, the skill is correctly persistent.

## Deferred Issues

**Pre-existing test failures (9 failures, all predating Phase 88):**

- `src/manager/__tests__/bootstrap-integration.test.ts` — 2 failures (pre-existing).
- `src/manager/__tests__/daemon-openai.test.ts` — 7 failures (pre-existing).

Confirmed pre-existing via `git stash && npx vitest run …` comparison. Same count before and after my changes (9/14 failed pre-stash, 9/14 failed post-restore). Out of scope per Rule 3 boundary (auto-fix only issues this task's changes caused).

**Intermittent test pollution (non-blocking):**

- `fork-effort-quarantine.test.ts`, `session-manager-memory-failure.test.ts`, `warm-path-mcp-gate.test.ts` — pass isolated (17/17), fail 3 of 17 when run as part of the full manager suite due to cross-test filesystem / SessionManager pollution (pre-existing, unrelated to Phase 88).

**Pre-existing TS errors (38, identical count pre/post):**

- image/types.ts ImageProvider export, session-manager WarmPathResult mismatches, budget.ts type comparison, tasks/task-manager.ts causationId missing, config/loader.ts effort level narrowing, memory/graph ScoringConfig. None touch Plan 88-02 code. Noted in Phase 85/86/87/88-01 SUMMARIES.

## User Setup Required

None — no external service configuration. Operators who want legacy skill sources in their marketplace add to `defaults.marketplaceSources` in clawcode.yaml (optional, introduced by Plan 88-01):

```yaml
defaults:
  marketplaceSources:
    - path: ~/.openclaw/skills
      label: OpenClaw legacy
```

## Known Stubs

None. Every new code path is wired to real production code:

- `handleMarketplaceListIpc` / `Install` / `Remove` are invoked by the real handler closure in startDaemon.
- `/clawcode-skills-browse` → sendIpcRequest → daemon intercept → real `loadMarketplaceCatalog` + `installSingleSkill` (Plan 01) → real `scanSkillsDirectory` + `linkAgentSkills` (Phase 84).
- `/clawcode-skills` → same pipeline, with `updateAgentSkills` (Plan 01 atomic YAML writer).
- `renderInstallOutcome` is a pure helper with exhaustive switch — every outcome kind has a distinct rendered string.
- Zero mock paths in production code; all test mocks live in `__tests__` directories via DI hooks.

## Next Phase Readiness

- **Phase 88 is COMPLETE.** Both plans shipped: Plan 01 (pure-function primitives — catalog, installer, atomic YAML writer) and Plan 02 (IPC + Discord UI + hot-relink).
- **v2.2 milestone scope check (MKT-xx):** MKT-01/02/03/04/05/06/07 all closed (02/03/04 in Plan 01; 01/05/06/07 in Plan 02). UI-01 cross-cutting validated end-to-end: /clawcode-effort (Phase 83), /clawcode-tools (Phase 85), /clawcode-model (Phase 86), /clawcode-permissions (Phase 87), /clawcode-skills-browse + /clawcode-skills (Phase 88). All 5 UI-bearing commands are StringSelectMenuBuilder- or EmbedBuilder-driven with zero LLM-prompt routing.
- **Inline-handler-short-circuit pattern is now canonical (5 applications across 4 phases):** /clawcode-tools (85) → /clawcode-model (86) → /clawcode-permissions (87) → /clawcode-skills-browse + /clawcode-skills (88). Future /clawcode-* commands should follow the same carve-out ordering.
- **Pure-exported-IPC-handler blueprint is now canonical (5 applications across 3 phases):** handleSetModelIpc (86) → handleSetPermissionModeIpc (87) → handleMarketplaceListIpc + Install + Remove (88). Future IPC handlers with typed errors should follow the same shape (exported + DI'd + ManagerError envelope).
- **Exhaustive-switch outcome rendering is a new canonical pattern:** renderInstallOutcome is the reference implementation. Future IPC handlers returning discriminated unions with 3+ variants should provide a module-level pure renderer with an exhaustive switch for compile-time MKT-05-style zero-silent-skip guarantees.

## Self-Check: PASSED

Verified 2026-04-21:

- FOUND: `src/manager/__tests__/daemon-marketplace.test.ts` (406 lines, 11 tests M1-M11)
- FOUND: `src/discord/__tests__/slash-commands-skills-browse.test.ts` (~480 lines, 10 tests B1-B10)
- FOUND: `src/discord/__tests__/slash-commands-skills-list.test.ts` (~290 lines, 6 tests L1-L6)
- FOUND: commit `eab8832` (Task 1 RED)
- FOUND: commit `d226b77` (Task 1 GREEN)
- FOUND: commit `69cdf29` (Task 2 RED)
- FOUND: commit `671d278` (Task 2 GREEN)
- FOUND: `"marketplace-list"` in `src/ipc/protocol.ts`
- FOUND: `handleMarketplaceListIpc` in `src/manager/daemon.ts`
- FOUND: `handleSkillsBrowseCommand` in `src/discord/slash-commands.ts`
- FOUND: `handleSkillsCommand` in `src/discord/slash-commands.ts`
- FOUND: `clawcode-skills-browse` in `src/discord/slash-types.ts`
- FOUND: `clawcode-skills` in `src/discord/slash-types.ts`
- FOUND: `renderInstallOutcome` in `src/discord/slash-commands.ts`
- FOUND: `linkAgentSkills` usage in `src/manager/daemon.ts` (install hot-relink call site)
- FOUND: 63/63 Plan-scope tests pass (daemon-marketplace + 2 skills Discord tests + slash-types + protocol)
- FOUND: 218/218 Discord suite tests pass
- FOUND: zero new TS errors (38 pre / 38 post)
- FOUND: zero new npm deps

---
*Phase: 88-skills-marketplace*
*Completed: 2026-04-21*
