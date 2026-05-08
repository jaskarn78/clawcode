# Phase 999.36 — Deferred workspace-keyed lookup audit

**Audit per:** PHASE.md sub-bug C blast radius step 3 — *"Audit other resolution paths that key off workspace. Memory writes, Discord posts, attachment uploads. Any 'which agent owns this?' question keyed off workspace is suspect when workspaces are shared."*

**Decision per CONTEXT D-02:** Other workspace-keyed resolution paths are **CATALOGUED but NOT FIXED** in Phase 999.36. The share-file routing fix (Plan 01) ships in isolation; sub-bug C blast radius is capped here. Promote any catalogued site below to a follow-up phase if operator confirms the bug class is reproducing in production.

**Methodology:** ripgrep across `src/manager/`, `src/discord/`, `src/memory/` for:
- `agentConfig.channels[0]` / `config.channels[0]` (the share-file fallback pattern that just got fixed)
- `configs.find((c) => c.name === ...)` (agent-config lookup by name; fragile when LLM-supplied)
- Workspace-path-derived agent identity (the actual sub-bug C class)

Audited 2026-05-08 with current master; line numbers may drift.

---

## Suspect sites (similar bug class — NOT fixed in 999.36)

### 1. `src/manager/daemon-ask-agent-ipc.ts:268-270` — ask-agent mirror channel resolution

```typescript
const channelId =
  deps.agentChannels?.get(to)?.[0] ??
  deps.configs.find((c) => c.name === to)?.channels?.[0];
```

- **Pattern:** Falls through to `targetConfig.channels[0]` when the routing-table doesn't have a binding.
- **Risk:** if `to` resolves to a shared-workspace family member (e.g. `finmentum-content-creator` when caller intended `fin-acquisition`), the mirror lands in the wrong channel.
- **Symptom that would surface:** agent A sends an `ask-agent` to a sibling in the same family; the mirror message lands in a different sibling's primary channel.
- **Mitigation that already exists:** `agentChannels` (routing table) lookup runs FIRST and is keyed by exact agent name (not workspace). Bug only surfaces if routing-table is unwired (test-only path per the comment block at line 108-110) AND the LLM passes the wrong `to` parameter.
- **Fix sketch:** consult thread bindings first if `to` is a sessionName; otherwise verify routing-table is always populated in production.
- **Decision:** NOT fixed in 999.36. Lower priority than share-file because the routing-table normally short-circuits the channels[0] fallback.

### 2. `src/manager/daemon.ts:6373` (legacy `send-message` IPC alias) — same fallback shape as ask-agent

```typescript
const targetConfig = configs.find((c) => c.name === to);
if (!targetConfig) {
  throw new ManagerError(`Target agent '${to}' not found in config`);
}
// ... downstream uses targetConfig.memoryPath for inbox writes (per Phase 75 SHARED-01)
```

- **Pattern:** target agent resolved via `configs.find((c) => c.name === to)` for inbox writes. The inbox path uses `targetConfig.memoryPath` (Phase 75 SHARED-01 — already de-conflicted), so memory routing is safe.
- **Risk:** if `to` is supplied by the LLM and the LLM picks the wrong sibling in a shared-workspace family, the inbox write lands in the wrong agent's memoryPath. This was the original sub-bug C surface — share-file just happened to be the first place it reproduced.
- **Mitigation that already exists:** Phase 75 SHARED-01 mandates per-agent `memoryPath` override (see `clawcode.yaml` for finmentum family). For shared-workspace agents that haven't migrated to per-agent memoryPath, the workspace fallback (`memoryPath ?? workspace`) at daemon.ts:3986/4109/4162/4282/4592 still hits the shared dir.
- **Symptom that would surface:** agent A sends a message to sibling B but the inbox write actually goes to sibling C's memory dir (or the shared dir for legacy configs).
- **Fix sketch:** audit which agents in the production config still rely on the workspace fallback (no per-agent memoryPath); migrate them per Phase 75 SHARED-01.
- **Decision:** NOT fixed in 999.36. Configuration-level mitigation is in place (per-agent memoryPath); this is a config-hygiene follow-up, not a code fix.

### 3. `src/manager/daemon.ts:3986`, `:4109`, `:4162`, `:4282`, `:4592` — `memoryPath ?? workspace` fallback chain

```typescript
const memoryRoot = cfg?.memoryPath ?? cfg?.workspace ?? "";
```

- **Pattern:** five sites in daemon.ts use the same fallback. When `cfg.memoryPath` is undefined (legacy config), the agent's writes land at `cfg.workspace` — which is the shared dir for finmentum-family.
- **Risk:** memory writes from agent A land in the shared workspace; downstream Wave 2 scanner ingests them under whichever agent's session is reading the shared dir. Cross-contamination of standing rules / SOULs / cue captures.
- **Symptom that would surface:** agent A says "remember this: don't tell users about X"; agent B (shared workspace) absorbs the rule on next session boot.
- **Mitigation:** confirm all production configs have explicit `memoryPath` per agent. Phase 75 SHARED-01 documents the migration; finmentum family already has per-agent memoryPath in clawcode.yaml (verified visually 2026-05-08).
- **Fix sketch:** remove the `?? cfg?.workspace` fallback entirely once all production agents have explicit memoryPath. Add a startup invariant check: if a config has `workspace` shared with another agent's `workspace` AND `memoryPath` is unset, fail-fast at boot.
- **Decision:** NOT fixed in 999.36. Defensive: would invalidate any config that hasn't migrated to per-agent memoryPath. Operator decides migration pace.

### 4. `src/memory/memory-cue.ts` (line 13 docstring) — `{workspace}/memory/...` write path

```
D-31: on cue match, write {workspace}/memory/YYYY-MM-DD-remember-<nanoid4>.md
```

- **Pattern:** memory-cue helper writes to `{workspace}/memory/`. The actual write is `join(workspaceArg, "memory", ...)` — caller passes the workspace.
- **Risk:** if the caller (TurnDispatcher post-turn hook) passes the agent's `workspace` (vs. `memoryPath`), shared-workspace siblings cross-pollute their captured cues.
- **Symptom that would surface:** "remember this" cues from agent A get re-loaded by agent B in the same family on next boot.
- **Mitigation:** caller-side already resolves `memoryPath` first per Phase 75 SHARED-01 patterns elsewhere — but this specific helper's docstring still references `{workspace}` as the contract. Easy to misread.
- **Fix sketch:** update the helper docstring to canonicalize `{memoryPath}/memory/...`. Audit all callers to confirm they pass `config.memoryPath`, not `config.workspace`.
- **Decision:** NOT fixed in 999.36. Low priority — docstring drift, not behavior bug (assuming callers do the right thing).

---

## Sites checked and CLEARED (no shared-workspace bug)

These were grep-suspects but the actual code path doesn't have the bug class:

- **`src/manager/daemon.ts:6737-6742` — `clawcode_share_file` allowedRoots construction** uses `agentConfig.workspace` + `agentConfig.memoryPath` + resolved `fileAccess`. This is a SECURITY GATE (path validation), not a routing decision — passing in a sibling agent's allowedRoots is harmless because the path validation gate refuses anything outside the agent's actual filesystem boundary. Cleared.

- **`src/manager/session-config.ts:699-703` — context-summary loader** uses `config.memoryPath` (Phase 75 SHARED-01 explicit comment). Cleared.

- **`src/manager/daemon.ts:2529-2531`, `:2769-2771`, `:6378-6380` — consolidation / inbox / send-message memoryPath usage** all explicitly use `memoryPath` not `workspace` (Phase 75 SHARED-01 mitigation already in place). Cleared.

- **`src/discord/webhook-manager.ts:59,108,183-195` — webhook routing** keys by exact agent name (`agentName`, `targetAgent`) with the agent's own webhookUrl. No workspace lookup. Cleared.

- **`src/discord/router.ts buildRoutingTable` (referenced from daemon.ts:129)** builds `agentToChannels` from each agent's explicit `channels` array. No workspace involvement. Cleared.

- **`src/manager/session-config.ts:336,364,422,791,1024` — SOUL/IDENTITY/MEMORY autoload paths** all use `config.workspace` directly because those files are workspace-scoped artifacts (intended to be shared across the family in finmentum's case — operator's design). Not a bug. Cleared.

---

## Sites NOT yet audited (deferred to operator follow-up)

- **`src/manager/turn-dispatcher.ts`** — origin propagation through dispatch surfaces. Plan 01 fix relies on the binding registry having the correct sessionName; the path of how origin → binding is wired wasn't audited end-to-end. If a future P0 surfaces showing origin drift even with this fix in place, audit `turn-dispatcher.ts:127` (the share-file artifact-sharing detection mentioned in CONTEXT canonical_refs).

- **Custom agent-team / cross-agent IPC paths** outside `daemon-ask-agent-ipc.ts` — Phase 999.12 work added new cross-agent IPC channels; they may have their own resolution paths that key off agent identity. Not audited here.

- **`src/manager/secrets-watcher-bridge.ts`** — secrets resolution per agent. Cursory grep showed no obvious workspace lookups but not exhaustively audited.

---

## Audit summary

- **4 suspect sites** documented above (1, 2, 3, 4 — all in daemon.ts / memory-cue.ts).
- **6+ cleared sites** documented above as already-safe (Phase 75 SHARED-01 mitigations + intentional workspace-scoped autoloads).
- **3 deferred areas** for operator follow-up if reproductions surface.

**Per D-02: NOTHING in this catalogue is fixed in Phase 999.36.** The share-file routing fix (`resolveShareFileChannel` + thread-binding lookup) is the only code change for the workspace-keyed bug class in this phase. Operator promotes follow-ups based on production observation cycles.

---

*Generated 2026-05-08 during Phase 999.36 Plan 01 execution. Source: ripgrep audit of `src/manager/`, `src/discord/`, `src/memory/` directories on master at commit `3300f47` (Task 4 of Plan 01).*
