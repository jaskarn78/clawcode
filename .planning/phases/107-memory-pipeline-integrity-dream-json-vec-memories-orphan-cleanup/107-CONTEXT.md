# Phase 107: Memory pipeline integrity — dream JSON output enforcement + vec_memories orphan cleanup — Context

**Gathered:** 2026-05-01
**Status:** Ready for planning
**Mode:** Auto-generated (small infrastructure phase — bundles 999.16 + 999.17 backlog items, both daemon-side memory integrity)

<domain>
## Phase Boundary

Two unrelated bugs in the dream/memory pipeline reported by Admin Clawdy 2026-05-01. Both daemon-side data integrity. Bundle since they share memory-subsystem touch points and one deploy is cheaper than two.

### Pillar A — Dream pass JSON output enforcement (DREAM-OUT-01..04)

**Symptom (verified 2026-05-01 by Admin Clawdy after DB cleanup):**
```
dream-result-schema-validation-failed:
  JSON parse failed (Unexpected token 'N', "Noted — co"... is not valid JSON)
```

The dream-pass LLM (Haiku, per Phase 95 design) returned chat-style prose `"Noted — co..."` instead of the structured JSON the dream pipeline expects. `JSON.parse()` choked on the first character. Dream pass aborted; long-term memory consolidation skipped this cycle.

**Background (Phase 95):** dream pass uses Haiku to scan recent memory chunks + suggest wikilinks/promotions/summaries as JSON. Phase 95 commit `509ff03` already tightened the prompt with explicit rules ("FIRST character MUST be `{`", "NO markdown fences", "NO narrative preamble"). Haiku is still ignoring them.

**Root cause hypotheses (planner picks):**
1. **Prompt rules aren't strong enough** — model still slipping into chat-style. Need a fallback contract: "if you cannot produce valid JSON, output a no-op JSON envelope, NEVER prose."
2. **No structured-output mode used** — Anthropic SDK supports forced JSON output for some models. Switch to that if available.
3. **No recovery path** — current code throws on parse failure, which propagates up and aborts the dream cycle. Need graceful degradation: log warn + treat as no-op result.

**Fix scope:**

**DREAM-OUT-01 — Strengthen prompt with fallback contract.** Update `src/manager/dream-prompt-builder.ts` (or wherever dream system prompt lives). Add to existing rules:
```
If you cannot produce a valid JSON object for any reason (input unclear, no patterns found, error condition), output this exact fallback:
{"newWikilinks":[],"promotionCandidates":[],"summary":"","errors":["<short reason>"]}
NEVER output prose, narrative, "Noted —", "I'll do my best", or any other chat-style preamble.
The first character MUST be `{`. The last character MUST be `}`.
```

**DREAM-OUT-02 — Switch to structured-output mode if available.** Anthropic API offers `response_format` parameter for some calls. Investigate whether the SDK exposes this for dream-pass. If yes, wire it with the dream-result zod schema. Stronger guarantee than prompt rules. Confirm SDK v0.2.x support; if not, document as deferred and rely on DREAM-OUT-01 alone.

**DREAM-OUT-03 — Graceful recovery on parse failure.** In `src/manager/dream-pass.ts` (or wherever JSON.parse is called), wrap with try/catch. On failure:
- Log warn with `{ component: "dream-pass", action: "parse-failed", responsePrefix: response.slice(0,80), msg: "dream pass returned non-JSON; treating as no-op" }`
- Return a no-op result `{ newWikilinks: [], promotionCandidates: [], summary: "", errors: [...] }`
- Don't throw, don't abort the dream cycle, don't crash the daemon

**DREAM-OUT-04 — Vitest tests.** New test file `src/manager/__tests__/dream-pass-json-recovery.test.ts`:
- LLM returns "Noted — couldn't analyze" → dream pass produces no-op result, doesn't throw, warn logged with action: "parse-failed"
- LLM returns valid JSON → result parsed correctly, no warn
- LLM returns the fallback envelope → treated as legitimate no-op (errors array surfaces the reason)
- LLM returns malformed JSON (e.g. trailing comma) → no-op + warn

### Pillar B — vec_memories orphan cleanup on memory delete (VEC-CLEAN-01..04)

**Symptom (verified 2026-05-01 by Admin Clawdy after manual DB cleanup):** When a row in `memories` table is deleted, the corresponding embedding row in `vec_memories` (sqlite-vec virtual table) is NOT cascaded. Orphan embeddings accumulate, bloat the index, and can return phantom matches in semantic search.

Admin Clawdy patched the immediate symptom (cleaned out current orphans manually). Root cause persists: any future memory delete creates a new orphan.

**Why FK doesn't work:** sqlite-vec virtual tables don't support FK constraints — limitation of the SQLite vtab interface. The `memories` and `vec_memories` tables are structurally decoupled. Application code must explicitly cascade.

**Fix scope:**

**VEC-CLEAN-01 — Audit all `memories` delete paths.** In `src/memory/store.ts` (or wherever MemoryStore lives). Find every method that issues a `DELETE FROM memories`. Likely:
- `deleteById(id)`
- `deleteByTag(tag)`
- `deleteOlderThan(timestamp)`
- Possibly `clear()` for tests
Each must paired-delete from `vec_memories` matching by rowid.

**VEC-CLEAN-02 — Atomic transaction wrapping.** Both deletes (memories + vec_memories) inside a single `db.transaction(() => { ... })`. Either both happen or neither — orphans are exactly the "deleted from memories but not vec_memories" state we're preventing.

**VEC-CLEAN-03 — Cleanup CLI subcommand.** New `clawcode memory cleanup-orphans [-a <agent>]`. Scans `vec_memories` for rowids not present in `memories`, deletes them. Operator-runnable for one-time recovery + can be auto-invoked by cron (or daemon's existing maintenance loop) for hygiene. Output: `Removed N orphan vec_memories entries (was M total).`

**VEC-CLEAN-04 — Vitest tests.** New `src/memory/__tests__/store-orphan-cleanup.test.ts`:
- `deleteById` cascade: insert memory + embedding, delete memory by id, assert vec_memories has no row for that rowid
- `deleteByTag` cascade: same pattern with multiple memories sharing a tag
- `deleteOlderThan` cascade: same with timestamp filter
- `cleanupOrphans()` standalone: insert memory + embedding, manually delete from memories only (simulating pre-fix state), call cleanupOrphans, assert vec_memories cleaned
- Atomicity: simulate failure mid-delete, assert no partial state

### Out of scope

- **Migrating away from sqlite-vec to a real FK-supporting vector store** (e.g. pgvector). Architectural change; not the point of this phase.
- **Vec_memories index rebuild / VACUUM** for performance. Separate concern (orthogonal optimization).
- **Memory consolidation pipeline rework** — Phase 95 already designed this. We're only fixing the JSON output bug + the orphan cleanup, not redesigning the dream pass.
- **Dream pass model swap** (e.g. Haiku → Sonnet). Bigger change. Test prompt fix first.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion. Use established conventions:

- **Phase 95 dream-pass infrastructure** — `dream-prompt-builder.ts`, `dream-pass.ts`, dream-result zod schema. Existing test scaffolding likely covers most regression cases.
- **Phase 999.6 atomic write idiom** — though here we use `db.transaction()` not file-system atomic. Same intent.
- **Phase 106 STALL-02 telemetry pattern** — structured pino warn log with parseable fields.

### Determinism preferences

**DREAM:**
- Fallback envelope text is canonical: `{"newWikilinks":[],"promotionCandidates":[],"summary":"","errors":["<reason>"]}`. Tests assert this exact shape on prose-input.
- Recovery log shape: `{ "level": 40, "component": "dream-pass", "action": "parse-failed", "responsePrefix": <80 chars>, "agent": "<agent name>", "msg": "..." }`. Operator-greppable.
- Don't include the FULL non-JSON response in logs (could be 1000+ chars of prose). Cap at 80 chars in `responsePrefix` field.
- DREAM-OUT-02 is investigation: if SDK doesn't support structured-output for the model used, the planner notes it as deferred and proceeds with DREAM-OUT-01+03 alone (which is sufficient for fault tolerance).

**VEC:**
- ALL existing memory-delete callsites updated. No new "delete-without-cascade" path.
- `cleanupOrphans` is idempotent — running twice is safe (second run finds 0 orphans).
- CLI subcommand: `clawcode memory cleanup-orphans` (matches the existing `memory` subcommand namespace from earlier phases). Optional `-a <agent>` to scope to one agent's memory db.
- Auto-invocation: NOT in this phase. cleanupOrphans is operator-runnable; auto-trigger is a separate decision (e.g. on agent-start? on heartbeat? after N deletes?).

### Non-negotiables

- **Dream pass NEVER crashes the daemon on parse failure.** Recovery path required.
- **Memory deletes ALWAYS cascade.** No leaky paths.
- **Atomic transactions** — partial state forbidden.
- **All existing tests stay green** (Phase 95, 99-mdrop, 999.6, 999.12, 999.14, 999.15, 106, etc.).
- **No new npm deps.**
- **Deploy gate per overnight rule** (channels silent ≥30 min on non-bot messageCreate).

</decisions>

<code_context>
## Existing Code Insights

Detailed exploration deferred to plan-phase RESEARCH.md. Anchors:

### DREAM
- `src/manager/dream-prompt-builder.ts` — system prompt for dream pass. Phase 95 + commit `509ff03` already tightened.
- `src/manager/dream-pass.ts` (or wherever) — orchestrates the LLM call + JSON.parse + schema validation.
- `src/manager/dream-result-schema.ts` (or similar) — zod schema for the structured output.
- `src/manager/__tests__/dream-prompt-builder.test.ts` — existing test scaffolding.

### VEC
- `src/memory/store.ts` — `MemoryStore` class with delete methods. Likely uses `better-sqlite3` + sqlite-vec extension.
- `src/memory/types.ts` — types for memory entries + embeddings.
- `src/memory/__tests__/store.test.ts` — existing scaffolding.
- `src/cli/commands/memory.ts` (if exists) — CLI subcommand pattern. Otherwise create new file.

### Reusable Patterns
- Phase 999.15 CLI command pattern (`clawcode mcp-tracker`)
- Phase 999.6 atomic write semantics (different mechanism but same intent)
- Phase 106 telemetry log style (structured pino with operator-greppable fields)

### Integration Points
- DREAM: dream-pass.ts (parse + recover), dream-prompt-builder.ts (prompt strengthening)
- VEC: memory/store.ts (cascade), cli/commands/memory.ts (subcommand), daemon.ts (CLI registration)
- Tests: per existing per-module convention

</code_context>

<specifics>
## Specific Ideas

### Admin Clawdy's exact report (preserved)

```
Good news + a separate finding:

The DB fix is confirmed. Dream pass executed without any FK or memory-store errors — proves the cleanup worked.

Bad news: Dream pass failed for a different, pre-existing reason:
  dream-result-schema-validation-failed:
    JSON parse failed (Unexpected token 'N', "Noted — co"... is not valid JSON)
The LLM returned a chat-style "Noted — …" response instead of the structured JSON schema the dream pipeline expects. This is a prompt/schema bug in the daemon's dream prompt, not anything to do with the linker. The model is ignoring the structured-output contract.

Recommend filing for projects:
1. Dream prompt isn't enforcing JSON output → tighten the prompt or use the LLM's structured-output mode.
2. vec_memories doesn't get cleaned when memories are deleted → root-cause fix for the orphan issue I just patched (so it doesn't recur).
```

### Verification commands (post-deploy)

```bash
# 1. DREAM: Force a dream pass on an agent (or wait for natural cron). Verify no parse-failed warn logs IF the model behaves; if it returns prose, verify warn fires + no-op result.
ssh clawdy 'journalctl -u clawcode --since "10 min ago" --no-pager | grep -E "dream-pass|parse-failed"'

# 2. VEC: Insert memory, delete it, count vec_memories rows for that rowid. Should be 0.
ssh clawdy 'sudo -u clawcode bash -lc "
  cd /home/clawcode/.clawcode/agents/research/memory
  sqlite3 memories.db \"SELECT COUNT(*) FROM vec_memories vm WHERE vm.rowid NOT IN (SELECT rowid FROM memories);\"
"'
# Expect: 0 (no orphans). Currently > 0 (Admin Clawdy's pre-fix state).

# 3. CLI cleanup utility:
ssh clawdy 'sudo -u clawcode node /opt/clawcode/dist/cli/index.js memory cleanup-orphans'
# Expect: "Removed N orphan vec_memories entries" or "No orphans found"
```

</specifics>

<deferred>
## Deferred Ideas

- Auto-invocation of `cleanupOrphans` on a schedule (cron / heartbeat / etc.). Manual + explicit-CLI-only for now.
- Migration to FK-supporting vector store. Architectural change; out of scope.
- Vec index rebuild / VACUUM. Performance optimization; orthogonal.
- Dream pass model upgrade (Haiku → Sonnet). Cost/perf tradeoff; test prompt fix first.
- Schema migration for existing `vec_memories` orphans (Admin Clawdy's manual patch was sufficient; but if more accumulated since, the cleanup CLI handles it).

</deferred>
