---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
stopped_at: Completed 91-02-PLAN.md
last_updated: "2026-04-24T20:00:03.772Z"
last_activity: 2026-04-24
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 6
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23 after v2.2 milestone completion)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 91 — OpenClaw ↔ ClawCode fin-acquisition Workspace Sync

## Current Position

Phase: 91 (OpenClaw ↔ ClawCode fin-acquisition Workspace Sync) — EXECUTING
Plan: 3 of 6

## Performance Metrics

**Velocity:**

- Total plans completed: 70+ (v1.0-v2.1 across 12 milestones)
- Average duration: ~3.5 min
- Total execution time: ~4+ hours

**Recent Trend:**

- v2.1 plans: stable 5-32min each (40 plans shipped in ~1 day)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.2 Roadmap]: Zero new npm deps — entire milestone runs on existing stack (Claude Agent SDK 0.2.97, discord.js 14.26.2, better-sqlite3, yaml 2.8.3, zod 4.3.6). Verified by .planning/research/STACK.md against installed node_modules/sdk.d.ts.
- [v2.2 Roadmap]: SDK pin to EXACT 0.2.97 (not ^0.2.97) — pre-1.0 churn risk; minor versions may break setModel/setPermissionMode/setMaxThinkingTokens/supportedCommands surface.
- [v2.2 Roadmap]: Phase 83 (Effort) FIRST as SDK canary — fixes P0 silent no-op at persistent-session-handle.ts:599 AND validates SDK mid-session mutation strategy for 86 (setModel) and 87 (setPermissionMode). Cannot ship 86/87 confidently without 83's spy-test proof of q.setMaxThinkingTokens live concurrency.
- [v2.2 Roadmap]: Namespace locked BEFORE Phase 87 — all ClawCode Discord commands MUST be `clawcode-*` prefixed. Bare /model, /clear, /memory rejected (OpenClaw + community-bot collision risk). Phase 86 establishes the unified /clawcode-model as the convention Phase 87 follows for every SDK-reported slash command.
- [v2.2 Roadmap]: Phase 86 depends on Phase 83, not the other way around — effort wiring is smaller surface (one SDK call) and its spy-test pattern is the template for the model-setter wiring in Phase 86. If q.setMaxThinkingTokens races the driver iterator, Phase 86 is in trouble too.
- [v2.2 Roadmap]: Phase 88 (Marketplace) reuses Phase 84 migration pipeline — one skill at a time, same secret-scan + frontmatter normalization + idempotency gates. No parallel skill-install pipeline built; marketplace is a Discord wrapper around the Phase 84 CLI.
- [v2.2 Roadmap]: UI-01 cross-cutting, validated per-phase — single requirement spans 4 UI-bearing phases (83 effort picker, 86 model picker, 87 autocomplete + control-plane commands, 88 skills browser). Each phase's acceptance includes UI-01 compliance; no single phase "owns" UI-01.
- [v2.2 Roadmap]: Dual Discord picker deferred to future milestone (MODEL-F1) — v2.2 ships the core picker with IPC dispatch + allowedModels schema foundation; OpenClaw-side read of materialized allowlist JSON is a follow-up once the ClawCode core is proven.
- [v2.2 Roadmap]: CMD-00 SDK spike is a gate, not a task — 30-minute throwaway script against `sdk.query({prompt, options})` confirming mid-session q.setModel/q.setPermissionMode/q.setMaxThinkingTokens concurrency safety against the single captured driverIter handle, committed to `.planning/research/CMD-SDK-SPIKE.md` BEFORE any Phase 87 implementation code lands.
- [v2.2 Roadmap]: Phase 85 (MCP Tool Awareness) is fully independent — no dependency on 83/86/87. Uses v1.3 MCP health-check infrastructure + v1.7 two-block prompt assembly; can ship in parallel with 83/84 for quickest delivery of the phantom-error fix.
- [Phase 83]: Plan 83-01 — Extended effortSchema to 7 levels (additive — v2.1 migrated configs parse unchanged via regression test); off=0 (number) and auto=null (model default) semantically distinct for Plan 02 persistence.
- [Phase 83]: Plan 83-01 — Closed P0 silent no-op at persistent-session-handle.ts:599 by wiring q.setMaxThinkingTokens. Pinned by spy test (8 tests); setEffort stays synchronous via fire-and-forget + .catch log-and-swallow pattern.
- [Phase 83]: Plan 83-01 — SDK session-start 'effort' option stays narrow (low|medium|high|max); extended levels (xhigh|auto|off) route exclusively through runtime q.setMaxThinkingTokens. Legacy wrapSdkQuery gets narrowEffortForSdkOption helper for type compliance.
- [Phase 83]: Plan 83-01 — Effort classified reloadable (agents.*.effort, defaults.effort) because live handle.setEffort takes effect next turn — no socket/db/workspace restart.
- [Phase 83]: Plan 83-01 SDK canary result — q.setMaxThinkingTokens concurrency SAFE against single captured driverIter handle. Spy-test shape unblocks Phase 86 (setModel) and Phase 87 (setPermissionMode) to follow the same regression-pin blueprint.
- [Phase 83]: Plan 83-03 — UI-01 StringChoices 7-entry dropdown for /clawcode-effort replaces free-text (schema extended with optional choices capped at 25 per Discord).
- [Phase 83]: Plan 83-03 — /clawcode-status is a daemon-side short-circuit returning authoritative 🎚️ Effort line from sessionManager.getEffortForAgent (no LLM turn consumed, trades rich self-report for reliability).
- [Phase 83]: Plan 83-03 — SKILL.md effort: frontmatter → SkillEntry.effort → TurnDispatcher.dispatch skillEffort option with try/finally revert at turn boundary; slash-command path wraps streamFromAgent with same apply+revert contract.
- [Phase 83]: Plan 83-02 — Runtime effort persistence via dedicated ~/.clawcode/manager/effort-state.json (NOT registry.json extension); atomic temp+rename write; graceful null fallback on corruption/missing/invalid; fire-and-forget persist at setEffortForAgent, re-apply in startAgent BEFORE warm-path gate.
- [Phase 83]: Plan 83-02 — Fork effort quarantine (EFFORT-06) pinned by explicit 'effort: parentConfig.effort' line in buildForkConfig + 6 tests (3 unit + 3 SessionManager integration). Prevents v1.5 fork-to-Opus cost spike: runtime override on parent does NOT propagate into fork; fork launches at parent CONFIG default.
- [Phase 84]: Plan 84-01 — Skills ledger is SEPARATE file (v2.2-skills-ledger.jsonl) from v2.1 agent ledger; keeps v2.1 byte-stable as regression pin. Mirrors v2.1 ledger.ts shape with trimmed action enum (plan/apply/verify) and extended status enum (adds skipped/refused).
- [Phase 84]: Plan 84-01 — Credential-context gate: high-entropy alone does NOT refuse. Line must ALSO contain a credential-shaped label (password/secret/token/api_key/...). Solves false-positive problem for avatar/webhook/git-SHA IDs in skill documentation. 3-phase classifier otherwise mirrors Phase 77 guards.ts (sk-prefix → whitelist → high-entropy).
- [Phase 84]: Plan 84-01 — Tighter thresholds than v2.1 PlanReport guard (len>=12 + bits>=3.8 for skills vs len>=30 + bits>=4.0 for PlanReport). Required to catch short hand-typed passwords like finmentum-crm's 19-char MySQL credential (entropy 3.93).
- [Phase 84]: Plan 84-01 — Word-boundary exemption: sub-30-char tokens containing `-`/`_`/space are NOT secrets (compound identifiers). Real credentials at that length are opaque runs with no word boundaries.
- [Phase 84]: Plan 84-01 — finmentum-crm secret-scan HARD GATE working: refused at SKILL.md:20 with reason=high-entropy. MySQL credentials must move to MCP env / op:// refs before plan 02 can migrate this skill.
- [Phase 84]: Plan 84-02 — Transformer adds frontmatter to tuya-ac ONLY; other P1 skills (frontend-design, new-reel, self-improving-agent) preserved byte-for-byte. hasFrontmatter regex permits empty-body frontmatter (---\n---\n) via optional middle group.
- [Phase 84]: Plan 84-02 — Copier filter drops .git/ + SKILL.md.{backup,pre,pre-fix,pre-restore}-* editor snapshots. Hash witness SELECTIVELY skips SKILL.md when transformSkillMd actually changed the content (expected rewrite).
- [Phase 84]: Plan 84-02 — Linker verifier is READ-ONLY (does not call linkAgentSkills). Replicates catalog.has(name) resolution check so dry-run validation cannot poison real symlinks on failure. Emits per-(agent,skill) status: linked / missing-from-catalog / scope-refused / not-assigned.
- [Phase 84]: Plan 84-02 — SCOPE_TAGS map v2.2-LOCKED with 5 P1 entries; unknown skills default to fleet (max-permissive). Agent families: fin- prefix → finmentum; clawdy/jas → personal; everything else → fleet. --force-scope bypasses gates.
- [Phase 84]: Plan 84-02 — Learnings import source=manual (MemoryStore CHECK constraint); tags=[learning,migrated-from-openclaw]; origin_id=openclaw-learning-<sha256-of-trimmed-content-prefix-16>. Two-layer idempotency: tag+content dedup + MemoryStore UNIQUE(origin_id) partial index (Phase 80 MEM-02).
- [Phase 84]: Plan 84-02 — CLI exit 1 on ANY of: secret-scan refusal, copy-failed bucket, missing-from-catalog verification. Scope-refused alone does NOT flip exit 1 — operator decision via --force-scope.
- [Phase 84]: Plan 84-03 — Report writer source_integrity_sha = sha256(sorted unique ledger source_hash values joined by \n); excludes 'verify-only' synthetic hashes from Plan 02 verify rows.
- [Phase 84]: Plan 84-03 — Source-tree-readonly invariant sampled BEFORE discovery (not just before copy) so external-actor drift is caught alongside fs-guard's own-write protection. Three-state: verified/mtime-changed/unchecked with explicit unchecked fallback on lstat failure.
- [Phase 84]: Plan 84-03 — Verify-action rows excluded from per-skill verdict derivation in deriveLatestStatus; their status field encodes linker outcome not migration outcome. Prevents finmentum-crm appearing as 'migrated' when a verify row would override its refused apply row.
- [Phase 84]: Plan 84-03 — Report overwritten on EVERY apply (not just first apply). Atomic temp+rename (mkdir recursive + writeFile .tmp + rename + best-effort tmp cleanup on failure) matches Phase 82 report-writer.ts discipline.
- [Phase 85]: Plan 85-01 — `mcpServerSchema.optional` is additive with default `false` (mandatory). v2.1 migrated configs parse unchanged; all 5 auto-injected servers (clawcode/1password/browser/search/image) explicitly declared `optional:false` in loader.ts so the infra stack stays mandatory by construction.
- [Phase 85]: Plan 85-01 — `performMcpReadinessHandshake` is a PURE module (no logger, no state) so warm-path gate + mcp-reconnect heartbeat share one regression lane. TOOL-04 verbatim-pass-through of JSON-RPC error messages pinned by `mcp: <name>: <raw transport error>` character-for-character assertion in readiness.test.ts.
- [Phase 85]: Plan 85-01 — CheckStatus uses project-standard `healthy|warning|critical` vocabulary (NOT plan's draft `ok|warn|critical`) — integrates with existing context-fill/auto-linker/thread-idle checks without a schema fork.
- [Phase 85]: Plan 85-01 — Heartbeat `mcp-reconnect` is NOT a reconnect driver. SDK owns MCP subprocess lifecycle and transparently reconnects; this check classifies + persists state (ready→degraded→failed→reconnecting→ready) and fuels /clawcode-tools + prompt-builder consumers.
- [Phase 85]: Plan 85-01 — `failureCount` bounded with 5-min backoff-reset window (grows monotonically within window, recycles to 1 after). Gives operators a "recently-flapping" signal via /clawcode-tools without an unbounded counter.
- [Phase 85]: Plan 85-01 — SessionHandle gets getMcpState/setMcpState mirror (sync'd at warm-path + every heartbeat tick) so TurnDispatcher-scope consumers (Plan 02 prompt-builder, Plan 03 slash commands) avoid reaching into SessionManager's private maps.
- [Phase 85]: Plan 85-01 — New IPC `list-mcp-status` returns shape `{agent, servers: [{name, status, lastSuccessAt, lastFailureAt, failureCount, optional, lastError:string}]}` — canonical feed for Plan 03's /clawcode-tools slash command.
- [Phase 85]: Plan 85-02 — Preauth statement + verbatim-error rule land in STABLE PREFIX via sources.toolDefinitions (v1.7 two-block assembler). Eviction-proof through compaction per TOOL-07.
- [Phase 85]: Plan 85-02 — MCP_VERBATIM_ERROR_RULE stored as SINGLE-LINE string literal so the plan's static-grep pin finds one hit (multi-line concat would pass runtime tests but fail the source-grep verification).
- [Phase 85]: Plan 85-02 — Pitfall 12 (MCP config leak) closed by narrowing renderer's accepted shape to Pick<McpServerSchemaConfig, name> & optional?. Eight regression pins prevent command/args/env from re-entering the prompt surface.
- [Phase 85]: Plan 85-02 — Tools column hard-coded to U+2014 em dash in v2.2 (not tool names). Future q.mcpServerStatus() wire-up can populate without changing table shape — prompt-hash compatible migration.
- [Phase 85]: Plan 85-02 — mcpStateProvider is OPTIONAL on SessionConfigDeps; absent → empty Map → status 'unknown'. Preauth framing still lands and closes phantom-error class even before first heartbeat tick.
- [Phase 85]: Plan 85-03 — /clawcode-tools is CONTROL_COMMANDS (daemon-routed, zero LLM cost) with inline dispatch branch BEFORE generic handleControlCommand so the reply renders as EmbedBuilder (UI-01) instead of the text blob the generic dispatcher emits.
- [Phase 85]: Plan 85-03 — CLI command name collision: plan called for 'clawcode tools' but src/cli/commands/tools.ts is already Phase 55's tool-call latency command. Shipped as 'clawcode mcp-status' instead (parallels existing mcp-servers); Discord slash stays /clawcode-tools as planned (independent name space).
- [Phase 85]: Plan 85-03 — Pitfall 9 closure: pre-flight count assertion CONTROL_COMMANDS.length + DEFAULT_SLASH_COMMANDS.length <= 90 pins the Discord 100-per-guild cap. Current count post-Plan-03: 16/100. Pitfall 12 closure: neither UI surface exposes command/args/env — MCP env secrets can't leak through observability.
- [Phase 86]: Plan 86-01 — allowedModels additive schema (optional per-agent + default-bearing defaults). v2.1 migrated fleet parses unchanged; downstream always sees a concrete array via loader.ts resolution.
- [Phase 86]: Plan 86-01 — allowedModels classified RELOADABLE (Discord picker re-reads on invocation) but agents.*.model stays NON-reloadable. Runtime model swaps go through SessionHandle.setModel, not through a YAML hot-reload event.
- [Phase 86]: Plan 86-01 — SDK canary blueprint (Phase 83) applied verbatim to setModel: synchronous caller + fire-and-forget + .catch log-and-swallow. Pinned by 5 spy tests asserting toHaveBeenCalledWith(exact model id).
- [Phase 86]: Plan 86-01 — ModelNotAllowedError (typed) raised at SessionManager BEFORE SDK call; carries agent+attempted+allowed list so Discord slash / IPC error rendering needs no second round-trip.
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — Retired 'Takes effect on next session' lie; IPC set-model now routes live SDK swap FIRST then atomic YAML persist; non-rollback on persistence failure (surface persisted:false + persist_error)
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — Extracted handleSetModelIpc as pure exported helper from daemon.ts (DI'd). First application of pure-IPC-handler blueprint; Phase 87 setPermissionMode follows the same shape
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — Extended ManagerError with optional {code, data}; IPC server.ts propagates. Typed ModelNotAllowedError surfaces as ManagerError w/ code=-32602 + data.allowed for Plan 03 ephemeral Discord error render (no second round-trip)
- [Phase 86-dual-discord-model-picker-core]: Plan 86-02 — updateAgentModel uses parseDocument AST + atomic temp+rename (Phase 78/81 reuse). 5 typed outcomes (updated/no-op/not-found/file-not-found/refused). Comment preservation + round-trip re-parse pinned
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — /clawcode-model converted from LLM-prompt routing to native StringSelectMenuBuilder picker + direct IPC dispatch. PROJECT.md tech debt line 150 closed (zero 'Set my model to' live routings in src/).
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — Extended IpcError with optional data field + ipc/client.ts propagation. Plan 02 wired the server side (ManagerError.data + ipc/server.ts forwarding) but IpcError constructor dropped .data at the client boundary. Without this Rule 3 blocking fix the 'model-not-allowed' typed-error branch never fires in production.
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — MODEL-05 cache-invalidation confirmation uses native ButtonBuilder (Danger + Secondary) with agent+nonce namespaced customIds. Prefix-based filter (model-confirm:{agent}:) for collision safety across parallel picker invocations. 'Active conversation' signal via sessionManager.getModelForAgent !== undefined — zero-cost, biased toward showing confirmation.
- [Phase 86-dual-discord-model-picker-core]: Plan 86-03 — Inline handler short-circuit pattern + shared dispatch helper (dispatchModelChange with editMode flag). Arg-path and select-menu path funnel through the same IPC call + ModelNotAllowedError rendering. Blueprint for Phase 87 setPermissionMode + Phase 88 skills browser.
- [Phase 87-native-cc-slash-commands]: Plan 01 — Query.initializationResult chosen over supportedCommands: one round-trip covers Plan 02/03 needs (agents+models+commands); narrower supportedCommands kept available on the SdkQuery type for callers that only want the command list post-init.
- [Phase 87-native-cc-slash-commands]: Plan 01 — Classifier safe-default is prompt-channel for unknown SDK commands (CMD-00 spike basis); clear/export/mcp hard-coded to skip-set (mcp covered by Phase 85 /clawcode-tools, Pitfall 12).
- [Phase 87-native-cc-slash-commands]: Plan 01 — clawcode- namespace enforced by construction in buildNativeCommandDefs (Pitfall 10). Static-grep regression pin (readdirSync walk of src/) rejects any hardcoded native-command array literal in CI.
- [Phase 87-native-cc-slash-commands]: Plan 01 — SlashCommandDef.nativeBehavior discriminator (optional field) is the single routing signal for Plans 02/03 — no name-matching or secondary lookup table required. Also added aclDeniedByAgent DI hook for hermetic unit tests; production derives from <memoryPath>/SECURITY.md.
- [Phase 87-native-cc-slash-commands]: Plan 03 — buildNativePromptString strips clawcode- prefix idempotently (both 'clawcode-compact' and 'compact' yield '/compact'); args pass VERBATIM (no escape/quote — over-escaping breaks SDK arg passthrough); empty/whitespace args → no trailing space
- [Phase 87-native-cc-slash-commands]: Plan 03 — Dispatch-fork carve-out ordering in handleInteraction: clawcode-tools → clawcode-model → CONTROL_COMMANDS → prompt-channel → legacy agent-routed. Dedicated inline handlers always win over stray colliding prompt-channel entries (pinned by P4 test).
- [Phase 87-native-cc-slash-commands]: Plan 03 — Phase 85 TOOL-04 verbatim-error pattern applied at slash-command layer: editReply surfaces the ACTUAL SDK error text (err.message), not a generic blob. Solves phantom-error UX class for native-CC commands (pinned by P5 test).
- [Phase 87-native-cc-slash-commands]: Plan 03 — Zero new streaming primitive. ProgressiveMessageEditor reused verbatim from v1.7; dispatchNativePromptCommand substitutes TurnDispatcher.dispatchStream + buildNativePromptString for sessionManager.streamFromAgent + formatCommandMessage in the agent-routed flow. Origin = makeRootOrigin('discord', channelId) for trace stitching.
- [Phase 87]: Canary blueprint trio locked: Phase 83 + 86 + 87-02 share byte-identical synchronous setter + fire-and-forget + .catch wire shape with 5-test spy harness
- [Phase 87]: Permission mode is ephemeral/runtime-only (no YAML persistence) — matches /clawcode-effort precedent, diverges from /clawcode-model's atomic YAML write
- [Phase 87]: No per-agent permission allowlist; PermissionMode validation is the static 6-value union only (unlike setModel's per-agent allowedModels)
- [Phase 88-skills-marketplace]: Plan 88-01 — Three pure-function handoff contracts for Plan 02: loadMarketplaceCatalog (read-only unioned catalog), installSingleSkill (8-outcome discriminated-union installer), updateAgentSkills (atomic YAML writer mirroring Phase 86 MODEL-04). No daemon coupling required.
- [Phase 88-skills-marketplace]: Plan 88-01 — loadMarketplaceCatalog is HASH-FREE (no source hash computed at browse time); hash derivation deferred to installSingleSkill step 4 for idempotency gate. Keeps /clawcode-skills-browse responsive; one hash per install, not N hashes per browse.
- [Phase 88-skills-marketplace]: Plan 88-01 — fs-guard deliberately NOT installed in installSingleSkill (daemon-context writes only to skillsTargetDir + clawcodeYamlPath, neither under ~/.openclaw/). CLI-scoped guard would cascade into unrelated in-flight daemon tasks.
- [Phase 88-skills-marketplace]: Plan 88-01 — SkillInstallOutcome discriminated union with 8 distinct kinds (installed/installed-persist-failed/already-installed/blocked-secret-scan/rejected-scope/rejected-deprecated/not-in-catalog/copy-failed) enforces zero-silent-skip invariant (MKT-05) at the type system level. Plan 02's Discord renderer is an exhaustive switch.
- [Phase 88-skills-marketplace]: Plan 88-01 — computeSkillHash promoted to exported computeSkillContentHash (non-breaking rename+export); ledger writes on scope/secret-scan/copy-fail refusals (not on not-in-catalog or rejected-deprecated pre-gate refusals); non-rollback on YAML persist failure (mirrors Phase 86 Plan 02 MODEL-04).
- [Phase 88-skills-marketplace]: Plan 88-02 — Inline slash-handler short-circuit BEFORE CONTROL_COMMANDS now has 5 canonical applications across 4 phases (85/86/87/88). /clawcode-skills-browse + /clawcode-skills round out the pattern.
- [Phase 88-skills-marketplace]: Plan 88-02 — Exhaustive-switch outcome rendering (renderInstallOutcome) is a new canonical pattern for IPC handlers returning discriminated unions; TypeScript enforces MKT-05 zero-silent-skip at compile time for all 8 SkillInstallOutcome kinds.
- [Phase 88-skills-marketplace]: Plan 88-02 — Post-install hot-relink runs on {installed, installed-persist-failed, already-installed} only; remove does NOT rewire (stale symlink harmless, scanner re-reads at next boot).
- [Phase 88-skills-marketplace]: Plan 88-02 — Closure-based IPC intercept BEFORE routeMethod (same pattern as browser/search/image-tool-call). Keeps the 24-arg routeMethod signature stable; marketplace handlers close over daemon-local resolvedMarketplaceSources + skillsPath + ledgerPath + log.
- [Phase 89-agent-restart-greeting]: Plan 89-01 — Schema additions mirror Phase 86 MODEL-01 precedent: additive-optional agentSchema + default-bearing defaultsSchema + loader resolver + RELOADABLE_FIELDS. v2.1 fleet (15 agents) parses unchanged (regression pin).
- [Phase 89-agent-restart-greeting]: Plan 89-01 — restart-greeting.ts is 100% pure module: zero SessionManager import, zero webhook-manager.ts concrete-class import. All I/O (webhook sender, conversation store, summarizer, clock, logger, cool-down Map) DI'd via structural types so tests use plain-object stubs — no vi.mock of session internals.
- [Phase 89-agent-restart-greeting]: Plan 89-01 — Truncation uses U+2026 (single char) with slice(MAX_CHARS - 1) — produces exactly 500-char embed description. Plan's draft assumed '...' (3 chars) would overshoot; pinned by test P15 asserting toHaveLength(500).
- [Phase 89-agent-restart-greeting]: Plan 89-01 — ConversationReader surface uses real public API 'getTurnsForSession(sessionId, limit?)' — plan's draft 'getTurnsForSessionLimited' refers to private prepared statement. Source-of-truth correction.
- [Phase 89-agent-restart-greeting]: Plan 89-01 — 22 test fixtures across agent/bootstrap/config/discord/heartbeat/manager updated with greetOnRestart: true, greetCoolDownMs: 300_000 (Rule 3 blocking cascade — same pattern as Phase 86 allowedModels additive-required-field rollout).
- [Phase 90]: Plan 90-01 — Sixth application of Phase 83/86/89 additive-optional schema blueprint for memoryAutoLoad (agentSchema optional + defaultsSchema default true + RELOADABLE_FIELDS + loader resolver + configSchema literal). Zero behavior change for v2.1 migrated fleet.
- [Phase 90]: Plan 90-01 — MEMORY.md injected into identityStr (sources.identity) so the assembler places it in the stable prefix; order SOUL → IDENTITY → MEMORY → MCP pinned by MEM-01-C1 four-monotonic-indexOf test. 50KB cap enforced via Buffer.byteLength + Buffer.slice(50*1024).toString('utf8') + literal marker '…(truncated at 50KB cap)'.
- [Phase 90]: Plan 90-01 — Opt-out readFile-zero-call invariant (MEM-01-C3): when memoryAutoLoad=false, readFile is NEVER invoked against MEMORY.md path. Override path (MEM-01-C4): when memoryAutoLoadPath is set, workspace/MEMORY.md is NEVER read, even if override fails. Silent fall-through on missing file mirrors Phase 78 soulFile/identityFile.
- [Phase 90]: Plan 90-01 — Rule 3 blocking cascade: 22 test fixtures updated to populate memoryAutoLoad: true. Matches Phase 89 GREET-10 cascade (22 fixtures then, 22 fixtures now). Pattern now routine for each additive-required field rollout in v2.x.
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — ClawHub API shape confirmed via live probe (GET /api/v1/skills returns {items, nextCursor}); zero new npm deps (Node 22 fetch + execFile for tar instead of execa)
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — SkillInstallOutcome extended 8→11 variants (auth-required, rate-limited, manifest-invalid); exhaustive-switch enforcement preserved via compile-time never-check. Each variant carries the exact payload Discord renderer needs — no second IPC round-trip
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — ClawHub install pipeline reuses Phase 84 verbatim (secret-scan → normalize → scope → copy+hash → YAML persist → ledger) AFTER a download+extract staging step; staging dir ~/.clawcode/manager/clawhub-staging/<nanoid>/ cleaned in try/finally regardless of outcome (D-07)
- [Phase 90-04-clawhub-http-and-install-pipeline]: Plan 90-04 — marketplaceSources zod union: legacy variant OMITS kind (v2.2 back-compat preserved — regression pin HUB-SCH-2a); ClawHub variant REQUIRES kind: 'clawhub'. Loader narrows via presence of kind with a cast fallback for legacy (TS narrowing on absent keys is weaker than on present)
- [Phase 90]: Third atomic YAML writer (updateAgentMcpServers) mirrors updateAgentModel + updateAgentSkills with literal secret-scan guard on env values
- [Phase 90]: Sixth application of inline-handler-short-circuit pattern (/clawcode-plugins-browse AFTER /clawcode-skills BEFORE CONTROL_COMMANDS)
- [Phase 90]: Two-stage Modal flow for plugin install: picker→empty-configInputs install→Modal on config-missing→retry. Single-field case is 95% of plugins (API key / password)
- [Phase 90]: RRF k=60 + cosine top-20 + FTS top-20 as the hybrid retrieval shape (Cormack/Clarke canonical); path-weight ±0.2 applied post-fusion as additive tiebreaker
- [Phase 90]: Mutable-suffix injection via TurnDispatcher.augmentWithMemoryContext — <memory-context source=hybrid-rrf chunks=N> wrapper prefixed to user message; stable prefix (Plan 90-01 MEMORY.md auto-load) NEVER touched so v1.7 cache stability preserved
- [Phase 90]: Lazy-MemoryStore Proxy in daemon.ts — scanner constructed at boot but MemoryStore reference resolves on each chokidar event (after SessionManager.startAgent initMemory). Pattern now available for future daemon-boot-time-but-per-agent-resource constructors
- [Phase 90]: chokidar 5.x glob patterns silently no-op — watch memory/ directory recursively + filter via shouldIndexMemoryPath in handlers. ready-event await in scanner.start() pins the post-init race window closed
- [Phase 90]: Seventh application of the Phase 83/86/89 additive-optional blueprint (memoryRetrievalTopK/TokenBudget/ScannerEnabled). Pattern is now routine; each rollout strengthens the v2.x convention for extending agent config
- [Phase 90]: Per-agent scanner (Map<string, MemoryScanner>) mirrors SessionManager per-agent resource pattern; setMemoryScanner DI shape mirrors Phase 89 setWebhookManager exactly — 5th application of post-construction DI mirror pattern
- [Phase 90]: Device-code OAuth over web-redirect (D-02 Claude's Discretion): ClawCode daemon is headless, no HTTPS callback surface
- [Phase 90]: Two-pass fuzzy matcher (substring containment first, Levenshtein ≤ 3 second) + first-word tokenization on both label and field-name sides for op:// rewrite
- [Phase 90]: Module-namespace imports (import * as mod) in install-plugin.ts + daemon.ts to enable vi.spyOn without breaking ESM live bindings
- [Phase 90]: Long-lived IPC (clawhub-oauth-poll, up to 15min) without client-side timeoutMs — daemon handler self-terminates at expires_at
- [Phase 90]: [Phase 90 Plan 03]: MemoryFlushTimer per-agent timer separate from existing Gap 3 flushTimers map (distinct concerns: markdown disk vs SQLite memories); memoryFileFlushTimers naming prevents name clash
- [Phase 90]: [Phase 90 Plan 03]: flushNow() declared NON-async so concurrent callers receive the EXACT same inFlight Promise instance (toBe-referential equality); async wrapper would mint fresh Promise on every call, breaking dedup
- [Phase 90]: [Phase 90 Plan 03]: discordReact signature is ({channelId, messageId}, emoji) not (messageId, emoji) — discord.js requires channel.messages.fetch first; channelId threaded through DispatchOptions
- [Phase 90]: [Phase 90 Plan 03]: Fourth fire-and-forget canary application (after 83/86/87/89); cue write + Discord reaction + subagent capture ALL use void fn().catch(log.warn)
- [Phase 90]: [Phase 90 Plan 03]: atomicWriteFile exported from memory-flush.ts and reused by memory-cue.ts + subagent-capture.ts — one implementation, one unlink-on-rename-fail discipline, one nanoid-suffixed tmp path
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — fourth atomic YAML writer (updateAgentConfig) generalizes updateAgentModel+Skills+McpServers to a Partial<AgentConfig> patcher with schema-validated merge + recursive literal secret scan + JSON-stable idempotency
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — agentSchema.heartbeat extended z.boolean() → z.union([z.boolean(), {enabled?, every?, model?, prompt?}]) to support OpenClaw-style 50m heartbeat shape for fin-acquisition; v2.1 migrated fleet parses unchanged
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — fin-acquisition channel binding INTENTIONALLY unchanged; operator-initiated OpenClaw→ClawCode cutover documented in .planning/migrations/fin-acquisition-cutover.md (9 sections, operator-executable)
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — HEARTBEAT.md content (1622 bytes) read verbatim from ~/.openclaw/workspace-finmentum/HEARTBEAT.md at apply time; AUTO-RESET: DISABLED directive + zone thresholds + snapshot template preserved byte-for-byte
- [Phase 90-clawhub-marketplace-fin-acquisition-memory-prep]: Plan 90-07 — verifyAgentWebhookIdentity uses pre-check-then-delegate pattern (peek fetchWebhooks before provisionWebhooks delegate) so return shape distinguishes verified vs provisioned; daemon-boot probe fire-and-forget
- [Phase 91]: Plan 91-01 — sync-runner uses node:child_process.execFile (not execa — not in package.json); matches marketplace/clawhub-client.ts pattern. Zero new npm deps preserved (v2.2 discipline extended to v2.4).
- [Phase 91]: Plan 91-01 — SuccessExitStatus=1 in systemd service so graceful-SSH-fail + flock-skip exits don't pollute journalctl; real bugs (exit 2+) still surface.
- [Phase 91]: Plan 91-01 — Regression guard in syncOnce throws if .sqlite/sessions/ paths leak into rsync touchedPaths; fail loud, not silent data leak. Filter file pins 13 exclude patterns as first defense.
- [Phase 91]: Plan 91-01 — DEFAULT_SYNC_JSONL_PATH exported alongside DEFAULT_SYNC_STATE_PATH so Plan 91-05 imports canonical path instead of re-deriving homedir join.
- [Phase 91]: Plan 91-03 — Idempotency via existing UNIQUE(session_id, turn_index, role) on conversation_turns (idx_turns_session_order), NOT a new origin_id UNIQUE column. Translator uses INSERT OR IGNORE via new ConversationStore.getDatabase() accessor; origin-id string stored in existing 'origin' TEXT column for human traceability.
- [Phase 91]: Plan 91-03 — Deterministic computeClawcodeSessionId(openclawSessionId)=openclaw-<sha256-20> as conversation_sessions PK so re-runs converge on one row per OpenClaw session uuid; session rows imported with status='ended' so Phase 67 SESS-03 gap-check sees them as terminated.
- [Phase 91]: Plan 91-03 — Remote→local via rsync staging (bash wrapper step 1) rather than SSH-per-file in translator. Keeps translator pure-function + testable without SSH; staging dir ~/.clawcode/manager/openclaw-sessions-staging/ is read-only from translator's perspective. Hourly timer distinct from 91-01's 5-min workspace sync per D-07.
- [Phase 91]: 91-02: Safer reading of D-11 — ANY destHash drift is a conflict (never silently clobber operator edits)
- [Phase 91]: 91-02: Per-FILE --exclude rsync args preserve non-conflicting propagation in same cycle (D-12)
- [Phase 91]: 91-02: Stateless re-alert (D-15) — fire embed every cycle with conflicts, no path-level suppression

### v2.1 closing decisions (for reference)

- [v2.1 Roadmap]: Zero new npm deps — entire milestone ran on existing stack.
- [v2.1 Roadmap]: Source of truth for memory translation is WORKSPACE MARKDOWN (MEMORY.md + memory/*.md + .learnings/*.md), not the OpenClaw sqlite chunks table.
- [v2.1 Roadmap]: SOUL/IDENTITY stored as workspace files with `soulFile:` + `identityFile:` YAML pointers — never inlined into clawcode.yaml.
- [v2.1 Roadmap]: Secret guard is a HARD REFUSAL not a warning — migrator rejects any raw secret-shaped value in clawcode.yaml.
- [v2.1 Roadmap]: Non-destructive to source — migrator NEVER modifies, deletes, or renames any file under `~/.openclaw/`.
- [v2.1 Roadmap]: Per-agent atomic cutover — memory → workspace → config (YAML append is the commit point). Agents in sequence, not parallel.

### Phase 82/82.1 v2.1 close-out decisions (for reference)

- [Phase 82-pilot-cutover-completion]: removeBindingsForAgent bypasses zod schema to preserve operator-curated passthrough fields (env, auth, channels.discord.token)
- [Phase 82-pilot-cutover-completion]: fs-guard allowlist uses exact-equality on resolve()'d paths — sibling .bak files still refuse
- [Phase 82-pilot-cutover-completion]: source_integrity_sha hashes sorted ledger witness rows (not a live tree walk) — the ledger IS the audit trail
- [Phase 82]: Pilot-highlight line suppressed on plan --agent <name> (single-agent filter has no signal value)
- [Phase 82]: Dispatch-holder default-with-fallback pattern: impl = holder.x ?? moduleRef for test-safety
- [Phase 82]: runCompleteAction bundled into Task 1 GREEN commit for dispatch-holder coherence (Phase 80/81 all-fields-init pattern)
- [Phase 82.1]: Fixed finmentum soulFile/identityFile YAML pointer via isFinmentum branch in config-mapper — closes v2.1 audit gap for CONF-01/WORK-02/MIGR-04; dedicated-agent behavior unchanged (regression-pinned)

### Roadmap Evolution

- 2026-04-18: Milestone v1.9 Persistent Conversation Memory shipped (Phases 64-68 + 68.1)
- 2026-04-18: Milestone v2.0 Open Endpoint + Eyes & Hands started — 20 requirements defined across 4 categories
- 2026-04-18: v2.0 roadmap created — 4 phases (69-72), 20/20 requirements mapped 1:1, zero orphans
- 2026-04-19: Phase 73 added — OpenClaw endpoint latency
- 2026-04-19: Phase 74 added — Seamless OpenClaw backend (caller-provided agent config)
- 2026-04-20: v2.0 complete (Phases 69-74 shipped); v2.1 OpenClaw Agent Migration milestone opened
- 2026-04-20: v2.1 research complete — STACK/FEATURES/ARCHITECTURE/PITFALLS/SUMMARY across `.planning/research/`
- 2026-04-20: v2.1 roadmap created — 8 phases (75-82), 31 requirements mapped 1:1 across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS
- 2026-04-21: v2.1 shipped (phases 75-82.1, 40 plans) — OpenClaw Agent Migration complete
- 2026-04-21: v2.2 milestone opened — OpenClaw Parity & Polish (skills migration, effort mapping, model picker core, native CC slash commands, MCP tool awareness, skills marketplace)
- 2026-04-21: v2.2 research complete — STACK/FEATURES/ARCHITECTURE/PITFALLS/SUMMARY across `.planning/research/`
- 2026-04-21: v2.2 roadmap created — 6 phases (83-88), 45 requirements mapped across UI/SKILL/EFFORT/MODEL/CMD/TOOL/MKT; UI-01 cross-cutting across 4 UI phases; zero orphans
- 2026-04-22: Phase 89 added — Agent restart greeting (active Discord send of prior-context summary on restart)
- 2026-04-23: v2.2 shipped (phases 83-89, 19 plans, 32 tasks) — OpenClaw Parity & Polish complete; tech_debt audit status (2 Phase 89 UAT items deferred)
- 2026-04-24: v2.3 Marketplace & Memory Activation opened — Phase 90 added: ClawHub Marketplace + fin-acquisition Memory Prep. Scope synthesized from Apr 23-24 fin-acquisition Discord conversation-history analysis (4900 msgs) + v2.2 gap analysis of OpenClaw → ClawCode fin-acquisition migration readiness. 21 requirements (HUB-01..08 + MEM-01..06 + WIRE-01..07) across 7 suggested plans.
- 2026-04-24: v2.3 shipped — Phase 90 autonomously executed (7 plans, 4 waves, 21 reqs, 1454/1462 tests). Milestone archived. Phase 90.1 hotfixes applied live: bot-direct greeting fallback + iterate-back empty-session + minimal greeting always-fires + restartAgent tolerates 'not running'. fin-acquisition channel binding mingled into test channel (1492939095696216307) per operator directive. fin-test agent removed from config.
- 2026-04-24: v2.4 OpenClaw ↔ ClawCode Continuous Sync opened — Phase 91 added: fin-acquisition workspace sync (markdown + uploads + skills + conversation-turn translator, uni-directional OpenClaw→ClawCode until operator flips `sync.authoritative`). 10 SYNC-01..10 requirements, 6-plan decomposition hint. Built on Phase 80 memory-translator + rsync + chokidar/inotify.

### Pending Todos

- `/gsd:plan-phase 83` — decompose Extended-Thinking Effort Mapping into plans (SDK canary, P0 bug fix, fork quarantine, persistence, per-skill override)
- CMD-00 SDK spike (~30min throwaway script) MUST land before Phase 87 planning — output to `.planning/research/CMD-SDK-SPIKE.md`
- Consider parallel `/gsd:plan-phase 84` (Skills Library Migration) and `/gsd:plan-phase 85` (MCP Tool Awareness) — both independent of 83/86/87 and each other

### Blockers/Concerns

- **CMD-00 spike gates Phase 87** — cannot start Phase 87 implementation without the SDK mid-session-mutation concurrency spike committed to research/. Spike is fast (~30min) but strictly blocking.
- **`finmentum-crm` SKILL.md contains literal MySQL credentials** — Phase 84 secret-scan MUST refuse the copy; creds need to be moved to MCP env/op:// refs before the skill can migrate. Hard gate, not advisory.
- **SDK pre-1.0 churn risk** — pinning to exact 0.2.97 (not ^0.2.97). If the SDK ships a breaking minor (0.3.x) during v2.2 execution, hold at 0.2.97 and defer bump to a separate milestone.
- **12 of 15 v1.1 phases missing formal VERIFICATION.md artifacts (docs only)** — legacy carry-over, not blocking v2.2.
- **Discord 100-command-per-guild cap** — v2.2 adds to the existing ~13 clawcode-* commands + ~20-25 native CC commands = worst case ~40/guild; safe but Phase 87 must keep per-guild dedupe (not per-agent registration).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260418-sux | Fix schedule display field mismatch and add registry ghost-entry reconciliation | 2026-04-18 | 3d4ff24 | [260418-sux-fix-schedule-display-field-mismatch-and-](./quick/260418-sux-fix-schedule-display-field-mismatch-and-/) |
| 260419-jtk | Harden OpenAI streaming for OpenClaw: usage trailing chunk + tool-call verify + warm-path startup race | 2026-04-19 | 18252fe | [260419-jtk-harden-openai-streaming-for-openclaw-emi](./quick/260419-jtk-harden-openai-streaming-for-openclaw-emi/) |
| 260419-mvh | Fix initMemory→warm-path cascade + add OpenAI request/payload JSONL logging + `openai-log tail` CLI | 2026-04-19 | 34dfb83 | [260419-mvh-fix-initmemory-warm-path-cascade-add-ope](./quick/260419-mvh-fix-initmemory-warm-path-cascade-add-ope/) |
| 260419-nic | Discord `/clawcode-interrupt` + `/clawcode-steer` slash commands — mid-turn abort + steering via Phase 73 interrupt primitive | 2026-04-19 | 8ff6780 | [260419-nic-add-discord-stop-and-steer-slash-command](./quick/260419-nic-add-discord-stop-and-steer-slash-command/) |
| 260419-p51 | Multi-agent bearer keys (scope=all) + composite-PK session index + fork-escalation regression pin + spawn-subagent UX docs | 2026-04-19 | edecd6e | [260419-p51-multi-agent-bearer-keys-fork-escalation-](./quick/260419-p51-multi-agent-bearer-keys-fork-escalation-/) |
| 260419-q2z | Registry atomic write + recovery + `clawcode registry repair` CLI + always-summarize short sessions + graceful shutdown drain (FIX A+B+C) | 2026-04-19 | fa34ef3 | [260419-q2z-registry-atomic-write-graceful-shutdown-](./quick/260419-q2z-registry-atomic-write-graceful-shutdown-/) |
| Phase 83 P01 | 32 | 2 tasks | 13 files |
| Phase 83 P03 | 17min 22s | 2 tasks | 11 files |
| Phase 83 P02 | 22min 13s | 2 tasks | 6 files |
| Phase 84 P01 | ~25min | 2 tasks (TDD) | 8 files |
| Phase 84 P02 | 17min 0s | 2 tasks | 14 files |
| Phase 84 P03 | 6min 23s | 1 tasks | 4 files |
| Phase 85 P01 | 30min 24s | 2 tasks (TDD) | 15 files |
| Phase 85 P02 | 13min 24s | 2 tasks | 6 files |
| Phase 85 P03 | 20min 0s | 2 tasks | 5 files |
| Phase 86 P01 | 31min | 2 tasks | 14 files |
| Phase 86-dual-discord-model-picker-core P02 | 12min 6s | 2 tasks | 9 files |
| Phase 86-dual-discord-model-picker-core P03 | 9 min 39 s | 2 tasks | 7 files |
| Phase 87-native-cc-slash-commands P01 | 19min 24s | 2 tasks | 18 files |
| Phase 87 P03 | 6min 12s | 1 tasks | 4 files |
| Phase 87 P02 | 11min | 2 tasks | 12 files |
| Phase 88-skills-marketplace P01 | 11min 27s | 2 tasks | 10 files |
| Phase 88-skills-marketplace P02 | 26min 47s | 2 tasks | 10 files |
| Phase 89 P01 | 20m 10s | 2 tasks | 30 files |
| Phase 90 P01 | 12min | 2 tasks | 28 files |
| Phase 90-clawhub-marketplace-fin-acquisition-memory-prep P04 | 33min 1s | 2 tasks (TDD) tasks | 10 files files |
| Phase 90 P05 | 20min 32s | 2 tasks | 14 files |
| Phase 90 P02 | 25min | 2 (TDD) tasks | 34 files |
| Phase 90 P06 | 12m 23s | 2 tasks | 13 files |
| Phase 90 P03 | 20min | 2 tasks | 36 files |
| Phase 90 P07 | 17min 55s | 2 (TDD) tasks | 13 files files |
| Phase 91 P01 | 7min 25s | 2 tasks | 10 files |
| Phase 91 P03 | 18 | 2 tasks | 8 files |
| Phase 91 P02 | 8m 37s | 2 tasks | 6 files |

## Session Continuity

Last activity: 2026-04-24
Stopped at: Completed 91-02-PLAN.md
Resume: Execute 85-02-PLAN.md (two-block prompt-builder MCP tools section — stable prefix tool list + mutable suffix live status table) — Plan 02 can now read `SessionHandle.getMcpState()` directly without reaching into SessionManager internals
