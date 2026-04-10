# Coding Conventions

**Analysis Date:** 2026-04-10

## Module System

**ESM throughout.** `package.json` sets `"type": "module"`. All imports use `.js` extensions even for `.ts` source files (NodeNext module resolution requirement).

```typescript
// Correct — .js extension on TypeScript imports
import { MemoryStore } from "../store.js";
import { logger } from "../shared/logger.js";
import type { ResolvedAgentConfig } from "../../shared/types.js";
```

Node built-ins use the `node:` protocol prefix:

```typescript
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
```

## Naming Patterns

**Files:**
- kebab-case for all source files: `session-adapter.ts`, `audit-trail.ts`, `episode-store.ts`
- `types.ts` for domain type modules, `errors.ts` for error classes, `schema.ts` for Zod schemas
- Test files: `__tests__/` subdirectory with matching name, e.g., `__tests__/store.test.ts`
- Exception: some tests co-located with source in CLI commands directory, e.g., `src/cli/commands/send.test.ts`

**Functions:**
- camelCase: `buildSessionConfig`, `resolveAgentConfig`, `detectBootstrapNeeded`
- CLI command registrars always named `register<Command>Command`: `registerSendCommand`, `registerStartAllCommand`
- Factory functions prefixed with `create` or `make`: `createTestStore()`, `makeDeps()`, `makeConfig()`

**Classes:**
- PascalCase: `MemoryStore`, `AgentRunner`, `TaskScheduler`, `MockSessionAdapter`
- Mock classes for testing prefixed with `Mock`: `MockSessionAdapter`, `MockSessionHandle`

**Types and Interfaces:**
- PascalCase type aliases: `MemoryEntry`, `SessionHandle`, `AgentRunnerOptions`
- Options/config types suffixed with `Options`, `Config`, `Deps`: `AgentRunnerOptions`, `SessionConfigDeps`, `DedupStoreConfig`
- Input types suffixed with `Input`: `CreateMemoryInput`, `EpisodeInput`

**Constants:**
- SCREAMING_SNAKE_CASE for module-level constants: `DEFAULT_DEDUP_CONFIG`, `SOCKET_PATH`, `BOOTSTRAP_FLAG_FILE`, `LOG_LEVEL`

## TypeScript Strictness

`tsconfig.json` enables `"strict": true` with target `ES2022` and `moduleResolution: "NodeNext"`.

**Strict patterns in practice:**
- All type parameters explicit or inferred — no implicit `any` (only deliberate `as any` in test mock factories)
- Return types declared on exported functions
- `readonly` on all type properties: `readonly id: string`, `readonly tags: readonly string[]`
- Discriminated unions for error handling over runtime type checks
- `type` imports for type-only imports: `import type { Logger } from "pino"`

**Type assertions:**
- Cast unknown error objects: `error instanceof Error ? error.message : "Unknown error"`
- SQLite row casting with explicit row types: `const row = stmt.get(id) as MemoryRow | undefined`

## Immutability Patterns

All domain objects returned as frozen with `Object.freeze()`:

```typescript
// From src/memory/store.ts
return Object.freeze({
  id,
  content: input.content,
  source: input.source,
  importance,
  accessCount: 0,
  tags: Object.freeze([...tags]),
  embedding,
  createdAt: now,
  // ...
});
```

Arrays on return types always `readonly`: `listRecent(limit: number): readonly MemoryEntry[]`

Type definitions use `readonly` on all fields — see `src/memory/types.ts` and `src/shared/types.ts`.

Options objects passed to constructors use `readonly` properties:
```typescript
type AgentRunnerOptions = {
  readonly sessionConfig: AgentSessionConfig;
  readonly sessionAdapter: SessionAdapter;
  readonly maxRestarts?: number;
};
```

## Error Handling Patterns

**Named error classes** for all domain errors, defined in module-local `errors.ts` files:
- `src/shared/errors.ts` — `ConfigValidationError`, `ConfigFileNotFoundError`, `WorkspaceError`, `ManagerError`, `SessionError`, `IpcError`, `ManagerNotRunningError`
- `src/memory/errors.ts` — `MemoryError`, `EmbeddingError`

All custom errors:
1. Extend `Error` with `super(message)`
2. Set `this.name` explicitly
3. Add `readonly` contextual fields: `readonly dbPath: string`, `readonly agentName: string`

```typescript
export class MemoryError extends Error {
  readonly dbPath: string;
  constructor(message: string, dbPath: string) {
    super(`Memory error (${dbPath}): ${message}`);
    this.name = "MemoryError";
    this.dbPath = dbPath;
  }
}
```

**Error handling in methods** — wrap all operations with try/catch, re-throw typed errors:

```typescript
try {
  // operation
} catch (error) {
  if (error instanceof MemoryError) throw error;
  const message = error instanceof Error ? error.message : "Unknown error";
  throw new MemoryError(`Failed to insert memory: ${message}`, this.dbPath);
}
```

**CLI commands** use instanceof checks to provide user-friendly messages:
```typescript
if (error instanceof ManagerNotRunningError) {
  cliError("Manager is not running. Start it with: clawcode start-all");
  process.exit(1);
}
```

## Logging Approach

**Pino** is the sole logger. Single shared instance from `src/shared/logger.ts`:

```typescript
import pino from "pino";
const LOG_LEVEL = process.env["CLAWCODE_LOG_LEVEL"] ?? "info";
export const logger = pino({ name: "clawcode", level: LOG_LEVEL });
```

Log level controlled via `CLAWCODE_LOG_LEVEL` env var (defaults to `"info"`).

**Structured logging** — always pass a context object as the first argument:
```typescript
logger.info({ agent: this.sessionConfig.name, restart: this.restartCount }, "starting agent session");
logger.warn({ agent: this.sessionConfig.name, error: err.message, restartCount: this.restartCount }, "agent session crashed");
logger.error({ agent: this.sessionConfig.name, restartCount: this.restartCount, maxRestarts: this.maxRestarts }, "max restarts exceeded");
```

**CLI output** uses explicit `process.stdout`/`process.stderr` writes, never `console.log`:
- `cliLog(message)` → `process.stdout.write(message + "\n")` (`src/cli/output.ts`)
- `cliError(message)` → `process.stderr.write(message + "\n")` (`src/cli/output.ts`)

## Config Validation Patterns (Zod)

**Import from `zod/v4`** (Zod v4 package path):
```typescript
import { z } from "zod/v4";
import type { z } from "zod/v4";
```

**Schema definition style** — each schema in `src/config/schema.ts` has a companion inferred type:
```typescript
export const scheduleEntrySchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
});
export type ScheduleEntryConfig = z.infer<typeof scheduleEntrySchema>;
```

**Validation** — use `schema.safeParse()` in tests, `schema.parse()` in production code where errors are caught and re-thrown as `ConfigValidationError`.

Default factories use arrow functions to avoid sharing mutable state:
```typescript
memory: memorySchema.default(() => ({ compactionThreshold: 0.75, ... }))
```

**Memory schema** defined in `src/memory/schema.ts`, re-exported from `src/config/schema.ts` via `export const memorySchema = memoryConfigSchema`.

## Import Organization

No enforced ordering tool (no eslint/prettier config found). Observed pattern:

1. Node built-ins (`node:` prefix)
2. Third-party packages
3. Internal absolute imports (shared utilities)
4. Internal relative imports (same-module files)
5. Type-only imports (`import type`) intermixed with value imports

## Function Design

**Small focused functions** — public methods under 50 lines typical. Private helper functions extracted for:
- SQL row mapping: `rowToEntry(row: MemoryRow): MemoryEntry`
- Error formatting: `formatZodIssues()`, `resolveAgentName()`, `extractFieldPath()`
- Options building: `turnOptions()`, `buildCleanEnv()`

**Constructor injection** for all dependencies — no static globals except the shared logger and cached SDK module.

## Module Design

**Barrel files** used selectively — `src/memory/index.ts` exists but not all modules have one.

**CLI commands** follow a consistent registration pattern:
```typescript
// Every CLI command module exports a single register function
export function registerSendCommand(program: Command): void {
  program.command("send <agent> <message>")
    .description("Send a message to an agent")
    .action(async (...) => { /* ... */ });
}
```

**Interface segregation for testing** — production interfaces have matching `Mock*` implementations co-located in the same source file (`src/manager/session-adapter.ts` exports both `SdkSessionAdapter` and `MockSessionAdapter`).

## Comments

JSDoc on all exported classes, types, and non-obvious functions. Format uses `/** ... */` blocks:

```typescript
/**
 * MemoryStore — SQLite-backed memory storage with sqlite-vec for vector search.
 *
 * Opens a better-sqlite3 database, enables WAL mode, loads the sqlite-vec
 * extension, and creates all required tables.
 */
```

Inline `//` comments for non-obvious decisions, including pitfall explanations:
```typescript
// Channel IDs are strings to prevent YAML numeric coercion (Pitfall 1).
```

---

*Convention analysis: 2026-04-10*
