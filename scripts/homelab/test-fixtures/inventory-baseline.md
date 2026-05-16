# Homelab Inventory

Test-fixture INVENTORY.md for Phase 999.47 Plan 03's vitest spec. Subset
of the production template — same shape but stripped to the anchors the
fixture-driven discovery JSON references.

Operator-edited stable facts (lines outside `<!-- refresh.sh: managed -->`
markers) MUST be byte-identical before and after refresh.sh — Test 8 of
`refresh.test.ts` enforces this invariant.

---

## Hosts

### clawdy

#### Stable Facts

- **Purpose:** ClawCode daemon host.
- **Lifecycle:** production

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

- **Purpose:** Hypervisor.
- **Lifecycle:** production

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

- **Purpose:** Legacy.
- **Lifecycle:** legacy

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

- **Purpose:** Personal laptop.
- **Lifecycle:** active

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

## VMs (on Unraid)

### WebServer

#### Stable Facts

- **Purpose:** Web frontend.
- **Lifecycle:** production

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

- **Purpose:** Windows desktop VM.
- **Lifecycle:** production

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

- **Purpose:** Moltbot.
- **Lifecycle:** production

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

- **Purpose:** Home Assistant.
- **Lifecycle:** production

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

### OldVM

#### Stable Facts

- **Purpose:** Decommissioned but not retired yet — fixture for stale-down test (D-04b).
- **Lifecycle:** retiring

#### Live State

```yaml
<!-- refresh.sh: managed -->
vm: oldvm
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

- **Purpose:** noVNC auth proxy.
- **Lifecycle:** production

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

- **Purpose:** noVNC console for Windows11-Min.
- **Lifecycle:** production

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
