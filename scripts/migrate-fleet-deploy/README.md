# Fleet Migration Deploy Scripts

Server-side Python/bash artifacts used during the v2.1 OpenClaw → ClawCode
pilot migration (April 2026). Preserved for reproducibility / audit trail.

## `deploy-mcps-and-skill.py`

Edits `/etc/clawcode/clawcode.yaml` on the server to:
- Add `polygon-api` to the top-level `mcpServers:` map.
- Add the fleet MCP list (finnhub, finmentum-db, brave-search, playwright,
  google-workspace, fal-ai, browserless, finmentum-content, polygon-api) to
  all 5 fin-* agents.
- Add a smaller MCP set (brave-search, playwright, browserless,
  google-workspace, fal-ai) to non-fin migrated agents (personal, general,
  projects, research).
- Add the `new-reel` skill to `finmentum-content-creator`.

Idempotent — safe to re-run.

## `add-1p-finmentum.py`

Adds an explicit top-level `1password:` mcpServer entry using the
Finmentum service account token (by 1P item ID
`f24sxydllnmblltmwe6ue2hwfi`), and references it from all 5 fin-* agents.
Non-fin agents continue to use the daemon-wide OP_SERVICE_ACCOUNT_TOKEN
via auto-inject.

## Usage on server

```bash
sudo python3 /tmp/deploy-mcps-and-skill.py
sudo python3 /tmp/add-1p-finmentum.py
sudo chown clawcode:clawcode /etc/clawcode/clawcode.yaml
sudo systemctl restart clawcode
```
