# Phase 93: Status-detail parity + ClawHub public-catalog defaults + plugin manifest-URL resilience - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

Three bundled fixes addressing user-reported gaps in the fin-acquisition Discord workflow (2026-04-24):

1. **93-01** — Restore the rich `/clawcode-status` output deferred in Phase 83 EFFORT-07. Match the OpenClaw `/status` field set: version+commit, model+key-source, fallbacks, context fill + compactions, session ID + updated time, runtime/runner/think/elevated, activation mode + queue depth.
2. **93-02** — Auto-inject `defaults.clawhubBaseUrl` as a synthetic ClawHub catalog source in `loadMarketplaceCatalog` so `/clawcode-skills-browse` surfaces public ClawHub skills by default (today: local-only unless an explicit `marketplaceSources[{kind:"clawhub"}]` entry is configured).
3. **93-03** — Distinguish "manifest 404 / unpublished" from "manifest malformed" in the plugin-install pipeline. Today, plugins listed on ClawHub without a fetchable manifest (e.g. `hivemind`) surface as misleading "manifest is invalid" errors; this phase routes them to a clearer `manifest-unavailable` outcome.

**IN scope:** code changes across `src/discord/slash-commands.ts`, `src/marketplace/catalog.ts`, `src/marketplace/clawhub-client.ts`, `src/marketplace/install-plugin.ts`, `src/manager/daemon.ts`, plus tests + Discord UI string updates.

**OUT of scope:** OAuth integration for skill-side ClawHub auth (Phase 90-06 territory); publishing the `hivemind` plugin manifest to ClawHub (registry-side / external operator action); plumbing real-time token counters through the daemon (deferred — see 93-01 decision below).

</domain>

<decisions>
## Implementation Decisions

### 93-01 — Status-detail command shape

- **Replace `/clawcode-status`** with the rich OpenClaw-parity block. No second `/clawcode-status-detail` command. Single source of truth; matches the user's stated view that the current 3-line output is "too thin".
- **Context-fill + compactions: ship as MVP with placeholders.** When the session handle does not expose running token counters or compaction count (current state), the status renders `Context: unknown · Compactions: n/a`. Do NOT plumb new token-counter infrastructure through the daemon in this phase — that belongs in a follow-up. Rationale: ships UX parity now; defers the ~200-line daemon detour.
- **Session ID display: prefer abbreviated form** (last 12 chars of the session-key after the channel prefix; full key still available via tooltip / future `/clawcode-session-id`). OpenClaw uses the full key but truncating keeps the embed compact in Discord's narrow ephemeral surface.
- **Updated-time format: relative** (`updated 24m ago`) using a tiny in-process formatter (no new deps; date-fns is already in the project — confirm in plan).
- Output ALL of these lines unconditionally; mark genuinely-unavailable fields as `unknown` rather than omitting (operators learn the schema once).

### 93-02 — ClawHub public-catalog default injection

- **Auto-inject behavior:** in `loadMarketplaceCatalog`, when `opts.sources` does NOT contain any `{kind:"clawhub"}` entry AND `opts.defaultClawhubBaseUrl` is provided, synthesize one before the source-iteration loop. Synthetic source carries no `authToken` (public access only). Honors the existing `cacheTtlMs` default.
- **Plumbing path:** `MarketplaceIpcDeps` grows one optional field `defaultClawhubBaseUrl?: string`. `daemon.ts` `handleMarketplaceListIpc` passes `config.defaults.clawhubBaseUrl`. `loadMarketplaceCatalog` accepts and forwards it.
- **UI surface — dropdown section headers:** in `/clawcode-skills-browse`, render local skills first, then a visual separator option (e.g. label `── ClawHub public ──`, description `(category divider)`, value `__separator_clawhub__`), then ClawHub-sourced skills. The separator is non-installable — slash handler filters it out of `marketplace-install` calls; if a user picks it (rare, since it looks like a section break), respond with an ephemeral "pick a skill, not the divider".
  - Plan should research StringSelectMenu rendering quirks: Discord may render disabled/non-functional options identically to selectable ones; the divider should be visually distinct (heavy unicode hyphens, no description-as-skill).
- **No duplication:** if an explicit `{kind:"clawhub"}` entry is already present, do NOT inject a synthetic one (regardless of baseUrl match).
- **Back-compat:** if `defaultClawhubBaseUrl` is undefined OR sources already include a clawhub entry, behavior is identical to today.

### 93-03 — Plugin manifest-URL resilience + clearer 404

- **New error class:** `ClawhubManifestNotFoundError` in `clawhub-client.ts`, thrown when `downloadClawhubPluginManifest` receives HTTP 404. Sibling to the existing `ClawhubManifestInvalidError` / `ClawhubRateLimitedError` / `ClawhubAuthRequiredError`.
- **New outcome variant:** `{ kind: "manifest-unavailable", plugin, manifestUrl, status }` in the `PluginInstallOutcome` union. Distinct from `manifest-invalid` (truly malformed body) and `not-in-catalog` (plugin name not in list).
- **Mapping:** `mapFetchErrorToOutcome` adds a branch for `ClawhubManifestNotFoundError` → `manifest-unavailable`.
- **Discord UI copy:** `'**${plugin}** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin.'` Technical but accurate; doesn't claim the manifest is malformed.
- **URL-shape investigation:** during plan-phase research, probe `https://clawhub.ai/api/v1/plugins/hivemind/manifest` and 2-3 sibling shapes (`.../plugins/hivemind`, `.../plugins/hivemind.json`, `.../plugins/hivemind/v1/manifest`) to confirm whether the fallback URL construction at `daemon.ts:1045` is correct. If a different shape works, fix the fallback. If hivemind genuinely lacks a manifest at every probed shape, the registry is the source of truth and 93-03 stays as pure UX-resilience work.
- **Prefer `item.manifestUrl` unconditionally:** current code already does (`item.manifestUrl ?? fallback`). No change needed there. Add a unit test that the fallback path is only taken when `manifestUrl` is undefined.

### Claude's Discretion

- Test surface: each sub-plan ships with vitest unit tests in the existing per-module `__tests__/` directories. Specific test count per sub-plan is at planner's discretion based on coverage gaps.
- Commit granularity: one commit per sub-plan minimum; can be split further by planner.
- Section-header visual treatment for 93-02 (exact unicode chars, label format) is at planner/implementer discretion as long as it visually separates from real skill entries.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/discord/slash-commands.ts:889` — current `/clawcode-status` daemon-side handler. Pulls effort + model from session manager. Direct extension point for 93-01.
- `src/manager/session-manager.ts` / `session-adapter.ts` — `getEffortForAgent` / `getModelForAgent` patterns. New methods needed: `getSessionIdForAgent`, `getLastActivityForAgent`, `getRuntimeInfoForAgent`, `getQueueDepthForAgent`. Fall back to "unknown" when unavailable.
- `src/marketplace/catalog.ts:202` — `loadMarketplaceCatalog` already iterates `opts.sources` with `kind: "clawhub"` discrimination; injection point is right before line 244 (the source loop).
- `src/marketplace/clawhub-client.ts:526` — `downloadClawhubPluginManifest` already has 429/401-403/!ok branches; adding the 404-specific branch is a 5-line change.
- `src/marketplace/install-plugin.ts:343` — `mapFetchErrorToOutcome` is the dispatch point for new outcome variants.
- `src/discord/slash-commands.ts:407` — `renderPluginInstallOutcome` switch must grow a new case for `manifest-unavailable`.
- `package.json` — `date-fns@4.x` already a dependency (per CLAUDE.md stack). Reuse for relative-time formatting in 93-01.

### Established Patterns
- Daemon IPC handlers follow the closure-intercept pattern (daemon.ts:2185–2235): pre-route by method name, dispatch to pure handler functions, deps passed as a single object.
- `MarketplaceIpcDeps` is the contract surface for marketplace IPC; growing it is the natural way to wire `defaultClawhubBaseUrl`.
- ClawCode error classes extend native Error with a `kind` discriminant on the outcome union; map errors → outcomes via a single dedicated function (`mapFetchErrorToOutcome`).
- Discord interactions use ephemeral replies via `interaction.editReply` after `deferReply({ephemeral: true})`. All 93-* user-facing strings follow this pattern.
- Tests live in `__tests__/` directories alongside the module under test; vitest, no separate integration directory.

### Integration Points
- 93-01 reads from `SessionManager` (persistent-session-handle.ts) and `ResolvedAgentConfig` (config/loader.ts). Writes to nothing — pure read.
- 93-02 reads `config.defaults.clawhubBaseUrl` (config/schema.ts:907). Plumbs through `handleMarketplaceListIpc` (daemon.ts:669) → `loadMarketplaceCatalog` (catalog.ts:202).
- 93-03 reads from ClawHub HTTP API; writes a new error class + outcome variant. UI surface in `slash-commands.ts:407` (renderPluginInstallOutcome).

</code_context>

<specifics>
## Specific Ideas

- 93-01 reference output: see screenshots from operator on 2026-04-24 (`/status` from OpenClaw clawdy bot) — version line uses 🦞 emoji, model line 🧠, fallbacks 🔄, etc. Mirror the emoji set for visual parity. Operator explicitly noted "We need more detail in there" comparing the two side-by-side.
- 93-03 user error path: operator ran `/clawcode-plugins-browse` → picked `hivemind` from the dropdown → saw `**hivemind** manifest is invalid: clawhub plugin manifest: 404 Not Found.` (edited). The "manifest is invalid" phrasing was the friction point.
- 93-02 user observation: operator ran `/clawcode-skills-browse` → saw only their existing/local skills, none from `clawhub.ai`.

</specifics>

<deferred>
## Deferred Ideas

- Plumbing real-time token counters + compaction count through the daemon (so `Context:` and `Compactions:` lines in 93-01 status output show real numbers instead of `unknown`/`n/a`). Future phase. Estimated: session-handle interface change + daemon IPC method `get-context-stats` + per-session token accumulator hook.
- Per-agent ClawHub auth tokens for skills (currently the synthetic source ships no `authToken`, so private/auth-required skills aren't visible). This is Phase 90-06 territory (GitHub OAuth flow already lands plugin auth there).
- Publishing the `hivemind` manifest to ClawHub itself (registry-side, external operator action — not ClawCode code).
- A `/clawcode-status-detail` second command if the replaced `/clawcode-status` proves too verbose for some use cases. Not adding now — single command is cleaner.

</deferred>
