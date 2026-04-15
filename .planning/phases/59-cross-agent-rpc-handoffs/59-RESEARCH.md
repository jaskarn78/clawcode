# Phase 59: Cross-Agent RPC (Handoffs) — Research

**Researched:** 2026-04-15
**Domain:** Typed async-ticket RPC between agents, schema-validated payloads, chain-walked cycle detection, deadline propagation through the Claude Agent SDK, idempotent retry
**Confidence:** HIGH

## Summary

Phase 59 lands the `TaskManager` subsystem and three MCP tools (`delegate_task`, `task_status`, `cancel_task`) plus a CLI retry command. All of the substrate is already in place — Phase 57 delivered `TurnDispatcher` + `TurnOrigin`, Phase 58 delivered `TaskStore` + state machine + reconciler + `errors.ts` + daemon wiring. The research below mostly nails down the **small choices** left in CONTEXT.md's "Claude's Discretion" section — all 8 undecided items flagged in the additional context have concrete recommendations grounded in code-path citations.

The single highest-value finding: `src/shared/canonical-stringify.ts` **already exists** (Phase 55 Plan 02). It's a deterministic recursive key-sorting stringify that Phase 59 `input_digest` MUST reuse verbatim — no new dep, no hand-roll, no `fast-json-stable-stringify`. Just `sha256(canonicalStringify(payload))`. Same rationale for Zod: v4 is wired through the project; no need to pull in `json-schema-to-zod` or `ajv`. A ~150-line hand-rolled JSON-Schema→Zod compiler covering the eight primitives + object + array + union + enum is cleaner than either dep for the narrow slice Phase 59 needs.

**Primary recommendation:** Three plans (59-01 / 59-02 / 59-03) matching the locked CONTEXT cadence. Wave 1 is pure-data (schema loader, hand-rolled compiler, typed errors). Wave 2 is `TaskManager` (authorize / cycle-detect / digest / deadline / result dispatch). Wave 3 is the surface (MCP tools, IPC methods, daemon wiring, CLI retry, config schema extension). Reuse `canonicalStringify`, `TaskStore`, `TurnDispatcher`, `AbortController` (SDK has native support), and `TOOL_DEFINITIONS` — no new runtime deps.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — MCP Surface & Result Flow**

- **Registration:** `delegate_task`, `task_status`, `cancel_task` registered in the shared MCP server (`src/mcp/server.ts` TOOL_DEFINITIONS) — consistent with `send_to_agent`, `ask_advisor` pattern. Not per-agent.
- **Return shape:** `delegate_task` returns `{ task_id: string }` — minimal async-ticket per HAND-01. Richer observability fields (status URL, chain cost) land in Phase 63.
- **Tool set shipped:** `delegate_task` + `task_status` + `cancel_task` as MCP tools so any agent can delegate, check, or cancel. `clawcode tasks retry <task_id>` (LIFE-06) is an IPC method + CLI command, not an MCP tool — retry is an operator action, not an agent action.
- **Result flow back to A:** When B's task completes (or fails/times out), the daemon dispatches a fresh turn to agent A through `TurnDispatcher` with `TurnOrigin{kind:'task', id: task_id, rootTurnId, chain}`. A consumes the result via its regular turn-handling pipeline. This matches Phase 57's design and means no ad-hoc side-channel into A's session.

**Area 2 — Task Schema Registry & Authorization**

- **Registry location:** `~/.clawcode/task-schemas/` — runtime config location, matches `~/.clawcode/manager/*.db` convention.
- **File layout:** One YAML file per schema (`research.brief.yaml`, `finmentum.client-followup.yaml`).
- **Schema format:** JSON Schema in YAML — compiled to Zod at load time via a thin adapter.
- **Payload cap:** 64 KB enforced at validation time (HAND-02, HAND-06). Size check happens BEFORE Zod parse to fail fast on oversize.
- **Allowlist location:** Per-agent `acceptsTasks:` section in `clawcode.yaml`, shape `{ [schemaName]: [callerAgentName, ...] }`. Default deny.

**Area 3 — Plan & Wave Breakdown**

- **59-01 (Wave 1):** Task schema registry loader + JSON-Schema→Zod compiler + input/output validation + 6 typed error classes (ValidationError, UnauthorizedError, CycleDetectedError, DepthExceededError, SelfHandoffBlockedError, DeadlineExceededError). Pure data/logic — no daemon state, no DB writes.
- **59-02 (Wave 2):** `TaskManager` class — `delegate()`, `cancel()`, `retry()`, result dispatch. Implements authorization, cycle detection, depth cap, self-handoff block, cost attribution, deadline + AbortSignal propagation, `input_digest` hashing, retry logic.
- **59-03 (Wave 3):** MCP tool registration; IPC methods; CLI `clawcode tasks retry <task_id>` + `clawcode tasks status <task_id>`; daemon wiring of `TaskManager` singleton; result-back-to-caller dispatch via `TurnDispatcher`.

### Claude's Discretion

- Internal file organization under `src/tasks/` — e.g. `manager.ts`, `schema-registry.ts`, `task-manager.ts`, `digest.ts`, `authorize.ts`, `handoff-errors.ts` — or fewer/more files as natural.
- SHA-256 normalization approach for `input_digest` — canonical JSON (sorted keys, no whitespace); pick the lightest existing dep (node's `crypto.createHash('sha256')`).
- IPC method naming within the established kebab-case convention.
- Test layout under `src/tasks/__tests__/` + `src/mcp/__tests__/`.
- Exact error message strings.

### Deferred Ideas (OUT OF SCOPE)

- Auto-retry policy (LIFE-06 mentions "(future) auto-retry policy" — explicitly out of scope)
- `clawcode tasks` list/inspect CLIs — Phase 63 OBS-02 owns
- Dashboard graph panel for in-flight tasks — Phase 63 OBS-03
- `clawcode trace <causation_id>` chain walker — Phase 63 OBS-04
- Policy-driven routing (task target chosen by policy rule) — Phase 62 POL-02
- Task retention cleanup (7-day default purge) — Phase 60 LIFE-03
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HAND-01 | `delegate_task` MCP tool with typed input/output, async-ticket semantics | Section "MCP Tool Registration" + "Result Dispatch Flow" + reuses TOOL_DEFINITIONS pattern at `src/mcp/server.ts:13` |
| HAND-02 | Task schema registry + Zod validation + 64 KB payload cap | Section "JSON Schema → Zod Compilation" + "Payload Size Check Ordering" — Wave 1 owns |
| HAND-03 | Chain-wide deadline + AbortSignal + receiver aborts on timeout | Section "AbortSignal Propagation" — SDK has native `abortController` in `Options` |
| HAND-04 | Receiver-declared allowlist (`acceptsTasks` per agent) | Section "Config Schema Extension" — add `acceptsTasks` to `agentSchema` at `src/config/schema.ts:327` |
| HAND-05 | Chain depth counter + cycle detection via `causation_id` walk | Section "Cycle Detection" — uses `TaskStore.get(parent_task_id)` walk |
| HAND-06 | Explicit payload — only schema fields cross boundary, no ambient context | Section "Payload Isolation" — Zod `.strict()` rejects unknown keys |
| HAND-07 | Self-handoff blocked at MCP tool level | Section "Authorization Order" — cheap-check first: `caller === target` |
| LIFE-05 | Cost attribution — tokens count against caller's budget by default | Section "Cost Attribution Path" — reuse `usageTracker.record()` + `budgetOwner` override |
| LIFE-06 | Manual retry command re-runs failed tasks idempotently | Section "Retry Idempotency" — re-compute `input_digest`, byte-compare, re-dispatch |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Actionable directives extracted from `./CLAUDE.md` (project root) that Phase 59 MUST honor:

- **Identity:** Agent "Clawdy" with 💠 emoji — informational only; no plan impact
- **Runtime:** Claude Code CLI sessions (persistent Claude Code processes) — tasks delegated to agent B run as turns inside B's Claude Code session via `TurnDispatcher`
- **Concurrency:** Multiple Claude Code processes running simultaneously — `TaskManager` operations must be safe for concurrent invocation from different agents (single-writer SQLite invariant preserved via the existing `TaskStore` daemon-scoped handle)
- **Locked tech stack:** TypeScript 6.0.2, Node.js 22 LTS, zod v4, nanoid, better-sqlite3, execa, Claude Agent SDK 0.2.x — Phase 59 introduces ZERO new runtime deps
- **What NOT to use:** no LangChain/LangGraph, no Redis/Postgres, no BullMQ/Agenda, no Prisma/Drizzle, no deprecated `@xenova/transformers` — Phase 59 has no temptation to reach for any of these, flagged for completeness
- **Workspace isolation (carried from earlier phases):** handoff payload is data-only; no caller-supplied execution environment; no shared mutable context across agents beyond the explicit schema fields (HAND-06 enforces)
- **GSD workflow:** Before Edit/Write, start work through a GSD command so planning artifacts stay in sync — research is itself inside `/gsd:research-phase`, compliant
- **STATE.md blocker carried forward:** `tasks.db is daemon-scoped (shared) — single-writer invariant must be preserved; any tool reading it must use a separate read-only handle` — Phase 59 writes to tasks.db ONLY via `TaskStore` instance already owned by the daemon; Phase 63 CLIs will open read-only

No CLAUDE.md directive conflicts with a CONTEXT.md locked decision.

## Standard Stack

### Core (all already installed — ZERO new deps for Phase 59)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | 4.3.6 | Payload validation at MCP entry + compiled task schemas | Locked stack at project level; already used by `src/tasks/schema.ts` / `src/config/schema.ts`. `zod/v4` import path already established |
| `nanoid` | 5.1.7 | `task_id` generation | Already used by `TurnOrigin.makeTurnId` (10-char). Use `nanoid(10)` for consistency; prefix task_id as `task:<nanoid(10)>` to match `TURN_ID_REGEX` at `src/manager/turn-origin.ts:57` |
| `better-sqlite3` | 12.8.0 | `TaskStore` persistence (already built in Phase 58) | Phase 59 is a pure consumer — no new DDL |
| `yaml` | 2.8.3 | Task schema YAML parsing in `~/.clawcode/task-schemas/` | Already used by `src/config/loader.ts:3` — reuse `parse as parseYaml` |
| `pino` | 9.x | Structured logging of handoff audit trail | Established pattern via `src/shared/logger.ts` child loggers |
| `@anthropic-ai/claude-agent-sdk` | 0.2.x | Provides `abortController` on `query` options for deadline propagation | Confirmed at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:957` — `Options.abortController?: AbortController` |
| Node `crypto.createHash` | built-in | `input_digest` + `result_digest` SHA-256 | Already used at `src/manager/context-assembler.ts:312` and `src/memory/tier-manager.ts:314` |

**Installation:** none. Every dependency is already in `package.json`.

**Version verification (via `npm view` on 2026-04-15):**

| Package | Project version | Latest registry | Gap |
|---------|-----------------|-----------------|-----|
| `zod` | 4.3.6 | current 4.x branch (project version) | none |
| `nanoid` | 5.1.7 | current 5.x | none |
| `better-sqlite3` | 12.8.0 | current 12.x | none |
| `yaml` | 2.8.3 | current 2.x | none |
| `@anthropic-ai/claude-agent-sdk` | 0.2.97 | current 0.2.x | none |

All versions verified current. No upgrades proposed (Phase 59 is purely additive on top of a locked stack).

### Alternatives Considered (all REJECTED)

| Instead of | Could use | Why rejected |
|------------|-----------|--------------|
| Hand-rolled JSON-Schema→Zod compiler | `json-schema-to-zod@2.8.1` | New dep; handles the full JSON Schema Draft-07 surface we don't need. Full $ref resolution, allOf gymnastics, format keywords, pattern regex — all baggage for a registry that CONTEXT deliberately restricts to "string/number/enum/object/array/union" per additional-context question 1. Hand-roll is ~150 LOC and we control the error messages and the "rejects unknown keys" semantics for HAND-06 |
| Hand-rolled JSON-Schema→Zod compiler | `ajv@8.18.0` | ajv is a JSON Schema **validator** — it would produce validation results, not Zod schemas. We want Zod because the daemon already speaks Zod everywhere (config, tasks, IPC protocol, MCP args) and the error shape is consistent. Using ajv would force every validation site to translate between two error formats |
| `crypto.createHash('sha256')` | `fast-json-stable-stringify` | Not needed — `src/shared/canonical-stringify.ts` already exists (Phase 55 Plan 02) with proven semantics (object key sorting, array order preservation, undefined/NaN/null normalization). Reuse it verbatim. Adding `fast-json-stable-stringify` duplicates this |
| Node's native `AbortController` | third-party cancellation libs | SDK natively supports `abortController` option — no wrapper needed |
| Per-agent MCP tool registration | Shared MCP tool with agent arg | Locked in CONTEXT Area 1 — shared TOOL_DEFINITIONS matches the `send_to_agent` + `ask_advisor` + `memory_lookup` pattern at `src/mcp/server.ts` |

## Architecture Patterns

### Recommended Project Structure

```
src/tasks/
├── errors.ts                 # EXTEND — add 6 handoff errors to existing file
├── schema.ts                 # keep as-is (Phase 58 owns TaskRowSchema)
├── types.ts                  # keep as-is (Phase 58 owns TaskStatus + transitions)
├── state-machine.ts          # keep as-is (Phase 58)
├── store.ts                  # keep as-is (Phase 58)
├── reconciler.ts             # keep as-is (Phase 58)
├── digest.ts                 # NEW — thin wrapper: computeInputDigest(payload) = sha256(canonicalStringify(payload))
├── handoff-schema.ts         # NEW — JSON-Schema→Zod compiler (~150 LOC hand-rolled)
├── schema-registry.ts        # NEW — SchemaRegistry class; loads ~/.clawcode/task-schemas/*.yaml, compiles once, caches, exposes .get(name)
├── authorize.ts              # NEW — pure functions: checkAllowlist, checkSelfHandoff, checkCycle, checkDepth
├── task-manager.ts           # NEW — TaskManager class: delegate, cancel, retry, dispatchResult
└── __tests__/
    ├── digest.test.ts
    ├── handoff-schema.test.ts
    ├── schema-registry.test.ts
    ├── authorize.test.ts
    └── task-manager.test.ts
```

**Why this layout:**

1. Matches the existing 58-01/02/03 convention — one concern per file, co-located tests
2. `digest.ts` is a 20-line module but separate because it's a primitive consumed by both `task-manager.ts` and CLI retry verification — single-responsibility
3. `handoff-schema.ts` is the JSON-Schema→Zod compiler; `schema-registry.ts` is the YAML loader + cache over it — clean separation so the compiler is test-isolated (no filesystem)
4. `authorize.ts` is pure functions (no state, no I/O) — testable without SQLite
5. `task-manager.ts` is the only stateful class with daemon dependencies (TaskStore, TurnDispatcher, SchemaRegistry, UsageTrackers, AbortController registry)

### Pattern 1: Shared MCP tool → IPC method → daemon handler

**What:** Every cross-cutting agent action lives as a `TOOL_DEFINITIONS` entry in `src/mcp/server.ts` mapped to an `IPC_METHODS` entry in `src/ipc/protocol.ts`, handled in `src/manager/daemon.ts` via a `case "<method-name>":` switch branch.

**When to use:** All three Phase 59 MCP tools (delegate_task, task_status, cancel_task) follow this — matches `send_to_agent`, `ask_advisor`, `memory_lookup` precedents.

**Example (adapted from existing `send-to-agent` at `src/manager/daemon.ts:1170`):**
```typescript
// src/mcp/server.ts — extend TOOL_DEFINITIONS
delegate_task: {
  description: "Delegate a typed task to another agent. Returns task_id immediately; result arrives as a new turn.",
  ipcMethod: "delegate-task",
},

// Tool handler (mirrors send_to_agent pattern at src/mcp/server.ts:530)
server.tool(
  "delegate_task",
  "Delegate a typed task...",
  {
    caller: z.string().describe("Your agent name"),
    target: z.string().describe("Target agent name"),
    schema: z.string().describe("Task schema name (e.g. 'research.brief')"),
    payload: z.record(z.string(), z.unknown()).describe("Task input payload matching the named schema"),
    deadline_ms: z.number().int().positive().optional().describe("Absolute wall-clock deadline (ms since epoch)"),
    budgetOwner: z.string().optional().describe("Override which agent's budget is charged (default: caller)"),
  },
  async ({ caller, target, schema, payload, deadline_ms, budgetOwner }) => {
    const result = (await sendIpcRequest(SOCKET_PATH, "delegate-task", {
      caller, target, schema, payload, deadline_ms, budgetOwner,
    })) as { task_id: string };
    return { content: [{ type: "text" as const, text: JSON.stringify({ task_id: result.task_id }) }] };
  },
);
```

### Pattern 2: Daemon-scoped singleton wiring

**What:** The `TaskManager` is constructed once at daemon boot (after `TaskStore` + `TurnDispatcher`, before `SessionManager.startAll`) and passed by reference into the IPC handler closure.

**When to use:** Matches the Phase 58 precedent for `taskStore` at `src/manager/daemon.ts:458`.

**Example:**
```typescript
// src/manager/daemon.ts — after step 6-ter (existing TaskStore init)

// 6-quater. Create TaskManager singleton (Phase 59).
const taskManager = new TaskManager({
  store: taskStore,
  turnDispatcher,
  sessionManager: manager,
  schemaRegistry: await SchemaRegistry.load(),
  getUsageTracker: (agent) => manager.getUsageTracker(agent),
  getAgentConfig: (agent) => configs.find(c => c.name === agent),
  log,
});
log.info({ schemaCount: taskManager.schemaCount }, "TaskManager initialized");

// Later in the return value:
return { server, manager, taskStore, taskManager, /* ... */ };
```

### Pattern 3: Pure-function authorization layered BEFORE I/O

**What:** Each check is a pure function that takes the TaskStore + request and throws the typed error. They compose in a fixed order, cheapest first.

**Why:** Matches the Phase 58 `assertLegalTransition` pattern — pure functions over data, fail fast with typed errors, zero side effects so unit tests don't need SQLite.

**Example:**
```typescript
// src/tasks/authorize.ts
export function checkSelfHandoff(caller: string, target: string): void {
  if (caller === target) throw new SelfHandoffBlockedError(caller);
}

export function checkDepth(depth: number, max: number): void {
  if (depth > max) throw new DepthExceededError(depth, max);
}

export function checkCycle(store: TaskStore, target: string, parentTaskId: string | null): void {
  let cursor = parentTaskId;
  while (cursor) {
    const row = store.get(cursor);
    if (!row) break;
    if (row.target_agent === target || row.caller_agent === target) {
      throw new CycleDetectedError(target, cursor);
    }
    cursor = row.parent_task_id;
  }
}

export function checkAllowlist(
  targetAgentConfig: ResolvedAgentConfig,
  caller: string,
  schema: string,
): void {
  const allowed = targetAgentConfig.acceptsTasks?.[schema];
  if (!allowed || !allowed.includes(caller)) {
    throw new UnauthorizedError(caller, targetAgentConfig.name, schema);
  }
}
```

### Anti-Patterns to Avoid

- **Sync await inside MCP tool handler** — would deadlock when A and B both hold turns. The `delegate_task` handler MUST return `{ task_id }` immediately; result arrives as a separate turn dispatch (locked in CONTEXT Area 1).
- **Agent writes directly to tasks.db** — violates the single-writer invariant (STATE.md Phase 58 blocker). All writes go through `TaskManager` → `TaskStore`.
- **Hand-rolling canonical JSON** — use `canonicalStringify` from `src/shared/canonical-stringify.ts`. Do NOT introduce `fast-json-stable-stringify`. Do NOT use `JSON.stringify(obj, keys.sort())` — that only sorts top-level keys.
- **Throwing un-typed errors from `TaskManager`** — every error path must use one of the 6 handoff error classes so MCP / IPC layers can translate to typed responses (matches Phase 58's `IllegalTaskTransitionError` precedent).
- **Skipping the allowlist by convention** — even if A and B are both "system" agents, the allowlist check must execute. Default deny is required for HAND-04.
- **Leaking ambient context in payload validation** — the Zod schema for each task MUST reject unknown keys (Zod `.strict()` equivalent in v4). HAND-06 is a correctness requirement, not a nicety.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Canonical JSON for digests | Custom key-sorting stringify | `canonicalStringify` at `src/shared/canonical-stringify.ts` | Already implements all edge cases (undefined→null, NaN→null, recursive key sort, array order preservation). Locked semantics in Phase 55 — don't divergence-drift |
| Task turn dispatch | Direct `sessionManager.sendToAgent` | `turnDispatcher.dispatch(origin, agentName, message)` | Phase 57 foundation. TurnOrigin auto-records. Trace lifecycle automatic. Matches Discord/scheduler hot paths |
| Task row persistence | Direct better-sqlite3 calls | `taskStore.insert / transition / get` | Phase 58 owns state machine enforcement. `assertLegalTransition` runs inside `transition()` |
| Abort / cancellation primitives | Custom timer + callback rig | Node native `AbortController` + SDK `abortController` option | SDK's `Options.abortController` at `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:957` is the supported entry point |
| Task_id generation | Random string | `nanoid(10)` + `task:` prefix | Matches `TURN_ID_REGEX` `/^(discord\|scheduler\|task\|trigger):[a-zA-Z0-9_-]{10,}$/` at `src/manager/turn-origin.ts:57` — preserves trace-id continuity |
| YAML parsing | Custom parser | `parse as parseYaml` from `yaml` | Already used at `src/config/loader.ts:3`. Ensures consistent YAML dialect across project |
| Typed error base | `Error` subclass from scratch | Mirror `TaskNotFoundError` at `src/tasks/errors.ts:52` | Sets `this.name`, exposes readonly context fields, grep-able format |
| Per-agent config loading | New loader | Extend `agentSchema` in `src/config/schema.ts:327`; `resolveAgentConfig` automatically picks up new fields | ConfigReloader already re-parses on file change — no new reload path needed |

**Key insight:** Every primitive Phase 59 needs is already in the codebase. The phase is about composition, not new capability.

## Runtime State Inventory

Phase 59 is greenfield — no renames, no refactors, no migrations. No runtime state inventory needed.

(Explicitly: Phase 58 already owns `tasks.db` schema and creation; Phase 59 writes rows via `TaskStore.insert` and `TaskStore.transition` through the existing daemon handle. No DDL changes in Phase 59.)

## Common Pitfalls

### Pitfall 1: Sync-RPC deadlock (PITFALL-03 from STATE.md)

**What goes wrong:** If A's `delegate_task` call awaits B's result, A holds its Claude Code session blocked on B. If B later needs to delegate back to A (even indirectly via a third agent), the whole chain deadlocks.

**Why it happens:** Naive mental model from HTTP RPC. Async-ticket breaks the wait state.

**How to avoid:** `delegate_task` returns `{ task_id }` immediately. A's turn ends. Result arrives as a **new** turn with `TurnOrigin{kind:'task'}`. This is the CORE architectural invariant of Phase 59 — locked in CONTEXT Area 1.

**Warning signs:** Any code path in `TaskManager.delegate()` that does `await waitFor(taskComplete)` or similar. The method MUST return synchronously once the row is inserted + B's turn is dispatched.

### Pitfall 2: Partial payload validation (payload bypasses size cap)

**What goes wrong:** A 10 MB payload gets Zod-parsed — runs through every `z.object` walk, allocates intermediate objects, potentially breaks the event loop — BEFORE the daemon realizes it exceeds 64 KB.

**Why it happens:** Natural code order is "parse first, validate afterwards" — but parsing is the expensive work.

**How to avoid:** `Buffer.byteLength(JSON.stringify(payload), 'utf8')` BEFORE Zod parse. Throw `ValidationError('payload_too_large', size, 64 * 1024)` on overflow. This is step 3 of the 6-step authorization order (CONTEXT specifics).

**Warning signs:** Zod error on a payload that should have been rejected for size — means the order is wrong.

### Pitfall 3: input_digest non-determinism (retry fails integrity check)

**What goes wrong:** `clawcode tasks retry <task_id>` re-computes `input_digest` from the original payload (stored in trace metadata or reconstructed from logs) but the recomputed digest differs from the stored one because key order, whitespace, or undefined/null coercion drifted.

**Why it happens:** `JSON.stringify({b: 1, a: 2})` is `'{"b":1,"a":2}'` but `JSON.stringify({a: 2, b: 1})` is `'{"a":2,"b":1}'`. Same logical payload, different digest.

**How to avoid:** Always route through `canonicalStringify` → `createHash('sha256').update(...).digest('hex')`. Never `JSON.stringify` directly. `canonicalStringify` normalizes: recursive key sort, `undefined→null`, `NaN→null`, array order preserved (see `src/shared/canonical-stringify.ts:35`).

**Warning signs:** Integration test "insert row, retry by id, compare digests" should be a Wave 2 gate. If it fails, the retry path will be useless.

### Pitfall 4: AbortSignal doesn't actually abort B's turn

**What goes wrong:** Deadline elapses, `TaskManager` calls `abortController.abort()`, but B's Claude Code process keeps running because the SDK's `query({ options })` didn't receive the controller.

**Why it happens:** Current `SessionManager.streamFromAgent` / `sendToAgent` signature does NOT accept `AbortSignal`. The SDK supports it (`Options.abortController`) but the wiring stops at the session adapter. Phase 59 needs to thread it through.

**How to avoid:** Extend `SessionHandle.sendAndCollect` / `sendAndStream` to accept an optional `{ signal?: AbortSignal }`. Thread into `turnOptions()` in `wrapSdkQuery` (`src/manager/session-adapter.ts:516`) as `abortController: new AbortController()` where the controller is wired to the passed signal. Then `TurnDispatcher.dispatch` gets a new option to pass it through. This is a small but load-bearing plumbing change — call it out as a Wave 3 task.

**Warning signs:** Test "set deadline 100ms; delegate task that takes 5s; verify task.status === 'timed_out' AND B's session did not actually reply" fails — B kept generating while the row was already marked timed_out.

**Concrete additive change** (Wave 3, small scope):
```typescript
// src/manager/session-adapter.ts — add to SessionHandle shape
sendAndCollect: (message: string, turn?: Turn, options?: { signal?: AbortSignal }) => Promise<string>;

// In wrapSdkQuery turnOptions, when signal provided:
const abortController = new AbortController();
if (options?.signal) {
  if (options.signal.aborted) abortController.abort();
  else options.signal.addEventListener('abort', () => abortController.abort(), { once: true });
}
return { ...rest, abortController };
```

The SDK type (`Options.abortController?: AbortController`) confirms this is supported — no SDK patch needed.

### Pitfall 5: Schema hot-reload during in-flight task

**What goes wrong:** Operator edits `~/.clawcode/task-schemas/research.brief.yaml` while task is mid-flight. If TaskManager re-resolves the schema from disk at completion time, the output validation may use a different shape than the input validation.

**Why it happens:** Two snapshot points (accept payload now, validate result later) for the same logical "task" — they'd better see the same schema version.

**How to avoid:** `SchemaRegistry` loads ALL schemas ONCE at daemon start (or explicit reload). In-flight tasks cache a reference to their compiled Zod object at `delegate()` time. Use `Map<task_id, { inputSchema, outputSchema }>`. Result validation uses the cached pair. This is simpler than versioning schemas and matches the 58-03 "reconcile at startup, not periodically" cadence.

**Warning signs:** Flaky "edit schema, retry completes with the wrong shape" tests.

### Pitfall 6: Cost attribution double-counting

**What goes wrong:** B's turn tokens land in B's `usage_events` (via existing per-turn usageCallback) AND get re-added to A's budget via handoff cost attribution — same tokens counted twice.

**Why it happens:** `SessionManager.startAgent` wires a `usageCallback` that calls `usageTrackers.get(B).record(...)`. Phase 59's cost attribution ALSO wants those tokens attributed to A.

**How to avoid:** Decide explicitly: tokens land in B's usage_events (keeps per-agent visibility for Phase 40 cost reports), but the `tasks.chain_token_cost` field rolls up against A's budget via `escalationBudget.recordUsage(A, model, tokens)` at task completion. Two separate accounting dimensions. Document the rule in the TaskManager docstring.

**Warning signs:** Test "delegate from A to B, B consumes 1000 tokens, check A's budget increased by 1000 AND B's usage_events sum equals 1000" — both must pass.

### Pitfall 7: Result payload shape ambiguity

**What goes wrong:** B completes its turn but the daemon has no structured way to extract the "result" — is it B's final assistant message? A specific MCP tool call B made? B's last structured log line?

**Why it happens:** CONTEXT doesn't lock this and additional-context question 5 explicitly flags it.

**How to avoid:** Ship `task_complete` as a **FOURTH MCP tool** (part of Wave 3) that B calls at the END of its turn with the structured output. `task_complete({ task_id, result_payload })`. Inside the handler: Zod-validate `result_payload` against the schema's `output` definition, compute `result_digest`, transition task to `complete`, then dispatch result-back-to-A turn. B's turn message can contain "natural language" narration AND the structured result — the result ONLY flows via `task_complete` call. Clearer than trying to parse B's assistant text.

**Note:** CONTEXT.md Tool set shipped says "delegate_task + task_status + cancel_task as MCP tools" — does NOT mention `task_complete`. The roadmap Phase 59 summary at `.planning/ROADMAP.md:95` lists `task_complete` explicitly as part of the phase. **This is a decision the planner must escalate to the user.** Recommend `task_complete` be added. Without it, the phase has no clean way for B to deliver structured results — the ROADMAP.md entry appears to intend it.

**Planner action:** Confirm with user whether `task_complete` ships in 59 (recommended) or is deferred. If deferred, the fallback is: parse B's final assistant message as JSON matching the output schema. This is fragile (Claude's prose sometimes wraps JSON in markdown fences). Strongly recommend shipping the MCP tool.

### Pitfall 8: Retry charges the wrong budget

**What goes wrong:** Operator retries a failed task from 3 days ago. System charges the tokens against the ORIGINAL caller's budget from 3 days ago (retroactive) OR against the retry-issuing operator's budget (not a real agent).

**Why it happens:** Additional context question 7 explicitly flags this.

**How to avoid:** Retry re-charges the **original caller_agent** (the one on the tasks row) — NOT the operator who issued `clawcode tasks retry`. Rationale: the retry is logically the same work the caller asked for; budget attribution should be consistent. Document this in the CLI command help text. No alternative interpretation is meaningfully better (the operator is not a budgeted entity — no `escalationBudget` config for them).

**Warning signs:** Budget reports showing "system" or "cli" as a budget consumer — means the wrong identity was charged.

## Code Examples

Verified patterns from the existing codebase (cited line numbers so planner can reference):

### Example 1: Typed handoff error class (extend `src/tasks/errors.ts`)

```typescript
// Add to src/tasks/errors.ts (follows existing TaskNotFoundError pattern at line 52)

export class ValidationError extends Error {
  readonly reason: "payload_too_large" | "schema_mismatch" | "unknown_schema" | "output_invalid";
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    reason: ValidationError["reason"],
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(`Validation failed (${reason}): ${message}`);
    this.name = "ValidationError";
    this.reason = reason;
    this.details = Object.freeze({ ...details });
  }
}

export class UnauthorizedError extends Error {
  readonly caller: string;
  readonly target: string;
  readonly schema: string;

  constructor(caller: string, target: string, schema: string) {
    super(`Agent '${caller}' is not authorized to delegate schema '${schema}' to '${target}'`);
    this.name = "UnauthorizedError";
    this.caller = caller;
    this.target = target;
    this.schema = schema;
  }
}

export class CycleDetectedError extends Error {
  readonly target: string;
  readonly foundAtTaskId: string;

  constructor(target: string, foundAtTaskId: string) {
    super(`Handoff cycle detected: '${target}' already appears in the causation chain at task '${foundAtTaskId}'`);
    this.name = "CycleDetectedError";
    this.target = target;
    this.foundAtTaskId = foundAtTaskId;
  }
}

export class DepthExceededError extends Error {
  readonly depth: number;
  readonly max: number;

  constructor(depth: number, max: number) {
    super(`Handoff depth ${depth} exceeds MAX_HANDOFF_DEPTH=${max}`);
    this.name = "DepthExceededError";
    this.depth = depth;
    this.max = max;
  }
}

export class SelfHandoffBlockedError extends Error {
  readonly agent: string;

  constructor(agent: string) {
    super(`Agent '${agent}' cannot delegate to itself`);
    this.name = "SelfHandoffBlockedError";
    this.agent = agent;
  }
}

export class DeadlineExceededError extends Error {
  readonly taskId: string;
  readonly deadlineMs: number;

  constructor(taskId: string, deadlineMs: number) {
    super(`Task '${taskId}' exceeded deadline (${deadlineMs}ms)`);
    this.name = "DeadlineExceededError";
    this.taskId = taskId;
    this.deadlineMs = deadlineMs;
  }
}
```

### Example 2: `input_digest` via existing canonical stringify

```typescript
// src/tasks/digest.ts
import { createHash } from "node:crypto";
import { canonicalStringify } from "../shared/canonical-stringify.js";

/**
 * Phase 59 — deterministic payload → sha256 hex digest.
 *
 * Same logical payload always produces the same digest, regardless of key
 * insertion order or undefined/null coercion. Consumed by TaskManager.delegate
 * (stores on row insert) and TaskManager.retry (re-validates before re-dispatch
 * — byte-exact match required).
 */
export function computeInputDigest(payload: unknown): string {
  const canonical = canonicalStringify(payload);
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
```

(Source: `src/shared/canonical-stringify.ts:35` and `src/manager/context-assembler.ts:327` for the existing `createHash('sha256')` pattern.)

### Example 3: Hand-rolled JSON-Schema→Zod compiler (Wave 1)

```typescript
// src/tasks/handoff-schema.ts
import { z, type ZodTypeAny } from "zod/v4";
import { ValidationError } from "./errors.js";

/**
 * Minimal JSON-Schema subset compiled to Zod v4. Supports:
 *   - Primitives: string, number, integer, boolean, null
 *   - Compound: object (with required[]), array (items), enum (const-list), oneOf (union)
 *   - Constraints: minLength, maxLength, minimum, maximum, minItems, maxItems
 *
 * Unsupported (throws ValidationError at compile time):
 *   - $ref, allOf, anyOf, not, patternProperties, additionalProperties other than false,
 *     format (date-time etc.), pattern (regex), dependencies, if/then/else
 *
 * Unknown-keys policy: objects compile to `z.object(shape).strict()` so any unknown
 * top-level key is REJECTED (HAND-06 explicit payload boundary).
 */
export type JsonSchema = Readonly<{
  type?: "string" | "number" | "integer" | "boolean" | "null" | "object" | "array";
  enum?: readonly unknown[];
  oneOf?: readonly JsonSchema[];
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  items?: JsonSchema;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}>;

export function compileJsonSchema(schema: JsonSchema, path = "#"): ZodTypeAny {
  // enum wins over type
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.map((v) => z.literal(v as string | number | boolean | null));
    if (values.length === 1) return values[0];
    return z.union(values as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const compiled = schema.oneOf.map((s, i) => compileJsonSchema(s, `${path}/oneOf/${i}`));
    if (compiled.length === 1) return compiled[0];
    return z.union(compiled as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  }

  switch (schema.type) {
    case "string": {
      let s = z.string();
      if (schema.minLength !== undefined) s = s.min(schema.minLength);
      if (schema.maxLength !== undefined) s = s.max(schema.maxLength);
      return s;
    }
    case "integer": {
      let n = z.number().int();
      if (schema.minimum !== undefined) n = n.min(schema.minimum);
      if (schema.maximum !== undefined) n = n.max(schema.maximum);
      return n;
    }
    case "number": {
      let n = z.number();
      if (schema.minimum !== undefined) n = n.min(schema.minimum);
      if (schema.maximum !== undefined) n = n.max(schema.maximum);
      return n;
    }
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array": {
      if (!schema.items) {
        throw new ValidationError("unknown_schema", `array schema at ${path} missing 'items'`, { path });
      }
      let a = z.array(compileJsonSchema(schema.items, `${path}/items`));
      if (schema.minItems !== undefined) a = a.min(schema.minItems);
      if (schema.maxItems !== undefined) a = a.max(schema.maxItems);
      return a;
    }
    case "object": {
      const shape: Record<string, ZodTypeAny> = {};
      const required = new Set(schema.required ?? []);
      for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
        const inner = compileJsonSchema(subSchema, `${path}/properties/${key}`);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      // HAND-06: reject unknown keys by default.
      return z.object(shape).strict();
    }
    default:
      throw new ValidationError("unknown_schema", `unsupported schema type at ${path}: ${schema.type}`, { path });
  }
}
```

### Example 4: Config schema extension for `acceptsTasks`

```typescript
// Add to src/config/schema.ts agentSchema (at line 327)

// New optional field — default undefined means "accepts no tasks"
acceptsTasks: z.record(
  z.string().min(1),                    // schema name (e.g. "research.brief")
  z.array(z.string().min(1)),           // caller agent names allowed
).optional(),
```

Then extend `src/shared/types.ts` `ResolvedAgentConfig` with the same field, and `resolveAgentConfig` at `src/config/loader.ts:46` automatically picks it up (matches existing `acceptsTasks ?? undefined` inheritance pattern).

### Example 5: AbortController threading

```typescript
// src/tasks/task-manager.ts (excerpt)
private readonly inflight = new Map<string, AbortController>();

async delegate(req: DelegateRequest): Promise<{ task_id: string }> {
  // ... all 6 authorization steps ...
  const taskId = `task:${nanoid(10)}`;
  const controller = new AbortController();
  this.inflight.set(taskId, controller);

  // Deadline propagation
  const deadlineMs = req.deadline_ms ?? this.inheritDeadlineFromChain(parentTaskId);
  if (deadlineMs) {
    const remaining = deadlineMs - Date.now();
    if (remaining > 0) {
      setTimeout(() => {
        controller.abort();
        void this.handleTimeout(taskId, deadlineMs);
      }, remaining).unref();  // unref so the timer doesn't keep the process alive
    }
  }

  this.store.insert(row);

  // Dispatch B's turn via TurnDispatcher — async, don't await here.
  void this.turnDispatcher
    .dispatch(childOrigin, req.target, formattedPrompt, { signal: controller.signal })
    .catch((err) => this.handleDispatchError(taskId, err));

  return { task_id: taskId };
}
```

## State of the Art

No "old → new" migration relevant to Phase 59 — all sub-choices are greenfield picks from a stable stack. No deprecated feature concerns.

One current-as-of-2026 note: Zod v4 (project uses `zod/v4` import path) is the current line. Phase 59 does NOT need to consider Zod v5 migration (not released). The JSON-Schema subset compiler targets v4 idioms (`.strict()`, `z.union`, `z.literal`).

## Open Questions

1. **Does `task_complete` ship as the fourth MCP tool in Phase 59?**
   - What we know: CONTEXT Area 1 "Tool set shipped" lists three (delegate_task + task_status + cancel_task). ROADMAP.md Phase 59 entry explicitly includes `task_complete` in its tool list. Pitfall 7 above surfaces why the tool is the clean way to receive structured results.
   - What's unclear: Was `task_complete` intentionally excluded from CONTEXT or is it an oversight?
   - Recommendation: **Planner confirms with user during plan-check. Strongly recommend shipping it in Phase 59.** Without it, result dispatch requires parsing B's assistant text as JSON — fragile and undocumented. Adding it is ~40 LOC (one more TOOL_DEFINITIONS entry + one IPC method + TaskManager.completeTask method).

2. **How is the result turn formatted for A — what does A actually see?**
   - What we know: `TurnOrigin{kind:'task', id: task_id, rootTurnId, chain}` carries provenance. But what's the STRING content of the new turn's message?
   - What's unclear: Is it `"Task <id> completed: <JSON result>"` (templated)? Or the raw result_payload rendered as Markdown? Or configurable?
   - Recommendation: Plan 59-03 picks a simple template: `"Task '${schemaName}' completed. Result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`"`. Failed-task template: `"Task '${schemaName}' FAILED: ${error}"`. Timed-out template: `"Task '${schemaName}' TIMED OUT after ${deadlineMs}ms"`. Operators who want fancier formatting can open a follow-up — not a v1.8 concern.

3. **Does `task_status` MCP tool return full row shape or a minimal subset?**
   - What we know: CONTEXT says it's an MCP tool but doesn't lock the shape.
   - What's unclear: Full 15-field row? Or `{ status, started_at, ended_at, error? }`?
   - Recommendation: Minimal — `{ task_id, status, error?: string, result?: unknown }`. Status polling via MCP during long-running tasks is the use case; agents shouldn't need depth/causation internals. (Phase 63 CLI can return the full row.)

4. **Where does `MAX_HANDOFF_DEPTH = 5` live as a constant?**
   - What we know: Locked at 5 per CONTEXT.
   - Recommendation: `src/tasks/task-manager.ts` module-level `export const MAX_HANDOFF_DEPTH = 5;`. Fine to reference from tests and downstream phases.

5. **`task_type` field semantics** (Phase 58 row has this; what goes in it?)
   - What we know: `TaskRow.task_type` is `z.string().min(1)` at `src/tasks/schema.ts:32`.
   - Recommendation: For delegate_task rows, `task_type` = schema name (e.g. `"research.brief"`). This is the natural identifier — matches the schema registry key — and lets Phase 63 `clawcode tasks --type` filter by schema name.

## Environment Availability

Phase 59 depends only on facilities ALREADY present in the running daemon:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `crypto` module | `input_digest` hashing | ✓ | Node 22 LTS built-in | — |
| Node.js `AbortController` | Deadline propagation | ✓ | Node 22 LTS built-in | — |
| `@anthropic-ai/claude-agent-sdk` | `abortController` option on query | ✓ | 0.2.97 (verified at `sdk.d.ts:957`) | — |
| `better-sqlite3` | Already-open TaskStore handle | ✓ | 12.8.0 | — |
| `~/.clawcode/task-schemas/` directory | Schema registry source | ✗ at first-boot | — | SchemaRegistry creates directory on load-fail with a log.warn + "zero schemas registered" empty state. System works for agents with no `acceptsTasks:` config (which is all of them on day 1) |

**Missing dependencies with fallback:**
- `~/.clawcode/task-schemas/` — first-boot does not block; directory is created on demand when the first schema is saved. Wave 1 SchemaRegistry.load() returns empty registry if dir missing.

**No blocking dependencies.** Phase 59 is purely additive on top of an existing daemon.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.3 (already installed at `package.json:39`) |
| Config file | `vitest.config.ts` at repo root (existing) |
| Quick run command | `npx vitest run src/tasks/__tests__/task-manager.test.ts` (per-file) |
| Full suite command | `npm test` (runs `vitest run --reporter=verbose`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HAND-01 | `delegate_task` returns `{task_id}` immediately without awaiting B | unit | `npx vitest run src/tasks/__tests__/task-manager.test.ts -t "returns task_id immediately"` | ❌ Wave 2 |
| HAND-01 | `delegate_task` MCP tool is registered in TOOL_DEFINITIONS | unit | `npx vitest run src/mcp/server.test.ts -t "defines delegate_task"` | ❌ Wave 3 |
| HAND-02 | Oversize payload (>64KB) rejected BEFORE Zod parse | unit | `npx vitest run src/tasks/__tests__/task-manager.test.ts -t "rejects oversize payload"` | ❌ Wave 2 |
| HAND-02 | Schema-invalid payload throws ValidationError | unit | `npx vitest run src/tasks/__tests__/handoff-schema.test.ts` | ❌ Wave 1 |
| HAND-02 | Unknown-key payload rejected via `.strict()` | unit | `npx vitest run src/tasks/__tests__/handoff-schema.test.ts -t "rejects unknown keys"` | ❌ Wave 1 |
| HAND-03 | Deadline elapsed → task status becomes `timed_out` + AbortSignal fires | integration | `npx vitest run src/tasks/__tests__/task-manager.test.ts -t "times out at deadline"` | ❌ Wave 2 |
| HAND-04 | Unauthorized caller rejected with UnauthorizedError | unit | `npx vitest run src/tasks/__tests__/authorize.test.ts -t "checkAllowlist"` | ❌ Wave 1 |
| HAND-04 | Default-deny when no `acceptsTasks` entry | unit | `npx vitest run src/tasks/__tests__/authorize.test.ts -t "default deny"` | ❌ Wave 1 |
| HAND-05 | Depth > MAX_HANDOFF_DEPTH throws DepthExceededError | unit | `npx vitest run src/tasks/__tests__/authorize.test.ts -t "checkDepth"` | ❌ Wave 1 |
| HAND-05 | Target present in causation chain throws CycleDetectedError | unit | `npx vitest run src/tasks/__tests__/authorize.test.ts -t "checkCycle"` | ❌ Wave 1 |
| HAND-06 | Unknown keys rejected (also covers via strict Zod, same as HAND-02) | unit | shared with HAND-02 above | ❌ Wave 1 |
| HAND-07 | caller === target throws SelfHandoffBlockedError | unit | `npx vitest run src/tasks/__tests__/authorize.test.ts -t "checkSelfHandoff"` | ❌ Wave 1 |
| LIFE-05 | Tokens count against caller's EscalationBudget on task completion | integration | `npx vitest run src/tasks/__tests__/task-manager.test.ts -t "attributes cost to caller"` | ❌ Wave 2 |
| LIFE-05 | `budgetOwner` override charges the named agent | integration | `npx vitest run src/tasks/__tests__/task-manager.test.ts -t "budgetOwner override"` | ❌ Wave 2 |
| LIFE-06 | `clawcode tasks retry <task_id>` re-dispatches with identical `input_digest` | integration | `npx vitest run src/cli/commands/__tests__/tasks.test.ts -t "retry preserves digest"` | ❌ Wave 3 |
| LIFE-06 | Retry of a task with mutated payload (digest mismatch) throws | integration | `npx vitest run src/tasks/__tests__/task-manager.test.ts -t "retry rejects mutated payload"` | ❌ Wave 2 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/tasks/__tests__/ src/mcp/__tests__/ src/ipc/__tests__/` (fast, ~2s)
- **Per wave merge:** `npm test` (full suite, ~20-30s)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

The Phase 59 planner will land these as first-task-of-wave scaffolds (Wave 0 here means "pre-implementation file creation"):

- [ ] `src/tasks/__tests__/digest.test.ts` — covers computeInputDigest determinism
- [ ] `src/tasks/__tests__/handoff-schema.test.ts` — covers JSON-Schema→Zod compiler (8 primitives + object strict + array + enum + union)
- [ ] `src/tasks/__tests__/schema-registry.test.ts` — covers YAML load + compile + cache + invalid-YAML graceful fallback
- [ ] `src/tasks/__tests__/authorize.test.ts` — covers 4 pure checker functions
- [ ] `src/tasks/__tests__/task-manager.test.ts` — covers delegate / cancel / retry / dispatchResult end-to-end with mock dispatcher
- [ ] `src/mcp/__tests__/server.test.ts` — EXTEND existing file with 3 (or 4) new `it(...)` blocks for TOOL_DEFINITIONS entries
- [ ] `src/ipc/__tests__/protocol.test.ts` — EXTEND existing `toEqual` assertion with the 4 new IPC methods (Phase 50 protocol parity lesson)
- [ ] `src/cli/commands/tasks.ts` + `__tests__/tasks.test.ts` — new CLI file, retry subcommand + status subcommand (Phase 63 will extend with list)
- [ ] `src/config/__tests__/schema.test.ts` — if it exists, add `acceptsTasks` shape test. If not, one is not blocking — Zod will catch regressions at daemon startup.

No framework install needed — Vitest is already wired.

## Sources

### Primary (HIGH confidence)

- Project codebase — direct reads of:
  - `.planning/phases/59-cross-agent-rpc-handoffs/59-CONTEXT.md` — all locked decisions
  - `.planning/REQUIREMENTS.md` — HAND-01..07, LIFE-05, LIFE-06 contracts
  - `.planning/ROADMAP.md` Phase 59 — success criteria, task_complete hint
  - `.planning/STATE.md` — prior phase completion state
  - `src/tasks/store.ts`, `schema.ts`, `types.ts`, `errors.ts`, `state-machine.ts`, `reconciler.ts` — Phase 58 substrate
  - `src/manager/turn-dispatcher.ts`, `turn-origin.ts` — Phase 57 substrate
  - `src/manager/session-manager.ts`, `session-adapter.ts` — session layer abort hooks
  - `src/mcp/server.ts` — TOOL_DEFINITIONS pattern
  - `src/ipc/protocol.ts`, `server.ts` — IPC_METHODS registry
  - `src/config/schema.ts`, `loader.ts` — agentSchema extension target
  - `src/usage/tracker.ts`, `budget.ts` — cost attribution hooks
  - `src/shared/canonical-stringify.ts` — reusable canonical JSON (key finding)
  - `src/shared/errors.ts` — typed error base conventions
  - `src/manager/daemon.ts` — startDaemon wiring precedent (lines 440-480, 770-820)
  - `src/tasks/__tests__/store.test.ts` — test harness patterns
  - `src/ipc/__tests__/protocol.test.ts` — protocol-parity test pattern
  - `src/mcp/server.test.ts` — TOOL_DEFINITIONS test pattern
  - `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:957` — `Options.abortController?: AbortController` confirms SDK-native deadline support
  - `package.json` — stack/version inventory

- npm registry (verified 2026-04-15 via `npm view`):
  - `json-schema-to-zod@2.8.1` (rejected alternative — documented)
  - `ajv@8.18.0` (rejected alternative — documented)

### Secondary (MEDIUM confidence)

- None. All claims in this document are backed by direct source reads.

### Tertiary (LOW confidence)

- None flagged.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package is already in `package.json`, no new deps
- Architecture: HIGH — 57/58 precedent is direct, TurnDispatcher and TaskStore integrations are mechanical
- Pitfalls: HIGH — each is either cited from STATE.md (PITFALL-03) or derivable from code inspection (AbortSignal threading, cost double-counting, schema hot-reload cache)
- Test coverage: HIGH — Vitest already wired, co-located test convention in place

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days — stack is stable, no fast-moving externals)
