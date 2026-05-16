# Phase 101: Robust document-ingestion pipeline — 2026 RAG engine upgrade — Research

**Researched:** 2026-05-16
**Domain:** Document ingestion + retrieval + reranking for financial-document RAG
**Confidence:** HIGH on baseline (verified in code), HIGH on Tier 1 stack (verified packages + local tools), MEDIUM on reranker (depends on ONNX availability at runtime), MEDIUM on benchmarks (vendor-reported numbers cross-checked but not re-run).

---

## Summary

ClawCode's existing RAG (Phase 49 `vec_document_chunks` + Phase 90 hybrid-RRF on `memory_chunks` + Phase 113 vision pre-pass + Phase 115 bge-small int8) is **already a competent 2025-era stack** — operator's Pon tax return failure on 2026-04-28 was an **ingestion-path gap**, not a retrieval-quality gap. There is no text-PDF/scanned-PDF/xlsx/docx type detection, no OCR fallback, no structured extraction, and no page-batching aware of Claude's 2000px many-image dimension limit. The single highest-leverage upgrade is **closing the ingestion path** with a typed dispatcher + Tesseract OCR fallback + Claude-vision-per-page fallback + structured extraction + an `ingest_document(path, hint, extract)` MCP tool. Hybrid-RRF for the document store + a local bge-reranker cross-encoder are Tier 2 quality wins for **the same compute envelope** (both run via the embedder's existing `@huggingface/transformers` ONNX runtime). ColPali, learned fusion, alternative vector stores, and HyDE are **researched and deferred** — sqlite-vec brute-force is fine to ~100K chunks, and ClawCode is nowhere near that.

**Primary recommendation:** Build Phase 101 in 4 sequenced plans: (1) type-detect + handlers + page-batched OCR fallback, (2) structured extraction with zod schemas, (3) `ingest_document` MCP tool + auto-link to Phase 90 memory pipeline, (4) hybrid-RRF + local bge-reranker on DocumentStore. Pon UAT is the acceptance gate.

---

## User Constraints

No CONTEXT.md exists for Phase 101 yet (this phase is pre-discuss). Constraints are extracted from CLAUDE.md and the operator directive (2026-05-16 "blazing fast performance"):

### Locked Decisions (from CLAUDE.md + roadmap)
- **Runtime:** Node.js 22 LTS, TypeScript 6.0.2, ESM, `"type": "module"`
- **Database:** better-sqlite3 12.8.0 + sqlite-vec 0.1.9 per-agent (one DB per agent — no shared writers)
- **Embeddings:** `@huggingface/transformers` 4.2.0 local ONNX — no API embedding dependency
- **Image preprocessing:** `sharp` already in stack (used by Phase 113 vision pre-pass)
- **PDF text:** `pdf-parse` 2.4.5 already in stack
- **Config validation:** zod 4.3.6 (per project convention)
- **Cost concern:** Anthropic API credits are operator's primary cost lever — local-first preferred
- **Deploy host:** clawdy (Tailscale 100.98.211.108); `/opt/clawcode` via systemd; build-deploy via `scripts/deploy-clawdy.sh`. **Tesseract NOT installed on clawdy** (verified via SSH probe 2026-05-16) — install is a deploy-side prereq.

### Claude's Discretion (in this phase)
- OCR backend choice (Tesseract CLI vs Tesseract.js WASM vs Claude vision)
- Hybrid-RRF wiring for DocumentStore (mirror Phase 90 vs cross-ingest into memory_chunks vs both)
- Whether reranker lands in Phase 101 or splits to a follow-up
- Structured-extraction prompt strategy (Sonnet vs Haiku, single-pass vs multi-pass)

### Deferred Ideas (OUT OF SCOPE — researched and rejected/postponed)
- **ColPali / ColQwen2 visual late-interaction** — overkill at ClawCode scale, ONNX support patchy, requires multi-vector storage rework. Re-open if corpus exceeds 10K visual-only docs/agent. [CITED: huggingface.co/blog/manu/colpali]
- **Alternative vector stores (LanceDB / Qdrant / Chroma)** — sqlite-vec brute-force handles ~1M 128-dim or ~100K 384-dim vectors fine. Migration trigger: latency p95 > 200ms on `vec_document_chunks` search OR corpus > 100K chunks/agent. [CITED: github.com/asg017/sqlite-vec/issues/25]
- **HyDE / query rewriting via Haiku** — adds 1 LLM hop per query for marginal gain on financial Q&A. Defer to v3.2 unless retrieval-quality regression evidence demands it.
- **Learned fusion (monoT5 / Cohere rerank-3 API)** — local bge-reranker-v2-m3 cross-encoder covers the same value at zero API cost.
- **Mistral OCR 3** — vendor benchmark wins on tables (96.6%) but adds API dependency. Available as **Tier 4 escape hatch** for financial-form precision regressions; not the default. [CITED: mistral.ai/news/mistral-ocr]

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| File type detection | Daemon (Node) | — | Pure filesystem inspection — no LLM needed. `file-type` magic-byte sniff + pdf-parse text-layer probe. |
| Text-layer PDF extract | Daemon (Node) | — | `pdf-parse` / `unpdf` in-process. No external service. |
| OCR for scanned PDFs | Daemon → local CLI (Tesseract) | API (Claude vision per-page) | Fast path local, fallback API for failure modes (low confidence / financial-form precision). |
| Office docs (docx/xlsx) | Daemon (Node) | — | `mammoth` / `exceljs` in-process — no LLM needed for raw text. |
| Page batching + dimension control | Daemon (Node) | — | `sharp` resize to ≤2000px **before** vision send (Phase 113 pattern, stricter ceiling for batches). |
| Structured extraction | API (Claude Sonnet/Haiku) | — | Schema-guided JSON via tool-use mode — Anthropic's recommended pattern for typed extraction. |
| Chunking | Daemon (Node) | — | Pure text op. |
| Embedding | Daemon (ONNX in-process) | — | `@huggingface/transformers` ONNX — no API. |
| Vector store | Daemon (sqlite-vec) | — | Per-agent SQLite isolation. |
| BM25 (FTS5) | Daemon (SQLite FTS5) | — | Already present on `memory_chunks_fts`; mirror for documents. |
| Reranking | Daemon (ONNX in-process) | — | Local cross-encoder — same ONNX runtime as embedder. |
| Memory pipeline integration | Daemon | — | Cross-ingest extracted text into `memory_chunks` so Phase 90 RRF surfaces it pre-turn. |

**Critical correction:** the prior CLAUDE.md / roadmap framing has document storage as a peer of memory storage; the **right model is "documents are a write-through to memory"** — Phase 49 has its own `vec_document_chunks` but Phase 90's RRF retrieval ONLY reads `memory_chunks` + `vec_memory_chunks` + `memory_chunks_fts`. Section 4 (Recommended Upgrades) treats this as the load-bearing architectural decision.

---

## Phase Requirements

(Phase 101 requirements will be locked in CONTEXT.md after discuss-phase. The candidates below are derived from ROADMAP §Phase 101 sub-scope 1-8 and refined here.)

| Candidate ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | File type detection + handler dispatch (text-PDF / scanned-PDF / xlsx / docx / image) | §2.1 — `file-type` 22.0.1 + pdftotext probe |
| SC-2 | OCR fallback for scanned PDFs (Tesseract primary, Claude vision fallback) | §2.1 — Tesseract 5.3.4 on dev, install required on clawdy |
| SC-3 | Page-batching with dimension control (`sharp` resize ≤2000px before vision send) | §2.1 — verified Claude 2000px many-image ceiling |
| SC-4 | Structured extraction via zod-validated schemas (`ExtractedTaxReturn`, etc.) | §2.4 — Anthropic tool-use JSON mode |
| SC-5 | New MCP tool `ingest_document(path, taskHint?, extract?)` | §1 + §6 — wraps Phase 49 IPC + adds structured path |
| SC-6 | Auto-feed extracted text into `memory_chunks` + `vec_memory_chunks` so Phase 90 RRF picks it up | §4 — the load-bearing arch decision |
| SC-7 | Fail-mode taxonomy + admin-clawdy alerts on ingestion failures | §1 — wired to trigger-engine like Phase 127 stall events |
| SC-8 | Pon tax-return UAT regression — operator-curated truth values | §6 — acceptance gate |
| SC-9 (new) | Hybrid-RRF + BM25 (FTS5) on DocumentStore | §2.5 — mirrors Phase 90 pattern on `vec_document_chunks` |
| SC-10 (new) | Local cross-encoder reranker (bge-reranker-v2-m3 ONNX) for top-K precision | §2.6 — verified Xenova/bge-reranker-base ONNX available |

---

## 1. Current ClawCode RAG Baseline

### Phase 49 RAG infrastructure (verified in code)
- **`src/documents/store.ts`** — `DocumentStore` over `document_chunks` (id, source, chunk_index, content, start_char, end_char, created_at) + `vec_document_chunks` USING vec0(chunk_id TEXT PK, embedding float[384] distance_metric=cosine) [VERIFIED: src/documents/store.ts:213-217]
- **`src/documents/chunker.ts`** — `chunkText(text, targetTokens=500, overlapTokens=50)` word-count heuristic (1 token ≈ 0.75 words) + `chunkPdf(buffer)` via `pdf-parse` [VERIFIED: src/documents/chunker.ts:75-88]
- **IPC `ingest-document`** in `src/manager/daemon.ts:10989-11016` — reads file, branches on `.pdf` extension, chunks, embeds via `manager.getEmbedder()`, calls `docStore.ingest(source, chunks, embeddings)` [VERIFIED: src/manager/daemon.ts:10989]
- **IPC `search-documents`** in `src/manager/daemon.ts:11018-11044` — embeds query, calls `docStore.search(embedding, limit, source?)` which does **pure KNN — no hybrid, no FTS, no rerank** [VERIFIED: src/documents/store.ts:242-258]

### Phase 90 hybrid-RRF retrieval (verified in code)
- **`src/memory/memory-retrieval.ts`** — fuses `vec_memory_chunks` cosine top-20 + `memory_chunks_fts` BM25 top-20 via Reciprocal Rank Fusion with k=60 (Cormack/Clarke canonical) + path-derived score_weight (vault +0.2, procedures +0.1, archive −0.2) [VERIFIED: src/memory/memory-retrieval.ts:54-90]
- **Scope:** operates on `memory_chunks` ONLY (MEMORY.md sections + agent's own saved memories). `document_chunks` is **not currently fused** into this surface.

### Phase 113 vision pre-pass (verified in roadmap)
- Local resize via `sharp` to ≤1568px longest side (Anthropic vision sweet spot) before Claude send. Cuts upload bandwidth + token cost 30-60%.
- Parallel Haiku 4.5 vision pre-pass on Discord image attachments produces `<screenshot-analysis>` text block; main agent skips vision by default. ~40-60% latency drop, ~50-70% token cost drop on screenshot-heavy turns. [CITED: ROADMAP.md:1152-1174]

### Phase 115 embedding-v2 (verified in code)
- **State machine** at `src/memory/migrations/embedding-v2.ts`: `idle → dual-write → re-embedding → re-embed-complete → cutover → v1-dropped`, with `rolled-back` as universal escape [VERIFIED: src/memory/migrations/embedding-v2.ts:26-33]
- **v1:** `Xenova/all-MiniLM-L6-v2` (384-dim float32, MTEB ~56) — STILL the default that `EmbeddingService.embed(text)` resolves to [VERIFIED: src/memory/embedder.ts:121-123]
- **v2:** `BAAI/bge-small-en-v1.5` + scalar int8 quantization (384-dim int8, ~+5-7 MTEB-point recall, ~78% storage reduction) — wired via `embedV2()` / `embedV2Float32()` but **only called when migration phase ≥ dual-write** [VERIFIED: src/memory/embedder.ts:160-176]
- **Status as of 2026-05-16:** I cannot tell from a static read whether ANY agent has flipped past `idle`. The dispatcher pattern preserves bit-identical v1 for all 7 legacy callers (compaction, consolidation, conversation-search, episode-store, memory-scanner, session-summarizer, tier-manager). [VERIFIED: src/memory/embedder.ts:115-123]

### Performance characteristics today
- **Ingestion:** synchronous loop in daemon (`for (const chunk of chunks) embed`). ~50ms/chunk for MiniLM on M-series. A 100-chunk doc takes ~5s embedding time — acceptable but not parallelized. [ASSUMED — order-of-magnitude only; no measurement instrumented]
- **Retrieval (documents):** sqlite-vec brute-force KNN over per-agent vector count. With <10K chunks/agent (operator's likely current scale), p50 should be <50ms. No hybrid or rerank cost added.
- **Retrieval (memory, Phase 90):** vec + FTS + RRF fusion + token-budget trim ≤2000 tokens. Not instrumented in code.
- **Corpus size today:** unknown without a SQLite probe on the live `fin-acquisition` DB; per CLAUDE.md memory model, "tens of thousands of entries" is the design target — operator is well below saturation.

### Critical baseline gaps (Pon failure mode root causes)
1. **No file-type detection.** `daemon.ts:11000` branches on `.pdf` extension only. Image / xlsx / docx all fall through to `chunkText(buffer.toString("utf-8"))` which produces garbage.
2. **No OCR fallback.** When `pdf-parse` returns empty/whitespace text (scanned PDF), there is no second-chance handler. This is the 2026-04-28 Pon failure mode.
3. **No page-batching for vision.** Subagent rendered pages manually via PyMuPDF then sent them all to Claude → "image dimension limit for many-image requests" (Anthropic stricter 2000px-per-image ceiling when >20 images per request). [CITED: github.com/anthropics/claude-code/issues/49537]
4. **No structured extraction.** Operator's downstream consumers want `ExtractedTaxReturn.box1Wages`, not 50KB of OCR text.
5. **DocumentStore is search-only-via-cosine.** No BM25, no RRF, no rerank. Account numbers / form-field names (where lexical match wins) are under-served.
6. **Documents don't auto-feed Phase 90 memory pipeline.** Once ingested into `vec_document_chunks`, the next turn's pre-turn RRF retrieval doesn't see them.
7. **No fail-mode taxonomy.** When OCR returns 12% confidence garbage, the agent silently uses it. No structured failure to operator.

### Critical Findings (post-advisor review 2026-05-16)

These were surfaced by reviewer call after the initial draft; they are blocking inputs to Plan 01 scope and to U6 implementation.

**CF-1 (BLOCKING for U6): Phase 90 time-window filter will silently expire document chunks.**
`src/memory/memory-chunks.ts:166-175` defines `applyTimeWindowFilter` — chunks survive the filter iff `c.path` includes `/memory/vault/` OR `/memory/procedures/` OR `file_mtime_ms >= now - days*86_400_000` (default 14 days per Phase 90 D-24). Document-derived chunks written under a `path: "document:pon-2024-1040"` convention would fall out of Phase 90 RRF retrieval **14 days after ingestion**. This silently defeats SC-6 and breaks the operator's "agent should know about Pon's tax return next month" expectation.

**Resolution (locked in Plan 03 scope):** Extend `applyTimeWindowFilter` allow-list to also exempt paths matching prefix `document:`. One-line code change (`if (c.path.startsWith("document:")) return true;`) in `src/memory/memory-chunks.ts`. Add regression test (`document:*` chunks survive 365-day filter). The alternative — stamping `file_mtime_ms` forward on every retrieval — is fragile and pollutes the time-decay signal for genuinely-old MEMORY.md chunks. The path-prefix allow-list mirrors the proven vault/procedures pattern exactly. [VERIFIED: src/memory/memory-chunks.ts:166-175]

**CF-2 (BLOCKING for Plan 01): `daemon.ts:11011` hardcodes v1 MiniLM embeddings.**
The current `ingest-document` IPC calls `embedder.embed(chunk.content)` which `src/memory/embedder.ts:121-123` resolves to `embedV1()` (MiniLM, Float32Array). Even after Phase 115 cutover ships, this call site stays on v1. The `vec_document_chunks` schema is also pinned to `float[384]` (not `int8[384]`).

**Resolution (locked in Plan 01 scope):**
- Switch the `ingest-document` IPC and the new `ingest_document` MCP tool path to call `embedder.embedV2(chunk.content)` (returns `Int8Array`).
- Migrate `vec_document_chunks` schema from `float[384] distance_metric=cosine` to `int8[384] distance_metric=cosine`. New tables can adopt int8 directly — no dual-write dance is needed because DocumentStore has no v1 history that needs preserving (operator confirms in CONTEXT.md whether any prior `vec_document_chunks` rows exist that need re-embedding; baseline assumption: zero, because Phase 49's ingest_document was rarely used).
- This applies to **`vec_document_chunks` AND any cross-ingested `vec_memory_chunks` writes from U6** — those writes go to `vec_memory_chunks_v2` (Phase 115 v2 table) iff agent's migration phase ≥ `dual-write`. **Decision needed in CONTEXT.md:** if agent is on Phase 115 idle, does U6 cross-ingest force a Phase 115 dual-write transition for that agent, or does U6 write v1 only and rely on the Phase 115 cutover to backfill? Cleanest: U6 cross-ingest auto-flips the agent to `dual-write` for the document path only.

**CF-3 (BLOCKING for Plan 04 scope): U6 and U8 are mutually-substituting if U6 ships.**
The initial draft contradicted itself: §4 Q3 recommended "always cross-ingest into memory_chunks" (U6 carries retrieval) while §4 Q5 noted "if U6 is solid, U8 becomes redundant." The cleanly-resolved position:

- **U6 (cross-ingest into memory pipeline) carries the retrieval path** — Phase 90 RRF + the U9 reranker on the memory-chunks surface gives operator-turn retrieval coverage. This is the primary surface the operator actually uses.
- **U8 (hybrid-RRF on DocumentStore) ONLY matters for the direct `search-documents` MCP tool** (operator/agent issuing `search_documents(query, source=X)` to scope retrieval to a specific document). That surface today does pure cosine.
- **Decision:** DROP U8 from Phase 101 scope. Plan 04 contains U9 only (~1 day, ~100 LOC) and shrinks from 2 days to 1 day. The `search-documents` MCP tool stays cosine-only for now; if operator hits precision regressions on direct document-scoped search, re-open as Phase 101.5 (would be ~120 LOC + schema migration on `document_chunks_fts`).

**Note:** `document_chunks_fts` does NOT exist today. The original draft called U8 "mirror an existing pattern" but `src/documents/store.ts:213-217` shows only `document_chunks` and `vec_document_chunks` — `*_fts` is greenfield for the document path. This is captured here so the (deferred) follow-up phase doesn't assume mirror-cost.

**CF-4 (advisory): `@anthropic-ai/tokenizer` 0.0.4 is pre-1.0 (last modified 2026-02-10 per npm registry).**
The draft recommended switching the chunker from word-heuristic to tokenizer-accurate via this package. The package IS maintained (npm version 0.0.4, modified 2026-02-10 [VERIFIED: npm registry 2026-05-16]) but pre-1.0 signals breaking-change risk. Acceptable fallback if the package surface shifts: use the SDK's `client.messages.countTokens(...)` endpoint per Anthropic's documented count-tokens API — slower (network hop) but stable. **Recommendation:** stay with `@anthropic-ai/tokenizer` for synchronous chunker use (it's already in stack); document the count-tokens fallback in Plan 01 as a code comment so future readers see the alternative.

**CF-5 (advisory): Plan 05 (operator UAT) assumes Pon truth file exists.**
The 0.5-day Plan 05 estimate assumes the operator has produced `tests/fixtures/pon-2024-truth.json` (the curated `ExtractedTaxReturn` truth values to compare structured extraction against). This is operator work, not Claude work. **Resolution:** add an explicit `checkpoint:human-verify` task at the head of Plan 02 — "operator builds Pon truth fixture for SC-8" — that blocks downstream tasks until the file lands. Without this, Plan 02's "≥ 95% field accuracy" gate is unmeasurable.

---

## 2. Cutting-Edge 2026 RAG Stack — by dimension

### 2.1 Document ingestion + type detection + OCR

**State of the art (2026):**
- **Type detection:** magic-byte sniff via `file-type` (npm, v22.0.1, [VERIFIED: npm registry]) — works across PDF, docx, xlsx, PNG, JPG, WebP. Confirms file type independent of extension. Then for PDFs: probe text-layer via `pdf-parse` / `unpdf` — if extracted text < threshold (e.g., 50 chars/page after normalization), treat as scanned. [CITED: github.com/unjs/unpdf]
- **Text-PDF extraction:** `unpdf` 1.6.2 [VERIFIED: npm registry] is the **modern alternative to pdf-parse** — wraps PDF.js, modern API, TypeScript-native, ~200K weekly downloads, actively maintained. `pdf-parse` (~2M weekly) is "popular but unmaintained" per pkgpulse 2026 review. **Recommendation:** stay on `pdf-parse` for Phase 101 (already in stack, working), migrate to `unpdf` in a follow-up. [CITED: pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist]
- **Scanned PDF — OCR options (ranked by ClawCode fit):**

  | Option | Local/API | Cost | Accuracy (financial forms) | Latency | Stack fit | Recommendation |
  |--------|-----------|------|---------------------------|---------|-----------|----------------|
  | **Tesseract 5 via `node-tesseract-ocr` 2.2.1** | Local CLI | Free | Medium (decent on clean scans, weak on dense tables) | ~3-5s/page on clawdy CPU | High — already on dev box, missing on clawdy (deploy prereq) | **Primary fallback** [VERIFIED: npm registry; VERIFIED: tesseract 5.3.4 installed locally] |
  | **Tesseract.js 7.0.0** | Local WASM in-process | Free | Same as Tesseract 5 (same engine) | 2-3× slower than CLI | High — pure-Node, no deploy prereq | Backup if Tesseract install on clawdy proves operational pain [VERIFIED: npm registry] |
  | **Claude vision API (Sonnet/Haiku per page)** | API | ~$0.005-0.015/page | High (best on dense forms) | ~2-3s/page | High — already use Phase 113 pattern | **Secondary fallback** when Tesseract confidence < 70% OR `taskHint: "high-precision"` |
  | **Mistral OCR 3 API** | API | $2/1000 pages | Vendor-claimed 96.6% on tables | ~1-2s/page | Adds vendor; against local-first preference | **Escape hatch** — wire as optional backend if operator hits regressions [CITED: mistral.ai/news/mistral-ocr] |
  | **Nougat (Meta) / Marker (open-source)** | Local Python | Free | High on academic + tables | ~10s/page, GPU-friendly | Low — Python dependency violates Node-only constraint | Reject — adds Python runtime to ClawCode |
  | **DocLayout-YOLO + Tesseract** | Local Python | Free | High on multi-column | Slow | Low — Python | Reject — same reason |

**Page-batching strategy (closes Pon failure):**
- Render each PDF page to PNG via `pdftoppm` (Poppler — already on dev + clawdy [VERIFIED: which pdftoppm 2026-05-16]) at 150 DPI.
- Apply `sharp` resize to ≤1568px longest side **per page** before Claude send (Phase 113 pattern).
- **Strict ceiling:** when batch contains >20 images, Anthropic applies a stricter 2000px-per-image cap [VERIFIED: github.com/anthropics/claude-code/issues/49537]. ClawCode should batch ≤8 pages per request to stay below the threshold AND keep individual page latency tight.
- Total payload < 5MB per request hard limit [CITED: platform.claude.com/docs/en/build-with-claude/vision].

### 2.2 Chunking strategies

**State of the art (2026):**
- **Recursive 512-token splitting (LangChain-style)** ranked first at 69% accuracy on Vecta's Feb 2026 benchmark across 50 academic papers [CITED: langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide].
- **Semantic chunking** (embedding-similarity boundaries) ranked second at ~54%; +9% recall over fixed-size in some workloads but **NAACL 2025 found computational cost not justified by consistent gains** vs fixed 200-word chunks [CITED: langcopilot.com].
- **Contextual retrieval (Anthropic, 2024):** prepend a 50-100 token chunk-specific context (auto-generated via Haiku) to each chunk before embedding + BM25 indexing. Combined Contextual Embeddings + Contextual BM25 reduces retrieval failure rate by **49%** (5.7% → 2.9%). With reranking: **67%** reduction. [CITED: anthropic.com/news/contextual-retrieval]
- **Late chunking (Jina, 2024):** embed full long-context document FIRST, then mean-pool over chunk-sized windows AFTER. Preserves cross-chunk context in each chunk's embedding. +24.47% average retrieval improvement on 512-token chunks. **Requires long-context embedding model** (Jina v3 supports it natively). [CITED: arxiv.org/abs/2409.04701]
- **Parent-child / hierarchical chunking:** retrieve small chunks for precision, return parent paragraph for context. Stack-natively expressible — already partially implemented in ClawCode via `getAdjacentChunk` in DocumentStore [VERIFIED: src/documents/store.ts:138-145].

**For ClawCode (financial documents):**
- **Default:** recursive 512-token chunks with 50-token overlap (existing pattern is close — current is 500/50 word-heuristic [VERIFIED: src/documents/chunker.ts:29-30]; convert to tokenizer-accurate via `@anthropic-ai/tokenizer` already in stack).
- **Tables:** detect Markdown / TSV tables and treat as atomic chunks (don't split mid-row). Convert each row to a synthetic sentence for embedding ("Tax year 2024 Box 1 wages: $97,400" instead of "97400 | Box 1 | 97,400").
- **Contextual retrieval:** PROMISING but requires a Haiku pre-pass per chunk (~$0.0001/chunk). For a 100-page tax return that's ~50 chunks × $0.0001 = $0.005/document. Recommended as Phase 101.5 / Plan 4 add-on AFTER baseline ships.
- **Late chunking:** NOT VIABLE today — bge-small-en-v1.5 is 512-token max. Would require switching to `jina-embeddings-v3` (8192-token) or `bge-m3` (8192-token). Defer to a future embedding-v3 phase.

### 2.3 Embedding models

**Current:** `BAAI/bge-small-en-v1.5` int8 (Phase 115). 384-dim, MTEB ~63, ~78% storage reduction vs float32.

**2026 cutting-edge candidates evaluated:**

| Model | Dim | MTEB | Long-context | Local ONNX | Notes |
|-------|-----|------|--------------|------------|-------|
| `BAAI/bge-m3` | 1024 | 66.4 | 8192 tokens | Yes (Xenova/bge-m3) | Multilingual; +3 MTEB over bge-small, but 2.6× storage. Worth it if operator needs non-English. |
| `nomic-embed-text-v1.5` | 768 (Matryoshka 64-768) | 62.3 | 8192 tokens | Yes | Matryoshka — flexible dim. |
| `intfloat/e5-large-v2` | 1024 | 62.3 | 512 tokens | Yes (Xenova) | Older; no advantage over bge-m3. |
| `jina-embeddings-v3` | 1024 (MRL) | 65.5 | 8192 tokens | Partial (Jina releases ONNX) | **Native late-chunking support.** API or local. |
| `voyage-3-large` | 1024 | 70+ | 32K | API only | SOTA but API dependency. Anthropic recommended for contextual retrieval. |

**Recommendation:** **Stay on Phase 115's bge-small-en-v1.5 int8** for Phase 101. The +3-5 MTEB gain from upgrading to bge-m3 is dwarfed by the gain from adding a reranker (10-30% precision @5) and hybrid retrieval (-49% failure rate). Re-open embedding upgrade in a separate phase if reranker + hybrid don't close Pon precision targets.

### 2.4 Structured extraction

**State of the art (2026):**
- **Anthropic tool-use mode** — pass a `tools` array with a `Pydantic-like` JSON schema; Claude returns a `tool_use` block with schema-valid JSON. No hallucinated fields, no parse errors. [CITED: platform.claude.com/docs/en/build-with-claude/tool-use]
- **`instructor`-style libraries** (Python): wrap an LLM call + Pydantic schema + auto-retry on validation fail. Node equivalent: `zod-to-json-schema` (or `zod`'s native `toJSONSchema` in v4+) → pass to Anthropic tool-use → validate response with the zod schema.
- **Constrained decoding** (vLLM / Outlines / lm-format-enforcer): forces every token to be a schema-legal continuation. NOT available via Anthropic API (server-side abstraction not exposed). Equivalent reliability via tool-use.

**For ClawCode:**
- Use **Anthropic tool-use** with zod-derived JSON schemas. Per-document-type schemas: `ExtractedTaxReturn`, `ExtractedBrokerageStatement`, `Extracted401kStatement`, `ExtractedADV`. Operator-curated; live in `src/documents/schemas/`.
- Single-pass extraction: send OCR/text + schema in one request. For long documents (>10K tokens), pre-chunk by section (Schedule A, Schedule C, etc.) and run schema-fragment extraction per section, then merge.
- Model: **Sonnet 4.5+** for high-precision; **Haiku 4.5** for low-stakes (e.g., document metadata only). Operator can pin per-document-type via config.
- Validate response with zod; on fail, retry once with the error in the prompt (`"Your previous response had: <zod error>. Return only valid JSON matching this schema."`).

### 2.5 Vector storage + retrieval

**Current:** sqlite-vec 0.1.9 with `float[384] distance_metric=cosine` brute-force. [VERIFIED: src/documents/store.ts:215]

**sqlite-vec scaling envelope (2026):**
- v0.1.0 stable was released 2024 [CITED: alexgarcia.xyz/blog/2024/sqlite-vec-stable-release]. Brute-force only; ANN (IVF, DiskANN) experimental in alpha, not enabled. [CITED: github.com/asg017/sqlite-vec/issues/25]
- Brute-force scales to ~1M 128-dim vectors fine; for 384-dim, comfortable to ~100K per agent.
- Phase 115 already proved int8 storage (4× compression) works for 384-dim memory vectors.
- **Migration trigger (not yet hit):** if document_chunks per agent grows past 50K AND p95 search > 200ms, evaluate `vectorlite` (HNSW ANN, 3×-100× faster on large datasets, recall trade) or LanceDB (Rust, ANN, scales to billions). [CITED: github.com/1yefuwang1/vectorlite]
- **Hybrid retrieval (the real upgrade for Phase 101):** add `document_chunks_fts` FTS5 virtual table mirroring `memory_chunks_fts` pattern. Issue parallel vec KNN + FTS5 MATCH queries, fuse via RRF (k=60, copy from `src/memory/memory-retrieval.ts:54-90`). Closes the "account number / form field name" precision gap where lexical match wins.

### 2.6 Reranking

**Current:** **None.** No reranker on either memory or document path.

**2026 cutting-edge candidates evaluated (local-first):**

| Reranker | Size | Local ONNX | Latency | Quality | Recommendation |
|----------|------|------------|---------|---------|----------------|
| **`Xenova/bge-reranker-base`** | 278M params | YES — Xenova ONNX in `@huggingface/transformers` | ~50-100ms for 20 pairs CPU | Strong English | **Primary recommendation** [VERIFIED: huggingface.co/Xenova/bge-reranker-base] |
| **`onnx-community/bge-reranker-v2-m3-ONNX`** | 568M params | YES — ONNX via `@huggingface/transformers` | ~150-200ms for 20 pairs CPU | Best multilingual + stronger overall | Recommend if multi-language docs ever ship [VERIFIED: huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX] |
| `mxbai-rerank-large-v1` | 1.5B params | ONNX exists but not Xenova-blessed | ~500ms+ | Top-tier on MTEB-RR | Defer — install friction not justified |
| Cohere `rerank-3` API | — | NO | ~100ms via API | Strong | API dependency — defer |

**Recommendation: `Xenova/bge-reranker-base`** — same ONNX runtime as the existing embedder (`@huggingface/transformers` 4.2.0 [VERIFIED: package.json]), proven via `text-classification` pipeline. Output is a logit (sigmoid → [0,1] relevance score). Apply over top-20 RRF candidates → keep top-5. Anthropic reports rerank turns 49% retrieval-failure-rate reduction (contextual + hybrid) into **67%** — the single biggest precision-per-dollar add. [CITED: anthropic.com/news/contextual-retrieval]

**Implementation sketch (verified from search results):**
```typescript
// src/documents/reranker.ts (sketch only; planner will own final API)
import { pipeline } from '@huggingface/transformers';
const reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base');
// Apply over [query, candidate.content] pairs; sort by score desc.
```

### 2.7 Query optimization

- **HyDE (Hypothetical Document Embeddings):** generate a hypothetical answer with Haiku, embed it, retrieve against THAT vector. Helps when query and corpus use different vocabulary. Adds 1 LLM hop (~500ms + ~$0.0001).
- **Query rewriting:** Haiku rewrites user query into a search-engine-style query. Same cost profile.
- **Query expansion:** add synonyms / acronym expansions.

**For ClawCode:** **Defer all three to v3.2.** Financial-document Q&A queries from the operator are short and term-rich ("Pon's 2024 Box 1 wages" — the field name IS in the document). Hybrid retrieval + rerank closes more failure modes for the same compute as a query-rewrite pass.

### 2.8 Performance targets + measurement

**Targets (proposed — operator confirms in CONTEXT.md):**
- **Ingestion:** text-PDF ≥ 5 pages/sec end-to-end (extract → chunk → embed → store). Scanned-PDF ≥ 0.5 pages/sec via Tesseract local (depends on clawdy CPU); ≥ 2 pages/sec via Claude vision parallel batches of 8.
- **Embedding:** p50 ≤ 30ms per chunk (bge-small int8 on M-class CPU). Batchable — parallelize across chunks via `Promise.all` in groups of 8.
- **Retrieval (per-turn):** p50 ≤ 80ms, p95 ≤ 200ms for top-5 RRF + rerank over 50K chunks.
- **Memory ceiling per agent:** ≤ 500MB resident at 50K chunks (sqlite-vec int8 = ~1KB/chunk + content ~2KB + FTS index ~0.5KB → ~3.5KB × 50K = ~175MB DB; +embedder ONNX ~150MB; +reranker ONNX ~100MB).
- **API budget:** ≤ $0.05/document for ingestion (covers Claude vision fallback on 2-3 pages worst case + 1 structured-extract pass).

**Measurement plan:**
- Reuse the `phaseN-resolver` structured log pattern from Phase 127 (one line per ingestion event with `duration_ms`, `chunks`, `pages`, `ocrUsed`, `apiCostUsd`).
- Add `ingest-document-metrics` IPC for the dashboard /memory page.
- Vitest perf tests for embedding + retrieval p50/p95 on synthetic 10K-chunk corpus.

### 2.9 Domain-specific — financial documents

**Failure modes specific to tax returns / brokerage statements:**
1. **Dense tables.** OCR loses cell alignment. Mitigation: feed Tesseract `tsv` output mode (`-c tessedit_create_tsv=1`) to get word-position bboxes; reconstruct rows via Y-coordinate clustering. Or use Claude vision per-page with explicit "preserve table structure as Markdown" instruction.
2. **Numeric precision.** OCR confuses `O` / `0`, `1` / `l` / `I`, `,` / `.` in money columns. Mitigation: structured extraction prompt with format constraints (`Box 1: integer dollars, no commas`); post-validate via zod number coercion + sanity range check.
3. **Account numbers / named entities.** Lexical match wins. Mitigation: hybrid retrieval (BM25 fires on the literal string).
4. **Multi-page line items.** A 1099 has 30 brokerage lines across 4 pages; structured extraction must merge. Mitigation: per-section schema extraction → array concat.
5. **Sensitive fields.** SSN, account numbers. Mitigation: redact via regex post-extract before logging; mark schema fields `sensitive: true` so display layer can mask.

---

## 3. Comparison Matrix

| Dimension | ClawCode baseline (today) | Cutting-edge 2026 | Delta (recommended Phase 101 target) |
|-----------|---------------------------|-------------------|--------------------------------------|
| File type detection | None (extension check only) | Magic-byte sniff + text-layer probe | Add `file-type` 22.0.1 + pdftotext probe |
| Text PDF extract | `pdf-parse` | `pdf-parse` (in stack) or `unpdf` (modern) | Stay on pdf-parse; flag unpdf for v3.2 |
| Scanned PDF OCR | **NONE** | Tesseract / Claude vision / Mistral OCR 3 | Tesseract primary + Claude vision fallback |
| Office docs | None (extension check only — falls to garbage utf-8) | `mammoth` (docx), `exceljs` or `officeparser` (xlsx) | Add `mammoth` + `exceljs` |
| Page batching for vision | None | sharp resize → ≤8 pages/batch → ≤1568px | Wire Phase 113 sharp + add batch loop |
| Chunking | Word-count heuristic, 500-token/50-overlap | Recursive 512-token + atomic tables | Convert to tokenizer-accurate; treat tables as atomic |
| Embeddings | bge-small int8 (Phase 115 wired, default path still v1 MiniLM) | bge-m3 / jina-v3 (long-context) | **No change** — finish Phase 115 cutover; extend to documents |
| Vector storage | sqlite-vec float[384] cosine | sqlite-vec int8[384] cosine | Adopt Phase 115 int8 pattern on `vec_document_chunks` |
| Hybrid retrieval (docs) | **NONE** (pure cosine) | vec + BM25 + RRF | **Mirror Phase 90 pattern on DocumentStore** |
| Reranker | **NONE** | bge-reranker-v2-m3 / Cohere rerank-3 | Add `Xenova/bge-reranker-base` via existing transformers.js runtime |
| Structured extraction | None | Anthropic tool-use + zod schemas | Add per-type schemas, Sonnet tool-use call |
| Memory pipeline integration | DocumentStore is islanded; time-window filter would expire docs after 14d | Auto cross-ingest into `memory_chunks` so Phase 90 RRF sees docs; allow-list `document:*` paths in filter | Hook `ingest_document` to also write `memory_chunks` rows + CF-1 filter fix |
| MCP tool surface | `ingest-document` IPC only | `ingest_document(path, hint, extract)` end-to-end | New MCP tool wraps full pipeline |
| Fail-mode alerts | Silent | Trigger-engine to admin-clawdy | Mirror Phase 127 `recordStall` pattern |

---

## 4. Recommended Upgrades — prioritized by ROI

### Tier 1 — Pon-blocking (MUST ship in Phase 101)

#### U1: File-type detection + handler dispatch [SC-1]
**What:** Add `src/documents/type-detector.ts` that returns `{ type: 'text-pdf' | 'scanned-pdf' | 'docx' | 'xlsx' | 'image' | 'text', confidence }`. Use `file-type` magic-byte sniff first; for PDFs additionally probe via `pdf-parse` and classify as `scanned-pdf` if extracted text < 50 chars/page after normalization.
**Why for ClawCode:** Closes the silent-garbage-utf-8 failure path. Without this, every other upgrade is wasted.
**Cost:** ~80 LOC + 1 new dep (`file-type` 22.0.1 [VERIFIED: npm registry]). 1 day plan.
**Risk:** Low. `file-type` is a well-known package (~30M downloads/week).

#### U2: OCR fallback (Tesseract + Claude vision tiers) [SC-2]
**What:** Add `src/documents/ocr.ts` with two backends: `tesseractOcr(pageImage): { text, confidence }` via `node-tesseract-ocr` 2.2.1 [VERIFIED: npm registry] and `claudeVisionOcr(pageImage, opts): { text }` via Anthropic SDK (already in stack). Confidence-gate Tesseract output at 70% — fall through to Claude vision if below.
**Why for ClawCode:** This is THE Pon failure mode.
**Cost:** ~250 LOC + 1 new dep + clawdy deploy prereq (apt install tesseract-ocr). 2 day plan.
**Risk:** MEDIUM — Tesseract apt install on clawdy is a deploy-time prereq not yet done [VERIFIED: ssh probe 2026-05-16]. Mitigation: include `apt install tesseract-ocr` in `scripts/deploy-clawdy.sh` precheck OR fall back to Tesseract.js WASM [VERIFIED: tesseract.js 7.0.0 npm registry].

#### U3: Page-batching with dimension control [SC-3]
**What:** Add `src/documents/page-batcher.ts` that takes a PDF + handler choice and emits batches of ≤8 pages, each rendered via `pdftoppm` then resized via `sharp` to ≤1568px longest side, ≤4MB payload check. Wired so the `claudeVisionOcr` path receives properly-shaped batches.
**Why for ClawCode:** Closes the "image dimension limit for many-image requests" error mode (the literal 2026-04-28 Pon failure).
**Cost:** ~150 LOC (sharp + pdftoppm already available). 1 day plan.
**Risk:** Low. Mirrors Phase 113 pattern.

#### U4: Structured extraction with zod schemas [SC-4]
**What:** Add `src/documents/schemas/` directory with per-type zod schemas (start with `ExtractedTaxReturn`). Add `src/documents/structured-extract.ts` that calls Anthropic tool-use with the schema → zod-validates response → retries once on validation fail.
**Why for ClawCode:** Operator wants `box1Wages: 97400` not "97,400". Downstream consumers need typed shape.
**Cost:** ~200 LOC + per-schema operator-curation (Pon schema first). 2 day plan.
**Risk:** MEDIUM — schema design is operator-curated and may need iteration. Mitigation: ship with `ExtractedTaxReturn` only, add others as needs surface.

#### U5: New MCP tool `ingest_document` [SC-5]
**What:** Add an MCP tool surface that wraps U1-U4 + the existing Phase 49 IPC. Signature: `ingest_document(path, taskHint?: string, extract?: "text"|"structured"|"both")`. Returns `{ source, text_path, structured_path?, structured_data?, chunks_created, pages, ocr_used, api_cost_usd }`.
**Why for ClawCode:** Single tool call vs current 4-step plumbing.
**Cost:** ~100 LOC in MCP server + IPC. 1 day plan.
**Risk:** Low.

#### U6: Auto cross-ingest into memory pipeline [SC-6]
**What:** When `ingest_document` writes to `document_chunks` + `vec_document_chunks`, also write extracted text to `memory_chunks` + `vec_memory_chunks` (or `vec_memory_chunks_v2` per CF-2) + `memory_chunks_fts` so Phase 90 hybrid-RRF surfaces it on subsequent turns. Use a `path: 'document:<doc-slug>'` chunk-path convention so retrieval can identify document-derived chunks. **Includes the CF-1 fix:** extend `applyTimeWindowFilter` allow-list to exempt `document:` paths so documents don't expire from RRF after 14 days.
**Why for ClawCode:** This is the load-bearing architectural decision and the primary retrieval surface (per CF-3, U6 obviates U8 for the operator-turn retrieval path). Without it, "agent should know about Pon's tax return next month" fails twice (once because documents aren't in memory_chunks, once because the time-window filter would expire them).
**Cost:** ~80 LOC (cross-write hook) + 1 LOC + test (time-window allow-list) + (per CF-2) 0-30 LOC depending on Phase 115 migration phase coordination. 1.5 day plan.
**Risk:** MEDIUM — dual-write means doubled storage. Mitigation: write reduced chunks (top sections only) to memory_chunks if storage pressure surfaces. The time-window allow-list fix (CF-1) is itself low-risk (mirrors vault/procedures pattern exactly).

#### U7: Fail-mode alerts to admin-clawdy [SC-7]
**What:** When ingestion fails (OCR confidence < threshold, structured-extract validation fails twice, vision API rejects payload), emit a structured event via trigger-engine to admin-clawdy. Reuse Phase 127 `recordStall` JSONL writer pattern.
**Why:** No more silent claim-but-fail.
**Cost:** ~60 LOC. 0.5 day plan.

### Tier 2 — Quality win, low cost (RECOMMEND ship in Phase 101 Plan 4; can split if surface area large)

#### U9: Local cross-encoder reranker [SC-10]
**What:** Add `src/documents/reranker.ts` using `Xenova/bge-reranker-base` via `@huggingface/transformers` `text-classification` pipeline. Apply over top-20 RRF candidates, keep top-5 for return.
**Why:** -67% retrieval failure rate (Anthropic benchmark) — biggest precision win per CPU-second. Same ONNX runtime as embedder, ~100ms additional latency.
**Cost:** ~100 LOC + warmup hook. 1 day plan.
**Risk:** MEDIUM — depends on ONNX model availability + tokenizer compat at runtime. Mitigation: smoke-test in Wave 0 — if `pipeline('text-classification', 'Xenova/bge-reranker-base')` errors, fall back to MEDIUM-confidence skip; Phase 101 ships without reranker, U9 splits to follow-up.

### Tier 3 — Researched and DEFERRED (do not include in Phase 101 unless evidence demands)

| Item | Why deferred |
|------|--------------|
| **U8: Hybrid-RRF + FTS5 on DocumentStore** | Per CF-3, U6 carries operator-turn retrieval via Phase 90 RRF on `memory_chunks`. U8 only matters for the direct `search-documents` MCP tool. Defer to Phase 101.5 if operator hits precision regressions on direct document-scoped search. ~120 LOC follow-up. `document_chunks_fts` is greenfield (not yet built). |
| Embedding upgrade (bge-m3 / jina-v3) | Phase 115's bge-small int8 isn't even cut-over yet; +3-5 MTEB is dwarfed by reranker (+10-30% precision). Re-open if U9 (alone) doesn't close Pon precision. |
| ColPali / ColQwen2 visual late-interaction | Multi-vector storage rework + ONNX patchy. Re-open at >10K visual-only docs/agent. |
| Late chunking (Jina v3) | Requires long-context embedding model (8192-token) — not in current stack. |
| Contextual retrieval (Anthropic 2024) | Adds Haiku pre-pass per chunk ~$0.005/doc. Worth doing AFTER U1-U9 ship; cleaner as a separate phase. |
| HyDE / query rewriting | Financial-doc queries are term-rich; hybrid+rerank covers same value at lower cost. |
| Mistral OCR 3 API | Vendor dependency; wait for operator regression evidence. |
| Alternative vector stores (LanceDB / Qdrant / vectorlite) | Not needed until ≥100K chunks/agent OR p95 retrieval > 200ms. |
| Learned fusion (monoT5) | Local cross-encoder reranker covers same value. |

---

## 5. Performance Targets (proposed for Phase 101)

| Metric | Target | Measurement | Source |
|--------|--------|-------------|--------|
| Ingestion throughput — text-PDF | ≥ 5 pages/sec | Wall-clock from `ingest_document` call to DB commit | New telemetry |
| Ingestion throughput — scanned-PDF (Tesseract local) | ≥ 0.5 pages/sec | Same | New telemetry |
| Ingestion throughput — scanned-PDF (Claude vision, batches of 8) | ≥ 2 pages/sec | Same | New telemetry |
| Embedding latency (bge-small int8, single chunk) | p50 ≤ 30ms, p95 ≤ 60ms | Per-call timing in EmbeddingService | Phase 115 baseline |
| Retrieval latency (top-5 RRF + rerank, 50K chunk corpus) | p50 ≤ 80ms, p95 ≤ 200ms | Per-IPC timing | New telemetry |
| Reranker latency (20 candidates) | p50 ≤ 100ms, p95 ≤ 250ms | Per-call timing | Estimated from bge-reranker-base benchmarks |
| Memory ceiling per agent | ≤ 500MB resident at 50K chunks | RSS sample on `agent-status` | New |
| API budget per ingested document (typical) | ≤ $0.05 | Sum Claude-vision pages × per-page cost + structured-extract input | Cost telemetry |
| API budget worst case (100-page scanned tax return) | ≤ $0.50 | Same | Cost telemetry |
| Pon regression — `ExtractedTaxReturn` field accuracy | ≥ 95% (operator truth values) | UAT script | §6 |

**Latency budget instrumentation strategy:** wire to existing pino logger + new `ingest-document-metrics` IPC for the dashboard.

---

## 6. Pon Tax Return UAT — End-to-end trace with upgraded stack

The 2026-04-28 failure: scanned 24-page tax return PDF → subagent fell back to per-page PyMuPDF rendering → all pages sent in single Claude call → "image dimension limit for many-image requests" error → subagent claimed to save analysis to file but file was never written → relay back to parent agent truncated at Discord 2000 chars.

### With Phase 101 stack — step-by-step

1. **Operator drops `pon-2024-1040.pdf` in fin-acquisition Discord channel.**
2. **Auto-ingest fires** (Phase 999.43, depends on Phase 101) → calls MCP tool `ingest_document(path="/agents/fin-acquisition/inbox/pon-2024-1040.pdf", taskHint="tax-return", extract="both")`.
3. **Type detection (U1):** `file-type` returns `application/pdf`. `pdf-parse` probe: extracted text 12 chars (PDF has no text layer). Classify as `scanned-pdf`.
4. **Page batching (U3):** `pdftoppm` renders all 24 pages to 150-DPI PNGs. `sharp` resizes each to ≤1568px longest side. Batches of 8 pages = 3 batches.
5. **OCR primary (U2 — Tesseract):** `node-tesseract-ocr` extracts per-page text. Per-page confidence reported. On pages 1-20, confidence ≥ 80% — keep Tesseract output. On pages 21-24 (handwritten Schedule C), confidence 45% — flag for fallback.
6. **OCR fallback (U2 — Claude vision):** Pages 21-24 sent in 1 batch of 4 (well under 8/2000px ceiling) to Claude Haiku 4.5 with prompt "Extract all visible text verbatim, preserving table structure as Markdown." Returns clean text.
7. **Chunking:** Combined OCR output chunked by section (Schedule A, B, C, D, E header markers) via tokenizer-accurate recursive splitter. Tables treated as atomic chunks (don't split mid-row).
8. **Embedding (Phase 115 v2):** bge-small-en-v1.5 int8 over each chunk. Stored in `vec_document_chunks` (int8 column — new Phase 101 schema migration).
9. **Memory cross-ingest (U6):** chunks also written to `memory_chunks` + `vec_memory_chunks` (`_v2` per CF-2) + `memory_chunks_fts` with `path="document:pon-2024-1040"`. Phase 90 RRF retrieval (vec + BM25 + RRF, time-window filter exempts `document:*` per CF-1) will see them on next turn AND every turn thereafter.
10. **Structured extraction (U4):** Anthropic Sonnet tool-use call with the OCR text + `ExtractedTaxReturn` zod-derived JSON schema. Returns typed JSON: `{ year: 2024, taxpayer: "Pon", box1Wages: 97400, scheduleC: { netProfit: 12300, expenses: [...] }, backdoorRoth: { amount: 7000 }, ... }`. Zod validates; on fail retry once with the error.
11. **File write (existing Phase 100-fu `verify-file-writes`):** Markdown summary written to `/agents/fin-acquisition/documents/pon-2024-1040.md`. Structured JSON written to `/agents/fin-acquisition/documents/pon-2024-1040.json`. Both writes verified by stat-after-write.
12. **MCP tool returns:** `{ source: "pon-2024-1040.pdf", text_path: "...", structured_path: "...", structured_data: { ... }, chunks_created: 47, pages: 24, ocr_used: ["tesseract:1-20", "claude-vision:21-24"], api_cost_usd: 0.038, p50_chunk_embed_ms: 28 }`.
13. **Next operator turn ("what was Pon's Schedule C net?"):** Phase 90 RRF retrieval fires pre-turn. vec match on "Schedule C net" + FTS BM25 match on "Schedule C" + path-derived score-weight 0 (no vault/procedures bonus on `document:` path) → top-20 → U9 bge-reranker over (query, candidate) pairs → top-5 → `<memory-context>` block injected. Agent answers: "Pon's Schedule C net profit was $12,300" with citation to chunk in the ingested doc.

**Failure modes that close (mapping to gaps from §1):**

| Gap | Closed by |
|-----|-----------|
| No file-type detection | U1 |
| No OCR fallback | U2 |
| No page-batching aware of dimension limits | U3 |
| No structured extraction | U4 |
| Claim-but-not-written files | Phase 100-fu `verify-file-writes` (pre-existing) + MCP-tool atomic return |
| Discord truncation of subagent reply | Phase 100-fu `long-output-to-file` (pre-existing) + MCP-tool returns paths not content |
| DocumentStore not in Phase 90 RRF | U6 |
| No fail-mode alerts | U7 |

---

## 7. Phasing Recommendation (4 plans)

Recommended split for Phase 101 (4 plans, sequenced by dependency):

### Plan 01 — Ingestion foundation (Pon-unblocking minimum)
- U1: type detection + handler dispatch
- U2: OCR fallback (Tesseract primary + Claude vision fallback)
- U3: page-batching with sharp + 8-page/1568px ceiling
- **CF-2: switch `daemon.ts:11011` and the new MCP tool path from `embedder.embed()` (v1 MiniLM) to `embedder.embedV2()` (bge-small int8)** — explicit code change, ~5 LOC
- **CF-2: migrate `vec_document_chunks` from `float[384] cosine` to `int8[384] cosine`** — schema migration (one-time recreate; no v1 history in DocumentStore per baseline assumption)
- **CF-2 coordination check:** confirm in CONTEXT.md whether U6's cross-write into `vec_memory_chunks` requires auto-flipping the agent to Phase 115 `dual-write` for the document path; default: yes, auto-flip on first document ingestion
- Deploy-side: `tesseract-ocr` + `poppler-utils` install on clawdy via `scripts/deploy-clawdy.sh` precheck
- **Estimate:** 3-4 days, ~650 LOC, 5-7 tasks
- **Gate:** Pon's 24-page scanned PDF round-trips text without error; new chunks stored as int8 in `vec_document_chunks`.

### Plan 02 — Structured extraction + MCP tool
- **CF-5: `checkpoint:human-verify` task at head — operator produces `tests/fixtures/pon-2024-truth.json` (curated truth values for SC-8 gate)** — blocks downstream tasks until file lands
- U4: zod-derived schemas (`ExtractedTaxReturn` first) + Anthropic tool-use call
- U5: `ingest_document` MCP tool wrapping U1-U4 + existing IPC
- U7: fail-mode alerts via trigger-engine (Phase 127 pattern)
- **Estimate:** 2-3 days, ~400 LOC, 4-5 tasks (incl. checkpoint)
- **Gate:** Pon UAT — `ExtractedTaxReturn` field accuracy ≥ 95% vs operator truth values.

### Plan 03 — Memory pipeline integration
- U6: auto cross-ingest into `memory_chunks` + `vec_memory_chunks` (or `_v2` per CF-2) + `memory_chunks_fts`
- **CF-1: extend `applyTimeWindowFilter` in `src/memory/memory-chunks.ts` to allow-list `path` prefixes matching `document:`** — 1 LOC + regression test (365-day filter keeps `document:*` chunks)
- Phase 90 RRF surfaces document chunks on subsequent turns
- New telemetry for ingest p50/p95 + chunk counts + api cost
- **Estimate:** 1.5 days, ~260 LOC, 3 tasks
- **Gate:** Day-after-ingest "what was Pon's Schedule C net?" returns cited answer from doc chunks; **14-day-old ingested document still surfaces in Phase 90 RRF** (CF-1 regression test passes).

### Plan 04 — Retrieval quality upgrade (U9 only — U8 deferred per CF-3)
- U9: local `Xenova/bge-reranker-base` via existing `@huggingface/transformers` runtime; applied over Phase 90 RRF top-20 candidates, keep top-5
- Wave 0 smoke-test: `pipeline('text-classification', 'Xenova/bge-reranker-base')` loads + scores a (query, passage) pair end-to-end. If this fails at runtime, U9 splits to a follow-up phase.
- **Estimate:** 1 day, ~100 LOC + warmup hook, 2 tasks
- **Gate:** retrieval p95 ≤ 200ms with reranker; precision@5 measurably improved on a synthetic financial-doc Q&A test set.

### Plan 05 — operator-deploy + UAT verification (autonomous: false)
- Deploy via `scripts/deploy-clawdy.sh`
- Operator runs Pon UAT, captures truth-value comparison
- Soak for 24h, gate on no ingestion failures in operator's daily workflow
- **Estimate:** 0.5 day

**Total Phase 101 estimate:** ~9-11 days end-to-end. Well within v2.7 milestone, does not contend with v3.1 hard deadline (2026-06-15 Anthropic cutover) since 101 ships before then.

**Alternative tightening:** if operator wants minimum-viable-Pon faster, ship Plans 01+02+05 only (~6 days), defer Plans 03+04 as Phase 101.5.

---

## 8. Open Questions / Decisions for CONTEXT.md

These need operator input at `/gsd:discuss-phase 101`:

1. **OCR backend choice for Tier 1:**
   - A) Tesseract CLI on clawdy (requires apt install — best accuracy + lowest CPU)
   - B) Tesseract.js WASM in-process (zero deploy prereq, ~2× slower)
   - C) Skip Tesseract; go directly to Claude vision per page (API cost, no local OCR)
   - **Research recommendation:** (A) — Tesseract CLI. Falls back to (B) only if clawdy install proves operationally painful.

2. **Claude vision OCR model:**
   - A) Haiku 4.5 (cheaper, ~$0.005/page, slightly lower OCR accuracy)
   - B) Sonnet 4.5 (~$0.015/page, best OCR accuracy on dense forms)
   - C) Dynamic — Haiku by default, Sonnet on `taskHint: "high-precision"`
   - **Research recommendation:** (C) — operator-tunable per call.

3. **Cross-ingest into memory_chunks (U6):**
   - A) Always cross-ingest every document chunk → memory_chunks (storage doubled, simplest)
   - B) Cross-ingest only structured-summary chunks (top sections, table of contents, key totals) — saves storage, may miss long-tail queries
   - C) Cross-ingest gated by document type — tax returns full, brokerage statements summary-only
   - **Research recommendation:** (A) for Phase 101 simplicity; revisit if memory_chunks growth becomes a pain point. **Locked finding (CF-1):** cross-ingested chunks must use `path: "document:<slug>"` AND the time-window filter must be extended to exempt this prefix — see Plan 03 task list.

4. **Reranker (U9) in Phase 101 or split?**
   - A) Include in Plan 04 of Phase 101 (recommended)
   - B) Defer to Phase 101.5 — ship Plans 01-03 fast
   - **Research recommendation:** (A) — same ONNX runtime as embedder, ~1 day plan, biggest precision win per dollar.

5. **Hybrid-RRF on DocumentStore (U8) in Phase 101 or split?**
   - **RESOLVED (CF-3): defer U8 to Phase 101.5.** U6 (cross-ingest into memory_chunks) carries operator-turn retrieval via Phase 90 RRF, making U8 redundant for that surface. U8 only matters for the direct `search-documents` MCP tool — re-open if operator hits precision regressions on document-scoped search. This shrinks Plan 04 to U9 only (1 day instead of 2).

6. **`ExtractedTaxReturn` schema scope for Pon UAT:**
   - Operator-curated field list. Suggested initial: `taxYear`, `taxpayerName`, `box1Wages`, `scheduleC: { netProfit, grossReceipts, expenses[] }`, `backdoorRoth: { amount, year }`, `iraDeduction`, `qbi: { deduction }`. Operator adds fields as needs surface.

7. **Schema versioning strategy:**
   - When `ExtractedTaxReturn` schema changes, do we re-extract historical documents? Or version the schema and tolerate mixed shapes downstream?
   - **Research recommendation:** version the schema (`extractionSchemaVersion: "v1"` field), don't auto-reextract — re-extract opt-in via re-running `ingest_document --force` on the file.

8. **Mistral OCR 3 as Tier 4 escape hatch?**
   - Wire `--backend mistral` flag in `ingest_document` for operator opt-in when Tesseract+Claude both fall short?
   - **Research recommendation:** YES — add as off-by-default config knob; operator flips per-document via taskHint. ~30 LOC. [CITED: mistral.ai/news/mistral-ocr]

9. **Embedding cutover gating:**
   - Should documents always embed via bge-small int8 (Phase 115 v2) regardless of memory's migration phase, since this is a new write surface with no v1 history?
   - **Research recommendation:** YES — DocumentStore is greenfield for v2; skip the dual-write dance for documents (Phase 115 migration only matters for `vec_memory_chunks` which has v1 history).

---

## Package Legitimacy Audit

> Verified via slopcheck v0.6.1 on 2026-05-16. All candidates passed `[OK]`. The slopcheck `[OK]` result on `node-tesseract-ocr` carried the advisory "Name starts with 'node-' -- classic LLM naming pattern. Name looks like LLM bait but package is established." Established status confirmed via 2.2.1 release + npm registry presence.

| Package | Registry | Version | Source | slopcheck | Disposition |
|---------|----------|---------|--------|-----------|-------------|
| `file-type` | npm | 22.0.1 | github.com/sindresorhus/file-type | [OK] | Approved (U1) |
| `node-tesseract-ocr` | npm | 2.2.1 | github.com/zapolnoch/node-tesseract-ocr | [OK] (with naming-pattern note) | Approved (U2 — primary path) |
| `tesseract.js` | npm | 7.0.0 | github.com/naptha/tesseract.js | [OK] | Approved (U2 — WASM fallback) |
| `mammoth` | npm | 1.12.0 | github.com/mwilliamson/mammoth.js | [OK] | Approved (docx handler) |
| `exceljs` | npm | 4.4.0 | github.com/exceljs/exceljs | [OK] | Approved (xlsx handler) |
| `officeparser` | npm | 7.0.3 | github.com/harshankur/officeParser | [OK] | Approved alternative |
| `unpdf` | npm | 1.6.2 | github.com/unjs/unpdf | [OK] | Approved (future migration target, NOT Phase 101 default) |

**No packages flagged `[SLOP]` or `[SUS]`.** Postinstall scripts checked: only `tesseract.js` has one (`opencollective-postinstall || true`) — informational/no-op.

**External system dependencies (non-npm):**

| Dependency | Required By | Available on dev | Available on clawdy | Fallback |
|------------|------------|------------------|---------------------|----------|
| `tesseract` (system binary) | U2 primary path | ✓ 5.3.4 | **✗ NOT INSTALLED** | `tesseract.js` WASM in-process |
| `pdftoppm` (poppler-utils) | U3 page render | ✓ 24.02.0 | ✓ verified | None — Plan 01 prerequisite |
| `pdftotext` (poppler-utils) | U1 text-layer probe | ✓ 24.02.0 | ✓ verified | `pdf-parse` text probe |
| `file` (libmagic) | U1 magic-byte sniff | ✓ | (assumed; `file-type` Node lib handles it in-process anyway) | `file-type` Node lib |

**clawdy install prereq for Plan 01:**
```bash
ssh clawdy "sudo apt update && sudo apt install -y tesseract-ocr tesseract-ocr-eng poppler-utils"
```

---

## Runtime State Inventory

Phase 101 is a **greenfield phase** — no rename, refactor, or migration. The new schemas, MCP tool, and ONNX models are additive. No `[RUNTIME-STATE]` items.

| Category | Items found | Action required |
|----------|-------------|------------------|
| Stored data | None — Phase 101 adds new tables (`document_chunks_fts`) and new chunk-path convention (`document:<slug>`); no existing data renamed | New schema migration only |
| Live service config | None — new MCP tool surface is additive | None |
| OS-registered state | None | None |
| Secrets/env vars | None new — uses existing `op://` references for Anthropic API key | None |
| Build artifacts / installed packages | Adds 5 npm deps (`file-type`, `node-tesseract-ocr`, `tesseract.js` (optional), `mammoth`, `exceljs`) | `npm install` post-merge |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3+ (already in stack) |
| Config file | `vitest.config.ts` (assumed; package.json `test` script uses `vitest run --reporter=verbose`) |
| Quick run command | `npm test -- src/documents` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | type detector classifies PDF/scanned-PDF/docx/xlsx/image correctly | unit | `npm test -- src/documents/__tests__/type-detector.test.ts` | ❌ Wave 0 |
| SC-2 | Tesseract OCR returns text + confidence; Claude vision called on low-confidence fallback | integration | `npm test -- src/documents/__tests__/ocr.test.ts` | ❌ Wave 0 |
| SC-3 | page batcher emits ≤8 pages/batch, each ≤1568px longest side, ≤4MB payload | unit | `npm test -- src/documents/__tests__/page-batcher.test.ts` | ❌ Wave 0 |
| SC-4 | structured extract returns zod-valid `ExtractedTaxReturn` on synthetic fixture | integration | `npm test -- src/documents/__tests__/structured-extract.test.ts` | ❌ Wave 0 |
| SC-5 | `ingest_document` MCP tool round-trips a fixture PDF | integration | `npm test -- src/mcp/__tests__/ingest-document-tool.test.ts` | ❌ Wave 0 |
| SC-6 | document ingestion writes to `memory_chunks` + Phase 90 RRF surfaces it | integration | `npm test -- src/memory/__tests__/document-memory-bridge.test.ts` | ❌ Wave 0 |
| SC-7 | OCR low-confidence emits trigger-engine alert | unit | `npm test -- src/documents/__tests__/fail-mode-alerts.test.ts` | ❌ Wave 0 |
| SC-8 | Pon UAT — 24-page scanned PDF produces matching `ExtractedTaxReturn` | UAT (manual + scripted) | `scripts/uat/pon-tax-return.sh` (new) | ❌ Wave 0 — operator-curated truth file |
| SC-9 | (DEFERRED to Phase 101.5 per CF-3) — hybrid RRF over document_chunks improves precision@5 vs cosine-only | unit | `npm test -- src/documents/__tests__/hybrid-retrieval.test.ts` | N/A — not in Phase 101 scope |
| SC-10 | reranker orders 20 candidates correctly on synthetic relevance set | unit | `npm test -- src/documents/__tests__/reranker.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/documents`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + Pon UAT pass before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/documents/__tests__/type-detector.test.ts` — covers SC-1
- [ ] `src/documents/__tests__/ocr.test.ts` — covers SC-2
- [ ] `src/documents/__tests__/page-batcher.test.ts` — covers SC-3
- [ ] `src/documents/__tests__/structured-extract.test.ts` — covers SC-4
- [ ] `src/mcp/__tests__/ingest-document-tool.test.ts` — covers SC-5
- [ ] `src/memory/__tests__/document-memory-bridge.test.ts` — covers SC-6 (incl. CF-1 regression: `document:*` chunks survive 365-day time-window filter)
- [ ] `src/documents/__tests__/fail-mode-alerts.test.ts` — covers SC-7
- [ ] `scripts/uat/pon-tax-return.sh` + `tests/fixtures/pon-2024-1040.pdf` + `tests/fixtures/pon-2024-truth.json` — covers SC-8
- ~~`src/documents/__tests__/hybrid-retrieval.test.ts` — covers SC-9~~ (DEFERRED per CF-3 — moves to Phase 101.5)
- [ ] `src/documents/__tests__/reranker.test.ts` — covers SC-10
- [ ] Test fixtures directory: small text-PDF, small scanned-PDF (synthetic), small docx, small xlsx, sample image

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — IPC path, daemon-internal |
| V3 Session Management | No | N/A |
| V4 Access Control | Yes (per-agent) | Document store is per-agent SQLite; existing isolation pattern enforces |
| V5 Input Validation | **Yes** | All ingested file paths validated; reject paths outside agent workspace |
| V6 Cryptography | No | N/A |
| V7 Error Handling | Yes | Structured failures, no PII in logs |
| V8 Data Protection | **Yes** | Financial PII (SSN, account numbers) handled — redact in logs |
| V12 API & Web Service | Yes (MCP tool surface) | Validate all `ingest_document` params via zod |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `path` param | Tampering / Info Disclosure | `path.resolve` + assert under `<workspace>/inbox/` or `<workspace>/documents/` |
| OCR'd PII leaks into logs | Information Disclosure | Pre-log redaction regex for SSN (`\d{3}-?\d{2}-?\d{4}`), account numbers (`\b\d{8,16}\b` in financial context) |
| Malicious PDF (CVE-prone parsers) | Tampering / DoS | `pdf-parse` runs in-process — wrap in try/catch; consider sandboxing pdftoppm via systemd-run scope if exposed to untrusted input. Currently scoped to operator-supplied files only. |
| Claude vision payload smuggling | Tampering | Validate decoded image dimensions + size BEFORE send; reject >5MB after sharp resize |
| Schema injection (operator-curated schema fields) | Tampering | Schemas live in source code, not user input — no runtime injection vector |
| FTS5 injection | Tampering | Use prepared statements via better-sqlite3 (already standard practice in MemoryStore) |
| Tesseract subprocess escape | Tampering | `node-tesseract-ocr` shells out — pass file path as last arg, validate path beforehand |

---

## Environment Availability

| Dependency | Required By | Available on dev | Available on clawdy | Fallback |
|------------|------------|------------------|---------------------|----------|
| `tesseract` 5.x system binary | U2 primary | ✓ 5.3.4 | **✗ NOT INSTALLED** | tesseract.js WASM (slower) |
| `pdftoppm` (poppler-utils) | U3 | ✓ 24.02.0 | ✓ verified | None — blocking |
| `pdftotext` (poppler-utils) | U1 | ✓ 24.02.0 | ✓ verified | pdf-parse text probe |
| Node.js 22 LTS | All | ✓ | ✓ (per CLAUDE.md) | None |
| `@huggingface/transformers` 4.2.0 | All embedding + rerank | ✓ in stack | ✓ in stack | None |
| `sharp` 0.34.5 | U3 | ✓ in stack | ✓ in stack | None |
| `better-sqlite3` 12.8.0 + `sqlite-vec` 0.1.9 | All storage | ✓ in stack | ✓ in stack | None |
| Anthropic API access (Claude vision + Sonnet) | U2 fallback + U4 | ✓ via SDK | ✓ via SDK | None |
| New: `file-type` 22.0.1 | U1 | Adds via npm | Adds via npm | None |
| New: `node-tesseract-ocr` 2.2.1 | U2 | Adds via npm | Adds via npm | tesseract.js |
| New: `mammoth` 1.12.0 | docx handler | Adds via npm | Adds via npm | officeparser |
| New: `exceljs` 4.4.0 | xlsx handler | Adds via npm | Adds via npm | officeparser |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `tesseract` system binary on clawdy → tesseract.js WASM fallback (operationally less clean but viable). **Strongly recommend** Plan 01 includes the `apt install tesseract-ocr` step in the deploy precheck — but ship a viable fallback path so the phase isn't infra-gated.

---

## Assumptions Log

> Claims tagged `[ASSUMED]` need operator confirmation before they become locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Current document corpus per agent is <10K chunks | §1 baseline | If actually larger, sqlite-vec brute-force may be slower than estimated — Plan 04 (hybrid+rerank) targets adjust |
| A2 | Embedding ingest at 50ms/chunk on M-class CPU | §1 baseline | Off by 2-3× would push throughput targets |
| A3 | Mistral OCR 3 vendor benchmarks (74% win rate, 96.6% tables) are accurate | §2.1 | Vendor-reported; not third-party verified. Only matters if Mistral becomes Tier 4 escape hatch |
| A4 | Anthropic batch image limit "stricter 2000px on >20 image batches" still current | §2.1, §6 | If Anthropic loosens, page-batching constraint relaxes — no failure mode, just suboptimal batches |
| A5 | bge-reranker-base ONNX via `text-classification` pipeline works in `@huggingface/transformers` 4.2.0 | §2.6 | If incompatible at runtime, U9 falls back to skip-rerank — Plan 04 ships without it. Smoke-test in Wave 0. |
| A6 | Operator's `fin-acquisition` agent currently runs Phase 115 v1 (MiniLM) not v2 (bge-small int8) | §1 baseline | If already on v2, no change to plan; if cutover stuck, document ingestion uses v2 directly per CF-2 (DocumentStore is greenfield for v2) |
| A9 | No prior `vec_document_chunks` rows exist that need re-embedding when migrating to int8 schema (CF-2) | §CF-2 | If rows exist, Plan 01 needs a tiny one-shot re-embed pass instead of a clean schema recreate. Operator probes per-agent DB to confirm during discuss-phase. |
| A7 | `ExtractedTaxReturn` field accuracy ≥ 95% on Pon truth values | §5 | Setting too low/high — operator confirms in CONTEXT.md |
| A8 | Memory ceiling 500MB/agent at 50K chunks | §5 | Off by factor 2× either way is fine; instrumentation in Plan 03 surfaces actuals |

---

## Sources

### Primary (HIGH confidence — codebase or Context7-equivalent verification)
- `src/documents/store.ts` — DocumentStore schema, search SQL [VERIFIED]
- `src/documents/chunker.ts` — chunkText, chunkPdf [VERIFIED]
- `src/memory/memory-retrieval.ts` — Phase 90 RRF [VERIFIED]
- `src/memory/embedder.ts` — Phase 115 v1/v2 dispatcher [VERIFIED]
- `src/memory/migrations/embedding-v2.ts` — migration state machine [VERIFIED]
- `src/manager/daemon.ts:10989-11044` — ingest-document IPC [VERIFIED]
- `src/ipc/protocol.ts:215` — IPC method registration [VERIFIED]
- `package.json` — installed deps [VERIFIED]
- npm registry — verified all candidate package versions via `npm view <pkg> version` 2026-05-16

### Secondary (MEDIUM confidence — official docs cross-verified)
- [Anthropic Contextual Retrieval (Sept 2024)](https://www.anthropic.com/news/contextual-retrieval) — chunk augmentation + BM25 + rerank benchmarks
- [Vision - Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/vision) — image dimension limits, max images per request
- [GitHub issue 49537 — many-image 2000px limit](https://github.com/anthropics/claude-code/issues/49537) — corroborates stricter batch ceiling
- [Mistral OCR launch (Mistral AI)](https://mistral.ai/news/mistral-ocr) — vendor benchmark for Tier 4 escape hatch
- [Mistral OCR 3 launch (VentureBeat)](https://venturebeat.com/technology/mistral-launches-ocr-3-to-digitize-enterprise-documents-touts-74-win-rate) — $2/1000 pages pricing, 74% win rate
- [Late Chunking (Jina arXiv 2409.04701)](https://arxiv.org/abs/2409.04701) — context-preserving chunk embeddings
- [Late Chunking blog (Jina AI)](https://jina.ai/news/late-chunking-in-long-context-embedding-models/) — implementation details
- [Hugging Face — Xenova/bge-reranker-base](https://huggingface.co/Xenova/bge-reranker-base) — ONNX availability + usage example
- [Hugging Face — onnx-community/bge-reranker-v2-m3-ONNX](https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX) — multilingual reranker
- [sqlite-vec v0.1.0 release blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html) — stable release status
- [sqlite-vec ANN tracking issue #25](https://github.com/asg017/sqlite-vec/issues/25) — IVF status (experimental, not enabled)
- [vectorlite README](https://github.com/1yefuwang1/vectorlite) — HNSW alternative for >100K scale
- [pkgpulse 2026 — unpdf vs pdf-parse vs pdfjs-dist](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026) — modern PDF parsing comparison
- [ColPali arXiv 2407.01449](https://arxiv.org/abs/2407.01449) — visual late-interaction (rejected for Phase 101)
- [LangCopilot — Chunking Strategies 2025](https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide) — Vecta Feb 2026 benchmark, recursive vs semantic
- [Anthropic cookbook — contextual embeddings](https://platform.claude.com/cookbook/capabilities-contextual-embeddings-guide) — implementation reference

### Tertiary (LOW confidence — flagged with [ASSUMED])
- Per-chunk embedding latency 50ms — order-of-magnitude only [A2]
- Mistral OCR vendor benchmarks — vendor-reported, not third-party [A3]
- Anthropic stricter 2000px on >20 images — verified via Apr 2026 issue thread; subject to API evolution [A4]

---

## Metadata

**Confidence breakdown:**
- Standard stack (Tier 1 packages): HIGH — every npm package verified via `npm view` + slopcheck `[OK]`
- Architecture (4-plan split): HIGH — mirrors proven patterns (Phase 90 RRF, Phase 113 vision pre-pass, Phase 115 v2 dispatch)
- Pitfalls (Pon failure-mode trace): HIGH — concrete failure documented in commit history, mapped step-by-step to U1-U7 closure
- Reranker integration (U9): MEDIUM — depends on ONNX model runtime compat (smoke-test Wave 0 mitigates)
- Mistral OCR 3 as escape hatch: LOW — vendor benchmarks not third-party verified

**Research date:** 2026-05-16
**Valid until:** 2026-07-16 (60 days — stack stable, but Anthropic API evolution + new SOTA OCR releases warrant re-check)

---

## RESEARCH COMPLETE
