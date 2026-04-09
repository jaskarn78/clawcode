# Phase 4: Memory System - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-09
**Phase:** 04-memory-system
**Areas discussed:** SQLite schema, Embedding strategy, Session logs, Compaction trigger, Memory metadata
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## SQLite Schema

| Option | Description | Selected |
|--------|-------------|----------|
| Single memories table + session_logs | Per-agent DB, memories with embeddings, session log tracking | x |
| Separate tables per memory type | Different tables for facts, conversations, etc. | |
| Key-value store | Simple key-value with JSON values | |

**User's choice:** [auto] Single memories table + session_logs (recommended)

---

## Embedding Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Local HuggingFace (all-MiniLM-L6-v2) | Zero cost, offline, 384-dim, sqlite-vec | x |
| Claude API embeddings | Higher quality but costs money | |
| No embeddings (FTS5 only) | Full-text search, simpler but less capable | |

**User's choice:** [auto] Local HuggingFace (recommended per stack research)

---

## Session Logs

| Option | Description | Selected |
|--------|-------------|----------|
| Daily markdown files | YYYY-MM-DD.md in workspace memory/, matches OpenClaw | x |
| Single rolling log file | Simpler but harder to navigate | |
| SQLite-only (no markdown) | Everything in DB, less human-readable | |

**User's choice:** [auto] Daily markdown files (recommended)

---

## Compaction Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| 75% context fill threshold | Monitor via SDK, flush + summarize + restart session | x |
| Fixed turn count | Compact every N turns | |
| Manual only | User triggers compaction | |

**User's choice:** [auto] 75% context fill threshold (recommended per OpenClaw pattern)

---

## Memory Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| Rich metadata (source, importance, access_count, tags) | Full tracking for future decay/dedup features | x |
| Minimal (timestamp only) | Simpler but limits future features | |
| OpenClaw-compatible format | Match existing memory DB schema | |

**User's choice:** [auto] Rich metadata (recommended)

## Claude's Discretion

- UUID library, sqlite-vec loading, log formatting, compaction prompt, search top-K

## Deferred Ideas

None
