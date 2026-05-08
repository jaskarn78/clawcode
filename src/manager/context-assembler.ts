/**
 * Pure context assembly function with per-source token budgets.
 * No side effects, no external imports beyond types + node:crypto.
 *
 * Phase 52 Plan 02 — two-block split for prompt caching:
 *   - `stablePrefix` — identity + hotMemories (when stable) + toolDefinitions
 *     + graphContext. This is the block fed to `systemPrompt.append` so the
 *     SDK's `claude_code` preset can auto-cache it across turns.
 *   - `mutableSuffix` — discordBindings + contextSummary (and hot-tier
 *     entries WHEN the hot-tier composition just changed). Prepended to the
 *     user message so it sits OUTSIDE the cached block.
 *
 * Hot-tier `stable_token`: if the caller passes `priorHotStableToken` and it
 * does NOT match the current hot-tier signature, hot-tier slides out of the
 * cacheable block for THIS TURN ONLY and lands in the mutable suffix. The
 * NEXT turn with unchanged hot-tier re-enters the stable prefix. This
 * prevents cache thrashing on a single hot-tier update.
 *
 * Phase 53 Plan 02 — per-section budget enforcement + section_tokens metadata:
 *   The assembler reads `memoryAssemblyBudgets` from `AssembleOptions` (threaded
 *   from `agentConfig.perf.memoryAssemblyBudgets`) and applies section-specific
 *   truncation strategies:
 *     - identity / soul → WARN-and-keep (user persona never truncated)
 *     - hot_tier        → drop LOWEST-importance rows
 *     - skills_header   → truncate by bullet-line (legacy mechanism reused)
 *     - recent_history  → measured only (SDK owns delivery)
 *     - per_turn_summary / resume_summary → pass-through (enforced in
 *       src/memory/context-summary.ts before the source string is built)
 *   The return shape `{ stablePrefix, mutableSuffix, hotStableToken }` is
 *   preserved EXACTLY — the per-section counts flow through the traced
 *   wrapper (`assembleContextTraced`) onto the `context_assemble` span's
 *   `metadata_json.section_tokens` key, consumed by Plan 53-01's audit CLI.
 */

// Phase 94 Plan 02 TOOL-03 contract: the `toolDefinitions` source string
// reaching this assembler has ALREADY been filtered by the
// capability-probe filter in session-config.ts. The assembler MUST NOT
// call the filter directly — single-source-of-truth invariant pinned by
// static-grep regression test. context-assembler renders whatever it is
// given; do not re-inject raw MCP server lists here.
import { createHash } from "node:crypto";
import type { Turn } from "../performance/trace-collector.js";
import { countTokens } from "../performance/token-count.js";
import type { MemoryEntry, MemoryTier1Source } from "../memory/types.js";
import { extractSkillMentions } from "../usage/skill-usage-tracker.js";

export type ContextBudgets = {
  readonly identity: number;
  readonly hotMemories: number;
  readonly toolDefinitions: number;
  readonly graphContext: number;
};

export type ContextSources = {
  /**
   * Phase 94 TOOL-10 / D-10 — pre-rendered system-prompt directive block.
   *
   * Caller (session-config.ts) renders this via
   * `renderSystemPromptDirectiveBlock(resolveSystemPromptDirectives(...))`
   * and passes the resulting string. When non-empty, the assembler
   * prepends it as the FIRST element of stableParts (BEFORE identity →
   * BEFORE Available Tools). When "" (all directives disabled), no
   * marker block is prepended — the stable prefix is byte-identical to
   * the no-directives baseline (REG-ASSEMBLER-EMPTY-WHEN-DISABLED), which
   * matters for prompt-cache hash stability.
   *
   * Optional for back-compat: existing callers without this field see no
   * behavior change.
   */
  readonly systemPromptDirectives?: string;
  /**
   * Phase 999.13 DELEG-02 — pre-rendered per-agent "Specialist Delegation"
   * directive block. Caller (session-config.ts) renders this via
   * `renderDelegatesBlock(config.delegates)` and threads the resulting
   * string here.
   *
   * When non-empty, the assembler appends it as the LAST element of the
   * stable prefix's tools-and-capability cluster (after toolDefinitions,
   * after filesystemCapabilityBlock, BEFORE the mutable suffix). This
   * positions the "where to delegate" footer at the bottom of the
   * agent's stable system prompt where CONTEXT.md prescribes.
   *
   * Empty/undefined short-circuits — NO header, NO whitespace, byte-
   * identical to the no-delegates baseline. Critical for prompt-cache
   * hash stability: agents without delegates see no fleet-wide cache
   * invalidation on Phase 999.13 deploy.
   */
  readonly delegatesBlock?: string;
  /**
   * Legacy compound identity field (Phase 53 / pre-115). Populated by
   * upstream session-config as a single concatenation of SOUL fingerprint +
   * IDENTITY.md + agent-name line + capability manifest + MEMORY.md auto-load.
   *
   * Phase 115 Plan 03 sub-scope 1 carves these into FOUR separate fields below
   * (`identitySoulFingerprint` / `identityFile` / `identityCapabilityManifest` /
   * `identityMemoryAutoload`) so the assembler can budget each independently
   * via `enforceDropLowestImportance`. When any of the four sub-source fields
   * is populated (non-undefined), the renderer uses them and IGNORES this
   * compound `identity` field. Tests + legacy callers that still pass only
   * `identity` continue to work — the four sub-fields default to undefined
   * and the legacy compound rendering path runs.
   */
  readonly identity: string;
  /**
   * Phase 115 Plan 03 sub-scope 1 — SOUL fingerprint (extractFingerprint
   * output, ≤1200 chars by extractor bound). Highest importance: NEVER
   * dropped by `drop-lowest-importance` strategy.
   */
  readonly identitySoulFingerprint?: string;
  /**
   * Phase 115 Plan 03 sub-scope 1 — IDENTITY.md raw body. Mid-priority:
   * head-tail truncated when over budget.
   */
  readonly identityFile?: string;
  /**
   * Phase 115 Plan 03 sub-scope 1 — agent-name line + capability manifest.
   * Mid-low priority: bullet-truncated when over budget.
   */
  readonly identityCapabilityManifest?: string;
  /**
   * Phase 115 Plan 03 sub-scope 1 — MEMORY.md auto-load body. Lowest priority
   * within identity (already separately bounded by INJECTED_MEMORY_MAX_CHARS
   * at the upstream load site). Dropped first in over-budget steps.
   */
  readonly identityMemoryAutoload?: string;
  /**
   * Phase 115 Plan 03 sub-scope 11 — typed Tier 1 source descriptor for the
   * MEMORY.md auto-load. Optional and additive: when present it carries the
   * same body that `identityMemoryAutoload` carries (`source.content`) plus
   * the file path + cap metadata that downstream consumers (Plan 115-04
   * lazy-load tools, observability sub-scope 13c diagnostics) need to
   * surface where the content came from.
   *
   * Back-compat contract: `identityMemoryAutoload` (raw string) remains the
   * field the assembler renders from. `identityMemoryAutoloadSource` is
   * threaded for INFORMATIONAL use by downstream callers — it does NOT
   * change the rendering path. When both are populated they MUST agree
   * (`identityMemoryAutoload === identityMemoryAutoloadSource.content`).
   * Plan 115-04 reads this field by name; do not rename it.
   */
  readonly identityMemoryAutoloadSource?: MemoryTier1Source;
  /**
   * Phase 53 Plan 02 — SOUL.md body carved out from identity. When the upstream
   * session-config already folds SOUL into identity, pass `""` here and the
   * `soul` section_tokens reading will be `0` (accurate, not a lie).
   */
  readonly soul?: string;
  /**
   * Phase 53 Plan 02 — skill descriptions block, separated from other tool
   * text so it becomes an individually-budgetable section. 53-03 will layer
   * lazy-skill compression on top. Legacy callers that pass the combined
   * skill+MCP+admin text via `toolDefinitions` keep working (no behavior
   * change when `skillsHeader` is omitted).
   */
  readonly skillsHeader?: string;
  readonly hotMemories: string;
  /**
   * Phase 53 Plan 02 — optional raw MemoryEntry list parallel to
   * `hotMemories`. When supplied, the assembler uses importance-ordered
   * selection for budget enforcement (`drop-lowest-importance` strategy).
   * When omitted, the assembler falls back to bullet-line truncation.
   */
  readonly hotMemoriesEntries?: readonly MemoryEntry[];
  readonly toolDefinitions: string;
  readonly graphContext: string;
  readonly discordBindings: string;
  readonly contextSummary: string;
  /**
   * Phase 53 Plan 02 — turn-local context recap (separate from resume summary).
   * Both `perTurnSummary` and `resumeSummary` land in the mutable suffix.
   * When BOTH are empty, the legacy `contextSummary` field is used as fallback
   * for resume_summary (preserving Phase 52 behavior).
   */
  readonly perTurnSummary?: string;
  /**
   * Phase 53 Plan 02 — session-resume summary loaded from
   * `<workspace>/memory/context-summary.md`. Budget enforcement happens in
   * `src/memory/context-summary.ts.enforceSummaryBudget` BEFORE this field is
   * populated; the assembler does not re-enforce here.
   */
  readonly resumeSummary?: string;
  /**
   * Phase 53 Plan 02 — recent conversation history text for MEASUREMENT only.
   * The SDK owns history delivery, so the assembler never truncates this.
   * The field exists solely so `section_tokens.recent_history` can be
   * populated on the `context_assemble` span for audit reporting.
   */
  readonly recentHistory?: string;

  /**
   * Phase 67 — pre-budget-enforced conversation brief rendered by
   * `src/memory/conversation-brief.ts::assembleConversationBrief`. Lands in
   * the MUTABLE SUFFIX (NOT stable prefix) so it never invalidates the SDK's
   * prompt cache turn-to-turn as session summaries accumulate. Empty string
   * or undefined → no heading rendered, `section_tokens.conversation_context`
   * reports 0 (SESS-02 / SESS-03 invariants).
   */
  readonly conversationContext?: string;

  /**
   * Phase 96 Plan 02 D-02 — pre-rendered <filesystem_capability> block.
   *
   * Caller (session-config.ts at the daemon edge) invokes
   * `renderFilesystemCapabilityBlock(handle.getFsCapabilitySnapshot(),
   * agentWorkspaceRoot, {flapHistory, now})` and threads the resulting
   * string here. context-assembler.ts is PURE (no SessionHandle import,
   * no fs); the renderer lives in src/prompt/filesystem-capability-block.ts
   * and is invoked at the boundary — same threading pattern as
   * Phase 94 D-10 systemPromptDirectives.
   *
   * When the snapshot is empty (v2.5 fixtures without fileAccess declared),
   * the renderer returns "" and this field is "" — no triplet markers
   * (`<tool_status>` / `<filesystem_capability>` / `<dream_log_recent>`)
   * appear in the assembled stable prefix. v2.5 stable-prefix hash
   * UNCHANGED on Phase 96 deploy (CA-FS-2 / CA-FS-4 cache-stability
   * invariants).
   *
   * When non-empty, the assembler wraps the block with literal-string
   * anchors `<tool_status></tool_status>` (Phase 94 sentinel) and
   * `<dream_log_recent></dream_log_recent>` (Phase 95 sentinel) so the
   * static-grep regression pin in 96-02-PLAN.md
   * (`grep -A 50 '<tool_status>' ... | grep -q '<filesystem_capability>'`)
   * confirms the byte-position invariant.
   *
   * D-04 silent re-render: the block re-renders on snapshot change only;
   * NO Discord post on capability shift. Operator inspects via
   * /clawcode-status (96-05) mutable suffix.
   */
  readonly filesystemCapabilityBlock?: string;

  // ── Phase 53 Plan 03 — lazy-skill compression sources ────────────────────

  /**
   * Phase 53 Plan 03 — per-skill catalog entries. When supplied (non-empty),
   * the assembler renders the skills_header block from these entries using
   * the lazy-skill compression decision matrix below rather than the legacy
   * `skillsHeader` pass-through. Entries render as FULL content (fullContent
   * verbatim) when "kept" and as a compressed one-line catalog entry
   * (`- <name>: <description>`) when "compressed" — NEVER dropped entirely
   * (preserves discoverability, CONTEXT.md Specifics #2).
   */
  readonly skills?: readonly SkillCatalogEntry[];
  /**
   * Phase 53 Plan 03 — usage window from SkillUsageTracker.getWindow(agent).
   * Skills whose names appear in `recentlyUsed` render full-content; others
   * compress. Warm-up: when `turns < lazySkillsConfig.usageThresholdTurns`,
   * all skills render full-content regardless of membership.
   */
  readonly skillUsage?: SkillUsageWindow;
  /**
   * Phase 53 Plan 03 — current user message (re-inflate source). When
   * `lazySkillsConfig.reinflateOnMention` is true, word-boundary matches
   * of skill names in this text force the matching skill to render full
   * content for THIS turn only.
   */
  readonly currentUserMessage?: string;
  /**
   * Phase 53 Plan 03 — last assistant message (re-inflate source). Same
   * mention-based re-inflation as `currentUserMessage`.
   */
  readonly lastAssistantMessage?: string;
  /**
   * Phase 53 Plan 03 — resolved lazy-skill configuration. When absent or
   * `enabled === false`, lazy-skill compression is disabled and all skills
   * render full content (legacy Phase 53-02 behavior preserved).
   */
  readonly lazySkillsConfig?: ResolvedLazySkillsConfig;
};

// ── Phase 53 Plan 03 — lazy-skill compression types ──────────────────────

/**
 * One skill catalog entry with both the description line (compressed form)
 * and the full SKILL.md body (uncompressed form). Session-config populates
 * the `fullContent` field from disk at session start (or falls back to a
 * description+version bullet line when SKILL.md reads fail).
 */
export type SkillCatalogEntry = {
  readonly name: string;
  readonly description: string;
  readonly fullContent: string;
};

/**
 * Usage window read from `SkillUsageTracker.getWindow(agent)`. Shape matches
 * the tracker's frozen return verbatim except we drop the `agent` key (the
 * assembler doesn't need it here).
 */
export type SkillUsageWindow = {
  readonly turns: number;
  readonly capacity: number;
  readonly recentlyUsed: ReadonlySet<string>;
};

/**
 * Resolved lazy-skill configuration (Plan 53-01 Zod output). Session-config
 * pulls this from `agentConfig.perf.lazySkills` after schema validation has
 * applied defaults + the `usageThresholdTurns >= 5` floor.
 */
export type ResolvedLazySkillsConfig = {
  readonly enabled: boolean;
  readonly usageThresholdTurns: number;
  readonly reinflateOnMention: boolean;
};

export const DEFAULT_BUDGETS: ContextBudgets = Object.freeze({
  identity: 1000,
  hotMemories: 3000,
  toolDefinitions: 2000,
  graphContext: 2000,
});

// ── Phase 115 Plan 03 — bounded always-injected tier + outer-cap constants ──

/**
 * Phase 115 sub-scope 1 / D-01 — bounded always-injected tier hard cap.
 *
 * 16,000 chars ≈ 4,000 tokens. Hard cap on the MEMORY.md auto-load that
 * folds into the identity stable-prefix section. Hermes uses 20,000 as
 * their precedent (`CONTEXT_FILE_MAX_CHARS = 20_000`); we run tighter
 * to leave 4K-char margin in the 8K-token outer prefix cap (D-02).
 *
 * REPLACES the legacy `MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024` byte cap
 * (still exported from `config/schema.ts` for back-compat with downstream
 * tests; the active cap on the assembly path is THIS char cap).
 *
 * Read by `buildSessionConfig` in session-config.ts at the MEMORY.md
 * auto-load site (was 50KB byte truncation; now 16K char head-tail
 * truncate with marker).
 */
export const INJECTED_MEMORY_MAX_CHARS = 16_000;

/**
 * Phase 115 sub-scope 1 / D-02 — total stable-prefix outer cap.
 *
 * 8,000 tokens. Hard P0 cap; the per-section budgets (DEFAULT_PHASE53_BUDGETS)
 * sum into this. When per-section enforcement still leaves us over cap, an
 * emergency head-tail truncate fires across the whole prefix (see
 * `enforceTotalStablePrefixBudget` in T02 / Plan 115-03).
 *
 * P1 *delivery* targets are softer (10K fleet p95, 12K fin-acq) — those
 * are observed-load goals; the 8K cap is the structural enforcement floor.
 */
export const STABLE_PREFIX_MAX_TOKENS = 8_000;

// ── Phase 53 Plan 02 — per-section budget surface ──────────────────────────

/**
 * Canonical section names (must match `SECTION_NAMES` in
 * src/performance/context-audit.ts verbatim). Duplicated inline here to avoid
 * a context-assembler -> performance/context-audit import cycle.
 */
export type SectionName =
  | "identity"
  | "soul"
  | "skills_header"
  | "hot_tier"
  | "recent_history"
  | "per_turn_summary"
  | "resume_summary"
  | "conversation_context"; // Phase 67 — must match SECTION_NAMES in performance/context-audit.ts

/**
 * Strategy applied to a section that exceeded its per-section budget.
 *
 *   - `warn-and-keep`          [DEPRECATED] Phase 53 era — identity / soul never
 *                              truncated. REPLACED by `drop-lowest-importance`
 *                              for identity in Phase 115 Plan 03 D-03; the
 *                              literal string is retained here only because
 *                              external test fixtures may pin the value.
 *   - `drop-lowest-importance` identity (Phase 115) + hot_tier: progressive
 *                              priority-ordered drop. For identity: SOUL
 *                              fingerprint > IDENTITY.md > capability >
 *                              MEMORY.md (drops MEMORY.md first).
 *   - `truncate-bullets`       skills_header / fallback hot_tier: drop trailing bullets
 *   - `passthrough`            recent_history / summaries: measured, not truncated
 */
export type SectionBudgetStrategy =
  | "warn-and-keep"
  | "drop-lowest-importance"
  | "truncate-bullets"
  | "passthrough";

/**
 * Event emitted on `onBudgetWarning` when a section exceeds its budget. The
 * full prompt body is NEVER attached — only section name + counts + strategy
 * — so log sinks never persist persona text.
 */
export type BudgetWarningEvent = {
  readonly section: SectionName;
  readonly beforeTokens: number;
  readonly budgetTokens: number;
  readonly strategy: SectionBudgetStrategy;
};

/**
 * Per-section token counts emitted onto the `context_assemble` span metadata
 * under key `section_tokens`. Consumed by Plan 53-01's audit aggregator.
 * All 8 canonical sections ALWAYS populated (0 for absent inputs) so the
 * audit report has a stable row shape. (Phase 67 added `conversation_context`.)
 */
export type SectionTokenCounts = {
  readonly identity: number;
  readonly soul: number;
  readonly skills_header: number;
  readonly hot_tier: number;
  readonly recent_history: number;
  readonly per_turn_summary: number;
  readonly resume_summary: number;
  /** Phase 67 — conversation brief rendered into the mutable suffix (SESS-02). */
  readonly conversation_context: number;
};

/**
 * Phase 53 Plan 02 — per-section budget overrides. All optional; missing
 * entries fall back to `DEFAULT_PHASE53_BUDGETS`. Mirrors
 * `ResolvedAgentConfig.perf.memoryAssemblyBudgets` so session-config can
 * thread the agent's config straight through.
 */
export type MemoryAssemblyBudgets = {
  readonly identity?: number;
  readonly soul?: number;
  readonly skills_header?: number;
  readonly hot_tier?: number;
  readonly recent_history?: number;
  readonly per_turn_summary?: number;
  readonly resume_summary?: number;
};

/**
 * Phase 53 Plan 02 / Phase 115 Plan 03 — per-section budgets (in TOKENS).
 *
 * Phase 115 D-02 lock — replaces the Phase 53 starter values:
 *   identity   was 1000 → 4000 (the carved-up four-sub-source aggregate; ≈D-01's
 *              16K-char MEMORY.md cap + headroom for SOUL/IDENTITY/capability)
 *   soul       was 2000 → 0    (folded into identity; n/a — `passthrough`-style)
 *   skills     was 1500 unchanged
 *   hot_tier   was 3000 → 1000 (CONTEXT.md `hotMemories` line)
 *   per_turn   was 500 unchanged
 *   resume     was 1500 unchanged
 *   recent_history was 8000 unchanged (SDK-owned passthrough)
 *
 * Identity strategy is ALSO updated at the assembler call site
 * (`enforceWarnAndKeep` → `enforceDropLowestImportance`), see T02.
 */
export const DEFAULT_PHASE53_BUDGETS: Required<MemoryAssemblyBudgets> = Object.freeze({
  identity: 4000,
  soul: 0,
  skills_header: 1500,
  hot_tier: 1000,
  recent_history: 8000,
  per_turn_summary: 500,
  resume_summary: 1500,
});

/**
 * Phase 52 Plan 02 — options for `assembleContext`.
 *
 * `priorHotStableToken` is the hot-tier `stable_token` from the PRIOR turn
 * (stored per-agent by SessionManager). When set and when the current turn's
 * token differs, hot-tier migrates from stable to mutable for this turn only.
 *
 * Phase 53 Plan 02 — `memoryAssemblyBudgets` threads per-section budgets
 * from agent config; `onBudgetWarning` fires once per over-budget section
 * so the caller can emit pino WARN logs with agent + turnId context.
 */
export type AssembleOptions = {
  readonly priorHotStableToken?: string;
  readonly memoryAssemblyBudgets?: MemoryAssemblyBudgets;
  readonly onBudgetWarning?: (event: BudgetWarningEvent) => void;
  /**
   * Phase 115 Plan 03 sub-scope 1 / T02 — agent name for the
   * stable-prefix-cap-fallback emergency log. Optional; the cap fallback
   * still fires without it (the log just omits the agent attribution).
   */
  readonly agentName?: string;
  /**
   * Phase 115 Plan 03 sub-scope 1 / T02 — minimal logger sink for the
   * D-02 outer-cap fallback. Only `error` is required. When omitted, the
   * cap fallback still truncates but emits no log line. Production callers
   * (session-config.ts) pass `deps.log` here.
   */
  readonly log?: {
    readonly error?: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

/**
 * Phase 52 Plan 02 — return shape of `assembleContext`.
 *
 * Two separate strings: callers plug `stablePrefix` into
 * `systemPrompt.append` (cached) and `mutableSuffix` into the user-message
 * preamble (uncached). `hotStableToken` is the sha256 of the hot-tier
 * signature THIS turn and should be carried forward into the NEXT turn's
 * `priorHotStableToken`.
 *
 * Phase 53 Plan 02 — this public shape is FROZEN; per-section token counts
 * flow through `assembleContextTraced` -> span.setMetadata instead.
 */
export type AssembledContext = {
  readonly stablePrefix: string;
  readonly mutableSuffix: string;
  readonly hotStableToken: string;
};

/**
 * Phase 52 Plan 02 — sha256 hex of the rendered hot-tier string.
 *
 * Exposed as a named export so SessionManager and tests can compute the token
 * deterministically. This hashes the RENDERED hot-memory block (the same data
 * the assembler would emit) so any textual change flips the hash.
 */
export function computeHotStableToken(hotMemoriesStr: string): string {
  return createHash("sha256").update(hotMemoriesStr, "utf8").digest("hex");
}

/**
 * Phase 52 Plan 02 — sha256 hex of the stable prefix string.
 *
 * Consumed by `SdkSessionAdapter.iterateWithTracing` via the
 * `prefixHashProvider` closure. Per-turn comparison against the prior turn's
 * hash for the same agent drives `cache_eviction_expected` recording.
 *
 * SECURITY: the hash is a 64-char lowercase hex and is safe to log. NEVER
 * log the pre-image (the stable prefix) since it contains the agent's
 * identity/soul text.
 */
export function computePrefixHash(stablePrefix: string): string {
  return createHash("sha256").update(stablePrefix, "utf8").digest("hex");
}

/**
 * Estimate token count using chars/4 heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check whether assembled context exceeds a token ceiling.
 * Default ceiling: 8000 tokens (32000 chars).
 */
export function exceedsCeiling(
  assembled: string,
  ceiling: number = 8000,
): boolean {
  return estimateTokens(assembled) > ceiling;
}

/**
 * Truncate text to fit within a token budget.
 * For bullet-list content (lines starting with "- "), truncates at line
 * boundaries by dropping trailing bullets.
 * For other content, hard-truncates at maxChars with "..." suffix.
 */
function truncateToBudget(text: string, tokenBudget: number): string {
  const maxChars = tokenBudget * 4;

  if (text.length <= maxChars) {
    return text;
  }

  // Check if content is bullet-list style (lines starting with "- ")
  const lines = text.split("\n");
  const isBulletList = lines.some((line) => line.startsWith("- "));

  if (isBulletList) {
    const kept: string[] = [];
    let charCount = 0;

    for (const line of lines) {
      const lineWithNewline = line.length + (kept.length > 0 ? 1 : 0);
      if (charCount + lineWithNewline > maxChars) {
        break;
      }
      kept.push(line);
      charCount += lineWithNewline;
    }

    return kept.join("\n");
  }

  // Hard truncate for non-bullet content
  return text.slice(0, maxChars) + "...";
}

// ── Phase 115 Plan 03 sub-scope 1 — compound-identity composer ────────────

/**
 * Phase 115 Plan 03 sub-scope 1 — compose the identity stable-prefix string
 * from the four carved sub-source fields.
 *
 * Order matches the legacy `identityStr` concatenation in session-config.ts
 * pre-115 so the rendered stable prefix is byte-compatible with prior
 * sessions for agents whose sub-source content is unchanged:
 *
 *   1. SOUL fingerprint + "\n\n"
 *   2. IDENTITY.md raw body
 *   3. agent-name line + capability manifest
 *   4. "\n## Long-term memory (MEMORY.md)\n\n" + MEMORY.md body + "\n"
 *
 * Empty sub-sources are omitted (no empty headers leaked). Order is fixed —
 * tests rely on it for stable-prefix hash continuity.
 */
function composeCarvedIdentity(sources: ContextSources): string {
  const parts: string[] = [];
  const soulFp = sources.identitySoulFingerprint ?? "";
  if (soulFp) parts.push(soulFp + "\n");
  const idFile = sources.identityFile ?? "";
  if (idFile) parts.push(idFile);
  const capManifest = sources.identityCapabilityManifest ?? "";
  if (capManifest) parts.push(capManifest);
  const memoryAutoload = sources.identityMemoryAutoload ?? "";
  if (memoryAutoload) {
    parts.push("\n## Long-term memory (MEMORY.md)\n\n" + memoryAutoload + "\n");
  }
  // Join with no extra separator — each sub-source already carries its own
  // trailing newlines (matches the pre-115 `identityStr +=` concatenation).
  return parts.join("");
}

// ── Phase 53 Plan 02 — per-section enforcement helpers ─────────────────────

function mergeBudgets(
  overrides?: MemoryAssemblyBudgets,
): Required<MemoryAssemblyBudgets> {
  if (!overrides) return DEFAULT_PHASE53_BUDGETS;
  return Object.freeze({
    identity: overrides.identity ?? DEFAULT_PHASE53_BUDGETS.identity,
    soul: overrides.soul ?? DEFAULT_PHASE53_BUDGETS.soul,
    skills_header:
      overrides.skills_header ?? DEFAULT_PHASE53_BUDGETS.skills_header,
    hot_tier: overrides.hot_tier ?? DEFAULT_PHASE53_BUDGETS.hot_tier,
    recent_history:
      overrides.recent_history ?? DEFAULT_PHASE53_BUDGETS.recent_history,
    per_turn_summary:
      overrides.per_turn_summary ?? DEFAULT_PHASE53_BUDGETS.per_turn_summary,
    resume_summary:
      overrides.resume_summary ?? DEFAULT_PHASE53_BUDGETS.resume_summary,
  });
}

/**
 * Phase 115 Plan 03 sub-scope 1 / D-04 — Hermes 70/20 head-tail truncation.
 *
 * Drops the middle 10% with a marker:
 *   `[TRUNCATED — N chars dropped]`
 *
 * Used by `enforceDropLowestImportance` (identity sub-sources) and by
 * `enforceTotalStablePrefixBudget` (outer-cap fallback). Returns input
 * unchanged when already under `targetChars`. Marker text is intentionally
 * generic; the upstream MEMORY.md auto-load site (session-config.ts) uses
 * a richer marker `[TRUNCATED — N chars dropped, dream-pass priority requested]`
 * so its truncation is agent-actionable.
 */
function headTailTruncate(text: string, targetChars: number): string {
  if (text.length <= targetChars) return text;
  const headLen = Math.floor(targetChars * 0.7);
  const tailLen = Math.floor(targetChars * 0.2);
  const dropped = text.length - headLen - tailLen;
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  return `${head}\n\n[TRUNCATED — ${dropped} chars dropped]\n\n${tail}`;
}

/**
 * Phase 115 Plan 03 sub-scope 1 / T02 — drop-lowest-importance for the
 * compound identity aggregate.
 *
 * Importance order (highest priority first → never truncated):
 *   1. SOUL fingerprint     (always preserved verbatim — extractor-bounded ≤1200 chars)
 *   2. IDENTITY.md          (head-tail truncated when needed)
 *   3. capability manifest  (bullet-truncated when needed)
 *   4. MEMORY.md autoload   (separately bounded by INJECTED_MEMORY_MAX_CHARS;
 *                            head-tail truncated FIRST when total still over)
 *
 * Steps when over budget:
 *   A — head-tail-truncate `identityMemoryAutoload` toward 70% of itself
 *       repeatedly until budget is met OR memory is < 100 tokens.
 *   B — bullet-truncate `identityCapabilityManifest` so the identity total
 *       fits under budget.
 *   C — head-tail-truncate `identityFile`.
 *   SOUL fingerprint is NEVER touched.
 *
 * Fires a single budget warning when any drop happened.
 *
 * The composed identity output is rendered the same way as
 * `composeCarvedIdentity`: SOUL + IDENTITY.md + capability + MEMORY.md
 * header + body. Returns the rendered string + total dropped tokens for
 * observability.
 */
function enforceDropLowestImportance(
  carved: {
    readonly identitySoulFingerprint: string;
    readonly identityFile: string;
    readonly identityCapabilityManifest: string;
    readonly identityMemoryAutoload: string;
  },
  budgetTokens: number,
  warn?: (e: BudgetWarningEvent) => void,
): { readonly rendered: string; readonly droppedTokens: number } {
  // Compose first, measure, short-circuit when under budget (no work).
  const renderInitial = composeCarvedIdentity({
    identity: "",
    hotMemories: "",
    toolDefinitions: "",
    graphContext: "",
    discordBindings: "",
    contextSummary: "",
    identitySoulFingerprint: carved.identitySoulFingerprint,
    identityFile: carved.identityFile,
    identityCapabilityManifest: carved.identityCapabilityManifest,
    identityMemoryAutoload: carved.identityMemoryAutoload,
  } as ContextSources);

  const initialTokens = countTokens(renderInitial);
  if (initialTokens <= budgetTokens) {
    return { rendered: renderInitial, droppedTokens: 0 };
  }

  // Mutable working copy for the truncation passes. SOUL fingerprint stays
  // verbatim throughout — extractor-bounded ≤1200 chars and operator-curated.
  let memoryAuto = carved.identityMemoryAutoload;
  let capManifest = carved.identityCapabilityManifest;
  let identityFile = carved.identityFile;

  // Helper to recompute tokens against the running truncated values.
  const measure = (): number =>
    countTokens(
      composeCarvedIdentity({
        identity: "",
        hotMemories: "",
        toolDefinitions: "",
        graphContext: "",
        discordBindings: "",
        contextSummary: "",
        identitySoulFingerprint: carved.identitySoulFingerprint,
        identityFile,
        identityCapabilityManifest: capManifest,
        identityMemoryAutoload: memoryAuto,
      } as ContextSources),
    );

  // Step A — repeatedly halve MEMORY.md until budget met or floor hit.
  // Floor: 100 tokens (≈400 chars) — below this, further halving wastes
  // useful context with marker overhead.
  let total = initialTokens;
  let safety = 12; // cap iterations: after 12 halvings of 16K we're ≤ 4 chars.
  while (
    total > budgetTokens &&
    countTokens(memoryAuto) > 100 &&
    safety-- > 0
  ) {
    const targetChars = Math.max(400, Math.floor(memoryAuto.length * 0.7));
    if (targetChars >= memoryAuto.length) break; // can't shrink further
    memoryAuto = headTailTruncate(memoryAuto, targetChars);
    total = measure();
  }

  // Step B — bullet-truncate capability manifest to fit remaining budget.
  if (total > budgetTokens && capManifest.length > 0) {
    const overTokens = total - budgetTokens;
    const overChars = overTokens * 4;
    const newManifestChars = Math.max(0, capManifest.length - overChars);
    if (newManifestChars < capManifest.length) {
      capManifest = truncateToBudget(
        capManifest,
        Math.max(0, Math.floor(newManifestChars / 4)),
      );
    }
    total = measure();
  }

  // Step C — head-tail truncate IDENTITY.md as last resort. SOUL fingerprint
  // remains verbatim no matter what.
  if (total > budgetTokens && identityFile.length > 0) {
    const overTokens = total - budgetTokens;
    const overChars = overTokens * 4;
    const newIdFileChars = Math.max(400, identityFile.length - overChars);
    if (newIdFileChars < identityFile.length) {
      identityFile = headTailTruncate(identityFile, newIdFileChars);
    }
    total = measure();
  }

  const rendered = composeCarvedIdentity({
    identity: "",
    hotMemories: "",
    toolDefinitions: "",
    graphContext: "",
    discordBindings: "",
    contextSummary: "",
    identitySoulFingerprint: carved.identitySoulFingerprint,
    identityFile,
    identityCapabilityManifest: capManifest,
    identityMemoryAutoload: memoryAuto,
  } as ContextSources);

  const finalTokens = countTokens(rendered);
  const droppedTokens = Math.max(0, initialTokens - finalTokens);

  // Fire one warn for the section as a whole.
  if (warn) {
    warn(
      Object.freeze({
        section: "identity",
        beforeTokens: initialTokens,
        budgetTokens,
        strategy: "drop-lowest-importance",
      }),
    );
  }

  return { rendered, droppedTokens };
}

/**
 * Phase 115 Plan 03 sub-scope 1 / D-02 — total stable-prefix outer cap.
 *
 * 8K-token hard cap on the assembled stable prefix. When per-section
 * enforcement still leaves us over, this fires an emergency head-tail
 * truncate across the WHOLE prefix and logs a `stable-prefix-cap-fallback`
 * line so the operator sees we hit the safety net.
 *
 * Returns the (possibly truncated) joined string. The caller plugs the
 * result back into the `stableParts` array as a single element so the
 * assembler doesn't need to know about the truncation.
 */
function enforceTotalStablePrefixBudget(
  joined: string,
  maxTokens: number,
  log:
    | {
        error?: (obj: Record<string, unknown>, msg?: string) => void;
      }
    | undefined,
  agentName: string | undefined,
): string {
  const total = countTokens(joined);
  if (total <= maxTokens) return joined;
  const targetChars = maxTokens * 4;
  const truncated = headTailTruncate(joined, targetChars);
  if (log?.error) {
    log.error(
      {
        agent: agentName,
        beforeTokens: total,
        afterTokens: countTokens(truncated),
        action: "stable-prefix-cap-fallback",
      },
      "[diag] stable-prefix-cap-fallback emergency truncation fired — per-section budgets failed to keep total under cap",
    );
  }
  return truncated;
}

/**
 * Over-budget bullet-list sections (skills_header) reuse the legacy
 * `truncateToBudget` drop-trailing-lines strategy. Fires one warn on truncation.
 */
function enforceBulletTruncation(
  text: string,
  section: SectionName,
  budget: number,
  warn?: (e: BudgetWarningEvent) => void,
): string {
  if (!text) return "";
  const tokens = countTokens(text);
  if (tokens <= budget) return text;
  if (warn) {
    warn(
      Object.freeze({
        section,
        beforeTokens: tokens,
        budgetTokens: budget,
        strategy: "truncate-bullets",
      }),
    );
  }
  return truncateToBudget(text, budget);
}

/**
 * Phase 53 Plan 02 — hot-tier importance-ordered truncation.
 *
 * When `entries` is supplied, sort by importance desc, accumulate bullet
 * cost (in tokens) and stop as soon as adding the next entry would exceed
 * budget (keeping at least 1 entry even if it individually exceeds budget —
 * otherwise the section would silently disappear).
 *
 * When `entries` is absent (back-compat with Phase 52 callers), fall back to
 * bullet-line truncation on `preRenderedHot`.
 */
function selectHotMemoriesWithinBudget(
  preRenderedHot: string,
  entries: readonly MemoryEntry[] | undefined,
  budget: number,
  warn: ((e: BudgetWarningEvent) => void) | undefined,
): { readonly rendered: string } {
  if (!entries || entries.length === 0) {
    if (!preRenderedHot) return Object.freeze({ rendered: "" });
    const tokens = countTokens(preRenderedHot);
    if (tokens <= budget) return Object.freeze({ rendered: preRenderedHot });
    if (warn) {
      warn(
        Object.freeze({
          section: "hot_tier",
          beforeTokens: tokens,
          budgetTokens: budget,
          strategy: "truncate-bullets",
        }),
      );
    }
    return Object.freeze({ rendered: truncateToBudget(preRenderedHot, budget) });
  }

  const sorted = [...entries].sort((a, b) => b.importance - a.importance);
  const kept: MemoryEntry[] = [];
  let running = 0;
  for (const mem of sorted) {
    const line = `- ${mem.content}`;
    const cost = countTokens(line);
    if (running + cost > budget && kept.length > 0) break;
    kept.push(mem);
    running += cost;
  }

  if (kept.length < sorted.length && warn) {
    const fullText = sorted.map((m) => `- ${m.content}`).join("\n");
    warn(
      Object.freeze({
        section: "hot_tier",
        beforeTokens: countTokens(fullText),
        budgetTokens: budget,
        strategy: "drop-lowest-importance",
      }),
    );
  }

  return Object.freeze({
    rendered: kept.map((m) => `- ${m.content}`).join("\n"),
  });
}

// ── Phase 53 Plan 03 — lazy-skill rendering helper ───────────────────────

/**
 * Decision matrix for a single skill:
 *
 *   - `warmUp === true`           → full content (disabled / under threshold)
 *   - `recentlyUsed.has(name)`    → full content
 *   - `mentioned.has(name)`       → full content (re-inflate on mention)
 *   - otherwise                   → compressed one-liner (`- name: desc`)
 *
 * Compressed skills STAY in the catalog block — they are NOT dropped.
 * This preserves discoverability (CONTEXT.md Specifics #2).
 *
 * Returns the rendered text alongside counts for span telemetry.
 */
function renderSkillsHeader(sources: ContextSources): {
  readonly rendered: string;
  readonly includedCount: number;
  readonly compressedCount: number;
} {
  const skills = sources.skills ?? [];
  if (skills.length === 0) {
    // Legacy path — no lazy skills, pass-through the precomposed header.
    return {
      rendered: sources.skillsHeader ?? "",
      includedCount: 0,
      compressedCount: 0,
    };
  }

  const cfg = sources.lazySkillsConfig;
  const usage = sources.skillUsage;
  // Warm-up / disabled — every skill renders full content.
  const warmUp =
    !cfg ||
    !cfg.enabled ||
    !usage ||
    usage.turns < cfg.usageThresholdTurns;

  const catalogNames = skills.map((s) => s.name);
  let mentioned: Set<string> = new Set<string>();
  if (cfg?.reinflateOnMention && !warmUp) {
    const fromUser = extractSkillMentions(
      sources.currentUserMessage ?? "",
      catalogNames,
    );
    const fromAssistant = extractSkillMentions(
      sources.lastAssistantMessage ?? "",
      catalogNames,
    );
    mentioned = new Set<string>([...fromUser, ...fromAssistant]);
  }

  const lines: string[] = [];
  let included = 0;
  let compressed = 0;

  for (const skill of skills) {
    const isRecent = usage?.recentlyUsed.has(skill.name) === true;
    const isMentioned = mentioned.has(skill.name);
    const keepFull = warmUp || isRecent || isMentioned;
    if (keepFull) {
      lines.push(skill.fullContent);
      included++;
    } else {
      lines.push(`- ${skill.name}: ${skill.description}`);
      compressed++;
    }
  }

  return {
    rendered: lines.join("\n\n"),
    includedCount: included,
    compressedCount: compressed,
  };
}

/**
 * Internal shared implementation returning both the public AssembledContext
 * shape and per-section token counts. The public `assembleContext` strips
 * the counts (Phase 52 shape contract); `assembleContextTraced` forwards
 * them onto the `context_assemble` span.
 */
function assembleContextInternal(
  sources: ContextSources,
  budgets: ContextBudgets,
  opts: AssembleOptions | undefined,
): {
  readonly assembled: AssembledContext;
  readonly sectionTokens: SectionTokenCounts;
  readonly skillsIncludedCount: number;
  readonly skillsCompressedCount: number;
} {
  const phaseBudgets = mergeBudgets(opts?.memoryAssemblyBudgets);
  const warn = opts?.onBudgetWarning;

  // 1. identity — Phase 115 sub-scope 1 / D-03 transition.
  //
  // When upstream populates the four carved sub-source fields
  // (identitySoulFingerprint, identityFile, identityCapabilityManifest,
  // identityMemoryAutoload), route through `enforceDropLowestImportance`:
  // SOUL fingerprint is verbatim-protected (highest importance), and the
  // other three are progressively truncated (memory → capability →
  // identityFile) until budget fits.
  //
  // When any of the four sub-source fields is undefined (legacy callers,
  // existing tests passing only `sources.identity`), fall through to the
  // pre-115 head-tail-truncate path: identity over budget gets head-tail
  // truncated as a single block. (This is the new D-03 default; previous
  // `enforceWarnAndKeep` no-op is GONE per Phase 115 D-03.)
  const useCarvedIdentity =
    sources.identitySoulFingerprint !== undefined ||
    sources.identityFile !== undefined ||
    sources.identityCapabilityManifest !== undefined ||
    sources.identityMemoryAutoload !== undefined;

  let identityOut: string;
  if (useCarvedIdentity) {
    const carvedResult = enforceDropLowestImportance(
      {
        identitySoulFingerprint: sources.identitySoulFingerprint ?? "",
        identityFile: sources.identityFile ?? "",
        identityCapabilityManifest: sources.identityCapabilityManifest ?? "",
        identityMemoryAutoload: sources.identityMemoryAutoload ?? "",
      },
      phaseBudgets.identity,
      warn,
    );
    identityOut = carvedResult.rendered;
  } else {
    // Legacy path — single compound identity string. Phase 115 D-03 replaces
    // the old `warn-and-keep` no-op with real head-tail truncation. Tests
    // that pin "identity is preserved verbatim regardless of budget" are
    // updated atomically per the Phase 115 plan note that this is a
    // BREAKING contract change. SOUL fingerprint protection in the carved
    // path requires the carved fields; the legacy compound path can't
    // distinguish SOUL from MEMORY.md, so the whole compound block is
    // head-tail truncated when over budget.
    const tokens = countTokens(sources.identity);
    if (sources.identity && tokens > phaseBudgets.identity) {
      const targetChars = phaseBudgets.identity * 4;
      identityOut = headTailTruncate(sources.identity, targetChars);
      if (warn) {
        warn(
          Object.freeze({
            section: "identity",
            beforeTokens: tokens,
            budgetTokens: phaseBudgets.identity,
            strategy: "drop-lowest-importance",
          }),
        );
      }
    } else {
      identityOut = sources.identity;
    }
  }

  // 2. soul — Phase 115 D-03 + D-04 head-tail truncate when over budget.
  //    With D-02 budget = 0 (folded into identity), any non-empty soul
  //    triggers a warn + truncation. When the upstream folds SOUL into
  //    identity and passes `sources.soul === ""`, this short-circuits.
  let soulOut = sources.soul ?? "";
  if (soulOut) {
    const soulTokens = countTokens(soulOut);
    if (soulTokens > phaseBudgets.soul) {
      // Head-tail truncate to budget*4 chars, OR to 1-char + marker when
      // budget is 0 (special-case the D-02 folded-into-identity locked value).
      const targetChars = Math.max(1, phaseBudgets.soul * 4);
      soulOut = phaseBudgets.soul > 0
        ? headTailTruncate(soulOut, targetChars)
        : ""; // D-02 lock — soul is folded into identity; budget=0 drops content.
      if (warn) {
        warn(
          Object.freeze({
            section: "soul",
            beforeTokens: soulTokens,
            budgetTokens: phaseBudgets.soul,
            strategy: "drop-lowest-importance",
          }),
        );
      }
    }
  }

  // 3. skills_header — Phase 53 Plan 03 lazy-skill compression, then
  //    Phase 53 Plan 02 bullet-truncation on the rendered result.
  const lazyOut = renderSkillsHeader(sources);
  const skillsOut = enforceBulletTruncation(
    lazyOut.rendered,
    "skills_header",
    phaseBudgets.skills_header,
    warn,
  );

  // 4. hot_tier — importance-ordered drop (or fallback bullet truncation)
  const hotInput = selectHotMemoriesWithinBudget(
    sources.hotMemories,
    sources.hotMemoriesEntries,
    phaseBudgets.hot_tier,
    warn,
  );

  // 5. recent_history — passthrough (SDK owns)
  const recentHistoryText = sources.recentHistory ?? "";

  // 6/7. per_turn_summary + resume_summary — split when new fields present,
  //      legacy contextSummary used for resume_summary when new fields absent.
  const perTurn = sources.perTurnSummary ?? "";
  const resumeSum = sources.resumeSummary ?? sources.contextSummary;

  // 8. conversation_context — Phase 67 — pre-budget-enforced brief from
  //    `assembleConversationBrief` (src/memory/conversation-brief.ts). Pure
  //    passthrough here: the helper already applied the accumulate-strategy
  //    budget BEFORE this string was built, so the assembler only measures.
  const conversationContext = sources.conversationContext ?? "";

  // ── Placement ────────────────────────────────────────────────────────────
  const stableParts: string[] = [];
  const mutableParts: string[] = [];

  // Phase 94 TOOL-10 / D-10 — system-prompt directives are operator-mandated
  // rules and lead the stable prefix so the LLM sees them BEFORE persona,
  // tools, and memory. Single integration site (no duplicate prepends).
  // Empty string short-circuits — no marker, no leading whitespace, byte-
  // identical to the no-directives baseline (REG-ASSEMBLER-EMPTY-WHEN-
  // DISABLED — required for prompt-cache hash stability when all
  // directives are disabled by operator override).
  if (sources.systemPromptDirectives && sources.systemPromptDirectives.length > 0) {
    stableParts.push(sources.systemPromptDirectives);
  }

  // Identity stays in stablePrefix (no section header — fingerprint has its own formatting)
  if (identityOut) {
    stableParts.push(identityOut);
  }

  // Soul in stablePrefix (carved out from identity when session-config supplies it)
  if (soulOut) {
    stableParts.push(soulOut);
  }

  // Hot-tier placement — Phase 52 stable_token logic applied to the
  // (possibly importance-truncated) rendered hot-tier string.
  const currentHotToken = computeHotStableToken(hotInput.rendered);
  if (hotInput.rendered) {
    const hotBlock = "## Key Memories\n\n" + hotInput.rendered;
    const priorToken = opts?.priorHotStableToken;
    const hotInMutable =
      priorToken !== undefined && priorToken !== currentHotToken;
    if (hotInMutable) {
      mutableParts.push(hotBlock);
    } else {
      stableParts.push(hotBlock);
    }
  }

  // Combined "Available Tools" header: skillsHeader (Phase 53) + toolDefinitions (Phase 52).
  // Session-config can populate either or both — the header renders once.
  const toolsCombined = [skillsOut, sources.toolDefinitions]
    .filter((s) => s && s.length > 0)
    .join("\n\n");
  if (toolsCombined) {
    stableParts.push(
      "## Available Tools\n\n" +
        truncateToBudget(toolsCombined, budgets.toolDefinitions),
    );
  }

  // ── Phase 96 Plan 02 D-02 — <filesystem_capability> block insertion ─────
  //
  // Insertion site sits BETWEEN literal-string anchor `<tool_status>` (Phase
  // 94 sentinel) and literal-string anchor `<dream_log_recent>` (Phase 95
  // sentinel). The renderer is `renderFilesystemCapabilityBlock` from
  // src/prompt/filesystem-capability-block.ts — invoked at the daemon edge
  // (session-config.ts) and threaded through `sources.filesystemCapabilityBlock`.
  //
  // When the fs block is empty (v2.5 fixture without fileAccess declared),
  // NEITHER the triplet markers NOR the block render — the stable prefix
  // is byte-identical to v2.5 (CA-FS-2 + CA-FS-4 cache-stability invariants).
  //
  // When non-empty, the triplet renders in this exact order — pinned by
  // the static-grep regression test in 96-02-PLAN.md:
  //   grep -A 50 '<tool_status>' src/manager/context-assembler.ts \
  //     | grep -q '<filesystem_capability>' \
  //     && grep -q '<dream_log_recent>' src/manager/context-assembler.ts
  //
  // The bookend markers `<tool_status></tool_status>` and
  // `<dream_log_recent></dream_log_recent>` are positioning sentinels — they
  // wrap NO content today (Phase 94's MCP block lives inside `toolDefinitions`
  // above; Phase 95's dream-log writer emits to disk, not the prompt). They
  // exist so a future plan that wants to inject content can land a string
  // between them without disturbing the fs block's byte position. Pitfall 4
  // from RESEARCH.md: any movement of the fs block changes the fleet-wide
  // stable-prefix hash and triggers fleet-wide Anthropic cache miss on
  // deploy. Static-grep on this very file pins the byte order.
  if (sources.filesystemCapabilityBlock && sources.filesystemCapabilityBlock.length > 0) {
    stableParts.push(
      "<tool_status></tool_status>\n" +
        sources.filesystemCapabilityBlock +
        "\n<dream_log_recent></dream_log_recent>",
    );
  }

  // Phase 999.13 DELEG-02 — per-agent delegates directive lands at the END of
  // the stable prefix's tools-and-capability cluster (after tools, after fs
  // capability). Per CONTEXT.md "block goes at the bottom of the agent's
  // system prompt".
  //
  // Empty/undefined short-circuits — byte-identical to no-delegates baseline.
  // Required for prompt-cache hash stability: agents without delegates see
  // NO fleet-wide cache invalidation on Phase 999.13 deploy (Pitfall 2 in
  // 999.13-RESEARCH.md).
  if (sources.delegatesBlock && sources.delegatesBlock.length > 0) {
    stableParts.push(sources.delegatesBlock);
  }

  // Graph context (Phase 41/52) stable
  if (sources.graphContext) {
    stableParts.push(
      "## Related Context\n\n" +
        truncateToBudget(sources.graphContext, budgets.graphContext),
    );
  }

  // Discord bindings pass-through in MUTABLE
  if (sources.discordBindings) {
    mutableParts.push(sources.discordBindings);
  }

  // Per-turn summary in mutable (Phase 53)
  if (perTurn) {
    mutableParts.push(perTurn);
  }

  // Resume summary in mutable — falls through to legacy contextSummary when new fields absent
  if (resumeSum) {
    mutableParts.push(resumeSum);
  }

  // Phase 67 — conversation brief in MUTABLE SUFFIX (never stable prefix).
  //   Placement: LAST in the mutable ordering so the most-concrete signal
  //   (`resumeSum`, i.e. "what you were doing last turn") sits closer to
  //   the user's message, and the "background context" brief trails it.
  //   The stable-prefix boundary is critical for prompt-cache stability —
  //   see Pitfall 1 in 67-RESEARCH.md and CONTEXT.md Decisions.
  if (conversationContext) {
    mutableParts.push(conversationContext);
  }

  const sectionTokens: SectionTokenCounts = Object.freeze({
    identity: countTokens(identityOut),
    soul: countTokens(soulOut),
    skills_header: countTokens(skillsOut),
    hot_tier: countTokens(hotInput.rendered),
    recent_history: countTokens(recentHistoryText),
    per_turn_summary: countTokens(perTurn),
    resume_summary: countTokens(resumeSum),
    conversation_context: countTokens(conversationContext), // Phase 67
  });

  // Phase 115 Plan 03 sub-scope 1 / D-02 — emergency outer-cap fallback.
  //
  // After per-section enforcement, if the joined stable prefix STILL exceeds
  // STABLE_PREFIX_MAX_TOKENS (8K), head-tail-truncate the whole prefix as a
  // last resort. This shouldn't normally fire — per-section budgets sum to
  // well under 8K — but it's the structural safety net Phase 115 D-02
  // commits to. The error log is operator-grep-friendly so a recurring
  // fallback signal triggers a deeper audit.
  const joinedStable = stableParts.join("\n\n");
  const stablePrefix = enforceTotalStablePrefixBudget(
    joinedStable,
    STABLE_PREFIX_MAX_TOKENS,
    opts?.log,
    opts?.agentName,
  );

  return Object.freeze({
    assembled: Object.freeze({
      stablePrefix,
      mutableSuffix: mutableParts.join("\n\n"),
      hotStableToken: currentHotToken,
    }),
    sectionTokens,
    skillsIncludedCount: lazyOut.includedCount,
    skillsCompressedCount: lazyOut.compressedCount,
  });
}

/**
 * Assemble context into stable + mutable blocks with per-source budgets.
 *
 * Stable prefix (cacheable via SDK preset+append):
 *   identity → soul → hotMemories (when stable) → toolDefinitions → graphContext
 *
 * Mutable suffix (per-turn, outside cache):
 *   [hotMemories (when hot-tier composition just changed)] → discordBindings
 *   → perTurnSummary → resumeSummary
 *
 * The hot-tier placement decision:
 *   - If `opts.priorHotStableToken` is undefined → hot-tier in stable
 *     (first turn of a fresh session — no thrashing signal yet).
 *   - If `opts.priorHotStableToken === currentHotToken` → hot-tier in stable
 *     (composition unchanged since prior turn).
 *   - Otherwise → hot-tier in mutable FOR THIS TURN ONLY (composition drift
 *     on the boundary; next unchanged turn re-enters the cached block).
 *
 * Phase 53 Plan 02 — per-section budget enforcement:
 *   When `opts.memoryAssemblyBudgets` is supplied, over-budget sections fire
 *   `opts.onBudgetWarning(event)` and apply their section-specific strategy:
 *     identity/soul → warn-and-keep | hot_tier → drop-lowest-importance
 *     skills_header → truncate-bullets
 *   Per-section counts are measured regardless of budget state and can be
 *   surfaced via `assembleContextTraced` on the `context_assemble` span.
 *
 * Empty sources are omitted entirely (no empty headers).
 * Discord bindings and summaries are pass-through (no truncation in assembler).
 */
export function assembleContext(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
  opts?: AssembleOptions,
): AssembledContext {
  return assembleContextInternal(sources, budgets, opts).assembled;
}

/**
 * Traced wrapper around {@link assembleContext}.
 *
 * Opens a `context_assemble` span before invoking `assembleContext` and ends
 * it in a `finally` block regardless of outcome (success or throw). When
 * `turn` is undefined the wrapper is a pass-through — no span is started.
 *
 * Phase 52 Plan 02 — signature widened to forward `AssembleOptions` through
 * so per-turn callers that thread `priorHotStableToken` preserve the
 * hot-tier stable_token semantic.
 *
 * Phase 53 Plan 02 — forwards per-section token counts onto the span as
 * `metadata_json.section_tokens` (consumed by the 53-01 audit CLI).
 *
 * WIRING NOTE (Phase 50 Plan 02 Case A carried forward): most current call
 * sites of `assembleContext` live inside `buildSessionConfig` and run at
 * agent-startup / session-resume — NOT per turn. The traced wrapper exists
 * for future per-turn refresh paths; today the segment row reports count=0
 * unless a caller opts in.
 */
export function assembleContextTraced(
  sources: ContextSources,
  budgets: ContextBudgets = DEFAULT_BUDGETS,
  opts?: AssembleOptions,
  turn?: Turn,
): AssembledContext {
  const span = turn?.startSpan("context_assemble");
  try {
    const {
      assembled,
      sectionTokens,
      skillsIncludedCount,
      skillsCompressedCount,
    } = assembleContextInternal(sources, budgets, opts);
    // Phase 53 Plan 02 — per-section token counts for audit aggregation.
    // Metadata key is snake_case `section_tokens` so it matches the consumer
    // shape in src/performance/context-audit.ts verbatim.
    // Phase 53 Plan 03 — lazy-skill telemetry: skills_included_count +
    // skills_compressed_count ride on the same span metadata blob so the
    // audit aggregator can surface compression savings.
    span?.setMetadata({
      section_tokens: sectionTokens,
      skills_included_count: skillsIncludedCount,
      skills_compressed_count: skillsCompressedCount,
    });
    return assembled;
  } finally {
    span?.end();
  }
}
