# Phase 96: Discord routing and file-sharing hygiene - Research

**Researched:** 2026-04-25
**Domain:** Filesystem capability probing + cross-workspace ACL access + file-sharing UX hygiene
**Confidence:** HIGH (the implementation surface mirrors Phase 94 verbatim — same heartbeat, same prompt-assembler, same ToolCallError, same auto-injection site, same atomic-state primitives. CONTEXT.md decisions are operator-locked and unambiguous; the planner's job is to translate them into the existing 7-plan-mirror shape.)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stale Capability Beliefs (Theme A) — D-01..D-04:**
- D-01: Probe schedule = boot + heartbeat (60s) + on-demand. No stale belief survives 60s.
- D-02: System prompt expression = `<filesystem_capability>` block with three subsections (My workspace / Operator-shared paths / Off-limits). Identical block renders in `/clawcode-status` and `clawcode fs-status`.
- D-03: Refresh trigger = both `/clawcode-probe-fs <agent>` Discord slash + `clawcode probe-fs <agent>` CLI + config-watcher (re-probe when `agents.*.fileAccess` or `defaults.fileAccess` changes). Both reuse `runFsProbe(agent, deps): Promise<FsProbeOutcome>`.
- D-04: Communication on changes = silent system-prompt re-render. No Discord post.

**Cross-Workspace File Access (Theme B) — D-05..D-08:**
- D-05: Declaration model = hybrid (yaml-declared candidates + probe verifies). Schema: `defaults.fileAccess` + `agents.*.fileAccess` (10th application of additive-optional schema blueprint). Declared-but-not-readable surfaces as `degraded` with message "configured but not accessible — check ACLs/group/systemd ProtectHome".
- D-06: Boundary check = cached probe snapshot + on-miss real `fs.access(path, R_OK)` check. Snapshot keyed by canonical absPath (resolved symlinks, no `..`). NO path-prefix `startsWith()`.
- D-07: System-prompt visibility = top-level summary + `clawcode_list_files({path, depth?, glob?})` auto-injected tool. Returns entries with name/type/size?/mtime?. Refuses paths outside cached snapshot. depth max 3, entries max 500.
- D-08: Out-of-allowlist refusal = ToolCallError (errorClass="permission") + alternative-agent suggestion via `findAlternativeFsAgents(absPath, fsStateProvider)`.

**File-Sharing UX Hygiene (Theme C) — D-09..D-12:**
- D-09: Output location = `agents.*.outputDir` template string (11th application). Tokens: `{date}` → YYYY-MM-DD, `{client_slug}` → from conversation context (LLM-filled), `{channel_name}` → Discord channel slug, `{agent}` → agent name. Anchored under agent workspace root. Path traversal blocked. Default `defaults.outputDir: "outputs/{date}/"`. fin-acquisition: `clients/{client_slug}/{date}/`.
- D-10: Auto-upload heuristic = response references file as artifact. System-prompt directive extends `defaults.systemPromptDirectives.file-sharing`. Post-turn check: if tool produced file path AND response matches `/here's|attached|generated|saved to|i (made|created|edited) .* (file|pdf|image|doc)/i` AND `clawcode_share_file` NOT called → log warning to admin-clawdy ("possible missed upload — operator review"). Soft signal, throttled.
- D-11: Sync architecture = read-from-source via ACL; deprecate Phase 91 mirror. Phase 96 disables 5-min systemd timer (`systemctl disable clawcode-sync-finmentum.timer`). Phase 91 sync code stays in repo for 7-day rollback. `sync-state.json.authoritative` set to "deprecated" with timestamp. `clawcode sync status` reports "deprecated — agents read source via ACL". Hourly conversation-turn translator STAYS (it's session→memory, not file mirror). Future agents: ACL by default.
- D-12: clawcode_share_file failure = ToolCallError with classification (size/missing/permission/transient). Extends Phase 94 D-06 ToolCallError. Per-class suggestions: size ("file is X MB; Discord limit is 25MB — compress or split"), missing ("file not found at /path/X — verify the path and re-run"), permission (D-08 verbatim), transient ("Discord upload failed (rate limit or 5xx) — retry in 30s").

**Migration & Acceptance — D-13..D-14:**
- D-13: In-flight session migration = auto-refresh on next heartbeat tick. No agent restart required. Stable-prefix hash changes once → one Anthropic cache miss per agent. Acceptable cost.
- D-14: Acceptance smoke test = Tara-PDF E2E in `#finmentum-client-acquisition`. Operator asks for Tara Maffeo financial worksheet → agent reads `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf` via ACL → calls `clawcode_share_file` → posts CDN URL. NO "not accessible from my side". NO OpenClaw fallback. Repeat for `tara-maffeo-speech-coaching-apr24.pdf`. UAT-95.

### Claude's Discretion

- Probe primitive shape: `runFsProbe(agent, deps): Promise<FsProbeOutcome>` — pure-DI; FsProbeOutcome 2-variant discriminated union (`{kind: "completed", snapshot, durationMs} | {kind: "failed", error}`).
- Snapshot shape: `Map<absPath, {status: 'ready' | 'degraded' | 'unknown', mode: 'rw' | 'ro' | 'denied', lastProbeAt, lastSuccessAt?, error?}>`. Persisted in `~/.clawcode/agents/<agent>/fs-capability.json` (atomic temp+rename).
- System-prompt assembly: new `<filesystem_capability>` block sits between Phase 94's `<tool_status>` and Phase 95's `<dream_log_recent>`. ~150 tokens typical for 2-3 paths.
- Pure-fn DI test strategy: Phase 94/95 idiom — runFsProbe, clawcode_list_files impl, findAlternativeFsAgents, resolveOutputDir all pure modules; production wires real fs/webhookManager at daemon edge.
- Phase 91 deprecation mechanics: `sync-state.json` `authoritative: "deprecated"` + `deprecatedAt: ISO`; `clawcode sync` subcommand surface unchanged; systemd timer disabled via `clawcode sync disable-timer` (idempotent; logs to ledger). 7-day rollback honored — `clawcode sync re-enable-timer` restores during window, errors after.
- Output-dir token resolution: `resolveOutputDir(template, ctx)` pure fn. `{client_slug}` LLM-filled via system-prompt directive; if absent, fall back to `unknown-client/` and log warning.
- Static-grep regression pin: every fs read/share site MUST go through `checkFsCapability(path, snapshot)` — single-source-of-truth boundary. CI grep ensures no direct `fs.readFile`/`fs.access` in tool implementations bypassing the check.
- Phase 92 verifier integration: cutover-time verifier reads filesystem capability snapshot (instead of running its own ACL check).
- clawcode_list_files token guard: depth max 3, entries max 500 per call. Glob via picomatch IF available else substring filter.
- Auto-upload soft-warning destination: admin-clawdy via Phase 94 alert primitive. Throttled (Phase 91 alert dedup).

### Deferred Ideas (OUT OF SCOPE)

- Discord routing — cross-workspace agent-to-agent messaging (revisit Phase 97+ if surfaces).
- Discord routing — channel→agent dispatch fixes / thread inheritance / webhook identity edge cases.
- Discord routing — skill-based handoff (Phase 94 D-07 left as text-only; real handoff too invasive for v2.7).
- LLM-side file-path hallucination prevention (beyond D-10 soft warning).
- Per-file granular probe (root-readable implies subtree-readable in practice).
- Probe-result caching across daemon restarts (premature optimization).
- Auto-update PR generation when fileAccess pattern fires repeatedly.
- Phase 91 conversation-turn translator deprecation (file mirror only, not session→memory translator).
- Bidirectional sync (Claw→Open).
- OpenClaw deprecation cliff date.
- Fleet-wide restart on deploy.
- clawcode_list_files glob via picomatch (substring fallback good enough for v1).
- Synthetic probe-only smoke test + generated-doc bidirectional test (only Tara-PDF E2E is canonical).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FS-01 (D-01) | Probe schedule: boot + 60s heartbeat + on-demand | `src/heartbeat/runner.ts` already has plug-in check shape (Phase 85 mcp-reconnect.ts:1-end is the template); add `src/heartbeat/checks/fs-probe.ts` alongside existing checks |
| FS-02 (D-02) | System-prompt `<filesystem_capability>` block | `src/manager/context-assembler.ts:894 lines` — block sits between `<tool_status>` (Phase 94) and `<dream_log_recent>` (Phase 95); pattern matches Phase 94 D-04 stable-prefix re-render |
| FS-03 (D-03) | `/clawcode-probe-fs` slash + `clawcode probe-fs` CLI + config-watcher trigger | `src/discord/slash-commands.ts` (8th inline-short-circuit application); `src/cli/commands/probe-fs.ts` (NEW, mirror Phase 94 mcp-probe pattern); `src/config/watcher.ts:143-145` — append `fileAccess` + `outputDir` to RELOADABLE_FIELDS |
| FS-04 (D-04) | Silent system-prompt update; expose via `/clawcode-status` Capability section | Existing `src/discord/status-render.ts` (Phase 93) — extend with capability block |
| FS-05 (D-05) | `agents.*.fileAccess` yaml schema (10th application) | `src/config/schema.ts:1373 lines` — same shape as `systemPromptDirectives` (lines 793, 841-846, 974-983, 1227-1232 reference); per-agent override + defaults block |
| FS-06 (D-06) | Cached snapshot + on-miss real check | New module `src/manager/fs-capability.ts` with `checkFsCapability(path, snapshot, deps)`; canonical absPath (no `..`, resolved symlinks via `node:path.resolve` + `node:fs.realpath`) |
| FS-07 (D-07) | `clawcode_list_files` auto-injected tool | `src/manager/session-config.ts:421` (the existing `clawcode_fetch_discord_messages` / `clawcode_share_file` auto-injection block from Phase 94 — extend with new tool); new module `src/manager/tools/clawcode-list-files.ts` |
| FS-08 (D-08) | ToolCallError (permission) + `findAlternativeFsAgents` | Reuse `src/manager/tool-call-error.ts` from Phase 94 (extend with no schema change — `errorClass: "permission"` already in 5-value enum); new module `src/manager/find-alternative-fs-agents.ts` mirroring Phase 94's `find-alternative-agents.ts` |
| FS-09 (D-09) | `agents.*.outputDir` template string + `resolveOutputDir(template, ctx)` | `src/config/schema.ts` 11th application; new pure module `src/manager/resolve-output-dir.ts`; `src/manager/tools/clawcode-share-file.ts` (Phase 94, 200+ lines) — extend the `path` resolution path |
| FS-10 (D-10) | Auto-upload heuristic + post-turn check + admin-clawdy soft warning | Extend `defaults.systemPromptDirectives.file-sharing` text in `src/config/schema.ts` `DEFAULT_SYSTEM_PROMPT_DIRECTIVES` (line 115); new post-turn checker (executor-level, likely `src/manager/turn-dispatcher.ts` or post-turn hook) |
| FS-11 (D-11) | Phase 91 mirror deprecation + 7-day rollback | `src/sync/sync-state-store.ts` (existing Phase 91 atomic state writer) — add `authoritative: "deprecated"` + `deprecatedAt` field; new CLI subcommands `clawcode sync disable-timer` / `re-enable-timer` in `src/cli/commands/sync.ts` (existing); systemd timer disable via `systemctl --user disable clawcode-sync-finmentum.timer` invocation |
| FS-12 (D-12) | clawcode_share_file 4-class failure classification | Extend `src/manager/tools/clawcode-share-file.ts` (Phase 94) — add classifyShareFileError(err) returning size/missing/permission/transient; reuse `src/manager/tool-call-error.ts` wrapMcpToolError |
| FS-13 (D-13) | Auto-refresh on next heartbeat tick | Implicit — no separate code; emerges from FS-01 + FS-02 wiring (heartbeat tick → probe → snapshot update → next prompt assembler call sees new state) |
| FS-14 (D-14) | Tara-PDF E2E acceptance test | Manual UAT-95; no code; documented in PHASE/VERIFICATION |

</phase_requirements>

## Summary

Phase 96 is a near-perfect mirror of Phase 94 applied to filesystem capability instead of MCP capability. Every primitive Phase 94 introduced — capability probe (94-01), stable-prefix filter (94-02), auto-recovery hooks (94-03), ToolCallError schema (94-04), auto-injected tools (94-05), system-prompt directives (94-06), display upgrade (94-07) — has a 1:1 analog in Phase 96. The planner does not need to design new architecture; it needs to *clone the Phase 94 shape* and re-aim it at `node:fs/promises.access` instead of MCP `callTool`.

**The key research finding:** Phase 94's 7-plan structure (capability primitive → filter/system-prompt block → auto-recovery → ToolCallError extension → auto-injected tools → defaults schema → display upgrade) maps cleanly onto Phase 96's 14 decisions, but with two structural differences:

1. **Phase 96 has no auto-recovery analog.** Filesystem capability changes are operator-driven (ACL edits via `setfacl`, group additions via `usermod`, systemd unit edits) — there's no equivalent of `npx playwright install chromium` the daemon could auto-run. Plan 94-03 has no Phase 96 sibling. Instead, Phase 96 adds a *Phase 91 deprecation surface* (D-11) which is operationally similar — modifying a long-running side-effect (the systemd timer) — but is a one-shot deploy step, not a heartbeat-driven recovery loop.

2. **Phase 96 has TWO new schema fields, not one.** Phase 94 added `defaults.systemPromptDirectives` (one field, 8th additive-optional application). Phase 96 adds BOTH `fileAccess` (10th) AND `outputDir` (11th). The planner can either fold them into one schema plan or split them — recommendation below is to fold into Plan 96-04 (the file-share extension plan) since `outputDir` is only meaningful in the share path, while `fileAccess` lives in the probe primitive plan (96-01).

**Primary recommendation:** Build a 7-plan structure mirroring Phase 94 with the wave structure adjusted for the actual dependencies. Wave 1 = primitives (probe, ToolCallError extension is no-op since the 5-value enum already covers permission/transient). Wave 2 = consumers (system-prompt block, list-files tool, share-file extension, schema). Wave 3 = operator surfaces (slash + CLI, deprecation, heartbeat scheduling).

**Critical operator-side note (researched live, environment-availability):** On THIS host (`workspace-coding` machine), the operator-side prerequisites listed in CONTEXT.md §specifics are NOT in place — there is no `clawcode` Linux user, the `/home/jjagpal/.openclaw/workspace-finmentum/` directory has only `group::rwx` ACL (no `clawcode:rwX` ACL entry), and there is no `clawcode` systemd unit. The Phase 96 production target is the `clawdy` server (per memory note `reference_clawcode_server.md`: clawdy host, /opt/clawcode install, systemd service). The Tara-PDF acceptance test (D-14) MUST run on clawdy, NOT on this dev box. The planner needs to flag this in 96-07 (deploy plan) so the verifier doesn't try to run the smoke test locally and fail spuriously.

## Standard Stack

### Core (already in package.json — zero new deps)

| Library | Version | Purpose | Why Standard for Phase 96 |
|---------|---------|---------|---------------------------|
| `node:fs/promises` (`fs.access`, `fs.realpath`, `fs.readdir`, `fs.stat`) | Node 22 LTS | POSIX read check, canonical-path resolution, directory listing for clawcode_list_files | Pure stdlib; no deps. `fs.access(path, fs.constants.R_OK)` is the canonical "can I read this?" probe. |
| `node:path` (`resolve`, `sep`, `basename`, `dirname`) | Node 22 LTS | Path canonicalization for snapshot keys (D-06), traversal-blocking for outputDir (D-09) | Already used by `src/manager/tools/clawcode-share-file.ts` |
| `zod` 4.3.6 | (existing) | Schema validation for fileAccess + outputDir (10th + 11th additive-optional applications) | Phase 83-94 idiom; pattern documented in `src/config/schema.ts` lines 115-1232 |
| `pino` 9.x | (existing) | Structured logging on probe diagnostics, Phase 91 deprecation events | Same logger Phase 91 sync-runner.ts uses |
| `croner` 10.0.1 | (existing) | NOT used directly in Phase 96; heartbeat tick (60s) is from `src/heartbeat/runner.ts:setInterval`, not croner | Documented to confirm we're NOT adding a new cron schedule |
| `discord.js` 14.26.2 | (existing) | EmbedBuilder for `/clawcode-probe-fs` reply + `/clawcode-status` Capability block | Already used in slash-commands.ts |
| `vitest` | (existing) | TDD harness for all new primitives | Established `src/manager/__tests__/<feature>.test.ts` shape per CONVENTIONS.md |

### Supporting (existing modules, NOT new)

| Module | Path | Purpose |
|--------|------|---------|
| Phase 94 `wrapMcpToolError` | `src/manager/tool-call-error.ts` | Reused verbatim for D-08 + D-12 (5-value ErrorClass already covers `permission` and `transient`) |
| Phase 94 `findAlternativeAgents` | `src/manager/find-alternative-agents.ts` | Pattern reused for `findAlternativeFsAgents` (parallel pure module) |
| Phase 91 atomic temp+rename writer | `src/sync/sync-state-store.ts` (atomic writer pattern, lines 75-160) | Reused for `fs-capability.json` writer |
| Phase 94 `clawcodeShareFile` | `src/manager/tools/clawcode-share-file.ts` (200+ lines, 25MB limit, allowedRoots, webhook→bot fallback) | Extended in 96-04 with outputDir resolution + classified failure |
| Phase 94 auto-injection site | `src/manager/session-config.ts:421-440` (NOT `src/manager/agent-bootstrap.ts` — that file does not exist; CONTEXT.md is wrong about this) | Extended in 96-03 with `clawcode_list_files` registration |
| Phase 22 config-watcher RELOADABLE_FIELDS | `src/config/watcher.ts:143-145` | Extended in 96-07 with `fileAccess` + `outputDir` |
| Phase 85 stable-prefix prompt assembler | `src/manager/context-assembler.ts:894 lines` | Extended in 96-02 with `<filesystem_capability>` block |
| Phase 93 `status-render.ts` | `src/discord/status-render.ts` | Extended in 96-05 with Capability section |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fs.access(path, R_OK)` for probe | `fs.stat(path)` + check mode bits | `fs.access` is the canonical POSIX read-check; `stat` gives more info but requires manual ACL interpretation. Use `access` for probe, `stat` only inside `clawcode_list_files` for size/mtime. |
| Path-prefix `startsWith()` for boundary | Canonical absPath via `path.resolve` + `fs.realpath` | D-06 explicitly forbids `startsWith()`. Use `realpath` to resolve symlinks to canonical absPath, then exact-match Map lookup. Phase 94's `clawcode-share-file.ts` `isPathInsideRoots` uses `startsWith(root + sep)` — Phase 96 D-06 says NO; the planner needs to call out that the outputDir path-anchoring in 96-04 keeps the existing `isPathInsideRoots` pattern (since outputDir resolves WITHIN agent workspace root, no symlink concern), but the cross-workspace `fileAccess` check in 96-01 uses canonical-absPath Map lookup. Two boundary-check patterns coexist. |
| `picomatch` for glob filter in clawcode_list_files | Substring filter (`name.includes(glob)`) | CONTEXT.md "Claude's Discretion" specifies: "Glob via `picomatch` if available in deps; else simple substring filter." Verified: `picomatch` is NOT in package.json. Substring fallback per CLAUDE.md zero-new-deps invariant. |
| Adding new heartbeat infrastructure | Reuse `src/heartbeat/runner.ts` plug-in pattern | runner.ts:1-361 shows `setInterval(runChecks, intervalMs)` structure; new check files in `src/heartbeat/checks/` are auto-discovered (per `src/heartbeat/discovery.ts` per STRUCTURE.md). Add `src/heartbeat/checks/fs-probe.ts` and the runner picks it up. |

**Installation:** None. All dependencies are existing.

**Version verification:** All listed packages were verified present in package.json during Phase 94 (shipped 2026-04-25, three days ago). No drift expected.

## Architecture Patterns

### Recommended Module Structure (NEW files only)

```
src/
├── manager/
│   ├── fs-probe.ts                          # NEW — runFsProbe primitive (pure DI)
│   ├── fs-capability.ts                     # NEW — checkFsCapability boundary check (single-source-of-truth)
│   ├── fs-snapshot-store.ts                 # NEW — atomic temp+rename for fs-capability.json
│   ├── find-alternative-fs-agents.ts        # NEW — pure parallel of find-alternative-agents.ts
│   ├── resolve-output-dir.ts                # NEW — pure token resolver for outputDir
│   ├── tools/
│   │   └── clawcode-list-files.ts           # NEW — auto-injected directory listing tool
│   └── __tests__/
│       ├── fs-probe.test.ts
│       ├── fs-capability.test.ts
│       ├── fs-snapshot-store.test.ts
│       ├── find-alternative-fs-agents.test.ts
│       ├── resolve-output-dir.test.ts
│       └── clawcode-list-files.test.ts
├── heartbeat/
│   └── checks/
│       └── fs-probe.ts                      # NEW — heartbeat check that calls runFsProbe + persists
├── cli/
│   └── commands/
│       ├── probe-fs.ts                      # NEW — clawcode probe-fs <agent> [--diff]
│       └── fs-status.ts                     # NEW — clawcode fs-status -a <agent>
└── prompt/
    └── filesystem-capability-block.ts       # NEW (or inline in context-assembler.ts) — pure renderer
```

### Files MODIFIED (not new)

```
src/
├── config/
│   ├── schema.ts                            # +fileAccess +outputDir +DEFAULT_SYSTEM_PROMPT_DIRECTIVES.file-sharing.text update
│   ├── loader.ts                            # +resolveFileAccess +resolveOutputDir helpers
│   └── watcher.ts                           # RELOADABLE_FIELDS += fileAccess, outputDir
├── manager/
│   ├── context-assembler.ts                 # +<filesystem_capability> block insertion (between <tool_status> and <dream_log_recent>)
│   ├── session-config.ts                    # +clawcode_list_files in auto-injection block (line 421)
│   ├── persistent-session-handle.ts         # +getFsCapabilitySnapshot / setFsCapabilitySnapshot lazy-init pair
│   ├── tools/
│   │   └── clawcode-share-file.ts           # +outputDir resolution + classified failure (size/missing/permission/transient)
│   ├── turn-dispatcher.ts                   # +post-turn missed-upload soft-warning check (D-10)
│   └── daemon.ts                            # +probe-fs IPC + +list-fs-status IPC + +sync disable-timer / re-enable-timer IPC handlers
├── discord/
│   ├── slash-commands.ts                    # +/clawcode-probe-fs handler + extend /clawcode-status with Capability section
│   └── status-render.ts                     # +renderCapabilityBlock pure renderer (Phase 93 module)
├── sync/
│   ├── sync-state-store.ts                  # +authoritative: "deprecated" + deprecatedAt field
│   └── sync-runner.ts                       # +deprecation gate (run-once errors with "deprecated, use ACL read")
└── cli/
    └── commands/
        └── sync.ts                          # +disable-timer +re-enable-timer subcommands
```

### Pattern 1: runFsProbe primitive (DI-pure, mirrors Phase 94 probeMcpCapability)

**What:** Pure function that probes a list of paths via `fs.access(path, R_OK)` with per-path 5s timeout, returns a snapshot Map.

**When to use:** Boot, every heartbeat tick (60s), on-demand via `/clawcode-probe-fs` slash + `clawcode probe-fs` CLI.

**Example:**
```typescript
// Source: mirror of src/manager/capability-probe.ts (Phase 94 plan 01)

import type { Logger } from "pino";

export type FsCapabilityStatus = "ready" | "degraded" | "unknown";
export type FsCapabilityMode   = "rw" | "ro" | "denied";

export interface FsCapabilitySnapshot {
  readonly status: FsCapabilityStatus;
  readonly mode: FsCapabilityMode;
  readonly lastProbeAt: string;       // ISO8601
  readonly lastSuccessAt?: string;
  readonly error?: string;            // verbatim from fs.access — Phase 85 TOOL-04 inheritance
}

export type FsProbeOutcome =
  | { readonly kind: "completed"; readonly snapshot: ReadonlyMap<string, FsCapabilitySnapshot>; readonly durationMs: number }
  | { readonly kind: "failed"; readonly error: string };

export const FS_PROBE_TIMEOUT_MS = 5_000;        // D-01: 5s per path

export interface FsProbeDeps {
  readonly fsAccess: (path: string, mode: number) => Promise<void>;     // wraps node:fs/promises.access
  readonly fsConstants: { readonly R_OK: number; readonly W_OK: number };
  readonly realpath: (path: string) => Promise<string>;                 // canonical-path resolution (D-06)
  readonly now?: () => Date;
  readonly log: Logger;
}

export async function runFsProbe(
  paths: readonly string[],
  deps: FsProbeDeps,
  prevSnapshot?: ReadonlyMap<string, FsCapabilitySnapshot>,
): Promise<FsProbeOutcome>;
```

### Pattern 2: `<filesystem_capability>` system-prompt block (mirrors Phase 94 D-04)

**What:** Stable-prefix prompt block that re-renders on every snapshot change. LLM reasons about RW vs RO.

**Where:** `src/manager/context-assembler.ts` — between `<tool_status>` block (Phase 94) and `<dream_log_recent>` block (Phase 95).

**Example:**
```typescript
// Source: mirror of context-assembler.ts (Phase 94 plan 02 + Phase 95 plan 01)

export function renderFilesystemCapabilityBlock(
  snapshot: ReadonlyMap<string, FsCapabilitySnapshot>,
  agentWorkspaceRoot: string,
): string {
  const myWorkspace: string[] = [];
  const operatorShared: string[] = [];
  const offLimits: string[] = [];

  for (const [absPath, state] of snapshot) {
    if (state.status !== "ready") continue;
    if (absPath.startsWith(agentWorkspaceRoot)) {
      myWorkspace.push(`- ${absPath} (full RW)`);
    } else if (state.mode === "ro") {
      operatorShared.push(`- ${absPath} (RO, ACL)`);
    }
  }

  // Off-limits is a single line — paths NOT in snapshot are off-limits by default.
  return [
    "<filesystem_capability>",
    "## My workspace (full RW)",
    ...myWorkspace,
    "",
    "## Operator-shared paths (per ACL)",
    ...operatorShared,
    "",
    "## Off-limits — do not attempt",
    "- Anything outside the above.",
    "</filesystem_capability>",
  ].join("\n");
}
```

### Pattern 3: Single-source-of-truth boundary check (D-06)

**What:** Every fs read site MUST go through `checkFsCapability(path, snapshot, deps)`. Static-grep regression pin enforces no direct `fs.readFile`/`fs.access` in tool implementations.

**Example:**
```typescript
// src/manager/fs-capability.ts (NEW)

export async function checkFsCapability(
  rawPath: string,
  snapshot: ReadonlyMap<string, FsCapabilitySnapshot>,
  deps: { fsAccess: (path: string, mode: number) => Promise<void>; realpath: (path: string) => Promise<string>; fsConstants: { R_OK: number } },
): Promise<{ allowed: true; canonicalPath: string; mode: FsCapabilityMode } | { allowed: false; reason: string }> {
  // Canonical path: resolve + realpath (handles symlinks)
  let canonical: string;
  try {
    canonical = await deps.realpath(rawPath);
  } catch {
    canonical = rawPath;  // path doesn't exist — caller decides
  }

  // Fast path: cached snapshot lookup
  const cached = snapshot.get(canonical);
  if (cached?.status === "ready") {
    return { allowed: true, canonicalPath: canonical, mode: cached.mode };
  }

  // On-miss: live fs.access check
  try {
    await deps.fsAccess(canonical, deps.fsConstants.R_OK);
    return { allowed: true, canonicalPath: canonical, mode: "ro" };  // assume RO; promotion to RW requires explicit fileAccess declaration
  } catch (err) {
    return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
```

### Anti-Patterns to Avoid

- **Path-prefix `startsWith()` for cross-workspace boundary check.** D-06 explicitly forbids it. Use canonical-absPath Map lookup. (NOTE: outputDir anchoring under agent workspace root in 96-04 still uses `startsWith()` — that's a different concern, contained within agent workspace, no symlink risk.)
- **Caching probe results across daemon restarts.** Phase 96 deferred-idea — re-probe on cold start. Don't optimize prematurely.
- **Auto-recovery loops for filesystem capability.** No analog to `npx playwright install`. Filesystem capability changes are operator-driven; the system surfaces the failure (snapshot status="degraded" + error message) and the operator fixes it (setfacl, usermod, systemctl edit).
- **Calling runFsProbe from a hot turn-dispatch path.** Boot + heartbeat + on-demand only. Per-turn calls add 5s × N-paths latency.
- **Adding a 6th status value beyond `ready | degraded | unknown`.** D-CONTEXT specifies 3 values for fs (vs Phase 94's 5). Plan budget doesn't allow drift.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic JSON state file write | Manual `fs.writeFile` + signal handling | Phase 91 atomic temp+rename pattern from `src/sync/sync-state-store.ts` (lines 75-160 verbatim) | Already battle-tested across Phase 83/86/89/90/91/94/95; handles partial-write crash recovery |
| Discriminated-union outcome | Tagged union by hand | Phase 84/86/88/90/92/94/95 idiom — `kind: "completed" \| "failed"` 2-variant | Compile-time exhaustive-switch via `assertNever`; consistent across project |
| Verbatim error pass-through | Wrap fs errors in custom classes | Phase 85 TOOL-04 pattern — pass `err.message` straight through to snapshot.error and ToolCallError.message | Operators need raw POSIX error strings (e.g., "EACCES: permission denied"); custom wrapping breaks `getfacl` debugging |
| Cross-agent alternative lookup | Per-tool ad-hoc query | `findAlternativeFsAgents(absPath, fsStateProvider)` — pure parallel of Phase 94's `findAlternativeAgents` (verbatim copy + s/capabilityProbe/fsCapabilityProbe/) | Symmetric to Phase 94 D-07; tests pin the same shape |
| ToolCallError shape for fs failures | New error class | Reuse Phase 94 `wrapMcpToolError` from `src/manager/tool-call-error.ts` — 5-value enum already covers `permission` (D-08) and `transient` (D-12); `unknown` covers `size`/`missing` if you don't want a 6th class | D-12 specifies 4 sub-classes (size/missing/permission/transient) but the 5-value Phase 94 ErrorClass enum is the contract; map size/missing → `unknown` with rich `suggestion` field, OR introduce a 6th enum value with explicit STATE.md decision (recommend the former — keeps 5-value enum locked) |
| Stable-prefix re-render on capability change | Force-restart agent | Phase 94 D-04 pattern — next turn's prompt assembler reads fresh snapshot; one Anthropic cache miss; cache re-stabilizes | D-13 explicit: "auto-refresh on next heartbeat tick. No agent restart required." |
| Configurable hot-reload for fileAccess + outputDir | Manual SIGHUP handling | `src/config/watcher.ts:RELOADABLE_FIELDS` extension (Phase 22 hot-reload) | Already wired; just append two field names |
| Path canonicalization | String manipulation | `node:path.resolve` + `node:fs/promises.realpath` | Realpath handles symlinks; resolve handles `..` and absolute/relative |
| Substring glob fallback | Manual glob impl | `name.includes(globString)` if `picomatch` not in deps (it isn't) | Phase 96 deferred-idea: full glob; v1 substring is sufficient |
| Phase 91 deprecation rollback semantics | New rollback machinery | Existing Phase 91 7-day window + `clawcode sync re-enable-timer` (mirror `clawcode sync set-authoritative ... --revert-cutover`) | Already implemented in Phase 91 plan 06 finalize semantics |

**Key insight:** Phase 96 introduces ~6-8 new pure modules (fs-probe, fs-capability, fs-snapshot-store, find-alternative-fs-agents, resolve-output-dir, clawcode-list-files, fs-probe heartbeat check, optional render module) but ZERO new architectural patterns. Every new module clones a Phase 94/91/85 sibling.

## Common Pitfalls

### Pitfall 1: agent-bootstrap.ts does not exist
**What goes wrong:** CONTEXT.md §code_context lines 213, 215 reference `src/manager/agent-bootstrap.ts` as the auto-injection site. That file does NOT exist.
**Why it happens:** CONTEXT.md was authored from memory of Phase 94 plans, but Phase 94 plan 05 (94-05-PLAN.md lines 311, 415) actually wires the auto-injection into `src/manager/session-config.ts:421` (verified — the imports for `CLAWCODE_FETCH_DISCORD_MESSAGES_DEF` and `CLAWCODE_SHARE_FILE_DEF` are at lines 58-59).
**How to avoid:** The planner MUST treat `src/manager/session-config.ts:421-440` as the auto-injection site, NOT `src/manager/agent-bootstrap.ts`. Plan 96-03 (clawcode_list_files) extends session-config.ts.
**Warning signs:** Any plan that says "extend src/manager/agent-bootstrap.ts" — that file doesn't exist; ENOENT will be the first failure.

### Pitfall 2: Phase 96 production environment is on `clawdy`, not this dev box
**What goes wrong:** D-14 Tara-PDF acceptance test assumes (a) `clawcode` user exists, (b) `clawcode:rwX` ACL on `/home/jjagpal/.openclaw/workspace-finmentum/`, (c) `clawcode` systemd unit relaxed (no `ProtectHome=tmpfs`). On THIS host (`workspace-coding`), none of these are true: `id clawcode` returns "no such user", `getfacl /home/jjagpal/.openclaw/workspace-finmentum/` shows only group::rwx with no user-named ACL, and there's no `clawcode` systemd unit.
**Why it happens:** The production target is the `clawdy` server (per `~/.claude/projects/.../memory/MEMORY.md` — `reference_clawcode_server.md` documents clawdy host, /opt/clawcode install, systemd service). The Tara-PDF files DO exist locally at `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/` (verified 7 PDFs/files including `tara-maffeo-financial-worksheet-apr24.pdf` and `tara-maffeo-speech-coaching-apr24.pdf`), but the agent that needs to read them runs on clawdy.
**How to avoid:** Plan 96-07 (deploy/heartbeat scheduling) MUST flag that D-14 acceptance runs on clawdy (clawdy has the user/ACL/systemd state); the verifier should NOT attempt local execution. Document the deploy procedure in 96-07-PLAN.md including the SSH/runbook step to validate clawdy-side prerequisites BEFORE running smoke test.
**Warning signs:** Tests that try to `fs.access('/home/jjagpal/.openclaw/workspace-finmentum/')` from the dev box may pass (jjagpal owns it) but the resulting snapshot would NOT match what the production clawcode user sees.

### Pitfall 3: D-12 four sub-classes vs. Phase 94's locked 5-value ErrorClass enum
**What goes wrong:** D-12 says clawcode_share_file failure has 4 errorClass values: `size | missing | permission | transient`. But Phase 94 ErrorClass enum is locked at 5 values (`transient | auth | quota | permission | unknown`) per `src/manager/tool-call-error.ts` static-grep pin.
**Why it happens:** D-12 looks like it's introducing 4 file-share-specific errorClasses, but `permission` and `transient` already exist in the Phase 94 enum, and `size`/`missing` map naturally to `unknown` (with rich `suggestion` field) without enum drift.
**How to avoid:** Plan 96-04 (clawcode_share_file extension) uses the Phase 94 enum verbatim. Map `size` → `unknown` with suggestion "file is X MB; Discord limit is 25MB — compress or split". Map `missing` → `unknown` with suggestion "file not found at /path/X — verify the path and re-run". `permission` and `transient` use the existing enum values directly. NO new errorClass values introduced. Confirm with `grep -c "transient\|auth\|quota\|permission\|unknown" src/manager/tool-call-error.ts` ≥ 5.
**Warning signs:** Any plan-04 task that adds `size: ...` or `missing: ...` directly to the ErrorClass union — this would cascade through 94-05 + 94-07 consumers and break the Phase 94 contract.

### Pitfall 4: `<filesystem_capability>` block ordering breaks Phase 94/95 cache stability
**What goes wrong:** D-CONTEXT specifies the new block sits between `<tool_status>` (Phase 94) and `<dream_log_recent>` (Phase 95). If inserted in the wrong position, the stable-prefix hash changes for ALL agents on Phase 96 deploy, causing fleet-wide cache misses on subsequent turns.
**Why it happens:** Stable-prefix order is the cache-key contract; insertion order matters for hash stability.
**How to avoid:** Plan 96-02 (system-prompt block) reads `src/manager/context-assembler.ts` first to identify the EXACT insertion point. Existing Phase 94 + 95 markers (`<tool_status>` literal, `<dream_log_recent>` literal) bookend the insertion. Pin via static-grep test: insertion is between those two literals.
**Warning signs:** Test failures in Phase 94/95 prompt-cache stability tests after Phase 96 deploy. If 95 has a "stable prefix unchanged for empty dream-log" test, it should still pass after 96 (Phase 96 block is empty when fileAccess is empty/legacy config).

### Pitfall 5: Phase 91 deprecation rollback window timing collision
**What goes wrong:** D-11 says Phase 91 sync code stays for 7-day rollback. But Phase 91 ALSO has its own 7-day window for cutover rollback (per `91-CONTEXT.md` D-19, D-20). If Phase 96 deploys WHILE Phase 91 is still in its own 7-day cutover-rollback window, the operator could `clawcode sync re-enable-timer` (Phase 96 surface) AND `clawcode sync set-authoritative openclaw --revert-cutover` (Phase 91 surface) — these are different rollback semantics on the same `sync-state.json` file.
**Why it happens:** Phase 91's `authoritative` field is a 2-value enum (`openclaw | clawcode`); Phase 96 introduces a 3rd value (`deprecated`). State machine transitions need careful handling: deprecated → openclaw (Phase 96 re-enable) and deprecated → openclaw (Phase 91 revert-cutover) look identical from outside but have different ledger entries.
**How to avoid:** Plan 96-06 (Phase 91 deprecation surface) MUST extend the `authoritative` enum to 3 values (`"openclaw" | "clawcode" | "deprecated"`), update the Zod schema in `src/sync/sync-state-store.ts`, and ensure `clawcode sync re-enable-timer` only succeeds within the 7-day Phase 96 deprecation window (read `deprecatedAt` field, compare to `now`). Phase 91's `--revert-cutover` is a separate command path; test that both can coexist.
**Warning signs:** Schema validation errors on `sync-state.json` after Phase 96 deploy if the Zod schema isn't updated; existing Phase 91 finalize tests may fail.

### Pitfall 6: Per-agent fs-capability.json snapshot concurrency
**What goes wrong:** Heartbeat tick runs probe → writes `fs-capability.json` via atomic temp+rename. SIMULTANEOUSLY, an on-demand `clawcode probe-fs <agent>` invocation also runs probe → writes the same file. The second writer wins (atomic temp+rename guarantees no torn writes), but operator's manual probe could be SHADOWED by a heartbeat tick that happens 100ms later, returning a stale snapshot to the CLI invocation.
**Why it happens:** No locking primitive. Phase 91 `sync-state-store.ts` uses atomic temp+rename but doesn't guard against concurrent writers — it accepts last-writer-wins semantics.
**How to avoid:** Document the last-writer-wins semantics in Plan 96-01 (probe primitive) — both heartbeat and on-demand calls produce snapshots; the more recent `lastProbeAt` ISO timestamp wins on read. The CLI returns the snapshot it produced (in-memory), independent of what eventually gets persisted. Concurrent writes are not a correctness issue; they're an observability nuance.
**Warning signs:** Operator runs `clawcode probe-fs fin-acquisition`, sees output X, then immediately runs `clawcode fs-status -a fin-acquisition` and sees output Y (heartbeat tick fired between calls). Both are correct snapshots at different timestamps.

### Pitfall 7: D-13 heartbeat-driven refresh leaves a 60s window of stale belief
**What goes wrong:** Operator runs `setfacl -m u:clawcode:rwX /home/jjagpal/.openclaw/workspace-finmentum/`. Agent currently has snapshot saying `degraded` for that path. Within 60s, heartbeat re-probes and updates to `ready`. But during that 60s window, if a user asks for the file, the agent will (still) say "not accessible".
**Why it happens:** D-13 chose 60s heartbeat as the refresh boundary. The on-demand probe (D-03) is the operator's escape hatch — `/clawcode-probe-fs <agent>` after the ACL change forces immediate refresh.
**How to avoid:** Plan 96-05 (slash + CLI surfaces) MUST document the operator workflow: after any ACL/group/systemd change, IMMEDIATELY run `/clawcode-probe-fs <agent>` to force re-probe BEFORE asking the user to retry. Add this to deploy-runbook in 96-07. The operator-runbook is the human-side mitigation; the technical mitigation (sub-1s detection via inotify) is deferred per "Discord routing inotify" defer.
**Warning signs:** During UAT-95 Tara-PDF test, if operator forgets to run `/clawcode-probe-fs` after confirming ACL is in place, the 1st test attempt may still fail (60s stale window). 2nd attempt 60+ seconds later succeeds. This is by design but confusing if undocumented.

## Runtime State Inventory

> Phase 96 deploys via daemon redeploy + clawcode.yaml edit. NOT a rename or refactor. This section is included because the **Phase 91 deprecation surface** (D-11) modifies multiple runtime systems beyond code: systemd timer, sync-state.json, `clawcode sync` CLI ledger.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.clawcode/manager/sync-state.json` (Phase 91 — `authoritative` field changes from `"openclaw"` to `"deprecated"` + new `deprecatedAt` ISO field). `~/.clawcode/agents/<agent>/fs-capability.json` (Phase 96 NEW — per-agent atomic-write JSON). | **Schema migration:** Plan 96-06 updates Phase 91's Zod schema to 3-value enum. **NEW state file:** Plan 96-01 introduces fs-capability.json — atomic temp+rename, schema-validated on read with graceful null fallback (Phase 91 pattern). |
| Live service config | clawcode.yaml: `defaults.fileAccess` + `agents.*.fileAccess` + `defaults.outputDir` + `agents.*.outputDir` (NEW fields). Phase 91 systemd timer: `clawcode-sync-finmentum.timer` (DISABLED via `systemctl --user disable`). | **Config edit:** documented in 96-07 deploy procedure. **Timer disable:** new CLI subcommand `clawcode sync disable-timer` invokes `systemctl --user disable clawcode-sync-finmentum.timer` via execFile. Idempotent — running twice is a no-op. |
| OS-registered state | systemd user unit `clawcode-sync-finmentum.timer` (Phase 91; clawdy host only) — disabled via Phase 96. systemd user unit `clawcode.service` (clawdy daemon) — NOT touched by Phase 96 (no service-file edits required; daemon redeploys via existing `systemctl --user restart clawcode` runbook step). | **Timer disable:** one-shot at deploy time. **Re-enable path:** within 7-day window, `clawcode sync re-enable-timer` invokes `systemctl --user enable --now clawcode-sync-finmentum.timer`. |
| Secrets/env vars | None — Phase 96 introduces no new secrets. Existing SSH key for Phase 91 rsync stays in place during 7-day rollback window. | None. |
| Build artifacts / installed packages | `dist/` rebuilds on Phase 96 deploy. NO install path changes. NO new node_modules entries (zero new npm deps). | Standard build/redeploy. |

**Nothing found in category Secrets/env vars:** Phase 96 is purely code + config + state-file additive; no env or secret changes.

## Environment Availability

> Phase 96 has external dependencies: filesystem ACLs, Linux user/group state, systemd. This section probes the THIS host (`workspace-coding` dev machine) and flags the production-target environment (`clawdy`) where prerequisites must be verified manually before D-14 acceptance.

| Dependency | Required By | Available on this host | Version | Available on clawdy | Fallback |
|------------|------------|------------------------|---------|---------------------|----------|
| Node.js 22 LTS | Daemon | ✓ | (existing project) | ✓ (per memory note) | — |
| `node:fs/promises.access` (POSIX R_OK check) | runFsProbe primitive (96-01) | ✓ | stdlib | ✓ | — |
| `node:fs/promises.realpath` (canonical path) | checkFsCapability boundary (96-01) | ✓ | stdlib | ✓ | — |
| `getfacl` / `setfacl` / `usermod` (operator-side ACL setup) | D-14 acceptance prerequisites | ✓ (`getfacl` returns "no clawcode ACL") | (system tools) | ✓ (per CONTEXT.md operator confirmed) | None — operator MUST verify on clawdy before D-14 smoke test |
| Linux user `clawcode` | Phase 96 production agent runs as this user | ✗ (no such user on dev box) | — | ✓ (per memory note: clawdy systemd EnvironmentFile path) | None on dev box; not blocking — test fixture uses jjagpal user; production tests on clawdy |
| systemd user manager (`systemctl --user`) | Phase 91 timer disable (96-06) | likely ✓ but irrelevant on dev box | — | ✓ (clawdy production) | None — operator runs `clawcode sync disable-timer` only on clawdy |
| `clawcode-sync-finmentum.timer` systemd unit | Phase 91 mirror sync (being deprecated) | ✗ (only exists on clawdy) | — | ✓ | None — Phase 96 disables it; if absent (e.g., never set up), the disable is a no-op error and Phase 96 logs warning |
| Discord bot token + plugin | All Discord slash + auto-upload | ✓ (existing Phase 1.6 + Phase 90.1 wiring) | — | ✓ | bot-direct fallback (Phase 90.1) |

**Missing dependencies with no fallback:**
- None on the production target (clawdy). All Phase 96 prerequisites (clawcode user, ACL, systemd unit) are operator-confirmed in CONTEXT.md §specifics — but verification on clawdy MUST happen at deploy time, not assumed.

**Missing dependencies with fallback:**
- On THIS dev box, `clawcode` user + ACL + systemd unit are absent — but irrelevant; Phase 96 development uses test fixtures, not real clawcode user/ACL.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (per CONVENTIONS.md, project-wide) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/<feature>/__tests__/<feature>.test.ts --reporter=dot` |
| Full suite command | `npx vitest run --reporter=dot` |

### Phase Requirements → Test Map (8 dimensions per CONTEXT.md §additional_context)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| Dim 1 (FS-01, FS-05) | **Capability probe correctness** — given a fileAccess config, runFsProbe produces correct snapshot (ready when path readable; degraded when fileAccess declares but probe fails) | unit | `npx vitest run src/manager/__tests__/fs-probe.test.ts -x` | ❌ Wave 0 (NEW: src/manager/__tests__/fs-probe.test.ts) |
| Dim 2 (FS-02) | **System-prompt rendering** — capability block matches snapshot state (My workspace lines, Operator-shared lines, Off-limits stub); empty when snapshot empty | unit | `npx vitest run src/manager/__tests__/context-assembler-fs-block.test.ts -x` | ❌ Wave 0 (NEW: extend or new test file) |
| Dim 3 (FS-06, FS-07, FS-08) | **Boundary check enforcement** — out-of-allowlist reads/shares refuse with errorClass=permission; in-allowlist succeed; canonical path resolution; on-miss real fs.access fallback | unit | `npx vitest run src/manager/__tests__/fs-capability.test.ts src/manager/__tests__/clawcode-list-files.test.ts -x` | ❌ Wave 0 (NEW: 2 new test files) |
| Dim 4 (FS-13) | **Heartbeat refresh propagation** — operator ACL change reflected in next prompt within 60s (simulated: snapshot Map mutates, next assembler render contains updated state) | integration | `npx vitest run src/heartbeat/checks/__tests__/fs-probe.test.ts -x` | ❌ Wave 0 (NEW: heartbeat integration test) |
| Dim 5 (FS-07, FS-09) | **Tool surface integration** — clawcode_list_files auto-injected at session-config.ts:421; clawcode_share_file outputDir-aware; both tools produce correct results given a snapshot | integration | `npx vitest run src/manager/__tests__/clawcode-list-files.test.ts src/manager/__tests__/clawcode-share-file.test.ts src/manager/__tests__/session-config.test.ts -x` | ⚠️ Partial Wave 0 (extend existing clawcode-share-file.test.ts; NEW for clawcode-list-files) |
| Dim 6 (FS-03) | **Discord/CLI parity** — `/clawcode-probe-fs` and `clawcode probe-fs` produce identical snapshot (both call same `runFsProbe` primitive) | integration | `npx vitest run src/discord/__tests__/slash-commands-probe-fs.test.ts src/cli/commands/__tests__/probe-fs.test.ts -x` | ❌ Wave 0 (NEW: 2 new test files; mirror Phase 94 `slash-commands-tools.test.ts` + `mcp-status.test.ts` cross-renderer parity test) |
| Dim 7 (FS-11) | **Phase 91 deprecation surface** — `clawcode sync run-once` errors with deprecation message; `clawcode sync status` reports deprecated; `clawcode sync re-enable-timer` within 7-day window restores; after window errors with hint | integration | `npx vitest run src/sync/__tests__/sync-state-store-deprecation.test.ts src/cli/commands/__tests__/sync.test.ts -x` | ❌ Wave 0 (NEW: extend existing sync-state-store.test.ts and sync.test.ts) |
| Dim 8 (FS-14) | **End-to-end Tara-PDF acceptance** — operator can ask in finmentum-client-acquisition, agent reads ACL path, uploads via clawcode_share_file, returns CDN URL | e2e (UAT, manual on clawdy) | UAT-95 — operator-driven smoke test in `#finmentum-client-acquisition` Discord channel post-deploy | N/A (manual; documented in 96-07 deploy plan) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/<feature>/__tests__/<feature>.test.ts --reporter=dot` (the specific test file the task touches)
- **Per wave merge:** `npx vitest run --reporter=dot` (full suite green before next wave)
- **Phase gate:** Full suite green + UAT-95 manual smoke test passed on clawdy before `/gsd:verify-work`

### Wave 0 Gaps (NEW test files needed before implementation)
- [ ] `src/manager/__tests__/fs-probe.test.ts` — covers FS-01, FS-05 (TDD for runFsProbe primitive)
- [ ] `src/manager/__tests__/fs-capability.test.ts` — covers FS-06 (boundary check)
- [ ] `src/manager/__tests__/fs-snapshot-store.test.ts` — covers atomic temp+rename for fs-capability.json
- [ ] `src/manager/__tests__/find-alternative-fs-agents.test.ts` — covers FS-08 alternative-agent lookup
- [ ] `src/manager/__tests__/clawcode-list-files.test.ts` — covers FS-07 auto-injected listing tool
- [ ] `src/manager/__tests__/resolve-output-dir.test.ts` — covers FS-09 token resolver
- [ ] `src/manager/__tests__/context-assembler-fs-block.test.ts` (or extend existing context-assembler-directives.test.ts) — covers FS-02 prompt block
- [ ] `src/heartbeat/checks/__tests__/fs-probe.test.ts` — covers FS-13 heartbeat refresh
- [ ] `src/discord/__tests__/slash-commands-probe-fs.test.ts` — covers FS-03 Discord slash
- [ ] `src/cli/commands/__tests__/probe-fs.test.ts` (or `fs-status.test.ts`) — covers FS-03 CLI parity
- [ ] `src/sync/__tests__/sync-state-store-deprecation.test.ts` (or extend existing sync-state-store.test.ts) — covers FS-11 deprecated authoritative state
- [ ] No new framework install needed — vitest already wired

## Code Examples

Verified patterns from existing project sources:

### Pattern A: heartbeat check plug-in shape (Phase 85 mcp-reconnect.ts mirror)
```typescript
// src/heartbeat/checks/fs-probe.ts (NEW; mirror of mcp-reconnect.ts)
// Source: src/heartbeat/checks/mcp-reconnect.ts (Phase 85; Phase 94 plan 01 extended)

import { runFsProbe } from "../../manager/fs-probe.js";
// import other deps...

export const fsProbeCheck: CheckModule = {
  name: "fs-probe",
  intervalMs: 60_000,                       // D-01: 60s, same as MCP probe
  async tick(deps) {
    for (const agent of deps.listAgents()) {
      const cfg = deps.getResolvedConfig(agent);
      const paths = [...cfg.fileAccess];     // resolved per-agent + defaults
      const outcome = await runFsProbe(paths, deps.fsProbeDeps, deps.getFsSnapshot(agent));
      if (outcome.kind === "completed") {
        deps.setFsSnapshot(agent, outcome.snapshot);
      }
    }
  },
};
```

### Pattern B: atomic state-file writer (Phase 91 sync-state-store.ts:75-160 verbatim mirror)
```typescript
// src/manager/fs-snapshot-store.ts (NEW)
// Source: src/sync/sync-state-store.ts lines 75-160 (Phase 91 atomic temp+rename)

export async function writeFsSnapshot(
  agent: string,
  snapshot: ReadonlyMap<string, FsCapabilitySnapshot>,
  deps: { writeFile: typeof fs.writeFile; rename: typeof fs.rename; mkdir: typeof fs.mkdir; log?: Logger },
): Promise<void> {
  const filePath = `~/.clawcode/agents/${agent}/fs-capability.json`;
  const tmp = `${filePath}.tmp-${Date.now()}`;
  const payload = {
    agent,
    lastProbeAt: new Date().toISOString(),
    paths: Object.fromEntries(snapshot),
  };
  await deps.mkdir(path.dirname(filePath), { recursive: true });
  await deps.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await deps.rename(tmp, filePath);
}
```

### Pattern C: ToolCallError wrap with classification (Phase 94 D-12 reuse)
```typescript
// src/manager/tools/clawcode-share-file.ts (EXTEND, Phase 94 plan 05 + Phase 96 D-12)
// Source: existing src/manager/tools/clawcode-share-file.ts:200+ lines

function classifyShareFileError(err: unknown): { errorClass: ErrorClass; suggestion: string } {
  const msg = err instanceof Error ? err.message : String(err);
  // size check happens BEFORE ToolCallError; this maps remaining failure modes
  if (/ENOENT|no such file/i.test(msg)) {
    return { errorClass: "unknown", suggestion: `file not found at the given path — verify the path and re-run` };
  }
  if (/EACCES|permission denied/i.test(msg)) {
    return { errorClass: "permission", suggestion: "path is outside this agent's fileAccess allowlist; ask operator to add to clawcode.yaml fileAccess, or check if another agent has it in scope" };
  }
  if (/rate.limit|429|5[0-9][0-9]/i.test(msg)) {
    return { errorClass: "transient", suggestion: "Discord upload failed (rate limit or 5xx) — retry in 30s" };
  }
  return { errorClass: "unknown", suggestion: msg };
}
```

### Pattern D: stable-prefix block insertion (Phase 94/95 mirror)
```typescript
// src/manager/context-assembler.ts EXTEND (after <tool_status> block from Phase 94, before <dream_log_recent> from Phase 95)
// Source: existing context-assembler.ts (894 lines)

// PHASE 96 FS-02 — filesystem capability block sits between Phase 94 tool_status and Phase 95 dream_log_recent
const fsBlock = renderFilesystemCapabilityBlock(deps.getFsSnapshot(agent), deps.getAgentWorkspaceRoot(agent));
prefix += "\n" + fsBlock;
```

## State of the Art

| Old Approach (pre-Phase-96) | New Approach (Phase 96) | When Changed | Impact |
|-----------------------------|------------------------|--------------|--------|
| Phase 91 5-min systemd-timer mirror sync of `/home/jjagpal/.openclaw/workspace-finmentum/` to `/home/clawcode/.clawcode/agents/finmentum/` | Direct ACL read of source by clawcode user (no mirror) | Phase 96 | Eliminates the `clients/tara-maffeo/` vs `clients/maffeo-household/` drift class; saves 513MB destination + 5min cron overhead; agents always see source-of-truth |
| Agents under-promise filesystem capability based on stale belief at boot | Boot + 60s heartbeat + on-demand probe; system-prompt block re-renders on snapshot change | Phase 96 D-01..D-04 | No stale belief survives 60s; canonical bug eliminated |
| `clawcode_share_file({path})` rejects paths outside agent workspace | `clawcode_share_file({path})` accepts ACL-approved paths; outputDir template anchors agent-produced files under per-client structure | Phase 96 D-05..D-09 | Agents stop saying "/home/clawcode/output.png"; CDN URLs always returned |

**Deprecated/outdated (per Phase 96):**
- Phase 91 5-min file mirror sync timer — disabled at Phase 96 deploy; code stays for 7-day rollback.
- Path-prefix `startsWith()` boundary check (Phase 94 `clawcode-share-file.ts:isPathInsideRoots`) — still used for outputDir anchoring (intra-workspace, no symlink concern), but NOT used for cross-workspace fileAccess (canonical absPath Map lookup instead per D-06).

## Open Questions

The 14 decisions in CONTEXT.md are tightly locked, but the planner needs to resolve these mechanical/scoping questions:

1. **Should size/missing be added to ErrorClass enum, or mapped to `unknown`?**
   - What we know: Phase 94 ErrorClass enum is locked at 5 values. D-12 lists 4 sub-classes (`size | missing | permission | transient`) for clawcode_share_file failures.
   - What's unclear: Does D-12 expect a 6th and 7th enum value, or rich `suggestion` field on existing `unknown`?
   - Recommendation: Map `size` and `missing` → `unknown` with rich `suggestion` field. Keeps 5-value enum locked. Add static-grep test that `clawcode-share-file.ts` produces ToolCallError with errorClass ∈ {permission, transient, unknown} only. The D-12 4-class breakdown is a SUGGESTION-FIELD-driven taxonomy, not an enum extension.

2. **Where does the post-turn missed-upload soft warning hook live?**
   - What we know: D-10 says "Post-turn check (executor-level): if a tool call produced a file path AND the LLM response text matches `/here's|attached|...|/i` AND clawcode_share_file was NOT called, log warning to admin-clawdy".
   - What's unclear: "Executor-level" — is this `src/manager/turn-dispatcher.ts` post-turn hook? Or a heartbeat check that scans recent conversation turns?
   - Recommendation: TurnDispatcher post-turn hook (per-turn, immediate). Mirror Phase 94's tool-call-error.ts wrap site (turn-dispatcher.ts). Plan 96-04 (clawcode_share_file extension) wires the post-turn detector. Throttled via Phase 91 alert dedup primitive.

3. **What's the canonical absPath resolution flow for cross-platform safety?**
   - What we know: D-06 says "Snapshot keyed by canonical absPath (resolved symlinks, no `..`)".
   - What's unclear: Order of `path.resolve(p)` (handles `..` + relative) and `fs.realpath(p)` (handles symlinks). If realpath fails (path doesn't exist yet), fall back to resolve-only?
   - Recommendation: `const canonical = await deps.realpath(deps.resolve(p)).catch(() => deps.resolve(p))` — try realpath first, fall back to resolve if path doesn't exist. Document in checkFsCapability that non-existent paths get a resolve-only canonical and may produce false-negative cache hits if the path is later created via different absolute spelling. This is acceptable for v1.

4. **Does the heartbeat fs-probe check run in parallel with the existing mcp-reconnect check, or sequentially?**
   - What we know: `src/heartbeat/runner.ts:setInterval` calls `runChecks(...)`; per STRUCTURE.md `src/heartbeat/discovery.ts` auto-loads files in `checks/` directory.
   - What's unclear: Are checks run in parallel (Promise.all) or sequentially? Reading runner.ts (361 lines) would clarify.
   - Recommendation: Plan 96-07 reads `runner.ts` and `discovery.ts` first to confirm. If parallel, fs-probe doesn't slow down mcp-probe. If sequential, fs-probe (5s × N paths) adds to tick latency; ensure tick interval is generous (60s default fits 9 paths × 5s = 45s worst case).

5. **What is the exact `outputDir` resolution call site? Is it inside `clawcode_share_file` or upstream in the LLM response path?**
   - What we know: D-09 says "Default `clawcode_share_file` resolves the configured outputDir before checking allowlist — a file produced under outputDir is always shareable".
   - What's unclear: The LLM may produce a file at an arbitrary path (e.g., `/tmp/build_abc/output.pdf`); does outputDir resolution mean `clawcode_share_file` automatically COPIES the file to the resolved outputDir before uploading? Or does it just NORMALIZE the input path?
   - Recommendation: Plan 96-04 specifies the LLM is RESPONSIBLE for writing files under outputDir. The system-prompt directive (extended in 96-04) instructs the LLM: "Write generated files to {resolved-outputDir} unless the user specifies otherwise". `clawcode_share_file` resolves outputDir for the system-prompt directive's context (the LLM reads its outputDir from the prompt) but does NOT auto-copy. Files outside outputDir but inside fileAccess are still shareable. Files outside both → permission ToolCallError.

6. **Is the `clawcode_list_files` glob filter case-sensitive or case-insensitive?**
   - What we know: CONTEXT.md says "substring filter" if picomatch absent.
   - What's unclear: macOS HFS+ is case-insensitive; Linux ext4 is case-sensitive. Production is Linux (clawdy).
   - Recommendation: Case-sensitive substring (matches Linux fs semantics). Document in tool description: "glob match is case-sensitive substring".

## Risks and Mitigations

### Risk 1 (HIGH): "Agents have stale belief NOW" — heartbeat-driven refresh leaves a 60s window during Phase 96 deploy
**Surface:** D-13 chose "auto-refresh on next heartbeat tick" over fleet-wide restart. During the 60s window between Phase 96 daemon redeploy and first heartbeat tick, agents have legacy snapshot (or empty snapshot if pre-fileAccess).
**Mitigation:** Plan 96-07 deploy procedure includes IMMEDIATE post-deploy step: operator runs `for agent in fin-acquisition fin-tax admin-clawdy ...; do clawcode probe-fs $agent; done` to force on-demand probe across fleet. Eliminates the 60s window. Add to deploy-runbook in 96-07-PLAN.md.
**Residual:** If operator forgets the immediate-probe step, the 60s window applies; agents may still say "not accessible" for the first turn within 60s of deploy. Acceptable cost; UAT-95 (D-14) confirms steady-state.

### Risk 2 (MEDIUM): Phase 91 deprecation rollback surface concurrency with Phase 91's own 7-day cutover-rollback window
**Surface:** Both Phase 91 (`clawcode sync set-authoritative openclaw --revert-cutover`) and Phase 96 (`clawcode sync re-enable-timer`) modify the same `sync-state.json` `authoritative` field. State machine has new transitions: `openclaw → deprecated` (Phase 96 disable), `deprecated → openclaw` (Phase 96 re-enable OR Phase 91 revert-cutover), `openclaw → clawcode` (Phase 91 forward-cutover, NOT touched by Phase 96).
**Mitigation:** Plan 96-06 extends `authoritative` to 3-value enum (`"openclaw" | "clawcode" | "deprecated"`) in Zod schema. Both Phase 91 and Phase 96 CLI paths verify current state before transitioning (e.g., `clawcode sync re-enable-timer` errors if `authoritative !== "deprecated"`). Test matrix: 4 transitions × 2 timing scenarios (within window / after window).
**Residual:** Operator running both `set-authoritative` and `re-enable-timer` within seconds of each other will produce the more-recent ledger entry as effective; both succeed; outcome is deterministic. Document in 96-06 deploy notes.

### Risk 3 (MEDIUM): Concurrency on per-agent fs-capability.json snapshot read/write
**Surface:** Heartbeat tick + on-demand probe + `/clawcode-status` IPC read all touch `~/.clawcode/agents/<agent>/fs-capability.json`. Atomic temp+rename guarantees no torn writes, but last-writer-wins; reader may get stale snapshot for ~50ms while writer is renaming.
**Mitigation:** Plan 96-01 uses Phase 91 atomic temp+rename pattern verbatim. Document last-writer-wins semantics. In-memory snapshot Map is the single source of truth for the daemon's running session; the JSON file is for reload-safety across restarts. CLI/slash readers consume IPC payload (in-memory), not the file directly.
**Residual:** If daemon crashes mid-tick, fs-capability.json may not reflect the most recent probe; on restart, runFsProbe runs again (D-deferred: no probe-result caching across restarts). Acceptable.

### Risk 4 (MEDIUM): Static-grep regression pin coverage gap (single-source-of-truth boundary)
**Surface:** D-CONTEXT specifies `checkFsCapability(path, snapshot)` is the boundary; CI grep ensures no direct `fs.readFile`/`fs.access` in tool implementations. But the universe of "fs-touching tools" includes Read/Write/Bash/Edit (built-ins, NOT MCP-backed) — these are SDK-native, not in `src/manager/tools/`.
**Mitigation:** Plan 96-03 + 96-04 grep regression pins are SCOPED to `src/manager/tools/clawcode-*.ts` (the auto-injected tools). Built-in Read/Write/Bash are SDK-native and the SDK doesn't expose a hook for `checkFsCapability` insertion; the system-prompt block (96-02) tells the LLM what's accessible, and the LLM uses Read/Write/Bash within that boundary. Built-in tools that read off-limits paths simply fail with EACCES — caught by ToolCallError wrap (Phase 94 turn-dispatcher).
**Residual:** A built-in Read of an off-limits path returns EACCES to the LLM (not a graceful ToolCallError with `findAlternativeFsAgents` suggestion). Acceptable — Phase 96 D-08 alternative-suggestion is for clawcode-list-files/clawcode-share-file, not for Read/Write/Bash. Plan 96-04 documents this scope.

### Risk 5 (LOW): D-CONTEXT references `src/manager/agent-bootstrap.ts` which does not exist
**Surface:** CONTEXT.md §code_context lines 213-215 say agent-bootstrap.ts is the auto-injection point. It isn't. session-config.ts:421 is.
**Mitigation:** Plan 96-03 (clawcode_list_files) extends `src/manager/session-config.ts:421-440` (verified — Phase 94 imports for `CLAWCODE_FETCH_DISCORD_MESSAGES_DEF` and `CLAWCODE_SHARE_FILE_DEF` are at lines 58-59).
**Residual:** None — the planner just needs to read this research before implementing.

### Risk 6 (LOW): Phase 96 production target environment differs from dev box
**Surface:** Tara-PDF acceptance test (D-14) requires clawcode user + ACL + relaxed systemd unit; these exist on clawdy (per CONTEXT.md operator confirmed) but NOT on this dev box (per live audit).
**Mitigation:** Plan 96-07 deploy procedure includes a clawdy-side prerequisite verification step BEFORE running smoke test: `id clawcode | grep jjagpal && getfacl /home/jjagpal/.openclaw/workspace-finmentum/ | grep -q 'user:clawcode:rwx' && systemctl cat clawcode | grep -v 'ProtectHome=tmpfs'`. If any prereq fails, smoke test is BLOCKED with operator-actionable error.
**Residual:** None — operator pre-conditions are part of deploy gate, not Phase 96 code.

### Risk 7 (LOW): Phase 94 ErrorClass enum drift if D-12 sub-classes get added
**Surface:** Phase 94's static-grep pin enforces 5-value enum. If D-12 implementer naively adds `"size" | "missing"` to the enum, Phase 94 plan-04 regression test fails.
**Mitigation:** Plan 96-04 explicit rule: D-12 4-class breakdown is achieved via `suggestion` field, NOT enum values. Map size/missing → `errorClass: "unknown"`. Static-grep regression test in 96-04 confirms `clawcode-share-file.ts` only references the 5 Phase 94 enum values.
**Residual:** None.

### Risk 8 (LOW): clawcode_list_files token guard insufficient for very wide directories
**Surface:** D-07 says depth max 3, entries max 500 per call. A directory with 10,000 immediate children at depth 1 hits the 500 cap on first level; LLM never sees deeper structure.
**Mitigation:** Plan 96-03 implements truncation message at limit ("[...truncated, use glob filter or specific subpath]"). LLM is instructed (system-prompt directive in 96-04 if needed) to use glob filter or specific subpath when truncation occurs. Acceptable for v1; CONTEXT.md defers picomatch glob to v2.
**Residual:** None — D-07 explicitly bounded.

## Test Data Fixtures

### Operator-side fixtures (production: clawdy host)

**Verification commands (run on clawdy BEFORE D-14 smoke test):**
```bash
# 1. Confirm clawcode user exists and is in jjagpal group
id clawcode | grep -q "groups=.*jjagpal" || echo "FAIL: clawcode not in jjagpal group"

# 2. Confirm ACL grants clawcode:rwX on workspace-finmentum
getfacl /home/jjagpal/.openclaw/workspace-finmentum/ | grep -q "user:clawcode:rwx" || echo "FAIL: missing clawcode ACL"

# 3. Confirm clawcode systemd unit doesn't have ProtectHome=tmpfs
systemctl cat clawcode 2>/dev/null | grep -E "^ProtectHome=" | grep -v "ProtectHome=tmpfs" \
  || echo "FAIL: clawcode unit still has ProtectHome=tmpfs (or unit absent)"

# 4. Confirm Tara PDFs exist on workspace
test -f /home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf || echo "FAIL: financial worksheet missing"
test -f /home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-speech-coaching-apr24.pdf || echo "FAIL: speech coaching missing"
```

**Verified on dev box (jjagpal local) 2026-04-25:**
- ✓ Both PDFs exist at expected paths
- ✓ Workspace directory has `group::rwx` (jjagpal owns it; jjagpal accesses with no ACL needed)
- ✗ NO `clawcode:rwX` ACL (operator runs `setfacl -R -m u:clawcode:rwX` on clawdy, NOT on dev box)
- ✗ NO `clawcode` user (irrelevant on dev box; clawdy has it)
- ✗ NO `clawcode` systemd unit (clawdy host has it; dev box doesn't)

**Production prerequisites BEFORE Phase 96 deploy (per CONTEXT.md operator confirmed):**
1. `clawcode` user exists (`useradd -m clawcode -G jjagpal`)
2. ACL: `setfacl -R -m u:clawcode:rwX /home/jjagpal/.openclaw/workspace-finmentum/`
3. systemd unit `/etc/systemd/system/clawcode.service` (or user-unit) has `ProtectHome=read-only` or absent (not `tmpfs`)

### ClawCode-side fixtures (production: clawdy)

**clawcode.yaml additions for fin-acquisition (Plan 96-07 deploy step 2):**
```yaml
defaults:
  fileAccess:
    - /home/clawcode/.clawcode/agents/{agent}/      # auto-resolved per agent
  outputDir: "outputs/{date}/"

agents:
  fin-acquisition:
    fileAccess:
      - /home/jjagpal/.openclaw/workspace-finmentum/  # operator-shared via ACL
    outputDir: "clients/{client_slug}/{date}/"
```

**Workspace existence check (Plan 96-07 deploy gate):**
```bash
test -d /home/clawcode/.clawcode/agents/fin-acquisition/ \
  && echo "OK: clawcode agent workspace exists" \
  || echo "FAIL: run agent-create CLI first"
```

### D-14 smoke test execution script (Plan 96-07 deploy step 6)

```
1. Operator (in #finmentum-client-acquisition Discord channel):
   "Send me Tara Maffeo's financial worksheet PDF"

2. Expected agent behavior (post-Phase-96):
   a. Agent reads `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf` via cached snapshot OR on-miss real fs.access (D-06)
   b. Agent calls `clawcode_share_file({path: "/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf"})`
   c. clawcode_share_file resolves path → checks fs-capability snapshot → ALLOWED (path is in fin-acquisition's fileAccess after D-05) → uploads via webhook (Phase 1.6)
   d. Returns `{cdnUrl: "https://cdn.discord/...", filename: "tara-maffeo-financial-worksheet-apr24.pdf"}`
   e. Agent posts CDN URL inline. NO mention of "not accessible from my side". NO recommendation to use OpenClaw.

3. Repeat for `tara-maffeo-speech-coaching-apr24.pdf`.

4. Negative test: ask agent for `/etc/passwd` — agent refuses with errorClass=permission and (if any other agent has /etc in scope, which none should) lists alternatives or just refuses.

5. Confirm `/clawcode-status -a fin-acquisition` Capability section shows /home/jjagpal/.openclaw/workspace-finmentum/ as `ready (RO)`.

6. Confirm `clawcode sync status` reports `authoritative: deprecated`, `deprecatedAt: <ISO>`.
```

## Plan Breakdown Recommendation

The planner should produce **7 plans** mirroring the Phase 94 structure exactly. Wave assignment is calibrated so Wave 1 = primitives (no inter-plan deps); Wave 2 = consumers reading the primitive snapshot; Wave 3 = operator surfaces (slash + CLI + deprecation + deploy).

| Plan | Title | Decisions Covered | Files Modified | Depends on Other Plans | Suggested Wave | Estimated Hours |
|------|-------|------------------|----------------|------------------------|----------------|-----------------|
| **96-01** | Filesystem capability probe primitive + per-agent snapshot store + fileAccess schema | D-01 (probe schedule), D-05 (yaml fileAccess schema), D-06 (boundary check + canonical absPath) | NEW: `src/manager/fs-probe.ts`, `src/manager/fs-capability.ts`, `src/manager/fs-snapshot-store.ts`, `src/manager/__tests__/{fs-probe,fs-capability,fs-snapshot-store}.test.ts`. EXTEND: `src/config/schema.ts` (+fileAccess + DEFAULT_FILE_ACCESS), `src/config/loader.ts` (+resolveFileAccess), `src/manager/persistent-session-handle.ts` (+getFsCapabilitySnapshot/setFsCapabilitySnapshot lazy-init pair) | None | Wave 1 | 3.5 |
| **96-02** | System-prompt `<filesystem_capability>` block + assembler integration | D-02 (path classification block in stable prefix), D-04 (silent re-render) | NEW: `src/prompt/filesystem-capability-block.ts` (or inline in assembler), `src/manager/__tests__/context-assembler-fs-block.test.ts`. EXTEND: `src/manager/context-assembler.ts` (insert between `<tool_status>` Phase 94 and `<dream_log_recent>` Phase 95) | 96-01 (snapshot Map shape + getFsCapabilitySnapshot) | Wave 2 | 2.0 |
| **96-03** | clawcode_list_files auto-injected tool + findAlternativeFsAgents helper | D-07 (auto-injected listing tool), D-08 (alternative-agent suggestion via findAlternativeFsAgents) | NEW: `src/manager/tools/clawcode-list-files.ts`, `src/manager/find-alternative-fs-agents.ts`, `src/manager/__tests__/{clawcode-list-files,find-alternative-fs-agents}.test.ts`. EXTEND: `src/manager/session-config.ts:421-440` (add `clawcode_list_files` to autoInjectedTools alongside Phase 94's `clawcode_fetch_discord_messages` and `clawcode_share_file`) | 96-01 (snapshot Map + checkFsCapability boundary) | Wave 2 | 3.0 |
| **96-04** | Extend clawcode_share_file with outputDir resolution + ToolCallError classification + system-prompt directive update + outputDir schema | D-09 (outputDir template + 11th additive-optional schema), D-10 (auto-upload heuristic + post-turn missed-upload soft warning + system-prompt directive update), D-12 (4-class share failure classification mapped to Phase 94 ErrorClass enum) | NEW: `src/manager/resolve-output-dir.ts`, `src/manager/__tests__/resolve-output-dir.test.ts`. EXTEND: `src/manager/tools/clawcode-share-file.ts` (+resolveOutputDir, +classifyShareFileError), `src/config/schema.ts` (+outputDir + DEFAULT_SYSTEM_PROMPT_DIRECTIVES.file-sharing.text update), `src/config/loader.ts` (+resolveOutputDir), `src/manager/turn-dispatcher.ts` (+post-turn missed-upload check) | 96-01 (snapshot Map for permission classification), Phase 94 wrapMcpToolError (already exists) | Wave 2 | 3.0 |
| **96-05** | `/clawcode-probe-fs` Discord slash + `clawcode probe-fs` CLI + `clawcode fs-status` CLI + `/clawcode-status` Capability section | D-03 (manual refresh trigger via slash + CLI), D-11 surface (status reports deprecated — combined with 96-06) | NEW: `src/cli/commands/probe-fs.ts`, `src/cli/commands/fs-status.ts`, `src/discord/__tests__/slash-commands-probe-fs.test.ts`, `src/cli/commands/__tests__/{probe-fs,fs-status}.test.ts`. EXTEND: `src/discord/slash-commands.ts` (+/clawcode-probe-fs handler + extend /clawcode-status with Capability block), `src/discord/status-render.ts` (+renderCapabilityBlock pure renderer), `src/manager/daemon.ts` (+probe-fs IPC + list-fs-status IPC handlers) | 96-01 (runFsProbe primitive + IPC), 96-02 (renderFilesystemCapabilityBlock for /clawcode-status reuse) | Wave 3 | 2.5 |
| **96-06** | Phase 91 mirror deprecation surface — `clawcode sync disable-timer` / `re-enable-timer` + 3-value authoritative enum + sync-runner deprecation gate | D-11 (Phase 91 mirror deprecation, 7-day rollback, sync-state.json schema extension, deprecation messaging) | EXTEND: `src/sync/sync-state-store.ts` (+authoritative: 3-value enum + deprecatedAt field), `src/sync/sync-runner.ts` (+deprecation gate — run-once errors with deprecation message), `src/cli/commands/sync.ts` (+disable-timer +re-enable-timer subcommands), `src/sync/__tests__/sync-state-store-deprecation.test.ts`. NEW (or EXTEND existing sync.test.ts) | None (independent of 96-01/02/03/04 — sync state is its own subsystem) | Wave 1 OR Wave 2 (independent — can run any time) | 2.5 |
| **96-07** | Heartbeat probe scheduling + config-watcher reload trigger + auto-refresh on heartbeat tick + deploy procedure + UAT-95 acceptance test | D-01 heartbeat layer (60s tick), D-03 config-watcher trigger, D-13 (auto-refresh on next heartbeat tick), D-14 (Tara-PDF E2E acceptance — operator-runbook documentation only, no code) | NEW: `src/heartbeat/checks/fs-probe.ts`, `src/heartbeat/checks/__tests__/fs-probe.test.ts`. EXTEND: `src/config/watcher.ts` (RELOADABLE_FIELDS += fileAccess, outputDir + re-probe trigger on change). Documentation: 96-07-PLAN.md includes deploy-runbook section with operator pre-conditions (clawdy ACL/group/systemd checks) + immediate-post-deploy probe step + UAT-95 smoke-test script | 96-01 (runFsProbe), 96-05 (slash trigger for re-probe-on-change), 96-06 (deprecation deploy step) | Wave 3 | 2.0 |

**Total estimated: 18.5 hours across 7 plans.**

**Wave assignment rationale:**
- **Wave 1 (parallel-safe — no inter-plan deps):** 96-01 (probe primitive + schema), 96-06 (Phase 91 deprecation — independent subsystem). These can run in parallel; both are foundational primitives.
- **Wave 2 (consumers of Wave 1):** 96-02 (system-prompt block reads snapshot from 96-01), 96-03 (auto-injected tool reads snapshot from 96-01), 96-04 (clawcode_share_file extension reads snapshot from 96-01 for permission classification). All three can run in parallel — they touch different files.
- **Wave 3 (operator surfaces + integration):** 96-05 (slash + CLI surfaces — depends on 96-01 IPC + 96-02 renderer), 96-07 (heartbeat scheduling + deploy — depends on 96-01 primitive + 96-05 slash for force-probe + 96-06 deprecation deploy step).

**Why this is 7 plans not 4-5:**
- Each plan has tightly bounded scope — 1-2 decisions, 2-4 files modified, ≤ 4 hours estimated. Matches Phase 94's 7-plan rhythm.
- Splitting 96-04 into separate "outputDir" + "auto-upload" + "classification" plans would push to 9 plans; consolidating reads the schema change once (resolve-output-dir + share-file) at the cost of a slightly bigger plan.

**Why not fewer (3-4 plans)?**
- Combining 96-01 + 96-02 + 96-03 + 96-04 into one mega-plan ("filesystem subsystem") would be 11+ hours, 12+ files, fail Phase 94's plan-budget heuristic. The 7-plan shape mirrors Phase 94's proven cadence.

**Why not more (8+ plans)?**
- Splitting 96-04 (outputDir + auto-upload + classification) into 3 plans creates inter-plan deps (resolve-output-dir → share-file → turn-dispatcher) that sequence into Wave 4, slowing total wallclock. Folding into one plan keeps Wave 2 parallel.

## Project Constraints (from CLAUDE.md + global rules)

**From `/home/jjagpal/.openclaw/workspace-coding/CLAUDE.md` (project):**
- **Identity & soul:** Read `clawcode.yaml` `agents[name=test-agent]` `identity` and `soul` fields at session start; respond as Clawdy (💠 emoji, dry wit, never sycophantic). NOT directly applicable to plan content but applies to any test fixture personality.
- **Tech stack pin:** TypeScript 6.0.2, Node 22 LTS, @anthropic-ai/claude-agent-sdk 0.2.x, better-sqlite3 12.8.0, sqlite-vec 0.1.9, @huggingface/transformers 4.0.1, croner 10.0.1, execa 9.6.1, zod 4.3.6, discord.js 14.26.2 — **Phase 96 introduces ZERO new npm deps.** Verified: all reusable assets in `src/heartbeat/`, `src/manager/tools/`, `src/manager/tool-call-error.ts`, `src/sync/sync-state-store.ts`, `src/discord/webhook-manager.ts`, `src/config/schema.ts` already exist.
- **Don't-use list (`What NOT to Use`):** No LangChain/LangGraph, no Redis/PostgreSQL, no BullMQ/Agenda, no PM2, no Prisma/Drizzle, no @xenova/transformers, no sqlite-vss, no embeddings APIs. **Phase 96 satisfies all.**
- **GSD Workflow Enforcement:** Plans MUST be created via GSD command flow. Phase 96 already follows this — research → plan → execute.
- **Architecture-Driving Decisions:** Claude Agent SDK is the orchestration layer; SQLite per-agent (already used for memory; fs-capability.json is a small JSON file, not new SQLite); local embeddings (irrelevant to Phase 96).

**From global `/home/jjagpal/.claude/CLAUDE.md`:**
- **Skills referenced (`~/.claude/skills/`):** `search-first` skill applies — research existing solutions before custom code. Phase 96 honors this by reusing Phase 94/91/85/22 patterns verbatim.
- **Frontend Design rules:** Not applicable — Phase 96 has no UI components beyond Discord embed text.
- **What to NEVER do:** Generic AI-slop aesthetics, cookie-cutter layouts, etc. — N/A for Phase 96.

**From global `/home/jjagpal/.claude/rules/coding-style.md`:**
- **Immutability (CRITICAL):** Always create new objects, never mutate. **Phase 96 plans MUST honor:** `Object.freeze` on snapshots, ProbeRowOutput, ToolCallError shapes; all `readonly` types; no array push without spread. Pinned by static-grep tests in each plan.
- **File organization:** Many small files > few large files. 200-400 lines typical, 800 max. **Phase 96 plans honor:** new modules are sub-200 lines (fs-probe.ts, fs-capability.ts, etc.).
- **Error handling:** Always handle errors comprehensively; never silently swallow. **Phase 96 honors:** verbatim error pass-through from `fs.access` rejection to ToolCallError.message; no `try/catch {}` patterns.
- **Input validation:** Always validate at system boundaries. **Phase 96 honors:** Zod schema validation for fileAccess + outputDir; canonical absPath validation in checkFsCapability.

**From global `/home/jjagpal/.claude/rules/security.md`:**
- **No hardcoded secrets:** Phase 96 introduces no secrets. ✓
- **All user inputs validated:** clawcode_list_files {path, depth, glob} validated via Zod + isPathInsideRoots boundary. ✓
- **SQL injection prevention:** Phase 96 doesn't touch SQL. N/A.
- **XSS prevention:** Phase 96 doesn't render HTML beyond Discord embeds (discord.js handles escaping). ✓
- **Authentication/authorization verified:** Phase 96 boundary check (D-06) is the authorization primitive. ✓
- **Rate limiting:** Phase 96 inherits Phase 91 alert dedup throttling for missed-upload soft warnings. ✓

**From global `/home/jjagpal/.claude/rules/git-workflow.md`:**
- **Commit format:** `<type>: <description>` — `feat`, `fix`, `refactor`, etc. **Phase 96 plan summaries follow this.**
- **No attribution:** Disabled globally via `~/.claude/settings.json`. ✓

## Sources

### Primary (HIGH confidence — verified in repo)
- `.planning/phases/96-discord-routing-and-file-sharing-hygiene/96-CONTEXT.md` — 14 locked decisions D-01..D-14, deferred ideas, code_context, specifics
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` — Phase 94 decisions D-01..D-12 (referenced inheritance pattern)
- `.planning/phases/94-tool-reliability-self-awareness/94-01-PLAN.md` — capability probe primitive shape (mirror for 96-01)
- `.planning/phases/94-tool-reliability-self-awareness/94-02-PLAN.md` — stable-prefix filter pattern (mirror for 96-02)
- `.planning/phases/94-tool-reliability-self-awareness/94-03-PLAN.md` — auto-recovery (no Phase 96 analog)
- `.planning/phases/94-tool-reliability-self-awareness/94-04-PLAN.md` — ToolCallError schema + findAlternativeAgents (reused verbatim in 96-03/96-04)
- `.planning/phases/94-tool-reliability-self-awareness/94-05-PLAN.md` — clawcode_share_file (extended in 96-04) + auto-injection site at session-config.ts:421
- `.planning/phases/94-tool-reliability-self-awareness/94-06-PLAN.md` — defaults.systemPromptDirectives (extended in 96-04 file-sharing text)
- `.planning/phases/94-tool-reliability-self-awareness/94-07-PLAN.md` — /clawcode-tools display (template for 96-05)
- `.planning/phases/91-openclaw-clawcode-fin-acquisition-workspace-sync/91-CONTEXT.md` — sync architecture being deprecated (D-11 source)
- `.planning/STATE.md` — recent decisions (Phase 92-95 shipped 2026-04-25)
- `.planning/ROADMAP.md` — milestone structure (v2.6 shipped, v2.7 staging)
- `.planning/codebase/STRUCTURE.md` — directory layout, integration points (verified `agent-bootstrap.ts` does NOT exist; auto-injection lives in session-config.ts)
- `.planning/codebase/CONVENTIONS.md` — coding conventions (kebab-case, readonly, Object.freeze, vitest)
- `/home/jjagpal/.openclaw/workspace-coding/CLAUDE.md` — project tech stack pin + workflow enforcement
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/session-config.ts` — auto-injection site verified at lines 58-59 (imports), 421+ (registration block)
- `/home/jjagpal/.openclaw/workspace-coding/src/manager/tools/` — confirmed clawcode-fetch-discord-messages.ts and clawcode-share-file.ts exist (Phase 94 outputs)
- `/home/jjagpal/.openclaw/workspace-coding/src/heartbeat/checks/` — confirmed mcp-reconnect.ts is the heartbeat-check template
- `/home/jjagpal/.openclaw/workspace-coding/src/cli/commands/` — confirmed mcp-status.ts, sync.ts, sync-status.ts, etc. as patterns
- `/home/jjagpal/.openclaw/workspace-coding/src/sync/sync-state-store.ts` — atomic temp+rename pattern + authoritative field shape
- `/home/jjagpal/.openclaw/workspace-coding/src/config/schema.ts` — verified DEFAULT_SYSTEM_PROMPT_DIRECTIVES at line 115; agentSchema systemPromptDirectives at line 846; defaultsSchema at line 981
- `/home/jjagpal/.openclaw/workspace-coding/src/config/watcher.ts` — RELOADABLE_FIELDS at line 143
- `/home/jjagpal/.openclaw/workspace-coding/.planning/config.json` — confirmed nyquist_validation: true
- Live audit (2026-04-25): `getfacl /home/jjagpal/.openclaw/workspace-finmentum/`, `id clawcode`, `systemctl cat clawcode`, `ls /home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/`

### Secondary (MEDIUM confidence)
- `~/.claude/projects/.../memory/MEMORY.md` references — clawdy server topology (clawdy host, /opt/clawcode install, systemd service, EnvironmentFile PATH gotcha)
- Phase 96 evidence directory referenced in CONTEXT.md (Discord screenshots from 2026-04-25 09:30 in #finmentum-client-acquisition — not directly read but operator-confirmed)

### Tertiary (LOW confidence — flagged for validation)
- Production environment state on `clawdy` host — operator confirmed in CONTEXT.md but NOT independently verified by this researcher (clawdy is remote; this dev box is local). Plan 96-07 deploy gate runs the verification commands listed under "Test Data Fixtures" before D-14 acceptance.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — Every reusable asset verified to exist in repo (file paths and line numbers spot-checked); Phase 94 patterns shipped 3 days ago and are proven.
- Architecture: **HIGH** — Phase 96 = mirror of Phase 94 decisions onto filesystem; 14 locked decisions in CONTEXT.md leave little room for ambiguity.
- Pitfalls: **HIGH** — Pitfall 1 (agent-bootstrap.ts missing) verified by `ls`; Pitfall 2 (clawdy vs dev box) verified by `id clawcode`/`getfacl`; Pitfall 3-7 derived from cross-referencing CONTEXT.md against Phase 94 plan files.
- Risks: **MEDIUM** — Risk 1 (60s stale window) is well-mitigated by operator-runbook step; Risk 2 (Phase 91/96 rollback concurrency) is the highest-residual risk and requires careful schema migration in Plan 96-06.
- Validation Architecture: **HIGH** — 8 dimensions per CONTEXT.md §additional_context map cleanly to 11 Wave 0 test files + 1 manual UAT.
- Test data fixtures: **MEDIUM** — Tara PDF files verified locally; clawcode-side prerequisites NOT verified (production target is remote clawdy host); operator-runbook step in 96-07 closes this gap.

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (30 days for stable patterns; Phase 96 directly mirrors Phase 94 which shipped 2026-04-25)
