---
phase: 110-mcp-memory-reduction-shim-runtime-swap
plan: 01
subsystem: daemon-ipc
tags: [phase-110, stage-0b, ipc, mcp-shim, list-mcp-tools, schema, zod, json-schema]
dependency-graph:
  requires:
    - 110-00-SUMMARY.md (Stage 0a foundational scaffolding — 0B-RT-13 sequencing)
  provides:
    - "list-mcp-tools" IPC method (daemon-side handler — Wave 2-4 Go shim prerequisite)
  affects:
    - src/ipc/protocol.ts (IPC_METHODS enum + new request/response Zod schemas)
    - src/manager/daemon.ts (pure handler + dispatch wiring + production TOOL_DEFINITIONS imports)
    - src/manager/__tests__/list-mcp-tools.test.ts (11 tests covering contract + handler)
    - src/ipc/__tests__/protocol.test.ts (roster test updated for new method)
tech-stack:
  added: []
  patterns:
    - native-zod-v4-toJsonSchema (zero new npm deps — z.toJSONSchema is built into zod v4.0.1+)
    - pure-DI-handler (mirrors handleSetModelIpc / handleRunDreamPassIpc precedent)
    - closure-intercept-dispatch (mirrors secrets-status / broker-status / fleet-stats / mcp-tracker-snapshot)
    - aliased-import-disambiguation (TOOL_DEFINITIONS as SEARCH_TOOL_DEFINITIONS / IMAGE_TOOL_DEFINITIONS / BROWSER_TOOL_DEFINITIONS)
key-files:
  created:
    - src/manager/__tests__/list-mcp-tools.test.ts (11 tests, contract + handler + immutability + DI seam)
  modified:
    - src/ipc/protocol.ts (+72 lines — method registration + request/response Zod schemas)
    - src/manager/daemon.ts (+128 lines — pure handler + production wiring imports + dispatch case)
    - src/ipc/__tests__/protocol.test.ts (+5 lines — roster assertion updated)
decisions:
  - "Use zod/v4's NATIVE z.toJSONSchema() instead of the zod-to-json-schema npm package. CONTEXT.md hedged 'verify zod-to-json-schema in deps before adding (no new npm deps without justification)'. Native availability satisfies that verification cleanly. Test 9 confirms required[] is correctly serialized for the realistic web_search schema."
  - "Pure-DI handler shape (handleListMcpToolsIpc) lets the unit test inject synthetic TOOL_DEFINITIONS fixtures, avoiding the test from being coupled to the search/image/browser modules' transitive imports (providers, readability, playwright)."
  - "Production wiring at the daemon edge passes the real frozen TOOL_DEFINITIONS arrays (Object.freeze'd ReadonlyArrays) — handler returns a NEW array via .map() per CLAUDE.md immutability rule (never mutates inputs)."
  - "Closure-intercept dispatch (BEFORE routeMethod) instead of adding to the routeMethod switch. Matches secrets-status / broker-status / mcp-tracker-snapshot / fleet-stats precedent — these handlers don't need the routeMethod argument list."
metrics:
  duration: ~7 minutes
  completed: 2026-05-06
  tasks: 2
  files_modified: 4
  tests_added: 11
  commits: 3
requirements: [0B-RT-13]
---

# Phase 110 Plan 01: MCP Shim Runtime Swap — `list-mcp-tools` Daemon IPC Method Summary

Wave 1 daemon-side prerequisite for Phase 110 Stage 0b's MCP shim runtime swap. Ships the `list-mcp-tools` IPC method — future Wave 2-4 Go shims call this at boot to fetch JSON-Schema-converted MCP tool definitions for their shim type, keeping the canonical Zod schemas single-sourced in TypeScript (no schema duplication into Go).

## What Shipped

**Three commits, atomic per task:**

| Commit    | Task | What                                                                          |
| --------- | ---- | ----------------------------------------------------------------------------- |
| `006467c` | 1    | feat(110-01): register list-mcp-tools IPC contract (Phase 110 0B-RT-13)       |
| `21bfd4e` | 2    | feat(110-01): implement list-mcp-tools daemon handler (Phase 110 0B-RT-13)    |
| `15c5a2c` | 2 fix| test(110-01): update IPC_METHODS roster test for list-mcp-tools (Rule 1)      |

### Handler Signature

```typescript
export function handleListMcpToolsIpc(
  deps: ListMcpToolsIpcDeps,
  rawParams: unknown,
): ListMcpToolsResponse;

interface ListMcpToolsIpcDeps {
  readonly searchTools: ReadonlyArray<ListMcpToolsHandlerToolDef>;
  readonly imageTools: ReadonlyArray<ListMcpToolsHandlerToolDef>;
  readonly browserTools: ReadonlyArray<ListMcpToolsHandlerToolDef>;
  readonly toJsonSchema?: (shape: unknown) => Record<string, unknown>;
}
```

### Schemas Registered (`src/ipc/protocol.ts`)

```typescript
listMcpToolsRequestSchema  = z.object({ shimType: z.enum(["search", "image", "browser"]) })
mcpToolSchemaSchema         = z.object({ name: z.string().min(1), description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })
listMcpToolsResponseSchema  = z.object({ tools: z.array(mcpToolSchemaSchema) })
```

### Tests Added (11 total, all passing)

**Contract tests (Task 1):**
1. Request schema accepts valid shimType (search/image/browser)
2. Request schema rejects unknown / empty / numeric / missing shimType
3. Response schema accepts well-formed tools (and rejects empty name / missing inputSchema)
4. `list-mcp-tools` is registered in IPC_METHODS

**Handler tests (Task 2):**
5. search shimType returns every TOOL_DEFINITIONS entry with matching name + description + non-empty inputSchema
6. image shimType — same
7. browser shimType — same
8. Unknown shimType throws ManagerError(-32602) (and empty / null params too)
9. JSON Schema fidelity: web_search inputSchema has `required: ["query"]` (zod/v4 native conversion correct)
10. Immutability — handler does not mutate input TOOL_DEFINITIONS arrays
11. Custom toJsonSchema override — DI seam works (synthetic deps)

## Deviations from Plan

### Rule 3 — Better Solution: Use native `z.toJSONSchema()` instead of `zod-to-json-schema` package

**Found during:** Task 2 prep (verifying `zod-to-json-schema` deps as CONTEXT.md required).

**Issue:** Plan's Task 2 action block hardcodes `import { zodToJsonSchema } from "zod-to-json-schema";` and the acceptance criteria literally greps `package.json` and `daemon.ts` for `zod-to-json-schema`. CONTEXT.md §Specifics line 134 explicitly hedged: "verify it's already in deps before adding (no new npm deps without justification)."

**Discovery:** `zod/v4` (the project's pinned Zod major) has a NATIVE `z.toJSONSchema()` function. Verified by `node -e "const {z} = require('zod/v4'); console.log(typeof z.toJSONSchema)"` → `function`. Confirmed JSON output includes `required: ["query"]` for the realistic `web_search` Zod schema.

**Fix:** Use native `zV4.toJSONSchema(zV4.object(rawShape))` in the handler. Zero new npm deps. Test 9 pins this behavior — if zod ever changes their native converter behavior (required[] serialization), the test catches it.

**Rationale stack:**
1. CLAUDE.md project rule: "no new npm deps without justification"
2. CONTEXT.md hedge: "verify zod-to-json-schema in deps before adding"
3. Native availability is the answer to that verification — adding a peer-dep package when the runtime already provides the function is the unjustified addition CLAUDE.md prohibits.

**Files modified:** src/manager/daemon.ts (handler uses `zV4.toJSONSchema`)

**Commits:** `21bfd4e`

**Truths verification (plan frontmatter `must_haves.truths`):** All four still satisfied:
- ✅ "Daemon registers a new IPC method `list-mcp-tools` that accepts `{shimType}` and returns `{tools: ToolSchema[]}` JSON Schema converted from existing Zod" — done with native converter
- ✅ "Calling with shimType:'search' returns the tools currently advertised by src/search/tools.ts TOOL_DEFINITIONS, JSON-Schema-equivalent (every name + description + input schema present)" — Test 5 + 9
- ✅ "Calling with unknown shimType returns -32602" — Test 8
- ✅ "Method ships in OWN PR/commit BEFORE any Go shim builds against it" — commits `006467c` (contract) + `21bfd4e` (handler) in this plan; Wave 2-4 shim work has not started

**Plan acceptance-criteria gaps from this deviation (intentional):**
- ❌ `grep -E "zod-to-json-schema" package.json` returns 0 hits (intentional — using native)
- ❌ `grep -E "import.*zodToJsonSchema" daemon.ts` returns 0 hits (intentional — using native)

The other Task 2 acceptance criteria all pass.

### Rule 1 — Bug fix: Update IPC_METHODS roster test

**Found during:** Task 2 verification (running broader vitest after handler implementation).

**Issue:** `src/ipc/__tests__/protocol.test.ts > IPC_METHODS > includes all required methods` uses `expect(IPC_METHODS).toEqual([...])` with the FULL frozen list. Adding `list-mcp-tools` to IPC_METHODS in Task 1 broke this deep-equal assertion.

**Fix:** Append `"list-mcp-tools"` to the test's expected roster array with a phase-tagged comment.

**Files modified:** src/ipc/__tests__/protocol.test.ts (+5 lines)

**Commit:** `15c5a2c`

## Verification

```bash
# All 11 list-mcp-tools tests pass
npx vitest run src/manager/__tests__/list-mcp-tools.test.ts
# → Test Files 1 passed (1) | Tests 11 passed (11)

# All 70 IPC tests pass (incl. updated roster test)
npx vitest run src/ipc
# → Test Files 6 passed (6) | Tests 70 passed (70)

# Adjacent IPC handler tests still pass (no regression)
npx vitest run src/manager/__tests__/dream-ipc.test.ts \
                src/manager/__tests__/daemon-set-model.test.ts \
                src/manager/__tests__/cutover-ipc-handlers.test.ts
# → Test Files 3 passed (3) | Tests 18 passed (18)

# TypeScript clean (the one pre-existing error in src/usage/budget.ts is unrelated;
# verified via `git stash` baseline check — same error exists on master)
npx tsc --noEmit
# → 1 pre-existing error (src/usage/budget.ts:138 — type narrowing)
#   0 errors introduced by this plan
```

## Acceptance Criteria Self-Check

**Task 1 (all pass):**
- ✅ `grep "list-mcp-tools" src/ipc/protocol.ts` returns 2 hits
- ✅ `grep "listMcpToolsRequestSchema" src/ipc/protocol.ts` returns 2 hits
- ✅ `grep "listMcpToolsResponseSchema" src/ipc/protocol.ts` returns 2 hits
- ✅ `grep 'z\.enum(\["search", "image", "browser"\])' src/ipc/protocol.ts` matches
- ✅ `test -f src/manager/__tests__/list-mcp-tools.test.ts` returns 0
- ✅ `npx vitest run src/manager/__tests__/list-mcp-tools.test.ts` exits 0 (4 then 11 tests pass)
- ✅ No new imports of zod-to-json-schema in protocol.ts (native converter chosen — see deviation)

**Task 2 (10 of 12 pass; 2 fail by design — see Rule 3 deviation above):**
- ❌ `grep "zod-to-json-schema" package.json` returns hit — INTENTIONAL DEVIATION (native zod/v4)
- ❌ `grep "import.*zodToJsonSchema" daemon.ts` returns hit — INTENTIONAL DEVIATION (native zod/v4)
- ✅ `grep "list-mcp-tools" src/manager/daemon.ts` returns 6 hits
- ✅ `grep "TOOL_DEFINITIONS" src/manager/daemon.ts` returns 12 hits (3 imports + comments + handler usage)
- ✅ `grep "-32602" src/manager/daemon.ts` returns 8 hits (incl. our handler)
- ✅ All 11 test cases pass
- ✅ `npx tsc --noEmit` introduces 0 new errors
- ✅ No mutation of TOOL_DEFINITIONS arrays (no push/splice/sort/reverse anywhere)
- ✅ No index assignment to TOOL_DEFINITIONS arrays

## Deploy Verification (Post-Merge)

The new IPC method must ship to the clawdy host BEFORE Wave 2 Go shim work begins. After deploy:

```bash
# Verify daemon recognizes the method (smoke test — should not error)
echo '{"jsonrpc":"2.0","id":"smoke-1","method":"list-mcp-tools","params":{"shimType":"search"}}' \
  | nc -U ~/.clawcode/manager/manager.sock | jq '.result.tools | length'
# → Expected: 2 (web_search + web_fetch_url)

# Verify error path returns -32602 for unknown shimType
echo '{"jsonrpc":"2.0","id":"smoke-2","method":"list-mcp-tools","params":{"shimType":"broker"}}' \
  | nc -U ~/.clawcode/manager/manager.sock | jq '.error.code'
# → Expected: -32602
```

The plan ships as its own commit set so the daemon-side change is deployable independently of Wave 2-4 Go shim work.

## Self-Check: PASSED

**File existence:**
- ✅ FOUND: src/ipc/protocol.ts (modified)
- ✅ FOUND: src/manager/daemon.ts (modified)
- ✅ FOUND: src/manager/__tests__/list-mcp-tools.test.ts (created)
- ✅ FOUND: src/ipc/__tests__/protocol.test.ts (modified)

**Commits exist:**
- ✅ FOUND: 006467c (Task 1 — IPC contract)
- ✅ FOUND: 21bfd4e (Task 2 — daemon handler)
- ✅ FOUND: 15c5a2c (Rule 1 fix — roster test)
