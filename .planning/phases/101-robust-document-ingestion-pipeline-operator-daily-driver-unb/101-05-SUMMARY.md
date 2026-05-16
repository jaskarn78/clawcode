---
phase: 101-robust-document-ingestion-pipeline-operator-daily-driver-unb
plan: 05
status: SHIPPED-WITH-CARRYOVERS
shipped: 2026-05-16
gate: operator-deploy (autonomous: false)
duration: ~30 min wall-clock (deploy + 2 emergency fixes + verification)
---

# Phase 101 Plan 05: Operator-Gated Deploy + Pon UAT — Summary

Closing plan for Phase 101. Plans 01-04 had landed code overnight via the autonomous chain; Plan 05's job was the operator-gated deploy + live UAT + 24h soak. This SUMMARY captures what actually happened, including two emergency fixes that surfaced during the deploy.

## Tasks

| Task | Status | Notes |
|------|--------|-------|
| T01 — Operator deploy authorization checkpoint | ✅ DONE | Operator authorized "Do it. Deploy" 2026-05-16; Ramy confirmed quiet |
| T02 — Run `scripts/deploy-clawdy.sh` | ✅ DONE (with 2 emergency fixes — see Incidents) | Service live on clawdy at pid 3513500 |
| T03 — Live Pon UAT | ⚠ PARTIAL — synthetic fixture | 3/3 vitest tests pass against synthetic placeholder; real-truth swap deferred per operator decision (operator slept through overnight chain authorized the synthetic placeholder) |
| T04 — 24h soak observation | ⏸ wall-clock pending | Starts 2026-05-16 ~08:32 PDT; operator-grep `journalctl -u clawcode -g phase101-ingest` for failures over next 24h |
| T05 — Phase-end push | ✅ DONE | All Phase 101 commits batched to origin/master |

## Deploy timeline

| Time (PDT 2026-05-16) | Event |
|------------------------|-------|
| 08:21:54 | Initial `scripts/deploy-clawdy.sh` invoked |
| 08:21:54 | Phase 101 D-01 precheck **caught missing tesseract-ocr** — deploy aborted cleanly per Plan 01 T06 precheck design |
| 08:22:?? | `ssh clawdy 'sudo apt-get install -y tesseract-ocr'` — installed Tesseract 5.5.0 |
| 08:22:27 | Retry deploy — clean build + stage + md5 verify |
| 08:22:39 | **INCIDENT 1: ERR_MODULE_NOT_FOUND `file-type`** — daemon crashloop |
| 08:23-08:24 | Manual recovery — scp package.json + package-lock.json to clawdy, `npm ci` in /opt/clawcode/ (28s, 682 packages) |
| 08:24:35 | Service restart succeeds — pid 3505785 |
| 08:29:34 | **INCIDENT 2: Claude Code native binary not found** — agents failing with "musl variant ELF interpreter missing" |
| 08:31-08:32 | Diagnosed: SDK 0.2.140 F5() variant lookup tries musl-first, glibc-fallback. Both installed by npm ci. Manual workaround: `mv claude-agent-sdk-linux-x64-musl → .DISABLED-glibc-host` |
| 08:32:18 | Final service restart — pid 3513500, NRestarts=0, clean boot |
| 08:32:43 | Admin Clawdy warm-path ready |
| 08:32:46 | fin-acquisition warm-path ready |
| 08:32:?? - 08:35:?? | Remaining 8 agents enter "stopped + ready" state (warm path complete; agents spin on first message) |

Total outage: ~5 minutes across two incidents.

## Incidents (and the deploy-script hardenings they triggered)

### Incident 1 — `npm ci` not part of deploy

**Symptom:** Daemon ERR_MODULE_NOT_FOUND for `file-type` package immediately after first successful deploy.

**Root cause:** Phase 101 Plan 01 added 6 new npm dependencies (`file-type`, `node-tesseract-ocr`, `mammoth`, `exceljs`, `pdf-parse`, `tesseract.js`). The `scripts/deploy-clawdy.sh` flow staged + deployed only the bundled `dist/cli/index.js`; it never synced `package.json`/`package-lock.json` to clawdy and never ran `npm install` there. The bundled code path-imported `file-type` at runtime (not bundled by tsup — marked external) and clawdy's stale node_modules (last touched 2026-05-07) didn't have it.

**Fix (already shipped commit `f488778`):** Deploy script now:
1. Compares local `package-lock.json` md5 vs `/opt/clawcode/package-lock.json` md5 before staging
2. On mismatch (or MISSING remote): rsync `package.json` + `package-lock.json` to staging
3. In the sudo block: cp lockfile into `/opt/clawcode` + chown to clawcode + `sudo -u clawcode bash -c 'cd /opt/clawcode && npm ci --no-audit --no-fund'` **BEFORE** systemctl restart
4. Steady-state (lockfile unchanged): zero extra remote work, one md5 round-trip
5. Dry-run preview added; header docstring updated

**Resilience characteristic:** Any future phase that adds npm deps will now self-heal on deploy. No more "deploy succeeds, service crashloops" pattern.

### Incident 2 — Claude Agent SDK musl variant on glibc host

**Symptom:** Agents failed every message with "Claude Code native binary not found at /opt/clawcode/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable."

**Root cause:** Claude Agent SDK 0.2.140's native-binary lookup function (`sdk.mjs` `F5`) on Linux tries `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl` BEFORE `@anthropic-ai/claude-agent-sdk-linux-${arch}` and returns the first that `require.resolve`s:

```js
G=(Q==="linux"
   ? [`@anthropic-ai/claude-agent-sdk-linux-${X}-musl`,
      `@anthropic-ai/claude-agent-sdk-linux-${X}`]
   : [`@anthropic-ai/claude-agent-sdk-${Q}-${X}`]
  ).map((U)=>`${U}/claude${J}`);
```

The SDK installs all 8 platform variants as `optionalDependencies` with per-package `libc: ["musl"]` and `libc: ["glibc"]` tags. NPM's libc-aware filtering should skip the musl variant on a glibc host, but on this Ubuntu 24.04 box it didn't — both got installed. The musl binary's ELF interpreter (`/lib/ld-musl-x86_64.so.1`) doesn't exist on glibc → exec returns ENOENT → SDK reports "binary not found" (despite the file being on disk).

**Fix (already shipped commit `f22fabb`):** Deploy script's `npm ci` block now includes an idempotent post-step that renames `claude-agent-sdk-linux-x64-musl` → `.DISABLED-glibc-host` after every `npm ci`. The SDK's `require.resolve` then fails on the musl path and falls through to the glibc binary at `claude-agent-sdk-linux-x64/claude`.

**Resilience characteristic:** Future `npm ci` runs (e.g., on new-dep-adding phases) automatically re-disable the musl variant. The workaround is captured in the deploy script docstring with link to SDK F5() function in `sdk.mjs`.

**Upstream report TODO:** This is a Claude Agent SDK bug; F5() should check `process.report.header.glibcVersionRuntime` to pick the variant rather than assuming musl-first. Captured for follow-up; not blocking ClawCode operationally as long as the deploy-script workaround is in place.

## SC coverage final

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | File-type detection + handler dispatch | ✅ MET | Plan 01 T02; 6-fixture parameterized tests pass; deployed binary contains `detectDocumentType` |
| SC-2 | OCR fallback (Tesseract → WASM → Claude vision) | ✅ MET | Plan 01 T03; tesseract-ocr 5.5.0 installed on clawdy; static-grep confirms `claude-haiku-4-5` / `claude-sonnet-4-5` in deployed bundle |
| SC-3 | Page-batching with dimension control | ✅ MET | Plan 01 T04; DIMENSION_MAX_PX=2000, MAX_PAGES=500 enforced |
| SC-4 | Structured extraction with zod schemas | ✅ MET | Plan 02 T02/T03; `ExtractedTaxReturn` shape locked per D-06; zod 4 native `z.toJSONSchema()` |
| SC-5 | `ingest_document` MCP tool — single entry point | ✅ MET | Plan 02 T04; live tools/list probe confirmed tool registered + `grep -rn ingest_document src/cli/` returns 0 (silent-path-bifurcation guard) |
| SC-6 | Memory cross-ingest + CF-1 filter exemption | ✅ MET | Plan 03; 14-day filter allow-list includes `document:` prefix; 94/94 tests pass |
| SC-7 | Fail-mode alerts to admin-clawdy | ✅ MET | Plan 02 T05; `recordIngestAlert` reuses Phase 127 JSONL writer pattern |
| **SC-8** | **Pon UAT ≥95% field accuracy vs operator truth** | **⚠ PARTIAL** | 3/3 pon-uat.test.ts vitest cases pass against SYNTHETIC placeholder `tests/fixtures/pon-2024-truth.json`. Real-truth swap deferred to operator follow-up (placeholder explicitly flagged `_SYNTHETIC_PLACEHOLDER: true` with `_swap_procedure` documented in-file). |
| SC-10 | Local cross-encoder reranker | ✅ MET | Plan 04; Wave-0 GATE PASSED — `Xenova/bge-reranker-base` loaded + scored in 3.76s; 11/11 reranker tests; 0 Phase 90 RRF regressions |

## Live evidence on clawdy

- **Service:** `systemctl is-active clawcode` → `active` (pid 3513500, ActiveEnterTimestamp Sat 2026-05-16 08:32:18 PDT, NRestarts=0)
- **Bundle has Phase 101 code:** `grep -c ingest_document /opt/clawcode/dist/cli/index.js` = 3; `grep -c ExtractedTaxReturn /opt/clawcode/dist/cli/index.js` = 5
- **Tool registered:** stdio MCP handshake against `/opt/clawcode/dist/cli/index.js mcp` returns 31 tools including `ingest_document`, `search_documents`, `delete_document`
- **Heartbeat:** `checkCount: 14` with `homelab-refresh` registered (Phase 999.47 still live)
- **All 10 agents in glibc-compatible state:** post-musl-disable, no agents reporting "native binary not found"
- **Admin Clawdy + fin-acquisition warm-path complete** before this SUMMARY landed

## Performance targets (Plan 05 verification gates — observation begins now)

| Metric | Target (per RESEARCH.md §5) | Status |
|--------|------------------------------|--------|
| text-PDF ingestion | ≥ 5 pages/sec | Pending operator first real ingest |
| scanned-PDF (Tesseract local) | ≥ 0.5 pages/sec | Pending operator first scanned ingest |
| Retrieval p95 with reranker | ≤ 200ms | Pending operator first retrieval-heavy turn |
| Memory footprint per agent at corpus N=10K chunks | <2 GB | Pending soak |
| API tokens per ingested document | <$0.10 typical | Pending operator first ingest |

These are wall-clock measurements that accumulate over the 24h soak.

## Operator handoff — what's left for you

**Sequence whenever you're ready:**

1. **Real Pon UAT** (closes SC-8):
   ```bash
   # Edit the fixture — swap _SYNTHETIC_PLACEHOLDER values for real Pon 2024 truth
   $EDITOR tests/fixtures/pon-2024-truth.json

   # Re-run UAT
   npx vitest run tests/document-ingest/pon-uat.test.ts

   # Live ingest on clawdy via ingest_document MCP tool
   # (copy Pon's actual 2024 tax return PDF to fin-acquisition's workspace,
   #  invoke ingest_document with taskHint="high-precision", capture output)
   ```

2. **24h soak verification:**
   ```bash
   ssh clawdy 'journalctl -u clawcode --since "2026-05-16 08:32" -g phase101-ingest' | grep -E "failureReason|consecutiveFailures" | head -20
   # Expected: zero failures across the operator's daily workflow
   ```

3. **SC-8 final-MET commit** when real Pon UAT passes:
   ```
   docs(101-05): SC-8 MET — Pon UAT verified against real 2024 truth values
   ```

4. **Plan 101.5 follow-ups (not blocking):**
   - U8 hybrid-RRF + FTS5 on DocumentStore (deferred per CF-3; re-open if direct `search-documents` precision regresses)
   - Mistral OCR 3 API client implementation (stub-that-throws shipped; flesh out if any document defeats Tesseract + Claude vision)
   - Additional structured-extraction schemas: `ExtractedBrokerageStatement`, `Extracted401kStatement`, `ExtractedADV` (operator-curated; add as concrete needs surface)

## Deploy-script hardenings (carry-over for any future phase)

The two emergency fixes that landed during Plan 05 are now baked into `scripts/deploy-clawdy.sh`. Any future phase that:
- Adds new npm dependencies → deploy auto-runs `npm ci` on lockfile change
- Inherits the Claude Agent SDK musl/glibc issue → musl variant auto-disabled after every `npm ci`

No special-case handling needed in those phases.

## Commits landed in Plan 05 surface

| Commit | Subject |
|--------|---------|
| `f488778` | fix(deploy): sync package.json + run npm ci on lockfile change (Phase 101-fu) |
| `f22fabb` | fix(deploy): disable musl variant of claude-agent-sdk after npm ci (Phase 101-fu) |
| (this commit) | docs(101-05): summary — Plan 05 deploy + 2 emergency fixes + SC-8 PARTIAL handoff |

## Phase 101 totals

- **Plans:** 5/5 closed
- **Tasks:** 19 atomic commits (T01-T06 Plan 01 × 6, T02-T05 Plan 02 × 4 + 2 fixes + addendum, T01-T03 Plan 03 × 3, T01-T02 Plan 04 × 2 + 1 fu, T01-T05 Plan 05 × 4 effective) = 19 task-level commits + plan SUMMARYs + 2 deploy-script fixes + STATE/ROADMAP
- **Lines of code:** ~3,500 (engine + schemas + MCP tool + cross-ingest + reranker + deploy hardening)
- **Tests:** Plan 01 103, Plan 02 76, Plan 03 94, Plan 04 11 + 17 baseline RRF + 5 CF-1 = ~300 pass
- **Deps added:** 6 npm (file-type, node-tesseract-ocr, mammoth, exceljs, pdf-parse, tesseract.js) + clawdy apt: tesseract-ocr
- **Pre-existing test failures untouched:** 60+ in unrelated subsystems (conversation-brief, migrate-skills, daemon-openai, etc.)
- **Outage during deploy:** ~5 min total across 2 incidents (8:21 → 8:32 PDT)

## Status: SHIPPED-WITH-CARRYOVERS

SC-1..SC-7 + SC-10 MET in code + live. SC-8 PARTIAL pending operator real-truth fixture swap. Performance targets (SC perf-1..5) start accumulating on the 24h soak.

Phase 101 is the v2.7 milestone's highest-leverage operator-daily-driver feature; ships the ingestion-side gap that caused the 2026-04-28 Pon failure. The two deploy-script fixes are operator-survival improvements that will benefit every future phase.

---

*Phase: 101-robust-document-ingestion-pipeline-operator-daily-driver-unb*
*Plan: 05*
*Closed: 2026-05-16 ~09:00 PDT*
*Live on clawdy: pid 3513500, deployed 08:32:18 PDT*
