# ClawCode Prompt Assembly + Dream/Consolidation Pipeline — Current State

**Date:** 2026-05-07
**Scope:** Codebase map for Phase 115 (memory redesign) — what builds the system prompt today, what controls each section's size, where the budgets are no-ops, and where memory reads land in the prompt without filter.

**Trigger:** fin-acquisition's `systemPrompt.append` was 32,989 chars on 2026-05-07; Anthropic rejected with `invalid_request_error` (masquerading as a billing error). Admin Clawdy was 9,587 chars on the same fleet. We need to know exactly which sections inflated and where the size guardrails ought to have stopped it.

> **Repo invariant referenced throughout:** `systemPrompt: { type: "preset", preset: "claude_code", append: stablePrefix }` is the locked SDK shape. The string in `append` is what landed at 32,989 chars. Source: `src/manager/session-adapter.ts:619-628`.

---

## TL;DR — the headline finding

`identityStr` in `buildSessionConfig` is a multi-source concatenation that lands as `sources.identity` in the assembler. It contains:

1. SOUL fingerprint (small, bounded by extractor),
2. **IDENTITY.md full text — UNBOUNDED**,
3. agent-name line,
4. `buildCapabilityManifest(config)` — variable, no token cap,
5. **MEMORY.md auto-load — capped at 50 KB BYTES (≈12,500 tokens worst case), NOT tokens.**

Then the assembler's "budget" for that section is 1000 tokens (`DEFAULT_PHASE53_BUDGETS.identity`) with strategy `warn-and-keep` — which literally **emits a warn record and returns the input unchanged** (`src/manager/context-assembler.ts:494-513`). The operator-observed log line `section: identity, beforeTokens: 5773, budgetTokens: 1000, strategy: warn-and-keep` is the budget firing — and doing nothing.

`MEMORY.md` alone, at 50 KB worst case, is ~5x the nominal `identity` budget. Add IDENTITY.md (no cap) and the capability manifest (variable) and a 32 KB systemPrompt.append is reachable from this single section.

---

## §1 — Section-by-section assembly trace (fresh fin-acquisition session start)

The function under audit is `buildSessionConfig(config, deps, contextSummary?, bootstrapStatus?)` at `src/manager/session-config.ts:256-902`. It produces an `AgentSessionConfig.systemPrompt` that is later wrapped by `buildSystemPromptOption` (`src/manager/session-adapter.ts:619-628`) into the SDK's `{type:"preset",preset:"claude_code",append:<systemPrompt>}` shape and passed to `sdk.query` in `createSession`/`resumeSession`.

`buildSessionConfig` collects strings into the `ContextSources` object (`session-config.ts:713-757`), then calls `assembleContext(sources, budgets, opts)` (`session-config.ts:817-821`). The assembler concatenates `stableParts.join("\n\n")` and returns `stablePrefix` + `mutableSuffix`. `stablePrefix` becomes `systemPrompt.append`. `mutableSuffix` is prepended to user messages OUTSIDE the cache.

### Bootstrap-needed short-circuit

`session-config.ts:262-297` — if `bootstrapStatus === "needed"` (detector fires when `.bootstrap-complete` is absent), the entire normal pipeline is bypassed and `buildBootstrapPrompt` (`src/bootstrap/prompt-builder.ts:12-59`) returns a fixed ~2 KB instruction block. Plus a Discord channel binding paragraph. Total: a few KB. **Not a contributor to the 32 KB blow-up** — fin-acquisition has long since bootstrapped.

### Stable prefix order (becomes `systemPrompt.append`)

The assembler `stableParts.push` order is locked at `context-assembler.ts:750-848`:

| # | Section | Source string | Producer | Upper bound | Typical observed |
|---|---------|---------------|----------|-------------|------------------|
| 1 | `systemPromptDirectives` | `sources.systemPromptDirectives` | upstream renderer (Phase 94 D-10) | unbounded | 0 today — empty unless directives configured (`context-assembler.ts:760-762`) |
| 2 | `identity` (compound) | `sources.identity` (= `identityStr`) | `session-config.ts:300-402` — see breakdown below | NO TOKEN CAP — only MEMORY.md byte cap | **5,773 tokens observed in operator log; can hit 50 KB MEMORY.md alone** |
| 3 | `soul` | `sources.soul` | always `""` today (see §1.x — SOUL is folded into identity) | n/a | 0 |
| 4 | hot memories block (`## Key Memories`) | `sources.hotMemories` rendered + `Key Memories` heading | `session-config.ts:404-421` (`tierManager.getHotMemories().slice(0,3)`) | budget: 3000 tokens (drop-lowest-importance) | small — 3 entries × 1-2 lines |
| 5 | `## Available Tools` (skills + tool defs) | `sources.skillsHeader` ⊕ `sources.toolDefinitions` | `session-config.ts:423-578` | `DEFAULT_BUDGETS.toolDefinitions = 2000` (truncate-bullets, line `context-assembler.ts:797`) | medium — depends on MCP server count + skill catalog |
| 6 | filesystem capability triplet | `sources.filesystemCapabilityBlock` | `renderFilesystemCapabilityBlock` at `session-config.ts:689-695` | renderer-bounded by snapshot size | empty when no fileAccess (most of fleet) |
| 7 | delegates block | `sources.delegatesBlock` | `renderDelegatesBlock(config.delegates)` at `session-config.ts:756` | renderer-bounded; `""` when no delegates | empty for fin-acquisition |
| 8 | `## Related Context` graph context | `sources.graphContext` | always `""` today (`session-config.ts:726`) | `DEFAULT_BUDGETS.graphContext = 2000` | 0 |

Final concatenation: `stableParts.join("\n\n")` at `context-assembler.ts:895`. Trimmed at `session-config.ts:827` and assigned to `AgentSessionConfig.systemPrompt`.

### Mutable suffix order (prepended to user message, NOT in `append`)

Same `assembleContext` call, `mutableParts` array (`context-assembler.ts:751-880`):

| # | Section | Source | Upper bound |
|---|---------|--------|-------------|
| 1 | hot memories block (when `priorHotStableToken !== currentHotToken`) | hot-tier kicked out of stable for cache-thrash protection | small |
| 2 | `## Discord Communication` | `sources.discordBindings` | renderer-bounded (`session-config.ts:580-590`) — fixed-size copy |
| 3 | `perTurnSummary` | `sources.perTurnSummary` | always `""` today (`session-config.ts:733`) |
| 4 | resume summary (`## Context Summary (from previous session)`) | `sources.resumeSummary` (= `contextSummaryStr`) | `enforceSummaryBudget` enforced — `resumeSummaryBudget` default 1500 tokens with hard-truncate fallback (`src/memory/context-summary.ts:210-301`) |
| 5 | conversation brief (`## Recent Sessions`) | `sources.conversationContext` | `conversationContextBudget` default 2000 tokens accumulate-strategy (`src/memory/conversation-brief.ts:194-225`) — BUT see §6(c) below |

Phase 90 hybrid retrieval (`<memory-context>`) wraps the user message ITSELF at turn-dispatch time, not via the assembler — see §6(d).

### §1.x — `identityStr` breakdown (the inflated section)

Lines `session-config.ts:300-402` build `identityStr` by concatenation:

```
identityStr = formatFingerprint(fingerprint) + "\n\n"      // SOUL fingerprint — bounded
            + identityContent                              // IDENTITY.md FULL — UNBOUNDED
            + `Your name is ${name}. When using …`         // 1 line — bounded
            + capabilityManifest                           // buildCapabilityManifest() — variable
            + "\n## Long-term memory (MEMORY.md)\n\n"      // header
            + body                                         // MEMORY.md FULL or 50 KB cap
            + "\n\n…(truncated at 50KB cap)\n"             // truncation marker (when cut)
```

| Sub-source | File:line | Cap | Comment |
|------------|-----------|-----|---------|
| SOUL fingerprint | `session-config.ts:309-329` (reads SOUL.md or `config.soul`, runs `extractFingerprint` + `formatFingerprint`) | bounded by extractor | extractor lives in `src/memory/fingerprint.ts` |
| IDENTITY.md | `session-config.ts:331-357` | **NONE** | full file body appended via `identityStr += identityContent`; if the operator drops a 100 KB IDENTITY.md, all 100 KB land in the prompt |
| Agent-name line | `session-config.ts:360` | 1 line | |
| Capability manifest | `session-config.ts:370-373` calls `buildCapabilityManifest` (`src/manager/capability-manifest.ts:54-210`) | **NONE** | grows with: dream block (1 line), N MCP servers (1 line each, includes operator-set `description` text), N skills, fileAccess paths, GSD paths, model+effort, conversation-memory boilerplate, recursion-guard line. For fin-acquisition with several MCP servers + skill assignments + `description` annotations, this can be hundreds of bytes; for a maximalist agent it's unbounded. |
| MEMORY.md auto-load | `session-config.ts:382-402` | **50 KB BYTES** (`MEMORY_AUTOLOAD_MAX_BYTES` in `src/config/schema.ts:43`) | byte-level truncation via `Buffer.slice` then `…(truncated at 50KB cap)` marker; opt-out via `config.memoryAutoLoad === false`. NB: `Buffer.slice` can split mid-multibyte-codepoint — flagged in code comment at `session-config.ts:391-394` as "theoretical concern but acceptable". |

Then this whole string is assigned to `sources.identity` at `session-config.ts:714` and the assembler runs `enforceWarnAndKeep(sources.identity, "identity", phaseBudgets.identity, warn)` (`context-assembler.ts:700-705`), which simply emits a budget-warning event and returns the string unchanged. **There is no actual truncation.** See §6(b) below.

`sources.soul` is hard-coded to `""` at `session-config.ts:720` (with a comment that SOUL is currently folded into identity), so the soul-budget is also a no-op.

---

## §2 — Bootstrap pipeline (MEMORY.md / AGENTS.md / SOUL.md / IDENTITY.md auto-inject)

There are TWO meanings of "bootstrap" in this codebase:

1. **First-run bootstrap walkthrough** — `src/bootstrap/{detector,prompt-builder,types,writer}.ts`. Fires only when `.bootstrap-complete` file is missing. Replaces the entire system prompt with a fixed instruction block (`src/bootstrap/prompt-builder.ts:12-59`) that tells the agent to write its OWN SOUL.md/IDENTITY.md. Not active on running fleet agents.

2. **Per-session disk-file auto-injection** — happens INSIDE `buildSessionConfig` regardless of bootstrap state. This is the path that contributed to the 32 KB blow-up.

### Per-session disk auto-injection (the relevant path)

Files read from disk on every `buildSessionConfig` call (= every session start + every hot-reload):

| File | Read at | Precedence | Cap |
|------|---------|------------|-----|
| `config.soulFile` (absolute path) → `<workspace>/SOUL.md` → `config.soul` (inline) | `session-config.ts:309-323` | first-readable wins, silent fall-through on read errors | none — full body, but only the **fingerprint** is extracted via `extractFingerprint` (`session-config.ts:327`); the full SOUL body is NEVER embedded |
| `config.identityFile` (absolute path) → `<workspace>/IDENTITY.md` → `config.identity` (inline) | `session-config.ts:333-353` | first-readable wins, silent fall-through | **NONE — full body appended as-is** |
| `config.memoryAutoLoadPath` (override) → `<workspace>/MEMORY.md` | `session-config.ts:382-402` | override-or-default | **50 KB BYTES** (`MEMORY_AUTOLOAD_MAX_BYTES`, `src/config/schema.ts:43`) |

There is **NO `AGENTS.md` auto-load** in the prompt-assembly path. Grep confirms: `grep -rn "AGENTS.md" src/` returns no read-time auto-injection sites in `session-config.ts`. AGENTS.md exists in agent workspaces and is consumed by the SDK's own `claude_code` preset (which reads `<cwd>/AGENTS.md` automatically) — it is NOT in the `append` block we're auditing.

### `bootstrapMaxChars` / `bootstrapTotalMaxChars` — DO NOT EXIST

The task brief asks about these constants. Verified absence:

```
$ grep -rn "bootstrapMaxChars\|bootstrapTotalMaxChars" src/
(no matches)
```

There is no per-source character budget in the bootstrap-injection path. The ONLY cap on auto-injected disk content is `MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024` on MEMORY.md (`src/config/schema.ts:43`). IDENTITY.md and SOUL.md (its fingerprint) are uncapped at the file-read site.

### Truncation-warning leak

When MEMORY.md exceeds 50 KB (`session-config.ts:388-396`):

```ts
if (Buffer.byteLength(body, "utf8") > MEMORY_AUTOLOAD_MAX_BYTES) {
  const buf = Buffer.from(body, "utf8");
  body = buf.slice(0, MEMORY_AUTOLOAD_MAX_BYTES).toString("utf8");
  body += "\n\n…(truncated at 50KB cap)\n";
}
identityStr += "\n## Long-term memory (MEMORY.md)\n\n" + body + "\n";
```

The truncation marker `…(truncated at 50KB cap)` is appended INTO the prompt body itself — agents see it and the operator-reported "agents discussing the truncation marker as if it were a system bug" issue surfaces from this exact line. (No grep hit for "leak" in this code, but the literal string "(truncated at 50KB cap)" lands in the LLM's context window.)

There is no warn LOG emitted on truncation. The marker IS the only signal. Suggested redesign target: emit a pino warn with `{ agent, originalBytes, capBytes }` and use a less-prompt-poisoning marker (or omit it entirely and tag in mutable suffix instead).

---

## §3 — The dream pass

Production dream pipeline lives across:

- `src/manager/dream-prompt-builder.ts` — prompt construction (Phase 95 Plan 01 Task 2)
- `src/manager/dream-pass.ts` — the runner primitive
- `src/manager/dream-cron.ts` — cron tick / idle gating
- `src/manager/dream-auto-apply.ts` — output disposition
- `src/manager/dream-log-writer.ts` — writes `memory/dreams/YYYY-MM-DD.md`

### When fires

`dream-cron.ts` polls per-agent (DI-pure, daemon edge wires the timer at `daemon.ts`). Each tick (`dream-cron.ts:104-132`):
1. Checks `isAgentIdle` — true when last turn > `dream.idleMinutes` ago.
2. Calls `runDreamPass(agentName, deps)` (`dream-pass.ts:200-337`).
3. Calls `applyDreamResult(agentName, outcome, deps)` (`dream-auto-apply.ts:77-160`).

`runDreamPass` short-circuits if `resolvedDreamConfig.enabled === false` returning `{kind:"skipped",reason:"disabled"}` (`dream-pass.ts:204-209`). Manual triggers (CLI, `/clawcode-dream` slash command — Plan 95-03) bypass idle gating.

### What reads (input to LLM)

`runDreamPass` collects four inputs (`dream-pass.ts:213-228`):

1. `memoryStore.getRecentChunks(agentName, 30)` — most recent 30 chunks from `memory_chunks` SQLite table, sorted by `lastModified DESC`.
2. `readFile(memoryRoot/MEMORY.md)` — full file (or `""` on missing).
3. `conversationStore.getRecentSummaries(agentName, 3)` — last 3 session-end summaries.
4. `readFile(memoryRoot/graph-edges.json)` — full file (or `"{}"` on missing).

Then calls `buildDreamPrompt(input)` (`dream-prompt-builder.ts:199-239`) which:
- Renders a fixed system prompt (`dream-prompt-builder.ts:96-122`) — a "reflection daemon" template with strict JSON output rules.
- Renders user prompt with all 4 sections.
- Sorts chunks newest-first; iteratively drops oldest chunks while estimated total > **32K input tokens** (`DREAM_PROMPT_INPUT_TOKEN_BUDGET = 32_000` at `dream-prompt-builder.ts:26`).
- Returns `{systemPrompt, userPrompt, estimatedInputTokens}`.

### What writes (output disposition)

`applyDreamResult` at `dream-auto-apply.ts:77-160` (and beyond — file is 200+ lines):

1. `outcome.result.newWikilinks` → `applyAutoLinks(agentName, links)` (Phase 36-41 link applier; mutates graph state, NOT MEMORY.md).
2. `outcome.result.promotionCandidates`, `themedReflection`, `suggestedConsolidations` → SURFACED to dream log via `writeDreamLog` (writes `memory/dreams/YYYY-MM-DD.md`) — operator-review-only.

**Critical finding for Phase 115:** Dream output does NOT land in the system prompt. The `<dream_log_recent></dream_log_recent>` markers in `context-assembler.ts:830-833` are **empty positioning sentinels** — they wrap NO content today. Comment on those lines says: "Phase 95's dream-log writer emits to disk, NOT the prompt. They exist so a future plan that wants to inject content can land a string between them without disturbing the fs block's byte position."

So a reflective dream-summary IS available on disk (`memory/dreams/YYYY-MM-DD.md`) and as wikilink graph mutations, but the agent NEVER sees the dream output in its prompt unless it explicitly reads the file via tool calls. This is the "I don't dream" failure mode the capability-manifest (`capability-manifest.ts`) was added to paper over: tell the LLM in prose that dreams DO happen, even though their substance never reaches the prompt.

---

## §4 — Session summarization paths

There are THREE places the codebase produces session summaries. They have overlapping but distinct triggers, content, and storage.

### Path A — Phase 65/66 session-end summarization (`summarizeSession`)

- File: `src/memory/session-summarizer.ts:180-423`
- Triggers: `stopAgent` / crash handlers in `session-manager.ts`. Session must be in terminal status (`ended` or `crashed`); active sessions are rejected.
- Pipeline: load session → idempotency check → load turns (use `turns.length`, not `session.turnCount` — Pitfall 2) → minTurns guard (default 3) → build `buildSessionSummarizationPrompt` (`session-summarizer.ts:58-105`, ≤30 KB chars) → call `deps.summarize(prompt, {signal})` with 30s timeout → on success use LLM content; on timeout/error use `buildRawTurnFallback` (raw turn dump) tagged `raw-fallback` → embed via `deps.embedder.embed` → `memoryStore.insert` with `source="conversation"`, `tags=["session-summary","session:<id>","raw-fallback"?]`, `skipDedup:true` → `conversationStore.markSummarized` → delete raw turns for the session (Gap 2 cleanup).
- Default importance: 0.78 (`DEFAULT_IMPORTANCE = 0.78`).
- Default timeoutMs: 30,000 (bumped from 10,000 on 99-mdrop, `session-summarizer.ts:38-40`).
- Storage: SQLite memory_entries table. Re-injected on next session start via `findByTag("session-summary")` in `assembleConversationBrief`.

The production `SummarizeFn` is `summarizeWithHaiku` at `src/manager/summarize-with-haiku.ts:26-31` which delegates to `callHaikuDirect` (Anthropic SDK direct, OAuth from `~/.claude/.credentials.json`, NOT the SDK subprocess). Phase 105 is the latest fix here.

### Path B — Mid-session flush (`flushSessionMidway`)

- Same file, `session-summarizer.ts:451-621`.
- Triggers: per-agent `setInterval` flush timer started at `session-manager.ts:startFlushTimer` (Gap 3 from memory-persistence-gaps).
- Same prompt + summarize call. Differences:
  - Requires `session.status === "active"` (the inverse of Path A).
  - Does NOT call `markSummarized` — session stays live.
  - Does NOT delete turns — needed for next flush + final summary.
  - Tags: `["mid-session", "session:<id>", "flush:<N>"]`.
  - Default importance: `DEFAULT_FLUSH_IMPORTANCE = 0.65` (`session-summarizer.ts:430`).
- Storage: SQLite. **Will be re-fetched by `findByTag("session-summary")`?** No — `findByTag` is exact-match on tag; "mid-session" entries are NOT tagged "session-summary", so they don't pollute the resume brief. Confirmed at `conversation-brief.ts:176`.

### Path C — Phase 89/105 restart-greeting summarization (`sendRestartGreeting`)

- File: `src/manager/restart-greeting.ts:348-637` (full file 637 lines).
- Triggers: `session-manager.ts:1781-1844` — fires fire-and-forget after `restartAgent` inside `reconcileRegistry` / explicit restart flow. Discord-facing, NOT prompt-facing.
- Pipeline:
  1. `classifyRestart(prevConsecutiveFailures)` → `clean` | `crash-suspected` | `platform-error-recovery`.
  2. Cool-down gate (per-agent 1× per `greetCoolDownMs`, `restart-greeting.ts:384`).
  3. Find most-recent terminated session that has either `summaryMemoryId` set OR un-pruned turns.
  4. **Fast path** (`restart-greeting.ts:514-525`): when `summaryMemoryId` is set, reuse the cached Path A summary — bypasses Haiku entirely.
  5. **Haiku path** (when no cached summary): `buildRestartGreetingPrompt(turns, agentConfig, restartKind)` (`restart-greeting.ts:285-305`) — prompts for a single first-person paragraph ≤500 chars in the agent's voice. Calls injected `summarize` (production = `summarizeWithHaiku`).
  6. Builds Discord embed via `buildCleanRestartEmbed` / `buildCrashRecoveryEmbed` (`restart-greeting.ts:318-342`).
  7. Posts to Discord webhook + sets `lastGreetingAt` cool-down.
- **Critical:** This summary **never lands in the system prompt**. It's strictly a Discord embed used to notify the operator that the agent recovered.
- Phase 105 fix (`summarize-with-haiku.ts`) addresses the OAuth-vs-API-key bill-routing for the Haiku call here AND in Path A/B (they share the same `SummarizeFn`).

### Where these summaries land in the next session's prompt

Only Path A summaries (tagged `session-summary`) land in the next session's prompt — via `assembleConversationBrief` in the MUTABLE SUFFIX (NOT stable prefix), under `## Recent Sessions`. Default last-3 summaries, default 2000-token budget, accumulate strategy.

| Path | Tag | Lands in next session's prompt? | Where | Budget |
|------|-----|--------------------------------|-------|--------|
| A (session-end) | `session-summary` | YES | mutable suffix `## Recent Sessions` | `conversationContextBudget` 2000 tokens (accumulate, but see §6c) |
| B (mid-session flush) | `mid-session` | NO | — | — |
| C (restart-greeting) | n/a (Discord embed) | NO | — | — |
| Phase 53 resume_summary file | n/a (file `memory/context-summary.md`) | YES | mutable suffix `## Context Summary (from previous session)` | `resumeSummaryBudget` 1500 tokens (`enforceSummaryBudget`, hard-truncate) |

The `memory/context-summary.md` file is a SEPARATE artifact (Phase 53 / earlier — produced by some compaction event) loaded via `loadLatestSummary` at `session-config.ts:606` and enforced via `enforceSummaryBudget` (`src/memory/context-summary.ts:210-301`). This IS budget-enforced with hard-truncate — the only summary path that respects its budget today.

---

## §5 — Caching policy today

The Phase 52 contract is two-block: stable prefix is fed to the SDK preset's `append` (cached by Anthropic via prompt-cache), mutable suffix is prepended to the per-turn user message (NOT cached).

### Stable vs mutable placement (assembled at `context-assembler.ts:750-880`)

**Always stable:** systemPromptDirectives, identity (incl. SOUL fingerprint, IDENTITY.md, capability manifest, MEMORY.md), soul (today empty), `## Available Tools` (skills + MCP block + admin info + auto-injected helpers + subagent-thread guidance + subagent-model guidance), filesystem capability triplet, delegates block, graph context.

**Always mutable:** Discord bindings, perTurnSummary, resume summary file, conversation brief.

**Conditional placement (hot-tier):** First turn of a session → stable. Subsequent turns: stable if `currentHotToken === priorHotStableToken`, otherwise mutable for THIS turn only (re-enters stable next turn if unchanged). See `context-assembler.ts:776-787` and `session-config.ts:759-770`.

### `hotStableToken` mechanics

- Token = `sha256(rendered hot-tier string)`. Computed at `context-assembler.ts:395-397`.
- On first turn: `priorHotStableToken === undefined` → hot-tier in stable.
- On subsequent turns: `SessionManager` carries forward via `lastHotStableTokenByAgent: Map<agent, string>` (`session-manager.ts:802-803`). When `buildSessionConfig` rebuilds the prefix and the rendered hot-tier signature differs, the assembler kicks hot-tier into mutable for ONE turn — preventing a single hot-tier change from busting the cached stable prefix.

### Cache-bust paths

The stable prefix recomputes every time `buildSessionConfig` runs. Sites:

| Site | File:line | Trigger |
|------|-----------|---------|
| `startAgent` | `session-manager.ts:791-796` | Daemon start, agent restart |
| `reconcileRegistry` | `session-manager.ts:1913-1916` | Daemon restart with running registry |
| Any hot-reload of skills / config | (via `latestStablePrefixByAgent.set` cache-update sites) | YAML edit, skill change |

There is **NO per-turn rebuild** under normal operation — see comment `context-assembler.ts:957-960`: "current call sites of `assembleContext` live inside `buildSessionConfig` and run at agent-startup / session-resume — NOT per turn." The stable prefix is therefore stable (modulo restarts) for the agent's lifetime once spawned.

### `prefixHash` + `cache_eviction_expected` telemetry

Per-turn the adapter computes `sha256(stablePrefix)` via `computePrefixHash` (`context-assembler.ts:410-412`) and compares against the prior turn's hash via `PrefixHashProvider` closure (`session-adapter.ts:69-72`, wired at `session-manager.ts:627-…`). The `cache_eviction_expected` boolean lands in `traces.db` per turn (`src/performance/trace-store.ts:170,513,533,579`).

**Observed cache hit rates:** Not directly logged in the codebase as a hit-rate metric. The recorded fields are `prefix_hash` (per-turn) + `cache_eviction_expected` (per-turn 0/1). To get cache hit rate, run `clawcode context-audit` (Phase 53 audit CLI; consumes `traces.db`). The adapter's per-turn cache telemetry comes from the SDK's own `cache_creation_input_tokens` + `cache_read_input_tokens` usage fields and is recorded but I did not locate a "cache hit rate" derived metric in this codebase audit; the raw inputs are present in `usageCallback` at `session-manager.ts:806-814`.

### What busts the cache (per turn)

1. Stable prefix changes (any `identityStr` change → MEMORY.md edit, IDENTITY.md edit, capability-manifest change, MCP server list change, skills change, config hot-reload).
2. Hot-tier composition change (inserts a new top-3 hot memory) for ONE turn.
3. Tool-list change (capability-probe filter dropping/restoring servers).

**Critical for Phase 115:** Today the stable prefix is the largest single thing in the request, AND it can balloon to 32 KB+, AND any MEMORY.md edit by the agent itself busts the cache for the next turn. So an agent that writes-its-own-MEMORY.md (the workflow we encourage) is paying full prompt cost on every turn it edits memory. Confirmation: `session-config.ts:386` reads MEMORY.md at every `buildSessionConfig` call — but that call only runs on session start. So intra-session MEMORY.md edits do NOT immediately rebuild. They only land on next session start.

---

## §6 — Pain points (the redesign target list)

### (a) Sections with NO size budget

| Section | Site | Note |
|---------|------|------|
| `sources.systemPromptDirectives` | `context-assembler.ts:760-762` | renderer-bounded, but no token cap |
| IDENTITY.md (folded into `identityStr`) | `session-config.ts:331-357` | full file body, no cap |
| Capability manifest (folded into `identityStr`) | `session-config.ts:370-373` + `capability-manifest.ts:54-210` | grows linearly with N MCP servers and skills |
| MEMORY.md auto-load (folded into `identityStr`) | `session-config.ts:382-402` | 50 KB BYTE cap (not tokens), single sliding window — no semantic selection |
| Subagent-thread skill guidance | `session-config.ts:467-477` | 7 lines, fixed copy — bounded but unbudgeted |
| MCP block | `session-config.ts:490-531` → `mcp-prompt-block.ts:116-158` | per-server `lastError.message` is escape-only, no length limit; 14+ servers × N-line errors can balloon (see (d) below) |
| Auto-injected built-in helpers | `session-config.ts:545-554` | 4-line block, fixed copy — bounded but unbudgeted |
| Admin agent table | `session-config.ts:557-572` | grows linearly with fleet size; admin agent gets the entire fleet |
| Subagent-model guidance | `session-config.ts:574-578` | 1 line, fixed copy |
| Discord bindings | `session-config.ts:580-590` | fixed-size copy |
| `sources.delegatesBlock` | renderer-bounded | renderer in `src/config/loader.ts` (`renderDelegatesBlock`) — no token cap |
| `sources.filesystemCapabilityBlock` | snapshot-bounded | renderer in `src/prompt/filesystem-capability-block.ts` |

### (b) The "warn-and-keep" no-op budgets

`enforceWarnAndKeep` at `context-assembler.ts:494-513`:

```ts
function enforceWarnAndKeep(text, section, budget, warn) {
  if (!text) return "";
  const tokens = countTokens(text);
  if (tokens > budget && warn) {
    warn({ section, beforeTokens: tokens, budgetTokens: budget,
           strategy: "warn-and-keep" });
  }
  return text;   // <-- input UNCHANGED
}
```

Applied to `identity` (line 700-705) and `soul` (710-715). The operator-observed `section: identity, beforeTokens: 5773, budgetTokens: 1000, strategy: warn-and-keep` log line is THIS function. It fires the warn callback (which `session-config.ts:771-784` routes to `deps.log.warn` with structured fields) and returns the unchanged text. **The "budget" is observability theater — there is no truncation.**

The warn-and-keep strategy was deliberate per `context-assembler.ts:284-289`: "identity / soul → WARN-and-keep (user persona never truncated)". The DESIGN intent is that persona text should never be cut. But the IMPLEMENTATION lets MEMORY.md (50 KB) ride along inside `identityStr` — which was definitely not the design intent.

### (c) Conditional sections with no upper bound on conditional content

| Site | What's conditionally injected | Cap |
|------|-------------------------------|-----|
| `session-config.ts:467-477` | `subagent-thread` guidance text — included when skill is assigned | fixed-size copy |
| `session-config.ts:557-572` | Admin fleet table — included when `config.admin === true` | grows with fleet size; 15+ rows for current fleet |
| `session-config.ts:574-578` | `subagentModel` guidance — included when set | fixed-size copy |
| `session-config.ts:382-402` | MEMORY.md — included when `config.memoryAutoLoad !== false` | 50 KB BYTES |
| `conversation-brief.ts:210-220` | Single oversized session-summary — accepted ANYWAY when it alone exceeds the 2000-token budget | NONE — comment: "returning `""` would silently hide content the operator asked for. They can tune the budget upward if this becomes chronic." |

The conversation-brief over-budget-accept (`conversation-brief.ts:210-220`) is particularly worth noting:

```ts
if (candidateTokens > config.budgetTokens && accepted.length === 0) {
  // Single summary already exceeds budget. Accept it anyway: returning
  // `""` would silently hide content the operator asked for. They can
  // tune the budget upward if this becomes chronic.
  accepted.push(entry);
  ...
  break;
}
```

A single 10K-token session summary lands in the mutable suffix verbatim, with only a `log.warn` to signal the over-budget acceptance.

### (d) Memory-store reads that inject into the prompt without filter

| Source | Reader call site | Lands in | Budget enforcement |
|--------|------------------|----------|--------------------|
| Hot-tier | `tierManager.getHotMemories().slice(0,3)` (`session-config.ts:413-414`) | stable prefix `## Key Memories` (or mutable on cache-thrash) | importance-ordered drop, budget 3000 tokens (`drop-lowest-importance` strategy actually works at `context-assembler.ts:552-601`). Per-entry content unbounded; budget cuts entries, not bytes within an entry. |
| `findByTag("session-summary")` (Phase 67 conversation brief) | `memoryStore.findByTag("session-summary")` (`conversation-brief.ts:176`) | mutable suffix `## Recent Sessions` | accumulate-strategy 2000 tokens — BUT single oversized entries pass through (see (c)). raw-fallback entries are placeholder-rendered (`conversation-brief.ts:117-121`). |
| Phase 90 hybrid retrieval (`<memory-context>`) | `retrieveMemoryChunks` invoked per-turn at `turn-dispatcher.ts:686-711` | wraps the USER MESSAGE (mutable, NOT in stable prefix or `append`) | retrieveMemoryChunks budget: topK=5, tokenBudget=2000 (~8000 chars), windowDays=14, RRF-fused vec+FTS+memories, path-weighted. Body length per chunk is unbounded — but cumulative cap stops accumulation when next chunk would exceed cap (line `memory-retrieval.ts:225-243`). |
| MEMORY.md auto-load | `readFile(memoryPath)` at `session-config.ts:386` | stable prefix (folded into identityStr) | 50 KB BYTES — no semantic filter, no token check. Whole file. |
| Dream pass MEMORY.md read | `readFile(memoryRoot/MEMORY.md)` at `dream-pass.ts:218-220` | dream LLM input (NOT system prompt) | 32K input-token budget enforced by `buildDreamPrompt` truncation loop (`dream-prompt-builder.ts:222-235`) — but ONLY chunk count is reduced; MEMORY.md + summaries + graph are pass-through. Comment: "if those alone exceed the budget the caller is misusing the primitive". |
| Dream pass graph-edges | `readFile(memoryRoot/graph-edges.json)` at `dream-pass.ts:225-227` | dream LLM input | same as above — pass-through |
| `loadLatestSummary` (resume_summary file) | `readFile(memoryDir/context-summary.md)` at `context-summary.ts:161-188` then `enforceSummaryBudget` at `session-config.ts:610-617` | mutable suffix `## Context Summary (from previous session)` | YES — `enforceSummaryBudget` does hard-truncate (`context-summary.ts:251-281`). Default 1500 tokens, floor 500. Currently the ONLY filtered persistent-store read that lands in the prompt. |

### (e) MCP block-specific concerns

`mcp-prompt-block.ts:116-158`:

- Per-server table row includes `state.lastError.message` (`mcp-prompt-block.ts:137-145`) — escape-only, no length cap. A multi-line JSON-RPC error from a misbehaving server can dump kilobytes per row.
- 15+ MCP servers × variable error text = unbounded growth.
- Tools column is hard-coded `—` (em dash) today; planned to become a per-server tool list in a follow-up plan, which would multiply the size.

---

## §7 — File:line citations index

| Topic | File | Lines |
|-------|------|-------|
| `buildSessionConfig` entry | `src/manager/session-config.ts` | 256-902 |
| Bootstrap-needed short-circuit | `src/manager/session-config.ts` | 262-297 |
| `identityStr` SOUL fingerprint | `src/manager/session-config.ts` | 309-329 |
| `identityStr` IDENTITY.md (no cap) | `src/manager/session-config.ts` | 331-357 |
| `identityStr` agent-name line | `src/manager/session-config.ts` | 360 |
| `identityStr` capability manifest | `src/manager/session-config.ts` | 370-373 |
| `identityStr` MEMORY.md auto-load (50 KB byte cap + truncation marker) | `src/manager/session-config.ts` | 382-402 |
| Hot memories collection | `src/manager/session-config.ts` | 404-421 |
| Skills header collection | `src/manager/session-config.ts` | 423-461 |
| Subagent-thread guidance | `src/manager/session-config.ts` | 467-477 |
| MCP block insertion | `src/manager/session-config.ts` | 490-531 |
| Built-in tool helpers | `src/manager/session-config.ts` | 545-554 |
| Admin fleet table | `src/manager/session-config.ts` | 557-572 |
| Subagent model guidance | `src/manager/session-config.ts` | 574-578 |
| Discord bindings | `src/manager/session-config.ts` | 580-590 |
| Resume summary load + enforce | `src/manager/session-config.ts` | 598-619 |
| Conversation brief assembly | `src/manager/session-config.ts` | 632-680 |
| Filesystem capability render | `src/manager/session-config.ts` | 689-695 |
| `ContextSources` populate | `src/manager/session-config.ts` | 713-757 |
| `onBudgetWarning` log routing | `src/manager/session-config.ts` | 771-784 |
| `assembleContext` call | `src/manager/session-config.ts` | 817-821 |
| MCP env override resolution | `src/manager/session-config.ts` | 829-869 |
| Final `AgentSessionConfig` return | `src/manager/session-config.ts` | 871-901 |
| `assembleContextInternal` | `src/manager/context-assembler.ts` | 686-903 |
| Stable parts ordering | `src/manager/context-assembler.ts` | 750-848 |
| Mutable parts ordering | `src/manager/context-assembler.ts` | 851-880 |
| Hot-tier `stable_token` placement logic | `src/manager/context-assembler.ts` | 776-787 |
| `enforceWarnAndKeep` (no-op) | `src/manager/context-assembler.ts` | 494-513 |
| `enforceBulletTruncation` | `src/manager/context-assembler.ts` | 519-539 |
| `selectHotMemoriesWithinBudget` | `src/manager/context-assembler.ts` | 552-601 |
| `renderSkillsHeader` | `src/manager/context-assembler.ts` | 618-678 |
| `DEFAULT_PHASE53_BUDGETS` | `src/manager/context-assembler.ts` | 343-351 |
| `DEFAULT_BUDGETS` | `src/manager/context-assembler.ts` | 254-259 |
| `computeHotStableToken` / `computePrefixHash` | `src/manager/context-assembler.ts` | 395-412 |
| `<tool_status>` / `<dream_log_recent>` empty sentinels | `src/manager/context-assembler.ts` | 819-833 |
| `MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024` | `src/config/schema.ts` | 43 |
| `buildSystemPromptOption` (preset+append) | `src/manager/session-adapter.ts` | 619-628 |
| `createSession` SDK call | `src/manager/session-adapter.ts` | 642-706 |
| `resumeSession` SDK call | `src/manager/session-adapter.ts` | 708-… |
| `buildCleanEnv` (strips ANTHROPIC_API_KEY) | `src/manager/session-adapter.ts` | 603-606 |
| Phase 105 fin-acq diagnostic dump | `src/manager/session-adapter.ts` | 23-51 |
| `buildBootstrapPrompt` | `src/bootstrap/prompt-builder.ts` | 12-59 |
| `buildCapabilityManifest` | `src/manager/capability-manifest.ts` | 54-210 |
| `summarizeSession` (Path A) | `src/memory/session-summarizer.ts` | 180-423 |
| `flushSessionMidway` (Path B) | `src/memory/session-summarizer.ts` | 451-621 |
| `buildSessionSummarizationPrompt` (≤30 KB) | `src/memory/session-summarizer.ts` | 58-105 |
| `buildRawTurnFallback` | `src/memory/session-summarizer.ts` | 115-125 |
| `summarizeWithHaiku` | `src/manager/summarize-with-haiku.ts` | 26-31 |
| `sendRestartGreeting` (Path C) | `src/manager/restart-greeting.ts` | 348-637 |
| `buildRestartGreetingPrompt` | `src/manager/restart-greeting.ts` | 285-305 |
| `assembleConversationBrief` | `src/memory/conversation-brief.ts` | 133-267 |
| Single-oversized accept path | `src/memory/conversation-brief.ts` | 210-220 |
| `loadLatestSummary` | `src/memory/context-summary.ts` | 161-188 |
| `enforceSummaryBudget` (real budget enforcement) | `src/memory/context-summary.ts` | 210-301 |
| `runDreamPass` | `src/manager/dream-pass.ts` | 200-337 |
| `buildDreamPrompt` (32K token cap) | `src/manager/dream-prompt-builder.ts` | 199-239 |
| `applyDreamResult` (no prompt write-back) | `src/manager/dream-auto-apply.ts` | 77-160+ |
| `MCP_PREAUTH_STATEMENT` | `src/manager/mcp-prompt-block.ts` | 49-53 |
| `MCP_VERBATIM_ERROR_RULE` | `src/manager/mcp-prompt-block.ts` | 67-68 |
| `renderMcpPromptBlock` (no error-message length cap) | `src/manager/mcp-prompt-block.ts` | 116-158 |
| `retrieveMemoryChunks` (Phase 90 hybrid RRF) | `src/memory/memory-retrieval.ts` | 124-245 |
| `augmentWithMemoryContext` (per-turn `<memory-context>` wrap) | `src/manager/turn-dispatcher.ts` | 686-711 |
| `getMemoryRetrieverForAgent` | `src/manager/session-manager.ts` | 565-582 |
| `latestStablePrefixByAgent` cache | `src/manager/session-manager.ts` | 800 |
| `lastHotStableTokenByAgent` cache | `src/manager/session-manager.ts` | 802-803 |
| `cache_eviction_expected` schema | `src/performance/trace-store.ts` | 170, 513, 533, 579 |

---

## §8 — Concrete redesign hooks for Phase 115

Hooks the redesign can lean on rather than reinvent:

1. **`assembleContext` already supports per-section budgets and a `BudgetWarningEvent` callback.** What's missing is real enforcement strategies on `identity` and the conditional sub-sources WITHIN identity. Today identity is opaque to the assembler. Carving SOUL fingerprint, IDENTITY.md, capability manifest, and MEMORY.md into separate `ContextSources` fields with their own budgets is a small surgical change.

2. **The `claude_code` SDK preset is a constraint.** `buildSystemPromptOption` (`session-adapter.ts:619-628`) is comment-pinned with "NEVER replace with a raw `string` systemPrompt — that loses the preset's cache scaffolding (CONTEXT D-01 LOCKED)." Any redesign must keep the preset+append shape.

3. **MEMORY.md is the biggest single redesign target.** It's read on every `buildSessionConfig`, capped only by a byte threshold, and lands inside the not-truncated `identity` section. Lazy-load via tool call (like skills do via `lazySkillsConfig`) is one approach; semantic chunking + RRF-style retrieval into the mutable suffix is another (and Phase 90 already has the retrieval primitive — `retrieveMemoryChunks`).

4. **Phase 90's `<memory-context>` already runs per-turn against the mutable suffix.** This is the primitive that should grow. Today it ONLY sees `memory_chunks` (file-scanner index) + `memory_save` entries. Wiring MEMORY.md content into the chunk index (chunker already exists at `src/memory/memory-chunks.ts`) would let `retrieveMemoryChunks` surface the relevant MEMORY.md sub-sections per turn instead of every turn carrying the whole file.

5. **The dream pass already produces `themedReflection` + `promotionCandidates` + `suggestedConsolidations`.** None of these reach the prompt today. A "dream-summary mutable-suffix block" with a real budget is a Phase 115 candidate — the empty `<dream_log_recent>` sentinels in `context-assembler.ts:830-833` are explicitly placed for this.

6. **Cache-bust math says: only the stable prefix needs to be small to reduce per-turn cost.** Mutable suffix is paid every turn anyway. Move sources OUT of the stable prefix when their content is per-turn-relevant (capability manifest? — arguably it's per-session-stable; MEMORY.md? — per-turn-relevant if memory grows during session).

7. **Phase 105 already isolates the Haiku summarize call from the SDK billing path.** Reuse `callHaikuDirect` for any new "compress-on-the-fly" budget enforcement. Don't roll a new Haiku-call surface.

---

*End of map.*
