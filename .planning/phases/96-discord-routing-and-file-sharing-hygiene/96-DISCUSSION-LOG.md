# Phase 96: Discord routing and file-sharing hygiene - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-25
**Phase:** 96-discord-routing-and-file-sharing-hygiene
**Areas discussed:** Stale capability beliefs (A), Cross-workspace file access (B), File-sharing UX hygiene (C), Migration & acceptance

---

## Scope confirmation

**Inputs informing scope:**
- Operator note: agent in `#finmentum-client-acquisition` denied filesystem access to `/home/jjagpal/.openclaw/workspace-finmentum/` despite operator having (a) added `clawcode` user to `jjagpal` group, (b) set `clawcode:rwX` ACLs on the workspace, (c) relaxed `clawcode` systemd unit (`ProtectHome=tmpfs` removed).
- Discord screenshot evidence (2026-04-25 09:30): Clawdy bot replied *"That path is not accessible from my side... To share those files, the OpenClaw agent needs to do it"* — false belief, recommending sunset path.
- Untracked workspace files (`Screenshot 2026-04-11 at 1.09.49 PM.png`, `amazon-reuzel-beard-foam.png`, `reuzel-beard-foam-product.png`) — provided context for file-sharing hygiene gaps.

### Q0a: Phase 96 scope (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| A. Stale capability beliefs | Re-probe environment capabilities on boot + heartbeat | ✓ |
| B. Cross-workspace file access | Relax clawcode_share_file's workspace boundary; ACL-aware | ✓ |
| C. File-sharing UX hygiene | Files outside agent workspace get uploaded properly | ✓ |
| D. Discord routing | Some Discord routing aspect (clarify in chat) | ✓ |

**User's choice:** A + B + C + D selected.

### Q0b: Discord routing slice (single-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Cross-workspace agent→agent | Agent-to-agent across workspaces | |
| Channel→agent dispatch | Wrong agent picks up; thread/webhook edge | |
| Skill route to different agent | Phase 94 D-07 → real routing | |
| None / not in scope | Title is misleading; actual scope is A+B+C | ✓ |

**User's choice:** None / not in scope. Discord routing in title is broad framing; real scope is filesystem.

**Notes:** Title kept for historical traceability; deferred ideas section captures the routing slices for future phases.

---

## Area A — Stale Capability Beliefs

### A.1: Probe schedule

| Option | Description | Selected |
|--------|-------------|----------|
| Boot + heartbeat + on-demand | Three layers; no stale belief survives 60s | ✓ |
| Boot + on-demand only | Skip heartbeat re-probe | |
| Boot only | Probe once at session start | |
| On-demand only | Lazy; agent learns by trying | |

**User's choice:** Boot + heartbeat + on-demand (Recommended).
**Notes:** Mirrors Phase 85 MCP probe timing.

### A.2: System prompt expression

| Option | Description | Selected |
|--------|-------------|----------|
| Path classification block | My workspace / Operator-shared / Off-limits | ✓ |
| Dynamic accessible-path list | Flat 'as of HH:MM, I can read X' | |
| Static yaml-declared list | Just dump fileAccess into prompt | |
| Nothing — probe on the fly | Cheapest but agent guesses | |

**User's choice:** Path classification block (Recommended).
**Notes:** Matches Phase 94 mutable-suffix tool table format; LLM reasons naturally about RW vs RO.

### A.3: Refresh trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Both: slash command + config-watcher | /clawcode-probe-fs + Phase 22 hot-reload | ✓ |
| Slash command only | Manual operator refresh | |
| Config-watcher only | Auto on yaml edit | |
| Neither — heartbeat only | Up to 60s lag | |

**User's choice:** Both (Recommended).

### A.4: Communication on changes

| Option | Description | Selected |
|--------|-------------|----------|
| Silent system-prompt update | Next turn re-renders; no Discord noise | ✓ |
| Embed alert on changes | Post to admin-clawdy on add/remove | |
| Status-only | /clawcode-status surfaces; no agent post | |
| Mixed: silent adds, alert removes | Adds quiet, removes notify | |

**User's choice:** Silent system-prompt update (Recommended).

---

## Area B — Cross-Workspace File Access

### B.1: Declaration model

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: declared candidates + probe verifies | yaml fileAccess + POSIX probe | ✓ |
| clawcode.yaml field only | No probe verification | |
| Auto-detect from POSIX | Walk /home/* + /opt/* | |
| Defaults block + per-agent override | (still hybrid probe) | |

**User's choice:** Hybrid (Recommended).

### B.2: Boundary check

| Option | Description | Selected |
|--------|-------------|----------|
| Cached probe + on-miss real check | Fast path + fallback to fs.access | ✓ |
| Path prefix match only | startsWith() — Phase 94 D-09 today | |
| POSIX read attempt every time | No cache | |
| Cached only — no fallback | Strict | |

**User's choice:** Cached probe + on-miss real check (Recommended).

### B.3: System-prompt visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level summary + on-demand listing tool | Compact + clawcode_list_files | ✓ |
| Full path listing | Token-heavy at scale | |
| Path roots only, no listing tool | Agent uses Bash/Read | |
| Workspace names + sampled examples | Operator-curated examples | |

**User's choice:** Top-level summary + on-demand listing tool (Recommended).

### B.4: Out-of-allowlist refusal

| Option | Description | Selected |
|--------|-------------|----------|
| ToolCallError (permission) + alternative suggestion | Phase 94 D-06 verbatim | ✓ |
| Warn + allow (audit-only) | Soft fail | |
| Auto-probe + add to allowlist | Permissive — soft hint | |
| Refuse, no suggestion | Hard refuse, worst UX | |

**User's choice:** ToolCallError + alternative (Recommended).

---

## Area C — File-Sharing UX Hygiene

### C.1: Output location

| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent dated outputs dir | outputs/YYYY-MM-DD/ | ✓ (with caveat) |
| Per-channel session dir | sessions/<session-id>/outputs/ | |
| Per-agent flat tmp | No time bucketing | |
| Configurable via clawcode.yaml | Field per agent | |

**User's choice:** Per-agent dated outputs — with caveat: "the client acquisition channel organizes by clients for docs generated for clients"

**Follow-up Q (C.1b): output strategy**

| Option | Description | Selected |
|--------|-------------|----------|
| agents.*.outputDir template string | {date}, {client_slug}, {channel_name}, {agent} tokens | ✓ |
| Per-agent enum strategy | 'dated' \| 'per-client' \| 'per-channel' | |
| Default dated + custom tool for clients | Two paths | |
| Hardcoded per channel-name pattern | Brittle | |

**User's choice:** Template string (Recommended).

### C.2: Path-reference reading behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Read directly, never auto-upload (Recommended) | Wait for explicit "share" | |
| Read + auto-upload when relevant | Faster UX, more uploads | ✓ |
| Ask permission first | Safest, most annoying | |
| Refuse path-references | Forces Discord upload | |

**User's choice:** Read + auto-upload when relevant. (User overrode my recommendation.)
**Notes:** Decision drove follow-up C.2b on heuristic for "relevant".

**Follow-up Q (C.2b): auto-upload trigger**

| Option | Description | Selected |
|--------|-------------|----------|
| Response references file as artifact | "here's the PDF" / "I generated X" | ✓ |
| Always upload when file was read | Simpler but over-uploads | |
| User-action keywords trigger upload | "share", "send", "attach" | |
| Agent decides, no rule | Pure LLM discretion | |

**User's choice:** Response references file as artifact (Recommended).

### C.3: Sync architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Read-from-source via ACL, deprecate Phase 91 mirror | Single source of truth | ✓ |
| Fix Phase 91 sync to full-mirror | Two filesystems lockstep | |
| Both: ACL read for live + sync for offline cache | Most resilient | |
| Sync stays, opposite direction (Claw→Open) | Authoritative flip | |

**User's choice:** Read-from-source via ACL, deprecate Phase 91 mirror (Recommended).

**Follow-up Q (C.3b): Phase 91 deprecation aggressiveness**

| Option | Description | Selected |
|--------|-------------|----------|
| Disable sync timer + mark deprecated, keep code | 7-day rollback honored | ✓ |
| Keep sync running for safety net | Two systems | |
| Hard remove Phase 91 sync | Burn it down | |
| Preserve sync for non-finmentum agents | Limited operational | |

**User's choice:** Disable sync timer + mark deprecated, keep code (Recommended).

### C.4: clawcode_share_file failure messaging

| Option | Description | Selected |
|--------|-------------|----------|
| ToolCallError with classification + suggested alt | Phase 94 D-06 pattern | ✓ |
| Plain error string | LLM parses NL errors | |
| Silent retry then surface | Hides intermittent | |
| Detailed embed to admin-clawdy | Noisy at scale | |

**User's choice:** ToolCallError with classification (Recommended).

---

## Migration & Acceptance

### M.1: In-flight session migration

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-refresh on next heartbeat tick | ≤60s; one cache miss | ✓ |
| Operator-triggered /clawcode-probe-fs | Manual rollout | |
| Full restart of fin-acquisition | Loses context | |
| Restart fleet-wide on deploy | Aggressive | |

**User's choice:** Auto-refresh on next heartbeat tick (Recommended).

### M.2: Acceptance smoke test

| Option | Description | Selected |
|--------|-------------|----------|
| Tara-PDF end-to-end | In #finmentum-client-acquisition: ask, agent reads, shares CDN URL | ✓ |
| Synthetic probe-only test | Fast/deterministic but doesn't exercise read+share | |
| Generated-doc bidirectional test | Output direction + per-client routing | |
| All three (Tara-PDF + probe + gen-doc) | Maximum coverage | |

**User's choice:** Tara-PDF end-to-end (Recommended).

---

## Claude's Discretion

The following implementation choices were left to Claude's judgement (codified as "Claude's Discretion" subsection in CONTEXT.md):

- Probe primitive shape (`runFsProbe(agent, deps)` pure-DI per Phase 94/95 idiom)
- Snapshot persistence shape (`fs-capability.json` atomic temp+rename)
- System-prompt block placement (between Phase 94 `<tool_status>` and Phase 95 `<dream_log_recent>`)
- Phase 91 deprecation mechanics (sync-state.json `authoritative: "deprecated"` + new CLI subcommands)
- Output-dir token resolution (`resolveOutputDir` pure fn; `{client_slug}` filled via system-prompt directive)
- Static-grep regression pin (`checkFsCapability` single-source-of-truth)
- Phase 92 verifier integration (read fs-capability snapshot instead of own ACL probe)
- clawcode_list_files token guard (depth max 3, entries max 500)
- Auto-upload soft-warning destination (admin-clawdy via Phase 94 alert primitive, Phase 91 dedup)

## Deferred Ideas (captured in CONTEXT.md)

- All Discord routing slices (cross-workspace agent-to-agent, channel dispatch, skill handoff)
- LLM-side file-path hallucination prevention beyond post-turn soft warning
- Per-file granular probe
- Probe-result caching across daemon cold starts
- Auto-update PR generation on repeated fileAccess pattern firings
- Phase 91 conversation-turn translator deprecation
- Bidirectional sync (Claw→Open file mirror)
- OpenClaw deprecation cliff date
- Fleet-wide restart on deploy
- clawcode_list_files glob via picomatch
- Probe-only and gen-doc bidirectional smoke tests (Tara-PDF E2E only is canonical)
