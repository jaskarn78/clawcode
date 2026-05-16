# Phase 96 — Production Evidence

This directory holds operator-provided evidence that motivated Phase 96 scope.

## Expected files

- `discord-2026-04-25-finmentum-client-acquisition.png` — Clawdy bot reply in `#finmentum-client-acquisition` claiming `/home/jjagpal/.openclaw/workspace-finmentum/clients/tara-maffeo/` "is not accessible from my side" and recommending OpenClaw fallback. **Bug:** belief is stale — operator had already added `clawcode` user to `jjagpal` group, set `clawcode:rwX` ACLs, and relaxed systemd `ProtectHome=tmpfs` earlier the same day.
- Any subsequent screenshots demonstrating the bug or post-fix verification.

## Untracked workspace files (likely related)

At time of Phase 96 discussion, the following files existed at repo root (untracked):

- `Screenshot 2026-04-11 at 1.09.49 PM.png` — Obsidian graph + Cross-Entropy Loss note; pre-dates Phase 96 (likely Phase 95 reference material). Not directly Phase 96 scope.
- `amazon-reuzel-beard-foam.png` — Amazon search results page capture.
- `reuzel-beard-foam-product.png` — Amazon product page capture (Reuzel Beard Foam).

The Reuzel screenshots likely represent agent-output that landed at workspace root instead of being uploaded via `clawcode_share_file`. Phase 96 D-09 (`agents.*.outputDir` template) + D-10 (response-references-file auto-upload) directly address this failure mode.

## How to add evidence

Drop screenshots in this directory and commit alongside Phase 96 artifacts:

```bash
git add .planning/phases/96-discord-routing-and-file-sharing-hygiene/evidence/
git commit -m "docs(96): add production evidence screenshot"
```
