---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase complete — ready for verification
stopped_at: Completed 103-03-PLAN.md
last_updated: "2026-04-29T15:35:39.415Z"
last_activity: 2026-04-29
progress:
  total_phases: 15
  completed_phases: 5
  total_plans: 28
  completed_plans: 28
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-23 after v2.2 milestone completion)

**Core value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace -- communicating naturally through Discord channels without manual orchestration overhead.
**Current focus:** Phase 103 — clawcode-status-rich-telemetry-usage-panel-operator-observability

## Current Position

Phase: 103 (clawcode-status-rich-telemetry-usage-panel-operator-observability) — EXECUTING
Plan: 3 of 3 (Plan 01 ✓ complete; Plan 02 next)

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
- [Phase 91]: Plan 91-04 complete: clawcode sync CLI group with 8 subcommands, drain-then-flip cutover, 7-day rollback window. SYNC-09 and SYNC-10 done.
- [Phase 91]: Plan 91-06 — Runbook appended with 5 Phase 91 sections (SSH provisioning, systemd install, cutover flip, 7-day rollback, operator-observable logs) under  heading; Phase 90-07 content preserved verbatim (RUN-SYNC-08 regression pin).
- [Phase 91]: Plan 91-06 — Rule 1 fix: filter file memory/ rules amended with `+ /memory/*.md` (direct children) and `+ /memory/**/` (intermediate-dir descent). Original `+ /memory/**/*.md` alone missed both in rsync 3.2 (zero-path-component `**` semantic), which would have silently dropped OpenClaw's dated memory flushes (memory/YYYY-MM-DD-slug.md). All 37 existing 91-01 tests still pass after the fix.
- [Phase 91]: Plan 91-06 — Zero new npm deps discipline preserved. Plan's test-file draft referenced execa; substituted node:child_process.execFile via promisify with non-zero-exit-tolerant wrapper (matches src/sync/sync-runner.ts:540 defaultRsyncRunner + src/marketplace/clawhub-client.ts patterns).
- [Phase 91]: Plan 91-06 — Exclude-filter test uses both static assertions (REG-EXCL-01/02 read filter file directly) AND behavioral assertions (REG-EXCL-03..08 run real rsync against synthetic workspace with dry-run itemize parsing + real-sync destination filesystem access checks). REG-EXCL-09 control probe prevents vacuous-pass scenarios. 9 tests total (plan wanted ≥6).
- [Phase 91]: 91-05: Colour vocabulary reuses Phase 91-02 CONFLICT_EMBED_COLOR=15158332 for red — conflict-alert embed + status embed speak the same visual language
- [Phase 91]: 91-05: /clawcode-sync-status is fleet-level (no agent option) — reads singleton sync-state.json; per-agent arg deferred to Phase 92+ fleet-wide sync
- [Phase 91]: 91-05: Conflict field cap at 25 with explicit '… N more conflicts' terminal marker — honest cap indicator, not silent ceiling (diverges from 91-02 alerter's silent slice)
- [Phase 92]: Plan 92-01: Mission Control REST API as PRIMARY corpus (D-11 amendment); bearer-token sourced from env MC_API_TOKEN ONLY at CLI surface, NEVER logged or in error strings (sanitizeError + status/statusText-only error classification)
- [Phase 92]: Plan 92-01: 503 'Failed to connect to OpenClaw Gateway' graceful in --source both (skip+continue), fatal in --source mc; cursor-driven incremental rerun via mc-cursor.json with monotonic lastUpdatedAt advance even on no-changes
- [Phase 92]: Plan 92-01: Source profiler reads N JSONL paths (mc + discord union) with origin-discriminated dedup; cron-prefixed intents preserved through merge — Phase 47 cron parity surfaces in canary battery distinct from user-initiated intents
- [Phase 92]: Plan 92-01: SQLite direct-read fallback (mission-control.db via SSH) DEFERRED to Phase 93+; pure REST API only this plan (regression-pinned by ! grep -rE 'mission-control.db' src/cutover/)
- [Phase 92]: Plan 92-02: CutoverGap typed discriminated union with EXACTLY 9 kinds (5 additive + 4 destructive); D-11 adds cron-session-not-mirrored. Pinned by D-EXHAUSTIVE compile-time switch + assertNever witness — adding a 10th kind fails the TypeScript build until 92-03/04/06 consumers update.
- [Phase 92]: Plan 92-02: diff-engine.ts is PURE (no fs, no clock, no env, no Math.random); target-probe.ts is DI-pure (loadConfig + listMcpStatus + readWorkspaceInventory all injected). Static-grep pins enforce both.
- [Phase 92]: Plan 92-02: NO-LEAK invariant — probe extracts MCP env KEY NAMES via Object.keys(entry.env). Values never read or serialized. PR5 test pins via sk_live_secret_42 sentinel. Field-by-field YAML extraction (no spread on env objects).
- [Phase 92]: Plan 92-02: TargetCapability.yaml.sessionKinds[] derived from agent.schedules presence (empty → [direct]; non-empty → [direct, scheduled]). Cron-entry detection lives in target.sessionKinds.includes('cron') — v1 emits without 'cron' so D-11 cron gaps surface end-to-end against any MC profile carrying cron-prefixed intents.
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: append-only cutover-ledger.jsonl mirrors Phase 82 invariants verbatim — validate-on-write (zod safeParse before mkdir+appendFile), no truncate/clear/rewrite helpers, appendFile-only (no read-modify-write race)
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: AdditiveApplierDeps DI-pure shape mirrors Plan 92-04 destructive applier blueprint; Phase 84/86/91 primitives all injected; CLI wrapper iterates Phase 86 updateAgentSkills(op:add) per skill (writer takes one at a time) — idempotency-safe via no-op return
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: missing-mcp 5th additive kind routed to deferred-with-reason ledger entry (operator must add op:// refs via /clawcode-plugins-browse) — applier never auto-mutates MCP credential surface
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: secret-scan ordering pin (A2 test) — scanSkillForSecrets called BEFORE runRsync for missing-skill; refusal terminal-short-circuits the entire applier (operator must move secrets before re-running)
- [Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier]: Plan 92-03: dry-run is the DEFAULT at the wrapper layer (apply: false → no writes, no ledger). --apply opt-in per D-07 three-tier safety; preChangeSnapshot field reserved for D-10 destructive reversibility (Plan 92-04 populates)
- [Phase 92]: Plan 92-04: customId namespace 'cutover-' reserved (D2 collision regression pins 9 existing prefixes); preChangeSnapshot capture order fixed (read→gz+b64→rsync→ledger); 64KB threshold; non-file destructive kinds emit audit-only ledger rows per D-06 propose-and-confirm
- [Phase 93]: Plan 93-01 — pure renderStatus(buildStatusData) module shipped: 9-line OpenClaw-parity output with unknown/n/a placeholders for ClawCode-only gaps; Pitfall 6 closure via tryRead-wrapped accessors at the StatusData boundary; date-fns/formatDistanceToNow reused (zero new deps).
- [Phase 93]: Plan 93-01 — Existing slash-commands-status-effort.test.ts 'Failed to read status' assertion was rewritten as the Pitfall 6 closure pin; the new contract is defensive-read collapses to 'Think: unknown' / 'Permissions: unknown' placeholders, never the legacy error path.
- [Phase 92]: Plan 92-05: CANARY_TIMEOUT_MS=30_000 + CANARY_CHANNEL_ID=1492939095696216307 (recently-freed fin-test channel) + CANARY_API_ENDPOINT=http://localhost:3101/v1/chat/completions; 20 prompts × 2 paths = 40 invocations per run; passRate >= 100 hard precondition for Plan 92-06 set-authoritative gate
- [Phase 92]: Plan 92-05: dispatchStream + fetchApi DI'd via CanaryRunnerDeps; Promise.race + setTimeout sentinel for 30s per-path timeout; sentinel string '__canary_timeout__' for collision-resistant discrimination; clearTimeout in finally for clean event-loop drain
- [Phase 92]: Plan 92-05: Synthesizer + runner determinism via spread-then-sort; results sorted by (intent ASC, path ASC); CANARY-REPORT.md frontmatter pinned: agent + generated_at + total_prompts + total_paths + total_invocations + passed + failed + canary_pass_rate (rounded to 1dp); Plan 92-06's set-authoritative reads canary_pass_rate
- [Phase 92]: Plan 92-05: Default fetchApi (Node 22 native fetch + OpenAI choices[0].message.content extraction with raw-body fallback) lives in src/cli/commands/cutover-canary.ts so canary-runner.ts stays purely DI'd. Loopback-only API; only http://localhost:3101 references are JSDoc comments. Zero new npm deps preserved
- [Phase 92]: Plan 92-06: Capstone wire-up — runVerifyPipeline 7-phase sequential orchestrator (DI'd) + writeCutoverReport atomic temp+rename with literal end-of-doc 'Cutover ready: true|false' line + Phase 91 sync-set-authoritative precondition gate (REPORT_FRESHNESS_MS=24h) + --skip-verify --reason emergency bypass appending action='skip-verify' audit row to cutover-ledger.jsonl
- [Phase 92]: Plan 92-06: cutover_ready: true REQUIRES (gaps.length === 0 AND canaryResults !== null AND totalInvocations > 0 AND passRate === 100) — clean diff alone NOT cutover-ready (CUT-09 contract); literal end-of-doc line derived from same boolean as frontmatter so they always agree
- [Phase 92]: Plan 92-06: rollback idempotency via append-only NEW row with reason='rollback-of:<origTimestamp>' marker (ROLLBACK_OF_REASON_PREFIX exported); ledger never mutated/deleted; CLI scaffolds for cutover verify + rollback emit clear daemon-required error today (precedent from cutover-canary), full daemon-IPC wiring deferred to follow-up plan
- [Phase 93]: Plan 93-02 — eighth additive-optional opt-in field application (defaultClawhubBaseUrl on LoadMarketplaceCatalogOpts + MarketplaceIpcDeps); Pitfall 4 closure preserved zero test fixture cascade.
- [Phase 93]: Plan 93-02 — auto-inject branch never mutates opts.sources; new sourcesArr clone with frozen synthetic clawhub source pushed when defaultClawhubBaseUrl set AND no explicit kind:'clawhub' present (back-compat byte-identical to today).
- [Phase 93]: Plan 93-02 — sentinel-value pattern for non-installable Discord StringSelectMenu options (CLAWHUB_DIVIDER_VALUE filter at chosen-equality before marketplace-install IPC). discord.js 14.x has no setDisabled on options; sentinel + filter is the canonical workaround.
- [Phase 93]: Plan 93-02 — divider gating: clawhubSide.length > 0 AND remainingSlots >= 2 (Pitfall 2/3 closure — divider never renders alone; never the terminal option after 25-cap).
- [Phase 93]: Plan 93-03 — ClawhubManifestNotFoundError is a sibling (not subclass) of ClawhubManifestInvalidError. Subclassing would defeat the differentiation purpose; instanceof checks must distinguish 404 from malformed-body errors.
- [Phase 93]: Plan 93-03 — daemon.ts:1116-1118 fallback URL construction deliberately UNCHANGED per RESEARCH §Pitfall 5 (13-URL probe table confirmed every shape returns 404 for unpublished plugins like hivemind; the registry is the source of truth, not the URL shape). Pinned by DPM-93-1 regression test.
- [Phase 93]: Plan 93-03 — PluginInstallOutcome union grows 10 → 11 variants (manifest-unavailable). Eleventh exhaustive-switch application of the Phase 88 MKT-05 / Phase 90 Plan 05 pattern; TypeScript never branch enforces completeness across PluginInstallOutcome + PluginInstallOutcomeWire + renderPluginInstallOutcome at compile time.
- [Phase 94]: 5-value CapabilityProbeStatus enum (ready|degraded|reconnecting|failed|unknown) locked at the contract layer (D-02); adding a 6th value cascades through Plans 94-02/03/04/07
- [Phase 94]: Capability probe is DI-pure: no SDK imports, no fs imports, no bare new Date() — primitive funnels Date construction through currentTime(deps) helper using integer-arg signature so static-grep regression pin holds
- [Phase 94]: Heartbeat layer runs probe with stub callTool (throws) + getProbeFor override forcing default-fallback; connect-ok → ready, connect-fail → failed mirror. Plan 94-03 lifts override and wires real callTool through SDK surface
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — D-06 ToolCallError discriminated-shape contract landed: 5-value ErrorClass enum (transient|auth|quota|permission|unknown) locked at the contract layer with 12 literal occurrences pinned by static-grep; verbatim-message pass-through (Phase 85 TOOL-04 inheritance) preserved exact substring including Playwright sentinel error
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — Classification regex priority order auth → quota → permission → transient → unknown: when 'HTTP 401 timeout' matches both auth and transient, auth wins because more specific class better signals what LLM should do; pinned by TCE-CLASS priority test
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — TurnDispatcher integration via new public method executeMcpTool (single-source-of-truth wrap site) rather than refactoring iterateUntilResult: production MCP tool calls flow through SDK driverIter inside persistent session handle, not through any direct dispatcher method; new method gives Plan 94-05 (auto-injected tools) a wrap-route they can hit directly + provides seam for future direct-MCP-call sites
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — Single-attempt-then-wrap (NO silent retry) inside dispatcher: recovery (Plan 94-03) is heartbeat-driven at the connection layer, NOT at the tool-execution layer; LLM sees structured failure and adapts naturally (asks user, switches to alternative agent) instead of silently retrying same bad call
- [Phase 94-tool-reliability-self-awareness]: Plan 94-04 — mcpStateProvider DI is additive-optional on TurnDispatcherOptions (Phase 86/89 schema-extension blueprint reused): when absent, ToolCallError.alternatives is undefined; existing tests without the field continue to pass; daemon edge wires the provider once SessionManager construction is touched in a follow-up plan
- [Phase 94]: Plan 94-02: 5min flap window + 3-transition threshold LOCKED at contract layer (FLAP_WINDOW_MS, FLAP_TRANSITION_THRESHOLD); pinned by static-grep. Lower threshold would block all recovery cycles.
- [Phase 94]: Plan 94-02: Conservative default for unknown / missing capabilityProbe — filter OUT, NOT pass-through. First-boot agents see zero MCP servers in their LLM tool table for the first 60s window until the heartbeat populates probe state. Don't advertise unproven tools.
- [Phase 94]: Plan 94-02: Single-source-of-truth filter call site at session-config.ts (NOT mcp-prompt-block.ts). Renderer stays pure; filter logic stays in one place. 4 inline static-grep regression tests pin the invariant.
- [Phase 94]: Plan 94-02: Failed/degraded servers FILTERED OUT entirely from LLM table — no row, no verbatim error in the prompt. Replaces pre-94 contract that surfaced lastError.message into the prompt (was a phantom-error vector). Operator-truth flows through /clawcode-tools + clawcode mcp-status (Phase 85 Plan 03).
- [Phase 94]: DI-purity over convenience: handlers + registry have ZERO node:child_process imports. Production wires real execFile/killSubprocess/adminAlert/opRead at heartbeat-tick edge in buildRecoveryDepsForHeartbeat (Phase 91 sync-runner pattern). Static-grep pin verifies on every commit.
- [Phase 94]: Bounded budget at the registry, not the handler. Per-server budget is global across all 3 handlers — Playwright fails 2x + op:// fails 1x means total budget exhausted. Operational intent: 'this server has been hammering recovery; back off'.
- [Phase 94]: 3rd-failure admin-clawdy alert counts give-up + retry-later as failures; not-applicable + recovered are not failures (no budget burn for not-applicable; recovered means system healed itself).
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — TOOL-10 8th application of additive-optional schema blueprint: defaults.systemPromptDirectives default-bearing record (DEFAULT_SYSTEM_PROMPT_DIRECTIVES with verbatim D-09 file-sharing + D-07 cross-agent-routing) + agents.*.systemPromptDirectives optional partial override; v2.5 migrated configs parse unchanged (REG-V25-BACKCOMPAT).
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — resolveSystemPromptDirectives: pure per-key merge (override?.field ?? defaults?.field), filter enabled && text !== ''; alphabetical sort + Object.freeze on output for prompt-cache hash stability + CLAUDE.md immutability invariant.
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — Pre-rendered block in ContextSources (caller computes via resolver+renderer pair); assembler stays config-type-agnostic (no schema imports). Empty string short-circuits — stable prefix byte-identical to no-directives baseline (REG-ASSEMBLER-EMPTY-WHEN-DISABLED).
- [Phase 94-tool-reliability-self-awareness]: Plan 94-06 — RELOADABLE classification: agents.*.systemPromptDirectives + defaults.systemPromptDirectives both reloadable at next-turn boundary (assembler reads via resolver each turn). No daemon restart for directive edits.
- [Phase 94-tool-reliability-self-awareness]: Plan 94-05 — clawcode_fetch_discord_messages + clawcode_share_file built-in tools auto-injected for every agent in session-config.ts toolDefinitionsStr; NO mcpServer attribution (Plan 94-02 capability filter sees them as built-in, never removes); 100-msg fetch clamp + 25MB share cap + allowedRoots security boundary + webhook→bot-direct fallback (Phase 90.1); failures wrap via 94-04 ToolCallError; DI-pure (no fs/discord.js imports in tool modules)
- [Phase 94]: Daemon-side computation of cross-agent alternatives — IPC payload is single source of truth, both renderers consume the same enriched payload
- [Phase 94]: Shared probe-renderer.ts module pattern — pure helpers (buildProbeRow / paginateRows / recoverySuggestionFor / STATUS_EMOJI) consumed by /clawcode-tools (Discord) AND clawcode mcp-status (CLI); cross-renderer parity test pins content equivalence
- [Phase 95]: [Phase 95]: Plan 95-01 — DreamPassOutcome 3-variant union (completed | skipped | failed) LOCKED — pinned by kind: z.literal count regression test
- [Phase 95]: [Phase 95]: Plan 95-01 — Token estimation via chars/4 heuristic; oldest-first chunk truncation drops tail after DESC sort until estimate ≤ 32K
- [Phase 95]: [Phase 95]: Plan 95-01 — Dream-pass primitive does NOT consult lastTurnAt — idle gating belongs to cron timer (Plan 95-02); manual triggers (CLI/Discord 95-03) bypass idle gating intentionally
- [Phase 95]: [Phase 95]: Plan 95-01 — Idle-detector hard floor 5min + hard ceiling 6h LOCKED at module-constant level (IDLE_HARD_FLOOR_MS/IDLE_HARD_CEILING_MS); per-agent dream.idleMinutes cannot override floor
- [Phase 95]: [Phase 95]: Plan 95-01 — MemoryChunk + ConversationSummary shapes decoupled from canonical SQLite-row types — narrow DI getter contracts kept independent so dream-pass schema evolves freely
- [Phase 95]: [Phase 95]: Plan 95-01 — 9th application of additive-optional schema blueprint: agents.*.dream + defaults.dream — v2.5/v2.6 migrated configs parse unchanged; both registered in RELOADABLE_FIELDS
- [Phase 95]: Plan 95-02: same-day dream-log files APPEND new ## sections (not overwrite); preserves prior passes byte-for-byte
- [Phase 95]: Plan 95-02: writeDreamLog failure does NOT roll back applyAutoLinks; wikilinks persisted on best-effort, structured error surfaces missing log to operator
- [Phase 95]: Plan 95-02: created src/manager/dream-cron.ts (mirroring daily-summary-cron.ts) instead of modifying non-existent src/manager/agent-bootstrap.ts; daemon-edge wiring deferred to Plan 95-03
- [Phase 95]: Plan 95-03 — Admin-gate-FIRST ordering: isAdminClawdyInteraction fires BEFORE deferReply so non-admins receive instant ephemeral 'Admin-only command' (zero IPC + zero LLM + zero log noise). Fail-closed default (empty adminUserIds → no admins recognized).
- [Phase 95]: Plan 95-03 — CLI exit-code 0/1/2 contract: 0=completed, 1=failed/IPC-error, 2=skipped. Operator scripts can branch on exit code without parsing JSON. Mirrors Phase 91/92 sync/cutover CLI patterns; extends with 2-for-skipped semantic.
- [Phase 95]: Plan 95-03 — Discord slash defaults idleBypass:true; CLI defaults idleBypass:false. Operator-driven Discord trigger semantically wants to fire; CLI requires explicit opt-in. Both share the daemon's run-dream-pass IPC handler — only the call-site contract differs.
- [Phase 95]: Plan 95-03 — 10th application of inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95) and 5th application of pure-IPC-handler blueprint (handleSetModelIpc / handleSetPermissionModeIpc / mcp-probe / handleCutoverButtonActionIpc / handleRunDreamPassIpc). Pattern is now canonical for operator-tier slash commands.
- [Phase 96]: [Phase 96 Plan 06] 3-value Zod enum extension for authoritativeSide (openclaw|clawcode|deprecated) — additive non-breaking schema migration; v2.4 fixtures parse unchanged.
- [Phase 96]: [Phase 96 Plan 06] DEPRECATION_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 ms locked at types.ts level; pinned by grep -F (W-2 convention robust to regex meta-chars in arithmetic literals).
- [Phase 96]: [Phase 96 Plan 06] Asymmetric systemctl-vs-state-update ordering — disable-timer: state-first (graceful systemctl); re-enable-timer: systemctl-first (fatal — rollback semantics demand timer running before claiming state restored).
- [Phase 96]: [Phase 96 Plan 06] sync run-once exit code 2 (NOT 1) when deprecated — bypasses systemd SuccessExitStatus=1, forces journalctl to surface deprecation as failed unit (operator attention).
- [Phase 96]: [Phase 96 Plan 06] State-machine guard at CLI layer (not runtime gate): deprecated → clawcode forward-cutover refused with operator-actionable error; operator must re-enable-timer or fresh setup before forward-cutover.
- [Phase 96]: Plan 96-01: 3-value FsCapabilityStatus enum (ready|degraded|unknown) intentionally diverges from Phase 94's 5-value MCP enum because filesystem capability has no reconnect/failed analog — operator-driven ACL changes don't transition through transient connect states
- [Phase 96]: Plan 96-01: D-06 boundary check (checkFsCapability) uses exact-match canonical-absPath Map lookup with NO startsWith — ACLs grant per-subtree access so a parent ready snapshot does NOT imply subtree readability; Phase 94 isPathInsideRoots startsWith pattern intentionally avoided
- [Phase 96]: Plan 96-01: fileAccess Zod schema is 10th additive-optional application (Phase 83/86/89/90/94 blueprint). Schema preserves literal {agent} token; loader resolveFileAccess(agentName, ...) substitutes at call time. v2.5 fixtures parse unchanged (5 fixtures regression-pinned)
- [Phase 96]: Plan 96-01: SessionHandle gains FsCapabilitySnapshot lazy-init mirror (getFsCapabilitySnapshot/setFsCapabilitySnapshot) — 6th application of post-construction DI mirror pattern (after McpState/FlapHistory/RecoveryAttemptHistory/SupportedCommands/ModelMirror). Stable Map identity contract matches Phase 85 exactly
- [Phase 96]: Plan 96-01: TS error count REDUCED net 13 (101 → 88) by sweeping up Phase 95's missing dream field while adding fileAccess to test fixtures (Rule 3 cascade pattern matches Phase 89 GREET-10 + Phase 90 MEM-01 precedent)
- [Phase 96]: Plan 96-02: Renderer at the daemon edge, NOT inside the assembler. Pre-rendered string threaded through ContextSources.filesystemCapabilityBlock additive optional field — preserves assembler purity (Phase 94 D-10 systemPromptDirectives idiom).
- [Phase 96]: Plan 96-02: <tool_status></tool_status> and <dream_log_recent></dream_log_recent> are positioning sentinels with EMPTY bodies — they wrap NO content today; render ONLY when fs block renders, preserving v2.5 cache-stability invariant.
- [Phase 96]: Plan 96-02: STRICT empty string on empty snapshot (W-4 ambiguity removed). v2.5 fixtures without fileAccess produce byte-identical stable prefix on Phase 96 deploy.
- [Phase 96]: Plan 96-02: Flap-stability constants reused by NAME from Phase 94 plan 02 (FS_FLAP_WINDOW_MS = 5*60*1000, FS_FLAP_TRANSITION_THRESHOLD = 3) — cross-domain consistency between tools and filesystem capabilities.
- [Phase 96-discord-routing-and-file-sharing-hygiene]: Phase 94 5-value ErrorClass enum NOT extended in 96-03. clawcode_list_files maps boundary refusal → 'permission'; depth/entries/size/missing → 'unknown' with rich suggestion. Pin established for 96-04 (share-file) which will face the same choice.
- [Phase 96-discord-routing-and-file-sharing-hygiene]: Auto-injection site verified at src/manager/session-config.ts:421-440 (NOT non-existent agent-bootstrap.ts per RESEARCH.md Pitfall 1). 96-03 wires clawcode_list_files as the third built-in tool alongside Phase 94 plan 05's two.
- [Phase 96]: [96-04] Phase 94 5-value ErrorClass enum LOCKED — D-12 4-class taxonomy (size/missing/permission/transient) maps onto existing 5 values via classifyShareFileError; size/missing → unknown with rich suggestion; permission/transient verbatim. NO enum extension.
- [Phase 96]: [96-04] outputDir runtime expansion (NOT loader) — loader returns literal template; runtime resolveOutputDir expands per-call with fresh ctx. Loader-time expansion would freeze {date} at config-load time.
- [Phase 96]: [96-04] D-10 directive text BOTH blocks — file-sharing directive contains auto-upload heuristic AND OpenClaw-fallback prohibition (added 2026-04-25 after operator surfaced anti-pattern in #finmentum-client-acquisition).
- [Phase 96]: [96-04] Sibling pure detectors with DISTINCT dedup keys — detectMissedUpload + detectOpenClawFallback throttle independently via 'missed-upload' vs 'openclaw-fallback' keys; sibling try/catch isolation in firePostTurnDetectors so one detector failure cannot prevent the other.
- [Phase 96]: Plan 96-05: Status emoji palette LOCKED ✓/⚠/? (NOT ✅/❌ from Phase 85) — filesystem has no failed/reconnecting analog so simpler 3-symbol palette suffices and reads cleaner in monospace CLI; pinned across Discord slash, status-render, probe-fs CLI, fs-status CLI
- [Phase 96]: Plan 96-05: Cap-budget invariant (Phase 85 Pitfall 9 — Discord 100/guild cap) pinned via vitest PFS-CAP-BUDGET assertion replacing fragile runtime grep on compiled JS — TDD-friendly, runs every test pass even when no compiled JS exists
- [Phase 96]: Plan 96-05: Daemon IPC handlers extracted as pure-DI module (src/manager/daemon-fs-ipc.ts) — handleProbeFsIpc + handleListFsStatusIpc tested in isolation without spawning the full daemon; mirrors Phase 92 daemon-cutover-button-action discipline; closure-based intercept BEFORE routeMethod preserves stable routeMethod signature
- [Phase 96-discord-routing-and-file-sharing-hygiene]: fs-probe heartbeat check shape = per-agent execute(ctx) (Phase 85 mcp-reconnect mirror, NOT plan example tick(deps))
- [Phase 96-discord-routing-and-file-sharing-hygiene]: Reload dispatch = simpler heartbeat-tick fallback (RELOADABLE_FIELDS classification + 60s tick); watcher.ts NOT extended for v1
- [Phase 96-discord-routing-and-file-sharing-hygiene]: D-01 boot probe APPROXIMATED via TWO-STEP coverage (deploy-runbook Section 4 mandatory fleet probe + first 60s heartbeat tick); no separate session-start probe code path
- [Phase 100-01]: Apply .min(1) on settingSources array (RESEARCH.md Pitfall 3 — empty array silently disables ALL filesystem settings)
- [Phase 100-01]: settingSources at ResolvedAgentConfig is ALWAYS populated (defaults to ['project']); gsd is conditional (undefined-when-unset)
- [Phase 100-01]: Cascade fix: 22 test fixtures got settingSources line after memoryCueEmoji (matches Phase 89/90/96 22-fixture pattern)
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-03 — settingSources + gsd.projectDir classified NON_RELOADABLE (agent-restart-required). 1st application of agent-restart classification in Phase 100; mirrors v2.5 SHARED-01 memoryPath documentation-of-intent pattern. Watcher untouched (Phase 22 reloadable=false contract already correct). DI8 regression pin defends against accidental future promotion to RELOADABLE_FIELDS.
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-03 — Plan 08 SMOKE-TEST runbook hand-off: operator MUST run 'clawcode restart admin-clawdy' after editing settingSources or gsd.projectDir in clawcode.yaml; the watcher emits agent-restart-needed signal but does NOT auto-restart. NOT a daemon restart (would unnecessarily bounce the entire fleet).
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 02 — symmetric-edits Rule 3 enforced for createSession + resumeSession baseOptions; SA5..SA8 parity tests catch any future drift
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 02 — vi.mock @anthropic-ai/claude-agent-sdk at session-adapter test file top establishes the SDK adapter end-to-end test pattern; existing tests unaffected (they don't await import the SDK module)
- [Phase 100]: Plan 100-05 — Phase 99-M relay extended with optional 'Artifacts written:' line. DI-pure helpers (resolveArtifactRoot + discoverArtifactPaths) preserve failures-swallow contract. Zero behavior change for non-GSD subthreads (parentConfig.gsd === undefined). Relative paths only per RESEARCH Pitfall 8.
- [Phase 100]: Optional-DI for subagentThreadSpawner (mirrors Phase 87 aclDeniedByAgent + Phase 83 skillsCatalog) — missing spawner emits 'unavailable' reply rather than throwing
- [Phase 100]: deferReply is FIRST async call in handleGsdLongRunner (RESEARCH.md Pitfall 4) — pinned by GSD-6 invocationCallOrder assertion
- [Phase 100]: Set-based long-runner detection (GSD_LONG_RUNNERS.has) instead of if-ladder string compares — scales when more long-runners join
- [Phase 100]: Plan 100-06 — clawcode gsd install CLI subcommand: DI-pure runGsdInstallAction + ensureSymlink + ensureSandbox helpers; idempotent (readlink + stat detection of already-present state); source-paths-immutable invariant pinned by INST14 spy assertion; zero new npm deps (node:fs/promises + node:child_process built-ins). Symlinks PARENT directories to sidestep Issue #14836; targets ~/.claude/commands/gsd as SDK-discoverable surface.
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-07: admin-clawdy block placed at END of agents list (after research) — coherent grouping; channels: [] in dev fixture (production yaml carries real ID per Plan 08 runbook); workspace: /tmp/admin-clawdy placeholder; gsd.projectDir byte-matches Plan 06 DEFAULTS.sandboxDir.
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-07 [Rule 3 - Blocking deviation]: PR11 (schema.test.ts) updated to encode Plan 07 cascade — admin-clawdy is sole settingSources/gsd carrier; production agents stay implicit-default. Preserves additive-optional schema invariant + CONTEXT.md lock-in. Strictly better coverage than pre-Plan-07 PR11 (catches both directions of drift).
- [Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow]: Plan 100-07: 8 YML parse-regression tests cover SHAPE, not BEHAVIOR. Plan 04 dispatcher tests handle dispatch-time behavior; Plan 02 session-adapter tests handle SDK-passthrough behavior. YML1..YML8 are the structural pin between the two consumer-side tests.
- [Phase 100]: [Phase 100]: Plan 100-08 — SMOKE-TEST.md (562 lines, 9 sections, 10 structural tests) is the canonical Phase 100 deploy + UAT runbook for transitioning to clawdy production. autonomous=false because Sections 6-8 require operator interaction in #admin-clawdy on production Discord.
- [Phase 100]: [Phase 100]: Plan 100-08 — Established structural runbook test pattern at .planning/phases/<N>-*/_tests__/<doc>-doc.test.ts pinning markdown invariants. Repeatable for any future operator-runnable artifact (deploy/migration/smoke runbook). Vitest discovers .planning/__tests__/ via default include pattern (no config edit needed).
- [Phase 103]: Plan 103-01 — /clawcode-status: 8 hardcoded `n/a` placeholders wired to live telemetry (Compactions, Context %, Tokens, Activation, Queue, Reasoning label, Permissions, lastActivityAt). 3 OpenClaw-only fields dropped (Fast/Elevated/Harness). Substring grep gates pin the absence at file level.
- [Phase 103]: Plan 103-01 — Compaction counter is in-memory only (Open Q4): resets on daemon restart, informational not persistence-worthy. Bumps ONLY on CompactionManager.compact() resolve via canonical compactForAgent wrapper (Pitfall 3 — rejection cannot inflate count). Closure check pins zero direct .compact() callers in production code.
- [Phase 103]: Plan 103-01 — HeartbeatRunner injected into SessionManager via setHeartbeatRunner DI setter (mirrors setWebhookManager / setMemoryScanner pattern); not a constructor argument. Daemon wires post-runner-start.
- [Phase 103]: Plan 103-01 — Activation timestamp mirrored in-memory via activationAtByAgent Map at startAgent — registry remains source of truth for restart recovery, but synchronous status renders don't await readRegistry per request. Cleared on stopAgent alongside compactionCounts (matches in-memory-only semantics).
- [Phase 103]: rate_limit_snapshots table lives in the per-agent UsageTracker DB rather than a separate SQLite file (one DB handle per agent stays clean)
- [Phase 103]: rateLimitType stored as TEXT (not SDK 5-value union) so a future SDK union expansion does not drop snapshots (Pitfall 10)
- [Phase 103]: surpassedThreshold typed as number|undefined per SDK shape (Pitfall 9 — NOT a boolean)
- [Phase 103]: Persistence is best-effort — SQLite write failures inside record() are logged + swallowed; in-memory state remains source of truth
- [Phase 103]: Hook positioned BEFORE the result branch in iterateUntilResult — ordering documents intent, result-terminator path is preserved
- [Phase 103]: 12th application of inline-handler-short-circuit-before-CONTROL_COMMANDS pattern (Phases 85/86/87/88/90/91/92/95/96/100/103-03) — pattern is canonical at 12 applications
- [Phase 103]: IPC method named list-rate-limit-snapshots (NOT colliding with existing rate-limit-status for Discord outbound rate-limiter — Pitfall 5 closure)
- [Phase 103]: Pure-DI handler module pattern — daemon-rate-limit-ipc.ts mirrors Phase 96 daemon-fs-ipc / Phase 92 cutover-ipc-handlers blueprint (3rd application of dedicated-IPC-module pattern)
- [Phase 103]: Overage rendered as status-line not progress bar (Open Q3) — credit-pool model doesn't translate to a percentage bar

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
- 2026-04-24: v2.4 shipped — Phase 91 autonomously executed (6 plans, 6 waves, 10 SYNC reqs, 166/166 sync tests green). Milestone archived to `.planning/milestones/v2.4-ROADMAP.md`. Zero new npm deps preserved via node:child_process.execFile + existing chokidar/yaml/better-sqlite3. Cutover command + 7-day rollback window implemented; `clawcode sync` CLI group with 8 subcommands + /clawcode-sync-status Discord slash. Sync runner + translator ship as systemd user timers with graceful-SSH-fail tolerance.
- 2026-04-24: v2.5 Cutover Parity Verification opened — Phase 92 added: OpenClaw → ClawCode fin-acquisition cutover parity verifier. Uses Discord message store (not OpenClaw internal sessions, which are absent) as behavior corpus. Emits gap report, auto-applies additive-reversible fixes, gates destructive mutations behind admin-clawdy ephemeral confirmation. `cutover-ready: true` report becomes hard precondition for Phase 91 `sync set-authoritative clawcode --confirm-cutover`. 10 CUT-01..CUT-10 requirements across 6 suggested plans (92-01..92-06). Reuses Phase 85 list-mcp-status IPC, Phase 86 atomic YAML writers, Phase 80 origin_id idempotency. Zero new npm deps expected.
- 2026-04-24: Phase 93 added — Status-detail parity + ClawHub public-catalog defaults + plugin manifest-URL resilience. Bundles three user-reported fixes from fin-acquisition Discord (2026-04-24): (93-01) restore rich `/clawcode-status` output deferred in Phase 83 EFFORT-07 to match OpenClaw /status (version+commit, model+key-source, fallbacks, context/compactions, session/updated, runtime/runner/think/elevated, activation/queue); (93-02) auto-inject `defaults.clawhubBaseUrl` as synthetic ClawHub source in `loadMarketplaceCatalog` when no explicit marketplaceSources[kind:"clawhub"] present so `/clawcode-skills-browse` surfaces public skills (today: local-only); (93-03) distinguish manifest-404 from manifest-invalid in `downloadClawhubPluginManifest` + `mapFetchErrorToOutcome` so hivemind-style "listed without manifest" emits `manifest-unavailable` outcome with actionable UI copy instead of misleading "manifest is invalid". IN: all three + tests + Discord UI strings. OUT: skill-side OAuth (Phase 90-06), publishing hivemind manifest (registry-side).
- 2026-04-25: Phase 96 added — Discord routing and file-sharing hygiene. Bundles user-reported issues from #research and #finmentum-client-acquisition (2026-04-25): dual-bot pattern (Clawdy red + Clawdy Code green both responding), agent confabulation about "OpenClaw vs ClawCode contexts", file attachment delivery via webhook with single visual identity (must post as "Clawdy" not "OpenClaw Agents"), agent auto-routing through OpenClaw without explicit user instruction every time, and stale "no workspace access from this side" excuses across multiple agents. Inline pre-phase work this session: (a) clawcode.yaml channel bindings stripped for OpenClaw-routed agents (test-agent + Admin Clawdy retain bindings); (b) `/home/clawcode/.claude/settings.json` disabled `discord@claude-plugins-official` plugin; (c) Discord channel ACLs reverted on 8 OpenClaw channels (Clawdy Code role removed); (d) `/etc/clawcode/openclaw-webhooks.json` populated with webhook id+token for 8 channels (3 newly created via legacy bot); (e) `clawcode_share_file` IPC handler in `daemon.ts` modified to use OpenClaw webhook execute when channel not in agent bindings — WIP edits stashed at `git stash@{0}` for fold-in. Open: webhook display name override (post as Clawdy + correct avatar) + agent prompt/memory updates so agents auto-attempt attach without user instruction + workspace access narrative (clawcode user IS in jjagpal group + has ACLs on .openclaw, but agents recite stale "no access" claim).

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
| 260429-ouw | Webhook table-wrap regression — wrap markdown tables inside webhookManager.send (covers 3 missed Phase 100-fu call sites) | 2026-04-29 | 696bc39 | [260429-ouw-webhook-path-table-wrap-regression-add-w](./quick/260429-ouw-webhook-path-table-wrap-regression-add-w/) |
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
| Phase 91 P04 | 11m | 2 tasks | 13 files |
| Phase 91 P06 | 9 min | 2 tasks | 4 files |
| Phase 91 P05 | 10m 33s | 2 tasks | 9 files |
| Phase 92 P01 | 29min | 2 tasks | 11 files |
| Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier P02 | 6m | 2 (TDD) tasks | 8 files files |
| Phase 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier P03 | 9m | 2 tasks | 5 files |
| Phase 92 P04 | 12 | 2 tasks | 11 files |
| Phase 93-status-detail-parity-clawhub-public-catalog-defaults-plugin-manifest-url-resilience P01 | 33m 40s | 2 tasks tasks | 5 files files |
| Phase 92 P05 | 6m 34s | 2 (TDD) tasks | 9 files |
| Phase 92 P06 | 7m | 2 tasks | 11 files |
| Phase 93 P02 | 21min | 2 tasks | 6 files |
| Phase 93 P03 | 25min | 2 tasks | 5 files |
| Phase 94 P01 | 13min | 2 tasks | 15 files |
| Phase 94-tool-reliability-self-awareness P04 | 17min | 2 tasks | 5 files |
| Phase 94 P02 | 34min | 2 tasks | 13 files |
| Phase 94 P03 | 23min | 2 tasks | 14 files |
| Phase 94-tool-reliability-self-awareness P06 | 7min | 2 tasks | 8 files |
| Phase 94-tool-reliability-self-awareness P05 | 6min | 2 tasks | 5 files |
| Phase 94 P07 | 10min | 2 tasks | 6 files |
| Phase 95 P01 | 30min | 2 tasks | 9 files |
| Phase 95 P02 | 24min | 2 tasks | 6 files |
| Phase 95 P03 | 25min | 2 tasks | 12 files |
| Phase 96 P06 | 28min | 2 tasks | 13 files |
| Phase 96 P01 | 25min | 3 tasks | 17 files |
| Phase 96 P02 | 12min | 3 tasks | 3 files |
| Phase 96-discord-routing-and-file-sharing-hygiene P03 | 18min | 2 tasks | 5 files |
| Phase 96 P04 | 23min | 3 tasks | 9 files |
| Phase 96 P05 | 14min | 3 tasks | 12 files |
| Phase 96-discord-routing-and-file-sharing-hygiene P07 | 9 min | 3 tasks | 6 files |
| Phase 100-01 P01 | 14min | 2 tasks | 27 files |
| Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow P03 | 5min | 1 tasks | 2 files |
| Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow P02 | 16min | 2 tasks | 4 files |
| Phase 100 P05 | 7min | 1 tasks | 2 files |
| Phase 100 P04 | 9min | 2 tasks | 2 files |
| Phase 100 P06 | 5min | 2 tasks | 3 files |
| Phase 100-gsd-via-discord-on-admin-clawdy-operator-self-serve-dev-workflow P07 | 6min | 2 tasks | 3 files |
| Phase 100 P08 | 5min | 1 tasks | 2 files |
| Phase 103 P02 | ~22min | 2 tasks | 10 files |
| Phase 103 P03 | 30min | 2 tasks | 14 files |

## Session Continuity

Last activity: 2026-04-29
Stopped at: Completed 103-03-PLAN.md
Resume: Execute 85-02-PLAN.md (two-block prompt-builder MCP tools section — stable prefix tool list + mutable suffix live status table) — Plan 02 can now read `SessionHandle.getMcpState()` directly without reaching into SessionManager internals
