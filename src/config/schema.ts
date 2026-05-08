import { z } from "zod/v4";
import { memoryConfigSchema } from "../memory/schema.js";

/**
 * Valid Claude model identifiers.
 */
export const modelSchema = z.enum(["sonnet", "opus", "haiku"]);

/**
 * Valid reasoning effort levels for the Claude API.
 * Controls how much thinking the model does per response.
 *
 * Phase 83 EFFORT-04 — extended from the v2.1 set (`low|medium|high|max`) to
 * the v2.2 set by adding:
 *   - `xhigh` → between `high` and `max` (mirrors OpenClaw's xhigh input)
 *   - `auto`  → reset to model default via q.setMaxThinkingTokens(null)
 *   - `off`   → explicit disable via q.setMaxThinkingTokens(0)
 *
 * Extension is additive: v2.1 migrated YAMLs (all 15 agents carry
 * `effort: low`) parse unchanged.
 */
export const effortSchema = z.enum([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
  "off",
]);
export type EffortLevel = z.infer<typeof effortSchema>;

/**
 * Phase 90 MEM-01 D-17 — 50KB hard cap on MEMORY.md auto-load.
 *
 * ~12.5K tokens — comfortable in Sonnet stable-prefix budget. Larger files
 * are truncated with a marker at injection time (session-config.ts); a
 * future MEM-02 phase chunks the rest into memory_chunks for retrieval.
 *
 * Exported so session-config.ts can enforce the cap without re-defining
 * the constant and to keep the regression-pin grep target stable.
 */
export const MEMORY_AUTOLOAD_MAX_BYTES = 50 * 1024;

/**
 * Canonical latency segment names — mirrored from src/performance/types.ts
 * `CANONICAL_SEGMENTS`. Kept inline (not imported) to avoid a config -> performance
 * dependency cycle and to keep schema parsing self-contained.
 */
const sloSegmentEnum = z.enum([
  "end_to_end",
  "first_token",
  "context_assemble",
  "tool_call",
]);

/**
 * Per-entry SLO override allowed in clawcode.yaml under `perf.slos`.
 * The Zod parse output is consumed by the daemon (Plan 51-03) via the
 * `ResolvedAgentConfig.perf.slos` TS type and merged with `DEFAULT_SLOS`
 * through `mergeSloOverrides` (src/performance/slos.ts).
 */
export const sloOverrideSchema = z.object({
  segment: sloSegmentEnum,
  metric: z.enum(["p50", "p95", "p99"]),
  thresholdMs: z.number().int().positive(),
});

/** Inferred SLO override type. */
export type SloOverrideConfig = z.infer<typeof sloOverrideSchema>;

/**
 * Memory configuration schema for compaction and search settings.
 * Re-exported from the memory module for config-level use.
 */
export const memorySchema = memoryConfigSchema;

/** Inferred memory config type. */
export type MemoryConfig = z.infer<typeof memorySchema>;

/**
 * Phase 94 TOOL-10 / D-10 — system-prompt directive shape.
 *
 * Each directive carries an enabled flag + the verbatim text the LLM sees
 * prepended to its stable prefix. Defaults (DEFAULT_SYSTEM_PROMPT_DIRECTIVES
 * below) ship two entries — file-sharing (D-09) and cross-agent-routing
 * (D-07) — both default-enabled per operator decision.
 *
 * 8th application of the Phase 83/86/89/90/92 additive-optional schema
 * blueprint: legacy v2.5 migrated configs without this field parse
 * unchanged because `defaultsSchema.systemPromptDirectives` is default-
 * bearing and `agentSchema.systemPromptDirectives` is fully optional.
 */
export const systemPromptDirectiveSchema = z.object({
  enabled: z.boolean(),
  text: z.string(),
});

/** Inferred Phase 94 directive type (per-key shape). */
export type SystemPromptDirective = z.infer<typeof systemPromptDirectiveSchema>;

/**
 * Phase 94 D-09 + D-07 — fleet-wide default directives.
 *
 * Verbatim from 94-CONTEXT.md decisions D-09 (file-sharing) and D-07
 * (cross-agent-routing). The directive TEXT is the LLM-facing instruction;
 * subtle wording changes can change LLM behavior in unobvious ways. Pinned
 * by static-grep regression tests:
 *   - "ALWAYS upload via Discord" (D-09 file-sharing)
 *   - "NEVER just tell the user a local file path" (D-09 NEVER clause)
 *   - "suggest the user ask another agent" (D-07 cross-agent-routing)
 *
 * Frozen so downstream code can't mutate the global default record.
 */
export const DEFAULT_SYSTEM_PROMPT_DIRECTIVES: Readonly<
  Record<string, SystemPromptDirective>
> = Object.freeze({
  "file-sharing": Object.freeze({
    enabled: true,
    // Phase 94 D-09 baseline + Phase 96 D-10 extension (2026-04-25):
    //   1. Auto-upload heuristic — distinguishes file-as-artifact references
    //      ("here's the PDF", "I generated X") from text-only Q&A about file
    //      content ("the PDF says X"). The former MUST upload via
    //      clawcode_share_file; the latter MUST NOT.
    //   2. OpenClaw-fallback prohibition — operator surfaced this anti-pattern
    //      in #finmentum-client-acquisition on 2026-04-25 (bot recommended
    //      "spawn a subagent on the OpenClaw side" for DB access). OpenClaw
    //      is being deprecated; recommending it as a fallback reinforces a
    //      sunset path. Agents instead surface the actual gap to the operator.
    //
    // Pinned by static-grep regression tests:
    //   - "ALWAYS upload via Discord"            (Phase 94 D-09 verbatim)
    //   - "NEVER just tell the user a local file path" (Phase 94 D-09 NEVER)
    //   - "When you produce a file the user wants to access" (D-10 auto-upload)
    //   - "If your response is text-only Q&A about file content" (D-10 negative)
    //   - "NEVER recommend falling back to the legacy OpenClaw agent" (D-10 prohibition)
    //   - "OpenClaw is being deprecated"          (D-10 deprecation rationale)
    text:
      "When you produce a file the user wants to access, ALWAYS upload via Discord (the channel/thread you're answering in) and return the CDN URL. NEVER just tell the user a local file path they can't reach (e.g., '/home/clawcode/...'). If unsure where to send it, ask which channel.\n\n" +
      "When you produce a file the user wants to access OR your response references a file as an artifact (\"here's the PDF\", \"I generated X\", \"attached below\", or includes file as evidence), upload it via clawcode_share_file and include the CDN URL inline. If your response is text-only Q&A about file content (e.g., \"the PDF says X\"), do NOT upload — the user is asking about content, not asking for the file.\n\n" +
      "NEVER recommend falling back to the legacy OpenClaw agent or \"the OpenClaw side\" to work around a capability gap (filesystem, network, DB, MCP, etc.). OpenClaw is being deprecated — recommending it as a fallback reinforces a sunset path. Instead: surface the actual gap clearly to the operator (e.g., \"I cannot reach the DB from this container — Docker bridge IP 172.17.0.1 is not in the MySQL bind-address allowlist; please add it\"; \"I cannot read /path/X — please extend my fileAccess in clawcode.yaml or check ACLs\"; \"MCP server Y is not responding — please check its health\"). Ask the operator to fix the underlying capability so I can do the work directly next time.",
  }),
  "cross-agent-routing": Object.freeze({
    enabled: true,
    text: "If a user asks you to do something requiring a tool you don't have, check your tool list. If unavailable, suggest the user ask another agent (mention specific channel/agent name) that has the tool ready.",
  }),
  // Phase 99 sub-scope K (2026-04-26) — operator observed agents blocking the
  // main channel while a subagent / opus delegation runs. They had to manually
  // ask "use a subagent thread" every time. Make it the default behavior:
  // any long-running / heavy operation routes to a Discord subthread via the
  // subagent-thread skill, and the main agent stays available for follow-ups.
  "subagent-routing": Object.freeze({
    enabled: true,
    text:
      "When you would delegate work / spawn a subagent / call opus / run any operation that takes >30 seconds (deep research, multi-file refactor, large analysis, PDF generation, complex DB queries, web scraping, batch operations), ALWAYS route the work into a Discord subthread using the `spawn_subagent_thread` MCP tool instead of blocking the current channel.\n\n" +
      "USE: `spawn_subagent_thread` MCP tool (or `subagent-thread` skill which wraps it). This is FIRE-AND-FORGET — returns the thread URL immediately, the subagent runs in the background and posts directly to the Discord thread.\n\n" +
      "DO NOT USE: the SDK's built-in `Task` tool for any operator-facing delegation. `Task` is BLOCKING — your turn pauses while the child runs, the typing indicator stays on, and the operator can't reach you in the channel until the child finishes. `Task` is acceptable only for sub-second internal tool composition (e.g., a quick one-shot search the LLM uses inside a single response), never for user-visible work.\n\n" +
      "Pattern (5 steps, in order):\n" +
      "1. Briefly acknowledge in the current channel (1-2 sentences max): \"Spinning up a subagent in a thread to dig into this; I'll keep this channel free for follow-ups.\"\n" +
      "2. Call `spawn_subagent_thread` with `task` set to the FULL work description. The subagent starts on the task automatically — you do NOT need to send a follow-up.\n" +
      "3. Return the thread URL inline (1 sentence: \"Working in <thread-name> — results post there.\").\n" +
      "4. END YOUR TURN. Do NOT call `read_thread` to poll the subagent's progress. Do NOT call `Task`. Do NOT loop on tool calls waiting for output. The subagent posts its results in the thread; the operator can read them there.\n" +
      "5. On the operator's NEXT turn (or at any future point), if they ask \"what did the subagent say\" or similar, THEN call `read_thread` once with the saved thread ID, summarize, return.\n\n" +
      "Why this matters: Discord shows \"<agent> is typing...\" while your turn is active. If you stay in the turn polling `read_thread` or running `Task`, the operator sees typing-state for minutes — they think you're stuck and can't ask follow-ups. The subthread pattern unblocks the channel immediately.\n\n" +
      "When NOT to use a subthread:\n" +
      "- Quick lookups (<10s expected — single memory_lookup, single tool call, simple Q&A from loaded context).\n" +
      "- Conversational replies that need the main thread's flow continuity.\n" +
      "- When the user explicitly says \"do it inline\" or \"don't use a subthread\".\n\n" +
      "Default to subthread when in doubt. Blocking the main channel for a multi-minute task is worse UX than a subthread the operator can collapse if uninterested.",
  }),
  // Phase 100-fu (2026-04-26) — silent-recall problem fix. Pre-100-fu the
  // pre-turn <memory-context> auto-injection only included the top-K hybrid
  // RRF chunks from MEMORY.md. The agent's own saved memories
  // (memory_save → memories table) were ONLY visible if the agent explicitly
  // invoked memory_lookup. So when an operator asked "what's my favorite
  // X?" or "what did I tell you about Y?", the agent often said "I don't
  // know" because (a) the relevant memory was in the memories table not the
  // chunks table OR (b) auto-retrieval's top-K didn't surface it.
  //
  // Fix lives in two parts:
  //   1. Code-level (memory-retrieval.ts) — fan out to memories table so
  //      saved memories are auto-injected too.
  //   2. Prompt-level (this directive) — instruct the agent to invoke
  //      memory_lookup before saying "I don't know" since auto-retrieval
  //      can still miss specific facts buried in long memories.
  //
  // Pinned by static-grep: "Before saying 'I don't know'" (line 1) and
  // "memory_lookup" (multiple).
  "memory-recall-before-uncertainty": Object.freeze({
    enabled: true,
    text:
      "Before saying 'I don't know' or 'I don't remember' or 'I don't have that information', ALWAYS invoke the `memory_lookup` MCP tool with the user's question terms. The `<memory-context>` block at the start of your turn is auto-populated with relevant content but covers only the top-K matches — for specific facts the operator has shared with you, an explicit memory_lookup catches what auto-retrieval missed.\n\n" +
      "Pattern: (a) reflect on what the operator asked, (b) extract 2-4 noun phrases as search terms, (c) call memory_lookup, (d) ONLY THEN form your response. If memory_lookup returns nothing useful, you may say 'I don't have that in memory'. If it returns something, integrate it.\n\n" +
      "Don't apologize for searching. Don't announce 'let me check' — just search silently and respond with what you found.",
  }),
  // Phase 100-fu (2026-04-28) — long-output-to-file directive.
  //
  // Real production failure 2026-04-28: an Opus deep-dive subagent generated
  // a multi-thousand-character analysis, posted only the first 2000 chars
  // to the Discord thread (silent truncation), then claimed the full
  // analysis was "saved to clients/.../tax-return-analysis.md" — the file
  // didn't exist (hallucinated save). The parent agent's auto-relay built
  // its main-channel summary on the truncated content, and the operator
  // had no way to recover the full analysis.
  //
  // Fix forces a "save first, summarize+link in Discord" pattern so long
  // outputs become durable artifacts the operator can open, while Discord
  // posts stay under the 2000-char cap with deterministic content.
  //
  // Pinned by static-grep:
  //   - "Discord messages are hard-capped" (this directive)
  //   - "SAVE the full content first" (step 1)
  //   - "VERIFY the save by Reading the file back" (step 2)
  //   - "POST to Discord" (step 3)
  //   - "NEVER paste >2000 chars into a Discord post" (step 4)
  "long-output-to-file": Object.freeze({
    enabled: true,
    text:
      "Discord messages are hard-capped at 2000 characters. When your reply will exceed ~1500 characters (rough estimate: 250 words, or ~5 short paragraphs of analysis), DO NOT just post the long text and hope it fits. Instead:\n\n" +
      "1. SAVE the full content first to a file in your workspace. Use a descriptive path like `<your-workspace>/output/<task-slug>-<YYYY-MM-DD>.md` (e.g., `output/pon-tax-return-analysis-2026-04-28.md`). Use the Write tool.\n\n" +
      "2. VERIFY the save by Reading the file back immediately. If the read fails or returns empty, the save failed — surface the error, do not claim success.\n\n" +
      "3. POST to Discord (thread or channel) a 1000-1500 character SUMMARY + the absolute file path. Format:\n" +
      "   ```\n" +
      "   <2-4 sentence summary of the headline finding>\n" +
      "   \n" +
      "   <3-7 bullet points of key data>\n" +
      "   \n" +
      "   Full analysis: /absolute/path/to/file.md\n" +
      "   ```\n\n" +
      "4. NEVER paste >2000 chars into a Discord post. Discord silently truncates at 2000 and the parent agent's relay sees only the truncated content. Files are durable; Discord posts are ephemeral and bounded.\n\n" +
      "Exceptions: short replies (under 1500 chars) post directly. Code blocks, tables, lengthy quotes — file. Conversational replies — direct.",
  }),
  // Phase 100-fu (2026-04-28) — verify-file-writes directive.
  //
  // Companion to long-output-to-file. The same 2026-04-28 incident showed
  // an agent claiming a save that never happened — a hallucinated file
  // path with no recoverable artifact. Force a Read-after-Write verify
  // pattern so 'I saved X' is always backed by proof.
  //
  // Pinned by static-grep:
  //   - "verify it by reading" (this directive)
  //   - "hallucinated saves" (failure-mode anchor)
  "verify-file-writes": Object.freeze({
    enabled: true,
    text:
      "Whenever you claim to save, write, or update a file, you MUST immediately verify it by reading the file back. Never report 'saved' or 'written' without proof.\n\n" +
      "Pattern:\n" +
      "1. Call Write (or Edit) with the content\n" +
      "2. Immediately call Read on the same path\n" +
      "3. If Read returns the expected content → safely report success with the absolute path\n" +
      "4. If Read fails (file not found, empty, mismatch) → DO NOT report success. Retry the save once. If still failing, surface the failure explicitly: 'I attempted to save to X but verification failed: <error>. The content is below — please save it manually.' Then paste the content (truncated to fit Discord if needed).\n\n" +
      "Failure mode this prevents: hallucinated saves where the agent says 'analysis saved to /path/file.md' but the file doesn't exist, leaving the operator with no recoverable artifact.",
  }),
  // Phase 100-fu (2026-04-26) — operator-surfaced anti-pattern: agents
  // hitting a tool-surface gap (read-only DB, no write tool, missing MCP)
  // would simply say "I can't do that" and stop, leaving the operator to
  // figure out the alternative path. Force the agent to enumerate concrete
  // alternatives FIRST — a different tool, a generated payload the operator
  // can run, a workaround — and only THEN ask which path the operator wants.
  // Pinned by static-grep: "constraint" + "alternatives" + "Never just 'I can't'".
  "propose-alternatives": Object.freeze({
    enabled: true,
    text:
      "When a tool you have access to is insufficient for the user's request (e.g., you have read-only DB access but they need a write, or you have a search tool but the data is in a different system), DO NOT simply state 'I can't do that'. Instead:\n\n" +
      "1. State the constraint specifically (\"the finmentum-db MCP is SELECT-only, so I can't INSERT directly\").\n" +
      "2. Propose 1-2 concrete alternatives, in order of effort:\n" +
      "   - Use a different tool that CAN do it (e.g., Playwright to fill an admin form, operator-runnable shell command, send_to_agent to delegate to an agent that has write access)\n" +
      "   - Generate the SQL/payload + ask the operator to run it themselves (\"here's the INSERT statement — paste this into your DB client\")\n" +
      "   - Suggest a workaround (e.g., \"I can update the cache file directly — does that meet your need?\")\n" +
      "3. Only AFTER offering alternatives, ask the operator which path they want.\n\n" +
      "Pattern: constraint → alternatives → ask. Never just 'I can't'.",
  }),
  // Phase 999.1 (2026-04-29) — freshness directive.
  //
  // Operator-observed pain (2026-04-29 session): agents emit
  // 2025-anchored answers when asked about live prices, current laws,
  // recent filings — silently anchor on training-cutoff knowledge
  // instead of running web_search. Search MCP is already auto-injected
  // fleet-wide; this directive is the prompt-side push to use it.
  //
  // Pinned by static-grep:
  //   - "Do not anchor on training-cutoff knowledge" (D-FR-04 verbatim)
  //   - "run `date` via Bash" (D-FR-02 verbatim)
  "freshness": Object.freeze({
    enabled: true,
    text:
      "When researching live prices, equity quotes, current tax rules, regulations, laws, financial filings, current events, recent news, or anything dated within ~6 months of today, run `web_search` BEFORE answering. Do not anchor on training-cutoff knowledge.\n\n" +
      "If you need today's date, run `date` via Bash — don't guess from your training cutoff.",
  }),
  // Phase 999.1 (2026-04-29) — derivative-work directive.
  //
  // Operator-observed pain (2026-04-29 session): a delegated subagent
  // refused to generate a parameterized PDF template, citing the
  // global CLAUDE.md "don't add features beyond what's requested"
  // rule. That rule applies to scope creep on the operator's request,
  // not to fulfilling delegated work product. Per D-DR-01/D-DR-04 the
  // directive fires fleet-wide (not subagent-only) — simpler shape,
  // ~80 token cost is acceptable.
  //
  // Pinned by static-grep:
  //   - "are all in-scope work product" (D-DR-03 verbatim)
  "derivative-work": Object.freeze({
    enabled: true,
    text:
      "When you've been delegated a task by another agent OR by the operator, creating new files, deriving parameterized templates from examples, generating code, and producing artifacts are all in-scope work product. The `don't add features beyond what's requested` guideline applies to scope creep on the user's request, not to fulfilling the delegated task itself.",
  }),
  // Phase 999.1 (2026-04-29) — trusted-operator directive.
  //
  // Operator-observed pain (2026-04-29 session): agents repeatedly
  // preface responses with "this is not malware" / "this is for
  // legitimate purposes" / "this is authorized work" disclaimers,
  // over-applying Claude Code's platform-level "authorized security
  // testing" prompt. Counter-instruct that this is a trusted operator
  // environment. Note: the directive scopes the override to PHRASING
  // patterns only — existing safety rails (security.md no-hardcoded-
  // secrets, validate-inputs, parameterized-queries) remain.
  //
  // Pinned by static-grep:
  //   - "Skip all CYA language" (D-TR-03 verbatim)
  "trusted-operator": Object.freeze({
    enabled: true,
    text:
      "This workspace is a single trusted operator's environment. The operator owns this code, has full authorization, and knows the context. Do not prefix responses with disclaimers like \"this is not malware\" / \"this is for legitimate purposes\" / \"this is authorized work\" / \"in a real engagement\". Skip all CYA language. Just answer the question or do the task.",
  }),
  // Phase 999.1 (2026-04-29) — discord-format directive.
  //
  // Companion to (does NOT replace) `wrapMarkdownTablesInCodeFence`
  // in src/discord/markdown-table-wrap.ts — that function stays as
  // the structural safety net for cases where tabular IS the right
  // format. This directive nudges agents toward bullets / definition-
  // style prose for 1-3 fields per item where a markdown table won't
  // render cleanly in Discord. Marks the deferred no-tables directive
  // referenced in markdown-table-wrap.ts:11-14 comments as landed.
  //
  // Pinned by static-grep:
  //   - "prefer bullets, numbered lists, or definition-style prose" (D-TB-03 verbatim)
  "discord-format": Object.freeze({
    enabled: true,
    text:
      "Discord doesn't render markdown tables natively. Pipes show as literal characters and columns don't align. When presenting structured data, prefer bullets, numbered lists, or definition-style prose. Use markdown tables only when the data is genuinely tabular and dense (e.g., 4+ columns × 4+ rows of comparable values); the webhook-wrap fence renders those as monospace code blocks as a safety net. For 1-3 fields per item, bullets are clearer.",
  }),
  // Phase 999.22 (2026-05-01) — mutate-verify directive.
  //
  // Operator-observed pain (2026-05-01 outage): Admin Clawdy posted
  // "Set. `threads.maxThreadSessions: 10` is live in `clawcode.yaml`
  // under `defaults` — takes effect on next daemon reload."
  // Investigation: yaml mtime was 2026-04-30 23:21:22 (~7h before
  // the chat); the value `10` was already there from a prior session.
  // The agent did NOT perform the write in the current turn but
  // framed the desired state as a just-completed action. The
  // operator believed the agent and triggered a daemon reload,
  // causing the outage.
  //
  // Companion to `verify-file-writes` (Phase 100-fu) — that directive
  // covers Write/Edit verification specifically; this one generalizes
  // to ANY in-turn mutation (file edit, config write, sudo, systemctl,
  // IPC mutation, MCP state-changing tool) AND bans passive-success
  // framing ("Set." / "Done." / "Live." / "Saved." / "Updated.")
  // when no mutation actually happened in the current turn.
  //
  // Pinned by static-grep:
  //   - "Quote the post-mutation evidence" (canonical phrase verbatim)
  "mutate-verify": Object.freeze({
    enabled: true,
    text:
      "After any mutation in the current turn (Edit/Write to files, config writes, sudo or shell commands that change system state, systemctl actions, IPC mutations, MCP tools that change state on the other side), you MUST read the resulting state back and Quote the post-mutation evidence inline BEFORE claiming the mutation is done. Format: \"After <action> on <target>, I <read-back action>; the resulting <field/line/state> is `<paste verbatim>`.\" Not just \"Done.\"\n\n" +
      "Do not say \"Set.\", \"Done.\", \"Live.\", \"Saved.\", or \"Updated.\" when you didn't actually perform the write in the current turn — even if the desired state is already present from a prior session. Passive-success framing implies you just did it; if you didn't, the operator may take a downstream action (reload, deploy, retry) that breaks production. Instead say \"<state> is already present (<source>: mtime=<ts>, value=`<paste>`)\" or \"I have not changed <target> in this turn.\"\n\n" +
      "If verification fails OR cannot be performed (read tool unavailable, target inaccessible, mutation went through a layer you can't observe), report failure or uncertainty — never success. Better: \"I attempted <action> on <target> but cannot verify the result (<reason>); please confirm before relying on this.\"",
  }),
});

/**
 * Phase 96 D-09 — 11th additive-optional schema application.
 *
 * Fleet-wide default outputDir template. Tokens ({date}/{agent}/
 * {channel_name}/{client_slug}) are preserved verbatim in the schema; the
 * runtime resolveOutputDir helper (src/manager/resolve-output-dir.ts) expands
 * them at call time with fresh ctx (per-call clock, per-call clientSlug).
 *
 * Pinned by static-grep regression: `grep -q "DEFAULT_OUTPUT_DIR"
 * src/config/schema.ts`. Frozen for immutability — exported so loader can
 * reference the literal default without re-stating the string.
 */
export const DEFAULT_OUTPUT_DIR: string = "outputs/{date}/";

/**
 * Phase 94 D-10 — per-agent override shape.
 *
 * Both fields optional so an operator can flip just `enabled` on a
 * default directive without re-stating its `text`. The resolver
 * (`resolveSystemPromptDirectives` in loader.ts) merges per-key:
 * fields not specified in the override fall back to the matching
 * default directive's value.
 */
export const systemPromptDirectiveOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  text: z.string().optional(),
});

/**
 * Phase 96 D-05 — 10th additive-optional schema application — fleet-wide
 * default fileAccess paths.
 *
 * The literal `{agent}` token is preserved verbatim in the schema; the
 * loader's `resolveFileAccess(agentName, ...)` helper substitutes the
 * actual agent name at call time. This indirection lets defaults be
 * defined once for the whole fleet while still resolving to per-agent
 * canonical paths at runtime.
 *
 * Pinned by static-grep regression: `grep -q "DEFAULT_FILE_ACCESS"
 * src/config/schema.ts`. Frozen so downstream code cannot mutate the
 * global default array.
 */
export const DEFAULT_FILE_ACCESS: readonly string[] = Object.freeze([
  "/home/clawcode/.clawcode/agents/{agent}/",
]);

/**
 * Phase 95 DREAM-01..03 — Memory dreaming (autonomous reflection) config.
 *
 * 9th application of the Phase 83/86/89/90/94 additive-optional schema
 * blueprint. v2.5/v2.6 migrated configs (no `dream:` block) parse unchanged
 * because:
 *   - `agents.*.dream` is fully optional (`agentSchema.dream.optional()`)
 *   - `defaults.dream` is default-bearing (resolver fills enabled=false /
 *     idleMinutes=30 / model=haiku when omitted)
 *
 * Bounds:
 *   - `idleMinutes` floor 5 = D-01 hard floor (don't dream more often than
 *     5 minutes — burns tokens). Ceiling 360 = D-01 6-hour hard ceiling
 *     bound (the cron-schedule layer respects the same window in 95-02).
 *   - `model` locked to the modelSchema enum (haiku|sonnet|opus). Default
 *     `haiku` per D-03 (cheap; dream passes are frequent + low-stakes).
 *   - `retentionDays` 1..365 — D-05 dream-log archival cadence; default
 *     applied at the consumer (95-02 dream-log writer), NOT here, to keep
 *     this schema shape minimal and the resolver responsibilities clean.
 *
 * Default `enabled: false` is OPT-IN fleet-wide per D-01 — operators flip
 * `agents.<name>.dream.enabled: true` (or `defaults.dream.enabled: true`)
 * to roll the cycle out gradually.
 */
export const dreamConfigSchema = z.object({
  enabled: z.boolean().default(false),
  idleMinutes: z.number().int().min(5).max(360).default(30),
  model: z.enum(["haiku", "sonnet", "opus"]).default("haiku"),
  retentionDays: z.number().int().min(1).max(365).optional(),
});

/** Inferred Phase 95 dream config type. */
export type DreamConfig = z.infer<typeof dreamConfigSchema>;

/**
 * Heartbeat monitoring configuration schema.
 * Controls the periodic health check system for agents.
 */
export const heartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().min(10).default(60),
  checkTimeoutSeconds: z.number().int().min(1).default(10),
  contextFill: z.object({
    warningThreshold: z.number().min(0).max(1).default(0.6),
    criticalThreshold: z.number().min(0).max(1).default(0.75),
    zoneThresholds: z.object({
      yellow: z.number().min(0).max(1).default(0.50),
      orange: z.number().min(0).max(1).default(0.70),
      red: z.number().min(0).max(1).default(0.85),
    }).default(() => ({ yellow: 0.50, orange: 0.70, red: 0.85 })),
  }).default(() => ({ warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } })),
});

/** Inferred heartbeat config type. */
export type HeartbeatConfig = z.infer<typeof heartbeatConfigSchema>;

/**
 * Schema for a single scheduled task entry.
 * Cron field accepts standard cron expressions or croner's extended format.
 * Validation of the cron expression itself happens at scheduler startup.
 */
export const scheduleEntrySchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(1),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
});

/** Inferred schedule entry config type. */
export type ScheduleEntryConfig = z.infer<typeof scheduleEntrySchema>;

/**
 * Schema for a single slash command option.
 * Type field uses Discord's ApplicationCommandOptionType (1-11).
 */
export const slashCommandOptionSchema = z.object({
  name: z.string().min(1),
  type: z.number().int().min(1).max(11),
  description: z.string().min(1),
  required: z.boolean().default(false),
  // Phase 83 UI-01 — optional structured choices for STRING options (type 3).
  // When present, Discord renders a dropdown instead of a free-text input.
  // Capped at 25 entries per Discord API; each name/value must be 1..100 chars.
  // Optional + backward-compatible: pre-existing YAML configs parse unchanged.
  choices: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        value: z.string().min(1).max(100),
      }),
    )
    .max(25)
    .optional(),
});

/**
 * Schema for a single slash command entry.
 * Name must be lowercase alphanumeric with hyphens (Discord requirement).
 */
export const slashCommandEntrySchema = z.object({
  name: z.string().min(1).max(32).regex(/^[\w-]+$/),
  description: z.string().min(1).max(100),
  claudeCommand: z.string().min(1),
  options: z.array(slashCommandOptionSchema).default([]),
});

/** Inferred slash command option type. */
export type SlashCommandOptionConfig = z.infer<typeof slashCommandOptionSchema>;

/** Inferred slash command entry type. */
export type SlashCommandEntryConfig = z.infer<typeof slashCommandEntrySchema>;

/**
 * Webhook identity configuration schema.
 * Allows agents to post to Discord with custom display name and avatar.
 */
export const webhookConfigSchema = z.object({
  displayName: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  webhookUrl: z.string().url().optional(),
});

/** Inferred webhook config type. */
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

/**
 * Thread management configuration schema.
 * Controls idle timeout and max concurrent thread sessions per agent.
 */
export const threadsConfigSchema = z.object({
  idleTimeoutMinutes: z.number().int().min(1).default(1440),
  // Phase 99 sub-scope N (2026-04-26) — lowered from 10 to 3 to cap
  // blast-radius if Layer 1 disallowedTools is somehow bypassed. Operator
  // can override per-agent in clawcode.yaml threads.maxThreadSessions.
  maxThreadSessions: z.number().int().min(1).default(3),
});

/** Inferred threads config type. */
export type ThreadsConfig = z.infer<typeof threadsConfigSchema>;

/**
 * Schema for a single allowlist entry (glob pattern for command matching).
 */
export const allowlistEntrySchema = z.object({
  pattern: z.string().min(1),
});

/**
 * Security configuration schema for per-agent execution approval.
 *
 * Phase 74 Plan 02 — `denyScopeAll` gates access to this agent from
 * scope='all' (multi-agent) bearer keys. Default `false` preserves
 * back-compat (any scope='all' key can target any configured agent).
 * Set `true` on admin-grade agents (e.g. admin-clawdy) so a compromised
 * OpenClaw-side scope='all' key cannot impersonate them via body.model.
 * The `openclaw:<slug>` template path is ALWAYS exempt from this flag —
 * that branch is a different code path entirely (no admin surface).
 */
export const securityConfigSchema = z.object({
  allowlist: z.array(allowlistEntrySchema).default([]),
  denyScopeAll: z.boolean().default(false),
});

/** Inferred security config type. */
export type SecurityConfig = z.infer<typeof securityConfigSchema>;

/**
 * Schema for an MCP server configuration entry.
 * Defines a server that Claude Code will connect to as an MCP client.
 */
export const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  // Phase 85 TOOL-01 — when true, this server's readiness handshake
  // failure does NOT block the warm-path gate (agent still transitions
  // to `status: running`). Default false = mandatory (existing behavior
  // for every currently-configured MCP server; v2.1 migrated configs
  // parse unchanged). See src/mcp/readiness.ts.
  optional: z.boolean().default(false),
  // Phase 100 follow-up — operator-curated annotations surfaced in the
  // capability manifest. Helps the agent describe its tool surface
  // accurately ("the finmentum-db tool is read-only — I can SELECT
  // but not INSERT/UPDATE/DELETE"). Both fields optional so existing
  // YAML configs without these annotations parse unchanged.
  description: z.string().optional(),
  accessPattern: z.enum(["read-only", "read-write", "write-only"]).optional(),
});

/** Inferred MCP server config type from schema. */
export type McpServerSchemaConfig = z.infer<typeof mcpServerSchema>;

/**
 * Context budget configuration schema.
 * Controls per-source token budgets for the context assembly pipeline.
 * Values represent estimated token counts (chars/4 heuristic).
 */
export const contextBudgetsSchema = z.object({
  identity: z.number().int().positive().default(1000),
  hotMemories: z.number().int().positive().default(3000),
  toolDefinitions: z.number().int().positive().default(2000),
  graphContext: z.number().int().positive().default(2000),
});

/** Inferred context budgets type. */
export type ContextBudgetsConfig = z.infer<typeof contextBudgetsSchema>;

/**
 * Phase 53 — per-section assembly budgets in tokens.
 *
 * Section names are canonical (D-01 from 53-CONTEXT.md) and map 1:1 to
 * the assembler blocks that Wave 2 will emit token counts for. Budgets
 * are optional — unset means "use default" at the consumer. Positive
 * integers only; negative or zero values are rejected.
 */
export const memoryAssemblyBudgetsSchema = z.object({
  identity: z.number().int().positive().optional(),
  soul: z.number().int().positive().optional(),
  skills_header: z.number().int().positive().optional(),
  hot_tier: z.number().int().positive().optional(),
  recent_history: z.number().int().positive().optional(),
  per_turn_summary: z.number().int().positive().optional(),
  resume_summary: z.number().int().positive().optional(),
});

/** Inferred Phase 53 memory-assembly budgets type. */
export type MemoryAssemblyBudgetsConfig = z.infer<
  typeof memoryAssemblyBudgetsSchema
>;

/**
 * Phase 53 — lazy-skill compression configuration.
 *
 * `usageThresholdTurns` has a hard floor of 5 (D-03 from 53-CONTEXT.md) —
 * anything smaller compresses skills too aggressively and defeats the
 * re-inflate cache-warming strategy.
 */
export const lazySkillsSchema = z.object({
  enabled: z.boolean().default(true),
  usageThresholdTurns: z.number().int().min(5).default(20),
  reinflateOnMention: z.boolean().default(true),
});

/** Inferred Phase 53 lazy-skills config type. */
export type LazySkillsConfig = z.infer<typeof lazySkillsSchema>;

/**
 * Phase 53 — session-resume summary hard token budget.
 *
 * Floor of 500 (D-04 from 53-CONTEXT.md) — below that the summary cannot
 * capture enough continuity for a useful session resume. Default 1500
 * applied at the consumer (src/memory/context-summary.ts in Wave 3),
 * NOT in the schema — keeps the Zod parse shape minimal.
 */
export const resumeSummaryBudgetSchema = z.number().int().min(500);

/**
 * Phase 54 — per-agent Discord streaming cadence.
 *
 * `editIntervalMs` has a HARD FLOOR of 300 ms (CONTEXT D-02 — absolute
 * Discord rate-limit safety net below which the 5-edits-per-5-seconds
 * bucket drains faster than it refills). Default 750 ms is applied at
 * the consumer (src/discord/streaming.ts ProgressiveMessageEditor in
 * Plan 54-03), NOT at the Zod layer — keeps the schema shape minimal.
 *
 * `maxLength` floors at 1 and ceilings at 2000 (Discord message
 * character limit). Default 2000 applied at consumer.
 */
export const streamingConfigSchema = z.object({
  editIntervalMs: z.number().int().min(300).optional(),
  maxLength: z.number().int().min(1).max(2000).optional(),
});

/** Inferred Phase 54 streaming config type. */
export type StreamingConfig = z.infer<typeof streamingConfigSchema>;

/**
 * Phase 55 — default whitelist of idempotent ClawCode tools safe for
 * intra-turn caching. LOCKED verbatim per 55-CONTEXT D-02.
 *
 * These four tools are read-only from the agent's perspective: `memory_lookup`,
 * `search_documents`, `memory_list`, `memory_graph`. Repeated calls with
 * identical args within a single turn return identical results, so the intra-
 * turn cache can return the first result safely.
 *
 * Non-idempotent tools (memory_save, spawn_subagent_thread, ingest_document,
 * delete_document, send_message, send_to_agent, send_attachment, ask_advisor)
 * MUST NOT appear here — caching them is a correctness bug. Adding a tool to
 * this list requires a 55-CONTEXT amendment + explicit review.
 */
export const IDEMPOTENT_TOOL_DEFAULTS: readonly string[] = Object.freeze([
  "memory_lookup",
  "search_documents",
  "memory_list",
  "memory_graph",
  // Phase 71 (SEARCH-03) — web search MCP tools. Both are read-only from the
  // agent's perspective: `web_search` issues a GET to Brave/Exa and returns
  // a ranked list, `web_fetch_url` issues a GET for a URL and returns
  // extracted article text. Duplicate calls with identical args within a
  // single Turn are safe to serve from the intra-turn cache (no side
  // effects, deterministic response within the ~second-scale Turn window).
  "web_search",
  "web_fetch_url",
]);

/**
 * Phase 55 — per-tool SLO override for `perf.tools.slos.<tool_name>`.
 *
 * `thresholdMs` is required and must be a positive integer.
 * `metric` is optional — the consumer (`getPerToolSlo` in
 * src/performance/slos.ts) defaults it to `"p95"` when omitted so the common
 * case stays concise in clawcode.yaml.
 */
export const toolSloOverrideSchema = z.object({
  thresholdMs: z.number().int().positive(),
  metric: z.enum(["p50", "p95", "p99"]).optional(),
});

/** Inferred per-tool SLO override type. */
export type ToolSloOverride = z.infer<typeof toolSloOverrideSchema>;

/**
 * Phase 55 — `perf.tools` config. Three surfaces:
 *
 *   1. `maxConcurrent` — soft cap on concurrent tool-dispatch within a single
 *      turn. Default 10 per 55-CONTEXT D-01. Hard floor of 1 (a value of 0
 *      would deadlock the dispatcher).
 *
 *   2. `idempotent` — string[] whitelist of tools safe for intra-turn caching.
 *      Defaults to `IDEMPOTENT_TOOL_DEFAULTS`. Consumers get the full default
 *      whitelist automatically if they omit this field.
 *
 *   3. `slos` — optional `Record<tool_name, { thresholdMs, metric? }>` for
 *      per-tool SLO overrides. Consumed by `getPerToolSlo` which falls back to
 *      the global `tool_call` SLO (1500ms p95 — from DEFAULT_SLOS) when no
 *      override is set for a given tool.
 *
 * Parse output shape:
 *   { maxConcurrent: number; idempotent: string[]; slos?: Record<string, ToolSloOverride> }
 */
export const toolsConfigSchema = z.object({
  maxConcurrent: z.number().int().min(1).default(10),
  idempotent: z
    .array(z.string().min(1))
    .default([...IDEMPOTENT_TOOL_DEFAULTS]),
  slos: z.record(z.string().min(1), toolSloOverrideSchema).optional(),
});

/** Inferred Phase 55 perf.tools config type. */
export type ToolsConfig = z.infer<typeof toolsConfigSchema>;

/**
 * Phase 69 — OpenAI-compatible endpoint config (OPENAI-01..07).
 *
 * Lives under `defaults.openai` in clawcode.yaml. Controls the HTTP listener
 * that exposes `/v1/chat/completions` + `/v1/models` on the daemon process.
 *
 * DO NOT confuse with `mcpServers.openai` (unrelated MCP server entry). The
 * two keys live at different nesting levels and have no interaction.
 *
 * Every field has a default so omitting the entire block still yields a
 * fully-populated runtime config (enabled listener on 0.0.0.0:3101).
 *
 * Bounds rationale:
 *  - `port` 1..65535 — full TCP range; 0 forbidden to avoid OS-picked port.
 *  - `host` non-empty string; default `0.0.0.0` mirrors the dashboard.
 *  - `maxRequestBodyBytes` 1 KiB..100 MiB — sensible OpenAI message sizing.
 *  - `streamKeepaliveMs` 1s..2min — SSE keepalive comment cadence window.
 */
export const openaiEndpointSchema = z
  .object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1).max(65535).default(3101),
    host: z.string().min(1).default("0.0.0.0"),
    maxRequestBodyBytes: z
      .number()
      .int()
      .min(1024)
      .max(104857600)
      .default(1048576),
    streamKeepaliveMs: z
      .number()
      .int()
      .min(1000)
      .max(120000)
      .default(15000),
  })
  // IMPORTANT: Must use factory-form default returning a fully-populated
  // literal (matching browserConfigSchema / searchConfigSchema / imageConfigSchema
  // pattern). A bare `.default({})` is a TRAP in Zod — when this schema appears
  // as a field in a parent z.object and the parent input omits the field, Zod
  // injects the literal default VALUE without re-running inner `.default()`
  // validators. Result: `{}` with no `enabled` key → `!config.enabled` trips
  // the disabled branch and the endpoint never binds. See
  // .planning/debug/resolved/clawdy-v2-stability.md (2026-04-19) for the full
  // forensic trail and the empirical reproduction.
  .default(() => ({
    enabled: true,
    port: 3101,
    host: "0.0.0.0",
    maxRequestBodyBytes: 1048576,
    streamKeepaliveMs: 15000,
  }));

/** Inferred Phase 69 OpenAI-endpoint config type. */
export type OpenAiEndpointConfig = z.infer<typeof openaiEndpointSchema>;

/**
 * Phase 70 — browser automation config (BROWSER-01..06).
 *
 * Governs the resident Chromium singleton warmed at daemon boot and the
 * per-agent BrowserContext persistence behavior. The auto-injected browser
 * MCP subprocess (clawcode browser-mcp — wired in Plan 02) delegates to the
 * daemon's BrowserManager; this schema shapes the manager's behavior, not
 * the subprocess transport.
 *
 * Architecture: `chromium.launch()` + per-agent
 * `browser.newContext({ storageState })` (70-RESEARCH.md Option 2 — Pitfall 1
 * forbids `launchPersistentContext` because it cannot share a Browser).
 *
 * DO NOT change `headless` to a string — Playwright 1.59 accepts the boolean
 * form and maps `true` to the new-headless mode. The `"new"` string the
 * CONTEXT.md draft mentioned is NOT a valid Playwright 1.59 launch option.
 *
 * Bounds rationale:
 *  - `navigationTimeoutMs` 1s..10min — 10 min hard ceiling prevents runaway
 *    agent behavior pinning a navigation forever.
 *  - `actionTimeoutMs` 100ms..5min — same ceiling philosophy at the
 *    action granularity (click/fill/wait_for).
 *  - `viewport` 320x240..7680x4320 — floor covers low-end phone emulation,
 *    ceiling matches 8K rendering (well above any realistic agent need).
 *  - `maxScreenshotInlineBytes` 0..5 MiB — 0 means "never inline" (always
 *    return path only); 5 MiB is Claude's per-image vision cap
 *    (70-RESEARCH.md Pitfall 7).
 */
export const browserConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    headless: z.boolean().default(true),
    warmOnBoot: z.boolean().default(true),
    navigationTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(600000)
      .default(30000),
    actionTimeoutMs: z
      .number()
      .int()
      .min(100)
      .max(300000)
      .default(10000),
    viewport: z
      .object({
        width: z.number().int().min(320).max(7680).default(1280),
        height: z.number().int().min(240).max(4320).default(720),
      })
      .default(() => ({ width: 1280, height: 720 })),
    userAgent: z.string().nullable().default(null),
    maxScreenshotInlineBytes: z
      .number()
      .int()
      .min(0)
      .max(5242880)
      .default(524288),
  })
  .default(() => ({
    enabled: true,
    headless: true,
    warmOnBoot: true,
    navigationTimeoutMs: 30000,
    actionTimeoutMs: 10000,
    viewport: { width: 1280, height: 720 },
    userAgent: null,
    maxScreenshotInlineBytes: 524288,
  }));

/** Inferred Phase 70 browser config type. */
export type BrowserConfig = z.infer<typeof browserConfigSchema>;

/**
 * Phase 71 — web search MCP config (SEARCH-01..03).
 *
 * Lives under `defaults.search` in clawcode.yaml. Governs the auto-injected
 * web-search MCP subprocess (Plan 02 wires the subprocess + CLI + daemon
 * auto-inject); this schema shapes the two pure tool handlers (`web_search`,
 * `web_fetch_url`) built in Plan 01.
 *
 * Architecture: backend union locked at `["brave", "exa"]` per 71-CONTEXT
 * D-01 (no Google CSE / DuckDuckGo / SerpAPI stubs). Provider API keys are
 * read LAZILY at client `search()` call time — missing keys at daemon boot
 * do NOT crash, they surface as structured `invalid_argument` errors on the
 * first call instead.
 *
 * Zero new npm deps: providers use native `fetch`, Readability extraction
 * reuses Phase 70's `@mozilla/readability` + `jsdom` import via
 * `src/search/readability.ts` (thin wrapper — no hoist).
 *
 * Bounds rationale:
 *  - `maxResults` 1..20 — hard cap 20 matches CONTEXT "maxResults: 20"
 *    (agents don't need more; providers charge per result).
 *  - `timeoutMs` 1s..60s — provider request budget; <1s is unreliable,
 *    >60s defeats intra-turn latency budgets.
 *  - `fetch.timeoutMs` 1s..2min — URL fetch has more variance than search
 *    (slow/redirecting sites); 2 min ceiling prevents runaway fetches.
 *  - `fetch.maxBytes` 1..10 MiB — 1 MiB default per CONTEXT, 10 MiB hard
 *    ceiling to keep agents from fetching absurd resource bundles.
 *  - `country` exactly 2 chars — ISO 3166 alpha-2 code validation.
 */
export const searchConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    backend: z.enum(["brave", "exa"]).default("brave"),
    brave: z
      .object({
        apiKeyEnv: z.string().min(1).default("BRAVE_API_KEY"),
        // Phase 110 follow-up — explicit op:// (or literal) override that
        // takes precedence over apiKeyEnv lookup. Lets operators store the
        // Brave key in 1Password instead of /etc/clawcode/env so Brave
        // joins the same secrets-resolver path used by FINNHUB / FAL /
        // STRAVA / etc. (clawcode.yaml zone 2). Resolved at daemon boot
        // via collectAllOpRefs → SecretsResolver.preResolveAll. If the
        // resolved value is non-empty it overrides whatever (if anything)
        // is in process.env[apiKeyEnv].
        apiKey: z.string().optional(),
        safeSearch: z.enum(["off", "moderate", "strict"]).default("moderate"),
        country: z.string().length(2).default("us"),
      })
      .default(() => ({
        apiKeyEnv: "BRAVE_API_KEY",
        safeSearch: "moderate" as const,
        country: "us",
      })),
    exa: z
      .object({
        apiKeyEnv: z.string().min(1).default("EXA_API_KEY"),
        // Same op:// passthrough as brave.apiKey above — keeps the two
        // backends symmetric for the same reason.
        apiKey: z.string().optional(),
        useAutoprompt: z.boolean().default(false),
      })
      .default(() => ({
        apiKeyEnv: "EXA_API_KEY",
        useAutoprompt: false,
      })),
    maxResults: z.number().int().min(1).max(20).default(20),
    timeoutMs: z.number().int().min(1000).max(60000).default(10000),
    fetch: z
      .object({
        timeoutMs: z.number().int().min(1000).max(120000).default(30000),
        maxBytes: z.number().int().min(1).max(10485760).default(1048576),
        userAgentSuffix: z.string().nullable().default(null),
      })
      .default(() => ({
        timeoutMs: 30000,
        maxBytes: 1048576,
        userAgentSuffix: null,
      })),
  })
  .default(() => ({
    enabled: true,
    backend: "brave" as const,
    brave: {
      apiKeyEnv: "BRAVE_API_KEY",
      safeSearch: "moderate" as const,
      country: "us",
    },
    exa: {
      apiKeyEnv: "EXA_API_KEY",
      useAutoprompt: false,
    },
    maxResults: 20,
    timeoutMs: 10000,
    fetch: {
      timeoutMs: 30000,
      maxBytes: 1048576,
      userAgentSuffix: null,
    },
  }));

/** Inferred Phase 71 search config type. */
export type SearchConfig = z.infer<typeof searchConfigSchema>;

/**
 * Phase 72 — image generation MCP config (IMAGE-01..04).
 *
 * Lives under `defaults.image` in clawcode.yaml. Governs the auto-injected
 * image-generation MCP subprocess (Plan 02 wires the subprocess + CLI +
 * daemon auto-inject); this schema shapes the three pure tool handlers
 * (`image_generate`, `image_edit`, `image_variations`) built in Plan 01.
 *
 * Architecture: backend union locked at `["openai", "minimax", "fal"]`
 * per 72-CONTEXT D-01 (no Stable Diffusion / Midjourney / video stubs).
 * Provider API keys are read LAZILY at client call time — missing keys at
 * daemon boot do NOT crash, they surface as structured `invalid_input`
 * errors on the first call instead.
 *
 * Zero new npm deps: providers use native `fetch` + native `FormData`
 * (Node 22 has both built-in).
 *
 * Bounds rationale:
 *  - `maxImageBytes` 1..10 MiB — 10 MiB ceiling matches the Discord
 *    attachment limit (Nitro-free guilds get 10 MiB) so generated
 *    artifacts can always be delivered via send_attachment.
 *  - `timeoutMs` 1s..5min — image generation has more variance than text
 *    (DALL-E HD can take 30-60s; flux-pro 10-20s); 5 min ceiling is the
 *    backend's own published max-runtime budget.
 *  - `workspaceSubdir` non-empty — defaults to `"generated-images"`;
 *    written to `<agent-workspace>/<workspaceSubdir>/<timestamp>-<id>.png`.
 */
export const imageConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    backend: z.enum(["openai", "minimax", "fal"]).default("openai"),
    openai: z
      .object({
        apiKeyEnv: z.string().min(1).default("OPENAI_API_KEY"),
        model: z.string().min(1).default("gpt-image-1"),
      })
      .default(() => ({
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-image-1",
      })),
    minimax: z
      .object({
        apiKeyEnv: z.string().min(1).default("MINIMAX_API_KEY"),
        model: z.string().min(1).default("image-01"),
      })
      .default(() => ({
        apiKeyEnv: "MINIMAX_API_KEY",
        model: "image-01",
      })),
    fal: z
      .object({
        apiKeyEnv: z.string().min(1).default("FAL_API_KEY"),
        model: z.string().min(1).default("fal-ai/flux-pro"),
      })
      .default(() => ({
        apiKeyEnv: "FAL_API_KEY",
        model: "fal-ai/flux-pro",
      })),
    maxImageBytes: z.number().int().min(1).max(10485760).default(10485760),
    timeoutMs: z.number().int().min(1000).max(300000).default(60000),
    workspaceSubdir: z.string().min(1).default("generated-images"),
  })
  .default(() => ({
    enabled: true,
    backend: "openai" as const,
    openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
    minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
    fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
    maxImageBytes: 10485760,
    timeoutMs: 60000,
    workspaceSubdir: "generated-images",
  }));

/** Inferred Phase 72 image config type. */
export type ImageConfig = z.infer<typeof imageConfigSchema>;

/**
 * Schema for a single agent entry in the config.
 * Channel IDs are strings to prevent YAML numeric coercion (Pitfall 1).
 */
export const agentSchema = z.object({
  name: z.string().min(1),
  workspace: z.string().optional(),
  // Phase 75 SHARED-01 — per-agent override for the directory that owns
  // this agent's private runtime state (memories.db, traces.db, inbox/,
  // heartbeat.log, context-summary files). When unset, loader.ts falls
  // back to `workspace`. Enables multiple agents (e.g., the finmentum family)
  // to share one basePath while keeping memory/inbox/heartbeat isolated.
  // Raw string — expansion via expandHome() happens in loader.ts (Plan 02).
  memoryPath: z.string().min(1).optional(),
  channels: z.array(z.string()).default([]),
  model: modelSchema.optional(),
  // Phase 86 MODEL-01 — per-agent allowlist for /clawcode-model picker.
  // Additive + optional: v2.1 migrated configs (15 agents) parse
  // unchanged; the loader's resolver fills defaults.allowedModels when
  // this is omitted. Each entry must be a valid modelSchema alias —
  // unknown aliases are rejected at parse time. Max 25 enforced
  // downstream (Discord StringSelectMenuBuilder cap in Plan 03).
  allowedModels: z.array(modelSchema).optional(),
  // Phase 89 GREET-07 — per-agent override for restart-greeting emission.
  // Additive + optional: v2.1 migrated configs parse unchanged when omitted;
  // loader resolver fills from defaults.greetOnRestart. Reloadable.
  greetOnRestart: z.boolean().optional(),
  // Phase 89 GREET-10 — per-agent override for in-memory cool-down window (ms).
  // Additive + optional; resolver falls back to defaults.greetCoolDownMs.
  greetCoolDownMs: z.number().int().positive().optional(),
  // Phase 90 MEM-01 — Auto-load workspace MEMORY.md into the v1.7
  // stable prefix at session boot (AFTER IDENTITY, BEFORE MCP status).
  // Additive + optional: v2.1 migrated configs parse unchanged; loader
  // resolver fills from defaults.memoryAutoLoad when omitted. Reloadable
  // per D-18 — next session boot picks up a YAML edit. 50KB hard cap
  // enforced downstream in session-config.ts (MEMORY_AUTOLOAD_MAX_BYTES).
  memoryAutoLoad: z.boolean().optional(),
  // Phase 90 MEM-01 — Override default MEMORY.md path (absolute or ~/...).
  // When unset, session-config.ts reads `{workspace}/MEMORY.md`. Raw
  // string here; expansion via expandHome() happens in loader.ts.
  memoryAutoLoadPath: z.string().min(1).optional(),
  // Phase 90 MEM-03 — per-agent override for the hybrid-RRF top-K. When
  // omitted, resolver falls back to defaults.memoryRetrievalTopK (5 per
  // D-RETRIEVAL). Reloadable (next turn picks up the new value).
  memoryRetrievalTopK: z.number().int().positive().max(50).optional(),
  // Phase 115 sub-scope 3 — per-agent override for the per-turn
  // <memory-context> token budget. When omitted, resolver falls back to
  // defaults.memoryRetrievalTokenBudget (1500 per Phase 115 D-02). Range
  // 500-8000. Reloadable — next turn picks up the new value via the
  // getMemoryRetrieverForAgent closure re-read.
  memoryRetrievalTokenBudget: z.number().int().min(500).max(8000).optional(),
  // Phase 115 sub-scope 4 — per-agent override for the tag-exclusion list
  // applied at hybrid-RRF retrieval. When omitted, resolver falls back to
  // defaults.memoryRetrievalExcludeTags (locked default ["session-summary",
  // "mid-session", "raw-fallback"] per CONTEXT.md sub-scope 4). Empty array
  // disables filtering entirely; a populated array replaces (does NOT merge
  // with) the defaults. Reloadable.
  memoryRetrievalExcludeTags: z.array(z.string()).optional(),
  // Phase 115 sub-scope 2 — per-agent override for the SDK
  // systemPrompt.excludeDynamicSections flag. When omitted, resolver falls
  // back to defaults.excludeDynamicSections (default true). Set false to
  // restore pre-115 behavior (dynamic sections like cwd/env/git remain
  // inside the system prompt rather than re-injected as the first user
  // message). Reload classification: NEXT-SESSION only — the systemPrompt
  // option is captured in baseOptions at session create/resume.
  excludeDynamicSections: z.boolean().optional(),
  // Phase 115 sub-scope 5 (Plan 04) — per-agent override for the
  // cache-breakpoint placement mode. When omitted, resolver falls back to
  // `defaults.cacheBreakpointPlacement` (default "static-first"). Set
  // "legacy" to revert to pre-115 interleaved stable-prefix ordering with
  // NO breakpoint marker — operator-controlled rollback path. Reload
  // classification: NEXT-SESSION only — placement is captured into the
  // assembled stable prefix at session create/resume.
  cacheBreakpointPlacement: z.enum(["static-first", "legacy"]).optional(),
  // Phase 90 MEM-02 — per-agent gate for the chokidar scanner. Default true
  // (via defaults.memoryScannerEnabled). Set to false to skip scanner start
  // for an agent whose memory/ is managed externally.
  memoryScannerEnabled: z.boolean().optional(),
  // Phase 90 MEM-04 — per-agent override for the mid-session flush cadence
  // in milliseconds (D-26). When omitted, resolver falls back to
  // defaults.memoryFlushIntervalMs (15 min). Positive integer only —
  // set defaults to a huge value (e.g. 24h) to effectively disable.
  memoryFlushIntervalMs: z.number().int().positive().optional(),
  // Phase 90 MEM-05 — per-agent override for the ✅ reaction emoji posted
  // on cue-detection (D-32). Short string (1–4 chars so a single unicode
  // glyph or short custom emoji name fits). Fallback via
  // defaults.memoryCueEmoji.
  memoryCueEmoji: z.string().min(1).max(8).optional(),
  /**
   * Phase 100 follow-up — when true, the agent boots automatically on
   * daemon start-all. When false, the agent's config is loaded but the SDK
   * session is NOT created on boot — operator can start it manually via
   * `clawcode start <name>` or via the IPC `start` method.
   *
   * Use case: large fleets where only a subset are in active rotation.
   * Configured agents that are dormant (rare-use specialists, on-call
   * agents, archived) skip the warm-path warmup at boot, cutting cold-start
   * time for the whole fleet from O(N agents × 2-3s) to O(active agents ×
   * 2-3s).
   *
   * Optional + back-compat: when omitted, loader.ts falls back to
   * defaults.autoStart (zod default true). v2.5/v2.6 yaml configs parse
   * unchanged. Mirrors the additive-optional schema blueprint used by
   * memoryAutoLoad / memoryScannerEnabled / greetOnRestart — agent fields
   * stay `.optional()` so the loader can detect "operator omitted" and
   * fall back to defaults.X verbatim.
   *
   * Reload classification: next-boot only. startAll has already run by the
   * time a config-watcher reload would fire, so flipping this field
   * requires a daemon restart to take effect.
   */
  autoStart: z.boolean().optional(),
  /**
   * Phase 110 Stage 0b — per-agent shimRuntime override. Mirrors the
   * shape of `defaultsSchema.shimRuntime` but each field is optional so
   * the loader can fall through (per-agent → defaults → "node") without
   * forcing operators to specify all three types when overriding one.
   *
   * Use case: per-agent canary rollout. Set
   * `agents.<name>.shimRuntime.search: static` to flip ONE agent to the
   * Go binary while the rest of the fleet stays on Node. Survives
   * agent-restart (loader re-resolves on every spawn) which the prior
   * inline-mcpServers-override workaround did not.
   *
   * Each field accepts the same enum as defaults.shimRuntime:
   *   - "node":   per-agent `clawcode <type>-mcp` (Node, ~147 MB RSS)
   *   - "static": Go binary at /opt/clawcode/bin/clawcode-mcp-shim --type X
   *   - "python": (reserved) python3 translator
   *
   * Crash-fallback (LOCKED): same as fleet-wide — no try/catch around
   * the alternate-runtime path. Operator-locked decision is fail-loud.
   */
  shimRuntime: z
    .object({
      search: z.enum(["node", "static", "python"]).optional(),
      image: z.enum(["node", "static", "python"]).optional(),
      browser: z.enum(["node", "static", "python"]).optional(),
    })
    .optional(),
  /**
   * Phase 999.25 — wake-order priority for boot-time auto-start.
   *
   * Lower numbers boot first. Agents without `wakeOrder` boot LAST in YAML
   * order (stable sort). Ties (same wakeOrder) preserve YAML order.
   *
   * Example:
   *   - admin-clawdy:    wakeOrder: 1   → boots first
   *   - fin-acquisition: wakeOrder: 2   → boots second
   *   - research:        wakeOrder: 3   → boots third
   *   - fin-research:    wakeOrder: 3   → boots fourth (tie → YAML order)
   *   - everyone else:   no wakeOrder   → boots after, in YAML order
   *
   * Boot is sequential (startAll iterates with `for...await`), so wakeOrder
   * only changes the ORDER, not the total time. Use case: ensure operator-
   * critical agents (Admin Clawdy, Ramy's fin-acquisition) come up before
   * peripheral agents during cold restarts.
   *
   * Reload classification: next-boot only — startAll has run by reload time.
   */
  wakeOrder: z.number().int().optional(),
  // Phase 94 TOOL-10 / D-10 — per-agent override of fleet directives.
  // Additive + optional: v2.5 migrated configs parse unchanged (loader
  // resolver fills from DEFAULT_SYSTEM_PROMPT_DIRECTIVES via
  // defaults.systemPromptDirectives). Per-key partial merge — setting
  // `agents.foo.systemPromptDirectives["file-sharing"].enabled = false`
  // disables that directive for foo only; cross-agent-routing still
  // inherits the default. Reloadable (next-turn boundary).
  systemPromptDirectives: z
    .record(z.string(), systemPromptDirectiveOverrideSchema)
    .optional(),
  // Phase 999.13 DELEG-01 — per-agent specialty → target-agent map.
  // Free-form keys (no enum lock-in): operators add `coding`, `legal`,
  // etc. via yaml without code changes. configSchema.superRefine
  // (below) rejects unknown target names at config load.
  // Optional + additive — agents without this field parse byte-
  // identically to v2.6 (back-compat invariant).
  delegates: z.record(z.string().min(1), z.string().min(1)).optional(),
  // Phase 95 DREAM-01..03 — per-agent autonomous reflection cycle.
  // Additive + optional: v2.5/v2.6 migrated configs parse unchanged when
  // omitted; loader resolver fills from defaults.dream. Per-agent override
  // wins for any field set; partial overrides inherit unset fields from
  // defaults. 9th application of the Phase 83/86/89/90/94 additive-
  // optional schema blueprint.
  dream: dreamConfigSchema.optional(),
  // Phase 96 D-05 — 10th additive-optional schema application; per-agent
  // operator-shared filesystem path candidates verified by runFsProbe at
  // boot + heartbeat tick. Schema preserves literal `{agent}` token; loader
  // resolveFileAccess expands it at call time. Each entry must be a non-
  // empty string; empty array allowed for explicit no-access fleet config.
  // Resolved set merges defaults.fileAccess (default-bearing) + per-agent
  // override (additive). v2.5 migrated configs parse unchanged. Reload
  // classification deferred to Plan 96-07 (config-watcher hot-reload).
  fileAccess: z.array(z.string().min(1)).optional(),
  // Phase 96 D-09 — 11th additive-optional schema application; per-agent
  // outputDir template string. Tokens ({date}/{agent}/{channel_name}/
  // {client_slug}) preserved literally; runtime resolveOutputDir expands
  // them with fresh ctx. Per-agent override beats defaults.outputDir.
  // v2.5/v2.6 migrated configs parse unchanged when omitted. Path traversal
  // is blocked at runtime (resolveOutputDir refuses leading `/` and `..`).
  outputDir: z.string().optional(),
  // Phase 100 GSD-02 / RESEARCH.md Pitfall 3 — 12th application of the
  // additive-optional schema blueprint (Phases 83/86/89/90/94/95/96).
  // Per-agent SDK settingSources. Default ["project"] applied at the loader
  // layer (resolveAgentConfig) — this schema field stays optional so v2.5/
  // v2.6 migrated configs parse unchanged. .min(1) rejects [] explicitly:
  // an empty array would silently disable all filesystem settings (no skills,
  // no CLAUDE.md, no commands) per SDK docs — Pitfall 3 in 100-RESEARCH.md.
  // Admin Clawdy sets ["project","user"] in clawcode.yaml so the SDK loads
  // ~/.claude/commands/gsd/*.md (the GSD slash command files symlinked by
  // Plan 06). Production agents (fin-acquisition, etc.) keep ["project"] —
  // omitting the field falls back to the loader default. Duplicates are
  // permitted (zod doesn't dedup); the SDK treats redundant entries idempotently.
  settingSources: z.array(z.enum(["project", "user", "local"])).min(1).optional(),
  // Phase 100 GSD-04 — per-agent gsd block. Currently only carries projectDir;
  // future fields (commitsAllowed, autoThreadKey, etc.) land here. Optional —
  // omission means "use agent.workspace as cwd" per the loader resolver in
  // Plan 02 (the consumer of this field). Per CONTEXT.md decision: only
  // Admin Clawdy sets gsd.projectDir; production agents do NOT.
  gsd: z.object({
    projectDir: z.string().min(1).optional(),
  }).optional(),
  skills: z.array(z.string()).default([]),
  soul: z.string().optional(),
  identity: z.string().optional(),
  // Phase 78 CONF-01 — file-pointer SOUL/IDENTITY. Mutually exclusive with
  // inline `soul` / `identity` (enforced at configSchema level via
  // superRefine below). Raw string stored here — expansion via
  // expandHome() happens in loader.ts in the same plan. Absolute or
  // `~/...` paths. When set, the daemon reads the file lazily at session
  // boot (see src/manager/session-config.ts precedence chain).
  soulFile: z.string().min(1).optional(),
  identityFile: z.string().min(1).optional(),
  memory: memorySchema.optional(),
  // Phase 90 Plan 07 WIRE-02 — per-agent heartbeat config.
  //
  // Legacy shape: `heartbeat: true|false` — a simple enable/disable flag
  // (behavior pre-Phase-90; `false` disables the heartbeat for this agent,
  // `true` defers to `defaults.heartbeat`).
  //
  // Extended shape: `heartbeat: { every?, model?, prompt? }` — carries an
  // OpenClaw-style per-agent heartbeat prompt + cadence (e.g. the 50-minute
  // context-zone monitor used by fin-acquisition). All fields optional so
  // a partial override is fine; resolver falls back to `defaults.heartbeat`
  // for unset fields.
  //
  // Accepted as a `z.union` so v2.1 migrated configs (all use boolean)
  // parse unchanged.
  heartbeat: z
    .union([
      z.boolean(),
      z.object({
        enabled: z.boolean().optional(),
        every: z.string().min(1).optional(),
        model: modelSchema.optional(),
        prompt: z.string().optional(),
      }),
    ])
    .default(true),
  schedules: z.array(scheduleEntrySchema).default([]),
  admin: z.boolean().default(false),
  subagentModel: modelSchema.optional(),
  // Phase 100 follow-up — operator-curated default effort raised low → high
  // (2026-04-28). Agents without an explicit effort field now ship at high
  // by default. Agents with explicit effort: low keep their override.
  effort: effortSchema.default("high"),
  slashCommands: z.array(slashCommandEntrySchema).default([]),
  threads: threadsConfigSchema.optional(),
  webhook: webhookConfigSchema.optional(),
  reactions: z.boolean().default(true),
  security: securityConfigSchema.optional(),
  mcpServers: z.array(z.union([mcpServerSchema, z.string()])).default([]),
  /**
   * Phase 100 follow-up — per-agent MCP server env overrides. Maps
   * `serverName → envKey → value`. Values matching `op://...` are resolved
   * at agent-start time via the daemon's `op read` shell-out (using the
   * daemon's process-level OP_SERVICE_ACCOUNT_TOKEN, which is the clawdbot
   * full-fleet service account). The resolved values replace whatever the
   * shared mcpServers[].env block provides, then get injected into the
   * spawned MCP subprocess env.
   *
   * Use case: vault-scope distribution. The daemon process holds the
   * clawdbot full-fleet token; this lets finmentum agents get a Finmentum-
   * vault-scoped token (whose source-of-truth is itself a credential
   * stored INSIDE the clawdbot vault) WITHOUT the daemon's clawdbot token
   * ever leaving the daemon process.
   *
   * Example:
   *   mcpEnvOverrides:
   *     1password:
   *       OP_SERVICE_ACCOUNT_TOKEN: "op://clawdbot/Finmentum Service Account/credential"
   *
   * Schema: server name + env key + env value all required to be non-empty
   * strings. Empty server name / key / value rejected at parse — those
   * shapes either silently no-op (empty server name doesn't match any
   * configured MCP) or break the env (zero-length token).
   *
   * Optional + missing field parses fine (back-compat with the existing
   * 15-agent fleet — all currently inherit the daemon's clawdbot token).
   */
  mcpEnvOverrides: z
    .record(
      z.string().min(1), // server name (must match an mcpServers entry)
      z.record(
        z.string().min(1), // env key
        z.string().min(1), // env value (op:// URI or literal)
      ),
    )
    .optional(),
  acceptsTasks: z                      // Phase 59 HAND-04
    .record(z.string().min(1), z.array(z.string().min(1)))
    .optional(),
  contextBudgets: contextBudgetsSchema.optional(),
  escalationBudget: z.object({
    daily: z.object({
      sonnet: z.number().int().positive().optional(),
      opus: z.number().int().positive().optional(),
    }).optional(),
    weekly: z.object({
      sonnet: z.number().int().positive().optional(),
      opus: z.number().int().positive().optional(),
    }).optional(),
  }).optional(),
  perf: z
    .object({
      traceRetentionDays: z.number().int().positive().optional(),
      taskRetentionDays: z.number().int().positive().default(7),
      slos: z.array(sloOverrideSchema).optional(),
      memoryAssemblyBudgets: memoryAssemblyBudgetsSchema.optional(),
      lazySkills: lazySkillsSchema.optional(),
      resumeSummaryBudget: resumeSummaryBudgetSchema.optional(),
      streaming: streamingConfigSchema.optional(),
      tools: toolsConfigSchema.optional(),
    })
    .optional(),
  // Phase 113 — per-agent Haiku vision pre-pass for image attachments.
  // When enabled, image attachments are resized and analysed by Haiku before
  // the main agent turn, injecting <screenshot-analysis> into the message.
  // Default false so the fleet opts in per-agent. Auth via OAuth token
  // (haiku-direct.ts), never ANTHROPIC_API_KEY.
  vision: z
    .object({
      enabled: z.boolean().default(false),
      preserveImage: z.boolean().default(false),
    })
    .optional(),
  // Phase 115 sub-scope 14 — operator-toggle for the diagnostic baseopts
  // dump. Default false: zero noise on the fleet. Replaces the temporary
  // hardcoded fin-acquisition + Admin Clawdy allowlist deployed during the
  // 2026-05-07 incident response. When true, the daemon writes a per-agent
  // baseopts dump to ~/.clawcode/agents/<agent>/diagnostics/baseopts-<flow>-
  // <ts>.json on every createSession/resumeSession (secrets redacted via
  // session-adapter.ts:redactSecrets). Optional + additive — every existing
  // agent yaml parses unchanged with this field omitted.
  debug: z.object({
    // Phase 115 sub-scope 14 — operator-toggle for dumpBaseOptionsOnSpawn.
    // Default false. Replaces the hardcoded fin-acquisition + Admin Clawdy
    // allowlist deployed during the 2026-05-07 incident response. When true,
    // daemon writes per-agent baseopts dump to ~/.clawcode/agents/<agent>/
    // diagnostics/baseopts-<flow>-<ts>.json on every createSession /
    // resumeSession (secrets redacted via session-adapter.ts:redactSecrets).
    dumpBaseOptionsOnSpawn: z.boolean().default(false),
  }).optional(),
});

/**
 * Schema for top-level defaults that agents inherit.
 */
export const defaultsSchema = z.object({
  model: modelSchema.default("haiku"),
  // Phase 100 follow-up — fleet-wide default effort raised low → high.
  effort: effortSchema.default("high"),
  // Phase 86 MODEL-01 — fleet-wide allowlist default. When an agent
  // omits `allowedModels`, the resolver substitutes this array. The
  // default ["haiku","sonnet","opus"] matches modelSchema's full set
  // so existing agents see no behavior change.
  allowedModels: z
    .array(modelSchema)
    .default(() => ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[]),
  // Phase 89 GREET-07 — fleet-wide default for restart-greeting emission.
  // Default true per D-09 — every agent greets on restart unless opted out.
  greetOnRestart: z.boolean().default(true),
  // Phase 89 GREET-10 — fleet-wide default for the cool-down window (ms).
  // 300_000 ms = 5 minutes per D-14.
  greetCoolDownMs: z.number().int().positive().default(300_000),
  // Phase 90 MEM-01 — Fleet-wide default: true (every agent auto-loads
  // its workspace MEMORY.md unless explicitly opted out). D-17 + D-18.
  memoryAutoLoad: z.boolean().default(true),
  // Phase 90 MEM-03 — fleet-wide hybrid-RRF retrieval top-K (default 5
  // per D-RETRIEVAL). Reloadable — next turn picks up the new value via
  // the getMemoryRetrieverForAgent closure re-read.
  memoryRetrievalTopK: z.number().int().positive().max(50).default(5),
  // Phase 115 sub-scope 3 — fleet-wide token budget for the per-turn
  // <memory-context> block. Down from the pre-115 hardcoded 2000 — the zod
  // knob existed in defaultsSchema since Phase 90 MEM-03 but was never
  // forwarded to retrieveMemoryChunks (Pain Point #1, codebase-memory-
  // retrieval.md). Phase 115 Plan 01 wires it through and tightens the
  // default to leave margin for sub-scope 1's tier-1 cap. 1500 ≈ ~6000
  // chars; range 500-8000 (validated). Reloadable — next turn picks up
  // via the getMemoryRetrieverForAgent closure re-read.
  memoryRetrievalTokenBudget: z.number().int().min(500).max(8000).default(1500),
  // Phase 115 sub-scope 4 — fleet-wide tag-exclusion list applied at the
  // hybrid-RRF memory retrieval BEFORE the chunks-side fan-out is fused
  // with the memories-side. The locked default removes pollution-feedback
  // memories that previously leaked into the <memory-context> block as
  // giant blobs (research codebase-memory-retrieval.md Pain Points #3 +
  // #15). Per-agent override available via agentSchema. Empty array
  // disables filtering entirely; a populated array fully replaces the
  // defaults (does NOT merge).
  memoryRetrievalExcludeTags: z
    .array(z.string())
    .default(() => ["session-summary", "mid-session", "raw-fallback"]),
  // Phase 115 sub-scope 2 — fleet-wide default for the SDK
  // systemPrompt.excludeDynamicSections flag. When true, per-machine
  // dynamic sections (cwd, auto-memory paths, git status) are stripped
  // from the cached system prompt and re-injected as the first user
  // message — improves cross-agent prompt-cache reuse. Default true per
  // CONTEXT.md sub-scope 2 lock; set false to revert to pre-115 behavior.
  // Reload classification: NEXT-SESSION only.
  excludeDynamicSections: z.boolean().default(true),
  // Phase 115 sub-scope 5 (Plan 04) — fleet-wide cache-breakpoint placement
  // mode. "static-first" (default): static sections (identity, soul, skills,
  // tools, fs-capability, delegates) land BEFORE the breakpoint marker;
  // dynamic sections (hot memories, graph context) land AFTER. Mirrors
  // Hermes static-then-dynamic placement; the operator-priority goal is
  // recovering prompt-cache hit rate by stabilizing the bytes prior to the
  // marker across most turns. "legacy" — pre-115 interleaved order, no
  // marker emitted — revert path. Reload classification: NEXT-SESSION only.
  cacheBreakpointPlacement: z
    .enum(["static-first", "legacy"])
    .default("static-first"),
  // Phase 90 MEM-02 — fleet-wide scanner on/off. Default true — every
  // agent starts a chokidar watcher on its {workspace}/memory/**/*.md.
  memoryScannerEnabled: z.boolean().default(true),
  // Phase 90 MEM-04 — fleet-wide mid-session flush cadence (D-26). Default
  // 15 minutes. Every active session's MemoryFlushTimer fires this often
  // (skip heuristic bails if no meaningful turns since last flush).
  memoryFlushIntervalMs: z.number().int().positive().default(900_000),
  // Phase 999.6 SNAP-04 — staleness threshold for pre-deploy-snapshot.json (hours).
  // 24h default per CONTEXT.md. Configurable so operators can tune.
  // Default-bearing → existing v2.5/v2.6 configs parse unchanged.
  preDeploySnapshotMaxAgeHours: z
    .number()
    .int()
    .positive()
    .default(24)
    .optional(),
  // Phase 999.12 HB-01 — per-check inbox heartbeat timeout in milliseconds.
  // Default 60_000 (60s) — comfortably exceeds typical Sonnet/Opus tool-using
  // cross-agent turn duration (30-90s) so the heartbeat inbox check no longer
  // false-positive-criticals during normal IPC traffic. Set to undefined or
  // omit to fall back to the fleet-wide `heartbeat.checkTimeoutSeconds`.
  // Default-bearing → existing v2.x configs parse unchanged. Same additive-
  // optional shape as preDeploySnapshotMaxAgeHours above.
  heartbeatInboxTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(60_000)
    .optional(),
  // Phase 90 MEM-05 — fleet-wide default reaction emoji for cue detection
  // (D-32). Standard ✅ — operators can override per-agent or fleet-wide.
  memoryCueEmoji: z.string().min(1).max(8).default("✅"),
  // Phase 100 follow-up — fleet-wide default for the per-agent autoStart
  // flag. Default true preserves existing behavior (every configured agent
  // boots on daemon start-all). Operators can flip the polarity to false
  // here and then opt-in only the agents they want live by setting
  // `autoStart: true` on those entries — useful when only a small subset of
  // a large configured fleet is in active rotation.
  autoStart: z.boolean().default(true),
  // Phase 94 TOOL-10 / D-10 — fleet-wide default system-prompt directives.
  //
  // Default-bearing: when omitted from clawcode.yaml, the loader resolves
  // to DEFAULT_SYSTEM_PROMPT_DIRECTIVES (D-09 file-sharing + D-07 cross-
  // agent-routing). v2.5 migrated configs parse unchanged (REG-V25-BACKCOMPAT
  // — additive-optional, 8th application of the Phase 83/86/89/90/92
  // schema blueprint).
  //
  // Reloadable — next agent prompt assembly picks up edits without daemon
  // restart (RELOADABLE_FIELDS in src/config/types.ts).
  systemPromptDirectives: z
    .record(z.string(), systemPromptDirectiveSchema)
    .default(() => ({ ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES })),
  // Phase 95 DREAM-01..03 — fleet-wide default dream cycle config.
  // Default-bearing via dreamConfigSchema's own field defaults
  // (enabled:false / idleMinutes:30 / model:haiku). v2.5/v2.6 migrated
  // configs parse unchanged when omitted. Reloadable: a YAML edit takes
  // effect on the NEXT cron tick / NEXT dream-pass invocation; current
  // in-flight dream passes complete at the previous setting.
  dream: dreamConfigSchema.default(() => ({
    enabled: false,
    idleMinutes: 30,
    model: "haiku" as const,
  })),
  // Phase 96 D-05 — 10th additive-optional schema application; fleet-wide
  // default filesystem path candidates. The `{agent}` literal token is
  // preserved here verbatim (NOT expanded at parse time) — loader
  // resolveFileAccess(agentName, ...) substitutes the actual agent name
  // at call time. v2.5/v2.6 migrated configs parse unchanged when omitted.
  // Reload classification deferred to Plan 96-07 (config-watcher hot-reload).
  fileAccess: z
    .array(z.string().min(1))
    .default(() => [...DEFAULT_FILE_ACCESS]),
  // Phase 96 D-09 — 11th additive-optional schema application; fleet-wide
  // default outputDir template. Default 'outputs/{date}/' lands generated
  // files under a dated subdirectory of the agent workspace root. Tokens
  // preserved literally; runtime expansion via resolveOutputDir at write
  // time keeps {date} fresh per call (loader-time expansion would freeze
  // the date at config-load time — wrong on the second day).
  outputDir: z.string().default(DEFAULT_OUTPUT_DIR),
  // Phase 999.13 TZ-02 — operator-local TZ for agent-visible timestamps.
  // IANA name (e.g. "America/Los_Angeles"). When unset, the runtime helper
  // resolveAgentTimezone() falls back to process.env.TZ → host TZ via
  // Intl.DateTimeFormat resolution (captured once at module load).
  // Pre-validation here catches typos like "Pacific/LosAngeles" at config
  // load (Q3=YES) — fail-fast vs. discovering the bad TZ at first prompt
  // assembly (where the helper would silently fall back to UTC).
  // Internal storage / DB / structured event keys stay UTC ISO; this knob
  // only affects agent-visible *rendering* at the prompt-emission boundary.
  timezone: z
    .string()
    .optional()
    .refine(
      (tz) => {
        if (tz === undefined) return true;
        try {
          new Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      {
        message:
          "invalid IANA timezone name (e.g. use 'America/Los_Angeles' not 'Pacific/LosAngeles')",
      },
    ),
  skills: z.array(z.string()).default([]),
  basePath: z.string().default("~/.clawcode/agents"),
  skillsPath: z.string().default("~/.clawcode/skills"),
  // Phase 88 MKT-02 — optional list of legacy skill source roots (typically
  // ~/.openclaw/skills) unioned with the local skillsPath into the /clawcode-
  // skills-browse marketplace catalog. Each entry names a filesystem path
  // (expanded via expandHome at resolution time) and an optional human-
  // readable label shown in the Discord picker.
  // Additive + optional: v2.1/v2.2 migrated configs parse unchanged when
  // omitted; Plan 02 resolver emits a concrete [] for downstream catalog
  // loaders. `path.min(1)` rejects empty strings at parse time.
  // Phase 90 Plan 04 HUB-01 — marketplace sources now accepts a union of
  // (legacy path-based) and (ClawHub registry) entries. The legacy branch
  // matches the pre-Phase-90 shape byte-for-byte so v2.1/v2.2 migrated
  // configs parse unchanged (regression pin: clawhub-schema.test.ts
  // HUB-SCH-2a). The ClawHub branch carries a full HTTPS baseUrl,
  // optional authToken (op://... ref or literal), and optional per-source
  // cacheTtlMs override. When cacheTtlMs is absent, the daemon-wide
  // `clawhubCacheTtlMs` default below applies.
  marketplaceSources: z
    .array(
      z.union([
        // Legacy / v2.2 path-based entry — read-only filesystem source
        // (typically ~/.openclaw/skills). Expanded via expandHome in
        // loader.ts.
        z.object({
          path: z.string().min(1),
          label: z.string().optional(),
        }),
        // Phase 90 HUB-01 — ClawHub registry source. baseUrl points at the
        // root (e.g. https://clawhub.ai); the HTTP client appends
        // /api/v1/skills?... paths. authToken can be literal or op://ref;
        // Plan 90-06 adds the interactive GitHub-OAuth flow that populates
        // it. cacheTtlMs overrides the fleet-wide default for this one
        // source (D-05).
        z.object({
          kind: z.literal("clawhub"),
          baseUrl: z.string().url(),
          authToken: z.string().min(1).optional(),
          cacheTtlMs: z.number().int().positive().optional(),
        }),
      ]),
    )
    .optional(),
  // Phase 90 Plan 04 HUB-01 — ClawHub registry base URL used when an
  // agent invokes /clawcode-skills-browse without an explicit
  // marketplaceSources[kind:"clawhub"] entry. Default mirrors the D-01
  // decision (confirmed via probe 2026-04-24).
  clawhubBaseUrl: z.string().url().default("https://clawhub.ai"),
  // Phase 90 Plan 04 HUB-08 — In-memory cache TTL for ClawHub registry
  // responses, keyed by {endpoint, query, cursor}. Default 10 min per
  // D-05. Per-source overrides via marketplaceSources[].cacheTtlMs.
  clawhubCacheTtlMs: z.number().int().positive().default(600_000),
  memory: memorySchema.default(() => ({
    compactionThreshold: 0.75,
    searchTopK: 10,
    consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" },
    decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 },
    deduplication: { enabled: true, similarityThreshold: 0.85 },
    tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20, centralityPromoteThreshold: 5 },
    episodes: { archivalAgeDays: 90 },
  })),
  heartbeat: heartbeatConfigSchema.default(() => ({
    enabled: true,
    intervalSeconds: 60,
    checkTimeoutSeconds: 10,
    contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } },
  })),
  threads: threadsConfigSchema.default(() => ({
    idleTimeoutMinutes: 1440,
    // Phase 99 sub-scope N (2026-04-26) — lowered from 10 to 3.
    // See threadsConfigSchema comment above for context.
    maxThreadSessions: 3,
  })),
  // Phase 999.14 MCP-09 — idle threshold for the periodic stale-binding
  // sweep. Format: "24h" / "6h" / "30m" / "0" ("0" disables sweep entirely).
  // Default "24h" surfaces today's incident pattern (fin-acquisition's 22h+
  // bindings) without surprising operators. The sweep runs on the same 60s
  // tick as the MCP-03 orphan reaper, AFTER the orphan reap completes.
  threadIdleArchiveAfter: z
    .string()
    .optional()
    .describe(
      "Idle duration after which stale Discord thread bindings get auto-archived (e.g. '24h', '6h', '30m'); '0' disables. Default '24h'.",
    ),
  // Phase 109-B — orphan-claude reaper config. Alert-only by default for the
  // first ~7 days post-deploy so operators can audit the false-positive rate
  // before flipping to "reap". Hot-reload via ConfigReloader; takes effect
  // on the next 60s tick without daemon restart.
  orphanClaudeReaper: z
    .object({
      mode: z.enum(["off", "alert", "reap"]).default("alert"),
      // 120s = 4× the polled-discovery budget (MCP_POLL_INTERVAL_MS×MCP_POLL_MAX_ATTEMPTS
      // = 30s in src/manager/session-manager.ts). The previous default of 30s exactly
      // matched the discovery budget, leaving zero buffer — under contended parallel
      // boots the reaper killed legitimate-but-not-yet-tracked claude subprocesses.
      // Pinned by the structural-invariant test in
      // src/mcp/__tests__/orphan-claude-reaper.test.ts.
      minAgeSeconds: z.number().int().positive().default(120),
    })
    .optional(),
  // Phase 999.25 — subagent completion relay. Decouples
  // `relayCompletionToParent` (operator-channel notification) from
  // session-end. Two new triggers: the `subagent_complete` MCP tool
  // (explicit signal from skill author) and a quiescence-timer sweep
  // (60s onTickAfter). `completedAt` on the ThreadBinding dedupes the
  // three trigger paths (tool / quiescence / session-end). Hot-reload
  // works post-PR #8 (closure-capture fix).
  subagentCompletion: z
    .object({
      enabled: z.boolean().default(true),
      quiescenceMinutes: z.number().int().positive().default(5),
    })
    .optional(),
  // Phase 999.X — subagent-thread reaper. Auto-spawned subagent threads
  // (SubagentThreadSpawner-named, see src/manager/subagent-name.ts) are
  // one-shot delegated tasks; they should self-prune after the Discord
  // thread goes idle but today nothing stops them. The fleet evidence
  // (admin-clawdy 2026-05-04) showed two such threads running 8h+/13h+
  // after their work completed. Hot-reload via ConfigReloader; takes
  // effect on the next 60s tick. Default mode "reap" — the screenshot
  // shows real leaks today, so we act on first tick rather than running
  // alert-only first (operator decision). Env kill-switch:
  // CLAWCODE_SUBAGENT_REAPER_DISABLE=1.
  subagentReaper: z
    .object({
      mode: z.enum(["off", "alert", "reap"]).default("reap"),
      idleTimeoutMinutes: z.number().int().positive().default(1440),
      minAgeSeconds: z.number().int().positive().default(300),
    })
    .optional(),
  // Phase 109-D — fleet-wide observability config. cgroupSampling reads
  // /sys/fs/cgroup/system.slice/clawcode.service/memory.{current,max}; toggle
  // off on hosts where cgroup v2 isn't mounted (the reader degrades to null
  // gracefully anyway, but operators can disable explicitly).
  observability: z
    .object({
      cgroupSampling: z.boolean().default(true),
      cgroupAlertPercent: z.number().int().positive().max(100).default(80),
    })
    .optional(),
  // Phase 109-C — broker pooling kill-switch. Phase 108 keeps `enabled: true`
  // by default since the broker is LIVE in production; surfaced here so an
  // operator can flip to false at runtime if the pool misbehaves under load.
  brokerPooling: z
    .object({
      enabled: z.boolean().default(true),
    })
    .optional(),
  // Phase 110 Stage 0a → Stage 0b — per-shim-type runtime selector. Each
  // entry picks the runtime the loader-auto-injected `clawcode {search,
  // image,browser}-mcp` shim spawns under. Stage 0a shipped the dial
  // wired end-to-end with a single value ("node" — current behavior);
  // Stage 0b widens the enum (DONE — see PR landing this commit) to
  // ["node","static","python"] so an operator can flip a flag and the
  // loader rewrites command/args without a daemon restart.
  //
  // - "node":   current behavior — `clawcode <type>-mcp` Node shim (~147 MB RSS each)
  // - "static": Go binary at /opt/clawcode/bin/clawcode-mcp-shim --type <type> (target <10 MB RSS)
  // - "python": (reserved) python3 translator at /opt/clawcode/bin/clawcode-mcp-shim.py;
  //             no implementation in Stage 0b. Widening the enum together
  //             with "static" lets a future Python pivot ship without
  //             another schema migration.
  //
  // Default still "node": existing operator config is byte-identical
  // until they explicitly flip a flag. Per-type independence — search
  // can flip to "static" while image stays "node" — is intentional so
  // the operator can roll out per-shim-type per CONTEXT.md's locked
  // search → image → browser rollout order.
  //
  // Crash-fallback policy (LOCKED): if a "static" spawn fails, fail
  // loud — do NOT auto-fall-back to "node". Surface the failure to the
  // operator. Loader code intentionally contains no try/catch around
  // the alternate-runtime path.
  shimRuntime: z
    .object({
      search: z.enum(["node", "static", "python"]).default("node"),
      image: z.enum(["node", "static", "python"]).default("node"),
      browser: z.enum(["node", "static", "python"]).default("node"),
    })
    .optional(),
  // Phase 115 D-08 + D-09 — embedding-v2 migration knobs. Default values
  // match the Phase 115 D-09 cost discipline: 5% CPU budget, 50-row
  // batch. These are knobs not constants; operator can dial both via
  // hot-reload on a per-fleet basis. The pausedAgents array lets the
  // operator pause migration for one or more agents (independent of the
  // per-agent state machine — agent stays in dual-write/re-embedding,
  // but the heartbeat-driven runner skips it). Schema-only this plan;
  // wave 4's migration kickoff actually wires the runner reads.
  embeddingMigration: z
    .object({
      cpuBudgetPct: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(5)
        .describe(
          "Phase 115 D-09 — CPU budget for the v2 re-embed batch worker. Default 5%.",
        ),
      batchSize: z
        .number()
        .int()
        .min(10)
        .max(500)
        .default(50)
        .describe(
          "Phase 115 D-08 — re-embed batch size. Default 50 entries per batch.",
        ),
      pausedAgents: z
        .array(z.string())
        .default(() => [])
        .describe(
          "List of agents whose v2 re-embed batch is paused (operator-controlled).",
        ),
    })
    // Optional (mirrors shimRuntime / brokers schema-only-default pattern)
    // — schema ships in this plan, runtime wiring lands in wave 4. Operators
    // who don't override see undefined; the runner fills in the cpuBudgetPct
    // / batchSize / pausedAgents defaults at consumption time.
    .optional(),
  // Phase 115 Plan 07 sub-scope 15 — daemon-side MCP tool-response cache.
  // Folds Phase 999.40 (now SUPERSEDED-BY-115). The cache lives at
  // `~/.clawcode/manager/tool-cache.db` and intercepts repeated tool
  // calls at the IPC dispatch boundary. Per-tool TTL + key-strategy
  // defaults live in `src/mcp/tool-cache-policy.ts:DEFAULT_TOOL_CACHE_POLICY`;
  // operators override per-tool here.
  //
  // Optional (mirrors shimRuntime / brokers / embeddingMigration
  // schema-only-default pattern). When absent, runtime fills in
  // `enabled=true` / `maxSizeMb=100` / empty policy overrides.
  toolCache: z
    .object({
      enabled: z
        .boolean()
        .default(true)
        .describe(
          "Phase 115 sub-scope 15 — master switch. Set false to fully bypass the cache (e.g., debugging tool dispatch).",
        ),
      maxSizeMb: z
        .number()
        .int()
        .min(10)
        .max(10000)
        .default(100)
        .describe(
          "Phase 115 sub-scope 15 — total cache size cap in MB. LRU evicts oldest rows when over cap. Default 100MB.",
        ),
      policy: z
        .record(
          z.string().min(1),
          z.object({
            ttlSeconds: z.number().int().min(0).max(86400).optional(),
            keyStrategy: z
              .enum(["per-agent", "cross-agent", "no-cache"])
              .optional(),
          }),
        )
        .default(() => ({}))
        .describe(
          "Per-tool overrides keyed by tool name. Operator can shorten TTL or flip strategy; cacheable predicate (e.g. mysql_query read-only gate) cannot be patched.",
        ),
    })
    .optional(),
  // Phase 110 Stage 0a — broker dispatch table. Server-id keyed map for
  // generalizing Phase 108's OnePasswordMcpBroker to typed multi-server
  // pools (one broker proc per server-id, N agents → 1 child). Schema
  // only this PR; Stage 1a wires the broker class to read this map and
  // Stage 1b wires the daemon dispatch. Reloadable in classification so
  // the surface is stable; runtime edits are no-ops until Stage 1a.
  brokers: z
    .record(
      z.string().min(1),
      z.object({
        enabled: z.boolean().default(true),
        maxConcurrent: z.number().int().positive().default(4),
        spawnArgs: z.array(z.string()).default(() => []),
        env: z.record(z.string(), z.string()).default(() => ({})),
        drainOnIdleMs: z.number().int().nonnegative().default(0),
      }),
    )
    .optional(),
  perf: z
    .object({
      traceRetentionDays: z.number().int().positive().optional(),
      taskRetentionDays: z.number().int().positive().default(7),
      slos: z.array(sloOverrideSchema).optional(),
      memoryAssemblyBudgets: memoryAssemblyBudgetsSchema.optional(),
      lazySkills: lazySkillsSchema.optional(),
      resumeSummaryBudget: resumeSummaryBudgetSchema.optional(),
      streaming: streamingConfigSchema.optional(),
      tools: toolsConfigSchema.optional(),
    })
    .optional(),
  // Phase 69: OpenAI-compatible endpoint config. DO NOT confuse with
  // mcpServers.openai (unrelated MCP entry at a different nesting level).
  openai: openaiEndpointSchema,
  // Phase 70: browser automation config (BROWSER-01..06). Governs the
  // resident Chromium singleton + per-agent BrowserContext persistence.
  browser: browserConfigSchema,
  // Phase 71: web search MCP config (SEARCH-01..03). Governs the Brave /
  // Exa provider clients + URL fetcher + Readability adapter. Backend
  // union locked at brave|exa; API keys read lazily at client call time.
  search: searchConfigSchema,
  // Phase 72: image generation MCP config (IMAGE-01..04). Governs the
  // OpenAI / MiniMax / fal.ai provider clients + workspace writer + cost
  // recorder. Backend union locked at openai|minimax|fal; API keys read
  // lazily at client call time. image_generate / edit / variations are
  // NOT idempotent (different images for same prompt) — explicitly
  // excluded from IDEMPOTENT_TOOL_DEFAULTS.
  image: imageConfigSchema,
});

// ---------------------------------------------------------------------------
// Phase 61 — Per-source trigger config schemas
// ---------------------------------------------------------------------------

/**
 * MySQL DB-change polling trigger config (TRIG-02).
 * Polls `SELECT ... WHERE id > ?` on a configurable table with committed-read
 * confirmation to avoid phantom triggers from ROLLBACKed inserts.
 */
export const mysqlTriggerSourceSchema = z.object({
  table: z.string().min(1),
  idColumn: z.string().min(1).default("id"),
  pollIntervalMs: z.number().int().positive().default(30_000),
  targetAgent: z.string().min(1),
  batchSize: z.number().int().positive().default(100),
  filter: z.string().optional(),
});
export type MysqlTriggerSourceConfig = z.infer<typeof mysqlTriggerSourceSchema>;

/**
 * Webhook HTTP trigger config (TRIG-03).
 * Accepts POST to `/webhook/<triggerId>` with HMAC-SHA256 signature verification.
 */
export const webhookTriggerSourceSchema = z.object({
  triggerId: z.string().min(1),
  secret: z.string().min(1),
  targetAgent: z.string().min(1),
  maxBodyBytes: z.number().int().positive().default(65_536),
});
export type WebhookTriggerSourceConfig = z.infer<typeof webhookTriggerSourceSchema>;

/**
 * Inbox filesystem trigger config (TRIG-04).
 * Watches collaboration inbox directory via chokidar with awaitWriteFinish.
 */
export const inboxTriggerSourceSchema = z.object({
  targetAgent: z.string().min(1),
  stabilityThresholdMs: z.number().int().min(0).default(500),
});
export type InboxTriggerSourceConfig = z.infer<typeof inboxTriggerSourceSchema>;

/**
 * Google Calendar polling trigger config (TRIG-05).
 * Polls upcoming events via MCP server and fires at configurable offsets.
 */
export const calendarTriggerSourceSchema = z.object({
  user: z.string().min(1),
  targetAgent: z.string().min(1),
  calendarId: z.string().min(1).default("primary"),
  pollIntervalMs: z.number().int().positive().default(300_000),
  offsetMs: z.number().int().min(0).default(900_000),
  maxResults: z.number().int().min(1).max(100).default(50),
  mcpServer: z.string().min(1),
  eventRetentionDays: z.number().int().positive().default(7),
});
export type CalendarTriggerSourceConfig = z.infer<typeof calendarTriggerSourceSchema>;

/**
 * Aggregate trigger sources config — optional object with arrays for each
 * source type. Each array defaults to empty (source type disabled).
 */
export const triggerSourcesConfigSchema = z.object({
  mysql: z.array(mysqlTriggerSourceSchema).default([]),
  webhook: z.array(webhookTriggerSourceSchema).default([]),
  inbox: z.array(inboxTriggerSourceSchema).default([]),
  calendar: z.array(calendarTriggerSourceSchema).default([]),
}).optional();
export type TriggerSourcesConfig = z.infer<typeof triggerSourcesConfigSchema>;

/**
 * Phase 60 — trigger engine configuration section.
 *
 * Lives at root level in clawcode.yaml under `triggers`. Optional — when
 * omitted, TriggerEngine uses the defaults from types.ts
 * (DEFAULT_REPLAY_MAX_AGE_MS, DEFAULT_DEBOUNCE_MS).
 *
 * Phase 61 extends this with an optional `sources` sub-object containing
 * per-source-type config arrays.
 */
export const triggersConfigSchema = z.object({
  replayMaxAgeMs: z.number().int().positive().default(86400000),
  defaultDebounceMs: z.number().int().min(0).default(5000),
  sources: triggerSourcesConfigSchema,
}).optional();

/** Inferred triggers config type. */
export type TriggersConfig = z.infer<typeof triggersConfigSchema>;

/**
 * Schema for optional Discord configuration.
 * botToken can be a literal token or an op:// reference resolved via 1Password CLI.
 */
export const discordConfigSchema = z.object({
  botToken: z.string().min(1).optional(),
}).optional();

/** Discord config type. */
export type DiscordConfig = z.infer<typeof discordConfigSchema>;

/**
 * Root config schema for clawcode.yaml.
 * Requires version: 1 and at least one agent.
 */
export const configSchema = z.object({
  version: z.literal(1),
  discord: discordConfigSchema,
  defaults: defaultsSchema.default(() => ({
    model: "haiku" as const,
    effort: "low" as const,
    // Phase 86 MODEL-01 — fleet-wide allowlist default matches the full
    // modelSchema enum so configs that omit `defaults` see identical
    // behavior to v2.1 (all three model aliases pickable).
    allowedModels: ["haiku", "sonnet", "opus"] as ("haiku" | "sonnet" | "opus")[],
    // Phase 89 GREET-07 / GREET-10 — fleet-wide defaults mirroring the
    // zod-populated values in defaultsSchema above.
    greetOnRestart: true,
    greetCoolDownMs: 300_000,
    // Phase 90 MEM-01 — fleet-wide default mirrors the zod-populated value.
    memoryAutoLoad: true,
    // Phase 90 MEM-02 / MEM-03 — fleet-wide defaults mirror the zod-populated
    // values in defaultsSchema above. Scanner on by default; retrieval
    // topK=5 + token budget 2000 per D-RETRIEVAL.
    memoryRetrievalTopK: 5,
    // Phase 115 sub-scope 3 — was 2000 (pre-115 dead-knob default). Now
    // 1500 (CONTEXT.md D-02). Mirror exists for the configSchema fallback
    // when `defaults:` is OMITTED entirely from clawcode.yaml.
    memoryRetrievalTokenBudget: 1500,
    // Phase 115 sub-scope 4 — locked default tag-exclusion list mirrors
    // defaultsSchema's zod default. Mutable copy so the configSchema-level
    // record is independent of the array literal.
    memoryRetrievalExcludeTags: ["session-summary", "mid-session", "raw-fallback"],
    // Phase 115 sub-scope 2 — fleet-wide default mirrors defaultsSchema.
    excludeDynamicSections: true,
    // Phase 115 sub-scope 5 (Plan 04) — fleet-wide default mirrors
    // defaultsSchema. "static-first" places static sections before the
    // CACHE_BREAKPOINT_MARKER and dynamic sections after; "legacy"
    // preserves pre-115-04 interleaved order with no marker (revert path).
    cacheBreakpointPlacement: "static-first" as const,
    memoryScannerEnabled: true,
    // Phase 90 MEM-04 / MEM-05 — fleet-wide defaults mirror defaultsSchema.
    memoryFlushIntervalMs: 900_000,
    memoryCueEmoji: "✅",
    // Phase 100 follow-up — fleet-wide autoStart default mirrors the
    // zod-populated value in defaultsSchema above. Default true preserves
    // back-compat: every configured agent boots on daemon start-all unless
    // it (or the operator's defaults block) explicitly opts out.
    autoStart: true,
    // Phase 94 TOOL-10 / D-10 — fleet-wide default directives mirror
    // DEFAULT_SYSTEM_PROMPT_DIRECTIVES (D-09 file-sharing + D-07 cross-
    // agent-routing). Spread to a fresh object so the configSchema-default
    // record is independent of the frozen exported constant (defensive
    // copy — downstream merges via resolveSystemPromptDirectives never
    // see the frozen reference).
    systemPromptDirectives: { ...DEFAULT_SYSTEM_PROMPT_DIRECTIVES },
    // Phase 95 DREAM-01..03 — fleet-wide default dream cycle config
    // mirrors the zod-populated value in defaultsSchema above.
    dream: { enabled: false, idleMinutes: 30, model: "haiku" as const },
    // Phase 96 D-05 — fleet-wide default fileAccess paths mirror the
    // zod-populated value in defaultsSchema above. Spread to a fresh
    // array so the configSchema-default is independent of the frozen
    // exported constant (defensive copy — downstream merges via
    // resolveFileAccess never see the frozen reference).
    fileAccess: [...DEFAULT_FILE_ACCESS],
    // Phase 96 D-09 — fleet-wide default outputDir mirrors the zod-populated
    // value in defaultsSchema above. Tokens preserved literally; runtime
    // resolveOutputDir expands them per call.
    outputDir: DEFAULT_OUTPUT_DIR,
    // Phase 90 Plan 04 HUB-01 / HUB-08 — ClawHub registry defaults
    // mirroring the zod-populated values in defaultsSchema above.
    clawhubBaseUrl: "https://clawhub.ai",
    clawhubCacheTtlMs: 600_000,
    skills: [] as string[],
    basePath: "~/.clawcode/agents",
    skillsPath: "~/.clawcode/skills",
    memory: { compactionThreshold: 0.75, searchTopK: 10, consolidation: { enabled: true, weeklyThreshold: 7, monthlyThreshold: 4, schedule: "0 3 * * *" }, decay: { halfLifeDays: 30, semanticWeight: 0.7, decayWeight: 0.3 }, deduplication: { enabled: true, similarityThreshold: 0.85 }, tiers: { hotAccessThreshold: 3, hotAccessWindowDays: 7, hotDemotionDays: 7, coldRelevanceThreshold: 0.05, hotBudget: 20, centralityPromoteThreshold: 5 }, episodes: { archivalAgeDays: 90 } },
    heartbeat: {
      enabled: true,
      intervalSeconds: 60,
      checkTimeoutSeconds: 10,
      contextFill: { warningThreshold: 0.6, criticalThreshold: 0.75, zoneThresholds: { yellow: 0.50, orange: 0.70, red: 0.85 } },
    },
    threads: {
      idleTimeoutMinutes: 1440,
      // Phase 99 sub-scope N (2026-04-26) — lowered from 10 to 3.
      maxThreadSessions: 3,
    },
    // Phase 69 — OpenAI-compatible endpoint defaults (OPENAI-01..07).
    openai: {
      enabled: true,
      port: 3101,
      host: "0.0.0.0",
      maxRequestBodyBytes: 1048576,
      streamKeepaliveMs: 15000,
    },
    // Phase 70 — browser automation defaults (BROWSER-01..06).
    browser: {
      enabled: true,
      headless: true,
      warmOnBoot: true,
      navigationTimeoutMs: 30000,
      actionTimeoutMs: 10000,
      viewport: { width: 1280, height: 720 },
      userAgent: null,
      maxScreenshotInlineBytes: 524288,
    },
    // Phase 71 — web search MCP defaults (SEARCH-01..03).
    search: {
      enabled: true,
      backend: "brave" as const,
      brave: {
        apiKeyEnv: "BRAVE_API_KEY",
        safeSearch: "moderate" as const,
        country: "us",
      },
      exa: {
        apiKeyEnv: "EXA_API_KEY",
        useAutoprompt: false,
      },
      maxResults: 20,
      timeoutMs: 10000,
      fetch: {
        timeoutMs: 30000,
        maxBytes: 1048576,
        userAgentSuffix: null,
      },
    },
    // Phase 72 — image generation MCP defaults (IMAGE-01..04).
    image: {
      enabled: true,
      backend: "openai" as const,
      openai: { apiKeyEnv: "OPENAI_API_KEY", model: "gpt-image-1" },
      minimax: { apiKeyEnv: "MINIMAX_API_KEY", model: "image-01" },
      fal: { apiKeyEnv: "FAL_API_KEY", model: "fal-ai/flux-pro" },
      maxImageBytes: 10485760,
      timeoutMs: 60000,
      workspaceSubdir: "generated-images",
    },
  })),
  mcpServers: z.record(z.string(), mcpServerSchema).default({}),
  triggers: triggersConfigSchema,
  agents: z.array(agentSchema).min(1),
}).superRefine((cfg, ctx) => {
  // Phase 75 SHARED-01 — detect two agents declaring the SAME memoryPath.
  // Raw-string comparison is sufficient at this layer: loader.ts handles
  // expansion + path resolution; identical user-facing YAML values are
  // guaranteed to collide post-expansion. Path-normalization edge cases
  // (trailing slash, ./ prefixes) are explicitly out of scope per the
  // deferred section of 75-CONTEXT.md and are handled downstream.
  const byPath = new Map<string, string[]>();
  for (const agent of cfg.agents) {
    if (!agent.memoryPath) continue;
    const list = byPath.get(agent.memoryPath) ?? [];
    list.push(agent.name);
    byPath.set(agent.memoryPath, list);
  }
  for (const [path, names] of byPath) {
    if (names.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents"],
        message: `memoryPath conflict: "${path}" is declared by multiple agents (${names.join(", ")}). Each agent must have a distinct memoryPath or omit it to fall back to workspace.`,
      });
    }
  }

  // Phase 78 CONF-01 — mutual exclusion: inline `soul`/`identity` cannot
  // coexist with file-pointer `soulFile`/`identityFile` on the same agent.
  // Ambiguous precedence would silently prefer one over the other; we fail
  // loud at load time instead. Per-agent scope (cross-agent mix is fine).
  for (const agent of cfg.agents) {
    if (agent.soul !== undefined && agent.soulFile !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents"],
        message: `agent "${agent.name}": inline "soul" and "soulFile" cannot be used together — pick one (soulFile is preferred for migrated agents).`,
      });
    }
    if (agent.identity !== undefined && agent.identityFile !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents"],
        message: `agent "${agent.name}": inline "identity" and "identityFile" cannot be used together — pick one (identityFile is preferred for migrated agents).`,
      });
    }
  }

  // Phase 999.13 DELEG-03 — every delegates value must point to a known agent.
  // Fail fast at config load (matches the soul/soulFile mutex pattern above)
  // so operators don't ship a half-booted fleet with a broken delegate target.
  const agentNames = new Set(cfg.agents.map((a) => a.name));
  for (const agent of cfg.agents) {
    if (!agent.delegates) continue;
    for (const [specialty, target] of Object.entries(agent.delegates)) {
      if (!agentNames.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agents"],
          message: `agent "${agent.name}": delegates["${specialty}"] points to unknown agent "${target}". Configure that agent or remove this delegate entry.`,
        });
      }
    }
  }
});

/** Fully parsed and validated config. */
export type Config = z.infer<typeof configSchema>;

/** Raw agent entry before defaults merging. */
export type AgentConfig = z.infer<typeof agentSchema>;

/** Top-level defaults section. */
export type DefaultsConfig = z.infer<typeof defaultsSchema>;

/**
 * Phase 88 MKT-02 — one raw marketplace source entry as it appears in
 * clawcode.yaml `defaults.marketplaceSources`. `path` is the yaml-native
 * string (possibly `~/...`); expansion happens in loader.ts via
 * `resolveMarketplaceSources`. `label` is the optional human-readable
 * caption shown in the Discord picker.
 */
export type MarketplaceSourceConfig = NonNullable<
  DefaultsConfig["marketplaceSources"]
>[number];
