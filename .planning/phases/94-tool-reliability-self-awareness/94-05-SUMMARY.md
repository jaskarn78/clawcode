---
phase: 94-tool-reliability-self-awareness
plan: 05
subsystem: manager
tags: [discord, auto-injected-tools, file-share, fetch-messages, di-pure, tool-call-error, security-boundary]

# Dependency graph
requires:
  - phase: 94-tool-reliability-self-awareness/04-tool-call-error
    provides: wrapMcpToolError + ToolCallError shape — both new tools wrap internal failures via this surface
  - phase: 94-tool-reliability-self-awareness/06-system-prompt-directives
    provides: file-sharing directive in default system prompt — agents are now TOLD to upload via Discord; this plan gives them the tool to do so
  - phase: 1.6-webhook-provisioning
    provides: per-agent webhook surface for in-character Discord uploads (sendViaWebhook DI primary path)
  - phase: 90.1-bot-direct-fallback
    provides: bot-direct upload surface (sendViaBot DI fallback when webhook fails / unavailable)
provides:
  - clawcode_fetch_discord_messages — auto-injected built-in tool; reads channel/thread message history; 100-msg max enforced; failures wrap via 94-04 ToolCallError
  - clawcode_share_file — auto-injected built-in tool; uploads agent-workspace file to current Discord channel; 25MB cap; allowedRoots security boundary; webhook→bot-direct fallback; returns CDN URL
  - DI-pure tool module pattern in src/manager/tools/ — first under that subdir; no fs/discord.js imports; production wires deps at daemon edge
  - CLAWCODE_FETCH_DISCORD_MESSAGES_DEF + CLAWCODE_SHARE_FILE_DEF — exported tool DEFs (no mcpServer attribution → 94-02 capability filter never removes them; built-in semantics)
affects:
  - daemon-edge-wiring — future plan wires production deps (discord.js fetch, webhook-manager.sendFile, fs.stat) onto these DI surfaces
  - 94-07-tools-display — both new tools join the /clawcode-tools display row; Plan 94-07 picks them up via the same auto-injection path

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DI-pure tool module — fs/discord.js imports forbidden; all I/O via injected deps. Static-grep regression pin: `! grep -E 'from \"node:fs|from \"discord\\.js\"' src/manager/tools/*.ts`. Mirrors Phase 94 Plan 04 tool-call-error.ts purity invariant."
    - "Built-in tool (no mcpServer attribution) — Plan 94-02 capability-probe filter sees no attribution and lets the tool through unconditionally. Built-in semantics distinct from MCP-backed tools (clawcode/browser/search/image MCPs are still capability-probed; these new helpers are not)."
    - "Path validation via isPathInsideRoots(absPath, allowedRoots) — pure resolve+startsWith check; refuses anything outside allowedRoots BEFORE any I/O. Returns ToolCallError(permission). Phase 90 fs-guard exact-equality pattern."
    - "Failure-path wrap via Plan 94-04 wrapMcpToolError — tools NEVER throw; LLM always receives ToolCallError shape on rejection (verbatim message preserved; errorClass classified)."
    - "Webhook → bot-direct fallback — primary call rejects → log warning → secondary call attempts → on second rejection, wrap via 94-04. SF-FALLBACK test pins both calls in order."
    - "Object.freeze on outputs (CLAUDE.md immutability) — frozen wrapper outputs + frozen attachments arrays (fetch tool); frozen success result (share tool)."

key-files:
  created:
    - src/manager/tools/clawcode-fetch-discord-messages.ts
    - src/manager/tools/clawcode-share-file.ts
    - src/manager/__tests__/clawcode-fetch-discord-messages.test.ts
    - src/manager/__tests__/clawcode-share-file.test.ts
  modified:
    - src/manager/session-config.ts

key-decisions:
  - "Tools have NO mcpServer attribution — built-in, not MCP-backed. Plan 94-02's filter never removes them from the LLM-visible tool list. Distinct from auto-injected MCP servers (clawcode/browser/search/image) which DO get capability-probed."
  - "Auto-injection happens in session-config.ts (toolDefinitionsStr) — tools are advertised in the stable-prefix tool block for EVERY agent regardless of mcpServers, skill assignment, or admin status. Single integration site; no per-agent opt-out."
  - "DI-pure modules — fs / discord.js / clock / logger imports FORBIDDEN at the tool layer. Production wires deps at the daemon edge (discord.js channels.fetch + webhook-manager.sendFile + fs.promises.stat). Tests stub via vi.fn(). Mirrors Plan 94-04 purity invariants."
  - "100-msg max clamp on fetch — Discord API caps at 100 per request; pagination via `before=<message_id>` is the API-compliant path for older history. input.limit=500 silently clamped (no error) so the LLM can request high-N without learning the cap."
  - "25MB hard cap on share — Discord free-tier upload limit. Higher caps require Nitro per-channel (outside bot control). Oversize → ToolCallError(unknown) with suggestion field carrying '25 MB' explainer."
  - "Path validation BEFORE stat — security gate paid on every call, no I/O cost paid for refused paths. /etc/passwd refused before fs touched. Returns ToolCallError(permission) with 'outside the agent workspace' verbatim message."
  - "Webhook → bot-direct fallback — webhook-manager (Phase 1.6) is primary; if it rejects (channel without webhook OR cloudflare 5xx), bot-direct (Phase 90.1) is secondary. Both calls in order on the failure path; on second rejection, wrap via 94-04."

patterns-established:
  - "src/manager/tools/ subdirectory — first home for built-in (non-MCP) auto-injected tools. Future tools (clawcode_search_memory, clawcode_attach_thread, etc) live alongside."
  - "Dual-path Discord I/O via DI — primary (webhook) + secondary (bot-direct) primitives are independent dep callables; tool body owns the order + the ToolCallError-on-second-failure semantics."
  - "Freeze-on-success / wrap-on-failure shape — every tool handler returns Output (frozen) | ToolCallError. Never throws. LLM sees structured failures and adapts naturally."

requirements-completed: [TOOL-08, TOOL-09]

# Metrics
duration: 6min
completed: 2026-04-25
---

# Phase 94 Plan 05: clawcode_fetch_discord_messages + clawcode_share_file Summary

**Two new auto-injected built-in tools — `clawcode_fetch_discord_messages` (D-08, channel/thread reader, 100-msg max) and `clawcode_share_file` (D-09, file uploader with 25MB cap + allowedRoots security boundary + webhook→bot-direct fallback). Both DI-pure; failures wrap via Plan 94-04 ToolCallError. Auto-injected for every agent in session-config.ts toolDefinitionsStr.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-25T05:50:22Z
- **Completed:** 2026-04-25T05:56:33Z
- **Tasks:** 2 (TDD: RED → GREEN)
- **Files created:** 4 (2 tool modules + 2 test files)
- **Files modified:** 1 (session-config.ts)

## Accomplishments

- **TOOL-08 wired.** `clawcode_fetch_discord_messages({channel_id, limit?=50, before?})` — auto-injected for every agent; closes the operator-reported context gap (2026-04-25 fin-acquisition screenshot) where the LLM had no way to read prior thread messages without manual paste. 100-msg API max enforced via clamp (input.limit=500 silently clamped); same `channel_id` field accepts both channel and thread snowflakes (Discord-treats-threads-as-channels). Returns `{messages: [{id, author, content, ts, attachments[]}]}` with frozen outputs.
- **TOOL-09 wired.** `clawcode_share_file({path, caption?})` — auto-injected for every agent; turns Plan 94-06's file-sharing directive from prose into action. Validates path inside allowedRoots BEFORE any I/O (security gate; refuses /etc/passwd-style escapes). Stat checks file existence + isFile + size. Discord 25MB cap enforced with ToolCallError(unknown) carrying a `25 MB` explainer suggestion. Webhook → bot-direct fallback (Phase 90.1) — webhook rejects once → log warning → bot-direct attempts → on second rejection, wrap via 94-04. Returns `{url, filename, sizeBytes}` (CDN URL for the user to click).
- **DI-purity preserved.** Both tool modules forbid fs / discord.js imports — verified by static-grep regression pin. Production wires deps at the daemon edge (discord.js client.channels.fetch + webhook-manager.sendFile + fs.promises.stat); tests stub via vi.fn(). Mirrors Plan 94-04 tool-call-error.ts purity invariants.
- **Built-in semantics (no mcpServer attribution).** Both tool DEFs lack mcpServer attribution → Plan 94-02 capability-probe filter sees them as built-in and never removes them from the LLM-visible tool list. Distinct from auto-injected MCP servers (clawcode/browser/search/image) which DO get probed.
- **Zero new npm deps; build clean; 63 tests pass** across the touched suites (11 new clawcode-* tests + 52 existing session-config tests unchanged).

## Task Commits

1. **Task 1: 11 failing tests (RED)** — `804c647` (test)
2. **Task 2: implement tools + auto-injection wiring (GREEN)** — `5a1c039` (feat)

## Files Created/Modified

### Created

- **`src/manager/tools/clawcode-fetch-discord-messages.ts`** — DI-pure module. Exports `clawcodeFetchDiscordMessages(input, deps)` async handler; `CLAWCODE_FETCH_DISCORD_MESSAGES_DEF` tool def (name + description + input_schema with channel_id required, limit min/max [1,100], before optional); `DiscordMessageOut` / `FetchDiscordMessagesInput` / `FetchDiscordMessagesOutput` / `FetchDiscordMessagesDeps` interfaces. Default limit 50, MAX_LIMIT 100 clamp via `Math.max(1, Math.min(MAX_LIMIT, requested))`. Failure wraps via `wrapMcpToolError`. Frozen output + frozen attachments arrays.
- **`src/manager/tools/clawcode-share-file.ts`** — DI-pure module. Exports `clawcodeShareFile(input, deps)` async handler; `CLAWCODE_SHARE_FILE_DEF` tool def; `DISCORD_FILE_SIZE_LIMIT = 25 * 1024 * 1024` constant; `isPathInsideRoots(absPath, allowedRoots)` pure path validator. Order: path validation → stat → isFile check → 25MB cap → currentChannelId resolved → webhook upload → on failure, bot-direct fallback → on second failure, wrap. Oversize error carries `suggestionFor` factory mentioning `25 MB`. node:path imports allowed (pure string ops, not I/O); fs and discord.js imports forbidden.
- **`src/manager/__tests__/clawcode-fetch-discord-messages.test.ts`** — 5 tests. FDM-HAPPY (deps stub returns 1 message → output.messages.length === 1), FDM-LIMIT-DEFAULT (no limit → fetchMessages called with limit=50), FDM-LIMIT-MAX (limit=500 → clamped to 100), FDM-THREAD-ID (thread snowflake accepted, fetchMessages called with the thread ID + limit=50), FDM-ERROR-WRAP (fetchMessages rejects "403 Missing Access" → ToolCallError errorClass="permission" + tool="clawcode_fetch_discord_messages").
- **`src/manager/__tests__/clawcode-share-file.test.ts`** — 6 tests. SF-HAPPY (1KB file + webhook resolves → CDN URL + filename + sizeBytes; webhook called once, bot-direct never), SF-OVERSIZE (26MB → ToolCallError errorClass="unknown" + suggestion mentions "25 MB"; webhook never called), SF-PATH-OUTSIDE (/etc/passwd outside allowedRoots → ToolCallError(permission) "outside"; stat + webhook never called — security gate paid before I/O), SF-FILE-NOT-FOUND (stat ENOENT → ToolCallError with verbatim ENOENT message), SF-FALLBACK (webhook rejects, bot-direct succeeds → success URL from bot-direct; both called in order ["webhook", "bot"]), SF-CAPTION (input.caption flows through verbatim to upload args).

### Modified

- **`src/manager/session-config.ts`** — Imported `CLAWCODE_FETCH_DISCORD_MESSAGES_DEF` + `CLAWCODE_SHARE_FILE_DEF`. Appended a "Built-in Discord helpers (auto-injected)" block to `toolDefinitionsStr` after the MCP block, before the Admin block. Block renders both tool names + descriptions verbatim so the LLM stable prefix advertises the helpers regardless of mcpServers / skills / admin status. Single integration site; no per-agent opt-out.

## Decisions Made

- **Tools have NO mcpServer attribution — built-in, not MCP-backed.** Plan 94-02's capability-probe filter sees no attribution and lets them through unconditionally. Distinct from auto-injected MCP servers (clawcode/browser/search/image) which DO get probed and may be filtered when degraded. Built-in helpers don't get probed because they have no separate process to fail.
- **Auto-injection happens in session-config.ts (toolDefinitionsStr).** Tools are advertised in the stable-prefix tool block for EVERY agent. Single integration site. The block renders verbatim tool names + descriptions so the LLM understands what to call. Per-agent opt-out is intentionally absent: these tools close two operator-reported context gaps (thread reading + file upload) and should be universally available.
- **DI-pure module pattern locked.** fs / discord.js / clock / logger imports FORBIDDEN at the tool module body. Production wires real implementations at the daemon edge — `deps.fetchMessages` → discord.js `client.channels.fetch(id).messages.fetch({limit, before})` mapped to DiscordMessageOut shape; `deps.stat` → `fs.promises.stat(path).then(s => ({size: s.size, isFile: s.isFile()}))`; `deps.sendViaWebhook` → webhook-manager.sendFile (Phase 1.6); `deps.sendViaBot` → bot-direct fallback (Phase 90.1). Static-grep regression pin: `! grep -E 'from "node:fs|from "discord\.js"' src/manager/tools/*.ts`.
- **100-msg max clamp on fetch is silent.** input.limit=500 is silently clamped to 100 — no error raised. Discord's API caps at 100 per request; pagination via `before=<message_id>` is the API-compliant path for deeper history. Silent clamp keeps the LLM from learning the cap; if it asks for 500 and gets 100, it figures out pagination from the response.
- **25MB hard cap on share — failure mode preserved.** Oversize → ToolCallError(unknown) carrying a suggestion field with the size + 25MB limit + "consider compressing or uploading to a different host" hint. errorClass=unknown chosen because the error is not transient/auth/quota/permission — it's an upload-policy ceiling. The LLM reads the suggestion and adapts naturally (offers to compress, suggests a different host).
- **Path validation BEFORE stat.** Security gate paid on every call. /etc/passwd is refused before fs is touched (no I/O cost paid for refused paths). isPathInsideRoots resolves each allowedRoot, checks `absPath === normRoot` OR `absPath.startsWith(normRoot + sep)`. Phase 90 fs-guard exact-equality pattern; relative paths are resolved against process.cwd via node:path.resolve before the check.
- **Webhook → bot-direct fallback semantics.** Webhook is primary (in-character agent voice). Bot-direct is fallback (admin-clawdy + untrusted channels lacking webhooks). On webhook rejection: log a warning (best-effort; logger errors swallowed), then attempt bot-direct. On second rejection: wrap via 94-04. SF-FALLBACK test pins both calls in order ["webhook", "bot"]. Some channels lack webhooks; bot-direct is the only path there. Skipping the fallback would break file-share for those channels.
- **No-LEAK in tool descriptions.** clawcode_share_file's description mentions "/home/clawcode/..." as a NEGATIVE example — the directive instructs agents NOT to surface those raw paths. The LLM reads "never tell the user a local path (e.g. /home/clawcode/...)" and learns the boundary. The path string itself is data the LLM was already going to hallucinate without this hint.

## Deviations from Plan

None. Plan executed exactly as written. RED gate (11 failing tests) confirmed before implementation; GREEN gate (11 passing tests + 63 in touched suites) confirmed after. All static-grep regression pins from `<acceptance_criteria>` and `<pitfalls>` sections pass:

- `grep -q "DISCORD_FILE_SIZE_LIMIT = 25 \* 1024 \* 1024" src/manager/tools/clawcode-share-file.ts` — 25MB pinned
- `grep -q "MAX_LIMIT = 100" src/manager/tools/clawcode-fetch-discord-messages.ts` — 100-msg max pinned
- `grep -q "isPathInsideRoots\|allowedRoots" src/manager/tools/clawcode-share-file.ts` — security boundary pinned
- `grep -q "wrapMcpToolError" src/manager/tools/{clawcode-fetch-discord-messages,clawcode-share-file}.ts` — 94-04 reuse pinned
- `! grep -E 'from "discord\.js"' src/manager/tools/*.ts` — DI-PURE (discord.js at daemon edge)
- `! grep -E 'from "node:fs"' src/manager/tools/clawcode-fetch-discord-messages.ts` — fetcher has no fs
- Auto-injection wired in `src/manager/session-config.ts` (CLAWCODE_FETCH_DISCORD_MESSAGES_DEF + CLAWCODE_SHARE_FILE_DEF imports + toolDefinitionsStr append)
- `git diff package.json` empty — zero new npm deps

## Issues Encountered

- TypeScript test narrowing: initial test file used `if ("kind" in result && result.kind === "ToolCallError")` which TS could not narrow to the success branch (the wrapper still typed `result` as the union). Replaced with `if ("kind" in result)` which TS narrows correctly because only ToolCallError carries the `kind` discriminator. Caught by `npx tsc --noEmit`; runtime tests passed both before and after the narrowing fix. No behavioral change.
- vi.fn() generic-typing for `mock.calls[0]` access: explicit `async (_id, _opts) => []` callback signature required to teach TS the call-arg shape. Without it, `callArgs?.[0]` returns undefined-typed and chained property access fails strict typecheck. Pattern: declare the callback signature inline at the vi.fn() factory site.

## Verification Results

- `npx vitest run src/manager/__tests__/clawcode-fetch-discord-messages.test.ts src/manager/__tests__/clawcode-share-file.test.ts --reporter=dot` — **11/11 passed**
- `npx vitest run src/manager/__tests__/clawcode-fetch-discord-messages.test.ts src/manager/__tests__/clawcode-share-file.test.ts src/manager/__tests__/session-config.test.ts --reporter=dot` — **63/63 passed** (zero regressions across session-config integration suite)
- `npm run build` exits 0; `dist/cli/index.js` 1.67 MB (no size delta vs Plan 94-04)
- `git diff package.json` empty — zero new npm deps
- `npx tsc --noEmit 2>&1 | grep -E "src/manager/tools|src/manager/__tests__/clawcode"` empty — no new TypeScript errors introduced
- All static-grep regression pins from `<acceptance_criteria>` pass (see Deviations from Plan above)

## Next Phase Readiness

- **Plan 94-07 (/clawcode-tools display):** can render both new tools in the per-agent tool table. They have NO mcpServer attribution — Plan 94-07 needs a "built-in" row category distinct from MCP-backed servers. Tool DEFs are exported (`CLAWCODE_FETCH_DISCORD_MESSAGES_DEF` + `CLAWCODE_SHARE_FILE_DEF`) so Plan 94-07 imports them directly to enumerate the built-in set.
- **Daemon edge wiring (follow-up):** Production deps need to be wired:
  - `clawcode_fetch_discord_messages.deps.fetchMessages` → `discord.js client.channels.fetch(id).messages.fetch({limit, before})` mapped to DiscordMessageOut shape (id, username from author, content, createdAt.toISOString, attachments.map({filename: name, url: url}))
  - `clawcode_share_file.deps.allowedRoots` → `[agent.workspacePath, agent.memoryPath].filter(Boolean)`
  - `clawcode_share_file.deps.sendViaWebhook` → webhook-manager.sendFile (Phase 1.6 — needs an `sendFile(channelId, {path, filename, caption})` method added if not yet present; current webhook-manager only has `send(text)` and `sendAsAgent(embed)` surfaces)
  - `clawcode_share_file.deps.sendViaBot` → bot-direct fallback (Phase 90.1 — analogous file-upload primitive)
  - `clawcode_share_file.deps.currentChannelId` → derived from current TurnDispatcher origin (turn-origin.ts:makeRootOrigin('discord', channelId))
  - `clawcode_share_file.deps.stat` → `fs.promises.stat(path).then(s => ({size: s.size, isFile: s.isFile()}))`
- **Integration with Plan 94-06 directive:** the file-sharing directive ("ALWAYS upload via Discord and return the CDN URL. NEVER just tell the user a local file path") is now actionable — agents read it in the system prompt and have `clawcode_share_file` available to fulfill it. End-to-end loop closed.
- **No blockers.** Tools shipped; auto-injection wired; tests green; build clean.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: src/manager/tools/clawcode-fetch-discord-messages.ts
- FOUND: src/manager/tools/clawcode-share-file.ts
- FOUND: src/manager/__tests__/clawcode-fetch-discord-messages.test.ts
- FOUND: src/manager/__tests__/clawcode-share-file.test.ts
- FOUND: src/manager/session-config.ts (modified — imports + toolDefinitionsStr block)

**Commits verified to exist:**
- FOUND: 804c647 (Task 1 — RED, 11 failing tests)
- FOUND: 5a1c039 (Task 2 — GREEN, implementation + auto-injection wiring)

---
*Phase: 94-tool-reliability-self-awareness*
*Plan: 05*
*Completed: 2026-04-25*
