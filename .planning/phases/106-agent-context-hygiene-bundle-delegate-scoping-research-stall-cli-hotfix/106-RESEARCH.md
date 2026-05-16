# Phase 106: Agent context hygiene bundle — delegate scoping + research stall + CLI hot-fix — Research

**Researched:** 2026-04-30
**Domain:** TypeScript / Node.js — agent prompt assembly, daemon IPC contract, async-startup telemetry
**Confidence:** HIGH (all three bugs verified by direct code inspection; STALL-02 telemetry shape matches existing patterns)

## Summary

Three small, independent bugs share the same Phase 999.13–999.15 substrate and ship together as one bundle. All three are root-caused via direct file inspection — no speculation:

1. **DSCOPE** — `subagentThreadSpawner.spawn()` builds `subagentConfig` via spread of the parent `sourceConfig`, which carries `delegates` verbatim. The subagent then runs through the SAME `buildSessionConfig` path as the parent, calls `renderDelegatesBlock(config.delegates)`, and gets the "## Specialist Delegation" directive in its system prompt. Recursion happens, SDK guard blocks the actual spawn, agent stalls.
2. **STALL** — research/fin-research warmup stalls AFTER memory-scanner-watching but BEFORE warm-path. The warm-path itself has a 10s timeout (`WARM_PATH_TIMEOUT_MS`) but the work that runs BETWEEN memory-scanner-start (line ~508 in session-manager via daemon wiring) and `runWarmPathCheck` (line 895) has NO outer timeout: `buildSessionConfig` (line 725), `adapter.createSession` (line 754), the polled MCP-discovery `void async` (line 780), and persisted-effort read (line 856). Most likely culprit per logs: `adapter.createSession` blocking on SDK MCP cold-start. STALL-02 wraps the entire `startAgent` body with a 60s sentinel that emits structured telemetry on stall.
3. **TRACK-CLI** — `mcp-tracker-snapshot` is registered as a switch case in `daemon.ts:3754` BUT is missing from the `IPC_METHODS` z.enum tuple in `src/ipc/protocol.ts`. The IPC server validates the method against the enum (`server.ts:74`); missing methods are rejected with `{code: -32600, message: "Invalid Request"}` BEFORE the daemon's switch ever runs. Direct precedent: commit `a9c39c7 fix(96-05): add probe-fs + list-fs-status to IPC_METHODS enum (96-05 wired CLI+handler+slash but missed protocol schema; deploy-blocking 'Invalid Request')`.

**Primary recommendation:** Three surgical fixes, single PR. DSCOPE in `subagent-thread-spawner.ts` (1 line: omit `delegates` from spread). STALL-02 in `session-manager.ts` (sentinel timer wrapping `startAgent`). TRACK-CLI in `protocol.ts` (1 line: append to enum) + `protocol.test.ts` (1 line: append to expected list).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices at Claude's discretion — three small fixes, scope locked. Use established conventions:

- **Phase 999.13 substrate** — `renderDelegatesBlock` and `delegatesBlock` injection in `context-assembler.ts` already exist. DSCOPE extends them.
- **Phase 999.6 telemetry pattern** — `level: 50` warn logs with structured fields for operator-grep.
- **Phase 999.15 IPC pattern** — `sendIpcRequest(SOCKET_PATH, "method-name", params)` shape. Easy to verify end-to-end.

**DSCOPE:**
- Subagent prompt assembly path: identify it AND inject the `isSubagent` flag at exactly one place. NO duplicate "skip delegates" guards in multiple files.
- Tests assert byte-identical primary-agent prompt (regression lock from 999.13 Plan 01).
- Tests assert byte-identical subagent prompt across "config has delegates" vs "config does NOT have delegates" cases (the directive is invisible to subagents either way).

**STALL:**
- INVESTIGATION FIRST: don't assume MCP cold-start is the cause. Reproduce on clawdy with controlled steps. If reproduce fails, the issue may have been a one-off transient. STALL-02 telemetry still ships regardless.
- Telemetry log line is structured (parseable): operator should `journalctl ... | grep "warmup-timeout" | jq .mcpServersPending`.

**TRACK-CLI:**
- Match daemon and CLI sides verbatim. Use string constants if both sides reference a method name, share via a common types module.

**ALL pillars:**
- Tiny diffs. DSCOPE ~15 lines. STALL telemetry ~30 lines. CLI fix ~5 lines.
- All existing tests stay green.
- No new npm deps.
- Deploy gate: ALL CHANNELS silent ≥30 min on non-bot `messageCreate` events.

### Non-negotiables

- **Subagent prompts MUST NOT contain the `delegates` directive when the parent agent has it set.** Test pinned.
- **Yaml fan-out only after DSCOPE GREEN.** Don't restore the delegate map until the recursion bug is impossible.
- **STALL-02 telemetry logs at level 50 (error/warn, not info).** Operators must see it.
- **Deploy ONLY when channels are silent ≥30 min.**
- **No new npm deps.**
- **Tests stay green** (Phase 999.6, 999.12, 999.14, 999.15 + the rest).

### Claude's Discretion

- Pick the cleanest gating point for DSCOPE (renderer vs caller). RESEARCH recommends the caller (subagent-thread-spawner).
- Choose the wrapper site for STALL-02's 60s sentinel (within `startAgent` vs at caller). RESEARCH recommends inside `startAgent` so all entry points (manual `clawcode start`, autoStart on daemon boot, restart) are covered uniformly.
- Telemetry's `lastStep` enumeration — RESEARCH proposes `"build-session-config" | "adapter-create-session" | "mcp-discovery" | "warm-path-check" | "post-warm"` based on the observable sequencing.

### Deferred Ideas (OUT OF SCOPE)

- **Discord bridge zombie-connection resilience** — separate phase
- **new-reel skill rebuild** — separate, multi-day, requires research
- **999.13 anti-recursion directive text** — rejected; the proper fix (DSCOPE) makes the directive invisible to subagents in the first place
- **MCP cold-start parallelization** — separate optimization
- **CLI subcommand renaming** (e.g. `mcp-tracker` → `mcp-pids`) — TRACK-CLI just fixes the bug
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DSCOPE-01 | Identify subagent prompt assembly path and verify it shares the same `buildSessionConfig` code as primary agents | §Existing Substrate — Subagent Path |
| DSCOPE-02 | Gate `delegates` injection so spawned subagent prompts NEVER contain the directive | §Architecture Patterns — Pattern A |
| DSCOPE-03 | Primary agent prompt rendering remains byte-identical to 999.13 baseline (test-pinned) | §Architecture Patterns — Pattern A invariant |
| DSCOPE-04 | Restore yaml fan-out after fix lands GREEN: `delegates: { research: fin-research }` on 4 finmentum agents, `delegates: { research: research }` on 4 non-finmentum agents | Out of plan scope — operator action post-deploy |
| STALL-01 | Reproduce on clawdy: `clawcode stop research && sleep 5 && clawcode start research`, observe last log line before stall, identify which subsystem hangs | §Common Pitfalls — Pitfall 5 (reproduction protocol) |
| STALL-02 | Add a 60s warmup-timeout sentinel inside `startAgent` that emits a structured pino-warn log with `agent`, `elapsedMs`, `lastStep`, `mcpServersConfigured/Loaded/Pending` and `msg: "agent warmup-timeout — boot stalled, no warm-path-ready"` at `level: 50` | §Architecture Patterns — Pattern B + §Code Examples |
| TRACK-CLI-01 | Add `"mcp-tracker-snapshot"` to the `IPC_METHODS` tuple in `src/ipc/protocol.ts` and the matching expected-list in `src/ipc/__tests__/protocol.test.ts` | §Architecture Patterns — Pattern C + §Common Pitfalls — Pitfall 1 |
</phase_requirements>

## Existing Substrate (verified by direct file inspection)

### Subagent Path (DSCOPE)

**File:** `src/discord/subagent-thread-spawner.ts:454-465`

```typescript
const subagentConfig: ResolvedAgentConfig = {
  ...sourceConfig,                    // ← spreads delegates verbatim
  name: sessionName,
  model,
  channels: [],
  soul: (config.systemPrompt ?? sourceConfig.soul ?? "") + threadContext,
  schedules: [],
  slashCommands: [],
  webhook,
  threads: parentConfig.threads,
  disallowedTools: ["mcp__clawcode__spawn_subagent_thread"],
};

await this.sessionManager.startAgent(sessionName, subagentConfig);
```

**Key facts:**
- `sourceConfig` is either the parent's config (when not delegating) or the delegate's config (when `delegateTo` is set, per 999.3 D-INH-01).
- The spread `...sourceConfig` carries `delegates` field verbatim from the source.
- `startAgent` calls `buildSessionConfig(subagentConfig, ...)` (line 725 in session-manager.ts) which calls `renderDelegatesBlock(config.delegates)` (line 730 in session-config.ts).
- The "## Specialist Delegation" directive lands in the subagent's stable prefix → the subagent reads "delegate research → fin-research" and tries to spawn another subagent → SDK recursion guard blocks `disallowedTools: ["mcp__clawcode__spawn_subagent_thread"]` → silent stall.

**Existing recursion guard (line 464):** `disallowedTools` blocks the *tool call* but does NOT remove the *directive text* from the prompt. The LLM sees the directive, attempts the action, the SDK refuses the tool — agent confused, never recovers within the turn budget.

### Delegates Renderer (DSCOPE)

**File:** `src/config/loader.ts:719-733`

```typescript
export function renderDelegatesBlock(
  delegates: Readonly<Record<string, string>> | undefined,
): string {
  if (!delegates) return "";
  const keys = Object.keys(delegates);
  if (keys.length === 0) return "";
  keys.sort();  // alphabetical for prompt-cache hash stability
  const lines = keys.map((k) => `- ${k} → ${delegates[k]}`);
  return [
    DELEGATES_DIRECTIVE_HEADER,    // "## Specialist Delegation\nFor tasks matching..."
    ...lines,
    DELEGATES_DIRECTIVE_FOOTER,    // "Verify the target is at opus/high..."
  ].join("\n");
}
```

**Key facts:**
- Pure function, no side effects. Returns `""` for undefined/empty delegates (already cache-stable).
- Caller is `buildSessionConfig` — a single call site (verified via grep: only 2 occurrences total — definition + caller).

### DelegatesBlock Injection (DSCOPE)

**File:** `src/manager/context-assembler.ts:836-847`

```typescript
// Phase 999.13 DELEG-02 — per-agent delegates directive lands at the END of
// the stable prefix's tools-and-capability cluster (after tools, after fs
// capability). Per CONTEXT.md "block goes at the bottom of the agent's
// system prompt".
//
// Empty/undefined short-circuits — byte-identical to no-delegates baseline.
if (sources.delegatesBlock && sources.delegatesBlock.length > 0) {
  stableParts.push(sources.delegatesBlock);
}
```

**Key facts:**
- The assembler is dumb — it renders whatever caller passes via `sources.delegatesBlock`.
- Empty string → no header, no whitespace, no cache-hash drift.
- This means the caller (session-config) is the right gate point. NO assembler changes needed.

### IPC Protocol & Server (TRACK-CLI)

**File:** `src/ipc/protocol.ts:7-245` — `IPC_METHODS` tuple. Sealed by zod enum.
**File:** `src/ipc/protocol.ts:254-259`:

```typescript
export const ipcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.enum(IPC_METHODS),    // ← the gatekeeper
  params: z.record(z.string(), z.unknown()).default({}),
});
```

**File:** `src/ipc/server.ts:74-82`:

```typescript
const result = ipcRequestSchema.safeParse(parsed);
if (!result.success) {
  // Invalid request — return -32600
  // ... { code: -32600, message: "Invalid Request" }
}
```

**Daemon dispatch** (`src/manager/daemon.ts:3754-3763`) — case `"mcp-tracker-snapshot"` exists, but is unreachable for CLI calls because the request is rejected at server.ts:74 before reaching the dispatcher.

**File:** `src/ipc/__tests__/protocol.test.ts:11-153` — `expect(IPC_METHODS).toEqual([…])` pins the exact tuple. The test will catch a missing entry but ALSO requires the test list to be updated when the enum is updated. Both edits ship together.

**Precedent (commit `a9c39c7`):** Phase 96 had this exact bug for `probe-fs` + `list-fs-status`. The fix was 4 lines total (2 in the enum, 2 in the test). TRACK-CLI follows the identical pattern.

### Warm-Path Substrate (STALL)

**File:** `src/manager/session-manager.ts:647-989` — `startAgent` body. The full sequence with line markers:

| Step | Line | Description | Has timeout? |
|------|------|-------------|--------------|
| 1 | 658 | `writeRegistry` (status: starting) | no — local file |
| 2 | 678 | `memory.initMemory(name, config)` | no — sync DB init |
| 3 | 717 | `memory.storeSoulMemory` | no — local |
| 4 | 721 | `detectBootstrapNeeded(config)` | no — local fs check |
| 5 | 725 | `buildSessionConfig` (reads SKILL.md, MEMORY.md, capability probe) | partial — file reads can hang on stale NFS, unlikely on local fs |
| 6 | 754 | `adapter.createSession(sessionConfig, ...)` | **NO — this calls into Claude Agent SDK which spins up `claude` subprocess + MCP servers** |
| 7 | 780 | polled MCP-discovery `void async` (fire-and-forget) | yes — internal 30s budget, doesn't block |
| 8 | 856 | `readEffortState` | swallowed — non-fatal |
| 9 | 895 | `runWarmPathCheck({timeoutMs: 10_000})` | yes — 10s WARM_PATH_TIMEOUT_MS |
| 10 | 988 | `log.info("warm-path ready — agent started")` | (target log line) |

**Likely stall location based on observed log sequence:** logs from step 1-4 succeed (`schedules registered` and `memory-scanner watching` fire). The next observable log would be either `"bootstrap check"` (line 722, info-level) or `"warm-path ready"` (line 988). The 22:09 incident shows `memory-scanner watching` at 22:09:23 then silence — this places the stall AFTER step 4 but BEFORE step 10.

The warm-path itself (step 9) has its own 10s timeout that produces a `"warm-path check failed — agent marked failed"` ERROR log on timeout. The fact that NO such log appeared rules out a step-9 stall — meaning the hang is in steps 5-8.

**Most likely culprit:** Step 6 — `adapter.createSession`. The Claude Agent SDK spawns `claude` subprocess synchronously and waits for the MCP servers configured in `mcpServers[]` to complete their JSON-RPC `initialize` handshake. Research has 5 MCPs; fin-research has 9. One slow MCP (e.g. playwright downloading a browser, browserless waiting for an HTTP service) blocks `createSession` indefinitely.

**No existing telemetry** at this layer — `pino` logs from the adapter are silent during the cold start.

### MCP Server Listing (STALL-02 telemetry)

**File:** `src/manager/session-manager.ts:894`:

```typescript
const mcpServers = config.mcpServers ?? [];
```

These are the configured MCP servers — used as `mcpServersConfigured` in the telemetry payload.

**MCP readiness state** is captured in `mcpReadiness.current` (line 893) AFTER warm-path completes. For pre-warm-path stall reporting, we know `mcpServersConfigured` (from config) but `mcpServersLoaded` and `mcpServersPending` aren't directly available without instrumentation.

**Workaround:** Track per-server connection state via a closure. The simplest implementation that ships within the ~30 line budget: probe each server in parallel for `initialize` response inside the timeout handler, classify each as loaded/pending. Or: just report `mcpServersConfigured` in the warmup-timeout log and let the operator deduce by the absence of mcp-server-specific log lines. RESEARCH recommends the latter — fewer moving parts, ships in <30 lines.

### Existing Pino Telemetry Pattern (STALL-02 reference)

**Phase 999.6 / 999.15 / 95 patterns:**

```typescript
this.log.warn(
  { agent: name, errors: warmResult.errors, total_ms: warmResult.total_ms, durations_ms: warmResult.durations_ms },
  "warm-path check failed — agent marked failed",
);
```

Pino's `level: 50` is the "warn" level. The first arg is structured fields; second arg is the message. STALL-02 follows this shape verbatim.

## Project Constraints (from CLAUDE.md)

| Directive | Source | Compliance |
|-----------|--------|-----------|
| `~/.claude/rules/security.md` — no hardcoded secrets, validate inputs | global | N/A — phase touches no secrets/inputs |
| `~/.claude/rules/coding-style.md` — immutability, small files (200-400 lines), explicit error handling | global | DSCOPE/STALL/TRACK-CLI fits in single-file edits, no mutation introduced |
| Project: `claude-agent-sdk@0.2.x`, `pino@9.x`, `zod@4.3.6`, no new npm deps | project CLAUDE.md | Phase uses existing deps only |
| Project: GSD workflow enforcement — no direct edits outside GSD command | project CLAUDE.md | Phase IS a GSD-tracked phase |

## Standard Stack

No new packages. Phase uses existing stack:

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| zod | 4.3.6 | IPC method-enum validation | already in deps |
| pino | 9.x | Structured warmup-timeout log | already in deps |
| @anthropic-ai/claude-agent-sdk | 0.2.x | createSession (the suspected stall site — observed only, not modified) | already in deps |
| vitest | (existing) | Snapshot tests for prompt rendering, fake-timer tests for STALL-02 timeout | already in deps |

## Architecture Patterns

### Pattern A — DSCOPE: gate `delegates` at the subagent caller

**What:** Strip `delegates` from the spread in `subagent-thread-spawner.ts` so it never reaches `buildSessionConfig`. Renderer stays pure.

**When to use:** Always for subagents. Single edit site. Avoids any conditional in the renderer or session-config (the renderer remains a pure function of its input).

**Example:**

```typescript
// src/discord/subagent-thread-spawner.ts (~line 454)
//
// Phase 106 DSCOPE-02 — strip `delegates` from spread. Subagents never
// orchestrate further subagents (recursion-guard above + DSCOPE invisibility
// below). Doing this at the caller keeps renderDelegatesBlock pure and the
// session-config code path identical for primary vs subagent.
const { delegates: _strippedDelegates, ...subagentSourceConfig } = sourceConfig;

const subagentConfig: ResolvedAgentConfig = {
  ...subagentSourceConfig,                  // delegates already stripped
  name: sessionName,
  model,
  channels: [],
  soul: (config.systemPrompt ?? sourceConfig.soul ?? "") + threadContext,
  schedules: [],
  slashCommands: [],
  webhook,
  threads: parentConfig.threads,
  disallowedTools: ["mcp__clawcode__spawn_subagent_thread"],
};
```

**Cache-stability invariant:** Primary agent prompt is byte-identical (no path that the primary agent flows through is changed). Subagent prompt loses the directive — its prompt-cache key changes from "with delegates block" to "without". This is FINE because subagents are short-lived (per-thread); their cache hits don't matter for fleet stability. Pin the byte-identical primary baseline with the existing `back-compat-byte-identical` test in session-config.test.ts:1492.

**Alternative (rejected):** Add `isSubagent` to `ContextSources` and gate inside the assembler. CONTEXT.md §Decisions explicitly prefers the caller approach: *"keeps the renderer pure"*. Rejected.

### Pattern B — STALL-02: 60s sentinel inside `startAgent`

**What:** A `setTimeout` armed at the top of `startAgent` body, cleared on either reaching the warm-path-ready log OR an explicit fail path. On fire (60s elapsed without clear), emit a structured pino-warn log.

**When to use:** Any async startup path with non-deterministic external dependencies (SDK subprocesses, MCP cold-start). Telemetry-only — no auto-recovery (out of scope per CONTEXT.md).

**Example:**

```typescript
// src/manager/session-manager.ts inside startAgent, BEFORE step 1
//
// Phase 106 STALL-02 — warmup-timeout sentinel. Fires once at 60s unless
// cleared by reaching warm-path ready (or any fail path). Reports the last
// observable step so operators can grep "warmup-timeout" + jq .lastStep
// to identify which subsystem hung.
let lastStep: "init" | "build-session-config" | "adapter-create-session" | "mcp-discovery" | "warm-path-check" | "post-warm" = "init";
const mcpServersConfigured = (config.mcpServers ?? []).map((s) => s.name);

const warmupTimeoutHandle = setTimeout(() => {
  this.log.warn(
    {
      agent: name,
      elapsedMs: 60_000,
      lastStep,
      mcpServersConfigured,
      // mcpServersLoaded / mcpServersPending populated when mcpReadiness ref
      // is non-null at fire time (warm-path probe completed but post-warm
      // step hung); else operator infers pending from configured.
      mcpServersLoaded: [],
      mcpServersPending: mcpServersConfigured,
    },
    "agent warmup-timeout — boot stalled, no warm-path-ready",
  );
}, 60_000);

try {
  // existing startAgent body, with `lastStep = "build-session-config"` etc.
  // updated as flow advances
  // ...
} finally {
  clearTimeout(warmupTimeoutHandle);
}
```

**Step-tracking points** (inside the existing flow):
- `lastStep = "build-session-config"` immediately before line 725
- `lastStep = "adapter-create-session"` immediately before line 754
- `lastStep = "mcp-discovery"` immediately after kicking off polled-discovery void async (line 780) — though this fire-and-forget completes async so the marker is informative only for operators
- `lastStep = "warm-path-check"` immediately before line 895
- `lastStep = "post-warm"` after line 977 (registry write)

**Refinement (telemetry quality):** When `mcpReadiness.current` is non-null at fire time, populate `mcpServersLoaded`/`mcpServersPending` from `mcpReadiness.current.stateByName`. Otherwise both are unknown — log `mcpServersLoaded: []` and `mcpServersPending: mcpServersConfigured`. The 22:09 incident showed the stall was BEFORE warm-path so `mcpReadiness.current` is null and the operator gets `mcpServersPending: [all]`.

**Alternative (rejected):** Per-step timeouts. Adds 5+ timer handles, more places to leak. Rejected — single sentinel is cleaner and adequate for detection.

### Pattern C — TRACK-CLI: register the IPC method in protocol.ts + test

**What:** Append `"mcp-tracker-snapshot"` to the `IPC_METHODS` tuple AND the test's expected list. Two-line surgical edit + matching test entry.

**Example:**

```typescript
// src/ipc/protocol.ts:244 (AFTER "secrets-invalidate", BEFORE the closing ] as const)
  // Phase 106 TRACK-CLI-01 — restore the operator-side mcp-tracker IPC.
  // Plan 999.15-03 wired the daemon dispatch + CLI client, but missed the
  // protocol enum (mirroring 96-05's identical regression — commit a9c39c7).
  "mcp-tracker-snapshot",
] as const;
```

```typescript
// src/ipc/__tests__/protocol.test.ts (matching position in expected tuple)
  "secrets-invalidate",
  "mcp-tracker-snapshot",
]);
```

**Verification:** After the edit, the test `expect(IPC_METHODS).toEqual([…])` passes; `clawcode mcp-tracker` returns the table.

### Anti-Patterns to Avoid

- **Conditional in `renderDelegatesBlock`** — would push the gate into a pure render function that has no business knowing about agent role. Renderer stays pure.
- **Per-step setTimeouts** for STALL-02 — multiplies failure modes (timer leak, stale handle, race on clear). Single sentinel is sufficient.
- **Renaming `mcp-tracker` → `mcp-pids`** — out of scope per CONTEXT.md §Deferred. The CLI keeps its name; only the IPC enum gets fixed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telemetry log shape | Custom JSON serializer | `this.log.warn(fields, msg)` (existing pino) | Pino already structured; project standard |
| Method-name string sharing | Re-export individual constants from a new types file | The existing `IPC_METHODS` tuple + `IpcMethod` type | Already the single source of truth |
| Subagent role detection | Add `isSubagent` field to `ResolvedAgentConfig` | Strip the field at the caller (`subagent-thread-spawner.ts`) | Avoids polluting the type for one consumer |
| Stall recovery | Auto-restart on warmup-timeout | DETECTION only (per CONTEXT.md §Boundaries) | Auto-restart is a separate phase |

**Key insight:** All three fixes are about *not* building things — strip a field, append to a tuple, add a single sentinel. The ecosystem (zod, pino, the SDK) already does the heavy lifting.

## Common Pitfalls

### Pitfall 1: Forgetting the `IPC_METHODS` test pin
**What goes wrong:** Add `"mcp-tracker-snapshot"` to the enum, ship the fix, deploy — `protocol.test.ts:13 expect(IPC_METHODS).toEqual([…])` immediately fails because the expected tuple doesn't include the new entry.
**Why it happens:** The test pins the exact tuple shape. Fix the enum without fixing the test → unit suite RED.
**How to avoid:** Edit both files in the same commit. Pre-flight `npx vitest run src/ipc/__tests__/protocol.test.ts` before pushing.
**Warning signs:** CI fails with "expected array to deeply equal" diff.

### Pitfall 2: Subagent prompt-cache invalidation cascading into primary
**What goes wrong:** Gating delegates wrong (e.g. inside `renderDelegatesBlock` with a buggy condition) accidentally changes primary agent prompt rendering — fleet-wide Anthropic prompt-cache miss on deploy.
**Why it happens:** Primary and subagent flow through the same `buildSessionConfig`. Any conditional with `isSubagent` flag-passing has a "what's the default for primary" branch that's easy to get wrong.
**How to avoid:** Use Pattern A (caller-side strip). The primary's flow is byte-untouched. Pin via the existing 999.13 byte-identical test.
**Warning signs:** Snapshot tests in `session-config.test.ts:1492` `back-compat-byte-identical` fail.

### Pitfall 3: STALL-02 sentinel firing during legitimate slow boots
**What goes wrong:** 60s threshold fires for an agent that legitimately takes 65s to cold-start (rare but possible on first-run model downloads).
**Why it happens:** Threshold is judgment call. 60s matches CONTEXT.md spec but a clean machine cold-starting MiniLM + pulling browser binary could exceed.
**How to avoid:** The log is `level: 50` (warn), not `error/fatal`. Doesn't fail the agent or alert paging. If routinely false-firing, raise to 90s in a follow-up.
**Warning signs:** `journalctl | grep warmup-timeout` returns entries that are followed by a `warm-path ready` log within 15s.

### Pitfall 4: Subagent recursion guard NOT redundant with DSCOPE
**What goes wrong:** Operator removes the `disallowedTools: ["mcp__clawcode__spawn_subagent_thread"]` guard at line 464 because "DSCOPE makes the directive invisible, the guard is moot."
**Why it happens:** False sense of security. The directive is ONE source of recursion temptation. The agent's own SOUL.md or skills could still nudge it toward spawning subagents.
**How to avoid:** Keep the recursion guard. It's defense-in-depth. CONTEXT.md §Specifics doesn't propose removal.
**Warning signs:** Test `subagent-recursion-guard.test.ts:292` fails after a "cleanup" PR.

### Pitfall 5: STALL-01 reproduction false negative
**What goes wrong:** Run `clawcode stop research && start research` post-deploy, agent boots cleanly in 30s. Conclude "no bug, ship STALL-02 telemetry only."
**Why it happens:** MCP cold-start is timing-dependent. On a quiet machine after fresh install, MCPs may load fast.
**How to avoid:** Run reproduction 3-5x with `sleep 5` between runs. Run during a moment of high MCP-process churn (e.g. immediately after restarting fin-acquisition + finmentum-content-creator). Even if no repro, STALL-02 telemetry MUST ship per CONTEXT.md.
**Warning signs:** None — false negatives are silent. Mitigation = ship telemetry regardless.

### Pitfall 6: TRACK-CLI's IPC schema also validates response shape
**What goes wrong:** Add the method to enum, dispatch works, but client gets "Invalid response from daemon" because some downstream zod validates response shape.
**Why it happens:** `ipcResponseSchema` (line 76 in client.ts) validates the response. If the response shape doesn't match `{result | error}` it rejects.
**How to avoid:** Verify `mcp-tracker-snapshot.ts:buildMcpTrackerSnapshot()` returns `{ agents: [...] }` plain object — it does (line 95: `return { agents }`). The IPC server wraps it as `{result: <return>}` automatically.
**Warning signs:** Post-deploy `clawcode mcp-tracker` returns "Invalid response from daemon" instead of the table.

## Code Examples

### A. DSCOPE — caller-side strip (subagent-thread-spawner.ts)

```typescript
// src/discord/subagent-thread-spawner.ts ~line 454
//
// BEFORE:
const subagentConfig: ResolvedAgentConfig = {
  ...sourceConfig,
  name: sessionName,
  // …
};

// AFTER (Phase 106 DSCOPE-02):
const { delegates: _stripped, ...subagentSourceConfig } = sourceConfig;
const subagentConfig: ResolvedAgentConfig = {
  ...subagentSourceConfig,
  name: sessionName,
  // …
};
```

### B. STALL-02 — sentinel + step tracking (session-manager.ts)

```typescript
// src/manager/session-manager.ts inside startAgent, just after this.configs.set
//
// Phase 106 STALL-02 — warmup-timeout sentinel.
let lastStep:
  | "init"
  | "build-session-config"
  | "adapter-create-session"
  | "mcp-discovery"
  | "warm-path-check"
  | "post-warm" = "init";
const mcpServersConfigured = (config.mcpServers ?? []).map((s) => s.name);
let mcpReadinessRef: McpReadinessReport | null = null;

const warmupTimeoutHandle = setTimeout(() => {
  const loaded: string[] = [];
  const pending: string[] = [];
  if (mcpReadinessRef) {
    for (const [name, state] of mcpReadinessRef.stateByName) {
      if (state.status === "ready") loaded.push(name);
      else pending.push(name);
    }
  } else {
    pending.push(...mcpServersConfigured);
  }
  this.log.warn(
    {
      agent: name,
      elapsedMs: 60_000,
      lastStep,
      mcpServersConfigured,
      mcpServersLoaded: loaded,
      mcpServersPending: pending,
    },
    "agent warmup-timeout — boot stalled, no warm-path-ready",
  );
}, 60_000);

try {
  // existing body — sprinkle `lastStep = "..."` at each transition.
  // After warm-path body assigns mcpReadiness.current, also set
  // mcpReadinessRef = mcpReadiness.current so the timer sees the latest state.
} finally {
  clearTimeout(warmupTimeoutHandle);
}
```

### C. TRACK-CLI — enum + test (protocol.ts + protocol.test.ts)

```typescript
// src/ipc/protocol.ts ~line 244 (BEFORE the closing ] as const)
  "secrets-status",
  "secrets-invalidate",
  // Phase 106 TRACK-CLI-01 — restore mcp-tracker IPC (regression mirror of
  // commit a9c39c7 — daemon dispatch + CLI client landed in 999.15-03 but
  // the enum entry was missed; "Invalid Request" deploy-blocker).
  "mcp-tracker-snapshot",
] as const;
```

```typescript
// src/ipc/__tests__/protocol.test.ts ~line 152 (matching position)
      "secrets-status",
      "secrets-invalidate",
      "mcp-tracker-snapshot",
    ]);
```

## Runtime State Inventory

> Phase 106 is code-edit only — no rename/migration. Confirm each category is empty:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — verified by reading scope: no DB schemas changed, no new SQLite tables, no memory-store edits. | None |
| Live service config | None — Discord channel routing unchanged. n8n/Datadog/Tailscale not touched. | None |
| OS-registered state | None — systemd unit `clawcode.service` unchanged. No new pm2 / launchd / Task Scheduler entries. | None |
| Secrets/env vars | None — no new env vars introduced. SOPS/1Password references unchanged. | None |
| Build artifacts | TypeScript transpile required: `npm run build` produces fresh `dist/` after deploy. No egg-info / native binary equivalents. | Standard build step |

**Yaml fan-out (post-deploy operator action):** Restoring `delegates: { research: fin-research }` on 4 finmentum agents and `delegates: { research: research }` on 4 non-finmentum agents IS a runtime-state change. CONTEXT.md correctly defers this to AFTER GREEN — the planner should call it out as a manual deploy-step in PLAN.md, not a Wave task.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | 22 LTS | — |
| TypeScript | build | ✓ | 6.0.2 | — |
| @anthropic-ai/claude-agent-sdk | runtime (observed only — not modified) | ✓ | 0.2.x | — |
| pino | telemetry | ✓ | 9.x | — |
| zod | IPC schema | ✓ | 4.3.6 | — |
| vitest | test | ✓ | (existing) | — |
| ssh access to clawdy | STALL-01 reproduction | assumed ✓ | — | document repro steps for manual run if access fails |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Subagent inherits parent's full prompt directives | Strip role-specific directives at the spawner | Phase 106 DSCOPE | Recursion impossible at the directive level (defense-in-depth alongside SDK guard) |
| IPC method silently rejected with "Invalid Request" | All registered handlers MUST appear in `IPC_METHODS` enum + test | Phase 96 (precedent commit a9c39c7); Phase 106 fixes the same regression for mcp-tracker | Single source of truth pattern, test pins the contract |
| Silent stall during warm-path | Structured warmup-timeout telemetry at level 50 | Phase 106 STALL-02 | Operators can grep + jq to identify hung MCP within 60s |

**Deprecated/outdated:** None — phase is purely additive.

## Open Questions

1. **Which MCP causes the stall on clawdy?**
   - What we know: research has 5 MCPs, fin-research has 9. Common to both: `playwright`, `brave-search`, `google-workspace`, `fal-ai`, `browserless`. Both stall.
   - What's unclear: whether the hang is in `playwright` (browser download), `browserless` (waiting on HTTP service), or another. Needs STALL-01 reproduction to identify.
   - Recommendation: STALL-01 instrumentation FIRST. STALL-02 telemetry ships regardless and will identify the culprit on the next stall in production.

2. **Does step 6 (`adapter.createSession`) have any internal timeout the SDK exposes?**
   - What we know: the SDK is `@anthropic-ai/claude-agent-sdk@0.2.x` (pre-1.0). No documented startup timeout in v0.2.x changelog.
   - What's unclear: whether passing `--timeout` or similar through `spawn_claude_code_process` would prevent the SDK from blocking forever.
   - Recommendation: out of scope for Phase 106. STALL-02 detects the symptom; SDK-level fix is a separate phase.

3. **Does the polled-discovery `void async` (line 780) escape the warmup-timeout cleanup?**
   - What we know: it's fire-and-forget with internal 30s budget.
   - What's unclear: whether it can outlive the parent `startAgent` and try to call `tracker.register` after the agent has been deleted from `this.sessions`.
   - Recommendation: existing code (line 821) already re-checks `this.sessions.has(name)` post-loop. Pattern is safe; no change needed for STALL-02.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | (project-standard, existing) |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` (project default) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DSCOPE-02 | Subagent prompt does NOT contain `## Specialist Delegation` directive | unit (snapshot) | `npx vitest run src/discord/subagent-thread-spawner.test.ts -t "DSCOPE"` | ❌ Wave 0 — add new test block |
| DSCOPE-03 | Primary prompt byte-identical to 999.13 baseline | unit (snapshot) | `npx vitest run src/manager/__tests__/session-config.test.ts -t "back-compat-byte-identical"` | ✅ exists at line 1492 |
| DSCOPE-02 alt | `renderDelegatesBlock` purity unchanged (still returns directive when called) | unit | `npx vitest run src/manager/__tests__/context-assembler.test.ts -t "delegates-block-injection"` | ✅ exists at line 1260 |
| STALL-02 | Sentinel fires at 60s with structured payload | unit (fake timers) | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "warmup-timeout"` | ❌ Wave 0 — add new test block |
| STALL-02 | Sentinel cleared on warm-path-ready | unit (fake timers) | (same file as above, additional test case) | ❌ Wave 0 — same block |
| TRACK-CLI-01 | `mcp-tracker-snapshot` in enum | unit | `npx vitest run src/ipc/__tests__/protocol.test.ts -t "includes all required methods"` | ✅ exists at line 12 (will need expected list update) |
| TRACK-CLI-01 | `ipcRequestSchema` accepts `{method: "mcp-tracker-snapshot"}` | unit | `npx vitest run src/ipc/__tests__/protocol.test.ts -t "accepts all valid methods"` | ✅ exists at line 203 |
| Integration | `clawcode mcp-tracker` returns formatted table on running daemon | manual | post-deploy verification on clawdy | manual-only, document in deploy checklist |

### Sampling Rate
- **Per task commit:** `npx vitest run <single-file>` for the file just edited (5–10s)
- **Per wave merge:** `npm test` full suite (90s typical)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/discord/__tests__/subagent-delegates-scoping.test.ts` (or extend `subagent-thread-spawner.test.ts`) — covers DSCOPE-02
- [ ] `src/manager/__tests__/session-manager-warmup-timeout.test.ts` (or extend `session-manager.test.ts`) — covers STALL-02

*(All other tests already exist and cover the requirement; Wave 0 only needs the two new test files / new describe blocks listed above.)*

## Sources

### Primary (HIGH confidence)
- `src/discord/subagent-thread-spawner.ts:454-465` — subagent config spread (DSCOPE root cause, direct verification)
- `src/manager/session-config.ts:730` — `delegatesBlock: renderDelegatesBlock(config.delegates)` (the lone caller, single edit point if needed)
- `src/config/loader.ts:719-733` — `renderDelegatesBlock` (pure renderer, no change needed)
- `src/manager/context-assembler.ts:836-847` — `delegatesBlock` injection (pure assembler, no change needed)
- `src/ipc/protocol.ts:7-245, 254-259` — `IPC_METHODS` tuple + `ipcRequestSchema` (TRACK-CLI root cause)
- `src/ipc/server.ts:74-82` — "Invalid Request" -32600 source
- `src/manager/daemon.ts:3754-3763` — `mcp-tracker-snapshot` dispatch (already wired, unreachable from CLI)
- `src/manager/session-manager.ts:647-989` — `startAgent` body (STALL hang location)
- `src/manager/warm-path-check.ts` — 10s `WARM_PATH_TIMEOUT_MS` (rules out warm-path itself as the stall point)
- `src/ipc/__tests__/protocol.test.ts:11-153` — `IPC_METHODS` test pin (TRACK-CLI test edit needed)
- `src/manager/__tests__/session-config.test.ts:1492` — back-compat byte-identical test (DSCOPE-03 regression lock)
- `src/manager/__tests__/context-assembler.test.ts:1240+` — Phase 999.13 DELEG injection tests (DSCOPE-02 cross-check)
- git history `a9c39c7 fix(96-05): add probe-fs + list-fs-status to IPC_METHODS enum` — direct precedent for TRACK-CLI

### Secondary (MEDIUM confidence)
- 22:09 PT 2026-04-30 incident logs (operator-reported sequence: schedules-registered → memory-scanner-watching → silence) — narrows STALL location to lines 725-989
- `src/ipc/client.ts:16-64` — `sendIpcRequest` shape (verified the request-side does NOT pre-validate against `IPC_METHODS`; the server-side does)

### Tertiary (LOW confidence)
- Suspicion that step 6 (`adapter.createSession`) is the specific hang site within steps 5-8 — based on which step has the most external dependencies (SDK + MCP subprocesses) and matches the known pre-1.0 SDK volatility note in CLAUDE.md. STALL-01 reproduction will confirm or refute. STALL-02 telemetry ships either way.

## Metadata

**Confidence breakdown:**
- DSCOPE root cause: **HIGH** — direct code inspection of spread + `renderDelegatesBlock` call chain
- DSCOPE fix pattern: **HIGH** — caller-side strip is the minimum-surface change
- STALL hang location: **MEDIUM-HIGH** — bracketed to lines 725-989 by log-sequence elimination; specific line within that range is suspicion (LOW)
- STALL-02 telemetry pattern: **HIGH** — matches existing pino + level-50 patterns verbatim
- TRACK-CLI root cause: **HIGH** — IPC_METHODS missing entry directly verified, exact precedent in commit a9c39c7
- TRACK-CLI fix: **HIGH** — 4-line surgical edit (2 in enum, 2 in test)

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (stable infra phase; substrate stays stable for ~30 days unless 999.13/999.15 substrate evolves)
