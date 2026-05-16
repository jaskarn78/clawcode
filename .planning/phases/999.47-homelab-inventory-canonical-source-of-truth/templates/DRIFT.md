# Homelab Drift

This file is **auto-managed by `scripts/refresh.sh`** (Phase 999.47 Plan 03) and operator-reviewed when convenient.

Two purposes:

1. **Drift Items** — entries that `refresh.sh` saw in the live environment (`tailscale status`, `virsh list --all`, `docker ps -a`, `op item list`, `cloudflared tunnel list`) but which are NOT present in [INVENTORY.md](INVENTORY.md). Operator reviews and promotes to INVENTORY.md (with semantic notes) or moves to [RETIRED.md](RETIRED.md).
2. **Refresh Failures** — structured rows logged by `refresh.sh` when a polling step exits non-zero (network down, `op://` auth broken, virsh unreachable, etc.). Per D-04c, no commit on failure — but the failure is recorded here on the next successful run.

Per D-04a, [INVENTORY.md](INVENTORY.md) is NEVER auto-modified. This file is the only place machine-driven new entries land before the operator-intent gate.

## Drift Items

## Refresh Failures
