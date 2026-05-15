# Homelab Access

**How to log in** to every host / VM / container / service in [INVENTORY.md](INVENTORY.md). SSH / VNC / RDP CLI snippets + 1Password `op://` references.

**Hard rule — zero literal secrets:** every credential below is an `op://<vault>/<item>/<field>` reference. If you find a literal password, token, or private key in this file, that is a security incident — rotate the secret immediately and replace the literal with an `op://` ref. The bootstrap `op://clawdbot/PLACEHOLDER-*` references are placeholders the operator confirms during the first refresh.

Cross-references: every section here corresponds to an anchor in [INVENTORY.md](INVENTORY.md); addressing lives in [NETWORK.md](NETWORK.md).

---

## clawdy

### SSH

```bash
ssh jjagpal@100.98.211.108
# or via Tailscale MagicDNS:
ssh jjagpal@clawdy
```

### Credentials

- SSH key: local `~/.ssh/id_*` — see op://clawdbot/PLACEHOLDER-clawdy-ssh/private-key *(operator: confirm op-item path)*
- Sudo password (for the `jjagpal` operator account): op://clawdbot/PLACEHOLDER-clawdy-sudo/password *(operator: confirm op-item path)*
- Deploy-script password file: `~/.clawcode-deploy-pw` on dev box (chmod 600) — see `CLAUDE.md` § Deploy.

---

## Unraid

### SSH

```bash
ssh root@100.117.234.17
```

### Web UI

- Unraid web console — see op://clawdbot/PLACEHOLDER-unraid-webui/url *(operator: confirm op-item path)*

### Credentials

- Root password: op://clawdbot/PLACEHOLDER-unraid-root/password *(operator: confirm op-item path)*
- Web UI login: op://clawdbot/PLACEHOLDER-unraid-webui/password *(operator: confirm op-item path)*

---

## OC server

### SSH

```bash
ssh jjagpal@100.71.14.96
```

### Credentials

- SSH key: op://clawdbot/PLACEHOLDER-oc-server-ssh/private-key *(operator: confirm op-item path)*
- Sudo password: op://clawdbot/PLACEHOLDER-oc-server-sudo/password *(operator: confirm op-item path)*

---

## Jas's MBP

### SSH

```bash
# Tailscale MagicDNS — IP populated by refresh.sh
ssh jjagpal@jas-mbp
```

### Credentials

- Login password: op://clawdbot/PLACEHOLDER-jas-mbp-login/password *(operator: confirm op-item path)*

---

## work MBP

### SSH

```bash
ssh jjagpal@work-mbp
```

### Credentials

- Login password: op://clawdbot/PLACEHOLDER-work-mbp-login/password *(operator: confirm op-item path)*

---

## Mac mini

### SSH

```bash
ssh jjagpal@mac-mini
```

### VNC/RDP

- Screen Sharing — see op://clawdbot/PLACEHOLDER-mac-mini-screen-sharing/url *(operator: confirm op-item path)*

### Credentials

- Login password: op://clawdbot/PLACEHOLDER-mac-mini-login/password *(operator: confirm op-item path)*

---

## WebServer

### SSH (via Unraid host)

```bash
ssh root@100.117.234.17 -- virsh console WebServer
# or once IP is known on the libvirt bridge:
# ssh <user>@<vm-ip>
```

### Credentials

- VM root: op://clawdbot/PLACEHOLDER-webserver-root/password *(operator: confirm op-item path)*

---

## Windows11-Min

### VNC/RDP

- noVNC via Cloudflare tunnel: https://vm.jjagpal.me (gated by [Cloudflare Access](NETWORK.md#cloudflare-access-team-domain))
- RDP fallback: see op://clawdbot/win11-vm-password/url *(operator: confirm op-item path)*

### Credentials

- VM login: op://clawdbot/win11-vm-password/password
- noVNC auth: op://clawdbot/PLACEHOLDER-novnc-auth/password *(operator: confirm op-item path)*

---

## Moltbot-VM

### SSH (via Unraid host)

```bash
ssh root@100.117.234.17 -- virsh console Moltbot-VM
```

### Credentials

- VM login: op://clawdbot/PLACEHOLDER-moltbot-vm-login/password *(operator: confirm op-item path)*

---

## HomeAssistant

### Web UI

- Home Assistant web — see op://clawdbot/PLACEHOLDER-homeassistant-webui/url *(operator: confirm op-item path)*

### Credentials

- HA admin: op://clawdbot/PLACEHOLDER-homeassistant-admin/password *(operator: confirm op-item path)*

---

## novnc-auth

### Web

- Auth proxy fronting the novnc consoles. URL: op://clawdbot/PLACEHOLDER-novnc-auth/url *(operator: confirm op-item path)*

### Credentials

- Proxy login: op://clawdbot/PLACEHOLDER-novnc-auth/password *(operator: confirm op-item path)*

---

## novnc-win11

### Web

- https://vm.jjagpal.me (Cloudflare Access)

### Credentials

- Console password: op://clawdbot/PLACEHOLDER-novnc-win11/password *(operator: confirm op-item path)*

---

## ClawCode daemon

### Service control (on clawdy)

```bash
ssh jjagpal@100.98.211.108 'sudo systemctl status clawcode'
ssh jjagpal@100.98.211.108 'sudo journalctl -u clawcode -n 100 --no-pager'
```

### Credentials

- Daemon sudo (clawdy): op://clawdbot/PLACEHOLDER-clawdy-sudo/password *(operator: confirm op-item path)*

---

## OpenClaw

### SSH

```bash
ssh jjagpal@100.71.14.96
```

### Credentials

- Service account: op://clawdbot/PLACEHOLDER-openclaw-service/password *(operator: confirm op-item path)*
