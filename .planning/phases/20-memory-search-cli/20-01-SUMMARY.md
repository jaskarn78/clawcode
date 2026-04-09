---
phase: 20-memory-search-cli
plan: 01
subsystem: cli, ipc, memory
tags: [cli, memory, search, ipc]

provides:
  - IPC memory-search method (semantic search via embeddings)
  - IPC memory-list method (recent memories listing)
  - CLI clawcode memory search <agent> <query> with --top-k
  - CLI clawcode memory list <agent> with --limit
  - Formatted table output with relevance scores
affects: [agent-memory-visibility, debugging]

key-files:
  created:
    - src/cli/commands/memory.ts
    - src/cli/commands/memory.test.ts
  modified:
    - src/ipc/protocol.ts
    - src/manager/daemon.ts
    - src/cli/index.ts

key-decisions:
  - "memory-search uses agent's running memory store and shared embedder for real-time semantic search"
  - "memory-list returns recent memories sorted by access time"
  - "Results formatted as table with rank, score, content preview, source, tier, and date"

duration: 3min
completed: 2026-04-09
---

# Phase 20 Plan 01: Memory Search CLI Summary

**Memory search and list CLI commands with IPC integration**

## Accomplishments
- IPC memory-search method delegates to SemanticSearch with live embedder
- IPC memory-list method returns recent entries from agent's MemoryStore
- CLI `clawcode memory search <agent> <query>` with --top-k flag
- CLI `clawcode memory list <agent>` with --limit flag
- Formatted table output with truncated content, scores, and metadata
- 5 passing tests covering formatters and edge cases

---
*Phase: 20-memory-search-cli*
*Completed: 2026-04-09*
