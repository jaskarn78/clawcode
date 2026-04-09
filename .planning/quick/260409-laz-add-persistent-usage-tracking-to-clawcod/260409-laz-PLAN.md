---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/usage/tracker.ts
  - src/usage/types.ts
  - src/manager/session-adapter.ts
  - src/manager/session-manager.ts
  - src/manager/daemon.ts
  - src/discord/slash-types.ts
  - src/cli/commands/usage.ts
  - src/cli/index.ts
  - src/usage/tracker.test.ts
  - src/cli/commands/usage.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Usage events are recorded automatically on every SDK send/sendAndCollect result"
    - "Usage data persists in per-agent SQLite in the agent's memory directory"
    - "CLI command 'clawcode usage <agent>' shows session and weekly totals"
    - "/usage slash command shows session totals and this week's usage in Discord"
    - "/status output includes a usage summary line"
  artifacts:
    - path: "src/usage/types.ts"
      provides: "UsageEvent type and aggregation result types"
    - path: "src/usage/tracker.ts"
      provides: "UsageTracker class with SQLite storage and aggregation methods"
      exports: ["UsageTracker"]
    - path: "src/cli/commands/usage.ts"
      provides: "CLI usage command"
      exports: ["registerUsageCommand"]
  key_links:
    - from: "src/manager/session-adapter.ts"
      to: "UsageTracker"
      via: "result message extraction in wrapSdkSession send/sendAndCollect"
      pattern: "usageCallback"
    - from: "src/manager/session-manager.ts"
      to: "src/usage/tracker.ts"
      via: "usageTrackers Map initialized in initMemory"
      pattern: "usageTrackers"
    - from: "src/manager/daemon.ts"
      to: "SessionManager"
      via: "IPC 'usage' method route"
      pattern: "case \"usage\""
---

<objective>
Add persistent usage tracking to ClawCode agents so token consumption, cost, turns, model, and duration are recorded per SDK interaction and queryable via CLI and Discord.

Purpose: Enables operators to monitor per-agent resource consumption over time, essential for cost management with 14+ concurrent agents.
Output: UsageTracker class, updated session adapter with usage extraction, IPC method, CLI command, /usage slash command, usage line in /status.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/manager/session-adapter.ts
@src/manager/session-manager.ts
@src/manager/daemon.ts
@src/discord/slash-types.ts
@src/cli/commands/memory.ts
@src/cli/commands/health.ts
@src/cli/index.ts
@src/memory/store.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create UsageTracker with SQLite storage and aggregation</name>
  <files>src/usage/types.ts, src/usage/tracker.ts, src/usage/tracker.test.ts</files>
  <behavior>
    - Test: record() inserts a usage event and getSessionUsage(sessionId) returns correct totals
    - Test: getDailyUsage(date) aggregates all events for that day
    - Test: getWeeklyUsage(weekStart) aggregates all events from weekStart to weekStart+7 days
    - Test: getTotalUsage() returns lifetime totals for the agent
    - Test: getTotalUsage() with agentFilter returns only that agent's data
    - Test: empty database returns zero-value aggregates (not errors)
  </behavior>
  <action>
    Create src/usage/types.ts with:
    - `UsageEvent` type: { id: string, agent: string, timestamp: string (ISO), tokens_in: number, tokens_out: number, cost_usd: number, turns: number, model: string, duration_ms: number, session_id: string }
    - `UsageAggregate` type: { tokens_in: number, tokens_out: number, cost_usd: number, turns: number, duration_ms: number, event_count: number }

    Create src/usage/tracker.ts with `UsageTracker` class:
    - Constructor takes `dbPath: string` — opens better-sqlite3 database at that path, creates `usage_events` table with columns matching UsageEvent, uses WAL mode. Use nanoid for IDs.
    - `record(event: Omit<UsageEvent, 'id'>): void` — inserts a row using a prepared statement
    - `getSessionUsage(sessionId: string): UsageAggregate` — SUM aggregation WHERE session_id = ?
    - `getDailyUsage(date: string): UsageAggregate` — SUM aggregation WHERE timestamp BETWEEN date 00:00:00 and date 23:59:59
    - `getWeeklyUsage(weekStart: string): UsageAggregate` — SUM aggregation WHERE timestamp BETWEEN weekStart and weekStart + 7 days (use date-fns addDays)
    - `getTotalUsage(agent?: string): UsageAggregate` — SUM aggregation, optionally filtered by agent name
    - `close(): void` — closes the database
    - All aggregation methods return zero-value UsageAggregate when no rows match (not null). Use COALESCE in SQL.
    - Follow the same better-sqlite3 patterns as MemoryStore (prepared statements, WAL mode, synchronous API).

    Create src/usage/tracker.test.ts with vitest tests covering all behavior items above. Use a temp directory for the test database.
  </action>
  <verify>
    <automated>npx vitest run src/usage/tracker.test.ts</automated>
  </verify>
  <done>UsageTracker class stores and aggregates usage events correctly. All tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Wire usage tracking into session adapter, session manager, daemon IPC, CLI, and Discord</name>
  <files>src/manager/session-adapter.ts, src/manager/session-manager.ts, src/manager/daemon.ts, src/discord/slash-types.ts, src/cli/commands/usage.ts, src/cli/commands/usage.test.ts, src/cli/index.ts</files>
  <action>
    **Session Adapter (src/manager/session-adapter.ts):**
    - Add an optional `usageCallback` to the `wrapSdkSession` function signature: `usageCallback?: (data: { tokens_in: number; tokens_out: number; cost_usd: number; turns: number; model: string; duration_ms: number }) => void`
    - In `wrapSdkSession`, inside both `send()` and `sendAndCollect()`, after the stream drain loop completes and the `msg.type === "result"` message is received: extract usage data from the result message. The SDK result message (type "result", subtype "success") has fields: `total_cost_usd` (number), `usage` (object with `input_tokens`, `output_tokens`), `num_turns` (number), `duration_ms` (number), `model` (string). Call `usageCallback` if provided with the extracted values. Wrap in try/catch so extraction failures never break the send flow.
    - Update `SdkSessionAdapter.createSession()` and `resumeSession()` to accept an optional `usageCallback` parameter and pass it to `wrapSdkSession`.
    - Update `SessionAdapter` type to include the optional callback in both `createSession` and `resumeSession` signatures: `usageCallback?: (data: { tokens_in: number; tokens_out: number; cost_usd: number; turns: number; model: string; duration_ms: number }) => void`
    - Update `MockSessionAdapter` and `MockSessionHandle` to accept and store the callback (no-op in mock — just store for test inspection if needed).

    **Session Manager (src/manager/session-manager.ts):**
    - Import `UsageTracker` from `../usage/tracker.js`
    - Add `private readonly usageTrackers: Map<string, UsageTracker> = new Map()` alongside the other per-agent Maps
    - In `initMemory()`: create a UsageTracker at `join(memoryDir, "usage.db")`, store in `usageTrackers` map
    - In `cleanupMemory()`: close and delete the UsageTracker from the map
    - In `startAgent()`: after `this.adapter.createSession(sessionConfig)`, the adapter should receive a usage callback. Modify the `createSession` call to pass a `usageCallback` that calls `usageTracker.record({ agent: name, timestamp: new Date().toISOString(), session_id: handle.sessionId, ...data })`. Since `createSession` is async and returns the handle, create the callback before the call using the tracker from the map, and pass it as a second arg or option.
    - Add `getUsageTracker(agentName: string): UsageTracker | undefined` accessor method (follows same pattern as getMemoryStore, getTierManager, etc.)

    **Daemon IPC (src/manager/daemon.ts):**
    - Add a `case "usage"` in `routeMethod`:
      - Extract `agent` param (required string via validateStringParam)
      - Extract optional `period` param: "session" | "daily" | "weekly" | "total" (default "session")
      - Extract optional `sessionId` param (string, for session-specific queries)
      - Extract optional `date` param (string, for daily queries)
      - Get the UsageTracker from manager via `manager.getUsageTracker(agentName)`
      - If not found, throw ManagerError
      - Based on period: call the appropriate aggregation method
      - For "session": use sessionId param, or get the current session ID from the running session handle
      - For "daily": use date param, default to today's ISO date
      - For "weekly": compute this week's Monday using date-fns startOfWeek with { weekStartsOn: 1 }
      - Return `{ agent, period, ...aggregate }`

    **Discord Slash Commands (src/discord/slash-types.ts):**
    - Add a `/usage` command to DEFAULT_SLASH_COMMANDS:
      ```
      { name: "usage", description: "Show token usage and costs", claudeCommand: "Report your usage statistics: session totals and this week's usage. Include tokens in/out, cost, turns, and duration.", options: [] }
      ```
    - Update the `/status` command's `claudeCommand` to append a usage line: add `💰 Usage: ${tokens_in} in / ${tokens_out} out · $${cost} this session` to the format template

    **CLI Command (src/cli/commands/usage.ts):**
    - Follow the exact pattern of memory.ts: define response types, format function, register function
    - `UsageResponse` type: `{ agent: string; period: string; tokens_in: number; tokens_out: number; cost_usd: number; turns: number; duration_ms: number; event_count: number }`
    - `formatUsageTable(data: UsageResponse): string` — format as a compact key-value display:
      ```
      Usage for {agent} ({period})
      
      Tokens In:    {tokens_in}
      Tokens Out:   {tokens_out}
      Total Cost:   ${cost_usd}
      Turns:        {turns}
      Duration:     {duration formatted as Xm Xs}
      Events:       {event_count}
      ```
    - `registerUsageCommand(program: Command): void`:
      - `clawcode usage <agent>` — default period "session"
      - Options: `--period <period>` (session|daily|weekly|total), `--date <date>` (for daily), `--session-id <id>` (for session)
      - Sends IPC request to "usage" method, formats and prints result
      - Error handling follows ManagerNotRunningError pattern from memory.ts

    **CLI Registration (src/cli/index.ts):**
    - Import `registerUsageCommand` from `./commands/usage.js`
    - Call `registerUsageCommand(program)` after the existing command registrations

    **CLI Test (src/cli/commands/usage.test.ts):**
    - Test `formatUsageTable` with sample data, verify output contains key fields
    - Test zero-value aggregate formats correctly
  </action>
  <verify>
    <automated>npx vitest run src/usage/ src/cli/commands/usage.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>
    - Usage events are recorded on every SDK send/sendAndCollect via the callback mechanism
    - UsageTracker is initialized per-agent in SessionManager.initMemory and cleaned up in cleanupMemory
    - IPC "usage" method routes correctly in daemon with period support
    - /usage slash command exists in DEFAULT_SLASH_COMMANDS
    - /status slash command includes usage line in its format template
    - `clawcode usage <agent>` CLI command works with period options
    - TypeScript compiles cleanly
  </done>
</task>

</tasks>

<verification>
- `npx vitest run src/usage/` — all usage tracker tests pass
- `npx vitest run src/cli/commands/usage.test.ts` — CLI formatting tests pass
- `npx tsc --noEmit` — no type errors across the project
- Grep for `usageCallback` in session-adapter.ts confirms extraction wiring
- Grep for `usageTrackers` in session-manager.ts confirms per-agent lifecycle
- Grep for `case "usage"` in daemon.ts confirms IPC routing
- Grep for `registerUsageCommand` in cli/index.ts confirms CLI registration
</verification>

<success_criteria>
- UsageTracker persists events to SQLite with all required fields
- Aggregation methods return correct sums with COALESCE for empty results
- Session adapter extracts usage from SDK result messages without breaking existing send flow
- SessionManager manages UsageTracker lifecycle (init/cleanup) alongside other per-agent resources
- IPC, CLI, and Discord interfaces all expose usage data
- All tests pass, TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/260409-laz-add-persistent-usage-tracking-to-clawcod/260409-laz-SUMMARY.md`
</output>
