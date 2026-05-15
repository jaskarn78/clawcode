# Homelab Inventory

**Canonical source of truth** for everything that exists in the homelab — hosts, VMs, containers, services. Addressing lives in [NETWORK.md](NETWORK.md). Login mechanics live in [ACCESS.md](ACCESS.md).

This file is **operator-edited** for stable facts (Purpose / Owner / Lifecycle / Tags) and **machine-managed** inside the `Live State` fenced blocks (Plan 03's `refresh.sh` rewrites them). Do not hand-edit anything between the `<!-- refresh.sh: managed -->` markers.

> Conventions:
> - Each `## <Name>` section is an **anchor** referenced by NETWORK.md and ACCESS.md.
> - `### Stable Facts` is human-written.
> - `### Live State` is auto-managed; placeholder values land at bootstrap.
> - Items never deleted — decommissioned entries move to [RETIRED.md](RETIRED.md).

---

## Hosts

### clawdy

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** host, linux, systemd, clawcode-daemon
- **Notes:** Runs the ClawCode daemon under the `clawcode` systemd user from `/opt/clawcode/`. See [NETWORK.md#clawdy](NETWORK.md#clawdy) and [ACCESS.md#clawdy](ACCESS.md#clawdy).

#### Live State

```yaml
<!-- refresh.sh: managed -->
host: clawdy
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### Unraid

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** host, hypervisor, libvirt, docker
- **Notes:** Hypervisor host for the four VMs + two novnc containers below. See [NETWORK.md#unraid](NETWORK.md#unraid) and [ACCESS.md#unraid](ACCESS.md#unraid).

#### Live State

```yaml
<!-- refresh.sh: managed -->
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### OC server

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** legacy
- **Tags:** host, linux, openclaw-legacy
- **Notes:** Legacy OpenClaw host pre-dating the ClawCode migration. See [NETWORK.md#oc-server](NETWORK.md#oc-server) and [ACCESS.md#oc-server](ACCESS.md#oc-server).

#### Live State

```yaml
<!-- refresh.sh: managed -->
host: oc-server
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### Jas's MBP

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** active
- **Tags:** host, macos, laptop, personal
- **Notes:** Personal MacBook Pro. Tailscale IP populated by refresh.sh.

#### Live State

```yaml
<!-- refresh.sh: managed -->
host: jas-mbp
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### work MBP

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** active
- **Tags:** host, macos, laptop, work
- **Notes:** Work-issued MacBook Pro. Tailscale IP populated by refresh.sh.

#### Live State

```yaml
<!-- refresh.sh: managed -->
host: work-mbp
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### Mac mini

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** active
- **Tags:** host, macos, desktop
- **Notes:** Mac mini. Tailscale IP populated by refresh.sh.

#### Live State

```yaml
<!-- refresh.sh: managed -->
host: mac-mini
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

## VMs (on Unraid)

### WebServer

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** vm, unraid, libvirt
- **Notes:** Runs on [Unraid](#unraid). See [ACCESS.md#webserver](ACCESS.md#webserver).

#### Live State

```yaml
<!-- refresh.sh: managed -->
vm: webserver
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### Windows11-Min

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** vm, unraid, libvirt, windows
- **Notes:** Windows 11 VM, accessed via novnc-win11 web console. See [ACCESS.md#windows11-min](ACCESS.md#windows11-min).

#### Live State

```yaml
<!-- refresh.sh: managed -->
vm: windows11-min
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### Moltbot-VM

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** vm, unraid, libvirt
- **Notes:** Moltbot VM. See [ACCESS.md#moltbot-vm](ACCESS.md#moltbot-vm).

#### Live State

```yaml
<!-- refresh.sh: managed -->
vm: moltbot-vm
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### HomeAssistant

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** vm, unraid, libvirt, home-automation
- **Notes:** Home Assistant VM. See [ACCESS.md#homeassistant](ACCESS.md#homeassistant).

#### Live State

```yaml
<!-- refresh.sh: managed -->
vm: homeassistant
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

## Containers (on Unraid)

### novnc-auth

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** container, unraid, docker, novnc
- **Notes:** noVNC auth proxy container. Fronts the VM web consoles. See [NETWORK.md#cloudflare-tunnels](NETWORK.md#cloudflare-tunnels).

#### Live State

```yaml
<!-- refresh.sh: managed -->
container: novnc-auth
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### novnc-win11

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** container, unraid, docker, novnc, windows
- **Notes:** noVNC console for [Windows11-Min](#windows11-min). Reached via [vm.jjagpal.me](NETWORK.md#cloudflare-tunnels).

#### Live State

```yaml
<!-- refresh.sh: managed -->
container: novnc-win11
host: unraid
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

## Services

### ClawCode daemon

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** production
- **Tags:** service, systemd, clawcode
- **Notes:** Runs on [clawdy](#clawdy) under the `clawcode` systemd user from `/opt/clawcode/`. Multi-agent orchestration daemon. See `CLAUDE.md` § Deploy.

#### Live State

```yaml
<!-- refresh.sh: managed -->
service: clawcode-daemon
host: clawdy
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```

---

### OpenClaw

#### Stable Facts

- **Purpose:** *(operator: fill in)*
- **Owner:** *(operator: fill in)*
- **Lifecycle:** legacy
- **Tags:** service, openclaw-legacy
- **Notes:** Pre-ClawCode gateway. Runs on [OC server](#oc-server). Retained for historical reference; migrate-out tracked elsewhere.

#### Live State

```yaml
<!-- refresh.sh: managed -->
service: openclaw
host: oc-server
status: unknown
last_seen: not-yet-refreshed
source: bootstrap
<!-- end refresh.sh: managed -->
```
