# Phase 94: Tool Reliability & Self-Awareness - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Operator-locked decisions captured inline (driven by live production bug — see screenshot evidence in conversation history)

<domain>
## Phase Boundary

Eliminate the class of bugs where agents confidently advertise capabilities (tools, MCP-backed features) that fail at execution time. Concrete production trigger (2026-04-25 fin-acquisition channel screenshot): user asked for a screenshot, bot said "Yep — I have a `browser` tool", user gave URL, bot then said "Playwright's Chrome isn't installed and Browserless MCP errored out". The LLM read its system prompt, trusted the tool list verbatim, and made a promise the runtime couldn't keep.

**Phase 94's goal:** make every tool an agent advertises actually-callable RIGHT NOW. Probe each MCP server's capability on boot + every heartbeat tick. Filter the LLM-visible tool list down to currently-healthy tools. Auto-recover known failure patterns (Playwright Chromium missing, op:// stale, etc). Add cross-cutting helpers — Discord thread fetch + file-share-via-CDN — so every agent has consistent UX for two operator-reported gaps.

**NOT in scope:** capability-probing built-in tools (Read/Write/Bash trusted to work), cross-agent permission delegation (subagent borrowing another agent's MCPs), replacing the SDK's tool-execution path, LLM hallucination prevention beyond filtering tool list.

</domain>

<decisions>
## Implementation Decisions

### D-01: Capability probe = synthetic representative call (not connect-test)
The Phase 85 connect-test verifies the MCP server *process* is up. That's not enough. A capability probe runs an actual representative tool call:
- `browser` MCP → `browser_snapshot(url="about:blank")`
- `playwright` MCP → first `browser_install({channel:"chromium"})` if missing, then `browser_navigate(url="about:blank")`
- `1password` MCP → `vaults_list()` (read-only, cheap)
- `finmentum-db` / `finmentum-content` MCP → `SELECT 1` against the configured DB
- `finnhub` MCP → `quote(symbol="AAPL")` (cheap, free-tier-safe)
- `brave-search` MCP → `search(query="test", limit=1)`
- `google-workspace` MCP → list-OAuth-scopes
- `fal-ai` MCP → list-models
- `browserless` MCP → `health` endpoint
- Auto-injected `clawcode` / `browser` / `search` / `image` MCPs — server-specific quick health calls

If the connect succeeds but the capability call returns an error, mark `degraded` (not just `failed`). This is the key distinction — `degraded` = we know about the failure mode + can describe it to the LLM/operator; `failed` = we don't even have a process up.

### D-02: New status enum: `ready | degraded | reconnecting | failed | unknown`
Extends Phase 85's CheckStatus vocabulary. Each MCP server's `McpServerSnapshot` gains a `capabilityProbe: { lastRunAt, status, error?, lastSuccessAt? }` block. Persisted in the same map Phase 85 uses (`SessionHandle.getMcpState()`).

### D-03: Probe schedule
- **On agent boot**: probe runs in parallel for all configured MCP servers; warm-path waits for probe completion (with 10s timeout per server) before declaring agent ready
- **Heartbeat tick (60s default)**: re-probe all servers; update snapshot
- **On-demand**: `clawcode mcp-probe -a <agent>` CLI for operator manual trigger

### D-04: Dynamic tool advertising via stable-prefix re-render
System-prompt builder (Phase 85's `assemblePrompt`) reads `mcpStateProvider` and FILTERS the tool list before rendering. Stable prefix contains ONLY tools whose `capabilityProbe.status === 'ready'`. The mutable suffix continues to show the full live status table (so operators reading /clawcode-tools see the truth even when the LLM doesn't see the tool).

**Consequence:** when Playwright is degraded, the LLM doesn't see `browser` in its tool list at all → can't promise screenshots. When auto-recovery succeeds, next turn's prompt re-renders with `browser` re-included.

**Cache stability:** changes to filtered tool list cause stable-prefix hash to change, breaking Anthropic prompt cache. Acceptable — degraded state is rare; recovery re-stabilizes the prefix.

### D-05: Auto-recovery patterns (3 wired by default)
1. **Playwright Chromium missing** — error matches `/Executable doesn't exist at .*ms-playwright/` → run `npx playwright install chromium --with-deps` in subprocess (timeout 120s) → re-probe → if pass, mark ready
2. **op:// reference auth-error** — error matches `/op://.*not authorized|service account/` → re-resolve via `op read` → swap env → re-spawn MCP subprocess → re-probe
3. **>5min degraded with no auto-recovery match** — force-restart the MCP subprocess (clean kill + respawn). Last-resort try.

Recovery actions: max 3 attempts per server per hour. Bounded. Each attempt logged + admin-clawdy alert on 3rd failure. Pattern is extensible — `RecoveryHandler` interface so future patterns plug in without core changes.

### D-06: Honest ToolCallError schema
When a tool that PASSED capability probe still fails mid-turn (transient network, quota, race), the executor wraps the failure in a `ToolCallError` shape returned to the LLM:
```ts
type ToolCallError = {
  tool: string;
  errorClass: 'transient' | 'auth' | 'quota' | 'permission' | 'unknown';
  message: string;  // verbatim from MCP — Phase 85 verbatim-error pattern
  suggestion?: string;  // e.g. "this tool is currently degraded — try alternative X"
  alternatives?: readonly string[];  // healthy tools that could substitute
};
```
LLM receives this in the tool-result slot — adapts naturally. No silent retries.

### D-07: Cross-agent tool routing (suggestion-only, not auto-routing)
When user asks fin-tax for browser work but fin-tax has no `playwright` configured AND `fin-acquisition` does AND fin-acquisition's `playwright` is `ready`, the system prompt directive instructs the agent to surface: "I don't have browser available here; ask Clawdy in #fin-acquisition or #general — those have a working browser tool." 

Auto-spawning a one-shot subagent across-agent boundaries is OUT OF SCOPE for v2.6 (too invasive). First pass: text suggestion only. The mutable-suffix tool table includes a "Healthy Alternatives" line listing other agents' channels with the missing tool ready.

### D-08: Discord thread-message fetcher (NEW per operator request 2026-04-25)
Every agent gets `clawcode_fetch_discord_messages` auto-injected (alongside existing `clawcode`/`browser`/`search`/`image`). Spec:
- Tool: `clawcode_fetch_discord_messages`
- Params: `{channel_id: string, limit?: number=50, before?: string}`
- Returns: `{messages: [{id, author, content, ts, attachments[]}]}`
- Discord treats threads as channels with parent IDs — same param works for both
- Wired through `plugin:discord:fetch_messages` SDK surface (already available — Phase 1.1 webhook auto-provisioning era)
- Permission gated: only fetches from channels the bot has read access to (Discord enforces server-side; we just propagate the error)

### D-09: File-sharing-via-Discord-URL (NEW per operator request 2026-04-25)
Two-pronged:
1. **System-prompt directive** in new `defaults.systemPromptDirectives` config field, default ON: "When you produce a file the user wants to access, ALWAYS upload via Discord (the channel/thread you're answering in) and return the CDN URL. NEVER just tell the user a local file path they can't reach (e.g., '/home/clawcode/...'). If unsure where to send it, ask which channel."
2. **Helper tool** `clawcode_share_file({path, caption?})` — uploads to current channel via webhook (Phase 1.6 auto-provisioned webhooks) or bot-direct (Phase 90.1 fallback), returns the Discord CDN URL. Agent doesn't have to remember to hand-roll the upload — the tool just works.

### D-10: defaults.systemPromptDirectives — new config field
```yaml
defaults:
  systemPromptDirectives:
    file-sharing:
      enabled: true
      text: "When you produce a file the user wants to access, ALWAYS upload via Discord and return the CDN URL. Never tell the user a local file path they can't reach."
    cross-agent-routing:
      enabled: true
      text: "If a user asks you to do something requiring a tool you don't have, check your tool list. If unavailable, suggest the user ask another agent (mention specific channel/agent name) that has the tool ready."
```
Per-agent override allowed (`agents.*.systemPromptDirectives`). Schema-validated. Empty/missing = no directives prepended (backward compatible).

### D-11: /clawcode-tools surface upgrade
Existing `/clawcode-tools` Discord slash + `clawcode mcp-status` CLI both gain a "Capability Probe" column with:
- Status (✅ ready | 🟡 degraded | 🔴 failed | ⏳ reconnecting)
- Last successful probe timestamp (ISO + relative)
- Recovery suggestion when degraded (e.g., "auto-recovery: `playwright install chromium`")
- "What would happen if I called X" preview line

EmbedBuilder column-cap: max 25 lines per Discord embed; paginate via select-menu when N > 25 servers.

### D-12: Cache-stability mitigation for hot-flapping servers
If a server flaps `ready ↔ degraded ↔ ready` within 5 minutes, the prompt builder treats it as `degraded` for cache stability (don't yo-yo the prefix hash). Configurable threshold; default 5min stability window. Logs the flap.

### Claude's Discretion

- **Probe execution model:** parallel via `Promise.all` with per-server timeout (10s); failures don't block other probes
- **Probe registry shape:** `Map<mcpServerName, () => Promise<ProbeResult>>` — pure functions registered at MCP server module load time
- **Recovery handler interface:** `interface RecoveryHandler { matches(error: string): boolean; recover(serverName: string, deps: RecoveryDeps): Promise<RecoveryOutcome>; }` — discriminated-union outcome (recovered | retry-later | give-up | not-applicable)
- **Test stub vs production split:** all probe + recovery primitives accept a `deps` object (clock, logger, execFile, fetch) so tests stub everything; production wires real implementations
- **Static-grep regression pin:** every system-prompt rendering site MUST go through `filterToolsByCapabilityProbe(tools, snapshot)` — a single-source-of-truth filter; CI grep ensures no direct `tools` array reaches the prompt assembler bypassing the filter
- **Degraded server alternatives lookup:** `findAlternativeAgents(toolName, mcpStateProvider)` — pure function returning agents whose snapshot has the tool ready; reads SessionManager's per-agent snapshots
- **Discord thread fetch tool registration:** auto-inject in the same place where `clawcode`/`browser`/`search`/`image` are auto-injected (Phase 85 era code in `src/manager/agent-bootstrap.ts` likely)
- **share_file tool path resolution:** accepts absolute path within agent's workspace OR memoryPath; refuses paths outside (security boundary); validates file exists + size <25MB (Discord limit)
- **/clawcode-tools probe display refresh:** reads from the same `mcpStateProvider` the prompt builder uses — single source of truth
- **Phase 92 verifier integration:** the steady-state capability probe REPLACES the cutover-time synthetic probe in Phase 92's verifier (verifier reads `capabilityProbe` from snapshot instead of running its own); reduces duplication

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (zero new npm deps preserved)
- **`src/heartbeat/checks/mcp-reconnect.ts`** (Phase 85) — current reconnect heartbeat check; extend with capability probe instead of just connect-test
- **`src/manager/daemon.ts` `list-mcp-status` IPC handler** — already returns per-server snapshot; extend payload with `capabilityProbe` field
- **`src/discord/slash-commands.ts`** — `/clawcode-tools` inline-short-circuit (Phase 85 Plan 03); extend renderer with capability probe column
- **`src/cli/commands/mcp-status.ts`** — CLI counterpart to /clawcode-tools; mirror upgrade
- **`src/manager/agent-bootstrap.ts`** — auto-injection point for `clawcode`/`browser`/`search`/`image` MCPs; extend with `clawcode_fetch_discord_messages` + `clawcode_share_file`
- **`src/discord/webhook-manager.ts`** (Phase 1.6 + 90.1) — webhook send + bot-direct fallback; reused by `clawcode_share_file` tool implementation
- **`src/config/schema.ts`** — agentSchema + defaultsSchema; extend with `systemPromptDirectives` block
- **TurnDispatcher.dispatch** — for any LLM-driven recovery decision (not used for D-05 patterns; kept simple imperative)
- **`node:child_process.execFile`** — for Playwright install + op:// re-resolution recovery (matches Phase 91 `defaultRsyncRunner` pattern)

### Established Patterns
- **Phase 83/86/89/90/92 additive-optional schema blueprint** — extending agentSchema with `systemPromptDirectives?` is the 8th application of this pattern; v2.5 migrated configs parse unchanged
- **Pure-fn IPC handlers** — Phase 86's `handleSetModelIpc` pattern; new `handleMcpProbeIpc` follows same shape
- **Discriminated-union outcomes** — Phase 84/86/88/90/92 SkillInstallOutcome, ModelUpdateOutcome, etc.; new `RecoveryOutcome` follows
- **Stable-prefix mutable-suffix prompt assembly** — Phase 85 Plan 02; extend with capability filter
- **Atomic temp+rename for state files** — Phase 83 effort-state.json, Phase 91 sync-state.json; new `mcp-probe-state.jsonl` (or extend existing snapshot)
- **Auto-recovery bounded retry** — Phase 91 sync-runner's 3-attempt budget per cycle; same idiom

### Integration Points
- `src/heartbeat/runner.ts` — capability-probe added as a heartbeat check
- `src/agents/session-handle.ts` — McpServerSnapshot type extended with capabilityProbe
- `src/prompt/assembler.ts` — `filterToolsByCapabilityProbe` step before tool-list rendering
- `src/manager/agent-bootstrap.ts` — auto-inject `clawcode_fetch_discord_messages` + `clawcode_share_file`
- `src/config/schema.ts` — `defaults.systemPromptDirectives` + per-agent override
- `src/cli/commands/mcp-status.ts`, `src/discord/slash-commands.ts` — display upgrades

</code_context>

<specifics>
## Specific Ideas

- **Reproducer for the original bug:** kill `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`, restart fin-acquisition, ask `take a screenshot of about:blank` — pre-Phase-94 behavior was confident "Yep, sec" then "Playwright not installed" failure; post-Phase-94 the LLM never sees `browser` until auto-recovery succeeds (within ~120s typically — install takes time)
- **Auto-recovery test data:** known Playwright error message — `"Executable doesn't exist at /home/clawcode/.cache/ms-playwright/chromium-1187/chrome-linux/chrome\nLooks like Playwright Test or Playwright was just installed or updated.\nPlease run the following command to download new browsers:\n\nnpx playwright install"` — regex match: `/Executable doesn't exist at.*ms-playwright/`
- **Discord thread test channel:** any thread already created in fin-acquisition's channels; the screenshot showed a thread reference — operator can pick a real thread for end-to-end test
- **File-share test:** image-gen tool (`fal-ai` MCP) produces a PNG to `~clawcode/.clawcode/agents/finmentum/output.png` — agent should auto-call `clawcode_share_file` and return CDN URL instead of telling user the local path
- **Cross-agent suggestion test:** `/clawcode-status` in fin-tax channel; ask "take a screenshot" — agent should respond "I don't have browser; ask in #fin-acquisition" (since fin-acquisition has playwright wired + ready)
- **Capability probe state file:** `~/.clawcode/manager/mcp-probe-state.jsonl` (append-only ledger; one row per probe; rotated daily) — for operator inspection + post-incident analysis
- **Probe timeout:** 10s per server (Phase 85's TOOL-04 verbatim error pattern propagates if the server itself times out responding to the probe)

</specifics>

<deferred>
## Deferred Ideas

- Cross-agent permission delegation (subagent borrows another agent's MCPs) — too invasive; revisit in v2.7+
- LLM-side tool-name hallucination prevention beyond filtering — trust LLM to use only listed tools
- Per-tool granular probing (probe each EXPOSED tool, not just one representative call per server) — diminishing returns; representative call is enough signal
- Probe-result caching across boots (skip probe if last successful was <5min ago and config hasn't changed) — premature optimization; revisit if probe overhead becomes meaningful
- Auto-update PR generation when a recovery pattern fires repeatedly across multiple agents (signal that the underlying issue should be fixed at the config/infrastructure layer, not just per-agent recovery) — Phase 96+ if pattern emerges
- Replacing the Discord plugin's fetch_messages with a lower-overhead direct API call — current SDK surface is fine

</deferred>
