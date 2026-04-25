---
phase: 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier
plan: 03
subsystem: cutover/additive-applier+ledger
tags: [cutover, additive-applier, ledger, jsonl, append-only, di-pure, dry-run-default, secret-scan-gate, idempotency-check-then-act, d05, d07, d10]
dependency-graph:
  requires:
    - "Plan 92-01 AgentProfile + cutover CLI subcommand-group skeleton (cutover.ts)"
    - "Plan 92-02 CutoverGap 9-kind discriminated union + AdditiveCutoverGap helper sub-union"
    - "Phase 84 scanSkillSecrets (3-phase classifier — credential-context gate)"
    - "Phase 84 normalizeSkillFrontmatter (pure string transform)"
    - "Phase 86 updateAgentSkills (atomic temp+rename, parseDocument AST, comment-preserving)"
    - "Phase 90-07 updateAgentConfig (Partial<AgentConfig> patcher with secret scan + JSON-stable merge)"
    - "Phase 91 RsyncRunner contract (node:child_process.execFile shape)"
    - "Phase 82 ledger.ts append-only JSONL invariants (mirror donor)"
  provides:
    - "cutoverLedgerActionSchema + cutoverLedgerRowSchema + CutoverLedgerRow type (D-05)"
    - "AdditiveApplyOutcome 7-variant discriminated union"
    - "DEFAULT_CUTOVER_LEDGER_PATH constant (~/.clawcode/manager/cutover-ledger.jsonl)"
    - "appendCutoverRow / readCutoverRows / queryCutoverRowsByAgent — append-only ledger surface"
    - "applyAdditiveFixes(deps): pure-DI per-kind dispatcher for the 4 additive CutoverGap kinds"
    - "AdditiveApplierDeps DI shape (mirrors Plan 92-04 destructive applier blueprint)"
    - "YamlWriteResult + SecretScanResult + RsyncResult normalized DI return shapes"
    - "clawcode cutover apply-additive CLI subcommand (--apply opt-in; default dry-run)"
  affects:
    - "Plan 92-04 destructive embed renderer mirrors AdditiveApplierDeps DI shape; ledger row uses preChangeSnapshot field reserved here"
    - "Plan 92-06 verify pipeline reads ledger via readCutoverRows + queryCutoverRowsByAgent"
    - "Plan 92-06 report writer consumes AdditiveApplyOutcome 7-variant union exhaustively"
    - "Plan 92-06 set-authoritative cutover gate reads ledger for audit trail (D-09 24h freshness)"
    - "Future rollback CLI (scope of Plan 92-06) rewinds via append-only ledger replay"
tech-stack:
  added: []
  patterns:
    - "Append-only JSONL ledger (mirrors Phase 82 + 84 ledger.ts shape)"
    - "Validate-on-write (zod safeParse before mkdir+appendFile)"
    - "Pure-DI dispatcher with all I/O primitives injected via Deps struct"
    - "Idempotency via check-then-act (re-read target state before each apply)"
    - "Secret-scan ordering invariant pinned by test-spy ordering (scan BEFORE rsync)"
    - "Dry-run default with --apply opt-in (D-07 three-tier safety)"
    - "Destructive deferral via gap.severity === 'additive' filter"
    - "Spread+sort immutable array updates (CLAUDE.md immutability rule)"
    - "Per-gap try/catch + log+continue (terminal short-circuit only on yaml-fail / rsync-fail / secret-scan-refused)"
key-files:
  created:
    - "src/cutover/ledger.ts (118 lines): append-only JSONL writer/reader/query"
    - "src/cutover/additive-applier.ts (407 lines): per-kind dispatcher + idempotency + ledger emit"
    - "src/cli/commands/cutover-apply-additive.ts (271 lines): production CLI wrapper"
    - "src/cutover/__tests__/ledger.test.ts (140 lines, 7 tests)"
    - "src/cutover/__tests__/additive-applier.test.ts (343 lines, 8 tests)"
  modified:
    - "src/cutover/types.ts: extended (NOT replaced) with cutoverLedgerActionSchema + cutoverLedgerRowSchema + AdditiveApplyOutcome — Plans 92-01/02 surface preserved verbatim"
    - "src/cli/commands/cutover.ts: registerCutoverApplyAdditiveCommand wired alongside ingest/profile/probe/diff"
decisions:
  - "Ledger row shape verbatim per CONTEXT.md D-05 with D-10 preChangeSnapshot reserved field (null for additive; Plan 92-04 populates for destructive)"
  - "Append-only invariant enforced by absence of clearLedger/truncate/removeRow/rewriteRow exports; appendFile (not writeFile) prevents read-modify-write races"
  - "Validate-on-write pattern: cutoverLedgerRowSchema.safeParse runs BEFORE mkdir + appendFile so a malformed row never reaches the filesystem (Phase 82 ledger.ts donor invariant)"
  - "Read-side tolerance: malformed JSON lines or schema-invalid rows are SKIPPED with logger warn (forward-compatibility for Plan 92-04/06 row-shape extensions)"
  - "applyAdditiveFixes is a single-pass loop with immutable state-snapshot read at start; per-applied gap, currentSkills/currentAllowedModels are spread+sort-replaced for the next iteration so two consecutive missing-skill gaps for different skills both succeed"
  - "Idempotency check-then-act per kind: missing-skill checks YAML.skills membership; missing-memory-file/upload stat the target path; model-not-in-allowlist checks YAML.allowedModels membership"
  - "Secret-scan ordering pin: scanSkillForSecrets called BEFORE runRsync for missing-skill — refusal short-circuits the entire applier (operator must move secrets before re-running)"
  - "Destructive deferral: gap.severity === 'additive' filter is the safety floor; destructive count surfaces in outcome.destructiveDeferred for Plan 92-04 admin-clawdy embed handoff"
  - "missing-mcp routed to a deferred-with-reason ledger entry (NOT auto-mutated): operator must add op:// refs via /clawcode-plugins-browse before MCP server is wired. The 5th additive kind from Plan 92-02's union does not auto-apply because credential context is operator-set"
  - "Dry-run is the DEFAULT at the wrapper layer (apply: false → no writes, no ledger). --apply flag is opt-in per D-07 three-tier safety"
  - "Phase 86 atomic YAML writers (updateAgentSkills/updateAgentConfig) reused via DI adapters in CLI wrapper — never raw fs.writeFile clawcode.yaml"
  - "Per-gap try/catch logs+continues for non-terminal errors (idempotent re-run safe). Terminal short-circuits: secret-scan-refused, rsync-failed, yaml-write-failed"
  - "updateAgentSkills wrapper note: Phase 86 writer takes one skillName at a time with op: add|remove. Adapter iterates the sorted nextSkills array calling add for each — idempotency-safe because the writer returns no-op for already-present entries"
  - "Test coverage exceeded plan minimum: 7 ledger tests (plan: 4) + 8 applier tests (plan: 8) = 15 total; secret-scan ordering pin (A2: scanSkillForSecrets called before runRsync), dry-run zero-side-effect (A6), destructive-deferral counting (A7), and check-then-act idempotency (A8) all explicitly pinned"
metrics:
  completed_date: "2026-04-25"
  duration_minutes: 9
  tasks: 2
  files_created: 5
  files_modified: 2
  tests_added: 15  # 7 ledger + 8 applier
  tests_total: 50  # 35 from Plans 92-01/02 + 15 from this plan
  tests_passing: 50
---

# Phase 92 Plan 03: Additive Auto-Applier + cutover-ledger.jsonl Summary

CUT-05 spine: pure-DI per-kind dispatcher for the 4 additive CutoverGap kinds (missing-skill, missing-memory-file, missing-upload, model-not-in-allowlist) routed to Phase 91 rsync (file copies) and Phase 86 atomic YAML writers (config patches), with Phase 84 secret-scan gating skill copies. Each successful apply emits exactly one append-only JSONL ledger row at `~/.clawcode/manager/cutover-ledger.jsonl`. Default invocation is dry-run; `--apply` is opt-in per D-07.

## What Shipped

**One append-only ledger module + one DI-pure dispatcher + one production CLI wrapper.**

```
clawcode cutover apply-additive --agent X            # dry-run (default)
clawcode cutover apply-additive --agent X --apply    # writes
  ├─ reads:   ~/.clawcode/manager/cutover-reports/X/latest/CUTOVER-GAPS.json (Plan 92-02)
  ├─ filters: gap.severity === "additive" (destructive count surfaced separately)
  ├─ per-gap: idempotency check-then-act → primitive call → ledger row
  └─ writes:  ~/.clawcode/manager/cutover-ledger.jsonl (append-only JSONL)
```

The applier is fully DI-pure — `updateAgentSkills`, `updateAgentConfig`, `scanSkillForSecrets`, `normalizeSkillFrontmatter`, and `runRsync` are all injected via `AdditiveApplierDeps`. The CLI wrapper at `src/cli/commands/cutover-apply-additive.ts` is the production caller that wires Phase 84/86/91 primitives; tests bypass the wrapper and pass `vi.fn()` stubs directly.

## CutoverLedgerRow Contract (D-05 + D-10)

```ts
{
  timestamp: ISO8601,                 // refine: Date.parse() && includes "T"
  agent: string,                      // min(1)
  action: "apply-additive" | "apply-destructive" | "reject-destructive" | "rollback" | "skip-verify",
  kind: string,                       // CutoverGap['kind'] OR meta-action
  identifier: string,
  sourceHash: string | null,          // sha256 of source content
  targetHash: string | null,          // sha256 of target content after apply
  reversible: boolean,                // true for additive
  rolledBack: boolean,                // false at apply; rollback action appends NEW row
  preChangeSnapshot: string | null,   // D-10 — base64-gzipped pre-apply for destructive < 64KB
  reason: string | null,              // skip-verify / refusal / deferred-mcp reason
}
```

Plan 92-04 (destructive embed) populates `preChangeSnapshot` on Accept; this plan emits `null` for every additive row (additive fixes are trivially reversible: delete file / remove YAML entry).

Plan 92-06 (rollback CLI) reads via `readCutoverRows()` + `queryCutoverRowsByAgent()` and rewinds in LIFO order, appending rollback rows (never mutating prior rows).

## AdditiveApplyOutcome 7-Variant Union

| Variant                       | Trigger                                              | Exit code |
|-------------------------------|------------------------------------------------------|-----------|
| `applied`                     | One or more additive gaps applied successfully       | 0         |
| `dry-run`                     | apply: false (default) — zero side effects           | 0         |
| `no-gaps-file`                | CUTOVER-GAPS.json missing                            | 1         |
| `secret-scan-refused`         | Phase 84 scanSkillSecrets refused (terminal)         | 1         |
| `yaml-write-failed`           | Phase 86 writer returned not-found/file-not-found    | 1         |
| `rsync-failed`                | rsync exitCode !== 0 (terminal for current gap)      | 1         |
| `destructive-gaps-deferred`   | Reserved (currently surfaced via outcome.destructiveDeferred field on `applied`) | — |

Plan 92-06's report writer switches exhaustively over this union (TypeScript compile-time enforcement).

## AdditiveApplierDeps DI Shape

```ts
type AdditiveApplierDeps = {
  agent: string;
  gaps: readonly CutoverGap[];
  apply: boolean;                      // false → dry-run
  clawcodeYamlPath: string;
  skillsTargetDir: string;
  memoryRoot: string;
  uploadsTargetDir: string;
  openClawHost: string;
  openClawWorkspace: string;
  openClawSkillsRoot: string;
  ledgerPath: string;
  updateAgentSkills: (agent, nextSkills, opts) => Promise<YamlWriteResult>;
  updateAgentConfig: (agent, patch, opts) => Promise<YamlWriteResult>;
  scanSkillForSecrets: (skillDir) => Promise<SecretScanResult>;
  normalizeSkillFrontmatter: (skillDir) => Promise<void>;
  runRsync: (args) => Promise<RsyncResult>;
  now?: () => Date;
  log: Logger;
};
```

Plan 92-04 (destructive applier) mirrors this DI shape verbatim — only the `apply` semantics differ (admin-clawdy Accept gates the call instead of the `--apply` flag).

## Idempotency Check-Then-Act (Per Kind)

| Kind                     | Check before apply                                          |
|--------------------------|-------------------------------------------------------------|
| missing-skill            | parseDocument(clawcode.yaml).agents[agent].skills includes? |
| missing-memory-file      | stat(memoryRoot/identifier) succeeds?                       |
| missing-upload           | stat(uploadsTargetDir/identifier) succeeds?                 |
| model-not-in-allowlist   | parseDocument(...).agents[agent].allowedModels includes?    |
| missing-mcp              | (deferred — ledger entry only, never auto-mutates)          |

Re-running `apply-additive` after the first successful run is a no-op: every check returns "already present", `gapsSkipped` increments, zero ledger rows emitted. A8 test pins this.

## Secret-Scan Ordering Invariant

For `missing-skill`:

1. Idempotency check (YAML.skills.includes) — skip if present
2. **scanSkillForSecrets(sourceSkillDir)** ← MUST be called BEFORE runRsync
3. If refused → return `secret-scan-refused` outcome (terminal short-circuit)
4. normalizeSkillFrontmatter(sourceSkillDir)
5. runRsync(skillDir copy)
6. updateAgentSkills(agent, nextSkills sorted)
7. appendCutoverRow

A2 test pins step 2 ordering: `expect(runRsync).toHaveBeenCalledTimes(0)` AND `expect(updateAgentSkills).toHaveBeenCalledTimes(0)` after a refused scan. The ledger file is also asserted absent (no row leaked).

## Phase 86 Atomic Writer Adapter Note

The Phase 86 `updateAgentSkills` writer takes one `skillName` at a time with `op: "add" | "remove"`. The CLI wrapper's `updateAgentSkillsAdapter` iterates the sorted `nextSkills` array calling `op: "add"` for each entry — idempotency-safe because the writer returns `outcome: "no-op"` for already-present entries. This avoids reimplementing the AST mutation logic; reuse discipline preserved.

## Test Coverage (15 new; 50/50 cumulative cutover)

### ledger.test.ts (7 tests)

| Test         | Pin                                                                |
|--------------|--------------------------------------------------------------------|
| L1           | First-write creates parent dir + 1 parseable JSONL line             |
| L2           | Two sequential appends → 2 lines; readCutoverRows preserves order   |
| L3           | Schema-invalid row throws before any fs touch (file size unchanged) |
| L4           | queryCutoverRowsByAgent filters mixed-agent rows correctly          |
| L4-empty     | queryCutoverRowsByAgent returns [] when ledger file absent          |
| DEFAULT-path | DEFAULT_CUTOVER_LEDGER_PATH ends in `.clawcode/manager/cutover-ledger.jsonl` |
| malformed    | readCutoverRows skips garbage lines (forward-compat read tolerance) |

### additive-applier.test.ts (8 tests)

| Test | Pin                                                                              |
|------|----------------------------------------------------------------------------------|
| A1   | missing-skill happy: scan→normalize→rsync→updateAgentSkills→ledger row           |
| A2   | missing-skill secret-scan refused: NO rsync, NO updateAgentSkills, NO ledger     |
| A3   | missing-memory-file happy: rsync→ledger row with kind="missing-memory-file"      |
| A4   | missing-upload happy: rsync→ledger row with kind="missing-upload"                |
| A5   | model-not-in-allowlist: updateAgentConfig({allowedModels: existing+missing})     |
| A6   | dry-run: apply: false → outcome.kind="dry-run", ZERO calls, no ledger file       |
| A7   | destructive-deferral: 2 outdated + 1 missing-skill → gapsApplied=1, deferred=2   |
| A8   | idempotency: pre-fixed gaps → gapsApplied=0, gapsSkipped=3, zero ledger rows     |

## Static-Grep Regression Pins (verified)

| Pin                                                                                          | Status |
|----------------------------------------------------------------------------------------------|--------|
| `grep -q "export const cutoverLedgerRowSchema" src/cutover/types.ts`                         | OK     |
| `grep -q "export type CutoverLedgerRow" src/cutover/types.ts`                                | OK     |
| `grep -q "export type AdditiveApplyOutcome" src/cutover/types.ts`                            | OK     |
| `grep -q 'preChangeSnapshot:' src/cutover/types.ts`                                          | OK     |
| `grep -q "export async function appendCutoverRow" src/cutover/ledger.ts`                     | OK     |
| `grep -q "cutoverLedgerRowSchema.safeParse(row)" src/cutover/ledger.ts`                      | OK (validate-on-write) |
| `! grep -E "(export\s+(async\s+)?function\|const)\s+(clearLedger\|truncate\|removeRow\|rewriteRow)" src/cutover/ledger.ts` | OK (append-only) |
| `! grep -E "\bwriteFile\b.*(ledger\|cutover)" src/cutover/ledger.ts`                         | OK (no read-modify-write) |
| `! grep -E '\.write\(.*pos:' src/cutover/ledger.ts`                                          | OK (no seek-and-overwrite) |
| `grep -q "export async function applyAdditiveFixes" src/cutover/additive-applier.ts`         | OK     |
| `grep -q 'gap.severity === "additive"' src/cutover/additive-applier.ts`                      | OK (destructive filter) |
| `grep -q "scanSkillForSecrets" src/cutover/additive-applier.ts`                              | OK     |
| `grep -q "updateAgentSkills" src/cutover/additive-applier.ts`                                | OK     |
| `grep -q "updateAgentConfig" src/cutover/additive-applier.ts`                                | OK     |
| `grep -q "registerCutoverApplyAdditiveCommand" src/cli/commands/cutover.ts`                  | OK     |
| `git diff package.json` empty                                                                 | OK (zero new npm deps) |

## CLI Surface (verified)

```
$ node dist/cli/index.js cutover apply-additive --help
Usage: clawcode cutover apply-additive [options]

Apply the 4 additive CutoverGap kinds (missing-memory-file, missing-upload,
missing-skill, model-not-in-allowlist). Default: dry-run. Use --apply to write.

Options:
  --agent <name>          Agent
  --apply                 Actually perform writes (without this flag, runs in
                          dry-run mode) (default: false)
  --gaps-file <path>      Override CUTOVER-GAPS.json path
  --ledger-path <path>    Override cutover-ledger.jsonl path (default:
                          "~/.clawcode/manager/cutover-ledger.jsonl")
  --clawcode-yaml <path>  Override clawcode.yaml path
  -h, --help              display help for command
```

## Deviations from Plan

### [Doc-only] Phase 86 writer signature differs from plan pseudocode

The plan's `<interfaces>` block called for `updateAgentSkills(agent, nextSkills[], opts)` accepting an entire array. The actual Phase 86 export is `updateAgentSkills({existingConfigPath, agentName, skillName, op: "add"|"remove", pid?})` — one skill per call.

**Resolution:** The applier's DI surface keeps the array-shape contract (cleaner for tests) and the CLI wrapper's `updateAgentSkillsAdapter` iterates the array, calling Phase 86's writer with `op: "add"` per entry. Idempotency-safe because the writer returns `outcome: "no-op"` for already-present skills. Zero behavior drift; the underlying atomic temp+rename + comment preservation discipline is preserved.

### [Doc-only] missing-mcp 5th additive kind treated as deferred ledger entry

Plan 92-02 declared the CutoverGap union with 5 additive kinds (missing-mcp added to the original 4). The user's prompt for this plan listed only 4 additive kinds for auto-application. The applier's switch handles missing-mcp by appending a deferred-with-reason ledger row (no auto-mutation) — the operator must add op:// refs via `/clawcode-plugins-browse` before the MCP server is wired. This matches the plan's action block which explicitly described this routing. Plan 92-06 report surfaces the deferred entries.

### [Auto-add Rule 2] Per-gap try/catch with log+continue

The plan's pseudocode had a single try/catch. The implementation also includes per-gap try/catch that logs and continues for non-terminal errors so a single transient hiccup (e.g., one rsync timeout) doesn't abort the entire batch. Terminal short-circuits remain explicit: secret-scan-refused, rsync-failed, yaml-write-failed. Idempotency makes re-runs safe.

### [Doc-only] Test count stated as ≥12; actual = 15

The plan specified 4+8 = 12 tests minimum. Actual: 7 ledger tests (added DEFAULT_CUTOVER_LEDGER_PATH constant test + malformed-line tolerance test beyond the 4 minimum) + 8 applier tests = 15 total. Coverage exceeded; nothing dropped.

## Wiring for Plan 92-04 (destructive applier)

Plan 92-04 mirrors `AdditiveApplierDeps` shape with one structural difference: the `apply` boolean becomes a per-gap `acceptedAt: ISO8601 | null` field (admin-clawdy Accept timestamp). For each accepted destructive gap:

```ts
case "outdated-memory-file":
  // 1. Capture pre-change snapshot (sha256 + base64-gzip if < 64KB) into ledger row
  // 2. Phase 91 rsync overwrite
  // 3. Append ledger row with action="apply-destructive" + preChangeSnapshot populated
case "mcp-credential-drift":      /* ... */
case "tool-permission-gap":       /* ... */
case "cron-session-not-mirrored": /* ... */
default: assertNever(gap);  // 9-kind exhaustive switch
```

The append-only ledger format already supports this (preChangeSnapshot field reserved here, `null` for additive; populated for destructive accepted apply).

## Wiring for Plan 92-06 (verify pipeline + rollback CLI)

- `runCutoverVerifyAction({...readCutoverRowsDep: readCutoverRows, queryByAgentDep: queryCutoverRowsByAgent})` reads the ledger to compose the cutover-readiness gate (D-09 24h freshness check)
- `runCutoverRollbackAction({...applyAdditiveFixesDep, applyDestructiveDep})` rewinds ledger rows in LIFO order; appends new rollback rows (never mutates)
- `clawcode sync set-authoritative clawcode --confirm-cutover` precondition: latest cutover-report's `cutover_ready: true` + ledger has zero unrolled-back destructive rows

Both action functions are pure async + DI'd, mirroring Phase 91's `runSyncRunOnceAction(deps)` pattern.

## Self-Check: PASSED

Verified files exist and commits are present in git history:
- `src/cutover/types.ts` (extended) — present, 670 lines
- `src/cutover/ledger.ts` — present, 118 lines
- `src/cutover/additive-applier.ts` — present, 407 lines
- `src/cli/commands/cutover-apply-additive.ts` — present, 271 lines
- `src/cli/commands/cutover.ts` (modified) — registers apply-additive
- `src/cutover/__tests__/ledger.test.ts` — present, 140 lines, 7 it-blocks
- `src/cutover/__tests__/additive-applier.test.ts` — present, 343 lines, 8 it-blocks
- Commit c22318a (Task 1 RED) — present in git log
- Commit f4ab850 (Task 2 GREEN) — present in git log
- 50/50 cutover tests pass (`npx vitest run src/cutover/`)
- `npm run build` exits 0
- `node dist/cli/index.js cutover apply-additive --help` lists --agent, --apply, --gaps-file, --ledger-path
- `git diff package.json` empty (zero new npm deps)
- All static-grep regression pins green
