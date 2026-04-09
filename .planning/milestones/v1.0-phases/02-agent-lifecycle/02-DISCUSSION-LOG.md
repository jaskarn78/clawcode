# Phase 2: Agent Lifecycle - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 02-agent-lifecycle
**Areas discussed:** Process spawning, Manager architecture, PID registry, Crash recovery
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## Process Spawning

| Option | Description | Selected |
|--------|-------------|----------|
| Agent SDK sessions | Each agent is a createSession/resumeSession call, managed in-process | x |
| child_process.spawn | Spawn separate claude CLI processes, manage as OS processes | |
| Hybrid | SDK for simple agents, child_process for complex workloads | |

**User's choice:** [auto] Agent SDK sessions (recommended default)
**Notes:** Research recommended SDK over raw CLI. Sessions are first-class objects with resume capability.

---

## Manager Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Long-running daemon | Manager holds all sessions in-process, CLI communicates via IPC | x |
| CLI-only | Each command spawns/attaches to processes independently | |
| Systemd-managed | One service per agent, systemd handles lifecycle | |

**User's choice:** [auto] Long-running daemon (recommended default)
**Notes:** Deterministic TypeScript process, not AI. Architecture research was explicit about this.

---

## PID/Session Registry

| Option | Description | Selected |
|--------|-------------|----------|
| JSON file on disk | Human-readable, survives restarts, simple | x |
| SQLite database | More structured but heavier | |
| In-memory only | Simplest but lost on restart | |

**User's choice:** [auto] JSON file on disk (recommended default)
**Notes:** Matches OpenClaw's runs.json pattern. Easy to inspect and debug.

---

## Crash Recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Exponential backoff (1s to 5min, max 10 retries) | Standard pattern, configurable, resets after 5min success | x |
| Fixed interval retry | Simple but not adaptive | |
| No auto-restart | User must manually restart crashed agents | |

**User's choice:** [auto] Exponential backoff (recommended default)
**Notes:** Standard reliability pattern. After max retries, agent enters "failed" state.

---

## Claude's Discretion

- IPC mechanism (Unix socket, TCP, HTTP)
- Agent SDK session configuration
- Log output format
- Status display formatting

## Deferred Ideas

None
