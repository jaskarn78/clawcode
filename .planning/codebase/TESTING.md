# Testing Patterns

**Analysis Date:** 2026-04-10

## Test Framework

**Runner:**
- Vitest 4.x
- Config: `vitest.config.ts` (minimal — only sets `globals: false`)
- No coverage thresholds configured

**Assertion Library:**
- Vitest built-in (`expect` from `"vitest"`)

**Run Commands:**
```bash
npm test                  # Run all tests (vitest run --reporter=verbose)
npx vitest                # Watch mode
npx vitest run --coverage # Coverage (no threshold enforced)
npm run typecheck         # Type check without running tests
```

## Test File Organization

**Two co-location patterns used:**

**Pattern 1 — `__tests__/` subdirectory (dominant pattern):**
```
src/memory/
├── store.ts
├── search.ts
├── errors.ts
└── __tests__/
    ├── store.test.ts
    ├── search.test.ts
    ├── compaction.test.ts
    └── ...
```
Used by: `src/memory/`, `src/config/`, `src/bootstrap/`, `src/agent/`, `src/scheduler/`, `src/skills/`, `src/manager/`

**Pattern 2 — Co-located in same directory:**
```
src/cli/commands/
├── send.ts
├── send.test.ts
├── memory.ts
├── memory.test.ts
```
Used by: `src/cli/commands/`, `src/security/`, `src/mcp/`, `src/memory/` (some files), `src/usage/`

**Naming:** Always `<module-name>.test.ts`. No `.spec.ts` files.

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// No globals — all imports explicit (vitest.config.ts: globals: false)

describe("ClassName or module", () => {
  describe("methodName()", () => {
    it("does X when Y", () => { /* ... */ });
    it("returns Z for edge case", () => { /* ... */ });
  });
});
```

**Lifecycle hooks pattern:**
```typescript
describe("MemoryStore", () => {
  let store: MemoryStore;

  afterEach(() => {
    store?.close();  // Optional chaining — safe if test failed before assignment
  });
  // ...
});
```

For filesystem tests:
```typescript
describe("detectBootstrapNeeded", () => {
  const tempDirs: string[] = [];

  async function makeTempWorkspace(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "bootstrap-test-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });
});
```

## Mocking

**Framework:** `vi` from `"vitest"` — no additional mocking libraries.

**Factory functions for mocks** (preferred over inline mocks):
```typescript
function createMockSessionManager() {
  return {
    sendToAgent: vi.fn().mockResolvedValue("Task completed"),
  } as any;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}
```

**Interface-based mock classes** for complex dependencies — production interfaces have `Mock*` implementations in the same source file, exported for test use:
- `MockSessionAdapter` — tracks all created sessions in a `Map`, exposed as `adapter.sessions`
- `MockSessionHandle` — exposes `simulateCrash()` and `simulateEnd()` to trigger lifecycle callbacks
- Both exported from `src/manager/session-adapter.ts`

```typescript
// From src/agent/__tests__/runner.test.ts
import { MockSessionAdapter, MockSessionHandle } from "../../manager/session-adapter.js";

adapter = new MockSessionAdapter();
// Simulate crash to test recovery:
const firstHandle = [...adapter.sessions.values()][0] as MockSessionHandle;
firstHandle.simulateCrash();
```

**`vi.fn()` for simple stubs:**
```typescript
const noopBridge = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
};
```

**`vi.spyOn()` for verifying calls on real objects:**
```typescript
const closeSpy = vi.spyOn(handle, "close");
await runner.stop();
expect(closeSpy).toHaveBeenCalledOnce();
```

**Reset between tests:**
```typescript
beforeEach(() => {
  vi.clearAllMocks();
});
```

## Fixtures and Factories

**Factory functions** for test data (not file-based fixtures):

```typescript
// Minimal config factory with overrides
function makeConfig(
  workspace: string,
  overrides: Partial<ResolvedAgentConfig> = {},
): ResolvedAgentConfig {
  return {
    name: "test-agent",
    workspace,
    channels: ["general"],
    model: "sonnet",
    skills: [],
    // ... defaults
    ...overrides,
  } as ResolvedAgentConfig;
}

// Embedding factories for deterministic vector tests
function randomEmbedding(): Float32Array {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i++) arr[i] = Math.random() * 2 - 1;
  return arr;
}

function directionalEmbedding(dim: number, value: number): Float32Array {
  const arr = new Float32Array(384);
  arr[dim] = value;
  const norm = Math.abs(value);
  if (norm > 0) arr[dim] /= norm;
  return arr;
}
```

**In-memory SQLite** for database tests — avoids file I/O and cleanup:
```typescript
function createTestStore(): MemoryStore {
  return new MemoryStore(":memory:");
}
```

**Temporary directories** for filesystem tests using `mkdtemp`:
```typescript
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "bootstrap-int-"));
  await mkdir(join(tmpDir, "memory"), { recursive: true });
});
afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});
```

**Location:** All factories are defined inline within the test file that uses them. No shared fixture directory.

## Coverage

**Requirements:** No coverage threshold enforced.

**Configuration:** No `coverage` block in `vitest.config.ts`. Coverage must be requested manually.

```bash
npx vitest run --coverage
```

## Test Types

**Unit Tests (dominant):**
- Pure function testing: Zod schema validation, config resolution, memory tier logic, decay calculations
- Class method testing with mocked dependencies
- SQLite in-memory database for store operations (effectively integration but contained)
- Examples: `src/memory/__tests__/store.test.ts`, `src/config/__tests__/schema.test.ts`, `src/scheduler/__tests__/scheduler.test.ts`

**Integration Tests:**
- Real filesystem with temp directories
- Tests that cross multiple layers (e.g., config loading + workspace creation + session config building)
- File: `src/manager/__tests__/bootstrap-integration.test.ts` — exercises `buildSessionConfig` with real file I/O
- Files: `src/bootstrap/__tests__/detector.test.ts`, `src/bootstrap/__tests__/writer.test.ts`

**E2E Tests:** Not present. No Playwright, Cypress, or similar.

## Common Patterns

**Async Testing:**
```typescript
it("creates session via the adapter", async () => {
  const runner = new AgentRunner({ ... });
  await runner.start();
  expect(adapter.sessions.size).toBe(1);
  await runner.stop();
});
```

**Error Testing:**
```typescript
it("throws if already running", async () => {
  await runner.start();
  await expect(runner.start()).rejects.toThrow("already running");
  await runner.stop();
});

it("rejects invalid source values", () => {
  expect(() =>
    store.insert({ content: "test", source: "invalid" as any }, randomEmbedding()),
  ).toThrow();
});
```

**Zod Schema Testing** — use `safeParse` to inspect success/failure without throwing:
```typescript
it("validates a complete MCP server config", () => {
  const result = mcpServerSchema.safeParse({ name: "finnhub", command: "npx", args: [], env: {} });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.name).toBe("finnhub");
  }
});

it("rejects missing name", () => {
  const result = mcpServerSchema.safeParse({ command: "npx" });
  expect(result.success).toBe(false);
});
```

**Timing-dependent crash recovery** — uses `backoffBaseMs: 0` and short `setTimeout` waits in tests:
```typescript
const runner = new AgentRunner({
  sessionConfig,
  sessionAdapter: adapter,
  discordBridge: noopBridge,
  maxRestarts: 2,
  backoffBaseMs: 0,  // Disable backoff in tests
});
firstHandle.simulateCrash();
await new Promise((resolve) => setTimeout(resolve, 20));  // Allow crash handler to run
expect(adapter.sessions.size).toBeGreaterThan(1);
```

**Immutability assertions** — tests actively verify frozen objects:
```typescript
it("returns a frozen (readonly) entry", () => {
  const entry = store.insert({ content: "test", source: "manual" }, randomEmbedding());
  expect(Object.isFrozen(entry)).toBe(true);
});

it("returns frozen array", () => {
  const results = store.listByTier("warm", 10);
  expect(Object.isFrozen(results)).toBe(true);
});
```

---

*Testing analysis: 2026-04-10*
