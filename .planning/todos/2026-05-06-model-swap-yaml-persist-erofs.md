---
created: 2026-05-06T16:01:06.000Z
title: Model swap live-applies but YAML persistence fails with EROFS
area: model-management
severity: medium
reported_by: jjagpal (via Admin Clawdy channel)
host: clawdy (100.98.211.108)
files:
  - src/migration/yaml-writer.ts (atomic temp-file writer — `<path>.<pid>.<ts>.tmp` then rename; matches the EROFS error string)
  - src/manager/daemon.ts (set-model + skill-create call sites; both surface the same "live OK, persistence failed" parenthetical pattern)
  - clawcode.service systemd unit (suspected ProtectSystem=strict / ReadOnlyPaths covering /etc/)
---

## Symptom

When swapping an agent model via the Discord `/model` flow (e.g. Admin Clawdy: opus → sonnet), the live in-memory swap succeeds but persistence to disk fails with:

```
Model set to **sonnet** for Admin Clawdy (was opus).
(Note: live swap OK, but YAML persistence failed: EROFS: read-only file system,
 open /etc/clawcode/.clawcode.yaml.1730046.1778083249882.tmp)
```

After daemon restart the agent will revert to its YAML-declared model (opus), silently undoing the user's swap.

## Hypothesis

The model-config writer uses an atomic temp-file pattern (`.clawcode.yaml.<pid>.<ts>.tmp` then rename), but writes the temp file to `/etc/clawcode/` — which on clawdy is owned by root (config dir for the systemd-managed daemon). The daemon process must therefore have either:

1. Lost write access to `/etc/clawcode/` (perms drift, recent mount change, or systemd `ProtectSystem=strict` / `ReadOnlyPaths` hardening), OR
2. Always lacked write access and this codepath only triggers on live model swaps (not on every config read), so it has been silently broken since launch.

EROFS specifically points to a read-only mount or systemd filesystem-protection sandbox — not a permission denial (which would be EACCES).

## Repro

1. On clawdy: open Admin Clawdy Discord channel
2. Run `/model claude-sonnet-4-6` (or any other valid model id)
3. Observe success message followed by the EROFS persistence note
4. Restart `clawcode.service` — agent reverts to opus

## Fix direction

- Audit `clawcode.service` unit for `ProtectSystem`, `ReadOnlyPaths`, `ReadWritePaths` directives → `/etc/clawcode/` must be writable, or move persisted state to `/var/lib/clawcode/` (FHS-correct location for mutable daemon state)
- Confirm the temp-file write happens in the same dir as the target (required for atomic rename across same filesystem) — if state moves to `/var/lib/clawcode/`, the temp must too
- Surface the persistence failure as a hard error (not a parenthetical note), or emit a Discord warning embed so the user knows the swap won't survive restart

## Related

- Linked to dual-account overflow setup (memory: ClawCode dual-account overflow) — Account 2 on OC server runs as `jjagpal` from `~/.openclaw/...` which has no `/etc/clawcode/` at all, so this exact codepath would also fail on OC server (different reason: ENOENT not EROFS).
- **Same bug class affects `skill-create`:** `src/manager/daemon.ts:3301` already emits `"skill-create: YAML persist failed — skill linked in-memory only"` — same writer, same target dir, same EROFS path. Fix should cover both call sites in one shot.

## Pointer correction (2026-05-07)

Original suspected file `src/manager/model-config-writer.ts` does not exist. The real atomic writer is `src/migration/yaml-writer.ts` (verified via `src/migration/__tests__/yaml-writer.test.ts` Test 1: tmp path matches `/\.clawcode\.yaml\.\d+\.\d+\.tmp$/`).
