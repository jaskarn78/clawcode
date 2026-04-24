# Pitfalls Research

**Domain:** Multi-agent orchestration data migration (OpenClaw → ClawCode, 15 live agents, live coexistence)
**Researched:** 2026-04-20
**Confidence:** HIGH (source schemas + source code verified directly on-box; OpenClaw is running live under systemd)

---

## Context verified on-box (2026-04-20)

These are facts, not assumptions. Every pitfall below is tied to one of these observations.

| Fact | Source |
|---|---|
| OpenClaw memory uses **gemini-embedding-001, 3072-dim** vectors | `SELECT value FROM meta WHERE key='memory_index_meta_v1'` on `general.sqlite` returns `{"provider":"gemini","model":"gemini-embedding-001","vectorDims":3072}`. Every chunk row's `model` column is `gemini-embedding-001`. |
| ClawCode memory uses **all-MiniLM-L6-v2, 384-dim** vectors | `vec_memories` is `vec0(memory_id TEXT PRIMARY KEY, embedding float[384] distance_metric=cosine)` in `.clawcode/agents/test-agent/memory/memories.db` |
| OpenClaw schema is **file-RAG** (chunks point at file paths) | `chunks(path, start_line, end_line, hash, model, text, embedding)` + FTS5 on `text` |
| ClawCode schema is **memory-object** (no file pointer) | `memories(id, content, source CHECK IN (conversation/manual/system/consolidation/episode), importance, tier, tags JSON)` |
| Memory volumes are large enough to matter | general.sqlite=128MB (~thousands of chunks), fin-acquisition.sqlite=97MB, projects.sqlite=71MB, finmentum-content-creator=47MB, research=48MB |
| Live OpenClaw daemon is running | `openclaw-gateway.service` active, pid 755761, ~1.3GB RSS |
| OpenClaw Discord bot token is **plaintext in openclaw.json** | `channels.discord.token = "MTQ3MDE2MjYzMDY4NDcwNDg4MQ.GLLa1Z..."` (literal secret, not a reference) |
| ClawCode Discord token is a **1Password ref** | `clawcode.yaml: discord.botToken = op://clawdbot/Clawdbot Discord Token/credential` |
| **Different Discord bot tokens** = different bot identities | OpenClaw token prefix `MTQ3MDE2MjYzMDY4NDcwNDg4MQ` (bot ID 1470162630684704881) is not `op://clawdbot/Clawdbot Discord Token` |
| All 5 finmentum agents share one workspace | `fin-acquisition, fin-research, fin-playground, fin-tax` all have `workspace: /home/jjagpal/.openclaw/workspace-finmentum`; `finmentum-content-creator` has its own |
| Workspaces are git repos with uncommitted work | workspace-general has 30+ untracked paths including `.omc/`, `MEMORY.md`, `config/`, `data/`; `.git` is 416KB |
| ClawCode has NO shared-workspace support today | `loader.ts:153` — `workspace: agent.workspace ?? join(expandHome(defaults.basePath), agent.name)`; schema assumes 1:1 agent↔workspace |
| `agents.*.workspace` is NON-RELOADABLE | `config/types.ts:56-61` — adding 15 agents hot-reloads (agents.* is not in NON_RELOADABLE) **but** changing an existing agent's workspace does require restart |
| ClawCode memory store has **no UNIQUE on content/hash** | `memories` PK is `id` only; re-running a migrator with regenerated IDs creates duplicate rows |
| Agent provisioner **does** reject duplicate names | `agent-provisioner.ts:120` throws `agent '${name}' already exists` — but this only fires on the `provision_agent` IPC path, not on config hot-reload |
| Webhook provisioner is idempotent-ish | `webhook-provisioner.ts:74` reuses existing bot-owned webhooks per channel |
| ClawCode embeds **identity + soul inline in YAML** | `test-agent` in clawcode.yaml has `soul: \|` and `identity: \|` block scalars — OpenClaw keeps them as `SOUL.md` / `IDENTITY.md` files |
| Old JSONL replay files exist but are sparse | workspace-general has `.omc/state/agent-replay-*.jsonl` (only 2, not 413) — the "413 files" must be in a different scope (probably the gateway's queue or per-session logs) |

---

## Critical Pitfalls

### Pitfall 1: Embedding dimension mismatch silently corrupts `vec_memories`

**What goes wrong:**
You write a migrator that reads `chunks.embedding` from OpenClaw's sqlite and inserts it into ClawCode's `vec_memories`. The insert succeeds because sqlite-vec only enforces the column dimension at query time for some code paths, or you "helpfully" truncate to 384 and think it worked. Every subsequent KNN search returns garbage: either zero results (because sqlite-vec rejects mismatched vectors per-row once it tries to read them) or semantically meaningless nearest neighbors (because 384 truncated dims of a 3072-dim Gemini vector is noise). The agent can't find anything in its own memory on day one.

**Why it happens:**
OpenClaw uses `gemini-embedding-001` (3072 dims) and stores embeddings as TEXT (JSON-serialized floats). ClawCode uses `all-MiniLM-L6-v2` (384 dims) and stores in sqlite-vec's `float[384]`. These are **different vector spaces** — cosine similarity between them is not just scale-shifted, it's geometrically meaningless. You cannot slice, pad, or normalize your way across. The only correct path is **re-embed from source text** using ClawCode's local model. Developers skip this because "we already have embeddings, just copy them over" feels faster.

**How to avoid:**
- **Migrator contract:** read `chunks.text` (not `chunks.embedding`) from OpenClaw, pass through ClawCode's `EmbeddingService.embed()` (singleton, per v1.7 warm-path), write into ClawCode schema. Throw loudly if any source chunk has `model != 'gemini-embedding-001'` so you notice schema drift.
- **Hard assertion:** after write, run `SELECT vec_length(embedding) FROM vec_memories LIMIT 1` and assert `== 384`. Fail the phase if not.
- **Parity test:** migrate one agent (personal is small — 5MB), then run 10 known-good semantic queries ("where are my strava tokens", "heygen avatar id") and assert top-1 hit is the same file that OpenClaw returned for the same query. No parity → do not proceed to the next agent.
- **Do not preserve Gemini dimensions in ClawCode** — it would require a whole second vec0 table, a second embedder at query time, and splits the agent's memory across two index spaces. Not in scope.

**Warning signs:**
- `memory_lookup` returns wildly different top-K for the migrated agent vs. what OpenClaw returned for the same query
- `vec_length()` check fails (dimension != 384)
- First-run heartbeat for a migrated agent logs "no relevant memories found" on queries that clearly have matches in `MEMORY.md`

**Severity:** **CRITICAL / data-loss-equivalent.** The rows exist but are unfindable — "data loss with extra steps." Every agent's semantic continuity is broken.

**Phase to address:** Dedicated memory-translation phase — must land before any agent is cut over. Do not merge with workspace copy phase.

---

### Pitfall 2: Re-running the migrator produces duplicate memories

**What goes wrong:**
You run `clawcode migrate openclaw --agent general --apply`. It works. You notice a bug, fix it, re-run. Now `memories.db` has **two rows for every memory**: different `id` (nanoid at write time), same `content`. Importance scoring, relevance decay, and dedup-on-save all fire on both copies. Agent starts returning the same memory twice in `memory_lookup`, or worse, tier-manager oscillates between them.

**Why it happens:**
ClawCode's `memories` schema has `PRIMARY KEY(id)` only. There is **no UNIQUE on content**, no `origin_id` column, and the existing `dedup.ts` is a similarity-threshold dedup tuned for runtime writes (near-duplicates) not exact-match re-runs. The migrator generating a fresh nanoid per run means the dedup function never sees a match at id-level, and content-similarity dedup fires at 0.95+ cosine, which is probabilistic. Re-runs accidentally double-insert.

**How to avoid:**
- Add an `origin_id TEXT UNIQUE` column (or index) to `memories` specifically for migration-sourced rows: `origin_id = "openclaw:{agent}:{chunks.id}"`. On re-insert, `INSERT OR IGNORE` / `ON CONFLICT(origin_id) DO UPDATE SET updated_at=?`. Native migrations already use `source` enum — add `origin_id` alongside.
- Migrator must be **explicitly idempotent** — `--apply` should log "upserted X / skipped Y (already imported)" per agent, and a second run should show `upserted 0`.
- `--force-reimport` flag for when you actually want to blow it away — deletes all rows where `origin_id LIKE 'openclaw:%'` first.

**Warning signs:**
- Migrated memory count after re-run > memory count after first run
- `SELECT content, COUNT(*) FROM memories GROUP BY content HAVING COUNT(*) > 1` returns rows
- `memory_lookup` returns the same chunk twice in its top-K

**Severity:** **HIGH / rollback pain.** Not data loss, but requires a dedup-and-repair pass across every migrated agent, and tier-manager state gets corrupt along the way.

**Phase to address:** Memory-translation phase — design the schema column + INSERT OR IGNORE before writing a single row. Cheap to add now, expensive to retrofit.

---

### Pitfall 3: Live OpenClaw daemon keeps writing while you copy its state

**What goes wrong:**
You start copying `~/.openclaw/workspace-general/` to the new ClawCode agent dir. Meanwhile `openclaw-gateway.service` (verified running on this box, PID 755761, 1.3GB RSS) is still receiving Discord messages, the general agent is still writing `memory/2026-04-20-*.md`, its sqlite indexer fires and `chunks.sqlite` gets WAL-checkpointed mid-copy. You end up with a partially-copied workspace: some files from before a write, some from after, and a sqlite file whose `-wal` sidecar you didn't copy. Opening it in ClawCode either shows stale data or fails integrity checks.

**Why it happens:**
SQLite in WAL mode has three files (`.sqlite`, `.sqlite-wal`, `.sqlite-shm`). A naive `fs.cp` or `cp -r` copies the main file but you might miss the WAL, capture it half-flushed, or capture the -shm which then confuses the reader. Markdown files have the opposite problem — they're independently consistent but the full workspace is a moving target.

**How to avoid:**
- **Stop the source agent before copying.** Either (a) `openclaw-gateway stop <agent>` for that specific agent via its CLI, or (b) accept a short full-daemon pause: `systemctl --user stop openclaw-gateway`, copy, start.
- **Copy sqlite via `VACUUM INTO` or the backup API**, not `fs.cp`. `sqlite3 source.sqlite ".backup target.sqlite"` produces a consistent snapshot even with a live writer. Or use better-sqlite3's `db.backup()` for the same guarantee from Node.
- **Per-agent migration, not whole-fleet.** Migrate `personal` (smallest, 5MB, low-activity) first — only needs to pause `personal`. Migrate `general` (128MB, highest activity) last, during a planned maintenance window.
- **Checksum verification.** Hash the source workspace before copy + after migration; if ClawCode agent's raw markdown hashes don't match the source, abort and rollback that agent.

**Warning signs:**
- `SQLITE_CORRUPT` or "database disk image is malformed" when ClawCode opens the migrated db
- Migrated agent's MEMORY.md missing entries from "last hour"
- Agent restarts but complains about missing files

**Severity:** **CRITICAL / data loss** if sqlite corrupts. **MEDIUM / data staleness** for markdown races.

**Phase to address:** Migration tooling phase (`clawcode migrate openclaw`) — the CLI must orchestrate source-daemon pause + backup-API copy, not leave it to the operator.

---

### Pitfall 4: Shared workspace + per-agent memory DB creates 5-way write contention for finmentum

**What goes wrong:**
All 5 finmentum agents (`fin-acquisition`, `fin-research`, `fin-playground`, `fin-tax`, `finmentum-content-creator`) point at `/home/jjagpal/.openclaw/workspace-finmentum`. After migration they'll all write to the same workspace directory. Without a plan, they all try to write `MEMORY.md`, `inbox/`, `.learnings/` — five processes racing on the same files, no file locks, no agent namespacing. ClawCode's `memories.db` is per-agent (correct), but the markdown-side of the workspace is unowned.

**Why it happens:**
Confirmed: ClawCode's `loader.ts:153` resolves `workspace = agent.workspace ?? basePath/agent.name`. That `??` means two agents can legally declare the same `workspace:` field — no validation rejects it. But every subsystem downstream (memory-md writer, inbox watcher, auto-linker, heartbeat) assumes **one agent owns a workspace**. Chokidar watchers from 5 agents on the same dir multiply events by 5. Inbox race is unavoidable.

**How to avoid:**
- **Design the shared-workspace contract before migration.** Three legitimate patterns:
  1. **Per-agent subdirectories inside the shared workspace:** `workspace-finmentum/agents/fin-acquisition/MEMORY.md`, etc. Shared state goes at workspace root. ClawCode's memory-md writer takes an `agentSubdir` param. Simplest.
  2. **Workspace as shared read-only, memory per-agent elsewhere:** cwd for the process is the shared workspace (so Read/Write tools can access `finmentum/compliance/...`) but MEMORY.md / inbox / .learnings live in `basePath/<agentName>/`. Cleanest separation, but breaks the "memory next to workspace" pattern.
  3. **Explicit `workspaceGroup`** in clawcode.yaml: agents with the same group share cwd but each has its own memory/inbox/heartbeat subroot. Requires schema change.
- Pick one, implement it, land it as a prerequisite phase **before** migrating any finmentum agent. The `test-agent` existing today does not exercise this — it's untested territory.
- **Chokidar deduplication:** if 5 agents watch the same path, only register one watcher and fan out events internally. Otherwise chokidar fires 5× on every file change.
- **Inbox ownership:** each finmentum agent needs its own inbox subdir. Cross-agent messaging's "write to other agent's inbox" pattern must write to `workspace-finmentum/agents/<target>/inbox/`, not `workspace-finmentum/inbox/`.

**Warning signs:**
- MEMORY.md gets corrupted / interleaved writes (you'll see half-sentences from two agents spliced together)
- Heartbeat events fire 5× per workspace change
- Two agents "find" each other's memory entries in `memory_lookup` (only if we wrongly shared the DB — don't)
- Git status inside `workspace-finmentum` becomes unusable — 5 agents all modify tracked files

**Severity:** **HIGH / observable bugs + data corruption** at the markdown layer. Per-agent DBs stay safe (SQLite isolation is preserved by separate files), but the workspace-level state is a mess.

**Phase to address:** Must be its own phase ahead of migration. Call it "Shared-workspace support" or similar. Don't conflate with "migration tooling" — this is a runtime feature addition.

---

### Pitfall 5: Discord bot token divergence — migrated agents come up on the wrong bot

**What goes wrong:**
OpenClaw's `openclaw.json` has `channels.discord.token` hardcoded as `MTQ3MDE2MjYzMDY4NDcwNDg4MQ.GLLa1Z...` (literal Discord bot token, bot ID 1470162630684704881). ClawCode's `clawcode.yaml` resolves `discord.botToken` from `op://clawdbot/Clawdbot Discord Token/credential` — **this is a different bot**. If we migrate agents with their Discord channel IDs but don't change bots, the ClawCode daemon will connect as the Clawdbot bot and try to respond in channels the OpenClaw bot owns. Two bots in one channel = duplicate replies to every message. Or the channel doesn't have Clawdbot added and the messages go nowhere.

**Why it happens:**
Channel IDs are global Discord resources (independent of bot), but **who's listening** is per-bot. The operator has been running OpenClaw's bot as the authority in all 15+ Discord channels. Mid-migration, if both bots are in the same channel, both respond. If we swap bots channel-by-channel we need to ensure Clawdbot is invited with correct permissions before we cut over.

**How to avoid:**
- **Document the bot identity model up front.** Decide: do migrated agents keep the OpenClaw bot identity (same webhook avatars users recognize) or move to Clawdbot? If the latter, we need a channel-access migration (invite Clawdbot to every channel, grant `MANAGE_WEBHOOKS` so `webhook-provisioner` can auto-create identities).
- **Per-agent cutover gate:** before a migrated agent goes live, validate `Clawdbot` is a member of every channel in its `channels:` list with required permissions. ClawCode has `webhook-provisioner.ts` — extend it with a precheck.
- **During dual-run (Pitfall 10):** either stop the OpenClaw bot from posting in channels owned by migrated agents (kill those bindings in openclaw.json), or keep the bots on separate channels entirely until cutover is complete.

**Warning signs:**
- Users report getting two replies to every Discord message
- ClawCode daemon logs `Missing permissions` or `Channel not found` for channels that exist
- Webhook provisioning fails with "cannot create webhook — channel member not found"

**Severity:** **HIGH / observable UX bug.** Users will notice duplicate replies immediately.

**Phase to address:** Phase covering "MCP + Discord wiring" must include a pre-flight Discord-access check per migrated agent. Probably add a `clawcode migrate openclaw --check-discord` subcommand.

---

### Pitfall 6: Plaintext secrets in `openclaw.json` get re-introduced into `clawcode.yaml`

**What goes wrong:**
A naïve migrator reads `openclaw.json`, finds `env.OPENAI_API_KEY: sk-proj-...` or `channels.discord.token: MTQ3...` (plaintext), and writes these directly into `clawcode.yaml` under `mcpServers.openai.env.OPENAI_API_KEY: sk-proj-...`. The user's ClawCode config, which had been clean 1Password references (`op://clawdbot/...`), now has plaintext secrets. Worse: if `clawcode.yaml` is committed to this git repo (it's in `workspace-coding/` which is a git repo), those secrets land in history. If any of those keys had been rotated since OpenClaw captured them, we just re-exposed the **old** rotated key — an attacker who had that key can exploit it again.

**Why it happens:**
OpenClaw stores Discord token as a raw string. It also has env overrides per-agent for MCP servers. A "copy over what's there" migrator treats these values as opaque strings and happily writes them to the target. The fact that ClawCode uses `op://...` references is a convention, not an enforced invariant in schema.

**How to avoid:**
- **Migrator whitelist, not blacklist.** The migrator should only copy per-agent **references** (e.g., channel IDs, MCP server names from a known list) — never raw values for any field matching `/key|token|secret|password/i`.
- **Refuse to write secrets:** if the migrator sees a field that looks like a secret (regex, or a known list of sensitive keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `BRAVE_API_KEY`, `HA_TOKEN`, `FAL_API_KEY`, `HEYGEN_API_KEY`, `FINMENTUM_DB_PASSWORD`, `STRAVA_*`, `FINNHUB_API_KEY`, the Discord token), it must **fail with instructions** to set up the matching `op://` reference. Never silently inline.
- **Reuse the existing `mcpServers:` section in `clawcode.yaml`.** Don't synthesize per-agent MCP env blocks — just map agent → list of mcpServer names that already exist at the file level. The existing file already has clean 1Password refs for every server an agent will need.
- **Secret scan pre-commit:** add a gitleaks/trufflehog check in CI (or at least a git pre-commit hook) on `clawcode.yaml` specifically. Block commits that contain raw bot-token-shaped strings (`M[A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}`) or `sk-*` / `sk-ant-*` / `sk-proj-*` prefixes.
- **Rotate credentials mid-migration** as a standard practice — the OpenClaw token dates back months, this is a good moment to rotate all shared secrets.

**Warning signs:**
- `grep -P 'M[A-Za-z0-9]{23}\\.[A-Za-z0-9_-]{6}\\.' clawcode.yaml` returns a match
- `grep -E 'sk-(ant-|proj-)?[A-Za-z0-9]{20}' clawcode.yaml` returns a match
- Any agent `mcpServers[].env.*` value that doesn't start with `op://` or `${...}`

**Severity:** **CRITICAL / security.** Rotated secrets re-exposed, plaintext in a git-tracked file, public bot token if this repo ever becomes public.

**Phase to address:** Config-mapping phase. Must have a "secret redaction" step that's enforced by the migrator itself, not just by operator discipline.

---

### Pitfall 7: `fs.cp` on a workspace that's a git repo clones the `.git` but not hooks, submodules, or uncommitted state correctly

**What goes wrong:**
11 of the 20 OpenClaw workspaces are git repos (verified: `workspace-general`, `workspace-finmentum`, `workspace-finmentum-content-creator`, etc.). `workspace-general` has 30+ untracked files including `MEMORY.md`, `config/`, `data/` — the core of the agent's state. If you `fs.cp --recursive` or `cp -r` and include `.git`, you copy a valid git repo with stale refs but lose any git-only metadata (hooks are regular files and do copy; submodules don't; `git worktree` references break). If you *exclude* `.git`, you also lose `.gitignore` (wait — that's a regular file, that copies) but lose the ability for the migrated agent to see "here's what I've committed vs not" which users rely on.

A nastier version: `workspace-general/.git` has a commit message referencing absolute paths (`/home/jjagpal/.openclaw/workspace-general/...`). When you copy to `/home/jjagpal/.clawcode/agents/general/`, any hook or config using absolute paths breaks silently. And `node_modules/.bin/` on these workspaces has ~17 broken symlinks after copy if the relative link targets don't exist in the new location.

**Why it happens:**
Node's `fs.cp` with `{ recursive: true }` follows symlinks by default (breaking them), doesn't preserve git-specific semantics, and treats `.git` like any other directory. `node_modules` directories (present in `workspace-general/remotion-banner-dev/node_modules`) have a forest of symlinks that are either relative or absolute — both break on a move.

**How to avoid:**
- **Don't use `fs.cp`. Use `rsync -a --delete` with explicit preserve flags:** `rsync -a --links --hard-links --exclude='node_modules' --exclude='.omc/state' workspace-general/ ~/.clawcode/agents/general/`. `rsync -a` preserves symlinks-as-symlinks, owner, timestamps.
- **Exclude `node_modules` entirely.** Agents can `npm install` on first run. Migrating a 400MB node_modules is wasteful and broken.
- **Exclude `.omc/state/*.jsonl` and other OpenClaw-specific runtime state** — these are session-replay files, useless in ClawCode, and Pitfall 8 covers the format question.
- **Preserve `.git` but run `git fsck` after copy.** If fsck fails, the git repo is corrupt — re-clone fresh if possible or document the loss.
- **Rewrite absolute paths post-copy.** Scan copied markdown files for `/home/jjagpal/.openclaw/workspace-<name>/` and rewrite to the new path. Otherwise SOUL.md, MEMORY.md references point at the old location.

**Warning signs:**
- Broken symlink count in migrated workspace (`find . -xtype l | wc -l`) > 0
- `git -C <new-path> status` errors with "not a git repository" or "gitdir not found"
- MEMORY.md contains absolute paths to the OpenClaw location after migration
- Disk usage of migrated workspace >> source (hint: you copied node_modules)

**Severity:** **MEDIUM / observable bugs + wasted disk.** Not data loss, but agents hit confusing errors on day one.

**Phase to address:** Workspace-migration phase — the copy step needs an explicit exclude-list spec, not "just copy everything."

---

### Pitfall 8: Attempting to replay OpenClaw JSONL session logs into ClawCode's ConversationStore

**What goes wrong:**
The milestone description mentions "413 files in general alone" of JSONL archives. If we try to feed them to ClawCode's v1.9 `ConversationStore` / `SessionManager.captureInput()`, they'll be in the wrong format. OpenClaw's gateway-based architecture serialized entire gateway envelopes (`messageEnvelope`, peer kinds, channel routes). ClawCode's `ConversationStore.turns` table expects `{sessionId, turnId, role, text, provenance, sourceTurnIds}`. Fields don't line up. A naive replay either silently drops most of the data (bad — breaks conversation memory), or corrupts the store (worse — breaks future sessions).

**Why it happens:**
Two different architectures wrote their session data at different semantic levels. OpenClaw: gateway-routing log. ClawCode: per-turn conversation record with provenance. No shared format.

**How to avoid:**
- **Don't replay session logs. Import as static memory-summaries instead.** Run each agent's JSONL through a summarizer once (Haiku, batch), produce a single `source='consolidation'` MemoryEntry per session tagged `["legacy-session", "session:{openclaw-session-id}"]`, write to `memories.db`. This is how the ClawCode v1.5 cold-archive pattern already works.
- **Alternatively, do nothing.** Most of the "413 files" are probably low-value routing traces. Preserve the raw JSONL in `workspace/archive/openclaw-sessions/` as a cold artifact — agents can grep it via the search MCP if they need it — but don't parse them into structured memory.
- **Hard rule: no direct INSERT into `turns` from migration.** The FTS5 index, provenance, trust-channel flags, and injection-detection metadata all depend on capture going through `captureInput()`. Never bypass.

**Warning signs:**
- Post-migration agent can't recall conversations from "yesterday" via `memory_lookup` even though JSONL files are present
- ConversationStore integrity check fails (FTS5 mismatch with raw rows, missing provenance columns)
- `SELECT COUNT(*) FROM turns WHERE provenance IS NULL` after migration > 0

**Severity:** **MEDIUM / silent data loss** if we try to replay — the cost of a botched attempt is high because recovering the raw source is possible but expensive. **LOW** if we explicitly skip replay and just archive the raw files.

**Phase to address:** Explicit decision point in the roadmap: "session history migration — archive-only, no replay." Mark it and move on. Don't leave this ambiguous — ambiguity invites a junior engineer to "helpfully" try to replay.

---

### Pitfall 9: Hot-reload fires mid-migration and spawns half-configured agents

**What goes wrong:**
The ClawCode daemon is running with a ConfigWatcher on `clawcode.yaml` (confirmed in `config/watcher.ts` — chokidar-based, 500ms debounce). You edit the YAML to add the 15 migrated agents. The watcher fires after your first save — even though you haven't finished setting up all 15 workspace directories yet. The daemon tries to spawn agents whose `workspace:` path doesn't exist, or whose `memories.db` is still being populated by the migrator. Claude Code processes fail to start, the daemon logs 15 errors, and the in-flight migration now has to deal with "agent already exists (in a broken state)".

**Why it happens:**
Chokidar doesn't know the config is mid-edit. Your editor's save-on-blur, your `yq` script, or `clawcode migrate --apply` (writing yaml) all look identical to the watcher. 500ms debounce is fine for interactive edits, useless for a scripted bulk change.

**How to avoid:**
- **Migrator writes to a side file, then atomically renames.** `clawcode.yaml.migrate-tmp` → `fsync` → `rename()` to `clawcode.yaml`. This is one event, not many. Critical: rename on the same filesystem, which is always true here.
- **Stage the workspace first, config last.** Order: (1) create `~/.clawcode/agents/<name>/` dir, (2) populate memories.db, (3) copy workspace contents, (4) write the YAML entry. When chokidar fires, the agent is already ready.
- **Pause mode via IPC.** Add a `clawcode ipc pause-config-watcher` / `resume-config-watcher` handshake. Migrator pauses, does all its work, writes the YAML, resumes. Worst-case fallback: `systemctl stop clawcode-daemon && migrate && systemctl start`.
- **Dry-run mode in the watcher.** Before applying a diff, if diff adds >5 agents at once, pause and log "bulk config change detected — applying in batches of 5". Makes partial failure recoverable.

**Warning signs:**
- Daemon log shows `agent spawn failed: workspace does not exist` for migrated agents
- Partial agent appears in `clawcode fleet` (registered but not spawning)
- Hot-reload audit trail (`config/audit-trail.json`) shows 15 separate diff events within 30 seconds instead of 1 bulk event

**Severity:** **MEDIUM / rollback pain.** Recoverable (stop-daemon, fix state, start), but "I broke prod while migrating to it" is a bad look and the timing can produce weird half-states.

**Phase to address:** Migration tooling phase — the CLI must handle the watcher coordination, not leave it to the operator's shell discipline.

---

### Pitfall 10: Coexistence during rollout — both OpenClaw and ClawCode listen to the same Discord channel

**What goes wrong:**
Verified: OpenClaw gateway is running live (`systemctl --user: openclaw-gateway.service active`). During a 15-agent staged migration, you'll have days or weeks where both systems are up. If you forget to unbind an agent from OpenClaw before binding it in ClawCode, both systems receive the same Discord message, both route to their respective agent, both reply. User gets duplicate responses. Worse: both agents try to update memory for the "same" event — but each is a separate memory stream, so state diverges.

**Why it happens:**
Cutover is not atomic. The sane rollout is "migrate agent N, unbind from OpenClaw, bind in ClawCode". But the Discord channel doesn't know about either bot's config — both bots are still members, both still receive gateway events for the channel. The only way they stop responding is **they choose not to**, driven by their respective config.

**How to avoid:**
- **Cutover protocol per agent:**
  1. Migrate memories + workspace to ClawCode (agent exists in ClawCode, not yet bound).
  2. Validate memory parity (Pitfall 1) + smoke test.
  3. **Remove** the agent's entry from `openclaw.json` `bindings` (or disable the binding). This makes OpenClaw stop replying in that channel.
  4. Only then add the agent to `clawcode.yaml` `channels:`.
  5. Observe in channel for 15 minutes — confirm Clawdbot responds, OpenClaw bot does not.
- **Per-channel lockfile.** Optional safety: ClawCode refuses to bind to a channel ID if `openclaw.json` bindings also lists it. Read openclaw.json at migrate-time, cross-check. Hard-fail with "disable the OpenClaw binding for channel X first".
- **Separate test channels.** Before any production channel cutover, migrate `test-agent` equivalent to a dedicated test channel where OpenClaw is not bound. Validate end-to-end there.
- **Kill switch.** Keep the OpenClaw daemon stoppable on 30-seconds notice: `systemctl stop openclaw-gateway`. If cutover goes wrong, buy yourself time.

**Warning signs:**
- Users see double replies
- Discord audit log shows both bot users posting within the same second
- OpenClaw's `bindings` and ClawCode's `channels:` share any channel ID

**Severity:** **HIGH / user-visible bug.** Cheap to fix (unbind one side), expensive if it runs for hours.

**Phase to address:** Cutover phase (one of the last) — must have an explicit per-agent checklist. Also needed in the migration CLI as a `--check-coexistence` precheck.

---

### Pitfall 11: Partial migration with no rollback story

**What goes wrong:**
You migrate 8 of 15 agents over 3 days. On agent 9, you discover the memory translator has a subtle bug (dropped all memories with unicode emojis in their `content` field). Now: 8 agents are live on ClawCode with correct-ish data, their OpenClaw counterparts have been unbound from Discord, and fixing the bug means re-running the migrator which per Pitfall 2 will double-insert. The "rollback" options are: (a) re-enable OpenClaw bindings for agents 1-8 (their OpenClaw memory is 3 days stale — users will notice the regression), (b) leave them on ClawCode and accept the buggy import for anyone affected, (c) write a third tool to patch just the bug.

**Why it happens:**
Linear forward-only migration assumes each step succeeds. 15-agent fleet with varying memory sizes (5MB to 128MB) and complexities (shared-workspace finmentum) will have partial failures.

**How to avoid:**
- **Snapshot-before-apply.** `clawcode migrate openclaw --apply --snapshot` takes `.clawcode/backups/pre-migrate-<timestamp>/` with full copies of the agent's ClawCode state. Roll back = `clawcode migrate rollback --snapshot <id>`.
- **Keep OpenClaw state pristine.** The migrator only **reads** from OpenClaw; it never deletes or modifies source files. Rollback to OpenClaw is always "re-enable the binding" — zero data-side work. Verify this in code review.
- **Per-agent success gate.** An agent is "migrated" only when: memory parity tests pass + 24 hours of clean runtime in ClawCode + no user complaints. If any of those fail, roll back *that agent* without touching others.
- **Two-way lockstep in early migrations.** For the first 2-3 agents, keep OpenClaw and ClawCode both live on separate test channels. Compare behavior. Only start unbinding from OpenClaw once parity is proven across a few agents.

**Warning signs:**
- Migration CLI can produce new state but has no `rollback` subcommand
- Operator can't answer "if this agent needs to go back to OpenClaw in an hour, what do I do?"
- The migrator ever writes to `~/.openclaw/`

**Severity:** **CRITICAL** if it happens during cutover — blast radius is entire fleet. **LOW** if prevention is in place from phase 1.

**Phase to address:** Migration tooling phase — rollback is a feature, not an afterthought. Spec it before writing the forward migration.

---

### Pitfall 12: MEMORY.md on disk vs. OpenClaw's sqlite chunks diverge — which is the truth?

**What goes wrong:**
OpenClaw's indexer re-reads workspace markdown files periodically to rebuild chunks. If the indexer hasn't run recently (daemon was restarted, indexer failed, file was edited mid-flight), `chunks.text` contains an older version of `MEMORY.md` than what's on disk. You migrate from sqlite → ClawCode: agent "loses" edits made in the last N hours/days. Or you migrate from disk → ClawCode but miss chunks that only exist in sqlite (the user deleted a memory markdown file, OpenClaw sqlite still has it, disk doesn't).

Evidence: `general.sqlite` has 878 chunks from `memory/*.md` paths but those markdown files may or may not all exist still on disk.

**Why it happens:**
File-RAG systems have two caches: the filesystem and the vector index. They're eventually consistent, not strongly consistent. Any migrator must pick one as truth, and the wrong pick loses data.

**How to avoid:**
- **Disk is truth for markdown content.** Read `memory/*.md` fresh from disk; rebuild chunks and embeddings from the current disk content. Sqlite is treated as a hint for what files used to exist.
- **Sqlite is truth for "did this exist."** For every path in `sqlite chunks`, check if the file still exists on disk. If not → the user deleted it, respect that, don't resurrect. If yes → re-embed from current disk content.
- **Force-index before migration.** Either (a) run `openclaw index --rebuild <agent>` and then immediately migrate (narrow the drift window), or (b) just re-embed from disk and accept sqlite's value-add is "zero" for this task.
- **Log the drift.** After migration, log `files in sqlite but not on disk: [...]`, `files on disk not in sqlite: [...]`. Operator reviews. High counts = indexer problem, flag it.

**Warning signs:**
- Post-migration diff: number of memory entries differs significantly (>10%) from source sqlite chunk count
- Agent's "what did we talk about yesterday" query returns nothing — but MEMORY.md on disk has yesterday's entry
- `MEMORY.md` mtime is newer than the sqlite's `chunks.updated_at` for the same path

**Severity:** **MEDIUM / silent data loss or resurrection.** Both directions are bad; loss is worse.

**Phase to address:** Memory-translation phase — the spec must state "disk is source of truth; sqlite is consulted only to confirm deletions." Code review enforces.

---

### Pitfall 13: Fork-to-Opus budget explosion across 15 newly-migrated agents

**What goes wrong:**
v1.5 gave every ClawCode agent the ability to fork into an Opus subagent. Today, that's exercised by `test-agent` only — ambient budget is fine. Migrate 15 agents, every one inherits fork capability, every one has full conversational autonomy over when to escalate. A single viral thread in a Discord channel where the agent decides "this needs deeper thinking" across 15 agents in parallel can burn the Anthropic monthly budget in hours. Opus is ~5× the cost of Sonnet; 15 agents × uncoordinated fork decisions = no spending ceiling.

**Why it happens:**
Fork-escalation was designed when there was one agent. The budget advisor tool (`advisor-budget.ts` exists) and budget system (`usage/budget.ts`) operate per-agent. No **global** daily fleet budget enforced.

**How to avoid:**
- **Per-agent fork budget, enforced at call-time, not advisory.** Before fork, agent consults its remaining budget for the day. Exceed → fork is refused, agent continues on sonnet/haiku. Not a suggestion — a hard gate in `manager/fork.ts`.
- **Global fleet ceiling.** Aggregate per-agent budgets sum ≤ fleet ceiling. If 5 agents have already used 80% of their budget in the first 6 hours of the day, the 6th agent gets a reduced budget. `usage/budget.ts` can expose this.
- **Conservative defaults for migrated agents.** They arrive with stale personalities and ill-calibrated "I should escalate" instincts from pre-fork-era OpenClaw. Start each migrated agent at a low fork budget ($1/day), revise upward after 2 weeks of observed behavior.
- **Alerting, not silent blocking.** When an agent's fork is refused, it should still get a Discord notification to the operator channel so you know. Sudden silence on a capability is worse than an alert.
- **Kill-switch:** daemon-level toggle `clawcode.yaml: defaults.forkEnabled: false`. If budget explodes, flip and restart. Shouldn't need to — but should exist.

**Warning signs:**
- Anthropic billing dashboard shows sudden spike within 24h of multi-agent cutover
- `clawcode costs` shows >30% of daily spend in forked Opus sessions
- Any agent has fork count > 20/day

**Severity:** **HIGH / financial.** Non-recoverable dollars, unlike most other pitfalls. Real-world ceiling if you're running on prepaid credits.

**Phase to address:** Not strictly migration, but must be **landed before final cutover**. Probably deserves its own small pre-migration phase: "Fleet-scale fork budgeting."

---

### Pitfall 14: Identity inlined in YAML makes the soul/identity file-based editing workflow break

**What goes wrong:**
`clawcode.yaml` currently embeds `soul: |` and `identity: |` as block scalars (verified on test-agent). OpenClaw agents keep these as `SOUL.md` / `IDENTITY.md` files in their workspace. Users (including me) are used to **editing the markdown file** and the agent picks it up on next session. After migration, if we inline into YAML, (a) editing SOUL.md in the workspace no longer affects the agent (it was a workspace file, now it's a YAML string), (b) the YAML file becomes multi-thousand-line (15 agents × multi-paragraph souls), (c) a SOUL.md commit to the workspace git repo no longer triggers any reload because the daemon watches YAML, not workspace files.

**Why it happens:**
Two valid design patterns collided: "identity in config for discoverability" vs. "identity in workspace for editability and git-tracking." When you migrate from the latter to the former, you break the workflow the user has habituated to.

**How to avoid:**
- **Keep SOUL.md / IDENTITY.md as files. Reference from YAML.** `clawcode.yaml: agents.general.soulFile: "~/.clawcode/agents/general/SOUL.md"`. Daemon reads the file at session start + watches it with chokidar for hot-update. File semantics preserved; config stays small.
- **If inlining is required (schema change too costly):** the migrator writes SOUL.md from the YAML to the workspace on first run — at least the file exists for reading. But the daemon still needs to watch the YAML for authoritative changes. Document clearly: "edit via YAML, not MD."
- **This is a design choice to surface in the config-mapping phase.** Don't let it default to "inline everything" just because test-agent does.

**Warning signs:**
- clawcode.yaml grows to thousands of lines post-migration
- User edits workspace/SOUL.md, restarts agent, sees no change in behavior
- Post-migration, no one knows whether to edit the YAML or the MD

**Severity:** **LOW / UX regression + config bloat.** Cosmetic-adjacent but affects the daily editing workflow meaningfully.

**Phase to address:** Config-mapping phase — explicit decision: inline vs. file-reference, documented in that phase's plan.

---

### Pitfall 15: Migrator assumes all 15 agents have equivalent workspace structure

**What goes wrong:**
The 15 OpenClaw agents evolved organically. Some workspaces have `SOUL.md + IDENTITY.md + MEMORY.md + TOOLS.md + USER.md + AGENTS.md + archive/` (workspace-general). Others just have `SOUL.md + IDENTITY.md` (workspace-kimi, workspace-local-clawdy — no subagents key, no heartbeat). `workspace-fin-acquisition` contains only `uploads/` — the SOUL/IDENTITY/MEMORY are in the shared `workspace-finmentum` parent. `workspace-finmentum` has 20+ subdirectories of financial data (clients, financials, compliance).

A migrator that assumes `workspace/MEMORY.md` exists crashes on kimi. A migrator that assumes `SOUL.md` is in `workspace-<agentId>/` fails for finmentum agents whose SOUL is in the shared parent. A migrator that assumes "copy all markdown files" sucks in `workspace-finmentum/clients/*.md` which aren't agent memory.

**Why it happens:**
Organic growth over years. Conventions drifted. `openclaw.json` per-agent `agentDir` field exists (confirmed in the dump) precisely because workspace and agent-memory-root can be different — but the migrator has to respect that field, not assume 1:1.

**How to avoid:**
- **Use `openclaw.json` `agentDir` field as source of truth** for where SOUL/IDENTITY/MEMORY live per agent, not an assumption based on agent id.
- **Explicit file manifest per agent:** the migrator's first action is "list what this agent actually has" (SOUL yes/no, IDENTITY yes/no, MEMORY yes/no, archive yes/no), log it, then migrate accordingly. No assumptions.
- **Dry-run shows per-agent manifest.** Operator reviews: "general has MEMORY.md ✓, kimi has no MEMORY.md (ok — will create empty), fin-acquisition has no SOUL.md (finding via parent workspace)."
- **Don't copy non-memory markdown.** Workspace may contain project files (financials, compliance docs). These belong in the workspace, not in ClawCode memory. Distinguish: `memory/*.md` files → memory; `./*.md` top-level Five Sacred Files (SOUL/IDENTITY/MEMORY/USER/TOOLS) → memory; other markdown → workspace files (leave in workspace, don't embed).

**Warning signs:**
- Migrator crashes on a specific agent (FileNotFound)
- Migrated agent memory includes project-data markdown (financial reports as memories)
- `kimi` or `local-clawdy` migrate as "empty agent" because migrator couldn't find the files

**Severity:** **MEDIUM / migration fails or produces polluted memory.** Recoverable but forces re-runs.

**Phase to address:** Migration tooling phase — agent manifest discovery must be step 1, before any copy.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|---|---|---|---|
| "Just copy the whole workspace with `cp -r`, fix later" | Fastest path to an MVP migration | Broken symlinks, bloated node_modules, path absolute-path corruption | **Never.** Always use rsync with explicit excludes from day one. |
| "Inline all souls in YAML, it's simpler" | Single-file config diff review | 3k+ line YAML, breaks file-watching workflow, users confused where to edit | **Never for production** — reference SOUL.md files. Inline OK for `test-agent` as we have today. |
| "Keep copying gemini embeddings, we can re-embed later" | Migrator finishes in seconds, not hours | `vec_memories` is unusable; nothing works until re-embed completes | **Never.** Re-embed or don't migrate. |
| "Skip the idempotency / `origin_id` — we'll just not re-run it" | Simpler migrator code | Operator inevitably re-runs; duplicate memory rows are hard to dedupe post-hoc | **Never.** Idempotency is a 1-line schema addition + `INSERT OR IGNORE`. |
| "Use `fs.cp` for sqlite — it's just a file" | No need to learn backup API | Corrupted DB on a live daemon; lost last N minutes of memory | **Only when the source daemon is fully stopped.** Never on a live writer. |
| "Migrate all 15 agents in one shot over a weekend" | Shorter coexistence window | Any bug stops the whole fleet; rollback blast radius is everyone | **Never.** Staged per-agent with 24h soak between each. |
| "Skip the Discord coexistence check — the operator will remember" | One less CLI subcommand | First duplicate-reply incident in prod destroys user trust | **Never.** CLI must enforce. |
| "No rollback — forward-only, we'll fix bugs forward" | Simpler CLI, less code | 8 of 15 done + bug discovered = either ship broken or dual-maintain two tools | **Never for a 15-agent migration.** Rollback is cheap to build now. |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|---|---|---|
| Discord bot identity | Assuming channel ID is enough; forgetting bot-must-be-member | Pre-flight check: `discord.js client.channels.fetch(id)` succeeds + has `MANAGE_WEBHOOKS` |
| Discord webhooks | Creating a new webhook per agent, ignoring existing ones | ClawCode's `webhook-provisioner` already reuses bot-owned webhooks — use it, don't write a parallel |
| 1Password CLI (`op://` refs) | Assuming refs resolve at YAML parse time | ClawCode resolves at session spawn — make sure `op` CLI is available in the daemon's PATH (see project memory about EnvironmentFile PATH gotcha on systemd) |
| sqlite-vec extension | Forgetting to call `loadExtension()` before using `vec_memories` | Already handled in ClawCode's memory init — but verify in any migration script that opens `memories.db` directly |
| MCP servers with `op://` env vars | Migrating agent expects MCP server env that's not in `clawcode.yaml:mcpServers` | Migrator validates: every `mcpServers` ref in an agent config has a matching top-level `mcpServers.<name>` definition |
| Git repos in workspaces | `git clone` accidentally pointing at a moved workspace | Run `git fsck` + `git remote -v` post-migration; fix absolute remote URLs if any |
| Chokidar on a shared workspace | Registering 5 watchers on same path (finmentum) → 5× event amplification | Shared-workspace plan must include single-watcher/fan-out |
| Anthropic API | Per-agent rate limit assumed unlimited at fleet scale | Enforce global fleet ceiling before cutover (Pitfall 13) |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|---|---|---|---|
| Re-embedding everything serially during migration | 12+ hour migration window, user impatient, operator interrupts → corrupt state | Batch: embed N=32 chunks per call, parallelize across agents, progress bar with ETA | fin-acquisition has ~5000 chunks; serial 50ms embed = 4+ minutes just for that one agent |
| All 15 agents cold-starting simultaneously at daemon restart | Disk I/O saturates, embedding model loads 15× (if warm-path isn't shared) | Stagger agent start by 2-3s each; ensure the embedding singleton from v1.7 warm-path is actually shared not per-agent | 15 agents × 23MB model load × parallel = IO storm + RAM pressure |
| Single-writer finmentum workspace with 5 agents | MEMORY.md write contention, heartbeat storm | Per-agent subdirectory (Pitfall 4 option 1) | As soon as 2+ finmentum agents are active in same hour |
| FTS5 rebuild after bulk memory insert | First query after migration takes 30s+ | `INSERT INTO memories_fts` batched inside a single transaction; run `INSERT INTO memories_fts(memories_fts) VALUES('optimize')` at end | ~10k memories migrated total across fleet |
| Chokidar events from 15 agent workspaces (not finmentum) | Events/sec spike, debounces start rejecting | Fine at current scale (15 × ~10 files watched each = ~150) — monitor daemon event loop lag | >50 agents, or per-directory instead of per-file watching |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---|---|---|
| Copying Discord bot token plaintext from openclaw.json to clawcode.yaml | Token leaks in git history; rotated tokens re-exposed | Migrator refuses to write any raw secret; enforces `op://` references (Pitfall 6) |
| Leaving `openclaw.json.backup-*` files in a workspace that gets committed | Old plaintext secrets in git history | Add to `.gitignore`; audit git log pre-commit |
| Migrating agent credentials for rotated keys | Attacker with the old key can still use them after "rotation" felt complete | Rotate secrets on migration day as a standard step |
| Migrated agent MCP env vars point at HTTP endpoints with secrets in URLs (HA_URL, BROWSERLESS_URL) | Internal services that were behind tailscale (`100.x.y.z` addresses) — verify new daemon has tailscale access | Check migrated agent's `mcpServers.*.env` URL schemes resolve from the daemon's network namespace |
| Prompt injection via migrated session summaries | Pitfall 8 alternative: summarizing 413 JSONL files through Haiku means feeding attacker-controlled text into LLM | Run summaries with v1.9's SEC-02 instruction-pattern detection; sanitize before storing as MemoryEntry |
| Workspace markdown containing `op://` references that the migrator tries to "resolve" | Secret materialization in markdown files | Migrator does NOT resolve `op://` refs during copy — only the daemon does at runtime |
| Multi-tenant shared workspace (finmentum) — one agent reads another's sensitive data | `fin-tax` reads `fin-acquisition`'s compliance docs — actually desired here since they're the same org, but in theory a risk | Document the threat model explicitly: "finmentum family = single-trust-boundary" |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---|---|---|
| Cutover in the middle of the user's workday | User's agent goes silent for 10 minutes, reappears with stale context | Migrate during low-activity windows per agent (check last-24h message count in openclaw gateway logs) |
| Agent "forgets" recent conversations post-migration | User re-explains context, trust erodes | Pitfall 12 handling (disk-as-truth) + clearly communicate "migrated on YYYY-MM-DD — memories older than this are intact, anything since is fresh" |
| Same bot name/avatar but different behavior | User doesn't know they're talking to the new system | Keep the webhook display name identical pre/post migration (name=identity.name, avatar=whatever was set); announce migration in the channel |
| Double replies during coexistence | User annoyance, confusion about which is "real" | Pitfall 10 cutover protocol |
| Opus-fork silently disabled | Agent suddenly "dumber" for complex questions; user doesn't know why | Fork refusal posts a visible notice in the Discord channel, not just daemon logs |
| Shared workspace means `@fin-research` responds about tax topics it doesn't own | finmentum agents confused about their scope | Each finmentum agent needs a clear SOUL/IDENTITY scope even though they share files |
| Config-audit-trail notifications to a Discord channel during migration | Channel floods with 50 reload events | Suppress audit trail during explicit migration window (dedicated `--migration-mode` flag on migrate CLI) |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Memory migrated:** Often missing parity verification — verify 5 known-good semantic queries return same top-1 chunk per agent
- [ ] **Memory migrated:** Often missing `vec_length()==384` assertion — verify `SELECT vec_length(embedding) FROM vec_memories` everywhere
- [ ] **Workspace copied:** Often missing absolute-path rewrite — verify `grep -r '/home/jjagpal/.openclaw/' <new-workspace>` is empty
- [ ] **Workspace copied:** Often missing broken-symlink scan — verify `find <new-workspace> -xtype l | wc -l` is 0
- [ ] **Agent spawns:** Often missing Discord permission check — verify bot is member + has MANAGE_WEBHOOKS for every channel
- [ ] **Agent spawns:** Often missing first-heartbeat success — verify heartbeat runs within 2× intervalSeconds with no errors
- [ ] **Memory search works:** Often missing embedding model consistency check — verify `memories.db` queries actually return results on common terms the agent knew
- [ ] **Config loaded:** Often missing secret-shape audit — verify `grep -E 'sk-|M[A-Za-z0-9]{23}\\.' clawcode.yaml` is empty
- [ ] **Shared workspace agents:** Often missing per-agent namespace — verify each finmentum agent writes to its own subdir (MEMORY.md is per-agent, not shared)
- [ ] **Session summaries migrated:** Often missing — decide explicitly "archive-only" (Pitfall 8), don't leave ambiguous
- [ ] **Rollback tested:** Often missing — rollback one agent end-to-end before migrating all 15
- [ ] **Budget guard active:** Often missing — verify fork budget enforcement with an integration test that triggers fork over-budget and confirms refusal
- [ ] **OpenClaw unbinding:** Often missing — verify `openclaw.json:bindings` does not contain any channel ID also in `clawcode.yaml:agents[*].channels` post-cutover
- [ ] **Identity files surface:** Often missing — verify the user can still edit SOUL.md the way they used to (or explicit doc that it moved to YAML)
- [ ] **Agent has correct MCP servers:** Often missing — verify migrated agent's `mcpServers:` list covers everything it had in OpenClaw (finnhub, google-workspace, etc. as appropriate per agent)

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---|---|---|
| Wrong-dimension embeddings written to vec_memories | **MEDIUM** | `DELETE FROM vec_memories WHERE memory_id IN (SELECT id FROM memories WHERE origin_id LIKE 'openclaw:%')`, re-run migrator's embed step only |
| Duplicate memories from re-run | **LOW** if origin_id column exists: `DELETE FROM memories WHERE id NOT IN (SELECT MIN(id) FROM memories GROUP BY origin_id)`. **HIGH** without it: requires content-hash dedup pass |
| Corrupted sqlite from live-copy | **HIGH** (need to re-run migration for that agent after stopping source daemon) | Stop OpenClaw for that agent, rerun migrator using sqlite backup API, verify integrity |
| Secrets committed to clawcode.yaml | **HIGH** (rotate all exposed secrets; git history filter) | Rotate Anthropic/OpenAI/Brave/HA/etc. keys; `git filter-repo` or `bfg-repo-cleaner`; force-push; audit who pulled |
| Broken symlinks / node_modules in migrated workspace | **LOW** | `find -xtype l -delete`, re-run `npm install` where needed |
| Double replies from both OpenClaw and ClawCode bots | **LOW** | Remove binding from one side (probably OpenClaw), no state-side fix needed |
| 8-of-15 migrated, agent-9 bug | **MEDIUM** (thanks to snapshot-before-apply) | `clawcode migrate rollback --snapshot <id>` for agent 9; leave 1-8 as-is; fix bug; resume |
| Shared-workspace finmentum corruption | **HIGH** (5 agents' MEMORY.md interleaved is hard to untangle) | Restore MEMORY.md per-agent from the pre-migration snapshot of `workspace-finmentum`; add per-agent subdir; re-migrate |
| Fork budget blown mid-day | **NON-RECOVERABLE** (money spent) | Hard-kill fork capability fleet-wide; issue post-mortem; lower budgets; enforce ceiling in code going forward |
| Partial hot-reload leaves half-spawned agents | **LOW** | `clawcode fleet stop-all; fleet start-all` (full daemon restart) |
| Migration tool wrote to ~/.openclaw/ by mistake | **HIGH** | Restore from OpenClaw's `.openclaw/backups/` directory (present on-box); audit code review process failed |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---|---|---|
| 1. Embedding dimension mismatch | **Memory-translation phase** (dedicated, must land first) | 5 known-good queries per agent; `vec_length()==384` |
| 2. Re-run duplicates | **Memory-translation phase** | Re-run migrator, confirm `upserted=0` on second run |
| 3. Live-daemon copy corruption | **Migration tooling phase** (CLI) | Migrate with source daemon live, verify integrity; then stop daemon, re-verify |
| 4. Shared-workspace finmentum | **Shared-workspace support phase** (prerequisite — new feature, not migration) | 2 agents writing to shared workspace don't interleave; chokidar events fire once |
| 5. Discord bot identity divergence | **MCP + Discord wiring phase** | Pre-flight check in CLI; dry-run reports missing bot-in-channel |
| 6. Plaintext secrets leaked | **Config-mapping phase** | grep pre-commit hook; CI secret-scan on clawcode.yaml |
| 7. fs.cp on git repo workspaces | **Workspace-migration phase** | `git fsck` post-copy; broken-symlink scan == 0 |
| 8. JSONL replay | **Explicit decision in session-history phase** (archive-only) | Document the decision; confirm ConversationStore has no migration-origin rows |
| 9. Hot-reload mid-edit | **Migration tooling phase** | Migrator uses atomic rename; daemon log shows 1 reload event not 15 |
| 10. Coexistence double-replies | **Cutover phase** + migration CLI precheck | Per-agent 15-min observation post-cutover; openclaw.json bindings diff |
| 11. Partial failure, no rollback | **Migration tooling phase** (snapshot + rollback subcommands are phase-1 features) | Test rollback end-to-end before first real migration |
| 12. Disk vs sqlite drift | **Memory-translation phase** | Log drift, operator reviews; disk-as-truth encoded in spec |
| 13. Fork budget explosion | **Fleet-scale budget phase** (pre-migration prerequisite) | Integration test: agent triggers over-budget fork, gets refusal |
| 14. Identity inline vs. file | **Config-mapping phase** (design decision) | Documented choice; user can edit the way they expect |
| 15. Workspace structure variance | **Migration tooling phase** | Per-agent manifest printed in dry-run; operator reviews before apply |

## Suggested Phase Ordering (implied from above)

1. **Fleet-scale fork budgeting** (prerequisite, small; mitigates Pitfall 13)
2. **Shared-workspace support** (prerequisite, medium; mitigates Pitfall 4)
3. **Migration tooling / CLI skeleton** (dry-run + snapshot + rollback, no execution yet; mitigates 3/9/11/15)
4. **Config mapping + secret guard** (CLI writes YAML safely; mitigates 5/6/14)
5. **Workspace migration** (rsync + path rewrite + symlink audit; mitigates 7)
6. **Memory translation** (re-embed from disk, idempotent via origin_id; mitigates 1/2/12)
7. **Session history archive-only decision** (ratify, document; mitigates 8)
8. **Pilot migration** (personal or local-clawdy — smallest, lowest-risk)
9. **Finmentum family migration** (tests shared workspace under real load)
10. **Cutover + OpenClaw coexistence retirement** (mitigates 10)

## Sources

- OpenClaw sqlite schema: direct `.schema` + `SELECT meta` inspection on `~/.openclaw/memory/general.sqlite`, `fin-acquisition.sqlite`, `finmentum-content-creator.sqlite` (2026-04-20)
- ClawCode sqlite schema: direct `.schema` inspection on `~/.clawcode/agents/test-agent/memory/memories.db` (2026-04-20)
- ClawCode source code: `/home/jjagpal/.openclaw/workspace-coding/src/` — `config/watcher.ts`, `config/types.ts`, `config/loader.ts`, `memory/store.ts`, `manager/agent-provisioner.ts`, `discord/webhook-provisioner.ts`, `usage/budget.ts`, `manager/fork.ts`
- Live system state: `systemctl --user list-units`, `ps auxf`, `pgrep` (confirmed `openclaw-gateway.service` active, PID 755761)
- OpenClaw config: `/home/jjagpal/.openclaw/openclaw.json` (2882 lines; parsed for agent list, bindings, channels)
- Disk layout: `ls`, `find`, `du -sh` across `~/.openclaw/memory/`, `~/.openclaw/workspace-*/`, `~/.clawcode/agents/`
- Project memory: `~/.claude/projects/-home-jjagpal--openclaw-workspace-coding/memory/MEMORY.md` for EnvironmentFile PATH gotcha and fork-escalation Phase 39 context
- ClawCode PROJECT.md: `.planning/PROJECT.md` for v1.5/v1.7/v1.9 feature context (fork escalation, warm-path embedding singleton, ConversationStore schema)

---
*Pitfalls research for: OpenClaw → ClawCode multi-agent data migration (v2.1)*
*Researched: 2026-04-20*
*Confidence: HIGH — findings verified against live source code, running daemon, and on-disk state rather than documentation inference*
