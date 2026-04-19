---
phase: 260419-mvh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/manager/session-manager.ts
  - src/manager/__tests__/session-manager-memory-failure.test.ts
  - src/openai/request-logger.ts
  - src/openai/__tests__/request-logger.test.ts
  - src/openai/server.ts
  - src/openai/__tests__/server.test.ts
  - src/openai/endpoint-bootstrap.ts
  - src/cli/commands/openai-log.ts
  - src/cli/index.ts
  - README.md
autonomous: true
requirements:
  - QUICK-MVH-01  # Fix initMemory→warm-path cascade (clean failure path)
  - QUICK-MVH-02  # OpenAI request/payload JSONL logging + CLI tail
---

<objective>
Two small, related observability/resilience fixes for the OpenAI endpoint — land as two atomic commits inside one plan because they share test infrastructure (vitest + pino harness) and both harden the same daemon lifecycle.

**Purpose:**
1. Make a per-agent memory-init failure fail-fast with a clean single-line cause, instead of cascading through warm-path and surfacing as a misleading `warmSqliteStores[memories]: no MemoryStore...` message that obscures the real error (e.g., SQLite corruption, bad workspace perms, sqlite-vec load failure).
2. Add structured JSONL request logging to the OpenAI-compatible endpoint so we can diagnose real-world OpenAI SDK traffic (from OpenClaw, LangChain, Vercel AI SDK, etc.) without leaking bearer keys or message bodies, and expose it via `clawcode openai-log tail`.

**Output:**
- Fail-fast `startAgent` path when memory init fails — registry goes `starting → failed` with the true root cause, warm-path never runs, daemon keeps serving other agents.
- `src/openai/request-logger.ts` — non-blocking fs.appendFileSync JSONL writer with bearer-key redaction and opt-in message-body capture.
- `clawcode openai-log tail --agent X --since 1h` subcommand.
- Test coverage for every new branch: memory-failure path, logger success path, logger write-failure path, body-redaction, server integration (non-stream/stream/401/503/models), CLI filter + format.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

# Core files the executor MUST read before editing anything
@src/manager/session-manager.ts
@src/manager/session-memory.ts
@src/openai/server.ts
@src/openai/endpoint-bootstrap.ts
@src/cli/commands/openai-key.ts
@src/cli/index.ts
@src/openai/__tests__/server.test.ts
@src/manager/__tests__/session-manager.test.ts

<interfaces>
<!-- Key contracts executor will touch. Extracted verbatim from codebase — do NOT re-explore. -->

From src/manager/session-memory.ts (AgentMemoryManager):
```typescript
class AgentMemoryManager {
  readonly memoryStores: Map<string, MemoryStore>;
  readonly conversationStores: Map<string, ConversationStore>;
  readonly tierManagers: Map<string, TierManager>;
  readonly usageTrackers: Map<string, UsageTracker>;
  // ... etc (see file)

  /**
   * initMemory(): CURRENT BEHAVIOUR — wraps internals in try/catch and LOGS
   * "failed to initialize memory (non-fatal)" on error, but does NOT throw.
   * Callers today only detect failure via `memoryStores.has(name)` === false.
   */
  initMemory(name: string, config: ResolvedAgentConfig): void;

  /**
   * warmSqliteStores(): THROWS Error when MemoryStore is missing:
   *   `warmSqliteStores: no MemoryStore for agent '${name}'`
   * (session-memory.ts:266-268). This throw is what cascades through
   * runWarmPathCheck and surfaces as "warm-path: warmSqliteStores[memories]: ..."
   * — hiding the real initMemory error recorded in the earlier log line.
   */
  async warmSqliteStores(name: string): Promise<{ memories_ms, usage_ms, traces_ms }>;
}
```

From src/manager/session-manager.ts `startAgent` flow (line ~222 onward):
```
1.  this.configs.set(name, config)
2.  registry entry created, status='starting'
3.  this.memory.initMemory(name, config)          // <-- silently fails today
4.  conversationStore.startSession(name)           // <-- NPE if initMemory failed
5.  await this.memory.storeSoulMemory(name, ...)   // <-- no-op on missing store
6.  tierManager.refreshHotTier()                   // <-- no-op if missing
7.  buildSessionConfig(...)                         // <-- runs even on failure
8.  adapter.createSession(...)                      // <-- creates a session for
                                                    //     an agent whose memory
                                                    //     is broken
9.  runWarmPathCheck({ sqliteWarm: warmSqliteStores })
                                                    // <-- THROWS → registry goes
                                                    //     'failed' with WRONG error
                                                    //     message, session is then
                                                    //     torn down via handle.close()
```

From src/openai/server.ts (OpenAiServerConfig):
```typescript
export interface OpenAiServerConfig {
  port: number;
  host: string;
  maxRequestBodyBytes: number;
  streamKeepaliveMs: number;
  apiKeysStore: ApiKeysStore;
  driver: OpenAiSessionDriver;
  agentNames: () => ReadonlyArray<string>;
  log?: Logger;
  agentIsRunning?: (agentName: string) => boolean;
  agentReadinessWaitMs?: number;
  agentReadinessPollIntervalMs?: number;
  // Plan will ADD:
  // requestLogger?: RequestLogger;
}
```

From src/openai/endpoint-bootstrap.ts (OpenAiEndpointDeps):
```typescript
export interface OpenAiEndpointDeps {
  readonly managerDir: string;  // ~/.clawcode/manager/
  readonly sessionManager: SessionManager;
  readonly turnDispatcher: TurnDispatcher;
  readonly agentNames: () => ReadonlyArray<string>;
  readonly log: Logger;
  readonly startServer?: typeof import("./server.js").startOpenAiServer;
  readonly apiKeysStoreFactory?: (dbPath: string) => ApiKeysStore;
}
```

From src/cli/commands/openai-key.ts — pattern to mirror for openai-log:
- `registerXxxCommand(program, deps?)` factory
- `OpenAiKeyCommandDeps` test-injection bag with `runX`, `log`, `error`, `exit`
- `buildDefaultDeps()` returns production deps (IPC-first, DB-or-FS fallback)
- `renderListTable(rows)` — padded columns with `-` divider between header and data
- Registered in src/cli/index.ts:49 as `import { registerOpenAiKeyCommand } from "./commands/openai-key.js";` and wired at line 176 with `registerOpenAiKeyCommand(program);`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix initMemory→warm-path cascade (fail-fast startAgent on memory init failure)</name>
  <files>
    src/manager/session-manager.ts,
    src/manager/__tests__/session-manager-memory-failure.test.ts
  </files>
  <behavior>
    Before implementing, write the regression test in
    `src/manager/__tests__/session-manager-memory-failure.test.ts` with the
    following expectations (vitest + vi.fn spies; DO NOT touch the existing
    session-manager.test.ts file — add a NEW file so regressions surface in
    isolation):

    - **Test 1 — initMemory throws → registry goes 'starting' → 'failed' with
      the real error message:**
      Stub `manager['memory'].initMemory` with `vi.spyOn(...).mockImplementation(() => { throw new Error('disk full: sqlite-vec load failed'); })`.
      Call `await manager.startAgent('clawdy', config)`.
      Read the registry JSON. Assert:
        - entry.status === 'failed'
        - entry.lastError includes the substring 'disk full: sqlite-vec load failed'
        - entry.lastError does NOT include the substring 'warm-path'
        - entry.warm_path_ready is NOT set (undefined or false)

    - **Test 2 — warm-path is NEVER invoked on initMemory failure:**
      Stub initMemory to throw AND stub `manager['memory'].warmSqliteStores`
      with `vi.fn()`. Call startAgent. Assert `warmSqliteStores` was called
      zero times.

    - **Test 3 — adapter.createSession is NEVER invoked on initMemory failure:**
      Assert `adapter.createSession` (spy on the MockSessionAdapter) is called
      zero times when initMemory throws.

    - **Test 4 — downstream maps are NOT populated on failure:**
      After the failure, assert:
        - `manager['sessions'].has('clawdy') === false`
        - `manager['activeConversationSessionIds'].has('clawdy') === false`
      (`configs` set earlier in startAgent is acceptable to leave set — it's
      pre-init bookkeeping; only assert sessions + activeConversationSessionIds.)

    - **Test 5 — daemon-equivalent path does not throw:**
      `await expect(manager.startAgent(...)).resolves.not.toThrow();`
      (startAgent returns, recording the failed registry entry; never
      re-throws — SessionManager today follows "daemon keeps running other
      agents" contract for warm-path failures; extend it to initMemory.)

    - **Test 6 — existing happy path still passes:**
      One smoke test that does NOT stub initMemory. Assert
      `entry.status === 'running'` after startAgent, same as today.

    Also verify the EXISTING `src/manager/__tests__/session-manager.test.ts`
    continues to pass without modification — do a full `npm test -- session-manager`
    after the fix lands.
  </behavior>
  <action>
    **Step 1 — Write the tests above (RED).**
    Run `npm test -- session-manager-memory-failure` and confirm Tests 1-5 FAIL
    against the current code (Test 6 should pass). This proves the cascade
    exists before we fix it.

    **Step 2 — Fix `startAgent` in src/manager/session-manager.ts (line ~237):**

    Replace the current unguarded call:
    ```
    this.memory.initMemory(name, config);
    ```
    with:
    ```typescript
    try {
      this.memory.initMemory(name, config);
    } catch (initErr) {
      const errMsg = (initErr as Error).message;
      this.log.warn(
        { agent: name, error: errMsg },
        "failed to initialize memory — agent marked failed, skipping warm-path",
      );
      const reg = await readRegistry(this.registryPath);
      const updated = updateEntry(reg, name, {
        status: "failed",
        lastError: `initMemory: ${errMsg}`,
      });
      await writeRegistry(this.registryPath, updated);
      // Do NOT start conversation session, NOT storeSoulMemory, NOT
      // refreshHotTier, NOT buildSessionConfig, NOT adapter.createSession,
      // NOT runWarmPathCheck. Return cleanly — daemon keeps other agents up.
      return;
    }
    ```

    **IMPORTANT — also catch the no-MemoryStore case:**
    Even though `AgentMemoryManager.initMemory` currently swallows errors (see
    session-memory.ts:125-130), it STILL ends up with no MemoryStore on failure.
    So after the try/catch above, add a second guard:
    ```typescript
    if (!this.memory.memoryStores.has(name)) {
      const errMsg = "MemoryStore missing after initMemory (check earlier 'failed to initialize memory' log for root cause)";
      this.log.warn({ agent: name }, errMsg);
      const reg = await readRegistry(this.registryPath);
      const updated = updateEntry(reg, name, {
        status: "failed",
        lastError: `initMemory: ${errMsg}`,
      });
      await writeRegistry(this.registryPath, updated);
      return;
    }
    ```
    This second guard handles today's swallow-and-continue path in initMemory
    (which logs ERROR but doesn't throw) — without it, Tests 1/3/4 would still
    fail because initMemory's current try/catch doesn't re-throw. Comment both
    guards so future readers understand why we have belt-and-suspenders.

    **Step 3 — RED → GREEN.**
    Run `npm test -- session-manager-memory-failure` — all 6 tests now pass.
    Run `npm test -- src/manager/__tests__/session-manager.test.ts` — existing
    tests still green (no regressions).

    **Commit atomically:**
    ```
    git add src/manager/session-manager.ts \
            src/manager/__tests__/session-manager-memory-failure.test.ts
    git commit -m "fix(manager): fail-fast startAgent on memory init failure (no warm-path cascade)"
    ```

    Coding-style notes:
    - Use the immutable `updateEntry(registry, name, {...})` pattern already
      used in startAgent (same file) — do NOT mutate `registry.entries` in place.
    - Keep the two guards as separate if-blocks rather than combining — the
      inner try/catch handles future case where initMemory starts throwing,
      the `!memoryStores.has` guard handles today's silent-fail case.
    - Do NOT add new imports beyond what session-manager.ts already has.
  </action>
  <verify>
    <automated>npm test -- session-manager-memory-failure.test.ts session-manager.test.ts</automated>
  </verify>
  <done>
    - `src/manager/__tests__/session-manager-memory-failure.test.ts` exists and all 6 tests pass.
    - Existing `src/manager/__tests__/session-manager.test.ts` unchanged and still green.
    - `git log -1` on master shows `fix(manager): fail-fast startAgent on memory init failure (no warm-path cascade)`.
    - Manual smoke (optional, not blocking the commit): grep `startAgent` in session-manager.ts shows the try/catch wraps initMemory and the second `!memoryStores.has` guard precedes `conversationStores.get(name)`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: OpenAI request/payload JSONL logging + `clawcode openai-log tail` CLI</name>
  <files>
    src/openai/request-logger.ts,
    src/openai/__tests__/request-logger.test.ts,
    src/openai/server.ts,
    src/openai/__tests__/server.test.ts,
    src/openai/endpoint-bootstrap.ts,
    src/cli/commands/openai-log.ts,
    src/cli/index.ts,
    README.md
  </files>
  <behavior>
    Before implementing, write tests in the following files (RED first).
    Every test MUST use a temp dir created via `fs.mkdtempSync(join(os.tmpdir(), 'oai-log-'))`
    and torn down in `afterEach`. No writes to `~/.clawcode/` during tests.

    **A. `src/openai/__tests__/request-logger.test.ts` (unit):**

    - **RL-1 — createRequestLogger + log writes one JSON line per record:**
      Create logger with `{ dir: tmpDir, log: pino({ level: 'silent' }) }`.
      Call `logger.log(record)` with 3 distinct records.
      Read `openai-requests-YYYY-MM-DD.jsonl` (UTC). Split by `\n`, filter
      non-empty, assert 3 lines. Parse each as JSON. Assert field shape:
      `request_id`, `timestamp_iso`, `method`, `path`, `agent`, `status_code`,
      `ttfb_ms`, `total_ms`, `bearer_key_prefix`, `messages_count`,
      `response_bytes`, `error_type`, `error_code`, `finish_reason`, `stream`.

    - **RL-2 — bearer_key_prefix is first 12 chars ONLY:**
      Log a record with full bearer 'ck_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbb'.
      Parse output. Assert `bearer_key_prefix.length === 12`.
      Assert the output file contents (raw text) does NOT contain the full
      bearer substring beyond the 12-char prefix (`indexOf('aaaa_extra')` === -1).

    - **RL-3 — includeBodies:false (default) strips messages[].content but keeps role+chars:**
      Log a record with messages: `[{role:'user',content:'hello world (12)'}]`.
      Assert output JSON has `messages_count: 1` and either omits `messages`
      entirely OR contains `messages: [{role:'user', chars:15}]` (pick one;
      document the choice in code — I recommend OMITTING the messages array
      entirely when includeBodies=false, keeping ONLY messages_count).

    - **RL-4 — includeBodies:true includes messages verbatim:**
      Same as RL-3 with `includeBodies: true`. Assert output has
      `messages: [{role:'user', content:'hello world (12)'}]`.

    - **RL-5 — appendFileSync throws → log.warn called once per minute, no re-throw:**
      Use `vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw new Error('EACCES'); })`.
      Use a fake timer / injected `clock` fn to control "once per minute".
      Call `logger.log(record)` 3 times rapidly. Assert the pino spy saw
      `.warn` exactly once (not 3 times — rate limit). Advance clock 61s.
      Call log again. Assert warn count is now 2.
      Critical: `logger.log()` MUST NOT throw — any fs error is swallowed.

    - **RL-6 — dir is created on first write (`fs.mkdirSync(dir, {recursive:true})`):**
      Delete tmpDir, then create logger pointing at `join(tmpDir, 'nested/new')`.
      Call log. Assert `fs.existsSync(join(tmpDir,'nested/new/openai-requests-YYYY-MM-DD.jsonl'))`.

    - **RL-7 — close() resolves (even if no writes occurred):**
      Create logger, call close() immediately. Assert it resolves within 100ms.

    **B. `src/openai/__tests__/server.test.ts` (extend existing — append below current tests):**

    Append a new `describe("POST /v1/chat/completions — request logging", ...)` block.
    Use the existing `bootHarness` helper but add a `requestLogger` param that
    wires an in-memory recorder:
    ```typescript
    const records: RequestLogRecord[] = [];
    const recorder: RequestLogger = {
      log: (r) => { records.push(r); },
      close: async () => {},
    };
    ```
    Pass through to `startOpenAiServer({..., requestLogger: recorder})`.

    Tests:

    - **SI-1 — non-stream 200 writes exactly 1 record with `status_code:200`,
      `stream:false`, `finish_reason:'stop'`, populated `total_ms` >= 0,
      `response_bytes > 0`, agent matches key's agent, `bearer_key_prefix`
      is 12-char prefix of pinnedKey.**

    - **SI-2 — stream 200 writes record at END with `stream:true`,
      `ttfb_ms > 0` (measured from request entry to first data chunk emit),
      `total_ms >= ttfb_ms`, `finish_reason:'stop'`.**
      Do the assertion inside an `awaitFlush` helper that polls `records.length`
      with a 1s timeout (the record is emitted in the `finally` of runStreaming
      / response close, which may be microtask-delayed).

    - **SI-3 — 401 missing bearer writes record with `status_code:401`,
      `error_type:'authentication_error'`, `error_code:'missing_key'`,
      `bearer_key_prefix: null`, `agent: null`.**

    - **SI-4 — 503 agent warming writes record with `status_code:503`,
      `error_code:'agent_warming'`, `agent` populated (key resolved, then
      warm-path gate tripped).** Boot harness with `agentIsRunning: () => false`
      and `agentReadinessWaitMs: 100`.

    - **SI-5 — GET /v1/models writes record with `method:'GET'`,
      `path:'/v1/models'`, `agent: null`, `messages_count: null`,
      `bearer_key_prefix: null`, `status_code:200`.**

    - **SI-6 — exactly one `logger.log(record)` call per request** —
      `records.length === 1` across every test above.

    **C. `src/cli/commands/__tests__/openai-log.test.ts` (NEW, unit):**

    - **CLI-1 — reads today's JSONL + filters by --agent:**
      Create fixture JSONL in tmpDir with 3 records: agent 'clawdy' x2,
      agent 'assistant' x1. Invoke the command with `--agent clawdy --since 1h`
      against the tmpDir. Capture `deps.log` output. Assert it contains both
      'clawdy' records and NOT the 'assistant' record.

    - **CLI-2 — `--since 1h` filters older records:**
      Fixture has 1 record 30min old + 1 record 2h old. `--since 1h` returns
      only the 30min-old one.

    - **CLI-3 — `--json` emits raw JSON lines (no table framing):**
      Same fixture. With `--json`, `deps.log` output is valid JSON lines
      (no padded columns, no `----` divider).

    - **CLI-4 — no records → "No requests logged." message, exit 0.**

    - **CLI-5 — table format mirrors openai-key list:**
      Default (no `--json`) output: first line is the header with columns
      [date, request_id, agent, status, ttfb_ms, total_ms, finish_reason];
      second line is all `-`; subsequent lines are data padded to column widths.
  </behavior>
  <action>
    **Step 1 — Write tests above (RED).** Confirm they all fail (no source files yet).

    **Step 2 — Implement `src/openai/request-logger.ts`:**

    ```typescript
    import { appendFileSync, mkdirSync, existsSync } from "node:fs";
    import { join } from "node:path";
    import type { Logger } from "pino";

    export interface RequestLogRecord {
      readonly request_id: string;
      readonly timestamp_iso: string;       // new Date().toISOString()
      readonly method: string;               // GET / POST / OPTIONS
      readonly path: string;                 // e.g. /v1/chat/completions
      readonly agent: string | null;         // null when not resolved (pre-auth failures, /models)
      readonly model: string | null;         // from request body.model when parsed
      readonly stream: boolean | null;       // null for GET /v1/models
      readonly status_code: number;
      readonly ttfb_ms: number | null;       // non-null only for stream:true + sent-first-chunk
      readonly total_ms: number;             // request-start to response-end
      readonly bearer_key_prefix: string | null;   // first 12 chars, null when no bearer
      readonly messages_count: number | null;      // null when no body / no messages
      readonly response_bytes: number;             // Content-Length or approx sum
      readonly error_type: string | null;          // OpenAI error.type when status >= 400
      readonly error_code: string | null;          // OpenAI error.code when status >= 400
      readonly finish_reason: string | null;       // from translator.finalize (stream/non-stream)
      readonly messages?: ReadonlyArray<{role: string; content: string}>;  // present iff includeBodies
    }

    export interface RequestLogger {
      log(record: RequestLogRecord): void;  // non-blocking, fails silent
      close(): Promise<void>;
    }

    export interface CreateRequestLoggerOpts {
      readonly dir: string;                  // default: ~/.clawcode/manager/
      readonly includeBodies?: boolean;      // default false; opt-in via env
      readonly clock?: () => Date;           // injected for tests
      readonly log: Logger;                  // warn-on-write-failure only
    }

    export function createRequestLogger(opts: CreateRequestLoggerOpts): RequestLogger {
      const clock = opts.clock ?? (() => new Date());
      const includeBodies = opts.includeBodies === true;
      let lastWarnAt = 0;
      let warnInFlight = false;

      function ensureDir(): void {
        if (!existsSync(opts.dir)) {
          mkdirSync(opts.dir, { recursive: true });
        }
      }

      function todayUtcIso(): string {
        return clock().toISOString().slice(0, 10);
      }

      function filePath(): string {
        return join(opts.dir, `openai-requests-${todayUtcIso()}.jsonl`);
      }

      function redact(record: RequestLogRecord): RequestLogRecord {
        if (includeBodies) return record;
        // Strip messages entirely when not opted in — keep messages_count only.
        const { messages: _omit, ...rest } = record as RequestLogRecord & { messages?: unknown };
        return rest as RequestLogRecord;
      }

      function maybeWarn(err: Error): void {
        const now = clock().getTime();
        if (now - lastWarnAt < 60_000) return;
        lastWarnAt = now;
        opts.log.warn(
          { err: err.message, dir: opts.dir },
          "openai request logger: write failed (rate-limited, 1/min)",
        );
      }

      return {
        log(record) {
          try {
            ensureDir();
            const line = JSON.stringify(redact(record)) + "\n";
            appendFileSync(filePath(), line);
          } catch (err) {
            try {
              maybeWarn(err as Error);
            } catch {
              // absolute last-resort silence — never throw from log()
            }
          }
        },
        async close() {
          // appendFileSync is synchronous — nothing to flush.
        },
      };
    }
    ```

    Design decisions (document inline):
    - Sync appendFileSync is intentional. At ≤ dozens of req/min on a daemon
      with one HTTP listener, the 100–500µs cost per write is negligible
      versus async reorder complexity. Fails silent on write error.
    - Bearer prefix is first 12 chars of the raw incoming key — never the
      SHA-256 hash (which is already stored in api-keys.db; don't duplicate).
      Server is responsible for slicing before handing to logger.
    - includeBodies is a BLAST RADIUS control — opt-in via
      `CLAWCODE_OPENAI_LOG_BODIES=true`. Default strips `messages` entirely.
    - File format: one JSON object per line, newline-terminated (JSONL).
      Name: `openai-requests-YYYY-MM-DD.jsonl` using UTC date (so operators
      across timezones see a single roll-over boundary).

    **Step 3 — Wire into `src/openai/server.ts`:**

    Add `requestLogger?: RequestLogger` to `OpenAiServerConfig`.
    In `route()`, build a record object at entry:
    ```typescript
    const recordStart = Date.now();
    let ttfbAt: number | null = null;
    const partialRecord: Partial<RequestLogRecord> = {
      request_id: xRequestId,
      timestamp_iso: new Date(recordStart).toISOString(),
      method: req.method ?? "GET",
      path: url,
      agent: null,
      model: null,
      stream: null,
      bearer_key_prefix: null,
      messages_count: null,
      status_code: 0,
      ttfb_ms: null,
      total_ms: 0,
      response_bytes: 0,
      error_type: null,
      error_code: null,
      finish_reason: null,
    };
    ```

    Finalize + emit on response close:
    ```typescript
    res.on("close", () => {
      if (!config.requestLogger) return;
      const now = Date.now();
      partialRecord.total_ms = now - recordStart;
      if (ttfbAt !== null) partialRecord.ttfb_ms = ttfbAt - recordStart;
      partialRecord.status_code = res.statusCode;
      // Best-effort response_bytes — res.getHeader('content-length') when set,
      // else sum of bytes written by sendJson/handle.emit (tracked via a
      // counter decorator; if too invasive, simply read Content-Length).
      partialRecord.response_bytes =
        Number(res.getHeader("content-length") ?? 0) || 0;
      config.requestLogger.log(partialRecord as RequestLogRecord);
    });
    ```

    Thread `partialRecord` into `handleChatCompletions` / `handleModels` so
    they can fill in `agent`, `model`, `stream`, `bearer_key_prefix`,
    `messages_count`, `error_type`, `error_code`, `finish_reason`.

    Exactly-one guarantee: the close listener runs once per request (node:http
    guarantee). Guard with a `logged = false` boolean if you paranoid-want
    belt-and-suspenders.

    For stream path: set `ttfbAt = Date.now()` inside `handle.emit(firstChunk)`
    (track a boolean flag `sentFirstChunk` inside `runStreaming`).

    For `finish_reason`: grab from `translator.finalize()` (stream) or from
    `makeNonStreamResponse` result (non-stream) — both already surface it.

    **Step 4 — Wire into `src/openai/endpoint-bootstrap.ts`:**

    Add optional `requestLogger?: RequestLogger` to `OpenAiEndpointDeps`
    (for test injection). In `startOpenAiEndpoint`, when deps.requestLogger
    is absent, build the default:
    ```typescript
    const requestLogger = deps.requestLogger ?? createRequestLogger({
      dir: process.env.CLAWCODE_OPENAI_LOG_DIR ?? deps.managerDir,
      includeBodies: process.env.CLAWCODE_OPENAI_LOG_BODIES === "true",
      log: deps.log,
    });
    ```
    Pass to startServer. On `handle.close()`, also `await requestLogger.close()`.

    **Step 5 — CLI `src/cli/commands/openai-log.ts`:**

    Mirror `openai-key.ts` exactly. Export `registerOpenAiLogCommand(program, deps?)`.
    Subcommand: `tail --agent <name> --since <duration> [--json]`.

    Duration parser: reuse the `parseDuration` logic from openai-key.ts
    (extract to `src/cli/shared/duration.ts` if it gets DRY — otherwise
    duplicate the 20 lines; duplication over premature abstraction for a
    one-shot quick task).

    Reader: compute the set of date-stamped JSONL files needed based on
    `--since` (e.g. `--since 48h` covers today + yesterday's UTC file).
    Read each file, parse each line (skip malformed with a best-effort
    warn), filter by `agent` and `timestamp_iso >= cutoff`.

    Table columns: `date | request_id | agent | status | ttfb_ms | total_ms | finish_reason`.
    Mirror `renderListTable` from openai-key.ts verbatim (padded columns,
    `-` divider between header and data). Extract a shared renderer if you
    want — not required.

    `--json` flag: emit one raw JSON line per matching record (unformatted),
    bypassing the table renderer.

    `deps` bag for testability:
    ```typescript
    export interface OpenAiLogCommandDeps {
      readLogFiles: (dir: string, dates: string[]) => ReadonlyArray<RequestLogRecord>;
      log: (msg: string) => void;
      error: (msg: string) => void;
      exit: (code: number) => void;
      now?: () => Date;
      dir?: string;  // test override for `~/.clawcode/manager/`
    }
    ```

    **Step 6 — Register in `src/cli/index.ts`:**
    Add `import { registerOpenAiLogCommand } from "./commands/openai-log.js";`
    near line 49 (adjacent to `registerOpenAiKeyCommand`).
    Wire at line 176 adjacent to `registerOpenAiKeyCommand(program);`.

    **Step 7 — README.md — add short section:**
    Append under an existing "OpenAI-Compatible Endpoint" section (create if
    absent) a note like:

    > **Request logging.** Every request to `/v1/chat/completions` and
    > `/v1/models` is appended to a JSONL file at
    > `~/.clawcode/manager/openai-requests-YYYY-MM-DD.jsonl` (UTC).
    > Bearer keys are redacted to a 12-char prefix. Message bodies are
    > omitted by default; set `CLAWCODE_OPENAI_LOG_BODIES=true` to capture
    > them verbatim (WARNING: prompts may contain PII). Override the log
    > directory with `CLAWCODE_OPENAI_LOG_DIR`. Tail with
    > `clawcode openai-log tail --agent <name> --since 1h`.

    **Step 8 — RED → GREEN.**
    Run the full new test suite:
    ```
    npm test -- request-logger openai-log server
    ```
    Confirm all tests pass. Confirm existing server.test.ts tests still pass
    (they SHOULD — logger is optional and absent in bootHarness by default,
    so server behaviour is unchanged for existing tests).

    **Commit atomically:**
    ```
    git add src/openai/request-logger.ts \
            src/openai/__tests__/request-logger.test.ts \
            src/openai/server.ts \
            src/openai/__tests__/server.test.ts \
            src/openai/endpoint-bootstrap.ts \
            src/cli/commands/openai-log.ts \
            src/cli/commands/__tests__/openai-log.test.ts \
            src/cli/index.ts \
            README.md
    git commit -m "feat(openai): JSONL request logging + clawcode openai-log tail subcommand"
    ```

    **Security-rule adherence:**
    - No hardcoded secrets — bearer prefix is 12 chars of the provided key
      ONLY at server runtime. Never logged in tests (use synthetic keys).
    - Inputs validated — `--since` parses via duration parser; unparseable →
      error + exit 1 (mirror openai-key.ts's try/catch).
    - Error messages — do NOT leak the full file path or the full bearer
      key in the pino warn message on write failure (use a 12-char prefix
      of the dir path if needed; the full path in .clawcode/manager/ is
      safe as it's a fixed project dir, not user-secret).

    **Coding-style adherence:**
    - Immutable: `redact()` returns a new object via spread. No in-place
      mutation of the RequestLogRecord.
    - Small files: request-logger.ts is ~80 lines. openai-log.ts is ~150
      (mirrors openai-key.ts's size).
    - Error handling: every fs call in request-logger.ts is try/wrapped,
      never re-throws.
    - No deep nesting: the `log()` method is 3 levels max.
  </action>
  <verify>
    <automated>npm test -- request-logger.test.ts server.test.ts openai-log.test.ts &amp;&amp; npx tsx src/cli/index.ts openai-log tail --help</automated>
  </verify>
  <done>
    - `src/openai/request-logger.ts` exists, ~80 lines, exports `RequestLogRecord`, `RequestLogger`, `createRequestLogger`.
    - `src/openai/__tests__/request-logger.test.ts` RL-1 through RL-7 all pass.
    - `src/openai/__tests__/server.test.ts` SI-1 through SI-6 all pass.
    - `src/openai/server.ts` accepts `requestLogger?` in `OpenAiServerConfig`, emits exactly one record per request in `res.on('close')`.
    - `src/openai/endpoint-bootstrap.ts` constructs a default logger at `CLAWCODE_OPENAI_LOG_DIR ?? managerDir`, honors `CLAWCODE_OPENAI_LOG_BODIES`, closes it in `handle.close()`.
    - `src/cli/commands/openai-log.ts` exports `registerOpenAiLogCommand`, registered in `src/cli/index.ts`.
    - `clawcode openai-log tail --help` prints usage (smoke check via `npx tsx`).
    - `clawcode openai-log tail` from an empty log dir prints "No requests logged." and exits 0.
    - Manual spot-check: run a test request against a local daemon, then `tail -1 ~/.clawcode/manager/openai-requests-$(date -u +%F).jsonl | jq .` shows the expected schema with `bearer_key_prefix.length === 12` and no raw message content.
    - README.md has the "Request logging" subsection.
    - `git log -1` shows `feat(openai): JSONL request logging + clawcode openai-log tail subcommand`.
    - No bearer keys or full message bodies appear in any test output or committed fixture.
  </done>
</task>

</tasks>

<verification>
**Full-suite regression gate** (run after both tasks land):
```
npm test
```
Expected: 2846 + (~6 new for Task 1) + (~17 new for Task 2) = ~2869 passing.
The 8 pre-existing flaky timeouts noted in STATE.md (stopped_at line) are
allowed to continue flaking — unrelated to this quick task.

**Manual smoke verification** (post-deploy on clawdy):
1. Restart daemon on clawdy via the orchestrator's update flow.
2. Hit `/v1/models` with a valid bearer key — see one JSONL line.
3. Hit `/v1/chat/completions` with an invalid bearer — see 401 JSONL line.
4. Hit `/v1/chat/completions` with valid bearer + stream:true — see JSONL line
   with `stream:true` and `ttfb_ms > 0`.
5. `clawcode openai-log tail --agent clawdy --since 10m` — table output matches
   the last 10 minutes.
6. (Memory cascade) Corrupt a test agent's memories.db (or revoke workspace
   read perms), restart the daemon, confirm `clawcode status` shows the agent
   as `failed` with the ROOT-CAUSE error in lastError — not the warm-path
   wrapper message.
</verification>

<success_criteria>
- Task 1 commit on master: fail-fast startAgent + 6 new tests + no existing-test regressions.
- Task 2 commit on master: request-logger module + server wiring + endpoint-bootstrap wiring + CLI subcommand + README note + 17 new tests.
- Full `npm test` green (modulo the 8 pre-existing flaky timeouts documented in STATE.md).
- Zero new npm dependencies.
- Zero bearer keys or message bodies visible in any JSONL output during default test or smoke runs.
- `git log --oneline -2` shows both commits on master in order (Task 1 first, Task 2 second — Task 2 has no dep on Task 1's diff but committing the bug fix first keeps history clean).
</success_criteria>

<output>
Both tasks commit directly. No SUMMARY.md needed for this quick task (the
commit messages + PLAN.md are sufficient artifact). After land: orchestrator
pushes to remote and runs the standard update flow on clawdy.
</output>
