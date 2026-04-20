# Phase 81: Verify + Rollback + Resume + Fork - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `verify` and `rollback` subcommands to `clawcode migrate openclaw`; write an integration test proving resume idempotency (mid-flight kill + re-run); write regression tests proving the v1.5 fork-to-Opus escalation path works for agents with non-Opus primary models AND that fork costs appear in `clawcode costs`. Resume and fork are mostly emergent from existing code (Phase 77 ledger + Phase 80 origin_id; v1.5 forkSession + v2.0 usage tracking); this phase is the completion of the write-side CLI tree and the regression proof.

Delivers MIGR-03 (resume), MIGR-04 (verify), MIGR-05 (rollback), FORK-01 (escalation path parity), FORK-02 (cost visibility).

</domain>

<decisions>
## Implementation Decisions

### `verify` Subcommand
- **Four checks per agent:**
  - (a) **Workspace files present:** each of SOUL.md, IDENTITY.md, MEMORY.md, CLAUDE.md, USER.md, TOOLS.md exists at resolved target paths (`config.workspace`, or `config.soulFile`/`identityFile` for file-ref agents). File-presence only (not content hash).
  - (b) **Memory count ±5%:** `SELECT COUNT(*) FROM memories WHERE origin_id LIKE 'openclaw:<agent>:%'` against per-agent `memories.db`; compare to source markdown-section count (re-discover via Phase 80's `discoverWorkspaceMarkdown` + splitter on target workspace). Pass if within ±5%.
  - (c) **Discord channel reachable:** best-effort REST `GET /api/v9/channels/{id}` with bot token; 200 → pass, 403/401 → fail, 404 → fail, no token → `skipped` (not failed). Any single-channel pass qualifies.
  - (d) **Daemon boot simulation:** parse `clawcode.yaml` via existing `loadConfig()`, assert agent resolves via `resolveAllAgents()` without throwing. Dry check — doesn't restart the actual daemon.
- **Output format:** Aligned-column table `Check | Status | Detail` with ✅ / ❌ / ⏭. Exit 0 if no ❌; exit 1 if any ❌. Invocation: `verify` (all migrated per ledger) or `verify <agent>` (single).
- **CI-safe defaults:** `CLAWCODE_DISCORD_TOKEN` absent → Discord check `skipped`. `CLAWCODE_VERIFY_OFFLINE=true` env var forces skip of Discord + fleet checks (for test isolation).

### `rollback` Subcommand
- **Scope:** Per-agent only (`rollback <agent>`). No batch mode. Atomic.
- **What gets removed:**
  - (a) Agent entry in `clawcode.yaml` removed via `yaml` Document AST node removal + atomic temp+rename (reuse Phase 78 yaml-writer pattern).
  - (b) For **dedicated-workspace agents:** `fs.rm(<config.workspace>, {recursive, force})`.
  - (c) For **finmentum family (shared-basePath):** `fs.rm(<memoryPath>)` (whole memory subdir), `fs.rm(<soulFile>)`, `fs.rm(<identityFile>)`, `fs.rm(<inbox>/<agent>)`. Shared `basePath` root + shared SOUL/IDENTITY preserved.
- **Source-tree invariant:** Hash-witness `~/.openclaw/workspace-<agent>/` + `~/.openclaw/memory/<agent>.sqlite` before-and-after rollback. Assert byte-identical (sha256 of both + `stat -c %Y` mtime). Any mismatch → refuse + throw (rollback corruption scenario).
- **Ledger:** Append `{action: "rollback", status: "rolled-back", step: "rollback:complete", agent}` row. Future `list` will show `rolled-back` status for this agent.
- **Re-apply after rollback:** Works because origin_id UNIQUE is per-`memories.db`, and rollback deletes that DB. A fresh `apply` will re-insert cleanly.

### Resume + Fork Regression
- **Resume test:** Integration test simulates mid-flight interruption: run `apply` on 3 agents, abort (or skip 12), re-run `apply`, assert `latestStatusByAgent` ledger read returns the 3 as `migrated` (skipped) and the remaining 12 as `migrated` (fresh). Assert no duplicate memory rows via `SELECT COUNT(*) FROM memories WHERE origin_id IS NOT NULL GROUP BY origin_id HAVING COUNT(*) > 1` → zero rows.
- **Fork-to-Opus regression (FORK-01):** Construct a migrated agent config with Haiku primary model, spawn/manipulate a session, invoke `forkSession(parent, {model: "opus"})` from existing v1.5 code path (`src/manager/fork.ts`). Assert: session spawns successfully, trace metadata records `model: "opus-*"` on forked Turn, `forked_from: <parent-turn-id>` linkage present. Repeat for Sonnet, MiniMax, Gemini primaries (unit test parameterized over all 4 primary models).
- **Cost ledger (FORK-02):** After a forked-to-Opus turn, `clawcode costs --agent <name>` returns a row with model matching `opus-*` prefix, non-zero token cost, `agent` column = migrated agent's name. Existing `usage.db` / `clawcode costs` code (from v2.0) should work as-is — just add a regression test ensuring Phase 80 migration didn't break the wiring.
- **No budget ceiling:** Default migrated-agent config has NO `escalationBudget.opus` entry. Assertion: `resolveAllAgents()` output for a migrated agent has `escalationBudget: undefined` (or daily.opus/weekly.opus both undefined). fork-to-opus proceeds without budget check.

### Claude's Discretion
- Discord REST call implementation — use `node:fetch` (global in Node 22)
- Exact error message copy for each rollback failure mode
- Test fixture layout — follow Phase 79/80 patterns

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/migration/ledger.ts` — `appendRow`, `latestStatusByAgent` (Phase 76/77)
- `src/migration/yaml-writer.ts` — atomic YAML write with Document AST (Phase 78)
- `src/migration/memory-translator.ts` — `discoverWorkspaceMarkdown` + chunk counter (Phase 80)
- `src/migration/workspace-copier.ts` — hash-witness helpers (Phase 79)
- `src/manager/fork.ts` — v1.5 `forkSession` code path
- `src/cli/commands/costs.ts` — existing `clawcode costs` command (Phase 74+)
- `src/config/loader.ts:loadConfig` + `resolveAllAgents` — config validation

### Established Patterns
- CLI subcommand registration in migrate-openclaw.ts
- Env-var test overrides (`CLAWCODE_OPENCLAW_ROOT`, `CLAWCODE_LEDGER_PATH`, etc.)
- Ledger witness rows per action
- Zero new npm deps

### Integration Points
- Extend `src/cli/commands/migrate-openclaw.ts` — register `verify` and `rollback` subcommands
- New modules:
  - `src/migration/verifier.ts` — four-check function returning `{check: string, status: "pass"|"fail"|"skip", detail: string}[]`
  - `src/migration/rollbacker.ts` — per-agent YAML removal + target fs.rm + source hash-witness
- Extend: YAML writer with a `removeAgentFromConfig(name)` export

</code_context>

<specifics>
## Specific Ideas

- Memory count tolerance: ±5% exact. Formula: `abs(migrated - source) / max(source, 1) <= 0.05`.
- Source markdown count discovery: reuse Phase 80's `discoverWorkspaceMarkdown` against SOURCE workspace path (`~/.openclaw/workspace-<agent>/`) — read-only, no writes.
- `verify` table columns: 4-wide. Check name truncated to 22 chars; Status emoji; Detail 40 chars. Aligned with ANSI color.
- `rollback` ledger row includes `file_hashes: {<target-workspace>: <sha before>}` so forensic analysis can correlate.
- Fork regression test uses existing vitest setup — mock the Anthropic API (or skip if no key) but assert the trace-metadata fields.

</specifics>

<deferred>
## Deferred Ideas

- `verify --all` parallel run — sequential is fine for 15 agents
- `rollback` batch mode — out of scope; per-agent safer
- Daemon restart during verify — dry parse is sufficient; live restart is Phase 82's concern
- Budget ceiling enforcement — intentional omission per STATE.md
- Fork-to-Opus tracing with OpenTelemetry — existing trace format is enough
- Rollback of finmentum shared SOUL/IDENTITY — not needed; those are shared across family

</deferred>
