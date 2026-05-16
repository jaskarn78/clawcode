# Phase 101: Robust Document-Ingestion Pipeline + 2026-era RAG Upgrade — Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Autonomous-mode discuss — Claude picked all 9 open-question defaults per researcher's recommendations (operator authorized 2026-05-15: "autonomous mode, Claude picks defaults across the board"). Research artifact at `101-RESEARCH.md` (commits `9a7f392` + `935516f`) is the source-of-truth for rationale.

<domain>
## Phase Boundary

Build a **production-grade document-ingestion pipeline** that handles the 2026-04-28 Pon-tax-return failure modes (silent-garbage UTF-8 from scanned PDFs, image-dimension-limit errors, claim-but-fail outputs) AND opportunistically upgrades the retrieval stack with the **highest-ROI 2026 RAG techniques** the researcher identified.

**Operator directive (2026-05-16):** "the rag engine should be thoroughly researched and try to implement cutting edge implementations for blazing fast performance." The researcher's finding: ClawCode's Phase 49 + 90 + 113 + 115 baseline is already competent 2025-era RAG; the Pon failure was an **ingestion-path gap**, not a retrieval-quality gap. Therefore Phase 101's "cutting-edge" lift focuses on:

- **Ingestion (Tier 1 / Pon-blocking):** file-type detection (U1), OCR fallback Tesseract→Claude vision (U2), page-batching with dimension control (U3), structured extraction via Anthropic tool-use + zod schemas (U4), single-entry-point MCP tool (U5), fail-mode alerts (U7), embedder v2 cutover for the document write path (CF-2), schema migration `vec_document_chunks` float[384]→int8[384]
- **Retrieval (Tier 2 / high-ROI):** local cross-encoder reranker (U9, `Xenova/bge-reranker-base` via existing ONNX runtime) applied over Phase 90 RRF top-20 → keep top-5
- **Memory cross-ingest (U6 + CF-1):** every document chunk also writes into `memory_chunks`/`vec_memory_chunks`/`memory_chunks_fts` with `path: "document:<slug>"` so Phase 90 hybrid-RRF surfaces it on subsequent turns; the 14-day `applyTimeWindowFilter` is extended to allow-list `document:` paths so documents don't silently expire after 2 weeks

**Explicitly NOT in scope (Tier 3 — researched + deferred with rationale in `101-RESEARCH.md` §4):**
- Embedding-model upgrade beyond Phase 115's bge-small int8 (Phase 115 isn't even cut-over yet; reranker dominates the precision win)
- ColPali / ColQwen2 visual late-interaction multi-vector storage (re-open at >10K visual-only docs/agent)
- Late chunking via Jina v3 (requires 8192-token embedder not in stack)
- Contextual retrieval (Anthropic 2024 — adds Haiku pre-pass per chunk; cleaner as standalone follow-up phase)
- HyDE / query rewriting (financial-doc queries are term-rich; hybrid+rerank covers the value)
- Mistral OCR 3 API (vendor dependency; off-by-default escape hatch only — wired but disabled at v1)
- Alternative vector stores (LanceDB / Qdrant / vectorlite) — not needed until ≥100K chunks/agent OR p95 retrieval > 200ms
- U8 hybrid-RRF + FTS5 on DocumentStore — researched, then resolved CF-3: U6 cross-ingest carries operator-turn retrieval via Phase 90 RRF on `memory_chunks`; U8 only matters for the direct `search-documents` MCP tool. Defer to Phase 101.5 if precision regressions on document-scoped search surface
- Phase 49 RAG infra rewrite — baseline (`memory_chunks` + `vec_memory_chunks` + `memory_chunks_fts` + Phase 90 RRF) is competent; only the document-write surface gets new tables

</domain>

<decisions>
## Implementation Decisions

### D-01 — OCR backend (researcher §8 Q1)
**Decision:** **Tesseract CLI on clawdy** as primary OCR (Tier 1), Claude vision (Haiku 4.5 by default, Sonnet on `taskHint: "high-precision"`) as fallback when Tesseract confidence < 70%. **`apt install tesseract-ocr` is a deploy-time prereq** — wire into `scripts/deploy-clawdy.sh` precheck.
**Rationale:** Best accuracy + lowest CPU for the offline path; falls back to Claude vision only when document quality demands it; preserves the Anthropic-credit-budget posture (cheap Tesseract first, paid API only when warranted).
**Fallback (locked):** if clawdy `apt install tesseract-ocr` proves operationally painful, replace with `tesseract.js` 7.0.0 WASM in-process (~2× slower, zero deploy prereq). Plan 01 must check tesseract-ocr availability on clawdy and surface an explicit "tesseract-not-installed" deploy gate.

### D-02 — Claude vision model selection (researcher §8 Q2)
**Decision:** **Dynamic per call** — Haiku 4.5 default (~$0.005/page), Sonnet 4.5 on `taskHint: "high-precision"` (~$0.015/page).
**Rationale:** Operator-tunable per document. Most ingestion is bulk + acceptable on Haiku; tax returns with messy tabular cells justify the Sonnet escalation.

### D-03 — Cross-ingest into memory_chunks (researcher §8 Q3)
**Decision:** **Always cross-ingest every document chunk** → `memory_chunks` + `vec_memory_chunks` (or `_v2` per Phase 115 dual-write coordination) + `memory_chunks_fts`. Chunk path convention: `path: "document:<doc-slug>"`. **CF-1 fix locked into Plan 03:** extend `applyTimeWindowFilter` allow-list in `src/memory/memory-chunks.ts:166-175` to exempt `document:` prefix so documents survive the 14-day expiry (existing allow-list already exempts `/memory/vault/` and `/memory/procedures/` — same pattern).
**Rationale:** Per CF-3, U6 cross-ingest is the load-bearing architectural decision and makes Phase 90 RRF the operator-turn retrieval path. U8 hybrid-RRF on DocumentStore becomes redundant for that surface. Storage doubling is acceptable at current corpus scale; revisit if growth surfaces pain.

### D-04 — Reranker scope (researcher §8 Q4)
**Decision:** **Include U9 in Phase 101 as Plan 04** (NOT split to Phase 101.5). Local `Xenova/bge-reranker-base` via existing `@huggingface/transformers` ONNX runtime.
**Rationale:** Researcher cites -67% retrieval failure rate (Anthropic benchmark) — biggest precision win per CPU-second. Same ONNX runtime as current MiniLM embedder, ~100ms additional latency. ~100 LOC + warmup hook.
**Wave-0 smoke test (locked):** Plan 04 Task 1 MUST first verify `pipeline('text-classification', 'Xenova/bge-reranker-base')` loads + scores a `(query, passage)` pair end-to-end on the dev box. If load fails (ONNX model availability OR tokenizer compat), U9 splits to a follow-up phase; Phase 101 closes with Plans 01-03 + Plan 05 only.

### D-05 — U8 hybrid-RRF on DocumentStore (researcher §8 Q5)
**Decision:** **DEFER to Phase 101.5.** CF-3 resolved.
**Rationale:** U6 cross-ingest carries operator-turn retrieval through Phase 90 RRF on `memory_chunks` — that's the primary retrieval surface. U8 only matters for direct `search-documents` MCP tool calls scoped to documents-only. Re-open if operator hits precision regressions on direct document-scoped search post-deploy. Document FTS5 (`document_chunks_fts`) is greenfield (not yet built) — Phase 101.5 lands the FTS5 table + hybrid-RRF code together.

### D-06 — Initial `ExtractedTaxReturn` schema (researcher §8 Q6)
**Decision:** **Ship Pon-tax-return canonical schema in Plan 02:**
```typescript
ExtractedTaxReturn = z.object({
  taxYear: z.number().int(),
  taxpayerName: z.string(),
  box1Wages: z.number().nullable(),
  scheduleC: z.object({
    netProfit: z.number().nullable(),
    grossReceipts: z.number().nullable(),
    expenses: z.array(z.object({ category: z.string(), amount: z.number() })),
  }).nullable(),
  backdoorRoth: z.object({ amount: z.number(), year: z.number() }).nullable(),
  iraDeduction: z.number().nullable(),
  qbi: z.object({ deduction: z.number() }).nullable(),
  extractionSchemaVersion: z.literal("v1"),
})
```
Additional schemas (`ExtractedBrokerageStatement`, `Extracted401kStatement`, `ExtractedADV`) deferred — operator adds as concrete daily-workflow needs surface.

### D-07 — Schema versioning + re-extract strategy (researcher §8 Q7)
**Decision:** **Version the schema; do NOT auto-reextract historical documents.** Every extracted record carries `extractionSchemaVersion: "v1"`. When the schema evolves to v2, historical v1 records remain valid; operator opt-in re-extract via `ingest_document --force <path>`.
**Rationale:** Auto-reextract on schema bump would burn API tokens unbounded. Operator chooses when to spend.

### D-08 — Mistral OCR 3 escape hatch (researcher §8 Q8)
**Decision:** **Wire as off-by-default Tier 4 backend.** Plan 02 includes a `defaults.documentIngest.allowMistralOcr: boolean` config knob (default `false`). When `true`, `ingest_document --backend mistral` becomes selectable; otherwise the flag throws "Mistral OCR backend disabled in config".
**Rationale:** Researcher recommendation YES — covers the edge case where Tesseract + Claude vision both fall short on weird document formats. Adds vendor dependency, so default-off until operator regression evidence justifies.
**Out of scope:** the Mistral API client + auth — wired as a stub in v1 (throws "not yet implemented"); the operator can flesh it out via a 30-LOC follow-up commit if/when they hit a failing document.

### D-09 — Embedding cutover (researcher §8 Q9)
**Decision:** **YES — DocumentStore is greenfield for v2.** All new document writes via `embedder.embedV2()` (Phase 115 bge-small int8). Schema migration `vec_document_chunks: float[384] → int8[384]` is a one-time recreate (no v1 history to preserve in DocumentStore — confirmed by researcher).
**Rationale:** CF-2 — explicit code change at `src/manager/daemon.ts:11011` from `embedder.embed()` → `embedder.embedV2()`. Skips the dual-write dance that `vec_memory_chunks` requires for v1-history compatibility.
**Cross-write coordination (CF-2):** U6 cross-ingest into `vec_memory_chunks` MUST honor the agent's Phase 115 migration phase. Default behavior: on first document ingestion, auto-flip the target agent to Phase 115 `dual-write` mode if it's still in `v1-only`. Plan 03 owns this wiring.

### Claude's Discretion (planner-decided in plan-phase)

- Exact task split within each plan (researcher recommends 4-7 tasks per plan; planner refines).
- Test-fixture sourcing for Pon UAT — operator-curated truth values are CF-5 checkpoint (Plan 02 Task 1 is a `checkpoint:human-verify` blocking on `tests/fixtures/pon-2024-truth.json` landing).
- Atomic-commit-per-task discipline — operator hard rule (one commit per `<task>` ID).
- Performance instrumentation surface (new `phase101-ingest` structured log tag mirroring `phase136-llm-runtime` / `phase127-resolver` pattern).
- Whether Plan 01 includes the `tesseract-ocr` apt-install precheck inside `scripts/deploy-clawdy.sh` OR as a separate "operator-action: ssh apt install" checkpoint task. Researcher recommends inline precheck; planner ratifies.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase artifacts (this phase)
- `.planning/phases/101-robust-document-ingestion-pipeline-operator-daily-driver-unb/101-RESEARCH.md` — 715-line research output. §1 baseline, §2 cutting-edge survey, §3 comparison matrix, §4 ROI-prioritized recommendations (Tier 1/2/3), §5 performance targets, §6 Pon UAT walkthrough, §7 phasing recommendation, §8 open decisions (all now locked in this CONTEXT), §validation/security/env sections at bottom. **CF-1, CF-2, CF-3, CF-5 critical findings are embedded throughout — planner MUST honor.**

### Phase trigger + acceptance
- `.planning/ROADMAP.md` — Phase 101 section ("Robust document-ingestion pipeline (operator-daily-driver unblock)") with 8 sub-scope candidates + UAT case (Pon 2025 tax return ingested with structured `ExtractedTaxReturn` output)
- 2026-04-28 Pon-tax-return debug session — canonical regression artifact; phase ships when fin-acquisition can re-ingest Pon's 2025 return cleanly

### Existing primitives to reuse
- `src/memory/store.ts` — Phase 49 RAG schema: `memory_chunks` + `vec_memory_chunks` + `memory_chunks_fts` (FTS5)
- `src/memory/memory-retrieval.ts` — Phase 90 hybrid-RRF (vector + BM25). The retrieval algorithm operator turns consume.
- `src/memory/memory-chunks.ts:166-175` — `applyTimeWindowFilter` (14-day expiry with `/memory/vault/` + `/memory/procedures/` allow-list). **CF-1 amends this to also allow-list `document:` prefix.**
- `src/manager/daemon.ts:10989` — current `ingest-document` IPC handler
- `src/manager/daemon.ts:11011` — current `embedder.embed()` (v1 MiniLM 384-dim) call site. **CF-2 switches this to `embedder.embedV2()` for the document path.**
- `src/ipc/protocol.ts:215` — `ingest-document` IPC method signature
- `src/discord/vision-pre-pass.ts` (Phase 113) — Haiku vision pattern reused for OCR fallback shape
- `@huggingface/transformers` 4.0.1 — ONNX runtime for local embedder (already in stack); same runtime hosts the bge-reranker-base in Plan 04
- `sharp` (already in stack via Phase 113) — image resize for U3 page-batching dimension control
- `pdftoppm` from `poppler-utils` — PDF→image rendering; **`poppler-utils` already on clawdy per researcher's deploy probe; `tesseract-ocr` NOT installed (deploy prereq for Plan 01)**

### Anti-patterns + constraints
- `feedback_silent_path_bifurcation.md` — single source-of-truth: `ingest_document` is THE entry point; no parallel ingestion paths.
- `feedback_no_auto_deploy.md`, `feedback_ramy_active_no_deploy.md` — Plan 05 deploy is operator-gated, autonomous: false. Plans 01-04 ship code only.
- `feedback_push_at_phase_end.md` — push only after Plan 05 closes the phase.
- `feedback_executor_no_stash_pop.md` — no git stash in executor agents.
- CLAUDE.md "Deploy" section — `scripts/deploy-clawdy.sh` is the canonical deploy path; precheck for `tesseract-ocr` belongs there.

### External sources cited by researcher
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — deferred to follow-up, but documented baseline
- [Claude Vision API Docs](https://platform.claude.com/docs/en/build-with-claude/vision) — image-dimension limits (Pon failure root cause)
- [Hugging Face — Xenova/bge-reranker-base](https://huggingface.co/Xenova/bge-reranker-base) — Plan 04 model
- [Hugging Face — onnx-community/bge-reranker-v2-m3-ONNX](https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX) — fallback if bge-reranker-base lacks ONNX support
- [Late Chunking arXiv 2409.04701](https://arxiv.org/abs/2409.04701) — deferred, documented
- [Mistral OCR launch](https://mistral.ai/news/mistral-ocr) — Tier 4 escape hatch
- [sqlite-vec v0.1.0 stable](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html) — current vector store
- [pkgpulse 2026 PDF parsing comparison](https://www.pkgpulse.com/blog/unpdf-vs-pdf-parse-vs-pdfjs-dist-pdf-parsing-extraction-nodejs-2026) — `pdf-parse` chosen for text-PDF probe
- [Claude Code issue 49537](https://github.com/anthropics/claude-code/issues/49537) — 2000px many-image limit (canonical Pon-failure ticket)
- [LangCopilot — Chunking Strategies 2025](https://langcopilot.com/posts/2025-10-11-document-chunking-for-rag-practical-guide) — chunking baseline
- [ColPali arXiv 2407.01449](https://arxiv.org/abs/2407.01449) — deferred, documented

### Package additions (all verified by `slopcheck` per researcher)
- `file-type@22.0.1` — magic-byte sniff (Plan 01)
- `node-tesseract-ocr@2.2.1` — Tesseract CLI wrapper (Plan 01, conditional on apt prereq)
- `mammoth@1.12.0` — docx text extraction
- `exceljs@4.4.0` — xlsx parsing
- `pdf-parse` (planner confirms version) — text-PDF probe
- `tesseract.js@7.0.0` — WASM fallback if apt-install path fails (Plan 01 fallback)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 49 RAG** (`src/memory/store.ts`, `src/memory/memory-retrieval.ts`) — full retrieval pipeline already shipped. Phase 101 adds the WRITE surface for documents; READ surface (Phase 90 RRF) is reused unchanged.
- **Phase 113 vision pre-pass** (`src/discord/vision-pre-pass.ts`) — Haiku 4.5 vision call pattern reused for Claude vision OCR fallback in U2.
- **Phase 115 bge-small int8 embedder** (`embedder.embedV2()`) — Phase 101 uses this as the default embedding for the document write path (greenfield, no v1 history dance needed).
- **Phase 127 `recordStall` JSONL writer** — Plan 02 reuses this pattern for U7 fail-mode alerts to admin-clawdy.
- **`scripts/deploy-clawdy.sh`** — canonical deploy path; Plan 01 extends it with a `tesseract-ocr` precheck (or treats install as separate operator action — planner picks).
- **`@huggingface/transformers` 4.0.1 ONNX runtime** — hosts both the embedder AND Plan 04's bge-reranker-base. Zero new runtime dependency.

### Established Patterns
- Structured log line for operator-grep: `phase101-ingest {docSlug, pages, type, ocrUsed, chunksCreated, p50_ms, p95_ms, apiCostUsd}` mirrors `phase136-llm-runtime` / `phase127-resolver` JSON-tag pattern.
- Atomic temp+rename for any new file write under `~/.clawcode/agents/<agent>/documents/` (Phase 96 pattern).
- Zod-validated config schema additions: `defaults.documentIngest` block with `allowMistralOcr`, `tesseractConfidenceThreshold`, `pageBatchSize`, `dimensionMaxPx`, `visionModelDefault`, `visionModelHighPrecision`. Per-agent overrides via standard cascade. Non-reloadable fields go in `NON_RELOADABLE_FIELDS`.
- New IPC method shape: extend `ingest-document` to accept `taskHint?: string` + `extract?: "text"|"structured"|"both"` in the request.

### Integration Points
- **`src/manager/daemon.ts:10989-11011`** — existing `ingest-document` IPC. Plan 02 extends with the U5 MCP tool surface + U4 structured extraction call. CF-2 changes `embedder.embed()` to `embedder.embedV2()` at line 11011.
- **`src/memory/memory-chunks.ts:166-175`** — CF-1 allow-list extension. 1 LOC + regression test.
- **`src/mcp/server.ts`** — register the new `ingest_document` MCP tool surface (Plan 02 Task — planner picks the exact location).
- **`src/heartbeat/checks/`** — no new check module required (ingestion is pull-only via MCP tool, no background tick).
- **`scripts/deploy-clawdy.sh`** — Plan 01 adds tesseract-ocr install precheck OR an explicit operator-action checkpoint.

</code_context>

<specifics>
## Specific Ideas

- **Pon 2025 tax return is the canonical UAT artifact.** Phase ships when fin-acquisition can `ingest_document /path/to/pon-2024-tax-return.pdf` and produce a complete `ExtractedTaxReturn` matching operator-curated truth values (`tests/fixtures/pon-2024-truth.json` — Plan 02 Task 1 checkpoint).
- **The structured log tag is `phase101-ingest`** — single grep target for operator telemetry across CLI/Discord/dashboard.
- **First-class telemetry fields per ingest:** `docSlug` (slug of input filename), `pages` (page count), `type` (text-pdf/scanned-pdf/docx/xlsx/image/text), `ocrUsed` (tesseract|claude-haiku|claude-sonnet|mistral|none), `ocrConfidence` (float 0-1 when applicable), `chunksCreated` (int), `p50_ms` + `p95_ms` (per-page wall-clock during ingestion), `apiCostUsd` (running total).
- **Performance targets (Plan 05 verification gates):**
  - text-PDF ≥ 5 pages/sec
  - scanned-PDF Tesseract ≥ 0.5 pages/sec
  - retrieval p95 ≤ 200ms WITH reranker (vs current ~80ms baseline)
  - precision@5 measurably improved on synthetic financial-doc Q&A test set (planner picks exact metric)
- **Workspace layout for ingested artifacts:** text saved to `<workspace>/documents/<doc-slug>-<date>.md`; structured output to `<workspace>/documents/<doc-slug>-<date>.json`. Both atomic temp+rename. Phase 49 RAG ingestion writes alongside.

</specifics>

<deferred>
## Deferred Ideas

All researched (with rationale in `101-RESEARCH.md` §4 Tier 3 table), explicitly NOT pursued in Phase 101:

- **U8 hybrid-RRF + FTS5 on DocumentStore** — defer to Phase 101.5 (CF-3 resolution; U6 cross-ingest covers the operator-turn surface)
- **Embedding-model upgrade beyond Phase 115 bge-small int8** (bge-m3, jina-v3, e5-large-v2) — Phase 115 itself isn't cut-over yet; reranker dominates the precision win
- **ColPali / ColQwen2 visual late-interaction** — re-open at >10K visual-only docs/agent
- **Late chunking (Jina v3)** — requires 8192-token embedder not in stack
- **Contextual retrieval (Anthropic 2024)** — adds Haiku pre-pass per chunk; cleaner as standalone follow-up
- **HyDE / query rewriting** — financial-doc queries are term-rich; hybrid+rerank covers the value at lower cost
- **Mistral OCR 3 API client implementation** — D-08 wires the config knob + selectable flag, but the actual client is a stub-that-throws. Operator implements when a specific document warrants it.
- **Alternative vector stores (LanceDB / Qdrant / vectorlite)** — not needed until ≥100K chunks/agent OR p95 retrieval > 200ms
- **Learned fusion (monoT5)** — bge-reranker-base covers the same value
- **`ExtractedBrokerageStatement` / `Extracted401kStatement` / `ExtractedADV` schemas** — operator-curated; add as concrete daily-workflow needs surface (per D-06)
- **Auto-reextract on schema bump** — opt-in via `ingest_document --force` only (per D-07)
- **`/voice/calibration` aggregator returning null-on-samples>0** — reelforge-container bug surfaced 2026-05-16; NOT Phase 101 scope. Captured in reelforge container followups.

</deferred>

---

*Phase: 101-robust-document-ingestion-pipeline-operator-daily-driver-unb*
*Context gathered: 2026-05-16 (autonomous mode — Claude picked all defaults per operator authorization)*
*Research artifact: `101-RESEARCH.md` (commits `9a7f392` + `935516f`)*
