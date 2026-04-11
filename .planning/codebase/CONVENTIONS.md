# Coding Conventions

**Analysis Date:** 2026-04-11

## Naming Patterns

**Files:**
- kebab-case for all source files: `session-manager.ts`, `rate-limiter.ts`, `graph-search.ts`
- Test files co-located with source or in `__tests__/` subdirectory: `store.test.ts` or `__tests__/store.test.ts`
- Type-only files named with `.types.ts` suffix: `consolidation.types.ts`, `graph.types.ts`, `graph-search.types.ts`

**Classes:**
- PascalCase: `MemoryStore`, `EscalationBudget`, `SemanticSearch`, `ConfigWatcher`
- Error classes end with `Error`: `MemoryError`, `ConfigValidationError`, `BudgetExceededError`, `SessionError`

**Functions:**
- camelCase: `loadConfig`, `resolveAgentConfig`, `calculateRelevanceScore`, `createRateLimiter`
- Factory functions prefixed with `create`: `createRateLimiter`, `createIpcServer`, `createTestStore` (in tests)
- Boolean return functions prefixed with verb: `canEscalate`, `shouldAlert`, `checkChannelAccess`

**Types:**
- PascalCase for all types and interfaces: `MemoryEntry`, `AgentBudgetConfig`, `CreateMemoryInput`
- Config types suffixed with `Config`: `DedupStoreConfig`, `AgentBudgetConfig`, `DecayParams`
- Input types suffixed with `Input`: `CreateMemoryInput`, `EpisodeInput`
- Schema constants use camelCase with `Schema` suffix: `configSchema`, `heartbeatConfigSchema`, `scheduleEntrySchema`

**Constants:**
- SCREAMING_SNAKE_CASE for exported constants: `DEFAULT_DEDUP_CONFIG`, `DEFAULT_RATE_LIMITER_CONFIG`, `MANAGER_DIR`, `SOCKET_PATH`, `ADVISOR_RESPONSE_MAX_LENGTH`

**Private class members:**
- Prefix `#` not used; `private readonly` modifier used instead: `private readonly db: DatabaseType`

## TypeScript Strictness

**tsconfig settings** (`tsconfig.json`):
- `"strict": true` — all strict checks enabled
- `"target": "ES2022"`
- `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
- `"declaration": true`, `"declarationMap": true`, `"sourceMap": true`
- `"esModuleInterop": true`, `"skipLibCheck": true`

**Type annotation style:**
- All function parameters and return types explicitly annotated
- `readonly` used pervasively on all type properties — see `src/memory/types.ts`:
  ```typescript
  export type MemoryEntry = {
    readonly id: string;
    readonly content: string;
    readonly source: MemorySource;
    readonly importance: number;
    readonly accessCount: number;
    readonly tags: readonly string[];
    readonly embedding: Float32Array | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly accessedAt: string;
    readonly tier: MemoryTier;
  };
  ```
- `as const` used for literal string type narrowing: `tier: "warm" as const`
- `as unknown as T` for mock type casting in tests
- Type parameters explicitly named: `ReadonlyArray<{ name: string }>` not `Array<any>`

**Zod integration:**
- Schemas defined in dedicated `schema.ts` files per module
- `z.infer<typeof schema>` used to derive TypeScript types from Zod schemas
- Import from `"zod/v4"` (Zod v4): `import { z } from "zod/v4"`

## Immutability Patterns

**Object.freeze** used consistently on all returned domain objects:
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
  updatedAt: now,
  accessedAt: now,
  tier: "warm" as const,
});
```

**Nested freeze:** Arrays within frozen objects are also frozen: `Object.freeze([...tags])`

**Array returns:** All collection-returning methods return `readonly T[]`:
```typescript
listRecent(limit: number): readonly MemoryEntry[]
listByTier(tier: MemoryTier, limit: number): readonly MemoryEntry[]
getSessionLogDates(): readonly string[]
```

**No mutation of inputs:** Functions explicitly avoid mutating parameters. Tests verify this:
```typescript
it("does not mutate input agent object", () => {
  const agentCopy = { ...agent };
  resolveAgentConfig(agent, defaults);
  expect(agent).toEqual(agentCopy);
});
```

**Spread for merges:** `{ ...defaults.heartbeat, enabled: false }` not mutation

## Import Organization

**Order:**
1. Node built-ins with `node:` prefix: `import { readFile } from "node:fs/promises"`
2. Third-party packages: `import Database from "better-sqlite3"`
3. Internal modules with `.js` extension (ESM): `import { MemoryError } from "./errors.js"`

**Path style:**
- Always use `.js` extension on relative imports (ESM NodeNext resolution): `"./errors.js"`, `"../shared/logger.js"`
- No path aliases configured — all imports are relative or package names
- `type` imports used when importing only types: `import type { Database as DatabaseType } from "better-sqlite3"`

**Module pattern:**
- Named exports preferred over default exports
- Barrel `index.ts` files used sparingly (only `src/memory/index.ts` found)

## Error Handling

**Custom error hierarchy** in `src/shared/errors.ts` and `src/memory/errors.ts`:
```typescript
export class ConfigValidationError extends Error {
  readonly issues: readonly string[];
  constructor(error: z.ZodError, rawConfig?: unknown) {
    const issues = formatZodIssues(error, rawConfig);
    super(`Config validation failed:\n${issues.join("\n")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}
```

**Pattern:** Every custom error:
1. Extends `Error`
2. Sets `this.name` to the class name
3. Adds readonly context properties (`readonly dbPath`, `readonly agentName`, `readonly code`)
4. Calls `super()` with a descriptive message

**Catch pattern:** Errors extracted safely before rethrowing as domain errors:
```typescript
} catch (error) {
  if (error instanceof MemoryError) throw error;
  const message = error instanceof Error ? error.message : "Unknown error";
  throw new MemoryError(`Failed to insert memory: ${message}`, this.dbPath);
}
```

**Async error flow:** `async` functions throw custom errors; callers receive typed exceptions

**Graceful missing file handling:** Many filesystem operations return empty defaults instead of throwing:
```typescript
// From src/security/acl-parser.ts
try {
  content = await readFile(filePath, "utf-8");
} catch {
  return [];  // Missing file = empty ACLs, not an error
}
```

## Logging

**Framework:** `pino` — `src/shared/logger.ts`

```typescript
import pino from "pino";
const LOG_LEVEL = process.env["CLAWCODE_LOG_LEVEL"] ?? "info";
export const logger = pino({ name: "clawcode", level: LOG_LEVEL });
```

**Usage:** Import `logger` singleton; use structured child loggers for module context:
```typescript
const log = logger.child({ agent: agentName });
log.info({ sessionId }, "Session started");
```

**In tests:** Logger is mocked with `vi.fn()` stubs for all levels:
```typescript
function mockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}
```

## Comments and Documentation

**JSDoc style:** Used on all exported functions and classes:
```typescript
/**
 * Calculate the relevance score for a memory entry based on importance and recency.
 *
 * Formula: importance * 0.5^(daysSinceAccess / halfLifeDays)
 *
 * @param importance - Base importance score (0-1)
 * @param accessedAt - ISO 8601 timestamp of last access
 * @param now - Current reference time
 * @param config - Decay configuration with halfLifeDays
 * @returns Relevance score in [0, 1]
 */
```

**Inline comments:** Used for non-obvious logic, migration steps, and SQL query context

**Type-level comments:** Single-line `/** */` on type declarations:
```typescript
/** Parameters controlling the decay curve. */
export type DecayParams = { readonly halfLifeDays: number; };
```

**Section comments:** Private method blocks separated with `/** Prepared statements for all store operations. */`

## Module Design

**Class pattern:** Classes encapsulate state and behavior; pure functions used for stateless logic:
- `MemoryStore` (class) — wraps SQLite state
- `calculateRelevanceScore` (function) — pure calculation

**Dependency injection:** Classes accept dependencies via constructor or typed `Deps` objects:
```typescript
// From src/memory/compaction.ts
type CompactionDeps = {
  memoryStore: MemoryStore;
  embedder: EmbeddingService;
  sessionLogger: SessionLogger;
  threshold: number;
  logger: Logger;
};
```

**Prepared statements pattern:** SQLite classes pre-compile all statements in constructor:
```typescript
type PreparedStatements = {
  readonly insertMemory: Statement;
  readonly getById: Statement;
  // ...
};
private readonly stmts: PreparedStatements;
```

**Constants for defaults:** Module-level `readonly` constant objects for defaults:
```typescript
const DEFAULT_DEDUP_CONFIG: DedupStoreConfig = {
  enabled: true,
  similarityThreshold: 0.85,
};
```

## File Organization Rules

- 200–400 lines typical; `src/manager/daemon.ts` at 1240 lines is the known outlier
- Feature-first directory structure: `src/memory/`, `src/discord/`, `src/config/`
- Types co-located near their consumers, not in a shared `types/` folder
- Shared infrastructure in `src/shared/`: `errors.ts`, `logger.ts`, `types.ts`

---

*Convention analysis: 2026-04-11*
