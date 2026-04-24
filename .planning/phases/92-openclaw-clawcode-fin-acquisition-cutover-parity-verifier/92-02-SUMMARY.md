---
phase: 92-openclaw-clawcode-fin-acquisition-cutover-parity-verifier
plan: 02
subsystem: cutover/probe+diff
tags: [cutover, target-probe, diff-engine, cutover-gap, discriminated-union, d11-cron-session, no-leak, pure-function, di-pure]
dependency-graph:
  requires:
    - "Plan 92-01 AgentProfile 7-key schema (agentProfileSchema)"
    - "Plan 92-01 cutover CLI subcommand-group skeleton (cutover.ts)"
    - "Phase 85 list-mcp-status IPC (target MCP runtime state)"
    - "Phase 86 atomic YAML writer pattern (atomic temp+rename — REUSED FOR JSON)"
    - "Phase 91 sync-status.ts CLI shape (mirrored for cutover-probe/diff wrappers)"
    - "Phase 88 SkillInstallOutcome 9-kinds discriminated-union pattern (canonical reference)"
  provides:
    - "CutoverGap typed discriminated union with EXACTLY 9 kinds (D-04 + D-11)"
    - "AdditiveCutoverGap / DestructiveCutoverGap helper sub-unions"
    - "assertNever exhaustive-switch compile-time witness"
    - "sortGaps deterministic-order helper (kind asc, identifier asc)"
    - "targetCapabilitySchema (mirror-shape of AgentProfile + workspace inventory + MCP runtime + sessionKinds[])"
    - "ProbeOutcome / DiffOutcome discriminated unions"
    - "diffAgentVsTarget(profile, target): PURE function returning sorted readonly CutoverGap[]"
    - "probeTargetCapability(deps): DI-pure module unioning yaml + workspace + IPC inputs into TargetCapability"
    - "McpServerSnapshot DI shape (canonical for downstream listMcpStatus consumers)"
    - "ProbeConfigShape: narrowed Config-shape so probe's loadConfig DI is testable without full Config schema"
    - "WorkspaceInventory DI shape: memoryFiles[], memoryMdSha256, uploads[], skillsInstalled[]"
    - "clawcode cutover probe + clawcode cutover diff CLI subcommands"
  affects:
    - "Plan 92-03 additive applier consumes 5 additive CutoverGap variants"
    - "Plan 92-04 destructive embed renderer consumes 4 destructive CutoverGap variants (exhaustive switch via assertNever)"
    - "Plan 92-05 canary synthesizer reads cron-prefixed topIntents to drive cron-parity battery"
    - "Plan 92-06 report writer consumes ProbeOutcome + DiffOutcome + the full CutoverGap[]"
tech-stack:
  added: []
  patterns:
    - "Pure-function diff engine (no I/O, no clock, no env) with sortGaps spread-then-sort immutability"
    - "DI-pure target probe (loadConfig + listMcpStatus + readWorkspaceInventory all injected)"
    - "Field-by-field YAML extraction with NEVER ...spread on env objects (NO-LEAK by construction)"
    - "envKeys: Object.keys(env) extraction discipline — values never accessed, never serialized"
    - "Atomic JSON write via writeFile to .nanoid.tmp + rename (mirrors Phase 78/86/91 yaml-writer)"
    - "Defensive schema.safeParse before serialization (catches builder/consumer drift)"
    - "Discriminated-union exhaustive switch + assertNever compile-time witness (Phase 88 SkillInstallOutcome blueprint extended to 9 kinds)"
    - "Heuristic credential-drift detection: status === 'critical' AND lastError contains auth keyword"
    - "Cast-extension test fixtures for v1-not-yet-emitted variants (memoryRefHashes, aclDenies) — type exists for downstream consumers, production data may produce zero gaps until profiler enrichment"
key-files:
  created:
    - "src/cutover/diff-engine.ts (294 lines): PURE diffAgentVsTarget(profile, target) → sorted readonly CutoverGap[]"
    - "src/cutover/target-probe.ts (323 lines): DI-pure probeTargetCapability(deps) → ProbeOutcome + atomic TARGET-CAPABILITY.json"
    - "src/cutover/__tests__/diff-engine.test.ts (373 lines, 11 tests): D1..D9 per-kind + D-DETERMINISM + D-EXHAUSTIVE"
    - "src/cutover/__tests__/target-probe.test.ts (228 lines, 5 tests): PR1 happy + PR2 not-found + PR3 yaml-fail + PR4 ipc-fail + PR5 NO-LEAK"
    - "src/cli/commands/cutover-probe.ts (119 lines): registerCutoverProbeCommand + runCutoverProbeAction (DI'd for tests, daemon-wired for prod via Plan 92-06)"
    - "src/cli/commands/cutover-diff.ts (200 lines): registerCutoverDiffCommand + runCutoverDiffAction (reads two JSONs, atomic CUTOVER-GAPS.json write)"
  modified:
    - "src/cutover/types.ts: extended (NOT replaced) with CutoverGap union (9 kinds), AdditiveCutoverGap/DestructiveCutoverGap, assertNever, sortGaps, targetCapabilitySchema (incl. sessionKinds[]), ProbeOutcome, DiffOutcome — Plan 92-01's mcHistoryEntrySchema/MC_DEFAULT_BASE_URL/etc preserved verbatim"
    - "src/cli/commands/cutover.ts: registerCutoverProbeCommand + registerCutoverDiffCommand wired alongside Plan 92-01's ingest + profile registrations"
decisions:
  - "CutoverGap has EXACTLY 9 kinds (5 additive + 4 destructive). D-11 added cron-session-not-mirrored — surfaces when MC has cron entries (cron:-prefixed intents) but target.yaml.sessionKinds[] lacks 'cron'. Additive count corrected from plan's 4 to 5 (the count drift was a CONTEXT.md shorthand pre-D-11)"
  - "diff-engine.ts is PURE: no fs, no clock (no `new Date()`), no env access, no Math.random. Pinned by static-grep (acceptance criterion in plan). The differ takes already-loaded inputs only"
  - "target-probe.ts is DI-pure: loadConfig + listMcpStatus + readWorkspaceInventory all injected via ProbeDeps. The CLI wrapper at cutover-probe.ts is the production caller that wires fs+IPC+config-loader; tests bypass the wrapper entirely"
  - "NO-LEAK invariant: probe extracts MCP env KEY NAMES via Object.keys(entry.env ?? {}) — VALUES are never read, copied, or serialized. PR5 test pins this with sk_live_secret_42 sentinel that must NOT appear in TARGET-CAPABILITY.json"
  - "Atomic JSON write via writeFile to .nanoid.tmp + rename — mirrors the yaml-writer convention from Phase 78/86/91. TARGET-CAPABILITY.json + CUTOVER-GAPS.json never appear partially-written"
  - "Heuristic mcp-credential-drift: requires status === 'critical' AND lastError matching one of [401, 403, invalid_key, auth, unauthorized, forbidden, expired]. First-pass; tightening to per-server fingerprinting deferred to Plan 92-05+"
  - "outdated-memory-file + tool-permission-gap variants are exercised via test fixture extensions (memoryRefHashes / aclDenies via cast). Production data may produce zero such gaps in v1 because Plan 92-01 profiler emits memoryRefs as plain strings without source hashes; production target ACL probe is deferred. The TYPES exist so downstream consumers (Plan 92-04 destructive embed) compile against the full union and adding profiler enrichment in a future plan automatically populates these gaps without renderer changes"
  - "TargetCapability.yaml.sessionKinds[] derived from agent's schedules array presence — empty schedules → ['direct'], non-empty → ['direct', 'scheduled']. Cron entry detection lives in target.yaml.sessionKinds.includes('cron') (a future enrichment can populate this from cron-config or daemon-side schedule introspection); v1 emits target without 'cron' so D-11 cron gaps surface end-to-end against any MC profile carrying cron-prefixed intents"
  - "Plan 92-03 additive applier handles 5 kinds (not 4 as 92-CONTEXT.md draft suggests pre-D-11). The 5 additive variants: missing-skill, missing-mcp, missing-memory-file, missing-upload, model-not-in-allowlist"
  - "Plan 92-04 destructive embed renderer handles 4 kinds: outdated-memory-file, mcp-credential-drift, tool-permission-gap, cron-session-not-mirrored — exhaustive switch + assertNever fails the TypeScript build if a 10th kind is added without updating the renderer"
  - "ProbeConfigShape narrows the full Config schema to fields the probe consumes (agents[].name + skills + mcpServers + model + allowedModels + memoryAutoLoad + memoryPath + workspace + channels + schedules) — keeps tests hermetic without materializing every required Config field via z.parse"
  - "agents are an ARRAY in the actual loadConfig output (config.agents.find((a) => a.name === target)), NOT a record by name. The plan's pseudocode showed config.agents?.[deps.agent] which would have been a bug; corrected at implementation time per the existing cutover-ingest.ts pattern"
  - "Status vocabulary normalization is the CLI wrapper's responsibility: Phase 85 list-mcp-status IPC returns 'ready/degraded/failed/reconnecting/unknown'; the probe + targetCapabilitySchema accept 'healthy/warning/critical/unknown'. Plan 92-06 will wire the mapping. Tests pass already-normalized snapshots"
metrics:
  completed_date: "2026-04-24"
  duration_minutes: 6
  tasks: 2
  files_created: 6
  files_modified: 2
  tests_added: 16  # 11 diff-engine + 5 target-probe
  tests_total: 35  # 19 from Plan 92-01 + 16 from this plan
  tests_passing: 35
  lines_total: 2087
---

# Phase 92 Plan 02: Target Capability Probe + Diff Engine + 9-Kind CutoverGap Union Summary

CUT-03 + CUT-04 spine: a DI-pure target-side capability probe (clawcode.yaml + workspace inventory + Phase 85 list-mcp-status IPC) and a deterministic, pure-function diff engine producing a typed CutoverGap[] discriminated union with exactly 9 kinds (D-11 cron-session-not-mirrored). The CutoverGap union is the contract Plans 92-03 (additive applier) and 92-04 (destructive embed) consume — interface-first by design.

## What Shipped

**Two pure-DI modules + two CLI subcommand wrappers + extended types.ts.**

```
clawcode cutover probe --agent X
  └─ probeTargetCapability(deps)     → ~/.clawcode/manager/cutover-reports/X/<ts>/TARGET-CAPABILITY.json
       reads: clawcode.yaml + workspace inventory + Phase 85 list-mcp-status IPC

clawcode cutover diff --agent X --input-dir <dir>
  └─ diffAgentVsTarget(profile, target)  → <dir>/CUTOVER-GAPS.json
       reads: AGENT-PROFILE.json (Plan 92-01) + TARGET-CAPABILITY.json (this plan)
```

The probe is DI-pure — `loadConfig`, `listMcpStatus`, and `readWorkspaceInventory` are all injected via `ProbeDeps`. The CLI wrapper at `src/cli/commands/cutover-probe.ts` is the production caller that wires production-side filesystem + IPC + config-loader; tests bypass the wrapper and pass `vi.fn()` stubs directly.

The diff engine is pure-pure — no I/O, no `new Date()`, no `process.env`, no `Math.random()`. Same input twice produces byte-identical output (D-DETERMINISM test). The `sortGaps()` helper spreads `[...gaps]` before sort so the input array is never mutated (CLAUDE.md immutability rule).

## CutoverGap Union — 9 Kinds (5 Additive + 4 Destructive)

| Kind                          | Severity    | Identifier source            | Consumed by   |
|-------------------------------|-------------|------------------------------|---------------|
| missing-skill                 | additive    | skill name                   | Plan 92-03    |
| missing-mcp                   | additive    | MCP server name              | Plan 92-03    |
| missing-memory-file           | additive    | memory path (rel memoryRoot) | Plan 92-03    |
| missing-upload                | additive    | upload filename              | Plan 92-03    |
| model-not-in-allowlist        | additive    | model id                     | Plan 92-03    |
| outdated-memory-file          | destructive | memory path                  | Plan 92-04    |
| mcp-credential-drift          | destructive | MCP server name              | Plan 92-04    |
| tool-permission-gap           | destructive | tool name (e.g. "Bash")      | Plan 92-04    |
| cron-session-not-mirrored     | destructive | cron sessionKey (D-11)       | Plan 92-04    |

Adding a 10th kind triggers TypeScript compile errors in:
- `src/cutover/diff-engine.ts` (the producer)
- `src/cutover/__tests__/diff-engine.test.ts` (D-EXHAUSTIVE switch over all 9 kinds)
- Plan 92-03's additive applier (when it lands)
- Plan 92-04's destructive embed renderer (when it lands)
- Plan 92-06's report writer (when it lands)

Via the `assertNever(x: never)` compile-time witness — the Phase 88 SkillInstallOutcome 9-kinds blueprint extended to the cutover spine.

## TargetCapability Schema (D-03 + D-11)

```ts
{
  agent: string,
  generatedAt: ISO8601,
  yaml: {
    skills: string[],
    mcpServers: { name: string, envKeys: string[] }[],   // KEY NAMES ONLY (NO-LEAK)
    model: string,
    allowedModels: string[],
    memoryAutoLoad: boolean,
    sessionKinds: string[],                              // D-11 cron parity surface
  },
  workspace: {
    memoryRoot: string,
    memoryFiles: { path: string, sha256: string }[],
    memoryMdSha256: string | null,
    uploads: string[],
    skillsInstalled: string[],
  },
  mcpRuntime: {
    name: string,
    status: "healthy" | "warning" | "critical" | "unknown",
    lastError: string | null,
    failureCount: number,
  }[],
}
```

`sessionKinds[]` is derived from the agent's `schedules` array presence: empty → `["direct"]`, non-empty → `["direct", "scheduled"]`. Cron-entry detection (would populate `"cron"`) is a future enrichment hook; v1 emits target without `"cron"` so D-11 cron gaps surface end-to-end against any MC profile carrying cron-prefixed intents.

## NO-LEAK Invariant (regression-pinned)

The probe extracts MCP env KEY NAMES via `Object.keys(entry.env ?? {})` — VALUES are never read, copied, or serialized. The static-grep pin enforces this:

- Required: `grep -q "Object.keys(entry.env"` → present
- Forbidden: `grep -E "agentCfg\\.mcpServers\\[.*\\]\\.env\\["` → no match
- Forbidden: `grep "JSON.stringify.*env"` → no match (env objects never serialized)

PR5 test pins this with the sentinel literal `sk_live_secret_42`: a synthetic config setting `STRIPE_SECRET_KEY: "sk_live_secret_42"` is fed to the probe; the test asserts `expect(raw).toContain("STRIPE_SECRET_KEY")` AND `expect(raw).not.toContain("sk_live_secret_42")`. Both pass.

## Test Coverage (16/16 green; 35/35 cumulative cutover)

| Test         | Pin |
|--------------|-----|
| D1           | missing-skill detection (skill in profile, absent in target.yaml.skills) |
| D2           | missing-mcp detection + toolsUsed extraction (mcp__SERVER__* tools collected) |
| D3           | missing-memory-file detection (memoryRef in profile, absent in target inventory) |
| D4           | missing-upload detection (upload in profile, absent in target inventory) |
| D5           | outdated-memory-file detection (extended fixture w/ memoryRefHashes; same path, different hashes) |
| D6           | model-not-in-allowlist detection (model used in profile, not in target allowlist) |
| D7           | mcp-credential-drift detection (status: critical + auth-shaped lastError "401 invalid_key") |
| D8           | tool-permission-gap detection (extended fixture w/ aclDenies; profile.tools matches deny list) |
| D9           | cron-session-not-mirrored detection (D-11 — cron-prefixed intent + target.sessionKinds lacks 'cron') |
| D-DETERMINISM | sorted by (kind asc, identifier asc); two calls deep-equal |
| D-EXHAUSTIVE | compile-time switch over all 9 kinds + assertNever default |
| PR1          | happy-path probe → outcome.kind === "probed"; written JSON validates against schema |
| PR2          | agent-not-found when config has no matching agent |
| PR3          | yaml-load-failed when loadConfig rejects |
| PR4          | ipc-failed when listMcpStatus rejects |
| PR5          | NO-LEAK: env values never appear in TARGET-CAPABILITY.json |

## Deviations from Plan

### [Rule 1 – Bug] Corrected `config.agents` shape from indexed-record to array

**Found during:** Task 2 implementation
**Issue:** The plan's pseudocode showed `config.agents?.[deps.agent]` (object indexed by name), but the actual `loadConfig` output is an array — verified against Plan 92-01's existing `cutover-ingest.ts:98` (`config.agents.find((a) => a.name === args.agent)`).
**Fix:** Implemented as `agents.find((a) => a.name === deps.agent)` in `target-probe.ts`, matching the existing convention. Also introduced a narrowed `ProbeConfigShape` type so tests can pass synthetic configs without materializing the full Config schema.
**Files modified:** `src/cutover/target-probe.ts`
**Commit:** 9574440

### [Rule 1 – Bug] Quieted comment-block parse errors (esbuild + oxc transformers)

**Found during:** Task 2 build + first vitest run
**Issue:** JSDoc comments containing literal glob patterns like `memory/**/*.md` and the literal regex `\"node:fs|readFile|...` parsed as code by esbuild/oxc. The build failed with `Unexpected "*"` and the test transform failed with `[PARSE_ERROR]`.
**Fix:** Rewrote the affected comment lines to natural language ("memory tree md files", "no fs/clock/env access — see Plan 92-02 verification block"). Documentation intent preserved; CI-level static-grep pins now live exclusively in this SUMMARY (which the regex doesn't traverse).
**Files modified:** `src/cutover/target-probe.ts`, `src/cli/commands/cutover-probe.ts`, `src/cutover/diff-engine.ts`
**Commit:** 9574440

### [Doc-only] Additive count = 5, not 4 (post-D-11)

The plan + 92-CONTEXT.md repeatedly says "4 additive + 4 destructive". Post-D-11 with `cron-session-not-mirrored` joining the destructive side, the destructive count became 4 — but the additive count was already 5 (missing-skill, missing-mcp, missing-memory-file, missing-upload, model-not-in-allowlist). The "4 additive" shorthand was a CONTEXT.md draft artifact pre-D-11. This SUMMARY documents the canonical 5+4=9 split.

### [Auto-add] Heuristic auth keyword list for mcp-credential-drift

**Trigger:** Rule 2 (auto-add missing critical functionality) — without an auth-shape detector the heuristic would fire on every "critical" MCP regardless of whether the failure relates to credentials.
**Action:** Hard-coded `AUTH_KEYWORDS = ["401", "403", "invalid_key", "invalid key", "auth", "unauthorized", "forbidden", "expired"]` inside `diff-engine.ts` with case-insensitive substring matching. First-pass; tightening to per-server fingerprinting deferred to Plan 92-05+.
**Commit:** 9574440

## Wiring for Plan 92-03 (additive applier)

Plan 92-03 reads `CUTOVER-GAPS.json` filtered to `severity: "additive"` and applies fixes via Phase 84 (skills) + Phase 86 (model allowlist) + Phase 91 (rsync staging for memory + uploads):

```ts
import type { AdditiveCutoverGap } from "../cutover/types.js";

for (const gap of gaps.filter((g) => g.severity === "additive")) {
  switch (gap.kind) {
    case "missing-skill":           /* Phase 84 migration pipeline */ break;
    case "missing-mcp":             /* Phase 86 updateAgentMcpServers */ break;
    case "missing-memory-file":     /* Phase 91 rsync */ break;
    case "missing-upload":          /* Phase 91 rsync */ break;
    case "model-not-in-allowlist":  /* Phase 86 updateAgentConfig */ break;
    default: assertNever(gap);  // compile-time exhaustiveness
  }
}
```

## Wiring for Plan 92-04 (destructive embed renderer)

Plan 92-04 reads `CUTOVER-GAPS.json` filtered to `severity: "destructive"` and emits an admin-clawdy ephemeral embed per gap with Accept/Reject/Defer buttons:

```ts
import type { DestructiveCutoverGap } from "../cutover/types.js";

for (const gap of gaps.filter((g) => g.severity === "destructive")) {
  switch (gap.kind) {
    case "outdated-memory-file":      /* diff-style file content embed */ break;
    case "mcp-credential-drift":      /* env-key-names + status embed */ break;
    case "tool-permission-gap":       /* ACL deny + tool list embed */ break;
    case "cron-session-not-mirrored": /* cron schedule + label embed (D-11) */ break;
    default: assertNever(gap);
  }
}
```

## Wiring for Plan 92-06 (production CLI)

`cutover probe` returns exit 1 when invoked without daemon-context DI (`loadConfigDep`, `listMcpStatusDep`, `readWorkspaceInventoryDep` all required). Plan 92-06 will wire:

- `runCutoverProbeAction({...loadConfigDep: () => loadConfig("clawcode.yaml")})`
- `listMcpStatusDep` via the IPC client + status-vocabulary mapper (Phase 85's "ready/degraded/failed/reconnecting/unknown" → the probe's "healthy/warning/critical/unknown")
- `readWorkspaceInventoryDep` via a `defaultReadWorkspaceInventory` helper that walks `<memoryRoot>/memory/` recursively, computes sha256 hashes via `node:crypto`, lists `<memoryRoot>/uploads/discord/`, and lists `<memoryRoot>/skills/` directory names

Both action functions are pure async + DI'd, mirroring Phase 91's `runSyncRunOnceAction(deps)` pattern.

## Static-Grep Regression Pins (verified)

| Pin | Status |
|-----|--------|
| `grep -q 'export type CutoverGap' src/cutover/types.ts` | OK |
| `grep -q 'export function assertNever' src/cutover/types.ts` | OK |
| `grep -q 'export function sortGaps' src/cutover/types.ts` | OK |
| `grep -q 'export const targetCapabilitySchema' src/cutover/types.ts` | OK |
| `grep -q 'AdditiveCutoverGap' src/cutover/types.ts` | OK |
| `grep -q 'DestructiveCutoverGap' src/cutover/types.ts` | OK |
| `grep -q 'export function diffAgentVsTarget' src/cutover/diff-engine.ts` | OK |
| `grep -q 'export async function probeTargetCapability' src/cutover/target-probe.ts` | OK |
| `grep -q 'registerCutoverProbeCommand' src/cli/commands/cutover.ts` | OK |
| `grep -q 'registerCutoverDiffCommand' src/cli/commands/cutover.ts` | OK |
| `! grep -E "from \"node:fs\|readFile\|writeFile\|new Date\|Math\\.random\|process\\.env" src/cutover/diff-engine.ts` | OK (pure) |
| `grep "Object.keys(entry.env" src/cutover/target-probe.ts` | OK (NO-LEAK) |
| `! grep -E 'agentCfg\\.mcpServers\\[.*\\]\\.env\\[' src/cutover/target-probe.ts` | OK (no env value access) |
| `! grep 'JSON.stringify.*env' src/cutover/target-probe.ts` | OK (env never serialized) |
| `grep -q 'assertNever(gap)' src/cutover/__tests__/diff-engine.test.ts` | OK |
| `grep -q 'sk_live_secret_42' src/cutover/__tests__/target-probe.test.ts` | OK (NO-LEAK sentinel) |
| `git diff package.json` empty | OK (zero new npm deps) |

## Self-Check: PASSED

Verified files exist and commits are present in git history:
- `src/cutover/types.ts` (extended) — present, 550 lines
- `src/cutover/diff-engine.ts` — present, 294 lines
- `src/cutover/target-probe.ts` — present, 323 lines
- `src/cutover/__tests__/diff-engine.test.ts` — present, 373 lines, 11 it-blocks
- `src/cutover/__tests__/target-probe.test.ts` — present, 228 lines, 5 it-blocks
- `src/cli/commands/cutover-probe.ts` — present, 119 lines
- `src/cli/commands/cutover-diff.ts` — present, 200 lines
- `src/cli/commands/cutover.ts` (modified) — registers probe + diff
- Commit addbc40 (Task 1 RED) — present in git log
- Commit 9574440 (Task 2 GREEN) — present in git log
- 35/35 cutover tests pass (`npx vitest run src/cutover/`)
- `npm run build` exits 0
- `node dist/cli/index.js cutover --help` lists ingest, profile, probe, diff
- `node dist/cli/index.js cutover probe --help` lists --agent, --output-dir
- `node dist/cli/index.js cutover diff --help` lists --agent, --input-dir, --output-dir, --profile, --capability
- `git diff package.json` empty (zero new npm deps)
- All static-grep regression pins green
