# Requirements — v2.2 OpenClaw Parity & Polish

**Milestone:** v2.2 OpenClaw Parity & Polish
**Opened:** 2026-04-21
**Predecessor:** v2.1 OpenClaw Agent Migration (shipped 2026-04-21)

## Goal

Close remaining parity gaps between OpenClaw and ClawCode so agents operate at feature parity for day-to-day use after the v2.1 migration. Zero new npm dependencies expected — all six features land on the existing stack.

## Cross-Cutting

- [ ] **UI-01**: All new Discord interactions (model picker, effort picker, skills browser, skills picker) use native discord.js selection elements (StringSelectMenuBuilder, autocomplete, action-row buttons) — no fallback to free-text arguments when a structured element fits

## Milestone Requirements

### Skills Library Migration (SKILL-*)

Port the 5 P1 must-have skills from `~/.openclaw/skills/` into ClawCode's skill system. See `.planning/research/FEATURES.md` for the complete skill inventory and per-skill verdicts.

- [ ] **SKILL-01**: Operator can migrate 5 P1 OpenClaw skills (`finmentum-crm`, `new-reel`, `frontend-design`, `self-improving-agent`, `tuya-ac`) into ClawCode via a `clawcode migrate openclaw skills` CLI command
- [ ] **SKILL-02**: Migration tool secret-scans every source SKILL.md and all bundled scripts before copy; refuses the copy and emits a refusal report on credential match (blocks `finmentum-crm` until MySQL creds are scrubbed from its description)
- [ ] **SKILL-03**: Migration normalizes YAML frontmatter for legacy skills (adds `name:` + `description:` to `tuya-ac`, preserves existing frontmatter for the other four)
- [ ] **SKILL-04**: Each migrated skill passes per-agent linker verification — a post-migration check confirms every skill resolves in the catalog of every agent it was linked to
- [ ] **SKILL-05**: Migration is idempotent — re-running against an already-migrated source produces zero new writes (ledger-driven, matches v2.1 MIGR-03 pattern)
- [ ] **SKILL-06**: Migration emits an operator-facing report to `.planning/milestones/v2.2-skills-migration-report.md` listing per-skill outcome (migrated / skipped / failed-secret-scan / deprecated)
- [ ] **SKILL-07**: Migration is non-destructive to source (`~/.openclaw/skills/` is never modified); enforced by fs-guard reused from v2.1
- [ ] **SKILL-08**: Scope-tag enforcement — Finmentum-specific skills (`finmentum-crm`, `new-reel`) are linked only to Finmentum agents by default; linking to other agents requires explicit opt-in

### Extended-Thinking Effort Mapping (EFFORT-*)

Wire `reasoning_effort` → `MAX_THINKING_TOKENS` all the way through the SDK, fixing the P0 latent bug at `persistent-session-handle.ts:599-602` where `setEffort()` stores the level but never calls `q.setMaxThinkingTokens()`.

- [ ] **EFFORT-01**: `/clawcode-effort <level>` dispatches through to `Query.setMaxThinkingTokens()` on the active SDK session (fixes the P0 silent no-op; regression pinned via query-options spy test)
- [ ] **EFFORT-02**: Agent config supports `defaults.effort` and per-agent `agents[*].effort` in `clawcode.yaml` (both optional, additive — v2.1 migrated configs parse unchanged)
- [ ] **EFFORT-03**: Effort level persists across agent restart via a runtime state file (new `~/.clawcode/manager/effort-state.json` or reuse of existing session-state)
- [ ] **EFFORT-04**: Effort supports levels `low`, `medium`, `high`, `max`, `auto`, `off` — where `off` forces `MAX_THINKING_TOKENS=0` (explicit disable, mirroring OpenClaw's env-var semantics) and `auto` resets to model default
- [ ] **EFFORT-05**: SKILL.md frontmatter `effort:` field (native Claude Code format) overrides the agent default for turns that invoke the skill, then reverts at turn boundary
- [ ] **EFFORT-06**: Session fork via `buildForkConfig` resets effort to the agent default — fork inheritance does not carry effort into Opus advisor calls (prevents cost spike)
- [ ] **EFFORT-07**: `/clawcode-status` output includes current effort level for every agent

### Model Picker Core (MODEL-*)

Replace the current `/clawcode-model` LLM-prompt routing with direct IPC dispatch. Adds `allowedModels` schema field and atomic persistence. **Dual-picker (OpenClaw side) deferred to future requirements.**

- [ ] **MODEL-01**: Agent config supports `defaults.allowedModels: string[]` and per-agent `agents[*].allowedModels` (both optional, additive)
- [ ] **MODEL-02**: `/clawcode-model` with no argument opens a Discord string-select menu showing the bound agent's `allowedModels` (max 25 per Discord UI cap)
- [ ] **MODEL-03**: Model change dispatches via IPC to `SessionManager.setModelForAgent()` → `SessionHandle.setModel()` → SDK `Query.setModel()` — no LLM prompt routing
- [ ] **MODEL-04**: Selected model persists atomically to `clawcode.yaml` using the v2.1 atomic temp+rename writer pattern (preserves comments, passes secret-guard)
- [ ] **MODEL-05**: Model change during an active conversation shows an ephemeral confirmation prompt warning about prompt-cache invalidation (mirrors native `/model` behavior)
- [ ] **MODEL-06**: Model change with an argument not in the agent's `allowedModels` list is rejected with an ephemeral error listing allowed values
- [ ] **MODEL-07**: `/clawcode-status` output includes current model for every agent

### Native CC Slash Commands (CMD-*)

Register SDK-exposed commands as per-agent Discord slash commands. Dispatch split: control-plane via `Query.setX()` methods; prompt-channel via SDK prompt input. Hardcoded command lists are forbidden — the SDK `system/init.slash_commands` manifest is the source of truth.

- [ ] **CMD-00**: Before implementation, a 30-minute SDK spike validates mid-session `Query.setModel()` / `Query.setPermissionMode()` / `Query.setMaxThinkingTokens()` concurrency safety against the single captured `driverIter` handle; spike output committed to `.planning/research/` as `CMD-SDK-SPIKE.md`
- [ ] **CMD-01**: On agent session start, ClawCode reads `system/init.slash_commands` from the SDK and registers each as a per-agent Discord slash command with `clawcode-` prefix (e.g., `/clawcode-compact`, `/clawcode-context`) — hardcoded command lists are rejected in code review via static-grep regression
- [ ] **CMD-02**: Control-plane commands (`/model`, `/permissions`, `/effort`) dispatch through corresponding SDK `Query.setX()` methods (not prompt input)
- [ ] **CMD-03**: Prompt-channel commands (everything else SDK-reported) dispatch as prompt strings through the existing `TurnDispatcher` per SDK docs
- [ ] **CMD-04**: Existing duplicate commands (`clawcode-compact`, `clawcode-usage`, `clawcode-model`, `clawcode-effort`) are unified onto the native SDK dispatch path — the current LLM-prompt routing is removed
- [ ] **CMD-05**: Per-agent SECURITY.md ACLs gate command registration — destructive or admin-only commands (`/init`, `/security-review`, `/batch`) are not registered on agents whose ACL forbids them
- [ ] **CMD-06**: Native command output (assistant / tool / system messages per SDK docs) streams to Discord via the v1.7 `ProgressiveMessageEditor` — no new streaming primitive
- [ ] **CMD-07**: Discord 100-command-per-guild cap is respected — existing per-guild name-dedupe in `slash-commands.ts` continues to deduplicate across the 15-agent fleet

### MCP Tool Awareness & Reliability (TOOL-*)

Fix the phantom-error class where agents claim "1Password isn't logged in" / "MCP not configured" / "key expired" when everything is actually valid and reachable. Root cause is a combination of weak MCP health-state visibility in the system prompt and no proactive readiness gate — agents parrot generic failure language instead of attempting the tool.

- [ ] **TOOL-01**: On agent startup, daemon performs JSON-RPC `initialize` handshake against every configured MCP server and refuses to mark the agent `ready` until all mandatory servers respond successfully — agent never starts with a half-broken MCP fleet (extends v1.6 warm-path readiness gate)
- [ ] **TOOL-02**: System prompt includes an explicit "MCP tools are pre-authenticated" statement plus a live tool-status table listing each configured MCP with its current readiness and the canonical tool names it exposes
- [ ] **TOOL-03**: Recurring MCP health-check heartbeat (existing v1.3 infrastructure) auto-reconnects any MCP server whose JSON-RPC `initialize` fails; reconnect outcome is visible in `/clawcode-status`
- [ ] **TOOL-04**: When an MCP tool call fails, the agent receives the actual JSON-RPC error (code + message) in its tool-result, not a generic "tool unavailable" — agent reports the real error instead of guessing
- [ ] **TOOL-05**: System prompt explicitly instructs the agent: "If an MCP tool reports an error, include the actual error message verbatim; do not assume the tool is misconfigured unless the error explicitly states misconfiguration" — pinned in prompt-builder with a regression test
- [ ] **TOOL-06**: `/clawcode-tools` slash command lists the agent's MCP servers with live status (ready / degraded / failed), last-successful-call timestamp, and recent failure count — surfaces the phantom-error contradiction if one occurs
- [ ] **TOOL-07**: MCP server list + tool descriptions are placed in the v1.7 stable prompt prefix (cached), so they can't be evicted during compaction

### Skills Marketplace (MKT-*)

Mimic OpenClaw's skill marketplace pattern — a browsable catalog in Discord that auto-installs selected skills. Scope intentionally minimal for v2.2: browse → pick → install, no rating/publishing flow.

- [ ] **MKT-01**: `/clawcode-skills-browse` opens a Discord string-select menu (or autocomplete for large lists) showing available skills from a registered skills source with name, short description, and category
- [ ] **MKT-02**: Skills source resolves from a configurable list in `clawcode.yaml` — initially ClawCode's local skills catalog (`workspace-coding/skills/`) unified with OpenClaw's legacy skills directory (`~/.openclaw/skills/`), format matches the research SKILL.md inventory
- [ ] **MKT-03**: User selects a skill → daemon runs the Phase 84 migration utility (SKILL-01 pipeline) against that single skill, with secret-scan, frontmatter normalization, and idempotency all enforced
- [ ] **MKT-04**: Post-install, the daemon updates the bound agent's `skills:` list in `clawcode.yaml` using the v2.1 atomic writer and triggers hot-reload (skill is linked into the agent's catalog via the v1.4 global-install path)
- [ ] **MKT-05**: `/clawcode-skills-browse` rejects skills that would fail Phase 84 gates (secret scan, deprecation list, scope-tag mismatch) with an ephemeral explanation — does not silently skip
- [ ] **MKT-06**: Install operation emits a single summary Discord message to the invoking channel: skill name, install path, post-install catalog entry — no multi-message spam
- [ ] **MKT-07**: `/clawcode-skills` (no `-browse`) lists the currently installed skills for the bound agent with remove option (ephemeral select menu)

## Future Requirements (Deferred from v2.2)

Items intentionally pushed to a later milestone:

- **MODEL-F1**: Dual Discord model picker — OpenClaw's existing picker reads a materialized allowlist JSON written by the daemon, so both pickers source from `allowedModels`
- **MODEL-F2**: Combined model + effort select menu (single UI that sets both)
- **MODEL-F3**: `fallbackModels` field per agent for auto-degradation on overload (mirrors native `--fallback-model`)
- **SKILL-F1**: Port P2 skills (`power-apps-builder`, `remotion`, `workspace-janitor`, `test`) — pending scope need
- **EFFORT-F1**: Auto-escalate effort to max on v1.5 fork-to-Opus advisor call
- **CMD-F1**: Wire `/review` + `/security-review` to PR-webhook flows (ties to global security-reviewer agent pattern)
- **CMD-F2**: `/clear` via end-session + restart workaround (research recommends deferring; not SDK-dispatchable)
- **CMD-F3**: Native `/insights` published as weekly Discord embed per agent
- **TOOL-F1**: MCP tool call latency / success-rate per-tool telemetry surfaced in the v1.7 trace store
- **MKT-F1**: Community skills publishing (push a local skill into the marketplace for other agents/users)
- **MKT-F2**: Skill versioning + upgrade prompts when a newer version is available

## Out of Scope

- **WhatsApp / Telegram / other channel support** — already excluded in PROJECT.md; no change
- **Real-time mid-turn model/effort swap** — native `/effort` immediate-effect is for the next response; we don't reach into an in-flight turn
- **Porting deprecated OpenClaw skills** — `cognitive-memory` fights v1.x memory stack (confabulation risk); `openclaw-config` references dead gateway; `finmentum-content-creator.retired` already superseded by `new-reel`
- **Cosmetic native commands** — `/theme`, `/color`, `/tui`, `/focus`, `/keybindings`, `/statusline` have no Discord semantics
- **Daemon-scope native commands** — `/login`, `/logout`, `/exit`, `/doctor`, `/heapdump` apply at process scope, not per-agent; exposing via Discord would affect multiple agents
- **Third-party provider wizards** — `/setup-bedrock`, `/setup-vertex` violate the Anthropic-only constraint in PROJECT.md
- **Hardcoded native-command allowlist** — forbidden by CMD-01; the SDK init manifest is the only source of truth
- **Exposing raw token budget** (`MAX_THINKING_TOKENS=<N>`) to users — the level abstraction is the contract; raw numbers make UX brittle across model upgrades
- **Separate picker per-agent AND per-user** — per-agent scope is sufficient; per-user adds preference-storage cardinality without clear benefit
- **Auto-spawning nested Claude Code subprocesses from skills** — collides with v1.1 subagent spawning (`remotion` skill concern)

## Traceability

(To be populated by gsd-roadmapper after phase mapping.)

| REQ-ID | Phase | Plan |
|--------|-------|------|
| UI-01 | TBD (cross-cutting) | TBD |
| SKILL-01..08 | TBD | TBD |
| EFFORT-01..07 | TBD | TBD |
| MODEL-01..07 | TBD | TBD |
| CMD-00..07 | TBD | TBD |
| TOOL-01..07 | TBD | TBD |
| MKT-01..07 | TBD | TBD |

**Total requirements:** 45 (1 UI + 8 SKILL + 7 EFFORT + 7 MODEL + 8 CMD + 7 TOOL + 7 MKT)
