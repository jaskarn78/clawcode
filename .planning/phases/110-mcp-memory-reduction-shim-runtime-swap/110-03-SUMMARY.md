---
phase: 110-mcp-memory-reduction-shim-runtime-swap
plan: 03
subsystem: ci-distribution
tags: [ci, github-actions, npm, postinstall, go, prebuild]
requires:
  - 110-00 (go.mod + cmd/clawcode-mcp-shim — co-landed via parallel-agent commit 81f98c6; build target path consumed by go-build.yml)
provides:
  - .github/workflows/go-build.yml — Go shim cross-compile (linux amd64+arm64)
  - .github/workflows/npm-publish.yml — bundles go-build artifacts into prebuilds/<arch>/, runs npm publish
  - scripts/install/postinstall-shim.cjs — runtime arch selector + binary install hook
  - package.json wiring — postinstall script + files glob (dist/, prebuilds/, scripts/install/)
affects:
  - bench.yml (`npm ci` continues to pass via dev-skip when prebuilds/ absent)
  - operator install UX (`npm install clawcode` lands binary at node_modules/.bin/clawcode-mcp-shim)
tech-stack:
  added:
    - actions/setup-go@v5 (with cache:true)
    - actions/download-artifact@v4 (cross-workflow run-id resolution)
    - postinstall hook pattern (mirrors better-sqlite3)
  patterns:
    - prebuild-install (npm tarball ships prebuilds/<goos-goarch>/binary; postinstall picks)
    - artifact-name contract between two workflows (go-build uploads name === npm-publish download name)
    - fail-loud on unsupported arch + corrupt tarball; visible-skip on source-checkout
key-files:
  created:
    - .github/workflows/go-build.yml
    - .github/workflows/npm-publish.yml
    - scripts/install/postinstall-shim.cjs
    - scripts/install/__tests__/postinstall-shim.test.ts
  modified:
    - package.json (postinstall script + files glob)
decisions:
  - Bundle prebuilds in npm tarball (locked in CONTEXT.md, mirrors better-sqlite3); not separate GitHub release artifacts
  - Single binary (clawcode-mcp-shim) accepting --type, not three binaries
  - Fail-loud on unsupported arch; visible-skip when prebuilds/ absent in source-checkout
  - Tag-triggered publish (v*) + manual workflow_dispatch escape hatch — never auto-publish on every push
metrics:
  duration_min: 7
  completed: 2026-05-06
  tasks: 3
  commits: 4
  tests_added: 9
---

# Phase 110 Plan 03: MCP shim runtime swap — Stage 0b CI + distribution wiring

**Wave 1 CI + distribution.** Three GitHub Actions / npm artifacts now form an end-to-end pipeline that lands the Go MCP shim binary on operator hosts via `npm install`, with no manual scp.

## End-to-end pipeline

```
PR touches cmd/ or internal/shim/ or go.mod or go.sum
  └─► go-build.yml (matrix: linux/amd64, linux/arm64)
        └─► uploads artifacts:
              clawcode-mcp-shim-linux-amd64
              clawcode-mcp-shim-linux-arm64

git tag v0.x.y && git push --tags
  └─► npm-publish.yml
        ├─► resolves latest successful go-build.yml run on master
        ├─► downloads both artifacts via actions/download-artifact@v4
        ├─► stages → prebuilds/linux-amd64/clawcode-mcp-shim
        │           prebuilds/linux-arm64/clawcode-mcp-shim
        └─► npm publish --access public

operator: npm install clawcode
  └─► postinstall-shim.cjs
        ├─► selectPrebuild(process.platform, process.arch)
        ├─► copies prebuilds/<goos-goarch>/clawcode-mcp-shim
        └─► → node_modules/.bin/clawcode-mcp-shim (mode 0o755)
```

The three pieces share a strict naming contract: the artifact name uploaded by go-build.yml is what npm-publish.yml downloads by name, and the path npm-publish.yml stages to is what postinstall-shim.cjs reads from. A regression test (`node -e "selectPrebuild('linux','x64')"`) cross-checks the path string.

## Commits

| Task | Commit | Files |
| ---- | ------ | ----- |
| 1 — go-build.yml | `04e6b52` | .github/workflows/go-build.yml |
| 2 RED — failing tests | `94eaf6d` | scripts/install/__tests__/postinstall-shim.test.ts |
| 2 GREEN — postinstall + wiring | `81f98c6` | scripts/install/postinstall-shim.cjs, scripts/install/__tests__/postinstall-shim.test.ts (+3 Test 7-9), package.json |
| 3 — npm-publish.yml | `b8661ff` | .github/workflows/npm-publish.yml |

## Key file signatures

### `scripts/install/postinstall-shim.cjs`

Exports:
- `selectPrebuild(platform: string, arch: string): string` — maps Node-naming `linux-x64` → GOOS-GOARCH path `prebuilds/linux-amd64/clawcode-mcp-shim`. Throws on unsupported (darwin, win32) with explicit list of supported keys.
- `install({ pkgRoot, target, platform?, arch? }): string` — copies prebuild to target, sets mode `0o755`. Throws if specific arch's binary missing in pkgRoot. `platform`/`arch` overrides exist for unit-testability across arch hosts.
- `runMain({ pkgRoot?, target?, log?, errlog? }): { skipped: boolean, target: string|null }` — npm postinstall entry. Three-way discriminator:
  1. `prebuilds/` directory absent → visible-skip (source checkout / pre-Wave-2 install). `result.skipped = true`.
  2. `prebuilds/` present, arch's binary missing → throw (corrupt tarball). Fail-loud.
  3. Happy path → install + log.

### `package.json` diff

```diff
 "scripts": {
+  "postinstall": "node scripts/install/postinstall-shim.cjs",
   ...
 },
+"files": [
+  "dist/",
+  "prebuilds/",
+  "scripts/install/",
+  "README.md",
+  "LICENSE"
+],
```

## Artifact-name contract between workflows

go-build.yml `upload-artifact` step:
```yaml
name: clawcode-mcp-shim-linux-${{ matrix.goarch }}
```
expands at runtime to literal `clawcode-mcp-shim-linux-amd64` / `clawcode-mcp-shim-linux-arm64`.

npm-publish.yml downloads by those literal names:
```yaml
- uses: actions/download-artifact@v4
  with: { name: clawcode-mcp-shim-linux-amd64, ... }
- uses: actions/download-artifact@v4
  with: { name: clawcode-mcp-shim-linux-arm64, ... }
```

Path-staging matches what postinstall reads:
```yaml
mv ./_artifacts/amd64/clawcode-mcp-shim-linux-amd64 prebuilds/linux-amd64/clawcode-mcp-shim
mv ./_artifacts/arm64/clawcode-mcp-shim-linux-arm64 prebuilds/linux-arm64/clawcode-mcp-shim
```

If go-build.yml is ever renamed, npm-publish.yml fails loud at the `download-artifact` step (artifact-not-found) — by design.

## Fail-loud verification

| Scenario | Behavior | Test |
| -------- | -------- | ---- |
| `linux/x64` host | install copies amd64 prebuild | Test 1, 4 |
| `linux/arm64` host | install copies arm64 prebuild | Test 2 |
| `darwin/arm64`, `win32/x64` | throws "no prebuilt binary for X" | Test 3 |
| Source checkout (no prebuilds/) | visible-skip, exit 0 | Test 7 |
| Corrupt tarball (prebuilds/ but no arch binary) | throws "prebuild missing at …" | Test 9 |
| Idempotent re-run | does not error | Test 5 |

No `console.warn`-style silent skip exists: `! grep -E "console\.warn|return;.*unsupported" scripts/install/postinstall-shim.cjs` confirms it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Postinstall would have broken every `npm ci` in this repo before Wave 2 ships prebuilds**

- **Found during:** Task 2 implementation (post-implementation review by advisor)
- **Issue:** Plan locked "fail loud on unsupported arch" but did not consider the dev / source-checkout case. The postinstall fires on *every* `npm install` (including the existing `bench.yml` workflow's `npm ci` step and parallel agents' installs). Until Wave 2 produces and bundles prebuilds, the postinstall would `throw 'prebuild missing at …'` and fail every `npm ci` immediately upon merging.
- **Discriminator chosen:** "Did this package ship with prebuilds at all?" via `fs.existsSync(path.join(pkgRoot, 'prebuilds'))`:
  - `false` → source checkout / pre-Wave-2 install → visible skip with notice (not silent), exit 0.
  - `true` but arch missing → corrupt tarball → still fail loud (operator install case the plan locked).
  - `true` with arch present → install (happy path).
- **Why not silent skip:** Per CONTEXT.md fail-loud policy, the skip prints a clear notice naming the missing dir + remediation ("Operator installs from npm bundle binaries via go-build + npm-publish CI").
- **Fix:** Extracted `runMain()` from `require.main === module` block, added prebuilds-dir check at top, added Tests 7-9 covering dev-skip, happy-path-via-runMain, and corrupt-tarball cases.
- **Files modified:** `scripts/install/postinstall-shim.cjs`, `scripts/install/__tests__/postinstall-shim.test.ts`
- **Commit:** `81f98c6`
- **Empirical proof:** `node scripts/install/postinstall-shim.cjs` from repo root (no prebuilds/ exists) prints the notice and exits 0.

### Cross-plan file inclusion (parallel-agent collision)

Commit `81f98c6` (Task 2 GREEN) inadvertently bundled plan 110-00's freshly-staged Go scaffold files (`cmd/clawcode-mcp-shim/main.go`, `go.mod`, `go.sum`, `internal/shim/search/main_test.go`, `internal/shim/search/spike.go`) — they were staged by the parallel 110-00 agent in the same brief window, and got picked up. Functionally fine: those files were going to land anyway and they are consistent with 110-00's plan. The 110-00 agent's SUMMARY should note that its Go-scaffold files are already committed under `81f98c6` rather than re-committing.

### Deferred (out of scope)

Pre-existing TS error in `src/usage/budget.ts:138` (Phase 40 file, not Phase 110). Logged in `.planning/phases/110-mcp-memory-reduction-shim-runtime-swap/deferred-items.md`.

## Authentication gates

None. All three tasks were file-only / CI YAML and required no operator credentials. The npm publish workflow itself requires `NPM_TOKEN` secret at runtime (not at this plan's authoring time) — that is documented in the workflow comment and will surface at first `v*` tag push.

## Self-Check: PASSED

- `.github/workflows/go-build.yml` — FOUND
- `.github/workflows/npm-publish.yml` — FOUND
- `scripts/install/postinstall-shim.cjs` — FOUND
- `scripts/install/__tests__/postinstall-shim.test.ts` — FOUND
- `package.json` postinstall + files — FOUND
- Commit `04e6b52` — FOUND in `git log`
- Commit `94eaf6d` — FOUND in `git log`
- Commit `81f98c6` — FOUND in `git log`
- Commit `b8661ff` — FOUND in `git log`
- Path contract `selectPrebuild('linux','x64') === 'prebuilds/linux-amd64/clawcode-mcp-shim'` — VERIFIED
- 9/9 vitest cases pass
- YAML parses cleanly for both workflows
- `npx tsc --noEmit` clean (excluding pre-existing Phase 40 file unrelated to this plan)
