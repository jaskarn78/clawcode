/**
 * Types and constants for config hot-reload infrastructure.
 */

/**
 * A single field-level change detected between two config versions.
 */
export type ConfigChange = {
  readonly fieldPath: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly reloadable: boolean;
};

/**
 * Result of diffing two config objects.
 */
export type ConfigDiff = {
  readonly changes: readonly ConfigChange[];
  readonly hasReloadableChanges: boolean;
  readonly hasNonReloadableChanges: boolean;
};

/**
 * A single entry in the JSONL audit trail.
 */
export type AuditEntry = {
  readonly timestamp: string;
  readonly fieldPath: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
};

/**
 * Event emitted when a config change is detected.
 */
export type ConfigChangeEvent = {
  readonly diff: ConfigDiff;
  readonly timestamp: string;
};

/**
 * Field path prefixes that can be hot-reloaded without daemon restart.
 */
export const RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  "agents.*.channels",
  "agents.*.skills",
  "agents.*.schedules",
  "agents.*.heartbeat",
  "defaults.heartbeat",
  // Phase 83 EFFORT-01 — runtime override via handle.setEffort → next turn.
  // No socket/db/workspace resource touched; buildOptions re-reads
  // currentEffort per turn, so YAML edits are picked up on restart AND a
  // live /clawcode-effort call invokes q.setMaxThinkingTokens immediately.
  "agents.*.effort",
  "defaults.effort",
  // Phase 86 MODEL-01 — allowlist is read lazily by the Discord picker
  // on every invocation (no cached state in a session handle). A YAML
  // edit takes effect on the NEXT /clawcode-model interaction without
  // restart. Runtime model SWITCHES remain non-reloadable (agents.*.model
  // still requires session restart per types.ts:63) — the allowlist
  // governs what's PICKABLE, not what's active.
  "agents.*.allowedModels",
  "defaults.allowedModels",
  // Phase 89 GREET-07 — both flags read lazily by SessionManager.restartAgent
  // on every call (no cached state). A YAML edit takes effect on the NEXT
  // restart without daemon bounce.
  "agents.*.greetOnRestart",
  "defaults.greetOnRestart",
  "agents.*.greetCoolDownMs",
  "defaults.greetCoolDownMs",
  // Phase 90 MEM-01 — Next session boot picks up a YAML edit. MEMORY.md
  // content itself is re-read at every session boot (mtime naturally
  // busts the stable-prefix cache); the schema flag gates the read.
  "agents.*.memoryAutoLoad",
  "defaults.memoryAutoLoad",
  "agents.*.memoryAutoLoadPath",
  // Phase 90 MEM-03 — top-K + token budget read lazily by
  // getMemoryRetrieverForAgent at each turn. A YAML edit takes effect on
  // the NEXT turn without daemon bounce.
  "agents.*.memoryRetrievalTopK",
  "defaults.memoryRetrievalTopK",
  "defaults.memoryRetrievalTokenBudget",
  // Phase 115 sub-scope 3 — per-agent + agents-prefix token budget.
  // Reloadable: same closure-re-read path as memoryRetrievalTopK above.
  // Plan 115-01 lit up this previously-dead knob; the closure in
  // SessionManager.getMemoryRetrieverForAgent reads
  // config?.memoryRetrievalTokenBudget on each retrieval.
  "agents.*.memoryRetrievalTokenBudget",
  // Phase 115 sub-scope 4 — tag-exclusion list for hybrid-RRF retrieval.
  // Reloadable: same closure-re-read path. Locked default
  // ["session-summary","mid-session","raw-fallback"] per CONTEXT.md
  // sub-scope 4.
  "agents.*.memoryRetrievalExcludeTags",
  "defaults.memoryRetrievalExcludeTags",
  // Phase 90 MEM-02 — scanner enable flag. Reloadable semantics: a YAML
  // flip from true→false at runtime does NOT stop an already-running
  // scanner (requires daemon restart); a false→true flip starts scanners
  // only for newly-added agents. Pragmatic compromise vs. full watcher-
  // lifecycle churn.
  "agents.*.memoryScannerEnabled",
  "defaults.memoryScannerEnabled",
  // Phase 90 MEM-04 — flush cadence. Reloadable: YAML edit takes effect
  // on the NEXT agent start (current timers keep running at the old
  // interval). A full daemon restart is NOT required for the fleet to
  // pick up a new default.
  "agents.*.memoryFlushIntervalMs",
  "defaults.memoryFlushIntervalMs",
  // Phase 90 MEM-05 — reaction emoji read lazily by TurnDispatcher at each
  // cue-detection event. A YAML edit takes effect on the NEXT cue-detected
  // turn.
  "agents.*.memoryCueEmoji",
  "defaults.memoryCueEmoji",
  // Phase 94 TOOL-10 / D-10 — system-prompt directives. Reloadable: a
  // YAML edit takes effect on the NEXT prompt assembly (per-turn boundary
  // — assembler reads via the loader resolver each turn). No socket / DB /
  // workspace restart required. 8th application of the Phase 83/86/89/90
  // additive-optional reloadable blueprint.
  "agents.*.systemPromptDirectives",
  "defaults.systemPromptDirectives",
  // Phase 95 DREAM-01..03 — dream cycle config. Reloadable: a YAML edit
  // takes effect on the NEXT cron tick / NEXT dream-pass invocation
  // (95-02 cron reads via the loader resolver each fire). Current in-
  // flight dream passes complete at the previous setting. 9th application
  // of the Phase 83/86/89/90/94 additive-optional reloadable blueprint.
  "agents.*.dream",
  "defaults.dream",
  // Phase 96 D-03 / D-09 — fileAccess + outputDir reloadable.
  // Reload semantics:
  //   - fileAccess: classifying as reloadable signals "no daemon restart
  //     needed". The next 60s heartbeat tick (src/heartbeat/checks/fs-
  //     probe.ts — Phase 96 plan 07 task 1) reads the freshly-loaded paths
  //     via deps.getResolvedConfig(agent) and runs runFsProbe against the
  //     new declarations. Operators wanting sub-60s response can run
  //     /clawcode-probe-fs <agent> (Phase 96 plan 05) manually.
  //   - outputDir: resolveOutputDirTemplate is read lazily on each
  //     clawcode_share_file call (Phase 96 plan 04) — a YAML edit takes
  //     effect on the NEXT share invocation. No restart required.
  // 10th and 11th applications of the Phase 83/86/89/90/94/95 additive-
  // optional reloadable blueprint.
  "agents.*.fileAccess",
  "defaults.fileAccess",
  "agents.*.outputDir",
  "defaults.outputDir",
  // Phase 110 Stage 0a — shimRuntime + brokers schema scaffolding.
  //   - defaults.shimRuntime: per-shim-type runtime selector. Reloadable
  //     via the existing prefix-match classifier (children of the prefix
  //     all classify reloadable). Stage 0a accepts only "node"; Stage 0b
  //     widens the enum and lands the alternate-runtime spawn path. The
  //     swap happens on the NEXT agent start (current shims keep running
  //     under their boot-time runtime — same posture as Phase 90 MEM-04).
  //   - defaults.brokers: server-id keyed dispatch table. Schema-only in
  //     Stage 0a; the broker dispatcher is wired in Stage 1a. Mirrors the
  //     Phase 109-C `brokerPooling` precedent (schema present, consumer
  //     reads at its own cadence) so a runtime YAML edit in Stage 0a is
  //     a no-op until Stage 1a lands. Classified reloadable so the
  //     Stage 1a wiring picks up edits without a restart.
  "defaults.shimRuntime",
  "defaults.brokers",
  // Phase 109-B — orphan-claude reaper config. Mode/minAgeSeconds edits
  // hot-reload via the daemon's onTickAfter closure, which reads
  // `config.defaults.orphanClaudeReaper` on each 60s tick. The closure-
  // capture fix (same PR that landed subagentReaper reloadable) ensures
  // the ModeGetter sees the post-reload value without a daemon restart.
  "defaults.orphanClaudeReaper",
  // Phase 999.X — subagent-thread reaper config. Mode/idle/minAge edits
  // hot-reload through the existing ConfigReloader path (Phase 109-B
  // precedent — same shape as defaults.orphanClaudeReaper above). The
  // daemon's onTickAfter closure reads `config.defaults.subagentReaper`
  // each tick, so a YAML edit takes effect on the next 60s sweep without
  // a restart.
  "defaults.subagentReaper",
  // Phase 999.25 — subagent completion relay. enabled +
  // quiescenceMinutes hot-reload via the same closure-capture-fixed
  // path as subagentReaper above. The daemon's quiescence sweep reads
  // `config.defaults.subagentCompletion` on each 60s tick.
  "defaults.subagentCompletion",
  // Phase 127 — stream-stall supervisor threshold (no-useful-tokens
  // timeout). The setInterval checker in persistent-session-handle.ts +
  // wrapSdkQuery re-reads the live ResolvedAgentConfig.streamStallTimeoutMs
  // on every tick (interval Math.min(threshold/4, 30_000)ms), so a yaml
  // edit picked up by ConfigWatcher applies to the very next stall-check
  // pass without daemon restart. Per-model overrides
  // (defaults.modelOverrides.<haiku|sonnet|opus>.streamStallTimeoutMs)
  // are read by the loader resolver at agent-start; live reload re-runs
  // the resolver via ConfigReloader so per-model edits propagate the
  // same tick. Mirrors the closure-re-read pattern from Phase 90 MEM-03
  // (memoryRetrievalTopK) — see types.ts:78-83 above. Doc-of-intent +
  // hot-reload boundary documented per Phase 999.54-03 precedent.
  "agents.*.streamStallTimeoutMs",
  "defaults.streamStallTimeoutMs",
  "defaults.modelOverrides",
  // Phase 100 GSD-07 — settingSources + gsd.projectDir DELIBERATELY EXCLUDED
  // from RELOADABLE_FIELDS. See NON_RELOADABLE_FIELDS below + Plan 100-02
  // session-adapter wiring for rationale: both fields are SDK session-boot
  // baseOptions (passed to sdk.query at session start, NOT re-read per turn),
  // so a runtime YAML edit cannot retroactively change a live SDK session.
  // Operators MUST run `clawcode restart admin-clawdy` for an edit to take
  // effect. 1st application of an agent-restart classification in Phase 100
  // (vs. the 11 prior reloadable classifications in 83/86/89/90/94/95/96).
]);

/**
 * Field path prefixes that require a daemon restart to take effect.
 */
export const NON_RELOADABLE_FIELDS: ReadonlySet<string> = new Set([
  "agents.*.model",
  "agents.*.workspace",
  // Phase 75 SHARED-01 — memoryPath determines which memories.db / inbox/ /
  // heartbeat.log / session-state dir this agent owns. Swapping those at
  // runtime would require (a) closing the live MemoryStore + UsageTracker +
  // TraceStore, (b) re-opening against new paths, and (c) re-attaching the
  // chokidar InboxSource watcher and heartbeat runner — none of which are
  // implemented and all of which risk data loss. Operators must run
  // `systemctl stop clawcode && apply && systemctl start clawcode`.
  // The classifier falls through to `false` for any field not in
  // RELOADABLE_FIELDS, so this entry is documentation-of-intent; the
  // differ tests in differ.test.ts assert memoryPath ends up reloadable:false.
  "agents.*.memoryPath",
  // Phase 100 GSD-07 — settingSources + gsd.projectDir are SDK session-boot
  // baseOptions (cwd + settingSources at src/manager/session-adapter.ts:585-636
  // — see Plan 100-02). They are NOT re-read per turn. A clawcode.yaml edit
  // takes effect ONLY on the NEXT agent restart (`clawcode restart <name>`).
  // The classifier in differ.ts:144-149 already falls through to false for
  // unclassified paths; the explicit entries below match the Phase 75
  // SHARED-01 memoryPath documentation-of-intent pattern (line above).
  // Architectural rationale (RESEARCH.md Architecture Pattern 5): cwd is
  // captured into baseOptions when the SDK builds its query handle; mutating
  // the YAML after that point cannot reach the active session. Same for
  // settingSources, which controls which skills/commands/CLAUDE.md the SDK
  // scans at session start. 1st application of an agent-restart classification
  // in Phase 100 — the 11 prior phases (83/86/89/90/94/95/96) all classified
  // their additive fields as RELOADABLE. Operators wanting these to take
  // effect run: clawcode restart admin-clawdy
  "agents.*.settingSources",
  "defaults.settingSources",
  "agents.*.gsd",
  "agents.*.gsd.projectDir",
  "defaults.gsd",
  "defaults.gsd.projectDir",
  "defaults.model",
  "defaults.basePath",
  // Phase 115 sub-scope 2 — excludeDynamicSections is captured into the SDK's
  // baseOptions inside session-adapter.ts createSession / resumeSession when
  // the session is built; it is NOT re-read per turn. Same architectural
  // pattern as Phase 100's settingSources / gsd above. A clawcode.yaml edit
  // takes effect ONLY on the NEXT agent restart. Operators wanting an
  // immediate change must run: `clawcode restart <agent>`.
  "agents.*.excludeDynamicSections",
  "defaults.excludeDynamicSections",
  // Phase 115 sub-scope 5 (Plan 04) — cacheBreakpointPlacement is captured
  // into the assembled stable prefix at session create/resume time (the
  // marker placement is baked into systemPrompt.append). Same architectural
  // pattern as excludeDynamicSections above. A clawcode.yaml edit takes
  // effect ONLY on the NEXT agent restart. Operators wanting an immediate
  // change must run: `clawcode restart <agent>`.
  "agents.*.cacheBreakpointPlacement",
  "defaults.cacheBreakpointPlacement",
  // Phase 999.54 (D-04) — mcpServers[].alwaysLoad is captured into the SDK's
  // baseOptions inside session-adapter.ts createSession / resumeSession via
  // transformMcpServersForSdk (Plan 01) when the session is built; it is NOT
  // re-read per turn. Same architectural pattern as Phase 100 GSD-07's
  // settingSources / gsd and Phase 115 sub-scope 2/5's excludeDynamicSections /
  // cacheBreakpointPlacement above. A clawcode.yaml edit takes effect ONLY on
  // the NEXT agent restart. Operators wanting an immediate change must run:
  // `clawcode restart <agent>`. The classifier in differ.ts:144-149 falls
  // through to `reloadable: false` for unclassified paths; the explicit
  // entries below match the documentation-of-intent precedent (grep target
  // for future maintainers + Plan 04 regression-test source-of-truth).
  // Phase 999.54 Plan 02 also bakes `alwaysLoad: true` into the auto-injected
  // `clawcode` server at loader.ts:295-304 — fleet-wide preload default;
  // per-agent overrides (inline-object form) win via the existing
  // resolvedMcpMap.has("clawcode") gate.
  "defaults.mcpServers.*.alwaysLoad",
  "agents.*.mcpServers.*.alwaysLoad",
]);
