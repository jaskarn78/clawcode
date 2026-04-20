# Feature Research — v2.1 OpenClaw Agent Migration Tooling

**Domain:** One-shot CLI migration tool (OpenClaw → ClawCode). 15 source agents, 4 data domains per agent (config, workspace files, memory DB, session archives), shared-workspace subcase for the 5-agent finmentum family.
**Researched:** 2026-04-20
**Confidence:** HIGH for table-stakes (industry-standard migration UX is well-documented); MEDIUM for schema-translation specifics (few precedents for RAG-chunks → knowledge-graph migrations).

## Scope framing

This research covers the **migration CLI** (`clawcode migrate openclaw`) — not the product features being migrated. The ClawCode agent runtime already ships all the capabilities each agent needs (memory DB, fork-to-opus, MCP auto-injection, Discord binding, session summarization). The migration tool's job is to get 15 legacy-shaped agents into the v2.0 shape without losing identity, memories, or tool wiring.

Three concrete user needs drive the feature set:

1. **Re-runnability** — Jas will run this tool repeatedly: first dry-run, then apply a subset, then iterate on problem agents. The tool cannot be one-shot destructive.
2. **Shared workspace UX** — 5 finmentum agents share one workspace directory but keep 5 distinct agent identities, channels, and memories. This is not a standard pattern and needs explicit treatment.
3. **Schema divergence** — OpenClaw memory is a chunked file-RAG; ClawCode memory is a knowledge-graph-ready `MemoryEntry` store with wikilink edges and importance scores. The two models are not isomorphic.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Enumerate source** (`clawcode migrate openclaw list`) | User needs to see what will be migrated before committing. Industry standard for any migration CLI (Alembic `current`, Terraform `plan`). | LOW | Parse `~/.openclaw/openclaw.json`, enumerate 15 agents, show name/model/workspace/channel/MCP count. No writes. |
| **Dry-run mode** (`--dry-run`) | Non-negotiable. Terraform, Ansible, every SQL migration tool has this. Users refuse destructive tools without it. | MEDIUM | Runs full migration logic except writes. Produces the same diff/summary as real run. Must be bit-for-bit predictive of what `--apply` will do. |
| **Per-agent diff / preview** | Users expect to see WHAT will change per agent (model, MCP list, memory count, workspace path). Terraform-style `+ create` / `~ modify` / `- destroy` output. | MEDIUM | Per-agent table: config fields, workspace file list (copied vs. translated), memory chunk counts (in → out), issues/warnings. |
| **Explicit `--apply` confirmation** | Dangerous operations should never execute by default. `kubectl apply`, `terraform apply`, `git rebase` all require explicit action. | LOW | Default invocation = dry-run. Writes only happen with explicit `--apply` flag and/or interactive `y/N` prompt. |
| **Per-agent selection** (`--agent <name>`, `--only fin-*`, `--exclude card-generator`) | 15 agents is too many to all-or-nothing. Users want to migrate one, verify, then do rest. Matches dbt's `--select`. | LOW | Glob/list matching against agent names. Validates against source manifest first. |
| **Idempotent re-run** | Classic table-stakes for any migration tool (Alembic, Rails, dbt, Terraform). Running twice on same input must produce same state, not double-write. | MEDIUM | Track state per agent in `~/.clawcode/migrate/state.json` (or similar journal). Second run detects already-migrated agents and skips or reconciles. |
| **Resume-from-failure** | 15 agents × 4 domains = 60 units of work. If unit 47 fails, re-running must not re-process 1-46. Standard pattern in any batch migrator. | MEDIUM | State file (above) carries per-unit status: `pending/in-progress/succeeded/failed`. Failed units are retried; succeeded are skipped unless `--force`. |
| **Human-readable logs + structured log file** | Pino-style structured logs exist elsewhere in ClawCode; users expect `~/.clawcode/migrate/logs/<ts>.jsonl` for post-mortem plus friendly stdout. | LOW | Two sinks: pretty stdout (spinner + per-agent colored status), pino JSONL to file. |
| **Pre-flight validation** | Users expect the tool to check prerequisites FIRST (source files exist, target paths writable, no clawcode agent name collisions, 1Password CLI available for credential resolution) rather than fail halfway. | MEDIUM | One pass through all agents collecting blockers. If any blocker, refuse `--apply` with a fixable error list. |
| **Non-destructive to source** | OpenClaw must keep working during and after migration. Tool must never delete, move, or modify `~/.openclaw/`. | LOW | Enforce read-only access to source directory. Tests verify source unchanged before/after. |
| **Post-migration verification** | After apply, user expects "migration complete — 14/15 succeeded, 1 warning" with drill-down. Matches dbt `run` summary, Terraform apply output. | MEDIUM | Per-agent check: config parses in zod, memory DB opens, workspace files present, daemon can load agent definition without error. |
| **Rollback** (`clawcode migrate openclaw undo [--agent X]`) | Data migration best-practice: "write the inverse before you run the migration." Users expect to unwind a bad run without manual cleanup. | MEDIUM | Because source is untouched, rollback = delete the target (workspace dir + memory DB + clawcode.yaml block) for the specified agent. State file tracks what was created so unknowns aren't touched. |
| **Credential flow preserved** | MCP server configs reference 1Password (`op://...`) secrets. Migration must not leak credentials into the target config, only preserve references. | LOW | Migration copies `op://` references verbatim — never resolves secrets during migration. |
| **Shared-workspace support** — see detailed UX section below | User explicitly asked for this. Finmentum family of 5 agents share one directory. | HIGH | See dedicated section. This is the one true novel feature of the migrator. |
| **Memory re-embedding** | ClawCode uses all-MiniLM-L6-v2 locally (384-dim). OpenClaw uses a different embedding model. Vectors are not compatible. Industry pattern: re-embed on model upgrades. | MEDIUM | Drop OpenClaw vectors, re-embed chunks with ClawCode's resident embedder singleton (v1.7). Batch to avoid load spikes. |
| **Safety rails for destructive operations** | If a target agent name already exists in `clawcode.yaml`, refuse overwrite unless `--overwrite`. If target workspace dir is non-empty, refuse unless `--overwrite`. | LOW | Pre-flight + runtime guards. Error messages tell user exactly how to bypass. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Per-agent diff with reconciliation hints** | Not just "memory 1200 → 1200", but "45 chunks look like duplicates of existing ClawCode memories for this agent; will dedupe by content hash". Turns the tool from mechanical into intelligent. | MEDIUM | Hash-based dedup pass during memory translation. Surfaces merge decisions in the diff. |
| **`--plan-file <path>`** | Terraform-style: dry-run writes a plan file; `--apply plan.json` executes exactly that plan, nothing else. Removes TOCTOU risk between plan and apply when migrating 15 agents across potentially minutes. | MEDIUM | Plan file is a JSON manifest of every action (create workspace, copy file X, translate memory Y). Apply consumes the manifest verbatim; refuses if source has changed since plan. |
| **Interactive TUI review** (optional flag) | For 15 agents, a scroll-through "inspect each agent's diff, accept/skip, edit config in place" workflow is dramatically faster than reading 15 text diffs. Similar to `git add -p` but for agents. | HIGH | Defer to P3 unless specifically scoped. |
| **Automatic `.learnings/` → MemoryEntry translation** | OpenClaw's `.learnings/` is informal extracted patterns (markdown). Instead of pure copy, translate each learning into a `MemoryEntry` with `tags: ["learning", ...]` and `source: "openclaw-learning"` — makes them searchable via memory_lookup MCP immediately. | MEDIUM | Higher-value differentiator because it puts learnings into the same retrieval path as v1.5 memory (not a separate file tree the agent has to remember to read). |
| **Session archive "warm link"** | Import the LAST N sessions (configurable, default 3) as `session_logs` entries so the ConversationStore brief has immediate context; leave the rest as a `~/.clawcode/archive/openclaw-sessions/<agent>/` pointer a `memory_lookup` can surface if needed. | MEDIUM | Best of both worlds (see Q7 below). Avoids full replay cost while preserving continuity. |
| **Semantic memory dedup** (optional) | Across OpenClaw memory chunks, find near-duplicates (cosine > 0.95) and merge into a single ClawCode MemoryEntry with a higher importance score. 15 agents × 100s-1000s of chunks will have redundancy. | MEDIUM | Reuses v1.5 memory auto-linker infrastructure. Improves signal-to-noise in the new store. |
| **Identity-drift detection** | During migration, compute embedding of `SOUL.md` pre- and post-migration. If cosine diverges beyond threshold, warn user (should be ~1.0 if migration is pure copy). Cheap guardrail against accidentally corrupting an agent's soul. | LOW | One embedding pair per agent. 15 comparisons total. |
| **Summary report as Markdown artifact** | After apply, write `~/.clawcode/migrate/reports/<ts>.md` with per-agent: before/after metrics, warnings, links to log file. Users can share/archive/diff across runs. | LOW | Leverages existing pino log stream. |
| **`clawcode migrate openclaw status`** | Post-migration, show drift: which ClawCode agents are still in sync with OpenClaw workspace vs. have diverged. Useful during the OpenClaw→ClawCode transition period where both systems may coexist. | MEDIUM | Compares source file hashes against recorded migration-time hashes. |
| **Shared-workspace conflict detection** | For the finmentum family, detect if 2+ agents have contradictory entries in the shared workspace (e.g., two different IDENTITY.md files both claiming to be the "primary"). Surfaces as a migration warning. | MEDIUM | Specific to this project's shape but high-value because the user explicitly called out this complexity. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Two-way sync OpenClaw ↔ ClawCode** | "I'll keep using OpenClaw for a while, keep them synced." | Dual-master is a footgun. Memory written during migration could overwrite newer OpenClaw state; writes in both systems create merge conflicts with no LLM-friendly resolution. Every OS migration in history that attempted bi-sync regretted it. | One-shot migration + `migrate openclaw status` drift report (above). User decides when to "cut over" per agent. |
| **Full session JSONL replay into ConversationStore** | "Preserve full conversation history in the new system." | OpenClaw session archives have 100s per agent = tens of thousands of turns. Replay cost (Haiku summarization per session) is real money and real hours. The v1.9 ConversationStore assumes FTS5 on raw turns captured at Discord-ingestion time — retroactively manufacturing that provenance ("user", "channel", "turn boundaries") from legacy JSONL is brittle. | Import last N sessions (differentiator above) + leave older archives as a read-only pointer. Matches industry pattern: "Codex CLI saves locally, resume reads from archives" — don't replay, just reference. |
| **LLM-powered schema translation** (use Opus to rewrite OpenClaw memories into "perfect" MemoryEntry format) | "Take this opportunity to upgrade the memory content." | Cost (thousands of Opus calls per agent), latency (hours per migration), and identity drift (model's "improvements" to an agent's memories = mutating the agent). Violates the PROJECT.md "automatic personality evolution" Out-of-Scope line. | Mechanical translation (structured fields → structured fields) + re-embed with local model. Preserve content verbatim. |
| **One big `migrate` command that does everything with no flags** | "Simplicity — just press the button." | Removes all safety. No preview, no selection, no resume, no rollback. Users lose control over a destructive operation on their most important data. | Dry-run by default + explicit `--apply` + per-agent selection. Make the button harder to press by design. |
| **Real-time progress bars instead of per-agent log** | "Modern, nice-looking." | Progress bars hide errors mid-migration and are incompatible with the existing pino logging approach. Users can't grep a progress bar. Worse — misleading during long per-agent work (memory re-embedding dominates time, looks "stuck"). | Per-agent status lines + pino JSONL file. One line per agent per phase, timestamped. Users can tail the log. |
| **Auto-detect and import new OpenClaw agents later** | "When I add a new agent in OpenClaw, migrate it too." | v2.1 is a one-shot cutover per PROJECT.md. Ongoing sync is not the design intent. OpenClaw is being deprecated; new agents should be created in ClawCode directly. | `migrate openclaw --agent <newname>` still works ad-hoc if user adds one and explicitly re-runs. No auto-detect cron. |
| **Migrate credentials into ClawCode's own secret store** | "Consolidate secrets." | Adds a new dependency, introduces a new attack surface, and breaks the existing 1Password integration that works. | Preserve `op://` references verbatim. If ClawCode adds a secret store in v3, migrate then. |
| **Convert OpenClaw SOUL.md into "structured JSON/YAML fields"** | "Normalize the schema." | SOUL.md works because it's freeform prose the LLM reads as context. Schema-ifying it would gut the pattern (the "souls.zip notes" research confirms: 200-500 word markdown works, JSON schemas don't land). | Preserve SOUL.md as literal text in either inline `soul:` field OR workspace file (user chooses — see Q5). |

## Deep-Dive Answers to Specific Research Questions

### Q1. Table-stakes feature set for a legacy-migration CLI

Answered in the table above. Canonical set drawn from Alembic, Terraform, dbt, Rails, kubectl:

1. **Enumerate** — show what's there
2. **Dry-run** — predict what will happen
3. **Diff/preview** — show per-item deltas
4. **Selection** — migrate subsets
5. **Explicit apply** — never auto-execute
6. **Idempotent** — safe to re-run
7. **Resume** — failed units retry, succeeded units skip
8. **Per-item status** — user knows what passed/failed
9. **Rollback** — undo creates a path home
10. **Pre-flight validation** — fail fast, fail actionable
11. **Post-migration verification** — confirm success, don't just claim it
12. **Logging** — structured + human-readable
13. **Non-destructive to source** — never modify what you're migrating from

Absence of any one of these is what separates "barely-usable" from "table-stakes". All of them are LOW or MEDIUM complexity individually; the integration is where the cost lives.

### Q2. What makes this migrator excellent vs. barely-usable

Ranked by user leverage:

1. **Plan-file separation** (plan vs. apply as two commands consuming a manifest) — eliminates TOCTOU during 15-agent runs, enables sharing/reviewing the plan before executing.
2. **Per-agent reconciliation diff** — shows semantic decisions (dedupes, merges) not just file counts. Turns the tool into a collaborator.
3. **Warm-link session archives** instead of full replay — 10x less cost, 90% of the value.
4. **`.learnings/` → MemoryEntry translation** — makes legacy wisdom discoverable via the v1.5 memory_lookup path on day one.
5. **Identity-drift detection** — cheap insurance against soul corruption.
6. **Shared-workspace conflict detection** — addresses the one unusual shape in your data.
7. **Markdown summary report artifact** — shareable, diff-able, archive-able.

### Q3. Shared-workspace UX (the finmentum family)

The concrete ask: 5 agents (fin-acquisition, fin-research, fin-playground, fin-tax, finmentum-content-creator) share one workspace directory on disk but remain 5 distinct agents with distinct identities, channels, memories, and MCP sets.

**Three viable patterns, ranked:**

#### Pattern A — `basePath` override per agent (RECOMMENDED)

```yaml
agents:
  - name: fin-acquisition
    basePath: ~/.clawcode/agents/finmentum       # shared
    soulFile: souls/fin-acquisition.md           # per-agent within shared
    memoryPath: memory/fin-acquisition.db        # per-agent DB
    channels: ["<channel-a>"]
    mcpServers: [...]
  - name: fin-research
    basePath: ~/.clawcode/agents/finmentum       # shared
    soulFile: souls/fin-research.md
    memoryPath: memory/fin-research.db
    ...
```

- **Shared on disk:** `SOUL.md` (shared family soul), `TOOLS.md`, `CLAUDE.md`, `skills/`, any common prose
- **Per-agent within shared dir:** `souls/<agent>.md` (individual overlay), `identities/<agent>.md`, `memory/<agent>.db`, `inbox/<agent>/`

**Why this wins:**
- Existing `defaults.basePath` config field can just be overridden per-agent — minimal schema change
- One source of truth on disk for family-wide content (edit `SOUL.md` once, 5 agents see it)
- Memory stays per-agent (required for isolation per Key Decisions doc)
- Clear, no symlink magic, filesystem tools work normally

**Complexity:** MEDIUM — requires `basePath` to be per-agent (not just global default), plus resolution logic for "per-agent overlay within shared base". The config loader needs to understand the overlay pattern.

#### Pattern B — Symlinks

Each agent has its own dir (`~/.clawcode/agents/fin-acquisition/`), and shared files (`SOUL.md`, `TOOLS.md`) are symlinks to a common location. Memory and identity stay in each agent's own dir.

**Pros:** Zero config-schema changes. `ls ~/.clawcode/agents/fin-research` looks like any other agent's dir.
**Cons:** Symlinks break on some backup tools, Windows support is awkward, `stat` vs. `lstat` confusion. Editors don't always follow symlinks sensibly. Hidden coupling. Chokidar file-watching gets weird with symlinks.

**Not recommended** but viable fallback.

#### Pattern C — Group config block

```yaml
agentGroups:
  - name: finmentum
    basePath: ~/.clawcode/agents/finmentum
    sharedFiles: [SOUL.md, TOOLS.md]
    agents: [fin-acquisition, fin-research, fin-playground, fin-tax, finmentum-content-creator]
```

**Pros:** Explicit grouping, easy to reason about at a glance.
**Cons:** New top-level config concept. Requires daemon/SessionManager to understand "group" as a first-class thing. Over-engineered for one group of 5 agents.

**Recommendation for v2.1:** Pattern A. Add `basePath` as per-agent override (minor schema change), add convention that `souls/<agent>.md`, `identities/<agent>.md`, `memory/<agent>.db` live inside the shared base. Migration tool writes them that way for the finmentum family and keeps every other agent using the default `basePath + /agent-name/` pattern.

**Opt-in mechanism:** The migration tool needs a flag or config hint. Cleanest: a source-side annotation in `openclaw.json` (or a sidecar `migrate-map.json` inside the migration tool config) declaring `sharedWorkspace: { group: "finmentum", agents: [...] }`. Tool generates the Pattern A config block from that.

### Q4. Memory translation with schema divergence

**Recommendation: hybrid.**

- **Preserve content verbatim** — never LLM-rewrite memories (violates PROJECT.md personality-evolution anti-feature).
- **Re-embed mechanically** — drop OpenClaw embeddings (different model, different dim), re-embed chunks with resident all-MiniLM-L6-v2 singleton. Standard practice per the "Advanced RAG Techniques" and "AI Memory vs RAG" sources: re-embed on model upgrades.
- **Translate structural fields** — OpenClaw chunk → ClawCode `MemoryEntry{ content, tags, source, importance, timestamp, sourceTurnIds?, ... }`. Fields that exist in ClawCode but not OpenClaw get sensible defaults (importance based on file location: MEMORY.md > memory/*.md > archive; tags from filename/path prefixes).
- **Skip knowledge-graph edges on import** — let the v1.6 auto-linker on-save heartbeat build edges organically from the new memories. Don't try to back-fill the graph in the migrator.
- **Deduplicate** — differentiator feature above; hash identical content, merge near-duplicates (cosine > 0.95) with tag union.

This matches the Cognee / ReMe pipeline pattern: ingest + deduplicate → embed → optimize incrementally. The migrator does the ingest + dedupe + embed; the running ClawCode agent does the ongoing optimize.

**What NOT to do:** Don't LLM-summarize chunks into "better memories." Don't try to extract entities/relations during migration (expensive, and PROJECT.md's "LLM-powered entity/relation extraction" is explicitly Out of Scope).

### Q5. Identity/soul — inline in config vs. file in workspace

**Recommendation: WORKSPACE FILE, with `soul:` inline ONLY for one-file-configurable agents.**

Reasoning:

- The `test-agent` entry in `clawcode.yaml` today has both `soul:` and `identity:` inline — that's fine for a quick demo, but for 15 production agents it bloats the single YAML file to unreadability (each soul is 200-500 words; 15 × ~400 words = a 6000-word config).
- The "souls.zip notes" research confirms SOUL.md works as a 200-500-word editable, diff-able, version-controllable file. That's what every OpenClaw agent has today.
- Editing a SOUL when it's embedded in YAML requires dealing with YAML escaping of markdown — painful. File is cleaner.
- Identity drift risk: inline YAML makes it easy to accidentally tweak a soul during a config edit session. Separate file forces intent.

**Migration rule:**
- OpenClaw `SOUL.md` → copied verbatim to `<workspace>/SOUL.md`, NOT inlined into `clawcode.yaml`.
- `clawcode.yaml` agent entry gets a `soulFile: SOUL.md` reference (or implicit default "load SOUL.md from workspace if present").
- Same for IDENTITY.md.
- Inline `soul:` / `identity:` remain supported for the `test-agent` demo case and for anyone who wants one-file config. But migration defaults to file-in-workspace.

This is also what the OpenClaw docs research confirms: "SOUL.md and IDENTITY.md are text files you can edit, version, and diff, with no database or API — just files in a workspace."

### Q6. `.learnings/` directories — translate or pure copy

**Recommendation: translate into MemoryEntries (differentiator feature above).**

Reasoning:
- `.learnings/` today is a filesystem blob the agent has to remember to read. Adoption is spotty.
- ClawCode's v1.5 `memory_lookup` MCP tool + graph search + auto-linker is the standard retrieval path. Learnings stored as MemoryEntries become first-class retrievable, rankable, and linkable.
- Cost is low: parse markdown files, create one MemoryEntry per learning with `tags: ["learning", "openclaw-imported", <filename-derived>]`, `importance: 0.8` (high — these are extracted patterns, not raw logs), `source: "openclaw-learning"`.
- No content transformation — just structural. Full fidelity preserved.

**Fallback if user disagrees:** Also keep the raw `.learnings/` directory in the new workspace as `legacy-learnings/` so nothing is lost. Cheap insurance.

### Q7. Session JSONL archives — replay vs. pointer

**Recommendation: HYBRID — import the most recent N, pointer to the rest.**

Reasoning:

**Full replay into v1.9 ConversationStore is NOT worth it:**
- ConversationStore was designed for Discord-ingested turns with trusted-channel provenance, session boundaries, and FTS5 indexes. Retrofitting that provenance onto legacy OpenClaw JSONL is brittle (no Discord message IDs, no trusted-channel flag, different turn shape).
- The summarization cost (Haiku per session) across hundreds of sessions per agent is real money and time.
- Replay introduces a chicken-and-egg: the v1.9 SessionSummarizer expects real session lifecycle events (ended/crashed) that JSONL archives don't cleanly carry.
- Industry pattern (Codex CLI JSONL logs, AnythingLLM export, Telegram JSON export) is "archive, don't re-import" — these tools produce JSONL for preservation, not for replay into a new system.

**Pure pointer is too cold:**
- v1.9 resume auto-injection assembles briefs from recent session-summary MemoryEntries. A fresh ClawCode agent with zero history feels discontinuous — it's been running for years in OpenClaw.

**Hybrid wins:**
- **Last 3 sessions per agent** → run through SessionSummarizer (or a migration-specific summarizer using the same deterministic-fallback pattern from SESS-01) to generate real session-summary MemoryEntries. This primes the conversation-brief auto-injection on first wake-up.
- **Rest of the archive** → copied to `<workspace>/archive/openclaw-sessions/` and indexed by a one-time `memory_lookup`-reachable metadata entry ("historical sessions available at...") with a date range. If the agent needs older context, it can `memory_lookup` surface the pointer and (optionally) the user can ask for deeper retrieval.

This matches the Codex-CLI pattern referenced in the research: "automatically saves conversation logs locally; these files are the same ones used when selecting a session with `codex resume`" — preserved but not forcibly re-imported.

**Default N = 3** (matches v1.9 default `conversation_context` budget). Configurable via `--replay-last N` migration flag for agents where the user wants more warmth.

## Feature Dependencies

```
enumerate-source
    └──required by──> dry-run
                          └──required by──> per-agent diff
                                                └──required by──> apply (never without diff having been shown)

pre-flight validation
    └──required by──> apply

state file (journal)
    ├──required by──> idempotent re-run
    ├──required by──> resume-from-failure
    └──required by──> rollback

per-agent selection ──enhances──> all of the above (scoping)

non-destructive-to-source ──constrains──> rollback (rollback only unmakes target; never touches source)

memory re-embedding
    └──required by──> memory translation
                          └──required by──> semantic dedup (differentiator — requires embeddings to exist first)

.learnings/ → MemoryEntry translation ──independent of──> memory re-embedding (separate pipeline)

session archive warm-link
    └──requires──> last-N sessions being parseable OpenClaw JSONL
    └──requires──> v1.9 SessionSummarizer being callable from migration context

shared-workspace support
    ├──requires──> basePath per-agent override in config schema
    ├──requires──> overlay file resolution (souls/<name>.md, identities/<name>.md)
    └──blocks──> default "one dir per agent" assumption in daemon/SessionManager

plan-file mode (differentiator)
    └──requires──> dry-run producing deterministic output (same input → same plan)

identity-drift detection (differentiator)
    └──requires──> embedding infrastructure (resident embedder singleton exists — v1.7 WARM-03)
```

### Dependency Notes

- **Dry-run must land before apply.** Apply is just "dry-run + actually write". If dry-run is half-baked, apply is dangerous.
- **State file is load-bearing.** Idempotent re-run, resume-from-failure, and rollback all read/write the same journal. Design this schema first; the rest is a consumer.
- **Plan-file is a dry-run superset.** Not a separate feature — just "dry-run output written to a specific path with stable format".
- **Memory re-embedding is not optional.** Embedding dim and model differ between the two systems; there is no world where OpenClaw vectors work against sqlite-vec in ClawCode. This is a mandatory translation step, not a choice.
- **Shared-workspace support touches the config schema.** Unlike other features that live entirely inside the migrator, this one requires ClawCode's core to understand per-agent `basePath` and overlay resolution. Roadmap coupling.

## MVP Definition

### Launch With (v2.1.0 — table stakes only)

Minimum viable migrator. If any of these are missing, the tool is not usable for a production cutover.

- [ ] **`clawcode migrate openclaw list`** — enumerate source agents
- [ ] **`clawcode migrate openclaw plan [--agent X]`** — dry-run + per-agent diff output
- [ ] **`clawcode migrate openclaw apply [--agent X] [--yes]`** — execute with explicit confirmation
- [ ] **Pre-flight validation** — fails fast with actionable errors
- [ ] **State file / journal** — `~/.clawcode/migrate/state.json` tracking per-(agent,domain) status
- [ ] **Idempotent re-run** — reading the state file, skip succeeded units
- [ ] **Resume-from-failure** — retry only failed units on re-run
- [ ] **Per-agent selection** — migrate subsets, not all-or-nothing
- [ ] **Config mapping** — openclaw.json agent entry → clawcode.yaml agent block (with `soul`/`identity` stored as workspace files, not inlined)
- [ ] **Workspace file copy** — SOUL.md, IDENTITY.md, USER.md, TOOLS.md, CLAUDE.md, archive/, .learnings/ (pure copy in v2.1.0 — translation is differentiator)
- [ ] **Shared-workspace support for finmentum family** — Pattern A (per-agent `basePath` override + overlay files) — this is an explicit user ask, not deferrable
- [ ] **Memory translation + re-embedding** — OpenClaw sqlite → ClawCode memories.db with fresh embeddings; preserve content verbatim
- [ ] **Credential preservation** — `op://` references copied as-is, never resolved
- [ ] **Post-migration verification** — per-agent smoke test (config parses, memory DB opens, daemon can load)
- [ ] **Rollback** — `clawcode migrate openclaw undo [--agent X]` unwinds target-side writes
- [ ] **Structured logs + stdout** — pino JSONL + human-readable progress
- [ ] **Non-destructive to source** — never modify `~/.openclaw/`

### Add After Validation (v2.1.x)

Features to add once the core migrator has been run successfully on at least a few agents.

- [ ] **Last-N session warm-link** — import recent sessions into ConversationStore so agents wake up with continuity. Defer only because v2.1.0 can ship with "pointer to archive" and users can upgrade later.
- [ ] **`.learnings/` → MemoryEntry translation** — adds searchability via memory_lookup. Defer only because it requires tag/importance schema decisions that benefit from real usage feedback.
- [ ] **Plan-file mode** (`--plan <path>`, `--apply <path>`) — TOCTOU safety. Add once users ask for it after running the basic plan/apply cycle a few times.
- [ ] **Semantic memory dedup** — cosine-similarity merge pass. Defer because it needs real corpora to tune thresholds.
- [ ] **Identity-drift detection** — embedding comparison pre/post. Cheap; could make MVP if trivially added.
- [ ] **Post-migration drift status** (`clawcode migrate openclaw status`) — useful during the transition period.

### Future Consideration (v2.2+)

- [ ] **Interactive TUI review** — only if 15-agent run reveals that per-agent terminal-diff review is slow in practice.
- [ ] **Shared-workspace conflict detection** (automated) — manual review in v2.1 is fine for one family of 5; automate if more groups emerge.
- [ ] **Bidirectional-drift reconciliation** (when user edits ClawCode side after migration, detect & warn) — speculative.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `migrate openclaw list` | MEDIUM | LOW | P1 |
| `migrate openclaw plan` + per-agent diff | HIGH | MEDIUM | P1 |
| `migrate openclaw apply` + confirmation | HIGH | MEDIUM | P1 |
| Pre-flight validation | HIGH | MEDIUM | P1 |
| State file / journal | HIGH | MEDIUM | P1 |
| Idempotent re-run | HIGH | MEDIUM | P1 |
| Resume-from-failure | HIGH | MEDIUM | P1 |
| Per-agent selection | HIGH | LOW | P1 |
| Config mapping | HIGH | MEDIUM | P1 |
| Workspace file copy | HIGH | LOW | P1 |
| Memory translation + re-embedding | HIGH | MEDIUM | P1 |
| Credential preservation | HIGH | LOW | P1 |
| Post-migration verification | HIGH | MEDIUM | P1 |
| Rollback | HIGH | MEDIUM | P1 |
| Structured logs | MEDIUM | LOW | P1 |
| Non-destructive to source | HIGH | LOW | P1 |
| Shared-workspace support (finmentum) | HIGH | HIGH | P1 |
| Last-N session warm-link | MEDIUM | MEDIUM | P2 |
| `.learnings/` → MemoryEntry translation | MEDIUM | MEDIUM | P2 |
| Plan-file mode | MEDIUM | MEDIUM | P2 |
| Identity-drift detection | MEDIUM | LOW | P2 |
| Semantic memory dedup | MEDIUM | MEDIUM | P2 |
| `migrate openclaw status` drift | MEDIUM | MEDIUM | P2 |
| Summary report artifact | LOW | LOW | P2 |
| Interactive TUI review | LOW | HIGH | P3 |
| Shared-workspace conflict auto-detect | LOW | MEDIUM | P3 |

**Priority key:**
- **P1** — Must have for v2.1.0 launch. Migrator is unusable without this.
- **P2** — Should have, add in v2.1.x as follow-up.
- **P3** — Future consideration, not part of current milestone.

## Competitor / Prior-Art Feature Analysis

This is a niche category (multi-agent system migration), so "competitors" here is really "prior-art migration tools that establish baseline user expectations".

| Feature | Alembic / dbt / Terraform | Codex CLI archives | Our Approach |
|---------|---------------------------|--------------------|--------------|
| Dry-run / plan | Standard (`alembic upgrade --sql`, `terraform plan`, `dbt compile`) | N/A (no migration, pure archive) | Standard: `migrate openclaw plan` is default, `--apply` is explicit |
| Per-item status | Alembic version table, dbt manifest.json, Terraform state | Per-file JSONL | Per-(agent,domain) journal in `~/.clawcode/migrate/state.json` |
| Resume-from-failure | dbt `--exclude` + re-run; Alembic handles each revision atomically | N/A | Journal + per-unit atomicity |
| Rollback | `alembic downgrade`, `terraform destroy` (dangerous), dbt has none | N/A | `migrate openclaw undo` — safe because source is read-only |
| Idempotent | Alembic tracks applied revisions; dbt is state-driven; Terraform diffs state vs. desired | N/A | Journal-driven skip of succeeded units |
| Session / conversation import | N/A | Preserve as archive, resume via pointer | Hybrid: last-N imported + rest as pointer |
| Schema translation w/ re-embed | Not applicable to any of these | N/A | Mechanical + re-embed (matches "Advanced RAG" best practice) |
| Shared config / multi-tenant | Alembic multi-schema support; dbt profiles; Terraform workspaces | N/A | Pattern A: per-agent `basePath` override + overlay files |

## Known Unknowns / Research Gaps

1. **Exact OpenClaw sqlite schema** for file-RAG — the migrator will need to read it directly. Not investigated here; Phase 0 / pre-flight validation should cover schema verification.
2. **OpenClaw session JSONL turn shape** — exact fields, timestamp format, turn boundary representation. Needs sampling of real archives before session warm-link can be implemented. Surfaced for a future phase.
3. **Finmentum workspace contents today** — which files are already de-facto shared in OpenClaw, which are per-agent, and where the boundaries live. Needs a one-time inspection before coding the Pattern A migration logic.
4. **Credential reference format** — confirm `op://...` is the only format used across all 15 agents' MCP configs; if mixed (e.g., env vars, plaintext), need a broader strategy. Pre-flight validation catches this.
5. **Hot-reload interaction** — does the migration tool run with the ClawCode daemon up or down? If up, chokidar will try to load half-migrated agents. Recommend: migration tool writes to a staging path and does an atomic rename+reload step at the end.

## Sources

Migration tool UX patterns:
- [AWS Migration Rollback Strategies](https://aws.amazon.com/blogs/migration-and-modernization/migration-rollback-strategies-when-your-migration-doesnt-go-as-planned/) — dry-run and rollback planning best practices (MEDIUM confidence)
- [Data Migration Checklist 2026](https://www.quinnox.com/blogs/data-migration-checklist/) — end-to-end migration process (MEDIUM)
- [Database Rollbacks in CI/CD](https://medium.com/@jasminfluri/database-rollbacks-in-ci-cd-strategies-and-pitfalls-f0ffd4d4741a) — forward-only migrations, write the inverse first (MEDIUM)
- [Trouble-Free Database Migration: Idempotence and Convergence](https://dzone.com/articles/trouble-free-database-migration-idempotence-and-co) — idempotent DDL scripts, convergence pattern (MEDIUM)
- [Alembic Documentation](https://alembic.sqlalchemy.org/en/latest/autogenerate.html) — state tracking, version table pattern (HIGH)

RAG chunks → knowledge graph translation:
- [Advanced RAG Techniques (Neo4j)](https://neo4j.com/blog/genai/advanced-rag-techniques/) — re-embedding on model upgrades, chunk-size alignment (MEDIUM)
- [Embeddings + Knowledge Graphs for RAG (TDS)](https://towardsdatascience.com/embeddings-knowledge-graphs-the-ultimate-tools-for-rag-systems-cbbcca29f0fd/) — hybrid retrieval, lightweight schema (MEDIUM)
- [AI Memory vs RAG vs Knowledge Graph (Atlan)](https://atlan.com/know/ai-memory-vs-rag-vs-knowledge-graph/) — incremental memory construction (MEDIUM)
- [Cognee — AI Memory Explained](https://www.cognee.ai/blog/fundamentals/ai-memory-in-five-scenes) — Add → Cognify → Memify → Search pipeline (MEDIUM)
- [Mem0 — mem0ai/mem0 (GitHub)](https://github.com/mem0ai/mem0) — universal memory layer incremental patterns (MEDIUM)

SOUL.md / identity file patterns:
- [What Makes a Soul File Actually Work (souls.zip)](https://souls.zip/notes/what-makes-a-soul-file-actually-work-patterns-from-engineering-30-agent-identiti) — 200-500 word sweet spot, markdown over JSON (MEDIUM)
- [OpenClaw SOUL.md Persona Guide (Stanza)](https://www.stanza.dev/concepts/openclaw-soul-persona) — workspace-file pattern, cascade resolution (MEDIUM)
- [Learn OpenClaw — SOUL.md & Identity](https://learnopenclaw.com/core-concepts/soul-md) — editable/diff-able text files over schema'd config (MEDIUM)

Conversation log / session archive patterns:
- [Codex CLI: Access Past Conversations from JSONL](https://betelgeuse.work/codex-resume/) — archive + resume pointer pattern (MEDIUM)
- [AnythingLLM Chat Logs](https://docs.anythingllm.com/features/chat-logs) — JSONL export for preservation, not replay (MEDIUM)
- [Unified Chat History and Logging System (Medium)](https://medium.com/@mbonsign/unified-chat-history-and-logging-system-a-comprehensive-approach-to-ai-conversation-management-dc3b5d75499f) — SQLite for hot, JSON for cold (MEDIUM)

Multi-tenant / shared workspace patterns:
- [pnpm Workspaces](https://pnpm.io/workspaces) — workspace references, alias patterns (HIGH)
- [Multi-tenant Configurations (Apache Commons)](https://commons.apache.org/proper/commons-configuration/userguide/howto_multitenant.html) — per-tenant unique configuration with shared base (MEDIUM)
- [Symlinks for Multi-Folder Dev (CSS-Tricks)](https://css-tricks.com/symbolic-links-for-easier-multi-folder-local-development/) — symlink tradeoffs (MEDIUM)

Existing ClawCode context (internal):
- `.planning/PROJECT.md` — v2.1 milestone scope, Out-of-Scope list, Key Decisions
- `CLAUDE.md` — project overview and tech stack
- `clawcode.yaml` — current agent config schema showing both inline and file-based soul/identity patterns

---
*Feature research for: v2.1 OpenClaw Agent Migration tooling*
*Researched: 2026-04-20*
