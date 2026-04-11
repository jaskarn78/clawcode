# Codebase Concerns

**Analysis Date:** 2026-04-11

## Tech Debt

**EscalationMonitor initialized before DiscordBridge:**
- Issue: `EscalationMonitor` is constructed at line 208 of `daemon.ts` with `alertCallback: discordBridge` — but `discordBridge` is not assigned until line 428. The alert callback closure captures the variable at construction time when it is still `null`. Budget alerts from escalation are silently dropped.
- Files: `src/manager/daemon.ts` lines 207–232 and 428–450
- Impact: Budget threshold Discord alerts never fire even when properly configured
- Fix approach: Move `EscalationMonitor` construction to after `discordBridge` is initialized, or pass `discordBridge` as a ref object `{ current: DiscordBridge | null }`

**Phase 26 TODO — context zone transitions not delivered to Discord:**
- Issue: Zone transition notifications are explicitly stubbed out with a comment: `// TODO: Wire to Discord delivery queue (Phase 26) when available.` The notification only logs at info level.
- Files: `src/manager/daemon.ts` line 269
- Impact: Agents receive no Discord notification when context zone changes (yellow/red zones). Operators have no real-time visibility.
- Fix approach: Route zone transition messages through `deliveryQueue.enqueue()` using the agent's first channel ID from `routingTableRef.current`

**Thread attachment downloads use hardcoded /tmp path:**
- Issue: Thread message attachments are downloaded to the literal `/tmp/thread-attachments` directory instead of the agent's workspace. This directory is never cleaned up by the `attachment-cleanup` heartbeat check (which looks in `{workspace}/attachments`).
- Files: `src/discord/bridge.ts` line 271
- Impact: Attachment files accumulate in `/tmp/thread-attachments` indefinitely; cleanup check misses them entirely
- Fix approach: Resolve thread attachment directory from the agent's workspace (look up agent from thread registry) or use a consistent temp path that the cleanup check covers

**Escalation error detection heuristic is brittle:**
- Issue: The `send-message` IPC handler uses a hardcoded list of lowercase substrings (`"i can't"`, `"i'm unable"`, `"i don't have the capability"`, `"tool_use_error"`, `"error executing"`) to decide if a response is an error. False positives are likely for conversational responses that legitimately contain these phrases.
- Files: `src/manager/daemon.ts` lines 724–730
- Impact: May escalate valid agent responses unnecessarily, wasting budget
- Fix approach: Treat this as a structured signal from the agent (a special prefix or JSON field) rather than substring matching on natural language

**Token estimation in escalation is rough:**
- Issue: After successful escalation, token usage is estimated as `Math.ceil((message.length + response.length) / 4)`. This approximation can be off by 2-3x for non-English content or code-heavy messages.
- Files: `src/manager/escalation.ts` lines 133–135
- Impact: Budget tracking for escalation model usage is inaccurate; agents may exhaust or never exhaust budgets at wrong thresholds
- Fix approach: Capture actual token counts from the `usageCallback` when the fork session records usage

**Scheduler uses `as any` to tag cron jobs with schedule names:**
- Issue: `(job as any)._scheduleName = schedule.name` and `(j as any)._scheduleName` are used to correlate cron jobs back to schedule names for `nextRun` tracking. This is a duck-typing workaround that bypasses TypeScript entirely.
- Files: `src/scheduler/scheduler.ts` lines 111 and 124
- Impact: Any croner API change silently breaks `nextRun` reporting without a compile error
- Fix approach: Maintain a parallel `Map<Cron, string>` mapping job instances to schedule names instead of monkey-patching the job object

**EmbeddingService passes `normalize: "true"` as string coerced to boolean:**
- Issue: `normalize: "true" as unknown as boolean` is passed to the HuggingFace transformers pipeline. This is a type lie — a string `"true"` is passed where a boolean is expected. The correct value is the boolean `true`.
- Files: `src/memory/embedder.ts` line 51
- Impact: Embeddings may not be normalized correctly depending on whether the pipeline coerces the string. If it does a strict boolean check, normalization is silently skipped, causing degraded similarity scores.
- Fix approach: Change to `normalize: true` (boolean literal) and remove the type cast

**`startDaemon` return type is a single giant inline type:**
- Issue: The return type of `startDaemon()` is an inline object type spanning one line (~200 chars) with 15+ fields. This is unreadable and unmaintainable.
- Files: `src/manager/daemon.ts` lines 137–141, 566
- Impact: Future callers cannot easily read what `startDaemon` returns; adding fields is error-prone
- Fix approach: Extract a `DaemonHandle` type in `daemon.ts` or `types.ts`

**Fallback `null as unknown as` in `startDaemon` return:**
- Issue: When the dashboard server fails to start, the return value uses `null as unknown as ReturnType<typeof import("node:http").createServer>` and `null as unknown as import("../dashboard/sse.js").SseManager`. If any caller accesses `.server` or `.sseManager` on the returned object, it will get a runtime null dereference.
- Files: `src/manager/daemon.ts` line 566
- Impact: Dashboard-related code paths that assume non-null server/sseManager will crash
- Fix approach: Use a proper `DashboardHandle | null` type and require callers to null-check

**Model pricing is hardcoded and stale-able:**
- Issue: `MODEL_PRICING` maps short names (`haiku`, `sonnet`, `opus`) to USD prices. Prices are manually updated and the SDK reports full model IDs (e.g., `claude-sonnet-4-5`), not short names. If a new model version ships, lookups return `0` (no cost tracked).
- Files: `src/usage/pricing.ts`
- Impact: Cost tracking silently returns `$0` for any model name that doesn't exactly match the three hardcoded keys
- Fix approach: Add prefix-matching logic (`model.includes("haiku")` etc.) and add a unit test asserting that a known SDK model ID resolves to non-zero pricing

## Known Bugs

**Attachment cleanup mismatched directory:**
- Symptoms: `attachment-cleanup` heartbeat check scans `{workspace}/attachments` but `DiscordBridge.handleMessage()` downloads to `{workspace}/inbox/attachments` (for channel messages) and `/tmp/thread-attachments` (for thread messages).
- Files: `src/heartbeat/checks/attachment-cleanup.ts` line 24; `src/discord/bridge.ts` lines 271, 338–339
- Trigger: Thread message with attachment is processed; cleanup check runs
- Workaround: None currently. Thread attachment temp files accumulate forever.

**`recentlySent` dedup set is unbounded:**
- Symptoms: Discord response deduplication tracks response content hashes in `recentlySent: Set<string>`. Items are removed after 5 seconds via `setTimeout`. Under high message volume, the set can grow large before items expire.
- Files: `src/discord/bridge.ts` lines 97, 499–504
- Trigger: High-throughput Discord channels with rapid responses
- Workaround: Low severity in practice; 5s TTL limits set size to `messages_per_5s` items

**Budget alert sends zero tokensUsed/tokenLimit:**
- Symptoms: When `alertCallback` is invoked, `tokensUsed: 0, tokenLimit: 0` are hardcoded in the `sendBudgetAlert` call. The resulting Discord embed always shows `0 / 0 (80%)` or `0 / 0 (100%)`.
- Files: `src/manager/daemon.ts` lines 222–228
- Trigger: Any escalation budget threshold crossed
- Workaround: None; the embed displays misleading data

## Security Considerations

**All agent sessions run with `permissionMode: "bypassPermissions"`:**
- Risk: Every agent Claude session runs with full tool-use bypass — no approval gates for any tool call including shell execution, file writes, and network access.
- Files: `src/manager/session-adapter.ts` lines 190 and 214
- Current mitigation: `AllowlistMatcher` and `ApprovalLog` exist for channel-level ACLs but do not gate individual tool calls within the agent session
- Recommendations: Consider `"acceptEdits"` for non-admin agents, or implement the tool approval flow before enabling multi-agent production deployments. The current setup means a prompt injection in Discord could execute arbitrary shell commands.

**Discord bot token loaded from readable plaintext file:**
- Risk: `loadBotToken()` reads from `~/.claude/channels/discord/.env` using `readFileSync`. The file path is well-known and any process running as the user has read access.
- Files: `src/discord/bridge.ts` lines 51–78
- Current mitigation: 1Password CLI resolution via `op://` references is supported in `daemon.ts` but only for the `clawcode.yaml` `discord.botToken` field — the fallback in `bridge.ts` still reads plaintext
- Recommendations: Deprecate `loadBotToken()` and always require the token via the `BridgeConfig.botToken` parameter which uses the 1Password-aware path in `daemon.ts`

**Dashboard HTTP server has no authentication:**
- Risk: The dashboard server listens on `127.0.0.1:3100` with no authentication. Any local process can call `POST /api/agents/:name/start|stop|restart` to control all agents.
- Files: `src/dashboard/server.ts` line 95
- Current mitigation: Bound to localhost only
- Recommendations: Add a shared-secret header check (e.g., `X-Dashboard-Token`) before accepting control API requests

**IPC socket has no authentication:**
- Risk: The Unix domain socket at `~/.clawcode/manager/clawcode.sock` accepts all connections from processes owned by the user. Any local process can issue arbitrary IPC commands including `set-model`, `allow-always`, and `update-security`.
- Files: `src/ipc/server.ts`; `src/manager/daemon.ts` line 68
- Current mitigation: File-system permissions (user-owned socket)
- Recommendations: Acceptable for single-user local deployment; document this as an explicit trust boundary

**`update-security` IPC method writes arbitrary content to agent SECURITY.md:**
- Risk: The `update-security` handler writes the `content` parameter (a raw string from the IPC caller) directly to `{workspace}/SECURITY.md` without sanitization.
- Files: `src/manager/daemon.ts` lines 1014–1025
- Current mitigation: Only IPC callers (local processes) can invoke this
- Recommendations: Validate that content is valid SECURITY.md ACL syntax before writing; reject malformed payloads

## Performance Bottlenecks

**Embedding model warm-up blocks on first memory operation:**
- Problem: `EmbeddingService.warmup()` is called at daemon startup via `session-memory.ts`, but if startup is fast, the ONNX model download (~23MB first run) hasn't completed before the first `memory-search` or `ask-advisor` IPC call arrives.
- Files: `src/memory/embedder.ts`; `src/manager/session-memory.ts` line 191
- Cause: `warmup()` is fire-and-forget at startup; `embed()` re-awaits it but the promise isn't shared if warmup fails and retries
- Improvement path: Await warmup in daemon startup before accepting IPC requests, or track warm status in daemon health endpoint

**Registry file written on every agent status change:**
- Problem: `readRegistry` + `writeRegistry` is called on nearly every operation: `startAgent`, `stopAgent`, `restartAgent`, `reconcileRegistry`, and crash handler. All 14 agents starting concurrently cause 28+ sequential file writes.
- Files: `src/manager/registry.ts`; `src/manager/session-manager.ts`; `src/manager/session-recovery.ts`
- Cause: No write batching or debouncing; each state change is immediately persisted
- Improvement path: Debounce registry writes with a 100ms delay; batch all concurrent startup writes into one flush

**Each IPC `send-message` with a running agent embeds the query twice:**
- Problem: The `send-message` handler calls `manager.sendToAgent()` first, then (if escalation triggers) calls `escalationMonitor.escalate()` which forks another session. The fork session startup also initializes memory and embedding context.
- Files: `src/manager/daemon.ts` lines 718–746
- Cause: Escalation forking path does a full session start (workspace scan, SOUL.md read, hot tier refresh)
- Improvement path: Pre-compute fork configs at startup so fork session creation is incremental

## Fragile Areas

**`startDaemon` function is 1240 lines and orchestrates all subsystems:**
- Files: `src/manager/daemon.ts`
- Why fragile: All subsystem dependencies are initialized in a single linear sequence with many implicit ordering constraints (e.g., `discordBridge` must exist before `escalationMonitor` alertCallback — but this ordering is currently wrong). Testing requires instantiating nearly the entire stack.
- Safe modification: Extract subsystem initialization into named functions with explicit dependency parameters. Add integration test that asserts all subsystems start in correct order.
- Test coverage: `src/manager/__tests__/daemon.test.ts` exists but tests are limited to structural checks; the alertCallback wiring bug has no test.

**Heartbeat checks are auto-discovered from filesystem at runtime:**
- Files: `src/heartbeat/discovery.ts`; `src/heartbeat/runner.ts`
- Why fragile: Check modules are loaded via dynamic `import()` from a directory scan of `src/heartbeat/checks/`. A typo in a check file causes silent `return []` from discovery (the check is simply skipped), with no warning unless the log is examined.
- Safe modification: Add a test that enumerates expected check names and asserts they all load successfully
- Test coverage: `src/heartbeat/__tests__/discovery.test.ts` exists but uses mocked filesystem — doesn't test actual check files

**`AsyncQueue` used only as dead code (unused import):**
- Files: `src/shared/async-queue.ts`
- Why fragile: This file was added (appears in git status as untracked) but is not imported anywhere in the production codebase. It was likely scaffolded for a `streamInput()` SDK approach that was abandoned in favor of per-turn `query()` calls.
- Safe modification: Either wire it into a real use case or delete it to avoid confusion
- Test coverage: None

**Config hot-reload `configWatcher` can silently fail to detect changes:**
- Files: `src/config/watcher.ts`
- Why fragile: Uses `chokidar` (or equivalent) file watching. On Linux, `inotify` watch limits (`/proc/sys/fs/inotify/max_user_watches`) can cause silent watch failures. No check verifies the watcher is active after startup.
- Safe modification: Add a `watcher.isWatching()` health check to the heartbeat system
- Test coverage: `src/config/__tests__/watcher.test.ts` uses timer-based polling in tests, not actual file events

## Scaling Limits

**Single-instance IPC socket limits horizontal scaling:**
- Current capacity: One daemon process with one Unix socket
- Limit: All 14+ agents share a single `SessionManager`; a daemon crash stops all agents simultaneously
- Scaling path: Not applicable for current architecture; document that agent isolation requires separate daemon instances per agent group

**SQLite per-agent isolation is correct but DB files accumulate:**
- Current capacity: Each running agent has: `agent.db` (memory), `delivery-queue.db`, `escalation-budget.db`, `advisor-budget.db`
- Limit: With 14 agents, 56+ SQLite files in `~/.clawcode/manager/`. No cleanup policy for stopped/removed agents.
- Scaling path: Add a `clawcode prune` command that removes DB files for agents no longer in config

## Dependencies at Risk

**`@anthropic-ai/claude-agent-sdk` is pre-1.0:**
- Risk: SDK is pinned at `0.2.x`. Breaking API changes between minor versions are expected. `sdk-types.ts` has a local type shim (`SdkModule`, `SdkQueryOptions`) that must be manually updated when the SDK changes.
- Impact: `SdkSessionAdapter` could silently break if the SDK's `query()` return type or message shapes change
- Migration plan: Pin exact version in `package.json` (not range). Add a canary test that sends a real query and asserts a `result` message is received.

**`@huggingface/transformers` model ID is the deprecated Xenova namespace:**
- Risk: The model is loaded as `"Xenova/all-MiniLM-L6-v2"` in `embedder.ts`. The Xenova organization on HuggingFace Hub was the old package maintainer; new models are under different org names. The model itself still works but future ONNX models may require different identifiers.
- Impact: Low immediate risk; high if the model is removed from HuggingFace Hub
- Migration plan: Document that model ID may need updating; consider pinning model revision hash

## Missing Critical Features

**No agent-level resource limits:**
- Problem: Individual agents have no CPU/memory/time limits on their Claude sessions. A runaway agent (e.g., one in an infinite tool-use loop) can consume unbounded API tokens and system resources.
- Blocks: Safe production deployment with multiple agents

**No health endpoint for embedding service:**
- Problem: The embedding model warm-up status is tracked in `EmbeddingService` but not exposed via the health IPC command or heartbeat system. If the model fails to warm up, subsequent `memory-search` and `ask-advisor` calls fail with `EmbeddingError` with no observable health signal.
- Blocks: Operator visibility into memory subsystem health

**Context zone notifications are a stub:**
- Problem: The `notificationCallback` in `HeartbeatRunner` only logs; it does not deliver zone change alerts to Discord. This was the intended behavior (Phase 26) but was never implemented.
- Files: `src/manager/daemon.ts` line 269; `src/heartbeat/runner.ts`
- Blocks: Agents receiving automated context-health warnings in their Discord channels

## Test Coverage Gaps

**`startDaemon` alertCallback wiring is untested:**
- What's not tested: The `EscalationMonitor` alertCallback is constructed with `discordBridge` before `discordBridge` is assigned. No test verifies that budget alerts actually fire and reach Discord.
- Files: `src/manager/daemon.ts` lines 207–232; `src/manager/__tests__/daemon.test.ts`
- Risk: Silent alert delivery failure in production
- Priority: High

**Thread attachment download path is untested:**
- What's not tested: The `/tmp/thread-attachments` download path in thread message handling. Only the channel (non-thread) attachment path has tests.
- Files: `src/discord/bridge.ts` line 271; `src/discord/__tests__/bridge-attachments.test.ts`
- Risk: Thread attachment files leak and are never cleaned up
- Priority: Medium

**`SdkSessionAdapter` has no integration tests:**
- What's not tested: The real SDK adapter (`SdkSessionAdapter`) is never tested — all tests use `MockSessionAdapter`. SDK shape changes would not be caught before deployment.
- Files: `src/manager/session-adapter.ts`; `src/manager/__tests__/session-manager.test.ts`
- Risk: SDK upgrade breaks production silently
- Priority: High

**`debug-bridge.ts` is production source with `console.log`:**
- What's not tested: `src/discord/debug-bridge.ts` is a debug script committed to `src/discord/` with 8+ `console.log` calls and a hardcoded channel ID `"1491623782807244880"`. It is not referenced by any import but is compiled as part of the build.
- Files: `src/discord/debug-bridge.ts`
- Risk: Hardcoded channel ID leaks internal Discord structure; file could be accidentally imported
- Priority: Low (move to `scripts/` or delete)

---

*Concerns audit: 2026-04-11*
