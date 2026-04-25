# Phase 96: Discord routing and file-sharing hygiene - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Operator-locked decisions captured inline (driven by live production bug — see Discord screenshot evidence in `.planning/phases/96-.../evidence/`)

<domain>
## Phase Boundary

Eliminate the inverse-of-Phase-94 bug class: agents *under-promising* capabilities they actually have. Concrete production trigger (2026-04-25 finmentum-client-acquisition channel screenshot): user asked for Tara Maffeo's financial-worksheet + speech-coaching PDFs; bot replied *"That path is not accessible from my side... To share those files, the OpenClaw agent needs to do it"* — but as of earlier the same day, the operator had already (a) added the `clawcode` user to the `jjagpal` group, (b) set `clawcode:rwX` ACLs on `/home/jjagpal/.openclaw/workspace-finmentum/`, and (c) relaxed the `clawcode` systemd unit (no more `ProtectHome=tmpfs`) so /home is visible. The agent's belief was stale. It never tested. It then recommended falling back to OpenClaw — the system being deprecated.

**Phase 96's goal:** make every filesystem capability the agent claims (or denies) match runtime reality. Probe accessible paths at boot, every heartbeat tick, and on-demand. Express the result as a "path classification block" in the system prompt (My workspace / Operator-shared / Off-limits). Make `clawcode_share_file` accept ACL-approved cross-workspace paths. Stop recommending OpenClaw fallback by giving ClawCode the actual capability. Phase 91's mirror sync becomes legacy — agents read source-of-truth directly via ACL.

**NOT in scope:** Discord routing (cross-workspace agent-to-agent messaging, channel→agent dispatch fixes, skill-based routing) — phase title is broad framing, actual scope is filesystem + file-sharing. Discord routing slices remain in deferred ideas. Probing built-in tools (Phase 94 already filtered MCP tools — we extend the same model to filesystem). Replacing the Phase 91 conversation-turn translator (separate plumbing).

</domain>

<decisions>
## Implementation Decisions

### Stale Capability Beliefs (Theme A)

**D-01: Probe schedule = boot + heartbeat + on-demand**
Three layers: (1) boot probe runs on session start over the configured `fileAccess` candidate set (parallel `fs.access` with 5s timeout), establishes baseline; (2) heartbeat (60s default — same tick as Phase 85 MCP probe) re-probes every path in the snapshot, refreshes `lastProbeAt`/`lastSuccessAt`/status; (3) on-demand probe fires when agent attempts a path not in the cache (B.2 fast path miss). No stale belief survives 60s.

**D-02: System prompt expression = path classification block**
Stable-prefix system prompt (Phase 85 pattern) gains a `<filesystem_capability>` block with three subsections:
```
<filesystem_capability>
## My workspace (full RW)
- /home/clawcode/.clawcode/agents/<agent>/

## Operator-shared paths (per ACL)
- /home/jjagpal/.openclaw/workspace-finmentum/ (RO, ACL)
- /home/jjagpal/.openclaw/workspace-coding/ (RO, ACL)

## Off-limits — do not attempt
- Anything outside the above.
</filesystem_capability>
```
LLM reasons about RW vs RO naturally. Mutable suffix continues to show probe diagnostics (last probe time, transient failures). Identical block ALSO renders in `/clawcode-status` and `clawcode fs-status` for operator inspection — single source of truth (matches Phase 94 D-04 mutable-suffix tool table precedent).

**D-03: Refresh trigger = both /clawcode-probe-fs slash + config-watcher**
- `/clawcode-probe-fs <agent>` Discord slash (admin-only via Phase 85 admin gate) + `clawcode probe-fs <agent>` CLI: operator manual refresh.
- Config-watcher (Phase 22 hot-reload) auto-fires re-probe when `agents.*.fileAccess` or `defaults.fileAccess` changes in clawcode.yaml.
- Both paths reuse same primitive: `runFsProbe(agent, deps): Promise<FsProbeOutcome>` (DI'd: clock, logger, fs.access, snapshotStore).

**D-04: Communication on changes = silent system-prompt update**
Next turn's stable prefix re-renders with updated capability block. No Discord post. Agent behavior shifts naturally. Operator inspects via `/clawcode-status` (gains Capability section) or `clawcode fs-status -a <agent>`. Rationale: capability changes in steady-state production are operator-driven (ACL edit) — operator already knows; agent doesn't need to broadcast.

### Cross-Workspace File Access (Theme B)

**D-05: Declaration model = hybrid (yaml-declared candidates + probe verifies)**
```yaml
defaults:
  fileAccess:
    - /home/clawcode/.clawcode/agents/{agent}/  # template — auto-resolved per agent
agents:
  fin-acquisition:
    fileAccess:
      - /home/jjagpal/.openclaw/workspace-finmentum/  # operator-shared via ACL
```
Schema: optional, additive (10th application of v2.2 additive-optional schema blueprint). Defaults block + per-agent override (matches Phase 94 systemPromptDirectives precedent). Probe at boot/heartbeat verifies each declared path is actually `fs.access`-readable. Declared-but-not-readable surfaces as `degraded` with message *"configured but not accessible — check ACLs/group/systemd ProtectHome"* — turns the staleness bug into an actionable warning.

**D-06: Boundary check = cached probe snapshot + on-miss real check**
At read-time / share-time: check `fsCapabilitySnapshot` first (fast path; in-memory Map<absPath, FsProbeResult>). If path not in cache, fall through to live `fs.access(path, R_OK)` check. On-miss probe result auto-cached for next call. Snapshot keyed by canonical absPath (resolved symlinks, no `..`). No path-prefix `startsWith()` (Phase 94 D-09's current approach) — that's brittle when ACLs grant per-subtree access.

**D-07: System-prompt visibility = top-level summary + clawcode_list_files tool**
Capability block (D-02) lists path roots only, not full trees. New auto-injected tool `clawcode_list_files({path, depth?, glob?})` for on-demand drill-in:
- Returns `{entries: [{name, type: 'file'|'dir', size?, mtime?}]}`
- Refuses paths outside cached capability snapshot (D-06 boundary)
- Refuses depth > 3 or entries > 500 per call (token guard)
- Read-only (no mutation)

Auto-injected alongside Phase 94's `clawcode_fetch_discord_messages` and `clawcode_share_file` (same site in `src/manager/agent-bootstrap.ts`).

**D-08: Out-of-allowlist refusal = ToolCallError (permission) + alternative suggestion**
Phase 94 D-06 ToolCallError pattern verbatim:
```ts
{
  tool: "clawcode_share_file" | "Read" | "clawcode_list_files",
  errorClass: "permission",
  message: "path /home/X is outside this agent's fileAccess allowlist",
  suggestion: "Ask operator to add to clawcode.yaml fileAccess, or check if another agent (Y) has it in scope.",
  alternatives: ["fin-tax", "admin-clawdy"]  // agents whose snapshot has the path readable
}
```
`alternatives` lookup via `findAlternativeFsAgents(absPath, fsStateProvider)` — pure-fn parallel to Phase 94's `findAlternativeAgents`.

### File-Sharing UX Hygiene (Theme C)

**D-09: Output location = `agents.*.outputDir` template string**
Schema:
```yaml
defaults:
  outputDir: "outputs/{date}/"  # default fleet-wide
agents:
  fin-acquisition:
    outputDir: "clients/{client_slug}/{date}/"  # client-organized
```
Tokens (resolved at write-time): `{date}` → `YYYY-MM-DD`, `{client_slug}` → from conversation context (LLM fills via system-prompt directive — when fin-acquisition is in a client conversation, it should know the slug from channel scope or recent messages), `{channel_name}` → current Discord channel slug, `{agent}` → agent name. Resolved path is anchored under agent workspace root (`/home/clawcode/.clawcode/agents/<agent>/`). Path traversal blocked (no `..`, no leading `/`). Default `clawcode_share_file` resolves the configured outputDir before checking allowlist — a file produced under outputDir is always shareable.

Migration: add fleet-wide `defaults.outputDir: "outputs/{date}/"` so existing agents are unaffected. fin-acquisition gets per-client template via per-agent override.

**D-10: Auto-upload heuristic = response references file as artifact**
System-prompt directive (added to `defaults.systemPromptDirectives.file-sharing` from Phase 94 D-10):
```
"When you produce a file the user wants to access OR your response references a file as an artifact ('here's the PDF', 'I generated X', 'attached below', or includes file as evidence), upload it via clawcode_share_file and include the CDN URL inline. If your response is text-only Q&A about file content (e.g., 'the PDF says X'), do NOT upload — the user is asking about content, not asking for the file."
```
Post-turn check (executor-level): if a tool call produced a file path AND the LLM response text matches `/here's|attached|generated|saved to|i (made|created|edited) .* (file|pdf|image|doc)/i`, AND clawcode_share_file was NOT called, log a warning to admin-clawdy ("possible missed upload — operator review"). Soft signal, not blocking.

**D-11: Sync architecture = read-from-source via ACL; deprecate Phase 91 mirror**
- Phase 96 disables the Phase 91 5-min systemd sync timer (`systemctl disable clawcode-sync-finmentum.timer`).
- Phase 91 sync code stays in repo for emergency rollback (7-day window per Phase 91 finalize semantics).
- `sync-state.json` `authoritative` flag set to "deprecated" with timestamp; `clawcode sync status` reports "deprecated — agents read source via ACL".
- Hourly conversation-turn translator (Phase 91 separate plumbing) STAYS — it's not a file mirror, it's session→memory translation.
- Single source of truth = operator's `/home/jjagpal/.openclaw/workspace-finmentum/`. No more divergence (the `clients/tara-maffeo/` vs `clients/maffeo-household/` drift cannot recur because there's no mirror to drift from).
- Future agents: ACL read by default; no mirror sync for new agents.

**D-12: clawcode_share_file failure = ToolCallError with classification**
Extends Phase 94 D-06 ToolCallError schema with file-share-specific errorClasses:
```ts
{
  tool: "clawcode_share_file",
  errorClass: "size" | "missing" | "permission" | "transient",
  message: <verbatim node:fs / discord.js error>,
  suggestion: <per-class>:
    - size: "file is 47MB; Discord limit is 25MB — compress or split"
    - missing: "file not found at /path/X — verify the path and re-run"
    - permission: D-08 verbatim
    - transient: "Discord upload failed (rate limit or 5xx) — retry in 30s"
}
```
LLM sees structured error, adapts response. No silent retries (Phase 94 deferred-idea — kept deferred).

### Migration & Acceptance

**D-13: In-flight session migration = auto-refresh on next heartbeat tick**
Phase 96 deploys via daemon redeploy. No agent restart required. Heartbeat's next tick (≤60s) probes filesystem, builds snapshot, next turn's stable prefix re-renders with capability block. Stable-prefix hash changes once → one Anthropic cache miss per agent → cache re-stabilizes on subsequent turns. Acceptable cost (Phase 94 D-04 same trade-off accepted).

**D-14: Acceptance smoke test = Tara-PDF end-to-end**
Canonical "Phase 96 fixed it" test, run in `#finmentum-client-acquisition`:
1. Operator: "Send me the Tara Maffeo financial worksheet."
2. Agent reads `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf` via ACL (D-06 cached probe + on-miss real check resolves).
3. Agent calls `clawcode_share_file({path: <abs>})` (D-08 allowlist accepts since path is in fileAccess after D-05 declaration + probe).
4. clawcode_share_file uploads to channel via webhook (Phase 1.6) or bot-direct (Phase 90.1 fallback), returns CDN URL.
5. Agent posts CDN URL inline. NO mention of *"not accessible from my side"*. NO recommendation to use OpenClaw.
6. Repeat for `tara-maffeo-speech-coaching-apr24.pdf`.

UAT-95 added to phase verification checklist. Operator-validated post-deploy. If agent says "not accessible" again — Phase 96 failed.

### Claude's Discretion

- **Probe primitive shape:** `runFsProbe(agent, deps): Promise<FsProbeOutcome>` — pure-DI, deps include `agentConfig.fileAccess`, `clock`, `logger`, `fs.access`, `snapshotStore`. `FsProbeOutcome = {kind: "completed", snapshot: FsCapabilitySnapshot, durationMs} | {kind: "failed", error: string}`.
- **Snapshot shape:** `Map<absPath, {status: 'ready' | 'degraded' | 'unknown', mode: 'rw' | 'ro' | 'denied', lastProbeAt, lastSuccessAt?, error?}>`. Persisted in `~/.clawcode/agents/<agent>/fs-capability.json` (atomic temp+rename per Phase 83/91/94). Reload-safe across daemon restarts.
- **System-prompt assembly:** new `<filesystem_capability>` section sits between Phase 94's `<tool_status>` block and Phase 95's `<dream_log_recent>` summary. Phase 53 stable-prefix budget accounts for it (~150 tokens typical for a 2-3 path agent).
- **Pure-fn DI test strategy:** Phase 94/95 idiom — `runFsProbe`, `clawcode_list_files` impl, `findAlternativeFsAgents`, `resolveOutputDir({outputDir, agent, channelName, clientSlug, date}, deps)` are all pure modules; production wires real `fs`/`webhookManager`/etc.
- **Phase 91 deprecation mechanics:** edit `sync-state.json` to set `authoritative: "deprecated"` + `deprecatedAt: <ISO>`; `clawcode sync` subcommand surface unchanged (status reports deprecated; run-once errors with "deprecated, use ACL read"); systemd timer disabled via `clawcode sync disable-timer` subcommand (idempotent; logs to ledger). Existing 7-day rollback window honored — `clawcode sync re-enable-timer` restores during window, errors after.
- **Output-dir token resolution:** `resolveOutputDir(template, ctx)` — pure fn. `{client_slug}` resolution: LLM fills via system-prompt directive (when in fin-acquisition channel, agent should know client from channel scope/conversation). If `{client_slug}` token present and LLM didn't fill → fall back to `unknown-client/` and log warning. Operator can grep logs to detect missed fills.
- **Static-grep regression pin:** every fs read/share site MUST go through `checkFsCapability(path, snapshot)` — single-source-of-truth boundary. CI grep ensures no direct `fs.readFile`/`fs.access` in tool implementations bypassing the check (Phase 94 filterToolsByCapabilityProbe pin precedent).
- **Phase 92 verifier integration:** Phase 92 cutover-time verifier reads filesystem capability snapshot (instead of running its own ACL check) — single source of truth. Reduces verifier complexity.
- **clawcode_list_files token guard:** depth max 3, entries max 500 per call (truncation message at limit: "[...truncated, use glob filter or specific subpath]"). Glob via `picomatch` if available in deps; else simple substring filter.
- **Auto-upload soft-warning destination:** admin-clawdy channel via Phase 94's existing alert primitive. Throttled (Phase 91 alert dedup).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 94 — Tool reliability foundation (the inverse bug class)
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` §D-01 — capability probe = synthetic representative call (not connect-test). Phase 96 D-01 mirrors this pattern for filesystem.
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` §D-02 — `ready | degraded | reconnecting | failed | unknown` status enum. Phase 96 reuses for fs probe results.
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` §D-04 — stable-prefix re-render on capability change. Phase 96 piggybacks on the same prompt-assembler call site.
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` §D-06 — ToolCallError schema (errorClass, message, suggestion, alternatives). Phase 96 D-08/D-12 extend this verbatim.
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` §D-09 — `clawcode_share_file` primitive. Phase 96 D-09 extends with outputDir resolution; Phase 96 D-12 extends error classification.
- `.planning/phases/94-tool-reliability-self-awareness/94-CONTEXT.md` §D-10 — `defaults.systemPromptDirectives` schema. Phase 96 D-10 extends `file-sharing` directive text.

### Phase 91 — Workspace sync (being deprecated)
- `.planning/phases/91-openclaw-clawcode-fin-acquisition-workspace-sync/91-CONTEXT.md` — mirror sync architecture, set-authoritative semantics, 7-day rollback window. Phase 96 D-11 disables the 5-min timer + sets authoritative to "deprecated" within Phase 91's existing semantics.
- `src/sync/sync-runner.ts` — sync runner; not deleted, kept for rollback safety.
- `~/.clawcode/manager/sync-state.json` (runtime artifact) — `authoritative` field + `deprecatedAt` timestamp added by Phase 96 deprecation step.

### Phase 85 — MCP probe foundation (probe schedule precedent)
- `.planning/phases/85-mcp-tool-awareness-and-reliability/` — boot probe + heartbeat probe pattern. Phase 96 mirrors timing (60s heartbeat default).
- `src/heartbeat/checks/mcp-reconnect.ts` — heartbeat check structure; Phase 96 adds `fs-probe.ts` alongside.

### Phase 22 — Config hot-reload (config-watcher trigger)
- `src/config/watcher.ts` — clawcode.yaml watcher; triggers re-load on change. Phase 96 D-03 adds `fileAccess` to RELOADABLE_FIELDS so config-watcher fires fs re-probe.
- `src/config/loader.ts` `resolveAgentConfig` — defaults + per-agent override resolution; Phase 96 extends with `fileAccess` and `outputDir` resolution.

### Phase 89 — Restart greeting (in-flight session pattern)
- `.planning/phases/89-.../89-CONTEXT.md` — additive-optional schema blueprint precedent (8th application). Phase 96 D-05 / D-09 are the 10th and 11th applications.

### Production evidence
- `.planning/phases/96-discord-routing-and-file-sharing-hygiene/evidence/` — Discord screenshots from `#finmentum-client-acquisition` 2026-04-25 09:30 showing the canonical bug (bot saying *"not accessible from my side"* despite ACL granting access). Operator can re-run Tara-PDF smoke test (D-14) post-deploy.

### Codebase integration points (codebase maps)
- `.planning/codebase/STRUCTURE.md` §`src/discord/` — bridge, router, webhook-manager, delivery-queue, slash-commands. clawcode_share_file uses webhook-manager + bot-direct fallback.
- `.planning/codebase/STRUCTURE.md` §`src/manager/` — agent-bootstrap (auto-injection point), session-manager, daemon. Phase 96 extends agent-bootstrap with `clawcode_list_files` registration.
- `.planning/codebase/STRUCTURE.md` §`src/heartbeat/` — runner.ts, checks/. Phase 96 adds `checks/fs-probe.ts`.
- `.planning/codebase/STRUCTURE.md` §`src/config/` — schema.ts (Zod), loader.ts, watcher.ts. Phase 96 extends schema with `fileAccess` + `outputDir`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (zero new npm deps preserved)
- **`src/heartbeat/runner.ts` + `src/heartbeat/checks/`** — pluggable check modules; new `checks/fs-probe.ts` plugs in alongside `mcp-reconnect.ts` (Phase 85), `auto-linker.ts` (Phase 36-41), `consolidation.ts` (Phase 1.1)
- **`src/manager/tools/clawcode-share-file.ts`** (Phase 94) — extend with outputDir resolution + ToolCallError classification (D-09, D-12)
- **`src/manager/tools/clawcode-fetch-discord-messages.ts`** (Phase 94) — auto-injection sibling for new `clawcode_list_files` tool
- **`src/manager/agent-bootstrap.ts`** — auto-injection point; extend with `clawcode_list_files` registration
- **`src/discord/webhook-manager.ts`** + bot-direct fallback (Phase 1.6 + 90.1) — already wired by Phase 94 D-09; Phase 96 reuses
- **`src/config/schema.ts`** — agentSchema + defaultsSchema; extend with `fileAccess` + `outputDir` (10th + 11th applications of additive-optional schema)
- **`src/config/loader.ts`** `resolveAgentConfig` — defaults+override resolution; extend
- **`src/config/watcher.ts`** RELOADABLE_FIELDS — append `fileAccess` + `outputDir`
- **`src/discord/slash-commands.ts`** — `/clawcode-tools` (Phase 94) + `/clawcode-status` (Phase 93) inline-short-circuit; add `/clawcode-probe-fs` slash + extend `/clawcode-status` with Capability block
- **`src/cli/commands/`** — mirror CLI for `clawcode probe-fs` + `clawcode fs-status` (Phase 94 D-11 mcp-status precedent)
- **`src/sync/sync-runner.ts`** (Phase 91) — sync runner; touched only to add deprecation surface (not deleted)
- **`src/manager/capability-probe.ts`** + **`src/manager/capability-probes.ts`** (Phase 94) — capability probe primitives; extend pattern for filesystem
- **`node:fs/promises` `fs.access`** — POSIX read check; pure stdlib, no deps

### Established Patterns
- **Phase 94 capability-probe blueprint** — synthetic representative call → status enum → snapshot → prompt filter → recovery. Phase 96 = same blueprint applied to filesystem.
- **Phase 83/86/89/90/92/94 additive-optional schema blueprint** (10th + 11th applications — `agents.*.fileAccess` + `agents.*.outputDir`) — v2.5/v2.6 migrated configs parse unchanged.
- **Pure-DI primitives + production wiring at daemon edge** (Phase 91/94/95 idiom).
- **Atomic temp+rename for state files** (Phase 83/91/94/95) — fs-capability.json follows.
- **Discriminated-union outcomes** (FsProbeOutcome — 2-3 variants per Phase 84/86/88/90/92/94/95 pattern).
- **Stable-prefix mutable-suffix prompt assembly** (Phase 53 + 85) — extend with `<filesystem_capability>` block.
- **Static-grep regression pin** (Phase 94 D-04 filterToolsByCapabilityProbe) — `checkFsCapability` is the new pin.

### Integration Points
- `src/heartbeat/runner.ts` → register `fs-probe` check
- `src/heartbeat/checks/fs-probe.ts` (NEW) → invoke `runFsProbe` on tick
- `src/manager/fs-probe.ts` (NEW) → primitive
- `src/manager/fs-snapshot-store.ts` (NEW) → atomic JSON persistence
- `src/manager/tools/clawcode-list-files.ts` (NEW) → on-demand listing tool
- `src/prompt/assembler.ts` → assemble `<filesystem_capability>` block
- `src/config/schema.ts` → fileAccess + outputDir Zod schemas
- `src/config/loader.ts` → resolveFileAccess + resolveOutputDir helpers
- `src/config/watcher.ts` → RELOADABLE_FIELDS extension
- `src/manager/tools/clawcode-share-file.ts` → outputDir resolution + ToolCallError classification
- `src/discord/slash-commands.ts` → `/clawcode-probe-fs` + `/clawcode-status` Capability block
- `src/cli/commands/probe-fs.ts` (NEW) + `src/cli/commands/fs-status.ts` (NEW) → CLI surface
- `src/cli/commands/sync.ts` → add `disable-timer` + `re-enable-timer` subcommands; status surfaces deprecation
- `src/sync/sync-runner.ts` → respect deprecation flag (run-once errors with deprecation message)

</code_context>

<specifics>
## Specific Ideas

### Reproducer for the original bug (operator-replicable)
1. In `#finmentum-client-acquisition`, ask Clawdy: *"Send me Tara Maffeo's financial worksheet PDF."*
2. Pre-Phase-96 behavior: bot replies *"That path is not accessible from my side... To share those files, the OpenClaw agent needs to do it."* (See `.planning/phases/96-.../evidence/discord-2026-04-25-finmentum-client-acquisition.png`.)
3. Post-Phase-96 expected: bot reads `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/tara-maffeo-financial-worksheet-apr24.pdf` via ACL, calls `clawcode_share_file`, posts CDN URL.

### Operator-side prerequisites (already done — Phase 96 assumes)
- `clawcode` user is member of `jjagpal` group (verify: `id clawcode | grep jjagpal`)
- ACLs grant `clawcode:rwX` on `/home/jjagpal/.openclaw/workspace-finmentum/` (verify: `getfacl /home/jjagpal/.openclaw/workspace-finmentum/`)
- `clawcode` systemd unit relaxed (no `ProtectHome=tmpfs`; verify: `systemctl cat clawcode | grep ProtectHome`)

### Default config values (post-Phase-96)
- `defaults.fileAccess: ["/home/clawcode/.clawcode/agents/{agent}/"]` — fleet-wide own-workspace default
- `defaults.outputDir: "outputs/{date}/"` — fleet-wide dated outputs
- `agents.fin-acquisition.fileAccess: ["/home/jjagpal/.openclaw/workspace-finmentum/"]` — operator-shared via ACL
- `agents.fin-acquisition.outputDir: "clients/{client_slug}/{date}/"` — client-organized

### Tool param shapes
- `clawcode_list_files({path: string, depth?: number = 1, glob?: string})` → `{entries: [{name, type, size?, mtime?}], truncated: boolean}`
- `clawcode_share_file({path: string, caption?: string})` → `{cdnUrl: string, channelId: string, messageId: string}` (already exists Phase 94; extended for outputDir + classification)

### Capability snapshot file shape
```json
// ~/.clawcode/agents/fin-acquisition/fs-capability.json
{
  "agent": "fin-acquisition",
  "lastProbeAt": "2026-04-25T16:30:00Z",
  "paths": {
    "/home/clawcode/.clawcode/agents/fin-acquisition/": {
      "status": "ready",
      "mode": "rw",
      "lastProbeAt": "2026-04-25T16:30:00Z",
      "lastSuccessAt": "2026-04-25T16:30:00Z"
    },
    "/home/jjagpal/.openclaw/workspace-finmentum/": {
      "status": "ready",
      "mode": "ro",
      "lastProbeAt": "2026-04-25T16:30:00Z",
      "lastSuccessAt": "2026-04-25T16:30:00Z"
    }
  }
}
```

### Slash + CLI signatures
- `/clawcode-probe-fs <agent>` — admin-only ephemeral; replies with EmbedBuilder summary (paths probed, ready/degraded counts, top 3 changes since last probe)
- `clawcode probe-fs <agent> [--diff]` — manual trigger; `--diff` shows changes since last probe
- `clawcode fs-status -a <agent>` — full snapshot dump (mirrors `clawcode mcp-status`)
- `clawcode sync disable-timer` — disables Phase 91 systemd timer + writes deprecation row to ledger
- `clawcode sync re-enable-timer` — within 7-day window, restores; after, errors

### Migration step (deploy procedure)
1. Daemon redeploy with Phase 96 code
2. Edit clawcode.yaml: add `defaults.fileAccess` + `defaults.outputDir`; add per-agent fin-acquisition `fileAccess` block (operator-shared paths)
3. Config-watcher detects edit → triggers re-probe across all agents
4. Within 60s, agents have fresh capability snapshot
5. Run `clawcode sync disable-timer` to deprecate Phase 91 mirror
6. Smoke-test D-14 (Tara-PDF end-to-end)

</specifics>

<deferred>
## Deferred Ideas

- **Discord routing — cross-workspace agent-to-agent messaging** — phase title's "Discord routing" framing suggested this; operator confirmed not in scope for Phase 96. Possible Phase 97+ if the cross-workspace ACL pattern surfaces a need (e.g., admin-clawdy@coding wants to delegate a query to clawdy@finmentum across workspaces).
- **Discord routing — channel→agent dispatch fixes / thread inheritance / webhook identity edge cases** — no concrete bug surfaced; deferred until reported.
- **Discord routing — skill-based handoff (Phase 94 D-07 → real routing)** — Phase 94 D-07 left this as text-suggestion-only. Real handoff (auto-spawn one-shot subagent across agents) too invasive for v2.7 — revisit when cross-workspace ACL fully proven in production.
- **LLM-side file-path hallucination prevention** — beyond the post-turn missed-upload soft warning (D-10), trust LLM to behave per directive.
- **Per-file granular probe** (probe each file in fileAccess, not just the root path) — diminishing returns; root-readable implies subtree readable in practice (ACL inheritance).
- **Probe-result caching across daemon restarts** — fs-capability.json IS persisted (D atomic write), but on cold start we re-probe rather than trust the file. Could short-circuit if last probe < 5min ago, but premature optimization.
- **Auto-update PR generation when fileAccess pattern fires repeatedly** — Phase 94 noted this as a Phase 96+ idea; defer to v2.7 if pattern emerges (signals operator should fix at infra layer).
- **Phase 91 conversation-turn translator deprecation** — Phase 96 disables the FILE mirror, NOT the session→memory translator. That's separate plumbing; revisit when v2.7 evaluates whether ACL-read-of-session-jsonl makes the translator redundant.
- **Bidirectional sync (Claw→Open)** — Phase 91 supports it via set-authoritative; Phase 96 confirmed direction is operator→clawcode (read-from-source), not the reverse. ClawCode does NOT become source-of-truth for files (only for memory/sessions).
- **OpenClaw deprecation cliff date** — Phase 96 makes ClawCode capable of subsuming OpenClaw's file-share role; the formal cliff (when OpenClaw is fully removed) is a separate operator decision, not Phase 96.
- **Fleet-wide restart on deploy** — operator preferred auto-refresh on heartbeat; restart deferred unless heartbeat-refresh proves insufficient in production.
- **clawcode_list_files glob via picomatch** — added picomatch as a dep would break "zero new npm deps" precedent; substring-filter fallback is good enough for v1. Revisit if operator workflow demands.
- **Synthetic probe-only smoke test + generated-doc bidirectional test** — operator chose Tara-PDF E2E as canonical acceptance; the other two from C.4-acceptance batch are deferred as nice-to-haves.

</deferred>

---

*Phase: 96-discord-routing-and-file-sharing-hygiene*
*Context gathered: 2026-04-25*
