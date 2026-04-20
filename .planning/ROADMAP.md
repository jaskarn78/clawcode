# Roadmap: ClawCode

## Milestones

- :white_check_mark: **v1.0 Core Multi-Agent System** - Phases 1-5 (shipped 2026-04-09)
- :white_check_mark: **v1.1 Advanced Intelligence** - Phases 6-20 (shipped 2026-04-09)
- :white_check_mark: **v1.2 Production Hardening & Platform Parity** - Phases 21-30 (shipped 2026-04-09)
- :white_check_mark: **v1.3 Agent Integrations** - Phases 31-32 (shipped 2026-04-09)
- :white_check_mark: **v1.4 Agent Runtime** - Phases 33-35 (shipped 2026-04-10)
- :white_check_mark: **v1.5 Smart Memory & Model Tiering** - Phases 36-41 (shipped 2026-04-10)
- :white_check_mark: **v1.6 Platform Operations & RAG** - Phases 42-49 (shipped 2026-04-12)
- :white_check_mark: **v1.7 Performance & Latency** - Phases 50-56 (shipped 2026-04-14)
- :white_check_mark: **v1.8 Proactive Agents + Handoffs** - Phases 57-63 (shipped 2026-04-17)
- :white_check_mark: **v1.9 Persistent Conversation Memory** - Phases 64-68 + 68.1 (shipped 2026-04-18)
- :white_check_mark: **v2.0 Open Endpoint + Eyes & Hands** - Phases 69-74 (shipped 2026-04-20)
- :arrow_forward: **v2.1 OpenClaw Agent Migration** - Phases 75-82 (active, started 2026-04-20)

## Phases

<details>
<summary>v1.0 Core Multi-Agent System (Phases 1-5) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

Phases 1-5 delivered: central config, agent lifecycle, Discord routing, per-agent memory, heartbeat framework.

</details>

<details>
<summary>v1.1 Advanced Intelligence (Phases 6-20) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

Phases 6-20 delivered: memory consolidation, relevance/dedup, tiered storage, task scheduling, skills registry, agent collaboration, Discord slash commands, attachments, thread bindings, webhook identities, session forking, context summaries, MCP bridge, reaction handling, memory search CLI.

</details>

<details>
<summary>v1.2 Production Hardening & Platform Parity (Phases 21-30) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

Phases 21-30 delivered: tech debt cleanup, config hot-reload, context health zones, episode memory, delivery queue, subagent Discord threads, security & execution approval, agent bootstrap, web dashboard.

</details>

<details>
<summary>v1.3 Agent Integrations (Phases 31-32) - SHIPPED 2026-04-09</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

Phases 31-32 delivered: subagent thread skill (Discord-visible subagent work via skill interface), MCP client consumption (per-agent external MCP server config with health checks).

</details>

<details>
<summary>v1.4 Agent Runtime (Phases 33-35) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

Phases 33-35 delivered: global skill install, standalone agent runner, OpenClaw coexistence (token hard-fail, slash command namespace, dashboard non-fatal).

</details>

<details>
<summary>v1.5 Smart Memory & Model Tiering (Phases 36-41) - SHIPPED 2026-04-10</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

Phases 36-41 delivered: knowledge graph (wikilinks + backlinks), on-demand memory loading (memory_lookup MCP + personality fingerprint), graph intelligence (graph-enriched search + auto-linker), model tiering (haiku default + fork-based escalation + opus advisor), cost optimization (per-agent tracking + importance scoring + escalation budgets), context assembly pipeline (per-source token budgets).

</details>

<details>
<summary>v1.6 Platform Operations & RAG (Phases 42-49) - SHIPPED 2026-04-12</summary>

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

Phases 42-49 delivered: auto-start agents on daemon boot, systemd production integration, agent-to-agent Discord communication, memory auto-linking on save, scheduled consolidation, Discord slash commands for control, webhook auto-provisioning, RAG over documents.

</details>

<details>
<summary>v1.7 Performance & Latency (Phases 50-56) - SHIPPED 2026-04-14</summary>

See `.planning/milestones/v1.7-ROADMAP.md` for full details.

Phases 50-56 delivered: phase-level latency instrumentation, SLO targets + CI regression gate, prompt caching (Anthropic preset+append), context audit + token budget tuning, streaming + typing indicator, tool-call overhead reduction, warm-path optimizations.

</details>

<details>
<summary>v1.8 Proactive Agents + Handoffs (Phases 57-63) - SHIPPED 2026-04-17</summary>

See `.planning/milestones/v1.8-ROADMAP.md` for full details.

Phases 57-63 delivered: TurnDispatcher foundation, task store + state machine, cross-agent RPC handoffs, trigger engine, additional trigger sources, policy layer + dry-run, observability surfaces.

</details>

<details>
<summary>v1.9 Persistent Conversation Memory (Phases 64-68 + 68.1) - SHIPPED 2026-04-18</summary>

See `.planning/milestones/v1.9-ROADMAP.md` for full details.

Phases 64-68 delivered: ConversationStore schema + lifecycle, capture integration (fire-and-forget + SEC-02), session-boundary summarization, resume auto-injection, conversation search + deep retrieval. Phase 68.1 closed the isTrustedChannel cross-phase wiring gap.

</details>

<details>
<summary>v2.0 Open Endpoint + Eyes & Hands (Phases 69-74) - SHIPPED 2026-04-20</summary>

Phases 69-74 delivered: OpenAI-compatible endpoint, browser automation MCP, web search MCP, image generation MCP, OpenClaw endpoint latency (sub-2s TTFB), seamless OpenClaw backend (caller-provided agent config).

</details>

### v2.1 OpenClaw Agent Migration (Active)

- [x] **Phase 75: Shared-Workspace Runtime Support** — Add optional `memoryPath` field to agentSchema so multiple agents can share one workspace basePath while keeping isolated memories/inboxes/session-state; unblocks the 5-agent finmentum family migration. (Plans 01-03 shipped 2026-04-20; gap-closure Plan 04 pending — session-resume context-summary read path swap) (completed 2026-04-20)
- [ ] **Phase 76: Migration CLI Read-Side + Dry-Run** — `clawcode migrate openclaw list` + `plan` surface per-agent diff tables (config, memory count, MCP servers, Discord channels) with zero writes; establishes the state-file ledger schema downstream phases consume.
- [ ] **Phase 77: Pre-flight Guards + Safety Rails** — Daemon-running check, secret-pattern hard refusal, Discord channel-collision check, non-destructive-to-source invariant, and ledger JSONL scaffolding so `apply` can fail fast before any write.
- [ ] **Phase 78: Config Mapping + YAML Writer** — Map `openclaw.json` agents to `clawcode.yaml` entries with `soulFile:`/`identityFile:` file pointers, MCP server references, and atomic temp+rename YAML writes preserving comments and key ordering.
- [ ] **Phase 79: Workspace Migration** — Copy per-agent workspace contents (SOUL/IDENTITY/USER/TOOLS/CLAUDE/MEMORY/memory/.learnings/archive) via `fs.cp` with symlink filter and hash-witness verification; finmentum family resolves to one shared basePath; `.git` preserved verbatim; openclaw-sessions archived read-only.
- [ ] **Phase 80: Memory Translation + Re-embedding** — Read workspace markdown (disk as truth, not sqlite chunks), insert through `MemoryStore.insert()` with `origin_id UNIQUE` for idempotency, re-embed via MiniLM singleton (384-dim); `.learnings/*.md` land as first-class memories tagged `"learning"`.
- [ ] **Phase 81: Verify + Rollback + Resume + Fork** — `verify`, idempotent re-run via ledger, per-agent `rollback`, and proof that every migrated agent (Sonnet/Haiku/MiniMax/Gemini) retains fork-to-Opus escalation with unbudgeted cost-ledger rows.
- [ ] **Phase 82: Pilot + Cutover + Completion** — Migrate low-risk pilot (`personal` or `local-clawdy`) first, run dual-bot guardrails during observation, per-agent `cutover` unbinds OpenClaw, and `complete` writes the v2.1-migration-report.md summarizing fleet outcomes.

## Phase Details

### Phase 69: OpenAI-Compatible Endpoint
**Goal**: Every ClawCode agent is reachable from any OpenAI-compatible client with first-class streaming, tool-use, and per-key session continuity.
**Status**: Shipped 2026-04-19. See `.planning/phases/69-openai-compatible-endpoint/`.

### Phase 70: Browser Automation MCP
**Goal**: Every agent can drive a real headless Chromium with a persistent per-agent profile.
**Status**: Shipped 2026-04-19. See `.planning/phases/70-browser-automation-mcp/`.
**UI hint**: yes

### Phase 71: Web Search MCP
**Goal**: Every agent can search the live web and fetch clean article text with intra-turn deduplication.
**Status**: Shipped 2026-04-19. See `.planning/phases/71-web-search-mcp/`.

### Phase 72: Image Generation MCP
**Goal**: Every agent can generate and edit images via MiniMax/OpenAI/fal.ai with workspace persistence and cost tracking.
**Status**: Shipped 2026-04-19. See `.planning/phases/72-image-generation-mcp/`.
**UI hint**: yes

### Phase 73: OpenClaw Endpoint Latency
**Goal**: Sub-2s TTFB on warm agents for synchronous OpenClaw-agent consumption via persistent `streamInput()` subprocess + brief cache.
**Status**: Shipped 2026-04-19. See `.planning/phases/73-openclaw-endpoint-latency/`.

### Phase 74: Seamless OpenClaw Backend
**Goal**: Caller-provided agent config on `/v1/chat/completions` — OpenClaw agents use ClawCode as a rendering backend without pre-registration.
**Status**: Shipped 2026-04-20. See `.planning/phases/74-seamless-openclaw-backend-caller-provided-agent-config/`.

### Phase 75: Shared-Workspace Runtime Support
**Goal**: The user (as config author) can declare multiple agents in `clawcode.yaml` that reference the same `basePath` and have each agent open an isolated `memories.db`, inbox, heartbeat log, and session-state directory via a per-agent `memoryPath:` override — so the 5-agent finmentum family can share one workspace without cross-agent pollution.
**Depends on**: Nothing (prerequisite; blocks finmentum family migration in Phase 79+). Zero impact on the 10 dedicated-workspace agents.
**Requirements**: SHARED-01, SHARED-02, SHARED-03
**Success Criteria** (what must be TRUE):
  1. User adds two agents to `clawcode.yaml` pointing at the same `basePath` with distinct `memoryPath:` values, restarts the daemon, and observes two distinct `memories.db` files on disk — writes to agent A's memory never touch agent B's memory file (`sqlite3 .clawcode/agents/<base>/memory/A/memories.db "SELECT COUNT(*) FROM memories"` and `.../B/memories.db` return independent counts).
  2. User starts 2+ agents on the same shared basePath and observes each agent gets its own `inbox/<agent>/`, heartbeat log, and session-state directory — chokidar watchers fire once per event per agent (no 2x/5x amplification), `clawcode send <target> "hi" --from <source>` delivers to the target's inbox only, and consolidation jobs target only the invoking agent's memory file.
  3. User boots all 5 finmentum agents (`fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum-content-creator`) on the same shared workspace and `clawcode fleet status` shows all 5 as `running` with no file-lock errors in daemon logs, no duplicate auto-linker runs across the same `memories.db`, and `memory_lookup` queries against agent A never return entries from agent B.
**Plans**: 4 plans (1 gap-closure)
- [x] 75-01-PLAN.md — Schema + ResolvedAgentConfig.memoryPath contract + differ non-reloadable classification (SHARED-01)
- [x] 75-02-PLAN.md — loader.ts resolution + swap 13 runtime consumers (session-memory, heartbeat, inbox, daemon, bridge) to memoryPath (SHARED-01, SHARED-02)
- [x] 75-03-PLAN.md — Integration test covering 2-agent isolation + 5-agent finmentum + conflict rejection (SHARED-02, SHARED-03)
- [x] 75-04-PLAN.md — **Gap closure** (VERIFICATION Truth #7): swap session-config.ts:318 loadLatestSummary from workspace/memory to memoryPath/memory + regression test for shared-workspace session-resume (SHARED-02)

### Phase 76: Migration CLI Read-Side + Dry-Run
**Goal**: User (as operator) can run `clawcode migrate openclaw list` and `clawcode migrate openclaw plan` to see every source agent's current state and the per-agent diff that `apply` would produce — with zero writes to `~/.clawcode/` or `clawcode.yaml` — so migration can be planned, reviewed, and re-planned safely before any real change.
**Depends on**: Phase 75 (shared-workspace support must exist so finmentum appears correctly in plan output with `memoryPath:` fields).
**Requirements**: MIGR-01, MIGR-08
**Success Criteria** (what must be TRUE):
  1. User runs `clawcode migrate openclaw list` and sees a table of all 15 active OpenClaw agents (name, source workspace path, memory chunk count, MCP server count, bound Discord channel) with zero file writes to `~/.clawcode/` — verified by `find ~/.clawcode -newer .planning/ROADMAP.md` returning empty after the command.
  2. User runs `clawcode migrate openclaw plan` and sees a color-coded per-agent diff (source name → target `basePath`, memory count, MCP servers mapped, Discord channel, warnings for unknown MCP servers or finmentum shared-workspace members) — diff is deterministic across runs (same input → same output hash).
  3. User runs `clawcode migrate openclaw list` at any point after initial plan and sees each of the 15 agents tagged `pending` / `migrated` / `verified` / `rolled-back` with the corresponding ledger row reference — status is read from `.planning/migration/ledger.jsonl`, never from the target filesystem.
  4. User runs `clawcode migrate openclaw plan --agent <name>` for a single agent and sees only that agent's diff, with exit code 0 on success and exit code 1 + actionable error message if `<name>` is not an active OpenClaw agent.
**Plans**: 3 plans
- [x] 76-01-PLAN.md — Pure readers + zod schemas + JSONL ledger (openclaw-config-reader.ts, source-memory-reader.ts, ledger.ts + fixture) (MIGR-01, MIGR-08)
- [ ] 76-02-PLAN.md — Deterministic diff builder with finmentum grouping + SHA256 plan hash (diff-builder.ts) (MIGR-01)
- [ ] 76-03-PLAN.md — CLI wiring (migrate openclaw list + plan [--agent]) + color helpers + zero-write integration test (MIGR-01, MIGR-08)

### Phase 77: Pre-flight Guards + Safety Rails
**Goal**: User (as operator) can trust that `clawcode migrate openclaw apply` will refuse to run — with a clear actionable error — if any of four safety invariants is violated: (a) OpenClaw daemon is running, (b) a secret-shaped value would be written to `clawcode.yaml`, (c) a Discord channel ID is already bound on an existing ClawCode agent, or (d) the migrator is about to modify any file under `~/.openclaw/`. The ledger JSONL is created and every pre-flight outcome lands in it.
**Depends on**: Phase 76 (plan output exists; guards attach to `apply` code path).
**Requirements**: MIGR-02, MIGR-06, MIGR-07, OPS-03
**Success Criteria** (what must be TRUE):
  1. User runs `clawcode migrate openclaw apply` while `openclaw-gateway.service` is active and sees exit code 1 with message `"OpenClaw daemon is running. Run 'systemctl --user stop openclaw-gateway' first, then re-run the migration."` — zero files under `~/.clawcode/` or `clawcode.yaml` are modified (verified by filesystem snapshot before/after).
  2. User seeds a test `openclaw.json` with a plaintext Discord token, runs `apply`, and sees exit code 1 with message `"refused to write raw secret-shaped value to clawcode.yaml — use op:// reference or whitelist the value"` — no partial YAML write occurs (atomic rename never fires).
  3. User runs `apply` when a Discord channel ID from an OpenClaw binding already appears in an existing `clawcode.yaml` agent's `channels:` list and sees a channel-collision report listing the conflict (source agent, target agent, channel ID) + exit code 1 — operator is told exactly which side to unbind.
  4. User inspects `.planning/migration/ledger.jsonl` after any migration action (plan, apply pre-flight fail, partial apply) and sees structured JSONL entries with `{timestamp, agent, step, outcome, file_hashes}` fields — ledger never contains rows for source-file modifications under `~/.openclaw/` (verified by grep).
  5. User runs the full migration end-to-end across all 15 agents and `stat -c %Y` timestamps on every file under `~/.openclaw/` match pre-migration values — source system is fully intact for fallback.
**Plans**: TBD

### Phase 78: Config Mapping + YAML Writer
**Goal**: User (as operator) can trust that `clawcode migrate openclaw apply` produces a `clawcode.yaml` where each migrated agent entry carries `soulFile:` + `identityFile:` pointers to workspace markdown files (no inline soul/identity bloat), `mcpServers:` references to existing ClawCode MCP patterns (clawcode + 1password auto-injection preserved), and a model id mapped from OpenClaw's convention — with the YAML round-trip preserving all existing comments and key ordering via atomic temp+rename writes.
**Depends on**: Phase 77 (secret guard enforced at YAML write boundary).
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04
**Success Criteria** (what must be TRUE):
  1. User opens `clawcode.yaml` after migrating one agent and sees its entry contains `soulFile: <workspace>/SOUL.md` and `identityFile: <workspace>/IDENTITY.md` references (absolute or `~`-prefixed paths) — no `soul: |` or `identity: |` inline block literals are added for migrated agents; the daemon reads these files lazily at session boot (`rg 'readFile.*soulFile' src/` returns the lazy-read code path).
  2. User runs `apply` against an agent with per-agent MCP servers declared in `openclaw.json` and sees the migrated agent's `mcpServers:` list in `clawcode.yaml` contains string references to matching entries in the top-level `mcpServers:` map — with `clawcode` and `1password` auto-injection preserved (every migrated agent gets both), and any MCP server not found in the top-level map flagged in `plan` output as a warning.
  3. User runs `plan` against an agent whose OpenClaw model id doesn't match any known ClawCode mapping and sees the diff output flag it (`⚠ unmappable model: <id> — pass --model-map "<id>=<clawcode-id>" or edit plan.json`); passing `--model-map` overrides the mapping and the override lands in the written YAML entry.
  4. User runs `apply` while a hand-edit is in `clawcode.yaml` with inline comments (`# v2.0 endpoint`, `# op://...` references), and after the write the file still contains every pre-existing comment verbatim + key ordering is preserved — chokidar watcher observes exactly one file event (not a half-written intermediate state) because the write uses temp-file + atomic rename.
**Plans**: TBD

### Phase 79: Workspace Migration
**Goal**: User (as operator) can trust that `clawcode migrate openclaw apply` copies each agent's workspace contents (SOUL.md, IDENTITY.md, USER.md, TOOLS.md, CLAUDE.md, MEMORY.md, memory/, .learnings/, archive/) from `~/.openclaw/workspace-<name>/` to the target ClawCode workspace with verbatim file preservation — and that the 5 finmentum agents all resolve to one shared basePath while keeping per-agent memoryPath/soulFile/identityFile/inbox distinct.
**Depends on**: Phase 78 (YAML writer resolves each agent's `basePath` and `soulFile:`/`identityFile:` target paths that workspace-writer populates).
**Requirements**: WORK-01, WORK-02, WORK-03, WORK-04, WORK-05
**Success Criteria** (what must be TRUE):
  1. User runs `apply` on one agent and verifies with `find <target-workspace> -name '*.md' | xargs sha256sum` that every source markdown file's hash matches the corresponding hash in the target — verified at apply time via a post-copy hash-witness step that writes `{path, src_sha, dst_sha}` into the ledger JSONL; `find <target-workspace> -xtype l` returns zero broken symlinks (no `instagram-env/lib64` self-symlink traps).
  2. User runs `apply` on all 5 finmentum agents and observes `clawcode.yaml` entries for each show the SAME `basePath:` value pointing at the shared workspace, but DIFFERENT `soulFile:`, `identityFile:`, `memoryPath:`, and inbox subdirectories — `ls <shared-basePath>/memory/` shows 5 distinct per-agent memory dirs, `ls <shared-basePath>/inbox/` shows 5 distinct inbox subdirs.
  3. User runs `apply` on a workspace that contains a `.git` directory and runs `git -C <target-workspace> fsck` — fsck returns clean, `git log --oneline | head -5` shows the source workspace's commit history verbatim, and `git status` shows untracked files preserved (no re-init, no corruption).
  4. User opens the migrated agent's Discord channel, sends a message, and the agent can read `<workspace>/archive/openclaw-sessions/*.jsonl` via its filesystem tools — archives are present as read-only reference (copied full tree, filter skips the directory from ConversationStore replay), and `SELECT COUNT(*) FROM turns WHERE provenance LIKE '%openclaw%'` in the ConversationStore returns 0 (no replay occurred).
  5. User runs `apply` on a workspace containing non-text blobs (images in `.learnings/`, PDFs under `archive/`) and inspects the target — file sizes match source byte-for-byte (`stat -c %s`), mtimes match source (`stat -c %Y`), and a visual inspection of copied images renders identically to source.
**Plans**: TBD

### Phase 80: Memory Translation + Re-embedding
**Goal**: User (as migrated agent) can retrieve memories via `memory_lookup` that originated from the source OpenClaw agent's workspace markdown (MEMORY.md + memory/*.md + .learnings/*.md) with full text preserved verbatim, fresh 384-dim MiniLM embeddings, idempotent re-insertion via `origin_id UNIQUE`, and `.learnings/` entries tagged as first-class `"learning"` memories — never via raw SQL against `vec_memories`.
**Depends on**: Phase 79 (workspace files must exist at target paths before memory reader can parse them). Research note: OpenClaw sqlite schema sample is captured in STACK.md; `/gsd:research-phase` before planning is optional but recommended to finalize markdown-section splitting rules.
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05
**Success Criteria** (what must be TRUE):
  1. User queries a migrated agent via `clawcode memory search <agent> "<known-phrase-from-source-MEMORY.md>"` and sees the exact source text returned verbatim (no LLM rewriting, no summarization) — content is byte-identical to the H2 section in `<source-workspace>/MEMORY.md`.
  2. User re-runs `clawcode migrate openclaw apply --agent <name>` after a successful first run and sees "upserted 0, skipped N (already imported via origin_id)" in the output — verified by `SELECT COUNT(*) FROM memories WHERE origin_id LIKE 'openclaw:<agent>:%'` returning the same count before and after the second run.
  3. User inspects a migrated agent's `memories.db` and sees every migrated row has `vec_length(embedding) == 384` (verified by `sqlite3 memories.db "SELECT vec_length(embedding) FROM vec_memories"` returning 384 for every row), and the codepath that inserts rows imports `MemoryStore.insert()` — `rg 'INSERT INTO vec_memories' src/migration/` returns zero matches (never raw SQL).
  4. User queries `memory_lookup {tag: "learning"}` on a migrated agent and receives entries whose `content` matches a file under `<source-workspace>/.learnings/*.md` — every `.learnings/*.md` file maps to exactly one `memories` row with `tags` including `"learning"` and the file's basename.
  5. User migrates an agent whose source `~/.openclaw/memory/<agent>.sqlite` shows N chunks but whose workspace `MEMORY.md` + `memory/*.md` shows a different count — the migrated `memories` table row count matches the WORKSPACE MARKDOWN count (disk is truth), not the sqlite chunk count; any "file in sqlite but not on disk" is logged in the ledger as `skipped: file-deleted-from-source`.
**Plans**: TBD

### Phase 81: Verify + Rollback + Resume + Fork
**Goal**: User (as operator) can run `verify`, `rollback`, and a second `apply` against the same agent to get clean pass/fail checks, per-agent reversal, and idempotent resume from partial success — AND every migrated agent (regardless of primary model: Sonnet, Haiku, MiniMax, Gemini) retains the v1.5 fork-to-Opus escalation path with fork turns appearing in `clawcode costs` under no budget ceiling.
**Depends on**: Phase 80 (all write-side phases 77-80 exist; verify/rollback operate on their outputs).
**Requirements**: MIGR-03, MIGR-04, MIGR-05, FORK-01, FORK-02
**Success Criteria** (what must be TRUE):
  1. User runs `clawcode migrate openclaw apply` mid-flight (after 3 of 15 agents migrated), kills the process, re-runs `apply`, and observes only the remaining 12 agents get processed — the 3 already-migrated agents are skipped (ledger-driven), no duplicate memory rows appear (origin_id UNIQUE enforced), and the final state is identical to an uninterrupted run.
  2. User runs `clawcode migrate openclaw verify <agent>` after a successful apply and sees a table of pass/fail checks: (a) workspace files present (SOUL/IDENTITY/MEMORY/etc. exist), (b) memory count within ±5% of source markdown-section count, (c) Discord channel reachable (bot in channel + MANAGE_WEBHOOKS permission), (d) agent boots cleanly on `clawcode fleet restart` — exit code 0 on all-pass, exit code 1 with failing-check list on any fail.
  3. User runs `clawcode migrate openclaw rollback <agent>` and sees the agent's entry removed from `clawcode.yaml` (verified by `yq '.agents[] | select(.name == "<name>")' clawcode.yaml` returning nothing), its ClawCode workspace + memory DB deleted (`ls <basePath>/<agent>` returns not-found for dedicated-workspace agents; for finmentum family only the per-agent `memoryPath:` subdir + per-agent soulFile/identityFile removed, shared `basePath` preserved), and `~/.openclaw/workspace-<agent>/` + `~/.openclaw/memory/<agent>.sqlite` unchanged (hash-witness match).
  4. User migrates a Haiku-primary agent, sends a Discord message triggering the existing fork-to-Opus escalation path (3-consecutive-error trigger OR keyword trigger from v1.5), and observes the forked session boots on Opus without any per-agent config change — verified by trace metadata showing `model: "opus-*"` on the forked Turn and `forked_from: <parent-turn-id>` linkage.
  5. User runs `clawcode costs --agent <migrated-agent>` after at least one fork-to-Opus turn and sees the Opus turn appear as a row in the cost ledger (non-zero token cost, model prefix matches Opus) — with no budget ceiling enforcement (v2.1 user decision: unlimited per agent); `clawcode costs` shows the Opus spend distinctly from the agent's primary-model spend.
**Plans**: TBD

### Phase 82: Pilot + Cutover + Completion
**Goal**: User (as operator) can migrate one low-risk pilot agent (`personal` or `local-clawdy`) first, verify end-to-end behavior, then execute per-agent `cutover` to unbind the OpenClaw bot from each migrated agent's Discord channel (dual-run guardrails during the observation window), then run `complete` to write a final migration report to `.planning/milestones/v2.1-migration-report.md` summarizing per-agent outcomes.
**Depends on**: Phase 81 (verify + rollback exist; pilot run must be able to fall back cleanly if issues surface).
**Requirements**: OPS-01, OPS-02, OPS-04
**Success Criteria** (what must be TRUE):
  1. User runs `clawcode migrate openclaw plan` and sees `personal` (or `local-clawdy`) highlighted as the recommended pilot (lowest memory-chunk count, lowest activity, not-business-critical) — user runs `apply --only personal`, `verify personal`, and observes the agent responding in its Discord channel with source-workspace memories reachable via `memory_lookup` (end-to-end parity check passes before touching the other 14 agents).
  2. User keeps OpenClaw daemon running during pilot observation window and sends a Discord message in the pilot agent's channel — both the OpenClaw bot AND the new ClawCode bot (Clawdbot) receive the message (dual-run confirmed); user runs `clawcode migrate openclaw cutover personal` and observes that the OpenClaw bot no longer responds in that channel (OpenClaw-side binding removed) while Clawdbot continues responding — verified by 15-minute observation with a test prompt returning exactly one reply.
  3. User runs `clawcode migrate openclaw complete` after all 15 agents migrated + verified + cut over, and `.planning/milestones/v2.1-migration-report.md` is written with per-agent sections containing: source workspace path, target basePath, memory-count delta (source vs. migrated), Discord cutover timestamp, rollback status (none/pending), and any warnings carried over from plan/apply/verify runs — the report is committable, greppable, and contains zero raw secrets.
  4. User runs `clawcode migrate openclaw complete` and observes that `openclaw.json:bindings` contains zero channel IDs that also appear in `clawcode.yaml:agents[*].channels:` — cutover invariant holds fleet-wide (no coexistence duplicates remain).
**Plans**: TBD

## Progress

**Status:** v2.1 OpenClaw Agent Migration started 2026-04-20. 8 phases (75-82), 31 requirements mapped 1:1, zero orphans.

| Milestone | Phases | Status | Completed |
|-----------|--------|--------|-----------|
| v1.0 | 1-5 | Complete | 2026-04-09 |
| v1.1 | 6-20 | Complete | 2026-04-09 |
| v1.2 | 21-30 | Complete | 2026-04-09 |
| v1.3 | 31-32 | Complete | 2026-04-09 |
| v1.4 | 33-35 | Complete | 2026-04-10 |
| v1.5 | 36-41 | Complete | 2026-04-10 |
| v1.6 | 42-49 | Complete | 2026-04-12 |
| v1.7 | 50-56 | Complete | 2026-04-14 |
| v1.8 | 57-63 | Complete | 2026-04-17 |
| v1.9 | 64-68 + 68.1 | Complete | 2026-04-18 |
| v2.0 | 69-74 | Complete | 2026-04-20 |
| v2.1 | 75-82 | Active | — |

### v2.1 Phase Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 75. Shared-Workspace Runtime Support | 4/4 | Complete    | 2026-04-20 |
| 76. Migration CLI Read-Side + Dry-Run | 1/3 | In Progress|  |
| 77. Pre-flight Guards + Safety Rails | 0/? | Not started | - |
| 78. Config Mapping + YAML Writer | 0/? | Not started | - |
| 79. Workspace Migration | 0/? | Not started | - |
| 80. Memory Translation + Re-embedding | 0/? | Not started | - |
| 81. Verify + Rollback + Resume + Fork | 0/? | Not started | - |
| 82. Pilot + Cutover + Completion | 0/? | Not started | - |

---

*Active milestone: v2.1 OpenClaw Agent Migration. 8 phases planned (75-82), 31 requirements across SHARED/MIGR/CONF/WORK/MEM/FORK/OPS categories. Zero new npm deps.*
