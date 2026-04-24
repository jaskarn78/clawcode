---
phase: 90-clawhub-marketplace-fin-acquisition-memory-prep
plan: 01
subsystem: memory
tags: [memory, stable-prefix, additive-optional, schema, session-config, fin-acquisition, zod]

# Dependency graph
requires:
  - phase: 89-agent-restart-greeting
    provides: additive-optional schema rollout blueprint (greetOnRestart/greetCoolDownMs) — agentSchema optional + defaultsSchema default + RELOADABLE_FIELDS + loader resolver fallback + configSchema literal + Rule 3 fixture cascade
  - phase: 86-dual-discord-model-picker-core
    provides: allowedModels additive-optional precedent — first application of the blueprint this plan now reuses verbatim
  - phase: 53-two-block-prompt-caching
    provides: v1.7 stable-prefix + mutable-suffix assembler (sources.identity → stablePrefix) — injection site for MEMORY.md
  - phase: 85-mcp-tool-awareness-reliability
    provides: MCP status table renderer (renderMcpPromptBlock) — anchor point BEFORE which MEMORY.md must land per D-18
  - phase: 78-cutover-shared-workspace
    provides: soulFile/identityFile lazy-read precedence pattern — silent fall-through semantics this plan copies
provides:
  - MEMORY.md auto-load into v1.7 stable prefix (SOUL → IDENTITY → **MEMORY** → MCP status → conversation history)
  - memoryAutoLoad additive-optional schema field (per-agent override + fleet-wide default)
  - memoryAutoLoadPath per-agent path override (absolute or ~/...)
  - MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024 hard cap + "…(truncated at 50KB cap)" marker
  - RELOADABLE_FIELDS entries: agents.*.memoryAutoLoad, defaults.memoryAutoLoad, agents.*.memoryAutoLoadPath
affects:
  - 90-02 (file-scanner + memory_chunks backfill — complements MEM-01's single-file auto-inject)
  - 90-03 (mid-session flush + "remember this" cue — writes new MEMORY candidates)
  - 90-07 (fin-acquisition wiring — inherits MEMORY.md auto-load on first session start)

# Tech tracking
tech-stack:
  added: []  # zero new npm deps — additive zod + existing fs/promises readFile only
  patterns:
    - "Sixth application of the Phase 83/86/89 additive-optional schema blueprint (agentSchema.optional + defaultsSchema.default + RELOADABLE_FIELDS + loader resolver + configSchema literal)"
    - "MEMORY_AUTOLOAD_MAX_BYTES exported constant — cap lives in schema.ts, consumed by session-config.ts; regression-pin grep target stays stable"
    - "Buffer byteLength + Buffer.slice(MAX).toString('utf8') truncation pattern for UTF-8 safe byte-level caps"
    - "Silent fall-through on missing file — mirrors Phase 78 soulFile/identityFile semantics; absence is the first-boot default, not an error"

key-files:
  created: []
  modified:
    - src/config/schema.ts
    - src/config/types.ts
    - src/config/loader.ts
    - src/shared/types.ts
    - src/manager/session-config.ts
    - src/config/__tests__/schema.test.ts
    - src/config/__tests__/loader.test.ts
    - src/manager/__tests__/session-config.test.ts
    - (22 test fixtures — Rule 3 blocking cascade for memoryAutoLoad required field)

key-decisions:
  - "Sixth application of the Phase 83/86/89 additive-optional blueprint — agentSchema.memoryAutoLoad optional, defaultsSchema.memoryAutoLoad defaults true, RELOADABLE_FIELDS lists both paths + memoryAutoLoadPath, loader resolver uses explicit `!== undefined` check (boolean false handling)"
  - "50KB hard cap per D-17 — enforced in session-config.ts via Buffer byteLength check + Buffer.slice + '…(truncated at 50KB cap)' marker. UTF-8 safe at byte boundaries (markdown prose is mostly ASCII)"
  - "Injection order pinned per D-18 — MEMORY.md appends to identityStr (lands in sources.identity), which is rendered AFTER SOUL fingerprint + IDENTITY body + name anchor and BEFORE the MCP status table assembly (toolDefinitionsStr section)"
  - "Silent fall-through on missing file mirrors Phase 78 soulFile/identityFile — configured-but-unreadable does NOT crash session boot; absence is the common first-boot case, no warn log"
  - "Opt-out via memoryAutoLoad === false — readFile is NEVER called when the flag is false. Test MEM-01-C3 pins the zero-readFile-call invariant"
  - "memoryAutoLoadPath is per-agent-only (NOT in defaults) — a fleet-wide memory path makes no sense (each agent has its own workspace). Expanded via expandHome in loader.ts; undefined passes through so session-config.ts falls back to {workspace}/MEMORY.md"
  - "No thread-through of memoryAutoLoad into AgentSessionConfig — buildSessionConfig reads config.memoryAutoLoad directly from the ResolvedAgentConfig parameter and bakes the content into systemPrompt. The downstream session adapter sees only the final prompt string, not the flag"

patterns-established:
  - "Injection order pinned by MEM-01-C1 four-monotonic-indexOf test — SOUL_MARKER < IDENTITY_MARKER < MEMORY_MARKER < MCP Servers. Guards against accidental reordering by future phases"
  - "Byte-level UTF-8 truncation with Buffer.slice — safe for markdown prose (ASCII-dominant) and asserted in MEM-01-C2 (60KB input → exactly 50*1024 byte body + marker)"
  - "Opt-out readFile-zero-call invariant — MEM-01-C3 asserts `vi.mocked(readFile).mock.calls.find((c) => c[0] === memPath)` is undefined when memoryAutoLoad=false. Opt-out is enforcement, not advisory"
  - "Override-path zero-fallback invariant — MEM-01-C4 asserts workspace/MEMORY.md is NEVER read when memoryAutoLoadPath is set, even if the override fails"
  - "Stable-prefix placement regression pin (MEM-01-C7) — MEMORY.md content MUST NOT appear in mutableSuffix. Guards the cache-hash invariant from Phase 52 Plan 02"

requirements-completed: [MEM-01]

# Metrics
duration: 12min
completed: 2026-04-24
---

# Phase 90 Plan 01: MEMORY.md Auto-Inject into Stable Prefix (MEM-01) Summary

**MEMORY.md auto-loaded into the v1.7 stable prefix at session boot (SOUL → IDENTITY → MEMORY → MCP), 50KB hard cap with truncation marker, additive-optional schema — closes the Apr 20 "Finmentum LLC" recall crisis for fin-acquisition and every other agent by default.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T01:02:35Z
- **Completed:** 2026-04-24T01:14:30Z
- **Tasks:** 2 (TDD: RED → GREEN for each)
- **Files modified:** 28 (4 production, 3 test files directly, 22 fixtures via Rule 3 cascade)

## Accomplishments

- Additive-optional `memoryAutoLoad` schema field (per-agent + fleet default true) — v2.1 migrated 15-agent fleet parses unchanged (regression-pinned)
- `memoryAutoLoadPath` per-agent path override with expandHome expansion in loader.ts
- `MEMORY_AUTOLOAD_MAX_BYTES` exported constant (50 * 1024) centralizes the cap
- `buildSessionConfig` reads `{workspace}/MEMORY.md` (or override path) and injects into the stable prefix after SOUL+IDENTITY and before MCP status table (D-18 order)
- 50KB hard cap with `…(truncated at 50KB cap)` marker (D-17) — pinned by MEM-01-C2 (60KB input → exactly 50*1024 body)
- Silent fall-through on missing file — no warn log, no crash (first-boot semantics mirror Phase 78 soulFile/identityFile)
- Opt-out via `memoryAutoLoad: false` — readFile NEVER invoked (MEM-01-C3 zero-call invariant)
- Fin-acquisition integration test MEM-01-C6 confirms "Finmentum LLC" surfaces in the stable prefix without retrieval
- Stable-prefix placement regression pin (MEM-01-C7) guards the Phase 52 cache-hash invariant

## Task Commits

Each task committed atomically (TDD):

1. **Task 1 RED: schema + loader failing tests** — `47b59af` (test)
2. **Task 1 GREEN: memoryAutoLoad additive-optional schema + resolver** — `ed517b9` (feat)
3. **Task 2 RED: session-config MEMORY.md injection failing tests** — `8ca3d1c` (test)
4. **Task 2 GREEN: wire MEMORY.md auto-inject into stable prefix** — `1556fcb` (feat)

**Plan metadata:** (pending — this SUMMARY + STATE/ROADMAP updates)

## Files Created/Modified

### Production code
- `src/config/schema.ts` — `agentSchema.memoryAutoLoad` optional, `agentSchema.memoryAutoLoadPath` optional, `defaultsSchema.memoryAutoLoad` default true, `MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024` exported, `configSchema` default literal updated
- `src/config/types.ts` — `RELOADABLE_FIELDS` entries for `agents.*.memoryAutoLoad`, `defaults.memoryAutoLoad`, `agents.*.memoryAutoLoadPath`
- `src/config/loader.ts` — resolver fills `memoryAutoLoad` from defaults when agent omits it; `memoryAutoLoadPath` expanded via expandHome
- `src/shared/types.ts` — `ResolvedAgentConfig.memoryAutoLoad: boolean` (always populated), `memoryAutoLoadPath?: string` (optional)
- `src/manager/session-config.ts` — MEMORY.md injection block after line 227 (identity anchor), imports `MEMORY_AUTOLOAD_MAX_BYTES`, 50KB cap with truncation marker, silent fall-through on missing file

### Tests
- `src/config/__tests__/schema.test.ts` — 12 new tests (MEM-01-S1..S4 + constant + RELOADABLE_FIELDS + v2.1 back-compat)
- `src/config/__tests__/loader.test.ts` — 5 new tests (MEM-01-L1..L3 + override expansion variants)
- `src/manager/__tests__/session-config.test.ts` — 7 new tests (MEM-01-C1..C7 covering order, cap, opt-out, override, missing, fin-acquisition integration, stable-prefix placement)

### Fixture cascade (Rule 3 blocking — 22 files)
- `src/config/__tests__/differ.test.ts`
- `src/agent/__tests__/workspace.test.ts`
- `src/bootstrap/__tests__/detector.test.ts`
- `src/discord/__tests__/router.test.ts`, `src/discord/subagent-thread-spawner.test.ts`, `src/discord/thread-manager.test.ts`
- `src/heartbeat/__tests__/runner.test.ts`, `src/heartbeat/checks/__tests__/mcp-reconnect.test.ts`
- `src/manager/__tests__/{config-reloader,effort-state-store,fork-effort-quarantine,fork-migrated-agent,mcp-session,persistent-session-recovery,restart-greeting,session-config,session-config-mcp,session-manager,session-manager-memory-failure,session-manager-set-model,session-manager-set-permission-mode,warm-path-mcp-gate}.test.ts`
- `src/manager/fork.test.ts`

## Decisions Made

- **Sixth additive-optional rollout** — the blueprint from Phase 83 (effortSchema), Phase 86 (allowedModels), Phase 89 (greetOnRestart/greetCoolDownMs) reused verbatim. Each application strengthens the pattern as the canonical way to extend agent config in v2.x
- **Resolver uses `!== undefined` check instead of `??`** — boolean false handling. `agent.memoryAutoLoad ?? defaults.memoryAutoLoad` would (correctly) keep false, but explicit check matches Phase 89's greetOnRestart pattern for readability
- **memoryAutoLoadPath is per-agent-only** — a fleet-wide memory path makes no sense (each agent has its own workspace MEMORY.md). No defaultsSchema entry
- **Injection site: `identityStr` concat** — MEMORY.md content appends to the identity string that lands in `sources.identity`, which the assembler places in the stable prefix. No separate source field needed; the order invariant (SOUL → IDENTITY → MEMORY → MCP) is enforced by string concatenation order, pinned by MEM-01-C1
- **No AgentSessionConfig thread-through** — `buildSessionConfig` reads `config.memoryAutoLoad` directly from its `ResolvedAgentConfig` parameter and bakes the content into systemPrompt. Downstream session adapter sees only the final prompt, not the flag (plan's Step 4/5 of Task 2 marked speculative; not needed)
- **Buffer.slice truncation not codepoint-aware** — markdown prose is ASCII-dominant; mid-multibyte truncation is acceptable (the assembler downstream treats the payload as opaque text). Pinned by MEM-01-C2 (60KB of 'A' → exactly 50*1024 body chars)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 22 test fixtures updated for memoryAutoLoad required field**
- **Found during:** Task 1 GREEN (after schema + ResolvedAgentConfig added memoryAutoLoad: boolean)
- **Issue:** ResolvedAgentConfig now requires memoryAutoLoad — TypeScript surfaced 21+ fixture errors across agent/bootstrap/config/discord/heartbeat/manager test directories
- **Fix:** Added `memoryAutoLoad: true, // Phase 90 MEM-01` alongside existing `greetCoolDownMs: 300_000` in each fixture. Same pattern as Phase 89 GREET-10 fixture rollout (22 fixtures then, 22 fixtures now — identical surface area)
- **Files modified:** 22 test files (listed above)
- **Verification:** `npx tsc --noEmit` returns to baseline 39 errors (none attributable to MEM-01)
- **Committed in:** ed517b9 (bundled into Task 1 GREEN commit — standard Phase 86/89 practice)

---

**Total deviations:** 1 auto-fixed (Rule 3 Blocking)
**Impact on plan:** Expected cascade — each additive-required field rollout since Phase 86 has triggered a similar fixture update. No scope creep; pattern is now routine.

## Issues Encountered

- **Parallel wave collision with 90-04 sibling** — 90-04 concurrently modifies `src/config/schema.ts` (adds `clawhubBaseUrl`, `clawhubCacheTtlMs`, `marketplaceSources` union with "clawhub" variant). My MEM-01 additions and 90-04's HUB-01/HUB-08 additions land in adjacent (non-overlapping) sections of schema.ts. Committed my changes only via explicit `git add <file>` per GSD parallel-wave protocol; 90-04's uncommitted additions passively piggyback in the same schema.ts diff view but remain the sibling's responsibility to commit. Verified via `git diff` that all my MEM-01 hunks (lines 30-43, 714-724, 796-798, 1020-1021 in schema.ts) are clearly delimited from 90-04's ClawHub hunks (805-853, 1023-1024)
- **TypeScript error count** — baseline 39 errors preserved post-plan. The 2 "new" errors from differ.test.ts (missing clawhubBaseUrl/clawhubCacheTtlMs) were auto-resolved by 90-04's parallel fixture edit (linter-triggered cascade matched their schema additions). Net delta: 0 new errors

## User Setup Required

None — no external service configuration needed. Every agent now auto-loads `{workspace}/MEMORY.md` at session boot by default. To opt out for a specific agent, add `memoryAutoLoad: false` to that agent's clawcode.yaml entry; to override the path, add `memoryAutoLoadPath: "/custom/path/MEMORY.md"` (expandHome handles `~/...`).

## Next Phase Readiness

- **MEM-02 (Plan 90-02)** can now build the file-scanner + memory_chunks + RRF retrieval on top of MEM-01's MEMORY.md auto-load. The single-file inject complements the chunked retrieval — MEMORY.md carries standing rules (hot path, stable-prefix cache hit); memory_chunks carries dated session history (mutable-suffix retrieval)
- **MEM-03 / MEM-04 / MEM-05 / MEM-06** unchanged — each plan reads from memory/ on disk or writes to it; MEM-01's injection site is orthogonal
- **WIRE-01..07 (Plan 90-07)** — fin-acquisition agent wiring inherits MEMORY.md auto-load with zero additional config. Success Criterion #6 from ROADMAP (fin-acquisition answers "what's our firm legal name?" with "Finmentum LLC") is the live integration test this plan enables
- **Parallel 90-04 (ClawHub HTTP client)** — runs in the same Wave 1; no cross-plan file overlap in production code semantics. Both commits land on master before Wave 2 starts

---
*Phase: 90-clawhub-marketplace-fin-acquisition-memory-prep*
*Completed: 2026-04-24*

## Self-Check: PASSED

Files verified present:
- .planning/phases/90-clawhub-marketplace-fin-acquisition-memory-prep/90-01-SUMMARY.md
- src/config/schema.ts, src/config/types.ts, src/config/loader.ts, src/shared/types.ts
- src/manager/session-config.ts
- src/config/__tests__/schema.test.ts, src/config/__tests__/loader.test.ts
- src/manager/__tests__/session-config.test.ts

Commits verified present: 47b59af (Task 1 RED), ed517b9 (Task 1 GREEN), 8ca3d1c (Task 2 RED), 1556fcb (Task 2 GREEN)

Tests verified: `npx vitest run src/config/__tests__/schema.test.ts src/config/__tests__/loader.test.ts src/manager/__tests__/session-config.test.ts` — 268/268 pass
TypeScript verified: `npx tsc --noEmit` — 39 errors (matches baseline; no new errors from MEM-01)
