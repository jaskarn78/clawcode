## Identity & Soul

At the start of every session, read `clawcode.yaml` in this directory and load the `identity` and `soul` fields for the `test-agent`. These define who you are:

- **Name**: Clawdy
- **Emoji**: 💠 (include in every response)
- **Vibe**: Competent, dry wit, never sycophantic
- **Soul**: Be genuinely helpful, have opinions, be resourceful before asking, earn trust through competence

Full soul and identity live in `clawcode.yaml` under `agents[name=test-agent]`. Read it. Be it.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**ClawCode**

A multi-agent orchestration system built natively on Claude Code that runs multiple persistent AI agents, each with their own identity, workspace, Discord channel, memory, and skills. It replaces OpenClaw's gateway architecture with direct Claude Code processes — no middleman, no bridge workarounds. Each agent is a full Claude Code session bound to a Discord channel, managed by a central agent manager.

**Core Value:** Persistent, intelligent AI agents that each maintain their own identity, memory, and workspace — communicating naturally through Discord channels without manual orchestration overhead.

### Constraints

- **Runtime**: Claude Code CLI sessions — each agent is a persistent Claude Code process
- **Discord**: Uses existing Claude Code Discord plugin for channel communication
- **Models**: Limited to Claude model family (sonnet, opus, haiku) via Claude Code's native model selection
- **Memory search**: Need to evaluate embedding providers for semantic search (could use Claude itself, or a lightweight local solution)
- **Concurrency**: Multiple Claude Code processes running simultaneously — need to manage system resources
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| TypeScript | 6.0.2 | Language | Type safety for complex agent configs, process lifecycle, and message routing. Non-negotiable for a system this interconnected. | HIGH |
| Node.js | 22 LTS | Runtime | LTS stability matters when managing 14+ persistent child processes. Bun is available on-box (1.3.11) but Node 22 LTS is the safer choice for long-running process management and better-sqlite3 native addon compatibility. | HIGH |
| @anthropic-ai/claude-agent-sdk | 0.2.x | Agent lifecycle | The official SDK for programmatically spawning and managing Claude Code sessions. Provides `spawn_claude_code_process`, session management, subagent definitions, and `forkSession`. This IS the orchestration primitive. | HIGH |
| better-sqlite3 | 12.8.0 | Database | Synchronous, single-threaded SQLite access. Perfect for per-agent memory stores. Proven pattern from OpenClaw. Works with sqlite-vec via `loadExtension()`. | HIGH |
| sqlite-vec | 0.1.9 | Vector search | Pure-C SQLite extension for KNN vector search. Successor to sqlite-vss (deprecated). No Faiss dependency. Loads directly into better-sqlite3. Supports float32/int8 vectors with SIMD acceleration. | MEDIUM |
| @huggingface/transformers | 4.0.1 | Local embeddings | Runs all-MiniLM-L6-v2 (384-dim) locally in Node.js via ONNX. Zero API keys, zero cost, zero network dependency. Good enough for memory semantic search at agent scale (~tens of thousands of entries). | MEDIUM |
| croner | 10.0.1 | Cron scheduling | TypeScript-native, handles DST/leap years, timezone-aware. Used by PM2 and Uptime Kuma. Cleaner API than node-cron with better error handling. | HIGH |
| execa | 9.6.1 | Process management | Wraps child_process with promises, template strings, graceful termination, and Windows support. Use for spawning and managing the `claude` CLI processes alongside the Agent SDK. | HIGH |
| zod | 4.3.6 | Config validation | Schema validation for agent configs, memory entries, cron definitions, and cross-agent messages. The standard for TypeScript runtime validation. | HIGH |
| discord.js | 14.26.2 | Discord (fallback) | NOT primary -- the existing Claude Code Discord plugin handles channel routing. discord.js is only needed if you need to do things the plugin cannot (e.g., programmatic channel creation, role management, admin commands). Keep as optional dependency. | MEDIUM |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | 4.x | File watching | Watch agent workspace directories for config changes, memory file updates, and SOUL.md modifications. Triggers hot-reload of agent configs. |
| pino | 9.x | Structured logging | Fast JSON logger. Each agent process gets its own log stream. Central manager aggregates. Pino's low overhead matters with 14+ concurrent agents. |
| nanoid | 5.x | ID generation | Lightweight, URL-safe unique IDs for messages, memory entries, and cross-agent communication. |
| date-fns | 4.x | Date handling | Memory timestamps, consolidation windows (daily/weekly/monthly), relevance decay calculations. Lighter than dayjs for tree-shaking. |
| glob | 11.x | File patterns | Agent workspace discovery, skill registry scanning, memory file enumeration. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| tsx | Run TypeScript directly | `npx tsx` for development. Faster iteration than `tsc` + `node`. |
| vitest | Testing | Fast, TypeScript-native, ESM-first. Test agent configs, memory consolidation, cron scheduling in isolation. |
| tsup | Bundling | Zero-config TypeScript bundler for production builds. ESM output. |
| @types/better-sqlite3 | Types | TypeScript definitions for better-sqlite3 |
## Installation
# Core
# Supporting
# Dev dependencies
## Architecture-Driving Decisions
### Claude Agent SDK IS the Orchestration Layer
- **`ClaudeAgent.create()`** -- programmatic agent spawning with model selection (sonnet/opus/haiku)
- **`agents` option** -- define subagents inline with description, prompt, tools, model override
- **`forkSession`** -- branch conversations without losing context
- **Session resumption** -- resume by session ID for persistent agents
- **Custom `spawn_claude_code_process`** -- full control over how the `claude` CLI gets invoked (cwd, env, signal)
- **`settingSources`** -- per-agent control over which config files to load
### Local Embeddings, Not API-Based
- Zero ongoing cost (14 agents * thousands of memory entries = real API spend otherwise)
- Zero network dependency (agents work offline)
- 384 dimensions is plenty for memory similarity (not building a search engine)
- Model downloads once (~23MB), runs in ~50ms per embedding
- sqlite-vec handles KNN search over 384-dim float32 vectors efficiently
### SQLite Per-Agent, Not Shared
- True isolation (agent crash doesn't corrupt another's memory)
- No WAL contention between 14+ concurrent writers
- Simple backup/restore per agent
- Matches the workspace isolation pattern from OpenClaw
### Node.js Over Bun for Production
- better-sqlite3 native addon is battle-tested on Node, quirky on Bun
- Claude Agent SDK is tested against Node.js
- Long-running process stability matters more than startup speed
- Node 22 LTS has support until April 2027
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| @anthropic-ai/claude-agent-sdk | Raw `child_process.spawn('claude', ...)` | Never for this project. The SDK exists specifically for this use case. Raw spawn loses session management, tool approval, and subagent support. |
| better-sqlite3 | bun:sqlite | If you migrate to Bun runtime entirely. bun:sqlite is 3-6x faster for reads but tied to Bun runtime. |
| better-sqlite3 | node:sqlite (Node 22 built-in) | Node's built-in SQLite is experimental (--experimental-vm-modules). Not ready for production. Revisit when it graduates. |
| sqlite-vec | sqlite-vss | Never. sqlite-vss is deprecated by its author in favor of sqlite-vec. sqlite-vss depends on Faiss which is a build nightmare. |
| @huggingface/transformers | Voyage AI API / OpenAI embeddings | If memory corpus grows beyond ~100K entries per agent and local embedding quality becomes a bottleneck. Unlikely for this use case. |
| @huggingface/transformers | @xenova/transformers | Never. @xenova/transformers is the old package name (v2). @huggingface/transformers v4.x is the current maintained fork. |
| croner | node-cron | If you want a simpler API and don't care about timezone handling. node-cron has 3M weekly downloads but lacks DST handling and TypeScript types. |
| execa | child_process (native) | If you want zero dependencies. execa adds graceful termination, promise-based API, and better error messages. Worth the 120KB. |
| pino | winston | Never for this use case. Winston's overhead per log line matters when 14+ agents are logging concurrently. Pino is 5x faster. |
| discord.js 14.x | discord.js 15.x | When v15 reaches stable. Currently 92% milestone completion, pre-release only. Stick with v14 for production. |
| zod 4.x | zod 3.x | No reason to use 3.x for a new project. Zod 4 has better performance and tree-shaking. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| LangChain / LangGraph | Massive abstraction layer that fights Claude Code's native agent model. You'd be wrapping an agent framework in another agent framework. | Claude Agent SDK directly |
| Redis / PostgreSQL | Overkill for per-agent memory. Adds operational complexity (running a DB server) for what SQLite handles perfectly at this scale. | better-sqlite3 per agent |
| BullMQ / Agenda | Job queue systems designed for distributed workloads. Cron scheduling here is per-agent, in-process. No queue needed. | croner (in-process) |
| PM2 | Process manager that would fight the Agent SDK's own process lifecycle. The SDK handles spawn/restart/signal. | Agent SDK + execa |
| Prisma / Drizzle ORM | ORM overhead for what are simple key-value and vector queries. Raw better-sqlite3 prepared statements are faster and clearer. | better-sqlite3 directly |
| @xenova/transformers | Deprecated package name. The project moved to @huggingface/transformers. | @huggingface/transformers 4.x |
| sqlite-vss | Deprecated. Depends on Faiss (C++ build nightmare). Author created sqlite-vec as replacement. | sqlite-vec |
| Embeddings APIs (Voyage, OpenAI, Cohere) | Adds cost, latency, and network dependency to every memory operation. Local embeddings are sufficient for this use case. | @huggingface/transformers locally |
## Stack Patterns by Variant
- Consider adding a dedicated memory compaction job that runs more aggressively
- sqlite-vec handles 100K+ vectors fine with brute-force KNN; no index needed below that
- If exceeding 100K, create a vec0 virtual table with IVF indexing
- Use Node.js IPC (process.send/process.on) between the manager and agent processes
- The Agent SDK supports inter-agent messaging natively via agent teams (experimental)
- Fallback: filesystem-based message queue (write JSON to agent's inbox directory, chokidar watches it)
- Add discord.js 14.x as a direct dependency for the admin agent only
- Register slash commands for /status, /restart-agent, /agent-logs
- Keep this separate from the plugin-based channel routing
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| better-sqlite3@12.8.0 | sqlite-vec@0.1.9 | Load via `db.loadExtension(sqliteVecPath)`. sqlite-vec npm package exports the path. |
| better-sqlite3@12.8.0 | Node.js 22 LTS | Requires node-gyp build. Pre-built binaries available via `prebuild-install`. |
| @huggingface/transformers@4.0.1 | Node.js 22 LTS | ONNX Runtime backend. First run downloads model (~23MB cached in `~/.cache/huggingface`). |
| @anthropic-ai/claude-agent-sdk@0.2.x | Node.js 22 LTS | SDK is pre-1.0. Expect breaking changes between minor versions. Pin exact version in package.json. |
| sqlite-vec@0.1.9 | better-sqlite3, bun:sqlite, node:sqlite | Multi-driver compatible. Use better-sqlite3 for Node.js. |
| croner@10.0.1 | Node.js 22, Bun, Deno | Runtime-agnostic. Pure JS, no native dependencies. |
| execa@9.6.1 | Node.js 22 LTS | ESM-only since v6. Project must use ESM (`"type": "module"` in package.json). |
## Key Risk: Claude Agent SDK Pre-1.0
## Sources
- [Claude Agent SDK TypeScript (GitHub)](https://github.com/anthropics/claude-agent-sdk-typescript) -- SDK source, changelog, API
- [Claude Agent SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Official docs
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) -- Experimental multi-agent coordination
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- --print flag, session management
- [sqlite-vec (GitHub)](https://github.com/asg017/sqlite-vec) -- Vector search extension, installation, API
- [sqlite-vec JS usage](https://alexgarcia.xyz/sqlite-vec/js.html) -- Node.js/Bun/Deno integration guide
- [better-sqlite3 (npm)](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0, synchronous SQLite
- [@huggingface/transformers](https://huggingface.co/docs/transformers.js) -- Local ONNX inference in Node.js
- [Croner](https://croner.56k.guru/) -- TypeScript cron scheduler docs
- [execa (GitHub)](https://github.com/sindresorhus/execa) -- Process execution library
- [Node-cron vs Croner comparison](https://www.pkgpulse.com/blog/node-cron-vs-node-schedule-vs-croner-task-scheduling-nodejs-2026) -- Scheduler comparison (2026)
- npm registry -- All version numbers verified via `npm view` on 2026-04-08
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
