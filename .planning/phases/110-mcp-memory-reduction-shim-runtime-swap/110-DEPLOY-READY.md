# Phase 110 Stage 0b — Deploy-Ready Block (PM session, 2026-05-06)

**Status:** Artifacts staged on clawdy:/tmp/. Awaiting operator go-ahead to install + restart.

**Built from:** `master` HEAD `98a4354` ("fix(110): broken sudo pipe in Path 1 retry command + buildSearchEnv unit tests").

---

## Pre-flight verification (already done)

| Check | Result |
|---|---|
| Local build clean | ✅ `npm run build` + `go build -ldflags="-s -w"` succeeded |
| Artifacts staged on clawdy | ✅ scp'd to `/tmp/clawcode-mcp-shim` + `/tmp/clawcode-dist.tar.gz` |
| SHA match (local ↔ clawdy) | ✅ `8656243a...` (binary) + `640c2c5c...` (tarball) — identical |
| Staged binary has image+browser active | ✅ all 3 types route through Register (probed via stdio fail-closed CLAWCODE_AGENT error, not the "not yet implemented" stub message) |
| Currently-deployed binary still has stubs | ✅ `/opt/clawcode/bin/clawcode-mcp-shim --type image` still says "not yet implemented" |
| Existing prod backups | ✅ `dist.bak-pre-110-final-20260506-125229` (this morning's), yaml `bak-pre-110-revert-20260506-130314` |
| Daemon uptime | 2h+ on PID `1945993` |

## What this deploy ships (vs current prod)

| Aspect | Currently on prod | After this deploy |
|---|---|---|
| Search Go shim | active in binary | active (no-op change) |
| Image Go shim | **stub (USAGE 64)** | **active** (Plan 110-06 Task 1) |
| Browser Go shim | **stub (USAGE 64)** | **active** (Plan 110-07 Task 1) |
| `defaults.search.brave.apiKey` op:// support | not present | **present** (Path 2) |
| `buildSearchEnv` synthetic env | not present | **present** |
| Per-agent `shimRuntime` schema | active | active (no-op change) |

**Behavioral effect on agents at the moment of restart:** none. Fleet stays on Node baseline because no `shimRuntime: <type>: static` overrides exist in clawcode.yaml. The deploy ships *capability*, not flips. Phase 110 RSS savings remain 0 GiB until the operator flips a canary.

---

## ⚠️ Pre-deploy operator checks

### 1. Ramy-quiet check (Discord MCP, NOT journalctl)

Per memory rule `feedback_ramy_active_no_deploy.md` — Ramy in #fin-acquisition; restarts disrupt his live client thread.

Use Discord MCP `fetch_messages` with `chat_id` of #fin-acquisition. Look for non-bot messages (Ramy or any external user, not jjagpal) in the last 10-15 min. **Hold if Ramy is mid-conversation.**

> Note from this PM session probe (15:09 PT): journalctl shows jjagpal himself was active in fin-acquisition channel ~5 minutes ago; agent responded multiple times. That's the OPERATOR working with their own bot, not Ramy. Operator's call whether their own in-flight thread is OK to interrupt — Phase 999.6 snapshot/restore preserves the agent's session, so a clean restart should resume the conversation.

### 2. Decide BRAVE_API_KEY: now or later?

The deploy itself does NOT fix BRAVE. Today's prod search returns "missing API key" regardless of which binary is running. Two clean-up options after deploy (or interleaved with):

- **(a) Apply Path 1 same-restart** — append `BRAVE_API_KEY=$(op read 'op://clawdbot/Brave Search API Key/credential')` to `/etc/clawcode/env` before the systemd restart. One restart fixes binary + Brave together.
- **(b) Apply Path 2 post-deploy** — after this deploy ships, edit `clawcode.yaml` to add `defaults.search.brave.apiKey: op://...`. ConfigWatcher hot-reloads on the next handler invocation; daemon then op-resolves at boot... actually wait, op:// resolution is at *daemon boot*, so Path 2 needs a *second* restart. **Path 1 is faster if doing both today.**
- **(c) Defer Brave** — ship the binary now, leave Brave for a separate window. Phase 110 cgroup-pressure-relief doesn't depend on web_search working.

---

## Deploy command block (paste-ready)

### Stage 1 — install fresh artifacts (no restart yet)

```bash
ssh clawdy

# Backup the current Go binary so rollback is one cp away
cp /opt/clawcode/bin/clawcode-mcp-shim \
   /opt/clawcode/bin/clawcode-mcp-shim.bak-pre-110-final-pm-$(date +%Y%m%d-%H%M%S)

# Snapshot the current dist (parallel to morning's dist.bak-pre-110-final-20260506-125229)
mv /opt/clawcode/dist /opt/clawcode/dist.bak-pre-110-final-pm-$(date +%Y%m%d-%H%M%S)

# Install new artifacts
mkdir /opt/clawcode/dist
tar -xzf /tmp/clawcode-dist.tar.gz -C /opt/clawcode/dist/
install -m 0755 /tmp/clawcode-mcp-shim /opt/clawcode/bin/clawcode-mcp-shim

# Verify the install — should show staged shas matching the staged tarball
ls -la /opt/clawcode/dist/cli/index.js /opt/clawcode/bin/clawcode-mcp-shim
sha256sum /opt/clawcode/bin/clawcode-mcp-shim   # expect: 8656243a0a3185784f834c31b869bfdd1e1c072f64888bd524dd032d00ac9958
```

### Stage 2 — OPTIONAL: BRAVE Path 1 (skip if deferring)

```bash
# Still on clawdy
KEY=$(op read 'op://clawdbot/Brave Search API Key/credential')
echo "686Shanghai" | sudo -S -p "" bash -c "echo BRAVE_API_KEY=\"$KEY\" >> /etc/clawcode/env"
unset KEY
# Verify it landed (var name only, no value):
echo "686Shanghai" | sudo -S -p "" awk -F= '/^[A-Z_]+=/{print $1}' /etc/clawcode/env | grep BRAVE
```

### Stage 3 — restart daemon (Phase 999.6 snapshot/restore preserves agents)

```bash
# Final Ramy-quiet sanity check via Discord MCP — abort here if RED
# (operator does this manually; no shell command)

echo "686Shanghai" | sudo -S -p "" /bin/systemctl restart clawcode.service

# Watch warm-path-ready for all auto-start agents (~2 min, personal can take 4-7 min)
echo "686Shanghai" | sudo -S -p "" journalctl -u clawcode -f -n 0 | \
  grep --line-buffered -E "warm-path ready|exit code 75|TEMPFAIL|panic|secrets:"
# Ctrl-C when all auto-start agents have warmed.
```

### Stage 4 — post-deploy verification

```bash
# 1. Daemon PID changed (proves restart happened)
pgrep -f "dist/cli/index.js.*start-all"

# 2. Binary still has image+browser active after install
/opt/clawcode/bin/clawcode-mcp-shim --type image 2>&1 | head -1
# expect: "image.Register failed" "CLAWCODE_AGENT env var is required"  (NOT "not yet implemented")

# 3. Fleet status (all on Node baseline — no canary flipped yet)
pgrep -af "clawcode-mcp-shim --type" | grep -v "^.*bash"
# expect: zero (or just the orphan PID 1966758 if it survived snapshot/restore)

# 4. Search regression: ask Admin Clawdy to web_search via Discord
# "Use web_search to find today's date. Reply YYYY-MM-DD only."
#  - if you DID Stage 2: GREEN reply (BRAVE working)
#  - if you SKIPPED Stage 2: still "missing API key" (expected; same as before deploy)

# 5. fleet-stats endpoint sanity check
curl -s "http://localhost:3100/api/fleet-stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(f\"mcpFleet entries: {len(d.get('mcpFleet',[]))}, runtime breakdown:\");
from collections import Counter;
c=Counter(s.get('runtime','?') for s in d.get('mcpFleet',[]));
[print(f'  {k}: {v}') for k,v in c.items()]"
# expect: all "node" (no "static" until canary flip)
```

---

## Rollback (if anything goes red mid-deploy)

```bash
ssh clawdy

# Find the most-recent pre-PM backup
ls -td /opt/clawcode/dist.bak-pre-110-final-pm-* | head -1   # confirm path

# Roll back dist
mv /opt/clawcode/dist /opt/clawcode/dist.failed-pm-$(date +%Y%m%d-%H%M%S)
mv /opt/clawcode/dist.bak-pre-110-final-pm-<timestamp> /opt/clawcode/dist

# Roll back binary
cp /opt/clawcode/bin/clawcode-mcp-shim.bak-pre-110-final-pm-<timestamp> \
   /opt/clawcode/bin/clawcode-mcp-shim

# (Optional) Roll back the BRAVE_API_KEY add-line if Stage 2 ran
echo "686Shanghai" | sudo -S -p "" sed -i.bak '/^BRAVE_API_KEY=/d' /etc/clawcode/env

# Restart on rolled-back artifacts
echo "686Shanghai" | sudo -S -p "" /bin/systemctl restart clawcode.service
```

---

## After deploy: next-step branches

| Operator decision | Next |
|---|---|
| `green-deploy` (warmed clean) | I update `110-RESUME.md` + `110-PROD-RETRY-PLAN.md` to reflect deploy state; we're now in "Gate B (Ramy-quiet)" → "Gate C (search canary flip)" of the retry plan |
| `green-deploy` + did Stage 2 BRAVE | I add a Discord smoke-prompt step; assuming it returns real results, proceed to Gate C |
| `red-deploy <details>` | Roll back per above; I investigate the failure mode; we triage |

**Resume signal:** `green-deploy` after Stage 4 verification passes, or `red-deploy <details>` with anomaly evidence.
