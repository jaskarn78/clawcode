# Phase 89: Agent Restart Greeting — Active Discord Send of Prior-Context Summary - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

When a ClawCode agent is explicitly restarted via `SessionManager.restartAgent()` (e.g., `/clawcode-restart <agent>`), the daemon proactively sends a Discord message to the agent's bound channel containing a Haiku-summarized recap of the prior session, so the human sees the agent come back online with a quick "here's where we left off" summary.

**In scope:**
- Discord-facing greeting message on individual agent restart
- Haiku-based fresh summarization of prior session for Discord-tuned length
- Per-agent opt-out + dormancy + empty-state + cool-down suppression
- Crash-recovery vs clean-restart message differentiation when classifiable
- Webhook + EmbedBuilder delivery via existing v1.6/v1.7 surfaces

**Out of scope (NOT this phase):**
- Changes to the v1.9 `assembleConversationBrief` / `conversation_context` passive prompt injection — that surface already feeds the agent's own system prompt and stays untouched
- Daemon-boot fleet-wide greetings — `startAll()` remains silent (agents load memory without pinging Discord)
- First-ever `startAgent()` greetings — only `restartAgent()` qualifies
- Fork + subagent-thread greetings — excluded by construction

</domain>

<decisions>
## Implementation Decisions

### Triggers
- **D-01:** Greeting fires **only** on `SessionManager.restartAgent()`. Neither the initial `startAgent()` from a fresh config nor `startAll()` boot-reconcile emit a greeting.
- **D-02:** Daemon `startAll()` stays silent. Agents reload memory and resume normally; operators learn "daemon came up" from logs, not Discord.
- **D-03:** Forks (`buildForkName` prefix from `src/manager/fork.ts`) and subagent threads (thread-origin detection from v1.2 `subagent-thread-spawner.ts`) are skipped — no greeting for either.
- **D-04:** Crash recovery vs clean restart use **different embed templates** when classifiable. Clean: "I'm back — last session: X." Crash: "Recovered after unexpected shutdown — last stable state: X." Classifier sources: `registry.restartCount` delta + `session-recovery.ts` signals (researcher to confirm reliable crash detector; if not reliably classifiable on a given path, default to clean template).

### Greeting content
- **D-05:** Summary source is a **fresh Haiku summarization at restart-time**, NOT a verbatim reuse of `assembleConversationBrief`. Researcher must evaluate whether the v1.9 `SessionSummarizer` pipeline (`src/manager/summarize-with-haiku.ts` — Haiku + 10s timeout + deterministic fallback) can be reused with a Discord-tuned prompt, vs a dedicated new summarizer. Reuse preferred if tuning covers the length constraint.
- **D-06:** Target length: **under ~500 characters** in embed description. Fits one-glance readability. Haiku prompt must enforce brevity.
- **D-07:** Surface **only the prior-session summary**. Exclude: last-active timestamp, active model, active effort, open-loops list. Minimal field set keeps the embed focused.
- **D-08:** **Agent's first-person voice** via the v1.6 webhook identity (per-agent avatar + display name from `webhook-manager.ts`). Matches every other agent-attributed Discord message; consistent identity.

### Fleet scope & opt-in
- **D-09:** Per-agent config flag `agents.*.greetOnRestart: boolean` with `defaults.greetOnRestart` fallback (default `true`). Schema addition follows the additive-optional pattern from Phase 83 (effortSchema) and Phase 86 (allowedModels). Hot-reload classification: **reloadable** — flag change takes effect on next restart without requiring daemon bounce. Any future persistence of runtime toggles goes through Phase 86's atomic YAML writer (`updateAgentModel` → `updateAgentGreetOnRestart` sibling helper pattern).
- **D-10:** Dormancy threshold: **skip greeting if agent's last activity > 7 days**. Activity source is the last turn's timestamp in the agent's ConversationStore. 7-day window catches short idle periods but mutes long-abandoned agents.
- **D-11:** **Empty-state: skip greeting entirely.** If the agent has no prior-session summary (never used, or just-migrated agent with zero history), no fallback minimal greeting — the restart is silent for that call only.
- **D-12:** Shared-workspace agents (finmentum family — 5 agents share `basePath`, each has its own channel): each agent greets its own bound channel on its own individual restart. `restartAgent()` is single-target; no cross-sibling fan-out or cross-sibling suppression.

### Delivery & dedup
- **D-13:** **Webhook + EmbedBuilder.** Per-agent webhook identity (v1.6 `webhook-provisioner.ts`) + EmbedBuilder structured render — UI-01 compliance, consistent with Phases 83/86/87/88. Subject to v1.2 `DiscordDeliveryQueue` retry + failed-message log.
- **D-14:** **Crash-loop suppression via per-agent cool-down.** Max 1 greeting per agent per **5-minute window** (default, configurable via `defaults.greetCoolDownMs` / `agents.*.greetCoolDownMs`). Track last-greeting-at timestamp per agent in-memory (daemon-scoped Map, like v1.2 cool-down patterns). Subsequent restartAgent() calls within the window skip silently (log debug, no Discord send).
- **D-15:** **New message every restart** — no edit-in-place. Scroll history of past greetings stays in the channel. Avoids storing messageId across daemon lifecycles and stays resilient to manual message deletions.
- **D-16:** **Delivery failure: log + continue session start.** Greeting is best-effort — if Discord send fails (channel deleted, webhook 401, rate limit exhaustion), log via pino and let `restartAgent()` complete normally. Follows the Phase 83/86/87 canary blueprint: synchronous caller + fire-and-forget + `.catch` log-and-swallow. Restart success MUST NOT depend on Discord availability.

### Claude's Discretion
- Exact Haiku prompt wording for the <500-char Discord-tuned summary.
- Whether to reuse `SessionSummarizer` with a new prompt mode vs implement a thin sibling summarizer (`greetingSummarizer`) — researcher decides based on coupling/testability trade-offs.
- Crash-recovery classifier implementation (researcher to survey `registry.restartCount` delta, `session-recovery.ts` signals, and any `stopAgent` intentional-stop flag; if unreliable, default to clean template — do NOT invent a new tracking mechanism for this phase alone).
- Embed visual shape (title, color, thumbnail reuse from webhook avatar, footer text).
- Whether the cool-down Map survives daemon boot (in-memory reset on boot is acceptable — every boot starts fresh since `startAll()` is silent anyway).
- Exact schema field names (`greetOnRestart` vs `greetingsEnabled` vs similar — pick one consistent naming style).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-level artifacts
- `.planning/ROADMAP.md` §"Phase 89: Agent restart greeting" — phase entry (goal currently TBD — this CONTEXT.md is the authoritative goal source)
- `.planning/PROJECT.md` — v1.9 "Resume auto-injection" description; v1.6 webhook-per-agent identity; v1.2 Discord delivery queue
- `.planning/STATE.md` — recent decisions log (v2.2 zero-new-deps, UI-01 precedent across Phases 83/86/87/88)

### Prior-phase CONTEXT references
- `.planning/phases/83-extended-thinking-effort-mapping/83-CONTEXT.md` — fire-and-forget + `.catch` log-and-swallow blueprint + additive-optional schema extension pattern
- `.planning/phases/86-dual-discord-model-picker-core/86-CONTEXT.md` — atomic YAML writer (`updateAgentModel`) + IPC dispatch + reloadable classification + StringSelectMenuBuilder UI precedent
- `.planning/phases/87-native-cc-slash-commands/87-CONTEXT.md` — native command dispatch + per-agent SECURITY.md ACL gating + UI-01 precedent
- `.planning/phases/88-skills-marketplace/88-CONTEXT.md` — exhaustive-switch renderer + UI-01 embed pattern

### Codebase integration points (scout surface — researcher to deepen)
- `src/manager/session-manager.ts` — `startAgent()`, `restartAgent()`, `startAll()` lifecycle chokepoints (restartAgent at ~line 932)
- `src/manager/registry.ts` — `restartCount` persistence (increments in restartAgent at ~line 936)
- `src/manager/session-recovery.ts` — crash-classification signals (exit code / reconcile path / orphan detection)
- `src/manager/fork.ts` — `buildForkName` prefix detector (skip-forks rule D-03)
- `src/manager/summarize-with-haiku.ts` — v1.9 SessionSummarizer (Haiku + 10s timeout + deterministic fallback) — evaluate reuse for D-05
- `src/memory/conversation-brief.ts` + `src/memory/conversation-brief.types.ts` — v1.9 assembleConversationBrief helper — surface to NOT duplicate (this phase is the Discord-side sibling, not a replacement)
- `src/manager/conversation-brief-cache.ts` — per-agent cache pattern; Phase 89's cool-down Map (D-14) mirrors this in-memory daemon-scoped shape
- `src/manager/session-config.ts` — where `conversationStores` + `memoryStores` are threaded into `buildSessionConfig` (upstream pattern for the new greet flow)
- `src/discord/webhook-manager.ts` + `src/discord/webhook-provisioner.ts` — per-agent webhook identity (avatar + display name) for D-08/D-13
- `src/discord/delivery-queue.ts` + `src/discord/delivery-queue-types.ts` — v1.2 retry + failed-message log for D-16
- `src/discord/bridge.ts` — channel send entry points; `sendBudgetAlert` at ~line 1094 is a reference shape for a new `sendGreeting(channelId, embed)` helper
- `src/migration/yaml-writer.ts` — Phase 86 `updateAgentModel` pattern; sibling writer for any greet-config persistence (D-09 future toggle)
- `src/shared/types.ts` + `src/config/schema.ts` (zod) — where `agents.*.greetOnRestart` + `defaults.greetOnRestart` additive-optional schema fields live
- `clawcode.yaml` — the runtime config file receiving the new optional fields; v2.1 migrated fleet MUST parse unchanged (additive-only schema test)

### Operational refs
- `src/manager/effort-mapping.ts` — Phase 83 canary blueprint (synchronous caller + fire-and-forget + `.catch`); D-16 follows this shape
- `src/discord/slash-commands.ts` — eventual future `/clawcode-greet` toggle (deferred — NOT this phase)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **v1.9 SessionSummarizer** (`src/manager/summarize-with-haiku.ts`): Haiku + 10s timeout + deterministic fallback — candidate for fresh Discord-tuned summarization (D-05). Researcher to confirm reuse vs new sibling.
- **v1.9 assembleConversationBrief** (`src/memory/conversation-brief.ts`): NOT reused verbatim for the Discord greeting per D-05, but its session selection / terminated-session lookup logic may inform greeting's "which session to summarize" choice.
- **v1.6 webhook identity** (`src/discord/webhook-manager.ts` + `src/discord/webhook-provisioner.ts`): Per-agent avatar + display name for D-08/D-13 — zero new provisioning needed.
- **v1.2 DiscordDeliveryQueue** (`src/discord/delivery-queue.ts`): Retry + failed-message log — D-16 routes failures here for best-effort semantics.
- **Phase 86 atomic YAML writer** (`src/migration/yaml-writer.ts` → `updateAgentModel` shape): Template for any future `updateAgentGreetOnRestart` sibling if runtime toggles land (currently deferred).
- **Phase 83 fire-and-forget canary** (`src/manager/effort-mapping.ts`): Synchronous caller + `.catch` log-and-swallow — D-16's failure-non-blocking pattern.
- **registry.restartCount** (`src/manager/registry.ts`): Already incremented in `restartAgent` (~line 936) — crash-vs-clean classifier's baseline signal (D-04).

### Established Patterns
- **Additive-optional schema extension** (Phases 83 `effortSchema`, 86 `allowedModels`): `agents.*.greetOnRestart` + `defaults.greetOnRestart` follow this — v2.1 migrated configs parse unchanged.
- **Reloadable classification** (Phase 86 `allowedModels`): `greetOnRestart` follows — flag change takes effect next restart without daemon bounce.
- **UI-01 EmbedBuilder precedent** (Phases 83, 86, 87, 88): Structured embeds for all user-facing Discord surfaces. D-13 conforms.
- **Fire-and-forget + .catch log-swallow** (Phases 83, 86 setModel, 87 setPermissionMode): Non-blocking side effects on session lifecycle. D-16 conforms.
- **Per-agent in-memory daemon-scoped Map** (Phase 85 MCP state, Phase 73 conversation-brief cache): Pattern for the D-14 cool-down tracker.

### Integration Points
- **`SessionManager.restartAgent()` (src/manager/session-manager.ts:932)** — D-01 trigger point. Greeting emission wraps this method after `startAgent(name, config)` completes.
- **Silent `startAll()` (src/manager/session-manager.ts ~line 943)** — D-02 carve-out; `startAll` path explicitly does NOT call the greeting helper.
- **Fork detection (src/manager/fork.ts `buildForkName`)** — D-03 skip check.
- **ConversationStore per-agent (src/memory/conversation-store.ts)** — D-10 dormancy source (last-turn-timestamp query) and D-11 empty-state detector (zero terminated sessions).
- **WebhookManager.sendAs(agent, payload)** (or equivalent in `webhook-manager.ts`) — D-08/D-13 delivery vehicle; researcher to confirm exact API surface.

</code_context>

<specifics>
## Specific Ideas

- **No MCP state surface in greeting** — Phase 85's MCP readiness table stays in the agent's system prompt (stable prefix); Phase 89 greeting is deliberately minimal (prior-session summary only, D-07).
- **Haiku-tuned prompt MUST enforce <500 char target** — if Haiku output exceeds the budget, truncate with ellipsis rather than re-calling. Deterministic fallback path returns `""` (empty summary) which trips D-11 empty-state skip.
- **Cool-down Map in-memory only** — reset on daemon boot is acceptable because `startAll()` is silent (D-02), so no "boot-time spam" scenario exists to defend against.
- **Crash template should not leak internal state** — phrasing like "Recovered after unexpected shutdown" is operator-friendly; avoid exposing exit codes / stack traces / session-recovery internals in the Discord-facing copy.

</specifics>

<deferred>
## Deferred Ideas

- **Slash-command toggle `/clawcode-greet on|off`** — runtime enable/disable without YAML edit. Plausible follow-up once the YAML-flag + atomic writer foundation is proven. Out of scope for Phase 89.
- **Observability metrics** — counters for greetings sent / skipped (per reason) / failed, surfaced via `/clawcode-status` or a new `/clawcode-greet-stats`. Nice-to-have; not blocking v2.2 parity.
- **Per-channel greet policy** — currently per-agent; per-channel override (e.g., different rules for `#ops` vs `#general` for a multi-channel-bound agent) is a future refinement.
- **Edit-in-place greeting mode** — D-15 chose new-message; a future "quiet mode" that edits the last greeting in place is worth revisiting if crash-loop noise becomes a real complaint.
- **Greeting for fork sessions** — D-03 skips forks; if long-running escalation forks ever warrant their own "I'm the escalation fork, back online" signal, that's a future phase.
- **Active model + effort surface in greeting** — D-07 excludes; if operators later want "running on sonnet @ high" to appear in the embed, it's an additive field.

</deferred>

---

*Phase: 89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart*
*Context gathered: 2026-04-22*
