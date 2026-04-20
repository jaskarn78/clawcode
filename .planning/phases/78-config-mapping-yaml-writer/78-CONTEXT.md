# Phase 78: Config Mapping + YAML Writer - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the real write path for `clawcode migrate openclaw apply`: produce a merged `clawcode.yaml` where each migrated agent entry carries `soulFile:`/`identityFile:` pointers (not inline blobs), `mcpServers:` string refs to the existing top-level map, a mapped model id, and every pre-existing comment/ordering is preserved via atomic temp+rename. Adds schema fields + lazy loader + model map + YAML writer.

Delivers CONF-01 (soulFile/identityFile), CONF-02 (MCP refs + auto-inject), CONF-03 (model map + --model-map override), CONF-04 (atomic + comment-preserving write). Still does NOT write workspace files or re-embed memory (those are Phases 79, 80).

</domain>

<decisions>
## Implementation Decisions

### Schema Extension & Lazy Read
- **New optional agent fields:** `soulFile: z.string().optional()` and `identityFile: z.string().optional()` on `agentSchema` (src/config/schema.ts:640+). Coexist with existing inline `soul: z.string().optional()` / `identity: z.string().optional()`.
- **Precedence:** If `soulFile` is set, it wins over inline `soul`. Configuring both for the same agent is a load-time error via Zod `.superRefine` — prevents silent ambiguity.
- **Lazy read:** Extend `AgentMemoryManager.loadSoul()` in `session-memory.ts:204+`. Order: `config.soulFile` (expandHome'd, read at session boot) → fallback to `<workspace>/SOUL.md` → fallback to inline `config.soul`. Mirror for `loadIdentity()`.
- **Path format:** Absolute or `~/...`. Expanded via existing `expandHome()` at loader.ts resolution. Stored on `ResolvedAgentConfig` as `soulFile?: string`, `identityFile?: string`.
- **differ classification:** Mark `agents.*.soulFile` and `agents.*.identityFile` as `reloadable: true` — unlike `memoryPath` (which requires restart), a soul/identity path swap is safe mid-session (content is re-read lazily anyway).

### Model Mapping & MCP References
- **Model map:** Hard-coded `Record<string, string>` in `src/migration/model-map.ts`:
  - `anthropic-api/claude-sonnet-4-6` → `sonnet`
  - `anthropic-api/claude-opus-4-7` → `opus`
  - `anthropic-api/claude-haiku-4-5` → `haiku`
  - `anthropic-api/claude-sonnet-4-5` → `sonnet` (older versions fold up)
  - `anthropic-api/claude-opus-4-6` → `opus`
  - `minimax/abab6.5` → `minimax` (only if minimax model id exists on ClawCode side)
  - `clawcode/admin-clawdy` → `clawcode/admin-clawdy` (passthrough — ClawCode-native)
  - Unknown → emit `unmappable-model` warning in `plan` output, block `apply` unless `--model-map` override supplied.
- **`--model-map` flag:** Syntax `--model-map "<openclaw-id>=<clawcode-id>"`, repeatable. Parsed to `Record<string,string>` and merged on top of hard-coded defaults. Overrides persist into the written YAML.
- **MCP auto-injection:** Every migrated agent unconditionally gets `clawcode` and `1password` string refs in its `mcpServers:` list (additive — doesn't duplicate if already present).
- **Per-agent MCP mapping:** OpenClaw's per-agent MCP server names → looked up in existing top-level `mcpServers:` map (read from current `clawcode.yaml`). Found → string ref. Not found → `unknown-mcp-server` warning in `plan` output (not a hard error — operator curates the top-level map).

### YAML Round-trip & Atomic Write
- **YAML library:** Use `yaml` package's `Document` AST (already in deps via `src/config/loader.ts`). Parse existing file → `Document`, insert new agent nodes into `agents:` seq preserving key ordering at the agent-entry level, serialize with `toString({ lineWidth: 0 })` (disable line wrapping) → comments intact.
- **Atomic write:**
  ```
  tmpPath = ${dir}/.clawcode.yaml.${pid}.${timestamp}.tmp
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, clawcode.yaml)  // atomic on same filesystem
  ```
  `.clawcode.yaml.<pid>.<ts>.tmp` naming avoids collisions with concurrent runs. Tmp file in same dir (rename is atomic on same fs).
- **Comment preservation test:** Fixture `clawcode.before.yaml` with hand-edited `# v2.0 endpoint` / `# op://...` comments + custom key ordering. Run writer. Assert `diff before after | grep -E '^[-]'` returns zero (no removed lines) and every pre-existing comment appears verbatim in the after file.
- **Chokidar single-event assertion:** Integration test installs chokidar watcher on `clawcode.yaml`, runs writer, counts events over 500ms window — must be exactly 1 `change` event. Protects against partial-write races.
- **Secret guard integration:** Before rename, run Phase 77's `scanSecrets(proposedDocument)` — refuse write if any secret-shape detected in the new agent entries (not the whole file — existing entries outside migration scope aren't re-scanned).

### Claude's Discretion
- Exact `Document` AST node-insertion helpers — use whatever yaml package's public API exposes cleanly
- Unit test layout — follow Phase 76/77 patterns
- Model-map override merge strategy (user `--model-map` wins over hard-coded defaults) — obvious
- Error message copy — keep consistent with Phase 76/77 style

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `yaml` package in `src/config/loader.ts` — Document AST already used for parse; extend usage for write
- `expandHome()` helper — handles `~/...` expansion
- Zod `.superRefine` pattern — established Phase 75 for memoryPath conflict detection
- `scanSecrets` from Phase 77 `guards.ts` — reuse for pre-write secret scan
- `appendRow` on ledger — write witness row for each yaml write

### Established Patterns
- New migration modules in `src/migration/<name>.ts`
- Lazy-load + fallback chain in session-memory.ts for workspace files
- differ.ts `NON_RELOADABLE_FIELDS` list — soulFile/identityFile NOT on it (they're hot-reloadable)

### Integration Points
- Extend `src/config/schema.ts` agentSchema with `soulFile`, `identityFile` fields + `.superRefine` for mutual exclusion with inline `soul`/`identity`
- Extend `src/config/loader.ts` to resolve `soulFile`/`identityFile` via expandHome on ResolvedAgentConfig
- Extend `src/manager/session-memory.ts` `loadSoul()`/`loadIdentity()` with file-ref precedence
- New: `src/migration/model-map.ts` — hard-coded map + parse for --model-map flag
- New: `src/migration/yaml-writer.ts` — Document AST manipulation + atomic write
- New: `src/migration/config-mapper.ts` — transforms OpenclawSourceEntry + model-map + mcp-map → target clawcode agent entry
- Extend `src/cli/commands/migrate-openclaw.ts` apply subcommand — replace Phase 77's "apply not implemented" stub with real write path (secret-scanned, atomic, ledger-logged)

</code_context>

<specifics>
## Specific Ideas

- Literal warning text for unmappable model (per success criterion #3): `"⚠ unmappable model: <id> — pass --model-map \"<id>=<clawcode-id>\" or edit plan.json"` — use this copy verbatim.
- Temp file naming: `.clawcode.yaml.${process.pid}.${Date.now()}.tmp` — ensures uniqueness across concurrent runs.
- Chokidar test window: 500ms is enough to catch double-write races; longer windows add test flakiness.
- Test fixture preservation check: hash of every pre-existing line matches after write (byte-exact).

</specifics>

<deferred>
## Deferred Ideas

- Workspace file COPYING (SOUL.md, IDENTITY.md markdown content) from OpenClaw source to ClawCode target — Phase 79
- Memory re-embedding — Phase 80
- `verify` / `rollback` / `cutover` / `complete` — Phase 81, 82
- Auto-curation of top-level `mcpServers:` map — out of scope; operator task
- Interactive `--model-map` prompt (ask per unmappable model) — non-interactive flag-based is simpler
- YAML schema version bumping / migration — clawcode.yaml has no versioned schema, N/A

</deferred>
