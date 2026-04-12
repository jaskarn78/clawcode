# Phase 49: RAG over documents - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Agents can ingest documents (text, markdown, PDF), chunk and embed them, then search over the chunks using semantic similarity. Three MCP tools: ingest_document, search_documents, delete_document. Reuses existing embedding infrastructure (sqlite-vec, @huggingface/transformers).

</domain>

<decisions>
## Implementation Decisions

### Document Ingestion
- Supported types: plain text (.txt, .md) and PDF
- Ingestion via MCP tool `ingest_document` (reads from agent workspace path) and Discord attachment upload
- Fixed-size chunks (~500 tokens) with overlap (~50 tokens)
- Per-agent SQLite with sqlite-vec — reuse existing embedding infrastructure

### Search & Retrieval
- MCP tool `search_documents` with query string, returns top-K chunks with source/page info
- Default 5 results, configurable via tool param (max 20)
- Return matched chunk plus 1 chunk of context on each side for coherence
- Optional `source` param filters to a specific document; omit for all-document search

### Storage & Lifecycle
- Separate `document_chunks` table — documents are not memories, different lifecycle and metadata
- MCP tool `delete_document` removes all chunks for a source; re-ingesting same path overwrites
- No hard per-agent limit — warn in logs when chunk count exceeds 10,000

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/store.ts` — MemoryStore with sqlite-vec loaded, embedding vectors
- `src/memory/embedder.ts` — EmbeddingService with @huggingface/transformers (384-dim)
- `src/mcp/server.ts` — MCP server for tool registration
- `src/manager/daemon.ts` — IPC handler registration
- `src/discord/attachments.ts` — Discord attachment download utilities

### Established Patterns
- sqlite-vec KNN search over 384-dim float32 vectors
- MCP tools delegate to IPC which routes to daemon handlers
- Per-agent databases in workspace directories
- Embedding via local ONNX model (~50ms per embedding)

### Integration Points
- New `document_chunks` table in per-agent SQLite (MemoryStore.db)
- New MCP tools registered in server.ts
- New IPC handlers in daemon.ts
- Chunker utility for text splitting

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches using existing embedding and storage patterns.

</specifics>

<deferred>
## Deferred Ideas

- Additional document types (docx, csv, html) — extend after initial text/PDF support
- Directory watching for auto-ingestion — add when needed
- Cross-agent document sharing — violates workspace isolation principle
- Hybrid search (keyword + semantic) — optimize later if needed

</deferred>
