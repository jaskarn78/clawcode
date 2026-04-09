# Phase 5: Heartbeat & Monitoring - Research

**Researched:** 2026-04-09
**Domain:** Extensible health-check framework with plugin-based check discovery
**Confidence:** HIGH

## Summary

Phase 5 adds an extensible heartbeat framework that periodically runs health checks against each running agent. The first built-in check monitors context fill percentage using the existing `CharacterCountFillProvider` from Phase 4. New checks are added by dropping `.ts` modules into `src/heartbeat/checks/` -- no core code modification required.

The codebase is well-structured for this addition. The `SessionManager` already exposes per-agent accessors (`getMemoryStore`, `getCompactionManager`, `getRunningAgents`), the IPC protocol is easily extended with new methods, the CLI follows a clean commander-based registration pattern, and Zod schemas compose naturally. The heartbeat runner is a new standalone module (`src/heartbeat/`) that integrates at daemon startup.

**Primary recommendation:** Build the heartbeat as an independent `HeartbeatRunner` class with injectable dependencies (session manager, registry, logger). Discovery uses `readdirSync` on the checks directory at startup. Each check module exports a well-typed interface. The runner uses `setInterval` with sequential per-agent check execution. Results are logged to per-agent `memory/heartbeat.log` as newline-delimited JSON and cached in-memory for the IPC `heartbeat-status` query.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Directory-based discovery -- checks are `.ts` modules in `src/heartbeat/checks/` directory
- D-02: Each check module exports: `{ name: string, interval?: number, execute: (context: CheckContext) => Promise<CheckResult> }`
- D-03: CheckResult has status (healthy/warning/critical), message, optional metadata object
- D-04: CheckContext provides access to agent name, session manager, memory store, registry
- D-05: Checks discovered at heartbeat startup by scanning the checks directory
- D-06: Sequential check execution within each heartbeat tick (no parallel)
- D-07: Each check has a timeout (configurable, default 10s) -- exceeded = critical
- D-08: Check results logged to agent workspace `memory/heartbeat.log` (append-only)
- D-09: Critical results logged as warnings. No automatic remediation
- D-10: Heartbeat results queryable via IPC (`heartbeat-status` method)
- D-11: Global default heartbeat interval in clawcode.yaml (default: 60 seconds)
- D-12: Per-check interval override possible
- D-13: Heartbeat can be disabled per-agent in config (`heartbeat: false`)
- D-14: First built-in check: `context-fill.ts`
- D-15: Warning at 60% fill, critical at 75% fill (configurable thresholds)
- D-16: Uses CharacterCountFillProvider from Phase 4
- D-17: When critical, logs recommendation to compact but does NOT auto-trigger

### Claude's Discretion
- Log format details (structured JSON vs plain text)
- Check discovery implementation (glob vs readdir)
- IPC heartbeat-status response format
- Whether to include a `clawcode health` CLI command (nice to have)

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HRTB-01 | Extensible heartbeat framework that runs checks on a configurable interval | HeartbeatRunner class with setInterval, config schema extension, daemon integration |
| HRTB-02 | Context fill percentage monitoring as the first built-in heartbeat check | context-fill.ts check module reusing CharacterCountFillProvider |
| HRTB-03 | Heartbeat checks are pluggable -- new checks can be added without modifying core code | Directory-based discovery scanning src/heartbeat/checks/, standard export interface |
</phase_requirements>

## Standard Stack

No new dependencies required. This phase uses only existing project libraries:

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Config schema extension | Already used for all config validation |
| pino | 9.x | Structured logging | Already used for all logging |
| node:fs | built-in | Check discovery (readdirSync), log file append | No external dependency needed |
| node:timers | built-in | setInterval for heartbeat tick | Standard Node.js timer |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| readdirSync | glob package | glob is overkill for scanning a single flat directory; readdirSync + filter is simpler and synchronous at startup |
| JSON log lines | Plain text logs | JSON is machine-parseable, searchable, and matches pino's output format. Use NDJSON (newline-delimited JSON) |
| In-memory result cache | File-based query | Memory is faster for IPC queries; file is for persistence/audit trail. Use both |

## Architecture Patterns

### Recommended Project Structure
```
src/heartbeat/
  types.ts          # CheckResult, CheckContext, CheckModule, HeartbeatConfig types
  runner.ts         # HeartbeatRunner class -- the core loop
  discovery.ts      # scanChecksDirectory() -- loads check modules
  checks/
    context-fill.ts # Built-in: context fill percentage check
```

### Pattern 1: Check Module Interface
**What:** Each check is a module that exports a standard shape
**When to use:** Every check in `src/heartbeat/checks/`
**Example:**
```typescript
// src/heartbeat/types.ts
export type CheckStatus = "healthy" | "warning" | "critical";

export type CheckResult = {
  readonly status: CheckStatus;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type CheckContext = {
  readonly agentName: string;
  readonly sessionManager: SessionManager;
  readonly registry: Registry;
};

export type CheckModule = {
  readonly name: string;
  readonly interval?: number;  // per-check override in seconds
  readonly execute: (context: CheckContext) => Promise<CheckResult>;
};
```

### Pattern 2: Discovery via readdirSync + Dynamic Import
**What:** Scan checks directory at startup, dynamically import each `.ts`/`.js` module
**When to use:** HeartbeatRunner initialization
**Example:**
```typescript
// src/heartbeat/discovery.ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckModule } from "./types.js";

export async function discoverChecks(checksDir: string): Promise<readonly CheckModule[]> {
  const files = readdirSync(checksDir).filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".test.ts")
  );

  const modules: CheckModule[] = [];
  for (const file of files) {
    const mod = await import(join(checksDir, file));
    // Validate export shape
    if (mod.default && typeof mod.default.name === "string" && typeof mod.default.execute === "function") {
      modules.push(mod.default);
    }
  }
  return modules;
}
```

**Note on dynamic import:** The project already uses dynamic `import()` for `@huggingface/transformers` (Phase 4 decision). Use `export default` for check modules since dynamic import returns the module namespace. Alternatively use a named export like `export const check: CheckModule = {...}`.

**Recommendation:** Use `export default` for consistency with the module-per-file pattern. The discovery function imports and reads `.default`.

### Pattern 3: HeartbeatRunner with Per-Check Interval Tracking
**What:** Single setInterval at GCD/minimum granularity, track per-check last-run timestamps
**When to use:** Core runner loop
**Example:**
```typescript
// Simplified runner concept
export class HeartbeatRunner {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly lastRun: Map<string, number> = new Map(); // checkName -> timestamp
  private readonly latestResults: Map<string, Map<string, CheckResult>> = new Map(); // agent -> check -> result

  start(): void {
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
  }

  private async tick(): Promise<void> {
    const agents = this.sessionManager.getRunningAgents();
    for (const agentName of agents) {
      for (const check of this.checks) {
        const effectiveInterval = (check.interval ?? this.config.intervalSeconds) * 1000;
        const lastRunTime = this.lastRun.get(`${agentName}:${check.name}`) ?? 0;
        if (Date.now() - lastRunTime < effectiveInterval) continue;

        const result = await this.executeCheck(check, agentName);
        // Store, log, update lastRun...
      }
    }
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
  }
}
```

**Important design note for per-check intervals (D-12):** The simplest correct approach is to run the main tick at the global interval (60s default) and skip checks whose per-check interval hasn't elapsed. This avoids multiple setInterval timers and keeps execution sequential as required by D-06.

### Pattern 4: Check Timeout via Promise.race
**What:** Wrap check execution in a timeout race (D-07)
**When to use:** Every check execution
**Example:**
```typescript
async function executeWithTimeout(
  check: CheckModule,
  context: CheckContext,
  timeoutMs: number,
): Promise<CheckResult> {
  const timeoutPromise = new Promise<CheckResult>((resolve) => {
    setTimeout(() => {
      resolve({
        status: "critical",
        message: `Check '${check.name}' timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });

  return Promise.race([check.execute(context), timeoutPromise]);
}
```

### Pattern 5: NDJSON Append-Only Log (D-08)
**What:** Append check results as one JSON object per line to `memory/heartbeat.log`
**When to use:** After each check execution
**Example:**
```typescript
import { appendFile } from "node:fs/promises";

async function logResult(
  workspace: string,
  agentName: string,
  checkName: string,
  result: CheckResult,
): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    agent: agentName,
    check: checkName,
    status: result.status,
    message: result.message,
    ...(result.metadata ? { metadata: result.metadata } : {}),
  };
  await appendFile(
    join(workspace, "memory", "heartbeat.log"),
    JSON.stringify(entry) + "\n",
    "utf-8",
  );
}
```

**Discretion recommendation: Use structured JSON (NDJSON).** Matches pino's output philosophy, is machine-parseable for future dashboards, and is trivial to implement with `JSON.stringify` + `appendFile`.

### Pattern 6: IPC heartbeat-status Response
**What:** Return latest cached results for all agents via IPC
**Discretion recommendation:**
```typescript
// Response shape
{
  agents: {
    [agentName: string]: {
      checks: {
        [checkName: string]: {
          status: "healthy" | "warning" | "critical";
          message: string;
          lastChecked: string; // ISO timestamp
          metadata?: Record<string, unknown>;
        };
      };
      overall: "healthy" | "warning" | "critical"; // worst status across checks
    };
  };
}
```

### Pattern 7: Config Schema Extension
**What:** Add heartbeat settings to clawcode.yaml
**Example:**
```typescript
// Extend config/schema.ts
export const heartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(10).default(60),
  checkTimeoutSeconds: z.number().int().min(1).default(10),
  contextFill: z.object({
    warningThreshold: z.number().min(0).max(1).default(0.6),
    criticalThreshold: z.number().min(0).max(1).default(0.75),
  }).default(() => ({
    warningThreshold: 0.6,
    criticalThreshold: 0.75,
  })),
});
```

**Add to agent schema** for per-agent disable (D-13):
```typescript
// In agentSchema
heartbeat: z.boolean().default(true),  // or z.union([z.boolean(), heartbeatConfigSchema])
```

**Add to defaults schema** for global config (D-11):
```typescript
// In defaultsSchema
heartbeat: heartbeatConfigSchema.default(() => ({
  enabled: true,
  intervalSeconds: 60,
  checkTimeoutSeconds: 10,
  contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75 },
})),
```

### Anti-Patterns to Avoid
- **Parallel check execution:** D-06 explicitly requires sequential. Do not use `Promise.all` on checks.
- **Auto-remediation:** D-09/D-17 explicitly forbid auto-fixing. Checks report only.
- **Modifying core code to add checks:** HRTB-03 requires plugin architecture. Never import checks in runner.ts by name -- use discovery.
- **Multiple setInterval timers:** One timer with skip logic is simpler and avoids timer drift/overlap.
- **Mutating CheckResult:** Keep results immutable with `Object.freeze` or readonly types.

### Discretion Recommendation: CLI `health` Command
**Recommendation: Yes, include `clawcode health`.** It follows the exact pattern of `clawcode status` (send IPC request, format table). Minimal code (~60 lines). High user value -- the primary way to see heartbeat results without reading log files.

```
$ clawcode health
AGENT       CHECK           STATUS    MESSAGE                    LAST CHECK
researcher  context-fill    healthy   Context fill: 23%          12s ago
researcher  (overall)       healthy                              12s ago
writer      context-fill    warning   Context fill: 64%          8s ago
writer      (overall)       warning                              8s ago
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Context fill monitoring | Custom token counter | CharacterCountFillProvider from `src/memory/compaction.ts` | Already built, tested, and in use by CompactionManager. Same heuristic, same maxCharacters constant |
| Check timeout | Custom timer management | `Promise.race` with `setTimeout` | Standard pattern, no library needed, handles cleanup correctly |
| Structured logging | Custom log formatter | pino (already installed) for daemon logs, NDJSON for heartbeat.log | pino handles structured JSON; NDJSON for file is just JSON.stringify + newline |
| Config validation | Manual type checks | Zod schema extension | Project uses Zod everywhere; schema gives free validation, defaults, and type inference |
| IPC method routing | Custom dispatcher | Extend existing `routeMethod` switch in daemon.ts | Pattern is established, just add a case |

**Key insight:** This phase extends existing infrastructure rather than building new. The SessionManager, IPC protocol, config schema, and CLI command patterns are all established. The new code is the heartbeat runner and check interface -- everything else is integration.

## Common Pitfalls

### Pitfall 1: CharacterCountFillProvider Access Gap
**What goes wrong:** The heartbeat check needs to read context fill, but `CharacterCountFillProvider` instances are created per-session and not currently exposed by SessionManager.
**Why it happens:** CompactionManager uses it internally but doesn't expose the provider.
**How to avoid:** Two options: (a) Add a `getContextFillProvider` accessor to SessionManager or CompactionManager, or (b) create a new `CharacterCountFillProvider` in the context-fill check and have the check query the CompactionManager's threshold state. Option (a) is cleaner -- expose the provider via CompactionManager.
**Warning signs:** Test fails because fill percentage is always 0.

### Pitfall 2: Dynamic Import Path Resolution in Bundled Code
**What goes wrong:** `import(join(checksDir, file))` fails after `tsup` bundling because the checks directory path is wrong relative to the bundle.
**Why it happens:** `tsup` bundles source files but plugin files need to remain as separate loadable modules.
**How to avoid:** Use `import.meta.url` or `__dirname` equivalent to resolve the checks directory relative to the current module. For bundled output, ensure the checks directory is copied to `dist/heartbeat/checks/`. Alternatively, configure tsup to exclude the checks directory from bundling.
**Warning signs:** "Cannot find module" errors only in production builds.

### Pitfall 3: Timer Cleanup on Shutdown
**What goes wrong:** `setInterval` keeps the process alive after `SIGTERM`, preventing clean shutdown.
**Why it happens:** The heartbeat interval isn't cleared during the daemon shutdown sequence.
**How to avoid:** Add `heartbeatRunner.stop()` to the daemon's `shutdown()` function, before `manager.stopAll()`. The HeartbeatRunner.stop() must call `clearInterval`.
**Warning signs:** Process hangs on `clawcode stop` or Ctrl+C.

### Pitfall 4: File Append Race on Concurrent Agents
**What goes wrong:** Multiple agents' heartbeat results written to different log files simultaneously could cause issues if they share a file.
**Why it happens:** Misunderstanding -- each agent has its own workspace and thus its own `heartbeat.log`. But if the runner is sequential (D-06), this is a non-issue even with shared files.
**How to avoid:** Confirm that log paths use per-agent workspace paths. Sequential execution within a tick naturally serializes writes.
**Warning signs:** Interleaved JSON lines in heartbeat.log (indicates parallel writes).

### Pitfall 5: Zod 4 Default Function Form
**What goes wrong:** `z.object({...}).default({...})` may not work as expected with nested objects in Zod 4.
**Why it happens:** Known project gotcha (Phase 1 decision: "Zod 4 default() on object schemas requires function form for nested defaults").
**How to avoid:** Always use `default(() => ({...}))` function form for object defaults, not `default({...})` literal form.
**Warning signs:** Shared default reference mutation between config instances.

### Pitfall 6: Workspace Directory May Not Exist for heartbeat.log
**What goes wrong:** `appendFile` to `memory/heartbeat.log` fails because the `memory/` directory doesn't exist for an agent.
**Why it happens:** If memory init failed (non-fatal, per Phase 4 decision), the memory directory might not exist.
**How to avoid:** Use `mkdirSync(memoryDir, { recursive: true })` before first log write, or check existence. The SessionManager's `initMemory` already creates this directory, but a defensive check in the log writer is cheap insurance.
**Warning signs:** ENOENT error on first heartbeat tick.

## Code Examples

### Context Fill Check Implementation
```typescript
// src/heartbeat/checks/context-fill.ts
import type { CheckModule } from "../types.js";

const contextFillCheck: CheckModule = {
  name: "context-fill",
  // Uses global interval by default (no override)
  execute: async (context) => {
    const compactionManager = context.sessionManager.getCompactionManager(context.agentName);
    if (!compactionManager) {
      return {
        status: "healthy",
        message: "No memory system configured",
        metadata: { fillPercentage: 0 },
      };
    }

    // Need to access the fill provider -- see Pitfall 1
    const fillPercentage = context.fillProvider?.getContextFillPercentage() ?? 0;
    const config = context.heartbeatConfig.contextFill;

    if (fillPercentage >= config.criticalThreshold) {
      return {
        status: "critical",
        message: `Context fill: ${Math.round(fillPercentage * 100)}% -- recommend compaction`,
        metadata: { fillPercentage },
      };
    }

    if (fillPercentage >= config.warningThreshold) {
      return {
        status: "warning",
        message: `Context fill: ${Math.round(fillPercentage * 100)}%`,
        metadata: { fillPercentage },
      };
    }

    return {
      status: "healthy",
      message: `Context fill: ${Math.round(fillPercentage * 100)}%`,
      metadata: { fillPercentage },
    };
  },
};

export default contextFillCheck;
```

### IPC Protocol Extension
```typescript
// Add to IPC_METHODS array in src/ipc/protocol.ts
export const IPC_METHODS = [
  "start",
  "stop",
  "restart",
  "start-all",
  "status",
  "routes",
  "rate-limit-status",
  "heartbeat-status",  // NEW
] as const;
```

### Daemon Integration Point
```typescript
// In startDaemon(), after step 7 (reconcile registry):

// 8. Initialize heartbeat runner
const heartbeatRunner = new HeartbeatRunner({
  sessionManager: manager,
  registryPath: REGISTRY_PATH,
  config: config.defaults.heartbeat,
  checksDir: join(import.meta.dirname, "../heartbeat/checks"),
  log,
});
await heartbeatRunner.initialize(); // discover checks
heartbeatRunner.start();

// In shutdown():
heartbeatRunner.stop();
```

### Config Extension in clawcode.yaml
```yaml
version: 1
defaults:
  model: sonnet
  heartbeat:
    intervalSeconds: 60
    checkTimeoutSeconds: 10
    contextFill:
      warningThreshold: 0.6
      criticalThreshold: 0.75

agents:
  - name: researcher
    channels: ["123456"]
  - name: indexer
    heartbeat: false  # disable heartbeat for this agent
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.3 |
| Config file | `vitest.config.ts` (exists, minimal config) |
| Quick run command | `npx vitest run src/heartbeat --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HRTB-01 | HeartbeatRunner starts, ticks at interval, executes checks sequentially | unit | `npx vitest run src/heartbeat/__tests__/runner.test.ts -x` | Wave 0 |
| HRTB-01 | Check timeout produces critical result | unit | `npx vitest run src/heartbeat/__tests__/runner.test.ts -x` | Wave 0 |
| HRTB-01 | Config schema validates heartbeat settings with defaults | unit | `npx vitest run src/config/__tests__/schema.test.ts -x` | Extend existing |
| HRTB-02 | Context fill check returns healthy/warning/critical at correct thresholds | unit | `npx vitest run src/heartbeat/__tests__/context-fill.test.ts -x` | Wave 0 |
| HRTB-02 | Context fill check uses CharacterCountFillProvider | unit | `npx vitest run src/heartbeat/__tests__/context-fill.test.ts -x` | Wave 0 |
| HRTB-03 | Discovery loads modules from checks directory | unit | `npx vitest run src/heartbeat/__tests__/discovery.test.ts -x` | Wave 0 |
| HRTB-03 | Discovery ignores non-module files and test files | unit | `npx vitest run src/heartbeat/__tests__/discovery.test.ts -x` | Wave 0 |
| HRTB-01 | IPC heartbeat-status returns cached results | unit | `npx vitest run src/ipc/__tests__/client-server.test.ts -x` | Extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run src/heartbeat --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/heartbeat/__tests__/runner.test.ts` -- covers HRTB-01 (runner lifecycle, timeout, sequential execution)
- [ ] `src/heartbeat/__tests__/context-fill.test.ts` -- covers HRTB-02 (threshold logic)
- [ ] `src/heartbeat/__tests__/discovery.test.ts` -- covers HRTB-03 (directory scanning, module validation)

## Open Questions

1. **CharacterCountFillProvider instance access**
   - What we know: CompactionManager is accessible via `sessionManager.getCompactionManager(name)`, but `CharacterCountFillProvider` instances are created and managed at the session level (not currently exposed).
   - What's unclear: Whether to expose the existing fill provider through CompactionManager, or create a separate one in the heartbeat check. Creating a separate one would give stale data (it wouldn't know about accumulated turns).
   - Recommendation: Add a `getContextFillPercentage()` method or `fillProvider` accessor to CompactionManager/SessionManager. The heartbeat check needs the live fill state, not a fresh provider.

2. **Bundled vs unbundled check modules**
   - What we know: tsup bundles the project. Dynamic import of check modules needs them to exist as separate files at runtime.
   - What's unclear: Whether tsup's current config already handles this, or if we need to configure it to exclude/copy the checks directory.
   - Recommendation: Investigate tsup config. May need `external` or `noExternal` configuration, or a copy step for the checks directory.

## Project Constraints (from CLAUDE.md)

- **Immutability:** All CheckResult, CheckContext, and config objects must be readonly. Never mutate existing objects.
- **File organization:** Many small files. The heartbeat module gets its own directory with types, runner, discovery, and checks as separate files.
- **Error handling:** Handle errors at every level. Check execution must catch and wrap errors, never silently swallow.
- **Input validation:** Zod schema for all config extensions. Validate check module exports at discovery time.
- **Security:** No hardcoded secrets. Heartbeat config thresholds come from validated config only.
- **Functions < 50 lines, files < 800 lines:** Keep runner methods focused.
- **No deep nesting > 4 levels**

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/manager/session-manager.ts`, `src/manager/daemon.ts`, `src/memory/compaction.ts` -- direct code inspection
- Existing codebase: `src/config/schema.ts`, `src/ipc/protocol.ts`, `src/ipc/server.ts` -- established patterns
- Existing codebase: `src/cli/commands/status.ts` -- CLI command pattern

### Secondary (MEDIUM confidence)
- Node.js `readdirSync` + dynamic `import()` for module discovery -- standard Node.js pattern, well-documented
- `Promise.race` for timeout -- standard JavaScript pattern

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies; all patterns from existing codebase
- Architecture: HIGH - Clear extension points; well-defined decisions from CONTEXT.md
- Pitfalls: HIGH - Based on direct code inspection and established project decisions

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (stable -- no external dependencies changing)
