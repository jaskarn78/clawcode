# Phase 107: Memory pipeline integrity — dream JSON output enforcement + vec_memories orphan cleanup — Research

**Researched:** 2026-05-01
**Domain:** Daemon-side memory subsystem — LLM structured output handling + SQLite/sqlite-vec data integrity
**Confidence:** HIGH

## Summary

Two independent daemon-side bugs share one phase. **Pillar A** (dream JSON enforcement) is a prompt+recovery hardening problem: the existing `runDreamPass` already returns `{kind:"failed"}` on parse failures (does NOT crash), but the operator logs surface as `error`-level when the LLM produces prose, polluting alerting. The SDK exposes `outputFormat: { type: "json_schema", schema }` (sdk.d.ts:1244, JsonSchemaOutputFormat at sdk.d.ts:694), but the production dream pass goes through the agent's persistent shared `sdk.query` handle (session-adapter.ts:653) where `outputFormat` is set ONCE at session creation — making per-turn JSON-schema mode architecturally non-trivial without forking the dream pass to its own SDK session. **Pillar B** (vec_memories orphans) is a SQLite cascade auditing problem: `MemoryStore.delete()` (store.ts:312) IS atomic+cascading already, but historical orphans exist in production from CHECK-constraint table-recreation migrations (store.ts:674-691, 736-754) that drop+recreate `memories` without touching `vec_memories`. Pre-existing orphans require a one-shot cleanup CLI; future orphan paths must be prevented by ensuring every `memories` delete site is audited.

**Primary recommendation:** Prompt-fallback (DREAM-OUT-01) + dedicated parse-failure warn-level recovery (DREAM-OUT-03) ship together as the value-delivery path. DREAM-OUT-02 (SDK structured output) is investigation-only — recommend deferring to a follow-up phase since wiring `outputFormat` per-turn through the persistent-handle path requires a new dispatch surface. For Pillar B, the cascade audit is one-line work (only `MemoryStore.delete()` is the mutation surface today; `archiveOldEpisodes` + `cleanupColdArchive` already correctly cascade or don't need to). Real work is the cleanup CLI + IPC method + tests for atomicity and idempotency.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
**Claude's Discretion** — All implementation choices at Claude's discretion. Use established conventions:
- Phase 95 dream-pass infrastructure — `dream-prompt-builder.ts`, `dream-pass.ts`, dream-result zod schema. Existing test scaffolding likely covers most regression cases.
- Phase 999.6 atomic write idiom — though here we use `db.transaction()` not file-system atomic. Same intent.
- Phase 106 STALL-02 telemetry pattern — structured pino warn log with parseable fields.

**Determinism preferences (DREAM):**
- Fallback envelope text is canonical: `{"newWikilinks":[],"promotionCandidates":[],"summary":"","errors":["<reason>"]}`. Tests assert this exact shape on prose-input.
- Recovery log shape: `{ "level": 40, "component": "dream-pass", "action": "parse-failed", "responsePrefix": <80 chars>, "agent": "<agent name>", "msg": "..." }`. Operator-greppable.
- Don't include the FULL non-JSON response in logs (could be 1000+ chars of prose). Cap at 80 chars in `responsePrefix` field.
- DREAM-OUT-02 is investigation: if SDK doesn't support structured-output for the model used, the planner notes it as deferred and proceeds with DREAM-OUT-01+03 alone (which is sufficient for fault tolerance).

**Determinism preferences (VEC):**
- ALL existing memory-delete callsites updated. No new "delete-without-cascade" path.
- `cleanupOrphans` is idempotent — running twice is safe (second run finds 0 orphans).
- CLI subcommand: `clawcode memory cleanup-orphans` (matches existing `memory` namespace). Optional `-a <agent>` to scope to one agent's memory db.
- Auto-invocation: NOT in this phase. Operator-runnable; auto-trigger is a separate decision.

**Non-negotiables:**
- Dream pass NEVER crashes the daemon on parse failure. Recovery path required.
- Memory deletes ALWAYS cascade. No leaky paths.
- Atomic transactions — partial state forbidden.
- All existing tests stay green (Phase 95, 99-mdrop, 999.6, 999.12, 999.14, 999.15, 106).
- No new npm deps.
- Deploy gate per overnight rule (channels silent ≥30 min on non-bot messageCreate).

### Claude's Discretion
- Exact phrasing of the fallback envelope rules in `dream-prompt-builder.ts`
- Whether DREAM-OUT-02 lands as deferred-only documentation vs an attempt at per-turn `outputFormat` plumbing through the persistent handle
- File location for the cleanup-orphans CLI — extend `src/cli/commands/memory.ts` (existing namespace) vs new file `src/cli/commands/memory-cleanup-orphans.ts`
- IPC method name (recommend `memory-cleanup-orphans` — matches existing `memory-*` IPC namespace)

### Deferred Ideas (OUT OF SCOPE)
- Auto-invocation of `cleanupOrphans` on a schedule (cron / heartbeat / etc.)
- Migration to FK-supporting vector store (architectural change)
- Vec index rebuild / VACUUM (orthogonal performance optimization)
- Dream pass model upgrade (Haiku → Sonnet)
- Schema migration for existing `vec_memories` orphans (Admin Clawdy's manual patch was sufficient; cleanup CLI handles forward-going)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DREAM-OUT-01 | Strengthen prompt with fallback contract | `src/manager/dream-prompt-builder.ts:99-118` is the system-prompt block. Append-only edit — extend the existing "CRITICAL OUTPUT RULES" with a fallback envelope rule. |
| DREAM-OUT-02 | Switch to SDK structured-output mode if available | SDK 0.2.x supports `outputFormat: JsonSchemaOutputFormat` (sdk.d.ts:1244, 694). Production blocker: dream pass uses agent's persistent shared session (session-adapter.ts:653) where outputFormat is session-scoped, not per-turn. Recommend deferring as investigation. |
| DREAM-OUT-03 | Graceful recovery on parse failure | `src/manager/dream-pass.ts:271-280` (JSON.parse try/catch). Currently logs `error`-level + returns `{kind:"failed"}`. Change semantics: log `warn`-level with structured fields + return `{kind:"failed"}` (or new no-op shape). `applyDreamResult` (dream-auto-apply.ts:82-87) already skips on non-completed — no daemon crash today. |
| DREAM-OUT-04 | Vitest tests for parse recovery | New test file `src/manager/__tests__/dream-pass-json-recovery.test.ts`. Existing scaffolding at `dream-pass.test.ts:33-100` shows the DI pattern (vi.fn() mock dispatch). |
| VEC-CLEAN-01 | Audit all `memories` delete paths | Single mutation site: `MemoryStore.delete(id)` at `store.ts:312-331`. Already atomic+cascading. NO `deleteByTag` / `deleteOlderThan` methods exist on MemoryStore — only by-id. `tier-manager.ts:128` calls `store.delete()` (covered). `episode-archival.ts:53-66` does `updateTier(cold) + DELETE FROM vec_memories` (NOT a memories delete — this is intentional excise). `dedup.ts:117-121` deletes+reinserts vec inside the merge transaction (NOT a memories delete). |
| VEC-CLEAN-02 | Atomic transaction wrapping | Already in place at `store.ts:315-321` (`db.transaction(() => { ... })()`). |
| VEC-CLEAN-03 | Cleanup CLI subcommand | New `MemoryStore.cleanupOrphans()` method + `memory-cleanup-orphans` IPC method + `clawcode memory cleanup-orphans [-a <agent>]` CLI subcommand. CLI pattern: `src/cli/commands/memory.ts:247-336` (existing `memory` Command group). IPC pattern: `src/ipc/protocol.ts:75-86` (memory namespace). Daemon dispatch pattern: `src/manager/daemon.ts:2846-2928` (closure intercept BEFORE routeMethod). |
| VEC-CLEAN-04 | Vitest tests | New test file `src/memory/__tests__/store-orphan-cleanup.test.ts`. Existing scaffolding at `store.test.ts:1-200` (uses `MemoryStore(":memory:")`). |
</phase_requirements>

## Standard Stack

### Core (already in stack — no changes)
| Library | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| better-sqlite3 | 12.8.0 | Synchronous SQLite, transaction wrappers, prepared statements | HIGH |
| sqlite-vec | 0.1.9 | Vector vtab loaded via `sqliteVec.load(this.db)` (store.ts:91); creates `vec_memories USING vec0(...)` (store.ts:639-642) | HIGH |
| @anthropic-ai/claude-agent-sdk | 0.2.x | `query()` API + persistent session handle. Exposes `outputFormat: JsonSchemaOutputFormat` per-call (sdk.d.ts:694, 1244) | HIGH |
| zod (v4) | — | `dreamResultSchema` (dream-pass.ts:48-72), `dreamPassOutcomeSchema` (dream-pass.ts:81-95). Per project pattern, all dream code uses `zod/v4`. | HIGH |
| pino | 9.x | Shared logger at `src/shared/logger.ts:9`. `logger.warn({ ... }, "msg")` pattern. | HIGH |
| vitest | — | Existing test framework | HIGH |
| commander | — | CLI command registration (`Command.command(...).action(...)`) | HIGH |

### No new dependencies required
Phase constraint: "No new npm deps." All work uses existing project surfaces.

## Architecture Patterns

### Pattern 1: Pure-DI primitive at `src/manager/`, daemon-edge wires production sources
**Source:** Phase 95 dream-pass module (dream-pass.ts header docs, lines 1-30)
**When to use:** Any logic that needs unit testing without spinning up SDK / DB / fs.
**Example:**
```typescript
// dream-pass.ts — primitive
export interface RunDreamPassDeps {
  readonly memoryStore: { getRecentChunks(...): Promise<MemoryChunk[]> };
  readonly dispatch: (req: DreamDispatchRequest) => Promise<DreamDispatchResponse>;
  readonly log: DreamPassLog;
  readonly now?: () => Date;
}

// daemon.ts:3024-3114 — production wiring at edge
runDreamPass: async (agent, model) => {
  const memoryStore = manager.getMemoryStore(agent);
  /* ... wire real SDK + fs + log ... */
  return runDreamPassPrim(agent, deps);
}
```

### Pattern 2: IPC method registration (closure intercept BEFORE routeMethod)
**Source:** Phase 95 DREAM-07 (daemon.ts:2846-2853), Phase 96 PFS- (daemon.ts:2854-2864), Phase 999.15 mcp-tracker
**When to use:** New daemon-routed CLI subcommand.
**Steps:**
1. Add string literal to `IPC_METHODS` array at `src/ipc/protocol.ts:7-256` (memory namespace ~line 75-86)
2. Write pure handler `handleMemoryCleanupOrphansIpc(req, deps)` near other handlers in `src/manager/daemon.ts` (or extract to `src/manager/memory-cleanup-orphans-ipc.ts` if non-trivial)
3. Wire intercept inside daemon's main IPC dispatch (`daemon.ts:2820-3140` block)
4. Inject production sources (MemoryStore lookup via `manager.getMemoryStore(agent)`)

### Pattern 3: CLI subcommand under existing `memory` group
**Source:** `src/cli/commands/memory.ts:247-336`
**When to use:** New operator surface that talks to the daemon.
**Example:**
```typescript
// In registerMemoryCommand(program)
memoryCmd
  .command("cleanup-orphans")
  .description("Remove vec_memories rows whose memory_id is no longer in memories")
  .option("-a, --agent <name>", "Filter to one agent")
  .action(async (opts: { agent?: string }) => {
    try {
      const result = (await sendIpcRequest(SOCKET_PATH, "memory-cleanup-orphans", {
        ...(opts.agent ? { agent: opts.agent } : {}),
      })) as CleanupOrphansResponse;
      cliLog(formatCleanupResult(result));
    } catch (error) {
      if (error instanceof ManagerNotRunningError) {
        cliError("Manager is not running. Start it with: clawcode start-all");
        process.exit(1);
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      cliError(`Error: ${msg}`);
      process.exit(1);
    }
  });
```

### Pattern 4: Atomic transaction for paired SQLite operations
**Source:** `MemoryStore.delete` (store.ts:315-321), `insertMemoryChunk` (store.ts:1094-1136), `deleteMemoryChunksByPath` (store.ts:1147-1164)
**Idiom:**
```typescript
this.db.transaction(() => {
  // multiple statements — all succeed or all roll back
})();
```

### Pattern 5: Pino structured warn (operator-greppable)
**Source:** Phase 106 STALL-02 idiom; `src/memory/episode-archival.ts:60-63`
**Idiom:**
```typescript
import { logger } from "../shared/logger.js";

logger.warn(
  { component: "dream-pass", action: "parse-failed", responsePrefix: rawText.slice(0, 80), agent: agentName },
  "dream pass returned non-JSON; treating as no-op",
);
```

### Anti-Patterns to Avoid
- **Don't add `cleanupOrphans` to the heartbeat / cron loop in this phase.** Auto-invocation is explicitly deferred per CONTEXT.md.
- **Don't use raw `db.exec` for paired deletes.** Always wrap in `this.db.transaction(() => { ... })()` to preserve atomicity.
- **Don't extend `dream-prompt-builder.ts` system prompt rules verbatim across the existing 5 numbered rules without preserving them.** Static-grep regression tests pin the existing rules — append-only edits only.
- **Don't log the FULL non-JSON LLM response.** Cap at 80 chars (CONTEXT.md determinism rule).
- **Don't change `dream-pass.ts` to throw on parse failure.** Existing contract returns `{kind:"failed"}`. Plan 95-02 + 95-03 consume the 3-variant union exhaustively (locked, per dream-pass.ts:78-95 comment).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON repair / extraction from LLM prose | Custom regex repair attempts | Existing `extractJsonObject` (dream-pass.ts:238-268) brace-balancing is sufficient; failures cleanly fall through to recovery path | Already handles fence-wrapped + prose-wrapped cases. Adding more "smart" repair adds bugs. |
| Vector vtab orphan detection | Recursive consistency walker | One SQL: `SELECT memory_id FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories)` | sqlite-vec vec0 vtabs ARE queryable like normal tables for the indexed columns. |
| LLM structured-output forcing | Custom retry-on-prose loop | DREAM-OUT-01 fallback envelope contract (the LLM produces the no-op envelope itself when uncertain) | Adding retries doubles dream-pass latency on the failure path; prompt-rule fix is cheaper. |
| Per-turn `outputFormat` injection | New dispatch path through `TurnDispatcher` | Defer — see Open Questions below. SDK supports it, but production wiring is session-scoped. | Out-of-budget for this phase. |

**Key insight:** Both pillars are about *cleanup of existing infrastructure*, not new architecture. Resist scope creep into "while we're in here, let's also …" rewrites.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Production agent SQLite DBs at `~/.clawcode/agents/<agent>/memory/memories.db` contain orphan rows in `vec_memories` (memory_id present in vec_memories but NOT in memories). Admin Clawdy already manually cleaned current state, but new orphans will accumulate without either (a) verified-clean delete paths or (b) ongoing cleanup. | Code edit (already-correct delete path verification) + operator-runnable cleanup CLI for forward maintenance. |
| Live service config | None. The dream cron `*/${idleMinutes} * * * *` is in-process (croner) and reads from agent config at registration time (dream-cron.ts:116). No external scheduler holds dream config. | None. |
| OS-registered state | None. clawcode systemd unit is unaware of memory/dream config (per `reference_clawcode_server.md`). | None. |
| Secrets/env vars | None. Dream pass uses the agent's existing OAuth/API key via the persistent SDK session — no new secret introduced. | None. |
| Build artifacts | `dist/` is rebuilt on deploy (tsup). No stale dependencies on dream-pass.ts or store.ts shape from prior phases. | None — rebuild on deploy is sufficient. |

**Canonical risk question:** *After every file in the repo is updated, what runtime systems still have orphan rows?* — Answer: production agent memories.db files. The cleanup CLI is the runtime-state migration tool. Per CONTEXT.md, Admin Clawdy's manual patch already addressed current state; phase-level concern is preventing future regressions + giving operator the tool.

## Common Pitfalls

### Pitfall 1: Modifying the existing 5 "CRITICAL OUTPUT RULES" instead of appending
**What goes wrong:** Phase 95 has static-grep regression tests pinning the existing rules.
**Why it happens:** Tempting to "consolidate" the rules into a tighter list.
**How to avoid:** Append a NEW rule (rule 6 + fallback envelope) AFTER the existing 5. Don't reword 1-5.
**Warning signs:** `dream-prompt-builder.test.ts` failures with phrases like "expected to contain 'NO markdown code fences'".

### Pitfall 2: Adding `outputFormat` to `baseOptions` at session creation
**What goes wrong:** `outputFormat` is session-scoped in the SDK. If you set it at the persistent session level (session-adapter.ts:603-664), EVERY turn for that agent (Discord chat, dream pass, scheduler) gets forced into JSON-schema output. Discord conversations break.
**Why it happens:** Misreading the SDK type as per-turn when it's per-session.
**How to avoid:** Confirm via `sdk.query({ prompt, options: { outputFormat: ... } })` at the per-turn call site — but the persistent-handle architecture (session-adapter.ts:1286-1311) reuses one long-lived `query` for streaming events; per-turn options are limited to what `turnOptions()` (session-adapter.ts:908-925) injects. **Per-turn `outputFormat` is non-trivial without a separate dispatch path.**
**Warning signs:** Agents responding to "what's up?" with `{...}` blobs.

### Pitfall 3: Confusing intentional excise (cold archive) with orphan
**What goes wrong:** `archiveOldEpisodes` (episode-archival.ts:53-66) sets tier=cold + deletes vec_memories. The memory row STAYS in `memories`. This is the OPPOSITE shape from an orphan (memory present, vec absent — fine, cold by design). If `cleanupOrphans` SQL accidentally walks the wrong direction, it would delete cold-archived memories.
**Why it happens:** Treating the `memories ↔ vec_memories` relationship as symmetric.
**How to avoid:** The SQL MUST be `DELETE FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories)` — directional. Never `DELETE FROM memories WHERE id NOT IN ...` (deletes valid cold archives).
**Warning signs:** Test fails after `archiveOldEpisodes` runs on a cleanup-orphans-touched DB.

### Pitfall 4: Schema-migration orphans (historical, root-cause)
**What goes wrong:** `migrateSchema` and `migrateEpisodeSource` (store.ts:651-755) recreate the `memories` table to alter CHECK constraints. The pattern: `CREATE memories_new; INSERT INTO memories_new SELECT * FROM memories; DROP TABLE memories; ALTER TABLE memories_new RENAME TO memories`. `vec_memories` is NOT touched by the migration. If the migration fails partway, or if a row in old `memories` violated the new CHECK constraint and was silently dropped during INSERT SELECT, that row's `vec_memories` entry orphans.
**Why it happens:** Standard SQLite limitation — can't ALTER CHECK; table-recreation is the workaround.
**How to avoid (forward):** New migrations that recreate `memories` MUST also `DELETE FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories_new)` inside the same transaction. Out of scope for THIS phase — the cleanup CLI handles existing orphans.
**Warning signs:** Operator runs `cleanup-orphans` after a deploy and finds N>0 orphans (without any code-level memory deletes happening). N gives the count of historical migration drops.

### Pitfall 5: pino warn level confusion
**What goes wrong:** Current dream-pass code uses `deps.log.error` (line 278, 285, 306). Changing to `deps.log.warn` requires the `DreamPassLog` interface (dream-pass.ts:133-137) to expose warn — it does. But the production wiring at daemon.ts:3112 passes a `log` value that may not have a clean warn surface; verify.
**Why it happens:** TypeScript narrow `info | warn | error` doesn't enforce the wiring.
**How to avoid:** Confirm `daemon.ts:3112`'s `log` argument is a pino-shaped object with `.warn(...)`; if not, the production warn call won't take the structured-fields shape the test expects.
**Warning signs:** Tests assert `{ component: "dream-pass" }` but production logs render as `[dream-pass: agent ... parse-failed]` (string-concat style instead of structured fields).

## Code Examples

### Pillar A — Append-only prompt rule (dream-prompt-builder.ts:99-118)

Current rule block (lines 97-118):
```typescript
return `You are ${agentName}'s reflection daemon. Your job is to read recent memory chunks, the core MEMORY.md, recent conversation summaries, and the existing wikilink graph, then emit a structured reflection.

CRITICAL OUTPUT RULES:
1. Your response MUST be valid JSON, parseable by JSON.parse() with no preprocessing.
2. The FIRST character MUST be '{' (no narrative preamble like "Picking up...", "Here's the reflection...", or "Sure!").
3. The LAST character MUST be '}' (no trailing commentary, no closing remarks).
4. NO markdown code fences (no \`\`\`json wrapper).
5. NO explanation text before or after the JSON object.

Required JSON schema (all 4 fields mandatory; use empty arrays/strings if no content):
{ ... existing schema block ... }
```

Append (DREAM-OUT-01):
```typescript
6. If you cannot produce valid JSON (input unclear, no patterns found, internal error), output this EXACT fallback envelope and NOTHING else:
{"newWikilinks":[],"promotionCandidates":[],"themedReflection":"","suggestedConsolidations":[]}
NEVER output prose like "Noted —", "I'll do my best", "Picking up where we left off", or any other chat-style preamble.
```

> ⚠️ The fallback envelope shape MUST match `dreamResultSchema` (dream-pass.ts:48-72) exactly. CONTEXT.md's text shows `summary` + `errors` fields — those would FAIL zod validation. Use the actual schema's keys: `newWikilinks`, `promotionCandidates`, `themedReflection`, `suggestedConsolidations`. Confirm with planner — CONTEXT.md determinism preference may need correction.

### Pillar A — Parse-failure recovery (dream-pass.ts:271-280)

Current (line 271-280):
```typescript
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(stripCodeFence(dispatchResp.rawText));
} catch (parseErr) {
  const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
  const errorText = `dream-result-schema-validation-failed: JSON parse failed (${msg})`;
  deps.log.error(`dream-pass: ${agentName} ${errorText}`);
  return { kind: "failed", error: errorText };
}
```

Proposed (DREAM-OUT-03):
```typescript
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(stripCodeFence(dispatchResp.rawText));
} catch (parseErr) {
  const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
  const responsePrefix = dispatchResp.rawText.slice(0, 80);
  // Phase 107 — log warn (not error) with structured fields. Operator
  // surface: parse-failure is a "model misbehaved" signal, not a bug;
  // grep on action="parse-failed" for fleet-wide rate.
  deps.log.warn(
    `dream-pass: ${agentName} parse-failed responsePrefix="${responsePrefix}" err="${msg}"`,
  );
  return { kind: "failed", error: `parse-failed: ${msg}` };
}
```

> The 3-variant `DreamPassOutcome` union is LOCKED (dream-pass.ts:78-80). Don't introduce a 4th variant. `applyDreamResult` (dream-auto-apply.ts:82-87) already maps `failed` → `skipped` outcome — daemon-non-crash invariant preserved.

> If `DreamPassLog.warn` (dream-pass.ts:135) signature is `(msg: string) => void` (string-only), the structured-fields contract from CONTEXT.md needs the production wiring (daemon.ts:3112) to bridge to the pino logger's `warn(obj, msg)` form. Planner: decide whether to extend `DreamPassLog` to support `(obj?: object, msg: string) => void` or whether the wiring layer reformats. Recommend extending the interface.

### Pillar B — `MemoryStore.cleanupOrphans()` method (NEW)

Add to `src/memory/store.ts`:
```typescript
/**
 * Phase 107 VEC-CLEAN-03 — remove orphan vec_memories entries.
 *
 * Detects rows in vec_memories whose memory_id is NOT in memories
 * (orphans accumulated from historical CHECK-constraint migrations
 * or any future delete path that bypasses MemoryStore.delete).
 *
 * Idempotent: running twice removes 0 on the second call.
 * Atomic: count + delete inside a single transaction.
 *
 * Returns { removed, totalAfter } so the operator sees both the patch
 * count and the post-cleanup total.
 */
cleanupOrphans(): { removed: number; totalAfter: number } {
  return this.db.transaction(() => {
    const beforeRow = this.db
      .prepare("SELECT COUNT(*) AS n FROM vec_memories")
      .get() as { n: number };
    const result = this.db
      .prepare(
        "DELETE FROM vec_memories WHERE memory_id NOT IN (SELECT id FROM memories)",
      )
      .run();
    const afterRow = this.db
      .prepare("SELECT COUNT(*) AS n FROM vec_memories")
      .get() as { n: number };
    return {
      removed: result.changes as number,
      totalAfter: afterRow.n,
    };
  })();
}
```

### Pillar B — IPC method registration (protocol.ts:75-86 namespace)

```typescript
// Add to IPC_METHODS array around line 80 (memory namespace)
"memory-cleanup-orphans",
```

### Pillar B — Daemon dispatch (daemon.ts ~line 2940 area, before routeMethod)

```typescript
if (method === "memory-cleanup-orphans") {
  const agentParam = typeof params["agent"] === "string"
    ? (params["agent"] as string)
    : null;
  const targets = agentParam
    ? [agentParam]
    : resolvedAgents.map((a) => a.name);
  const results: Array<{ agent: string; removed: number; totalAfter: number }> = [];
  for (const agent of targets) {
    const store = manager.getMemoryStore(agent);
    if (!store) {
      results.push({ agent, removed: 0, totalAfter: 0 });
      continue;
    }
    try {
      const r = store.cleanupOrphans();
      results.push({ agent, removed: r.removed, totalAfter: r.totalAfter });
    } catch (err) {
      log.error(
        `[memory-cleanup-orphans] ${agent} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      results.push({ agent, removed: 0, totalAfter: -1 });
    }
  }
  return { results };
}
```

### Pillar B — CLI subcommand (memory.ts:247+)

Extend `registerMemoryCommand`:
```typescript
memoryCmd
  .command("cleanup-orphans")
  .description("Remove orphan vec_memories rows whose memory_id no longer exists")
  .option("-a, --agent <name>", "Filter to one agent (omit for all agents)")
  .action(async (opts: { agent?: string }) => {
    try {
      const params: Record<string, unknown> = {};
      if (opts.agent) params.agent = opts.agent;
      const result = (await sendIpcRequest(
        SOCKET_PATH,
        "memory-cleanup-orphans",
        params,
      )) as { results: Array<{ agent: string; removed: number; totalAfter: number }> };
      for (const r of result.results) {
        if (r.totalAfter < 0) {
          cliError(`${r.agent}: cleanup failed`);
        } else if (r.removed === 0) {
          cliLog(`${r.agent}: no orphans (${r.totalAfter} vec_memories total)`);
        } else {
          cliLog(`${r.agent}: removed ${r.removed} orphans (${r.totalAfter} vec_memories remaining)`);
        }
      }
    } catch (error) {
      if (error instanceof ManagerNotRunningError) {
        cliError("Manager is not running. Start it with: clawcode start-all");
        process.exit(1);
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      cliError(`Error: ${msg}`);
      process.exit(1);
    }
  });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anthropic SDK forcing JSON via prompt rules alone | `outputFormat: { type: "json_schema", schema }` per-call SDK option | claude-agent-sdk 0.2.x (current) | Stronger guarantee than prompt rules — SDK tool-forces output. BLOCKED in this phase by per-session option scoping (see Open Questions). |
| `JSON.parse + try/catch + log.error` | Add `responsePrefix` field to log + downgrade to `warn` level | Phase 107 | Cleaner operator alerting. parse-failure now categorized as "model misbehaved", not "system bug". |
| FK CASCADE for paired tables | Application-code transaction for sqlite-vec vtabs (no FK support) | Always — vtab limitation | Why VEC-CLEAN-03 is needed at all. |

## Open Questions

1. **DREAM-OUT-02 viability — per-turn `outputFormat` through the persistent handle.**
   - What we know: SDK 0.2.x supports `outputFormat: JsonSchemaOutputFormat` (sdk.d.ts:1244, 694). Each `sendAndCollect` makes a fresh `sdk.query({ prompt, options: turnOptions(...) })` call (session-adapter.ts:1301). `turnOptions` (session-adapter.ts:908-925) currently spreads `baseOptions` + adds `effort` + `resume`.
   - What's unclear: whether `outputFormat` can be safely added to per-turn `turnOptions` ONLY when the dispatch is dream-pass (not Discord chat). The dream pass goes through `TurnDispatcher.dispatch` → `sessionManager.dispatchTurn` (session-manager.ts) which calls `sendAndCollect`. There's no per-turn flag plumbed today saying "this is a JSON-schema-output turn."
   - Recommendation: Document as DEFERRED in PLAN.md. Plumbing per-turn `outputFormat` requires a new `DispatchOptions` field + threading through `TurnDispatcher.dispatch` + `SessionManager.dispatchTurn` + `sendAndCollect` + `turnOptions`. That's a ~5-file refactor not justified here. DREAM-OUT-01 (prompt fallback envelope) + DREAM-OUT-03 (warn-level recovery) are sufficient for fault tolerance per CONTEXT.md.

2. **Fallback envelope shape mismatch in CONTEXT.md.**
   - CONTEXT.md DREAM-OUT-01 specifies: `{"newWikilinks":[],"promotionCandidates":[],"summary":"","errors":["<reason>"]}`
   - Actual `dreamResultSchema` (dream-pass.ts:48-72) requires: `newWikilinks`, `promotionCandidates`, `themedReflection`, `suggestedConsolidations`. There's no `summary` or `errors` field.
   - If the model produces the CONTEXT-specified envelope, zod validation FAILS and we land in the same `failed` outcome as if it produced prose.
   - Recommendation: Planner should reconcile — either (a) update the prompt to ask for the schema-matching fallback `{"newWikilinks":[],"promotionCandidates":[],"themedReflection":"","suggestedConsolidations":[]}`, or (b) extend the schema to accept an optional `errors: string[]` field. (a) is lower-friction and matches the principle "fallback is a successful no-op result".

3. **`DreamPassLog` warn signature.**
   - Current interface (dream-pass.ts:133-137): `warn(msg: string): void` — string-only.
   - CONTEXT.md determinism: `{ "level": 40, "component": "dream-pass", "action": "parse-failed", "responsePrefix": <80 chars>, ... }` — pino-structured.
   - Recommendation: Extend `DreamPassLog.warn` to `(obj: Record<string, unknown>, msg: string) => void` (matches pino), update production wiring at daemon.ts:3112. Tests assert the structured shape.

4. **Should `cleanupOrphans()` be exposed on `MemoryStore` or live in a separate utility?**
   - Method on `MemoryStore`: clean — single owner of the SQLite handle.
   - Separate utility: easier to import without instantiating a store.
   - Recommendation: Method on `MemoryStore`. The daemon already has the store handle open per-agent. Mirrors `bumpAccess` and `getMemoryFileSha256` (one-line operational helpers).

5. **Schema migration as orphan source — should the cleanup run inside future migrations?**
   - Out of scope per CONTEXT.md deferred section, but worth flagging: any future Phase that adds a new CHECK constraint on `memories` (re-running the table-recreate idiom at store.ts:674-691) MUST cascade to vec_memories inside the same transaction.
   - Recommendation: Note in CONVENTIONS.md or add to Phase 107 PR description.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 22 LTS | — |
| better-sqlite3 | MemoryStore + cleanupOrphans | ✓ | 12.8.0 | — |
| sqlite-vec | vec_memories table | ✓ | 0.1.9 | — |
| @anthropic-ai/claude-agent-sdk | dream pass dispatch | ✓ | 0.2.x | — |
| pino | logger.warn | ✓ | 9.x | — |
| vitest | tests | ✓ | — | — |

**Missing dependencies:** None. Phase is pure code-level work using the existing stack.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | `/home/jjagpal/.openclaw/workspace-coding/vitest.config.ts` |
| Quick run command | `npx vitest run src/manager/__tests__/dream-pass-json-recovery.test.ts src/memory/__tests__/store-orphan-cleanup.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DREAM-OUT-01 | Prompt contains fallback envelope rule (rule 6) | unit | `npx vitest run src/manager/__tests__/dream-prompt-builder.test.ts` | ✅ extend existing file |
| DREAM-OUT-03 (a) | Prose response → no-op outcome + warn log | unit | `npx vitest run src/manager/__tests__/dream-pass-json-recovery.test.ts -t "prose-input"` | ❌ Wave 0 |
| DREAM-OUT-03 (b) | Valid JSON response → completed outcome, no warn | unit | `npx vitest run src/manager/__tests__/dream-pass-json-recovery.test.ts -t "valid-json"` | ❌ Wave 0 |
| DREAM-OUT-03 (c) | Fallback envelope from LLM → completed (legitimate no-op) | unit | `npx vitest run src/manager/__tests__/dream-pass-json-recovery.test.ts -t "fallback-envelope"` | ❌ Wave 0 |
| DREAM-OUT-03 (d) | Malformed JSON (trailing comma) → no-op + warn | unit | `npx vitest run src/manager/__tests__/dream-pass-json-recovery.test.ts -t "malformed-json"` | ❌ Wave 0 |
| DREAM-OUT-03 (e) | Daemon does NOT crash on parse failure | unit | `npx vitest run src/manager/__tests__/dream-cron.test.ts -t "parse-failure-non-fatal"` | ✅ extend existing file |
| VEC-CLEAN-01 | Existing `MemoryStore.delete` cascades atomically (regression) | unit | `npx vitest run src/memory/__tests__/store.test.ts -t "delete"` | ✅ extend existing file |
| VEC-CLEAN-03 (a) | `cleanupOrphans` removes orphan vec_memories | unit | `npx vitest run src/memory/__tests__/store-orphan-cleanup.test.ts -t "removes-orphans"` | ❌ Wave 0 |
| VEC-CLEAN-03 (b) | `cleanupOrphans` is idempotent (second run = 0 removed) | unit | `npx vitest run src/memory/__tests__/store-orphan-cleanup.test.ts -t "idempotent"` | ❌ Wave 0 |
| VEC-CLEAN-03 (c) | `cleanupOrphans` does NOT delete cold-archived memories (intentional excise) | unit | `npx vitest run src/memory/__tests__/store-orphan-cleanup.test.ts -t "preserves-cold"` | ❌ Wave 0 |
| VEC-CLEAN-03 (d) | `cleanupOrphans` is atomic (no partial state) | unit | `npx vitest run src/memory/__tests__/store-orphan-cleanup.test.ts -t "atomic"` | ❌ Wave 0 |
| VEC-CLEAN-04 | IPC method `memory-cleanup-orphans` registered + dispatches | unit | `npx vitest run src/ipc/__tests__/protocol.test.ts -t "memory-cleanup-orphans"` | ✅ extend existing file |
| VEC-CLEAN-04 | CLI `clawcode memory cleanup-orphans` calls IPC | unit | `npx vitest run src/cli/commands/__tests__/memory.test.ts` (NEW or extend) | ⚠️ check exists |

### Sampling Rate
- **Per task commit:** `npx vitest run src/manager/__tests__/dream-pass-json-recovery.test.ts src/memory/__tests__/store-orphan-cleanup.test.ts` (~5s)
- **Per wave merge:** `npx vitest run src/manager src/memory src/ipc src/cli` (memory + dream + IPC scope)
- **Phase gate:** Full suite green (`npx vitest run`) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/manager/__tests__/dream-pass-json-recovery.test.ts` — covers DREAM-OUT-03 (a–d)
- [ ] `src/memory/__tests__/store-orphan-cleanup.test.ts` — covers VEC-CLEAN-03 (a–d)
- [ ] Possibly `src/cli/commands/__tests__/memory.test.ts` — verify if exists; CLI tests may use existing `memory.test.ts` location
- [ ] No new framework install needed — vitest is the existing standard

## Recommended Plan Breakdown (planner-facing)

**Suggested plan count: 2 plans, 4-5 waves total.**

### Plan 107-01 — Pillar A (Dream JSON enforcement)
- **Wave 0:** Create `src/manager/__tests__/dream-pass-json-recovery.test.ts` (RED — tests the recovery path against the current code which logs at `error` level and may use string-concat)
- **Wave 1 (DREAM-OUT-01):** Append rule 6 + fallback envelope to `dream-prompt-builder.ts:99-118`. Update existing `dream-prompt-builder.test.ts` to assert the rule's presence.
- **Wave 1 (DREAM-OUT-03):** Update `dream-pass.ts:271-280` to log `warn` with structured fields. Extend `DreamPassLog.warn` signature (dream-pass.ts:135) to `(obj, msg)`. Update production wiring at `daemon.ts:3112` to bridge pino's `warn(obj, msg)` form. Wave 0 tests turn GREEN.
- **DREAM-OUT-02:** Document as DEFERRED in PLAN. Add a section explaining the per-session-vs-per-turn `outputFormat` blocker. (No code change.)

### Plan 107-02 — Pillar B (vec_memories orphan cleanup)
- **Wave 0:** Create `src/memory/__tests__/store-orphan-cleanup.test.ts` (RED — tests `cleanupOrphans` method that doesn't exist yet)
- **Wave 1 (VEC-CLEAN-01 + VEC-CLEAN-02):** Audit task — confirm `MemoryStore.delete` is the only `DELETE FROM memories` site (verified in research). Add a regression test in `store.test.ts` asserting cascade atomicity. No production code change in this wave.
- **Wave 2 (VEC-CLEAN-03):** Add `cleanupOrphans()` method on `MemoryStore` (store.ts). Wave 0 unit tests turn GREEN. Add IPC method `memory-cleanup-orphans` to `protocol.ts` + daemon dispatch handler in `daemon.ts`. Add CLI subcommand to `memory.ts`. Add IPC + CLI tests.
- **Wave 3 (VEC-CLEAN-04):** Final integration — verify all phase tests green, run full suite, document operator runbook in PR description.

**Parallelism:** Plans 107-01 and 107-02 are fully independent. Can run in parallel waves.

## Sources

### Primary (HIGH confidence)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/dream-pass.ts` — runDreamPass primitive, DreamPassOutcome contract
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/dream-prompt-builder.ts:97-118` — System prompt with CRITICAL OUTPUT RULES
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/dream-auto-apply.ts:82-87` — `failed`-outcome handling (no daemon crash)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/daemon.ts:3019-3140` — Production dream dispatch wiring
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/store.ts:312-331` — `MemoryStore.delete` cascade
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/store.ts:639-642` — `vec_memories USING vec0` schema
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/store.ts:651-755` — Migration patterns (CHECK constraint table-recreate)
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/dedup.ts:117-121` — Merge path's vec delete-and-reinsert (atomic)
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/episode-archival.ts:53-66` — Cold-archive intentional excise (NOT orphan source)
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/tier-manager.ts:128` — Cold archival via `store.delete` (cascades correctly)
- `/home/jjagpal/.openclaw/workspace-coding/src/cli/commands/memory.ts:247-336` — CLI command group pattern
- `/home/jjagpal/.openclaw/workspace-coding/src/cli/commands/mcp-tracker.ts:246-304` — Phase 999.15 CLI/IPC reference
- `/home/jjagpal/.openclaw/workspace-coding/src/ipc/protocol.ts:75-86` — Memory IPC namespace
- `/home/jjagpal/.openclaw/workspace-coding/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:694, 1244, 1485` — `JsonSchemaOutputFormat` and `outputFormat` SDK option definitions

### Secondary (MEDIUM confidence)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-adapter.ts:653, 908-925, 1286-1311` — Persistent SDK session handle, per-turn options, dispatch callsites
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/__tests__/dream-pass.test.ts` — Existing test scaffolding for DI mocks
- `/home/jjagpal/.openclaw/workspace-coding/src/memory/__tests__/store.test.ts:1-200` — Existing MemoryStore test scaffolding (`MemoryStore(":memory:")`)

### Tertiary (LOW confidence — noted but not blocking)
- Historical schema-migration orphan-source hypothesis: based on inspection of `migrateSchema` + `migrateEpisodeSource` patterns. Production agent DBs would need direct inspection to confirm exact orphan count. Admin Clawdy's report (CONTEXT.md specifics block) confirms presence; counts deferred to operator post-deploy verification.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via existing imports + node_modules type defs
- Architecture (delete cascade audit): HIGH — exhaustive grep across `src/` confirmed only one `DELETE FROM memories` site
- Architecture (dream pass dispatch): HIGH — daemon.ts:3019-3140 fully traced; SDK type confirmed in sdk.d.ts
- DREAM-OUT-02 SDK-side support: HIGH (SDK supports it) — but production-wiring blocker MEDIUM (architectural reasoning verified, but not exhaustively prototyped)
- Pitfalls: HIGH — drawn from actual file inspection + Phase 95/99 hotfix comments

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (30 days — ClawCode codebase is fast-moving but the Phase 95 dream + Phase 80/100 memory infrastructure are stable)
