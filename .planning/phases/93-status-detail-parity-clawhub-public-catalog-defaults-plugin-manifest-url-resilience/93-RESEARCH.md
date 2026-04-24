# Phase 93: Status-detail parity + ClawHub public-catalog defaults + plugin manifest-URL resilience — Research

**Researched:** 2026-04-24
**Domain:** Discord slash-command UX (status output) + marketplace catalog plumbing + ClawHub HTTP error mapping
**Confidence:** HIGH (codebase-internal probes + live HTTP probes against clawhub.ai + decompiled OpenClaw status-message module)

## Summary

Three bundled fixes, all narrow surface-area, no new dependencies. The phase reuses well-trodden patterns:

1. **93-01 (status parity)** — Replace the 3-line `/clawcode-status` daemon short-circuit at `slash-commands.ts:889-913` with a multi-line block mirroring the OpenClaw status format. The OpenClaw structure is fully recovered from the installed `openclaw` npm package's `dist/status-message-BKSo537O.js` file: a 17-element array filtered through `Boolean` and joined with `\n`. Many ClawCode-side fields legitimately render as `unknown`/`n/a`/`—` because they have no equivalent (no per-handle token counter, no `runner`/`think`/`elevated`/`activation`/`queue` schema fields). This is the locked decision — research confirms there is no zero-cost way to plumb context-fill or compaction count without a daemon detour, so placeholder-with-honest-label is the right MVP.
2. **93-02 (auto-inject ClawHub default)** — `resolveMarketplaceSources` already produces `ResolvedMarketplaceSources` with `{kind:"clawhub", baseUrl}` discrimination; `loadMarketplaceCatalog` already iterates and dispatches on `kind`. Injection is a single-line additive change inside `loadMarketplaceCatalog` before its `for (const source of opts.sources)` loop, gated on `opts.defaultClawhubBaseUrl !== undefined && !opts.sources.some(s => "kind" in s && s.kind === "clawhub")`. `MarketplaceIpcDeps` grows one optional field; `handleMarketplaceListIpc` passes `config.defaults.clawhubBaseUrl` (which already has zod default `https://clawhub.ai`).
3. **93-03 (404 vs invalid manifest)** — Live probes confirm the registry **never** serves a manifest at any URL shape for `hivemind` (every `/api/v1/plugins/hivemind*` URL returns 404). The list-endpoint response carries NO `manifestUrl` field — the daemon's fallback URL construction is the only path, and it dead-ends at 404. So 93-03 is pure UX-resilience work: route the 404 case through a new `ClawhubManifestNotFoundError` → `manifest-unavailable` outcome variant with copy that doesn't blame "invalid manifest".

**Primary recommendation:** Follow the locked CONTEXT.md decisions verbatim. Patterns are well-established in the codebase — every plumbing change has direct precedent in Phase 88/90. Zero new deps; zero schema-additive fields beyond `MarketplaceIpcDeps.defaultClawhubBaseUrl?` and the new error class.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 93-01 — Status-detail command shape
- **Replace `/clawcode-status`** with the rich OpenClaw-parity block. No second `/clawcode-status-detail` command. Single source of truth.
- **Context-fill + compactions: ship as MVP with placeholders.** Renders `Context: unknown · Compactions: n/a`. Do NOT plumb new token-counter infrastructure through the daemon in this phase.
- **Session ID display: prefer abbreviated form** (last 12 chars of the session-key after the channel prefix).
- **Updated-time format: relative** (`updated 24m ago`) using a tiny in-process formatter (no new deps; date-fns is already in the project — confirm in plan).
- Output ALL of these lines unconditionally; mark genuinely-unavailable fields as `unknown` rather than omitting.

#### 93-02 — ClawHub public-catalog default injection
- **Auto-inject behavior:** in `loadMarketplaceCatalog`, when `opts.sources` does NOT contain any `{kind:"clawhub"}` entry AND `opts.defaultClawhubBaseUrl` is provided, synthesize one before the source-iteration loop. Synthetic source carries no `authToken`. Honors existing `cacheTtlMs` default.
- **Plumbing path:** `MarketplaceIpcDeps` grows one optional field `defaultClawhubBaseUrl?: string`. `daemon.ts` `handleMarketplaceListIpc` passes `config.defaults.clawhubBaseUrl`. `loadMarketplaceCatalog` accepts and forwards.
- **UI surface — dropdown section headers:** in `/clawcode-skills-browse`, render local skills first, then a visual separator option (label `── ClawHub public ──`, description `(category divider)`, value `__separator_clawhub__`), then ClawHub-sourced skills. Slash handler filters separator out of `marketplace-install` calls; ephemeral "pick a skill, not the divider" on accidental selection.
- **No duplication:** if an explicit `{kind:"clawhub"}` entry is already present, do NOT inject a synthetic one (regardless of baseUrl match).
- **Back-compat:** if `defaultClawhubBaseUrl` is undefined OR sources already include a clawhub entry, behavior is identical to today.

#### 93-03 — Plugin manifest-URL resilience + clearer 404
- **New error class:** `ClawhubManifestNotFoundError` in `clawhub-client.ts`, thrown when `downloadClawhubPluginManifest` receives HTTP 404. Sibling to `ClawhubManifestInvalidError` / `ClawhubRateLimitedError` / `ClawhubAuthRequiredError`.
- **New outcome variant:** `{ kind: "manifest-unavailable", plugin, manifestUrl, status }` in the `PluginInstallOutcome` union.
- **Mapping:** `mapFetchErrorToOutcome` adds a branch for `ClawhubManifestNotFoundError` → `manifest-unavailable`.
- **Discord UI copy:** `'**${plugin}** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin.'`
- **Prefer `item.manifestUrl` unconditionally** (current code already does). Add a unit test that the fallback path is only taken when `manifestUrl` is undefined.

### Claude's Discretion
- Test surface: each sub-plan ships with vitest unit tests in the existing per-module `__tests__/` directories. Specific test count per sub-plan is at planner's discretion based on coverage gaps.
- Commit granularity: one commit per sub-plan minimum; can be split further by planner.
- Section-header visual treatment for 93-02 (exact unicode chars, label format) is at planner/implementer discretion as long as it visually separates from real skill entries.

### Deferred Ideas (OUT OF SCOPE)
- Plumbing real-time token counters + compaction count through the daemon (so `Context:` and `Compactions:` lines in 93-01 status output show real numbers). Future phase.
- Per-agent ClawHub auth tokens for skills (synthetic source ships no `authToken`). Phase 90-06 territory.
- Publishing the `hivemind` manifest to ClawHub itself. Registry-side, external operator action.
- A `/clawcode-status-detail` second command if `/clawcode-status` proves too verbose. Not adding now.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **File size:** prefer 200-400 lines, 800 max. `slash-commands.ts` is already 108KB / ~2400 lines — adding the rich status renderer SHOULD extract into a new module (e.g. `src/discord/status-render.ts`) rather than growing the slash-commands file further.
- **Immutability:** ALL data structures must be created fresh, never mutated. Outcome unions stay frozen via `Object.freeze`.
- **No mutation of existing objects:** When extending `PluginInstallOutcome` or `MarketplaceIpcDeps`, return new shapes; do not patch in place.
- **Granular files:** Status assembler should live in its own file with focused responsibility (status data shape, formatter, emoji map).
- **Error handling:** Render outcomes through exhaustive switches with `never` sample branches (existing pattern at `slash-commands.ts:295` and `:407`).
- **Input validation:** continue to validate IPC params via `validateStringParam` (existing helper).
- **Security:** No literal secrets; the synthetic ClawHub source carries no `authToken` (locked decision matches the security rule by construction).
- **GSD workflow:** every change goes through `/gsd:execute-phase` — do not edit src/ outside the GSD pipeline.

## Phase Requirements

> Phase added outside the formal milestone requirements process. Track sub-plan IDs (no REQ-IDs).

| Sub-Plan ID | Description | Research Support |
|-------------|-------------|------------------|
| 93-01 | Restore rich `/clawcode-status` output (OpenClaw parity, n/a placeholders for unsupplied fields) | Reference structure recovered from installed openclaw npm dist; existing daemon short-circuit at `slash-commands.ts:889`; date-fns 4.x available with `formatDistanceToNow` |
| 93-02 | Auto-inject `defaults.clawhubBaseUrl` as synthetic ClawHub source in `loadMarketplaceCatalog` | `MarketplaceIpcDeps` shape at `daemon.ts:621-638`; loader iteration loop at `catalog.ts:244-279`; `defaults.clawhubBaseUrl` zod-defaulted to `https://clawhub.ai` at `schema.ts:907`; existing `handleSkillsBrowseCommand` at `slash-commands.ts:1684` is the dropdown render site |
| 93-03 | Distinguish 404 from invalid-manifest in plugin install (new `ClawhubManifestNotFoundError` + `manifest-unavailable` outcome) | Live HTTP probes confirm hivemind manifest 404 at every URL shape; existing error class hierarchy at `clawhub-client.ts:108-141`; `mapFetchErrorToOutcome` at `install-plugin.ts:343`; renderer at `slash-commands.ts:407-449` |

## Standard Stack

### Core (already installed — zero new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `discord.js` | ^14.26.2 | StringSelectMenuBuilder, ChatInputCommandInteraction, ActionRowBuilder | Already the project's Discord surface |
| `date-fns` | ^4.1.0 | `formatDistanceToNow` for `updated 24m ago` rendering | Already imported in 6 other modules; no new dep |
| `zod` | ^4.3.6 | Schema additions if any | `MarketplaceIpcDeps` is a TS type, not a zod schema — likely no zod change needed |
| `pino` | ^9 | Structured logging on warn paths | Existing pattern |

### Supporting
None. Phase 93 is purely additive against the existing stack.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `date-fns/formatDistanceToNow` | Hand-rolled `formatTimeAgo(ms)` | OpenClaw uses a custom `formatTimeAgo`, but `date-fns` is already imported in `consolidation.ts`, `tiers.ts`, `usage/tracker.ts`, `usage/budget.ts`, `daemon.ts`, `screenshot.ts`. No reason to hand-roll when the helper is one import away. CONTEXT.md says "tiny in-process formatter (no new deps; date-fns is already in the project — confirm in plan)" — date-fns already in project, so use it. |
| New `ClawhubManifestNotFoundError` class | Add a `status` field to `ClawhubManifestInvalidError` | Locked decision. The discriminated outcome union pattern wants a distinct error class; mirrors `ClawhubRateLimitedError` / `ClawhubAuthRequiredError` exactly. |
| Discord StringSelectMenu category groups | (no native API) | Discord.js 14.x has no native option-grouping or section-header API in `StringSelectMenuBuilder`. The sentinel-value workaround is the only option (validated by Discord API spec — components.v2 has Section components but they don't apply inside select menus). |

**Installation:** None — every dependency is already pinned in `package.json`.

**Version verification (per CLAUDE.md research discipline):**
- `date-fns` 4.1.0: `npm view date-fns version` → confirmed; `formatDistanceToNow` exported at `node_modules/date-fns/formatDistanceToNow.js` (verified locally).
- `discord.js` 14.26.2: pinned, current. `StringSelectMenuOptionBuilder` exposes `setLabel/setValue/setDescription/setEmoji/setDefault` — NO `setDisabled` (only menu-level `setDisabled` exists).

## Architecture Patterns

### Recommended Project Structure (additive — no major rearrangement)

```
src/
├── discord/
│   ├── slash-commands.ts        # Existing — replace daemon short-circuit at L889 with new renderer call
│   ├── status-render.ts         # NEW — pure status-data → text formatter (extract from slash-commands.ts)
│   └── __tests__/
│       └── status-render.test.ts # NEW — unit tests for the formatter
├── marketplace/
│   ├── catalog.ts               # Existing — add defaultClawhubBaseUrl handling at LoadMarketplaceCatalogOpts + loop preamble
│   ├── clawhub-client.ts        # Existing — add ClawhubManifestNotFoundError class + 404 branch
│   ├── install-plugin.ts        # Existing — extend PluginInstallOutcome union + mapFetchErrorToOutcome branch
│   └── __tests__/
│       ├── catalog-clawhub-default.test.ts # NEW
│       ├── clawhub-client-manifest-404.test.ts # NEW
│       └── install-plugin-manifest-unavailable.test.ts # NEW
└── manager/
    └── daemon.ts                # Existing — extend MarketplaceIpcDeps + plumb defaultClawhubBaseUrl in handleMarketplaceListIpc
```

### Pattern 1: Daemon Short-Circuit Slash Handler (existing — applies to 93-01)
**What:** A slash command handled entirely daemon-side without an LLM turn. The current `/clawcode-status` already does this at `slash-commands.ts:876-913`.
**When to use:** When the data is authoritative server-side (handle.getEffort, handle.getModel, configs[].name) and should never block on the agent.
**Example (existing code, the integration point):**
```typescript
// Source: src/discord/slash-commands.ts:889
if (commandName === "clawcode-status") {
  try {
    const effort = this.sessionManager.getEffortForAgent(agentName);
    const liveModel = this.sessionManager.getModelForAgent(agentName);
    const configModel = this.resolvedAgents.find((a) => a.name === agentName)?.model ?? "(unknown)";
    const model = liveModel ?? configModel;
    await interaction.editReply(
      `📋 ${agentName}\n🤖 Model: ${model}\n🎚️ Effort: ${effort}`,
    );
  } catch (error) {
    /* ... */
  }
  return;
}
```
**93-01 task:** Replace the `interaction.editReply` body with a call to `renderStatus(buildStatusData({...}))` from a new `status-render.ts` module.

### Pattern 2: Discriminated-Union Outcome with Exhaustive Switch (existing — applies to 93-03)
**What:** Every install outcome is a frozen object with a `kind` literal. The renderer switches on `kind` exhaustively; TypeScript enforces completeness via the implicit `never` branch.
**When to use:** Adding any new outcome variant to either `SkillInstallOutcome` or `PluginInstallOutcome`.
**Example:**
```typescript
// Source: src/marketplace/install-plugin.ts:343-373
export function mapFetchErrorToOutcome(
  err: unknown,
  pluginName: string,
): PluginInstallOutcome {
  if (err instanceof ClawhubRateLimitedError) {
    return Object.freeze({ kind: "rate-limited" as const, plugin: pluginName, retryAfterMs: err.retryAfterMs });
  }
  if (err instanceof ClawhubAuthRequiredError) {
    return Object.freeze({ kind: "auth-required" as const, plugin: pluginName, reason: err.message });
  }
  if (err instanceof ClawhubManifestInvalidError) {
    return Object.freeze({ kind: "manifest-invalid" as const, plugin: pluginName, reason: err.message });
  }
  return Object.freeze({ kind: "manifest-invalid" as const, plugin: pluginName, reason: err instanceof Error ? err.message : String(err) });
}
```
**93-03 task:** Add a new branch BEFORE the generic `manifest-invalid` fallthrough:
```typescript
if (err instanceof ClawhubManifestNotFoundError) {
  return Object.freeze({
    kind: "manifest-unavailable" as const,
    plugin: pluginName,
    manifestUrl: err.manifestUrl,
    status: err.status,
  });
}
```

### Pattern 3: Closure-Intercept IPC Plumbing (existing — applies to 93-02)
**What:** Daemon IPC handlers close over typed deps and route via `if method === ...` BEFORE the generic `routeMethod`. New optional fields land on `MarketplaceIpcDeps`.
**When to use:** Adding a config-derived value to a marketplace IPC handler.
**Example:**
```typescript
// Source: src/manager/daemon.ts:2190-2212
if (
  method === "marketplace-list" ||
  method === "marketplace-install" ||
  method === "marketplace-remove"
) {
  const deps = {
    configs: resolvedAgents as ResolvedAgentConfig[],
    configPath,
    marketplaceSources: resolvedMarketplaceSources,
    localSkillsPath: skillsPath,
    skillsTargetDir: skillsPath,
    ledgerPath,
    log,
    params,
  };
  if (method === "marketplace-list") return handleMarketplaceListIpc(deps);
  /* ... */
}
```
**93-02 task:** Add `defaultClawhubBaseUrl: config.defaults.clawhubBaseUrl` to the `deps` literal. Extend `MarketplaceIpcDeps` to include `defaultClawhubBaseUrl?: string`. Extend `LoadMarketplaceCatalogOpts` similarly. Pass-through in `handleMarketplaceListIpc`.

### Anti-Patterns to Avoid
- **Plumbing token-counter infrastructure into 93-01.** Locked-out by CONTEXT.md. The decision is to ship `unknown`/`n/a` placeholders. Don't quietly add `getContextTokensForAgent` to SessionManager — that's the deferred follow-up phase.
- **Adding a `setDisabled` separator option.** Discord.js StringSelectMenu options have no `disabled` — selecting the separator WILL fire the menu interaction. Plan must filter on the sentinel value in the install handler.
- **Schema-extending `ResolvedAgentConfig` with OpenClaw-specific fields** (runner, think, elevated, activation, queue policy). These are OpenClaw-platform concepts that don't apply to ClawCode's Claude Agent SDK runtime. The status renderer should hard-code these as `n/a`/`SDK session`/`bypass` constants.
- **Fixing the fallback URL construction at `daemon.ts:1045-1047`.** Live probing confirms NO URL shape resolves on clawhub.ai for hivemind. The construction is fine; the registry simply hasn't published manifests. 93-03 is pure UX work.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relative time formatting (`24m ago`) | Custom `formatTimeAgo(ms)` | `date-fns/formatDistanceToNow` | Already a project dep; handles seconds/minutes/hours/days/weeks/months without per-unit edge cases. CONTEXT.md hints at this ("date-fns is already in the project — confirm in plan"). |
| URL parsing for the synthetic ClawHub source | Manual `new URL(baseUrl)` validation | Reuse the zod default at `schema.ts:907` | `defaults.clawhubBaseUrl` is already validated by `z.string().url()` at config-load time. |
| Sentinel separator value detection | Multiple regex patterns | Single string-equality check (`chosen === "__separator_clawhub__"`) | Locked CONTEXT.md decision; one prefix is sufficient and unambiguous. |
| StringSelectMenu category dividers | Multi-step UX (modal → category picker → skill picker) | Single sentinel-value separator option | Discord doesn't support native section headers in select menus; sentinel option is the established pattern, simpler than a multi-step flow. |

**Key insight:** Every primitive Phase 93 needs already exists in the codebase. The phase is reorganization + extension, not invention.

## Runtime State Inventory

> Not applicable — Phase 93 is pure code extension. No renames, no string replacements, no migrations. Verified by:
> - Stored data: **None** — no ChromaDB/Mem0/SQLite key changes; the new `manifest-unavailable` outcome is computed transient at install-call time, never persisted.
> - Live service config: **None** — no Discord registration name changes (`/clawcode-status` keeps its existing name + slot at `slash-types.ts:103`); ClawHub baseUrl is read fresh from config at every IPC call.
> - OS-registered state: **None** — no systemd unit name changes; no Task Scheduler entries.
> - Secrets / env vars: **None** — synthetic ClawHub source carries no `authToken` by design (locked decision).
> - Build artifacts: **None** — no package rename, no egg-info equivalents in this codebase (TypeScript + tsup).

## Common Pitfalls

### Pitfall 1: StringSelectMenu separator option fires install handler
**What goes wrong:** User clicks the `── ClawHub public ──` divider, expecting it to be inert. The select menu fires `awaitMessageComponent` with `value === "__separator_clawhub__"`, which then calls `marketplace-install` with skill name `__separator_clawhub__` → IPC handler returns `not-in-catalog` → user sees a confusing `**__separator_clawhub__** not found in marketplace catalog.` message.
**Why it happens:** Discord.js 14.x has no `setDisabled` on `StringSelectMenuOptionBuilder` — only on the menu itself. Every option is selectable.
**How to avoid:** In `handleSkillsBrowseCommand` at `slash-commands.ts:1808`, BEFORE the `await followUp.update({ content: \`Installing ${chosen}...\` })`, add:
```typescript
if (chosen === "__separator_clawhub__") {
  await followUp.update({ content: "Pick a skill, not the divider.", components: [] });
  return;
}
```
**Warning signs:** Test for it: simulated selection of `__separator_clawhub__` should NOT result in a `marketplace-install` IPC call.

### Pitfall 2: Picker with 0 ClawHub skills still shows the divider
**What goes wrong:** Local skills exist, ClawHub fetch fails (rate-limit / auth-required) → divider renders with NO ClawHub options below it.
**Why it happens:** The catalog merge happens upstream of the picker; if no `source.kind === "clawhub"` items resolve, the divider is rendered alongside an empty "ClawHub public" section.
**How to avoid:** When rendering the picker, count ClawHub-sourced items first; only inject the divider when count > 0. Specifically: if `available.filter(e => typeof e.source === "object" && "kind" in e.source && e.source.kind === "clawhub").length === 0`, omit the divider.
**Warning signs:** Test: when ClawHub fetch returns 429 (graceful degradation already wired into `loadMarketplaceCatalog`), divider must be absent.

### Pitfall 3: 25-option Discord cap orphans skills below the divider
**What goes wrong:** Local skills + divider + ClawHub skills exceed Discord's 25-option StringSelectMenu cap. The existing code slices at 25 (`DISCORD_SELECT_CAP`); if local skills alone fill 24+ slots, the ClawHub section gets truncated, and the divider may be the LAST visible option (with no skills under it).
**Why it happens:** `slash-commands.ts:1747` caps the array unconditionally with `slice(0, DISCORD_SELECT_CAP)`.
**How to avoid:** Re-order interleave logic so local-then-divider-then-clawhub is computed BEFORE the cap. If post-cap the divider would be terminal (no clawhub option follows), drop the divider. Append overflow note `(N more — refine via /clawcode-skills-browse)` so the operator knows the divider may be hiding entries.
**Warning signs:** Test: 26 local skills + 5 ClawHub skills → divider absent (cap takes locals only); 20 local + 5 ClawHub → divider visible at position 21.

### Pitfall 4: `MarketplaceIpcDeps` field add propagates to test fixtures
**What goes wrong:** Existing `daemon-marketplace.test.ts` fixtures construct `MarketplaceIpcDeps` literals; the additive optional field requires no fixture update IF marked `?:`, but if marked required, every fixture must populate it.
**Why it happens:** Phase 86 MODEL-01 / Phase 89 GREET-10 / Phase 90 MEM-01 each cascaded through 22+ fixture files (state.md decisions confirm this is the project's "Rule 3 blocking cascade" pattern).
**How to avoid:** Keep `defaultClawhubBaseUrl?: string` (with `?`) on `MarketplaceIpcDeps`. The loader treats `undefined` as "no auto-inject", which is the back-compat behavior CONTEXT.md requires.
**Warning signs:** TypeScript compile errors in test fixtures = sign the field went required when it should have stayed optional.

### Pitfall 5: Fallback URL fix is a wrong-target fix
**What goes wrong:** Naive read of the user's bug report says "fallback URL is wrong, fix it". Live probing confirms ZERO URL shapes resolve on clawhub.ai for hivemind. Changing the fallback URL would just move the 404 elsewhere.
**Why it happens:** The list endpoint `/api/v1/plugins` returns hivemind without a `manifestUrl` field; the registry has not published any per-plugin manifest endpoint. Probed shapes (all 404):
- `/api/v1/plugins/hivemind/manifest`
- `/api/v1/plugins/hivemind`
- `/api/v1/plugins/hivemind.json`
- `/api/v1/plugins/hivemind/v1/manifest`
- `/api/v1/plugins/hivemind/0.6.55/manifest`
- `/api/v1/plugins/hivemind/0.6.55`
- `/api/v1/plugins/hivemind/manifest.json`
- `/api/v1/plugins/by-runtime/hivemind`
- `/api/v1/plugins/by-runtime/hivemind/manifest`
- `/api/v1/plugins/kaghni/hivemind`
- `/api/v1/plugins/kaghni/hivemind/manifest`
- `/api/v1/registry/plugins/hivemind`
- `/api/v1/manifests/hivemind`
**How to avoid:** Plan 93-03 stays scoped to error UX. The fallback URL construction in `daemon.ts:1045-1047` is correct — there is no different shape that works.
**Warning signs:** Plan task list mentions "fix fallback URL" → should be "leave fallback URL alone; route 404 through new error class".

### Pitfall 6: Effort line should ALWAYS render, even when handle is missing
**What goes wrong:** Existing daemon short-circuit catches errors and renders `Failed to read status: ...` — losing all the other server-known fields (version, agent name, config model).
**Why it happens:** `requireSession` throws when the agent isn't running; the try/catch wraps the entire block.
**How to avoid:** New renderer reads each field defensively (try/catch around each accessor) and renders `unknown` for unavailable ones, never falling through to a generic error message. The locked decision is "mark genuinely-unavailable fields as unknown rather than omitting".
**Warning signs:** Test: when `getModelForAgent` throws (agent not running), the rest of the status block should still render with `Model: unknown`.

### Pitfall 7: Decompiled OpenClaw labels carry trailing emoji-spacing characters
**What goes wrong:** Copying the OpenClaw template strings raw introduces variable-width Unicode emoji-presentation selectors (FE0F) which render inconsistently across Discord clients.
**Why it happens:** The decompiled strings (`📚 ${contextLine}`, `🧵 ${sessionLine}`, `🦞 OpenClaw`, etc.) include the variation-selector codepoint after some emojis.
**How to avoid:** Use the canonical Unicode-only forms (`📋`, `🤖`, `🎚`, `🧠`, `🔄`, `🦞`, `🧮`, `📚`, `🧹`, `🧵`, `⚙️`, `💰`, `👥`, `🪢`, `🔑`, `🧩`). Test in a Discord client to confirm.
**Warning signs:** Inconsistent emoji rendering across mobile vs desktop Discord.

## Code Examples

Verified patterns from in-tree code:

### Existing daemon short-circuit (the 93-01 integration point)
```typescript
// Source: src/discord/slash-commands.ts:889-913
if (commandName === "clawcode-status") {
  try {
    const effort = this.sessionManager.getEffortForAgent(agentName);
    const liveModel = this.sessionManager.getModelForAgent(agentName);
    const configModel =
      this.resolvedAgents.find((a) => a.name === agentName)?.model ??
      "(unknown)";
    const model = liveModel ?? configModel;
    await interaction.editReply(
      `📋 ${agentName}\n🤖 Model: ${model}\n🎚️ Effort: ${effort}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    try {
      await interaction.editReply(`Failed to read status: ${msg}`);
    } catch { /* expired */ }
  }
  return;
}
```

### OpenClaw status block structure (recovered from installed `openclaw` npm dist)
```javascript
// Source: ~/.npm-global/lib/node_modules/openclaw/dist/status-message-BKSo537O.js
// (decompiled — final return statement of buildStatusMessage)
return [
  versionLine,                                      // 🦞 OpenClaw v.X (commit)
  args.timeLine,                                    // ⏱️ <time>
  modelLine,                                        // 🧠 Model: <name> · 🔑 oauth · <channel-note>
  configuredFallbacksLine,                          // 🔄 Fallbacks: <list>
  fallbackLine,                                     // (active fallback notice)
  usageCostLine,                                    // 💰 Usage: ...
  cacheLine,                                        // (cache info)
  `📚 ${contextLine}`,                              // 📚 Context: <fmt> · 🧹 Compactions: <n>
  mediaLine,                                        // (media)
  args.usageLine,                                   // 🧮 Tokens: in / out
  `🧵 ${sessionLine}`,                              // 🧵 Session: <id> • updated <ago>
  args.subagentsLine,                               // (subagents)
  args.taskLine,                                    // 📋 Task: <current>
  `⚙️ ${optionsLine}`,                              // ⚙️ Runtime: ... · Runner: ... · Think: ... · ...
  pluginStatusLine ? `🧩 ${pluginStatusLine}` : null,
  voiceLine,                                        // (voice mode)
  activationLine                                    // 👥 Activation: <mode> · 🪢 Queue: <mode>
].filter(Boolean).join("\n");

// optionsLine inner array:
optionsLine = [
  `Runtime: ${runtime.label}`,
  `Runner: ${runnerLabel}`,
  `Think: ${thinkLevel}`,
  formatFastModeLabel(fastMode),
  formatHarnessLabel(args.resolvedHarness),
  textVerbosity ? `Text: ${textVerbosity}` : null,
  verboseLabel,
  traceLabel,
  reasoningLevel !== "off" ? `Reasoning: ${reasoningLevel}` : null,
  elevatedLabel
].filter(Boolean).join(" · ");
```

### Recommended ClawCode parity output (n/a placeholders for unsupplied OpenClaw fields)
```
🦞 ClawCode v0.2.0 (<short-sha>)
🧠 Model: sonnet · 🔑 sdk
🔄 Fallbacks: n/a
📚 Context: unknown · 🧹 Compactions: n/a
🧵 Session: …<last-12-of-sessionId> • updated 24m ago
📋 Task: idle
⚙️ Runtime: SDK session · Runner: claude-agent-sdk · Think: <effort> · Permissions: <permissionMode>
👥 Activation: bound-channel · 🪢 Queue: depth-1 (<inflight|idle>)
```

### Existing catalog injection point (the 93-02 integration site)
```typescript
// Source: src/marketplace/catalog.ts:230-244
// (after step 1 — local skills loaded — BEFORE the source loop)
for (const [name, entry] of localCatalog) {
  /* ... */
}

// 93-02 INSERT POINT — synthesize a clawhub source if not already present
// (insert here, before the `for (const source of opts.sources)` loop)

for (const source of opts.sources) {
  if ("kind" in source && source.kind === "clawhub") {
    /* ... existing clawhub fetch ... */
  }
  /* ... legacy ... */
}
```

### Existing renderPluginInstallOutcome switch (the 93-03 UI integration)
```typescript
// Source: src/discord/slash-commands.ts:407-449
function renderPluginInstallOutcome(
  outcome: PluginInstallOutcomeWire,
  agent: string,
): string {
  switch (outcome.kind) {
    case "installed":          return `Installed ${outcome.plugin}...`;
    case "manifest-invalid":   return `**${outcome.plugin}** manifest is invalid: ${outcome.reason}.`;
    // 93-03 ADD: case "manifest-unavailable":
    //   return `**${outcome.plugin}** manifest unavailable (404) — the registry lists this plugin but can't serve its manifest. Retry later or choose a different plugin.`;
    /* ... other cases ... */
  }
}
```

### Existing ClawHub error class shape (the 93-03 sibling pattern)
```typescript
// Source: src/marketplace/clawhub-client.ts:108-141
export class ClawhubRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number, message: string) {
    super(message);
    this.name = "ClawhubRateLimitedError";
  }
}

export class ClawhubAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClawhubAuthRequiredError";
  }
}

export class ClawhubManifestInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClawhubManifestInvalidError";
  }
}

// 93-03 ADD:
export class ClawhubManifestNotFoundError extends Error {
  constructor(
    public readonly manifestUrl: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ClawhubManifestNotFoundError";
  }
}
```

### Existing 404 dispatch path in `downloadClawhubPluginManifest`
```typescript
// Source: src/marketplace/clawhub-client.ts:526-554
export async function downloadClawhubPluginManifest(
  args: Readonly<{ manifestUrl: string; authToken?: string; deps?: ClawhubClientDeps }>,
): Promise<ClawhubPluginManifest> {
  const fetchFn = args.deps?.fetch ?? globalThis.fetch;
  const res = await fetchFn(args.manifestUrl, { headers: buildHeaders(args.authToken) });

  if (res.status === 429) { throw new ClawhubRateLimitedError(/*...*/); }
  if (res.status === 401 || res.status === 403) { throw new ClawhubAuthRequiredError(/*...*/); }
  // 93-03 INSERT POINT — add BEFORE generic !res.ok branch:
  // if (res.status === 404) {
  //   throw new ClawhubManifestNotFoundError(
  //     args.manifestUrl,
  //     404,
  //     `clawhub plugin manifest: 404 Not Found at ${args.manifestUrl}`,
  //   );
  // }
  if (!res.ok) { throw new Error(`clawhub plugin manifest: ${res.status} ${res.statusText}`); }
  /* ... */
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/clawcode-status` returns rich agent-authored markdown via prompt routing | Daemon-side short-circuit returning 3 lines | Phase 83 EFFORT-07 | Reliability (no LLM cost) at the price of detail. 93-01 restores the detail without re-introducing LLM cost. |
| Local-only marketplace catalog by default | Auto-injected ClawHub default source | Phase 93 (this phase) | New users see ClawHub public skills out of the box without explicit `marketplaceSources[kind:"clawhub"]` config. |
| Plugin install 404 → "manifest is invalid" | New `manifest-unavailable` outcome | Phase 93 (this phase) | UX clarity — operators know the registry, not the file, is the issue. |

**Deprecated/outdated:**
- The `claudeCommand` template at `slash-types.ts:105-113` for `/clawcode-status` (a multi-line LLM prompt) is OBSOLETE since Phase 83 EFFORT-07's daemon short-circuit. The slash command is registered by name (`clawcode-status`) but the `claudeCommand` body is never executed because the daemon intercepts the command before route-to-agent. **Decision for 93-01:** the planner can choose to either (a) leave the obsolete `claudeCommand` body alone (it's harmless as documentation) or (b) replace it with a one-liner like `Show daemon-side status` (since it never runs).

## Open Questions

1. **Should the `optionsLine` always render all OpenClaw-style fields or omit n/a ones?**
   - What we know: CONTEXT.md says "Output ALL of these lines unconditionally; mark genuinely-unavailable fields as unknown rather than omitting (operators learn the schema once)."
   - What's unclear: does this apply at line level or sub-field level? E.g. `⚙️ Runtime: SDK session · Runner: n/a · Think: medium · Permissions: bypass` (all sub-fields rendered) vs `⚙️ Runtime: SDK session · Think: medium · Permissions: bypass` (n/a fields omitted).
   - Recommendation: planner should render ALL sub-fields with `n/a` placeholders for the OpenClaw-only ones (Runner, Fast Mode, Harness, Reasoning, Elevated). Matches the locked-decision spirit. Keep schema-discoverable.

2. **Where exactly does the abbreviated session ID slice from?**
   - What we know: CONTEXT.md says "last 12 chars of the session-key after the channel prefix".
   - What's unclear: ClawCode uses `handle.sessionId` which is the SDK's UUID, not a `<channel>:<thread>` composite. There may be no "channel prefix" to slice off in the ClawCode shape.
   - Recommendation: planner inspects `handle.sessionId` shape at `persistent-session-handle.ts:558` — likely a UUID. Just take the last 12 chars (`…<sessionId.slice(-12)>`). Matches the spirit of the locked decision.

3. **Divider option ordering with overflow.**
   - What we know: locked decision is local first, then divider, then ClawHub.
   - What's unclear: when post-cap there are zero ClawHub items visible, should the divider still appear?
   - Recommendation: planner suppresses the divider when no ClawHub items follow. See Pitfall 2 + 3.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | 22 LTS (per CLAUDE.md stack) | — |
| date-fns (`formatDistanceToNow`) | 93-01 relative-time formatter | ✓ | ^4.1.0 (`node_modules/date-fns/formatDistanceToNow.js` verified) | — |
| discord.js (`StringSelectMenuOptionBuilder`) | 93-02 picker divider | ✓ | ^14.26.2 | — |
| ClawHub HTTP API (`https://clawhub.ai/api/v1/plugins`) | 93-02 catalog fetch + 93-03 install path | ✓ (200 OK, returns items array) | — | If unreachable: existing graceful-fail path in `loadMarketplaceCatalog` (warn + skip source); `installClawhubPlugin` returns `manifest-invalid`/`manifest-unavailable` |
| `git rev-parse --short HEAD` | 93-01 commit-sha display | ✓ (already used in `src/benchmarks/runner.ts:236` and `src/performance/context-audit.ts:98`) | — | "unknown" string fallback (existing pattern) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**External API state (verified 2026-04-24 via curl probes):**
- `GET https://clawhub.ai/api/v1/plugins` → 200, `{items: [...]}` (hivemind listed; NO `manifestUrl` field on any item).
- `GET https://clawhub.ai/api/v1/plugins/hivemind/manifest` → 404 `Not found` (and every sibling URL shape — see Pitfall 5 for the full table).
- `GET https://clawhub.ai/api/v1/skills` → 200, `{items: [], nextCursor: null}` (skills endpoint exists but is currently empty — relevant to 93-02 testing: ClawHub injection will populate the dropdown with zero items in production today, but the code path must still work).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.3 (per `package.json`) |
| Config file | (none — uses vitest defaults; tests live in per-module `__tests__/` directories) |
| Quick run command | `npx vitest run src/discord/__tests__/<file>.test.ts` (single file) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Sub-Plan | Behavior | Test Type | Automated Command | File |
|----------|----------|-----------|-------------------|------|
| 93-01 | Status renderer formats version + commit + model + effort + session + relative time | unit | `npx vitest run src/discord/__tests__/status-render.test.ts` | NEW: `src/discord/__tests__/status-render.test.ts` |
| 93-01 | n/a placeholders render when fields unavailable (no token counter, no fallbacks) | unit | same | NEW |
| 93-01 | Defensive read: missing handle does NOT collapse the whole render — emits `unknown` per field | unit | same | NEW |
| 93-01 | Daemon short-circuit at `slash-commands.ts:889` calls the renderer with the right args | unit | `npx vitest run src/discord/__tests__/slash-commands-status-model.test.ts` | EXTEND existing |
| 93-01 | `formatDistanceToNow` produces `<num> minutes ago` for sub-hour deltas | unit | covered by status-render.test.ts | NEW |
| 93-02 | `loadMarketplaceCatalog` injects synthetic clawhub source when `defaultClawhubBaseUrl` set + no clawhub in sources | unit | `npx vitest run src/marketplace/__tests__/catalog-clawhub-default.test.ts` | NEW |
| 93-02 | `loadMarketplaceCatalog` does NOT inject when explicit `kind:"clawhub"` source already present | unit | same | NEW |
| 93-02 | `loadMarketplaceCatalog` no-op when `defaultClawhubBaseUrl` is undefined (back-compat) | unit | same | NEW |
| 93-02 | `MarketplaceIpcDeps.defaultClawhubBaseUrl` plumbs through `handleMarketplaceListIpc` | unit | `npx vitest run src/manager/__tests__/daemon-marketplace.test.ts` | EXTEND existing |
| 93-02 | Skills-browse picker renders local + divider + clawhub options in correct order | unit | `npx vitest run src/discord/__tests__/slash-commands-skills-browse.test.ts` | EXTEND existing |
| 93-02 | Picker filters separator-value selection out of `marketplace-install` IPC | unit | same | EXTEND existing |
| 93-02 | Picker omits divider when zero ClawHub items would render | unit | same | NEW assertion in existing file |
| 93-03 | `downloadClawhubPluginManifest` throws `ClawhubManifestNotFoundError` on 404 | unit | `npx vitest run src/marketplace/__tests__/clawhub-client-manifest-404.test.ts` | NEW |
| 93-03 | `mapFetchErrorToOutcome` routes `ClawhubManifestNotFoundError` → `manifest-unavailable` | unit | `npx vitest run src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts` | NEW |
| 93-03 | `renderPluginInstallOutcome` includes new `manifest-unavailable` case (exhaustive switch) | unit | `npx vitest run src/discord/__tests__/slash-commands-plugins-browse.test.ts` | EXTEND existing |
| 93-03 | Fallback URL only used when `item.manifestUrl` is undefined | unit | `npx vitest run src/manager/__tests__/daemon-plugin-marketplace.test.ts` | EXTEND existing |
| 93-01..03 | Manual UAT: `/clawcode-status` shows the rich block on Discord | manual | run daemon, invoke in fin-acquisition channel, compare to OpenClaw `/status` screenshot | — |
| 93-02 | Manual UAT: `/clawcode-skills-browse` lists ClawHub-public skills with section divider | manual | same channel, no marketplaceSources config | — |
| 93-03 | Manual UAT: `/clawcode-plugins-browse` → pick `hivemind` → see new "manifest unavailable" copy | manual | reproduce the original 2026-04-24 user error path | — |

### Sampling Rate
- **Per task commit:** `npx vitest run <relevant test file>` (~5-10s per sub-plan's test surface).
- **Per wave merge:** `npm test` (full vitest suite — all 1454+ tests).
- **Phase gate:** Full suite green before `/gsd:verify-work`; manual UAT items checked off.

### Wave 0 Gaps
- [ ] `src/discord/__tests__/status-render.test.ts` — new file. Covers 93-01 renderer unit tests.
- [ ] `src/marketplace/__tests__/catalog-clawhub-default.test.ts` — new file. Covers 93-02 auto-injection logic.
- [ ] `src/marketplace/__tests__/clawhub-client-manifest-404.test.ts` — new file. Covers 93-03 404 → `ClawhubManifestNotFoundError`.
- [ ] `src/marketplace/__tests__/install-plugin-manifest-unavailable.test.ts` — new file. Covers 93-03 outcome mapping.
- (Existing test infrastructure: vitest is set up; per-module `__tests__/` directories already exist; no framework install needed.)

### Log Messages to Verify Behavior
- 93-02: `loadMarketplaceCatalog: auto-injecting default clawhub source baseUrl=<url>` (new log line — info-level).
- 93-03: existing `mapFetchErrorToOutcome` site does NOT log; the install pipeline logs at the daemon level. Consider an info-level log at the new `ClawhubManifestNotFoundError` throw site: `clawhub plugin manifest: 404 Not Found at <url>`.

## Sources

### Primary (HIGH confidence — codebase-internal)
- `/home/jjagpal/.openclaw/workspace-coding/.planning/phases/93-.../93-CONTEXT.md` — locked decisions (verbatim).
- `/home/jjagpal/.openclaw/workspace-coding/src/discord/slash-commands.ts:876-913` — current daemon short-circuit implementation (93-01 integration site).
- `/home/jjagpal/.openclaw/workspace-coding/src/discord/slash-types.ts:101-115` — current command registration with obsolete `claudeCommand` body.
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-manager.ts:912-964` — `getEffortForAgent`, `getModelForAgent`, `getSessionHandle` accessors.
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/persistent-session-handle.ts:557-700` — SessionHandle interface (`sessionId`, `getEffort`, `getModel`, `getPermissionMode`, `hasActiveTurn`).
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-adapter.ts:78-159` — full SessionHandle type definition.
- `/home/jjagpal/.openclaw/workspace-coding/src/shared/types.ts:5-323` — `ResolvedAgentConfig` shape (no runner/think/elevated/activation/queue fields → these are n/a in ClawCode).
- `/home/jjagpal/.openclaw/workspace-coding/src/marketplace/catalog.ts:202-313` — `loadMarketplaceCatalog` implementation (93-02 integration site).
- `/home/jjagpal/.openclaw/workspace-coding/src/marketplace/clawhub-client.ts:108-586` — error classes + `downloadClawhubPluginManifest` (93-03 integration site).
- `/home/jjagpal/.openclaw/workspace-coding/src/marketplace/install-plugin.ts:73-373` — `PluginInstallOutcome` union + `mapFetchErrorToOutcome`.
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/daemon.ts:621-697`, `:1020-1065`, `:2185-2235` — `MarketplaceIpcDeps` + plugin install plumbing + IPC closure-intercept.
- `/home/jjagpal/.openclaw/workspace-coding/src/config/schema.ts:822-907` — `defaultsSchema` + `clawhubBaseUrl` zod default.
- `/home/jjagpal/.openclaw/workspace-coding/src/config/loader.ts:443-475` — `resolveMarketplaceSources` (zod → resolved discriminated union).
- `/home/jjagpal/.openclaw/workspace-coding/src/discord/slash-commands.ts:1684-1856` — `handleSkillsBrowseCommand` (93-02 UI integration).
- `/home/jjagpal/.openclaw/workspace-coding/src/discord/slash-commands.ts:407-449` — `renderPluginInstallOutcome` (93-03 UI integration).
- `/home/jjagpal/.openclaw/workspace-coding/package.json` — `date-fns ^4.1.0` confirmed; `discord.js ^14.26.2` confirmed; CLI version `0.2.0` at `src/cli/index.ts:118`.
- `/home/jjagpal/.openclaw/workspace-coding/node_modules/date-fns/formatDistanceToNow.js` — confirmed `formatDistanceToNow` export available.

### Primary (HIGH confidence — external decompiled source)
- `~/.npm-global/lib/node_modules/openclaw/dist/status-message-BKSo537O.js` — installed OpenClaw npm `0.2.x`, contains the canonical OpenClaw `/status` block assembly. Fields recovered: versionLine, modelLine (with 🔑 auth label), configuredFallbacksLine, fallbackLine, usageCostLine, cacheLine, contextLine (with 🧹 Compactions), tokens line, sessionLine (with `formatTimeAgo`), subagentsLine, taskLine, optionsLine (Runtime/Runner/Think/FastMode/Harness/Text/Verbose/Trace/Reasoning/Elevated), pluginStatusLine, voiceLine, activationLine (👥 Activation + 🪢 Queue).

### Primary (HIGH confidence — live HTTP probes)
- 2026-04-24 curl probes against `https://clawhub.ai/api/v1/plugins/hivemind/...` — every shape returns 404 `Not found` (Vercel-served, no auth required). Plugin list endpoint returns 200 with hivemind in the items array but NO `manifestUrl` field on the item.

### Secondary (MEDIUM confidence)
- discord.js 14.x StringSelectMenuOptionBuilder API — known: `setLabel/setValue/setDescription/setEmoji/setDefault`; no `setDisabled` (per discord.js typedefs); pattern of sentinel values for non-installable options is common (referenced in v2 components Section discussion but unsupported in select menus).

### Tertiary (LOW confidence)
- None — every claim in this research is sourced to either codebase-internal files, decompiled installed-module source, or a live HTTP probe with output captured.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps already installed and verified at exact installed paths.
- Architecture: HIGH — every integration point quoted from in-tree code with line numbers.
- Pitfalls: HIGH — every pitfall traced to specific lines (Discord cap at L1747, separator behavior in awaitMessageComponent, etc.).
- ClawHub URL discovery: HIGH — 13 URL shapes probed, all 404; list response parsed structurally.
- OpenClaw status format: HIGH — recovered from installed npm dist, all 17 final-array elements + optionsLine inner array confirmed.

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days; OpenClaw npm dist could update — re-verify if blocked).
