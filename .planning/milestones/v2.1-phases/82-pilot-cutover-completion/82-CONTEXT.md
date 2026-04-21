# Phase 82: Pilot + Cutover + Completion - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Final phase of v2.1. Surface a recommended pilot agent in `plan` output (lowest-risk selection), add `cutover` subcommand that removes OpenClaw's Discord channel bindings per-agent (the ONLY phase that modifies `~/.openclaw/`), and add `complete` subcommand that generates `.planning/milestones/v2.1-migration-report.md` summarizing per-agent outcomes and asserting fleet-wide invariants (no channel overlap, source integrity).

Delivers OPS-01 (pilot highlight), OPS-02 (cutover), OPS-04 (migration report). OPS-03 (channel collision refuse) was closed by Phase 77.

</domain>

<decisions>
## Implementation Decisions

### Pilot Highlighting (OPS-01)
- **Scoring formula:** `score = memory_chunk_count * 0.6 + mcp_server_count * 0.2 + (is_finmentum_family ? 100 : 0)`. Lower wins. Finmentum penalty prevents them from being selected (shared workspace, business-critical).
- **Tie-break:** alphabetical by agent name.
- **Output location:** After the main `plan` diff table — append a single line: `✨ Recommended pilot: <name> (<reason>)` where `reason` is e.g., `"lowest memory count (47 chunks), dedicated workspace, not-business-critical"`.
- **Tests:** unit (score calculation across 15 agents → `personal` or `local-clawdy` wins); integration (plan output contains the `✨ Recommended pilot:` line).

### cutover Subcommand (OPS-02)
- **Action:** Modify `~/.openclaw/openclaw.json` — remove all `bindings[]` entries where `agentId === <agent>`. Atomic write (temp+rename).
- **Source-modification exception:** Phase 77's fs-guard is installed in `runCutoverAction` with an allowlist granting write access to `~/.openclaw/openclaw.json` ONLY. All other `~/.openclaw/` writes still throw `ReadOnlySourceError`. Ledger row logs the write with `file_hashes: {openclaw.json.before: <sha>, openclaw.json.after: <sha>}`.
- **Safety guards (refuse if):**
  - (a) Agent's ledger status is not `migrated` or `verified` (must have completed Phase 78+80 apply path)
  - (b) `clawcode.yaml` doesn't have the agent entry (ClawCode-side absent → cutover would orphan the channel)
  - (c) `openclaw.json:bindings` doesn't have any entry for this agent (already cut over OR never bound)
  - Each refusal: exit 1 + actionable error.
- **Idempotency:** Re-run after successful cutover → guard (c) triggers → print `"already cut over"` + exit 0 (not 1, since it's a successful no-op). Ledger row `status: "already-cut-over"`.
- **Output:** Print removed binding count + verification hint (`"Now wait 15 minutes and confirm only Clawdbot responds in channel <id>"`).

### complete + Report (OPS-04)
- **Report path:** `.planning/milestones/v2.1-migration-report.md` (exact, per roadmap).
- **Report structure:**
  ```markdown
  ---
  milestone: v2.1
  date: <ISO>
  agents_migrated: <N>
  agents_verified: <N>
  agents_cut_over: <N>
  agents_rolled_back: <N>
  source_integrity_sha: <sha256-of-~/.openclaw/-tree-minus-openclaw.json>
  ---

  # v2.1 OpenClaw → ClawCode Migration Report

  ## Per-Agent Outcomes

  ### <agent-name>
  - source_workspace: ~/.openclaw/workspace-<name>/
  - target_basePath: <resolved>
  - memory_count_delta: <source> → <migrated> (Δ <pct>%)
  - discord_cutover_ts: <ISO or "not-cut-over">
  - rollback_status: none | rolled-back-on <ISO>
  - warnings: <count>
    - <warning text>

  ## Cross-Agent Invariants

  - [x] Zero Discord channel IDs present in both `openclaw.json:bindings` and `clawcode.yaml:agents[].channels`
  - [x] `~/.openclaw/` tree byte-identical to pre-migration snapshot (except `openclaw.json` which was intentionally modified by cutover — tracked via before/after hashes in ledger)
  - [x] Every `memories.db` across migrated agents has zero duplicate `origin_id` values
  ```
- **`complete` command behavior:**
  - Read ledger, agents registry, `clawcode.yaml`, `openclaw.json` bindings
  - Compute per-agent report rows from ledger + filesystem state
  - Assert cross-agent invariants (fails → refuse write)
  - Run Phase 77 `scanSecrets` on report content → refuse if any secret shape
  - Write to the report path (atomic temp+rename)
  - Exit 0 on success with `"Migration complete. Report: <path>"`
- **Preconditions:** Refuse if any agent has ledger status `"pending"` (use `--force` to override, logged in ledger as warning).

### Claude's Discretion
- Exact error message copy
- Report formatting details (table column widths, date format)
- Whether the `✨` is actually used or a color code (context says emoji — keep it)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/migration/ledger.ts` — `latestStatusByAgent`, `readRows`
- `src/migration/openclaw-config-reader.ts` — parse openclaw.json
- `src/migration/yaml-writer.ts` — atomic temp+rename pattern + removeAgentFromConfig
- `src/migration/fs-guard.ts` — Phase 77 runtime interceptor; extend with allowlist option
- `src/migration/guards.ts:scanSecrets` — Phase 77 secret detector
- `src/cli/commands/migrate-openclaw.ts` — existing subcommand registrations

### Established Patterns
- Subcommand registration in migrate-openclaw.ts
- Atomic writes via temp+rename
- Ledger witness rows per action
- Env-var test overrides

### Integration Points
- Extend `src/cli/commands/migrate-openclaw.ts` with `cutover <agent>` and `complete` subcommands + pilot-highlight line in runPlanAction output
- New modules:
  - `src/migration/pilot-selector.ts` — scoring + pick
  - `src/migration/cutover.ts` — bindings modification + safety guards
  - `src/migration/report-writer.ts` — report generation
- Extend `src/migration/fs-guard.ts` with `allowlist?: string[]` option (paths that bypass the readonly check)
- Extend `src/migration/openclaw-config-reader.ts` with a write helper: `removeBindingsForAgent(inventoryPath, agent)` that preserves the rest of the JSON file

</code_context>

<specifics>
## Specific Ideas

- Pilot recommendation line format (literal): `✨ Recommended pilot: <name> (<reason>)`
- Report filename (literal): `.planning/milestones/v2.1-migration-report.md`
- Cutover observation hint (literal): `Now wait 15 minutes and confirm only Clawdbot responds in channel <channel_id>`
- `complete` refusal message on remaining pending: `Cannot complete: <N> agent(s) still pending. Run apply + verify first, or pass --force to acknowledge gaps.`
- Cross-agent invariants MUST ALL be `[x]` for `complete` to succeed (any `[ ]` → refuse).

</specifics>

<deferred>
## Deferred Ideas

- Rollback of `cutover` (re-adding bindings to openclaw.json) — not needed; operator can edit manually if truly necessary
- `--dry-run` flag for cutover / complete — out of scope; `plan` already serves this purpose for apply
- Visual dashboard of migration state — out of scope
- Automated Discord channel health checks post-cutover — operator observation is sufficient
- Report diff tool (compare report runs) — out of scope; git diff suffices

</deferred>
