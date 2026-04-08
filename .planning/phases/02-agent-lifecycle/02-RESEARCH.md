# Phase 2: Agent Lifecycle - Research

**Researched:** 2026-04-08
**Domain:** Agent process lifecycle management, IPC daemon architecture, crash recovery
**Confidence:** HIGH

## Summary

Phase 2 builds a long-running TypeScript daemon (the "manager") that manages Claude Agent SDK sessions as in-process objects, a CLI-to-daemon IPC layer, a persistent JSON registry tracking session state, and crash recovery with exponential backoff. The key architectural insight is that agents are NOT separate OS processes -- they are SDK session objects held in-memory by the manager process. This simplifies process management significantly compared to child process spawning but means the manager itself is the single point of failure.

The Claude Agent SDK (v0.2.97) provides both a stable V1 API (`query()` with `resume` option) and an unstable V2 preview (`unstable_v2_createSession` / `unstable_v2_resumeSession` with `send()`/`stream()` pattern). The V2 API is the natural fit for a daemon that holds persistent sessions, but it is explicitly marked unstable. The V1 API is stable but requires managing async generators. Given the CONTEXT.md decision to use createSession/resumeSession, V2 is the path -- but it must be wrapped in a thin adapter layer to absorb API changes.

For CLI-to-daemon IPC, a Unix domain socket with a simple JSON-RPC protocol is the recommended approach. It avoids port conflicts (unlike TCP), provides fast local communication, and Node.js has first-class `net.createServer` support for Unix sockets.

**Primary recommendation:** Use the V2 SDK preview wrapped in a SessionAdapter, Unix domain socket for IPC, JSON file registry at `~/.clawcode/manager/registry.json`, and a state machine per agent for lifecycle transitions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Agents are spawned as Claude Code SDK sessions via `@anthropic-ai/claude-agent-sdk` using `createSession`/`resumeSession`
- **D-02:** The manager process holds all agent sessions in-process -- agents are NOT separate OS processes but SDK session objects
- **D-03:** Each agent session receives its workspace path, SOUL.md content, and IDENTITY.md content as system prompt context
- **D-04:** Manager is a long-running TypeScript daemon process (not AI) that manages all agent sessions
- **D-05:** CLI commands (`clawcode start`, `clawcode stop`, `clawcode restart`, `clawcode start-all`, `clawcode status`) communicate with the running manager
- **D-06:** Manager listens on a local socket/port for CLI commands (IPC between CLI and daemon)
- **D-07:** Manager reads `clawcode.yaml` on startup and creates sessions for all configured agents
- **D-08:** JSON registry file persisted to disk tracking: agent name, session ID, status (running/stopped/crashed/restarting), start time, restart count, last error
- **D-09:** Registry updated on every state change (start, stop, crash, restart)
- **D-10:** Registry survives manager restart -- on startup, manager reads registry and attempts to resume or clean up stale sessions
- **D-11:** `clawcode status` reads the registry and displays a formatted table of all agents
- **D-12:** Exponential backoff starting at 1 second, doubling on each consecutive failure, capped at 5 minutes
- **D-13:** Configurable max retries per agent (default: 10). After max retries, agent enters "failed" state and stops retrying
- **D-14:** Backoff resets to 0 after agent runs successfully for 5 minutes (configurable)
- **D-15:** On manager graceful shutdown (SIGTERM/SIGINT), all agent sessions are terminated cleanly before exit
- **D-16:** Process group management to prevent zombie processes -- manager is the process group leader

### Claude's Discretion
- IPC mechanism choice (Unix socket, TCP localhost, HTTP API)
- Exact Agent SDK session configuration and options
- Log output format and destination for agent sessions
- Status display formatting

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MGMT-02 | User can start an individual agent by name via CLI command | SDK `query()` with V1 or `unstable_v2_createSession()` with V2; CLI command via Commander; IPC to daemon |
| MGMT-03 | User can stop an individual agent by name via CLI command | `session.close()` (V2) or `query.close()` (V1); state machine transition to "stopped" |
| MGMT-04 | User can restart an individual agent by name via CLI command | Close existing session, create new one; registry tracks restart count |
| MGMT-05 | User can boot all configured agents with a single command | `loadConfig()` + `resolveAllAgents()` from Phase 1; iterate and create sessions |
| MGMT-06 | Manager detects agent process crashes and auto-restarts with exponential backoff | Stream error/result handling; backoff timer with 1s base, 2x multiplier, 5min cap |
| MGMT-07 | Manager maintains a PID registry tracking all running agent processes | JSON file at `~/.clawcode/manager/registry.json`; updated on every state change |
| MGMT-08 | Manager prevents and cleans up zombie processes on shutdown | SIGTERM/SIGINT handlers; session.close() for all active sessions; process.exit after cleanup |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Immutability:** Always create new objects, never mutate existing ones. Registry updates must produce new state objects.
- **File organization:** Many small files, 200-400 lines typical, 800 max. Manager should be split across multiple files.
- **Error handling:** Handle errors explicitly at every level. Never silently swallow errors.
- **Security:** No hardcoded secrets. Validate all inputs. Error messages must not leak sensitive data.
- **Git workflow:** Meaningful commits, review before push.
- **Testing:** Vitest is already configured (vitest.config.ts exists, `vitest run --reporter=verbose`).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/claude-agent-sdk | 0.2.97 | Agent session management | Official SDK; provides createSession/resumeSession, session lifecycle, message streaming |
| commander | 14.0.3 | CLI commands | Already in use (Phase 1); extend with start/stop/restart/status subcommands |
| pino | 9.x | Structured logging | Already in use (Phase 1); extend with per-agent child loggers |
| zod | 4.3.6 | Schema validation | Already in use (Phase 1); validate registry schema, IPC messages |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:net | built-in | Unix domain socket IPC | Manager daemon listens on socket; CLI connects as client |
| node:fs/promises | built-in | Registry file persistence | Atomic writes to JSON registry file |
| nanoid | 5.x | Unique IDs | Generate request IDs for IPC messages |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Unix domain socket (node:net) | TCP localhost | TCP risks port conflicts; Unix socket is local-only and faster |
| Unix domain socket (node:net) | HTTP API (e.g., fastify) | HTTP adds unnecessary overhead for local IPC; socket is simpler |
| V2 SDK (unstable_v2_createSession) | V1 SDK (query with resume) | V1 is stable but async generator pattern is more complex for daemon hold-session pattern; V2 is natural fit but unstable |
| JSON registry file | SQLite registry | SQLite is overkill for a single registry of <30 agents; JSON is simpler and human-readable |

**Installation:**
```bash
npm install @anthropic-ai/claude-agent-sdk nanoid
```

**Version verification:** SDK version 0.2.97 verified via `npm view` on 2026-04-08. nanoid 5.x is ESM-only, compatible with this project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  manager/
    daemon.ts          # Daemon entry point, signal handling, socket server
    session-manager.ts # Create/resume/close SDK sessions, state machine
    registry.ts        # JSON registry read/write, atomic file operations
    backoff.ts         # Exponential backoff calculator
    types.ts           # Manager-specific types (AgentState, RegistryEntry, etc.)
  ipc/
    server.ts          # Unix socket JSON-RPC server (runs in daemon)
    client.ts          # Unix socket JSON-RPC client (used by CLI)
    protocol.ts        # Shared message types and validation schemas
  cli/
    index.ts           # Extend with start/stop/restart/start-all/status commands
    commands/
      start.ts         # clawcode start <name>
      stop.ts          # clawcode stop <name>
      restart.ts       # clawcode restart <name>
      start-all.ts     # clawcode start-all (launches daemon + boots agents)
      status.ts        # clawcode status (reads registry, formats table)
  shared/
    errors.ts          # Extend with ManagerError, SessionError, IpcError
```

### Pattern 1: Agent State Machine
**What:** Each agent has a finite state machine: `stopped -> starting -> running -> stopping -> stopped` with error transitions to `crashed -> restarting -> starting`.
**When to use:** All lifecycle transitions.
**Example:**
```typescript
// Source: Domain pattern for process supervisors
type AgentStatus = "stopped" | "starting" | "running" | "stopping" | "crashed" | "restarting" | "failed";

type RegistryEntry = {
  readonly name: string;
  readonly status: AgentStatus;
  readonly sessionId: string | null;
  readonly startedAt: number | null;
  readonly restartCount: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastStableAt: number | null;
};
```

### Pattern 2: SDK Session Wrapper
**What:** Thin adapter around the Claude Agent SDK that normalizes V2 unstable API into a stable internal interface. If SDK changes, only the adapter changes.
**When to use:** All SDK interactions.
**Example:**
```typescript
// Source: SDK adapter pattern for unstable APIs
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

type SessionHandle = {
  readonly sessionId: string;
  send(message: string): Promise<void>;
  stream(): AsyncGenerator<SDKMessage, void>;
  close(): void;
};

function createAgentSession(config: AgentSessionConfig): SessionHandle {
  const session = unstable_v2_createSession({
    model: config.model,
    cwd: config.workspace,
    systemPrompt: config.systemPrompt,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: ["user", "project"],
    persistSession: true,
  });
  return session;
}
```

### Pattern 3: JSON-RPC over Unix Socket
**What:** CLI sends JSON-RPC 2.0 messages to the daemon over a Unix domain socket. Simple request/response protocol.
**When to use:** All CLI-to-daemon communication.
**Example:**
```typescript
// Source: JSON-RPC 2.0 spec + Node.js net module
// Socket path: ~/.clawcode/manager/clawcode.sock

type IpcRequest = {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;     // "start" | "stop" | "restart" | "status" | "start-all"
  readonly params: Record<string, unknown>;
};

type IpcResponse = {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
};
```

### Pattern 4: Atomic Registry Writes
**What:** Registry updates write to a temp file then rename (atomic on POSIX). Prevents corruption from crashes during write.
**When to use:** Every registry state change.
**Example:**
```typescript
// Source: Standard POSIX atomic file write pattern
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

async function writeRegistry(
  registryPath: string,
  registry: Registry,
): Promise<void> {
  const tmpPath = `${registryPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
  await rename(tmpPath, registryPath);
}
```

### Anti-Patterns to Avoid
- **Mutable state in registry:** Never mutate registry entries in place. Always create new entry objects and new registry objects (per CLAUDE.md immutability rule).
- **Polling for agent health:** Do not poll SDK sessions with API calls. Instead, detect crashes via stream termination and result message types.
- **Synchronous IPC:** Never block the daemon's event loop waiting for a response. Use async handlers for all IPC methods.
- **Storing SDK session objects in registry:** The JSON registry stores session IDs (strings), not session objects. Session objects are held in a Map in memory.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exponential backoff | Custom retry loop with sleeps | Dedicated backoff calculator function | Edge cases: jitter, cap, reset-after-stable-period, max retries |
| JSON-RPC framing | Custom line-delimited protocol | JSON-RPC 2.0 spec with newline-delimited framing | Well-defined error codes, request/response correlation via IDs |
| Process signal handling | Raw process.on("SIGTERM") | Structured shutdown coordinator | Must handle: multiple signals, timeout-then-force, cleanup ordering |
| Session ID capture | Parsing SDK output | SDK's `session.sessionId` property (V2) or `message.session_id` from result message (V1) | SDK provides this natively |
| Atomic file writes | Direct writeFile | write-to-tmp + rename pattern | Prevents corruption on crash during write |

**Key insight:** The SDK handles the hard parts (session persistence, context management, tool execution). The manager's job is coordination and state tracking, not agent intelligence.

## Common Pitfalls

### Pitfall 1: SDK V2 API Instability
**What goes wrong:** The `unstable_v2_createSession` API changes between SDK versions, breaking the manager.
**Why it happens:** The V2 API is explicitly marked unstable preview. The prefix `unstable_v2_` signals this.
**How to avoid:** Pin exact SDK version in package.json (`"@anthropic-ai/claude-agent-sdk": "0.2.97"`). Wrap all SDK calls in a thin adapter (SessionAdapter) so changes are isolated to one file. Write integration tests against the adapter interface, not the SDK directly.
**Warning signs:** TypeScript compilation errors after SDK update. Session creation failing with unknown options.

### Pitfall 2: Socket File Cleanup
**What goes wrong:** If the manager crashes without cleanup, the Unix socket file (`~/.clawcode/manager/clawcode.sock`) remains on disk. The next manager startup gets `EADDRINUSE` because the socket file exists.
**Why it happens:** Unix domain sockets are files. They persist after the process that created them exits.
**How to avoid:** On daemon startup: (1) check if socket file exists, (2) try to connect to it -- if connection succeeds, another manager is running (abort with error), (3) if connection fails (ECONNREFUSED), delete the stale socket file and proceed. Also write a PID file alongside the socket for additional verification.
**Warning signs:** "Address already in use" errors on daemon start. Multiple daemon instances running.

### Pitfall 3: Registry Corruption on Concurrent Access
**What goes wrong:** CLI reads the registry while the daemon is mid-write, getting partial JSON.
**Why it happens:** `writeFile` is not atomic. If the daemon crashes mid-write, the file is truncated.
**How to avoid:** Always use atomic writes (write to `.tmp`, then `rename`). For CLI reads of the registry (e.g., `clawcode status`), prefer reading via IPC request to the daemon rather than reading the file directly. Fallback to file read only when daemon is not running.
**Warning signs:** JSON parse errors when reading registry. Missing or incomplete agent entries.

### Pitfall 4: Zombie Sessions After Manager Crash
**What goes wrong:** Manager crashes hard (SIGKILL, OOM). SDK sessions were in-process objects -- they die with the manager. But session state is persisted to disk by the SDK (`~/.claude/projects/...`). On manager restart, the registry says agents are "running" but the sessions are gone.
**Why it happens:** In-process sessions don't survive process death. The registry is the source of truth for "desired state" but the actual sessions are gone.
**How to avoid:** On manager startup, iterate registry entries. For any entry with status "running": attempt to resume session via SDK's `unstable_v2_resumeSession(sessionId)`. If resume succeeds, agent is recovered. If resume fails, mark as "crashed" and apply restart policy. Never trust the registry status without verifying the session exists.
**Warning signs:** Registry shows agents as "running" but no SDK sessions exist in memory.

### Pitfall 5: Backoff Reset Race
**What goes wrong:** Agent crashes at 4m59s (just under the 5-minute stability window), backoff resets to 0, then immediately crashes again and gets rapid restarts.
**Why it happens:** The stability window check uses wall-clock time from last start, not cumulative stable run time.
**How to avoid:** Track `lastStableAt` separately from `startedAt`. Only reset backoff when the agent has been continuously running for the full stability window. Use a timer that fires after the window to mark the agent as "stable" and reset the counter.
**Warning signs:** Agent rapidly cycling between "running" and "restarting" despite the backoff mechanism.

### Pitfall 6: Signal Handler Ordering
**What goes wrong:** SIGTERM handler calls `session.close()` on all sessions, but some sessions are mid-stream. The close races with the stream consumer, causing unhandled promise rejections.
**Why it happens:** `session.close()` is called while `for await (const msg of session.stream())` is still iterating. The stream throws an error that nobody catches.
**How to avoid:** Use an AbortController per session. On shutdown: (1) signal abort on all controllers, (2) wait for all stream consumers to finish (with a timeout), (3) then close sessions. Set a hard shutdown timeout (e.g., 10 seconds) and force exit if cleanup doesn't complete.
**Warning signs:** UnhandledPromiseRejection errors in logs during shutdown. Process hanging on exit.

## Code Examples

### Manager Daemon Entry Point
```typescript
// Source: Node.js net module + signal handling best practices
import { createServer } from "node:net";
import { unlink } from "node:fs/promises";

const SOCKET_PATH = join(expandHome("~/.clawcode/manager"), "clawcode.sock");
const PID_PATH = join(expandHome("~/.clawcode/manager"), "clawcode.pid");

async function startDaemon(): Promise<void> {
  await ensureCleanSocket(SOCKET_PATH);
  await writeFile(PID_PATH, String(process.pid), "utf-8");

  const sessionManager = new SessionManager(registry);
  const server = createServer((socket) => handleConnection(socket, sessionManager));

  server.listen(SOCKET_PATH, () => {
    logger.info({ socket: SOCKET_PATH }, "manager daemon started");
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutdown signal received");
    server.close();
    await sessionManager.stopAll();
    await unlink(SOCKET_PATH).catch(() => {});
    await unlink(PID_PATH).catch(() => {});
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
```

### Exponential Backoff Calculator
```typescript
// Source: Standard exponential backoff with jitter
type BackoffConfig = {
  readonly baseMs: number;       // 1000 (1 second)
  readonly maxMs: number;        // 300000 (5 minutes)
  readonly maxRetries: number;   // 10
  readonly stableAfterMs: number; // 300000 (5 minutes)
};

function calculateBackoff(
  consecutiveFailures: number,
  config: BackoffConfig,
): number {
  if (consecutiveFailures >= config.maxRetries) {
    return -1; // Signal: stop retrying
  }
  const delay = Math.min(
    config.baseMs * Math.pow(2, consecutiveFailures),
    config.maxMs,
  );
  // Add jitter: +/- 10%
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}
```

### IPC Client (for CLI commands)
```typescript
// Source: Node.js net.connect for Unix sockets
import { connect } from "node:net";

async function sendIpcRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH);
    const request: IpcRequest = {
      jsonrpc: "2.0",
      id: nanoid(),
      method,
      params,
    };

    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString(); });
    socket.on("end", () => {
      const response: IpcResponse = JSON.parse(data);
      if (response.error) {
        reject(new IpcError(response.error.message, response.error.code));
      } else {
        resolve(response.result);
      }
    });
    socket.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        reject(new ManagerNotRunningError());
      } else {
        reject(err);
      }
    });

    socket.write(JSON.stringify(request) + "\n");
    socket.end();
  });
}
```

### Status Table Formatting
```typescript
// Source: Docker ps-style output
function formatStatusTable(entries: readonly RegistryEntry[]): string {
  const header = "NAME            STATUS      UPTIME      RESTARTS  MODEL";
  const separator = "─".repeat(header.length);
  const rows = entries.map((e) => {
    const uptime = e.startedAt ? formatUptime(Date.now() - e.startedAt) : "—";
    return [
      e.name.padEnd(16),
      colorStatus(e.status).padEnd(12),
      uptime.padEnd(12),
      String(e.restartCount).padEnd(10),
      e.model ?? "—",
    ].join("");
  });
  return [header, separator, ...rows].join("\n");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| V1 query() with async generators | V2 createSession/send/stream (preview) | SDK 0.2.x (2026) | Simpler multi-turn patterns; V2 is unstable |
| child_process.spawn for agents | SDK sessions in-process | SDK 0.2.x (2026) | No child process management needed; sessions are objects |
| Raw CLI `claude -p` invocation | @anthropic-ai/claude-agent-sdk | 2025-2026 | Structured API, session management, tool hooks |

**Deprecated/outdated:**
- `@anthropic-ai/claude-code-sdk`: This package name does not exist on npm. The correct package is `@anthropic-ai/claude-agent-sdk`.
- `unstable_v2_*` prefix: Expected to stabilize eventually, but no timeline announced.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MGMT-02 | Start individual agent by name | unit + integration | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "start agent"` | Wave 0 |
| MGMT-03 | Stop individual agent by name | unit | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "stop agent"` | Wave 0 |
| MGMT-04 | Restart individual agent by name | unit | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "restart agent"` | Wave 0 |
| MGMT-05 | Boot all configured agents | unit | `npx vitest run src/manager/__tests__/session-manager.test.ts -t "start all"` | Wave 0 |
| MGMT-06 | Crash detection + exponential backoff | unit | `npx vitest run src/manager/__tests__/backoff.test.ts` | Wave 0 |
| MGMT-07 | PID/session registry tracking | unit | `npx vitest run src/manager/__tests__/registry.test.ts` | Wave 0 |
| MGMT-08 | Clean shutdown, no zombies | unit | `npx vitest run src/manager/__tests__/daemon.test.ts -t "shutdown"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/manager/__tests__/session-manager.test.ts` -- covers MGMT-02, MGMT-03, MGMT-04, MGMT-05
- [ ] `src/manager/__tests__/backoff.test.ts` -- covers MGMT-06
- [ ] `src/manager/__tests__/registry.test.ts` -- covers MGMT-07
- [ ] `src/manager/__tests__/daemon.test.ts` -- covers MGMT-08
- [ ] `src/ipc/__tests__/protocol.test.ts` -- covers IPC message validation
- [ ] `src/ipc/__tests__/client-server.test.ts` -- covers IPC round-trip
- [ ] SDK mock/stub for testing without real API calls

### Testing Strategy Notes
The Claude Agent SDK spawns real Claude Code processes and consumes API tokens. Tests MUST mock the SDK. Create a `SessionAdapter` interface and provide a `MockSessionAdapter` for tests that simulates session lifecycle (create, send, stream, close, crash) without touching the real SDK. This enables deterministic testing of backoff, registry, and lifecycle logic.

## Open Questions

1. **SDK V2 `createSession` options surface**
   - What we know: `model`, `cwd`, `systemPrompt`, `permissionMode`, `settingSources`, `persistSession` are documented options
   - What's unclear: V2 createSession accepts the same Options as V1 query(), but the V2 docs only show `model`. Need to verify all Options are forwarded.
   - Recommendation: Test with the full Options interface; fall back to V1 query() if V2 doesn't support needed options

2. **SDK Session Crash Detection**
   - What we know: The V2 `stream()` returns an AsyncGenerator. When the session ends normally, the generator completes. When it crashes, the generator likely throws or yields an error result message.
   - What's unclear: Exact error types/messages on session crash vs. normal completion vs. max_turns exceeded
   - Recommendation: Implement a stream consumer that categorizes all termination types and handles each case

3. **Process Group Leader (D-16)**
   - What we know: Since agents are in-process SDK sessions (not child processes), traditional process group management doesn't directly apply
   - What's unclear: Whether the SDK internally spawns child processes that need group management
   - Recommendation: The manager process itself should handle signals. If the SDK spawns subprocesses internally, they should die with the manager. Test this explicitly.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v22.22.0 | -- |
| npm | Package install | Yes | (bundled) | -- |
| Unix sockets | IPC | Yes | (kernel) | TCP localhost |
| @anthropic-ai/claude-agent-sdk | Agent sessions | No (not yet installed) | 0.2.97 on npm | -- |

**Missing dependencies with no fallback:**
- `@anthropic-ai/claude-agent-sdk` must be installed (`npm install @anthropic-ai/claude-agent-sdk`)

**Missing dependencies with fallback:**
- None

## Sources

### Primary (HIGH confidence)
- [Claude Agent SDK TypeScript Reference](https://code.claude.com/docs/en/agent-sdk/typescript) - Full V1 API, Options interface, session management functions
- [Claude Agent SDK V2 Preview](https://code.claude.com/docs/en/agent-sdk/typescript-v2-preview) - V2 createSession/resumeSession/send/stream API
- [Claude Agent SDK Sessions](https://code.claude.com/docs/en/agent-sdk/sessions) - Session persistence, resume, fork, session files on disk
- npm registry: `@anthropic-ai/claude-agent-sdk@0.2.97` verified 2026-04-08
- Existing codebase: Phase 1 config/schema/loader/workspace code inspected directly

### Secondary (MEDIUM confidence)
- OpenClaw reference: `~/.openclaw/subagents/runs.json` - Registry format inspiration (runId, status, startedAt, endedAt, outcome)
- OpenClaw reference: `~/.openclaw/openclaw.json` - Daemon configuration patterns

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - SDK API verified from official docs, all dependencies are either already installed or on npm
- Architecture: HIGH - Patterns derive from locked decisions in CONTEXT.md and verified SDK API surface
- Pitfalls: HIGH - Socket cleanup, atomic writes, and signal handling are well-documented Node.js patterns; SDK instability risk is documented by Anthropic themselves

**Research date:** 2026-04-08
**Valid until:** 2026-04-22 (SDK is pre-1.0, may change; 14-day window recommended)
