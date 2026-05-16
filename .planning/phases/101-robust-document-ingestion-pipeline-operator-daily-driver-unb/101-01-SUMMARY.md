---
phase: 101-robust-document-ingestion-pipeline-operator-daily-driver-unb
plan: 01
subsystem: document-ingestion + embeddings
tags: [ingestion, ocr, sqlite-vec, embedV2, deploy-precheck, phase101]
requires:
  - Phase 49 RAG (memory_chunks + vec_memory_chunks)
  - Phase 113 vision pre-pass pattern (Haiku/Sonnet vision)
  - Phase 115 embedV2 / bge-small int8 embedder
  - poppler-utils (pdftoppm) on clawdy
  - sharp ≥0.34 (already in stack)
provides:
  - src/document-ingest/ engine (detect + handlers + OCR + batching + telemetry)
  - vec_document_chunks int8[384] schema (CF-2 + D-09)
  - scripts/deploy-clawdy.sh tesseract-ocr precheck (D-01)
  - phase101-ingest structured log tag (operator grep target)
affects:
  - src/manager/daemon.ts (ingest-document + search-documents IPC)
  - src/documents/store.ts (DocumentStore schema + ingest/search signatures)
  - scripts/deploy-clawdy.sh
tech-stack:
  added:
    - file-type@22.0.1 (magic-byte sniff)
    - node-tesseract-ocr@2.2.1 (Tier-1 OCR CLI wrapper)
    - tesseract.js@7.0.0 (Tier-2 WASM fallback)
    - mammoth@1.12.0 (.docx text extraction)
    - exceljs@4.4.0 (.xlsx cell extraction)
  patterns:
    - Phase 113 vision pattern reused inside src/document-ingest/ocr/claude-vision.ts
    - Phase 49 atomic-tmp-rename pattern reused inside scanned-pdf renderer
    - phase101-ingest log tag mirrors phase127-resolver / phase136-llm-runtime JSON-tag pattern
key-files:
  created:
    - src/document-ingest/types.ts
    - src/document-ingest/telemetry.ts
    - src/document-ingest/detect.ts
    - src/document-ingest/index.ts
    - src/document-ingest/page-batch.ts
    - src/document-ingest/ocr/index.ts
    - src/document-ingest/ocr/tesseract-cli.ts
    - src/document-ingest/ocr/tesseract-wasm.ts
    - src/document-ingest/ocr/claude-vision.ts
    - src/document-ingest/handlers/text-pdf.ts
    - src/document-ingest/handlers/scanned-pdf.ts
    - src/document-ingest/handlers/docx.ts
    - src/document-ingest/handlers/xlsx.ts
    - src/document-ingest/handlers/image.ts
    - src/document-ingest/handlers/text.ts
    - tests/document-ingest/{telemetry,detect,ocr-fallback,page-batch,embedder-v2}.test.ts
    - tests/fixtures/document-ingest/{sample-text.pdf,sample-scanned.pdf,sample.docx,sample.xlsx,sample.png}
    - tests/deploy/tesseract-precheck.test.sh
  modified:
    - package.json + package-lock.json (5 new deps)
    - src/documents/store.ts (int8[384] migration + ingest/search signature widening)
    - src/documents/__tests__/store.test.ts (fakeEmbedding flipped Float32→Int8)
    - src/manager/daemon.ts (CF-2 cutover in ingest-document + search-documents)
    - scripts/deploy-clawdy.sh (D-01 tesseract precheck)
decisions:
  - "sqlite-vec int8 column syntax is `int8[384]`, NOT `vector_int8[384]` (verified by Database :memory: probe; plan literal was wrong)"
  - "sqlite-vec int8 binding requires raw bytes wrapped via the `vec_int8(?)` SQL cast on BOTH INSERT and MATCH; bare Int8Array/Buffer binds as float32"
  - "search-documents IPC also flips to embedV2 (not just ingest-document) — leaving search on Float32 would break MATCH against the new int8 column"
  - "DocumentStore.ingest()/search() signatures widened to accept Int8Array | Float32Array; Float32 branch is a TODO removable once Plan 03 lands memory_chunks dual-write"
  - "Pre-existing src/documents/__tests__/store.test.ts fakeEmbedding flipped Float32Array → Int8Array (greenfield-for-v2 per D-09)"
  - "Tesseract precheck inline in scripts/deploy-clawdy.sh (NOT a separate operator-action checkpoint) per planner ratification of researcher recommendation"
  - "pdf-parse kept at the project's existing ^2.4.5 — plan's pdf-parse@^1.1.1 would have been a breaking downgrade for chunkPdf"
metrics:
  duration: "~70 minutes"
  completed: 2026-05-16
  commits: 6 task commits + 1 summary commit
  tasks: 6
  tests-added: 38 (5 telemetry, 7 detect, 7 ocr-fallback, 11 page-batch, 9 embedder-v2 - 1 dup picker test that lives in both modules, plus 4 deploy-precheck shell assertions)
  files-changed: ~30
---

# Phase 101 Plan 01: Ingestion Engine Foundation Summary

JWT-style canonical one-liner: **Document-ingestion engine — magic-byte type detection, three-tier OCR fallback (Tesseract CLI → WASM → Claude vision Haiku/Sonnet), page batching under 2000px/5-page/25MB caps, plus the vec_document_chunks int8[384] schema migration that completes the CF-2 embedder cutover at the daemon's ingest-document + search-documents call sites.**

## What Shipped

### 1. Document-ingestion engine (`src/document-ingest/`)

- **`detect.ts`** — `detectDocumentType(buf, filename)` classifies into the six DocumentType branches. PDF disambiguation feeds the buffer to `pdf-parse` v2, strips its `-- N of N --` page-separator artifact, and treats empty trimmed output as `scanned-pdf`. ZIP-based Office formats disambiguate by filename extension.
- **Six per-type handlers** (`handlers/`):
  - `text-pdf.ts` — pdf-parse v2, page split on `-- N of N --` markers (fallback: form-feed `\f`).
  - `scanned-pdf.ts` — `pdftoppm` argv-array spawn (no shell), 150 DPI rasterization, sharp resize to ≤2000px long-side. OCR runs at engine entrypoint, not in handler.
  - `docx.ts` — `mammoth.extractRawText`.
  - `xlsx.ts` — exceljs per-sheet cell iteration; one BatchedPage per worksheet.
  - `image.ts` — sharp resize, single page.
  - `text.ts` — utf-8 decode.
- **`page-batch.ts`** — `batchPages()` greedy bin-packer + constants: `DEFAULT_BATCH_SIZE=5`, `MAX_BATCH_BYTES=25MB`, `DIMENSION_MAX_PX=2000`, `MAX_PAGES=500`. `IngestError` class for cap violations.
- **`telemetry.ts`** — `logIngest()` emits one `phase101-ingest` JSON line per ingestion. Required fields validated at runtime: `docSlug, type, pages, ocrUsed, chunksCreated, p50_ms, p95_ms`. Per T-101-02 the emitter never logs extracted text content.

### 2. Three-tier OCR fallback (`src/document-ingest/ocr/`)

- **Tier 1: Tesseract CLI** (`tesseract-cli.ts`) — wraps `node-tesseract-ocr` (LSTM engine, psm=6). Confidence: 0.75 for non-empty pages (above the 0.70 D-01 threshold), 0 for empty (forces fallback). Image buffer written to OS tmpdir; argv-array spawn (T-101-01 mitigation).
- **Tier 2: tesseract.js WASM** (`tesseract-wasm.ts`) — lazy-singleton worker; real per-page 0-100 confidence normalized to [0,1].
- **Tier 3: Claude vision** (`claude-vision.ts`) — D-02: `claude-haiku-4-5` default, `claude-sonnet-4-5` on `taskHint: 'high-precision'`. Image pre-resized to `DIMENSION_MAX_PX=2000` via sharp before send — direct mitigation for the 2026-04-28 Pon-tax-return many-image / over-2000px failure (canonical issue 49537 + T-101-04).
- **Orchestrator** (`index.ts`) — each tier wrapped in try/catch so a missing binary or WASM init crash slides through to the next tier. `skipCli`/`skipWasm` test seams.

### 3. CF-2 embedder cutover + D-09 schema migration

- **`src/documents/store.ts`** (NOT `src/memory/store.ts` — Rule 3 path correction):
  - `vec_document_chunks` column type: `float[384]` → **`int8[384]`**.
  - `migrateDocumentChunksToInt8(db)` — idempotent: no-op on fresh DB or already-int8 table; DROPs + clears `document_chunks` rows on detected `float[384]` (greenfield per D-09). Runs from constructor before `initSchema()`.
  - `ingest()` + `search()` signatures widened: `readonly Int8Array[] | readonly Float32Array[]`. Float32 branch is a TODO-removable dead-code safety net.
  - Prepared statements: INSERT uses `VALUES (?, vec_int8(?))`, SELECT uses `WHERE v.embedding MATCH vec_int8(?)`.
  - Bind path: Int8Array → `Buffer.from(buf, byteOffset, byteLength)` so shared-buffer typed-array views don't bleed extra bytes.
- **`src/manager/daemon.ts`** — both `case "ingest-document":` AND `case "search-documents":` flipped from `embedder.embed()` → `embedder.embedV2()`. Inline `CF-2 (Phase 101 D-09)` comments at both sites.

### 4. Deploy precheck (D-01)

- **`scripts/deploy-clawdy.sh`** — between password-file pre-flight and the dry-run preview, runs `ssh "$HOST" 'which tesseract'` and exits 1 with the documented `apt-get install -y tesseract-ocr` hint on miss. Skipped under `--dry-run` (dry-run prints the precheck intent line).

## Deviations from Plan

### Auto-fixed Issues (no operator gate needed)

**1. [Rule 3 - Wrong file path]** Plan referenced `src/memory/store.ts` for the schema migration, but `vec_document_chunks` actually lives at `src/documents/store.ts` (verified via repo grep). Edits routed to the actual file; documented in commit message and the acceptance grep at the plan-spec level became inapplicable.

**2. [Rule 3 - sqlite-vec syntax]** Plan called for `vector_int8[384]` but sqlite-vec rejects that grammar ("could not parse table option 'emb vector_int8[384]…'"). Canonical syntax verified via `Database :memory: + sqliteVec.load + db.exec(...)` probe is `int8[384]`. Used `int8[384]`.

**3. [Rule 3 - sqlite-vec int8 binding]** A bare `Int8Array` or `Buffer` parameter binds as float32 and the column-type assertion rejects the row. Fix: bind raw bytes via `Buffer.from(arr.buffer, byteOffset, byteLength)` AND wrap the SQL parameter with the `vec_int8(?)` cast on both INSERT and the MATCH side of SELECT. Same pattern for query embeddings in `search()`.

**4. [Rule 3 - search-documents needed embedV2 too]** Plan only named the write path at `daemon.ts:11011` for CF-2. But once `vec_document_chunks` is `int8[384]`, the `search-documents` path's Float32 query vector would fail MATCH against the int8 column. Flipped both sites to `embedV2()`.

**5. [Rule 3 - DocumentStore.ingest signature widening]** Plan called for a same-commit signature widening (advisor flagged this explicitly). Done — `ingest()` and `search()` both accept `Int8Array | Float32Array`. Float32 branch left as a TODO-removable safety net per Plan 03 (memory_chunks dual-write coordination).

**6. [Rule 3 - pre-existing tests broke under int8 migration]** `src/documents/__tests__/store.test.ts` previously bound 1536-byte Float32Array embeddings into the now-int8 column. Flipped `fakeEmbedding()` from `Float32Array` to `Int8Array` (greenfield-for-v2 per D-09 — no row data migration needed). All 12 pre-existing DocumentStore tests pass.

**7. [Rule 3 - pdf-parse version]** Plan suggested adding `pdf-parse@^1.1.1` but the project already has `pdf-parse@^2.4.5` wired into `src/documents/chunker.ts`. Downgrade would have broken `chunkPdf`. Kept the existing 2.x. The "6 deps" acceptance check became 5 — documented.

**8. [Rule 3 - pdf-lib not in stack]** Plan T02 suggested generating fixtures via `pdf-lib`. Since `pdf-lib` is not installed and slopcheck wasn't run on it, took the boring path: handcrafted minimal binary fixtures (~10KB total) generated via exceljs + a hand-rolled docx zipper + a 592-byte text-PDF written byte-by-byte + ImageMagick `convert` for the scanned PDF + sharp for the PNG. All committed under `tests/fixtures/document-ingest/`.

**9. [Rule 3 - deploy-clawdy.sh variable name]** Plan snippet used `$CLAWDY_HOST` but the existing script uses `$HOST`. Fixed inline.

**10. [Rule 3 - exceljs Buffer type]** `wb.xlsx.load(buffer)` types want `Buffer<ArrayBuffer>` but Node's `Buffer` is `Buffer<ArrayBufferLike>`. Cast through `unknown` to `ArrayBuffer` to satisfy tsc; runtime contract identical.

### Auth Gates / Architectural Decisions

None. No Rule 4 surfaces hit; no auth gates triggered (the OCR Claude-vision tests mock the SDK at the module boundary so no live OAuth path was exercised).

## Test Coverage

- `tests/document-ingest/telemetry.test.ts` — 5 cases (emit shape, tag value, two missing-field rejections, optional-field preservation).
- `tests/document-ingest/detect.test.ts` — 7 cases (one per DocumentType branch + ingest() stub).
- `tests/document-ingest/ocr-fallback.test.ts` — 7 cases (cli-ok, cli-low→wasm, wasm-low→haiku, taskHint→sonnet, CLI-thrown→wasm, D-02 model picker mapping × 2).
- `tests/document-ingest/page-batch.test.ts` — 11 cases (constants, 3 batching cases, empty input, MAX_PAGES rejection, 6 handler dispatch cases end-to-end).
- `tests/document-ingest/embedder-v2.test.ts` — 9 cases (int8 schema assertion, ingest/search signature widening × 2, three migration paths, three CF-2 static greps).
- `src/documents/__tests__/store.test.ts` — 12 pre-existing cases now pass under int8 schema.
- `tests/deploy/tesseract-precheck.test.sh` — 4 shell assertions (syntax-ok, ≥2 tesseract refs, apt-install hint, D-01 marker).

**Totals:** 59 vitest cases pass; tsc clean; shellcheck — only pre-existing info-level warnings in `deploy-clawdy.sh`, no new diagnostics introduced.

## Wiring Status

Engine modules are **built but not yet exposed**:

- **Not yet wired through MCP** — Plan 02 ships the `ingest_document` MCP tool surface + the U4 structured extraction (`ExtractedTaxReturn`).
- **Not yet cross-ingested into memory_chunks** — Plan 03 ships the U6 cross-ingest + CF-1 (`applyTimeWindowFilter` allow-list extension for `document:` paths).
- **Not yet reranking** — Plan 04 ships the U9 bge-reranker-base.
- **Not yet deployed** — Plan 05 closes the phase with operator-gated deploy + UAT.

The daemon's `case "ingest-document":` IPC handler at `src/manager/daemon.ts:10989` still uses the legacy `chunkPdf`/`chunkText` path (NOT yet the new `src/document-ingest/index.ts` engine entrypoint). Plan 02 makes that swap when wiring the MCP tool. Today's CF-2 cutover is targeted at the embedder call only — `embed()` → `embedV2()` — preserving the existing chunker contract.

## Known Stubs

None. The engine entrypoint is fully wired through real handlers; OCR fallback executes the real Tesseract CLI / WASM / Anthropic SDK paths (tests mock these but production wiring is live).

## Threat Flags

None. The plan's `<threat_model>` enumerated T-101-01 through T-101-SC; all are mitigated in this plan:

- **T-101-01** (path injection → Tesseract CLI): mitigated by `node-tesseract-ocr`'s argv-array API + nanoid'd tempfile path.
- **T-101-02** (text in logs): mitigated by `telemetry.ts` emitting only metadata.
- **T-101-03** (DoS via 10000-page PDF): mitigated by `MAX_PAGES=500` in `page-batch.ts` + `handleScannedPdf` pre-render check.
- **T-101-04** (oversized image to Claude vision): mitigated by sharp resize to `DIMENSION_MAX_PX=2000` in `claude-vision.ts` AND in `scanned-pdf.ts` + `image.ts` handlers.
- **T-101-SC** (slopsquatted packages): all 5 new packages were slopcheck-verified in the researcher's audit table; `pdf-parse` already pinned in-tree.

No new threat surface introduced beyond what the model documented.

## Self-Check: PASSED

- src/document-ingest/types.ts: FOUND
- src/document-ingest/telemetry.ts: FOUND
- src/document-ingest/detect.ts: FOUND
- src/document-ingest/index.ts: FOUND
- src/document-ingest/page-batch.ts: FOUND
- src/document-ingest/ocr/{index,tesseract-cli,tesseract-wasm,claude-vision}.ts: FOUND
- src/document-ingest/handlers/{text-pdf,scanned-pdf,docx,xlsx,image,text}.ts: FOUND
- tests/document-ingest/{telemetry,detect,ocr-fallback,page-batch,embedder-v2}.test.ts: FOUND
- tests/fixtures/document-ingest/{sample-text.pdf,sample-scanned.pdf,sample.docx,sample.xlsx,sample.png}: FOUND
- tests/deploy/tesseract-precheck.test.sh: FOUND
- T01 commit 853ee12: FOUND
- T02 commit 765ddc6: FOUND
- T03 commit c3219c1: FOUND
- T04 commit 467a75d: FOUND
- T05 commit 433103b: FOUND
- T06 commit 878aedf: FOUND
- All 59 vitest cases pass; tsc clean.
