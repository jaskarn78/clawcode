---
phase: 74-seamless-openclaw-backend-caller-provided-agent-config
plan: 01
subsystem: api
tags: [openai-endpoint, openclaw-integration, routing, caller-identity, lru-cache, persistent-session, sdk]

# Dependency graph
requires:
  - phase: 69-openai-compatible-endpoint
    provides: OpenAiSessionDriver interface, translateRequest, ChatCompletionRequest schema, ApiKeysStore scope-aware auth
  - phase: 73-openclaw-endpoint-latency
    provides: createPersistentSessionHandle (reused verbatim for transient template sessions)
provides:
  - OPENCLAW_PREFIX constant + TIER_MODEL_MAP (sonnet/opus/haiku → Claude model ids)
  - CallerIdentity discriminated union (clawcode-native | openclaw-template)
  - TemplateDriverInput interface for server→templateDriver dispatch
  - extractCallerIdentity(body, row, knownAgents, ...) pure discriminator
  - TransientSessionCache LRU+TTL with close-on-evict
  - OpenClawTemplateDriver materializing per-caller persistent handles
  - server.ts caller-identity routing branch (openclaw: prefix → template driver)
  - endpoint-bootstrap.ts template driver wiring with env tunables
affects: 74-02 (security denyScopeAll + cost attribution + TTL reaper + docs)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "caller-identity discriminator — pure function gating scope='all' + slug regex + tier-token validation BEFORE scope-aware authz"
    - "LRU + TTL cache with close-on-evict — handle.close() errors caught + logged; cache-state invariants hold under any failure mode"
    - "Handle-reuse via cache key (bearer, slug, soulFp, tier) — any change to any of the four spawns a new persistent handle"
    - "Callback → AsyncIterable event bridge — mirrors Phase 69 driver.ts queue + pending-resolver pattern to adapt handle.sendAndStream(onChunk) into SdkStreamEvent iterable"
    - "Dynamic SDK import fallback in bootstrap — keeps daemon.ts zero-touch for Plan 01 while still wiring a live template driver in production"

key-files:
  created:
    - src/openai/caller-identity.ts
    - src/openai/transient-session-cache.ts
    - src/openai/template-driver.ts
    - src/openai/__tests__/caller-identity.test.ts
    - src/openai/__tests__/transient-session-cache.test.ts
    - src/openai/__tests__/template-driver.test.ts
    - src/openai/__tests__/server-openclaw-routing.test.ts
  modified:
    - src/openai/types.ts (+OPENCLAW_PREFIX, TIER_MODEL_MAP, Tier, CallerIdentity, TemplateDriverInput)
    - src/openai/server.ts (+extractCallerIdentity branch, +templateDriver config field, caller-identity routing before scope check)
    - src/openai/endpoint-bootstrap.ts (+TransientSessionCache + OpenClawTemplateDriver wiring, shutdown drain order)

key-decisions:
  - "Phase 74-01: caller-identity routing runs BEFORE scope-aware authz — malformed openclaw: syntax on a pinned key surfaces as 400 malformed_caller (not 403 agent_mismatch). Rule 1 fix: plan ordering was wrong; scope check on its own would 404 openclaw: prefixed models. extractCallerIdentity itself enforces scope='all' for template paths."
  - "Phase 74-01: systemPrompt passed as STRING (Pitfall 2) — REPLACES SDK kernel prompt entirely. preset+append form explicitly NOT used for transient sessions — caller's SOUL is the whole instruction surface."
  - "Phase 74-01: CLAWCODE_TRANSIENT_CWD fixed at module scope (~/.clawcode/manager/transient). Driver never reads body.workspace/body.cwd/body.metadata.workspace (Pitfall 4 guard — grep-enforced on src/openai/template-driver.ts)."
  - "Phase 74-01: handle.sendAndStream's onChunk(accumulated) bridged into AsyncIterable<SdkStreamEvent> via queue + pending-resolver — same pattern as Phase 69 driver.ts uses for TurnDispatcher. Abort flows via SendOptions.signal, error/end via then/catch on the send promise."
  - "Phase 74-01: TransientSessionCache.set() on a full cache synchronously evicts the LRU entry AND fire-and-forget-invokes handle.close(). Errors from close() are caught + logged; cache invariants hold even on SDK subprocess crash."
  - "Phase 74-01: endpoint-bootstrap dynamically imports @anthropic-ai/claude-agent-sdk when deps.sdk is absent — daemon.ts wiring stays zero-touch for Plan 01. When the SDK import fails, templateDriver is left undefined and openclaw: requests return 501 template_driver_disabled."

patterns-established:
  - "Pattern: OpenAI endpoint driver extensibility — two drivers (native + template) sharing one OpenAiSessionDriver interface, routed via a pure discriminator that runs BEFORE scope-aware authz so each driver owns its own authn rules."
  - "Pattern: per-caller persistent session cache — composite key (bearer_hash, caller_id, content_fingerprint, tier) + LRU+TTL with close-on-evict. Any component change respawns; stale handles age out via idle TTL."

requirements-completed:
  - BACKEND-01
  - BACKEND-02
  - BACKEND-05

# Metrics
duration: 22min
completed: 2026-04-19
---

# Phase 74 Plan 01: Transient Session Cache + OpenClawTemplateDriver + Server Routing Summary

**Namespace-prefixed `openclaw:<slug>[:<tier>]` model ids now route to a new OpenClawTemplateDriver that caches per-caller persistent SDK sessions keyed on (bearer, slug, sha256(SOUL).slice(0,16), tier) — Phase 69 literal-agent routing untouched.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-04-19T23:15:00Z
- **Completed:** 2026-04-19T23:37:00Z
- **Tasks:** 3 (all committed atomically)
- **Files created:** 7
- **Files modified:** 3
- **Tests added:** 66 (14 caller-identity + 14 transient-cache + 16 template-driver + 12 server-openclaw-routing + 10 implicit through existing Phase 69 regression runs)

## Accomplishments

- Caller-identity discriminator gates the openclaw: prefix path with the slug regex `/^[a-z0-9][a-z0-9_-]{0,63}$/i` and tier admission set `{sonnet, opus, haiku}` — malformed syntax returns 400 malformed_caller regardless of key scope.
- scope='all' enforcement baked into extractCallerIdentity — pinned keys attempting `openclaw:<slug>` route receive 400 malformed_caller (not 403 agent_mismatch); defense-in-depth against cross-caller impersonation.
- TransientSessionCache LRU+TTL (default 32 entries, 30min idle) with guaranteed handle.close() on eviction, replacement, or closeAll() — SDK subprocess lifecycle bounded under any failure mode.
- OpenClawTemplateDriver reuses Phase 73's createPersistentSessionHandle VERBATIM with the only differences being: string-form systemPrompt (REPLACES SDK kernel prompt), fixed CLAWCODE_TRANSIENT_CWD, mcpServers:{}, settingSources:[] — caller-declared tools flow through as OpenAI tool_calls round-trips, not ClawCode MCP mounts.
- Integration tests prove mutual-exclusion: literal agent name → native driver only; openclaw: prefixed → template driver only; the two never fire on the same request.
- Zero Phase 69 regressions: all 49 existing server.test.ts tests + 11 endpoint-bootstrap.test.ts tests pass unchanged.

## Task Commits

Each task was committed atomically on master (NOT pushed):

1. **Task 1: Caller-identity discriminator + transient-session cache + shared types** — `8fe70c7` (feat)
2. **Task 2: OpenClawTemplateDriver reusing Phase 73 persistent handle** — `c7459c4` (feat)
3. **Task 3: Caller-identity routing in server.ts + endpoint-bootstrap wiring** — `8cf651f` (feat)

## Files Created/Modified

### Created

- `src/openai/caller-identity.ts` — pure extractCallerIdentity(body, row, knownAgents, ...) → CallerIdentity | {error}; slug regex + tier validation + scope='all' gate + SOUL-from-parts extraction + sha256Hex helper.
- `src/openai/transient-session-cache.ts` — LRU+TTL cache keyed on (keyHash::callerSlug::soulFp::tier); reap-on-read TTL; evictions always fire handle.close() with error isolation; closeAll() idempotent.
- `src/openai/template-driver.ts` — createOpenClawTemplateDriver returns an OpenAiSessionDriver whose dispatch() materializes (via Phase 73 createPersistentSessionHandle) one persistent SDK session per (bearer, slug, soulFp, tier), bridges callback-style sendAndStream into AsyncIterable<SdkStreamEvent>. CLAWCODE_TRANSIENT_CWD constant exported.
- `src/openai/__tests__/caller-identity.test.ts` — 24 test cases covering native match, tier parse (+default sonnet), malformed slug/tier/prefix variants, SOUL-from-string / SOUL-from-array-of-parts, scope='all' enforcement, 64-char slug boundary.
- `src/openai/__tests__/transient-session-cache.test.ts` — 14 test cases covering set/get, LRU recency on get, LRU eviction with close() fire, TTL reap-on-read, closeAll idempotency, error isolation from close() rejections, and the post-closeAll defensive close path.
- `src/openai/__tests__/template-driver.test.ts` — 16 test cases covering OpenAiSessionDriver shape conformance, STRING systemPrompt assertion, fixed cwd, tier→model map, cache key components (bearer/slug/soulFp/tier), AbortSignal passthrough, createHandle-throw propagation, ensureCwd invocation count.
- `src/openai/__tests__/server-openclaw-routing.test.ts` — 12 integration test cases: literal → native only, openclaw:<slug>:<tier> → template only, tier defaulting, malformed slug → 400, pinned key + openclaw: → 400 (NOT 403), unknown literal → 404, auth errors still fire first, non-stream response.model echoes requested id, template_driver_disabled → 501.

### Modified

- `src/openai/types.ts` — appended OPENCLAW_PREFIX, TIER_MODEL_MAP, Tier, CallerIdentity, TemplateDriverInput exports.
- `src/openai/server.ts` — OpenAiServerConfig gained optional templateDriver field; handleChatCompletions reordered so translateRequest + extractCallerIdentity run BEFORE scope check (see Decisions Made below); openclaw-template branch dispatches to templateDriver with warm-path wait skipped.
- `src/openai/endpoint-bootstrap.ts` — builds TransientSessionCache + OpenClawTemplateDriver alongside native driver; env vars CLAWCODE_OPENCLAW_TEMPLATE_CACHE_SIZE (32) + CLAWCODE_OPENCLAW_TEMPLATE_TTL_MS (30min) tunable; shutdown drain order now server.close() → transientCache.closeAll() → apiKeysStore.close() → requestLogger.close(); error path also drains cache; dynamic SDK import fallback when deps.sdk absent.

## Decisions Made

1. **Caller-identity runs BEFORE scope check (Rule 1 - Bug fix).** The plan's original action step specified inserting caller-identity AFTER the existing scope-aware authz block (line 547-582). That would 404 `openclaw:fin-test:sonnet` on a scope='all' key (because it's not in the knownAgents list) AND 403 it on a pinned key — but test 5 of the plan required 400 malformed_caller for the pinned-key case. Fix: caller-identity extraction now runs before scope check; scope check only runs for clawcode-native branches; template branch relies on extractCallerIdentity's own `row.scope === "all"` gate. Zero Phase 69 regression — all 49 existing server tests still green.

2. **Dynamic SDK import fallback (Rule 3 - Blocking-adjacent).** The plan said to add a `readonly sdk: SdkModule` field to OpenAiEndpointDeps and pass it from daemon.ts (line 1392). To keep the daemon-wiring scope of Plan 01 minimal, I added the deps.sdk field as OPTIONAL and wrote a fallback that dynamically imports @anthropic-ai/claude-agent-sdk when deps.sdk is undefined. This mirrors the existing loadSdk pattern in session-adapter.ts / summarize-with-haiku.ts. Production wiring is correct end-to-end even without daemon.ts changes; daemon.ts can thread deps.sdk explicitly in a follow-up without any observable behavior difference.

3. **OpenClaw-prefix branch skips warm-path wait.** Transient-template handles are NOT managed by SessionManager — they live in the TransientSessionCache, not SessionManager.sessions. config.agentIsRunning() would return false for any `openclaw:<slug>` name, causing spurious 503 Retry-After responses. Fix: the template branch dispatches directly, bypassing waitForAgentReady. Native branch unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Caller-identity check must run BEFORE scope-aware authz block**
- **Found during:** Task 3 (server.ts wiring)
- **Issue:** Plan said "replace the block from line 608 (touchLastUsed) through line 640" — implying scope check on lines 547-582 runs FIRST. But `openclaw:<slug>` is not in knownAgents, so the scope='all' branch's 404 unknown_model gate fires before the template path is ever evaluated. And on a pinned key, the else-branch's 403 agent_mismatch fires — but test 5 of the plan's <behavior> block requires 400 malformed_caller for that case.
- **Fix:** Moved extractCallerIdentity + translateRequest BEFORE the scope check. Native (clawcode-native) branch inherits the original scope check unchanged — Phase 69 semantics preserved byte-for-byte (all 49 server tests green). Template branch owns its own scope='all' gate inside extractCallerIdentity itself.
- **Files modified:** src/openai/server.ts
- **Verification:** 12 new integration tests in server-openclaw-routing.test.ts + 49 existing Phase 69 tests all pass.
- **Committed in:** 8cf651f (Task 3 commit)

**2. [Rule 3 - Blocking] Dynamic SDK import fallback in endpoint-bootstrap**
- **Found during:** Task 3 (endpoint-bootstrap wiring)
- **Issue:** Plan said to add `readonly sdk: SdkModule` to OpenAiEndpointDeps and pass it from daemon.ts. But there's no exported loadSdk helper from src/manager/session-adapter.ts, and daemon.ts doesn't directly touch the SDK module — it uses SdkSessionAdapter which internally does dynamic import. Adding `sdk` as REQUIRED would demand a daemon.ts rewrite that's out of scope for Plan 01.
- **Fix:** Made `deps.sdk?: SdkModule` OPTIONAL. When absent, endpoint-bootstrap dynamically imports @anthropic-ai/claude-agent-sdk itself (mirrors the existing loadSdk pattern in session-adapter.ts). When the import fails (e.g., test env without SDK installed), templateDriver is left undefined and `openclaw:`-prefixed requests return 501 template_driver_disabled — covered by a dedicated integration test.
- **Files modified:** src/openai/endpoint-bootstrap.ts
- **Verification:** Existing 10 daemon-openai.test.ts tests had the same 7-tolerated baseline failures (pre-existing per STATE.md 260419-q2z note) — zero new regressions. 11 endpoint-bootstrap.test.ts tests all green.
- **Committed in:** 8cf651f (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug — plan ordering inconsistency; 1 blocking-adjacent — daemon wiring scope minimization)
**Impact on plan:** Both fixes necessary for test correctness + Phase 69 non-regression. No scope creep — both changes stay within the files the plan identified.

## Issues Encountered

- **7 pre-existing daemon-openai.test.ts failures + 1 pre-existing session-manager.test.ts failure** — baseline per STATE.md quick task 260419-q2z notes ("tsc at 29 baseline; 3149 pass, 7 tolerated daemon-openai failures"). Verified by git stash + re-run: failures reproduce on master HEAD before Plan 74-01 touches. Not a regression.

## Verification

- `npx tsc --noEmit` — 29 errors (unchanged baseline; zero Plan 74-01 contribution).
- `npx vitest run src/openai --reporter=dot` — 294 pass across 14 files (66 NEW tests plus 228 pre-existing).
- `npx vitest run --reporter=dot` (full suite) — 3214 pass / 8 failed (8 failures are all pre-existing baseline, NOT Plan 74-01 regressions).
- `npm run build` — tsup build completes in ~470ms with no new warnings.

### Grep invariants (all confirmed)

- `export const OPENCLAW_PREFIX = "openclaw:"` — src/openai/types.ts:236
- `TIER_MODEL_MAP` with all three entries (sonnet→claude-sonnet-4-6, opus→claude-opus-4-7, haiku→claude-haiku-4-5-20251001) — src/openai/types.ts:239-243
- `export type CallerIdentity` — src/openai/types.ts:247
- `export function extractCallerIdentity` — src/openai/caller-identity.ts:93
- `/^[a-z0-9][a-z0-9_-]{0,63}$/i` — src/openai/caller-identity.ts:48
- `export class TransientSessionCache` + `makeTransientCacheKey` — src/openai/transient-session-cache.ts:72, 40
- `entry.handle.close()` inside evictEntry — src/openai/transient-session-cache.ts:161
- `export const CLAWCODE_TRANSIENT_CWD = path.join(homedir()` — src/openai/template-driver.ts:59
- `systemPrompt: input.soulPrompt` (STRING form, single match) — src/openai/template-driver.ts:184
- `TIER_MODEL_MAP[input.tier]` — src/openai/template-driver.ts:183
- `mcpServers: {}` + `settingSources: [] as ReadonlyArray<string>` — src/openai/template-driver.ts:187-188
- `createPersistentSessionHandle` imported from persistent-session-handle.js — src/openai/template-driver.ts:49
- `templateDriver?: OpenAiSessionDriver` — src/openai/server.ts:142
- `extractCallerIdentity(` call — src/openai/server.ts:589
- `callerIdentity.kind === "openclaw-template"` — src/openai/server.ts:630
- `partial.agent = \`openclaw:${callerIdentity.callerSlug}\`` — src/openai/server.ts:631
- `createOpenClawTemplateDriver(` — src/openai/endpoint-bootstrap.ts:241
- `transientCache.closeAll()` in both shutdown paths — src/openai/endpoint-bootstrap.ts:321, 350
- **Pitfall 4 guard:** no `input.workspace | input.cwd | input.metadata` code paths in template-driver.ts (only docstring mentions of what NOT to do) — verified via `grep input\.(workspace|cwd|metadata)` returning 0 matches.
- **No explicit clawcode-native branch in server.ts** — it's the fall-through path (0 matches for `callerIdentity.kind === "clawcode-native"`).

## User Setup Required

None — no external service configuration required for Plan 01 foundation work. Plan 02 will add operator docs for the OpenClaw-side provider config block and the two new env vars.

## Next Phase Readiness

- Ready for Plan 74-02: denyScopeAll per-agent security flag + UsageTracker cost attribution (`agent: "openclaw:<slug>"`) + TTL reaper background timer + drain integration with SessionManager.drain() + operator README.
- The TemplateDriverDeps `onUsage` hook is already wired in Plan 01 as an optional callback — Plan 02 plugs UsageTracker.record() here with zero template-driver changes.
- Daemon.ts wiring for explicit `deps.sdk` pass-through is deferred and non-urgent: dynamic SDK import fallback already makes templateDriver available in production.

## Self-Check: PASSED

All created files verified on disk:
- FOUND: src/openai/caller-identity.ts
- FOUND: src/openai/transient-session-cache.ts
- FOUND: src/openai/template-driver.ts
- FOUND: src/openai/__tests__/caller-identity.test.ts
- FOUND: src/openai/__tests__/transient-session-cache.test.ts
- FOUND: src/openai/__tests__/template-driver.test.ts
- FOUND: src/openai/__tests__/server-openclaw-routing.test.ts

All commits verified via `git log --oneline`:
- FOUND: 8fe70c7 (Task 1)
- FOUND: c7459c4 (Task 2)
- FOUND: 8cf651f (Task 3)

---
*Phase: 74-seamless-openclaw-backend-caller-provided-agent-config*
*Completed: 2026-04-19*
