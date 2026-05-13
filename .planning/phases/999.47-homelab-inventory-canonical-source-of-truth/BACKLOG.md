# Backlog: Homelab Inventory System

## 999.47 — Build a canonical, agent-readable homelab inventory

Operator wants a single source of truth for everything running across the homelab (clawdy host, Unraid server, OC server, personal/work macs, mac mini, every VM, every container, every tunnel) and how each one is accessed. Today this knowledge is fragmented across:

- MEMORY.md entries scattered across agents
- 1Password vault items
- Tailscale admin console
- Unraid web UI
- Ad-hoc notes in Discord history

No agent has a complete picture, and a new agent has zero way to bootstrap it. Operator has to re-explain "what's on Unraid" every time.

### Goal

A version-controlled, agent-readable directory that captures:

1. **Stable facts** — what exists, what it does, who owns it, how to reach it
2. **Access pointers** — references to 1Password items (never literal secrets)
3. **Live state** — auto-refreshed snapshot of what's actually running right now
4. **Change history** — git so the inventory is auditable over time

### Proposed structure

```
/home/clawcode/homelab/
├── INVENTORY.md       ← hosts, VMs, containers, services
├── NETWORK.md         ← Tailscale IPs, port maps, DNS, Cloudflare tunnels
├── ACCESS.md          ← how to SSH/VNC/RDP each one (1P item references)
├── scripts/
│   ├── refresh.sh     ← polls tailscale + virsh + docker, regenerates Live State
│   └── verify.sh      ← sanity-check that everything in INVENTORY is actually reachable
└── .git/
```

### Categories to cover

- **Hosts:** clawdy (100.98.211.108), Unraid (100.117.234.17), OC server (100.71.14.96), Jas's MBP, work MBP, Mac mini
- **VMs (on Unraid):** WebServer, Windows11-Min, Moltbot-VM, HomeAssistant — purpose, current specs, who uses them
- **Containers (on Unraid):** novnc-auth, novnc-win11, etc.
- **Tunnels:** Cloudflare tunnels for vm.jjagpal.me, dashboard.finmentum.com, notify.earlscheibconcord.com, etc.
- **Services:** ClawCode daemon, OpenClaw, MariaDB, Plan Builder, dashboards
- **DNS:** what domains point where (Cloudflare team domain `finmentum.cloudflareaccess.com`, IONOS holdings, etc.)

### Acceptance criteria

- Any agent on clawdy host can read `/home/clawcode/homelab/INVENTORY.md` and understand what's deployed and how to access it
- Cron-driven `refresh.sh` keeps "Live State" sections honest (which VM is running, which container is up) — operator doesn't manually update
- Credentials never appear in the markdown — only 1P references like `op://clawdbot/win11-vm-password`
- New host/VM/container added → one new section in the relevant doc + commit; refresh.sh picks it up on next run
- Old/removed items get retired (moved to a `RETIRED.md` section), not deleted — preserves history

### Out of scope

- Building a UI for this (the markdown + git is the UI)
- Monitoring/alerting on host health (separate concern, already partially handled by fleet-alert)
- Cross-machine config sync (this is documentation, not configuration management)

### Discoverability for agents

Add a one-line pointer to each agent's MEMORY.md:
```
- [Homelab inventory](/home/clawcode/homelab/INVENTORY.md) — canonical source of truth for hosts, VMs, containers, access
```

Then every agent that auto-loads MEMORY.md sees it immediately and can `Read` the file on demand.

### Related

- `project_dashboard_finmentum_tailnet_bypass.md`, `project_cloudflare_team_domain.md`, `project_ionos_db_failover_active.md`, `host_clawdy_memory_tuning.md` — all are fragments of the inventory that should be consolidated/linked
- ClawCode `clawcode_memory_search` could index this on a refresh cadence for cross-agent semantic search

### Reporter

Jas, 2026-05-13 11:02 PT. Triggered by the realization that "where is X" knowledge is scattered and not portable across agents.
