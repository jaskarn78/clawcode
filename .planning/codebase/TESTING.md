# Testing Patterns

**Analysis Date:** 2026-04-11

## Test Framework

**Runner:**
- vitest v4.1.3
- Config: `vitest.config.ts` (minimal — `globals: false` is the only setting)

**Assertion Library:**
- vitest built-in (`expect`) — no separate assertion library

**Run Commands:**
```bash
npm test                    # Run all tests once, verbose reporter
npm run typecheck           # TypeScript compile check (no emit)
```

No watch mode script defined in `package.json`. Run `npx vitest` for watch mode.

No coverage script configured — coverage is not enforced.

## Test File Organization

**Two co-location patterns are mixed:**

1. `__tests__/` subdirectory — used in `src/memory/`, `src/config/`, `src/discord/`, `src/agent/`, `src/bootstrap/`, `src/cli/`, `src/dashboard/`, `src/scheduler/`, `src/skills/`, `src/manager/`:
   ```
   src/memory/
   ├── store.ts
   ├── decay.ts
   └── __tests__/
       ├── store.test.ts
       └── decay.test.ts
   ```

2. Sibling co-location — used in `src/cli/commands/`, `src/security/`, `src/usage/`, `src/mcp/`, `src/manager/`:
   ```
   src/usage/
   ├── budget.ts
   └── budget.test.ts
   ```

**Naming:** Always `<module-name>.test.ts`. No `.spec.ts` files.

**Import style in tests:** Named imports from vitest with explicit list:
```typescript
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
```

`globals: false` means test globals (`describe`, `it`, `expect`) must always be imported explicitly.

## Test Structure

**Suite organization:**
```typescript
describe("ClassName or functionName", () => {
  let subject: SubjectType;

  beforeEach(() => {
    subject = createTestSubject();
  });

  afterEach(() => {
    subject?.close();  // cleanup with optional chaining
  });

  describe("methodName", () => {
    it("describes the expected behavior in plain English", () => {
      // arrange
      // act
      // assert
    });
  });
});
```

**Nested describes:** Used to group tests by method or scenario — typical depth is 2 levels (`describe("Class") > describe("method") > it()`).

**Multiple top-level describes per file:** Common when testing multiple exported functions from one module:
```typescript
// From src/config/__tests__/loader.test.ts
describe("resolveAgentConfig", () => { ... });
describe("resolveAgentConfig - mcpServers", () => { ... });
describe("resolveContent", () => { ... });
describe("loadConfig", () => { ... });
describe("resolveEnvVars", () => { ... });
```

**Test names:** Written as expected behaviors: `"returns entry and increments access_count"`, `"does not mutate input agent object"`, `"merges near-duplicate embedding instead of creating two entries"`.

## Cleanup Patterns

**SQLite in-memory stores:** Closed in `afterEach`:
```typescript
afterEach(() => {
  store?.close();
});
```

**Temporary filesystem directories:** Created in `beforeEach`, removed in `afterEach`:
```typescript
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "clawcode-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});
```

**Environment variables:** Saved and restored manually:
```typescript
beforeEach(() => {
  savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
});
afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});
```

## Mocking

**Module mocking** — `vi.mock()` at top of file, before imports:
```typescript
// From src/memory/__tests__/embedder.test.ts
// Mock the @huggingface/transformers module to avoid 23MB model download
vi.mock("@huggingface/transformers", () => {
  const mockPipeline = vi.fn(async () => {
    return async (_text: string, _opts?: Record<string, unknown>) => ({
      tolist: () => {
        const vec = Array.from({ length: 384 }, (_, i) => i / 384);
        return [vec];
      },
    });
  });
  return { pipeline: mockPipeline };
});
```

**Inline object mocks** — factory functions that return typed mock objects via `as unknown as T`:
```typescript
// From src/memory/__tests__/compaction.test.ts
function mockMemoryStore(): MemoryStore {
  return {
    insert: vi.fn().mockReturnValue({ id: "mem-1", content: "test", ... }),
    recordSessionLog: vi.fn().mockReturnValue({ ... }),
    close: vi.fn(),
  } as unknown as MemoryStore;
}

function mockEmbedder(): EmbeddingService {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array(384)),
    warmup: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
  } as unknown as EmbeddingService;
}
```

**vi.spyOn** — used for partial mocking of real instances:
```typescript
vi.spyOn(store, "updateTier").mockImplementation((id, tier) => { ... });
```

**vi.mocked()** — used to access mock-specific API on mocked imports:
```typescript
vi.mocked(pipeline).mockResolvedValueOnce(mockExtractor as ...);
```

**vi.clearAllMocks()** — called in `beforeEach` when module mocks are in use to reset call history.

**What to mock:**
- `@huggingface/transformers` — avoid 23MB model download
- `EmbeddingService`, `SessionLogger`, `MemoryStore` — when testing orchestration logic
- `Logger` (pino) — silence output and verify log calls
- External filesystem for integration boundary tests

**What NOT to mock:**
- `better-sqlite3` — use `:memory:` database for real SQLite behavior in all store tests
- Domain logic in pure functions — test directly without mocking

## Test Data Patterns

**SQLite in-memory databases:** All store tests use `:memory:` database path:
```typescript
function createTestStore(): MemoryStore {
  return new MemoryStore(":memory:");
}
```

**Embeddings for vector tests:** Random 384-dim Float32Array helpers:
```typescript
function randomEmbedding(): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) arr[i] = Math.random() * 2 - 1;
  return arr;
}

// Directional embedding for predictable similarity tests
function directionalEmbedding(dim: number, value: number): Float32Array {
  const arr = new Float32Array(384);
  arr[dim] = value;
  const norm = Math.abs(value);
  if (norm > 0) arr[dim] /= norm;
  return arr;
}
```

**Injected clocks:** For time-sensitive tests (rate limiter, token bucket), a clock function is injected:
```typescript
const now = 1000000;
const clock = () => now;
const limiter = createRateLimiter(DEFAULT_RATE_LIMITER_CONFIG, clock);
// ...
now += 1000;  // advance time
```

**Builder helpers for typed test data:** Minimal `makeAgent()` factories that return valid typed objects:
```typescript
function makeAgent(name: string, channels: string[] = []): ResolvedAgentConfig {
  return {
    name,
    workspace: `/tmp/agents/${name}`,
    channels,
    model: "sonnet",
    // ... all required fields with sane defaults
  };
}
```

**Deps objects:** Tests construct `CompactionDeps`, `ConsolidationDeps` etc. from mock factories then pass to the function under test — this is the primary pattern for testing functions with multiple dependencies.

## Assertions

**Immutability assertions:** Actively tested as a first-class behavior:
```typescript
it("returns a frozen (readonly) entry", () => {
  const entry = store.insert({ ... }, randomEmbedding());
  expect(Object.isFrozen(entry)).toBe(true);
});

it("returns frozen array", () => {
  const results = store.listByTier("warm", 10);
  expect(Object.isFrozen(results)).toBe(true);
});
```

**Error type assertions:**
```typescript
await expect(loadConfig(missingPath)).rejects.toThrow(ConfigFileNotFoundError);

// For checking error message contents:
try {
  await loadConfig(configPath);
  expect.fail("Should have thrown");
} catch (err) {
  expect(err).toBeInstanceOf(ConfigValidationError);
  expect((err as ConfigValidationError).message).toContain("researcher");
}
```

**Null assertions:** Using non-null assertion `!` after checking for null:
```typescript
const found = store.getById(created.id);
expect(found).not.toBeNull();
expect(found!.content).toBe("findme");
```

**Numeric precision:** `toBeCloseTo(value, decimalPlaces)` for floating-point comparisons:
```typescript
expect(result).toBeCloseTo(0.8, 5);
expect(result).toBeCloseTo(0.4, 1);
```

## Coverage

**Requirements:** None enforced — no `coverage` script in `package.json`, no thresholds in `vitest.config.ts`.

**Actual coverage:** Well-tested areas:
- `src/memory/` — comprehensive tests for all public methods of all 15+ modules
- `src/config/` — loader, schema, differ, watcher, audit-trail all tested
- `src/discord/` — rate-limiter, router, slash-commands, attachments, threads tested
- `src/security/` — acl-parser, allowlist-matcher, approval-log tested
- `src/usage/` — budget, tracker, advisor-budget tested
- `src/scheduler/` — scheduler and schema tested

**Notable gaps** (no test files found):
- `src/manager/daemon.ts` — 1240 lines, no test (hardest to test — process lifecycle)
- `src/manager/session-adapter.ts` — 467 lines, no test (SDK wrapper)
- `src/manager/session-recovery.ts` — no test
- `src/discord/bridge.ts` — 635 lines, no test (Discord integration)
- `src/ipc/server.ts` and `src/ipc/client.ts` — no tests (Unix socket IPC)
- `src/collaboration/inbox.ts` — no test
- `src/heartbeat/checks/` — individual check functions untested
- `src/cli/commands/` — start, stop, restart, health, run untested (CLI side effects)
- `src/dashboard/sse.ts` — no test

## Test Types

**Unit Tests:**
- All tests are unit tests — no integration tests or e2e tests present
- External dependencies (embedder, LLM, Discord API) are mocked
- SQLite is the only external dependency used without mocking (`:memory:` database)

**Integration Tests:** Not present.

**E2E Tests:** Not present.

---

*Testing analysis: 2026-04-11*
