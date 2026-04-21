# Features Research — v2.2 OpenClaw Parity & Polish

## Research Mode
Ecosystem (feature landscape, 4 subsystems).

## Confidence
HIGH on SDK limits and native commands (verified via official docs); HIGH on OpenClaw behavior (read source); HIGH on skill inventory (direct filesystem scan + SKILL.md spot-check).

---

## Feature 1 — Skills Library Migration

### Skill Inventory (`~/.openclaw/skills/`, 13 directories)

| # | Skill | Format | Domain | Verdict | Complexity | Notes |
|---|-------|--------|--------|---------|------------|-------|
| 1 | `cognitive-memory` | YAML frontmatter + prose | Memory system | **DEPRECATE** | n/a | Superseded by ClawCode's KG / consolidation / decay / tiering (v1.1/v1.5/v1.9). |
| 2 | `finmentum-content-creator.retired` | YAML frontmatter | Finmentum Reels (legacy) | **SKIP** | n/a | Replaced by `new-reel`. Dir explicitly `.retired`. |
| 3 | `finmentum-crm` | YAML frontmatter | Finmentum DB ops | **MUST-MIGRATE** | LOW | `fin-*` agents only. MCP target `finmentum-db` already wired. ⚠ contains literal MySQL credentials (host/port/user/password) in SKILL.md description — must secret-scan. |
| 4 | `frontend-design` | YAML frontmatter | Aesthetic guide | **MUST-MIGRATE** | LOW | Content-only, zero-conversion. |
| 5 | `new-reel` | YAML frontmatter + scripts/ + reference/ | Finmentum Reels workflow | **MUST-MIGRATE** | MEDIUM | 56KB SKILL.md + `heygen-*.sh` + `pexels-download.sh`. Uses `${CLAUDE_SKILL_DIR}` substitution (natively supported). |
| 6 | `openclaw-config` | YAML frontmatter | Gateway config manipulation | **DEPRECATE** | n/a | References dead `gateway()` tool post-v2.1. |
| 7 | `power-apps-builder` | YAML frontmatter + references/ | Power Apps YAML generator | **NICE-TO-HAVE** | LOW | General-purpose. `references/` ports intact. |
| 8 | `remotion` | YAML frontmatter | Motion graphics | **NICE-TO-HAVE** | MEDIUM | Spawns nested Claude Code sessions — potential collision with v1.1 subagent spawning; test isolation. |
| 9 | `self-improving-agent` | YAML + hooks/ + scripts/ + `.learnings/` | Error/learning capture | **MIGRATE WITH CONVERSION** | MEDIUM | Ships `hooks:` frontmatter (doc-confirmed supported). `.learnings/*.md` — dedupe against v2.1-migrated memory (already tagged `learning`). |
| 10 | `test` | YAML frontmatter, `user-invocable: true` | Sanity check | **NICE-TO-HAVE** | LOW | 8-line smoke test for linker. |
| 11 | `tuya-ac` | **Plain markdown** (no frontmatter) | Smart-home (personal) | **MIGRATE WITH CONVERSION** | LOW | Format mismatch — scanner falls back but degraded. Add `---` frontmatter during port. Personal agent only. |
| 12 | `workspace-janitor` | **Plain markdown** (no frontmatter) | File organizer | **NICE-TO-HAVE** | LOW | Same format issue. Ships Node CLI (`scripts/run.js`). |

### Format Compatibility
ClawCode's scanner (`src/skills/scanner.ts`) is forgiving — tolerates missing frontmatter, falls back to first paragraph as description. Main conversions needed: (a) hooks-bearing skills (`self-improving-agent`), (b) frontmatter-less skills (tuya-ac, workspace-janitor). Native Claude Code supports `${CLAUDE_SKILL_DIR}` and `$ARGUMENTS` substitutions.

### Classification

**Must-migrate (P1):** `finmentum-crm`, `new-reel`, `frontend-design`, `self-improving-agent`, `tuya-ac`
**Nice-to-have (P2):** `power-apps-builder`, `remotion`, `workspace-janitor`, `test`
**Deprecate:** `cognitive-memory`, `openclaw-config`, `finmentum-content-creator.retired`

### Table Stakes / Differentiators / Anti-Features

| Classification | Item | Why |
|---|---|---|
| **Table Stakes** | Idempotent port preserving directory structure (SKILL.md + scripts/ + references/) | Bundled-file references break silently otherwise |
| **Table Stakes** | Per-agent linker verification | `skills:` list must resolve via v1.4 global skill install |
| **Table Stakes** | Frontmatter normalization for legacy skills | Autonomous invocation relies on `description` |
| **Table Stakes** | Skip `.retired` dirs + deprecate-list | No dead skills in catalog |
| **Table Stakes** | Secret scan (finmentum-crm contains literal MySQL creds) | Prevent credential leak via system prompt |
| **Differentiators** | Migration report per skill (v2.1-style) | Operator visibility |
| **Differentiators** | Dry-run diff of skills catalog before/after | Matches v2.1 UX |
| **Differentiators** | Scope tags — skip Finmentum skills on non-Finmentum agents | `finmentum-crm` doesn't belong on `personal` |
| **Anti-Feature** | Recreating `cognitive-memory` | Fights v1.x memory stack — confabulation risk |
| **Anti-Feature** | Porting `openclaw-config` | Gateway no longer exists |
| **Anti-Feature** | Auto-spawning Claude Code subprocesses (Remotion pattern) | Collides with v1.1 subagent spawning + v1.6 auto-linker |

---

## Feature 2 — Extended-Thinking Effort Mapping

### OpenClaw Bridge Behavior (verified `openclaw-claude-bridge/src/claude.js:48-58, 107-118`)

```
OC reasoning_effort → Claude CLI --effort
  minimal → low
  low     → medium
  medium  → high
  high    → max
  xhigh   → max
  (unset) → --effort omitted + env MAX_THINKING_TOKENS=0  (thinking OFF)
```

**Critical:** When `reasoning_effort` is falsy, OpenClaw sets `MAX_THINKING_TOKENS=0` in spawn env, forcibly disabling extended thinking. This is per-request env var, not session config.

### Native Claude Code Support (verified via official commands docs)
- CLI flag `--effort <level>` accepts `low | medium | high | xhigh | max` (max is session-only)
- `/effort [level|auto]` slash command — effect is immediate, doesn't wait for current response
- SKILL.md frontmatter supports `effort:` override per-skill
- `auto` resets to model default

### ClawCode Current State
`/clawcode-effort` slash command exists (`src/discord/slash-types.ts:116-127`, validation at `slash-commands.ts:264-284`). Accepts `low/medium/high/max`, calls `sessionManager.setEffortForAgent(name, level)`. **Plumbing exists but `persistent-session-handle.ts:599-602` has a `// Future: q.setMaxThinkingTokens() wiring` TODO — P0 latent bug: setEffort stores level in local var but never calls the SDK.** Existing UX reports success while thinking tokens stay at default.

### Token Budgets
Neither OpenClaw nor ClawCode hardcode specific token budgets. Effort level is the knob; Anthropic decides token budget internally per tier. The only explicit token control is the `MAX_THINKING_TOKENS=0` kill-switch.

### Table Stakes / Differentiators / Anti-Features

| Classification | Item | Why |
|---|---|---|
| **Table Stakes** | Persist effort on session (not just in-memory) | ClawCode long-lived sessions; restart must restore |
| **Table Stakes** | Per-agent default in clawcode.yaml (`defaults.effort` + `agents[*].effort`) | Mirrors `model` field |
| **Table Stakes** | Runtime override via `/clawcode-effort` actually wired to SDK (fix the TODO) | Current command silently no-ops |
| **Table Stakes** | Honor `MAX_THINKING_TOKENS=0` for explicit OFF | OpenClaw semantics; "none" must truly disable thinking |
| **Table Stakes** | Support `auto` to reset to model default | Parity with native `/effort auto` |
| **Differentiators** | Per-skill effort override (native `effort:` frontmatter) | Deep-analysis skill requests `max` just for its turn |
| **Differentiators** | Effort visible in `/clawcode-status` | Operators see current level without extra command |
| **Differentiators** | Per-channel / per-agent effort (research=high, personal=low) | Natural extension of agent config |
| **Differentiators** | Fork-to-Opus auto-escalates effort (v1.5 fork) | Opus + max for complex subtasks, revert on main thread |
| **Anti-Feature** | Real-time effort swap mid-turn | Out-of-scope per PROJECT.md line 116 |
| **Anti-Feature** | Exposing raw token budget (`MAX_THINKING_TOKENS=<N>`) | Level abstraction is the contract |
| **Anti-Feature** | Rebuilding OpenClaw's 5-level mapping | Use Claude CLI's native names (`low/medium/high/xhigh/max`) |

---

## Feature 3 — Dual Discord Model Picker

### Current OpenClaw Picker State (`~/.openclaw/discord/model-picker-preferences.json`)

```json
{
  "version": 1,
  "entries": {
    "discord:default:guild:<GUILD>:user:<USER>": {
      "recent": [
        "clawcode/openclaw:coder:sonnet",
        "clawcode/fin-acquisition",
        "clawcode/openclaw:generic:sonnet",
        "anthropic-api/claude-sonnet-4-6",
        "clawcode/openclaw:research:sonnet"
      ],
      "updatedAt": "2026-04-21T14:18:14.035Z"
    }
  }
}
```

**Shape:** per-guild/per-user keys → `recent[]` of `<provider>/<model-id>` strings (likely max 5) + `updatedAt`. **No allowlist stored** — picker tracks recently-used only. Allowed-model list lives in OpenClaw's gateway config.

### ClawCode Current State
`/clawcode-model` exists but per PROJECT.md tech debt (line 150): *"/model slash command uses indirect claudeCommand routing through agent LLM"* — command sends `"Set my model to {model}"` as a prompt, no direct dispatch. **This is what v2.2 fixes.**

### Agent Config Shape
`clawcode.yaml` agents have `model: <alias>` (`sonnet`, `opus`). **No `fallbackModels` or `allowedModels` field exists yet.** v2.2 must add it.

### Native Picker UX (verified via docs)
- Native `/model [model]`: no arg = opens picker; with arg = sets directly
- Confirmation required when prior output exists (cache invalidation warning)
- Effort adjustment via arrow keys in the picker

### Discord UI Tradeoffs
- **String autocomplete:** best for >5 options, live filtering
- **String select menu:** up to 25 options × 25-char labels, proper dropdown, survives ephemeral replies — **recommended for 3-8 curated models per agent**
- **Buttons (action row):** max 5 per row, fastest click, doesn't scale

### Table Stakes / Differentiators / Anti-Features

| Classification | Item | Why |
|---|---|---|
| **Table Stakes** | Add `allowedModels: []` to `agents[*]` schema (default inherit from `defaults.allowedModels`) | Picker needs a source of truth |
| **Table Stakes** | `/clawcode-model` dispatches direct to SessionManager (not LLM prompt) | Fixes documented tech debt |
| **Table Stakes** | Model change persists atomically (v2.1 writer pattern) | Restart must not lose setting |
| **Table Stakes** | OpenClaw picker reads `clawcode/*` entries from clawcode.yaml's allowedModels | Satisfies dual-picker parity |
| **Table Stakes** | Confirmation UX when prior conversation exists | Preserves v1.7 prompt-cache savings |
| **Table Stakes** | Per-agent recent-models memory | Each agent gets its own picker state |
| **Differentiators** | Effort adjustment from same picker | One-stop model+effort control |
| **Differentiators** | Model-change webhook embed (old→new, cost delta) | v1.6 webhook identities surface the switch |
| **Differentiators** | `fallbackModel` for auto-degrade on overload | Matches native `--fallback-model` |
| **Differentiators** | Current model shown in `/clawcode-status` | Confirms switch took effect |
| **Anti-Feature** | Picker available in ALL channels universally | Must scope to the channel's bound agent |
| **Anti-Feature** | Global recent-models list (OpenClaw's per-user/per-guild shape) | Agent-bound channels = natural scope is the agent |
| **Anti-Feature** | Showing every Claude alias | Curation via `allowedModels` is the value |
| **Anti-Feature** | Separate picker per-agent AND per-user | Double-cardinality preference storage |

---

## Feature 4 — Native Claude Code Slash Commands in Discord

### Command Inventory (64 commands + bundled skills, verified via https://code.claude.com/docs/en/commands)

**Legend:** `YES` = meaningful + SDK-dispatchable · `SKILL` = bundled skill, dispatchable via skill tool · `NO-SDK` = interactive-only · `NO-FIT` = nonsensical in Discord · `CONFLICT` = collides with existing clawcode-*

| Command | Purpose | Verdict |
|---|---|---|
| `/add-dir <path>` | Add working dir | YES |
| `/agents` | Manage subagents | YES (read-only via SDK) |
| `/autofix-pr` | Web session for PR | NO-FIT |
| `/batch` | Parallel changes (skill) | SKILL — gate it |
| `/branch [name]` | Fork conversation | YES (alias `/fork`) |
| `/btw <question>` | Side question | YES |
| `/chrome` | Chrome integration | NO-FIT |
| `/claude-api` | API reference (skill) | SKILL |
| `/clear` | New conversation | **NO-SDK** — official docs state "not available in the SDK". Must simulate by session restart. |
| `/color` | Prompt bar color | NO-FIT |
| `/compact [instructions]` | Summarize old messages | YES — CONFLICT `clawcode-compact`; unify |
| `/config` (`/settings`) | Settings UI | NO-SDK |
| `/context` | Context viz | YES |
| `/copy [N]` | Copy response | NO-FIT |
| `/cost` | Token stats | YES — CONFLICT `clawcode-usage` |
| `/debug` | Debug logs (skill) | SKILL |
| `/desktop` | Continue in desktop | NO-FIT |
| `/diff` | Diff viewer | NO-SDK |
| `/doctor` | Install health | NO-FIT |
| `/effort [level\|auto]` | Set effort | **CONFLICT** `clawcode-effort` — unify |
| `/exit` | Exit CLI | NO-FIT (would kill agent) |
| `/export [file]` | Export conversation | NO-SDK (filename arg may bypass — test) |
| `/extra-usage` | Rate limit extras | NO-FIT |
| `/fast [on/off]` | Toggle fast mode | YES |
| `/feedback` (`/bug`) | Submit feedback | NO-FIT |
| `/fewer-permission-prompts` | Skill | SKILL — gated |
| `/focus` | Focus toggle | NO-FIT |
| `/heapdump` | Heap snapshot | NO-FIT |
| `/help` | Show help | YES |
| `/hooks` | View hooks | YES |
| `/ide` | IDE integration | NO-FIT |
| `/init` | Init CLAUDE.md | YES — admin-only |
| `/insights` | Session analysis | YES |
| `/install-github-app` | GitHub OAuth | NO-FIT |
| `/install-slack-app` | Slack OAuth | NO-FIT |
| `/keybindings` | Edit keybindings | NO-FIT |
| `/login` / `/logout` | Auth | NO-FIT (daemon-scope) |
| `/loop` | Interval runner (skill) | SKILL — overlaps v1.1 cron |
| `/mcp` | MCP mgmt | YES (read-only) |
| `/memory` | Edit CLAUDE.md | YES (careful — different from clawcode KG) |
| `/mobile` (`/ios`/`/android`) | QR | NO-FIT |
| `/model [model]` | Change model | **CONFLICT** — Feature 3 unify |
| `/passes` | Referral | NO-FIT |
| `/permissions` (`/allowed-tools`) | Tool perms | YES |
| `/plan [desc]` | Plan mode | YES |
| `/plugin` | Plugin mgmt | YES |
| `/powerup` | Lessons | NO-FIT |
| `/pr-comments [PR]` | PR comments | REMOVED v2.1.91 |
| `/privacy-settings` | Privacy | NO-FIT |
| `/recap` | Session summary | YES |
| `/release-notes` | Changelog | NO-SDK |
| `/reload-plugins` | Hot-reload plugins | YES |
| `/remote-control` (`/rc`) | claude.ai remote | NO-FIT |
| `/remote-env` | Web session env | NO-FIT |
| `/rename [name]` | Rename session | YES |
| `/resume` (`/continue`) | Resume prior | YES |
| `/review [PR]` | Local PR review | YES |
| `/rewind` (`/checkpoint`/`/undo`) | Rewind | YES |
| `/sandbox` | Sandbox toggle | YES |
| `/schedule` | Routines | YES — CONFLICT v1.1 cron |
| `/security-review` | Security audit | YES |
| `/setup-bedrock`/`/setup-vertex` | 3rd-party providers | NO-FIT (Anthropic-only per PROJECT.md) |
| `/simplify` | 3-agent review (skill) | SKILL |
| `/skills` | List skills | YES |
| `/stats` | Usage viz | NO-SDK |
| `/status` | Settings status | YES — CONFLICT `clawcode-status` |
| `/statusline` | Status line config | NO-FIT |
| `/stickers` | Order stickers | NO-FIT |
| `/tasks` (`/bashes`) | Background tasks | YES |
| `/team-onboarding` | Team guide | NO-FIT |
| `/teleport` (`/tp`) | Pull web session | NO-FIT |
| `/terminal-setup` | Keybindings | NO-FIT |
| `/theme` | Color theme | NO-FIT |
| `/tui` | Renderer mode | NO-FIT |
| `/ultraplan` / `/ultrareview` | Cloud sessions | NO-FIT |
| `/upgrade` | Plan upgrade | NO-FIT |
| `/usage` | Plan limits | YES |
| `/vim` | Removed v2.1.92 | skip |
| `/voice` | Voice dictation | NO-FIT |
| `/web-setup` | GitHub OAuth | NO-FIT |

### SDK Dispatch Constraint (CRITICAL)

Per https://code.claude.com/docs/en/agent-sdk/slash-commands:
> "Only commands that work without an interactive terminal are dispatchable through the SDK; the `system/init` message lists the ones available in your session."

Example dispatchable set given in docs: `["/compact", "/context", "/cost"]` + custom commands. The SDK `system/init.slash_commands` field is the **definitive per-session manifest** — v2.2 must read this at session start and register only those as Discord commands, not a hardcoded list.

**/clear is explicitly not SDK-dispatchable.** Workaround: end `query()` and start fresh (v1.0 session-restart primitive).

### Existing clawcode-* Conflicts

| Existing | Native | Resolution |
|---|---|---|
| `clawcode-status` | `/status` | Keep clawcode-status (richer) |
| `clawcode-memory` | `/memory` | Different semantics — keep both, rename native as `clawcode-memory-file` |
| `clawcode-compact` | `/compact` | Unify — route to native SDK dispatch |
| `clawcode-usage` | `/cost` | Merge |
| `clawcode-model` | `/model` | Unify via Feature 3 |
| `clawcode-effort` | `/effort` | Unify via Feature 2 |
| `clawcode-schedule` | `/schedule` | Different — keep both (cron vs routines) |
| `clawcode-health` | `/doctor` | Different scope — keep both |

### Namespace Guidance
Register native commands with `clawcode-` prefix (e.g., `/clawcode-context`, `/clawcode-compact`). All clawcode-managed commands under one Discord namespace.

### Table Stakes / Differentiators / Anti-Features

| Classification | Item | Why |
|---|---|---|
| **Table Stakes** | Read `system/init.slash_commands` at session start; register only SDK-reported commands | Docs-confirmed definitive list |
| **Table Stakes** | Dispatch via SDK prompt input per docs | Documented API contract |
| **Table Stakes** | Unify duplicates (`-model`, `-effort`, `-compact`, `-usage`) to native SDK | Fixes tech debt, avoids confusion |
| **Table Stakes** | Per-agent filtering — no admin-only to non-admin | Respects v1.2 SECURITY.md ACLs |
| **Table Stakes** | Parse native command output → Discord via v1.7 `ProgressiveMessageEditor` | Reuse existing streaming |
| **Differentiators** | `/rewind` wired to v1.2 auto-snapshots | Rewind to last stable state |
| **Differentiators** | `/review` + `/security-review` from PR webhooks | Closes security-reviewer pattern |
| **Differentiators** | `/insights` as weekly Discord embed per agent | v1.1 scheduler + v1.6 webhooks |
| **Differentiators** | `/clawcode-plan` captures plan to v1.9 ConversationStore | Plans become FTS5-searchable |
| **Anti-Feature** | Hardcoded "supported commands" list | Will lie when SDK changes |
| **Anti-Feature** | Exposing `/logout`/`/login`/`/exit` | Daemon-wide — admin-only if at all |
| **Anti-Feature** | Emulating `/clear` via history slice | Docs: end query+start new. Use v1.0 restart. |
| **Anti-Feature** | Native `/schedule` alongside v1.1 cron | Two schedulers = foot-gun |
| **Anti-Feature** | Exposing every cosmetic (`/theme`/`/color`/`/tui`/`/focus`/`/keybindings`/`/statusline`) | No Discord semantics |
| **Anti-Feature** | Rebuilding `/cost` when `clawcode-usage` is richer | Keep ClawCode version, route native `/cost` to it |

---

## Cross-Feature Dependencies

```
Feature 4 (Native CC slash)
    ├── depends-on ── Feature 2 (/effort backing + clawcode-effort unification)
    ├── depends-on ── Feature 3 (/model backing + clawcode-model unification)
    └── blocks ────── unified namespace decisions for /clawcode-* vs native

Feature 3 (Dual picker)
    ├── depends-on ── agents[*].allowedModels schema (new clawcode.yaml field)
    └── depends-on ── Feature 2 (for combined model+effort picker UX)

Feature 2 (Effort mapping)
    ├── depends-on ── Agent SDK session-option pass-through
    └── independent-of ── Feature 1

Feature 1 (Skills migration)
    ├── depends-on ── v1.4 global skill install (shipped)
    ├── depends-on ── v2.1 atomic writer + ledger (reusable)
    └── independent-of ── Features 2/3/4
```

**Phase-ordering implication:**
- Feature 1 runs in parallel with 2/3/4
- Feature 2 must land before Feature 3's combined picker UX
- Feature 4 must come last — it rationalizes the clawcode-* namespace, depending on final shape of `clawcode-model` + `clawcode-effort`

---

## Open Questions (for phase-specific research)

- Does SDK's `system/init.slash_commands` include bundled skills (`/simplify`, `/debug`, `/batch`, `/loop`, `/claude-api`)? Docs example shows only 3 built-ins. Empirical test during Phase 2.
- Does `/export <filename>` work non-interactively via SDK? Docs classify as dialog; filename arg may bypass.
- Does `remotion` skill's nested `claude` spawn survive in long-lived ClawCode agent process? Subagent-vs-subshell collision risk.
- No `fallbackModels` field exists; Feature 3 introduces it or relies only on `model` + `allowedModels`?
