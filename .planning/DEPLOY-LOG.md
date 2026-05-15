# Production Deploy Log

Operator-driven deploy chronicle. Most recent at top. Each entry pins:

- Deploy timestamp (UTC + local)
- Daemon pid + commit on master at deploy time
- Phases newly deployed
- Pending SC verifications (the soak window after the deploy)
- Any side-channel host/config changes

GSD-managed STATE.md tracks *plan* state; this file tracks *production* state. The two diverge whenever code is shipped local but not yet deployed.

---

## 2026-05-15 18:01 UTC (11:01 PDT) — pid=2684181 — commit `93e8676` (master tip), `405753d` (deployed bytes)

Closes a ~50-commit / 7-phase gap built up since 2026-05-14.

### Newly LIVE

**v2.9 (milestone closure)**

| Phase | Surface |
|-------|---------|
| 121 | Subagent chunk-boundary seam fix |
| 122 | Universal Discord table auto-wrap (WebhookManager + BotDirectSender chokepoint) |
| 124 | Operator-triggered session compaction — CLI `clawcode session compact` + `/clawcode-session-compact` slash + auto-trigger + telemetry |
| 125 | Intelligent tiered auto-compaction (Tier 1 verbatim / Tier 2 Haiku / Tier 3 prose / Tier 4 drop) |
| 999.54 | `mcpServers[].alwaysLoad` SDK passthrough |
| 999.55 | `scripts/deploy-clawdy.sh` per-agent prompt-corpus rsync (confirmed: 6 agents staged this deploy) |

**v3.0 Wave 1+2**

| Phase | Surface |
|-------|---------|
| 126 | Subagent context isolation + DEL-20..24 regression tests |
| 127 | Per-agent stream stall timeout watchdog (`streamStallTimeoutMs`: Opus 300000 / Sonnet 180000 / Haiku 90000) + Discord notification + JSONL row |
| 130 | Manifest-driven plugin SDK + 6 migrated fleet skills + `clawcode skills <agent>` CLI + boot-time Discord refused-skill notification |

### Boot signature

- Service: active, SubState=running, ActiveEnterTimestamp=Fri 2026-05-15 11:01:28 PDT
- 8 agents auto-started from pre-deploy snapshot: Admin Clawdy, fin-acquisition, research, fin-research, fin-playground, finmentum-content-creator, general, projects
- 2 skipped (autoStart=false): `personal` (operator promoted to autoStart=true mid-deploy), `fin-tax`
- Admin Clawdy warm-path ready in 1.96 s (mcp dominated at 1.89 s — normal)
- fin-acquisition warm-path ready by 11:01:47 PDT
- No FATAL, no stack traces

### Pending SC verifications (24-48 h soak window)

| Phase | Criterion |
|-------|-----------|
| 121 SC-3 | `seamGapBytes:0` over 24 h |
| 122 SC-2 | 4-channel screenshots — webhook / bot-direct / cron / subagent-relay |
| 125 SC-5 + SC-6 | A/B agreement vs baseline + first-token < 8 s |
| 127 D-07 + D-09 | Opus advisor false-positive watch + 24 h threshold tuning |
| 127 | Synthetic stall probe |
| 130 | First boot in 4 channels surfaces refused-skill notification (if any) |
| 119 residual | SC-3 next live A2A turn + SC-4 24 h projects-channel soak |

### Side-channel changes

- `~/.ssh/config` — added `Host clawdy` block with `IdentitiesOnly=yes + IdentityFile ~/.ssh/id_ed25519`. Without it, deploy-script SSH fans through 6 agent keys and hits server `MaxAuthTries`. **Durable** — future deploys clean.
- `/etc/clawcode/clawcode.yaml:168` — `personal.autoStart: false → true` (sed in place, backup `clawcode.yaml.bak-personal-autostart`). Personal agent started manually post-deploy.
- `clawcode.example.yaml:270-272` — repo template flipped to match production. Commit `93e8676`.

### Rollback path

`scripts/deploy-clawdy.sh --no-build` against commit before `405753d` (which was `b8bf08e..91535c7` range on master from 2026-05-14 deploy era — daemon md5 was `<unrecorded>`). If a regression surfaces in the soak window, prefer `git revert` of the offending commit + redeploy over wholesale rollback.

---
