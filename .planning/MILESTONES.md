# Milestones: ClawCode

## Completed Milestones

### v1.0 — Core Multi-Agent System (2026-04-08 to 2026-04-09)

**Status:** Complete
**Phases:** 5 | **Plans:** 11 | **Tests:** 210 | **Commits:** 85

**What shipped:**
1. **Central YAML config system** — Zod validation, defaults merging, per-agent overrides
2. **Agent lifecycle management** — Start/stop/restart, crash recovery with exponential backoff, PID registry, Unix socket IPC
3. **Discord channel routing** — Channel-to-agent binding, token bucket rate limiter (50 req/s + per-channel), native plugin integration
4. **Per-agent memory system** — SQLite + sqlite-vec, local embeddings (all-MiniLM-L6-v2), semantic search, daily session logs, auto-compaction
5. **Extensible heartbeat framework** — Directory-based check discovery, context fill monitoring, NDJSON logging

**Key decisions:**
- Agents are Claude Code SDK sessions, not separate OS processes
- Manager is deterministic TypeScript, not AI
- Discord routing via native plugin (system prompt channel binding), not separate bridge
- Memory uses local embeddings (zero cost, offline-capable)

**Archive:** [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) | [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md)

---
*Last updated: 2026-04-09*
