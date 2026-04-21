# Phase 77: Pre-flight Guards + Safety Rails - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Introduce an `apply` subcommand stub that runs four pre-flight safety invariants in order and refuses to proceed on any violation with an actionable error — daemon running, secret-shape in proposed YAML, Discord channel collision with existing `clawcode.yaml`, and write attempt on any path under `~/.openclaw/`. Every guard outcome lands in `.planning/migration/ledger.jsonl`.

This phase delivers MIGR-02 (4 pre-flight refusals), MIGR-06 (ledger schema witnesses), MIGR-07 (source system read-only), OPS-03 (channel collision hard-fail). The `apply` command's ACTUAL write path is Phase 78+ — this phase produces the guards that protect it.

</domain>

<decisions>
## Implementation Decisions

### Daemon Detection & apply Skeleton
- **Daemon check:** `systemctl --user is-active openclaw-gateway.service` via `execa` (already in deps). Exit 0 → running → refuse. `openclaw-gateway.service` confirmed present on prod host (systemd verified).
- **apply shape this phase:** Stub runs all 4 guards in order, logs each outcome to ledger, refuses at the end with `apply not implemented — pre-flight guards only in Phase 77`. Zero actual YAML or filesystem writes beyond the ledger.
- **systemd fallback:** Error out with actionable message: `"daemon check requires systemd (Linux). Skipping — pass --force-no-daemon-check to override on non-systemd hosts."` No actual `--force-no-daemon-check` flag this phase; just the error. (Flag can be added in a future milestone if cross-platform dev becomes a need.)
- **Exit codes:** 0 = all guards pass; 1 = any guard fails. Guard-specific diagnostics encoded in ledger rows (`step` + `outcome` fields), not via multi-exit-code. Matches Phase 76 binary-exit convention.

### Secret Shape Detection & Channel Collision
- **Secret-shape flagger (reject):**
  - `^sk-[A-Za-z0-9_\-]{20,}$` — OpenAI / Anthropic bearer tokens
  - `^MT[A-Za-z0-9._\-]{20,}` — Discord bot tokens
  - Generic high-entropy string: ≥30 chars, ≥3 character classes (upper + lower + digit, or +/=/._- in the mix) with shannon entropy ≥ 4.0 bits/char
- **Whitelist (allow):**
  - `^op://` (1Password refs)
  - Numeric-only strings (Discord channel IDs, Unix timestamps)
  - `^[a-z0-9\-]+$` short identifiers up to 40 chars (MCP server names, agent ids)
  - Empty string / `null`
- **Scanner scope:** Recursive walk of every string value in the proposed `clawcode.yaml` tree (from `buildPlan()` output → target config projection). Catches secrets nested in `mcpServers[].env` blocks.
- **Channel collision source:** Use existing `loadConfig()` from `src/config/loader.ts` to parse the user's current `clawcode.yaml`. Extract `channels:` entries across all agents. Intersect with the Discord channel IDs in OpenClaw `bindings[]` (from Phase 76 reader).
- **Collision report format:** Aligned-column table — `Source agent (OpenClaw) | Target agent (ClawCode) | Channel ID | Resolution hint`. Default resolution hint: "unbind the OpenClaw side (ClawCode is the migration target)". Operator gets exact commands to run.

### Read-Only Guard & Ledger Schema Extension
- **Read-only guard (belt + suspenders):**
  - **Runtime:** Wrap `fs.writeFile{,Sync}`, `fs.appendFile{,Sync}`, `fs.mkdir{,Sync}` at migration-CLI entry. If path resolves (via `path.resolve()`) under `~/.openclaw/`, throw `ReadOnlySourceError` immediately — aborts the current guard chain, logs refuse row to ledger.
  - **Static:** Grep-based test asserts no literal `~/.openclaw/` string appears in write-context calls across `src/migration/`. Runs in CI; prevents silent regression.
- **Ledger schema extension:** Additive — keep Phase 76 fields canonical (`ts`, `action`, `agent`, `status`, `source_hash`, `target_hash?`, `notes?`). ADD as optional:
  - `step?: string` — guard identifier, e.g., `"pre-flight:daemon"`, `"pre-flight:secret"`, `"pre-flight:channel"`, `"pre-flight:readonly"`
  - `outcome?: "allow" | "refuse"` — narrower than existing `status`; `refuse` always pairs with `status: "pending"` (guard never advances state)
  - `file_hashes?: Record<string, string>` — map of path → sha256 for witness rows (e.g., hash of current `clawcode.yaml`)
- **Guard execution order:** 1. daemon (fastest fail), 2. read-only guard (installed early so subsequent guards can't write source files), 3. secret-scan, 4. channel-collision. Fail-fast; short-circuit on first refusal.
- **`--only <agent>` flag:** Implemented this phase on `apply` stub. Pre-flight guards run for that agent's slice only (single OpenclawSourceEntry, single target projection). Channel-collision check narrows to that target agent's channels. Matches MIGR-02 wording exactly.

### Claude's Discretion
- Exact shannon-entropy computation implementation (standard formula, no library needed)
- Error message copy — keep actionable and consistent with Phase 76's style
- Unit test structure for each guard — follow Phase 76 module test patterns
- Whether to expose guards as reusable exports from `src/migration/guards.ts` or keep them private to the CLI module — Phase 78+ consumers may want reuse, so lean toward exported

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/migration/ledger.ts` — Phase 76's JSONL writer; schema is zod-validated and additive-extendable
- `src/migration/openclaw-config-reader.ts` — exposes `OpenclawSourceInventory` with `bindings[]` (Discord channels) per-agent
- `src/migration/diff-builder.ts` — `buildPlan()` produces the PlanReport that feeds secret-scanner (proposed YAML tree preview)
- `src/config/loader.ts:loadConfig()` — reads existing `clawcode.yaml`; returns validated full config for channel-collision check
- `src/cli/output.ts` — ANSI color helpers from Phase 76 (red for refuse, green for allow)
- `execa` — already in deps; use for `systemctl` invocation

### Established Patterns
- New migration modules land in `src/migration/<module>.ts` with sibling `__tests__/<module>.test.ts`
- Exit-1 CLI paths use `cliError()` + `process.exit(1)` (Phase 76 convention)
- zod schemas in module file; type derived via `z.infer`
- Env-var test overrides — `CLAWCODE_OPENCLAW_JSON`, `CLAWCODE_LEDGER_PATH` established Phase 76; extend with `CLAWCODE_CONFIG_PATH` for the user clawcode.yaml override (for test isolation)

### Integration Points
- New module: `src/migration/guards.ts` — exports `checkDaemonRunning()`, `scanSecrets(report: PlanReport)`, `detectChannelCollisions(inventory, existingConfig)`, `assertReadOnlySource(path: string)`. Each returns a GuardResult with `{pass: boolean, ledgerRow: LedgerRow}`.
- New module: `src/migration/apply-preflight.ts` — orchestrates the 4 guards in order, writes ledger rows, returns final exit code.
- Extend: `src/migration/ledger.ts` `ledgerRowSchema` with optional `step`, `outcome`, `file_hashes` fields (backward-compatible — all optional).
- Extend: `src/cli/commands/migrate-openclaw.ts` with `.command("apply")` subcommand + `--only <agent>` flag; wire to `apply-preflight.ts`.
- Runtime fs-guard: install once in `migrate-openclaw.ts` before any guard runs; uninstall on command exit.

### Data Sources
- 15 OpenClaw agents from `openclaw.json` (Phase 76)
- 7 Discord bindings from `openclaw.json.bindings[]` (Phase 76)
- Existing `clawcode.yaml` channels — may be empty; handle missing-file case gracefully (no collisions possible if no existing config)

</code_context>

<specifics>
## Specific Ideas

- Error message for daemon-running (per success criterion #1): `"OpenClaw daemon is running. Run 'systemctl --user stop openclaw-gateway' first, then re-run the migration."` — use this literal string.
- Error message for secret refusal (per success criterion #2): `"refused to write raw secret-shaped value to clawcode.yaml — use op:// reference or whitelist the value"` — use this literal string.
- Channel collision report includes the exact `clawcode` unbind command the operator can copy-paste.
- Ledger row for each guard outcome — bootstrap four rows minimum per `apply` invocation (one per guard, even if short-circuited — write the refused one then stop).

</specifics>

<deferred>
## Deferred Ideas

- Actual YAML write path for `apply` — Phase 78
- `--force-no-daemon-check` flag for non-systemd hosts — future milestone if needed
- Parallel guard execution — fail-fast sequential is clearer and matches operator expectations
- Cross-platform daemon detection (macOS `launchctl`, Windows service) — Linux-only prod per STATE.md
- Secret-shape whitelist file (user-provided JSON with allowed strings) — out of scope; hard refusal is the rule per roadmap
- Ledger compaction / rotation — the JSONL will never grow beyond ~hundreds of rows for this migration; rotation is premature

</deferred>
