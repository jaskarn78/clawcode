# Homelab Network

**Addressing + topology** for everything in [INVENTORY.md](INVENTORY.md). Tailscale IPs, port maps, DNS, Cloudflare tunnels.

This file is **operator-edited** for stable facts and **machine-managed** inside the `Live State` fenced block. Do not hand-edit anything between the `<!-- refresh.sh: managed -->` markers.

> Cross-references: every entry here corresponds to a host/VM/container anchor in [INVENTORY.md](INVENTORY.md). Login mechanics live in [ACCESS.md](ACCESS.md).

---

## Tailscale Nodes

| Host          | Tailscale IP        | OS    | Notes                                                                            |
| ------------- | ------------------- | ----- | -------------------------------------------------------------------------------- |
| [clawdy](INVENTORY.md#clawdy)         | 100.98.211.108      | Linux | ClawCode daemon host. `/opt/clawcode/` install. `clawcode` systemd user.        |
| [Unraid](INVENTORY.md#unraid)         | 100.117.234.17      | Unraid | libvirt + docker hypervisor for the VMs and novnc containers.                   |
| [OC server](INVENTORY.md#oc-server)   | 100.71.14.96        | Linux | Legacy OpenClaw host.                                                            |
| [Jas's MBP](INVENTORY.md#jass-mbp)    | *(refresh.sh will populate)* | macOS | Personal laptop.                                                  |
| [work MBP](INVENTORY.md#work-mbp)     | *(refresh.sh will populate)* | macOS | Work laptop.                                                      |
| [Mac mini](INVENTORY.md#mac-mini)     | *(refresh.sh will populate)* | macOS | Mac mini.                                                         |

---

## Cloudflare Tunnels

| Hostname                       | Tunnel ID                    | Service                       | Behind                                       |
| ------------------------------ | ---------------------------- | ----------------------------- | -------------------------------------------- |
| vm.jjagpal.me                  | *(refresh.sh will populate)* | noVNC for Windows11-Min       | [Unraid](INVENTORY.md#unraid) / [novnc-win11](INVENTORY.md#novnc-win11) |
| dashboard.finmentum.com        | *(refresh.sh will populate)* | Finmentum dashboard           | *(operator: fill in upstream)*               |
| notify.earlscheibconcord.com   | *(refresh.sh will populate)* | Notification webhook surface  | *(operator: fill in upstream)*               |

---

## DNS

### Cloudflare Access team domain

- **`finmentum.cloudflareaccess.com`** — Cloudflare Access team domain. Gates the tunneled services above via Cloudflare Zero Trust policies.

### IONOS holdings

*(operator: enumerate IONOS-registered domains at refresh time — `vm.jjagpal.me`, `earlscheibconcord.com`, etc., are routed through Cloudflare but the registrar of record may be IONOS.)*

---

## Port Map

*(operator: fill in once first refresh cycle lands. Conventional ports for the homelab go here — SSH on 22, novnc on 6080/6081, etc.)*

---

## Live State

```yaml
<!-- refresh.sh: managed -->
domain: network
last_refresh: not-yet-refreshed
tailscale_nodes_seen: 0
cloudflare_tunnels_seen: 0
source: bootstrap
<!-- end refresh.sh: managed -->
```
