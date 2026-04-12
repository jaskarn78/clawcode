---
phase: 49-rag-over-documents
plan: 02
subsystem: mcp
tags: [rag, mcp, ipc, document-search, chunking, embeddings]

requires:
  - phase: 49-01
    provides: DocumentStore, chunker, document types

provides:
  - Four MCP tools for document RAG (ingest, search, delete, list)
  - Four IPC handlers routing document operations through daemon
  - Per-agent DocumentStore lifecycle in SessionManager

affects: [agent-tools, mcp-server, daemon-ipc]

tech-stack:
  added: []
  patterns: [MCP-to-IPC document tool delegation, shared SQLite DB between MemoryStore and DocumentStore]

key-files:
  created: []
  modified:
    - src/mcp/server.ts
    - src/manager/daemon.ts
    - src/manager/session-manager.ts
    - src/manager/session-memory.ts

key-decisions:
  - "DocumentStore shares per-agent SQLite DB via store.getDatabase() -- no separate DB file"
  - "search_documents formats results with similarity scores and context chunks for readability"

patterns-established:
  - "Document tool IPC pattern: MCP tool -> sendIpcRequest -> daemon case -> DocumentStore method"

requirements-completed: [RAG-INGEST, RAG-SEARCH, RAG-DELETE]

duration: 150s
completed: 2026-04-12
---

# Phase 49 Plan 02: MCP Tools and IPC Handlers for Document RAG Summary

**Four MCP tools (ingest_document, search_documents, delete_document, list_documents) wired through IPC to per-agent DocumentStore with PDF/text detection and formatted search results**

## Performance

- **Duration:** 150s
- **Started:** 2026-04-12T03:15:04Z
- **Completed:** 2026-04-12T03:17:34Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Per-agent DocumentStore created alongside MemoryStore, sharing the same SQLite database
- Four IPC handlers in daemon.ts for ingest, search, delete, and list operations
- Four MCP tool registrations with proper error handling and formatted output
- search_documents returns similarity-ranked results with adjacent chunk context

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-agent DocumentStore in SessionManager and IPC handlers** - `382ee58` (feat)
2. **Task 2: MCP tool registrations for document RAG** - `b142083` (feat)

## Files Created/Modified
- `src/manager/session-memory.ts` - Added DocumentStore map, creation in initMemory, cleanup in cleanupMemory
- `src/manager/session-manager.ts` - Added getDocumentStore accessor, DocumentStore type import
- `src/manager/daemon.ts` - Added four IPC cases (ingest-document, search-documents, delete-document, list-documents) with chunker and readFile imports
- `src/mcp/server.ts` - Added four TOOL_DEFINITIONS entries and four server.tool registrations

## Decisions Made
- DocumentStore shares the per-agent memory SQLite DB via `store.getDatabase()` rather than creating a separate database file -- keeps document chunks co-located with memory for simpler backup/restore
- search_documents formats results with similarity scores and context chunks in plain text rather than JSON -- more readable for agents consuming the output

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Document RAG pipeline is fully wired: agents can ingest files, search across documents, delete sources, and list what's ingested
- All operations route through the established MCP -> IPC -> daemon pattern
- Ready for end-to-end testing with actual agent sessions

---
*Phase: 49-rag-over-documents*
*Completed: 2026-04-12*
