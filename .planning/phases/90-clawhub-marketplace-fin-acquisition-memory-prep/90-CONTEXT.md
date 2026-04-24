# Phase 90: ClawHub Marketplace + fin-acquisition Memory Prep - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning
**Source:** Synthesized from (1) Apr 23–24 conversation-history analysis of OpenClaw fin-acquisition channel (4,900 msgs), (2) v2.2 gap analysis of OpenClaw→ClawCode fin-acquisition migration readiness, (3) user decisions via AskUserQuestion on 2026-04-24.

<domain>
## Phase Boundary

Phase 90 delivers two inter-related capability bundles against the **ClawCode fin-acquisition agent** on the remote clawdy host, prepping it for an eventual (operator-triggered, not auto) cutover from the live OpenClaw fin-acquisition agent in Discord channel `1481670479017414767` (Ramy's financial advisory workflow):

**(A) ClawHub Marketplace Extension** — extends Phase 88's `/clawcode-skills-browse` to additionally discover and install from clawhub.ai (https://clawhub.ai, public skill + plugin registry, 52.7k skills, vector-search). Adds a sibling `/clawcode-plugins-browse` for ClawHub plugins that map to ClawCode `mcpServers` entries. Install-time config modal collects required env vars / secrets, rewrites to `op://clawdbot/…` 1Password references where possible. Reuses Phase 84 secret-scan + frontmatter normalize + idempotency + scope-tag check pipeline end-to-end for every downloaded package.

**(B) fin-acquisition Memory Activation** — the ClawCode fin-acquisition agent has all the artifacts from the v2.1 migration (MEMORY.md, 62 memory/*.md files, 15 skills, workspace) but none of them flow back into the agent's runtime context. Phase 90 activates them via: MEMORY.md auto-inject at session start, chokidar file-scanner with chunks+embeddings for memory/**/*.md, hybrid pre-turn retrieval, periodic mid-session flush to survive dashboard-restart SIGKILL, "remember this" cue detection, subagent-output capture. Closes the Apr 20 crisis ("remember the last thing we worked on?" → "memory's coming up empty") + Apr 23 gap ("do you recall the opus agent you spawned?" → "no memory of it").

**In scope:**
- `/clawcode-skills-browse` extension to ClawHub skills source (HUB-01, HUB-03)
- `/clawcode-plugins-browse` new slash command for ClawHub plugins → `mcpServers` (HUB-02, HUB-04)
- New `updateAgentMcpServers` atomic YAML writer (mirrors Phase 86 `updateAgentModel` + Phase 88 `updateAgentSkills`)
- Install-time config modal + `op://` rewrite + GitHub OAuth for authenticated fetches (HUB-05, HUB-07)
- Exhaustive install-outcome discriminated union for all failure modes (HUB-06)
- ClawHub catalog response caching with TTL (HUB-08)
- `MEMORY.md` auto-inject into the v1.7 stable-prefix at session start (MEM-01)
- chokidar file-watcher + new `memory_chunks` table with MiniLM embeddings (MEM-02)
- Hybrid (cosine + FTS) pre-turn retrieval injected into the mutable suffix (MEM-03)
- Periodic mid-session flush every 15 min to `memory/YYYY-MM-DD-HHMM.md` (MEM-04)
- "Remember this" cue detection → one-shot file write (MEM-05)
- Subagent-output capture → parent workspace memory file (MEM-06)
- fin-acquisition agent wiring in `clawcode.yaml` — MCP list, heartbeat, effort, allowedModels (WIRE-01..04)
- Webhook identity provisioning confirmation (WIRE-05)
- Initial `memory_chunks` backfill scanner run for fin-acquisition (WIRE-06)
- `.planning/migrations/fin-acquisition-cutover.md` runbook for the eventual manual cutover (WIRE-07)

**Out of scope (NOT this phase):**
- **The actual cutover flip** of OpenClaw channel `1481670479017414767` from `anthropic-api/claude-sonnet-4-6` to `clawcode/fin-acquisition` — explicitly deferred per user directive "we're going to prepare the agent but not cutover yet I'll do that manually"
- Clawhub skill/plugin **publishing** (reverse direction — posting local skills to clawhub.ai). User chose browse + install + configure only; publishing is a future phase
- **513MB uploads rsync** — runbook documents the rsync command (WIRE-07) but does not execute it (operator runs during cutover)
- Extending `MEMORY.md` auto-load or `memory_chunks` scanner to **non-fin-acquisition agents** as a first-class rollout — the infrastructure applies to every agent by design (schema is per-agent), but the Phase 90 success criteria only demand it works for fin-acquisition. Other agents (admin-clawdy, general, projects, research, personal, finmentum-content-creator, fin-playground, fin-research, fin-tax) inherit the capability with no extra work but are not separately verified in this phase
- **Plugin hot-reload** after `updateAgentMcpServers` writes — Phase 88 established the YAML hot-reload path for `skills:` but MCP server hot-add requires SDK restart; operator manually restarts agent after plugin install. Flag as defer
- **Embedding model upgrades** — sticks with existing MiniLM 384-dim (Phase 80 / v2.1 precedent). Any upgrade is a separate phase
- **Multi-workspace memory sharing** — each agent's `memory_chunks` remains isolated per agent. Cross-agent memory queries are not in scope
- **Web dashboard UI for clawhub browsing** — Discord-only surface (v1.2 Phase 29 dashboard stays silent on marketplace)

</domain>

<decisions>
## Implementation Decisions

### ClawHub API client
- **D-01 API base:** `https://clawhub.ai/api/v1` (confirmed via probe 2026-04-24; `/api/v1/skills` returns `{items, nextCursor}` paginated response; `/api/v1/plugins` expected to follow the same shape — planner verifies)
- **D-02 Auth:** GitHub OAuth, token stored in `op://clawdbot/ClawHub Token/credential`. Public browsing unauthenticated; auth only needed for rate-limit-avoidance on heavy fetches and for private/unpublished skills. Unauthenticated requests use `User-Agent: ClawCode/<version> (clawcode-marketplace)` header for rate-limit attribution
- **D-03 Pagination:** cursor-based via `nextCursor` field; fetch pages on-demand as user scrolls Discord `StringSelectMenuBuilder` (25-item cap per menu; "Load more…" sentinel item at position 25 triggers next-page fetch)
- **D-04 Search:** vector-search query forwarded as `?q=<urlencoded>` to ClawHub; ClawHub's backend (Convex + vector index per its marketing) does the work. ClawCode does NOT maintain a local vector index of ClawHub content
- **D-05 Cache:** in-memory TTL cache on the daemon, 10-minute default (configurable via `defaults.clawhubCacheTtlMs`), keyed by `{endpoint, query, cursor}`. Cache is daemon-scope, resets on daemon boot (acceptable — browse responses are never hot-path)
- **D-06 Rate-limit handling:** if ClawHub returns `429` or `Retry-After` header, surface an ephemeral "ClawHub rate-limited, try again in Ns" Discord message; cache the 429 for the `retry_after` duration so subsequent pickers in that window fail fast

### Install pipeline (skills + plugins share most of it)
- **D-07 Download:** skills = tar/zip archive streamed to a temp dir (`~/.clawcode/manager/clawhub-staging/<nanoid>/`), extracted, validated; plugins = JSON manifest + optional bundle. Temp dir cleaned up on success OR failure (try/finally)
- **D-08 Secret scan:** reuses Phase 84's `scan-secrets.ts` verbatim — same credential-context gate (high-entropy + label), same thresholds, hard refusal class for `password|secret|token|api_key|...` adjacent to high-entropy strings
- **D-09 Frontmatter normalization:** skills reuse Phase 84's transformer (adds `name:` + `description:` if missing). Plugins have their own manifest shape (`command`, `args`, `env`, `description`) — new normalizer enforces ClawCode's `mcpServers:` schema from `src/config/schema.ts`
- **D-10 Idempotency:** hash-based (Phase 84 + Phase 88 pattern). `memory_chunks`-style `files` table tracks installed `{source, source_version, hash, installed_at}` — re-install is a no-op if hash matches
- **D-11 Scope tags:** skills inherit Phase 84 scope map (fin* → finmentum, clawdy/jas → personal, else → fleet). Plugins default to agent-scoped (only install on the invoking agent unless operator uses `--fleet` flag in CLI variant)
- **D-12 op:// rewrite:** when install-time config surfaces a required credential, check if the operator has a matching 1Password item via `op item list --categories=Credential,API --format=json` (read-only, returns item UUIDs + titles); if a title matches the credential label (fuzzy — Levenshtein ≤ 3 or substring), propose `op://clawdbot/<title>/<field>`. Operator confirms via button. If no match, operator can type a 1Password path manually OR paste a literal (literal requires explicit "I know this leaves a secret in YAML" confirmation button — Phase 88 secret-scan precedent)

### Config modal UX (Discord-level)
- **D-13 Modal vs follow-up:** Discord `ModalBuilder` supports up to 5 `TextInputBuilder` rows per modal. If skill/plugin requires ≤5 config fields → single modal. If >5 → serialize as follow-up prompts (ephemeral message + button flow) with progress indicator ("Step 3/8 — configure DATABASE_URL")
- **D-14 Field types:** `short` for single-line (API keys, usernames, URLs), `paragraph` for multi-line (SSH keys, JSON blobs). Default to `short`; plugin manifest can override via `config.fields[].type: "long"`
- **D-15 Validation:** regex validation hints declared in plugin manifest (`config.fields[].pattern`) surfaced in modal `placeholder`. Submit-time validation runs the regex before any write
- **D-16 Secret field indicator:** config fields with `sensitive: true` in manifest get ⚠️ emoji prefix in label + placeholder text "op:// reference preferred"

### Memory activation
- **D-17 MEMORY.md size cap:** 50KB hard cap. If larger, load first 50KB + truncation marker + kick off a background chunker to index the rest (MEM-02 handles it anyway). 50KB ~ 12.5K tokens — within Sonnet's stable-prefix budget comfortably
- **D-18 MEMORY.md load placement:** inject AFTER SOUL.md + IDENTITY.md in the v1.7 stable prefix, BEFORE the MCP tool-status table (Phase 85). Order: SOUL → IDENTITY → MEMORY → MCP status → conversation history. The stable-prefix cache-hash includes MEMORY.md, so mtime changes bust the cache — acceptable since MEMORY.md evolves slowly (hours, not minutes)
- **D-19 File-scanner watched paths:** `{workspace}/memory/**/*.md` (recursive), `{workspace}/memory/vault/**/*.md` (weighted +0.2 cosine score — higher priority for ground-truth docs), `{workspace}/memory/procedures/**/*.md` (+0.1), `{workspace}/memory/archive/**/*.md` (weight −0.2 — lower priority, older content), top-level `{workspace}/MEMORY.md` (not chunked — handled by MEM-01), `{workspace}/HEARTBEAT.md` (not chunked — operator-written, always-loaded separately if heartbeat enabled)
- **D-20 Chunk boundary:** split by H2 headings (`## `), with max 800-token chunk size (soft cap; split at H3 if still too large). Overlap zero — memory docs are curated, not prose; no need for sliding window
- **D-21 Embedding model:** existing MiniLM (all-MiniLM-L6-v2, 384-dim) from `@huggingface/transformers` per v2.1 / Phase 80 precedent. NO upgrade in this phase
- **D-22 `memory_chunks` table location:** same SQLite file as `memories` (`{memoryPath}/memories.db`) — not a separate file. `sqlite-vec` virtual table `vec_memory_chunks` for KNN. `memory_chunks_fts` FTS5 virtual table for keyword search
- **D-23 Retrieval fusion:** hybrid (RRF) — cosine top-20 + FTS top-20 → reciprocal-rank-fusion → top-5 injected. K configurable via `defaults.memoryRetrievalTopK`, default 5. Token budget per retrieval block: 2000 tokens max (truncate chunk tail if needed)
- **D-24 Retrieval filters:** time-window filter applied BEFORE ranking: last 14 days of `memory/*.md` dated files ∪ all-time `memory/vault/**` ∪ all-time `memory/procedures/**`. Older dated files are IGNORED unless explicitly queried (prevents 3-month-old archive noise)
- **D-25 Retrieval query source:** extract from last user turn (entire user message, no fancy NLP). Optional prepend of last 2 turns if user turn < 20 chars (likely a short follow-up like "yes" / "continue")

### Mid-session flush (MEM-04)
- **D-26 Flush cadence:** 15 min default, configurable via `defaults.memoryFlushIntervalMs` + `agents.*.memoryFlushIntervalMs`. Skip if no meaningful turns since last flush (heuristic: ≥1 user turn AND ≥1 assistant turn with a tool call or ≥200 chars of text output)
- **D-27 Flush content:** Haiku-summarized delta of the current session since last flush. Prompt: "Summarize the most important decisions, tasks in progress, and standing rules from this session segment. Under 300 words, markdown sections, no meta-commentary." Reuses `summarize-with-haiku.ts` (Phase 89 precedent)
- **D-28 Flush file path:** `{workspace}/memory/YYYY-MM-DD-HHMM.md` atomic temp+rename (Phase 82 yaml-writer discipline). Filename uses turn-start timestamp to make concurrent agents' flushes non-colliding
- **D-29 Flush on stop:** final flush on `stopAgent()` (before drain timeout). If flush is already in flight when stop fires, await it (up to 10s cap). Phase 89 drain hook extended

### "Remember this" cue detection (MEM-05)
- **D-30 Cue regex:** case-insensitive `(remember( this)?|keep this (in )?(long[- ]?term )?memory|standing rule|don'?t forget|note for later|save to memory)`. Applied to user turn text AND to assistant tool-call args where `name=="Memory"` (if such a tool exists — research confirms)
- **D-31 Write behavior:** on cue detection, writes `{workspace}/memory/YYYY-MM-DD-remember-<nanoid4>.md` immediately BEFORE the next turn. Content = the containing paragraph (3 sentences max) + turn timestamp + Discord message link (if available)
- **D-32 Confirmation UX:** after write, agent posts an ephemeral Discord reaction ✅ to the originating user message (not a reply — minimize chat noise). Skill-authors can override the reaction emoji via agent config `memoryCueEmoji`

### Subagent-output capture (MEM-06)
- **D-33 Trigger:** when the parent agent's `Task(...)` tool-use returns (success path) — hook into the native `Task` tool-return interceptor (Phase 85 pattern where MCP results flow through a wrapper). Subagent final report (from its last assistant turn) → written to `memory/YYYY-MM-DD-subagent-<slug>.md` where slug = first 40 chars of the subagent description
- **D-34 Content shape:** markdown with frontmatter (spawned_at, duration_ms, subagent_type, task_description, return_summary)
- **D-35 Skip criteria:** Task tool invocations with subagent_type=`gsd-*` (GSD internal agents) are EXCLUDED — they have their own planning artifacts and would spam memory/

### fin-acquisition wiring (WIRE-01..07)
- **D-36 MCP list:** `mcpServers: [finmentum-db, finmentum-content, google-workspace, browserless, fal-ai, brave-search]`. These 6 cover: pipeline CRM (MySQL), PDF/HeyGen/newsletters, Drive, browser automation, image edits, search fallback. Excluded: `finnhub` (agent uses Polygon directly via shell per MEMORY.md Research Protocol), `homeassistant` / `strava` (unrelated to advisory domain), `elevenlabs` / `chatterbox-tts` (content-creator domain), `ollama` (no evidence of use), `openai` / `anthropic` (model providers, handled by ClawCode itself not by MCP tool)
- **D-37 Heartbeat:** `heartbeat: { every: 50m, model: haiku, prompt: "<exact OpenClaw heartbeat prompt>" }` — preserve OpenClaw's proven 50-minute cadence and HEARTBEAT.md-reading prompt verbatim (found at `~/.openclaw/workspace-finmentum/HEARTBEAT.md` — auto-reset disabled, context-zone monitor, snapshot template)
- **D-38 Effort:** `effort: auto` (Phase 83 default, maps to OpenClaw's `thinkingDefault: adaptive`)
- **D-39 AllowedModels:** `[sonnet, opus, haiku]`. Excludes the 50+ OpenAI/Google/OpenRouter/Minimax fallbacks from OpenClaw's list — ClawCode is Claude-family-only per PROJECT.md Constraints
- **D-40 greetOnRestart:** inherit default `true` (Phase 89) — Ramy gets a "I'm back, here's where we left off" after any ClawCode restart. `greetCoolDownMs` default 300000 (5 min)
- **D-41 Webhook identity:** verify via `webhook-provisioner` runtime probe that a webhook exists for fin-acquisition in the `Finmentum Discord` guild with display_name="Finance Clawdy" and the 🤝 avatar. If missing, auto-provision (v1.6 Phase 47 pattern — webhook auto-provisioning)
- **D-42 Backfill scanner:** one-shot CLI `clawcode memory backfill fin-acquisition` runs MEM-02 scanner against the existing workspace. Idempotent (re-run safe). Emits progress: `[INFO] Indexed 62 memory/*.md files, 487 chunks, 214KB embeddings`
- **D-43 Cutover runbook:** `.planning/migrations/fin-acquisition-cutover.md` — checklist-style markdown with pre-cutover verification steps (op:// auth, MCP readiness, uploads rsync command, OpenClaw channel config flip procedure, rollback procedure, observability during Day-1 canary)

### Claude's Discretion (defer to implementation)
- Exact Discord embed visual shape for `/clawcode-skills-browse` and `/clawcode-plugins-browse` (following Phase 88 precedent — UI-01 StringSelectMenuBuilder)
- Plugin manifest JSON schema precise field names (research confirms clawhub.ai's plugin shape; if it's already defined upstream, use that verbatim)
- Hybrid retrieval RRF K constant (default 60 per original RRF paper; tune empirically)
- GitHub OAuth redirect flow — whether to use device-code flow (better for CLI/headless) or web-redirect (requires public HTTPS callback). Device code recommended since ClawCode daemon runs headless
- Whether to add a `/clawcode-skills-refresh` command to force-bust the D-05 cache (nice-to-have, flag as optional)
- Whether MEM-04 flush uses the Phase 89 restart-greeting summarizer verbatim or creates a sibling with a different prompt (reuse preferred)
- Subagent slug collision handling in MEM-06 (append nanoid suffix if slug already exists that day)
- Error handling for ClawHub manifest-schema-version mismatches (old manifest, new ClawCode → probably forward-compatible; new manifest, old ClawCode → reject with upgrade prompt)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase-level artifacts
- `.planning/ROADMAP.md` — Phase 90 entry with goal, 21 requirements, 14 success criteria, 7-plan decomposition hint
- `.planning/PROJECT.md` — v2.2 Key Decisions (canary blueprint, additive-optional schema, pure-function DI, atomic YAML writer, DeliveryQueue bypass, restart greeting)
- `.planning/STATE.md` — post-v2.2 state, Phase 90 listed as current focus
- `.planning/milestones/v2.2-MILESTONE-AUDIT.md` — cross-phase integration map, canary blueprint consistency, DI order in daemon.ts

### Prior-phase SUMMARYs (direct dependencies)
- `.planning/milestones/v2.2-phases/84-skills-library-migration/84-01-SUMMARY.md` through `-03-SUMMARY.md` — secret-scan, frontmatter normalize, ledger, scope-tag map, source-readonly invariant
- `.planning/milestones/v2.2-phases/85-mcp-tool-awareness-reliability/85-01-SUMMARY.md` — JSON-RPC readiness handshake, MCP state Map, heartbeat reconnect, verbatim error pass-through, list-mcp-status IPC
- `.planning/milestones/v2.2-phases/86-dual-discord-model-picker-core/86-02-SUMMARY.md` — `updateAgentModel` atomic YAML writer shape (parseDocument + temp+rename + secret-guard + 5 typed outcomes)
- `.planning/milestones/v2.2-phases/88-skills-marketplace/88-01-SUMMARY.md` — `loadMarketplaceCatalog`, `installSingleSkill`, `updateAgentSkills` contracts; SkillInstallOutcome 8-variant discriminated union; exhaustive-switch renderer
- `.planning/milestones/v2.2-phases/88-skills-marketplace/88-02-SUMMARY.md` — Discord `/clawcode-skills-browse` inline-handler short-circuit pattern, IPC intercept before routeMethod
- `.planning/milestones/v2.2-phases/89-agent-restart-greeting-active-discord-send-of-prior-context-summary-on-restart/89-02-SUMMARY.md` — fire-and-forget canary, setWebhookManager DI, cool-down Map, stopAgent cleanup

### v1.x foundations (still load-bearing)
- Phase 47 (v1.6): webhook auto-provisioning — `src/discord/webhook-provisioner.ts`
- Phase 48 (v1.6): scheduled consolidation — cron discipline for background flushes
- Phase 53 (v1.7): two-block prompt assembler (stable prefix + mutable suffix) — MEM-01/MEM-03 injection site
- Phase 80 (v2.1): memory translation + MiniLM 384-dim embedding + origin_id idempotency — MEM-02 patterns
- Phase 64–68 (v1.9): ConversationStore, capture integration, summarizer, resume auto-injection — MEM-04 reuses summarizer

### Codebase integration points (planner to deepen)
- `src/config/schema.ts` — additive-optional fields (MEM: `memoryAutoLoad`, `memoryAutoLoadPath`, `memoryFlushIntervalMs`, `memoryRetrievalTopK`; HUB: `clawhubBaseUrl`, `clawhubCacheTtlMs`; agent: `memoryCueEmoji`). Phase 83/86/89 additive-optional precedent
- `src/config/types.ts` RELOADABLE_FIELDS — which new fields are hot-reloadable
- `src/config/loader.ts` — resolver fallbacks
- `src/memory/store.ts` — `memories` + `vec_memories` today; adds `memory_chunks`, `vec_memory_chunks`, `memory_chunks_fts`, `files` (idempotency tracking — distinct from Phase 84's skill ledger)
- `src/memory/memory-scanner.ts` (new) — chokidar watcher + chunk+embed pipeline
- `src/memory/memory-retrieval.ts` (new) — hybrid RRF retrieval
- `src/manager/session-config.ts` — inject MEMORY.md + retrieval chunks into stable prefix / mutable suffix
- `src/manager/turn-dispatcher.ts` — pre-turn retrieval hook (before TurnDispatcher.dispatchStream)
- `src/manager/session-manager.ts` — mid-session flush timer, stopAgent flush-await extension, subagent-output capture hook
- `src/manager/effort-mapping.ts` — Phase 83 canary pattern reused for fire-and-forget flushes + cue writes
- `src/marketplace/load-marketplace-catalog.ts` (Phase 88) — extend with ClawHub source
- `src/marketplace/install-single-skill.ts` (Phase 88) — generalize to cover plugin install path
- `src/marketplace/clawhub-client.ts` (new) — HTTP client + auth + cache
- `src/marketplace/install-plugin.ts` (new) — plugin install pipeline
- `src/marketplace/update-agent-mcp-servers.ts` (new) — atomic YAML writer mirroring updateAgentModel + updateAgentSkills
- `src/discord/slash-commands.ts` — inline handler short-circuit for `/clawcode-skills-browse` (already Phase 88) + new `/clawcode-plugins-browse`
- `src/discord/config-modal.ts` (new) — Discord ModalBuilder flow for install-time config
- `src/ipc/server.ts` — new IPC handlers: `marketplace-clawhub-search`, `marketplace-clawhub-install-skill`, `marketplace-clawhub-install-plugin`
- `scripts/memory-backfill.ts` (new) — `clawcode memory backfill <agent>` CLI
- `.planning/migrations/fin-acquisition-cutover.md` (new) — runbook

### External references
- https://clawhub.ai — public skill registry; `/api/v1/skills` + `/api/v1/plugins` endpoints (planner to probe for full API shape)
- https://github.com/openclaw/clawhub — open-source backend (Convex)
- `~/.openclaw/workspace-finmentum/MEMORY.md` (13.5KB, hand-curated) — reference for what the ClawCode fin-acquisition MEMORY.md should look like post-MEM-01
- `~/.openclaw/workspace-finmentum/HEARTBEAT.md` — reference content for WIRE-02
- `~/.openclaw/memory/fin-acquisition.sqlite` (97MB, `chunks` + `files` schema) — reference schema for MEM-02 `memory_chunks` table
- `/home/jjagpal/.clawcode/agents/finmentum/memory/` (62 .md files, migrated v2.1) — WIRE-06 backfill source
- `/home/jjagpal/.clawcode/agents/finmentum/MEMORY.md` (27KB, migrated v2.1) — target of MEM-01 auto-load for fin-acquisition

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`loadMarketplaceCatalog`** (Phase 88 `src/marketplace/load-marketplace-catalog.ts`) — read-only unioned catalog, currently unions local skills + configured legacy sources. Extend: add ClawHub as a configurable source entry `{ kind: "clawhub", baseUrl, authToken?, cacheTtlMs }`
- **`installSingleSkill`** (Phase 88) — 8-outcome discriminated union installer. Generalize return type to `InstallOutcome = SkillInstallOutcome | PluginInstallOutcome` (tagged union), extend the installer to dispatch on `kind: "skill" | "plugin"`
- **`updateAgentSkills`** (Phase 88, `src/migration/yaml-writer.ts`) — atomic temp+rename YAML writer for `agents[name].skills: [...]`. Copy-paste-adapt for `updateAgentMcpServers` (agents[name].mcpServers: [...])
- **`scanSecrets`** (Phase 84) — secret-scan gate with credential-context detection. Reuse verbatim for both skill SKILL.md and plugin manifest env values
- **`summarizeWithHaiku`** (v1.9 + Phase 89, `src/manager/summarize-with-haiku.ts`) — Haiku + 10s timeout + deterministic fallback. Reuse for MEM-04 flush summarization
- **`scan-secrets.ts`** (Phase 84 guards) — credential-context gate. Reuse for D-08
- **Phase 83/86/87/89 fire-and-forget canary** — `effort-mapping.ts` pattern: synchronous caller + `void fn().catch(log.warn)`. Reuse for MEM-04 flush + MEM-05 cue write
- **`performMcpReadinessHandshake`** (Phase 85) — pure-function DI blueprint for `memory-scanner.ts`, `memory-retrieval.ts`, `clawhub-client.ts`, `install-plugin.ts`
- **MiniLM embedder** (Phase 80) — `@huggingface/transformers` all-MiniLM-L6-v2, 384-dim. Reuse verbatim
- **`sqlite-vec`** (v1.1 `vec_memories` + v1.6 Phase 49 RAG chunks) — `vec_memory_chunks` table pattern established
- **`ConversationStore.prototype.listRecentTerminatedSessions` + `getTurnsForSession`** (v1.9) — MEM-04 flush input
- **v1.7 two-block prompt assembler** — stable prefix injection site for MEM-01 (MEMORY.md), mutable suffix injection site for MEM-03 (retrieved chunks)

### Established Patterns
- **Additive-optional schema extension** (Phase 83, 86, 89) — `z.type().optional()` at agent level + `z.type().default(X)` at defaults level + RELOADABLE_FIELDS list + loader resolver fallback + v2.1 migrated fleet parses unchanged
- **Atomic YAML writer** (Phase 82 `yaml-writer.ts` → Phase 86 `updateAgentModel` → Phase 88 `updateAgentSkills`) — parseDocument AST + temp+rename + secret-guard + 5-outcome discriminated union
- **Fire-and-forget canary** (Phase 83 setEffort, Phase 86 setModel, Phase 87 setPermissionMode, Phase 89 sendRestartGreeting) — synchronous caller + `.catch(log.warn)` + spy-test regression pin
- **Pure-function DI + Deps struct** (Phase 85 `performMcpReadinessHandshake`, Phase 89 `sendRestartGreeting`) — 100% unit-testable; all I/O injected
- **Exhaustive-switch discriminated-union outcomes** (Phase 88 8-variant `SkillInstallOutcome`) — compile-time zero-silent-skip invariant
- **Inline handler short-circuit BEFORE CONTROL_COMMANDS** (Phase 85 /clawcode-tools, Phase 86 /clawcode-model, Phase 88 /clawcode-skills-browse) — routes EmbedBuilder-bearing commands before generic control dispatch
- **IPC intercept BEFORE routeMethod** (Phase 88 marketplace handlers) — closure-based, daemon-local
- **Stable prefix cache + mutable suffix** (Phase 53 v1.7) — prompt caching preservation
- **Heartbeat framework** (v1.0 Phase 5, v1.6 Phase 48) — agent config `heartbeat: { every, model, prompt }`
- **Webhook auto-provisioning** (v1.6 Phase 47) — `webhook-provisioner.ts`
- **Phase 84 secret-scan invariant** — credential-context gate (high-entropy + label proximity) NOT pure high-entropy; word-boundary exemption for compound identifiers

### Integration Points
- **`daemon.ts` DI wiring** (established order per v2.2 audit): SessionManager construct → setSkillsCatalog → WebhookManager construct (3 branches) → setWebhookManager → setMcpStateProvider → startAll. MEM scanner gets added to this sequence as `setMemoryScanner` between `setSkillsCatalog` and `setWebhookManager` (scanner must be ready before any agent session starts)
- **Discord slash-commands inline handler order** (Phase 85/86/87/88): `clawcode-tools → clawcode-model → clawcode-permissions → clawcode-skills-browse → clawcode-skills → CONTROL_COMMANDS → native/prompt-channel → clawcode-effort`. `clawcode-plugins-browse` inserts after `clawcode-skills` and before CONTROL_COMMANDS
- **100-command-per-guild cap** — current count ~16-18; Phase 90 adds `/clawcode-plugins-browse` + (optional) `/clawcode-skills-refresh` = 18-20. Well within the 90-assertion ceiling
- **`~/.clawcode/agents/<agent>/memories.db`** — per-agent SQLite, `memory_chunks` lands here as a new table alongside `memories` + `vec_memories`
- **`~/.clawcode/manager/`** — daemon-scoped state; ClawHub cache lives in-memory only (no disk), ClawHub staging temp dirs cleaned per-install

</code_context>

<specifics>
## Specific Ideas

- **ClawHub API shape assumption to verify:** `/api/v1/skills?cursor=X&q=Y` returns `{items: [{id, name, description, version, author, downloadUrl, manifestUrl, rating, downloadCount, category, tags[], createdAt, updatedAt}], nextCursor: string|null}`. Planner MUST probe with one live request and adapt to actual schema
- **Plugin manifest assumption:** `{name, description, version, command, args[], env: {<name>: {default?, required, sensitive, description}}, config: {fields: [{name, label, type, placeholder, pattern, sensitive}]}, dependencies?: {mcpServers: [<name>]}, documentation?: <url>}`. Verify against clawhub.ai/api/v1/plugins actual shape
- **Ramy's exact pain-point quotes as regression targets** (MUST still be answerable after fin-acquisition backfill — MEM-03 acceptance test):
  - "do you recall if we already applied these changes?" (requires recent session retrieval)
  - "Earlier you said Allan might be complicated to do the IRA pass through" (cross-session fact recall)
  - "I thought you said we can pull these from the schwab data delivery dump?" (multi-day memory)
  - "note, my company name is not Finmentum Investment Advisors LLC, it's just 'Finmentum LLC' remember this" (already in MEMORY.md per 2026-04-20; MEM-01 must surface it without retrieval)
  - "Remember in your long term memory, whenever I upload a transcript for a client, keep the raw transcript in their file" (standing-rule, goes to memory/procedures/ or a dated file)
- **OpenClaw HEARTBEAT.md content to mirror verbatim** in ClawCode: auto-reset DISABLED directive, context-zone thresholds (green/yellow/orange/red), context snapshot template, user-facing messages
- **Pre-cutover verification** baked into WIRE-07 runbook: confirm `clawcode mcp-status fin-acquisition` shows 6/6 ready, confirm fin-acquisition session can be started and reads MEMORY.md successfully (log assertion), confirm `memory_chunks` count >200 chunks post-backfill, confirm webhook identity renders "Finance Clawdy" + 🤝 in a test message
- **ClawHub auth prompt to operator:** if install requires auth, surface "Paste clawhub token → stored to 1Password as `ClawHub Token`" flow or GitHub OAuth device-code with user-code shown in Discord embed

</specifics>

<deferred>
## Deferred Ideas

- **Clawhub skill/plugin publishing** (reverse direction) — `/clawcode-skills-publish` command that packages a local skill + posts to clawhub.ai. Requires GitHub OAuth + ClawHub publish API + operator approval flow. Follow-up phase once browse+install is proven
- **Plugin hot-reload after install** — Phase 90 requires manual agent restart after plugin install (YAML watcher exists but MCP subprocess doesn't SIGHUP). Future phase closes this
- **Cross-agent memory sharing** — each agent's `memory_chunks` is isolated. Cross-agent queries ("what did fin-research tell me about Polygon yesterday?") need a shared index + access control. Defer
- **Embedding model upgrades** — v2.3 or later could swap MiniLM → larger model. Not scoped here
- **Web dashboard marketplace UI** — Discord-only in Phase 90. Web dashboard extension is a follow-up
- **Skill/plugin update notifications** — when clawhub publishes a new version of an installed package, notify the operator. Nice-to-have, not blocking
- **Batch install from a collection** — "install this curated skill pack" (7 skills in one flow). Post-Phase-90
- **Multi-tenant ClawHub** — private workspaces / org-scoped skills. Assumes ClawHub backend supports it; orthogonal to Phase 90's public browse
- **Memory pruning / archive rotation** — `memory/*.md` grows unbounded. A future phase could age-out old dated files to `memory/archive/YYYY-MM/` after 90 days. Currently just lives on disk
- **Subagent capture for GSD internal agents** (D-35 exclusion) — could enable with operator opt-in flag if someone wants to retain GSD agent output for debugging. Out of scope
- **Cutover automation** — automated flip of OpenClaw channel binding. User explicitly wants this manual. Defer indefinitely

</deferred>

---

*Phase: 90-clawhub-marketplace-fin-acquisition-memory-prep*
*Context gathered: 2026-04-24*
