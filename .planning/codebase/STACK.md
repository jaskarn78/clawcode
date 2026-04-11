# Technology Stack

**Analysis Date:** 2026-04-11

## Languages

**Primary:**
- TypeScript 6.0.2 - All source code in `src/`

**Secondary:**
- JavaScript - Dashboard static files in `src/dashboard/static/`
- CSS - Dashboard styling in `src/dashboard/static/styles.css`

## Runtime

**Environment:**
- Node.js 22.22.0 (LTS)

**Package Manager:**
- npm (package-lock.json present)
- Lockfile: present (`package-lock.json`)

## Module System

- ESM-only (`"type": "module"` in `package.json`)
- All imports use `.js` extension for NodeNext module resolution
- TypeScript target: ES2022 with NodeNext module resolution (`tsconfig.json`)

## Frameworks

**Core:**
- No HTTP framework — dashboard uses Node.js built-in `http` module directly (`src/dashboard/server.ts`)
- `commander` ^14.0.3 — CLI argument parsing (`src/cli/index.ts`)

**Agent Orchestration:**
- `@anthropic-ai/claude-agent-sdk` ^0.2.97 (pinned at 0.2.97 in lock) — Core agent lifecycle management, `query()` API, session resumption. Used in `src/manager/session-adapter.ts`.
- `@modelcontextprotocol/sdk` 1.29.0 (transitive via claude-agent-sdk) — MCP server implementation in `src/mcp/server.ts`

**Discord:**
- `discord.js` ^14.26.2 — Discord bot client, webhook delivery, slash commands. Used in `src/discord/bridge.ts`, `src/discord/webhook-manager.ts`, `src/discord/slash-commands.ts`.

**Database:**
- `better-sqlite3` ^12.8.0 — Synchronous SQLite. Used in `src/memory/store.ts`, `src/usage/tracker.ts`.
- `sqlite-vec` ^0.1.9 — Vector similarity search extension loaded into better-sqlite3 via `sqliteVec.load(db)`. Used in `src/memory/store.ts`.

**Embeddings:**
- `@huggingface/transformers` ^4.0.1 — Local ONNX inference for `Xenova/all-MiniLM-L6-v2` (384-dim). Model cached at `~/.cache/huggingface`. Used in `src/memory/embedder.ts`.

**Scheduling:**
- `croner` ^10.0.1 — In-process cron scheduler. Used in `src/scheduler/scheduler.ts`.

**Testing:**
- `vitest` ^4.1.3 — Test runner. Config in `vitest.config.ts`.

**Build/Dev:**
- `tsup` ^8.5.1 — TypeScript bundler, ESM output. Config in `tsup.config.ts`.
- `tsx` ^4.21.0 — Run TypeScript directly without build step.

## Key Dependencies

**Critical:**
- `@anthropic-ai/claude-agent-sdk` ^0.2.97 — Pre-1.0, breaking changes possible between minor versions. Pin exact version. Provides `query()`, session management, `permissionMode`, `settingSources`, `resume`.
- `better-sqlite3` ^12.8.0 — Requires native node-gyp build. Per-agent SQLite databases in `~/.clawcode/agents/<name>/memory.db` and `usage.db`.
- `discord.js` ^14.26.2 — Primary Discord integration layer.

**Infrastructure:**
- `zod` ^4.3.6 — Schema validation for all config, memory entries, and IPC messages. Uses `zod/v4` import path. Config schema in `src/config/schema.ts`.
- `pino` ^9 — Structured JSON logger. Singleton instance in `src/shared/logger.ts`, log level via `CLAWCODE_LOG_LEVEL` env var.
- `yaml` ^2.8.3 — Parses `clawcode.yaml` config file.
- `nanoid` ^5.1.7 — URL-safe unique IDs for memory entries, messages.
- `chokidar` ^5.0.0 — File watching for `clawcode.yaml` hot-reload. Used in `src/config/watcher.ts`.
- `date-fns` ^4.1.0 — Date arithmetic for memory consolidation windows, usage period calculations.
- `commander` ^14.0.3 — CLI command registration. Entry point `src/cli/index.ts`, built binary `dist/cli/index.js`.

## Configuration

**Environment:**
- `CLAWCODE_LOG_LEVEL` — Log level (default: `"info"`)
- `DISCORD_BOT_TOKEN` — Discord bot token (fallback; primary location is `~/.claude/channels/discord/.env`)
- No `.env` file in project root; secrets are stored externally

**Config File:**
- `clawcode.yaml` — Primary config file in project root. Defines all agents, defaults, and runtime settings. Validated by `src/config/schema.ts` via zod.

**Build:**
- `tsup.config.ts` — Entry `src/cli/index.ts`, output `dist/cli/`, ESM format, Node.js 22 target, shebang banner.
- `tsconfig.json` — Strict mode, NodeNext modules, output `dist/`, source maps, declaration files.
- `vitest.config.ts` — Minimal config, no globals.

## Directories

- `src/` — All TypeScript source
- `dist/` — Build output (gitignored)
- `node_modules/` — Dependencies

## Platform Requirements

**Development:**
- Node.js 22 LTS
- npm (for package management)
- `tsx` for direct TypeScript execution: `npm run dev`

**Production:**
- Node.js 22 LTS
- Built binary: `npm run build` → `dist/cli/index.js`
- Native addon: `better-sqlite3` requires node-gyp build (pre-built binaries via prebuild-install)
- First run: `@huggingface/transformers` downloads ~23MB model to `~/.cache/huggingface`
- Runtime data: `~/.clawcode/agents/` for agent workspaces and databases

---

*Stack analysis: 2026-04-11*
