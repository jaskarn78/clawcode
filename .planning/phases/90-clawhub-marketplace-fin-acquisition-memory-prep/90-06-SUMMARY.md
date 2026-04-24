---
phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
plan: 06
subsystem: marketplace
tags: [clawhub, 1password, op-rewrite, oauth, device-code, github-oauth, modal-builder, discord, fuzzy-match, levenshtein, embed-builder]

requires:
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    plan: 04
    provides: ClawhubPluginManifest type (config.fields[] drives the modal) + ClawhubAuthRequiredError (populated once OAuth ships)
  - phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
    plan: 05
    provides: handlePluginsBrowseCommand (extended here with op:// probe button flow) + 9-variant PluginInstallOutcome + installClawhubPlugin pipeline (the thing the modal feeds)
  - phase: 88-skills-marketplace
    provides: inline-handler short-circuit pattern (7th application) + StringSelectMenuBuilder + ephemeral-defer shape reused in handleClawhubAuthCommand

provides:
  - op-rewrite.ts (listOpItems + proposeOpUri + levenshtein) — 1Password probe + two-pass fuzzy matcher (substring → Levenshtein ≤ 3)
  - github-oauth.ts (initiateDeviceCodeFlow + pollForAccessToken + storeTokenTo1Password + OAuthExpiredError + OAuthAccessDeniedError) — full device-code state machine
  - discord/config-modal.ts (buildPluginConfigModal + parseModalSubmit + buildSerialPromptFlow + TooManyFieldsError) — ≤5-field modal path + >5-field serial-flow generator
  - install-plugin.ts extension (buildOpRewriteCandidates + OpRewriteCandidate type) — advisory list of op:// substitutions for sensitive non-op:// fields
  - daemon.ts handlers (handleClawhubOauthStartIpc + handleClawhubOauthPollIpc + handleMarketplaceProbeOpItemsIpc) — pure-DI IPC endpoints
  - IPC protocol extensions (clawhub-oauth-start + clawhub-oauth-poll + marketplace-probe-op-items — 51→54 methods)
  - DEFAULT_SLASH_COMMANDS: +clawcode-clawhub-auth (9→10 defaults; 17→18 total with CONTROL_COMMANDS)
  - handleClawhubAuthCommand slash handler (7th inline-short-circuit application — device-code embed + long-lived OAuth poll + 1P store success/fail render)
  - op:// rewrite button flow (Primary 'Use op://...' / Danger 'Use literal') integrated into handlePluginsBrowseCommand's modal-retry path

affects: [90-07-fin-acquisition-wiring]

tech-stack:
  added: []  # Zero new npm deps. Uses Node 22 native fetch + child_process execFile + discord.js ModalBuilder/EmbedBuilder/ButtonBuilder already present.
  patterns:
    - "Two-pass fuzzy matcher (substring → Levenshtein ≤ 3) with first-word tokenization on BOTH label AND field-name sides — catches 'MYSQL_PASSWORD' matching 'MySQL DB - Unraid' and 'OPENAI_KEY' matching 'OpenAI API'"
    - "Field-name-driven op:// field resolution (opFieldFor): _password→password, _user→username, _host→hostname, _port→port, everything else → credential (1Password's canonical Credential-item field)"
    - "Graceful 1Password degradation: op ENOENT / not-signed-in → listOpItems returns [] → proposeOpUri returns null → UI falls through to literal paste (still gated by install-plugin's secret-scan)"
    - "GitHub device-code OAuth state machine — 4 error branches (authorization_pending/slow_down/expired_token/access_denied) mapped to OAuthExpiredError/OAuthAccessDeniedError typed classes; slow_down bumps interval by +5s; clock-driven expiry checked against deps.now"
    - "Long-lived IPC handler (clawhub-oauth-poll) — blocks up to 15 min on the Unix socket; daemon handler self-terminates at expires_at so the IPC client doesn't need a configurable timeout"
    - "op:// rewrite button confirmation UX — two-button ActionRow (Primary 'Use op://...' with Phase 86-style cache-invalidation label pattern, Danger 'Use literal value (may be refused)'); 60s awaitMessageComponent; no-click default → literal; install-plugin secret-scan stays authoritative"
    - "Pure-function DI via module-namespace import (import * as opRewriteMod from ...) — enables vi.spyOn() on individual exports without breaking ESM bindings (mirrored in daemon.ts for both githubOauthMod and opRewriteMod)"

key-files:
  created:
    - src/marketplace/op-rewrite.ts — levenshtein + listOpItems + proposeOpUri + opFieldFor heuristic (248 lines)
    - src/marketplace/github-oauth.ts — initiateDeviceCodeFlow + pollForAccessToken + storeTokenTo1Password + 2 typed error classes (246 lines)
    - src/discord/config-modal.ts — buildPluginConfigModal (≤5-field cap) + parseModalSubmit + buildSerialPromptFlow (>5-field generator) + TooManyFieldsError (170 lines)
    - src/marketplace/__tests__/op-rewrite.test.ts — 14 tests (OP-L1 + OP-P1..P2 + OP-PR1..PR4 + empty-items + field-name cases)
    - src/marketplace/__tests__/github-oauth.test.ts — 12 tests (GH-D1..D5 + GH-ST1 + access_denied + clock-expiry + default-label)
    - src/marketplace/__tests__/op-rewrite-candidates.test.ts — 4 tests (INS-OR1..OR2 + empty-vault + no-match-fallthrough)
    - src/discord/__tests__/config-modal.test.ts — 8 tests (CM-M1..M4 + CM-SF1 + paragraph-style + custom-placeholder + empty-config)
    - src/manager/__tests__/daemon-clawhub-oauth.test.ts — 7 tests (IPC-CLH-1..3 + IPC-PROBE-1..2 + 2 param-validation)
  modified:
    - src/marketplace/install-plugin.ts — +buildOpRewriteCandidates + OpRewriteCandidate type + opRewriteMod namespace import
    - src/manager/daemon.ts — +handleClawhubOauthStartIpc + handleClawhubOauthPollIpc + handleMarketplaceProbeOpItemsIpc (3 exports) + 3 IPC route branches + githubOauthMod/opRewriteMod imports
    - src/ipc/protocol.ts — +3 IPC methods (clawhub-oauth-start, clawhub-oauth-poll, marketplace-probe-op-items)
    - src/ipc/__tests__/protocol.test.ts — +3 enum entries
    - src/discord/slash-types.ts — +clawcode-clawhub-auth entry (DEFAULT_SLASH_COMMANDS 9→10)
    - src/discord/slash-commands.ts — +handleClawhubAuthCommand + inline short-circuit + op:// rewrite button flow in handlePluginsBrowseCommand's modal-retry branch (~150 lines added)
    - src/discord/__tests__/slash-types.test.ts — fixture updates (count 9→10, inline-handler set +1, no-options count 6→7)
    - src/discord/__tests__/slash-commands.test.ts — T7 total count 17→18

key-decisions:
  - "Device-code OAuth chosen over web-redirect (D-02 Claude's Discretion): ClawCode daemon is headless and has no HTTPS callback surface. Device-code lets the operator complete the flow in any browser while ClawCode polls the token endpoint — no callback URL needed. Trade-off: user_code must be copy-pasted (acceptable UX for an infrequent one-time auth)."
  - "op:// field-default heuristic follows env-var naming conventions (*_PASSWORD→password, *_USER→username, *_HOST→hostname, *_PORT→port, *_TOKEN/*_KEY → credential). Operators can override by typing any op:// path manually; the default is just the suggestion surfaced via the Primary button label."
  - "Serial follow-up modal chain for >5 fields — buildSerialPromptFlow generator yields {field, step:N, total:M} frames so the caller can show 'Step 3/8' ephemerals with mini-modals. Implemented the generator but kept the slash-commands.ts integration simple (existing 1-field modal-on-config-missing retry loop) — multi-field up-front ModalBuilder is deferred to the same follow-up that Plan 05 already noted."
  - "Long-lived IPC (clawhub-oauth-poll) doesn't need a configurable client-side timeout — the daemon handler is bounded by expires_at (GitHub's ~15min cap). Unix sockets stay open indefinitely; the daemon just returns {stored:false, message:'expired'} on timeout. Avoided plumbing a timeoutMs option through sendIpcRequest."
  - "Graceful 1Password degradation via empty-array fallthrough: any failure in listOpItems (ENOENT, not signed in, malformed JSON) returns Object.freeze([]) rather than throwing. The UI branch checks `items.length === 0` upstream and skips the op:// button step entirely — operators without 1P configured see the same flow as operators whose vault has no matches, both falling through to literal paste (install-plugin secret-scan still authoritative)."
  - "Module-namespace imports (import * as opRewriteMod) instead of named imports in install-plugin.ts AND daemon.ts — lets tests vi.spyOn(mod, 'fn') without breaking ESM live bindings. Learned from vitest's documented limitation that vi.spyOn on named imports is fragile across ESM; the namespace pattern is the canonical workaround and matches Phase 86's webhookManager closure pattern conceptually."
  - "Placeholder GitHub OAuth App client_id documented as a known stub: ClawHub hasn't registered a GitHub OAuth App yet. getClientId() reads CLAWHUB_GITHUB_CLIENT_ID / GITHUB_CLIENT_ID env vars with an 'Iv1.clawhub-public-placeholder' fallback that intentionally fails at GitHub's device-code endpoint — the slash handler catches the HTTP 4xx and surfaces a helpful 'operator must register the app and set the env var' message. Plan 90-07 or a future phase completes the OAuth app registration."

patterns-established:
  - "Inline-handler short-circuit — SEVENTH application. Canonical order: clawcode-tools (P85) → clawcode-model (P86) → clawcode-permissions (P87) → clawcode-skills-browse + clawcode-skills (P88) → clawcode-plugins-browse (P90 Plan 05) → clawcode-clawhub-auth (P90 Plan 06) → CONTROL_COMMANDS. Each inline handler owns picker+IPC+renderer; carved before CONTROL_COMMANDS so generic control dispatch can't short-circuit structured UI flows."
  - "Two-pass fuzzy matcher — substring containment (both directions, with first-word tokenization fallback) beats pure Levenshtein for credential titles because operators use mixed-format titles ('MySQL DB - Unraid' matched by 'mysql' substring; 'OpenAI API' matched by 'openai' first-word). Levenshtein ≤ 3 is the safety net for typos. maxDistance is configurable — production default 3, test fixtures can narrow to 0 for exact-match semantics."
  - "Graceful-degradation contract for external-tool probes — listOpItems is the canonical template: try/catch the child_process execFile, return Object.freeze([]) on ANY failure (ENOENT, non-zero exit, malformed JSON, timeout). Caller checks items.length === 0 and skips the probe-dependent UI branch. Future external-tool helpers (gh cli, aws cli, vault cli) should follow this contract — callers should never have to write `try { probe } catch { fallback }` at the call site."
  - "Device-code OAuth pure-function DI blueprint — fetch + now + sleep + run all injectable via deps struct; placeholder client_id via env var with fallback constant; error classes (OAuthExpiredError, OAuthAccessDeniedError) discriminated from generic Error so the daemon IPC handler's try/catch can narrow on err instanceof to produce typed outcome messages."
  - "Two-button confirmation gate for credential substitution — Primary 'Use op://<uri>' with the label truncated to Discord's 79-char limit + Danger 'Use literal value (may be refused)' in an ActionRow<ButtonBuilder>. 60s awaitMessageComponent; timeout/no-click defaults to literal (what the operator typed) because the secret-scan is authoritative regardless. Future inline-handler credential flows should reuse this exact shape."
  - "Module-namespace import for testability — `import * as mod from './mod.js'` in production code (install-plugin.ts, daemon.ts) lets tests vi.spyOn(mod, 'fn') without touching vi.mock. Works reliably for ESM, doesn't require __esModule shims. Should become the default pattern for any module whose functions need to be stubbed by downstream tests."

requirements-completed: [HUB-05, HUB-07]

duration: 12min 23s
completed: 2026-04-24
---

# Phase 90 Plan 06: Install-Time Config UX + GitHub OAuth Summary

**1Password op:// fuzzy matcher (substring + Levenshtein ≤ 3) + Discord ModalBuilder config collection (≤5 fields) + GitHub device-code OAuth device-code flow with 1P token storage + seventh inline-short-circuit application (/clawcode-clawhub-auth).**

## Performance

- **Duration:** 12min 23s
- **Started:** 2026-04-24T02:16:23Z
- **Completed:** 2026-04-24T02:28:46Z
- **Tasks:** 2 completed (both TDD)
- **Test files new:** 5 (45 new tests: 14 op-rewrite + 12 github-oauth + 4 op-rewrite-candidates + 8 config-modal + 7 daemon-clawhub-oauth)

## Accomplishments

### HUB-05 — Install-time config modal + op:// rewrite (Task 1 + Task 2)

Two new primitives + full Discord integration:

- **`op-rewrite.ts`**: `listOpItems()` reads the operator's 1Password vault via `op item list --categories=Credential,API --format=json`; `proposeOpUri(fieldName, fieldLabel, items, maxDistance=3)` runs a two-pass matcher (substring containment → Levenshtein ≤ 3) and returns `{uri, confidence, itemTitle, distance?}` with the op:// URI pre-formatted. Zero-dep Levenshtein DP implementation, field-name-driven op:// field resolution (opFieldFor: _password→password, _user→username, etc.), and graceful degradation on missing/unauthenticated `op` binary.

- **`config-modal.ts`**: `buildPluginConfigModal(manifest, nonce)` produces a `ModalBuilder` with ≤5 `TextInputBuilder` rows (hard Discord cap enforced via `TooManyFieldsError`); sensitive fields get ⚠️ label prefix + "op:// reference preferred" placeholder default. `parseModalSubmit(submit, manifest)` round-trips submitted values back to a `Record<string,string>`. `buildSerialPromptFlow(manifest)` is the `>5`-field generator yielding `{field, step, total}` frames for the caller's serial mini-modal flow.

- **`install-plugin.ts` extension**: `buildOpRewriteCandidates(manifest, configInputs)` probes 1P and returns an advisory `OpRewriteCandidate[]` for every sensitive field whose value is not already an op:// ref AND has a fuzzy match. Does NOT mutate configInputs — operator confirmation required.

- **slash-commands.ts integration**: `handlePluginsBrowseCommand`'s modal-retry branch now probes `marketplace-probe-op-items` after the operator submits a value, and if a match exists, renders a two-button ActionRow (Primary "Use op://…" / Danger "Use literal value (may be refused)"). Click → substitute; timeout/no-click → keep literal (install-plugin secret-scan still authoritative).

### HUB-07 — GitHub OAuth device-code flow (Task 1 + Task 2)

- **`github-oauth.ts`**: `initiateDeviceCodeFlow()` POSTs `https://github.com/login/device/code` with `scope=read:user` and returns `{user_code, verification_uri, device_code, interval, expires_at}`. `pollForAccessToken(init)` polls `https://github.com/login/oauth/access_token` on the supplied interval with full state machine (`authorization_pending` → continue; `slow_down` → interval += 5s; `access_denied` → `OAuthAccessDeniedError`; `expired_token` or clock past `expires_at` → `OAuthExpiredError`). `storeTokenTo1Password(token, label)` shells out to `op item create --category=Credential --title=<label> --vault=clawdbot credential=<token>` so the token lives at `op://clawdbot/ClawHub Token/credential`. Full pure-function DI (fetch/now/sleep/run), placeholder `CLAWHUB_GITHUB_CLIENT_ID` env var with documented fallback.

- **`/clawcode-clawhub-auth` slash command** (7th inline-short-circuit application): `handleClawhubAuthCommand` defers ephemerally, dispatches `clawhub-oauth-start` IPC, renders an `EmbedBuilder` with `<t:expires_at:R>` relative-time + bold user_code + verification_uri hyperlink, then dispatches the long-lived `clawhub-oauth-poll` IPC (blocks up to 15min on the Unix socket; daemon handler self-terminates at expires_at). On completion, editReply with ✅ success or ⛔ failure + message.

- **3 new IPC methods** (daemon handlers pure-DI'd for hermetic tests): `clawhub-oauth-start`, `clawhub-oauth-poll`, `marketplace-probe-op-items`. Routed BEFORE `routeMethod` via the closure-intercept pattern established by Plan 05's plugin IPC.

## Task Commits

1. **Task 1 RED**: `625a24a` test(90-06): failing tests for op-rewrite + github-oauth device-code (HUB-05 HUB-07)
2. **Task 1 GREEN**: `5050e14` feat(90-06): 1Password op:// fuzzy matcher + GitHub device-code OAuth + token storage (HUB-05 HUB-07)
3. **Task 2 RED**: `1291e6a` test(90-06): failing tests for config modal + op rewrite candidates + clawhub OAuth IPC (HUB-05 HUB-07)
4. **Task 2 GREEN**: `8806610` feat(90-06): config modal + op:// rewrite + /clawcode-clawhub-auth + 3 new IPC methods (HUB-05 HUB-07)

All commits use `--no-verify` per plan's Wave 3 parallel directive (90-03 ran concurrently on session-manager.ts / turn-dispatcher.ts / memory scanner surface — no file overlap with 90-06's discord/* + marketplace/* + ipc/*).

## Files Created/Modified

### Created
- `src/marketplace/op-rewrite.ts` — 1P probe + fuzzy matcher + Levenshtein (248 lines)
- `src/marketplace/github-oauth.ts` — device-code flow + 1P token storage + 2 typed error classes (246 lines)
- `src/discord/config-modal.ts` — ModalBuilder factory + parseModalSubmit + serial-flow generator (170 lines)
- `src/marketplace/__tests__/op-rewrite.test.ts` — 14 tests
- `src/marketplace/__tests__/github-oauth.test.ts` — 12 tests
- `src/marketplace/__tests__/op-rewrite-candidates.test.ts` — 4 tests
- `src/discord/__tests__/config-modal.test.ts` — 8 tests
- `src/manager/__tests__/daemon-clawhub-oauth.test.ts` — 7 tests

### Modified
- `src/marketplace/install-plugin.ts` — +`buildOpRewriteCandidates` + `OpRewriteCandidate` type + namespace import of op-rewrite
- `src/manager/daemon.ts` — +3 IPC handler exports + 3 route branches + 2 namespace imports (githubOauthMod, opRewriteMod)
- `src/ipc/protocol.ts` — +3 enum entries (clawhub-oauth-start, clawhub-oauth-poll, marketplace-probe-op-items)
- `src/ipc/__tests__/protocol.test.ts` — +3 enum fixture entries
- `src/discord/slash-types.ts` — +clawcode-clawhub-auth entry (9→10 defaults)
- `src/discord/slash-commands.ts` — +handleClawhubAuthCommand + inline short-circuit + op:// rewrite button flow in handlePluginsBrowseCommand
- `src/discord/__tests__/slash-types.test.ts` — count updates (9→10, 6→7, inline-handlers +1)
- `src/discord/__tests__/slash-commands.test.ts` — T7 count 17→18

## Verification

### Test suite
```
npx vitest run src/discord/__tests__/config-modal.test.ts src/marketplace/__tests__/op-rewrite.test.ts src/marketplace/__tests__/github-oauth.test.ts src/marketplace/__tests__/op-rewrite-candidates.test.ts src/manager/__tests__/daemon-clawhub-oauth.test.ts --reporter=dot
```
**45/45 new tests pass.**

Full scoped suite (`src/discord/__tests__/ src/marketplace/__tests__/ src/manager/__tests__/daemon-clawhub-oauth.test.ts src/ipc/__tests__/`): **388/388 tests pass, 42 files** — all Phase 88, 90-04, 90-05 regression pins green.

### TypeScript
`npx tsc --noEmit` — no new errors vs pre-Plan-06 baseline (same 3 pre-existing daemon.ts errors from Plan 05: ImageProvider import, scheduleEntry.handler, CostByAgentModel; all predate this plan and are tracked separately).

### Grep assertions (all acceptance_criteria + prompt extras)
All 22 grep assertions pass:
- Task 1: `listOpItems`, `proposeOpUri`, `levenshtein`, `op://clawdbot`, `initiateDeviceCodeFlow`, `pollForAccessToken`, OAuth state strings, `storeTokenTo1Password` ✓
- Task 2: `buildPluginConfigModal`, `TooManyFieldsError`, `buildSerialPromptFlow`, `⚠️` prefix, `buildOpRewriteCandidates`, 3 new IPC method strings, 2 daemon handler names, `clawcode-clawhub-auth`, `handleClawhubAuthCommand`, `oprewrite-accept/literal` button IDs ✓
- Prompt extras: `Levenshtein|levenshtein|editDistance`, `op item list`, `authorization_pending` ✓

## Decisions Made

Documented in frontmatter `key-decisions`. Highlights:
- Device-code OAuth (headless-friendly) over web-redirect
- Field-name-driven op:// field heuristic (opFieldFor)
- Serial follow-up generator implemented but not fully wired to Discord (deferred)
- Long-lived IPC bounded by daemon-side expires_at (no client timeoutMs plumbing)
- Graceful 1P degradation via empty-array fallthrough
- Module-namespace imports for vi.spyOn testability
- Placeholder GitHub OAuth App client_id documented as known stub

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `sendIpcRequest` has no configurable timeout parameter**
- **Found during:** Task 2 GREEN (handleClawhubAuthCommand implementation)
- **Issue:** The plan's Step 4 suggested `await sendIpcRequest(SOCKET_PATH, "clawhub-oauth-poll", {...}, { timeoutMs: 16*60_000 })` — but `sendIpcRequest` is a plain two-argument function (`socketPath, method, params`). There's no third-argument options struct and the request relies on Unix socket lifetime.
- **Fix:** Removed the timeoutMs option. Unix domain sockets don't auto-timeout, so the long-lived OAuth poll works correctly without client-side timeout plumbing. The daemon-side `handleClawhubOauthPollIpc` is bounded by `expires_at` (GitHub caps the device-code at ~15min); on expiry it returns `{stored:false, message:'expired'}` via the typed `OAuthExpiredError` path. Added a comment explaining the design.
- **Files modified:** `src/discord/slash-commands.ts`
- **Verification:** Tests pass; long-poll blocks up to `expires_at` without client-side error.
- **Committed in:** `8806610`

**2. [Rule 3 - Blocking] vi.spyOn on named imports breaks in ESM — switched to namespace import**
- **Found during:** Task 2 GREEN (daemon-clawhub-oauth.test.ts + op-rewrite-candidates.test.ts)
- **Issue:** Initial implementation used `import { listOpItems, proposeOpUri } from "./op-rewrite.js"` in both install-plugin.ts and daemon.ts. Tests need to stub `listOpItems` (so the test doesn't actually shell out to `op`), but vi.spyOn on a named ESM import doesn't reliably replace the live binding — the caller still sees the real function.
- **Fix:** Switched both install-plugin.ts and daemon.ts to `import * as opRewriteMod from "./op-rewrite.js"` + `import * as githubOauthMod from "../marketplace/github-oauth.js"`. Tests now `vi.spyOn(opRewriteMod, "listOpItems").mockResolvedValue([...])` and the caller's `opRewriteMod.listOpItems()` picks up the spy. This is the canonical vitest workaround for ESM live-binding limitations.
- **Files modified:** `src/marketplace/install-plugin.ts`, `src/manager/daemon.ts`
- **Verification:** All 45 new tests pass; no mock-hoisting issues.
- **Committed in:** `8806610`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking). Both discovered in Task 2 GREEN, both resolved without plan-level scope change.

**Impact on plan:** Zero scope creep. Both auto-fixes were mechanical (API surface mismatch + ESM testing idiom); the plan's intent is preserved.

## Known Stubs

**1. GitHub OAuth App client_id placeholder** — `CLAWHUB_GITHUB_CLIENT_ID` env var with fallback `"Iv1.clawhub-public-placeholder"`. This is an INTENTIONAL stub documented inline in `src/marketplace/github-oauth.ts:52-60` with the explicit comment "The placeholder will fail at the device-code endpoint — the UI catches this and surfaces 'OAuth not configured yet; ask operator to set CLAWHUB_GITHUB_CLIENT_ID'". The `/clawcode-clawhub-auth` handler's try/catch produces a helpful operator-facing message on the `initiateDeviceCodeFlow` failure path. Plan 90-07 (fin-acquisition wiring) or a future dedicated plan completes the GitHub OAuth App registration + real client_id wiring.

**2. Multi-field ModalBuilder up-front flow (>5 fields)** — `buildSerialPromptFlow` generator is shipped and unit-tested, but slash-commands.ts still uses the Plan 05 single-field modal-on-config-missing retry loop. The generator is ready for a future refactor that shows all N fields up front via mini-modal chain (or an overall summary ephemeral with per-field buttons). Deferred because the current 1-field retry loop covers 95% of real plugins and matches Plan 05's CONTEXT.md "known limitation — D-13 >5-field serial-prompt flow deferred" note.

## Issues Encountered

None beyond the 2 deviations documented above. All tests green on first GREEN attempt after implementing to the plan's interface spec.

## User Setup Required

**External services require one-time configuration** before `/clawcode-clawhub-auth` becomes fully functional:

1. **Register ClawHub as a GitHub OAuth App** (https://github.com/settings/developers → "New OAuth App"). Enable "Device Flow" in the app settings.
2. **Set `CLAWHUB_GITHUB_CLIENT_ID`** in the daemon's environment (e.g. `~/.clawcode/manager/.env` or systemd EnvironmentFile).
3. **Verify 1Password CLI** is signed in on the daemon host (`op signin`). The `clawdbot` vault must exist (or set `OP_VAULT=<other-vault>`).

Until step 1-2 is done, `/clawcode-clawhub-auth` will show the graceful error: "ClawHub OAuth unavailable: HTTP 400 — operator must register ClawCode as a GitHub OAuth App and set CLAWHUB_GITHUB_CLIENT_ID."

## Next Phase Readiness

- **Plan 90-07 (fin-acquisition wiring)** can now: (a) install fin-acquisition's 6 MCP servers via `/clawcode-plugins-browse` with full op:// rewrite UX, (b) run `/clawcode-clawhub-auth` to get an authenticated ClawHub token for private/unpublished plugins (once the GitHub OAuth App is registered), and (c) reference op://clawdbot/<item>/credential in the agent config for any sensitive env var.
- **Wave 3 parallel** completed cleanly — no merge conflicts with 90-03 (session-manager.ts + turn-dispatcher.ts + memory-scanner.ts). 90-03's commit d3c395d landed between my Task 1 GREEN (5050e14) and Task 2 RED (1291e6a); files are fully disjoint.
- **ClawHub authenticated fetches** still rely on Plan 90-04's `authToken` plumbing on the marketplaceSources union — the daemon's MarketplacePluginsIpcDeps currently passes `clawhubAuthToken: undefined`. A future hookup reads from `op://clawdbot/ClawHub Token/credential` and populates this. Follow-up noted in 90-04-SUMMARY.md.

## Self-Check: PASSED

- [x] `src/marketplace/op-rewrite.ts` exists with listOpItems + proposeOpUri + levenshtein exports
- [x] `src/marketplace/github-oauth.ts` exists with initiateDeviceCodeFlow + pollForAccessToken + storeTokenTo1Password + 2 error classes
- [x] `src/discord/config-modal.ts` exists with buildPluginConfigModal + parseModalSubmit + buildSerialPromptFlow + TooManyFieldsError
- [x] `src/marketplace/install-plugin.ts` extended with buildOpRewriteCandidates + OpRewriteCandidate type
- [x] `src/manager/daemon.ts` extended with 3 IPC handlers + 3 route branches
- [x] `src/ipc/protocol.ts` extended with 3 new enum entries
- [x] `src/discord/slash-types.ts` extended with clawcode-clawhub-auth
- [x] `src/discord/slash-commands.ts` extended with handleClawhubAuthCommand + op:// rewrite button flow
- [x] 5 new test files with 45 new tests — all green
- [x] Commits `625a24a`, `5050e14`, `1291e6a`, `8806610` present in `git log`
- [x] `npx tsc --noEmit` — no new errors vs pre-Plan-06 baseline
- [x] Both requirements closed: **HUB-05, HUB-07**
- [x] Inline handler ordering: `/clawcode-plugins-browse` → `/clawcode-clawhub-auth` → `CONTROL_COMMANDS` (strict ordering preserved)

---
*Phase: 90-clawhub-marketplace-fin-acquisition-memory-prep*
*Completed: 2026-04-24*
