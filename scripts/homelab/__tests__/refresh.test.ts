/**
 * scripts/homelab/__tests__/refresh.test.ts
 *
 * Phase 999.47 Plan 03 — vitest spec for refresh.sh.
 *
 * Shells out to `bash scripts/homelab/refresh.sh` against a temp git repo
 * seeded from the canonical fixtures in `scripts/homelab/test-fixtures/`.
 * Eight scenarios pin the contract surface:
 *
 *   1. Happy path — counts match plan expectations + schema validates
 *   2. Drift — `<!-- drift:virsh:WildcatVM-NEW -->` marker filed
 *   3. Stale-down — OldVM marked `unreachable since <ts>` (D-04b)
 *   4. Failure path — `.refresh-last.json.ok=false` + DRIFT.md row
 *   5. Idempotency — second run with same fixtures → noDiff:true, no new commit
 *   6. Commit identity — clawcode-refresh <noreply@clawcode>
 *   7. consecutiveFailures — 3 back-to-back failures land consec=3
 *   8. Outside-marker invariant — byte-diff of non-managed regions
 *
 * Schema is imported from `src/homelab/refresh-output-schema.ts` so a Plan 02
 * contract change immediately surfaces as a Plan 03 test failure.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { refreshOutputSchema } from "../../../src/homelab/refresh-output-schema.js";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/homelab/refresh.sh");
const FIXTURES = path.join(REPO_ROOT, "scripts/homelab/test-fixtures");

interface Workspace {
  dir: string;
  invBefore: string;
}

function setupWorkspace(): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homelab-refresh-test-"));
  fs.copyFileSync(path.join(FIXTURES, "inventory-baseline.md"), path.join(dir, "INVENTORY.md"));
  fs.copyFileSync(path.join(FIXTURES, "drift-baseline.md"), path.join(dir, "DRIFT.md"));
  fs.writeFileSync(path.join(dir, "NETWORK.md"), "# Network\n");
  // Match Plan 01's bootstrap .gitignore — `.refresh-last.json` is
  // transient telemetry, NOT source-of-truth. If we don't exclude it the
  // first run's untracked write gets picked up by the second run's
  // `git add -A`, breaking the idempotency invariant.
  fs.writeFileSync(path.join(dir, ".gitignore"), ".refresh-last.json\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@e"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd: dir });
  const invBefore = fs.readFileSync(path.join(dir, "INVENTORY.md"), "utf8");
  return { dir, invBefore };
}

function teardown(ws: Workspace) {
  fs.rmSync(ws.dir, { recursive: true, force: true });
}

interface RunOptions {
  /** Override env vars before invocation. */
  env?: Record<string, string | undefined>;
  /** Allow non-zero exit (default: throw on non-zero). */
  allowNonZero?: boolean;
}

function runRefresh(ws: Workspace, opts: RunOptions = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOMELAB_REPO: ws.dir,
    HOMELAB_TS_FIXTURE: path.join(FIXTURES, "tailscale-status.json"),
    HOMELAB_UNRAID_VIRSH_FIXTURE: path.join(FIXTURES, "virsh-list.txt"),
    HOMELAB_UNRAID_DOCKER_FIXTURE: path.join(FIXTURES, "docker-ps.txt"),
    HOMELAB_TUNNELS_FIXTURE: path.join(FIXTURES, "cloudflared-tunnel-list.json"),
    HOMELAB_OP_FIXTURE: path.join(FIXTURES, "op-item-list.json"),
    HOMELAB_LOCK_FILE: path.join(ws.dir, "refresh.lock"),
    ...opts.env,
  };
  // Allow callers to *unset* an env var by passing undefined.
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) {
      delete env[k];
    }
  }
  const result = spawnSync("bash", [SCRIPT, "--repo-path", ws.dir], {
    env,
    encoding: "utf8",
  });
  if (!opts.allowNonZero && result.status !== 0) {
    throw new Error(
      `refresh.sh exited ${result.status}\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result;
}

function readRefreshLast(ws: Workspace) {
  const raw = fs.readFileSync(path.join(ws.dir, ".refresh-last.json"), "utf8");
  return JSON.parse(raw);
}

/**
 * Returns the file with every <!-- refresh.sh: managed --> ... <!-- end
 * refresh.sh: managed --> block replaced with a sentinel. Used to byte-diff
 * outside-marker regions.
 */
function stripManagedBlocks(s: string): string {
  return s.replace(
    /<!-- refresh\.sh: managed -->[\s\S]*?<!-- end refresh\.sh: managed -->/g,
    "<<MANAGED>>",
  );
}

let ws: Workspace;
beforeEach(() => {
  ws = setupWorkspace();
});
afterEach(() => {
  teardown(ws);
});

describe("Plan 03 / refresh.sh", () => {
  it("Test 1: happy path — schema-valid output + correct counts", () => {
    runRefresh(ws);
    const last = readRefreshLast(ws);

    // Schema-validity (Plan 02 frozen contract).
    const parsed = refreshOutputSchema.safeParse(last);
    expect(parsed.success).toBe(true);

    expect(last.ok).toBe(true);
    expect(last.schemaVersion).toBe(1);
    expect(last.counts.hostCount).toBe(4);
    expect(last.counts.vmCount).toBe(4);
    expect(last.counts.containerCount).toBe(2);
    expect(last.counts.driftCount).toBe(1);
    expect(last.counts.tunnelCount).toBe(3);
    expect(last.counts.dnsCount).toBe(0);
    expect(last.commitsha).toMatch(/^[0-9a-f]{40}$/);
    expect(last.noDiff).toBe(false);
    expect(last.consecutiveFailures).toBe(0);
  });

  it("Test 2: drift — DRIFT.md contains source-keyed marker for WildcatVM-NEW", () => {
    runRefresh(ws);
    const drift = fs.readFileSync(path.join(ws.dir, "DRIFT.md"), "utf8");
    expect(drift).toContain("<!-- drift:virsh:WildcatVM-NEW -->");
    expect(drift).toContain("**virsh** `WildcatVM-NEW`");
    expect(drift).toContain("source=virsh list --all");
  });

  it("Test 3: stale-down — OldVM marked unreachable, anchor NOT deleted", () => {
    runRefresh(ws);
    const inv = fs.readFileSync(path.join(ws.dir, "INVENTORY.md"), "utf8");
    // Anchor header survives (D-04b — NEVER delete).
    expect(inv).toContain("### OldVM");
    // Managed-block flagged unreachable.
    const oldvmBlock = inv.match(
      /<!-- refresh\.sh: managed -->\s*\nvm: oldvm[\s\S]*?<!-- end refresh\.sh: managed -->/,
    );
    expect(oldvmBlock).not.toBeNull();
    expect(oldvmBlock![0]).toMatch(/status: unreachable since 2\d{3}-\d{2}-\d{2}T/);
  });

  it("Test 4: failure path — .refresh-last.json.ok=false + DRIFT.md row + non-zero exit", () => {
    const res = runRefresh(ws, {
      env: { HOMELAB_TS_FIXTURE: "/nonexistent/tailscale-fixture" },
      allowNonZero: true,
    });
    expect(res.status).not.toBe(0);

    const last = readRefreshLast(ws);
    expect(last.ok).toBe(false);
    expect(typeof last.failureReason).toBe("string");
    expect((last.failureReason as string).length).toBeGreaterThan(0);
    expect(last.failureReason).toBe("tailscale-fixture-missing");

    // Cross-field invariant from Plan 02 schema must still hold.
    const parsed = refreshOutputSchema.safeParse(last);
    expect(parsed.success).toBe(true);

    const drift = fs.readFileSync(path.join(ws.dir, "DRIFT.md"), "utf8");
    expect(drift).toContain("## Refresh Failures");
    expect(drift).toMatch(/reason=tailscale-fixture-missing/);
  });

  it("Test 5: idempotency — second run sees noDiff:true and adds no commit", () => {
    runRefresh(ws);
    const commitsBefore = execFileSync("git", ["log", "--oneline"], {
      cwd: ws.dir,
      encoding: "utf8",
    }).split("\n").filter(Boolean).length;

    runRefresh(ws);
    const last = readRefreshLast(ws);
    expect(last.noDiff).toBe(true);
    expect(last.commitsha).toBeNull();

    const commitsAfter = execFileSync("git", ["log", "--oneline"], {
      cwd: ws.dir,
      encoding: "utf8",
    }).split("\n").filter(Boolean).length;
    expect(commitsAfter).toBe(commitsBefore);
  });

  it("Test 6: commit identity — clawcode-refresh <noreply@clawcode>", () => {
    runRefresh(ws);
    const author = execFileSync("git", ["log", "--format=%an <%ae>", "-1"], {
      cwd: ws.dir,
      encoding: "utf8",
    }).trim();
    expect(author).toBe("clawcode-refresh <noreply@clawcode>");
  });

  it("Test 7: consecutiveFailures rollover — three back-to-back failures → consec=3", () => {
    for (let i = 1; i <= 3; i++) {
      const res = runRefresh(ws, {
        env: { HOMELAB_TS_FIXTURE: "/nonexistent" },
        allowNonZero: true,
      });
      expect(res.status).not.toBe(0);
      const last = readRefreshLast(ws);
      expect(last.ok).toBe(false);
      expect(last.consecutiveFailures).toBe(i);
    }
  });

  it("Test 8: outside-marker invariant — non-managed regions byte-identical", () => {
    runRefresh(ws);
    const invAfter = fs.readFileSync(path.join(ws.dir, "INVENTORY.md"), "utf8");

    const beforeStripped = stripManagedBlocks(ws.invBefore);
    const afterStripped = stripManagedBlocks(invAfter);

    // Every byte outside the managed blocks must be identical.
    expect(afterStripped).toBe(beforeStripped);

    // And there must actually be managed blocks (sanity — we want the test
    // to fail if the fixture accidentally has no markers).
    expect(beforeStripped.split("<<MANAGED>>").length).toBeGreaterThan(2);
  });
});
