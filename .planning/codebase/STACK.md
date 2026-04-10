# Technology Stack

**Analysis Date:** 2026-04-10

## Languages

**Primary:**
- TypeScript 6.0.2 - All source code in `src/`

**Secondary:**
- None (pure TypeScript project)

## Runtime

**Environment:**
- Node.js 22 LTS (target specified in `tsup.config.ts` as `node22`)
- ESM-only (`"type": "module"` in `package.json`)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)

## Frameworks

**Core:**
- None (no web framework — dashboard uses raw `node:http`)

**CLI:**
- commander 14.0.3 - CLI command parsing in `src/cli/index.ts`

**Testing:**
- vitest 4.1.3 - Test runner, config at `vitest.config.ts`

**Build/Dev:**
- tsup 8.5.1 - Bundles `src/cli/index.ts` → `dist/cli/`, config at `tsup.config.ts`
- tsx 4.21.0 - Runs TypeScript directly for development (`npm run dev`)
- TypeScript 6.0.2 - Compiler, config at `tsconfig.json`

## Key Dependencies

**Agent Orchestration:**
- `@anthropic-ai/claude-agent-sdk` ^0.2.97 - Spawns and manages Claude Code sessions. Used in `src/manager/session-adapter.ts` via `SdkSessionAdapter`. Pre-1.0, pin versions carefully.

**Database:**
- `better-sqlite3` ^12.8.0 - Synchronous SQLite for memory (`src/memory/store.ts`) and usage tracking (`src/usage/tracker.ts`). WAL mode enabled. Per-agent databases at `~/.clawcode/agents/{name}/memory.db`.
- `sqlite-vec` ^0.1.9 - SQLite vector search extension for KNN memory search. Loaded via `sqliteVec.load(db)` in `src/memory/store.ts`. Creates `vec_memories` virtual table with 384-dim float32 cosine vectors.

**Embeddings:**
- `@huggingface/transformers` ^4.0.1 - Local ONNX inference using `Xenova/all-MiniLM-L6-v2` (384 dimensions). Used in `src/memory/embedder.ts`. Model downloads once (~23MB) to `~/.cache/huggingface`.

**Discord:**
- `discord.js` ^14.26.2 - Discord gateway client. Used in `src/discord/bridge.ts` for message routing, thread management, reactions, and webhook delivery.

**MCP Protocol:**
- `@modelcontextprotocol/sdk` ^1.27.1 (resolved 1.29.0) - MCP server implementation in `src/mcp/server.ts`. ClawCode exposes itself as an MCP server for external tools.

**Scheduling:**
- `croner` ^10.0.1 - Cron job scheduling in `src/scheduler/scheduler.ts`. Timezone-aware, TypeScript-native.

**Config & Validation:**
- `zod` ^4.3.6 - Schema validation for `clawcode.yaml`. Full config schema in `src/config/schema.ts`. Uses `zod/v4` import path.
- `yaml` ^2.8.3 - Parses `clawcode.yaml` in `src/config/loader.ts`.

**Logging:**
- `pino` ^9 - Structured JSON logging. Shared instance in `src/shared/logger.ts`. Per-component child loggers via `logger.child({component})`.

**Utilities:**
- `nanoid` ^5.1.7 - URL-safe unique IDs for memory entries, session logs, usage events.
- `date-fns` ^4.1.0 - Date arithmetic for memory consolidation windows and usage aggregation. Used in `src/usage/tracker.ts`.
- `chokidar` ^5.0.0 - File watching for config hot-reload in `src/config/watcher.ts`.

## Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/better-sqlite3` | ^7.6.13 | TypeScript types for better-sqlite3 |
| `@types/node` | ^22 | Node.js type definitions |
| `tsup` | ^8.5.1 | Production bundler |
| `tsx` | ^4.21.0 | Dev TypeScript runner |
| `typescript` | ^6.0.2 | TypeScript compiler |
| `vitest` | ^4.1.3 | Test framework |

## Configuration

**TypeScript (`tsconfig.json`):**
- `target`: ES2022
- `module` / `moduleResolution`: NodeNext (required for ESM)
- `strict`: true
- `outDir`: `./dist`, `rootDir`: `./src`
- Source maps and declaration maps enabled

**Build (`tsup.config.ts`):**
- Entry: `src/cli/index.ts`
- Output: `dist/cli/` (ESM format)
- Target: node22
- Adds `#!/usr/bin/env node` shebang to output
- Sourcemap enabled, no code splitting

**Test (`vitest.config.ts`):**
- `globals: false` (import `describe`, `it`, `expect` explicitly)

**Agent Config (`clawcode.yaml`):**
- Root config file, loaded by `src/config/loader.ts`
- Schema defined in `src/config/schema.ts`
- Validated with Zod

**Environment Variables:**
- `CLAWCODE_LOG_LEVEL` - Pino log level (default: `info`), read in `src/shared/logger.ts`
- `CLAWCODE_DASHBOARD_PORT` - Dashboard HTTP port (default: 3100), read in `src/manager/daemon.ts`
- `DISCORD_BOT_TOKEN` - Fallback Discord token, read in `src/discord/bridge.ts` and `src/discord/debug-bridge.ts`

## Platform Requirements

**Development:**
- Node.js 22 LTS
- npm for package management
- `tsx` for running TypeScript directly (`npm run dev`)
- Native addon build tools (node-gyp) for `better-sqlite3`

**Production:**
- Node.js 22 LTS
- Deployed as npm binary: `clawcode` → `dist/cli/index.js`
- Agent workspaces at `~/.clawcode/agents/{agent-name}/`
- Skills at `~/.clawcode/skills/`
- HuggingFace model cache at `~/.cache/huggingface`

---

*Stack analysis: 2026-04-10*
