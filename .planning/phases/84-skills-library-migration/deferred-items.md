# Phase 84 — Deferred Items

Pre-existing test failures observed during Plan 02 execution. These are
**not caused by Plan 02** and are **out of scope** per the executor's
Rule-3 scope boundary (auto-fix only issues the current task caused).

Confirmed pre-existing by stashing Plan 02 changes and re-running:

## src/migration/__tests__/config-mapper.test.ts (4 failures)

- `mapAgent — mcpServers auto-injection > always includes clawcode AND 1password even when perAgentMcpNames is empty`
- `mapAgent — mcpServers auto-injection > preserves order: clawcode, 1password, then per-agent names`
- `mapAgent — mcpServers auto-injection > does not double-inject when user already declared clawcode explicitly`
- `mapAgent — mcpServers auto-injection > emits unknown-mcp-server warning and skips the ref when name is not in top-level map`

Root cause: the v2.1 migration config-mapper changed the auto-injection rules
between tests and implementation (pre-Plan 01). Unrelated to skills.

## src/migration/__tests__/memory-translator.test.ts (2 failures)

- `MEM-05: module source never imports better-sqlite3, references openclaw sqlite, or calls loadExtension`
- `static grep: exactly one store.insert call site and one embedder.embed call site`

Static-grep regression tests. Unrelated to Plan 02's new helpers.

## src/migration/__tests__/verifier.test.ts (2 failures)

- `all 6 files present → pass (Test 1)`
- `missing MEMORY.md → fail with filename in detail (Test 2)`

ENOENT errors on a test tmpdir not being populated. Pre-existing
per stash verification. Unrelated to Plan 02.

## Recommendation

Open dedicated quick-fix sessions to triage each test file. Phase 84
Plan 02 tests (55/55) pass cleanly.
