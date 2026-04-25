# Phase 95: Memory Dreaming — Autonomous Reflection & Consolidation - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Operator-locked decisions captured inline

<domain>
## Phase Boundary

Add an idle-time autonomous reflection cycle to ClawCode's memory system. While agents are quiet, the daemon spawns short LLM "dream" passes that re-read recent memory chunks, infer new wikilinks/backlinks between related notes, promote frequently-referenced chunks toward MEMORY.md core, and write operator-readable reflections to `memory/dreams/YYYY-MM-DD.md`. Mirrors the OpenClaw "dreaming" behavior pattern but built natively on top of ClawCode's existing knowledge-graph + sqlite-vec + RRF retrieval infrastructure.

The user explicitly asked for this behavior pattern in the conversation that led into v2.6: "should we configure the dreaming/memory/obsidian style stuff that seems to be native to openclaw now". The answer was: keep ClawCode's superior memory infrastructure, but ADD the autonomous-reflection cycle that's the missing piece.

**NOT in scope:** replacing the existing memory store, changing the markdown vault structure, OpenClaw-style "memory rounds" UI (that's a Phase 96+ visualization layer if useful).

</domain>

<decisions>
## Implementation Decisions

### D-01: Idle-window detector — silence-based trigger
A dream pass fires when an agent has been silent for >N minutes (no incoming Discord messages, no scheduled task, no heartbeat-driven action). Silence is observed via `lastTurnAt` timestamp on SessionHandle (already tracked).

**Default thresholds:**
- Per-agent `dream.idleMinutes` (default 30 minutes, configurable; e.g., fin-acquisition might want 60min, content-creator might want 15min)
- Hard floor: 5 minutes (don't dream more often than that — burns tokens)
- Hard ceiling: 6 hours (if agent has been silent that long, daemon should still consider one final dream pass to consolidate the prior day's activity)

**Schedule:** croner timer per-agent with the configured cadence. Disabled fleet-wide by default; opt-in via `agents.*.dream.enabled: true`.

### D-02: Dream prompt builder — focused reflection input
Assembles the dream context from:
1. Recent memory chunks: most recent N (default 30) chunks from memory_chunks SQLite, sorted by last-modified desc
2. Current MEMORY.md (the core memory file) — full content
3. Recent conversation summaries: last 3 session-end summaries from ConversationStore (Phase 65)
4. Existing wikilinks: graph-edges.json snapshot

Total prompt budget: ≤32K input tokens. Truncate oldest chunks first if over budget.

Pure-DI builder; deps include MemoryStore, ConversationStore, fs.readFile.

### D-03: LLM dream pass — Haiku-class default
Single TurnDispatcher.dispatch call (NOT a streaming Discord turn — this is internal). Default model: `haiku` (cheap; dream passes are frequent + low-stakes). Operator can override per-agent via `agents.*.dream.model`.

**Output: structured JSON with 4 sections:**
```json
{
  "newWikilinks": [{"from": "memory/X.md", "to": "memory/Y.md", "rationale": "..."}],
  "promotionCandidates": [{"chunkId": "...", "currentPath": "memory/X.md", "rationale": "...", "priorityScore": 0-100}],
  "themedReflection": "1-3 paragraph narrative summary of recent activity",
  "suggestedConsolidations": [{"sources": ["memory/A.md", "memory/B.md"], "newPath": "memory/consolidations/X.md", "rationale": "..."}]
}
```

Schema-validated via zod; LLM emits structured output (response_format JSON-schema mode if Haiku supports, else extract-and-parse fallback).

### D-04: Auto-apply additive results
- **newWikilinks:** apply via existing Phase 36-41 auto-linker (`src/memory/auto-linker.ts`) — additive, idempotent, safe
- **promotionCandidates:** SURFACE in `/clawcode-memory` dashboard for operator review; do NOT auto-edit MEMORY.md (operator curates the core file)
- **themedReflection:** written to dream log (D-05); not applied
- **suggestedConsolidations:** SURFACE for operator review; do NOT auto-merge files

Auto-apply scope is intentionally narrow: only purely additive operations (new wikilinks). Anything that mutates MEMORY.md or merges files is operator-confirmed.

### D-05: Dream log writer — atomic markdown emission
File: `~clawcode/.clawcode/agents/<agent>/memory/dreams/YYYY-MM-DD.md`
- Date-bucketed (one file per day; multiple dream passes append sections)
- Atomic temp+rename (Phase 84/91 pattern)
- Each dream entry: `## [HH:MM UTC] Dream pass\n- Themed reflection: ...\n- New wikilinks: ...\n- Promotion candidates: ...\n- Suggested consolidations: ...\n- Token cost: input/output\n- Duration: Xs`

Operator-readable. Lives in the workspace memory tree → automatically synced via Phase 91 (no extra plumbing needed).

### D-06: Cron timer per-agent
Croner schedule wired in agent-bootstrap. Each agent's `dream.idleMinutes` becomes the cron cadence (e.g., 30min → every 30min, check if idle, if yes → fire dream pass).

Schedule registration mirrors existing schedules pattern (Phase 47/55 cron + heartbeat). Schedule label: `dream`. Visible in `/clawcode-status` schedule list.

**Idle check at fire time:**
- If `now - lastTurnAt < dream.idleMinutes * 60 * 1000` → skip (agent active)
- If `now - lastTurnAt > 6h` → fire (long-idle bound from D-01)
- Else → fire

### D-07: CLI + Discord slash for manual trigger
- `clawcode dream <agent>` — operator-driven manual dream pass; runs synchronously, prints output JSON + dream-log path
- `/clawcode-dream` Discord slash — admin-only ephemeral; triggers a dream pass for the agent owning that channel; replies with EmbedBuilder showing themed reflection + counts

Both paths reuse the same core dream-pass primitive; CLI wraps with stdout printing, Discord wraps with EmbedBuilder rendering.

### Claude's Discretion

- **Dream-pass primitive shape:** `runDreamPass(agentName, deps): Promise<DreamPassOutcome>` — pure-DI, deps include memoryStore, conversationStore, fs, dispatcher, log
- **DreamPassOutcome union:** `{kind: "completed", result: DreamResult, durationMs, tokensIn, tokensOut} | {kind: "skipped", reason: "agent-active" | "disabled"} | {kind: "failed", error: string}`
- **Token budgeting:** input prompt capped at 32K tokens; output capped at 4K tokens; if exceeded, dream pass returns `failed` with diagnostic — recovery via TOOL-04-class auto-recovery (Phase 94) is out-of-scope here
- **Dream log rotation:** files older than 90 days move to `memory/dreams/archive/YYYY-MM-DD.md` on a daily cleanup task; archive itself is purged after 1 year (configurable via `defaults.dream.retentionDays`)
- **Schema additions:** `agents.*.dream?: {enabled, idleMinutes, model, retentionDays?}` — 9th application of additive-optional schema blueprint; Phase 94's TOOL-10 file-sharing-directive style of nested config under per-agent
- **Cost guardrail:** track per-agent dream token spend in `~/.clawcode/manager/dream-budget.jsonl`; if monthly spend > $X (configurable; default $5/agent/month), pause auto-dreams + alert admin-clawdy
- **Knowledge graph wiring:** newWikilinks invocation goes through existing Phase 36-41 `applyAutoLinks` function; if it doesn't accept the LLM-suggested format directly, write a thin adapter
- **Test strategy:** dream-pass primitive tested via DI stubs (mock dispatcher returns structured JSON, verify auto-apply called, dream log written); croner schedule tested by mocking clock + advancing time; integration tested by spawning a real agent in CI fixture, sending one Discord message, waiting 30+1 minutes (or fast-forwarded clock), asserting dream-log file appears

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (zero new npm deps preserved)
- **`src/memory/conversation-store.ts`** (Phase 65) — last-3-summaries query for D-02
- **`src/memory/memory-store.ts`** (Phase 36-41 + Phase 90) — recent N chunks query for D-02
- **`src/memory/auto-linker.ts`** (Phase 36-41) — applies new wikilinks for D-04
- **TurnDispatcher.dispatch** (Phase 58/83) — LLM pass in D-03
- **`src/agents/session-handle.ts` `lastTurnAt`** — silence detection for D-01
- **`src/scheduler/croner.ts`** — cron timer infra; mirror agents.*.dream registration after agents.*.heartbeat
- **`src/sync/sync-runner.ts`** (Phase 91) — atomic temp+rename pattern for D-05
- **`src/discord/slash-commands.ts`** (Phase 85/86/88) — inline-short-circuit + EmbedBuilder for D-07
- **`src/cli/commands/sync.ts`** (Phase 91) — subcommand-group pattern for D-07's `clawcode dream <agent>`

### Established Patterns
- **Phase 83/86/89/90/92/94 additive-optional schema blueprint** (9th application — agents.*.dream) — v2.5/v2.6 migrated configs parse unchanged
- **Pure-DI primitives + production wiring at daemon edge** (Phase 91/94 idiom)
- **Atomic temp+rename for state files** (Phase 83/91/94)
- **Discriminated-union outcomes** (DreamPassOutcome — 3 variants per Phase 84/86/88/90/92/94 pattern)
- **Croner per-agent schedule** (existing heartbeat + scheduled-task pattern)

### Integration Points
- `src/manager/agent-bootstrap.ts` — register dream cron schedule alongside heartbeat
- `src/manager/session-manager.ts` startAgent() — fire-and-forget initial dream-pass IS NOT done (we wait for first idle window)
- `src/config/schema.ts` — agents.*.dream optional + defaults.dream optional resolver
- `src/cli/commands/dream.ts` (NEW) + `src/cli/index.ts` (register subcommand)
- `src/discord/slash-commands.ts` — /clawcode-dream slash + dispatch
- `src/manager/daemon.ts` — `run-dream-pass` IPC method for CLI + Discord triggers
- `src/manager/dream-pass.ts` (NEW) — the primitive
- `src/manager/dream-prompt-builder.ts` (NEW) — D-02 builder
- `src/manager/dream-log-writer.ts` (NEW) — D-05 writer

</code_context>

<specifics>
## Specific Ideas

- **Default dream prompt template** (the system prompt portion of D-03):
  ```
  You are <agent>'s reflection daemon. Your job is to read recent memory chunks, the core MEMORY.md, recent conversation summaries, and the existing wikilink graph, then emit a structured reflection.

  Output JSON ONLY (no prose). Schema:
  {newWikilinks, promotionCandidates, themedReflection, suggestedConsolidations}

  Focus on:
  - Connections that are NEW (not already in graph-edges.json)
  - Chunks referenced 3+ times in recent memory but NOT in MEMORY.md (promotion candidates)
  - Themes spanning multiple recent chunks (consolidation candidates)
  - 1-3 paragraph narrative on what happened recently
  ```

- **Dream log file content sample:**
  ```markdown
  # Dream log — fin-acquisition — 2026-04-25

  ## [03:00 UTC] Dream pass (idle 35min, model=haiku)

  **Themed reflection:** Recent activity centered on cutover verification debugging. fin-acquisition crashed during Phase 94 deploy; root cause was workspace path drift from a surgical edit. Recovery succeeded after path correction. The day's work also surfaced 6 OpenClaw agents that route through anthropic-direct rather than clawcode/* — Jas plans to flip them once ClawCode equivalents exist.

  **New wikilinks (3):**
  - memory/2026-04-25-cutover-fix.md → memory/2026-04-22-phase91-deploy.md (related: workspace path drift recurring pattern)
  - memory/procedures/finmentum-content-mcp-restart.md → memory/2026-04-25-stale-ip-fix.md
  - memory/vault/openclaw-anthropic-routing.md → memory/2026-04-25-fin-tax-binding.md

  **Promotion candidates (2):**
  - "OpenClaw agents that route via anthropic-direct: work, shopping, local-clawdy, kimi, card-planner, card-generator" → consider promoting to MEMORY.md (referenced 4 times in last 24h)
  - "FINMENTUM_DB_HOST resolves via op://clawdbot/MySQL DB - Unraid/hostname not Python script default" → consider promoting (high signal-to-noise on cutover)

  **Suggested consolidations (1):**
  - memory/2026-04-25-{cutover-fix, finmentum-content-fix, fin-acquisition-restart}.md → memory/consolidations/v2.6-deploy-troubleshooting.md (3 files; same incident; consolidate for clean recall)

  **Cost:** 12,400 in / 1,800 out tokens · Duration: 4.2s
  ```

- **CLI signature:** `clawcode dream <agent> [--force] [--model haiku|sonnet|opus] [--idle-bypass]`
- **Discord slash signature:** `/clawcode-dream agent:<name>` — admin-only via Phase 85 admin gate
- **Per-agent default values:**
  - `dream.enabled: false` (opt-in fleet-wide)
  - `dream.idleMinutes: 30`
  - `dream.model: haiku`
  - `dream.retentionDays: 90`

</specifics>

<deferred>
## Deferred Ideas

- OpenClaw-style "dream feed" Discord embed (real-time stream of dream reflections) — UI layer; Phase 96+ if useful
- Cross-agent dream consolidation (one master dream pass that reads all agents' memory for systemic patterns) — too invasive; per-agent dreaming first
- Dream pass that auto-merges suggested consolidations after operator approval — initial pass is propose-only; auto-merge with confirm-flow can come later
- Dream model fine-tuning or prompt iteration based on quality feedback — manual prompt for v1; iterate later
- ML-driven idle-window detection (don't dream when user is "about to message" predicted by recent typing patterns) — over-engineering for v1
- Dream-cost forecasting + budget UI — token tracking ships, advanced budgeting deferred
- Dream history search / recall via `clawcode dream search` — operator-readable markdown is enough for v1

</deferred>
