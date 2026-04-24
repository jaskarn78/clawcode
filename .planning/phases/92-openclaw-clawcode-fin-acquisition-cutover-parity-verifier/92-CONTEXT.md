# Phase 92: OpenClaw → ClawCode fin-acquisition Cutover Parity Verifier - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning
**Mode:** Decisions captured inline from pre-phase conversation (Discord message store source confirmed, verification-first scope confirmed, safety model at Claude's discretion with user approval)

<domain>
## Phase Boundary

Before the operator flips `sync.authoritative` to clawcode (Phase 91 SYNC-09), run an automated parity check that proves the ClawCode fin-acquisition agent can handle every task the OpenClaw source agent has historically handled — tool use, skill invocation, MCP access, memory recall, uploads, agentic workflows — via BOTH entry points (Discord bot routing + /v1/chat/completions API). Emits a gap report, auto-applies additive-reversible fixes (missing memory files, missing skills, missing uploads, model allowlist gaps), gates destructive mutations (MEMORY.md merges, MCP credential rewrites, skill edits, outdated memory overwrites) behind admin-clawdy ephemeral confirmation with Accept/Reject/Defer buttons, and sets `cutover-ready: true` as a hard precondition for `clawcode sync set-authoritative clawcode --confirm-cutover`.

**NOT in scope:** bidirectional parity (one-way only), live-conversation replay, MEMORY.md content auto-merge, fleet-wide verifier for other agents, daily regression suite, auto-repair of MCP verbatim errors.

</domain>

<decisions>
## Implementation Decisions

### D-01: Source corpus — Discord message store
OpenClaw does not persist Claude Code-style `sessions/*.jsonl` at the workspace path (confirmed absent at `~/.openclaw/workspace-finmentum/sessions/`). Authoritative behavior corpus is the Discord message history for fin-acquisition's channels.

**How:** ingestor uses the existing `plugin:discord:fetch_messages` tool through the Claude Agent SDK to pull full history per channel. Writes to clawdy-local JSONL staging at `~/.clawcode/manager/cutover-staging/<agent>/discord-history.jsonl`. Idempotent by Discord message id (UNIQUE index).

**Depth default:** max(10000 messages, 90 days) per channel. Configurable via `--depth-msgs N --depth-days N` CLI flags. Covers the production corpus for fin-acquisition (4900 msgs observed 2026-04-23/24 window per prior analysis).

### D-02: Behavior profiler — single LLM pass
Profiler is a single `TurnDispatcher.dispatch` call (reuse existing SDK path, no new primitive) with the Discord history JSONL as input and a structured-output system prompt that emits `AGENT-PROFILE.json`. Shape:

```json
{
  "tools": ["Bash", "Read", "mcp__1password__read", ...],
  "skills": ["content-engine", "market-research", ...],
  "mcpServers": ["browser", "search", "1password", ...],
  "memoryRefs": ["vault/icapital-2026-04-03.md", "procedures/newsletter-pipeline.md", ...],
  "models": ["anthropic-api/claude-sonnet-4-6"],
  "uploads": ["analysis.pdf", "chart.png", ...],
  "topIntents": [{"intent": "portfolio-analysis", "count": 47}, ...]
}
```

Chunked if history exceeds token budget (split by 30-day windows, merge profile outputs with dedup). Emits deterministic JSON (sorted keys, sorted arrays).

### D-03: Target capability probe — three data sources
Probe reads:
1. **clawcode.yaml** (parsed via existing `yaml 2.8.3`): `skills[]`, `mcpServers[]`, `model`, `allowedModels[]`, `channels[]`, `memoryAutoLoad`, `heartbeat`
2. **Workspace inventory**: MEMORY.md presence + sha256, `memory/**/*.md` file list with mtimes + hashes, `uploads/discord/` count + total bytes, `skills/**` list
3. **Runtime MCP state**: reuse Phase 85 `list-mcp-status` IPC — returns per-server `{status, lastError, failureCount}` for live health

Emits `TARGET-CAPABILITY.json` with the same shape keys as AGENT-PROFILE.json (tools from skills+mcpServers unions, etc.) for easy diffing.

### D-04: Diff engine — typed CutoverGap discriminated union
8 gap kinds:
- `missing-skill` (source used skill, target doesn't have it)
- `missing-mcp` (source used MCP tool from server not in target mcpServers)
- `missing-memory-file` (source referenced memory/X.md, target doesn't have it)
- `outdated-memory-file` (target has memory/X.md but hash differs from source — DESTRUCTIVE)
- `missing-upload` (source referenced uploads/X, target doesn't have it)
- `model-not-in-allowlist` (source used model M, target's allowedModels[] excludes M)
- `mcp-credential-drift` (target has MCP server but env/op:// refs differ — DESTRUCTIVE)
- `tool-permission-gap` (source invoked Bash/Write without approval, target has ACL denying it — DESTRUCTIVE)

Discriminated via `kind` field. Emits `CUTOVER-GAPS.json` sorted deterministically by (kind, identifier).

### D-05: Additive fix auto-applier — 4 kinds, ledger-backed
Auto-applies when `--apply-additive` flag passed (default OFF = dry-run):
- `missing-memory-file` → copy from OpenClaw workspace via rsync staging (reuse Phase 91 sync primitive)
- `missing-upload` → copy from OpenClaw uploads/discord/ via rsync (reuse Phase 91)
- `missing-skill` → read source skill dir, apply Phase 84 secret-scan + frontmatter normalize + copy to target, call Phase 86 `updateAgentSkills(agent, skills + [new])` atomic YAML writer
- `model-not-in-allowlist` → read source model usage, call Phase 86 `updateAgentConfig(agent, {allowedModels: existing + [missing]})` atomic writer

Each fix writes a row to `~/.clawcode/manager/cutover-ledger.jsonl` with `{timestamp, action, kind, identifier, sourceHash, targetHash, reversible:true, rolledBack:false}`. Ledger is human-inspectable and drives ledger-rewind.

### D-06: Destructive fix proposer — admin-clawdy embed w/ buttons
4 destructive kinds: `outdated-memory-file`, `mcp-credential-drift`, `tool-permission-gap`, and any MEMORY.md merge.

Emits an admin-clawdy channel ephemeral embed per gap (first pass — batch into pages if > 10 gaps):
- Title: `⚠ Cutover gap: {kind}`
- Description: diff-style: "OpenClaw side: <hash/content>, ClawCode side: <hash/content>"
- Buttons: **Accept** (danger red) / **Reject** (secondary) / **Defer** (secondary)
- customId: `cutover-{agent}-{gapId}:{action}` (prefix-filterable per Phase 86-03 pattern)

**Accept** → runs atomic writer, logs ledger row with `destructive:true, accepted:true`.
**Reject** → logs ledger row `destructive:true, accepted:false`; target unchanged.
**Defer** → no-op at button level; next `verify` run re-surfaces the gap.

Mutation ONLY on Accept. Defer never auto-applies.

### D-07: Safety model — dry-run default + three-tier gating
1. **Default (`clawcode cutover verify`)**: dry-run, no writes to target YAML/workspace/skills/memory. Ingestor + profiler + probe + diff run; report emits. Pre/post sha256 sweep verifies byte-equality of target.
2. **`--apply-additive`**: auto-applies the 4 additive kinds; destructive still gated.
3. **Destructive**: NEVER auto-applies. Always admin-clawdy button confirmation. No flag can bypass this — it's the safety floor.

User explicitly said "propose-and-confirm for first pass" → this wires it.

### D-08: Dual entry-point canary — synthetic prompt battery
Canary runner executes after additive fixes apply. Two phases:
1. **Intent clustering** (from profiler output `topIntents[]`): take top 20 intents by count. For each, synthesize 1 representative prompt (e.g., "Summarize the Q1 performance of the iCapital fund" for intent=portfolio-analysis). LLM pass with constrained output = JSON array of 20 prompts.
2. **Dual-invocation**: for each prompt, run TWICE:
   - **Discord bot path**: post to a canary channel (reuse existing canary channel from Phase 89 greet infra, or create `#cutover-canary`), wait for agent response, verify completion (no exception, no empty reply, response length > N chars).
   - **API path**: POST `http://localhost:3101/v1/chat/completions` with `model: "clawcode/fin-acquisition", messages: [{role:"user", content: prompt}]`. Verify 200 OK + non-empty content + no error field.

Pass criteria: all 20 prompts × 2 paths = 40 invocations, ALL complete. Any failure → 0% pass rate, cutover-ready: false.

Emits `CANARY-REPORT.md` with per-prompt per-path pass/fail + response time.

### D-09: Cutover-ready gate — 24h freshness
`CUTOVER-REPORT.md` frontmatter:
```yaml
cutover_ready: true  # or false
report_generated_at: 2026-04-24T22:30:00Z
gap_count: 0
canary_pass_rate: 100
```

`clawcode sync set-authoritative clawcode --confirm-cutover` reads this. Refuses unless:
- `cutover_ready: true`
- AND `report_generated_at` within 24h of invocation

Escape hatch: `--skip-verify` flag. When set, writes an audit-log entry to `~/.clawcode/manager/cutover-ledger.jsonl` with `{action: 'skip-verify', reason: <operator-provided>, timestamp}` and allows the flip. Emergency-only.

### D-10: Reversibility via ledger rewind
`clawcode cutover rollback --ledger-to <timestamp>` rewinds all ledger rows with timestamp > target, reversing each fix in LIFO order:
- `missing-memory-file` copy → delete the target file
- `missing-skill` → remove skills[] entry via updateAgentSkills + delete skill dir
- `model-not-in-allowlist` → remove from allowedModels[] via updateAgentConfig
- Accepted destructive → restore pre-change content from the ledger's `preChangeSnapshot` field (captured before apply)

Additive fixes are trivially reversible (just delete/remove). Destructive fixes require snapshot capture at apply time — ledger row stores full pre-change content sha256 + compressed blob for files < 64KB. Files > 64KB logged as "irreversible-without-backup" and excluded from rollback.

### Claude's Discretion

- **Ledger format:** JSONL append-only (no binary encoding), matches Phase 84 skills-ledger.jsonl convention
- **Canary channel choice:** use `1492939095696216307` (recently freed by the OpenClaw removal earlier today) as the canary channel since fin-acquisition is already bound there in clawcode.yaml
- **Intent clustering depth:** top 20 intents by raw count; weight adjustments (recency decay, tool-use-bearing intents) deferred to Phase 93+
- **Ingestor pagination:** Discord fetch_messages 100/request; sleep 500ms between requests for rate-limit politeness; retry with exponential backoff on 429
- **Chunking threshold:** if Discord history JSONL > 50K messages, profiler runs per-30-day-window and merges; threshold is a constant in source (`PROFILER_CHUNK_THRESHOLD_MSGS = 50000`)
- **Command shape:** `clawcode cutover verify --agent <name> [--apply-additive] [--dry-run] [--depth-msgs N] [--depth-days N] [--output-dir <path>]` plus `clawcode cutover rollback --ledger-to <timestamp>`. New `cutover` subcommand group mirrors `sync` structure from Phase 91.
- **Embed batching:** if > 10 destructive gaps, emit ONE summary embed with select-menu of top 10 + "load more" button; tiny fleets (< 10) get one embed per gap
- **Canary response timeout:** 30s per prompt per path; timeout = failure

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (zero new npm deps — v2.2 discipline preserved)
- **`plugin:discord:fetch_messages`** (Claude Agent SDK MCP tool) — Discord history ingestor
- **`src/memory/conversation-store.ts`** — ConversationStore DB + origin_id idempotency pattern (Phase 80)
- **`src/config/updateAgentModel.ts`, `updateAgentSkills.ts`, `updateAgentMcpServers.ts`, `updateAgentConfig.ts`** — atomic YAML writers w/ secret scan (Phase 86/90-07)
- **`src/ipc/protocol.ts` — `list-mcp-status`** — Phase 85 target-side MCP runtime state
- **`src/sync/sync-runner.ts`** — rsync primitives + exclude-filter (Phase 91) for additive file copies
- **`src/discord/slash-commands.ts`** — inline-short-circuit pattern for `/clawcode-*` commands + EmbedBuilder + ButtonBuilder (Phase 85/86/88)
- **`src/manager/daemon.ts`** — IPC handler registration + pure-fn extraction pattern (Phase 86 handleSetModelIpc)
- **TurnDispatcher.dispatch** (Phase 58/83) — reuse for profiler LLM pass + canary invocations; `dispatchStream` for Discord bot canary
- **`src/cli/commands/sync.ts`** (Phase 91) — CLI subcommand-group scaffolding pattern; mirror for `cutover verify/rollback`

### Established Patterns
- **Typed discriminated unions for outcomes**: Phase 84 `SkillCopyOutcome`, Phase 86 `ModelUpdateOutcome`, Phase 88 `SkillInstallOutcome` (8 kinds), Phase 90-04 extended to 11 — `CutoverGap` extends this pattern to 8 kinds w/ exhaustive switch enforcement
- **Atomic YAML writer discipline**: parseDocument AST + temp+rename + Zod re-parse roundtrip + preserveComments
- **Pure-fn IPC handlers**: `handleSetModelIpc` / `handleSetEffortIpc` extracted from daemon.ts for testability; `handleCutoverVerifyIpc` follows same shape
- **Ledger-JSONL witness**: Phase 82 migration-ledger, Phase 84 skills-ledger v2.2, Phase 88 marketplace-ledger — append-only, operator-readable, drives rollback
- **Inline-handler short-circuit in slash-commands.ts**: Phase 85/86/87/88 all apply this; cutover Accept/Reject/Defer buttons follow suit
- **Origin_id idempotency**: Phase 80 (memory-translator), Phase 91-03 (conversation-turn-translator). Cutover ingestor uses Discord message_id as origin_id in staging DB.

### Integration Points
- `src/cli/index.ts` — add `cutover` subcommand group after `sync` registration (line ~60)
- `src/ipc/protocol.ts` — add `cutover-verify`, `cutover-apply-additive`, `cutover-button-action`, `cutover-rollback` IPC methods
- `src/manager/daemon.ts` — register the 4 new IPC handlers; closure-based intercept before routeMethod
- `src/discord/slash-commands.ts` — `/clawcode-cutover-verify` and `/clawcode-cutover-status` slash commands; button-interaction handler for cutover-* customIds
- `scripts/systemd/` — NO new timers (this is operator-initiated, not scheduled; diverges from Phase 91)
- Phase 91 `set-authoritative` command at `src/cli/commands/sync-set-authoritative.ts` — add precondition check reading CUTOVER-REPORT.md

</code_context>

<specifics>
## Specific Ideas

- **Canary channel ID:** 1492939095696216307 (recently freed from OpenClaw by this session's config edit; already in fin-acquisition's channels[] via prior Option-A remap)
- **OpenClaw host:** jjagpal@100.71.14.96 (reuse Phase 91 SSH key path at /home/clawcode/.ssh/openclaw_unraid)
- **Staging root:** /home/clawcode/.clawcode/manager/cutover-staging/<agent>/ (mirrors Phase 91 sync-state.json location convention)
- **Report output:** /home/clawcode/.clawcode/manager/cutover-reports/<agent>/<timestamp>.md (one report per run; latest symlinked to /latest.md)
- **Ledger path:** /home/clawcode/.clawcode/manager/cutover-ledger.jsonl (single file, all agents — per-line agent field)
- **Discord history: fin-acquisition's channels from current clawcode.yaml:** 1471307765401129002 (admin-clawdy) + 1492939095696216307 (former fin-test, now fin-acquisition)

</specifics>

<deferred>
## Deferred Ideas

- Fleet-wide cutover verifier for fin-playground, general, projects, etc. — Phase 93+ once fin-acquisition proves the pattern
- Automated MEMORY.md content auto-merge — stays propose-and-confirm permanently (operator judgment required for curated memory)
- Live-conversation replay against ClawCode — too non-deterministic (LLM nondeterminism + time-sensitive tool results); Discord history is the contract
- Regression/CI integration — cutover is a one-shot gate, not a daily check
- Intent weighting (recency decay, tool-use-bearing prioritization) — top-20-by-count is fine for first pass
- Button-paginated destructive-gap summary when N > 10 destructive — first pass emits one embed per gap up to 25, then paginates
- Auto-repair of Phase 85 MCP verbatim errors — out of scope; operator resolves via existing /clawcode-tools surface

</deferred>
