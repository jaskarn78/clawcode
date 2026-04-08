# Phase 1: Foundation & Workspaces - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-08
**Phase:** 01-foundation-workspaces
**Areas discussed:** Config schema, Workspace layout, Default identity, Setup CLI interface
**Mode:** Auto (all areas auto-selected, recommended defaults chosen)

---

## Config Schema

| Option | Description | Selected |
|--------|-------------|----------|
| Single YAML with agents array | Declarative config, each agent has name/workspace/channels/model/skills/soul/identity | x |
| Multiple YAML files per agent | One config file per agent, discovered by convention | |
| JSON config | Machine-readable but less human-friendly | |

**User's choice:** [auto] Single YAML with agents array (recommended default)
**Notes:** Mirrors OpenClaw's declarative pattern. Top-level defaults with per-agent overrides.

---

## Workspace Layout

| Option | Description | Selected |
|--------|-------------|----------|
| SOUL.md + IDENTITY.md + memory/ + skills/ | Proven OpenClaw pattern, future-proof for Phase 4 and v1.x | x |
| Minimal (SOUL.md + IDENTITY.md only) | Add directories in later phases | |
| Flat structure (all files in root) | Simpler but less organized | |

**User's choice:** [auto] Full workspace layout (recommended default)
**Notes:** Creating memory/ and skills/ directories upfront avoids migration in later phases.

---

## Default Identity

| Option | Description | Selected |
|--------|-------------|----------|
| Sensible defaults with config override | Ship defaults, allow inline or path reference in YAML | x |
| No defaults (user must provide) | Forces explicit identity for every agent | |
| Template system with named presets | Multiple personality templates to choose from | |

**User's choice:** [auto] Sensible defaults with config override (recommended default)
**Notes:** Low friction for new agents. Default SOUL.md provides general-purpose behavioral philosophy.

---

## Setup CLI Interface

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript CLI (`clawcode init`) | Standard pattern, validates config, creates workspaces | x |
| Shell script | Simpler but less maintainable | |
| Node.js script without CLI framework | Lightweight but no arg parsing | |

**User's choice:** [auto] TypeScript CLI (recommended default)
**Notes:** Idempotent — re-running updates without destroying existing workspaces.

---

## Claude's Discretion

- Config validation library (zod, ajv, etc.)
- YAML parsing library
- CLI framework (commander, yargs, etc.)
- Default SOUL.md and IDENTITY.md content

## Deferred Ideas

None
