# Phase 115: Memory + context + prompt-cache redesign — Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Mode:** Operator delegated all gray-area decisions to Claude with directive *"decide what's best to achieve optimal results with quick responses based on my usage."* Defaults locked from research synthesis (`.planning/research/115-memory-redesign/`) + alignment with operator's headline priorities (responsiveness + retention) + prior phase decisions (Phase 90 / 95 / 99) + the specific 11-agent / Discord-paced fleet topology.

<domain>
## Phase Boundary

Replace today's "inject everything every turn" memory model — which produced the 2026-05-07 fin-acquisition incident (32,989-char `systemPrompt.append` → Anthropic 400 `invalid_request_error` masquerading as a billing-cap message; ~3 hours operator + agent cost; Ramy mid-thread blocked) — with three converging changes:

1. **Bounded always-injected tier** with hard cap, real enforcement (no more `warn-and-keep` no-op), head-tail truncation fallback, priority-dream-pass overflow trigger.
2. **Tool-mediated lazy recall** — four new MCP tools exposed to every agent so older context is one tool-call away, not always-injected text. Eliminates the "Apr 26 was last solid memory" failure mode.
3. **Cache-breakpoint repositioning + tool-response cache** — restore prompt-cache hit rate (regressed 2026-03-06 from 1h → 5m TTL upstream) AND eliminate repeated MCP tool round-trips.

Plus the embedding upgrade Phase 90 explicitly punted to "a separate phase" (this one), the diagnostic surface changes that would have caught today's incident in real-time, and the benchmark/dashboard integration that proves whether the changes worked.

**In scope (16 of 17 roadmap sub-scopes — sub-scope 6 measurement-gated, see Decision D-12):**
1, 2, 3, 4, 5, 6 (gated), 7, 8, 9, 10, 11, 12, 13(a-c), 14, 15, 16(a-c), 17(a-c).

**Folds in (per roadmap):**
- Phase 999.40 — fully absorbed as sub-scope 15. Will be marked `SUPERSEDED-BY-115` in roadmap.
- Phase 999.41 — sub-scope 13(a) carve-out (rolling-summary fail-loud guard for `summarize-with-haiku.ts`); rest of 999.41 stays.
- Phase 999.42 — sub-scopes 7, 10, 11 absorb the FTS5 + tier model parts; auto-skill creation explicitly NOT in 115 scope, stays in 999.42.

**Out of scope (deferred, named for clarity):**
- Auto-skill creation pipeline (stays in 999.42)
- Cross-host memory sync (single-host only this phase)
- Cross-agent KG (each agent's memory remains isolated; finmentum workspace-tier opt-in is Tier 1 only — see D-13)
- Switching off `better-sqlite3` + `sqlite-vec`
- Operator-readable memory format (operator confirmed not required — int8 quantized vectors fine)
- Three-phase Hermes-style compression beyond audit (sub-scope 9 ships only the cheap no-LLM Phase 1; LLM-driven Phases 2 + 3 deferred)

</domain>

<decisions>
## Implementation Decisions

### Tier 1 budget — D-01 through D-05 (was operator gray area `a`)

**D-01 — Bounded always-injected tier hard cap: `INJECTED_MEMORY_MAX_CHARS = 16_000` (≈4K tokens).**
- Covers SOUL.md fingerprint + IDENTITY.md head + capability manifest skeleton + MEMORY.md + USER.md + recent-reflections snippet.
- Synthesis recommendation §1.1, Hermes-proven precedent (`CONTEXT_FILE_MAX_CHARS = 20_000` is their value; 16K is tighter for our 11-agent / 8-12 GB headroom box).
- Why not 12K: too tight for fin-acq's curated memory growth (it has ~1,182 memories already). Why not 20K: gives no margin under the fin-acq 33K failure point.
- Enforced at **assembly time** (not write time — write-time enforcement requires a curation pass we're not building this phase). Hermes 70/20 head-tail truncation as the fallback.

**D-02 — Total stable-prefix cap: `STABLE_PREFIX_MAX_TOKENS = 8000` (the *enforced* hard cap).**
- This is the OUTER cap. Total of `systemPromptDirectives + identity + soul + hotMemories + skillsHeader + toolDefinitions + filesystemCapabilityBlock + delegatesBlock + graphContext` (per `context-assembler.ts:750-848`).
- Bounded tier (D-01) is a *subset* of this cap.
- **Numerical drift in roadmap acknowledged:** roadmap line 95 says ≤ 8K tokens hard cap; line 113 says fin-acq ≤ 12K tokens at session start; line 114 says fleet p95 ≤ 10K tokens. **Resolution:** 8K is the *enforced* hard cap (assembly truncates at this number); 12K (fin-acq session start observed-target) and 10K (fleet p95 observed-target) are *delivery* targets — what the cap should produce in normal load. The cap is stricter than the targets so we have safety margin. Acceptance criteria in `115-VERIFICATION.md` (when the verifier runs) should compare measured stable-prefix sizes against 8K hard cap (P0 — must hold) AND 10K fleet p95 / 12K fin-acq (P1 — should hold).
- Per-section budgets (in tokens, NOT chars — fixes existing chars-vs-tokens unit mismatch in `context-assembler.ts:494-513`):
  | Section | Budget | Strategy |
  |---|---|---|
  | `systemPromptDirectives` | 500 | truncate-bullets |
  | `identity` (compound) | 4000 (≈D-01's 16K chars) | drop-lowest-importance, **NOT** `warn-and-keep` |
  | `soul` | folded into `identity` (always `""` today per `session-config.ts`) | n/a |
  | `hotMemories` | 1000 | drop-lowest-importance |
  | `skillsHeader + toolDefinitions` | 2000 | truncate-bullets (existing `DEFAULT_BUDGETS.toolDefinitions`) |
  | `filesystemCapabilityBlock + delegatesBlock` | 500 | renderer-bounded |
  | `graphContext` | 0 (currently always empty) | n/a |

**D-03 — Replace `warn-and-keep` with real enforcement for `identity` and `soul`.**
- `enforceWarnAndKeep` at `context-assembler.ts:494-513` literally emits a warn record and returns input unchanged. **The operator's observed log line `section: identity, beforeTokens: 5773, budgetTokens: 1000, strategy: warn-and-keep` is the budget firing — and doing nothing.** Replace with `drop-lowest-importance` for `identity` (sectionable: SOUL fingerprint > IDENTITY.md > capability manifest > MEMORY.md last-loaded > older sections drop first) and `head-tail-truncate` (70/20) for `soul`-when-folded.
- The SDK accepts whatever string we send — there is no API-side budget. ALL enforcement is daemon-side at assembly time.

**D-04 — Overflow strategy: head-tail truncation (Hermes 70/20) + daemon-side warn surfaced to dashboard.**
- Truncation marker: `\n\n[TRUNCATED — N tokens dropped, dream-pass priority requested]\n\n` between head and tail.
- Daemon-side log line `[diag] tier1-truncation agent=<N> droppedTokens=<M> file=<which-section>` (sub-scope 13c). Operator gets visibility into truncation events instead of the marker being silently embedded INSIDE the agent's prompt where they never see it.

**D-05 — Priority dream-pass trigger.**
- When tier-1 truncation fires twice in succession within 24h for the same agent, the daemon schedules a *priority* dream-pass at the next 5-minute idle window (Phase 95 normally fires at 30-min idle). The dream-pass's job is to compact MEMORY.md so the next assembly fits.
- Tier-1 truncation event count is recorded per-agent in `traces.db` for trend visibility on the dashboard (sub-scope 16c).

---

### Embedding upgrade + migration — D-06 through D-09 (was operator gray area `c`)

**D-06 — Model: `BAAI/bge-small-en-v1.5` (Apache 2.0, MTEB 62.17, 384-dim native, ~33MB ONNX).**
- Why bge-small over alternatives:
  - **vs MiniLM-L6** (current, 2019-vintage, MTEB ~56): real recall improvement (~5–7 MTEB points); same 384-dim so sqlite-vec schema is compatible with simple column rename (no MRL truncation needed for default path).
  - **vs Jina v5-nano**: ONNX path is larger and less battle-tested in `@huggingface/transformers`.
  - **vs gte-small** (MTEB ~62): bge-small has stronger ONNX deployment proof + better long-context degradation.
  - **vs stay**: 5-7 MTEB points is real on memory queries; operator confirmed memory does not need to be human-readable, removing the only constraint that argued for staying.
- Confidence: HIGH. Two independent paths confirm: synthesis §2.1 + perf-caching-retrieval research §3 (both produced by parallel research agents).

**D-07 — Quantization: int8 in sqlite-vec (`vec0` column type `int8`).**
- Operator constraint released: memory does not need to be human-readable.
- ~78% storage reduction at <2% recall loss, per perf-caching-retrieval research §3.
- ~17ms KNN at 100k vectors with int8 vs ~12ms at float32 — negligible at our scale (10K-100K vectors per agent).
- Implementation note: `embedder.ts` quantizes the float32 ONNX output to int8 immediately before write; query-side dequantizes within sqlite-vec native path.

**D-08 — Migration approach: dual-write + background batch re-embed (NOT one-shot, NOT lazy on-access).**
- Why not one-shot: 11 agents × ~10K-100K vectors each = single batch operation across the fleet with no rollback path. Phase 99-A's `getAgentMemoryDbPath` regression pin (CI grep enforcement) demonstrates we got bitten by single-path migrations before.
- Why not lazy on-access: synthesis §1.5 requires async-only writes; on-access re-embed lands embed cost on the response path (latency hit, exactly what this phase is trying to fix).
- Migration phases:
  1. **T+0 → T+7d**: dual-write transition. New writes embed with both MiniLM (legacy) and bge-small-int8 (new). Both vectors stored in `vec_memories` (existing column) + new `vec_memories_v2` virtual table. Reads still use MiniLM.
  2. **T+7d → T+14d**: background batch re-embed of historical memories. Background job runs at 5% CPU budget when daemon is otherwise idle. Per-agent progress tracked in `migrations` table; resumable across daemon restarts.
  3. **T+14d**: cutover. Reads switch to v2; v1 column dropped after 24h soak.
- Migration state machine and progress: `migrations.embeddingV2.<agentName>` tracked in daemon state. Operator can force-cutover or rollback via `clawcode memory migrate-embeddings --force-cutover|--rollback`.

**D-09 — Re-embed cost discipline.**
- bge-small-en-v1.5 ONNX inference: ~50ms per vector on the box's CPU.
- 11 agents × avg 30K vectors = ~330K vectors total. At 50ms each = 4.6 hours of CPU time. At 5% budget = ~92 wall-clock hours = 4 days.
- This fits the T+7d → T+14d window comfortably with margin.
- Migration runs OFF the response path. Discord-active agents always have priority over migration CPU.

---

### Phase 95 promotion override — D-10 through D-11 (was operator gray area `d`)

**D-10 — Decision: HYBRID (matches synthesis §1.6 + Phase 95 D-04 spirit + sub-scope 8 intent).**

Phase 95's existing D-04 lock: *"Auto-apply scope is intentionally narrow: only purely additive operations (new wikilinks). Anything that mutates MEMORY.md or merges files is operator-confirmed."*

Phase 115 sub-scope 8 proposes: *"Auto-apply with operator-veto: dream-pass writes consolidated entries into Tier 1 MEMORY.md, dedupes against existing, demotes superseded chunks."*

**Resolution — three-tier auto-apply policy (replaces Phase 95 D-04, not silently — D-04 was correct for its time but the bounded-tier requirement creates new pressure):**

| Operation type | Auto-apply? | Confidence threshold | Operator veto window |
|---|---|---|---|
| `newWikilinks` | YES (unchanged from D-04) | n/a | none — additive only |
| `promotionCandidates` (additive: chunk → MEMORY.md *new* entry, no overwrite) | YES | `priorityScore >= 80` | 30-min Discord summary; auto-apply if no veto |
| `promotionCandidates` (mutating: chunk → MEMORY.md edit overwriting existing entry) | NO | n/a | operator-required |
| `suggestedConsolidations` (file merges) | NO | n/a | operator-required (D-04 unchanged) |
| **Forced-priority pass** (D-05 trigger when tier-1 over cap) | YES — promotion ALLOWED to mutate | overrides priorityScore floor | 30-min summary; auto-apply if no veto |

**D-11 — Promotion review channel + summary format.**
- Each agent's priority dream-pass posts a structured summary to its Discord channel:
  ```
  [dream-pass priority] Tier 1 over cap — proposed compaction:
  - ADD: <new entry title> (priorityScore=<N>) [auto-apply in 30m]
  - EDIT: <existing entry> ← merge with <chunk> [veto-required]
  - MERGE: <file A> + <file B> → <file C> [veto-required]

  Veto: react with ❌, or `clawcode-memory-veto <run_id>`. Approve all: ✅.
  ```
- Agent-curated promotion via `clawcode_memory_archive` (lazy-load tool, sub-scope 7) bypasses this review window entirely — the agent's own decision is operator-trusted.

---

### Sub-scope sequencing + 1h-TTL + per-agent scoping — D-12 through D-15 (was operator gray area `b` + `e` + new sequencing)

**D-12 — Sub-scope 6 (1h-TTL) is measurement-gated, not binary.**

Roadmap line 42 already states *"Decision based on measured tool_use rate from `traces.db`."* Lock the gate explicitly:

- **6-A (ships in wave 3)**: Instrument `traces.db` to compute per-turn `parallel_tool_call_count` and per-agent `tool_use_rate_per_turn` (count of turns with ≥1 tool_use vs total turns). Add to dashboard.
- **6-B (gated)**: If measured `tool_use_rate_per_turn < 30%` across non-fin-acq agents (i.e., most turns are short Discord acks with no tools), ship direct-SDK fast-path mirroring `callHaikuDirect` in wave 4. The fast-path carries explicit `cache_control: { type: "ephemeral", ttl: "1h" }` blocks and recovers the 1h cache the CLI no longer offers (per perf-caching-retrieval research §1).
- **30% threshold provenance**: starting threshold — Claude pick, NOT a research-backed number. Sub-scope 6-A's measurement may refine. The 30% choice is intuition: if more than 30% of turns hit tools, the round-trip-bound latency dominates over cache-write tax, so 1h-TTL gives diminishing returns. Plan-phase or executor can adjust the threshold based on the first week of 6-A data; this is a knob, not a constant.
- **6-B punt path**: If measured rate ≥ 30%, defer to follow-on phase (CLI's 5m TTL is the right tradeoff for tool-heavy turns; direct-SDK fast-path saves nothing on those). Ship 6-A's measurement as the artifact for the next phase to decide.
- This way 6 ships if measurement supports it; otherwise 6 cleanly punts with the measurement that explains why.

**D-13 — Per-agent vs per-workspace tier scoping: per-agent default, per-workspace OPTIONAL via config.**

Phase 90 explicitly locked per-agent isolation for `memory_chunks`. Don't break that. But finmentum family (`finmentum-content-creator`, `fin-acquisition`, `fin-research`, etc.) shares `workspace: /home/jjagpal/.clawcode/agents/finmentum` (verified in `clawcode.example.yaml`) and Phase 75 SHARED-01 added the `memoryPath` per-agent override pattern so they can keep `memories.db` / `traces.db` / `inbox/` / `heartbeat.log` isolated while sharing SOUL/IDENTITY.

- **Default**: `defaults.memory.tier1ScopingPolicy: "per-agent"` (matches Phase 90 lock).
- **Opt-in**: workspace-level operators can flip to `"per-workspace"` via the same config knob.
- **Per-workspace mode storage**: workspace-level MEMORY.md at `<workspace>/MEMORY.md` (i.e., `~/.clawcode/agents/finmentum/MEMORY.md` for finmentum family — extends the existing pattern that already shares `<workspace>/SOUL.md` + `<workspace>/IDENTITY.md`) AND per-agent MEMORY.md at the agent's `memoryPath` location. Bounded-tier assembly merges both (workspace first as more general scope, agent second as more specific, deduped by entry-id).
- **Tier 2 (chunks) stays per-agent ALWAYS** — Phase 90 lock unchanged. Cross-agent chunk sharing is a different problem out of 115 scope. The `memories.db` Phase 75 isolation invariant is preserved.
- **Workspace MEMORY.md curation**: Phase 95 dreaming fires per-agent; promotionCandidates targeting "workspace" scope (a new field) get reviewed by ANY agent in the workspace via Discord summary. First-to-veto wins.
- **Planner discretion**: if the existing Phase 75 basePath structure produces unexpected friction (e.g., per-agent and per-workspace MEMORY.md write conflicts), planner may propose a different storage location during plan-phase; the *behavior* (workspace-shared bounded tier) is the lock, not the exact filesystem path.

**D-14 — Wave plan: 5 waves, ~10 plans (top of 6-10 range — phase is large but cleanly cuttable).**

| Wave | Plan # | Sub-scopes | Why grouped |
|---|---|---|---|
| **0 — Baseline** | 1 | 16(a) benchmark suite + 16(b) pre-115 baseline run | Lock today's broken numbers BEFORE any change. Without this we can't prove the phase worked. |
| **1 — Quick wins** | 2 | 2 (excludeDynamicSections) + 3 (wire memoryRetrievalTokenBudget) + 4 (tag-filter at hybrid-RRF) | All <100-line changes, low risk, immediate ROI. Drops fin-acq's stable prefix today by single-digit-percent. |
| | 3 | 13(a-c) (observability) + 14 (debug dump as flag) | Operator-side observability — let operator see the next prompt-bloat in real-time. Pure adds, no risk. |
| **2 — Structural** | 4 | 1 (hard tier-1 budget) + 11 (Tier 1 / Tier 2 formal split) + 9 (3-phase compression — Phase 1 only, no-LLM tool-output prune) | The structural backbone. Sub-scope 9's no-LLM Phase 1 is a free win bundled here. |
| | 5 | 5 (cache-breakpoint placement) | Cache architecture — independent of memory tier work; can run in parallel with plan 4 if executor permits. |
| | 6 | 7 (lazy-load memory tools — 4 new MCP tools) + 8 (Phase 95 dreaming as Tier 1 consolidation engine, hybrid policy from D-10) | Agent-facing surface + consolidation engine. Tightly coupled — ship together. |
| | 7 | 10 (embedding upgrade + dual-write migration kickoff) | Migration is long-running; kicks off here, completes in wave 4. |
| **3 — Performance** | 8 | 15 (MCP tool-response cache — folds 999.40) | Tool cache is independent; cleanest standalone plan. |
| | 9 | 17(a-c) (tool-latency methodology audit + parallel-tool-call) + 6-A (tool_use_rate measurement) | Performance instrumentation — sets up the gate for 6-B. |
| **4 — Closeout** | 10 | 12 (cross-agent consolidation transactionality) + 16(c) (dashboard surface) + 6-B (gated direct-SDK fast-path, IF measurement supports) + post-115 benchmark re-run + perf-comparisons report | Reliability + measurement closeout. Migration completes in this wave. |

Total: **10 plans across 5 waves**, top of the 6-10 range. Plans 4 and 5 can wave-2-parallel if the executor's wave-based parallelization permits (per `.planning/config.json` `parallelization: true`).

**D-15 — No new sub-scope additions during planning.**

Sub-scope list is locked. If new ideas surface during plan-phase or execution, they go to Deferred Ideas section, NOT into this phase. Roadmap is detailed enough.

---

### Claude's Discretion (planner can choose)

The following implementation details are NOT pre-decided and the planner can choose:
- Exact file/module locations for new code (e.g., where the new MCP tool registry lives — under `src/memory/tools/` is the natural choice but planner refines)
- Internal interface shapes for the four new memory tools — planner specs from research synthesis §2.3
- Exact SQLite schema for `vec_memories_v2` (column naming, foreign-key strategy)
- Test fixtures for migration regression (per-agent, dual-write transition, batch re-embed checkpointing)
- Discord embed format for priority-dream-pass review summary (text fallback if Discord embed budget exceeded)
- Specific DI shapes for `dream-auto-apply.ts` extension to support D-10's three-tier policy
- Background-job CPU-budget mechanism (signals + nice level vs in-process scheduler vs cron)
- Exact name of the `clawcode_memory_*` MCP tools (research synthesis suggests `clawcode-memory-search` / `-recall` / `-edit` / `-archive`; planner can prefix differently if it conflicts with existing tool names)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 115 source-of-truth (research outputs — already complete)

- `.planning/research/115-memory-redesign/sota-synthesis.md` — convergent SOTA pattern + Phase 115 design recommendation. **Highest-priority read.**
- `.planning/research/115-memory-redesign/codebase-memory-retrieval.md` — current memory subsystem map, 21 specific pain points with file:line citations
- `.planning/research/115-memory-redesign/codebase-prompt-assembly.md` — current prompt assembly trace, "warn-and-keep" no-op confirmation, all uncapped sources
- `.planning/research/115-memory-redesign/sota-hermes-architecture.md` — Hermes 20K-char cap + FTS5+vec + 3-phase compression + cache-breakpoint placement
- `.planning/research/115-memory-redesign/sota-hierarchical-memory.md` — Letta 4-tier + sleep-time-compute paper (arXiv:2504.13171) alignment with our Phase 95
- `.planning/research/115-memory-redesign/sota-memory-products.md` — Mem0 / Zep / Cognee / Anthropic memory tool / ChatGPT memory comparison matrix
- `.planning/research/115-memory-redesign/perf-caching-retrieval.md` — Anthropic prompt caching deep-dive, **2026-03-06 CLI 1h→5m TTL regression** (GitHub anthropics/claude-code#46829), `excludeDynamicSections: true` not currently set, embedding-model + int8-quantization upgrade path

### Roadmap entry (the task statement)

- `.planning/ROADMAP.md` `### Phase 115:` section — 17 sub-scope candidates, 6 perf targets, fold-in list, out-of-scope list, acceptance criteria, backups + temp-debug-code revert list

### Prior phase decisions that constrain Phase 115

- `.planning/phases/95-memory-dreaming-autonomous-reflection-and-consolidation/95-CONTEXT.md` — D-04 locked operator-review-only for promotionCandidates / suggestedConsolidations. Phase 115 D-10 explicitly extends D-04 with three-tier hybrid policy.
- `.planning/phases/90-clawhub-marketplace-fin-acquisition-memory-prep/90-CONTEXT.md` — locked per-agent memory_chunks isolation. Phase 115 D-13 keeps this for Tier 2; opens Tier 1 to per-workspace as opt-in.
- `.planning/phases/99-memory-translator-and-sync-hygiene/99-CONTEXT.md` — sub-scope A's `getAgentMemoryDbPath` regression pin (CI grep enforcement). Phase 115 migration must not regress this.
- `.planning/phases/107-memory-pipeline-integrity-dream-json-vec-memories-orphan-cleanup/107-CONTEXT.md` — VEC-CLEAN-* (vec_memories orphan cleanup on memory delete). Phase 115's embedding migration must respect the cascade-delete invariant for both vec_memories and vec_memories_v2.

### Existing code we extend (line-cited)

- `src/manager/context-assembler.ts:494-513` — `enforceWarnAndKeep` no-op. **REPLACE** per D-03.
- `src/manager/context-assembler.ts:343` — `DEFAULT_PHASE53_BUDGETS` — extend per D-02 per-section budgets.
- `src/manager/context-assembler.ts:750-848` — stable prefix order. Sub-scope 5 cache-breakpoint placement reorders this.
- `src/manager/session-config.ts:262-902` — `buildSessionConfig` (the assembly orchestrator). Sub-scope 1's tier-1 cap enforcement lands here.
- `src/manager/session-config.ts:565-582` — where `memoryRetrievalTokenBudget` SHOULD be forwarded to `retrieveMemoryChunks` but isn't. Sub-scope 3 wires it.
- `src/manager/session-adapter.ts:619-628` — `buildSystemPromptOption` — the SDK shape `{type:"preset",preset:"claude_code",append:stablePrefix}` is locked. Sub-scope 2 sets `excludeDynamicSections: true` here.
- `src/manager/session-adapter.ts` — `debugDumpBaseOptions` helper (current allowlist of fin-acquisition + Admin Clawdy). Sub-scope 14 promotes to config flag.
- `src/manager/dream-auto-apply.ts:1-174` — Phase 95 auto-apply implementation. Sub-scope 8 + D-10 extends to three-tier policy.
- `src/manager/haiku-direct.ts` — direct-SDK OAuth-bearer path. Sub-scope 6-B fast-path mirrors this.
- `src/memory/embedder.ts` — current MiniLM embedder. Sub-scope 10 + D-06/D-07 swap to bge-small-int8.
- `src/memory/store.ts` — vec_memories CRUD + delete cascade (Phase 107). Sub-scope 10 adds vec_memories_v2 dual-write.
- `src/memory/search.ts` — hybrid retrieval. Sub-scope 4 adds tag/source filter; sub-scope 7's `clawcode_memory_search` tool wraps this.
- `src/memory/compaction.ts` — Hermes-style audit target for sub-scope 9.

### Anthropic SDK + caching references

- `node_modules/@anthropic-ai/claude-agent-sdk/src/sdk-types.ts:73,90` — `excludeDynamicSections` flag definition. Currently undocumented in our config.
- `platform.claude.com/docs/en/build-with-claude/prompt-caching` — invalidation cheat sheet, 4-breakpoint limit, 1.25× / 2.0× cache-write costs
- GitHub issue `anthropics/claude-code#46829` — 2026-03-06 CLI TTL regression (closed "not planned"). Must be referenced in sub-scope 6-A docstring so future operators understand the gate.

### Production deployment

- `scripts/deploy-clawdy.sh` — deploys to clawdy (100.98.211.108). Migration kickoff in wave 2 plan 7 happens via this path; respect Ramy-active no-deploy memory.
- `~/.clawcode-deploy-pw` — sudo password (chmod 600).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`enforceSummaryBudget`** (Phase 53, `src/manager/context-assembler.ts:343`) — the only correctly-bounded persistent-store reader today. Treat as the model for sub-scope 1's real budget enforcement: it actually drops content rather than warning-and-keeping.
- **Phase 52 stable-prefix tracking** (`latestStablePrefixByAgent` cache + `priorHotStableToken` cache-bust check) — sub-scope 5 cache-breakpoint placement extends this. Don't reinvent.
- **Phase 90 MEM-03 `retrieveMemoryChunks` hybrid-RRF** — the right per-turn retrieval primitive. Sub-scope 4 just adds filters + sub-scope 3 wires the budget knob.
- **Phase 95 `dream-cron.ts` + `dream-auto-apply.ts`** — already produces `promotionCandidates` / `suggestedConsolidations` / `themedReflection` that today never reach the prompt. Sub-scope 8 wires them per D-10 hybrid policy.
- **Phase 105 `callHaikuDirect`** (`src/manager/haiku-direct.ts`) — direct-SDK OAuth-bearer path. Sub-scope 6-B fast-path mirrors this exactly (same OAuth bearer plumbing, different tool surface).
- **Phase 99 sub-scope N SDK-level `disallowedTools`** — same wiring pattern for new memory tools (sub-scope 7).
- **Phase 100 GSD-04 per-agent cwd plumbing** — same shape for per-agent prompt budget config (sub-scope 1's `tier1MaxChars` + `stablePrefixMaxTokens` per-agent overrides).
- **`mutableSuffix`** on the SDK options — already supports prepend-to-user-msg content. The natural place for per-turn lazy-recall results to land if the agent calls `clawcode_memory_search` synchronously during turn assembly.
- **Phase 107 VEC-CLEAN-* atomic cascade** — must extend to `vec_memories_v2` during migration window.

### Established Patterns

- **Per-agent SQLite isolation** (`~/.clawcode/agents/<name>/memory/memories.db`) — Phase 90 lock; Phase 99-A's regression pin enforces via CI grep. Sub-scope 10 migration must respect this — every per-agent migration step is its own DB transaction.
- **`db.transaction(() => { ... })` atomicity** (Phase 107 VEC-CLEAN-02) — both `memories` and `vec_memories` deletes inside one transaction. Sub-scope 10 dual-write must atomic-write to both vec_memories and vec_memories_v2.
- **Config hot-reload via ConfigWatcher** (Phase 88, commit `98ff1bc`) — sub-scope 1's per-agent budget overrides hot-reloadable via this path. Existing-session children keep old budget; new sessions pick up new budget.
- **JSONL audit-trail logs** — sub-scope 13(b) consolidation run-log mirrors existing `audit-trail.ts` shape.
- **Heartbeat framework** — sub-scope 9's no-LLM Phase 1 compaction can run as a heartbeat check rather than a synchronous step.

### Integration Points

- **`buildSessionConfig` (`session-config.ts:256-902`)** — central assembler; sub-scope 1, 2, 11 all land here.
- **`buildSystemPromptOption` (`session-adapter.ts:619-628`)** — SDK call boundary; sub-scope 2 sets `excludeDynamicSections` here, sub-scope 5 places cache breakpoint here.
- **`dream-cron.ts` + `dream-auto-apply.ts`** — sub-scope 8's three-tier policy + D-05's priority trigger land here.
- **`embedder.ts`** + `vec_memories` schema — sub-scope 10's bge-small-int8 swap lands here, gated by migration state machine.
- **MCP tool registry** (likely under `src/mcp/` or `src/tools/`) — sub-scope 7 four new tools register here; planner picks exact directory.
- **Dashboard panel rendering** — sub-scope 16(c) extends existing performance panel; the trace segments stay byte-identical (operator can compare historical SLOs).
- **`traces.db`** — sub-scope 6-A and 17(a/b) all write here. Schema additions: `parallel_tool_call_count`, `tool_use_rate_per_turn`, `tool_execution_ms`, `tool_roundtrip_ms`.
- **`/clawcode-status` slash command + dashboard** — sub-scope 13(a) `prompt-bloat-suspected` classifier surfaces here.

</code_context>

<specifics>
## Specific Ideas

- **Operator's exact words on memory format**: *"memory does not need to be human-readable — int8 quantized vectors fine."* This unlocks D-07's int8 quantization. Without this constraint release, we'd be stuck on float32 for inspection-from-CLI use cases.
- **Operator's headline priorities** (from roadmap line 17): *"Agent responsiveness speed → cache-breakpoint repositioning + 1h-TTL recovery + lazy memory recall + smaller stable prefix + bge-small int8 vectors"* AND *"Memory retention → tool-mediated recall over arbitrary horizon."* These are the two SLOs the phase optimizes for. Every decision in this CONTEXT.md is graded against them.
- **Reference architecture: Hermes**. The synthesis explicitly anchors on Hermes' design (`CONTEXT_FILE_MAX_CHARS = 20_000`, 70/20 head-tail truncation, three-phase compression, dynamic-after-cache-breakpoint placement). Phase 115 is closer to "Hermes-on-Claude-Code" than to a clean-slate redesign — which is correct, because Hermes already proved the architecture works.
- **Letta sleep-time paper convergence** (`arXiv:2504.13171`) — Phase 95 dreaming was designed independently and converged on Letta's architecture. This is strong validation; D-10's three-tier policy is the natural next step that paper's architecture also implies.
- **fin-acquisition incident specifics anchor every perf target**: 5,200ms first-token p50, 288s end-to-end p95, 92.8% cache hit (Ramy-paced active session) vs <30% (idle agents), 32,989-char `systemPrompt.append`. These numbers are the "broken baseline" sub-scope 16(b) locks in.
- **Backup files MUST NOT be garbage-collected until phase ships** (per roadmap line 125):
  - `.bak-pre-cwd-fix-20260507-150422` + `.bak-pre-resumegap-20260507-144315` (yaml)
  - `.bak-pre-billing-cleanup-20260507-154551` + `.bak-pre-poison-fix-20260507-144315` + `.bak-pre-summary-purge-20260507-153416` + `.bak-postcleanup-20260507-143641` (fin-acq DB)
  - `.credentials.json.bak-relogin-1778192734`
- **Temporary debug code MUST be reverted before shipping** (per roadmap line 130):
  - `src/manager/session-adapter.ts` `debugDumpBaseOptions` helper + `import { writeFile }` + dump call sites in createSession / resumeSession (currently allowlisted to fin-acquisition + Admin Clawdy). Sub-scope 14 promotes to a config flag form FIRST, then the hardcoded allowlist + import gets removed in the same plan.

</specifics>

<deferred>
## Deferred Ideas

Nothing surfaced during discussion that wasn't already in scope. Nothing was scope-creep-rejected.

For the record, the following are explicitly DEFERRED to follow-on phases (named so they don't get re-discovered):

- **Auto-skill creation pipeline** (Hermes 5+ tool-calls trigger). Stays in Phase 999.42.
- **Cross-host memory sync**. Single-host only this phase. Future phase if/when ClawCode multi-host is on the table.
- **Cross-agent KG (knowledge graph) sharing across agents.** Phase 115 keeps Tier 2 per-agent. Tier 1 workspace-scoping (D-13 opt-in) is the most we do here.
- **Three-phase Hermes-style compression beyond Phase 1.** Phases 2 (LLM mid-summarization) and 3 (drop oldest) deferred; sub-scope 9 ships only the cheap no-LLM Phase 1.
- **Switching off `better-sqlite3` + `sqlite-vec`**. Stack stable; not a 115 question.
- **Operator-readable memory format**. Operator confirmed not required — int8 quantized vectors fine. If a future audit tool needs human-readable, that's a separate small phase.
- **Sub-scope 6-B (direct-SDK 1h-TTL fast-path) if measurement gate doesn't fire.** Carried forward to follow-on phase with the measurement artifact from sub-scope 6-A.

</deferred>

---

*Phase: 115-Memory + context + prompt-cache redesign*
*Context gathered: 2026-05-07*
*Decisions locked by Claude per operator delegation; mapped to research synthesis defaults + prior-phase constraints + 11-agent fleet topology.*
