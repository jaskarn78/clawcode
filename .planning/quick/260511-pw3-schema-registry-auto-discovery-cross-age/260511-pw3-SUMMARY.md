---
quick_id: 260511-pw3
slug: schema-registry-auto-discovery-cross-age
date: 2026-05-11
status: complete
classification: fully-fixed
commits:
  - 0fe7fb5  # feat(260511-pw3): schema registry introspection + helpful error responses
files_changed:
  - src/tasks/task-manager.ts (new methods: listSchemasForAgent, acceptedSchemasForTarget)
  - src/manager/daemon.ts (new IPC case list-agent-schemas; delegate-task error translation)
  - src/mcp/server.ts (new list_agent_schemas tool; delegate_task error rendering)
  - src/tasks/__tests__/list-agent-schemas.test.ts (new — 5 unit + 5 sentinel tests)
  - docs/cross-agent-schemas.md (new — documents the two-layer registration path)
---

# Quick 260511-pw3 — Schema registry auto-discovery

## Summary

Cross-agent senders had no way to discover what schemas a recipient
accepts via `delegate_task`. The registry was a closed allowlist with no
introspection surface — Admin Clawdy's 2026-05-11 attempt to delegate
`bug.report` to Projects returned an opaque `unknown_schema` and there
was no way to pick a valid schema short of reading every target agent's
clawcode.yaml.

This change implements the plan's recommended Option A + C combination:

- **A: Introspection tool** — new `list_agent_schemas(caller, target)`
  MCP tool, auto-injected for every agent. Returns each accepted schema
  with `callerAllowed` (per-agent allowlist check) and `registered`
  (fleet registry check) flags.
- **C: Helpful error responses** — `delegate_task` unknown_schema
  rejections now carry the target's accepted-schemas list on
  `error.data.acceptedSchemas`. The MCP wrapper renders it inline so the
  sender's LLM can retry with a valid schema instead of falling back to
  `post_to_agent` (which had its own silent-drop bug — Quick 260511-pw2).

## What changed

### TaskManager (new methods)

- `listSchemasForAgent(caller, target)` — returns
  `[{ name, callerAllowed, registered }]` for every schema in
  `acceptsTasks`. `registered=false` flags schemas declared in config
  but missing the YAML file in `~/.clawcode/task-schemas/`.
- `acceptedSchemasForTarget(target)` — returns the intersection of
  `acceptsTasks` keys and the fleet registry; this is the payload on
  `delegate_task` unknown_schema errors so senders can retry intelligently.

### Daemon

- New IPC case `list-agent-schemas` — validates target, dispatches to
  `taskManager.listSchemasForAgent`. Returns
  `{ target, caller, schemas }`.
- `case "delegate-task"` wraps `taskManager.delegate` and catches
  `ValidationError("unknown_schema")`. Re-throws as `ManagerError` with:

  ```js
  {
    code: -32602,                                 // JSON-RPC Invalid Params
    data: { reason: "unknown_schema", schema, target, acceptedSchemas }
  }
  ```

  The IPC server already forwards `error.data` to the wire (Phase 86
  Plan 02) and `IpcError.data` is preserved on the MCP client (Phase 86
  Plan 03), so no transport-layer changes were needed.

### MCP server

- New tool `list_agent_schemas` registered (auto-injected because the
  ClawCode MCP server is itself auto-injected — same pattern as
  `clawcode_fetch_discord_messages` from Phase 94 D-08).
- `delegate_task` MCP wrapper now reads `error.data.reason` and renders
  the structured error inline: `"Delegate failed: schema 'X' is not
  accepted by 'Y'. Accepted schemas: A, B, C. Call list_agent_schemas..."`.
- TOOL_DEFINITIONS map updated with `list_agent_schemas →
  list-agent-schemas`.

### Documentation

`docs/cross-agent-schemas.md` describes the two-layer model:

1. **Fleet registry** — `~/.clawcode/task-schemas/<name>.yaml`
2. **Per-agent allowlist** — `clawcode.yaml`'s `acceptsTasks` map

Both must be satisfied for `delegate_task` to succeed. The doc covers
the YAML schema shape, the config schema, the rejection surface, and
step-by-step "how to add a new cross-agent schema" instructions.

## Sentinel tests

`src/tasks/__tests__/list-agent-schemas.test.ts` contains:

- 5 unit tests for the two new TaskManager methods covering:
  - registered × callerAllowed permutations
  - unknown target → empty array
  - empty `acceptsTasks` → empty array
  - intersection of `acceptsTasks` keys with the fleet registry
- 5 static-grep sentinels pinning the production caller chain:
  - `daemon.ts case "delegate-task"` calls
    `taskManager.acceptedSchemasForTarget(target)` and includes
    `reason: "unknown_schema"` in error data.
  - `daemon.ts case "list-agent-schemas"` calls
    `taskManager.listSchemasForAgent(caller, target)`.
  - `server.tool("list_agent_schemas", ...)` is registered.
  - `TOOL_DEFINITIONS.list_agent_schemas.ipcMethod ===
    "list-agent-schemas"`.
  - `delegate_task` MCP handler renders `acceptedSchemas` on
    `errData.reason === "unknown_schema"` branch.

The anti-pattern guard (`feedback_silent_path_bifurcation.md`): without
these sentinels, a future refactor could land the new logic on a code
path the daemon never executes. Both daemon cases and both MCP tools
are pinned.

## Verification

- `npx tsc --noEmit` exits 0
- `npx vitest run src/tasks/__tests__/list-agent-schemas.test.ts` —
  10/10 pass
- `npx vitest run src/tasks/__tests__/` (full task suite) — 253/253 pass
- `npx vitest run src/manager/__tests__/ask-agent-ipc.test.ts
  src/manager/__tests__/post-to-agent-ipc.test.ts
  src/tasks/__tests__/list-agent-schemas.test.ts
  src/tasks/__tests__/task-manager.test.ts` — 64/64 pass

## Threat-surface scan

The new `list-agent-schemas` IPC method reads from `acceptsTasks`
config — a non-secret config field. No new auth paths, file access
patterns, or schema changes at trust boundaries. The structured error
data for `delegate_task` leaks the list of accepted schemas, which is
already implicitly readable (a sender can probe via repeated
`delegate_task` calls). No new threat surface.

## Self-Check: PASSED

- `src/tasks/__tests__/list-agent-schemas.test.ts` exists.
- `docs/cross-agent-schemas.md` exists.
- `src/tasks/task-manager.ts` contains `listSchemasForAgent` and
  `acceptedSchemasForTarget`.
- `src/manager/daemon.ts` contains `case "list-agent-schemas":` and the
  delegate-task ValidationError catch.
- `src/mcp/server.ts` contains `server.tool("list_agent_schemas"`.
- Commit 0fe7fb5 exists in `git log --oneline`.
