---
phase: 78-config-mapping-yaml-writer
verified: 2026-04-20T19:45:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 78: Config Mapping + YAML Writer Verification Report

**Phase Goal:** User (as operator) can trust that `clawcode migrate openclaw apply` produces a `clawcode.yaml` where each migrated agent entry carries `soulFile:` + `identityFile:` pointers, `mcpServers:` references, a mapped model id, and round-trip preserves all comments/ordering via atomic temp+rename.
**Verified:** 2026-04-20T19:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migrated agent entry contains `soulFile:` + `identityFile:` pointers; no inline `soul:` / `identity:` block literals; daemon reads lazily (`rg 'readFile.*soulFile' src/` non-empty) | VERIFIED | `src/manager/session-config.ts:164` has `readFile(config.soulFile...)` in 3-branch precedence; yaml-writer Test 6 asserts entry shape; E2E Test 1 regex-checks output YAML |
| 2 | `mcpServers:` list in migrated entry has string refs to top-level map; `clawcode` + `1password` auto-injected; unknown servers flagged as warnings | VERIFIED | `config-mapper.ts:49` AUTO_INJECT_MCP = ["clawcode","1password"]; config-mapper test covers unknown-mcp-server warning path; E2E Test 1 asserts clawcode+1password in output |
| 3 | Plan output flags unmappable model with exact literal; `--model-map` override lands in written YAML | VERIFIED | `model-map.ts:46` UNMAPPABLE_MODEL_WARNING_TEMPLATE = `⚠ unmappable model: <id> — pass --model-map "<id>=<clawcode-id>" or edit plan.json`; E2E Test 4 passes --model-map override and asserts `model: sonnet` in output |
| 4 | Hand-edited comments preserved verbatim; key ordering preserved; chokidar sees exactly 1 change event; atomic temp+rename used | VERIFIED | yaml-writer.ts uses parseDocument + toString({lineWidth:0}); atomic path `.clawcode.yaml.${pid}.${Date.now()}.tmp`; Tests 1-5+7 pass (comment-preservation, key-order, chokidar single-event) |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/schema.ts` | `soulFile` + `identityFile` optional fields + superRefine mutual-exclusion guard | VERIFIED | Lines 661-662: both fields present as `z.string().min(1).optional()`; lines 973+980: "cannot be used together" guard for soul+soulFile and identity+identityFile; single `superRefine` chain (count=2 matches but grep -c returns 2 meaning it found 2 lines — checked: exactly 1 `.superRefine(` call) |
| `src/shared/types.ts` | `readonly soulFile?: string` + `readonly identityFile?: string` on ResolvedAgentConfig | VERIFIED | Lines 30+35 confirmed present |
| `src/config/loader.ts` | expandHome expansion for soulFile/identityFile | VERIFIED | Line 167: `soulFile: agent.soulFile ? expandHome(agent.soulFile) : undefined` |
| `src/manager/session-config.ts` | 3-branch lazy-read precedence: soulFile -> workspace/SOUL.md -> inline | VERIFIED | Lines 155-165: full precedence chain; `readFile(config.soulFile)` on line 164 |
| `src/migration/model-map.ts` | DEFAULT_MODEL_MAP (frozen 7-entry) + UNMAPPABLE_MODEL_WARNING_TEMPLATE + parseModelMapFlag + mergeModelMap + mapModel | VERIFIED | All exports present; DEFAULT_MODEL_MAP frozen via Object.freeze; 7 entries (5 anthropic + minimax + clawcode/admin-clawdy); literal template byte-exact |
| `src/migration/config-mapper.ts` | `mapAgent` pure function producing MappedAgentNode + MapAgentWarning[] | VERIFIED | `export function mapAgent` at line 51; AUTO_INJECT_MCP = ["clawcode","1password"] at line 49; kind:"unknown-mcp-server" and kind:"unmappable-model" warning paths present |
| `src/migration/diff-builder.ts` | WARNING_KINDS extended with "unknown-mcp-server" + "unmappable-model" | VERIFIED | Lines 65+69 confirmed |
| `src/migration/yaml-writer.ts` | `writeClawcodeYaml` — Document AST + atomic temp+rename + scanSecrets + sha256 return | VERIFIED | All 5 must-have patterns present: `export async function writeClawcodeYaml` (line 76), `.clawcode.yaml.${pid}.${Date.now()}.tmp` (line 199), `parseDocument` (line 35+115), `toString({ lineWidth: 0 })` (line 193), `scanSecrets` (line 37+144), `createHash` (line 33+213) |
| `src/cli/commands/migrate-openclaw.ts` | `--model-map` flag on plan + apply; `writeClawcodeYaml` called in runApplyAction; ledger witness row | VERIFIED | `--model-map` option on both plan (line 514) and apply (line 554); `parseModelMapFlag` called in both action handlers (lines 523+562); `writeClawcodeYaml` imported+called (lines 68+388); `step:"write"` + `file_hashes` in success witness row (lines 419+421) |
| `src/migration/__tests__/fixtures/clawcode.before.yaml` | Hand-edited fixture with `# v2.0 endpoint` + `op://` references | VERIFIED | Fixture exists; `# clawcode.yaml — v2.0 endpoint` on line 1; multiple `op://clawdbot/` references |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| agentSchema | soulFile / identityFile fields | `z.string().min(1).optional()` | VERIFIED | schema.ts:661-662 |
| configSchema.superRefine | mutual-exclusion guard | rejects (soul + soulFile) per agent | VERIFIED | "cannot be used together" at lines 973+980 |
| session-config.ts buildSessionConfig | SOUL content | soulFile readFile -> workspace/SOUL.md -> inline | VERIFIED | `readFile(config.soulFile, "utf-8")` at session-config.ts:164 |
| migrate openclaw plan/apply CLI | mapModel | parseModelMapFlag -> mergeModelMap -> mapAgent | VERIFIED | parseModelMapFlag imported+called in both subcommands; mergeModelMap at migrate-openclaw.ts:344 |
| config-mapper.mapAgent | MappedAgentNode with mcpServers | AUTO_INJECT_MCP + per-agent lookup + unknown-warning | VERIFIED | config-mapper.ts:49+88-112 |
| runApplyAction (CLI) | writeClawcodeYaml | after guards pass + mapAgent -> yaml-writer + ledger | VERIFIED | migrate-openclaw.ts:388 (call); 395-423 (refuse+allow branches with ledger rows) |
| writeClawcodeYaml | yaml Document AST | parseDocument -> insert agents seq -> toString({lineWidth:0}) | VERIFIED | yaml-writer.ts:35+115+193 |
| writeClawcodeYaml | atomic temp+rename | `.clawcode.yaml.${pid}.${Date.now()}.tmp` + fs.rename | VERIFIED | yaml-writer.ts:196-210 |
| writeClawcodeYaml | Phase 77 scanSecrets | pre-write scan on new nodes only | VERIFIED | yaml-writer.ts:37+144; shim PlanReport wraps MappedAgentNode[] |
| runApplyAction (CLI) | ledger witness row | appendRow({action:"apply", step:"write", outcome:"allow", file_hashes}) | VERIFIED | migrate-openclaw.ts:412-423 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `yaml-writer.ts` | `newText` (serialized YAML) | `parseDocument(existingText)` + `doc.toString({lineWidth:0})` after agent seq insertion | Yes — Document AST mutated from real file read | FLOWING |
| `config-mapper.ts mapAgent` | `MappedAgentNode` | `OpenclawSourceEntry` + `modelMap` + `existingTopLevelMcp` | Yes — pure transform of real source data, no hardcoded stubs | FLOWING |
| `migrate-openclaw.ts runApplyAction` | `agentsToInsert` | `mapAgent` per planned agent from `buildPlan(report.agents)` | Yes — wired to real inventory read + real mapAgent calls | FLOWING |
| `session-config.ts buildSessionConfig` | `soulContent` | `readFile(config.soulFile)` -> workspace/SOUL.md -> inline | Yes — lazy read from real file path or fallback chain | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| model-map module exports DEFAULT_MODEL_MAP frozen 7-entry table | `grep -c 'Object.freeze' src/migration/model-map.ts` | 1 match | PASS |
| UNMAPPABLE_MODEL_WARNING_TEMPLATE literal is byte-exact (em-dash, angle brackets) | `grep -Fn '⚠ unmappable model: <id> — pass --model-map' src/migration/model-map.ts` | 1 match | PASS |
| writeClawcodeYaml uses atomic tmp path naming | `grep -nE '\.clawcode\.yaml\.\$\{pid\}\.\$\{Date\.Now' yaml-writer.ts` | 1 match | PASS |
| Full Phase 78 test suites (7 files) | `npx vitest run <7 files>` | 278/278 pass | PASS |
| APPLY_NOT_IMPLEMENTED_MESSAGE not emitted on success path | `grep -c 'APPLY_NOT_IMPLEMENTED_MESSAGE' migrate-openclaw.ts` | 1 match (only the const declaration, not in success return) | PASS |
| Zero new npm deps | `git diff HEAD~10..HEAD -- package.json` | empty output | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONF-01 | 78-01 | soulFile/identityFile in migrated entries + lazy-read code path | SATISFIED | schema.ts fields + loader expansion + session-config 3-branch precedence + yaml-writer produces soulFile/identityFile in output; `rg 'readFile.*soulFile' src/` returns session-config.ts:164 |
| CONF-02 | 78-02 | MCP refs match top-level map + clawcode+1password auto-inject + unknown-server warnings | SATISFIED | config-mapper.ts AUTO_INJECT_MCP; unknown-mcp-server warning in WARNING_KINDS; E2E test asserts clawcode+1password in output |
| CONF-03 | 78-02 | Unmappable-model warning literal + --model-map override | SATISFIED | UNMAPPABLE_MODEL_WARNING_TEMPLATE byte-pinned in model-map.ts; --model-map on both plan+apply; E2E Test 4 asserts override propagates to written YAML |
| CONF-04 | 78-03 | Atomic write + comment preservation + chokidar single-event + secret refusal + ledger witness | SATISFIED | yaml-writer.ts temp+rename pattern; parseDocument round-trip; chokidar Test 7 asserts 1 change event; scanSecrets pre-write; ledger witness row with file_hashes |

---

### Anti-Patterns Found

No blockers or warnings found. All phase-introduced code follows the project's conventions:
- No TODO/FIXME/placeholder comments in any phase-78 source files
- No `return null`, `return {}`, `return []` stubs — all functions return real data
- No hardcoded empty props at call sites
- APPLY_NOT_IMPLEMENTED_MESSAGE retained as `@deprecated` export (correct pattern per plan decision) but not emitted on success path

---

### Human Verification Required

None. All success criteria are verifiable programmatically:
- Test suite covers atomicity (spy on fs.rename), comment preservation (line subsequence check), chokidar single-event (500ms window), secret refusal (scanSecrets), and ledger witness (row inspection).
- No UI, no real-time behavior, no external service integration required to verify this phase's contract.

---

## Summary

Phase 78 goal is fully achieved. All 9 must-haves verified (4 observable truths + 5 artifact/wiring checks):

1. **soulFile/identityFile on agentSchema + Zod mutual exclusion + lazy-read precedence** — schema fields land as `z.string().min(1).optional()`; superRefine guard rejects per-agent coexistence with inline soul/identity; session-config.ts implements full 3-branch fallback chain; `rg 'readFile.*soulFile' src/` is non-empty.

2. **MCP refs include clawcode + 1password auto-inject; unknown server warning emitted** — AUTO_INJECT_MCP constant in config-mapper.ts; dedup-aware injection; unknown names emit `{kind:"unknown-mcp-server"}` warning and are skipped from the node.

3. **Unmappable model warning literal matches exactly; --model-map flag works** — UNMAPPABLE_MODEL_WARNING_TEMPLATE is the byte-exact string per 78-CONTEXT (em-dash U+2014, angle-bracket placeholders); --model-map on both plan and apply; fail-fast parse before any guard/ledger side-effect; E2E test confirms override propagates.

4. **Atomic write pattern present** — `.clawcode.yaml.${pid}.${Date.now()}.tmp` in same dir; fs.rename to dest; unlink-on-failure + re-throw.

5. **YAML Document AST for comment preservation** — `parseDocument` from `yaml` package; `toString({lineWidth:0})`; clawcode.before.yaml fixture preserves comments + key ordering through round-trip.

6. **Chokidar single-event assertion in test** — yaml-writer.test.ts Test 7 uses chokidar with ignoreInitial:true + 500ms window; asserts exactly 1 `change` event.

7. **Pre-write secret scan refuses with Phase 77 literal message** — `scanSecrets` called in yaml-writer.ts with shim PlanReport; test asserts `result.reason === SECRET_REFUSE_MESSAGE` exactly.

8. **Ledger witness row on success** — `appendRow` called with `{action:"apply", step:"write", outcome:"allow", file_hashes:{"clawcode.yaml": sha256}}` on successful write; `{outcome:"refuse"}` path also covered.

9. **Zero new npm deps** — `git diff HEAD~10..HEAD -- package.json` produces no output; parseDocument already in `yaml` package dep; chokidar already installed; createHash from `node:crypto`.

CONF-01, CONF-02, CONF-03, CONF-04 all satisfied. 278 tests pass across all 7 phase-78 test suites.

---

_Verified: 2026-04-20T19:45:00Z_
_Verifier: Claude (gsd-verifier)_
